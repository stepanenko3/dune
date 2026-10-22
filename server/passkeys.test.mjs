// Паскеї й двофакторна перевірка: справжній шлях через сервер, з «автентифікатором» на вбудованому crypto (ключі
// P-256 і Ed25519, CBOR — як віддає браузер). Обв'язка — як у security.test.mjs: SQLite і Postgres <DB_DATABASE>_testing.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Encoder } from 'cbor-x'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'
import { base32, checkCode, codeAt, stepOf, unbase32 } from './lib/totp.mjs'

const SCHEMA = `pk_${process.pid}_${Date.now().toString(36)}`
let pg = null
try {
  const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  if (env.DB_HOST && env.DB_CONNECTION !== 'sqlite') {
    pg = { host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: `${env.DB_DATABASE || 'dune'}_testing`, user: env.DB_USERNAME || 'postgres', password: env.DB_PASSWORD || undefined }
    const probe = await openDb({ pg }).catch(() => null)
    if (probe) {
      await probe.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`)
      await probe.close()
      pg = { ...pg, options: `-c search_path=${SCHEMA}` }
    } else pg = null
  }
} catch { pg = null }
const ENGINES = [['SQLite', null], ...(pg ? [['Postgres', pg]] : [])]

const cbor = new Encoder({ mapsAsObjects: false, useRecords: false })
const sha256 = (b) => crypto.createHash('sha256').update(b).digest()
const b64u = (b) => Buffer.from(b).toString('base64url')

/** «автентифікатор»: створює ключ і підписує, як браузер; kind — 'ec' (ES256) чи 'ed' (EdDSA) */
function authenticator(kind = 'ec') {
  const { privateKey, publicKey } = kind === 'ed' ? crypto.generateKeyPairSync('ed25519') : crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const cose = kind === 'ed'
    ? new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x, 'base64url')]])
    : new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]])
  const credId = crypto.randomBytes(16)
  let counter = 0
  let userHandle = null
  const client = (type, challenge, origin) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
  return {
    id: b64u(credId),
    set counter(n) { counter = n },
    create(pk, origin) {
      userHandle = Buffer.from(pk.user.id, 'base64url')
      const head = Buffer.alloc(37)
      sha256(pk.rp.id).copy(head, 0)
      head[32] = 0x45 // UP | UV | AT
      head.writeUInt32BE(counter, 33)
      const len = Buffer.alloc(2)
      len.writeUInt16BE(credId.length)
      const authData = Buffer.concat([head, Buffer.alloc(16), len, credId, cbor.encode(cose)])
      return {
        id: b64u(credId), rawId: b64u(credId), type: 'public-key',
        response: { clientDataJSON: b64u(client('webauthn.create', pk.challenge, origin)), attestationObject: b64u(cbor.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))), transports: ['internal'] },
      }
    },
    get(pk, origin, { flags = 0x05 } = {}) {
      const authData = Buffer.alloc(37)
      sha256(pk.rpId).copy(authData, 0)
      authData[32] = flags
      authData.writeUInt32BE(counter, 33)
      const cd = client('webauthn.get', pk.challenge, origin)
      const data = Buffer.concat([authData, sha256(cd)])
      const signature = kind === 'ed' ? crypto.sign(null, data, privateKey) : crypto.sign('sha256', data, privateKey)
      return {
        id: b64u(credId), rawId: b64u(credId), type: 'public-key',
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: userHandle ? b64u(userHandle) : null },
      }
    },
  }
}

describe('TOTP', () => {
  it('рахує як RFC 6238 (SHA1, 30 с) і не приймає той самий крок двічі', () => {
    const secret = base32(Buffer.from('12345678901234567890'))
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(unbase32(secret).toString()).toBe('12345678901234567890')
    expect(codeAt(secret, 1)).toBe('287082') // T = 59 с
    expect(codeAt(secret, 37037036)).toBe('081804') // T = 1111111109 с
    const now = 1111111109_000
    expect(checkCode(secret, '081804', 0, now)).toBe(37037036)
    expect(checkCode(secret, '081 804', 37037036, now)).toBeNull()
    expect(checkCode(secret, '000000', 0, now)).toBeNull()
  })
})

describe.each(ENGINES)('%s', (_name, pgCfg) => {
  let server, base, origin, ipBase, dir, app, db
  const mail = []
  const codeFor = (email) => [...mail].reverse().find((m) => m.to === email)?.text.match(/\b\d{6}\b/)?.[0]

  let ips = 0
  function agent({ at = () => base, from = () => origin } = {}) {
    let cookie = ''
    // своя адреса кожному «браузеру» — щоб не впертися в ліміт кодів входу з однієї адреси
    const ip = `10.9.${Math.floor(++ips / 250)}.${ips % 250 + 1}`
    const call = async (method, url, body) => {
      const r = await fetch(at() + url, {
        method,
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: from(), 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const set = r.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
      return { status: r.status, body: await r.json().catch(() => null) }
    }
    const a = {
      get cookie() { return cookie },
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      patch: (u, b) => call('PATCH', u, b),
      del: (u, b) => call('DELETE', u, b),
      async code(email) {
        expect((await a.post('/api/auth/code', { email })).status).toBe(200)
        return a.post('/api/auth/verify', { email, code: codeFor(email) })
      },
      async addPasskey(key, name) {
        const o = await a.post('/api/me/passkeys/options')
        expect(o.status).toBe(200)
        return a.post('/api/me/passkeys', { ticket: o.body.ticket, credential: key.create(o.body.publicKey, origin), ...(name ? { name } : {}) })
      },
      async passkey(key, opts) {
        const o = await a.post('/api/auth/passkey/options')
        expect(o.status).toBe(200)
        return a.post('/api/auth/passkey', { ticket: o.body.ticket, credential: key.get(o.body.publicKey, origin, opts) })
      },
    }
    return a
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-pk-'))
    db = await openDb({ dataDir: dir, pg: pgCfg })
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    const port = server.address().port
    // паскеї — лише на імені сайту: localhost (за IP браузер їх не дає, сервер теж відмовляє)
    base = `http://localhost:${port}`
    origin = base
    ipBase = `http://127.0.0.1:${port}`
  })
  afterAll(async () => {
    await new Promise((r) => server.close(r))
    await app.locals.close?.()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('додає паскей і входить ним без пошти; повтор і чужий сайт — ні', async () => {
    const me = agent()
    await me.code('pk1@example.com')
    const key = authenticator('ec')
    const add = await me.addPasskey(key)
    expect(add.status).toBe(201)
    expect(add.body.passkeys).toHaveLength(1)
    expect(add.body.passkeys[0].name).toBe('Паскей')
    // той самий ключ удруге — ні
    expect((await me.addPasskey(key)).status).toBe(409)

    const phone = agent()
    const r = await phone.passkey(key)
    expect(r.status).toBe(200)
    expect(r.body.user.email).toBe('pk1@example.com')
    expect((await phone.get('/api/me')).body.user.email).toBe('pk1@example.com')

    // повтор тієї самої відповіді з новим викликом — ні (виклик інший)
    const o = await phone.post('/api/auth/passkey/options')
    const stale = key.get({ ...o.body.publicKey, challenge: crypto.randomBytes(32).toString('base64url') }, origin)
    expect((await phone.post('/api/auth/passkey', { ticket: o.body.ticket, credential: stale })).status).toBe(400)
    // квиток одноразовий
    expect((await phone.post('/api/auth/passkey', { ticket: o.body.ticket, credential: key.get(o.body.publicKey, origin) })).status).toBe(400)
    // підпис для іншого сайту
    const o2 = await phone.post('/api/auth/passkey/options')
    expect((await phone.post('/api/auth/passkey', { ticket: o2.body.ticket, credential: key.get(o2.body.publicKey, 'https://evil.test') })).status).toBe(400)
    // без «присутності» (UP) — ні
    expect((await agent().passkey(key, { flags: 0x04 })).status).toBe(400)
  })

  it('лічильник підписів не йде назад; Ed25519 теж працює', async () => {
    const me = agent()
    await me.code('pk2@example.com')
    const key = authenticator('ec')
    key.counter = 5
    expect((await me.addPasskey(key)).status).toBe(201)
    key.counter = 6
    expect((await agent().passkey(key)).status).toBe(200)
    key.counter = 3
    expect((await agent().passkey(key)).status).toBe(401)

    const ed = authenticator('ed')
    expect((await me.addPasskey(ed, 'Ключ')).status).toBe(201)
    expect((await agent().passkey(ed)).status).toBe(200)
  })

  it('перейменування й видалення: видаленим не ввійти; чужий паскей не чіпають', async () => {
    const me = agent()
    await me.code('pk3@example.com')
    const key = authenticator()
    const id = (await me.addPasskey(key)).body.id
    expect((await me.patch(`/api/me/passkeys/${id}`, { name: 'iPhone' })).body.passkeys[0].name).toBe('iPhone')
    expect((await me.patch(`/api/me/passkeys/${id}`, { name: '  ' })).status).toBe(400)
    const other = agent()
    await other.code('pk4@example.com')
    expect((await other.del(`/api/me/passkeys/${id}`)).status).toBe(404)
    expect((await me.del(`/api/me/passkeys/${id}`)).body.passkeys).toHaveLength(0)
    expect((await agent().passkey(key)).status).toBe(401)
  })

  it('за IP паскеїв нема; без входу додати не можна', async () => {
    expect((await agent({ at: () => ipBase, from: () => ipBase }).post('/api/auth/passkey/options')).status).toBe(400)
    expect((await agent().post('/api/me/passkeys/options')).status).toBe(401)
  })

  it('двофакторна перевірка: увімкнути, вхід кодом застосунку чи резервним, вимкнути', async () => {
    const me = agent()
    await me.code('tf@example.com')
    const setup = await me.post('/api/me/2fa/setup')
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\//)
    const secret = setup.body.secret
    expect((await me.post('/api/me/2fa/enable', { code: '000000' })).status).toBe(400)
    const on = await me.post('/api/me/2fa/enable', { code: codeAt(secret, stepOf()) })
    expect(on.status).toBe(200)
    expect(on.body.codes).toHaveLength(10)
    expect(on.body.twoFactor).toMatchObject({ enabled: true, recoveryLeft: 10 })
    const codes = on.body.codes

    // код із пошти більше не відкриває сеанс — лише квиток
    const b = agent()
    const v = await b.code('tf@example.com')
    expect(v.body.twoFactor).toBe(true)
    expect(v.body.user).toBeUndefined()
    expect((await b.get('/api/me')).body.user).toBeNull()
    expect((await b.post('/api/auth/2fa', { ticket: v.body.ticket, code: '123456' })).status).toBe(400)
    const ok = await b.post('/api/auth/2fa', { ticket: v.body.ticket, code: codeAt(secret, stepOf() + 1) })
    expect(ok.status).toBe(200)
    expect((await b.get('/api/me')).body.user.email).toBe('tf@example.com')
    // квиток одноразовий
    expect((await b.post('/api/auth/2fa', { ticket: v.body.ticket, code: codes[0] })).status).toBe(429)

    // резервний код — один раз (регістр і дефіс не важать)
    const c = agent()
    const v2 = await c.code('tf@example.com')
    const r1 = await c.post('/api/auth/2fa', { ticket: v2.body.ticket, code: codes[1].toUpperCase().replace('-', ' ') })
    expect(r1.status).toBe(200)
    expect(r1.body.recoveryLeft).toBe(9)
    const d = agent()
    const v3 = await d.code('tf@example.com')
    expect((await d.post('/api/auth/2fa', { ticket: v3.body.ticket, code: codes[1] })).status).toBe(400)

    // паскей — без другого кроку
    const key = authenticator()
    expect((await me.addPasskey(key)).status).toBe(201)
    expect((await agent().passkey(key)).status).toBe(200)

    // нові резервні коди й вимкнення — лише з кодом
    expect((await me.post('/api/me/2fa/recovery', { code: '111111' })).status).toBe(400)
    const fresh = await me.post('/api/me/2fa/recovery', { code: codes[2] })
    expect(fresh.body.codes).toHaveLength(10)
    expect((await me.post('/api/me/2fa/disable', { code: codes[3] })).status).toBe(400) // старі вже недійсні
    expect((await me.post('/api/me/2fa/disable', { code: fresh.body.codes[0] })).body.twoFactor.enabled).toBe(false)
    expect((await agent().code('tf@example.com')).body.user.email).toBe('tf@example.com')
  })

  it('п’ять хибних кодів — квиток згорає', async () => {
    const me = agent()
    await me.code('tf2@example.com')
    const { secret } = (await me.post('/api/me/2fa/setup')).body
    await me.post('/api/me/2fa/enable', { code: codeAt(secret, stepOf()) })
    const b = agent()
    const v = await b.code('tf2@example.com')
    for (let i = 0; i < 4; i++) expect((await b.post('/api/auth/2fa', { ticket: v.body.ticket, code: '000000' })).status).toBe(400)
    expect((await b.post('/api/auth/2fa', { ticket: v.body.ticket, code: '000000' })).status).toBe(429)
    expect((await b.post('/api/auth/2fa', { ticket: v.body.ticket, code: codeAt(secret, stepOf() + 1) })).status).toBe(429)
  })

  it('видалення облікового запису забирає паскеї й 2FA; секрети не в журналі', async () => {
    const me = agent()
    await me.code('gone@example.com')
    const uid = (await me.get('/api/me')).body.user.id
    await me.addPasskey(authenticator())
    const { secret } = (await me.post('/api/me/2fa/setup')).body
    await me.post('/api/me/2fa/enable', { code: codeAt(secret, stepOf()) })
    expect((await me.del('/api/me', { confirm: 'gone@example.com' })).status).toBe(200)
    expect(Number((await db.get('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?', uid)).n)).toBe(0)
    expect(await db.get('SELECT * FROM user_2fa WHERE user_id = ?', uid)).toBeFalsy()
    expect(Number((await db.get('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?', uid)).n)).toBe(0)
    const logged = (await db.all("SELECT detail FROM audit WHERE action LIKE '%passkey%' OR action LIKE '%2fa%'")).map((r) => r.detail).join('\n')
    expect(logged).not.toMatch(/attestationObject|clientDataJSON/)
  })
})

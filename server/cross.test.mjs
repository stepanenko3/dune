// Наскрізні виправлення аудиту (19.10.2026): перевірка бази в /api/health, помилки розбору тіла, службові логіни,
// неповторні назва й тег гільдії, запрошення (один вхід за замовчуванням, роль), блокування знімає з лідерства,
// прев'ю посилань (server/lib/og.mjs) лише для того, що видно без входу.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'
import { createOg } from './lib/og.mjs'

const SCHEMA = `cross_${process.pid}_${Date.now().toString(36)}`
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
/** найменша справжня база з деталей (як у bases-io.test.mjs) */
const tiny = (name) => ({
  format: 2,
  claims: [{ x: -5, y: 0, w: 10, d: 10 }],
  pieces: [{ id: 'p1', shape: 'Sardaukar_Foundation', x: 0.5, y: 0.5, z: 0, rot: 0 }, { id: 'p2', shape: 'Sardaukar_Wall_01', x: 0.5, y: 0, z: 0, rot: 0 }],
  items: [],
  zones: [],
  ui: { name },
})

describe.each(ENGINES)('%s', (_name, pgCfg) => {
  let server, base, dir, app, db
  const mail = []
  const codeFor = (email) => [...mail].reverse().find((m) => m.to === email.trim().toLowerCase())?.text.match(/\b\d{6}\b/)?.[0]

  function agent() {
    let cookie = ''
    const call = async (method, url, body) => {
      const r = await fetch(base + url, {
        method,
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const set = r.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
      return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) }
    }
    const a = {
      get cookie() { return cookie },
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      put: (u, b) => call('PUT', u, b),
      patch: (u, b) => call('PATCH', u, b),
      del: (u, b) => call('DELETE', u, b),
      async signIn(email) {
        const r = await a.post('/api/auth/code', { email })
        if (r.status !== 200) return r
        return a.post('/api/auth/verify', { email, code: codeFor(email) })
      },
    }
    return a
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-cross-'))
    db = await openDb({ dataDir: dir, pg: pgCfg })
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(async () => {
    server?.close()
    await app?.locals.close()
    if (db?.kind === 'pg') await db.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {})
    await db?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const admin = agent(), bob = agent(), carol = agent(), dave = agent(), erin = agent(), anon = agent()
  let bobId = ''

  it('вхід', async () => {
    expect((await admin.signIn('admin.cross@example.com')).body.user.role).toBe('admin')
    bobId = (await bob.signIn('bob.cross@example.com')).body.user.id
    for (const [a, e] of [[carol, 'carol'], [dave, 'dave'], [erin, 'erin']]) expect((await a.signIn(`${e}.cross@example.com`)).status).toBe(201)
  })

  it('/api/health перевіряє й базу', async () => {
    const r = await anon.get('/api/health')
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
  })

  it('хибне тіло запиту — зрозумілий текст, а не англійська бібліотеки', async () => {
    const r = await fetch(base + '/api/auth/code', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{"email":' })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('хибні дані в запиті')
  })

  it('службові логіни не взяти собі', async () => {
    for (const login of ['admin', 'sup-port', 'Sandwalkers', 'm.o.d']) expect((await bob.patch('/api/me', { login })).status).toBe(400)
    expect((await bob.patch('/api/me', { login: 'admiral' })).status).toBe(200)
  })

  it('назва й тег гільдії — неповторні', async () => {
    expect((await bob.post('/api/guilds', { name: 'Alpha Wing', tag: 'ALP' })).status).toBe(201)
    expect((await carol.post('/api/guilds', { name: 'alpha wing', tag: 'XYZ' })).status).toBe(409)
    expect((await carol.post('/api/guilds', { name: 'Gamma', tag: 'alp' })).status).toBe(409)
    // назва гільдії сайту теж зайнята
    expect((await carol.post('/api/guilds', { name: 'Sandwalkers', tag: 'SWX' })).status).toBe(409)
    // свою ж назву зберегти можна (змінюється лише опис)
    const slug = (await bob.get('/api/me')).body.guild.slug
    expect((await bob.patch(`/api/guilds/${slug}`, { name: 'Alpha Wing', tag: 'ALP', about: 'нове' })).status).toBe(200)
  })

  it('запрошення: за замовчуванням — один вхід; роль — та, що обрали', async () => {
    const slug = (await bob.get('/api/me')).body.guild.slug
    const inv = await bob.post(`/api/guilds/${slug}/invites`, { days: 7, role: 'recruit' })
    expect(inv.status).toBe(201)
    expect(inv.body.maxUses).toBe(1)
    expect(inv.body.role).toBe('recruit')
    expect((await dave.post(`/api/invites/${inv.body.code}/accept`)).status).toBe(200)
    expect((await dave.get('/api/me')).body.guild.role).toBe('recruit')
    // вичерпане — більше не впускає
    expect((await erin.post(`/api/invites/${inv.body.code}/accept`)).status).toBe(404)
    // офіцером через посилання — ні: роль зводиться до учасника
    const off = await bob.post(`/api/guilds/${slug}/invites`, { uses: 0, role: 'officer' })
    expect(off.body.role).toBe('member')
    expect(off.body.maxUses).toBe(null)
  })

  it('блокування знімає з лідерства — лідером стає наступний', async () => {
    const r = await admin.post('/api/admin/r/users/action/ban', { ids: [bobId], input: { reason: 'тест' } })
    expect(r.status).toBe(200)
    const daveId = (await dave.get('/api/me')).body.user.id
    expect((await db.get('SELECT role FROM members WHERE user_id = ?', bobId)).role).toBe('member')
    expect((await db.get('SELECT role FROM members WHERE user_id = ?', daveId)).role).toBe('leader')
  })
})

describe('прев’ю посилань', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-og-'))
  const file = path.join(dir, 'index.html')
  fs.writeFileSync(file, '<html><head><title>Sandwalkers · Dune: Awakening</title>\n<meta name="description" content="загальний" />\n<meta property="og:title" content="x" />\n</head><body></body></html>')
  const rows = {
    'base:pub': { kind: 'base', id: 'pub', title: 'Моя <база>', summary: '', visibility: 'public', owner_kind: 'user', owner_id: 'u1' },
    'base:priv': { kind: 'base', id: 'priv', title: 'Таємна', summary: '', visibility: 'private', owner_kind: 'user', owner_id: 'u1' },
  }
  const og = createOg({
    file,
    db: { get: async () => ({ version: 3, deleted: null }) },
    items: { get: async (k, id) => rows[`${k}:${id}`] || null },
    auth: { byLogin: async () => null },
    guilds: { get: async () => null },
    thumbs: { url: (id, v) => `/api/bases/${id}/thumb.jpg?v=${v}-a` },
    access: { ctxOf: async () => ({ user: null, ranks: new Map() }) },
  })
  const req = (p) => ({ path: p, query: {}, originalUrl: p, protocol: 'https', get: () => 'sw.test', t: (k) => k })

  it('публічна база — назва й знімок; заголовок і опис — один раз', async () => {
    const h = await og.render(req('/bases/pub'))
    expect(h).toContain('<title>Моя &lt;база&gt; · Sandwalkers</title>')
    expect(h).toContain('content="https://sw.test/api/bases/pub/thumb.jpg?v=3-a"')
    expect(h).toContain('summary_large_image')
    expect(h.match(/name="description"/g)).toHaveLength(1)
    expect(h.match(/og:title/g)).toHaveLength(1)
  })
  it('особиста база — нічого про неї, лише загальний опис', async () => {
    const h = await og.render(req('/bases/priv'))
    expect(h).not.toContain('Таємна')
    expect(h).toContain('<title>Sandwalkers · Dune: Awakening</title>')
  })
})

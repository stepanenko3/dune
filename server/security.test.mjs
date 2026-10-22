// Захисти сайту (аудит 19.10.2026): указ сайту — лише через панель; код входу не підібрати паралельними запитами;
// «dryRun» не знімає лімітів; відповідь на запит коду однакова для будь-якої пошти; захисні заголовки; важкі збори й
// тайли мапи — не для всіх; підписка на нагадування — лише на справжні служби push; пошти не лягають у журнал;
// після видалення облікового запису не лишається особистого; живі оновлення зупиняються з сеансом.
// Обв'язка — як у admin.test.mjs: SQLite у тимчасовій теці і Postgres <DB_DATABASE>_testing у власній схемі.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'

const SCHEMA = `sec_${process.pid}_${Date.now().toString(36)}`
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

  // extra — свої заголовки (x-forwarded-for: інша адреса, щоб не впертися в ліміт кодів входу з однієї адреси)
  function agent(extra = {}) {
    let cookie = ''
    const call = async (method, url, body) => {
      const r = await fetch(base + url, {
        method,
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...extra, ...(cookie ? { cookie } : {}) },
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-sec-'))
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

  const admin = agent(), bob = agent(), anon = agent()

  it('вхід: адміністратор (перший) і Боб; логін і ім’я — не з пошти', async () => {
    expect((await admin.signIn('admin.person@example.com')).body.user.role).toBe('admin')
    const b = await bob.signIn('bob.secret@example.com')
    expect(b.status).toBe(201)
    expect(b.body.user.login).not.toMatch(/bob/i)
    expect(b.body.user.name).not.toMatch(/bob|secret/i)
  })

  it('захисні заголовки на кожній відповіді', async () => {
    const r = await anon.get('/api/me')
    expect(r.headers.get('x-frame-options')).toBe('DENY')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/)
    expect(r.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  })

  it('запит коду: однакова відповідь для відомої й нової пошти', async () => {
    const known = await anon.post('/api/auth/code', { email: 'bob.secret@example.com' })
    const fresh = await anon.post('/api/auth/code', { email: 'nobody@example.com' })
    expect(known.status).toBe(200)
    expect(fresh.status).toBe(200)
    expect(known.body).toEqual(fresh.body)
  })

  it('код не підібрати паралельними запитами: спроб не більше п’яти', async () => {
    const email = 'race@example.com'
    await anon.post('/api/auth/code', { email })
    const tries = await Promise.all(Array.from({ length: 20 }, () => agent().post('/api/auth/verify', { email, code: '000001' })))
    const wrong = tries.filter((r) => /невірний код/.test(r.body?.error || '')).length
    expect(wrong).toBeLessThanOrEqual(5)
    // після вичерпаних спроб справжній код уже не діє
    expect((await agent().post('/api/auth/verify', { email, code: codeFor(email) })).status).not.toBe(201)
  })

  it('указ сайту — лише з дозволом: давнього шляху «указ гільдії» нема', async () => {
    const g = await bob.post('/api/guilds', { name: 'Мої', tag: 'MY' })
    expect(g.status).toBe(201)
    const r = await bob.put(`/api/guilds/${g.body.guild.slug}/decree`, { id: 'production', until: Date.now() + 86400_000 })
    expect(r.status).toBe(404)
    expect((await bob.put('/api/decree', { id: 'production', until: Date.now() + 86400_000 })).status).toBe(403)
    expect((await anon.get('/api/decree')).body.id).toBe(null)
  })

  it('«dryRun» не знімає ліміт: роадмапів не більше ліміту', async () => {
    await admin.patch('/api/admin/site-settings', { limits: { user: { roadmap: 1 }, guild: {} } })
    // Боб у гільдії — свій роадмап створюємо особистим
    const own = { owner: { kind: 'user', id: (await bob.get('/api/me')).body.user.id } }
    expect((await bob.post('/api/roadmaps', { ...own })).status).toBe(201)
    expect((await bob.post('/api/roadmaps', { ...own, dryRun: true })).status).toBe(409)
    await admin.patch('/api/admin/site-settings', { limits: { user: { roadmap: 10 }, guild: {} } })
  })

  it('оновити мапу — лише з входом; тайли — лише відомих мап і в межах сітки', async () => {
    expect((await anon.post('/api/map/refresh')).status).toBe(401)
    expect((await anon.get('/map-tiles/zz_fake-0123456789abcdef0123456789abcdef/0/0/0.webp')).status).toBe(404)
    expect([400, 404]).toContain((await anon.get('/map-tiles/zz_fake-0123456789abcdef0123456789abcdef/2/-1/0.webp')).status)
  })

  it('довідник: збір без входу не запустити; іконки — без «..»', async () => {
    expect((await anon.post('/api/catalog/refresh')).status).toBe(404)
    const r = await fetch(`${base}/catalog-icons/assets/Dune/..%2F..%2F..%2Fetc/x.webp`)
    expect(r.status).toBe(404)
  })

  it('нагадування: лише після входу і лише на службу push браузера', async () => {
    const body = (endpoint) => ({ sub: { endpoint, keys: { p256dh: 'x', auth: 'y' } }, region: 'eu', lead: 24 })
    expect((await anon.post('/api/push/subscribe', body('https://fcm.googleapis.com/fcm/send/abc'))).status).toBe(401)
    expect((await anon.post('/api/push/test', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' })).status).toBe(401)
    const sub = (endpoint) => admin.post('/api/push/subscribe', body(endpoint))
    expect((await sub('https://127.0.0.1:9/hook')).status).toBe(400)
    expect((await sub('https://evil.example/fcm.googleapis.com/x')).status).toBe(400)
    expect((await sub('https://fcm.googleapis.com/fcm/send/abc')).status).toBe(200)
  })

  it('журнал не зберігає пошт', async () => {
    const rows = (await admin.get('/api/admin/r/audit?size=200')).body.rows
    const all = JSON.stringify(await Promise.all(rows.slice(0, 40).map((r) => admin.get(`/api/admin/r/audit/one?id=${r._id}`).then((x) => x.body?.detail))))
    expect(all).not.toMatch(/@example\.com/)
  })

  it('видалення облікового запису: не лишається особистого (історія з документами, пошта, IP)', async () => {
    const carol = agent()
    await carol.signIn('carol.private@example.com')
    const me = (await carol.get('/api/me')).body.user
    const b = await carol.post('/api/builds', { name: 'secret build', code: '1a', notes: '' })
    expect(b.status).toBe(201)
    await carol.put(`/api/builds/${b.body.id}`, { name: 'secret build 2' })
    expect((await carol.del('/api/me', { confirm: 'carol.private@example.com' })).status).toBe(200)
    const dump = JSON.stringify(await db.all('SELECT * FROM revisions')) + JSON.stringify(await db.all('SELECT * FROM audit'))
    expect(dump).not.toMatch(/secret build/)
    expect(dump).not.toMatch(/carol\.private/)
    const left = [...(await db.all('SELECT * FROM revisions')), ...(await db.all('SELECT * FROM audit'))].filter((r) => JSON.stringify(r).includes(me.id))
    expect(left).toEqual([])
  })

  it('одночасні збереження бази й роадмапу: проходить одне, друге — конфлікт (нічого не губиться мовчки)', async () => {
    const own = { owner: { kind: 'user', id: (await admin.get('/api/me')).body.user.id } }
    const b = await admin.post('/api/bases', { doc: tiny('Гонка'), ...own })
    expect(b.status).toBe(201)
    // адреса — з назви й випадкового хвоста: «за посиланням» не вгадати
    expect(b.body.id).toMatch(/^honka-[0-9a-f]{6}$/)
    const put = () => admin.put(`/api/bases/${b.body.id}`, { doc: b.body.doc, version: b.body.version, note: '' })
    const two = await Promise.all([put(), put()])
    expect(two.map((r) => r.status).sort()).toEqual([200, 409])
    const r = await admin.post('/api/roadmaps', { ...own })
    const rp = () => admin.put(`/api/roadmaps/${r.body.id}`, { doc: r.body.doc, version: r.body.version })
    expect((await Promise.all([rp(), rp()])).map((x) => x.status).sort()).toEqual([200, 409])
  })

  it('«+ до запису» двох людей одночасно: обидві точки лишаються; стара версія позначки — 409', async () => {
    const own = { owner: { kind: 'user', id: (await admin.get('/api/me')).body.user.id } }
    const p = await admin.post('/api/places', { res: 'Титан', place: 'Скелі', zone: 'hagga', pins: [], ...own })
    expect(p.status).toBe(201)
    const pin = (x) => admin.patch(`/api/places/${p.body.id}`, { addPins: [{ map: 'survival_1', x, y: 10 }] })
    await Promise.all([pin(100), pin(200)])
    const got = (await admin.get(`/api/places/${p.body.id}`)).body
    expect((got.row ?? got).pins.map((x) => x.x).sort()).toEqual([100, 200])
    const stale = await admin.patch(`/api/places/${p.body.id}`, { how: 'нове', base: p.body.updated })
    expect(stale.status).toBe(409)
    const m = await admin.post('/api/markers', { map: 'survival_1', x: 1, y: 2, kind: 'note', title: 'А', note: '', ...own })
    expect(m.status).toBe(201)
    expect((await admin.put(`/api/markers/${m.body.id}`, { title: 'Б', base: m.body.updated })).status).toBe(200)
    expect((await admin.put(`/api/markers/${m.body.id}`, { title: 'В', base: m.body.updated })).status).toBe(409)
  })

  it('база в кошику: за посиланням не відкрити й не скопіювати; власнику — видно, але не змінити, поки в кошику', async () => {
    const own = { owner: { kind: 'user', id: (await admin.get('/api/me')).body.user.id }, visibility: 'link' }
    const b = (await admin.post('/api/bases', { doc: tiny('Смітник'), ...own })).body
    expect((await bob.get(`/api/bases/${b.id}`)).status).toBe(200)
    expect((await admin.del(`/api/bases/${b.id}`)).status).toBe(200)
    expect((await bob.get(`/api/bases/${b.id}`)).status).toBe(404)
    expect((await bob.get(`/api/bases/${b.id}/export`)).status).toBe(404)
    expect((await bob.post(`/api/items/base/${b.id}/copy`, {})).status).toBeGreaterThanOrEqual(400)
    expect((await admin.get(`/api/bases/${b.id}`)).status).toBe(200)
    expect((await admin.put(`/api/bases/${b.id}`, { doc: b.doc, version: b.version, note: '' })).status).toBe(409)
  })

  it('«від сайту» й «від гільдії» запитом в обхід сайту: без права — 403 на кожному шляху, власник не змінюється', async () => {
    const other = { 'x-forwarded-for': '10.20.30.40' }
    const eve = agent(other), rita = agent(other), oleg = agent(other)
    await eve.signIn('eve.owner@example.com')
    await rita.signIn('rita.owner@example.com')
    await oleg.signIn('oleg.owner@example.com')
    const bobMe = (await bob.get('/api/me')).body
    const my = (await bob.get(`/api/guilds/${bobMe.guild.slug}`)).body.guild
    const sw = (await admin.get('/api/guilds/sandwalkers')).body.guild
    // Рита — новобранець у гільдії Боба, Олег — офіцер
    const code = (await bob.post(`/api/guilds/${my.slug}/invites`, { days: 7, uses: 0 })).body.code
    for (const a of [rita, oleg]) expect((await a.post(`/api/invites/${code}/accept`)).status).toBe(200)
    const idOf = async (a) => (await a.get('/api/me')).body.user.id
    const [ritaId, olegId, eveId] = [await idOf(rita), await idOf(oleg), await idOf(eve)]
    await bob.patch(`/api/guilds/${my.slug}/members/${ritaId}`, { role: 'recruit' })
    await bob.patch(`/api/guilds/${my.slug}/members/${olegId}`, { role: 'officer' })

    const SITE = { kind: 'site', id: 'site' }, MY = { kind: 'guild', id: my.id }, SW = { kind: 'guild', id: sw.id }
    // нова річ кожного виду: сайту — ні (і Бобу-лідеру теж), чужій гільдії — ні, новобранцю у своїй — ні
    const creates = [
      ['/api/bases', { doc: tiny('Підробка') }],
      ['/api/bases/import', { doc: tiny('Імпорт') }],
      ['/api/bases/import', { doc: tiny('Імпорт'), dryRun: true }],
      ['/api/roadmaps', { title: 'Підробка' }],
      ['/api/builds', { name: 'Підробка', code: '1a' }],
      ['/api/markers', { map: 'survival_1', x: 1, y: 1, kind: 'note', title: 'Підробка', note: '' }],
      ['/api/places', { res: 'Титан', place: 'Скелі', zone: 'hagga', pins: [] }],
    ]
    for (const [url, body] of creates) {
      for (const owner of [SITE, { kind: 'site' }]) {
        expect((await eve.post(url, { ...body, owner, visibility: 'public' })).status, `${url} → сайт`).toBe(403)
        expect((await bob.post(url, { ...body, owner, visibility: 'public' })).status, `${url} → сайт (лідер)`).toBe(403)
      }
      expect((await eve.post(url, { ...body, owner: MY })).status, `${url} → чужа гільдія`).toBe(403)
      expect((await eve.post(url, { ...body, owner: { kind: 'guild', id: my.slug } })).status, `${url} → чужа гільдія за адресою`).toBe(403)
      expect((await rita.post(url, { ...body, owner: MY })).status, `${url} → новобранець`).toBe(403)
      expect((await eve.post(url, { ...body, owner: { kind: 'user', id: ritaId } })).status, `${url} → інша людина`).toBe(403)
    }
    // підроблені вигляди власника — не сайт і не чужа гільдія
    expect((await eve.post('/api/builds', { name: 'х', code: '1a', owner: { kind: 'SITE' } })).status).toBe(400)
    expect((await eve.post('/api/builds', { name: 'х', code: '1a', owner: { kind: 'guild', id: { $ne: '' } } })).status).toBe(404)
    expect((await eve.post('/api/builds', { name: 'х', code: '1a', owner: { kind: ['site'] } })).status).toBe(400)

    // копія: «Копіювати собі» сайту чи чужій гільдії — ні; копія бази (from) — так само
    const pub = (await admin.post('/api/bases', { doc: tiny('Публічна'), visibility: 'public' })).body
    for (const owner of [SITE, MY, SW]) {
      expect((await eve.post(`/api/items/base/${pub.id}/copy`, { owner })).status).toBe(403)
      expect((await eve.post('/api/bases', { from: pub.id, owner })).status).toBe(403)
    }
    expect((await rita.post(`/api/items/base/${pub.id}/copy`, { owner: MY })).status).toBe(403)

    // «Доступ»: свою річ — не сайту й не чужій гільдії; гільдійську — офіцер не віддає (ні собі, ні сайту)
    const mine = (await eve.post('/api/bases', { doc: tiny('Моя') })).body
    for (const owner of [SITE, MY, SW, { kind: 'user', id: ritaId }]) {
      expect((await eve.patch(`/api/items/base/${mine.id}/access`, { owner })).status).toBe(403)
    }
    const theirs = (await bob.post('/api/bases', { doc: tiny('Гільдійська'), owner: MY })).body
    for (const owner of [SITE, { kind: 'user', id: olegId }]) {
      expect((await oleg.patch(`/api/items/base/${theirs.id}/access`, { owner })).status).toBe(403)
    }
    expect((await bob.patch(`/api/items/base/${theirs.id}/access`, { owner: SITE })).status).toBe(403)
    expect((await eve.patch(`/api/items/base/${theirs.id}/access`, { owner: { kind: 'user', id: eveId } })).status).toBe(404)
    // збереження бази з полем owner власника не міняє
    expect((await eve.put(`/api/bases/${mine.id}`, { doc: mine.doc, version: mine.version, note: '', owner: SITE, visibility: 'public' })).status).toBe(200)
    expect((await eve.get(`/api/bases/${mine.id}`)).body.item).toMatchObject({ owner: { kind: 'user', id: eveId }, visibility: 'private' })
    expect((await bob.get(`/api/bases/${theirs.id}`)).body.item.owner).toMatchObject({ kind: 'guild', id: my.id })
    // ніщо з цього не стало річчю сайту
    expect((await db.all("SELECT id FROM items WHERE owner_kind = 'site'")).length).toBe(0)

    // з правом: учасник і вище — своїй гільдії; адміністратор — сайту
    expect((await oleg.post('/api/builds', { name: 'Гільдії', code: '1a', owner: MY })).status).toBe(201)
    expect((await admin.post('/api/builds', { name: 'Сайту', code: '1a', owner: SITE, visibility: 'public' })).status).toBe(201)
  })

  it('живі оновлення: «вийти на всіх пристроях» закриває й відкриту вкладку', async () => {
    const dave = agent()
    await dave.signIn('dave@example.com')
    const ctrl = new AbortController()
    const stream = await fetch(`${base}/api/roadmaps/stream`, { headers: { cookie: dave.cookie }, signal: ctrl.signal })
    expect(stream.status).toBe(200)
    const reader = stream.body.getReader()
    await reader.read() // «: ok»
    // вийти скрізь — з іншого сеансу тієї ж людини
    const other = agent()
    await other.signIn('dave@example.com')
    await other.post('/api/me/sessions/others')
    // будь-яка подія — і потік закривається (сеанс уже не живий)
    await other.post('/api/roadmaps', {})
    const done = await Promise.race([
      (async () => { for (;;) { const x = await reader.read(); if (x.done) return true } })(),
      new Promise((r) => setTimeout(() => r(false), 3000)),
    ])
    ctrl.abort()
    expect(done).toBe(true)
  })
})

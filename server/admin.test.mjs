// Панель керування: ролі з дозволами за розділами, історія змін будь-якого запису з різницею, журнал дій із сайту,
// фонові задачі (розклад, ручний запуск, журнал запуску) і указ Ландсрааду (один на сайт, виставляє адміністрація).
// Обв'язка — як у bases-io.test.mjs: SQLite у тимчасовій теці і Postgres <DB_DATABASE>_testing у власній схемі.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { nextRun, parseCron } from './lib/cron.mjs'
import { jsonDiff } from './lib/revisions.mjs'
import { openDb } from './lib/sql.mjs'

describe('розклад задач (cron)', () => {
  const at = (s) => new Date(s).getTime()
  it('наступний запуск: крок, конкретний час, день тижня', () => {
    expect(nextRun('*/5 * * * *', at('2026-10-19T12:03:20'))).toBe(at('2026-10-19T12:05:00'))
    expect(nextRun('7 * * * *', at('2026-10-19T12:07:00'))).toBe(at('2026-10-19T13:07:00'))
    // середа, 04:00 — 19.10.2026 понеділок
    expect(nextRun('0 4 * * 3', at('2026-10-19T12:00:00'))).toBe(at('2026-10-21T04:00:00'))
    expect(nextRun('20 */6 * * *', at('2026-10-19T12:30:00'))).toBe(at('2026-10-19T18:20:00'))
  })
  it('хибний розклад — зрозуміла помилка', () => {
    expect(() => parseCron('* * *')).toThrow(/п’ять полів/)
    expect(() => parseCron('61 * * * *')).toThrow(/незрозумілий/)
    expect(() => parseCron('a b c d e')).toThrow(/незрозумілий/)
  })
})

describe('різниця версій (jsonDiff)', () => {
  it('поля, вкладені об’єкти й списки з id', () => {
    const a = { name: 'А', ui: { lead: 'x' }, pieces: [{ id: 'p1', x: 1 }, { id: 'p2', x: 2 }] }
    const b = { name: 'Б', ui: { lead: 'x' }, pieces: [{ id: 'p1', x: 5 }, { id: 'p3', x: 3 }] }
    expect(jsonDiff(a, b)).toEqual(expect.arrayContaining([
      { path: 'name', type: 'change', from: 'А', to: 'Б' },
      { path: 'pieces[id=p1].x', type: 'change', from: 1, to: 5 },
      { path: 'pieces[id=p2]', type: 'remove', from: { id: 'p2', x: 2 } },
      { path: 'pieces[id=p3]', type: 'add', to: { id: 'p3', x: 3 } },
    ]))
  })
  it('списки рядків (дозволи) — що додано й прибрано, без зсуву за позиціями', () => {
    expect(jsonDiff({ p: ['a', 'b', 'c'] }, { p: ['x', 'a', 'c'] })).toEqual([
      { path: 'p[]', type: 'remove', from: 'b' },
      { path: 'p[]', type: 'add', to: 'x' },
    ])
  })
})

const SCHEMA = `admin_${process.pid}_${Date.now().toString(36)}`
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

describe.each(ENGINES)('%s', (_name, pgCfg) => {
  let server, base, dir, app, db
  const mail = []
  const codeFor = (email) => [...mail].reverse().find((m) => m.to === email.trim().toLowerCase())?.text.match(/\b\d{6}\b/)?.[0]
  const f = (o) => encodeURIComponent(JSON.stringify(o))

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
      return { status: r.status, body: await r.json().catch(() => null) }
    }
    const a = {
      /** відповідь як є (файли: CSV) */
      raw: (u) => fetch(base + u, { headers: { 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) } }),
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      put: (u, b) => call('PUT', u, b),
      patch: (u, b) => call('PATCH', u, b),
      async signIn(email) {
        const r = await a.post('/api/auth/code', { email })
        if (r.status !== 200) return r
        return a.post('/api/auth/verify', { email, code: codeFor(email) })
      },
    }
    return a
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-admin-'))
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

  const admin = agent(), bob = agent(), eve = agent(), anon = agent()
  const idOf = async (login) => (await admin.get(`/api/admin/r/users?search=${login}`)).body.rows[0]._id

  it('вхід: адміністратор (перший), Боб і Єва', async () => {
    expect((await admin.signIn('admin@example.com')).body.user.role).toBe('admin')
    expect((await bob.signIn('bob@example.com')).status).toBe(201)
    expect((await eve.signIn('eve@example.com')).status).toBe(201)
  })

  describe('ролі й дозволи', () => {
    it('вбудовані ролі; «Адміністратор» не змінити й не видалити', async () => {
      const roles = (await admin.get('/api/admin/r/roles')).body.rows.map((r) => r.key)
      expect(roles).toEqual(expect.arrayContaining(['admin', 'moderator', 'user']))
      expect((await admin.patch('/api/admin/r/roles/one?id=admin', { permissions: ['admin'] })).status).toBeGreaterThanOrEqual(400)
      expect((await admin.post('/api/admin/r/roles/delete', { ids: ['admin'] })).status).toBeGreaterThanOrEqual(400)
    })

    it('своя роль: бачить і створює лише оголошення, решта панелі — 403', async () => {
      const r = await admin.post('/api/admin/r/roles', { key: 'herald', name: 'Глашатай', permissions: ['admin', 'announcements.view', 'announcements.create'] })
      expect(r.status).toBe(200)
      expect(r.body.permissions).toEqual(expect.arrayContaining(['announcements.create']))
      expect((await admin.patch(`/api/admin/r/users/one?id=${await idOf('bob')}`, { role: 'herald' })).body.role).toBe('herald')
      const meta = (await bob.get('/api/admin/meta')).body
      expect(meta.resources.map((x) => x.name)).toEqual(['announcements'])
      expect(meta.resources[0]).toMatchObject({ canCreate: true, canDelete: false })
      expect((await bob.get('/api/admin/r/users')).status).toBe(403)
      expect((await bob.get('/api/admin/r/roles')).status).toBe(403)
      const a = await bob.post('/api/admin/r/announcements', { title: 'Від глашатая' })
      expect(a.status).toBe(200)
      expect((await bob.post('/api/admin/r/announcements/delete', { ids: [a.body._id] })).status).toBe(403)
      // налаштування сайту й указ — окремі дозволи
      expect((await bob.patch('/api/admin/site-settings', { guildCap: 5 })).status).toBe(403)
      expect((await bob.put('/api/decree', { id: 'production', until: Date.now() + 86400_000 })).status).toBe(403)
    })

    it('невідома роль — 400; роль, яку хтось має, не видалити; без людей — видаляється', async () => {
      expect((await admin.patch(`/api/admin/r/users/one?id=${await idOf('eve')}`, { role: 'nobody' })).status).toBe(400)
      expect((await admin.post('/api/admin/r/roles/delete', { ids: ['herald'] })).status).toBeGreaterThanOrEqual(400)
      await admin.patch(`/api/admin/r/users/one?id=${await idOf('bob')}`, { role: 'user' })
      expect((await bob.get('/api/admin/meta')).status).toBe(403)
      expect((await admin.post('/api/admin/r/roles/delete', { ids: ['herald'] })).body.removed).toBe(1)
    })

    it('модератор: бачить людей, але ролі не міняє й адміністратора не блокує', async () => {
      await admin.patch(`/api/admin/r/users/one?id=${await idOf('eve')}`, { role: 'moderator' })
      expect((await eve.get('/api/admin/r/users')).status).toBe(200)
      expect((await eve.patch(`/api/admin/r/users/one?id=${await idOf('bob')}`, { role: 'admin' })).status).toBe(403)
      expect((await eve.post('/api/admin/r/users/action/ban', { ids: [await idOf('admin')], input: { reason: 'х' } })).status).toBeGreaterThanOrEqual(400)
      // фонові задачі — бачить, але не запускає
      expect((await eve.get('/api/admin/r/cron-jobs')).status).toBe(200)
      expect((await eve.post('/api/admin/r/cron-jobs/action/run', { ids: ['cleanup'] })).status).toBe(403)
    })
  })

  describe('історія змін і журнал', () => {
    it('білд із сайту: створення й зміна — у його історії, різниця — за полями', async () => {
      const b = (await bob.post('/api/builds', { name: 'Мечник', code: '1a', notes: '' })).body
      await bob.put(`/api/builds/${b.id}`, { name: 'Мечник 2' })
      const rows = (await admin.get(`/api/admin/history/builds?id=${b.id}`)).body.rows
      expect(rows.map((r) => r.action)).toEqual(['update', 'create'])
      expect(rows[0].actor_name).toBeTruthy()
      const d = (await admin.get(`/api/admin/revisions/${rows[0].id}/diff`)).body
      expect(d.changes).toContainEqual({ path: 'name', type: 'change', from: 'Мечник', to: 'Мечник 2' })
    })

    it('зміна з панелі теж пишеться; історію бачить лише той, кому можна', async () => {
      const g = (await admin.get('/api/admin/r/guilds')).body.rows[0]
      await admin.patch(`/api/admin/r/guilds/one?id=${g._id}`, { motto: 'Пісок пам’ятає' })
      const rows = (await admin.get(`/api/admin/history/guilds?id=${g._id}`)).body.rows
      expect(rows[0]).toMatchObject({ action: 'update' })
      expect((await bob.get(`/api/admin/history/guilds?id=${g._id}`)).status).toBe(403)
    })

    it('журнал дій: запити з сайту з людиною й станом; код входу — схований', async () => {
      const builds = (await admin.get(`/api/admin/r/audit?search=${encodeURIComponent('/api/builds')}`)).body
      expect(builds.total).toBeGreaterThan(0)
      const verify = (await admin.get(`/api/admin/r/audit?search=${encodeURIComponent('/api/auth/verify')}&size=50`)).body.rows
      expect(verify.length).toBeGreaterThan(0)
      const code = codeFor('eve@example.com')
      expect(JSON.stringify(verify)).not.toContain(code)
    })
  })

  describe('фонові задачі', () => {
    it('задачі сайту — у панелі з розкладом і наступним запуском; ручний запуск пише журнал', async () => {
      const jobs = (await admin.get('/api/admin/r/cron-jobs')).body.rows
      expect(jobs.map((j) => j.key)).toEqual(expect.arrayContaining(['map-refresh', 'cleanup']))
      // зборів сторонніх сайтів (довідник, уміння, назви TH.GL) нема — дані гри з файлів гри
      for (const k of ['catalog-sync', 'skills-sync', 'thgl-names']) expect(jobs.map((j) => j.key)).not.toContain(k)
      expect(jobs.find((j) => j.key === 'cleanup').next_run).toBeGreaterThan(Date.now() - 60_000)
      const run = await admin.post('/api/admin/r/cron-jobs/action/run', { ids: ['cleanup'] })
      expect(run.status).toBe(200)
      // запуск іде у фоні — чекаємо, поки допрацює
      let runs = []
      for (let i = 0; i < 50; i++) {
        runs = (await admin.get(`/api/admin/r/cron-runs?f=${f({ job: 'cleanup' })}`)).body.rows
        if (runs[0]?.status && runs[0].status !== 'running') break
        await new Promise((r) => setTimeout(r, 20))
      }
      expect(runs[0]).toMatchObject({ job: 'cleanup', status: 'ok', trigger: 'manual' })
      expect((await admin.get('/api/admin/r/cron-jobs')).body.rows.find((j) => j.key === 'cleanup').runs).toBe(1)
    })

    it('розклад змінюється з панелі; хибний — 400', async () => {
      expect((await admin.patch('/api/admin/r/cron-jobs/one?id=cleanup', { schedule: '0 3 * * *' })).body.schedule).toBe('0 3 * * *')
      expect((await admin.patch('/api/admin/r/cron-jobs/one?id=cleanup', { schedule: 'щогодини' })).status).toBe(400)
    })
  })

  describe('ліміти й офіційне від сайту', () => {
    it('ліміт на людину: третій білд — ні (і копією теж); адміністрації — без лімітів; 0 — без обмежень', async () => {
      expect((await admin.patch('/api/admin/site-settings', { limits: { user: { build: 2 }, guild: {} } })).status).toBe(200)
      // у Боба вже є білд із тесту історії — ще один можна, далі — ні
      expect((await bob.post('/api/builds', { name: 'Другий', code: '1a' })).status).toBe(201)
      const third = await bob.post('/api/builds', { name: 'Третій', code: '1a' })
      expect(third.status).toBe(409)
      expect(third.body.error).toMatch(/ліміту/)
      const pub = (await admin.post('/api/builds', { name: 'Від адміна', code: '1a', visibility: 'public' })).body
      expect((await bob.post(`/api/items/build/${pub.id}/copy`, {})).status).toBe(409)
      for (let i = 0; i < 3; i++) expect((await admin.post('/api/builds', { name: `Адмін ${i}`, code: '1a' })).status).toBe(201)
      expect((await admin.patch('/api/admin/site-settings', { limits: { user: { build: -1 } } })).status).toBe(400)
      await admin.patch('/api/admin/site-settings', { limits: { user: { build: 0 } } })
      expect((await bob.post('/api/builds', { name: 'Третій', code: '1a' })).status).toBe(201)
    })

    it('сайт як власник: не в чиїхось списках, але в бібліотеці; віддати сайту може лише адміністрація', async () => {
      const r = await admin.post('/api/builds', { name: 'Офіційний білд', code: '1a', owner: { kind: 'site' }, visibility: 'public' })
      expect(r.body.error ?? null).toBe(null)
      const b = r.body
      expect(b.item.owner).toMatchObject({ kind: 'site', id: 'site' })
      expect((await admin.get('/api/items?scope=shared&kind=build')).body.rows.map((x) => x.id)).not.toContain(b.id)
      expect((await anon.get('/api/library?kind=build')).body.rows.map((x) => x.id)).toContain(b.id)
      const mine = (await bob.post('/api/builds', { name: 'Мій', code: '1a' })).body
      expect((await bob.patch(`/api/items/build/${mine.id}/access`, { owner: { kind: 'site' } })).status).toBe(403)
      expect((await bob.patch(`/api/items/build/${b.id}/access`, { visibility: 'private' })).status).toBe(403)
    })
  })

  describe('безпека панелі', () => {
    it('з правом змінювати людей: собі роль — ні, ширшу роль — ні, пошту — ні, адміністрацію — не чіпає', async () => {
      expect((await admin.post('/api/admin/r/roles', { key: 'keeper', name: 'Доглядач', permissions: ['admin', 'users.view', 'users.edit', 'users.create', 'roles.view', 'roles.edit', 'roles.create'] })).status).toBe(200)
      const bobId = await idOf('bob')
      await admin.patch(`/api/admin/r/users/one?id=${bobId}`, { role: 'keeper' })
      const dan = (await admin.post('/api/admin/r/users', { email: 'dan@example.com', name: 'Дан' })).body
      expect((await bob.patch(`/api/admin/r/users/one?id=${bobId}`, { role: 'admin' })).status).toBe(400)
      expect((await bob.patch(`/api/admin/r/users/one?id=${dan._id}`, { role: 'admin' })).status).toBe(403)
      expect((await bob.patch(`/api/admin/r/users/one?id=${dan._id}`, { role: 'moderator' })).status).toBe(403)
      expect((await bob.patch(`/api/admin/r/users/one?id=${dan._id}`, { email: 'bob2@example.com' })).status).toBe(403)
      expect((await bob.patch(`/api/admin/r/users/one?id=${await idOf('admin')}`, { name: 'Злам' })).status).toBe(403)
      expect((await bob.post('/api/admin/r/users', { email: 'mole@example.com', role: 'admin' })).status).toBe(403)
      // ім'я звичайній людині — можна
      expect((await bob.patch(`/api/admin/r/users/one?id=${dan._id}`, { name: 'Дан 2' })).body.name).toBe('Дан 2')
      // ролі: свою — ні; права, яких нема в самого, — ні; з тих, що є, — так
      expect((await bob.patch('/api/admin/r/roles/one?id=keeper', { permissions: ['admin', 'users.view'] })).status).toBe(403)
      expect((await bob.post('/api/admin/r/roles', { key: 'boss', name: 'Бос', permissions: ['admin', 'settings.view', 'audit.view'] })).status).toBe(403)
      expect((await bob.post('/api/admin/r/roles', { key: 'helper', name: 'Помічник', permissions: ['admin', 'users.view'] })).status).toBe(200)
      // адміністратор змінює пошту — старі сеанси людини закриваються
      expect((await admin.patch(`/api/admin/r/users/one?id=${dan._id}`, { email: 'dan2@example.com' })).body.email).toBe('dan2@example.com')
      await admin.patch(`/api/admin/r/users/one?id=${bobId}`, { role: 'user' })
      await admin.post('/api/admin/r/roles/delete', { ids: ['helper', 'keeper'] })
    })

    it('власник із панелі: право змінювати розділ не дає віддати річ сайту, чужій гільдії чи людині', async () => {
      await admin.post('/api/admin/r/roles', { key: 'editor', name: 'Редактор', permissions: ['admin', 'builds.view', 'builds.edit', 'builds.create', 'items.view', 'items.edit'] })
      const bobId = await idOf('bob'), eveId = await idOf('eve')
      await admin.patch(`/api/admin/r/users/one?id=${bobId}`, { role: 'editor' })
      const ev = (await eve.post('/api/guilds', { name: 'Євині', tag: 'EV' })).body.guild
      const sw = (await admin.get('/api/guilds/sandwalkers')).body.guild
      const hers = (await eve.post('/api/builds', { name: 'Білд Єви', code: '1a' })).body
      const doc = { name: 'З панелі', code: '1a' }
      const mk = (o) => bob.post('/api/admin/r/builds', { doc, visibility: 'public', ...o })
      // нова річ: сайту, чужій гільдії, іншій людині — ні; собі — так
      expect((await mk({ owner_kind: 'site' })).status).toBe(403)
      expect((await mk({ owner_kind: 'guild', owner_id: ev.id })).status).toBe(403)
      expect((await mk({ owner_kind: 'user', owner_id: eveId })).status).toBe(403)
      expect((await mk({})).status).toBe(200)
      // чужа річ: забрати собі, віддати сайту чи гільдії — ні (і через «Реєстр речей» теж); видимість — можна
      const card = `/api/admin/r/builds/one?id=${hers.id}`
      expect((await bob.patch(card, { owner_kind: 'user', owner_id: bobId })).status).toBe(403)
      expect((await bob.patch(card, { owner_kind: 'site' })).status).toBe(403)
      const reg = (await admin.get(`/api/admin/r/items?search=${encodeURIComponent('Білд Єви')}`)).body.rows[0]._id
      expect((await bob.patch(`/api/admin/r/items/one?id=${encodeURIComponent(reg)}`, { owner_kind: 'guild', owner_id: sw.id })).status).toBe(403)
      expect((await bob.patch(`/api/admin/r/items/one?id=${encodeURIComponent(reg)}`, { owner_kind: 'user', owner_id: bobId })).status).toBe(403)
      expect((await bob.patch(card, { visibility: 'link' })).status).toBe(200)
      expect((await eve.get(`/api/builds/${hers.id}`)).body.item.owner).toMatchObject({ kind: 'user', id: eveId })

      // дозвіл site.content: офіційне від сайту — і в панелі, і на сайті; вести його можна, віддати (собі) — ні
      await admin.patch('/api/admin/r/roles/one?id=editor', { permissions: ['admin', 'builds.view', 'builds.edit', 'builds.create', 'items.view', 'items.edit', 'site.content'] })
      const off = await mk({ owner_kind: 'site' })
      expect(off.status).toBe(200)
      const viaSite = await bob.post('/api/builds', { name: 'Офіційний', code: '1a', owner: { kind: 'site' }, visibility: 'public' })
      expect(viaSite.status).toBe(201)
      expect(viaSite.body.item.can).toMatchObject({ view: true, edit: true, manage: true, own: false })
      expect((await bob.put(`/api/builds/${viaSite.body.id}`, { name: 'Офіційний 2' })).status).toBe(200)
      expect((await bob.patch(`/api/items/build/${viaSite.body.id}/access`, { owner: { kind: 'user', id: bobId } })).status).toBe(403)
      // чуже сайту — і далі ні (це передача, потрібен site.owners)
      expect((await bob.patch(card, { owner_kind: 'site' })).status).toBe(403)

      // дозвіл site.owners: віддати будь-кому; гільдія за адресою зберігається за id
      await admin.patch('/api/admin/r/roles/one?id=editor', { permissions: ['admin', 'builds.view', 'builds.edit', 'items.view', 'items.edit', 'site.owners'] })
      expect((await bob.patch(card, { owner_kind: 'guild', owner_id: sw.slug })).status).toBe(200)
      expect((await admin.get(`/api/builds/${hers.id}`)).body.item.owner).toMatchObject({ kind: 'guild', id: sw.id })
      // сайту без site.content — ні й тут
      expect((await bob.patch(card, { owner_kind: 'site' })).status).toBe(403)

      await admin.patch(`/api/admin/r/users/one?id=${bobId}`, { role: 'user' })
      await admin.post('/api/admin/r/roles/delete', { ids: ['editor'] })
    })

    it('журнал і історію не стерти; історія — лише розділів, які людина бачить', async () => {
      expect((await admin.post('/api/admin/r/audit/delete', { ids: ['1'] })).status).toBe(405)
      expect((await admin.post('/api/admin/r/revisions/delete', { ids: ['1'] })).status).toBe(405)
      await admin.post('/api/admin/r/roles', { key: 'historian', name: 'Літописець', permissions: ['admin', 'revisions.view', 'builds.view'] })
      await admin.patch(`/api/admin/r/users/one?id=${await idOf('bob')}`, { role: 'historian' })
      const seen = (await bob.get('/api/admin/r/revisions?size=200')).body.rows
      expect(seen.length).toBeGreaterThan(0)
      expect(seen.every((r) => r.entity === 'builds')).toBe(true)
      const userRev = (await admin.get('/api/admin/r/revisions?f=' + f({ entity: ['users'] }))).body.rows[0]
      expect(userRev).toBeTruthy()
      expect((await bob.get(`/api/admin/revisions/${userRev.id}/diff`)).status).toBe(404)
      expect((await bob.get(`/api/admin/r/revisions/one?id=${userRev.id}`)).status).toBe(404)
      // одна зміна з панелі — одна версія (сховище, яке кличе панель, своєї не пише)
      const g = (await admin.get('/api/admin/r/guilds')).body.rows[0]
      const before = (await admin.get(`/api/admin/history/guilds?id=${g._id}`)).body.rows.length
      await admin.patch(`/api/admin/r/guilds/one?id=${g._id}`, { about: 'Одна зміна' })
      expect((await admin.get(`/api/admin/history/guilds?id=${g._id}`)).body.rows.length).toBe(before + 1)
      await admin.patch(`/api/admin/r/users/one?id=${await idOf('bob')}`, { role: 'user' })
      await admin.post('/api/admin/r/roles/delete', { ids: ['historian'] })
    })

    it('обов’язкове поле дії й форми — 400 з назвою поля; стара версія картки — 409', async () => {
      const item = (await admin.get('/api/admin/r/items')).body.rows[0]
      expect((await admin.post('/api/admin/r/items/action/visibility', { ids: [item._id], input: {} })).status).toBe(400)
      const r = await admin.post('/api/admin/r/users', {})
      expect(r.status).toBe(400)
      expect(r.body.field).toBe('email')
      const b = (await admin.post('/api/builds', { name: 'Паралельний', code: '1a', notes: '' })).body
      const card = (await admin.get(`/api/admin/r/builds/one?id=${b.id}`)).body
      await new Promise((ok) => setTimeout(ok, 5))
      await admin.put(`/api/builds/${b.id}`, { name: 'Паралельний 2' })
      expect((await admin.patch(`/api/admin/r/builds/one?id=${b.id}`, { visibility: 'private', _updated: card.updated })).status).toBe(409)
      const fresh = (await admin.get(`/api/admin/r/builds/one?id=${b.id}`)).body
      expect((await admin.patch(`/api/admin/r/builds/one?id=${b.id}`, { visibility: 'private', _updated: fresh.updated })).status).toBe(200)
    })

    it('пошук по панелі й CSV: лише видиме, мовою людини', async () => {
      const hits = (await admin.get('/api/admin/search?q=bob')).body.rows
      expect(hits.some((x) => x.res === 'users')).toBe(true)
      expect((await bob.get('/api/admin/search?q=bob')).status).toBe(403)
      const csv = await admin.raw('/api/admin/r/users/export.csv?f=' + f({}))
      expect(csv.status).toBe(200)
      expect(csv.headers.get('content-type')).toMatch(/text\/csv/)
      const text = await csv.text()
      expect(text.split('\r\n')[0]).toContain('Пошта')
      expect(text).toContain('bob@example.com')
      expect((await bob.raw('/api/admin/r/users/export.csv')).status).toBe(403)
    })
  })

  describe('указ Ландсрааду', () => {
    it('один на сайт: виставляє адміністрація, бачать усі', async () => {
      expect((await anon.get('/api/decree')).body).toMatchObject({ canSet: false })
      expect((await admin.get('/api/decree')).body.canSet).toBe(true)
      expect((await admin.put('/api/decree', { id: 'production', until: Date.now() + 3 * 86400_000 })).status).toBe(200)
      expect((await admin.put('/api/decree', { id: 'nonsense', until: Date.now() + 86400_000 })).status).toBe(400)
      expect((await anon.get('/api/decree')).body.id).toBe('production')
      expect((await bob.get('/api/decree')).body).toMatchObject({ id: 'production', canSet: false })
    })
  })
})

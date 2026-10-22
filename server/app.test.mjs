// Вхід поштою з кодом, гільдії, доступ до речей, бібліотека й панель керування — через справжній HTTP.
// Двічі: на запасній SQLite (тимчасова тека) і на Postgres dune_testing зі Snotax console (якщо є .env і база
// відповідає). Листи не йдуть — коди перехоплює тестовий «відправник».
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { can } from './lib/items.mjs'
import { openDb } from './lib/sql.mjs'

// Postgres для тестів — база <DB_DATABASE>_testing з .env
let pg = null
try {
  const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  if (env.DB_HOST && env.DB_CONNECTION !== 'sqlite') {
    pg = { host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: `${env.DB_DATABASE || 'dune'}_testing`, user: env.DB_USERNAME || 'postgres', password: env.DB_PASSWORD || undefined }
    const probe = await openDb({ pg }).catch(() => null)
    if (probe) await probe.close()
    else pg = null
  }
} catch { pg = null }

const ENGINES = [['SQLite', null], ...(pg ? [['Postgres', pg]] : [])]

describe.each(ENGINES)('%s', (_name, pgCfg) => {
  let server, base, dir, app, db
  const mail = []
  const codeFor = (email) => [...mail].reverse().find((m) => m.to === email.trim().toLowerCase())?.text.match(/\b\d{6}\b/)?.[0]

  /** «браузер»: свій cookie сеансу, запити з того самого сайту */
  function agent() {
    let cookie = ''
    const call = async (method, url, body, headers = {}) => {
      const r = await fetch(base + url, {
        method,
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const set = r.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
      return { status: r.status, body: await r.json().catch(() => null) }
    }
    const a = {
      get: (u) => call('GET', u),
      post: (u, b = {}, h) => call('POST', u, b, h),
      put: (u, b) => call('PUT', u, b),
      patch: (u, b) => call('PATCH', u, b),
      del: (u, b) => call('DELETE', u, b),
      /** вхід поштою: код — з перехопленого листа */
      async signIn(email) {
        const r = await a.post('/api/auth/code', { email })
        if (r.status !== 200) return r
        return a.post('/api/auth/verify', { email, code: codeFor(email) })
      },
    }
    return a
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-test-'))
    db = await openDb({ dataDir: dir, pg: pgCfg })
    if (db.kind === 'pg') await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(async () => {
    server?.close()
    await app?.locals.close()
    await db?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const admin = agent(), bob = agent(), eve = agent(), anon = agent()
  let invite = ''

  describe('вхід поштою', () => {
    it('без входу давнього вмісту не видно; перший — адміністратор і лідер Sandwalkers; логін і ім’я — з пошти', async () => {
      expect((await anon.get('/api/bases')).body.bases).toEqual([])
      const r = await admin.signIn('Art.Step@Example.com')
      expect(r.status).toBe(201)
      expect(r.body.created).toBe(true)
      // логін і ім'я — нейтральні, не з пошти (пів адреси пошти не стає публічним)
      expect(r.body.user).toMatchObject({ email: 'art.step@example.com', role: 'admin' })
      expect(r.body.user.login).toMatch(/^sw-[0-9a-f]{5}$/)
      expect(r.body.user.name).toMatch(/^Sandwalker [0-9A-F]{5}$/)
      expect(JSON.stringify(r.body.user)).not.toMatch(/art\.step"|Art Step/)
      expect(r.body.guilds[0]).toMatchObject({ slug: 'sandwalkers', role: 'leader' })
      expect((await admin.get('/api/bases')).body.bases.map((b) => b.id)).toEqual(expect.arrayContaining(['main', 'dd']))
      expect((await admin.get('/api/roadmaps')).body.rows.map((x) => x.id)).toContain('sandwalkers')
    })

    it('лист — з кодом; хибний код рахує спроби; правильний — одноразовий; повторний вхід — та сама людина', async () => {
      expect((await bob.post('/api/auth/code', { email: 'не пошта' })).status).toBe(400)
      await bob.post('/api/auth/code', { email: 'bob@example.com' })
      expect(mail.at(-1)).toMatchObject({ to: 'bob@example.com' })
      expect(mail.at(-1).subject).toMatch(/^Код входу: \d{3} \d{3}$/)
      const wrong = await bob.post('/api/auth/verify', { email: 'bob@example.com', code: '000000' === codeFor('bob@example.com') ? '111111' : '000000' })
      expect(wrong.status).toBe(400)
      expect(wrong.body.error).toContain('спроб лишилось: 4')
      const code = codeFor('bob@example.com')
      expect((await bob.post('/api/auth/verify', { email: 'bob@example.com', code })).body.user.role).toBe('user')
      expect((await agent().post('/api/auth/verify', { email: 'bob@example.com', code })).status).toBe(400)
      const again = await agent().signIn('BOB@example.com')
      expect(again.status).toBe(200)
      expect(again.body.created).toBe(false)
      expect((await eve.signIn('eve@example.com')).status).toBe(201)
    })

    it('вихід забирає сеанс; зміни з чужого сайту — 403', async () => {
      const a = agent()
      await a.signIn('bob@example.com')
      await a.post('/api/auth/logout')
      expect((await a.get('/api/me')).body.user).toBe(null)
      expect((await bob.post('/api/roadmaps', { title: 'x' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
      expect((await bob.post('/api/roadmaps', { title: 'x' }, { 'sec-fetch-site': '', origin: 'https://evil.example' })).status).toBe(403)
    })

    it('профіль: ім’я й адреса сторінки змінюються; зайнята адреса — 409', async () => {
      expect((await bob.patch('/api/me', { name: 'Боб', login: 'bobby' })).body.user).toMatchObject({ name: 'Боб', login: 'bobby' })
      expect((await eve.patch('/api/me', { login: 'bobby' })).status).toBe(409)
      expect((await anon.get('/api/users/bobby')).body.user.name).toBe('Боб')
    })
  })

  describe('гільдія й доступ', () => {
    it('чужа гільдійська база — 404; після вступу за запрошенням — видно й можна змінювати, але не видаляти', async () => {
      expect((await bob.get('/api/bases/main')).status).toBe(404)
      invite = (await admin.post('/api/guilds/sandwalkers/invites', { days: 7, uses: 5 })).body.code
      expect((await bob.get(`/api/invites/${invite}`)).body.guild.slug).toBe('sandwalkers')
      expect((await bob.post(`/api/invites/${invite}/accept`)).status).toBe(200)
      const main = await bob.get('/api/bases/main')
      expect(main.status).toBe(200)
      expect(main.body.item.can).toMatchObject({ view: true, edit: true, manage: false, own: false })
      expect((await bob.del('/api/bases/main')).status).toBe(403)
      expect((await bob.patch('/api/items/base/main/access', { visibility: 'public' })).status).toBe(403)
    })

    it('офіцер не призначає офіцерів; новобранець бачить, але не змінює', async () => {
      const g = (await admin.get('/api/guilds/sandwalkers')).body
      const bobId = g.members.find((m) => m.login === 'bobby').id
      await admin.patch(`/api/guilds/sandwalkers/members/${bobId}`, { role: 'officer' })
      const eveId = (await admin.get('/api/admin/r/users?search=eve')).body.rows[0].id
      await eve.post(`/api/invites/${invite}/accept`)
      expect((await bob.patch(`/api/guilds/sandwalkers/members/${eveId}`, { role: 'officer' })).status).toBe(403)
      expect((await bob.patch(`/api/guilds/sandwalkers/members/${eveId}`, { role: 'recruit' })).status).toBe(200)
      expect((await eve.get("/api/bases/dd")).body.item.can).toMatchObject({ view: true, edit: false, manage: false, own: false })
      expect((await eve.post('/api/roadmaps', { title: 'Мій', owner: { kind: 'guild', id: g.guild.id } })).status).toBe(403)
    })

    it('особисте бачить лише власник (і адміністратор); публічне — усі й у бібліотеці; «за посиланням» — лише за адресою', async () => {
      const r = await eve.post('/api/roadmaps', { title: 'Мій шлях до орні' })
      expect(r.status).toBe(201)
      expect(r.body.item.visibility).toBe('private')
      expect((await bob.get(`/api/roadmaps/${r.body.id}`)).status).toBe(404)
      expect((await admin.get(`/api/roadmaps/${r.body.id}`)).status).toBe(200)
      expect((await eve.patch(`/api/items/roadmap/${r.body.id}/access`, { visibility: 'guild' })).body.item.visibility).toBe('private')
      expect((await eve.patch(`/api/items/roadmap/${r.body.id}/access`, { visibility: 'public' })).body.item.visibility).toBe('public')
      expect((await anon.get(`/api/roadmaps/${r.body.id}`)).status).toBe(200)
      expect((await anon.get('/api/library?kind=roadmap')).body.rows.map((x) => x.id)).toContain(r.body.id)
      await eve.patch(`/api/items/roadmap/${r.body.id}/access`, { visibility: 'link' })
      expect((await anon.get(`/api/roadmaps/${r.body.id}`)).status).toBe(200)
      expect((await anon.get('/api/library?kind=roadmap')).body.rows.map((x) => x.id)).not.toContain(r.body.id)
    })

    it('роадмап: збереження з версією, конфлікт — 409, історія й відновлення', async () => {
      const r = (await bob.post('/api/roadmaps', { title: 'Версії' })).body
      const v1 = await bob.put(`/api/roadmaps/${r.id}`, { doc: { ...r.doc, lead: 'один' }, version: r.version })
      expect(v1.body.version).toBe(2)
      expect((await bob.put(`/api/roadmaps/${r.id}`, { doc: r.doc, version: r.version })).status).toBe(409)
      const hist = (await bob.get(`/api/roadmaps/${r.id}/history`)).body.rows
      expect(hist).toHaveLength(1)
      const back = await bob.post(`/api/roadmaps/${r.id}/history/${hist[0].hid}/restore`)
      expect(back.body).toMatchObject({ version: 3, doc: { lead: '' } })
    })

    it('білд: створити, викласти, зірка й копія собі з позначкою «на основі»', async () => {
      const b = await bob.post('/api/builds', { name: 'Меч і щит', code: '3abc', notes: 'для PvP', visibility: 'public' })
      expect(b.status).toBe(201)
      expect((await eve.post(`/api/items/build/${b.body.id}/star`, { on: true })).body).toEqual({ stars: 1, starred: true })
      const c = await eve.post(`/api/items/build/${b.body.id}/copy`)
      expect(c.status).toBe(201)
      expect(c.body.item).toMatchObject({ visibility: 'private', basedOn: { kind: 'build', id: b.body.id } })
      expect((await anon.get(`/api/items/build/${b.body.id}`)).body.item).toMatchObject({ stars: 1, copies: 1 })
    })

    it('база: нова з власником-гільдією, збереження й історія', async () => {
      const g = (await admin.get('/api/guilds/sandwalkers')).body.guild
      const doc = (await admin.get('/api/bases/dd')).body.doc
      const nb = await admin.post('/api/bases', { doc: { ...doc, ui: { ...doc.ui, name: 'Аванпост на Хагга' } }, note: 'тест', owner: { kind: 'guild', id: g.id } })
      expect(nb.status).toBe(201)
      // адреса — з назви й випадкового хвоста (не вгадати перебором)
      expect(nb.body).toMatchObject({ version: 1, item: { visibility: 'guild', owner: { tag: 'SW' } } })
      expect(nb.body.id).toMatch(/^avanpost-na-khahha-[0-9a-f]{6}$/)
      const v2 = await bob.put(`/api/bases/${nb.body.id}`, { doc: nb.body.doc, version: 1, note: 'правка' })
      expect(v2.body.version).toBe(2)
      expect((await bob.get(`/api/bases/${nb.body.id}/history`)).body.rows.map((h) => h.version)).toEqual([2, 1])
    })

    it('видалення гільдії: її річ — лідеру особисто', async () => {
      // гільдія в людини одна — спершу виходимо з Sandwalkers
      await bob.post('/api/guilds/sandwalkers/leave')
      const g = await bob.post('/api/guilds', { name: 'Харконнени', tag: 'HK' })
      const m = await bob.post('/api/roadmaps', { title: 'Рейд', owner: { kind: 'guild', id: g.body.guild.id } })
      expect(m.body.item.owner).toMatchObject({ kind: 'guild', tag: 'HK' })
      expect((await bob.del(`/api/guilds/${g.body.guild.slug}`)).status).toBe(200)
      expect((await bob.get(`/api/roadmaps/${m.body.id}`)).body.item).toMatchObject({ owner: { kind: 'user', login: 'bobby' }, visibility: 'private' })
    })
  })

  describe('панель керування', () => {
    const f = (o) => encodeURIComponent(JSON.stringify(o))
    it('звичайній людині — 403; закрита реєстрація не пускає нову пошту, але пускає наявну', async () => {
      expect((await bob.get('/api/admin/r/users')).status).toBe(403)
      expect((await bob.get('/api/admin/meta')).status).toBe(403)
      await admin.patch('/api/admin/site-settings', { registration: 'closed' })
      // відповідь — як для будь-якої пошти (сторонній не дізнається, чи є така людина); що реєстрацію закрито — каже лист
      expect((await agent().post('/api/auth/code', { email: 'new@example.com' })).status).toBe(200)
      expect(mail.at(-1)).toMatchObject({ to: 'new@example.com' })
      expect(mail.at(-1).subject).toMatch(/закрито/)
      expect((await agent().post('/api/auth/verify', { email: 'new@example.com', code: '000000' })).status).toBe(400)
      expect((await agent().signIn('eve@example.com')).status).toBe(200)
      await admin.patch('/api/admin/site-settings', { registration: 'open' })
    })

    it('опис розділів: усі таблиці сайту, без функцій', async () => {
      const m = (await admin.get('/api/admin/meta')).body
      const names = m.resources.map((r) => r.name)
      for (const n of ['users', 'sessions', 'guilds', 'members', 'invites', 'requests', 'items', 'bases', 'roadmaps', 'builds', 'markers', 'places', 'game-items', 'game-recipes', 'game-skills', 'game-texts', 'translations', 'announcements', 'settings', 'audit', 'push']) expect(names).toContain(n)
      expect(JSON.stringify(m)).not.toContain('async')
      expect(m.langs.length).toBe(14)
    })

    it('список: пошук, фільтр, сортування, сторінки; запис — читання й зміна', async () => {
      const all = (await admin.get('/api/admin/r/users?size=2&sort=created&desc=0')).body
      expect(all.rows).toHaveLength(2)
      expect(all.total).toBeGreaterThanOrEqual(3)
      expect(all.rows[0].email).toBeTruthy()
      const admins = (await admin.get(`/api/admin/r/users?f=${f({ role: 'admin' })}`)).body
      expect(admins.rows.every((u) => u.role === 'admin')).toBe(true)
      const eve = (await admin.get('/api/admin/r/users?search=eve')).body.rows[0]
      const upd = await admin.patch(`/api/admin/r/users/one?id=${eve._id}`, { nick: 'Eve_X', role: 'moderator' })
      expect(upd.body).toMatchObject({ nick: 'Eve_X', role: 'moderator' })
      expect((await admin.patch(`/api/admin/r/users/one?id=${eve._id}`, { color: 'red' })).status).toBe(400)
      const g = (await admin.get('/api/admin/r/guilds')).body.rows.find((x) => x.slug === 'sandwalkers')
      expect(g.members_n).toBeGreaterThan(0)
      // зв'язок: підпис гільдії поруч з id
      expect((await admin.get('/api/admin/r/members?f=' + f({ guild_id: g.id }))).body.rows[0].guild_id__label).toBe('Sandwalkers')
      // журнал фіксує зміни
      const changes = (await admin.get('/api/admin/r/audit?f=' + f({ action: ['admin.update'] }))).body.rows
      expect(changes.length).toBeGreaterThan(0)
      // людською мовою: на що вказує подія — запис панелі з назвою й посиланням
      expect(changes[0]).toMatchObject({ status: 'ok' })
      expect(Array.isArray(changes[0].target__ref)).toBe(true)
    })

    it('створення й видалення: людина з пошти, гільдія, учасник', async () => {
      const u = await admin.post('/api/admin/r/users', { email: 'zed@example.com', name: 'Зед', role: 'user' })
      expect(u.status).toBe(200)
      expect(u.body).toMatchObject({ email: 'zed@example.com', name: 'Зед' })
      const g = await admin.post('/api/admin/r/guilds', { name: 'Фремени', tag: 'FR' })
      expect(g.body).toMatchObject({ name: 'Фремени', tag: 'FR' })
      const m = await admin.post('/api/admin/r/members', { guild_id: g.body.id, user_id: u.body.id, role: 'officer' })
      expect(m.body).toMatchObject({ role: 'officer' })
      expect((await admin.post('/api/admin/r/guilds/delete', { ids: [g.body.id] })).body.removed).toBe(1)
      expect((await admin.post('/api/admin/r/users/delete', { ids: [u.body.id] })).body.removed).toBe(1)
      expect((await admin.get('/api/admin/r/users?search=zed')).body.total).toBe(0)
    })

    it('блокування дією: код не надсилається, сеанси закрито; приховане зникає з бібліотеки', async () => {
      const id = (await admin.get('/api/admin/r/users?search=bobby')).body.rows[0].id
      expect((await admin.post('/api/admin/r/users/action/ban', { ids: [id], input: { reason: 'спам' } })).status).toBe(200)
      // код надходить як і всім (сторонній не дізнається про блокування), а причину людина бачить, увівши код
      const bobAgain = agent()
      expect((await bobAgain.post('/api/auth/code', { email: 'bob@example.com' })).status).toBe(200)
      expect((await bobAgain.post('/api/auth/verify', { email: 'bob@example.com', code: codeFor('bob@example.com') })).body.error).toContain('спам')
      expect((await bob.get('/api/me')).body.user).toBe(null)
      const lib = (await anon.get('/api/library?kind=build')).body.rows
      expect((await admin.post('/api/admin/r/items/action/hide', { ids: [JSON.stringify(['build', lib[0].id])] })).status).toBe(200)
      expect((await anon.get('/api/library?kind=build')).body.rows).toHaveLength(lib.length - 1)
      await admin.post('/api/admin/r/users/action/unban', { ids: [id] })
    })

    it('оголошення: вікно показу, аудиторія, серія й список одним пакетом', async () => {
      const now = Date.now()
      const live = await admin.post('/api/admin/r/announcements', { title: 'Техроботи', tone: 'warning', starts: now - 1000, ends: now + 3600_000 })
      expect(live.body.status).toBe('live')
      await admin.post('/api/admin/r/announcements', { title: 'Майбутнє', starts: now + 86400_000 })
      await admin.post('/api/admin/r/announcements', { title: 'Лише гостям', audience: 'guests' })
      expect((await anon.get('/api/announcements')).body.list.map((a) => a.title)).toEqual(expect.arrayContaining(['Техроботи', 'Лише гостям']))
      expect((await anon.get('/api/announcements')).body.list.map((a) => a.title)).not.toContain('Майбутнє')
      expect((await admin.get('/api/announcements')).body.list.map((a) => a.title)).not.toContain('Лише гостям')
      expect((await admin.post('/api/admin/r/announcements', { title: 'Хибно', starts: now, ends: now - 1 })).status).toBe(400)
      const series = await admin.post('/api/admin/announcements/bulk', { template: { title: 'Буря', starts: now + 1000, ends: now + 7200_000 }, repeat: { every: 'week', count: 4 } })
      expect(series.body.created).toBe(4)
      const rows = (await admin.get(`/api/admin/r/announcements?f=${f({ batch: series.body.batch })}&sort=starts`)).body.rows
      expect(rows).toHaveLength(4)
      // той самий час на годиннику щотижня (перехід на зимовий час дає ±1 год)
      expect(Math.round((rows[1].starts - rows[0].starts) / 86400_000)).toBe(7)
      expect(new Date(rows[1].starts).getHours()).toBe(new Date(rows[0].starts).getHours())
      const list = await admin.post('/api/admin/announcements/bulk', { items: [{ title: 'А' }, { title: 'Б', tone: 'success' }] })
      expect(list.body.created).toBe(2)
      expect((await admin.post('/api/admin/announcements/bulk', { items: [{ title: 'В' }, { title: '' }] })).status).toBe(400)
      // масова дія: зсунути дати серії на день
      await admin.post('/api/admin/r/announcements/action/shift', { ids: rows.map((r) => r._id), input: { days: 1 } })
      const moved = (await admin.get(`/api/admin/r/announcements?f=${f({ batch: series.body.batch })}&sort=starts`)).body.rows
      expect(moved[0].starts - rows[0].starts).toBe(86400_000) // зсув — рівно на добу
      expect((await bob.post('/api/admin/announcements/bulk', { items: [{ title: 'x' }] })).status).toBe(401)
    })

    it('переклади: словник мовою з правками панелі; помилки — мовою людини', async () => {
      const key = 'потрібно увійти'
      const fromFile = (await anon.get('/api/i18n/en')).body.dict[key] // переклад із locales/en.json (може бути й порожньо)
      await admin.patch(`/api/admin/r/translations/one?id=${encodeURIComponent(JSON.stringify(['en', key]))}`, { text: 'please sign in' })
      expect((await anon.get('/api/i18n/en')).body.dict[key]).toBe('please sign in')
      expect((await anon.get('/api/i18n/uk')).body.dict).toEqual({})
      expect((await anon.post('/api/roadmaps?lang=en', {})).body.error).toBe('please sign in')
      expect((await anon.post('/api/roadmaps', {}, { 'accept-language': 'en-US,en;q=0.9' })).body.error).toBe('please sign in')
      expect((await anon.post('/api/roadmaps', {}, { cookie: 'sw_lang=uk' })).body.error).toBe(key)
      const tr = (await admin.get(`/api/admin/r/translations?f=${f({ lang: 'en', state: ['override'] })}`)).body
      expect(tr.rows.map((r) => r.key)).toContain(key)
      await admin.post('/api/admin/r/translations/delete', { ids: [JSON.stringify(['en', key])] })
      expect((await anon.get('/api/i18n/en')).body.dict[key]).toBe(fromFile) // правку прибрано — знову з файлу
    })

    it('дані гри в базі: правка закріплює запис, тексти мовами, довідник мовою', async () => {
      const it0 = await admin.post('/api/admin/r/game-items', { id: 'TestOre', name: 'Test Ore', grade: 2, cat: 'misc' })
      expect(it0.status).toBe(200)
      await admin.post('/api/admin/r/game-recipes', { id: 'TestOreRecipe', name: 'Test Ore', time: 10, inputs: [['TestOre', 3]], outputs: [['TestOre', 1]], stations: [] })
      expect((await admin.post('/api/admin/r/game-recipes', { id: 'Bad', name: 'Bad', inputs: [['x']] })).status).toBe(400)
      await admin.put('/api/admin/game-texts/item?id=TestOre', { texts: { uk: { name: 'Тестова руда', description: 'Для тесту' }, de: { name: 'Testerz' } } })
      const uk = (await anon.get('/api/catalog?lang=uk')).body
      expect(uk.items.find((i) => i.id === 'TestOre')).toMatchObject({ name: 'Test Ore', loc: 'Тестова руда' })
      expect(uk.recipes.find((r) => r.id === 'TestOreRecipe')).toMatchObject({ in: [['TestOre', 3]], out: [['TestOre', 1]] })
      expect((await anon.get('/api/catalog?lang=de')).body.items.find((i) => i.id === 'TestOre').loc).toBe('Testerz')
      // приховане зникає з довідника
      await admin.post('/api/admin/r/game-items/action/hide', { ids: ['TestOre'] })
      expect((await anon.get('/api/catalog?lang=uk')).body.items.find((i) => i.id === 'TestOre')).toBeUndefined()
      expect((await admin.get('/api/admin/r/game-items/one?id=TestOre')).body).toMatchObject({ hidden: true, locked: true })
    })
  })
})

describe('правила доступу', () => {
  const ctx = (id, role = 'user', ranks = {}) => ({ user: { id, role }, ranks: new Map(Object.entries(ranks)) })
  const it0 = { owner_kind: 'guild', owner_id: 'g1', visibility: 'guild', hidden: null }
  it('ранги гільдії: новобранець дивиться, учасник змінює, офіцер керує, лідер — ще й віддає й стирає назавжди', () => {
    expect(can(ctx('u', 'user', { g1: 1 }), it0)).toEqual({ view: true, edit: false, manage: false, own: false })
    expect(can(ctx('u', 'user', { g1: 2 }), it0)).toEqual({ view: true, edit: true, manage: false, own: false })
    expect(can(ctx('u', 'user', { g1: 3 }), it0)).toEqual({ view: true, edit: true, manage: true, own: false })
    expect(can(ctx('u', 'user', { g1: 4 }), it0)).toEqual({ view: true, edit: true, manage: true, own: true })
    expect(can(ctx('u'), it0).view).toBe(false)
    expect(can(ctx('u', 'admin'), it0)).toEqual({ view: true, edit: true, manage: true, own: true })
  })
  it('приховане публічне бачить власник і модератор, решта — ні', () => {
    const pub = { owner_kind: 'user', owner_id: 'a', visibility: 'public', hidden: 1 }
    expect(can(ctx('a'), pub).view).toBe(true)
    expect(can(ctx('b'), pub).view).toBe(false)
    // модератор — за дозволом ролі (site.moderate), а не за її назвою
    expect(can({ ...ctx('m', 'moderator'), moderate: true }, pub).view).toBe(true)
    expect(can(ctx('m', 'moderator'), pub).view).toBe(false)
  })
})

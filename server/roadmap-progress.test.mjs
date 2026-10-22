// Прогрес і права роадмапів (lib/roadmap-access, lib/roadmap-progress, routes/roadmap): хто відмічає, редагує, бачить
// прогрес і історію, копіює й куди, хто міняє права — для особистого, гільдійського й публічного; що буває з прогресом
// при передачі, копії, видаленні; перенесення давніх статусів із документів. Через справжній HTTP, як решта: на
// запасній SQLite і на Postgres dune_testing (якщо є), у власній схемі.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'
import { defaultAccess, effectiveAccess, levelsFor, modesFor, normAccess, patchAccess, rightsOf } from './lib/roadmap-access.mjs'

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

async function freshDb(pgCfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-rmp-'))
  if (!pgCfg) {
    const db = await openDb({ dataDir: dir })
    const close = db.close
    db.close = async () => { await close(); fs.rmSync(dir, { recursive: true, force: true }) }
    return { db, dir }
  }
  const schema = `gt_rmp_${crypto.randomBytes(4).toString('hex')}`
  const root = await openDb({ pg: pgCfg })
  await root.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`)
  await root.close()
  const db = await openDb({ pg: { ...pgCfg, options: `-c search_path=${schema}` } })
  const close = db.close
  db.close = async () => {
    await close()
    const r = await openDb({ pg: pgCfg })
    await r.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await r.close()
  }
  return { db, dir }
}

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/** документ з етапом, задачею й карткою «зібрано» */
const DOC = {
  title: 'Тест', stages: [{ id: 's1', title: 'Перший', tasks: [{ id: 't1', text: 'зробити' }] }, { id: 's2', title: 'Другий', tasks: [] }],
  sections: [{ id: 'sec', title: 'Набори', collect: true, columns: [{ id: 'c1', title: 'Картка' }, { id: 'c2', title: 'Ще' }] }],
}

describe('права (чисті функції)', () => {
  const ctxOf = (id, ranks = {}) => ({ user: { id, role: 'user' }, ranks: new Map(Object.entries(ranks)) })
  const guildIt = { kind: 'roadmap', id: 'r', owner_kind: 'guild', owner_id: 'g', visibility: 'public' }
  it('типові: гільдія — учасник редагує й відмічає, офіцер міняє права; новобранець лише дивиться', () => {
    const a = defaultAccess('guild')
    expect(rightsOf(ctxOf('m', { g: 2 }), guildIt, a)).toMatchObject({ edit: true, mark: true, settings: false, scope: 'g:g', whose: 'guild' })
    expect(rightsOf(ctxOf('r', { g: 1 }), guildIt, a)).toMatchObject({ edit: false, mark: false, seeProgress: true })
    expect(rightsOf(ctxOf('o', { g: 3 }), guildIt, a)).toMatchObject({ settings: true, settingsLevel: false })
    expect(rightsOf(ctxOf('l', { g: 4 }), guildIt, a)).toMatchObject({ settings: true, settingsLevel: true })
    // сторонній бачить прогрес гільдії, але не відмічає; анонім — так само, і не копіює
    expect(rightsOf(ctxOf('x'), guildIt, a)).toMatchObject({ mark: false, seeProgress: true, copy: true, edit: false })
    expect(rightsOf({ user: null, ranks: new Map() }, guildIt, a)).toMatchObject({ mark: false, seeProgress: true, copy: false, history: true })
  })
  it('рівні, яких власник не має, — 400; збережені — підрізаються до найближчих', () => {
    expect(() => patchAccess(defaultAccess('user'), { edit: 'officer' }, 'user', 'public')).toThrow()
    expect(() => patchAccess(defaultAccess('guild'), { edit: 'anyone' }, 'guild', 'public')).toThrow()
    expect(() => patchAccess(defaultAccess('guild'), { settings: 'member' }, 'guild', 'public')).toThrow()
    expect(() => patchAccess(defaultAccess('guild'), { progress: 'mine' }, 'guild', 'public')).toThrow()
    expect(() => patchAccess(defaultAccess('guild'), { whatever: 1 }, 'guild', 'public')).toThrow()
    expect(normAccess({ edit: 'member', mark: 'recruit', settings: 'officer' }, 'user')).toMatchObject({ edit: 'owner', mark: 'owner', settings: 'owner' })
  })
  it('рівні — за видимістю: особисте без вибору, гільдія — лише ранги, публічне — ранги гільдії й «усі»', () => {
    expect(levelsFor('edit', 'user', 'private')).toEqual([])
    expect(() => patchAccess(defaultAccess('user'), { mark: 'owner' }, 'user', 'private')).toThrow()
    expect(levelsFor('mark', 'guild', 'guild')).toEqual(['nobody', 'owner', 'officer', 'member', 'recruit'])
    expect(() => patchAccess(defaultAccess('guild'), { mark: 'users' }, 'guild', 'guild')).toThrow()
    expect(() => patchAccess(defaultAccess('guild'), { progress: 'all' }, 'guild', 'guild')).toThrow()
    expect(modesFor('guild')).toEqual(['owner', 'each'])
    expect(levelsFor('mark', 'user', 'public')).toEqual(['nobody', 'owner', 'users'])
    expect(levelsFor('seeProgress', 'guild', 'public')).toEqual(['owner', 'officer', 'member', 'recruit', 'users', 'anyone'])
    // збережене, що не діє за видимістю, лишається, а діє найближче
    expect(effectiveAccess({ mark: 'users', progress: 'all' }, 'guild', 'guild')).toMatchObject({ mark: 'recruit', progress: 'owner' })
    expect(effectiveAccess({ mark: 'nobody', edit: 'users' }, 'user', 'private')).toMatchObject({ mark: 'owner', edit: 'owner' })
    // особисте: власник відмічає навіть якщо колись поставив «ніхто»
    const mine = { kind: 'roadmap', id: 'r', owner_kind: 'user', owner_id: 'u', visibility: 'private' }
    expect(rightsOf({ user: { id: 'u', role: 'user' }, ranks: new Map() }, mine, { mark: 'nobody' })).toMatchObject({ mark: true, edit: true })
  })
  it('адміністратор не відмічає чужий особистий прогрес, але може все інше', () => {
    const it = { kind: 'roadmap', id: 'r', owner_kind: 'user', owner_id: 'u', visibility: 'public' }
    const admin = { user: { id: 'a', role: 'admin' }, ranks: new Map(), superuser: true }
    expect(rightsOf(admin, it, defaultAccess('user'))).toMatchObject({ edit: true, settings: true, mark: false, scope: 'u:u' })
  })
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
      return { status: r.status, body: await r.json().catch(() => null) }
    }
    const a = {
      get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b),
      patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u),
      async signIn(email) { await a.post('/api/auth/code', { email }); return a.post('/api/auth/verify', { email, code: codeFor(email) }) },
      me: async () => (await a.get('/api/me')).body,
    }
    return a
  }
  const admin = agent(), bob = agent(), carol = agent(), dave = agent(), eve = agent(), frank = agent(), anon = agent()
  let sw = null
  const ids = {}

  beforeAll(async () => {
    ;({ db, dir } = await freshDb(pgCfg))
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    base = `http://127.0.0.1:${server.address().port}`
    // адміністратор — перший, лідер Sandwalkers; Боб — офіцер, Керол — учасниця, Дейв — новобранець; Єва й Френк — сторонні
    sw = (await admin.signIn('admin@example.com')).body.guild
    const code = (await admin.post('/api/guilds/sandwalkers/invites', { days: 7, uses: 0 })).body.code
    for (const [a, e] of [[bob, 'bob@example.com'], [carol, 'carol@example.com'], [dave, 'dave@example.com'], [eve, 'eve@example.com'], [frank, 'frank@example.com']]) {
      await a.signIn(e)
      ids[e.split('@')[0]] = (await a.me()).user.id
    }
    for (const a of [bob, carol, dave]) expect((await a.post(`/api/invites/${code}/accept`)).status).toBe(200)
    expect((await admin.patch(`/api/guilds/sandwalkers/members/${ids.bob}`, { role: 'officer' })).status).toBe(200)
    expect((await admin.patch(`/api/guilds/sandwalkers/members/${ids.dave}`, { role: 'recruit' })).status).toBe(200)
    // Френк — модератор сайту
    await db.run("UPDATE users SET role = 'moderator' WHERE id = ?", ids.frank)
  })
  afterAll(async () => {
    server?.close()
    await app?.locals.close()
    await db?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  /** новий роадмап із тестовим документом */
  async function make(a, owner, visibility) {
    const r = await a.post('/api/roadmaps', { title: 'Тест', owner, visibility })
    expect(r.status).toBe(201)
    const put = await a.put(`/api/roadmaps/${r.body.id}`, { doc: DOC, version: r.body.version })
    expect(put.status).toBe(200)
    return r.body.id
  }
  const mark = (a, id, kind, item, value, extra = {}) => a.post(`/api/roadmaps/${id}/progress`, { kind, id: item, value, ...extra })

  describe('особистий', () => {
    let rid
    it('власник відмічає свій прогрес; сміття й хибні значення — відмова', async () => {
      rid = await make(eve)
      const g = await eve.get(`/api/roadmaps/${rid}`)
      expect(g.body.progress).toMatchObject({ mode: 'owner', whose: 'mine', scope: `u:${ids.eve}` })
      expect(g.body.rights).toMatchObject({ mark: true, edit: true, settings: true })
      expect((await mark(eve, rid, 's', 's1', 'done')).body.state.s).toEqual({ s1: 'done' })
      expect((await mark(eve, rid, 't', 't1', true)).body.state.t).toEqual({ t1: true })
      expect((await mark(eve, rid, 's', 'nope', 'done')).status).toBe(404)
      expect((await mark(eve, rid, 's', 's1', 'finished')).status).toBe(400)
      expect((await mark(eve, rid, 'x', 's1', true)).status).toBe(400)
      // статус у документі більше не живе: прогрес — окремо, документ без status/done
      expect((await eve.get(`/api/roadmaps/${rid}`)).body.doc.stages[0].status).toBeUndefined()
    })
    it('поки особисте — права не міняються (вибору нема), чужим 404; відкрили — бачать прогрес власника лише для перегляду', async () => {
      const own = (await eve.get(`/api/roadmaps/${rid}`)).body
      expect(Object.values(own.levels).every((l) => l.length === 0)).toBe(true)
      expect((await eve.patch(`/api/roadmaps/${rid}/access-settings`, { mark: 'users' })).status).toBe(400)
      expect((await carol.get(`/api/roadmaps/${rid}`)).status).toBe(404)
      expect((await mark(carol, rid, 's', 's1', 'todo')).status).toBe(404)
      expect((await eve.patch(`/api/items/roadmap/${rid}/access`, { visibility: 'public' })).status).toBe(200)
      const c = (await carol.get(`/api/roadmaps/${rid}`)).body
      expect(c.progress).toMatchObject({ whose: 'owner', state: { s: { s1: 'done' } } })
      expect(c.rights).toMatchObject({ mark: false, edit: false, settings: false, copy: true })
      expect(c.access).toBeUndefined() // налаштування — лише тим, хто їх міняє
      expect((await mark(carol, rid, 's', 's1', 'todo')).status).toBe(403)
      expect((await carol.put(`/api/roadmaps/${rid}`, { doc: DOC, version: 2 })).status).toBe(403)
      expect((await carol.patch(`/api/roadmaps/${rid}/access-settings`, { mark: 'users' })).status).toBe(403)
      const a = (await anon.get(`/api/roadmaps/${rid}`)).body
      expect(a.progress.state.s).toEqual({ s1: 'done' })
      expect(a.rights).toMatchObject({ mark: false, copy: false })
      expect((await mark(anon, rid, 's', 's1', 'todo')).status).toBe(401)
    })
    it('«у кожного свій»: кожен веде свій запис, чужого не бачить; у списку — свій прогрес', async () => {
      expect((await eve.patch(`/api/roadmaps/${rid}/access-settings`, { progress: 'each', mark: 'users' })).status).toBe(200)
      expect((await mark(carol, rid, 's', 's2', 'done')).body.state.s).toEqual({ s2: 'done' })
      expect((await eve.get(`/api/roadmaps/${rid}`)).body.progress).toMatchObject({ whose: 'mine', state: { s: { s1: 'done' } }, people: 2 })
      expect((await carol.get(`/api/roadmaps/${rid}`)).body.progress.state.s).toEqual({ s2: 'done' })
      // анонім у «кожен свій» прогресу не має й не відмічає
      expect((await anon.get(`/api/roadmaps/${rid}`)).body.progress).toMatchObject({ scope: null, whose: 'none' })
      // scope з запиту ігнорується: Керол не запише в запис Єви
      await mark(carol, rid, 't', 't1', true, { scope: `u:${ids.eve}` })
      expect((await eve.get(`/api/roadmaps/${rid}`)).body.progress.state.t).toEqual({ t1: true })
      expect((await carol.get(`/api/roadmaps/${rid}`)).body.progress.state.t).toEqual({ t1: true })
      const lib = (await carol.get('/api/library?kind=roadmap')).body.rows.find((r) => r.id === rid)
      expect(lib.summary).toBe('2 етапи, виконано 1')
      // Єва не бачить «Прогрес учасників» сторонніх — лише загальне число
      const m = (await eve.get(`/api/roadmaps/${rid}/progress/members`)).body
      expect(m.people.map((p) => p.id)).toEqual([ids.eve])
      expect(m.others).toBe(1)
      expect((await carol.get(`/api/roadmaps/${rid}/progress/members`)).status).toBe(403)
    })
    it('рівні, яких в особистого нема, — 400; «ніхто не відмічає» — і власник не відмічає', async () => {
      expect((await eve.patch(`/api/roadmaps/${rid}/access-settings`, { edit: 'officer' })).status).toBe(400)
      expect((await eve.patch(`/api/roadmaps/${rid}/access-settings`, { edit: 'anyone' })).status).toBe(400)
      expect((await eve.patch(`/api/roadmaps/${rid}/access-settings`, { mark: 'nobody' })).status).toBe(200)
      expect((await mark(eve, rid, 's', 's2', 'done')).status).toBe(403)
      expect((await mark(carol, rid, 's', 's1', 'done')).status).toBe(403)
      // прогрес не зник — лише перегляд
      expect((await carol.get(`/api/roadmaps/${rid}`)).body.progress.state.s).toEqual({ s2: 'done' })
    })
    it('копіювати: «ніхто» — 403; лише в особисте — у гільдію 403; з позначками — у запис власника копії', async () => {
      expect((await eve.patch(`/api/roadmaps/${rid}/access-settings`, { copy: 'nobody' })).status).toBe(200)
      expect((await carol.post(`/api/items/roadmap/${rid}/copy`, {})).status).toBe(403)
      expect((await eve.patch(`/api/roadmaps/${rid}/access-settings`, { copy: 'users', copyTo: ['user'] })).status).toBe(200)
      expect((await carol.post(`/api/items/roadmap/${rid}/copy`, { owner: { kind: 'guild', id: sw.id } })).status).toBe(403)
      const cp = await carol.post(`/api/items/roadmap/${rid}/copy`, { progress: true })
      expect(cp.status).toBe(201)
      const mine = (await carol.get(`/api/roadmaps/${cp.body.item.id}`)).body
      expect(mine.progress).toMatchObject({ mode: 'owner', whose: 'mine', state: { s: { s2: 'done' }, t: { t1: true } } })
      expect(mine.rights.mark).toBe(true)
      expect((await anon.post(`/api/items/roadmap/${rid}/copy`, {})).status).toBe(401)
    })
    it('історія: «лише власник» — стороннім 403', async () => {
      expect((await carol.get(`/api/roadmaps/${rid}/history`)).status).toBe(200)
      expect((await eve.patch(`/api/roadmaps/${rid}/access-settings`, { history: 'owner' })).status).toBe(200)
      expect((await carol.get(`/api/roadmaps/${rid}/history`)).status).toBe(403)
      expect((await anon.get(`/api/roadmaps/${rid}/history`)).status).toBe(403)
      expect((await eve.get(`/api/roadmaps/${rid}/history`)).status).toBe(200)
    })
    it('вікі-режим: редагувати можуть усі, хто увійшов (анонім — ні)', async () => {
      expect((await eve.patch(`/api/roadmaps/${rid}/access-settings`, { edit: 'users' })).status).toBe(200)
      const v = (await carol.get(`/api/roadmaps/${rid}`)).body.version
      expect((await carol.put(`/api/roadmaps/${rid}`, { doc: { ...DOC, title: 'Від Керол' }, version: v })).status).toBe(200)
      expect((await anon.put(`/api/roadmaps/${rid}`, { doc: DOC, version: v + 1 })).status).toBe(401)
    })
  })

  describe('гільдійський', () => {
    let rid
    const GUILD = () => ({ kind: 'guild', id: sw.id })
    it('типові: новобранець дивиться, учасник відмічає й редагує, але не міняє права', async () => {
      rid = await make(carol, GUILD())
      expect((await dave.get(`/api/roadmaps/${rid}`)).body.progress).toMatchObject({ whose: 'guild', scope: `g:${sw.id}` })
      expect((await mark(dave, rid, 's', 's1', 'doing')).status).toBe(403)
      const v = (await dave.get(`/api/roadmaps/${rid}`)).body.version
      expect((await dave.put(`/api/roadmaps/${rid}`, { doc: DOC, version: v })).status).toBe(403)
      expect((await mark(carol, rid, 's', 's1', 'doing')).status).toBe(200)
      expect((await carol.patch(`/api/roadmaps/${rid}/access-settings`, { mark: 'recruit' })).status).toBe(403)
      // гільдійська видимість — лише ранги: «усі, хто увійшов» і «спільний на всіх» тут не дають
      expect((await bob.patch(`/api/roadmaps/${rid}/access-settings`, { mark: 'users' })).status).toBe(400)
      expect((await bob.patch(`/api/roadmaps/${rid}/access-settings`, { progress: 'all' })).status).toBe(400)
      expect((await bob.get(`/api/roadmaps/${rid}`)).body).toMatchObject({ modes: ['owner', 'each'], levels: { mark: ['nobody', 'owner', 'officer', 'member', 'recruit'] } })
      // гільдійський — стороннім 404
      expect((await eve.get(`/api/roadmaps/${rid}`)).status).toBe(404)
      // спільний гільдії: позначку Керол бачить і Дейв
      expect((await dave.get(`/api/roadmaps/${rid}`)).body.progress.state.s).toEqual({ s1: 'doing' })
    })
    it('офіцер дає відмічати новобранцям; «хто міняє права» — лише лідер', async () => {
      expect((await bob.patch(`/api/roadmaps/${rid}/access-settings`, { mark: 'recruit' })).status).toBe(200)
      expect((await mark(dave, rid, 'c', 'c1', true)).status).toBe(200)
      expect((await bob.patch(`/api/roadmaps/${rid}/access-settings`, { settings: 'owner' })).status).toBe(403)
      expect((await admin.patch(`/api/roadmaps/${rid}/access-settings`, { settings: 'owner' })).status).toBe(200)
      expect((await bob.patch(`/api/roadmaps/${rid}/access-settings`, { mark: 'member' })).status).toBe(403)
      expect((await bob.get(`/api/roadmaps/${rid}`)).body.rights.settings).toBe(false)
    })
    it('«редагують лише офіцери»: учасник не змінює зміст, але відмічає', async () => {
      expect((await admin.patch(`/api/roadmaps/${rid}/access-settings`, { edit: 'officer' })).status).toBe(200)
      const v = (await carol.get(`/api/roadmaps/${rid}`)).body.version
      expect((await carol.put(`/api/roadmaps/${rid}`, { doc: DOC, version: v })).status).toBe(403)
      expect((await carol.post(`/api/roadmaps/${rid}/history/1/restore`)).status).toBe(403)
      expect((await mark(carol, rid, 's', 's2', 'done')).status).toBe(200)
      expect((await bob.put(`/api/roadmaps/${rid}`, { doc: DOC, version: v })).status).toBe(200)
    })
    it('публічний: сторонній бачить прогрес гільдії, але не пише в нього; «бачать лише учасники» — без стану', async () => {
      expect((await admin.patch(`/api/items/roadmap/${rid}/access`, { visibility: 'public' })).status).toBe(200)
      const e = (await eve.get(`/api/roadmaps/${rid}`)).body
      expect(e.progress).toMatchObject({ whose: 'guild', state: { s: { s1: 'doing', s2: 'done' } } })
      expect((await mark(eve, rid, 's', 's1', 'done')).status).toBe(403)
      expect((await admin.patch(`/api/roadmaps/${rid}/access-settings`, { seeProgress: 'member' })).status).toBe(200)
      const e2 = (await eve.get(`/api/roadmaps/${rid}`)).body
      expect(e2.progress).toMatchObject({ scope: null, state: { s: {}, t: {}, c: {} } })
      // новобранець тепер не бачить спільного — і не відмічає, хоч «відмічати» йому дано
      expect((await mark(dave, rid, 'c', 'c2', true)).status).toBe(403)
      expect((await anon.get(`/api/library?kind=roadmap`)).body.rows.find((r) => r.id === rid).summary).toBe('2 етапи, виконано 0')
      expect((await carol.get(`/api/roadmaps`)).body.rows.find((r) => r.id === rid).summary).toBe('2 етапи, виконано 1')
      expect((await admin.patch(`/api/roadmaps/${rid}/access-settings`, { seeProgress: 'anyone' })).status).toBe(200)
    })
    it('«у кожного свій» + прогрес учасників: видно гільдії, стороннім — ні; сторонні — лише числом', async () => {
      expect((await admin.patch(`/api/roadmaps/${rid}/access-settings`, { progress: 'each', mark: 'users' })).status).toBe(200)
      expect((await mark(carol, rid, 'c', 'c1', true)).status).toBe(200)
      expect((await mark(eve, rid, 'c', 'c2', true)).status).toBe(200)
      const m = await dave.get(`/api/roadmaps/${rid}/progress/members`)
      expect(m.status).toBe(200)
      expect(m.body.people.find((p) => p.id === ids.carol).state.c).toEqual({ c1: true })
      expect(m.body.people.some((p) => p.id === ids.eve)).toBe(false)
      expect(m.body.others).toBe(1)
      expect((await eve.get(`/api/roadmaps/${rid}/progress/members`)).status).toBe(403)
      // спільний гільдії не зник — повернули режим, він на місці
      expect((await admin.patch(`/api/roadmaps/${rid}/access-settings`, { progress: 'owner' })).status).toBe(200)
      expect((await dave.get(`/api/roadmaps/${rid}`)).body.progress.state.s).toEqual({ s1: 'doing', s2: 'done' })
    })
    it('«спільний на всіх»: двоє людей — один запис; скинути — модератор так, учасник ні; «Повернути»', async () => {
      expect((await admin.patch(`/api/roadmaps/${rid}/access-settings`, { progress: 'all', mark: 'users' })).status).toBe(200)
      await mark(eve, rid, 's', 's1', 'done')
      await mark(carol, rid, 't', 't1', true)
      expect((await anon.get(`/api/roadmaps/${rid}`)).body.progress).toMatchObject({ whose: 'all', state: { s: { s1: 'done' }, t: { t1: true } }, people: 2 })
      expect((await mark(anon, rid, 's', 's2', 'done')).status).toBe(401)
      expect((await carol.del(`/api/roadmaps/${rid}/progress?which=shared`)).status).toBe(403)
      const reset = await frank.del(`/api/roadmaps/${rid}/progress?which=shared`)
      expect(reset.status).toBe(200)
      expect(reset.body.state.s).toEqual({})
      expect((await carol.post(`/api/roadmaps/${rid}/progress/restore`, { which: 'shared', state: reset.body.before })).status).toBe(403)
      expect((await admin.post(`/api/roadmaps/${rid}/progress/restore`, { which: 'shared', state: reset.body.before })).body.state).toMatchObject({ s: { s1: 'done' }, t: { t1: true } })
      const log = await admin.get(`/api/roadmaps/${rid}/progress/members`)
      expect(log.body.log.length).toBeGreaterThanOrEqual(2)
    })
    it('копіювати в гільдію — лише якщо дозволено й ти в ній щонайменше учасник', async () => {
      expect((await dave.post(`/api/items/roadmap/${rid}/copy`, { owner: GUILD() })).status).toBe(403) // новобранець
      expect((await carol.post(`/api/items/roadmap/${rid}/copy`, { owner: GUILD() })).status).toBe(201)
    })
  })

  describe('бази, білди, розрахунки, ресурси — ті самі права', () => {
    const GUILD = () => ({ kind: 'guild', id: sw.id })
    const BASE = (name) => ({ format: 2, claims: [{ x: -5, y: 0, w: 10, d: 10 }], pieces: [{ id: 'p1', shape: 'foundation', x: 0.5, y: 0.5, z: 0, rot: 0 }], items: [], zones: [], levels: [{ key: 'g', name: 'Рівень 0', sub: '', z0: 0, z1: 1 }, { key: 'r', name: 'Дах', sub: '', z0: 1, z1: 99 }], heights: {}, ui: { name, lead: '', facts: [] } })
    const putBase = async (a, id) => a.put(`/api/bases/${id}`, { doc: (await a.get(`/api/bases/${id}`)).body.doc, version: (await a.get(`/api/bases/${id}`)).body.version })
    let bid
    it('база гільдії: типово змінює учасник; «лише офіцери» — учасник 403, офіцер 200; права міняє офіцер, не учасник', async () => {
      bid = (await carol.post('/api/bases', { doc: BASE('Гільдійська'), owner: GUILD() })).body.id
      expect((await putBase(dave, bid)).status).toBe(403)
      expect((await putBase(carol, bid)).status).toBe(200)
      const g = (await bob.get(`/api/items/base/${bid}`)).body
      expect(g.keys).toEqual(['edit', 'copy', 'history', 'settings'])
      expect(g.levels.edit).toEqual(['nobody', 'owner', 'officer', 'member', 'recruit'])
      expect(g.rights).toMatchObject({ edit: true, settings: true, mark: false })
      expect((await carol.patch(`/api/items/base/${bid}/rights`, { edit: 'officer' })).status).toBe(403)
      expect((await bob.patch(`/api/items/base/${bid}/rights`, { edit: 'officer' })).status).toBe(200)
      expect((await putBase(carol, bid)).status).toBe(403)
      expect((await carol.get(`/api/bases/${bid}`)).body.item.can.edit).toBe(false)
      expect((await putBase(bob, bid)).status).toBe(200)
      // у бази нема прогресу; «усі, хто увійшов» за гільдійської видимості нема
      expect((await bob.patch(`/api/items/base/${bid}/rights`, { mark: 'users' })).status).toBe(400)
      expect((await bob.patch(`/api/items/base/${bid}/rights`, { edit: 'users' })).status).toBe(400)
    })
    it('історія бази — окреме право: типово учасники (як і змінювати); «лише офіцери» — учасникові 403', async () => {
      expect((await carol.get(`/api/bases/${bid}/history`)).status).toBe(200)
      expect((await dave.get(`/api/bases/${bid}/history`)).status).toBe(403)
      expect((await bob.patch(`/api/items/base/${bid}/rights`, { history: 'officer' })).status).toBe(200)
      expect((await carol.get(`/api/bases/${bid}/history`)).status).toBe(403)
      expect((await bob.get(`/api/bases/${bid}/history`)).status).toBe(200)
    })
    it('копія бази: «ніхто» — 403 обома шляхами; лише в гільдію — особиста копія 403', async () => {
      expect((await admin.patch(`/api/items/base/${bid}/access`, { visibility: 'public' })).status).toBe(200)
      expect((await bob.patch(`/api/items/base/${bid}/rights`, { copy: 'nobody' })).status).toBe(200)
      expect((await eve.post('/api/bases', { from: bid, name: 'x' })).status).toBe(403)
      expect((await eve.post(`/api/items/base/${bid}/copy`, {})).status).toBe(403)
      expect((await bob.patch(`/api/items/base/${bid}/rights`, { copy: 'users', copyTo: ['guild'] })).status).toBe(200)
      expect((await eve.post('/api/bases', { from: bid, name: 'x' })).status).toBe(403)
      expect((await carol.post('/api/bases', { from: bid, name: 'y', owner: GUILD() })).status).toBe(201)
    })
    it('вивантаження бази (файл = копія): без входу 401; копіювати не дозволено — 403 (власникові — можна); дозволено — 200', async () => {
      const exp = (a) => a.get(`/api/bases/${bid}/export`)
      expect((await exp(anon)).status).toBe(401)
      expect((await bob.patch(`/api/items/base/${bid}/rights`, { copy: 'nobody', copyTo: ['user', 'guild'] })).status).toBe(200)
      expect((await exp(eve)).status).toBe(403)
      expect((await exp(bob)).status).toBe(200) // офіцер гільдії-власниці керує базою — своє вивантажити може
      expect((await bob.patch(`/api/items/base/${bid}/rights`, { copy: 'users' })).status).toBe(200)
      expect((await exp(eve)).status).toBe(200)
    })
    it('копія: «Назва (копія)», далі «(копія 2)»; копія копії не нарощує хвіст', async () => {
      const b = (await frank.post('/api/builds', { name: 'Мечник', code: '3abc', notes: '', visibility: 'public' })).body
      const c1 = (await carol.post(`/api/items/build/${b.id}/copy`, {})).body
      const c2 = (await carol.post(`/api/items/build/${b.id}/copy`, {})).body
      expect([c1.title ?? c1.item?.title, c2.title ?? c2.item?.title]).toEqual(['Мечник (копія)', 'Мечник (копія 2)'])
      expect((await carol.patch(`/api/items/build/${c1.id ?? c1.item.id}/access`, { visibility: 'public' })).status).toBe(200)
      const c3 = (await eve.post(`/api/items/build/${c1.id ?? c1.item.id}/copy`, {})).body
      expect(c3.title ?? c3.item?.title).toBe('Мечник (копія)')
    })
    it('білд людини: типово лише власник; вікі-режим — змінює кожен, хто увійшов; права білду без історії', async () => {
      const b = (await frank.post('/api/builds', { name: 'Білд', code: '3abc', notes: '', visibility: 'public' })).body
      const put = (a) => a.put(`/api/builds/${b.id}`, { name: 'Білд 2', code: '3abc', notes: '' })
      expect((await put(carol)).status).toBe(403)
      expect((await frank.patch(`/api/items/build/${b.id}/rights`, { history: 'owner' })).status).toBe(400)
      expect((await frank.patch(`/api/items/build/${b.id}/rights`, { edit: 'users' })).status).toBe(200)
      expect((await put(carol)).status).toBe(200)
      expect((await put(anon)).status).toBe(401)
      expect((await carol.patch(`/api/items/build/${b.id}/rights`, { edit: 'owner' })).status).toBe(403)
    })
    it('ресурс гільдії: новобранець змінює, лише коли дали; особисте — права не міняються', async () => {
      const p = (await carol.post('/api/places', { res: 'Титан', place: 'Скелі', owner: GUILD() })).body
      expect((await dave.patch(`/api/places/${p.id}`, { place: 'Печера' })).status).toBe(403)
      expect((await bob.patch(`/api/items/place/${p.id}/rights`, { edit: 'recruit' })).status).toBe(200)
      expect((await dave.patch(`/api/places/${p.id}`, { place: 'Печера' })).status).toBe(200)
      // ресурс не копіюють
      expect((await carol.post(`/api/items/place/${p.id}/copy`, {})).status).toBe(403)
      const mine = (await carol.post('/api/places', { res: 'Сталь', place: 'Дім' })).body
      expect((await carol.patch(`/api/items/place/${mine.id}/rights`, { edit: 'users' })).status).toBe(400)
    })
    it('розрахунок гільдії → людині: права звужуються до допустимих для людини', async () => {
      const c = (await carol.post('/api/calcs', { name: 'Розрахунок', code: 'abc', owner: GUILD() })).body
      expect(c.id).toBeTruthy()
      expect((await bob.patch(`/api/items/calc/${c.id}/rights`, { edit: 'recruit', copy: 'officer' })).status).toBe(200)
      // кнопка «Копіювати» знає, чи можна: учасниці — ні (лише офіцери), офіцеру — так
      expect((await carol.get(`/api/calcs/${c.id}`)).body.item.can).toMatchObject({ edit: true, copy: false })
      expect((await bob.get(`/api/calcs/${c.id}`)).body.item.can).toMatchObject({ copy: true, copyTo: ['user', 'guild'] })
      expect((await carol.post(`/api/items/calc/${c.id}/copy`, {})).status).toBe(403)
      expect((await admin.patch(`/api/items/calc/${c.id}/access`, { owner: { kind: 'user', id: ids.carol } })).status).toBe(200)
      expect((await carol.get(`/api/items/calc/${c.id}`)).body.access).toMatchObject({ edit: 'owner', copy: 'owner' })
    })
  })

  describe('передача, видалення, давні статуси', () => {
    it('особистий → гільдії: прогрес власника їде з ним, права — допустимі для гільдії', async () => {
      const rid = await make(admin)
      await mark(admin, rid, 's', 's1', 'done')
      expect((await admin.patch(`/api/items/roadmap/${rid}/access`, { owner: { kind: 'guild', id: sw.id } })).status).toBe(200)
      const c = (await carol.get(`/api/roadmaps/${rid}`)).body
      expect(c.progress).toMatchObject({ whose: 'guild', state: { s: { s1: 'done' } } })
      // прав не міняли — діють типові гільдійські: учасниця відмічає
      expect(c.rights.mark).toBe(true)
      expect(Number((await db.get('SELECT COUNT(*) AS n FROM roadmap_marks WHERE roadmap_id = ? AND scope = ?', rid, `u:${ids.admin}`)).n)).toBe(0)
    })
    it('змінені права при передачі лишаються, а рівні, яких новий власник не має, звужуються', async () => {
      const rid = await make(carol, { kind: 'guild', id: sw.id })
      expect((await bob.patch(`/api/roadmaps/${rid}/access-settings`, { mark: 'officer', edit: 'recruit', history: 'member' })).status).toBe(200)
      expect((await admin.patch(`/api/items/roadmap/${rid}/access`, { owner: { kind: 'user', id: ids.admin } })).status).toBe(200)
      const a = (await admin.get(`/api/roadmaps/${rid}`)).body.access
      expect(a).toMatchObject({ mark: 'owner', edit: 'owner', history: 'owner', settings: 'owner' })
    })
    it('видалення роадмапу стирає весь його прогрес', async () => {
      const rid = await make(eve)
      await mark(eve, rid, 's', 's1', 'done')
      expect((await eve.del(`/api/roadmaps/${rid}`)).status).toBe(200)
      expect(Number((await db.get('SELECT COUNT(*) AS n FROM roadmap_marks WHERE roadmap_id = ?', rid)).n)).toBe(0)
    })
    it('давні статуси з документа переносяться в запис власника раз; картки «зібрано» → у кожного свій', async () => {
      const rid = await make(carol, { kind: 'guild', id: sw.id })
      const old = { ...DOC, stages: [{ id: 's1', title: 'A', status: 'done', tasks: [{ id: 't1', text: 'x', done: true }] }, { id: 's2', title: 'B', status: 'doing', tasks: [] }] }
      await db.run('UPDATE roadmaps SET doc = ? WHERE id = ?', JSON.stringify(old), rid)
      await db.run("UPDATE items SET access = NULL WHERE kind = 'roadmap' AND id = ?", rid)
      await db.run("DELETE FROM settings WHERE k = 'roadmapProgressMigrated'")
      for (let i = 0; i < 2; i++) {
        const again = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async () => {} }, log: { info() {}, warn() {}, error() {} } })
        await again.locals.close()
        await db.run("DELETE FROM settings WHERE k = 'roadmapProgressMigrated'")
      }
      const rows = await db.all('SELECT kind, item, value FROM roadmap_marks WHERE roadmap_id = ? AND scope = ? ORDER BY kind, item', rid, `g:${sw.id}`)
      expect(rows).toEqual([{ kind: 's', item: 's1', value: 'done' }, { kind: 's', item: 's2', value: 'doing' }, { kind: 't', item: 't1', value: '1' }])
      expect(JSON.parse((await db.get("SELECT access FROM items WHERE kind = 'roadmap' AND id = ?", rid)).access)).toMatchObject({ progress: 'each', mark: 'users' })
    })
    it('давній роадмап сайту з етапами: прогрес власника, відмічають лише автори сайту (як і міняли статуси)', async () => {
      const rid = await make(admin, { kind: 'site', id: 'site' }, 'public')
      await db.run('UPDATE roadmaps SET doc = ? WHERE id = ?', JSON.stringify({ ...DOC, sections: [], stages: [{ id: 's1', title: 'A', status: 'done', tasks: [] }] }), rid)
      await db.run("UPDATE items SET access = NULL WHERE kind = 'roadmap' AND id = ?", rid)
      await db.run("DELETE FROM settings WHERE k = 'roadmapProgressMigrated'")
      const again = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async () => {} }, log: { info() {}, warn() {}, error() {} } })
      await again.locals.close()
      expect(JSON.parse((await db.get("SELECT access FROM items WHERE kind = 'roadmap' AND id = ?", rid)).access)).toMatchObject({ progress: 'owner', mark: 'owner' })
      const c = (await carol.get(`/api/roadmaps/${rid}`)).body
      expect(c.progress).toMatchObject({ whose: 'site', state: { s: { s1: 'done' } } })
      expect((await mark(carol, rid, 's', 's1', 'todo')).status).toBe(403)
    })
    it('людину видалено: її особистий прогрес стерто, у спільних і журналі вона безіменна', async () => {
      const n = async (sql, ...a) => Number((await db.get(sql, ...a)).n)
      expect(await n('SELECT COUNT(*) AS n FROM roadmap_marks WHERE scope = ?', `u:${ids.eve}`)).toBeGreaterThan(0)
      expect(await n('SELECT COUNT(*) AS n FROM roadmap_marks_log WHERE actor = ?', ids.eve)).toBeGreaterThan(0)
      expect((await admin.post('/api/admin/r/users/delete', { ids: [ids.eve] })).status).toBe(200)
      expect(await n('SELECT COUNT(*) AS n FROM roadmap_marks WHERE scope = ?', `u:${ids.eve}`)).toBe(0)
      expect(await n('SELECT COUNT(*) AS n FROM roadmap_marks WHERE by_user = ?', ids.eve)).toBe(0)
      expect(await n('SELECT COUNT(*) AS n FROM roadmap_marks_log WHERE actor = ?', ids.eve)).toBe(0)
    })
  })
})

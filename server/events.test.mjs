// Події спільноти через справжній HTTP: створення й перевірка документа, видимість (публічна, особиста, гільдійська),
// реєстрація команд (місця, резерв, підтвердження організатором, одна команда на людину), приєднання кодом, глядачі,
// сітка й результати, календар, видалення. Двічі: на запасній SQLite і на Postgres dune_testing (якщо є .env і база
// відповідає) — у власній схемі, щоб не заважати app.test.mjs.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'

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

/** чиста база: SQLite — у тимчасовій теці; Postgres — у власній схемі */
async function freshDb(pgCfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-events-'))
  if (!pgCfg) return { db: await openDb({ dataDir: dir }), dir }
  const schema = `ev_${crypto.randomBytes(4).toString('hex')}`
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

const HOUR = 3600_000
const ids = (rows) => rows.map((x) => x.id)

describe.each(ENGINES)('%s', (_name, pgCfg) => {
  let server, base, dir, app, db
  const mail = []
  const codeFor = (email) => [...mail].reverse().find((m) => m.to === email.trim().toLowerCase())?.text.match(/\b\d{6}\b/)?.[0]

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
      const text = await r.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* не JSON (календар) */ }
      return { status: r.status, body: json, text, type: r.headers.get('content-type') }
    }
    const a = {
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      put: (u, b) => call('PUT', u, b),
      patch: (u, b) => call('PATCH', u, b),
      del: (u, b) => call('DELETE', u, b),
      async signIn(email) {
        await a.post('/api/auth/code', { email })
        return a.post('/api/auth/verify', { email, code: codeFor(email) })
      },
    }
    return a
  }

  beforeAll(async () => {
    ;({ db, dir } = await freshDb(pgCfg))
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

  const admin = agent(), bob = agent(), eve = agent(), carol = agent(), dave = agent(), frank = agent(), grace = agent(), anon = agent()
  /** бій 2 на 2: на два місця, без підтвердження; арена й зона глядачів — на мапі Хагги */
  const duel = (extra = {}) => ({
    title: 'Бій 2 на 2 біля Арракіна', type: 'pvp', starts: Date.now() + 48 * HOUR, duration: 90, region: 'eu', server: 'Hagga 12',
    place: 'Скелі на схід від Арракіна', arena: { map: 'survival_1', x: 1000, y: -2000 }, watch: { map: 'survival_1', x: 1200, y: -2100 },
    watchNote: 'PvE-зона на скелі — звідти видно арену', reg: { open: true, teamSize: 2, slots: 2, approval: false },
    prizes: [{ label: '1 місце', prize: '50 000 соларів' }, { label: '2 місце', prize: '20 000 соларів' }, { label: '', prize: '' }],
    about: 'Без **Т6** зброї.', visibility: 'public', ...extra,
  })
  let ev = null
  const teams = {}

  it('вхід: адміністратор (перший), організатор і гравці', async () => {
    expect((await admin.signIn('admin@example.com')).status).toBe(201)
    for (const [a, email] of [[bob, 'bob@example.com'], [eve, 'eve@example.com'], [carol, 'carol@example.com'], [dave, 'dave@example.com'], [frank, 'frank@example.com'], [grace, 'grace@example.com']]) {
      expect((await a.signIn(email)).status).toBe(201)
    }
    // нік у грі — ним Френк займе своє місце в команді
    expect((await frank.patch('/api/me', { nick: 'Stilgar' })).status).toBe(200)
  })

  describe('подія', () => {
    it('створення: перевірка полів; без входу — 401; минула — 400; хибна точка чи http-трансляція — 400', async () => {
      expect((await anon.post('/api/events', duel())).status).toBe(401)
      expect((await bob.post('/api/events', duel({ title: 'x' }))).status).toBe(400)
      expect((await bob.post('/api/events', duel({ starts: Date.now() - 10 * HOUR }))).status).toBe(400)
      expect((await bob.post('/api/events', duel({ arena: { map: 'survival_1', x: 9e9, y: 0 } }))).status).toBe(400)
      expect((await bob.post('/api/events', duel({ stream: 'http://twitch.tv/x' }))).status).toBe(400)
      expect((await bob.post('/api/events', duel({ reg: { open: true, teamSize: 2, closes: Date.now() + 100 * HOUR } }))).status).toBe(400)
      const r = await bob.post('/api/events', duel({ stream: 'https://twitch.tv/sandwalkers' }))
      expect(r.status).toBe(201)
      ev = r.body
      expect(ev).toMatchObject({ title: 'Бій 2 на 2 біля Арракіна', type: 'pvp', duration: 90, regState: 'open', teams: [], rights: { edit: true, manage: true } })
      expect(ev.reg).toMatchObject({ teamSize: 2, slots: 2, approval: false, closes: null })
      // порожній приз — геть; точки — округлені й з мапою
      expect(ev.prizes).toHaveLength(2)
      expect(ev.arena).toEqual({ map: 'survival_1', x: 1000, y: -2000 })
      expect(ev.ends).toBe(ev.starts + 90 * 60_000)
      expect(ev.item).toMatchObject({ kind: 'event', visibility: 'public', owner: { kind: 'user' }, title: ev.title })
    })

    it('публічну бачать усі, і без входу; у списку «найближчі» — з лічильниками; календар .ics', async () => {
      const one = await anon.get(`/api/events/${ev.id}`)
      expect(one.status).toBe(200)
      expect(one.body.rights).toEqual({ edit: false, manage: false })
      const list = await anon.get('/api/events')
      expect(ids(list.body.rows)).toContain(ev.id)
      const row = list.body.rows.find((x) => x.id === ev.id)
      expect(row).toMatchObject({ counts: { confirmed: 0, watchers: 0 }, regState: 'open' })
      // у списку — без довгих текстів
      expect(row.about).toBeUndefined()
      expect(ids((await anon.get('/api/events?when=past')).body.rows)).not.toContain(ev.id)
      expect(ids((await anon.get('/api/events?type=race')).body.rows)).not.toContain(ev.id)
      expect(ids((await anon.get('/api/events?type=pvp&region=eu')).body.rows)).toContain(ev.id)
      const ics = await anon.get(`/api/events/${ev.id}/calendar.ics`)
      expect(ics.status).toBe(200)
      expect(ics.type).toMatch(/text\/calendar/)
      expect(ics.text).toMatch(/BEGIN:VEVENT[\s\S]*SUMMARY:Бій 2 на 2 біля Арракіна[\s\S]*TRIGGER:-PT30M/)
      expect(ics.text).toContain(`UID:${ev.id}@`)
    })

    it('особиста — лише власнику (іншим 404 і не в списку); гільдійська — учасникам гільдії', async () => {
      const mine = await eve.post('/api/events', duel({ title: 'Тренування Єви', visibility: 'private' }))
      expect(mine.status).toBe(201)
      expect(mine.body.item.visibility).toBe('private')
      expect((await bob.get(`/api/events/${mine.body.id}`)).status).toBe(404)
      expect(ids((await bob.get('/api/events')).body.rows)).not.toContain(mine.body.id)
      expect(ids((await eve.get('/api/events?scope=mine')).body.rows)).toContain(mine.body.id)
      const me = (await admin.get('/api/me')).body
      const g = await admin.post('/api/events', duel({ title: 'Збір гільдії', type: 'meet', owner: { kind: 'guild', id: me.guild.id }, visibility: 'guild' }))
      expect(g.status).toBe(201)
      expect(g.body.item.owner).toMatchObject({ kind: 'guild' })
      expect((await bob.get(`/api/events/${g.body.id}`)).status).toBe(404)
      expect(ids((await bob.get(`/api/events?scope=guild&guild=${me.guild.id}`)).body.rows)).not.toContain(g.body.id)
      expect(ids((await admin.get('/api/events?scope=guild')).body.rows)).toContain(g.body.id)
      // і чужа людина не створить подію від гільдії
      expect((await bob.post('/api/events', duel({ owner: { kind: 'guild', id: me.guild.id } }))).status).toBe(403)
    })
  })

  describe('реєстрація', () => {
    it('команда капітана: перший гравець — він; місця скінчились — резерв; повтор — 409; без входу — 401', async () => {
      expect((await anon.post(`/api/events/${ev.id}/teams`, { name: 'X', members: ['a'] })).status).toBe(401)
      const r = await eve.post(`/api/events/${ev.id}/teams`, { name: 'Фремени', members: ['Chani', 'Stilgar'], note: 'Будемо вчасно' })
      expect(r.status).toBe(201)
      const t1 = r.body.teams.find((x) => x.name === 'Фремени')
      expect(t1).toMatchObject({ status: 'confirmed', mine: true, note: 'Будемо вчасно', captain: { login: expect.any(String) } })
      expect(t1.members.map((m) => m.nick)).toEqual(['Chani', 'Stilgar'])
      expect(t1.members[0].user).toMatchObject({ name: expect.any(String) })
      expect(t1.members[1].user).toBe(null)
      expect(t1.code).toEqual(expect.any(String))
      expect(r.body.me.team).toBe(t1.id)
      teams.fremen = t1
      // друга команда тієї ж людини, задовгий склад, та сама назва
      expect((await eve.post(`/api/events/${ev.id}/teams`, { name: 'Ще', members: ['Chani'] })).status).toBe(409)
      expect((await carol.post(`/api/events/${ev.id}/teams`, { name: 'Задовга', members: ['a', 'b', 'c'] })).status).toBe(400)
      expect((await carol.post(`/api/events/${ev.id}/teams`, { name: 'фремени', members: ['Feyd'] })).status).toBe(409)
      const c = await carol.post(`/api/events/${ev.id}/teams`, { name: 'Харконнени', members: ['Feyd', 'Rabban'] })
      expect(c.body.teams.find((x) => x.name === 'Харконнени').status).toBe('confirmed')
      teams.hark = c.body.teams.find((x) => x.name === 'Харконнени')
      const d = await dave.post(`/api/events/${ev.id}/teams`, { name: 'Атрейдеси', members: ['Paul', 'Gurney'] })
      expect(d.status).toBe(201)
      teams.atr = d.body.teams.find((x) => x.name === 'Атрейдеси')
      expect(teams.atr.status).toBe('reserve')
    })

    it('хто що бачить: склад — усі; примітку — команда й організатор; код — капітан і організатор', async () => {
      const pub = (await anon.get(`/api/events/${ev.id}`)).body
      expect(pub.teams.map((x) => x.name)).toEqual(['Фремени', 'Харконнени', 'Атрейдеси'])
      expect(pub.teams.every((x) => x.code === undefined && x.note === undefined)).toBe(true)
      expect(pub.counts).toMatchObject({ confirmed: 2, reserve: 1 })
      const org = (await bob.get(`/api/events/${ev.id}`)).body
      expect(org.teams.find((x) => x.id === teams.fremen.id)).toMatchObject({ code: teams.fremen.code, note: 'Будемо вчасно' })
      const other = (await carol.get(`/api/events/${ev.id}`)).body
      expect(other.teams.find((x) => x.id === teams.fremen.id).code).toBeUndefined()
      expect(other.teams.find((x) => x.id === teams.hark.id).code).toEqual(expect.any(String))
    })

    it('приєднання кодом: місце з твоїм ніком — твоє; хибний код — 404; уже в команді — без реєстрації своєї', async () => {
      expect((await frank.post(`/api/events/${ev.id}/teams/${teams.fremen.id}/join`, { code: 'nope' })).status).toBe(404)
      const r = await frank.post(`/api/events/${ev.id}/teams/${teams.fremen.id}/join`, { code: teams.fremen.code })
      expect(r.status).toBe(200)
      const t = r.body.teams.find((x) => x.id === teams.fremen.id)
      expect(t.members[1]).toMatchObject({ nick: 'Stilgar', user: { name: expect.any(String) } })
      expect(r.body.me.team).toBe(teams.fremen.id)
      expect((await frank.post(`/api/events/${ev.id}/teams`, { name: 'Своя', members: ['Stilgar'] })).status).toBe(409)
      // повний склад — новому місця нема
      expect((await grace.post(`/api/events/${ev.id}/teams/${teams.fremen.id}/join`, { code: teams.fremen.code })).status).toBe(409)
      // «мої» Френка — ця подія
      expect(ids((await frank.get('/api/events?scope=mine')).body.rows)).toContain(ev.id)
    })

    it('приєднання до повного складу з ніками капітана: сервер питає, хто ти, — і людина займає вибране місце', async () => {
      const hark = (await carol.get(`/api/events/${ev.id}`)).body.teams.find((x) => x.id === teams.hark.id)
      const ask = await grace.post(`/api/events/${ev.id}/teams/${hark.id}/join`, { code: hark.code })
      expect(ask.status).toBe(409)
      expect(ask.body.pick).toEqual([{ i: 1, nick: 'Rabban' }])
      // зайняте місце (капітана) не вибрати
      expect((await grace.post(`/api/events/${ev.id}/teams/${hark.id}/join`, { code: hark.code, slot: 0 })).status).toBe(409)
      const r = await grace.post(`/api/events/${ev.id}/teams/${hark.id}/join`, { code: hark.code, slot: 1 })
      expect(r.status).toBe(200)
      expect(r.body.teams.find((x) => x.id === hark.id).members[1]).toMatchObject({ nick: 'Rabban', user: { name: expect.any(String) } })
      expect(r.body.me.team).toBe(hark.id)
      expect((await grace.post(`/api/events/${ev.id}/teams/${hark.id}/leave`)).status).toBe(200)
    })

    it('капітан змінює склад: гравець із сайту лишається на місці, чужого не додати; капітан — у складі', async () => {
      const keep = (await eve.get(`/api/events/${ev.id}`)).body.teams.find((x) => x.id === teams.fremen.id).members
      const r = await eve.patch(`/api/events/${ev.id}/teams/${teams.fremen.id}`, { name: 'Фремени Сієчу', members: keep.map((m) => ({ nick: m.nick, user: m.user?.id })) })
      expect(r.status).toBe(200)
      expect(r.body.teams.find((x) => x.id === teams.fremen.id)).toMatchObject({ name: 'Фремени Сієчу' })
      expect(r.body.teams.find((x) => x.id === teams.fremen.id).members.every((m) => m.user)).toBe(true)
      expect((await eve.patch(`/api/events/${ev.id}/teams/${teams.fremen.id}`, { members: [{ nick: 'Stilgar', user: keep[1].user.id }] })).status).toBe(400)
      // чужий капітан і статус від капітана — ні
      expect((await carol.patch(`/api/events/${ev.id}/teams/${teams.fremen.id}`, { name: 'Злам' })).status).toBe(403)
      expect((await eve.patch(`/api/events/${ev.id}/teams/${teams.fremen.id}`, { status: 'confirmed' })).status).toBe(403)
    })

    it('команда знялась — перший із резерву бере участь сам; гравець виходить із команди', async () => {
      const r = await carol.del(`/api/events/${ev.id}/teams/${teams.hark.id}`)
      expect(r.status).toBe(200)
      expect(r.body.teams.find((x) => x.id === teams.atr.id).status).toBe('confirmed')
      expect(r.body.teams.some((x) => x.id === teams.hark.id)).toBe(false)
      // Керол знову вільна — може зареєструватись (тепер у резерв)
      const again = await carol.post(`/api/events/${ev.id}/teams`, { name: 'Харконнени', members: ['Feyd'] })
      expect(again.body.teams.find((x) => x.name === 'Харконнени').status).toBe('reserve')
      teams.hark = again.body.teams.find((x) => x.name === 'Харконнени')
      expect((await eve.post(`/api/events/${ev.id}/teams/${teams.fremen.id}/leave`)).status).toBe(400)
      const left = await frank.post(`/api/events/${ev.id}/teams/${teams.fremen.id}/leave`)
      expect(left.status).toBe(200)
      expect(left.body.teams.find((x) => x.id === teams.fremen.id).members.map((m) => m.nick)).toEqual(['Chani'])
      expect(left.body.me.team).toBe(null)
    })

    it('з підтвердженням: нова — чекає; рішення — лише організатор; підтвердити, коли місць нема, — 409', async () => {
      const cur = (await bob.get(`/api/events/${ev.id}`)).body
      // стара версія — 409 зі свіжою
      const stale = await bob.put(`/api/events/${ev.id}`, { reg: { ...cur.reg, approval: true }, base: cur.updated - 1 })
      expect(stale.status).toBe(409)
      expect(stale.body.row.id).toBe(ev.id)
      const r = await bob.put(`/api/events/${ev.id}`, { reg: { ...cur.reg, approval: true, slots: 3 }, base: cur.updated })
      expect(r.status).toBe(200)
      expect(r.body.reg).toMatchObject({ approval: true, slots: 3 })
      // з підтвердженням резерв сам не проходить
      expect(r.body.teams.find((x) => x.id === teams.hark.id).status).toBe('reserve')
      const g = await grace.post(`/api/events/${ev.id}/teams`, { name: 'Контрабандисти', members: ['Esmar'] })
      teams.smug = g.body.teams.find((x) => x.name === 'Контрабандисти')
      expect(teams.smug.status).toBe('pending')
      // заявки, що чекають, — лише організатор і сама команда
      expect((await anon.get(`/api/events/${ev.id}`)).body.teams.some((x) => x.id === teams.smug.id)).toBe(false)
      expect((await grace.patch(`/api/events/${ev.id}/teams/${teams.smug.id}`, { status: 'confirmed' })).status).toBe(403)
      expect((await bob.patch(`/api/events/${ev.id}/teams/${teams.smug.id}`, { status: 'confirmed' })).body.teams.find((x) => x.id === teams.smug.id).status).toBe('confirmed')
      expect((await bob.patch(`/api/events/${ev.id}/teams/${teams.hark.id}`, { status: 'confirmed' })).status).toBe(409)
      expect((await bob.patch(`/api/events/${ev.id}/teams/${teams.hark.id}`, { status: 'rejected' })).status).toBe(200)
    })

    it('реєстрацію закрито — 409; скасовану подію видно в списку з причиною', async () => {
      const cur = (await bob.get(`/api/events/${ev.id}`)).body
      const closed = await bob.put(`/api/events/${ev.id}`, { reg: { ...cur.reg, open: false }, base: cur.updated })
      expect(closed.body.regState).toBe('closed')
      expect((await dave.post(`/api/events/${ev.id}/teams`, { name: 'Пізно', members: ['x'] })).status).toBe(409)
      const other = await bob.post('/api/events', duel({ title: 'Перегони на орні', type: 'race' }))
      const c = await bob.put(`/api/events/${other.body.id}`, { cancelled: true, cancelNote: 'Буря', base: other.body.updated })
      expect(c.body).toMatchObject({ cancelled: true, cancelNote: 'Буря', regState: 'cancelled' })
      expect((await anon.get('/api/events?type=race')).body.rows[0]).toMatchObject({ id: other.body.id, cancelled: true })
      expect((await dave.post(`/api/events/${other.body.id}/teams`, { name: 'X', members: ['x'] })).status).toBe(409)
      await bob.put(`/api/events/${ev.id}`, { reg: { ...cur.reg, open: true } })
    })
  })

  describe('глядачі, сітка, результати', () => {
    it('«Піду дивитись»: лише з входом; лічильник; у «моїх»', async () => {
      expect((await anon.post(`/api/events/${ev.id}/watch`)).status).toBe(401)
      expect((await dave.post(`/api/events/${ev.id}/watch`)).body).toEqual({ watching: true, watchers: 1 })
      expect((await carol.post(`/api/events/${ev.id}/watch`, { on: true })).body.watchers).toBe(2)
      expect((await carol.post(`/api/events/${ev.id}/watch`, { on: false })).body).toEqual({ watching: false, watchers: 1 })
      expect((await dave.get(`/api/events/${ev.id}`)).body.me.watching).toBe(true)
      expect((await dave.get('/api/events?scope=mine')).body.rows.find((x) => x.id === ev.id).me).toMatchObject({ watching: true })
    })

    it('сітка: лише підтверджені команди цієї події, вибір переможців перерахований; результати — лише свої команди', async () => {
      const cur = (await bob.get(`/api/events/${ev.id}`)).body
      const ok = cur.teams.filter((x) => x.status === 'confirmed').map((x) => x.id)
      expect(ok).toHaveLength(3)
      // чужа й відхилена команди стають пропусками; вибір у матчі з пропуском — геть
      const seed = [ok[0], teams.hark.id, ok[1], ok[2]]
      const r = await bob.put(`/api/events/${ev.id}`, { bracket: { seed, picks: [['b', 'a'], ['b']] }, base: cur.updated })
      expect(r.status).toBe(200)
      expect(r.body.bracket).toEqual({ seed: [ok[0], null, ok[1], ok[2]], picks: [[null, 'a'], ['b']] })
      expect((await bob.put(`/api/events/${ev.id}`, { bracket: { seed: [ok[0], ok[1], ok[2]] } })).status).toBe(400)
      const res = await bob.put(`/api/events/${ev.id}`, { results: [{ team: ok[1] }, { team: 'tnosuchteam1' }, { team: null, name: 'Найкращий пілот: Duncan' }] })
      expect(res.body.results).toEqual([{ team: ok[1], name: '' }, { team: null, name: 'Найкращий пілот: Duncan' }])
      // список про сітку лише знає, що вона є
      expect((await anon.get('/api/events')).body.rows.find((x) => x.id === ev.id).bracket).toBe(true)
    })

    it('чуже не змінити: гравець — 403, гість — 401', async () => {
      expect((await eve.put(`/api/events/${ev.id}`, { title: 'Злам' })).status).toBe(403)
      expect((await anon.put(`/api/events/${ev.id}`, { title: 'Злам' })).status).toBe(401)
      expect((await eve.del(`/api/events/${ev.id}`)).status).toBe(403)
    })
  })

  describe('прибирання', () => {
    it('людину видалено: її місця в командах — геть, капітанство — наступному з сайту, глядача — нема', async () => {
      const me = (await dave.get('/api/me')).body.user
      // Френк приєднується до команди Дейва (вільне місце), Дейв іде з сайту — капітаном стає Френк
      const atr = (await dave.get(`/api/events/${ev.id}`)).body.teams.find((x) => x.id === teams.atr.id)
      await dave.patch(`/api/events/${ev.id}/teams/${teams.atr.id}`, { members: [{ nick: 'Paul', user: me.id }] })
      expect((await frank.post(`/api/events/${ev.id}/teams/${teams.atr.id}/join`, { code: atr.code })).status).toBe(200)
      expect((await dave.del('/api/me', { confirm: 'dave@example.com' })).status).toBe(200)
      const after = (await bob.get(`/api/events/${ev.id}`)).body
      const t = after.teams.find((x) => x.id === teams.atr.id)
      expect(t.members.map((m) => m.nick)).toEqual(['Stilgar'])
      expect(t.captain.id).toBe(t.members[0].user.id)
      expect(after.counts.watchers).toBe(0)
    })

    it('видалення події — разом із командами; потім 404 і нема в списках; у панелі — розділ подій', async () => {
      const panel = await admin.get(`/api/admin/r/events?search=${encodeURIComponent('Бій 2 на 2')}`)
      expect(panel.status).toBe(200)
      const del = await bob.del(`/api/events/${ev.id}`)
      expect(del.status).toBe(200)
      expect((await anon.get(`/api/events/${ev.id}`)).status).toBe(404)
      expect(ids((await frank.get('/api/events?scope=mine')).body.rows)).not.toContain(ev.id)
      expect(Number((await db.get('SELECT COUNT(*) AS n FROM event_teams WHERE event_id = ?', ev.id)).n)).toBe(0)
      expect(Number((await db.get('SELECT COUNT(*) AS n FROM event_players WHERE event_id = ?', ev.id)).n)).toBe(0)
    })
  })
})

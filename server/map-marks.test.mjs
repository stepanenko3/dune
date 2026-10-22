// Чуже публічне на мапі — позначки й записи ресурсів разом: список пачками (сторінки, пошук за назвою й автором,
// фільтр мапи й виду), своє й гільдійське туди не потрапляє; «ввімкнене» (окремі речі й усе від автора) — окремим
// запитом. Обв'язка — як у bases-io.test.mjs: запасна SQLite (тимчасова тека) і Postgres <DB_DATABASE>_testing
// зі Snotax console (якщо є), у своїй схемі на кожен запуск.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'

const SCHEMA = `map_marks_${process.pid}_${Date.now().toString(36)}`
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

  /** «браузер»: свій cookie сеансу, запити з того самого сайту */
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
      user: null,
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      patch: (u, b) => call('PATCH', u, b),
      async signIn(email) {
        const r = await a.post('/api/auth/code', { email })
        if (r.status !== 200) return r
        const v = await a.post('/api/auth/verify', { email, code: codeFor(email) })
        a.user = v.body?.user
        return v
      },
    }
    return a
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-map-marks-'))
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
  const ids = {}

  it('вхід і чуже публічне: 25 позначок Боба на Хаззі, 2 у пустелі; записи Єви; приватне й гільдійське', async () => {
    expect((await admin.signIn('admin@example.com')).body.user.role).toBe('admin')
    expect((await bob.signIn('bob@example.com')).status).toBe(201)
    expect((await eve.signIn('eve@example.com')).status).toBe(201)
    // логін і ім'я нових людей випадкові — для пошуку за автором даємо сталі (без цифр, щоб не плутали пошук «скеля 1»)
    bob.user = (await bob.patch('/api/me', { login: 'bob', name: 'Bob' })).body.user
    eve.user = (await eve.patch('/api/me', { login: 'eve', name: 'Eve' })).body.user
    for (let i = 1; i <= 25; i++) {
      const r = await bob.post('/api/markers', { map: 'survival_1', x: i * 100, y: -i * 100, kind: 'resource', title: `Скеля ${i}`, note: i === 7 ? 'тут титан' : '', visibility: 'public' })
      expect(r.status).toBe(201)
      if (i === 7) ids.rock7 = r.body.id
    }
    for (const n of [1, 2]) expect((await bob.post('/api/markers', { map: 'deepdesert_1', x: n, y: n, layout: 3, kind: 'danger', title: `Черв ${n}`, visibility: 'public' })).status).toBe(201)
    // записи Єви: з точкою на Хаззі і лише з регіоном «Глибока пустеля» (без точок)
    const p1 = await eve.post('/api/places', { res: 'Титанова руда', place: 'Скелі на півночі', zone: 'hagga', pins: [{ map: 'survival_1', x: 10, y: 20 }], visibility: 'public' })
    expect(p1.status).toBe(201)
    ids.evePlace = p1.body.id
    const p2 = await eve.post('/api/places', { res: 'Плазмова гармата', place: 'Скриня в секторі B4', zone: 'dd', visibility: 'public' })
    expect(p2.status).toBe(201)
    ids.eveDd = p2.body.id
    const priv = await eve.post('/api/markers', { map: 'survival_1', x: 1, y: 1, kind: 'note', title: 'Моя схованка' })
    expect(priv.body.item.visibility).toBe('private')
    ids.evePriv = priv.body.id
    // гільдійське адміністратора (лідер Sandwalkers) — гільдії, не публічне
    const sw = (await admin.get('/api/guilds/sandwalkers')).body.guild
    expect((await admin.post('/api/markers', { map: 'survival_1', x: 5, y: 5, kind: 'base', title: 'База SW', owner: { kind: 'guild', id: sw.id } })).body.item.visibility).toBe('guild')
  })

  it('сторінки по 20: перша, друга, найновіше згори; ліміт сторінки не більше 50', async () => {
    const p1 = await anon.get('/api/map/public?map=survival_1')
    expect(p1.status).toBe(200)
    expect(p1.body).toMatchObject({ total: 26, offset: 0, limit: 20 })
    expect(p1.body.rows).toHaveLength(20)
    const place = p1.body.rows.find((r) => r.item.kind === 'place')
    expect(place).toMatchObject({ res: 'Титанова руда', pins: [{ map: 'survival_1', x: 10, y: 20 }], item: { visibility: 'public', owner: { kind: 'user', id: eve.user.id } } })
    expect(p1.body.rows.find((r) => r.title === 'Скеля 25')).toMatchObject({ map: 'survival_1', kind: 'resource', x: 2500, item: { kind: 'marker' } })
    const p2 = await anon.get('/api/map/public?map=survival_1&offset=20')
    expect(p2.body.rows).toHaveLength(6)
    const rows = [...p1.body.rows, ...p2.body.rows]
    expect(new Set(rows.map((r) => r.id)).size).toBe(26)
    // найновіше згори
    expect(rows.every((r, i) => i === 0 || rows[i - 1].item.updated >= r.item.updated)).toBe(true)
    expect((await anon.get('/api/map/public?map=survival_1&limit=500')).body).toMatchObject({ limit: 50, total: 26 })
    expect((await anon.get('/api/map/public?map=survival_1&limit=5&offset=-3')).body).toMatchObject({ limit: 5, offset: 0 })
    // без мапи — усе публічне чуже
    expect((await anon.get('/api/map/public')).body.total).toBe(29)
  })

  it('фільтр мапи й виду: пустеля — позначки з неї і запис лише з регіоном; приватне й гільдійське не видно', async () => {
    const dd = await anon.get('/api/map/public?map=deepdesert_1')
    expect(dd.body.rows.map((r) => r.title || r.res).sort()).toEqual(['Плазмова гармата', 'Черв 1', 'Черв 2'])
    expect((await anon.get('/api/map/public?map=deepdesert_1&kind=place')).body.rows.map((r) => r.id)).toEqual([ids.eveDd])
    expect((await anon.get('/api/map/public?map=survival_1&kind=marker')).body.total).toBe(25)
    expect((await anon.get('/api/map/public?map=sh_arrakeen')).body).toMatchObject({ total: 0, rows: [] })
    const all = (await bob.get('/api/map/public?limit=50')).body.rows
    expect(all.some((r) => r.title === 'Моя схованка' || r.title === 'База SW')).toBe(false)
  })

  it('своє й гільдійське — не в списку (воно й так на мапі)', async () => {
    const forBob = (await bob.get('/api/map/public?map=survival_1')).body
    expect(forBob.total).toBe(1)
    expect(forBob.rows[0].id).toBe(ids.evePlace)
    expect((await eve.get('/api/map/public?map=survival_1')).body.total).toBe(25)
  })

  it('пошук: за назвою, описом, автором; кілька слів — усі мають бути', async () => {
    expect((await anon.get(`/api/map/public?map=survival_1&q=${encodeURIComponent('скеля 1')}`)).body.rows.map((r) => r.title).sort())
      .toEqual(['Скеля 1', 'Скеля 10', 'Скеля 11', 'Скеля 12', 'Скеля 13', 'Скеля 14', 'Скеля 15', 'Скеля 16', 'Скеля 17', 'Скеля 18', 'Скеля 19', 'Скеля 21'])
    // «титан» — в описі позначки 7 і в назві запису Єви
    expect((await anon.get(`/api/map/public?q=${encodeURIComponent('ТИТАН')}`)).body.rows.map((r) => r.id).sort()).toEqual([ids.evePlace, ids.rock7].sort())
    // автор: ім'я чи логін Боба
    const byName = (await anon.get(`/api/map/public?map=deepdesert_1&q=${encodeURIComponent(bob.user.login)}`)).body
    expect(byName.rows.map((r) => r.title).sort()).toEqual(['Черв 1', 'Черв 2'])
    expect((await anon.get(`/api/map/public?q=${encodeURIComponent(eve.user.login + ' гармата')}`)).body.rows.map((r) => r.id)).toEqual([ids.eveDd])
    expect((await anon.get('/api/map/public?q=немає-такого')).body.total).toBe(0)
    // лише один автор (owner=user:<id>)
    expect((await anon.get(`/api/map/public?owner=user:${eve.user.id}`)).body.total).toBe(2)
  })

  it('ввімкнене на мапі: окремі речі (які видно) і все від автора на цій мапі', async () => {
    const q = (s) => anon.get(`/api/map/public/shown?${s}`)
    const one = await q(`ids=marker:${ids.rock7},marker:${ids.evePriv},place:${ids.eveDd}&map=survival_1`)
    expect(one.status).toBe(200)
    // приватне Єви чужим не видно; запис з пустелі — не на цій мапі
    expect(one.body.rows.map((r) => r.id)).toEqual([ids.rock7])
    expect((await eve.get(`/api/map/public/shown?ids=marker:${ids.evePriv}`)).body.rows.map((r) => r.id)).toEqual([ids.evePriv])
    const follow = await q(`owners=user:${bob.user.id}&map=deepdesert_1`)
    expect(follow.body.rows.map((r) => r.title).sort()).toEqual(['Черв 1', 'Черв 2'])
    expect((await q(`owners=user:${bob.user.id},user:${eve.user.id}&map=survival_1`)).body.rows).toHaveLength(26)
    expect((await q('ids=bogus,marker:&owners=nobody')).body.rows).toEqual([])
  })

  it('«за посиланням» зникає зі списку, але ввімкнене за id лишається; запис за id', async () => {
    expect((await bob.patch(`/api/items/marker/${ids.rock7}/access`, { visibility: 'link' })).status).toBe(200)
    expect((await anon.get('/api/map/public?map=survival_1&kind=marker')).body.total).toBe(24)
    expect((await anon.get(`/api/map/public/shown?ids=marker:${ids.rock7}`)).body.rows).toHaveLength(1)
    expect((await anon.get(`/api/map/public/shown?owners=user:${bob.user.id}&map=survival_1`)).body.rows).toHaveLength(24)
    expect((await anon.get(`/api/places/${ids.evePlace}`)).body).toMatchObject({ id: ids.evePlace, res: 'Титанова руда', item: { visibility: 'public' } })
    expect((await anon.get('/api/places/nope')).status).toBe(404)
    // змінений документ одразу видно в списку (кеш документів — за датою зміни)
    expect((await eve.patch(`/api/places/${ids.evePlace}`, { res: 'Титан' })).status).toBe(200)
    expect((await anon.get(`/api/map/public?map=survival_1&kind=place`)).body.rows[0].res).toBe('Титан')
  })
})

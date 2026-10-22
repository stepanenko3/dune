// Активні поля меланжу: позначки гравців (для себе, гільдії, усіх), відлік від першої видимої позначки, підтвердження,
// строк за величиною поля, місця великих полів (відомі й з позначок). Обв'язка — як у bases-io.test.mjs: запасна SQLite (тимчасова тека) і Postgres <DB_DATABASE>_testing
// зі Snotax console (якщо є), у своїй схемі на кожен запуск.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'
import { createSpice, SPICE_TTL } from './lib/spice.mjs'

/** великі поля розкладки 2 у файлах гри (координати сайту) */
const KNOWN2 = [[-1016000, 914400], [-1016000, -812800], [-609600, 812800], [-609600, -1016000], [-304800, -304800], [-1117600, 0]]

const SCHEMA = `spice_marks_${process.pid}_${Date.now().toString(36)}`
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
      del: (u) => call('DELETE', u),
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-spice-'))
    db = await openDb({ dataDir: dir, pg: pgCfg })
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    // відомі місця великих полів — з файлів гри (застосування розділу spice); тут — розкладка 2, як у грі
    await app.locals.spice.setKnown(KNOWN2.map(([x, y]) => ({ id: `2@${x}:${y}`, layout: 2, x, y, size: 'large' })))
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
  const S = { map: 'survival_1', size: 'small', x: 1000, y: -2000 }
  const fieldAt = (body, p) => body.fields.find((f) => f.size === p.size && f.x === p.x && f.y === p.y)

  it('позначати — лише після входу; перша позначка запускає відлік', async () => {
    expect((await admin.signIn('admin@example.com')).body.user.role).toBe('admin')
    expect((await bob.signIn('bob@example.com')).status).toBe(201)
    expect((await eve.signIn('eve@example.com')).status).toBe(201)
    bob.user = (await bob.patch('/api/me', { login: 'bob', name: 'Bob' })).body.user
    eve.user = (await eve.patch('/api/me', { login: 'eve', name: 'Eve' })).body.user
    expect((await anon.post('/api/map/spice', { ...S, visibility: 'public' })).status).toBe(401)
    expect((await anon.get('/api/map/spice/survival_1')).body).toMatchObject({ fields: [], spots: [], ttl: SPICE_TTL })
    const r = await bob.post('/api/map/spice', { ...S, visibility: 'public' })
    expect(r.status).toBe(200)
    const f = fieldAt((await anon.get('/api/map/spice/survival_1')).body, S)
    expect(f).toMatchObject({ n: 1, names: ['Bob'], vis: 'public', mine: null })
    expect(f.expires - f.first).toBe(SPICE_TTL.small)
    expect(fieldAt(r.body, S).mine).toMatchObject({ visibility: 'public' })
  })

  it('наступні позначки лише підтверджують: лічильник росте, відлік і строк — від першої', async () => {
    const before = fieldAt((await anon.get('/api/map/spice/survival_1')).body, S)
    await new Promise((r) => setTimeout(r, 5))
    expect((await eve.post('/api/map/spice', { ...S, visibility: 'public' })).status).toBe(200)
    const f = fieldAt((await anon.get('/api/map/spice/survival_1')).body, S)
    expect(f).toMatchObject({ n: 2, names: ['Bob', 'Eve'], first: before.first, expires: before.expires })
    expect(f.last).toBeGreaterThan(f.first)
    // повторна позначка тієї ж людини — не друга, а зміна видимості її позначки
    await eve.post('/api/map/spice', { ...S, visibility: 'private' })
    expect(fieldAt((await anon.get('/api/map/spice/survival_1')).body, S)).toMatchObject({ n: 1, names: ['Bob'] })
    expect(fieldAt((await eve.get('/api/map/spice/survival_1')).body, S)).toMatchObject({ n: 2, mine: { visibility: 'private' } })
  })

  it('гільдія: бачать лише її учасники; без гільдії — не можна', async () => {
    const G = { ...S, x: 5000, y: 5000, size: 'medium' }
    expect((await eve.post('/api/map/spice', { ...G, visibility: 'guild' })).status).toBe(400)
    expect((await admin.post('/api/map/spice', { ...G, visibility: 'guild' })).status).toBe(200)
    expect(fieldAt((await admin.get('/api/map/spice/survival_1')).body, G)).toMatchObject({ n: 1, vis: 'guild' })
    expect(fieldAt((await bob.get('/api/map/spice/survival_1')).body, G)).toBeUndefined()
    expect(fieldAt((await anon.get('/api/map/spice/survival_1')).body, G)).toBeUndefined()
  })

  it('відлік — для кожного глядача з тих позначок, що він бачить', async () => {
    const P = { ...S, x: 9000, y: 9000 }
    await eve.post('/api/map/spice', { ...P, visibility: 'private' })
    await new Promise((r) => setTimeout(r, 5))
    await bob.post('/api/map/spice', { ...P, visibility: 'public' })
    const forEve = fieldAt((await eve.get('/api/map/spice/survival_1')).body, P)
    const forAnon = fieldAt((await anon.get('/api/map/spice/survival_1')).body, P)
    expect(forEve.n).toBe(2)
    expect(forAnon.n).toBe(1)
    expect(forEve.first).toBeLessThan(forAnon.first)
  })

  it('зняти можна лише свою позначку', async () => {
    const mine = fieldAt((await bob.get('/api/map/spice/survival_1')).body, S).mine
    expect((await eve.del(`/api/map/spice/${mine.id}`)).status).toBe(404)
    expect((await anon.del(`/api/map/spice/${mine.id}`)).status).toBe(401)
    const r = await bob.del(`/api/map/spice/${mine.id}`)
    expect(r.status).toBe(200)
    // лишилась тільки приватна позначка Єви
    expect(fieldAt((await anon.get('/api/map/spice/survival_1')).body, S)).toBeUndefined()
    expect(fieldAt((await eve.get('/api/map/spice/survival_1')).body, S)).toMatchObject({ n: 1, names: ['Eve'] })
  })

  it('Глибока пустеля: лише зі своєю розкладкою; велике поле прилипає до відомого місця і стає «вивченим» місцем', async () => {
    const near = { map: 'deepdesert_1', size: 'large', x: -1016000 + 4000, y: 914400 - 3000, visibility: 'public' }
    expect((await bob.post('/api/map/spice', near)).status).toBe(400)
    const r = await bob.post('/api/map/spice', { ...near, layout: 2 })
    expect(r.status).toBe(200)
    expect(fieldAt(r.body, { size: 'large', x: -1016000, y: 914400 })).toMatchObject({ n: 1 })
    const known = (await anon.get('/api/map/spice/deepdesert_1?layout=2')).body.spots
    expect(known.filter((s) => s.src === 'known')).toHaveLength(6)
    // далеко від відомих — нове місце, з позначки
    const far = { ...near, layout: 2, x: 100000, y: 100000 }
    await bob.post('/api/map/spice', far)
    expect((await anon.get('/api/map/spice/deepdesert_1?layout=2')).body.spots).toContainEqual({ x: 100000, y: 100000, src: 'marked' })
    expect((await anon.get('/api/map/spice/deepdesert_1?layout=5')).body.spots.filter((s) => s.src === 'known')).toHaveLength(0)
    expect((await bob.post('/api/map/spice', { ...far, size: 'huge' })).status).toBe(400)
    expect((await bob.post('/api/map/spice', { ...far, visibility: 'friends' })).status).toBe(400)
  })

  it('відомі місця — з файлів гри: setKnown замінює всі, повтор не дублює', async () => {
    const s = await createSpice({ db, guilds: { ofOne: async () => null } })
    await s.setKnown([{ id: '5@1:2', layout: 5, x: 1, y: 2, size: 'large' }, { id: '5@3:4', layout: 5, x: 3, y: 4, size: 'large' }])
    await s.setKnown([{ id: '5@1:2', layout: 5, x: 1, y: 2, size: 'large' }])
    expect((await s.view(null, 'deepdesert_1', 5)).spots).toEqual([{ x: 1, y: 2, src: 'known' }])
    await s.setKnown(KNOWN2.map(([x, y]) => ({ id: `2@${x}:${y}`, layout: 2, x, y, size: 'large' })))
  })

  it('строк: позначка після строку починає нове вікно; давнє вікно не активне', async () => {
    const s = await createSpice({ db, guilds: { ofOne: async () => null } })
    const ctx = { user: { id: bob.user.id }, ranks: new Map() }
    const p = { map: 'survival_1', layout: null, size: 'medium', x: 123, y: 456, visibility: 'public' }
    const T = 1_000_000_000_000
    await s.mark(ctx, p, T)
    expect((await s.view(null, 'survival_1', null, T + 60_000)).fields.find((f) => f.x === 123)).toMatchObject({ first: T, expires: T + SPICE_TTL.medium })
    expect((await s.view(null, 'survival_1', null, T + SPICE_TTL.medium + 1)).fields.find((f) => f.x === 123)).toBeUndefined()
    await s.mark(ctx, p, T + SPICE_TTL.medium + 10)
    expect((await s.view(null, 'survival_1', null, T + SPICE_TTL.medium + 20)).fields.find((f) => f.x === 123)).toMatchObject({ first: T + SPICE_TTL.medium + 10, n: 1 })
  })
})

// Мапа після аудиту: записи ресурсів чистяться як позначки (текст без розмітки, «[object Object]» не пролазить,
// точки — у межах мапи, розкладка — лише в пустелі); /api/places — лише видиме людині, без «усього публічного»;
// запис видалили посеред правки — 404, а не порожній «конфлікт»; публічне — за часом публікації (правки не
// підіймають нагору). Окремо, без мережі: опис з TH.GL перевіряється, точка від людини — cleanPoint, частіша
// перевірка TH.GL — довкола бурі. Обв'язка — як у map-marks.test.mjs (SQLite і, якщо є, Postgres).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Encoder } from 'cbor-x'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'
import { createMapData, refreshEvery, validSource } from './lib/thgl.mjs'

const SCHEMA = `map_fixes_${process.pid}_${Date.now().toString(36)}`
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

describe('дані мапи без мережі', () => {
  let dir, data
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-map-data-'))
    data = createMapData({ dataDir: dir, log: { log() {}, warn() {} } })
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('точка від людини: мапа, межі, розкладка', () => {
    expect(data.cleanPoint({ map: 'deepdesert_1', x: '10.4', y: -20, layout: 3 })).toEqual({ map: 'deepdesert_1', x: 10, y: -20, layout: 3 })
    // розкладка в мапи без розкладок — відкидаємо (позначку перенесли з пустелі в Хаггу)
    expect(data.cleanPoint({ map: 'survival_1', x: 1, y: 2, layout: 3 })).toEqual({ map: 'survival_1', x: 1, y: 2 })
    for (const bad of [
      { map: 'nope', x: 1, y: 1 }, { map: 'survival_1', x: 1e300, y: 0 }, { map: 'survival_1', x: '', y: 0 },
      { map: 'survival_1', x: null, y: 0 }, { map: 'survival_1', x: { a: 1 }, y: 0 }, { map: 'deepdesert_1', x: 0, y: 0, layout: 99 },
      { map: 'deepdesert_1', x: 0, y: 0, layout: '3' }, null,
    ]) expect(() => data.cleanPoint(bad)).toThrow()
  })

  it('точка гри за стабільним ключем: id без координат, перша така точка', async () => {
    const map = data.source.maps.find((m) => m.id === 'sh_arrakeen')
    const enc = new Encoder({ useRecords: true, pack: true })
    fs.mkdirSync(path.join(dir, 'map', 'nodes'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'map', 'nodes', map.nodes), enc.encode([
      { type: 'landsraadvendor', spawns: [{ id: 'landsraad_vendor@2651:5640', p: [5640, 2651, 52477] }] },
      { type: 'npc_unaffiliated', spawns: [{ id: 'armor_vendor@2661.9:5518.2', p: [5518.2, 2661.9, 1] }, { id: 'weapon_vendor@2661.5:5636.2', p: [5636.2, 2661.5, 1] }] },
    ]))
    expect(await data.spot('sh_arrakeen', 'npc_unaffiliated', 'weapon_vendor')).toEqual({ type: 'npc_unaffiliated', i: 1, x: 5636, y: 2662 })
    expect(await data.spot('sh_arrakeen', 'landsraadvendor', 'landsraad_vendor')).toEqual({ type: 'landsraadvendor', i: 0, x: 5640, y: 2651 })
    // лише цілий ключ («weapon» — не «weapon_vendor») і лише в цьому типі точок
    expect(await data.spot('sh_arrakeen', 'npc_unaffiliated', 'weapon')).toBe(null)
    expect(await data.spot('sh_arrakeen', 'landsraadvendor', 'weapon_vendor')).toBe(null)
    expect(await data.spot('sh_arrakeen', '__proto__', 'weapon_vendor')).toBe(null)
    expect(await data.spot('nope', 'npc_unaffiliated', 'weapon_vendor')).toBe(null)
    // розібрані точки мапи (для розділів реєстру): тип → координати й id TH.GL; невідома мапа — null
    expect((await data.raw('sh_arrakeen')).npc_unaffiliated.pts).toEqual([5518, 2662, 1, 5636, 2662, 1])
    expect(await data.raw('nope')).toBe(null)
  })

  it('опис з TH.GL: непридатний не замінює робочий', () => {
    expect(validSource(data.source)).toBe(true)
    expect(validSource({ syncedAt: 'x', maps: [], groups: [] })).toBe(false)
    expect(validSource({ ...data.source, maps: data.source.maps.filter((m) => m.id !== 'deepdesert_1') })).toBe(false)
    expect(validSource({ ...data.source, groups: [] })).toBe(false)
    expect(validSource(null)).toBe(false)
  })

  it('після бурі TH.GL перевіряється частіше (півгодини), посеред тижня — раз на 6 год', () => {
    // перша буря тижня — в Океанії (понеділок, 18:00 UTC узимку там), остання — Пн. Америка (вівторок)
    expect(refreshEvery(Date.parse('2026-10-19T17:30:00Z'))).toBe(30 * 60_000)
    expect(refreshEvery(Date.parse('2026-10-20T12:00:00Z'))).toBe(30 * 60_000)
    expect(refreshEvery(Date.parse('2026-10-23T12:00:00Z'))).toBe(6 * 3600_000)
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-map-fixes-'))
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

  it('вхід', async () => {
    expect((await admin.signIn('admin@example.com')).body.user.role).toBe('admin')
    expect((await bob.signIn('bob@example.com')).status).toBe(201)
    expect((await eve.signIn('eve@example.com')).status).toBe(201)
  })

  it('запис чиститься як позначка: без розмітки, керівних символів і «[object Object]»', async () => {
    const r = await bob.post('/api/places', {
      res: '<b>Титан</b>\u0007', place: { toString: 'x' }, area: 42, how: 'рядок 1\r\nрядок 2<script>x</script>', zone: 'nope',
      pins: [{ map: 'survival_1', x: 10.6, y: '20', label: '<i>вхід</i>' }],
    })
    // місце-об'єкт — порожнє, а воно обов'язкове
    expect(r.status).toBe(400)
    const ok = await bob.post('/api/places', {
      res: '<b>Титан</b>\u0007', place: 'Скелі', area: 42, how: 'рядок 1\r\nрядок 2<script>x</script>', zone: 'nope',
      pins: [{ map: 'survival_1', x: 10.6, y: '20', label: '<i>вхід</i>', layout: 5 }],
    })
    expect(ok.status).toBe(201)
    expect(ok.body).toMatchObject({ res: 'Титан', place: 'Скелі', area: '42', how: 'рядок 1\nрядок 2x', zone: 'hagga', pins: [{ map: 'survival_1', x: 11, y: 20, label: 'вхід' }] })
    expect(ok.body.pins[0].layout).toBeUndefined()
    // точка за межами мапи, невідома розкладка пустелі — 400
    expect((await bob.patch(`/api/places/${ok.body.id}`, { addPins: [{ map: 'survival_1', x: 1e300, y: 0 }] })).status).toBe(400)
    expect((await bob.patch(`/api/places/${ok.body.id}`, { pins: [{ map: 'deepdesert_1', x: 0, y: 0, layout: 42 }] })).status).toBe(400)
    // стерти назву ресурсу правкою не можна
    expect((await bob.patch(`/api/places/${ok.body.id}`, { res: '   ' })).status).toBe(400)
  })

  it('/api/places — лише своє й гільдійське; «усе публічне» тут не віддаємо', async () => {
    const pub = await eve.post('/api/places', { res: 'Плазма', place: 'Скриня', visibility: 'public' })
    const priv = await eve.post('/api/places', { res: 'Схованка', place: 'Печера' })
    expect(pub.status).toBe(201)
    const forBob = (await bob.get('/api/places')).body.rows.map((r) => r.id)
    expect(forBob).not.toContain(priv.body.id)
    expect(forBob).not.toContain(pub.body.id)
    expect((await bob.get('/api/places?scope=public')).body.rows).toEqual([])
    expect((await anon.get('/api/places?scope=public,shared')).body.rows).toEqual([])
    expect((await eve.get('/api/places')).body.rows.map((r) => r.id)).toEqual(expect.arrayContaining([pub.body.id, priv.body.id]))
  })

  it('запис видалили посеред правки — 404, а не порожній «конфлікт»', async () => {
    const p = await eve.post('/api/places', { res: 'Тимчасове', place: 'Тут' })
    expect((await eve.del(`/api/places/${p.body.id}`)).status).toBe(200)
    const r = await eve.patch(`/api/places/${p.body.id}`, { how: 'x', base: p.body.updated })
    expect(r.status).toBe(404)
  })

  it('публічне — за часом публікації: правка старого не підіймає його нагору', async () => {
    const a = await bob.post('/api/places', { res: 'Старе', place: 'Північ', visibility: 'public' })
    await new Promise((r) => setTimeout(r, 15))
    const b = await bob.post('/api/places', { res: 'Нове', place: 'Південь', visibility: 'public' })
    await new Promise((r) => setTimeout(r, 15))
    expect((await bob.patch(`/api/places/${a.body.id}`, { how: 'уточнив' })).status).toBe(200)
    const rows = (await anon.get('/api/map/public?map=survival_1&kind=place')).body.rows.map((r) => r.id)
    expect(rows.indexOf(b.body.id)).toBeLessThan(rows.indexOf(a.body.id))
    // правку видно одразу (покажчик перебудувався)
    expect((await anon.get('/api/map/public?map=survival_1&kind=place')).body.rows.find((r) => r.id === a.body.id).how).toBe('уточнив')
    // увімкнене за id: публічне — з покажчика, приватне чуже — ні
    const shown = (await anon.get(`/api/map/public/shown?ids=place:${a.body.id},place:${b.body.id}&map=survival_1`)).body.rows.map((r) => r.id)
    expect(shown.sort()).toEqual([a.body.id, b.body.id].sort())
  })
})

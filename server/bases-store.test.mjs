// Бази: проріджування історії, одночасні збереження (409), автор версії, відновлення, список без документів,
// спільні правки калькулятора, копія з «на основі …», історія лише тим, хто змінює, і стирання назавжди лише власнику.
// Обв'язка — як у bases-io.test.mjs: запасна SQLite (тимчасова тека) і Postgres <DB_DATABASE>_testing (якщо є), у своїй
// схемі на кожен запуск.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { cleanCalc, createBasesStore, noteText, thinHistory } from './lib/bases.mjs'
import { openDb } from './lib/sql.mjs'

const SCHEMA = `bases_store_${process.pid}_${Date.now().toString(36)}`
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

const tiny = (name = 'Тестова') => ({
  format: 2,
  claims: [{ x: -5, y: 0, w: 10, d: 10 }],
  pieces: [{ id: 'p1', shape: 'Sardaukar_Foundation', x: 0.5, y: 0.5, z: 0, rot: 0 }],
  items: [],
  zones: [],
  levels: [{ key: 'g', name: 'Рівень 0', sub: '', z0: 0, z1: 1 }, { key: 'r', name: 'Дах', sub: '', z0: 1, z1: 99 }],
  heights: {},
  ui: { name, lead: 'для тесту', facts: [] },
})

describe('проріджування історії', () => {
  const DAY = 864e5, now = Date.UTC(2026, 9, 19, 12)
  it('свіжі 20 — усі; далі — остання за день (30 днів), давніші — остання за тиждень; не більше 80', () => {
    // 200 версій: по 10 на день упродовж 20 днів
    const rows = Array.from({ length: 200 }, (_, i) => ({ hid: 200 - i, updated: now - Math.floor(i / 10) * DAY - (i % 10) * 60e3 }))
    const drop = new Set(thinHistory(rows, now))
    const kept = rows.filter((r) => !drop.has(r.hid))
    expect(kept.slice(0, 20).map((r) => r.hid)).toEqual(rows.slice(0, 20).map((r) => r.hid))
    // після свіжих — по одній на кожен з решти днів (перші два дні вже в «свіжих»)
    expect(kept.length).toBe(20 + 18)
    const days = kept.slice(20).map((r) => Math.floor(r.updated / DAY))
    expect(new Set(days).size).toBe(days.length)
    // давні (понад 30 днів) — по тижнях; межа 80
    const old = Array.from({ length: 400 }, (_, i) => ({ hid: 1000 - i, updated: now - (40 + i) * DAY }))
    const keptOld = old.filter((r) => !new Set(thinHistory(old, now)).has(r.hid))
    expect(keptOld.length).toBeLessThanOrEqual(80)
    expect(keptOld.length).toBeGreaterThan(50)
  })
  it('службові примітки — мовою людини', () => {
    const t = (k, v) => `[${k}]${v ? JSON.stringify(v) : ''}`
    expect(noteText('Нова база', t)).toBe('[Нова база]')
    expect(noteText('Копія бази «Main»', t)).toBe('[Копія бази «{name}»]{"name":"Main"}')
    expect(noteText('Перетворено в деталі гри. щось', t)).toBe('[Перетворено в деталі гри. {notes}]{"notes":"щось"}')
    expect(noteText('своя примітка', t)).toBe('своя примітка')
  })
  it('правки калькулятора чистяться: службові ключі цілі, розмітки й чужих полів нема', () => {
    const c = cleanCalc({ qty: { 'row:foundation': 5, 'pl:Цистерна': -2, bad: 'x' }, removed: ['dev:shield', 3], extra: [{ kind: 'build', id: 'placeables/power generators|wind_turbine_directional', qty: 2, name: '<b>x</b>', icon: 'javascript:alert(1)' }, { kind: 'evil', id: 'x', qty: 1 }], dd: true, junk: 1 })
    expect(c).toEqual({ qty: { 'row:foundation': 5, 'pl:Цистерна': 0 }, removed: ['dev:shield'], extra: [{ kind: 'build', id: 'placeables/power generators|wind_turbine_directional', qty: 2, name: 'x' }], dd: true })
    expect(cleanCalc(null)).toBe(null)
  })
})

describe.each(ENGINES)('%s', (_name, pgCfg) => {
  let server, base, dir, app, db, store
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
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      put: (u, b) => call('PUT', u, b),
      patch: (u, b) => call('PATCH', u, b),
      del: (u) => call('DELETE', u),
      async signIn(email) {
        const r = await a.post('/api/auth/code', { email })
        if (r.status !== 200) return r
        return a.post('/api/auth/verify', { email, code: codeFor(email) })
      },
    }
    return a
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-bases-store-'))
    db = await openDb({ dataDir: dir, pg: pgCfg })
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    base = `http://127.0.0.1:${server.address().port}`
    store = await createBasesStore(db) // той самий стан таблиць, напряму
  })
  afterAll(async () => {
    server?.close()
    await app?.locals.close()
    if (db?.kind === 'pg') await db.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {})
    await db?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const admin = agent(), bob = agent(), eve = agent()

  it('вхід: адміністратор, Боб і Єва', async () => {
    expect((await admin.signIn('admin@example.com')).body.user.role).toBe('admin')
    expect((await bob.signIn('bob@example.com')).status).toBe(201)
    expect((await eve.signIn('eve@example.com')).status).toBe(201)
  })

  it('одночасні збереження від тієї самої версії: одне проходить, друге — конфлікт; історія з автором', async () => {
    const b = await store.create(tiny('Гонка'), 'Нова база', undefined, 'u-1')
    const [x, y] = await Promise.all([
      store.put(b.id, { ...tiny('Гонка А') }, 1, 'А', undefined, 'u-a'),
      store.put(b.id, { ...tiny('Гонка Б') }, 1, 'Б', undefined, 'u-b'),
    ])
    expect([x, y].filter((r) => r.conflict)).toHaveLength(1)
    const won = [x, y].find((r) => !r.conflict)
    expect(won.version).toBe(2)
    const h = await store.history(b.id)
    expect(h.map((r) => [r.version, r.author])).toEqual([[2, won.author], [1, 'u-1']])
    // відновлення: нова поточна з тим самим документом, автор — хто відновив
    const r = await store.restore(b.id, h[1].hid, 'u-r')
    expect(r).toMatchObject({ version: 3, note: 'Відновлено версію 1', author: 'u-r' })
    expect(r.doc.ui.name).toBe('Гонка')
    // список — з підсумку, без документа; назва — поточна
    const row = (await store.list(undefined, [b.id]))[0]
    expect(row).toMatchObject({ id: b.id, version: 3, name: 'Гонка' })
    expect(row.doc).toBeUndefined()
  })

  it('історія проріджується при збереженні', async () => {
    const b = await store.create(tiny('Багато'), '', undefined, null)
    let v = 1
    for (let i = 0; i < 30; i++) v = (await store.put(b.id, tiny(`Багато ${i}`), v, '', undefined, null)).version
    const h = await store.history(b.id)
    // поточна + 20 свіжих + по одній за сьогодні (решта того ж дня — геть)
    expect(h.length).toBe(1 + 21)
    expect(h[1].version).toBe(30)
  })

  it('історія — лише тим, хто змінює; автор — ім’ям; стерти назавжди — лише власник', async () => {
    const b = (await eve.post('/api/bases', { doc: tiny('Публічна Єви'), note: 'Нова база', visibility: 'public' })).body
    expect(b.note).toBe('Нова база')
    expect((await eve.put(`/api/bases/${b.id}`, { doc: tiny('Публічна Єви 2'), version: 1, note: 'правка' })).status).toBe(200)
    expect((await bob.get(`/api/bases/${b.id}`)).status).toBe(200)
    expect((await bob.get(`/api/bases/${b.id}/history`)).status).toBe(403)
    const h = await eve.get(`/api/bases/${b.id}/history`)
    expect(h.status).toBe(200)
    expect(h.body.rows.map((r) => r.version)).toEqual([2, 1])
    expect(h.body.rows[0].author).toMatchObject({ name: expect.any(String) })
    expect((await bob.get(`/api/bases/${b.id}/history/${h.body.rows[1].hid}`)).status).toBe(403)
    expect((await eve.get(`/api/bases/${b.id}/history/${h.body.rows[1].hid}`)).body.doc.ui.name).toBe('Публічна Єви')
    // кошик і стирання: чужому — як нема, власниці — можна
    expect((await eve.del(`/api/bases/${b.id}`)).status).toBe(200)
    expect((await bob.post(`/api/bases/${b.id}/purge`)).status).toBe(404)
    expect((await eve.post(`/api/bases/${b.id}/purge`)).status).toBe(200)
  })

  it('копія наявної: документ з сервера, «на основі …», лічильник копій, примітка службова', async () => {
    const src = (await eve.post('/api/bases', { doc: tiny('Оригінал'), visibility: 'public' })).body
    const cp = await bob.post('/api/bases', { from: src.id, name: 'Моя копія' })
    expect(cp.status).toBe(201)
    expect(cp.body.doc.ui.name).toBe('Моя копія')
    expect(cp.body.doc.pieces).toEqual(src.doc.pieces)
    expect(cp.body.note).toBe('Копія бази «Оригінал»')
    expect(cp.body.item).toMatchObject({ owner: { kind: 'user' }, visibility: 'private', basedOn: { kind: 'base', id: src.id, title: 'Оригінал' } })
    expect((await eve.get(`/api/bases/${src.id}`)).body.item.copies).toBe(1)
    // чужу приватну не скопіювати
    const priv = (await eve.post('/api/bases', { doc: tiny('Приватна') })).body
    expect((await bob.post('/api/bases', { from: priv.id, name: 'x' })).status).toBe(404)
  })

  it('правки калькулятора спільні: зберігає той, хто змінює; бачать усі; нова версія не з’являється', async () => {
    const b = (await eve.post('/api/bases', { doc: tiny('Калькулятор'), visibility: 'public' })).body
    const calc = { qty: { 'row:foundation': 7 }, removed: ['fuel'], extra: [] }
    expect((await eve.put(`/api/bases/${b.id}/calc`, { calc })).status).toBe(200)
    const seen = (await bob.get(`/api/bases/${b.id}`)).body
    expect(seen.calc).toEqual(calc)
    expect(seen.version).toBe(1)
    expect((await bob.put(`/api/bases/${b.id}/calc`, { calc: null })).status).toBe(403)
    expect((await eve.put(`/api/bases/${b.id}/calc`, { calc: null })).status).toBe(200)
    expect((await eve.get(`/api/bases/${b.id}`)).body.calc).toBe(null)
  })

  it('список баз: лише видимі, назва з підсумку після збереження', async () => {
    const b = (await eve.post('/api/bases', { doc: tiny('До'), note: '' })).body
    await eve.put(`/api/bases/${b.id}`, { doc: tiny('Після'), version: 1, note: '' })
    const mine = (await eve.get('/api/bases')).body.bases.find((x) => x.id === b.id)
    expect(mine).toMatchObject({ name: 'Після', version: 2, lead: 'для тесту' })
    expect((await bob.get('/api/bases')).body.bases.map((x) => x.id)).not.toContain(b.id)
  })
})

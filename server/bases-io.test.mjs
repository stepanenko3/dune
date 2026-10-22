// Вивантаження й імпорт баз — через справжній HTTP: файл → імпорт дає ту саму базу, хибні документи — зрозумілі
// помилки з місцем у документі, dryRun нічого не створює, чуже приватне не вивантажити. Обв'язка — як у app.test.mjs:
// запасна SQLite (тимчасова тека) і Postgres <DB_DATABASE>_testing зі Snotax console (якщо є), але у своїй схемі на
// кожен запуск — щоб не заважати app.test.mjs (він перестворює схему public тієї ж бази) і паралельним запускам.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { EXPORT_FORMAT, validateBase } from './lib/bases.mjs'
import { openDb } from './lib/sql.mjs'

const SCHEMA = `bases_io_${process.pid}_${Date.now().toString(36)}`
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

/** невеличка база з деталей: фундамент, стіна, станція, приміщення */
const tiny = (name = 'Тестова') => ({
  format: 2,
  claims: [{ x: -5, y: 0, w: 10, d: 10 }],
  pieces: [
    { id: 'p1', shape: 'Sardaukar_Foundation', x: 0.5, y: 0.5, z: 0, rot: 0 },
    { id: 'p2', shape: 'Sardaukar_Wall_01', x: 0.5, y: 0, z: 0, rot: 0 },
  ],
  items: [{ name: 'Верстак', kind: 'craft', w: 1.4, d: 1.6, h: 1.6, c: { x: 0.5, y: 0.5 }, z: 0, ang: 0 }],
  zones: [{ id: 'z1', name: 'Майстерня', group: 'craft', z: 0, tiles: ['500,500'] }],
  levels: [{ key: 'g', name: 'Рівень 0', sub: '', z0: 0, z1: 1 }, { key: 'r', name: 'Дах', sub: '', z0: 1, z1: 99 }],
  heights: {},
  ui: { name, lead: 'для тесту', facts: [] },
})

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
      return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) }
    }
    const a = {
      get: (u, h) => call('GET', u, undefined, h),
      post: (u, b = {}, h) => call('POST', u, b, h),
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-bases-io-'))
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

  it('вхід: адміністратор (перший), Боб і Єва', async () => {
    expect((await admin.signIn('admin@example.com')).body.user.role).toBe('admin')
    expect((await bob.signIn('bob@example.com')).status).toBe(201)
    expect((await eve.signIn('eve@example.com')).status).toBe(201)
  })

  it('вивантаження → імпорт: та сама база (давня з приміщень і нова з деталей)', async () => {
    const r = await fetch(`${base}/api/bases/main/export`, { headers: { cookie: '' } })
    expect(r.status).toBe(401) // вивантаження — лише після входу
    for (const id of ['main', 'dd']) {
      const src = (await admin.get(`/api/bases/${id}`)).body
      const ex = await admin.get(`/api/bases/${id}/export`)
      expect(ex.status).toBe(200)
      expect(ex.headers.get('content-disposition')).toBe(`attachment; filename="${id}-v${src.version}.json"`)
      expect(ex.body).toMatchObject({ format: EXPORT_FORMAT, id, version: src.version, name: src.doc.ui.name, site: { name: 'Sandwalkers' } })
      expect(Date.parse(ex.body.exportedAt)).toBeGreaterThan(0)
      const im = await admin.post('/api/bases/import', { doc: ex.body })
      expect(im.status).toBe(201)
      expect(im.body.errors).toEqual([])
      expect(im.body.id).not.toBe(id)
      const got = (await admin.get(`/api/bases/${im.body.id}`)).body
      expect(got.doc).toEqual(src.doc)
      expect(got.item).toMatchObject({ visibility: 'private', owner: { kind: 'user' } })
      expect(got.note).toBe(`Імпортовано з файлу: ${src.doc.ui.name} v${src.version} (Sandwalkers)`)
    }
    // своя база з деталей: файл → імпорт гільдії → знову файл — документ той самий
    const g = (await admin.get('/api/guilds/sandwalkers')).body.guild
    const mine = await admin.post('/api/bases', { doc: tiny('Деталі'), note: 'тест' })
    const ex = (await admin.get(`/api/bases/${mine.body.id}/export`)).body
    const im = await admin.post('/api/bases/import', { doc: ex, owner: { kind: 'guild', id: g.id }, visibility: 'guild' })
    expect(im.status).toBe(201)
    expect(im.body.summary).toMatchObject({ format: 2, pieces: 2, items: 1, zones: 1, levels: 1, claims: 1, name: 'Деталі' })
    expect(im.body.base.item).toMatchObject({ visibility: 'guild', owner: { tag: 'SW' } })
    expect((await admin.get(`/api/bases/${im.body.id}/export`)).body.doc).toEqual(ex.doc)
  }, 30_000) // дві повні бази туди й назад — під навантаженням усього набору тестів буває довше 5 с

  it('dryRun лише перевіряє: підсумок є, бази нема; сам документ (без обгортки) теж приймається', async () => {
    const before = (await bob.get('/api/bases')).body.bases.length
    const r = await bob.post('/api/bases/import', { doc: tiny('Пробна'), dryRun: true })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, errors: [], summary: { pieces: 2, items: 1, name: 'Пробна' } })
    expect(r.body.id).toBeUndefined()
    expect((await bob.get('/api/bases')).body.bases.length).toBe(before)
    // і назва з вікна імпорту — замість тієї, що у файлі
    const ok = await bob.post('/api/bases/import', { doc: tiny('Пробна'), name: 'Моя копія' })
    expect(ok.status).toBe(201)
    expect(ok.body.base.doc.ui.name).toBe('Моя копія')
    expect((await bob.get('/api/bases')).body.bases.length).toBe(before + 1)
  })

  it('хибні документи: 400, зрозумілі помилки з місцем у документі, нічого не створено', async () => {
    const before = (await bob.get('/api/bases')).body.bases.length
    const doc = tiny()
    doc.pieces.push({ id: 'p3', shape: 'death_star', x: 1, y: 'два', z: 0, rot: 0 }, 'не деталь')
    doc.items.push({ name: 'Без місця', kind: 'craft', w: -1 })
    doc.zones.push({ tiles: 'усе' })
    const r = await bob.post('/api/bases/import', { doc: { format: EXPORT_FORMAT, name: 'x', doc } })
    expect(r.status).toBe(400)
    expect(r.body.ok).toBe(false)
    const at = Object.fromEntries(r.body.errors.map((e) => [e.path, e.message]))
    expect(at['doc.pieces[2].shape']).toBe('невідома деталь «death_star»')
    expect(at['doc.pieces[2].y']).toBe('y має бути числом')
    expect(at['doc.pieces[3]']).toMatch(/деталь — це об’єкт/)
    expect(at['doc.items[1].c']).toMatch(/немає місця/)
    expect(at['doc.items[1].w']).toMatch(/більшим за нуль/)
    expect(at['doc.zones[1].name']).toBe('у приміщення немає назви')
    expect(at['doc.zones[1].tiles']).toMatch(/мають бути списком/)
    expect((await bob.get('/api/bases')).body.bases.length).toBe(before)

    // не база взагалі; чужий тип файлу; англійською — перекладено (ключ лишається український)
    expect((await bob.post('/api/bases/import', { doc: [1, 2] })).body.errors[0]).toMatchObject({ path: '', key: 'це не база: у файлі має бути об’єкт JSON із документом бази' })
    expect((await bob.post('/api/bases/import', { doc: { format: 'sandwalkers-roadmap/1', doc: {} } })).body.errors[0]).toMatchObject({ path: 'format', message: 'це не база, а «sandwalkers-roadmap/1»' })
    expect((await bob.post('/api/bases/import', { doc: { ui: { name: 'x' } } })).body.errors[0].message).toMatch(/немає ні деталей/)
    const en = await bob.post('/api/bases/import?lang=en', { doc: { format: 2, pieces: 'ні' } })
    expect(en.body.errors[0]).toMatchObject({ path: 'pieces', key: 'деталі мають бути списком', vars: null })
    expect(typeof en.body.errors[0].message).toBe('string')
  })

  it('дрібне виправляє саме, з попередженням: без назви, без ділянок, повтори деталей', () => {
    const doc = tiny()
    delete doc.ui.name
    doc.claims = []
    doc.pieces.push({ ...doc.pieces[1], id: 'p2' }, { ...doc.pieces[1], id: 'p9', x: 20.5 })
    const v = validateBase(doc)
    expect(v.errors).toEqual([])
    expect(v.doc.ui.name).toBe('База')
    expect(v.doc.pieces).toHaveLength(3) // однакова стіна на тому самому місці — одна
    expect(v.doc.claims).toEqual([{ x: 0, y: 0, w: 10, d: 10 }, { x: 10, y: 0, w: 10, d: 10 }, { x: 20, y: 0, w: 10, d: 10 }])
    const keys = v.warnings.map((w) => w.path)
    expect(keys).toEqual(expect.arrayContaining(['ui.name', 'claims', 'pieces']))
    // без перекладача — українською; з ним — тим, що він дає
    expect(validateBase({ format: 2, pieces: 'x' }, (k) => `[${k}]`).errors[0].message).toBe('[деталі мають бути списком]')
  })

  it('доступ: чужу особисту не вивантажити; гостю — ніяку (лише з входом і правом копіювати); імпорт — лише з входом', async () => {
    const own = await eve.post('/api/bases', { doc: tiny('Секрет Єви') })
    expect(own.body.item.visibility).toBe('private')
    expect((await eve.get(`/api/bases/${own.body.id}/export`)).status).toBe(200)
    expect((await bob.get(`/api/bases/${own.body.id}/export`)).status).toBe(404)
    expect((await anon.get(`/api/bases/${own.body.id}/export`)).status).toBe(401)
    await eve.patch(`/api/items/base/${own.body.id}/access`, { visibility: 'link' })
    expect((await anon.get(`/api/bases/${own.body.id}/export`)).status).toBe(401)
    expect((await bob.get(`/api/bases/${own.body.id}/export`)).status).toBe(200)
    expect((await anon.post('/api/bases/import', { doc: tiny(), dryRun: true })).status).toBe(401)
    // віддати імпорт чужій гільдії не можна
    const g = (await admin.get('/api/guilds/sandwalkers')).body.guild
    expect((await eve.post('/api/bases/import', { doc: tiny(), owner: { kind: 'guild', id: g.id } })).status).toBe(403)
  })

  it('кошик: видалена база — з позначкою в реєстрі й поза бібліотекою; стерти назавжди — лише з кошика', async () => {
    const b = (await eve.post('/api/bases', { doc: tiny('У кошик'), visibility: 'public' })).body
    expect((await anon.get('/api/library?kind=base')).body.rows.map((x) => x.id)).toContain(b.id)
    expect((await eve.post(`/api/bases/${b.id}/purge`)).status).toBe(409) // не в кошику
    await eve.del(`/api/bases/${b.id}`)
    const mine = (await eve.get('/api/items?scope=mine&kind=base')).body.rows.find((x) => x.id === b.id)
    expect(mine.deleted).toBeGreaterThan(0)
    expect((await anon.get('/api/library?kind=base')).body.rows.map((x) => x.id)).not.toContain(b.id)
    // чужа база в кошику для інших — як нема (стирає лише той, хто нею керує)
    expect((await bob.post(`/api/bases/${b.id}/purge`)).status).toBe(404)
    expect((await eve.post(`/api/bases/${b.id}/purge`)).status).toBe(200)
    expect((await eve.get(`/api/bases/${b.id}`)).status).toBe(404)
    expect((await eve.get('/api/items?scope=mine&kind=base')).body.rows.map((x) => x.id)).not.toContain(b.id)
  })
})

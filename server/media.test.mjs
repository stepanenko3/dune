// Медіатека: картинка з дозволеного джерела — один раз у сховище (webp, ключ з хешу вмісту, розміри й ThumbHash),
// запасна «…_D» для «…R_D», «нема» й збої, давній кеш проксі на диску, фонова задача (повтори, недоступне джерело),
// наші адреси в довіднику й документах роадмапів, проксі /catalog-icons|wiki|gt і /media (без private/).
// Обв'язка — як у spice.test.mjs: запасна SQLite (тимчасова тека) і Postgres <DB_DATABASE>_testing у своїй схемі.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from './lib/sql.mjs'
import { createStorage, mediaRoute } from './lib/storage.mjs'
import { createMedia, prepareImage, sourceOf, SOURCES } from './lib/media.mjs'
import { rgbaToThumbHash } from './lib/thumbhash.mjs'
import { createCatalog, iconSource } from './lib/catalog.mjs'
import { createCatalogRoutes } from './routes/catalog.mjs'
import { thumbHashToRGBA } from '../src/lib/thumbhash.ts'

const SCHEMA = `media_${process.pid}_${Date.now().toString(36)}`
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

const QL = SOURCES.ql.base, WIKI = SOURCES.wiki.base, GT = SOURCES.gt.base
const png = (r, g, b, w = 64, h = 32) => sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer()
const webp = (r, g, b) => sharp({ create: { width: 48, height: 48, channels: 4, background: { r, g, b, alpha: 0.5 } } }).webp().toBuffer()

/** «інтернет» для тестів: адреса → байти | статус | 'down' (мережа лягла); лічильник запитів */
function fakeNet(map) {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const v = typeof map[url] === 'function' ? map[url]() : map[url]
    if (v === 'down' || v === undefined) throw new TypeError('fetch failed')
    if (typeof v === 'number') return new Response('nope', { status: v })
    return new Response(v, { status: 200, headers: { 'content-type': 'image/png' } })
  }
  return { fetchImpl, calls }
}

describe('ThumbHash', () => {
  it('кодує й розкодовує: колір і пропорції зберігаються', async () => {
    const { data, info } = await sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 200, g: 120, b: 40, alpha: 1 } } }).raw().toBuffer({ resolveWithObject: true })
    const hash = rgbaToThumbHash(info.width, info.height, data)
    expect(hash.length).toBeGreaterThanOrEqual(5)
    expect(hash.length).toBeLessThan(40)
    const out = thumbHashToRGBA(hash)
    expect(out.w).toBeGreaterThan(out.h) // альбомна
    const mid = ((out.h >> 1) * out.w + (out.w >> 1)) * 4
    expect(Math.abs(out.rgba[mid] - 200)).toBeLessThan(25)
    expect(Math.abs(out.rgba[mid + 1] - 120)).toBeLessThan(25)
    expect(Math.abs(out.rgba[mid + 2] - 40)).toBeLessThan(25)
    expect(out.rgba[mid + 3]).toBe(255)
  })
  it('прозорість', async () => {
    const { data, info } = await sharp({ create: { width: 30, height: 30, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 0.3 } } }).raw().toBuffer({ resolveWithObject: true })
    const out = thumbHashToRGBA(rgbaToThumbHash(info.width, info.height, data))
    expect(out.rgba[3]).toBeLessThan(140)
  })
  it('більше 100×100 — помилка', () => {
    expect(() => rgbaToThumbHash(101, 10, new Uint8Array(101 * 40))).toThrow()
  })
})

describe('джерела й підготовка', () => {
  it('лише дозволені джерела й шляхи', () => {
    expect(sourceOf(QL + 'assets/Dune/GUI/X_D.webp')).toEqual({ id: 'ql', rel: 'assets/Dune/GUI/X_D.webp' })
    expect(sourceOf(QL + 'assets/Dune/../../x.webp')).toBeNull()
    expect(sourceOf('https://evil.example/x.png')).toBeNull()
    expect(sourceOf(WIKI + 'wiki/a/ab/T_X%28a%29.png')?.id).toBe('wiki')
    expect(sourceOf(GT + 'images/dune/x/y.webp')?.id).toBe('gt')
    expect(sourceOf(GT + 'data/en/skills.json')).toBeNull()
  })
  it('png → webp з ключем із хешу; webp лишається як є', async () => {
    const a = await prepareImage(await png(10, 20, 30))
    expect(a.key).toMatch(/^img\/[0-9a-f]{2}\/[0-9a-f]{32}\.webp$/)
    expect((await sharp(a.buf).metadata()).format).toBe('webp')
    expect([a.w, a.h]).toEqual([64, 32])
    expect(a.thumbhash).toMatch(/^[\w-]+$/)
    const raw = await webp(1, 2, 3)
    const b = await prepareImage(raw)
    expect(b.buf).toBe(raw)
    await expect(prepareImage(Buffer.from('not an image'))).rejects.toThrow()
  })
  it('іконка: кольоровий рендер, запасна — базова; спершу questlog, потім той самий шлях малими літерами', () => {
    const gt = (p) => GT + 'images/' + p.toLowerCase() + '.webp'
    const all = [QL + 'assets/Dune/I/T_AR_D.webp', gt('Dune/I/T_AR_D'), QL + 'assets/Dune/I/T_A_D.webp', gt('Dune/I/T_A_D')]
    expect(iconSource('assets/Dune/I/T_A_D')).toEqual({ src: all[0], alt: all.slice(1) })
    expect(iconSource('assets/Dune/I/T_AR_D')).toEqual({ src: all[0], alt: all.slice(1) })
    expect(iconSource('assets/Dune/I/T_A_D', { color: false })).toEqual({ src: all[2], alt: [all[3]] })
    expect(iconSource('assets/Dune/I/T_AR_D', { color: false })).toEqual({ src: all[0], alt: all.slice(1) })
    expect(iconSource('assets/DLC/X/T_B')).toEqual({ src: QL + 'assets/DLC/X/T_B.webp', alt: [gt('DLC/X/T_B')] })
    expect(iconSource('../x')).toBeNull()
  })
})

describe.each(ENGINES)('медіатека — %s', (_name, pgCfg) => {
  let dir, db, storage
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-media-'))
    db = await openDb({ dataDir: dir, pg: pgCfg })
    storage = createStorage({ dataDir: dir, env: {} })
    await db.exec('CREATE TABLE IF NOT EXISTS roadmaps (id TEXT PRIMARY KEY, doc TEXT NOT NULL, version INTEGER NOT NULL, created BIGINT NOT NULL, updated BIGINT NOT NULL)')
  })
  afterAll(async () => {
    await db?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('тягне один раз, кладе у сховище, однаковий вміст — один ключ; наша адреса з розмірами й заглушкою', async () => {
    const red = await png(255, 0, 0)
    const net = fakeNet({ [WIKI + 'wiki/a/ab/A.png']: red, [WIKI + 'wiki/b/bc/B.png']: red })
    const m = await createMedia({ db, storage, dataDir: dir, fetchImpl: net.fetchImpl })
    const r1 = await m.ensure(WIKI + 'wiki/a/ab/A.png')
    const r2 = await m.ensure(WIKI + 'wiki/a/ab/A.png')
    expect(r2).toBe(r1)
    expect(net.calls.length).toBe(1)
    const r3 = await m.ensure(WIKI + 'wiki/b/bc/B.png')
    expect(r3.key).toBe(r1.key)
    expect(await storage.has(r1.key)).toBe(true)
    expect(m.local(WIKI + 'wiki/a/ab/A.png')).toMatch(new RegExp(`^/media/${r1.key.replace(/\./g, '\\.')}#s=64x32&t=[\\w-]+$`))
    expect(m.local(WIKI + 'wiki/a/ab/A.png', { hash: false })).toBe('/media/' + r1.key)
    // ще не завантажене — наш проксі; чуже — нічого; наше — як є
    expect(m.local(WIKI + 'wiki/c/cd/C.png')).toBe('/catalog-wiki/wiki/c/cd/C.png')
    expect(m.local('https://evil.example/x.png')).toBeNull()
    expect(m.local('/media/img/aa/b.webp')).toBe('/media/img/aa/b.webp')
    // після перезапуску — з таблиці, без мережі
    const again = await createMedia({ db, storage, dataDir: dir, fetchImpl: net.fetchImpl })
    expect(again.found(WIKI + 'wiki/a/ab/A.png', { hash: false })).toBe('/media/' + r1.key)
    // номер стану — скільки картинок у медіатеці (без нових — той самий і після перезапуску)
    expect(again.epoch).toBe(2)
  })

  it('«…R_D» нема — базова «…_D»; нема нічого — null і запис «нема» (без повтору добу)', async () => {
    const base = await png(0, 255, 0)
    const net = fakeNet({ [QL + 'assets/Dune/I/T_BR_D.webp']: 403, [QL + 'assets/Dune/I/T_B_D.webp']: base, [QL + 'assets/Dune/I/T_C_D.webp']: 404 })
    const m = await createMedia({ db, storage, dataDir: dir, fetchImpl: net.fetchImpl })
    const r = await m.ensure(QL + 'assets/Dune/I/T_BR_D.webp', { alt: [QL + 'assets/Dune/I/T_B_D.webp'], remember: true })
    expect(r.key).toBe(m.row(QL + 'assets/Dune/I/T_B_D.webp').key)
    expect(await m.ensure(QL + 'assets/Dune/I/T_C_D.webp', { remember: true })).toBeNull()
    expect(m.row(QL + 'assets/Dune/I/T_C_D.webp').status).toBe('missing')
    const n = net.calls.length
    expect(await m.ensure(QL + 'assets/Dune/I/T_C_D.webp')).toBeNull()
    expect(net.calls.length).toBe(n)
  })

  it('запасне джерело лягло — наступне в ланцюжку; лише збої — не «нема», а збій', async () => {
    const ok = await png(4, 4, 4)
    const net = fakeNet({ [QL + 'assets/Dune/W/T_WR_D.webp']: 404, [GT + 'images/dune/w/t_wr_d.webp']: 'down', [QL + 'assets/Dune/W/T_W_D.webp']: ok })
    const m = await createMedia({ db, storage, dataDir: dir, fetchImpl: net.fetchImpl })
    const s = iconSource('assets/Dune/W/T_W_D')
    expect((await m.ensure(s.src, { alt: s.alt, remember: true })).status).toBe('ok')
    const net2 = fakeNet({ [QL + 'assets/Dune/V/T_VR_D.webp']: 404, [GT + 'images/dune/v/t_vr_d.webp']: 'down', [QL + 'assets/Dune/V/T_V_D.webp']: 404, [GT + 'images/dune/v/t_v_d.webp']: 404 })
    const m2 = await createMedia({ db, storage, dataDir: dir, fetchImpl: net2.fetchImpl })
    const v = iconSource('assets/Dune/V/T_V_D')
    await expect(m2.ensure(v.src, { alt: v.alt, remember: true })).rejects.toThrow()
    expect(m2.row(v.src).status).toBe('error')
  })

  it('мережа лягла — виняток (проксі віддасть 404), у задачі — запис збою', async () => {
    const net = fakeNet({ [GT + 'images/x/down.webp']: 'down' })
    const m = await createMedia({ db, storage, dataDir: dir, fetchImpl: net.fetchImpl })
    await expect(m.ensure(GT + 'images/x/down.webp')).rejects.toThrow()
    expect(m.row(GT + 'images/x/down.webp')).toBeNull()
    await expect(m.ensure(GT + 'images/x/down.webp', { remember: true })).rejects.toThrow()
    expect(m.row(GT + 'images/x/down.webp').status).toBe('error')
  })

  it('давній кеш проксі на диску переноситься без мережі', async () => {
    const f = path.join(dir, 'catalog', 'icons', 'assets', 'Dune', 'Old', 'T_Old_D.webp')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, await webp(9, 9, 9))
    const net = fakeNet({})
    const m = await createMedia({ db, storage, dataDir: dir, fetchImpl: net.fetchImpl })
    const r = await m.ensure(QL + 'assets/Dune/Old/T_Old_D.webp')
    expect(r.status).toBe('ok')
    expect(net.calls.length).toBe(0)
  })

  it('фонова задача: повтори, недоступне джерело не валить, адреси в роадмапах — наші', async () => {
    let flaky = 0
    const blue = await png(0, 0, 255, 20, 20)
    const map = {
      [GT + 'images/rm/one.webp']: blue,
      [GT + 'images/rm/flaky.webp']: () => (++flaky < 2 ? 'down' : blue),
      [QL + 'assets/Dune/K/T_K_D.webp']: await png(1, 1, 1),
    }
    for (let k = 0; k < 12; k++) map[WIKI + `wiki/d/de/Dead${k}.png`] = 'down'
    const net = fakeNet(map)
    const m = await createMedia({ db, storage, dataDir: dir, fetchImpl: net.fetchImpl })
    m.collect(async () => [{ src: QL + 'assets/Dune/K/T_K_D.webp' }, { src: 'https://evil.example/x.png' }, ...Array.from({ length: 12 }, (_, k) => ({ src: WIKI + `wiki/d/de/Dead${k}.png` }))])
    m.collect(async () => { throw new Error('збій переліку') })
    const doc = JSON.stringify({ stages: [{ body: `![a](${GT}images/rm/one.webp) і ![b](${GT}images/rm/flaky.webp) і ![c](https://evil.example/c.png)` }] })
    await db.run('INSERT INTO roadmaps (id, doc, version, created, updated) VALUES (?, ?, 3, 1, 1)', 'r1', doc)
    const before = m.epoch
    const log = []
    const st = await m.sync((...a) => log.push(a.join(' ')), { concurrency: 2, retries: 2, pause: 1 })
    expect(st.ok).toBe(3)
    expect(st.failed + st.skipped).toBe(12)
    expect(st.skipped).toBeGreaterThan(0) // після кількох збоїв поспіль решту відкладено
    expect(log.join('\n')).toMatch(/не відповідає/)
    expect(log.join('\n')).toMatch(/збій переліку/)
    expect(net.calls.some((u) => u.includes('evil'))).toBe(false)
    expect(m.epoch).toBeGreaterThan(before)
    const row = await db.get('SELECT doc, version FROM roadmaps WHERE id = ?', 'r1')
    expect(row.version).toBe(3)
    expect(row.doc).not.toContain('gaming.tools')
    expect(row.doc).toContain('](/media/img/')
    expect(row.doc).toContain('https://evil.example/c.png')
    // вдруге — нічого нового
    const st2 = await m.sync(() => {}, { retries: 1, pause: 1 })
    expect(st2.ok).toBe(0)
    expect(st2.docs).toBe(0)
  })

  it('проксі /catalog-icons|wiki|gt — зі сховища, R_D → _D, без «..», недоступне — 404; /media — без private/', async () => {
    const icon = await webp(5, 6, 7)
    const net = fakeNet({ [QL + 'assets/Dune/P/T_PR_D.webp']: 404, [GT + 'images/dune/p/t_pr_d.webp']: 404, [QL + 'assets/Dune/P/T_P_D.webp']: icon, [WIKI + 'wiki/e/ef/T_E%20(x).png']: await png(3, 3, 3), [GT + 'images/s/i.webp']: 'down', [QL + 'assets/DLC/Q/T_Q_D.webp']: 404, [GT + 'images/dlc/q/t_q_d.webp']: icon })
    const m = await createMedia({ db, storage, dataDir: dir, fetchImpl: net.fetchImpl })
    const app = express()
    app.use(createCatalogRoutes({ catalog: { get: async () => null }, game: {}, media: m }))
    app.use('/media', mediaRoute(storage))
    await storage.put('private/thumbs/x.jpg', Buffer.from('secret'))
    const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)) })
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      // questlog не має — той самий шлях малими літерами з іншого джерела
      const dlc = await fetch(base + '/catalog-icons/assets/DLC/Q/T_Q_D.webp')
      expect(dlc.status).toBe(200)
      const a = await fetch(base + '/catalog-icons/assets/Dune/P/T_PR_D.webp')
      expect(a.status).toBe(200)
      expect(Buffer.from(await a.arrayBuffer()).equals(icon)).toBe(true)
      // ім'я файлу — як у даних (encodeURIComponent), хоч би як його закодував браузер
      expect((await fetch(base + '/catalog-wiki/wiki/e/ef/T_E%20(x).png')).status).toBe(200)
      expect(m.row(WIKI + 'wiki/e/ef/T_E%20(x).png')?.status).toBe('ok')
      expect((await fetch(base + '/catalog-wiki/wiki/e/ef/T_E%20%28x%29.png')).status).toBe(200)
      expect((await fetch(base + '/catalog-gt/images/s/i.webp')).status).toBe(404)
      expect((await fetch(base + '/catalog-icons/assets/Dune/..%2F..%2F..%2Fetc/x.webp')).status).toBe(404)
      expect((await fetch(base + '/catalog-gt/images/../../x.webp')).status).toBe(404)
      const key = m.row(QL + 'assets/Dune/P/T_P_D.webp').key
      const media = await fetch(base + '/media/' + key)
      expect(media.status).toBe(200)
      expect(media.headers.get('cache-control')).toMatch(/immutable/)
      expect((await fetch(base + '/media/private/thumbs/x.jpg')).status).toBe(404)
      expect((await fetch(base + '/media/private%2Fthumbs%2Fx.jpg')).status).toBe(404)
    } finally {
      server.close()
    }
  })

  it('довідник: іконки й картинки модулів — наші адреси, етег — зі станом медіатеки', async () => {
    const gone = Object.fromEntries(iconSource('assets/Dune/G/T_G_D').alt.concat(iconSource('assets/Dune/G/T_G_D').src).map((u) => [u, 404]))
    const net = fakeNet({ [QL + 'assets/Dune/Z/T_ZR_D.webp']: await webp(1, 1, 1), [WIKI + 'wiki/f/fa/Z.png']: await png(2, 2, 2), [WIKI + 'wiki/1/1a/Gone.png']: 404, [WIKI + 'wiki/1/1b/Gone2.png']: 404, ...gone })
    const m = await createMedia({ db, storage, dataDir: dir, fetchImpl: net.fetchImpl })
    const raw = {
      etag: '"cen-abc"',
      items: [{ id: 'z', icon: 'assets/Dune/Z/T_Z_D' }, { id: 'y', icon: 'assets/Dune/Y/T_Y_D' }, { id: 'n', icon: null }, { id: 'gone', icon: 'assets/Dune/G/T_G_D' }],
      placeables: [{ id: 'p', icon: 'assets/Dune/Z/T_Z_D' }],
      recipes: [],
      buildables: [{ id: 'b', img: WIKI + 'wiki/f/fa/Z.png' }, { id: 'c', img: WIKI + 'wiki/0/0a/None.png' }, { id: 'p', img: WIKI + 'wiki/1/1a/Gone.png' }, { id: 'q', img: WIKI + 'wiki/1/1b/Gone2.png' }],
    }
    const catalog = createCatalog({ dataDir: dir, game: { catalog: async () => raw }, media: m })
    const imgs = await catalog.images()
    expect(imgs.map((x) => x.src)).toContain(QL + 'assets/Dune/Z/T_ZR_D.webp')
    await m.sync(() => {}, { retries: 1, pause: 1 })
    const c = await catalog.get('en')
    expect(c.items[0].icon).toMatch(/^\/media\/img\/.+\.webp$/)
    expect(c.items[1].icon).toBe('assets/Dune/Y/T_Y_D')
    expect(c.items[2].icon).toBeNull()
    // нема ніде — без іконки (сайт малює заглушку й не питає проксі)
    expect(c.items[3].icon).toBeNull()
    expect(c.buildables[0].img).toMatch(/^\/media\/img\/.+\.webp#s=64x32&t=/)
    expect(c.buildables[1].img).toBe('/catalog-wiki/wiki/0/0a/None.png')
    // картинки модуля нема — іконка пристрою з тим самим id; нема й її — без картинки
    expect(c.buildables[2].img).toBe(c.placeables[0].icon)
    expect(c.buildables[3].img).toBeNull()
    expect(c.etag).toBe(`"cen-abc-m${m.epoch}"`)
    expect(await catalog.get('en')).toBe(c)
    expect(JSON.stringify(c)).not.toMatch(/https?:\/\//)
  })
})

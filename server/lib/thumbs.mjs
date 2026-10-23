/*
 * Знімки 3D баз для прев'ю (список баз, головна) — малює сам сервер, без браузера й відеокарти: сцену будує той самий
 * рушій сайту (src/engine/view3d.js, камера 3/4, без підписів), растеризує її lib/raster.mjs в окремому потоці
 * (lib/thumb-worker.mjs — щоб не гальмувати відповіді API), sharp згладжує й стискає в JPEG. Файл —
 * data/thumbs/<id>-<версія>-<відбиток>.jpg; відбиток — з того, що впливає на картинку: код, що малює (рушій сцени,
 * растеризатор), і форми деталей (геометрія з pieces.js, а не весь файл — правка цін чи назв знімків не застарює).
 * Новий знімок — у фоні після кожного збереження, на старті сервера, якщо нема, і на запит; старі видаляються.
 * Знімок, що не вдався (помилка чи довше за TIMEOUT), позначається файлом <…>.err: цю версію не малюємо знову годину
 * (адреса в списку — null, і браузер показує заглушку, а не чекає). Браузер лише показує готову картинку.
 * Файли — у сховищі (lib/storage.mjs, RustFS) під private/thumbs/<ім'я>: не через /media, а лише маршрутом бази з
 * перевіркою доступу; давня тека data/thumbs переноситься туди один раз (thumbBox).
 * Своє фото бази (завантажили в панелі керування) — замість знімка: <id>-custom-<відбиток>.jpg, тією ж адресою
 * /api/bases/<id>/thumb.jpg (тож його бачить увесь сайт); прибрали — знову знімок. redraw — намалювати знімок заново.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createStorage } from './storage.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '..')
const require = createRequire(import.meta.url)
const W = 1600, H = 934
const SS = 2 // кадр удвічі більший — згладжування при зменшенні
// тло — світле небо з .three-wrap (index.css): полотно прозоре там, де нема піску
const SKY = [[0xf3, 0xe3, 0xcc], [0xe7, 0xc9, 0xa2]].map((c) => c.map((x) => x / 255))
/** код, що малює: зміна будь-якого — знімки наново */
const CODE = [
  ...['geom', 'convert', 'hydrate', 'stations3d', 'view3d'].map((n) => path.join(root, 'src/engine', `${n}.js`)),
  path.join(here, 'raster.mjs'),
  path.join(here, 'thumb-worker.mjs'),
]
const PIECES_FILE = path.join(root, 'src/engine/pieces.js')
/** скільки чекати знімок, поки потік не зупинимо */
const TIMEOUT = 90_000
/** скільки не пробувати знову версію, що не вдалась */
const RETRY = 3600_000
/** як часто перевіряти дати файлів коду (а не на кожен рядок списку) */
const RECHECK = 5000
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** відбиток форм деталей: геометрія кожної форми й те, з чого її малює сцена (без назв і цін) */
function shapesPrint() {
  delete require.cache[PIECES_FILE]
  const P = require(PIECES_FILE)
  const h = crypto.createHash('sha1')
  h.update(JSON.stringify([P.DIM, P.PRICE]))
  for (const [id, s] of Object.entries(P.SHAPES)) {
    const { name: _n, cost: _c, ...look } = s
    h.update(JSON.stringify([id, look, P.geom({ id: 'x', shape: id, x: 0.5, y: 0.5, z: 0, rot: 0 })]))
  }
  return h.digest('hex')
}

/**
 * Файли знімків у сховищі: імена — у пам'яті (список баз не питає сховище на кожен рядок; на старті — один перелік).
 * Давню теку dir переносимо у сховище один раз (позначка .moved; файли в теці лишаються, повторно не переносяться —
 * інакше перемальоване чи стерте поверталося б після перезапуску)
 */
function thumbBox({ storage, dir, log }) {
  const P = 'private/thumbs/'
  const index = new Map() // ім'я → коли записано
  const ready = (async () => {
    try {
      for (const f of await storage.list(P)) index.set(f.key.slice(P.length), f.modified || Date.now())
    } catch (e) { log.warn?.(`[thumbs] сховище недоступне: ${e.message}`); return }
    if (index.has('.moved')) return
    try {
      let n = 0
      for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        if (!/\.(jpg|err)$/.test(f) || index.has(f)) continue
        const file = path.join(dir, f)
        await storage.put(P + f, fs.readFileSync(file), f.endsWith('.jpg') ? 'image/jpeg' : 'text/plain; charset=utf-8')
        index.set(f, fs.statSync(file).mtimeMs)
        n++
      }
      await storage.put(P + '.moved', Buffer.from(String(n)), 'text/plain; charset=utf-8')
      index.set('.moved', Date.now())
      if (n) log.info?.(`[thumbs] перенесено у сховище: ${n}`)
    } catch (e) { log.warn?.(`[thumbs] перенесення у сховище: ${e.message}`) }
  })()
  return {
    ready,
    names: () => [...index.keys()],
    has: (n) => index.has(n),
    at: (n) => index.get(n) ?? 0,
    async put(n, buf, type = 'image/jpeg') { await storage.put(P + n, buf, type); index.set(n, Date.now()) },
    rm(n) { if (index.delete(n)) storage.del(P + n).catch((e) => log.warn?.(`[thumbs] ${n}: ${e.message}`)) },
    /** байти файлу; зник зі сховища — забуваємо (наступний запит намалює знову) */
    async read(n) {
      const f = await storage.get(P + n)
      if (!f) index.delete(n)
      return f?.buf ?? null
    },
  }
}

export function createThumbs({ dataDir, bases, log = console, storage = createStorage({ dataDir, env: {} }) }) {
  const box = thumbBox({ storage, dir: path.join(dataDir, 'thumbs'), log })
  const name = (id, v, st) => `${id}-${v}-${st}.jpg`
  const jobs = new Map()
  let queue = Promise.resolve()

  // відбиток: дати файлів перевіряємо не частіше RECHECK; змінилась — рахуємо наново
  let seen = { key: '', stamp: '', at: 0 }
  function stamp() {
    if (seen.stamp && Date.now() - seen.at < RECHECK) return seen.stamp
    const key = [...CODE, PIECES_FILE].map((f) => fs.statSync(f).mtimeMs).join(',')
    if (key !== seen.key) {
      const h = crypto.createHash('sha1')
      for (const f of CODE) h.update(fs.readFileSync(f))
      h.update(shapesPrint())
      seen = { key, stamp: h.digest('hex').slice(0, 8), at: Date.now() }
    } else seen.at = Date.now()
    return seen.stamp
  }

  /** свої фото баз: id → відбиток (зі сховища — один раз на старті, далі пам'ять) */
  const custom = new Map()
  const customFile = (id, tag) => `${id}-custom-${tag}.jpg`

  /** невдалі знімки: файл <id>-<v>-<відбиток>.err → коли; у пам'яті — щоб список не питав сховище на кожен рядок */
  const failed = new Map()
  const ready = box.ready.then(() => {
    for (const f of box.names()) {
      const m = /^(.+)-custom-([0-9a-f]{8})\.jpg$/.exec(f)
      if (m) custom.set(m[1], m[2])
      else if (f.endsWith('.err')) failed.set(f.slice(0, -4), box.at(f))
    }
  })
  const failedAt = (key) => {
    const at = failed.get(key)
    if (at && Date.now() - at < RETRY) return at
    if (at) { failed.delete(key); box.rm(key + '.err') }
    return 0
  }
  /** знімок для відповіді: { name, tag, read() → байти JPEG | null } */
  const shot = (n, tag, extra = {}) => ({ name: n, tag, ...extra, read: () => box.read(n) })

  /** JPEG бази: окремий потік на кожен знімок (рушій щоразу свіжий, пам'ять звільняється); довше TIMEOUT — зупиняємо */
  const draw = (doc) =>
    new Promise((resolve, reject) => {
      const w = new Worker(path.join(here, 'thumb-worker.mjs'), { workerData: { doc, width: W, height: H, ss: SS, sky: SKY } })
      const timer = setTimeout(() => { reject(new Error(`знімок довший за ${TIMEOUT / 1000} с`)); w.terminate() }, TIMEOUT)
      timer.unref?.()
      // під node --watch потік ще й шле службові повідомлення (які модулі підвантажив) — беремо лише байти знімка
      w.on('message', (jpg) => { if (!ArrayBuffer.isView(jpg) && !(jpg instanceof ArrayBuffer)) return; clearTimeout(timer); resolve(Buffer.from(jpg)); w.terminate() })
      w.once('error', (e) => { clearTimeout(timer); reject(e) })
      w.once('exit', (code) => { clearTimeout(timer); if (code) reject(new Error(`потік знімка завершився з кодом ${code}`)) })
    })

  /** адреса знімка: з версією й відбитком — браузер кешує її назавжди; знімок не вдався — null (заглушка) */
  const url = (id, version) => {
    if (custom.has(id)) return `/api/bases/${id}/thumb.jpg?v=c-${custom.get(id)}`
    const st = stamp()
    return failedAt(`${id}-${version}-${st}`) ? null : `/api/bases/${id}/thumb.jpg?v=${version}-${st}`
  }

  /**
   * знімок поточної версії бази: { name, tag, read } (готовий чи новий; tag — як у ?v= адреси); null — такої бази нема.
   * Документ читаємо лише тоді, коли треба малювати; невдалу версію годину не малюємо (виняток одразу)
   */
  async function ensure(id) {
    await ready
    const h = await bases.head(id)
    if (!h) return null
    if (custom.has(id)) return shot(customFile(id, custom.get(id)), `c-${custom.get(id)}`, { custom: true })
    const st = stamp(), tag = `${h.version}-${st}`, key = `${id}-${tag}`
    const file = name(id, h.version, st)
    if (box.has(file)) return shot(file, tag)
    if (failedAt(key)) throw new Error('знімок цієї версії не вдався')
    if (jobs.has(key)) return jobs.get(key)
    const job = queue.then(async () => {
      const t0 = Date.now()
      try {
        const b = await bases.get(id)
        if (!b) return null
        const jpg = await draw(b.doc)
        await box.put(file, jpg)
        // старі знімки й позначки невдач цієї бази — геть
        const old = new RegExp(`^${id}-\\d+(-[0-9a-f]+)?\\.(jpg|err)$`)
        for (const f of box.names()) if (old.test(f) && f !== file) { box.rm(f); failed.delete(f.replace(/\.(jpg|err)$/, '')) }
        log.info?.(`[thumbs] ${id} v${h.version} — ${Date.now() - t0} мс`)
        return shot(file, tag)
      } catch (e) {
        log.warn?.(`[thumbs] ${id} v${h.version}: ${String(e?.message || e).split('\n')[0]}`)
        failed.set(key, Date.now())
        await box.put(key + '.err', Buffer.from(String(e?.message || e).slice(0, 500)), 'text/plain; charset=utf-8').catch(() => { /* без позначки — спробуємо знову після перезапуску */ })
        throw e
      } finally {
        jobs.delete(key)
      }
    })
    queue = job.catch(() => {})
    jobs.set(key, job)
    return job
  }

  /** знімки всіх баз, яких ще нема (на старті сервера, щогодини): { total, drawn, failed } */
  async function warm() {
    await ready
    const list = (await bases.list()).filter((b) => !b.deleted)
    let drawn = 0, bad = 0
    await Promise.all(list.map(async (b) => {
      const st = stamp(), had = custom.has(b.id) || box.has(name(b.id, b.version, st))
      try { await ensure(b.id); if (!had) drawn++ } catch { bad++ }
    }))
    return { total: list.length, drawn, failed: bad }
  }

  /** намалювати знімок поточної версії заново (навіть якщо він є чи щойно не вдався): { name, tag, read } | null */
  async function redraw(id) {
    await ready
    const h = await bases.head(id)
    if (!h) return null
    const st = stamp(), key = `${id}-${h.version}-${st}`
    if (!jobs.has(key)) {
      box.rm(name(id, h.version, st))
      box.rm(key + '.err')
      failed.delete(key)
    }
    const had = custom.get(id)
    custom.delete(id) // ensure малює знімок, а не віддає своє фото
    try { return await ensure(id) } finally { if (had && !custom.has(id) && box.has(customFile(id, had))) custom.set(id, had) }
  }

  /** своє фото бази: будь-яке зображення → JPEG розміру знімка (обрізане по центру); { tag } */
  async function setCustom(id, buf) {
    const jpg = await sharp(buf, { limitInputPixels: 64e6 }).rotate().resize(W, H, { fit: 'cover' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer()
    const tag = crypto.createHash('sha1').update(jpg).digest('hex').slice(0, 8)
    await ready
    await box.put(customFile(id, tag), jpg)
    const old = custom.get(id)
    custom.set(id, tag)
    if (old && old !== tag) box.rm(customFile(id, old))
    return { tag }
  }
  /** прибрати своє фото — знову знімок */
  function dropCustom(id) {
    const old = custom.get(id)
    custom.delete(id)
    if (old) box.rm(customFile(id, old))
  }
  /** стан фото бази для панелі: своє чи знімок і адреса (null — знімок не вдався) */
  const photo = (id, version) => ({ custom: custom.has(id), url: url(id, version) })

  /** базу стерто назавжди — її знімки, позначки й своє фото теж */
  function drop(id) {
    const re = new RegExp(`^${esc(id)}-(\\d+-[0-9a-f]{8}\\.(jpg|err)|custom-[0-9a-f]{8}\\.jpg)$`)
    for (const f of box.names()) if (re.test(f)) { box.rm(f); failed.delete(f.replace(/\.(jpg|err)$/, '')) }
    custom.delete(id)
  }

  return { ensure, url, warm, drop, redraw, setCustom, dropCustom, photo, ready }
}

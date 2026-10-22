/*
 * Знімки 3D баз для прев'ю (список баз, головна) — малює сам сервер, без браузера й відеокарти: сцену будує той самий
 * рушій сайту (src/engine/view3d.js, камера 3/4, без підписів), растеризує її lib/raster.mjs в окремому потоці
 * (lib/thumb-worker.mjs — щоб не гальмувати відповіді API), sharp згладжує й стискає в JPEG. Файл —
 * data/thumbs/<id>-<версія>-<відбиток>.jpg; відбиток — з того, що впливає на картинку: код, що малює (рушій сцени,
 * растеризатор), і форми деталей (геометрія з pieces.js, а не весь файл — правка цін чи назв знімків не застарює).
 * Новий знімок — у фоні після кожного збереження, на старті сервера, якщо нема, і на запит; старі видаляються.
 * Знімок, що не вдався (помилка чи довше за TIMEOUT), позначається файлом <…>.err: цю версію не малюємо знову годину
 * (адреса в списку — null, і браузер показує заглушку, а не чекає). Браузер лише показує готову картинку.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'

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

export function createThumbs({ dataDir, bases, log = console }) {
  const dir = path.join(dataDir, 'thumbs')
  fs.mkdirSync(dir, { recursive: true })
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

  /** невдалі знімки: файл <id>-<v>-<відбиток>.err → коли; у пам'яті — щоб список не питав диск на кожен рядок */
  const failed = new Map()
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.err')) continue
    try { failed.set(f.slice(0, -4), fs.statSync(path.join(dir, f)).mtimeMs) } catch { /* щойно прибрали */ }
  }
  const failedAt = (key) => {
    const at = failed.get(key)
    if (at && Date.now() - at < RETRY) return at
    if (at) { failed.delete(key); fs.rmSync(path.join(dir, key + '.err'), { force: true }) }
    return 0
  }

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
    const st = stamp()
    return failedAt(`${id}-${version}-${st}`) ? null : `/api/bases/${id}/thumb.jpg?v=${version}-${st}`
  }

  /**
   * знімок поточної версії бази: { file, tag } (з диска чи новий; tag — як у ?v= адреси); null — такої бази нема.
   * Документ читаємо лише тоді, коли треба малювати; невдалу версію годину не малюємо (виняток одразу)
   */
  async function ensure(id) {
    const h = await bases.head(id)
    if (!h) return null
    const st = stamp(), tag = `${h.version}-${st}`, key = `${id}-${tag}`
    const file = path.join(dir, name(id, h.version, st))
    if (fs.existsSync(file)) return { file, tag }
    if (failedAt(key)) throw new Error('знімок цієї версії не вдався')
    if (jobs.has(key)) return jobs.get(key)
    const job = queue.then(async () => {
      const t0 = Date.now()
      try {
        const b = await bases.get(id)
        if (!b) return null
        const jpg = await draw(b.doc)
        fs.writeFileSync(file + '.tmp', jpg)
        fs.renameSync(file + '.tmp', file)
        // старі знімки й позначки невдач цієї бази — геть
        const old = new RegExp(`^${id}-\\d+(-[0-9a-f]+)?\\.(jpg|err)$`)
        for (const f of fs.readdirSync(dir)) if (old.test(f) && f !== path.basename(file)) { fs.rmSync(path.join(dir, f), { force: true }); failed.delete(f.replace(/\.(jpg|err)$/, '')) }
        log.info?.(`[thumbs] ${id} v${h.version} — ${Date.now() - t0} мс`)
        return { file, tag }
      } catch (e) {
        log.warn?.(`[thumbs] ${id} v${h.version}: ${String(e?.message || e).split('\n')[0]}`)
        failed.set(key, Date.now())
        try { fs.writeFileSync(path.join(dir, key + '.err'), String(e?.message || e).slice(0, 500)) } catch { /* без позначки — спробуємо знову після перезапуску */ }
        throw e
      } finally {
        jobs.delete(key)
      }
    })
    queue = job.catch(() => {})
    jobs.set(key, job)
    return job
  }

  /** знімки всіх баз, яких ще нема (на старті сервера, щогодини) */
  async function warm() {
    for (const b of await bases.list()) if (!b.deleted) ensure(b.id).catch(() => {})
  }

  /** базу стерто назавжди — її знімки й позначки теж */
  function drop(id) {
    const re = new RegExp(`^${String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+-[0-9a-f]{8}\\.(jpg|err)$`)
    for (const f of fs.readdirSync(dir)) if (re.test(f)) { fs.rmSync(path.join(dir, f), { force: true }); failed.delete(f.replace(/\.(jpg|err)$/, '')) }
  }

  return { ensure, url, warm, drop }
}

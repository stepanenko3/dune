/*
 * Медіатека: картинки з дозволених зовнішніх джерел (іконки предметів і навичок, картинки модулів, техніки, роадмапів —
 * у серверних файлах гри пікселів нема) сервер тягне сам один раз і кладе у сховище (lib/storage.mjs, RustFS) під
 * незмінним ключем img/<хеш вмісту>.webp; браузер бере їх лише з нашого /media/<ключ> і на чужі сайти не ходить.
 * Таблиця media: адреса джерела → ключ, розміри, ThumbHash (розмита заглушка, lib/thumbhash.mjs) і стан
 * (ok — є; missing — джерело каже «нема», перевіряємо знову не раніше ніж за добу; error — збій, повтор наступним запуском).
 * Наша адреса картинки — /media/<ключ>#s=<ш>x<в>&t=<відбиток>: розміри й заглушка їдуть разом з адресою (фрагмент
 * браузер не надсилає й на кеш він не впливає). Ще не завантажене — наш проксі (/catalog-icons, /catalog-wiki,
 * /catalog-gt: routes/catalog.mjs), який дотягне його в медіатеку з першого ж запиту.
 * Масово — фонова задача media-sync (sync()): відомі картинки довідника й умінь, картинки в роадмапах; давній кеш
 * проксі на диску (data/catalog/icons|wiki) переноситься у сховище без мережі. Адреси картинок у документах
 * роадмапів задача замінює на наші (без нової версії: вміст той самий).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { rgbaToThumbHash, thumbHashToText } from './thumbhash.mjs'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Sandwalkers/2'

/**
 * Дозволені джерела: початок адреси, шлях (лише такі файли), наш проксі (ще не завантажене) і давній кеш на диску.
 * Будь-яка інша адреса — не наша справа (null): сервер не тягне що завгодно на чуже прохання.
 */
export const SOURCES = {
  // іконки предметів, пристроїв і навичок (шлях текстури гри)
  ql: { base: 'https://cdn.questlog.gg/dune-awakening/', path: /^assets\/(Dune|DLC)\/[\w/.-]+\.webp$/, route: '/catalog-icons/', disk: 'icons' },
  // картинки будівельних модулів і техніки (імена — як у текстур гри)
  wiki: { base: 'https://media.awakening.wiki/', path: /^wiki\/[0-9a-f]\/[0-9a-f]{2}\/[\w.%()'-]+\.(png|jpe?g|webp)$/i, route: '/catalog-wiki/', disk: 'wiki' },
  // ті самі іконки (шлях текстури гри малими літерами — і тих, яких нема вище), іконки спеціалізацій, картинки в роадмапах
  gt: { base: 'https://cdn-hosted.gaming.tools/dune/', path: /^images\/[\w/.%-]+\.(webp|png|jpe?g)$/i, route: '/catalog-gt/', disk: null },
}
/** шлях без «..», «.» і порожніх сегментів */
const plainPath = (p) => !p.split('/').some((s) => s === '..' || s === '.' || s === '')

/** чужа адреса → { id, rel } дозволеного джерела; інше — null */
export function sourceOf(url) {
  const u = String(url || '')
  for (const [id, s] of Object.entries(SOURCES)) {
    if (!u.startsWith(s.base)) continue
    const rel = u.slice(s.base.length)
    return s.path.test(rel) && plainPath(rel) ? { id, rel } : null
  }
  return null
}
/** адреса джерела за шляхом у проксі (/catalog-icons/<rel>) — лише дозволені; інакше null */
export function srcOf(id, rel) {
  const s = SOURCES[id]
  return s && s.path.test(rel) && plainPath(rel) ? s.base + rel : null
}

/** іконка гри (шлях текстури без розширення) → адреси на джерелах: спершу questlog, потім той самий шлях малими літерами */
const iconUrls = (p) => [srcOf('ql', `${p}.webp`), srcOf('gt', `images/${p.replace(/^assets\//, '').toLowerCase()}.webp`)].filter(Boolean)

/**
 * іконка гри → { src, alt } для медіатеки. color — сайт показує кольоровий рендер (…R_D), а якщо його нема (у кожної
 * четвертої) — базову (…_D); без color — саме цю, а запасна для «…R_D» — та сама «…_D»
 */
export function iconSource(icon, { color = true } = {}) {
  if (!icon) return null
  const p = String(icon)
  const base = p.replace(/R_D$/, '_D')
  const want = color && /_D$/.test(p) ? base.replace(/_D$/, 'R_D') : p
  const list = [...iconUrls(want), ...(want !== base ? iconUrls(base) : [])]
  return list.length ? { src: list[0], alt: list.slice(1) } : null
}

/** картинки в markdown-тексті документів: ![назва](адреса) */
const MD_IMG = /!\[[^\]]*\]\((https?:\/\/[^)\s"\\]+)\)/g
/** таблиці з документами (JSON у doc), де бувають картинки: роадмапи й сторінки сайту */
const DOC_TABLES = ['roadmaps', 'docs']

/** «нема» на джерелі: S3/CloudFront на відсутній файл відповідають і 403 */
const MISSING = new Set([403, 404, 410])
/** «нема» перевіряємо знову не раніше ніж за добу */
const MISS_MS = 24 * 3600_000
/** найбільша картинка, яку беремо, і найбільша сторона в медіатеці */
const MAX_BYTES = 15 * 1024 * 1024
const MAX_SIDE = 2048
/** стільки збоїв поспіль — джерело вважаємо недоступним до наступного запуску */
const BREAKER = 8

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * картинка → webp (webp лишаємо як є, якщо не завелика) + розміри й ThumbHash; ключ — з хешу вмісту.
 * Не картинка — помилка
 */
export async function prepareImage(buf) {
  const meta = await sharp(buf, { failOn: 'none' }).metadata()
  if (!meta.width || !meta.height) throw new Error('не картинка')
  const big = Math.max(meta.width, meta.height) > MAX_SIDE
  const out = meta.format === 'webp' && !big && !(meta.pages > 1)
    ? buf
    : await sharp(buf, { failOn: 'none' }).rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 86, alphaQuality: 100, effort: 5 }).toBuffer()
  const size = out === buf ? meta : await sharp(out).metadata()
  const { data, info } = await sharp(out).resize(100, 100, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const hex = crypto.createHash('sha256').update(out).digest('hex')
  return { buf: out, key: `img/${hex.slice(0, 2)}/${hex.slice(2, 34)}.webp`, w: size.width, h: size.height, thumbhash: thumbHashToText(rgbaToThumbHash(info.width, info.height, data)) }
}

/** фрагмент адреси з розмірами й заглушкою: #s=128x128&t=… */
export const fragmentOf = (r) => {
  const parts = [r.w && r.h ? `s=${r.w}x${r.h}` : '', r.thumbhash ? `t=${r.thumbhash}` : ''].filter(Boolean)
  return parts.length ? '#' + parts.join('&') : ''
}

/** fetchImpl — для тестів; now — годинник */
export async function createMedia({ db, storage, dataDir, log = console, fetchImpl = (...a) => fetch(...a), now = Date.now }) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      src TEXT PRIMARY KEY, key TEXT, type TEXT, w INTEGER, h INTEGER, bytes INTEGER, thumbhash TEXT,
      status TEXT NOT NULL DEFAULT 'new', tries INTEGER NOT NULL DEFAULT 0, error TEXT, fetched BIGINT, checked BIGINT
    );
  `)
  /** src → рядок (усю таблицю тримаємо в пам'яті: кілька тисяч рядків) */
  const rows = new Map()
  for (const r of await db.all('SELECT * FROM media')) rows.set(r.src, r)
  /** ключі, що точно є у сховищі */
  const stored = new Set([...rows.values()].filter((r) => r.status === 'ok').map((r) => r.key))
  /** «нема» з проксі (адреси від відвідувачів у таблицю не пишемо — їх можна вигадати безліч): src → коли */
  const missRam = new Map()
  const flight = new Map()
  /** звідки ще брати перелік картинок для фонової задачі: async () => [{ src, alt? }] */
  const collectors = []
  /** стан для адрес у довіднику — скільки картинок у медіатеці (лише росте): той самий номер — ті самі адреси, і після перезапуску */
  const okCount = () => { let n = 0; for (const r of rows.values()) if (r.status === 'ok') n++; return n }
  let epoch = okCount()

  async function save(r) {
    rows.set(r.src, r)
    await db.run(`INSERT INTO media (src, key, type, w, h, bytes, thumbhash, status, tries, error, fetched, checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (src) DO UPDATE SET key = excluded.key, type = excluded.type, w = excluded.w, h = excluded.h, bytes = excluded.bytes, thumbhash = excluded.thumbhash,
        status = excluded.status, tries = excluded.tries, error = excluded.error, fetched = excluded.fetched, checked = excluded.checked`,
    r.src, r.key ?? null, r.type ?? null, r.w ?? null, r.h ?? null, r.bytes ?? null, r.thumbhash ?? null, r.status, r.tries ?? 0, r.error ?? null, r.fetched ?? null, r.checked ?? null)
    return r
  }

  /** давній кеш проксі на диску (до медіатеки): data/catalog/icons|wiki/<шлях> */
  const oldFile = (src) => {
    const s = sourceOf(src)
    const d = s && SOURCES[s.id].disk
    return d && dataDir ? path.join(dataDir, 'catalog', d, ...s.rel.split('/')) : null
  }

  async function download(url) {
    const r = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'image/avif,image/webp,image/png,image/*;q=0.8' }, signal: AbortSignal.timeout(20_000) })
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e }
    if (Number(r.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('завелика картинка')
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length > MAX_BYTES) throw new Error('завелика картинка')
    return buf
  }

  /** байти картинки → у сховище (якщо такого вмісту ще нема) і рядок ok */
  async function ingest(src, buf) {
    const p = await prepareImage(buf)
    if (!stored.has(p.key)) {
      if (!(await storage.has(p.key))) await storage.put(p.key, p.buf, 'image/webp')
      stored.add(p.key)
    }
    const t = now()
    return save({ src, key: p.key, type: 'image/webp', w: p.w, h: p.h, bytes: p.buf.length, thumbhash: p.thumbhash, status: 'ok', tries: 0, error: null, fetched: t, checked: t })
  }

  /**
   * картинка в медіатеці: рядок ok; null — на джерелі нема (і запасних alt теж: «…R_D» → «…_D»); збій мережі — виняток.
   * remember — «нема» й збої пишемо в таблицю (фонова задача; проксі — лише в пам'ять); force — перевірити «нема» знову
   */
  function ensure(src, { alt = [], remember = false, force = false } = {}) {
    const row = rows.get(src)
    if (row?.status === 'ok') return Promise.resolve(row)
    if (!force && row?.status === 'missing' && now() - (row.checked || 0) < MISS_MS) return Promise.resolve(null)
    const ram = missRam.get(src)
    if (!force && ram && now() - ram < MISS_MS) return Promise.resolve(null)
    if (!sourceOf(src)) return Promise.resolve(null)
    if (flight.has(src)) return flight.get(src)
    const job = (async () => {
      const file = oldFile(src)
      let buf = file ? await fs.promises.readFile(file).catch(() => null) : null
      if (!buf) {
        try {
          buf = await download(src)
        } catch (e) {
          if (!MISSING.has(e.status)) {
            if (remember) await save({ ...(row || {}), src, key: row?.key ?? null, status: 'error', tries: (row?.tries ?? 0) + 1, error: String(e.message).slice(0, 300), checked: now() })
            throw e
          }
          // нема — запасна картинка (кольорового рендеру «…R_D» нема в кожної четвертої — тоді базова «…_D»)
          // запасне джерело не відповідає — пробуємо наступне; «нема» лише тоді, коли всі сказали «нема»
          let down = null
          for (const a of alt) {
            try {
              const r = await ensure(a, { remember, force })
              if (r) return save({ ...r, src, tries: 0, error: null, checked: now() })
            } catch (x) { down ??= x }
          }
          if (down) {
            if (remember) await save({ ...(row || {}), src, key: row?.key ?? null, status: 'error', tries: (row?.tries ?? 0) + 1, error: String(down.message).slice(0, 300), checked: now() })
            throw down
          }
          if (remember) await save({ src, key: null, status: 'missing', tries: (row?.tries ?? 0) + 1, error: `HTTP ${e.status}`, checked: now() })
          else { if (missRam.size > 5000) missRam.clear(); missRam.set(src, now()) }
          return null
        }
      }
      return ingest(src, buf)
    })().finally(() => flight.delete(src))
    flight.set(src, job)
    return job
  }

  /** вміст картинки для проксі: { buf, type } чи null; зниклий зі сховища файл — тягнемо знову */
  async function open(src, opts) {
    let r = await ensure(src, opts)
    if (!r) return null
    let f = await storage.get(r.key)
    if (!f) {
      stored.delete(r.key)
      rows.delete(src)
      r = await ensure(src, opts)
      f = r && (await storage.get(r.key))
    }
    return f
  }

  /** наша адреса /media/… — лише якщо картинка вже в медіатеці (з розмірами й заглушкою, якщо hash); інакше null */
  function found(src, { hash = true } = {}) {
    const r = rows.get(src)
    return r?.status === 'ok' && r.key ? storage.url(r.key) + (hash ? fragmentOf(r) : '') : null
  }

  /**
   * наша адреса для картинки: уже наша (/…) — як є; з медіатеки — /media/…; дозволене джерело, ще не завантажене, —
   * наш проксі; чужа невідома — null (такої картинки не показуємо)
   */
  function local(url, opts) {
    if (!url) return null
    const u = String(url)
    if (u.startsWith('/') && !u.startsWith('//')) return u
    const s = sourceOf(u)
    if (!s) return null
    return found(u, opts) ?? SOURCES[s.id].route + s.rel
  }

  /** картинки в документах: [{ table, id, doc, urls }] */
  async function docImages() {
    const out = []
    for (const table of DOC_TABLES) {
      let list = []
      try { list = await db.all(`SELECT id, doc FROM ${table}`) } catch { continue } // таблиці ще нема
      for (const r of list) {
        const urls = [...String(r.doc).matchAll(MD_IMG)].map((m) => m[1]).filter((u) => sourceOf(u))
        if (urls.length) out.push({ table, id: r.id, doc: r.doc, urls: [...new Set(urls)] })
      }
    }
    return out
  }

  /** адреси картинок у документах → наші (лише вже завантажені); версія документа не міняється — вміст той самий */
  async function rewriteDocs(list) {
    let n = 0
    for (const d of list) {
      let doc = d.doc
      for (const u of d.urls) {
        const to = found(u)
        if (to) doc = doc.split(`](${u})`).join(`](${to})`)
      }
      if (doc === d.doc) continue
      // лише якщо документ не змінився, поки ми тягли картинки (інакше — наступного запуску)
      const r = await db.run(`UPDATE ${d.table} SET doc = ? WHERE id = ? AND doc = ?`, doc, d.id, d.doc)
      n += r.changes || 0
    }
    return n
  }

  /**
   * Фонова задача: усе відоме — у медіатеку (паралельно concurrency, кожну — до retries спроб), потім адреси в
   * документах. Джерело, що поспіль не відповідає, до кінця запуску не чіпаємо. Падати не має: лише журнал.
   */
  async function sync(say = () => {}, { concurrency = 4, retries = 3, pause = 1000 } = {}) {
    const want = new Map() // src → alt
    for (const fn of collectors) {
      try {
        for (const x of await fn()) if (x?.src && sourceOf(x.src) && !want.has(x.src)) want.set(x.src, x.alt ?? [])
      } catch (e) { say('⚠ перелік картинок:', e.message) }
    }
    const docs = await docImages()
    for (const d of docs) for (const u of d.urls) if (!want.has(u)) want.set(u, [])
    const todo = [...want].filter(([src]) => {
      const r = rows.get(src)
      return !r || (r.status !== 'ok' && !(r.status === 'missing' && now() - (r.checked || 0) < MISS_MS))
    })
    const have = [...want.keys()].filter((s) => rows.get(s)?.status === 'ok').length
    say(`картинок відомо: ${want.size}, уже в медіатеці: ${have}, до завантаження: ${todo.length}`)
    const st = { ok: 0, missing: 0, failed: 0, skipped: 0 }
    const streak = new Map() // джерело → збоїв поспіль
    const down = new Set()
    let i = 0
    const worker = async () => {
      while (i < todo.length) {
        const [src, alt] = todo[i++]
        const sid = sourceOf(src).id
        if (down.has(sid)) { st.skipped++; continue }
        for (let k = 1; ; k++) {
          try {
            const r = await ensure(src, { alt, remember: true, force: true })
            if (r) st.ok++
            else st.missing++
            streak.set(sid, 0)
            break
          } catch (e) {
            if (k < retries) { await sleep(pause * 3 ** (k - 1)); continue }
            st.failed++
            if (st.failed <= 20) say(`⚠ ${src}: ${e.message}`)
            const s = (streak.get(sid) ?? 0) + 1
            streak.set(sid, s)
            if (s >= BREAKER && !down.has(sid)) { down.add(sid); say(`⚠ ${new URL(src).host} не відповідає — решту з нього відкладено до наступного запуску`) }
            break
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker))
    const docsChanged = await rewriteDocs(docs)
    // і те, що за цей час дотягнув проксі
    epoch = okCount()
    const line = `завантажено: ${st.ok}, нема на джерелі: ${st.missing}, збоїв: ${st.failed}${st.skipped ? `, відкладено: ${st.skipped}` : ''}, документів з новими адресами: ${docsChanged}`
    say(line)
    return { ...st, docs: docsChanged }
  }

  return {
    ensure,
    open,
    found,
    local,
    sync,
    /** додати джерело переліку картинок для фонової задачі */
    collect: (fn) => { collectors.push(fn) },
    /** номер стану медіатеки: міняється, коли з'явились нові картинки (довідник перебудовує адреси) */
    get epoch() { return epoch },
    row: (src) => rows.get(src) ?? null,
    stats() {
      const by = {}
      for (const r of rows.values()) by[r.status] = (by[r.status] ?? 0) + 1
      return by
    },
  }
}

/*
 * Дані мапи з TH.GL (duneawakening.th.gl) — так само, як у Satisfactory шари бралися з SCIM.
 *
 * Що звідки:
 *   • опис мап, груп і типів точок (source.json) — з RSC-корисного навантаження сторінки мапи.
 *     Знімок лежить у репозиторії (server/map/source.json, `npm run map:sync`), а сервер сам
 *     перевіряє свіжий раз на кілька годин: Deep Desert — окрема мапа, яку буря перебудовує
 *     щотижня, і TH.GL тримає всі її розкладки (layout_00…11) з позначкою поточної;
 *   • точки — CBOR-файли nodes/*.raw, словники назв — dicts/<мова>.json і dicts/layouts/…,
 *     тайли — map-tiles/…, іконки — один спрайт icons/icons.webp.
 * Усе, що тягнеться з CDN, кешується на диск у <dataDir>/map і далі працює без мережі.
 * Назви й опис луту — мовою запиту: словник кожної мови гри (uk, en, de, fr… zh-CN, zh-TW) тягнеться з CDN
 * один раз і далі береться з диска; немає перекладу — англійська.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Encoder } from 'cbor-x'
import { lastReset, nextReset, STORM_REGIONS } from './storm.mjs'
import { fail } from './util.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CDN = 'https://cdn.th.gl/dune-awakening'
export const PAGE = 'https://duneawakening.th.gl/maps/Hagga%20Basin'
const SNAPSHOT = path.join(__dirname, '..', 'map', 'source.json')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Sandwalkers/2'
const REFRESH_MS = 6 * 3600 * 1000
/** TH.GL не відповів — наступна спроба не раніше, ніж за стільки (а не на кожне відкриття мапи) */
const RETRY_MS = 10 * 60 * 1000
/** запит до TH.GL, що завис, — обриваємо */
const TIMEOUT_MS = 20_000
/**
 * Після бурі Коріоліса (вівторок, 05:00 за часом серверів регіону — lib/storm.mjs) TH.GL виставляє нову розкладку
 * Глибокої пустелі — від години до першої бурі й до півтори доби після останньої перевіряємо частіше, щоб нова
 * розкладка з'являлась на мапі швидше.
 */
const STORM_REFRESH_MS = 30 * 60 * 1000
export function refreshEvery(now = Date.now()) {
  const H = 3600 * 1000
  const near = Object.keys(STORM_REGIONS).some((r) => nextReset(r, now) - now < H || now - lastReset(r, now) < 36 * H)
  return near ? STORM_REFRESH_MS : REFRESH_MS
}

const cbor = new Encoder({ useRecords: true, pack: true })

/**
 * Мови словників TH.GL (`dicts/<код>.json`): наша мова → коди в CDN. Китайська спрощена там `zh-CN`, традиційна —
 * `zh-TW` (на випадок збою беремо спрощену). Кожен словник тягнемо з CDN раз і кладемо на диск (cached).
 */
const THGL_LOCALES = {
  uk: ['uk'], en: ['en'], de: ['de'], fr: ['fr'], es: ['es'], it: ['it'], pl: ['pl'], 'pt-BR': ['pt-BR'], ru: ['ru'], tr: ['tr'],
  ja: ['ja'], ko: ['ko'], 'zh-Hans': ['zh-CN'], 'zh-Hant': ['zh-TW', 'zh-CN'],
}
const DEFAULT_LANG = 'uk'
/** мова сайту → відома нам мова словників (невідома — українська) */
export const thglLang = (lang) => (Object.hasOwn(THGL_LOCALES, lang) ? lang : DEFAULT_LANG)
/** якщо словника мови немає або мережа лягла — не мучимо CDN запитами на кожен запит, пробуємо раз на кілька хвилин */
const DICT_RETRY_MS = 10 * 60 * 1000

/** Пам'ять із витісненням найдавнішого; зберігає обіцянки, тож паралельні запити не рахують те саме двічі. */
function memo(store, key, make, cap) {
  if (store.has(key)) {
    const p = store.get(key)
    store.delete(key)
    store.set(key, p)
    return p
  }
  const p = Promise.resolve().then(make).catch((e) => { store.delete(key); throw e })
  store.set(key, p)
  if (cap && store.size > cap) store.delete(store.keys().next().value)
  return p
}

// ---------- source.json: з сторінки TH.GL ----------

/** Дістає з HTML сторінки мапи об'єкт конфігурації (filters, tilesConfig, nodesPaths…). */
export function extractConfig(html) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((m) => JSON.parse(m[1]))
  const txt = chunks.join('')
  const at = txt.indexOf('"tilesConfig"')
  if (at < 0) throw new Error('на сторінці мапи немає tilesConfig')
  let i = at, depth = 0
  for (; i > 0; i--) {
    const c = txt[i]
    if (c === '}') depth++
    else if (c === '{') { if (depth === 0) break; depth-- }
  }
  let j = i
  for (depth = 0; j < txt.length; j++) {
    const c = txt[j]
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) break
  }
  return JSON.parse(txt.slice(i, j + 1))
}

/** Компактний source.json: лише те, що потрібно застосунку. */
export function toSource(cfg) {
  const maps = cfg.mapNames.filter((id) => cfg.tilesConfig[id]).map((id) => {
    const t = cfg.tilesConfig[id]
    return {
      id,
      title: t.defaultTitle,
      tiles: t.url.replace(/^\/map-tiles\//, '').replace(/\/\{z\}.*$/, ''),
      minNativeZoom: t.options.minNativeZoom ?? 0,
      maxNativeZoom: t.options.maxNativeZoom ?? 4,
      tileSize: t.options.tileSize ?? 512,
      bounds: t.options.bounds,
      transformation: t.transformation,
      nodes: cfg.nodesPaths[id]?.replace(/^\/nodes\//, '') ?? null,
      layout: t.layout ?? null,
      layouts: (t.layouts || []).map((l) => ({
        id: l.id,
        tiles: l.url.replace(/^\/map-tiles\//, '').replace(/\/\{z\}.*$/, ''),
        nodes: l.nodes.replace(/^\/nodes\//, ''),
        dicts: l.dicts.replace(/^\/dicts\//, ''),
        resources: !!l.resources,
      })),
    }
  })
  const groups = cfg.filters.map((g) => ({
    id: g.group,
    defaultOn: !!g.defaultOn,
    types: g.values.map((v) => ({ id: v.id, icon: v.icon ? [v.icon.x, v.icon.y, v.icon.width, v.icon.height] : null, size: v.size ?? 2 })),
  }))
  return { syncedAt: new Date().toISOString(), maps, groups }
}

export async function fetchSource() {
  const res = await fetch(PAGE, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`мапа: HTTP ${res.status}`)
  return toSource(extractConfig(await res.text()))
}

/**
 * Опис з TH.GL придатний: є Хагга й Глибока пустеля з розкладками (і поточна серед них), групи точок, у кожної мапи —
 * тайли й межі. Інакше (сторінку змінили, порожня відповідь) лишаємо попередній: з порожнім описом позначки й записи
 * перестали б зберігатися («невідома мапа»).
 */
export function validSource(s) {
  const dd = s?.maps?.find?.((m) => m.id === 'deepdesert_1')
  return !!s && Array.isArray(s.maps) && s.maps.some((m) => m.id === 'survival_1') && !!dd?.layouts?.length && dd.layouts.some((l) => l.id === dd.layout)
    && Array.isArray(s.groups) && s.groups.some((g) => g.types?.length)
    && s.maps.every((m) => typeof m.id === 'string' && typeof m.tiles === 'string' && Array.isArray(m.bounds) && m.bounds.flat().length === 4 && m.bounds.flat().every(Number.isFinite))
}

// ---------- кеш ----------

export function createMapData({ dataDir, log = console }) {
  const dir = path.join(dataDir, 'map')
  const tilesDir = path.join(dir, 'tiles')
  fs.mkdirSync(tilesDir, { recursive: true })
  const liveFile = path.join(dir, 'source.json')
  const histFile = path.join(dir, 'dd-history.json')

  const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
  let source = readJson(liveFile, null) || readJson(SNAPSHOT, null)
  if (!source) throw new Error('немає server/map/source.json — запусти npm run map:sync')
  let refreshing = null
  /** коли TH.GL востаннє не відповів (чи віддав непридатне) */
  let failedAt = 0

  /** Історія тижнів Deep Desert: коли яку розкладку вперше побачили поточною. */
  const noteLayout = (src) => {
    const dd = src.maps.find((m) => m.id === 'deepdesert_1')
    if (!dd || dd.layout == null) return
    const hist = readJson(histFile, [])
    if (!hist.length || hist[hist.length - 1].layout !== dd.layout) {
      hist.push({ layout: dd.layout, seenAt: new Date().toISOString() })
      fs.writeFileSync(histFile, JSON.stringify(hist, null, 1))
    }
  }
  noteLayout(source)

  async function refresh(force = false) {
    if (refreshing) return refreshing
    const age = Date.now() - Date.parse(source.syncedAt || 0)
    if (!force && (age < refreshEvery() || Date.now() - failedAt < RETRY_MS)) return source
    refreshing = fetchSource()
      .then((s) => {
        if (!validSource(s)) throw new Error('опис мап непридатний — лишаю попередній')
        failedAt = 0
        const before = source.maps.find((m) => m.id === 'deepdesert_1')?.layout
        source = s
        fs.writeFileSync(liveFile, JSON.stringify(s))
        noteLayout(s)
        const after = s.maps.find((m) => m.id === 'deepdesert_1')?.layout
        if (before !== after) log.log?.(`[map] Deep Desert: нова розкладка ${before} → ${after}`)
        mem.clear()
        memLoc.clear()
        return s
      })
      .catch((e) => { failedAt = Date.now(); log.warn?.('[map] не вдалося оновити опис мап:', e.message); return source })
      .finally(() => { refreshing = null })
    return refreshing
  }

  // з диска — не блокуючи сервер (тайлів на кожну мапу — сотні); немає — з CDN з тайм-аутом
  async function cached(rel, url, { text = false } = {}) {
    const f = path.join(dir, rel)
    try {
      return await fs.promises.readFile(f, text ? 'utf8' : undefined)
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) { const e = new Error(`HTTP ${res.status} ${url}`); e.status = res.status; throw e }
    const buf = Buffer.from(await res.arrayBuffer())
    await fs.promises.mkdir(path.dirname(f), { recursive: true })
    await fs.promises.writeFile(f, buf)
    return text ? buf.toString('utf8') : buf
  }

  // словники: загальний для мови + словник розкладки DD; значення «@ключ» — посилання
  const dicts = new Map()
  const dictFailed = new Map()
  const dict = (rel) => memo(dicts, rel, async () => {
    const clean = rel.replace(/\?.*$/, '')
    return JSON.parse(await cached(path.join('dicts', clean), `${CDN}/dicts/${rel}`, { text: true }))
  }, 16)
  /** словник, якого може не бути (мова без перекладу, мережа): null — і наступні кілька хвилин не питаємо знову */
  async function dictOr(rel) {
    const bad = dictFailed.get(rel)
    if (bad && Date.now() - bad < DICT_RETRY_MS) return null
    try {
      return await dict(rel)
    } catch (e) {
      // паралельні запити падають разом — пишемо в журнал один раз
      if (!dictFailed.has(rel) || Date.now() - dictFailed.get(rel) >= DICT_RETRY_MS) log.warn?.(`[map] словник ${rel} недоступний:`, e.message)
      dictFailed.set(rel, Date.now())
      return null
    }
  }
  /**
   * Назви мовою `lang` (як у грі) + англійські. Немає перекладу в словнику мови — англійська.
   * t(k) — мовою людини, en(k) — англійською; значення «@ключ» розгортаються.
   */
  async function lexicon(map, layout, lang = DEFAULT_LANG) {
    const lay = map?.layouts?.find((l) => l.id === layout)
    const layDict = async (code) => (lay ? (await dictOr(lay.dicts.replace('{locale}', code))) ?? {} : {})
    const en = await dict('en.json')
    const len = await layDict('en')
    let base = en, lbase = len
    for (const code of THGL_LOCALES[thglLang(lang)]) {
      if (code === 'en') break
      const b = await dictOr(`${code}.json`)
      if (b) { base = b; lbase = await layDict(code); break }
    }
    const raw = (k) => lbase[k] ?? base[k] ?? len[k] ?? en[k]
    const enRaw = (k) => len[k] ?? en[k]
    const deref = (v, get) => {
      for (let n = 0; typeof v === 'string' && v.startsWith('@') && n < 4; n++) v = get(v)
      return typeof v === 'string' && !v.startsWith('@') ? v : null
    }
    return { t: (k) => deref(raw(k), raw), en: (k) => deref(enRaw(k), enRaw) }
  }

  /** Підписи типів, груп і мап — для панелі шарів: loc — мовою людини, en — англійською (uk — для старих вкладок). */
  async function labels(lang = DEFAULT_LANG) {
    const L = await lexicon(null, null, lang)
    const out = {}
    const put = (k) => {
      const loc = L.t(k)
      out[k] = { loc, en: L.en(k), uk: thglLang(lang) === 'uk' ? loc : null }
    }
    for (const g of source.groups) { put(g.id); for (const t of g.types) put(t.id) }
    for (const m of source.maps) put(m.id)
    return out
  }

  // точки мапи. Розбір файлу (координати й id) від мови не залежить — його тримаємо окремо (12 файлів: Хагга, поточна
  // пустеля, міста, печери й кілька давніх розкладок); назви й опис луту підставляються мовою людини (мапа × мова,
  // 64 — кожна копія лише з назвами, точки спільні). Важку роботу (розбір, назви) робимо по одній: запити з
  // перебором ?lang= чи ?layout= чекають у черзі, а не займають увесь процесор разом.
  const mem = new Map()
  const memLoc = new Map()
  let line = Promise.resolve()
  const oneByOne = (fn) => {
    const p = line.then(fn)
    line = p.catch(() => {})
    return p
  }
  const rawPoints = (file) => memo(mem, file, async () => {
    const buf = await cached(path.join('nodes', file), `${CDN}/nodes/${file}`)
    return oneByOne(() => decodePoints(buf))
  }, 12)
  function decodePoints(buf) {
    const groups = cbor.decode(new Uint8Array(buf))
    const types = {}
    for (const g of groups) {
      if (!g.spawns?.length) continue
      const T = (types[g.type] ||= { pts: [], ids: [] })
      for (const s of g.spawns) {
        if (!s.p || s.p.length < 2) continue
        const i = T.pts.length / 3
        T.pts.push(Math.round(s.p[0]), Math.round(s.p[1]), Math.round(s.p[2] || 0))
        if (s.id) T.ids.push(i, s.id)
      }
    }
    return types
  }
  /**
   * Точки мапи мовою `lang`: types[тип] = { pts: [x, y, z, …], info: { i: [назва, лут/опис, назва англ., лут англ.] } },
   * назва й лут — мовою людини (немає перекладу — англійською).
   */
  async function points(mapId, layoutId, lang = DEFAULT_LANG) {
    const map = source.maps.find((m) => m.id === mapId)
    if (!map) return null
    const lay = map.layouts.length ? map.layouts.find((l) => l.id === (layoutId ?? map.layout)) : null
    if (map.layouts.length && !lay) return null
    const file = lay ? lay.nodes : map.nodes
    const lg = thglLang(lang)
    return memo(memLoc, `${file}|${lg}`, async () => {
      const raw = await rawPoints(file)
      const L = await lexicon(map, lay?.id ?? null, lg)
      return oneByOne(() => {
        const types = {}
        for (const [type, R] of Object.entries(raw)) {
          const info = {}
          for (let k = 0; k < R.ids.length; k += 2) {
            const i = R.ids[k], id = R.ids[k + 1]
            const name = L.t(id), desc = L.t(id + '_desc')
            if (name || desc) info[i] = [name, desc, name ? L.en(id) : null, desc ? L.en(id + '_desc') : null]
          }
          types[type] = { pts: R.pts, info }
        }
        return { map: mapId, layout: lay?.id ?? null, types }
      })
    }, 64)
  }

  /**
   * Точка гри за стабільним ключем — id TH.GL без координат (`weapon_vendor@2661.5:5636.2` → `weapon_vendor`): для
   * посилань «показати на мапі» (торговці указів Ландсрааду). Координати в id змінюються з оновленнями TH.GL, ключ — ні.
   * Шукаємо в одному типі точок: той самий ключ буває в різних (`vehicle_vendor` — і звичайний торговець технікою,
   * і торговець Ландсрааду серед NPC). → { type, i, x, y } першої такої точки, або null
   */
  async function spot(mapId, type, key, layoutId) {
    const map = source.maps.find((m) => m.id === mapId)
    if (!map || !type || !key) return null
    const lay = map.layouts.length ? map.layouts.find((l) => l.id === (layoutId ?? map.layout)) : null
    if (map.layouts.length && !lay) return null
    const raw = await rawPoints(lay ? lay.nodes : map.nodes)
    const R = Object.hasOwn(raw, type) ? raw[type] : null
    for (let k = 0; R && k < R.ids.length; k += 2) {
      const i = R.ids[k], id = R.ids[k + 1]
      if (id === key || id.startsWith(key + '@')) return { type, i, x: R.pts[i * 3], y: R.pts[i * 3 + 1] }
    }
    return null
  }

  /**
   * Точка від людини (позначка, точка запису): відома мапа, координати в межах мапи (із запасом 5%), розкладка — лише
   * в мапи з розкладками і лише одна з них (інакше — без неї: позначку перенесли з пустелі в Хаггу). → { map, x, y, layout? }
   */
  function cleanPoint(p) {
    const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN)
    const m = source.maps.find((x) => x.id === p?.map)
    const x = num(p?.x), y = num(p?.y)
    if (!m || !Number.isFinite(x) || !Number.isFinite(y)) throw fail('хибна точка на мапі')
    const [[ax, ay], [bx, by]] = m.bounds
    const mx = Math.abs(bx - ax) * 0.05, my = Math.abs(by - ay) * 0.05
    if (x < Math.min(ax, bx) - mx || x > Math.max(ax, bx) + mx || y < Math.min(ay, by) - my || y > Math.max(ay, by) + my) throw fail('хибна точка на мапі')
    const out = { map: m.id, x: Math.round(x), y: Math.round(y) }
    if (m.layouts?.length && p.layout != null) {
      if (!Number.isInteger(p.layout) || !m.layouts.some((l) => l.id === p.layout)) throw fail('хибна точка на мапі')
      out.layout = p.layout
    }
    return out
  }

  /** розібрані точки мапи (Глибока пустеля — поточна розкладка, якщо не вказано): тип → { pts, ids }; нема мапи — null */
  async function raw(mapId, layoutId) {
    const map = source.maps.find((m) => m.id === mapId)
    if (!map) return null
    const lay = map.layouts.length ? map.layouts.find((l) => l.id === (layoutId ?? map.layout)) : null
    if (map.layouts.length && !lay) return null
    return rawPoints(lay ? lay.nodes : map.nodes)
  }

  const missing = new Set()
  async function tile(dirName, z, y, x) {
    const rel = `${dirName}/${z}/${y}/${x}.webp`
    if (missing.has(rel)) return null
    try {
      return await cached(path.join('tiles', rel), `${CDN}/map-tiles/${rel}`)
    } catch (e) {
      // «нема на CDN» пам'ятаємо (не безмежно); тимчасова заборона CDN (403) — не назавжди: лише 404
      if (e.status === 404) { if (missing.size > 20000) missing.clear(); missing.add(rel) }
      return null
    }
  }

  const icons = () => cached('icons.webp', `${CDN}/icons/icons.webp`)
  const ddHistory = () => readJson(histFile, [])

  return { get source() { return source }, refresh, labels, points, raw, spot, tile, icons, ddHistory, lexicon, cleanPoint, dir }
}

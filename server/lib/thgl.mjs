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
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Encoder } from 'cbor-x'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const CDN = 'https://cdn.th.gl/dune-awakening'
export const PAGE = 'https://duneawakening.th.gl/maps/Hagga%20Basin'
const SNAPSHOT = path.join(__dirname, '..', 'map', 'source.json')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Sandwalkers/2'
const REFRESH_MS = 6 * 3600 * 1000

const cbor = new Encoder({ useRecords: true, pack: true })

// ---------- source.json: з сторінки TH.GL ----------

/** Дістає з HTML сторінки мапи об'єкт конфігурації (filters, tilesConfig, nodesPaths…). */
export function extractConfig(html) {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map((m) => JSON.parse(m[1]))
  const txt = chunks.join('')
  const at = txt.indexOf('"tilesConfig"')
  if (at < 0) throw new Error('на сторінці TH.GL немає tilesConfig')
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
  const res = await fetch(PAGE, { headers: { 'user-agent': UA, accept: 'text/html' } })
  if (!res.ok) throw new Error(`TH.GL: HTTP ${res.status}`)
  return toSource(extractConfig(await res.text()))
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
    if (!force && age < REFRESH_MS) return source
    refreshing = fetchSource()
      .then((s) => {
        const before = source.maps.find((m) => m.id === 'deepdesert_1')?.layout
        source = s
        fs.writeFileSync(liveFile, JSON.stringify(s))
        noteLayout(s)
        const after = s.maps.find((m) => m.id === 'deepdesert_1')?.layout
        if (before !== after) log.log?.(`[map] Deep Desert: нова розкладка ${before} → ${after}`)
        mem.clear()
        return s
      })
      .catch((e) => { log.warn?.('[map] не вдалося оновити опис з TH.GL:', e.message); return source })
      .finally(() => { refreshing = null })
    return refreshing
  }

  async function cached(rel, url, { text = false } = {}) {
    const f = path.join(dir, rel)
    if (fs.existsSync(f)) return text ? fs.readFileSync(f, 'utf8') : fs.readFileSync(f)
    const res = await fetch(url, { headers: { 'user-agent': UA } })
    if (!res.ok) { const e = new Error(`HTTP ${res.status} ${url}`); e.status = res.status; throw e }
    const buf = Buffer.from(await res.arrayBuffer())
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, buf)
    return text ? buf.toString('utf8') : buf
  }

  // словники: загальний для мови + словник розкладки DD; значення «@ключ» — посилання
  const dicts = new Map()
  async function dict(rel) {
    if (dicts.has(rel)) return dicts.get(rel)
    const clean = rel.replace(/\?.*$/, '')
    const d = JSON.parse(await cached(path.join('dicts', clean), `${CDN}/dicts/${rel}`, { text: true }))
    dicts.set(rel, d)
    return d
  }
  async function lexicon(map, layout) {
    const uk = await dict('uk.json')
    const en = await dict('en.json')
    const lay = map?.layouts?.find((l) => l.id === layout)
    const luk = lay ? await dict(lay.dicts.replace('{locale}', 'uk')).catch(() => ({})) : {}
    const len = lay ? await dict(lay.dicts.replace('{locale}', 'en')).catch(() => ({})) : {}
    const raw = (k) => luk[k] ?? uk[k] ?? len[k] ?? en[k]
    const enRaw = (k) => len[k] ?? en[k]
    const deref = (v, get) => {
      for (let n = 0; typeof v === 'string' && v.startsWith('@') && n < 4; n++) v = get(v)
      return typeof v === 'string' && !v.startsWith('@') ? v : null
    }
    return { t: (k) => deref(raw(k), raw), en: (k) => deref(enRaw(k), enRaw) }
  }

  /** Підписи типів, груп і мап — для панелі шарів. */
  async function labels() {
    const L = await lexicon(null, null)
    const out = {}
    const put = (k) => { out[k] = { uk: L.t(k), en: L.en(k) } }
    for (const g of source.groups) { put(g.id); for (const t of g.types) put(t.id) }
    for (const m of source.maps) put(m.id)
    return out
  }

  // точки мапи: розібрані й згруповані за типом; у пам'яті — останні кілька мап
  const mem = new Map()
  async function points(mapId, layoutId) {
    const map = source.maps.find((m) => m.id === mapId)
    if (!map) return null
    const lay = map.layouts.length ? map.layouts.find((l) => l.id === (layoutId ?? map.layout)) : null
    if (map.layouts.length && !lay) return null
    const file = lay ? lay.nodes : map.nodes
    const key = file
    if (mem.has(key)) return mem.get(key)
    const raw = await cached(path.join('nodes', file), `${CDN}/nodes/${file}`)
    const groups = cbor.decode(new Uint8Array(raw))
    const L = await lexicon(map, lay?.id ?? null)
    const types = {}
    for (const g of groups) {
      if (!g.spawns?.length) continue
      const T = (types[g.type] ||= { pts: [], info: {} })
      for (const s of g.spawns) {
        if (!s.p || s.p.length < 2) continue
        const i = T.pts.length / 3
        T.pts.push(Math.round(s.p[0]), Math.round(s.p[1]), Math.round(s.p[2] || 0))
        if (s.id) {
          const name = L.t(s.id), desc = L.t(s.id + '_desc')
          // [назва, лут/опис, назва англ., лут англ.] — пошук по луту йде обома мовами
          if (name || desc) T.info[i] = [name, desc, name ? L.en(s.id) : null, desc ? L.en(s.id + '_desc') : null]
        }
      }
    }
    const out = { map: mapId, layout: lay?.id ?? null, types }
    mem.set(key, out)
    if (mem.size > 4) mem.delete(mem.keys().next().value)
    return out
  }

  const missing = new Set()
  async function tile(dirName, z, y, x) {
    const rel = `${dirName}/${z}/${y}/${x}.webp`
    if (missing.has(rel)) return null
    try {
      return await cached(path.join('tiles', rel), `${CDN}/map-tiles/${rel}`)
    } catch (e) {
      if (e.status === 404 || e.status === 403) missing.add(rel)
      return null
    }
  }

  const icons = () => cached('icons.webp', `${CDN}/icons/icons.webp`)
  const ddHistory = () => readJson(histFile, [])

  return { get source() { return source }, refresh, labels, points, tile, icons, ddHistory, lexicon, dir }
}

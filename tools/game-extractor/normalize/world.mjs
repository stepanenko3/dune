/*
 * Карта світу — карта поверхні гри (Overmap, «Overland Map»): місця, до яких летять орнітоптером, і переходи між мапами.
 *
 * Місця — точки карти поверхні: OvermapPoiComponent (мапа — рядок DT_MapsInfo, назва, опис, тег категорії, чи увімкнена)
 * з положенням свого актора; коло посадки — StaticMeshActor-площина з матеріалом M_POI_TravelVolume_Circular (площина
 * 100 од., радіус = 50 × масштаб), до місця — найближче. Місце, куди веде перехід, але якого на карті поверхні нема
 * (поселення в гайлайнері, сюжетні мапи), — без положення.
 * Переходи — пари «запит → точка прибуття» за назвою (FName — без регістру): запит (DestinationName або
 * m_DestinationOptions; умови — TravelRequirements) у рівні мапи A і точка прибуття з тією самою назвою
 * (TravelDestinationNameOverride / TravelDestinationName) у рівні мапи B — перехід A → B. Рівень належить мапі
 * DT_MapsInfo, у теці якої лежить (найглибша). Запит із карти поверхні, чия точка прибуття без своєї назви, — до місця,
 * у чиєму колі посадки він стоїть.
 * Таксі — точки прибуття «Travel_To_*»: у рівні з міткою TaxiService — стоянка поселення; без неї — посадка на торговому
 * пості; таксі возить між стоянками й посадками.
 * Карта поверхні — вид згори: X гри — схід, Y — південь (виходи Западини N/E/S/W, старт гравця дивиться на −Y).
 * Тексти — «таблиця рядків:ключ» → 14 мов із .locres; ключа нема в таблицях рядків — тексту нема (null).
 */

/** шлях пакета → шлях гри без розширення: «DuneSandbox/Content/Dune/A/B.umap» чи «/Game/Dune/A/B.B» → «/Game/Dune/A/B» */
export const gamePath = (p) => String(p ?? '').replace(/^DuneSandbox\/Content\//, '/Game/').replace(/\.(umap|uasset)$/, '').replace(/(\/[^/.]+)\.[^/]+$/, '$1')
const dirOf = (p) => gamePath(p).replace(/\/[^/]*$/, '/')
/** тека мапи, якій належать рівні в ній; мапа просто в «…/Maps/» (головне меню) теки не має — там усі мапи */
const ownDir = (p) => { const d = dirOf(p); return /\/Maps\/$/.test(d) ? null : d }
const inner = (s) => { const a = s.indexOf("'"), b = s.lastIndexOf("'"); return a >= 0 && b > a ? s.slice(a + 1, b) : s }
const low = (s) => String(s ?? '').toLowerCase()
const round = (v) => Math.round(v)

/** таблиці й рівні, які треба експортувати для карти світу, — зі списку пакетів збірки */
export const WORLD = {
  mapsInfo: /^DuneSandbox\/Content\/Dune\/Maps\/DT_MapsInfo[^/]*\.uasset$/,
  overmap: /^DuneSandbox\/Content\/Dune\/Systems\/Overmap\/(Sublevels\/)?Overmap(_[^/]+)?\.umap$/,
  overmapSkip: /_(Audio|Geometry|Light|VFX)\.umap$/,
  categories: /^DuneSandbox\/Content\/Dune\/GUI\/Data\/CategoryData\/DA_PoiCategoryData_[^/]+\.uasset$/,
  /** рівні мапи, де живуть переходи: сама мапа, її *_Travel і *_Gameplay* */
  travel: /(_Travel|_Gameplay[^/]*)\.umap$/i,
}
export function worldTables(files) {
  return files.filter((f) => WORLD.mapsInfo.test(f) || WORLD.categories.test(f) || (WORLD.overmap.test(f) && !WORLD.overmapSkip.test(f)))
}
/** рівні мап DT_MapsInfo (крім самої карти поверхні), у яких можуть бути переходи */
export function worldLevels(files, mapsInfo) {
  const dirs = Object.values(mapsInfo).map((r) => gamePath(r?.m_Map?.AssetPathName)).filter((p) => p && p !== '/Game/None' && !/\/Systems\/Overmap\//.test(p))
  const maps = new Set(dirs)
  const folders = [...new Set(dirs.map(ownDir).filter(Boolean))]
  return files.filter((f) => f.endsWith('.umap') && (maps.has(gamePath(f)) || (WORLD.travel.test(f) && folders.some((d) => gamePath(f).startsWith(d)))))
}

/** FText → «таблиця рядків:ключ» (лише з таблиці рядків — інакше його нема в .locres) */
const refOf = (t) => (t?.TableId && t.Key ? `${t.TableId.split('.').pop()}:${t.Key}` : null)
/** текст гри для сайту: без розмітки «<b>…</>» і переносів рядків */
export const plainText = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()

/** експорт рівня (масив, як GetExports) → актори { c, n, l, s, p, att, comp(ref) } — як у рівнях експортера, і компоненти за шляхом */
function actorsOf(exports) {
  const byPath = new Map()
  for (const e of exports ?? []) if (e?.Outer?.ObjectName) byPath.set(`${inner(e.Outer.ObjectName)}.${e.Name}`, e)
  const comp = (ref) => (ref?.ObjectName ? byPath.get(inner(ref.ObjectName)) ?? null : null)
  const out = []
  for (const e of exports ?? []) {
    const p = e?.Properties
    if (!p?.RootComponent) continue
    const rp = comp(p.RootComponent)?.Properties ?? {}
    const v = (o, a, b, c) => (o ? [o[a] ?? 0, o[b] ?? 0, o[c] ?? 0] : null)
    out.push({ c: e.Type, n: e.Name, l: v(rp.RelativeLocation, 'X', 'Y', 'Z'), s: v(rp.RelativeScale3D, 'X', 'Y', 'Z'), att: !!rp.AttachParent, p, root: rp, comp })
  }
  return out
}

/** запити переходу актора: [{ name, reqs, dimension }] */
function requestsOf(p) {
  const opts = Array.isArray(p?.m_DestinationOptions) ? p.m_DestinationOptions : p?.DestinationName ? [{ DestinationName: p.DestinationName, TravelRequirements: p.TravelRequirements }] : []
  return opts.filter((o) => o?.DestinationName && o.DestinationName !== 'None').map((o) => ({
    name: o.DestinationName,
    reqs: (o.TravelRequirements ?? []).map(reqOf),
    dimension: !!p.m_bCanSelectDimensionDestination,
  }))
}
/** умова переходу: тип гри, текст відмови (якщо з таблиці рядків), теги прапорців гравця */
function reqOf(r) {
  const out = { type: String(r?.Type ?? '').replace(/^ETravelRequirementType::/, '') }
  const text = refOf(r?.FailReason)
  if (text) out.text = text
  const tags = (r?.PlayerFlagsRequirement?.TagDictionary ?? []).map((t) => t?.TagName).filter(Boolean)
  if (tags.length) out.tags = tags
  return out
}
const destName = (p) => p?.TravelDestinationNameOverride || p?.TravelDestinationName || null
const isDest = (c) => /TravelDestination/.test(String(c))
const isRequest = (c) => /TravelRequest/.test(String(c))

/** пояснення до самої карти поверхні — підказки гри: паливо й вода в дорозі, як на неї потрапити */
export const ABOUT = ['ST_Localization_Progression:PROGRESSION/Tutorial_Description_OverlandAccess', 'ST_Localization_UI:UI/Overmap_Tutorial_Popup2']

export function normalizeWorld({ mapsInfo, overmap, levels = {}, extra = [], categories = {}, loc = {} }) {
  const texts = {}
  const use = (ref) => { if (ref && !(ref in texts)) texts[ref] = null; return ref }
  ABOUT.forEach(use)
  // мапи DT_MapsInfo: id рядка → шлях мапи; тека → мапа (найглибша)
  const maps = Object.entries(mapsInfo).map(([id, r]) => ({ id, path: gamePath(r?.m_Map?.AssetPathName), row: r })).filter((m) => m.path && m.path !== '/Game/None')
  const overland = maps.find((m) => /\/Systems\/Overmap\/Overmap$/.test(m.path))
  if (!overland) throw new Error('нема карти поверхні в DT_MapsInfo')
  const mapOfLevel = (pkg) => {
    const p = gamePath(pkg)
    const exact = maps.find((m) => m.path === p)
    if (exact) return exact.id
    let best = null
    for (const m of maps) { const d = ownDir(m.path); if (d && p.startsWith(d) && (!best || d.length > ownDir(best.path).length)) best = m }
    return best?.id ?? null
  }

  // категорії: тег фільтра → назва, батьківська категорія (підкатегорії — m_SubCategories)
  const cats = new Map()
  const subOf = new Map()
  for (const [pkg, exp] of Object.entries(categories)) {
    const p = exp?.find((e) => e?.Properties?.m_ItemFilter)?.Properties
    const tag = p?.m_ItemFilter?.TagDictionary?.[0]?.TagName
    if (!tag) continue
    cats.set(tag, { tag, name: use(refOf(p.m_DisplayName)), asset: pkg.split('/').pop().replace(/\..*$/, '') })
    for (const s of p.m_SubCategories ?? []) subOf.set(inner(s?.ObjectName ?? ''), tag)
  }
  for (const c of cats.values()) c.parent = subOf.get(c.asset) ?? null

  // карта поверхні: місця, кола посадки, запити й точки прибуття
  const pois = [], circles = [], reqs = [], dests = []
  for (const [pkg, exp] of Object.entries(overmap)) {
    for (const a of actorsOf(exp)) {
      if (a.p.m_PoiComponent) {
        const pc = a.comp(a.p.m_PoiComponent)?.Properties
        if (pc?.m_MapId?.Name && a.l) pois.push({ map: pc.m_MapId.Name, pos: a.l, pc })
      } else if (a.c === 'StaticMeshActor' && a.l && a.s) {
        const sm = a.comp(a.p.StaticMeshComponent)?.Properties ?? a.root
        if ((sm?.OverrideMaterials ?? []).some((m) => /M_POI_TravelVolume_Circular/.test(m?.ObjectName ?? ''))) circles.push({ pos: a.l, r: Math.abs(a.s[0]) * 50 })
      }
      if (isRequest(a.c)) for (const q of requestsOf(a.p)) reqs.push({ ...q, from: overland.id, pos: a.att ? null : a.l, level: pkg })
      if (isDest(a.c)) { const n = destName(a.p); if (n) dests.push({ name: n, map: overland.id, pos: a.l, level: pkg, actor: a }) }
    }
  }
  if (!pois.length) throw new Error('на карті поверхні нема жодного місця')
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

  // рівні мап: запити, точки прибуття, мітки таксі
  const taxiLevels = new Set()
  const scan = (pkg, lvl, map) => {
    if (!map) return
    for (const a of lvl?.actors ?? []) {
      const p = a.p ?? {}
      if (isRequest(a.c)) for (const q of requestsOf(p)) reqs.push({ ...q, from: map, pos: null, level: pkg })
      if (isDest(a.c)) { const n = destName(p); if (n) dests.push({ name: n, map, pos: null, level: pkg }) }
      if (a.c === 'DuneStaticMarkerActor' && p.m_bOverrideMarkerType && p.m_MarkerTypeDisplayed?.Name === 'TaxiService') taxiLevels.add(pkg)
    }
  }
  for (const [pkg, lvl] of Object.entries(levels)) scan(pkg, lvl, mapOfLevel(pkg))
  for (const x of extra) for (const [pkg, lvl] of Object.entries(x.levels ?? {})) scan(pkg, lvl, maps.find((m) => m.path === gamePath(x.map))?.id ?? null)

  // місця з положенням: точки карти поверхні; одна назва й те саме місце (гарнізон для двох фракцій) — одне місце
  const locs = new Map()
  const alias = new Map()
  for (const poi of pois.sort((a, b) => a.map.localeCompare(b.map))) {
    const nameRef = refOf(poi.pc.m_LocationName)
    const same = [...locs.values()].find((l) => l.pos && l.name === nameRef && dist(l.pos, poi.pos) < 500)
    if (same) { same.ids.push(poi.map); alias.set(poi.map, same.id); continue }
    const row = mapsInfo[poi.map]
    const circle = circles.filter((c) => dist(c.pos, poi.pos) < Math.max(3000, c.r)).sort((a, b) => dist(a.pos, poi.pos) - dist(b.pos, poi.pos))[0]
    const tags = poi.pc.m_PoiCategoryTags ?? []
    // найточніша категорія: підкатегорія (Регіони, Поселення) раніше за батьківську
    const tag = tags.find((t) => cats.get(t)?.parent) ?? tags.find((t) => cats.has(t)) ?? tags[0] ?? null
    locs.set(poi.map, {
      id: poi.map, ids: [poi.map], tag,
      name: use(nameRef), title: use(refOf(row?.m_DisplayName)), desc: use(refOf(poi.pc.m_LocationDescription)), note: use(refOf(row?.m_Description)),
      group: /Party/.test(row?.m_RecommendedGroupSize ?? '') ? 'party' : 'solo',
      hidden: poi.pc.m_bEnabled === false,
      map: row ? gamePath(row.m_Map?.AssetPathName).split('/').pop() : null,
      pos: [round(poi.pos[0]), round(poi.pos[1])], r: circle ? round(circle.r) : null,
    })
  }
  // мапа без точки на карті поверхні з тією самою назвою в DT_MapsInfo, що й у місця на карті (повтор сюжетної мапи —
  // «Уламки «Гефеста»», «Руїни Старого Карфага»), — те саме місце
  for (const m of maps) {
    if (locs.has(m.id) || alias.has(m.id)) continue
    const ref = refOf(m.row?.m_DisplayName)
    const twin = ref && [...locs.values()].find((l) => l.title === ref)
    if (twin) { twin.ids.push(m.id); alias.set(m.id, twin.id) }
  }
  const idOf = (map) => alias.get(map) ?? map

  // переходи: запит → точки прибуття з тією самою назвою; без них (з карти поверхні) — місце, в чиєму колі запит
  const byName = new Map()
  for (const d of dests) { const k = low(d.name); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(d) }
  const links = new Map()
  const unresolved = []
  const add = (from, to, mode, q, arrive) => {
    if (!from || !to || from === to) return
    const k = `${from}>${to}>${mode}`
    if (!links.has(k)) links.set(k, { from, to, mode, options: [], dimension: false, points: new Set() })
    const l = links.get(k)
    const key = JSON.stringify(q.reqs)
    if (!l.options.some((o) => JSON.stringify(o) === key)) l.options.push(q.reqs)
    for (const r of q.reqs) use(r.text)
    if (q.dimension) l.dimension = true
    for (const a of arrive) l.points.add(low(a.name))
  }
  for (const q of reqs) {
    const to = byName.get(low(q.name)) ?? []
    const from = idOf(q.from)
    if (to.length) { for (const m of new Set(to.map((d) => idOf(d.map)))) add(from, m, 'travel', q, to.filter((d) => idOf(d.map) === m)); continue }
    const near = q.from === overland.id && q.pos ? [...locs.values()].filter((l) => l.pos && dist(l.pos, q.pos) <= Math.max(3000, l.r ?? 0)).sort((a, b) => dist(a.pos, q.pos) - dist(b.pos, q.pos))[0] : null
    if (near) add(from, near.id, 'travel', q, [])
    else unresolved.push(`${q.from}: ${q.name}`)
  }
  // таксі: стоянки поселень (рівень з міткою TaxiService) ↔ посадки (без мітки) — між різними мапами
  const pads = dests.filter((d) => /^Travel_To_/i.test(d.name) && d.map !== overland.id)
  const hubs = pads.filter((d) => taxiLevels.has(d.level))
  // посадки — лише в мапах без стоянки (вихід із допиту в селищі — не посадка таксі)
  const spokes = pads.filter((d) => !hubs.some((h) => h.map === d.map))
  for (const h of hubs) for (const s of spokes) {
    if (idOf(h.map) === idOf(s.map)) continue
    add(idOf(h.map), idOf(s.map), 'taxi', { reqs: [] }, spokes.filter((x) => x.map === s.map))
    add(idOf(s.map), idOf(h.map), 'taxi', { reqs: [] }, [h])
  }

  // місця без положення, куди чи звідки є переходи (поселення в гайлайнері, сюжетні мапи) і сама карта поверхні
  const linked = new Set([...links.values()].flatMap((l) => [l.from, l.to]))
  for (const id of linked) {
    if (locs.has(id)) continue
    const row = mapsInfo[id]
    if (!row) continue
    locs.set(id, {
      id, ids: [id], tag: null,
      name: use(refOf(row.m_DisplayName)), title: null, desc: null, note: use(refOf(row.m_Description)),
      group: /Party/.test(row.m_RecommendedGroupSize ?? '') ? 'party' : 'solo', hidden: false,
      map: gamePath(row.m_Map?.AssetPathName).split('/').pop(), pos: null, r: null,
    })
  }
  // точки прибуття на карті поверхні: де опиняєшся, вилетівши з місця (виходи Западини, Глибокої пустелі)
  for (const l of links.values()) {
    if (l.to !== overland.id) continue
    const loc = locs.get(l.from)
    if (!loc) continue
    const pts = dests.filter((d) => d.map === overland.id && l.points.has(low(d.name)) && d.pos)
    if (pts.length) loc.exits = pts.map((d) => [round(d.pos[0]), round(d.pos[1])])
  }
  // межі карти: місця з колами й точки прибуття, із полем
  const xs = [], ys = []
  for (const l of locs.values()) {
    if (!l.pos) continue
    const r = l.r ?? 0
    xs.push(l.pos[0] - r, l.pos[0] + r); ys.push(l.pos[1] - r, l.pos[1] + r)
    for (const e of l.exits ?? []) { xs.push(e[0]); ys.push(e[1]) }
  }
  const pad = 0.06 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const bounds = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad].map(round)

  // тексти всіма мовами (порожні — геть)
  for (const ref of Object.keys(texts)) {
    const i = ref.indexOf(':')
    const by = {}
    for (const [lang, dict] of Object.entries(loc)) { const s = plainText(dict?.[ref.slice(0, i)]?.[ref.slice(i + 1)]); if (s) by[lang] = s }
    texts[ref] = Object.keys(by).length ? by : null
  }
  for (const k of Object.keys(texts)) if (!texts[k]) delete texts[k]
  const keep = (ref) => (ref && texts[ref] ? ref : null)
  const locations = [...locs.values()].map((l) => ({ ...l, name: keep(l.name), title: keep(l.title), desc: keep(l.desc), note: keep(l.note) }))
    .sort((a, b) => (a.id === overland.id ? -1 : b.id === overland.id ? 1 : a.id.localeCompare(b.id)))
  return {
    overland: overland.id,
    about: ABOUT.filter((r) => texts[r]),
    bounds,
    categories: [...cats.values()].map(({ tag, name, parent }) => ({ tag, name: keep(name), parent })).sort((a, b) => a.tag.localeCompare(b.tag)),
    locations,
    links: [...links.values()].map((l) => ({
      from: l.from, to: l.to, mode: l.mode, dimension: l.dimension, points: l.points.size,
      options: l.options.map((o) => o.map((r) => (r.text && !texts[r.text] ? { ...r, text: undefined } : r))),
    })).sort((a, b) => `${a.from}>${a.to}>${a.mode}`.localeCompare(`${b.from}>${b.to}>${b.mode}`)),
    texts,
    unresolved,
  }
}

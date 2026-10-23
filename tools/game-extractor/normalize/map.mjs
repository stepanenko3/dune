/*
 * Точки мапи з контент-блоків гри. Регіон мапи ставить блоки (BP_TerrainBlockActor_C: опис блоку, трансформ, групи
 * рівнів, перевизначення вкладених блоків); опис блоку (TerrainBlockDataAsset) — рівні блоку з групами й вкладені
 * блоки (актор-блок у рівні + свій опис); у рівнях — актори. Світова точка = трансформ блоку ∘ зсув рівня ∘ точка
 * актора (обертання UE: Pitch, Yaw, Roll). Сайт тримає мапу як [Y гри, X гри].
 * Тип точки — ігровий id: мітка — тип мітки (CDT_FullscreenMapMarkers; з налаштувань мітки або перевизначений на
 * акторі), лут — тип контейнера, ключ пентащита — потрібний ключ. Назва місця — «таблиця рядків:ключ» (переклад —
 * розділ texts). Блоку чи рівня нема в експорті — помилка розділу, а не мовчки менше точок.
 * Ресурси — точки ResourceNodeData рівнів: тип — група точок гри (Minerals, Scrap, Primrose…), основна (core) чи
 * додаткова (aux); конкретну руду гра вибирає картами тепла (план 5b-3).
 */
import { zoneOf } from './zones.mjs'

const pkg = (p) => String(p ?? '').split('/').pop().replace(/\..*$/, '')
/** рівень за шляхом пакета («/Game/…/CB_X.CB_X» → «/Game/…/CB_X»): імена рівнів у різних теках бувають однакові */
const levelPath = (p) => String(p ?? '').replace(/\.[^/.]+$/, '')
const rad = (d) => ((d ?? 0) * Math.PI) / 180

/** трансформ { M (рядки), T } з положення, FRotator UE (градуси) і масштабу */
function xf(l = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  const [p, y, ro] = (r ?? [0, 0, 0]).map(rad)
  const SP = Math.sin(p), CP = Math.cos(p), SY = Math.sin(y), CY = Math.cos(y), SR = Math.sin(ro), CR = Math.cos(ro)
  const R = [[CP * CY, CP * SY, SP], [SR * SP * CY - CR * SY, SR * SP * SY + CR * CY, -SR * CP], [-(CR * SP * CY + SR * SY), CY * SR - CR * SP * SY, CR * CP]]
  const S = s ?? [1, 1, 1]
  return { M: R.map((row, i) => row.map((v) => v * S[i])), T: l ?? [0, 0, 0] }
}
const apply = (t, v) => [0, 1, 2].map((c) => v[0] * t.M[0][c] + v[1] * t.M[1][c] + v[2] * t.M[2][c] + t.T[c])
/** спершу inner, далі outer */
const compose = (outer, inner) => ({ M: inner.M.map((row) => [0, 1, 2].map((c) => row.reduce((s, v, k) => s + v * outer.M[k][c], 0))), T: apply(outer, inner.T) })
const shift = (o) => xf([o?.X ?? 0, o?.Y ?? 0, o?.Z ?? 0])

/** що за точка: { kind, type, name? } або null (актор не точка мапи); npcs — іменовані NPC гри { рядок: { faction, name } } */
function pointOf(a, configs, npcs) {
  const p = a.p ?? {}
  // мітка гри — й її підкласи з тими самими полями (таксі ГП: BP_AutoDiscoveredStaticMarkerActor_C)
  if (a.c === 'DuneStaticMarkerActor' || p.m_MarkerTypeDisplayed?.Name) {
    // тип не знайшовся — помилка розділу: інакше місце (шар, увімкнений на свіжій мапі) зникло б мовчки
    const cfg = p.m_ConfigurationAsset?.AssetPathName
    const type = p.m_bOverrideMarkerType ? p.m_MarkerTypeDisplayed?.Name : configs[pkg(cfg)]
    if (!type || type === 'None') throw new Error(p.m_bOverrideMarkerType ? `мітка ${a.n}: перевизначено, а типу нема` : `мітка ${a.n}: невідомі налаштування ${cfg ?? '—'}`)
    const t = p.m_DisplayName
    return { kind: 'marker', type, name: t?.Key ? `${pkg(t.TableId)}:${t.Key}` : null }
  }
  if (a.c === 'TemporaryLootSpawner') {
    const t = p.m_LootConfig?.LootContainerType?.Name
    // своя таблиця луту спавнера (нема — таблиця розподілу за типом контейнера й зоною; рахує видобувач)
    const table = pkg(p.m_LootConfig?.LootTable?.AssetPathName) || null
    return t && t !== 'None' ? { kind: 'loot', type: t, ...(table && table !== 'None' ? { lootTable: table } : {}) } : null
  }
  if (a.c === 'BP_PentashieldKey_C') { const t = p.m_NeededKey?.Name; return t && t !== 'None' ? { kind: 'key', type: t } : null }
  // NPC на сталому місці, іменований (торговці, представники, тренери…): тип — фракція гри; натовп і варта — ні
  if (a.c === 'BP_AiSpawnLocation_C' && p.m_bIsStatic) { const n = npcs?.[p.NPCType?.RowName]; return n ? { kind: 'npc', type: n.faction, name: n.name } : null }
  return null
}

/**
 * map — id мапи сайту; regions — { назва: рівень мапи } (регіони Хаґґи; у містах і малих мапах — усі рівні мапи: точки й
 * у них самих); blocks — { назва опису блоку: m_Data }; level(шлях) → { actors, nodes } | null; configs —
 * { StaticMarker_X: тип мітки }; npcs — { рядок NPC гри: { faction, name } }. → { markers, resources }: записи
 * { id, map, kind, type, name?, x, y, z }
 */
export function normalizeMap({ map, layout = null, regions = {}, placements = [], points = [], blocks, level, configs, npcs = {} }) {
  const out = []
  const nodes = []
  // зони безпеки (об'єми BP_SecurityZone_C) у світі: для луту — які рядки таблиць діють у місці
  const zones = []
  const zone = (a, t) => {
    if (a.c !== 'BP_SecurityZone_C') return
    const type = a.p?.m_SecurityZoneType?.Name
    if (type && type !== 'None') zones.push(zoneOf(type, a.p?.m_SecurityZonePriority, compose(t, xf(a.l, a.r, a.s))))
  }
  const ids = new Map()
  const need = (name) => {
    const L = level(name)
    if (!L) throw new Error(`нема рівня ${name}`)
    return L
  }
  const add = (pt, w, to = out) => {
    const x = Math.round(w[1]), y = Math.round(w[0])
    const base = `${map}${layout == null ? '' : `/${layout}`}@${x}:${y}`
    const n = (ids.get(base) ?? 0) + 1
    ids.set(base, n)
    to.push({ id: n === 1 ? base : `${base}#${n}`, map, ...(layout == null ? {} : { layout }), kind: pt.kind, type: pt.type, ...(pt.name ? { name: pt.name } : {}), ...(pt.lootTable ? { lootTable: pt.lootTable } : {}), x, y, z: Math.round(w[2]) })
  }
  function place(assetPath, T, groupsOn, overrides, depth) {
    const name = pkg(assetPath)
    const d = blocks[name]
    if (!d) throw new Error(`нема опису блоку ${name}`)
    if (depth > 8) throw new Error(`блок ${name}: забагато вкладень`)
    const v = d.Versions?.[0] ?? {}
    const on = Object.fromEntries((v.SubLevelsGroups ?? []).map((g) => [g.Key, !!g.Value?.bIsEnabled]))
    Object.assign(on, groupsOn)
    const enabled = (names) => !names?.length || names.some((g) => on[g])
    const levels = [{ Level: v.Level, RelativeLocation: null, GroupsNames: [] }, ...(v.SubLevels ?? [])]
    const offsets = new Map(levels.map((s) => [levelPath(s.Level?.AssetPathName), s.RelativeLocation]))
    for (const s of levels) {
      const ln = levelPath(s.Level?.AssetPathName)
      if (!ln || !enabled(s.GroupsNames) || /_Foliage_|_Audio|_Lighting/.test(pkg(ln))) continue
      const LT = compose(T, shift(s.RelativeLocation))
      const L = need(ln)
      for (const a of L.actors) {
        zone(a, LT)
        const pt = a.l && pointOf(a, configs, npcs)
        if (pt) add(pt, apply(LT, a.l))
      }
      for (const n of L.nodes ?? []) for (const [x, y, z, core] of n.pts) add({ kind: core ? 'core' : 'aux', type: n.k }, apply(LT, [x, y, z]), nodes)
    }
    for (const sc of v.SubContentBlocksSettings ?? []) {
      const where = sc.ContentBlockActor ?? {}
      const o = overrides?.get(`${where.AssetPathName}|${where.SubPathString}`) ?? sc
      if (!(o.bShouldOverrideIsEnabled ? o.bIsEnabled : sc.bIsEnabled ?? true) || !enabled(sc.GroupsNames)) continue
      const ln = levelPath(where.AssetPathName)
      const actorName = String(where.SubPathString ?? '').split('.').pop()
      const a = need(ln).actors.find((x) => x.n === actorName)
      if (!a) throw new Error(`нема блоку ${actorName} у рівні ${ln}`)
      const AT = compose(compose(T, shift(offsets.get(ln))), xf(a.l, a.r, a.s))
      const next = (o.bShouldOverrideTerrainBlockAsset ? o.TerrainBlockAsset : sc.TerrainBlockAsset)?.ObjectPath ?? a.p?.m_TerrainBlockAsset?.ObjectPath
      const g = {}
      for (const x of a.p?.m_SubLevelGroupsSettings ?? []) g[x.Key] = !!x.Value?.bIsEnabled
      for (const x of [...(sc.SubLevelsGroupsOverride ?? []), ...(o !== sc ? o.SubLevelsGroupsOverride ?? [] : [])]) if (x.bShouldOverrideIsEnabled) g[x.GroupName] = !!x.bIsEnabled
      if (next) place(next, AT, g, null, depth + 1)
    }
  }
  const I = xf()
  for (const [, R] of Object.entries(regions)) {
    for (const n of R.nodes ?? []) for (const [x, y, z, core] of n.pts) add({ kind: core ? 'core' : 'aux', type: n.k }, [x, y, z], nodes)
    for (const a of R.actors) {
      zone(a, I)
      if (a.c !== 'BP_TerrainBlockActor_C') { const pt = a.l && pointOf(a, configs, npcs); if (pt) add(pt, apply(I, a.l)); continue }
      if (!a.p?.m_TerrainBlockAsset) continue
      const g = Object.fromEntries((a.p.m_SubLevelGroupsSettings ?? []).map((x) => [x.Key, !!x.Value?.bIsEnabled]))
      const ov = new Map((a.p.m_SubContentBlocksSettings ?? []).map((sc) => [`${sc.ContentBlockActor?.AssetPathName}|${sc.ContentBlockActor?.SubPathString}`, sc]))
      place(a.p.m_TerrainBlockAsset.ObjectPath, xf(a.l, a.r, a.s), g, ov, 0)
    }
  }
  // розкладка Глибокої пустелі: блоки кластерів (трансформ, групи й перевизначення — як у BP_TerrainBlockActor_C)
  for (const b of placements) place(b.asset, xf(b.l, b.r), b.groups ?? {}, b.overrides ?? null, 0)
  // готові точки світу (поля розкладки ГП) — тим самим лічильником id
  for (const p of points) add(p, p.l)
  return { markers: out, resources: nodes, zones }
}

/**
 * ВИНЯТОК, дозволений користувачем 23.10.2026: поля прянощів малі й середні та борошнистий пісок ГП гра прив'язує до
 * типу мітки в коді, а не в даних, — тож клас поля → тип мітки гри тут названо вручну. Лише ці три; інших відповідностей
 * не додавати.
 */
const FIELD_MARKERS = { BP_SpiceField_Small: 'SpiceFieldSmall', BP_SpiceField_Medium: 'SpiceFieldMedium', BP_FlourSandField_Small: 'FlourSand' }
/**
 * поля розкладки ГП (m_GenericActorsInstances: шаблон → клас актора, місце — світове): лише класи з FIELD_MARKERS;
 * уламки (фабрика випадкових подій) — не сталі точки
 */
export function layoutGenericPoints(layoutProps) {
  const cls = new Map((layoutProps?.m_GenericActorsTemplates ?? []).map((t) => [t.Key, pkg(t.Value?.ActorClass?.AssetPathName)]))
  const out = []
  for (const i of layoutProps?.m_GenericActorsInstances ?? []) {
    const type = FIELD_MARKERS[cls.get(i.TemplateName)]
    const L = i.Location ?? {}
    if (type) out.push({ kind: 'marker', type, l: [L.X ?? 0, L.Y ?? 0, L.Z ?? 0] })
  }
  return out
}

/** якір кластера розкладки → см світу (клітинка сітки кластерів) */
const ANCHOR = 101600
/**
 * розміщення блоків розкладки ГП (WorldLayoutDataAsset): кластер (WLC_*) на якорі, його варіант → увімкнені блоки;
 * світ = локальне місце блоку + якір × 101600. clusters — { WLC_X: властивості кластера }
 */
export function layoutPlacements(layoutProps, clusters) {
  const out = []
  for (const c of layoutProps?.m_Clusters ?? []) {
    const name = pkg(c.Value?.ClusterDataAsset?.ObjectPath)
    const w = clusters[name]
    if (!w) throw new Error(`нема кластера ${name}`)
    const vName = c.Value?.ClusterVariation ?? 'Default'
    const v = (w.m_Variations ?? []).find((x) => x.Key === vName)
    if (!v) throw new Error(`кластер ${name}: нема варіанта ${vName}`)
    const A = c.Value?.ClusterAnchor ?? {}
    for (const b of v.Value?.TerrainBlocks ?? []) {
      if (!b.bIsEnabled || !b.TerrainBlockDataAsset?.ObjectPath) continue
      const L = b.Location ?? {}, R = b.Rotation ?? {}
      out.push({
        asset: b.TerrainBlockDataAsset.ObjectPath,
        l: [(L.X ?? 0) + (A.X ?? 0) * ANCHOR, (L.Y ?? 0) + (A.Y ?? 0) * ANCHOR, L.Z ?? 0],
        r: [R.Pitch ?? 0, R.Yaw ?? 0, R.Roll ?? 0],
        groups: Object.fromEntries((b.SubLevelGroupsSettings ?? []).map((x) => [x.Key, !!x.Value?.bIsEnabled])),
        overrides: new Map((b.SubContentBlocksSettings ?? []).map((sc) => [`${sc.ContentBlockActor?.AssetPathName}|${sc.ContentBlockActor?.SubPathString}`, sc])),
      })
    }
  }
  return out
}

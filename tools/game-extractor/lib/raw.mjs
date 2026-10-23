/*
 * Сирий експорт збірки (Docker-образ експортера) і його нормалізація в розділи пакета.
 * <work>/raw/<збірка>/{tables/*.json, levels/*.json, files.txt, loc/<мова>.json, stations.json, DefaultGame.ini, .done}
 */
import fs from 'node:fs'
import path from 'node:path'
import { run } from './run.mjs'
import { rowsOf } from '../normalize/common.mjs'
import { normalizeItems } from '../normalize/items.mjs'
import { normalizePlaceables } from '../normalize/placeables.mjs'
import { normalizeRecipes } from '../normalize/recipes.mjs'
import { normalizeBuildables } from '../normalize/buildables.mjs'
import { LANG_DIRS, normalizeTexts } from '../normalize/texts.mjs'
import { normalizeSkills } from '../normalize/skills.mjs'
import { normalizeSpice } from '../normalize/spice.mjs'
import { normalizeConfig } from '../normalize/config.mjs'
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'
import { ddLayoutSettings, normalizeDdLayouts } from '../normalize/ddlayouts.mjs'
import { layoutGenericPoints, layoutPlacements, normalizeMap } from '../normalize/map.mjs'
import { normalizeMapKinds, normalizeMarkerTypes } from '../normalize/markertypes.mjs'
import { normalizeOvermap } from '../normalize/overmap.mjs'
import { bitmapSampler, lootWithBonus, pickDistribution } from '../normalize/loot.mjs'
import { zoneAt } from '../normalize/zones.mjs'
import { normalizeResources } from '../normalize/resources.mjs'

export const EXPORT_IMAGE = 'sandwalkers/gd-export:3'
const SYS = 'DuneSandbox/Content/Dune/Systems'
export const TABLES = {
  items: `${SYS}/Items/CDT_BaseItems`,
  placeables: `${SYS}/Building/Data/CDT_PlaceableData`,
  recipes: `${SYS}/Crafting/DT_ItemsCraftingRecipes`,
  building: `${SYS}/Building/Data/CDT_BuildingData`,
  group: `${SYS}/Building/Data/CDT_BuildableGroupData`,
  sets: `${SYS}/Building/Data/DT_BuildableUnlockableSetsData`,
  subcat: `${SYS}/Building/Data/DT_DuneBuildableUiSubcategory`,
  // уміння: модулі дерева, ціна рангів, характеристики здібностей
  modules: `${SYS}/Progression/DT_TrainingModules`,
  skillCosts: `${SYS}/Progression/SkillCosts`,
  abilityTuning: 'DuneSandbox/Content/Dune/GadgetsAbilities/CT_AbilityTuning',
  abilityStats: 'DuneSandbox/Content/Dune/GadgetsAbilities/CT_AbilityStatDisplay',
}

/** розкладки Глибокої пустелі (номер = номер розкладки на мапі; нова розкладка в патчі — дописати номер) */
const DD_LAYOUTS = 'DuneSandbox/Content/Dune/Maps/Arrakis/DeepDesert_1/Layouts/DA_DeepDesert_1_Layout_'
export const LAYOUTS = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '16', '18'].map((n) => DD_LAYOUTS + n)
const SOS = 'DuneSandbox/Content/Dune/Maps/Arrakis/SeaOfSand/'
/** кластери, на які посилаються вже експортовані розкладки (тож новий кластер патча підхопиться сам); only — фільтр імені */
export function clustersOf(out, only = /^WLC_/) {
  const names = new Set()
  for (const pkg of layoutPackages(out)) {
    let exp
    try { exp = JSON.parse(fs.readFileSync(path.join(out, 'tables', path.basename(pkg) + '.json'), 'utf8')) } catch { continue }
    for (const c of exp.find?.((e) => e.Type === 'WorldLayoutDataAsset')?.Properties?.m_Clusters ?? []) {
      const n = String(c.Value?.ClusterDataAsset?.ObjectPath ?? '').split('/').pop().replace(/\.\d+$/, '')
      if (only.test(n)) names.add(SOS + n)
    }
  }
  return [...names].sort()
}
/** кластери меланжу (великі поля розкладок) */
export const spiceClustersOf = (out) => clustersOf(out, /^WLC_Spice_/)

/** типи міток мапи (DefaultGame.ini m_MapMarkerTypesDataTable) */
export const MARKER_TYPES = `${SYS}/FullscreenMap/DataTables/FullscreenMapMarkers/CDT_FullscreenMapMarkers`
/** легенда мапи гри: категорії (Місцевість, NPC, Ресурси…) з перекладом і іконки типів */
export const MAP_LEGEND = `${SYS}/FullscreenMap/DataTables/DT_MapLegend`
/** мапа: рядки NPC і іменовані NPC, фракції (іконки), ключі-коди (назва, колір), рецепти іконок міток гри */
export const MAP_TABLES = {
  npcs: 'DuneSandbox/Content/Dune/AI/Config/CDT_NPCConfigs',
  named: 'DuneSandbox/Content/Dune/AI/Config/DT_NPCConfigs_Named',
  factions: `${SYS}/Faction/Data/DT_FactionData`,
  keyCodes: 'DuneSandbox/Content/Dune/Characters/Player/Interactions/DT_InteractionKeyCodes',
  presets: 'DuneSandbox/Content/Dune/GUI/Data/DT_IconPreset',
  // лут: тип контейнера → його таблиця розподілу
  lootContainers: `${SYS}/Items/DT_LootContainerActorsTable`,
  // зони безпеки: тип зони → правила (PvP / PvE / місто) — які рядки луту діють у місці
  securityZones: `${SYS}/SecurityZones/DT_SecurityZones`,
}
/**
 * Мапа з контент-блоків — зі списку пакетів збірки (files.txt), тож нові регіони, блоки й мітки патча підхопляться самі:
 * регіони Хаґґи (без звуку, сезонних подій, туману, ефектів), описи блоків, налаштування міток.
 * Сезонні події — рівні *_MTXEvent (MTXEventWorldSettings, блоки BP_MTXEventTerrainBlockActor_C, вмикаються подією);
 * Survival_1_MTX_Journey — звичайні блоки (DLC Lost Harvest: уламок «Мітри»), постійний вміст мапи.
 */
const MAP = {
  regions: /^DuneSandbox\/Content\/Dune\/Maps\/Arrakis\/SOC_1\/SubLevels\/Survival_1_[^/]+\.umap$/,
  // постійні підрівні Глибокої пустелі (кільце щитової стіни, подорожі) — у кожній розкладці
  ddRegions: /^DuneSandbox\/Content\/Dune\/Maps\/Arrakis\/DeepDesert_1\/SubLevels\/[^/]+\.umap$/,
  skip: /Audio|MTXEvent|FogCards|_Fog|VFX|Cinematic|EditorOnly|GapFix/,
  blocks: /^DuneSandbox\/Content\/Dune\/Systems\/DynamicContent\/TerrainBlocks\/Collection\/[^/]+\.uasset$/,
  configs: /^DuneSandbox\/Content\/Dune\/Systems\/StaticMarkers\/StaticMarker_[^/]+\.uasset$/,
  // категорії точок огляду (дерево й категорії: тег точки → тип мітки)
  poiCats: /^DuneSandbox\/Content\/Dune\/GUI\/Data\/CategoryData\/DA_Poi[^/]+\.uasset$/,
  // таблиці луту (і розподілу за типом контейнера) — усі, зокрема DLC
  loot: /^DuneSandbox\/Content\/.*\/(LootTables|Looting)\/(.*\/)?DT_[^/]+\.uasset$/,
}
const noExt = (p) => p.replace(/\.(uasset|umap)$/, '')
/**
 * файл рівня в levels/ — за шляхом пакета (імена рівнів у різних теках бувають однакові): «DuneSandbox/Content/Dune/A/B.umap»
 * чи «/Game/Dune/A/B» → «Dune~A~B» (так само називає експортер)
 */
export const levelFile = (p) => noExt(String(p)).replace(/^DuneSandbox\/Content\//, '').replace(/^\/Game\//, '').replace(/\.[^/.]+$/, '').replaceAll('/', '~')
/** пакети мапи зі списку збірки; списку ще нема — null */
export function mapPackages(out) {
  let list
  try { list = fs.readFileSync(path.join(out, 'files.txt'), 'utf8').split('\n').filter(Boolean) } catch { return null }
  return {
    regions: list.filter((p) => MAP.regions.test(p) && !MAP.skip.test(path.basename(p))),
    ddRegions: list.filter((p) => MAP.ddRegions.test(p) && !MAP.skip.test(path.basename(p))),
    blocks: list.filter((p) => MAP.blocks.test(p)).map(noExt),
    configs: list.filter((p) => MAP.configs.test(p)).map(noExt),
    poiCats: list.filter((p) => MAP.poiCats.test(p)).map(noExt),
    loot: list.filter((p) => MAP.loot.test(p)).map(noExt),
    worlds: worldMaps(list),
  }
}
/**
 * Міста, малі мапи й огляд — мапи World Composition: кореневий рівень теки X.umap (поряд рівні X_*); рівні мапи — усі
 * .umap теки (з підтеками) без службових (звук, світло, листя, LOD, ефекти, туман, кінематографія, контракти — їхні точки
 * з'являються лише в завданні). Id мапи сайту — назва кореневого рівня малими (SH_Arrakeen → sh_arrakeen).
 */
const WC_DIRS = /^DuneSandbox\/Content\/Dune\/(Maps\/SocialHubs\/[^/]+|Maps\/OverlandMaps(_Story)?\/[^/]+|Systems\/Overmap)\/$/
const WC_SKIP = /_Audio|_Lighting|_Foliage|\/LOD\/|_LOD\d|VFX|_Fog|FogCards|Cinematic|Contract|MTX/i
export function worldMaps(list) {
  const umaps = list.filter((p) => p.endsWith('.umap'))
  // імена рівнів кожної теки — раз (список збірки — тисячі рівнів)
  const byDir = new Map()
  for (const p of umaps) {
    const dir = path.posix.dirname(p) + '/'
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push(path.posix.basename(p, '.umap'))
  }
  const out = []
  for (const world of umaps) {
    const dir = path.posix.dirname(world) + '/'
    if (!WC_DIRS.test(dir)) continue
    const name = path.posix.basename(world, '.umap')
    const here = byDir.get(dir)
    // корінь — має рівні X_* і сам не підрівень іншого (SH_Arrakeen_Art при SH_Arrakeen_Art_Bar — підрівень SH_Arrakeen)
    if (!here.some((n) => n.startsWith(name + '_')) || here.some((n) => name.startsWith(n + '_'))) continue
    out.push({ id: name.toLowerCase(), world, levels: umaps.filter((p) => p.startsWith(dir) && !WC_SKIP.test(p.slice(dir.length))) })
  }
  return out
}
/** рівні, на які посилаються вже експортовані описи блоків (без листя, звуку, світла й LOD — точок мапи там нема) */
export function blockLevels(out, blocks) {
  const levels = new Set()
  const add = (soft) => {
    const p = soft?.AssetPathName
    if (!p || p === 'None' || /_Foliage_|_Audio|_Lighting|\/LOD\//.test(p)) return
    levels.add('DuneSandbox/Content' + p.replace(/^\/Game/, '').replace(/\.[^/.]+$/, '') + '.umap')
  }
  for (const pkg of blocks) {
    let exp
    try { exp = JSON.parse(fs.readFileSync(path.join(out, 'tables', path.basename(pkg) + '.json'), 'utf8')) } catch { continue }
    for (const v of exp.find((e) => e.Properties?.m_Data)?.Properties.m_Data.Versions ?? []) {
      add(v.Level)
      for (const s of v.SubLevels ?? []) add(s.Level)
      for (const s of v.SubContentBlocksSettings ?? []) add(s.ContentBlockActor)
    }
  }
  return [...levels].sort()
}
/**
 * Ресурси (5b-3): світ мапи (WorldGenerator: геометрія карт тепла, таблиця типів ресурсів, група карт тепла) → таблиця
 * типів і група → карти тепла й спавнери типів → компоненти спавнерів (тип мітки). Кожен крок — з уже експортованого,
 * тож нові типи, карти й спавнери патча підхопляться самі.
 */
export const MAP_WORLD = 'DuneSandbox/Content/Dune/Maps/Arrakis/SOC_1/Survival_1.umap'
/** Глибока пустеля: геометрія карт тепла й таблиця типів; групу карт кожна розкладка має свою (DefaultGame.ini) */
export const DD_WORLD = 'DuneSandbox/Content/Dune/Maps/Arrakis/DeepDesert_1/DeepDesert_1.umap'
const iniOf = (out) => { try { return fs.readFileSync(path.join(out, 'DefaultGame.ini'), 'utf8') } catch { return '' } }
/** вміст розкладок ГП — зі списку гри в ini (нова розкладка патча підхопиться сама); ini ще нема — відомий список */
export function layoutPackages(out) {
  const fromIni = ddLayoutSettings(iniOf(out)).map((s) => s.content)
  return fromIni.length ? fromIni : LAYOUTS
}
/** «/Game/A/B.B_C» чи «/Game/A/B.0» → пакет «DuneSandbox/Content/A/B» (лише /Game; рушій — ні) */
const pkgOfPath = (p) => (typeof p === 'string' && p.startsWith('/Game/') ? 'DuneSandbox/Content' + p.slice(5).replace(/\.[^/.]*$/, '') : null)
const readTable = (out, pkg) => { try { return JSON.parse(fs.readFileSync(path.join(out, 'tables', path.basename(pkg) + '.json'), 'utf8')) } catch { return null } }
/** світ мапи з експорту: геометрія, таблиця типів, група карт тепла */
export function worldOf(exp) {
  const w = exp?.find((e) => e.Type === 'DuneWorldGenerator')?.Properties
  if (!w) return null
  return {
    origin: w.m_WorldOriginOffset ?? { X: 0, Y: 0 }, sizeM: w.m_WorldSizeInMeters,
    types: pkgOfPath(w.m_ResourceTypesTable?.AssetPathName), group: pkgOfPath(w.m_WorldHeatMaps?.[0]?.ResourceDistributionGroup?.AssetPathName),
    // загальні актори світу (поля меланжу, борошнистий пісок, події): шаблони й місця
    generic: [pkgOfPath(w.m_GenericActorsTemplatesTable?.AssetPathName), pkgOfPath(w.m_GenericActorsInstancesTable?.AssetPathName)],
    // теги зон (тири луту): набір бітових карт; світ без них — свої теги (малі мапи: LootTier.6)
    tagsBitmap: pkgOfPath(w.m_WorldHeatMaps?.[0]?.TagsDistributionBitMap?.AssetPathName),
    fallbackTags: w.m_FallbackWorldTags ?? [],
  }
}
/** пакети ресурсів, потрібні з огляду на вже експортоване (світ, таблиця, група, карти, спавнери, компоненти) */
export function resourcePackages(out) {
  // світи: Хаґґа й кореневі рівні мап World Composition (міста, малі мапи, огляд)
  const roots = [MAP_WORLD, DD_WORLD, ...(mapPackages(out)?.worlds ?? []).map((w) => w.world)]
  const need = [...roots]
  const spawners = new Set()
  // групи карт: світів і розкладок ГП (з ini)
  const groups = ddLayoutSettings(iniOf(out)).map((s) => s.group).filter(Boolean)
  for (const root of roots) {
    const w = worldOf(readTable(out, root))
    if (!w) continue
    if (w.types) need.push(w.types)
    if (w.group) groups.push(w.group)
    if (root === MAP_WORLD) for (const g of w.generic) if (g) need.push(g)
    for (const r of Object.values(rowsOf(readTable(out, w.types ?? '') ?? []))) for (const v of r.SpawnerVariants ?? []) for (const c of [v.ResourceSpawnerClassCore, v.ResourceSpawnerClassAux]) { const p = pkgOfPath(c?.AssetPathName); if (p) spawners.add(p) }
  }
  for (const g of new Set(groups)) {
    need.push(g)
    for (const h of readTable(out, g)?.find((e) => e.Properties?.m_ResourceDistributionHeatMapData)?.Properties.m_ResourceDistributionHeatMapData ?? []) { const p = pkgOfPath(h.Value?.ObjectPath); if (p) need.push(p) }
  }
  for (const sp of spawners) {
    need.push(sp)
    for (const e of readTable(out, sp) ?? []) { const p = e.Type === 'SCS_Node' && pkgOfPath(e.Properties?.ComponentClass?.ObjectPath); if (p) need.push(p) }
  }
  return [...new Set(need)]
}
/** набори бітових карт зон (Хаґґа й розкладки ГП) і самі карти: таблиці (властивості) і байти (біти) */
export function bitmapPackages(out) {
  const sets = [worldOf(readTable(out, MAP_WORLD))?.tagsBitmap, ...ddLayoutSettings(iniOf(out)).map((s) => s.tags)].filter(Boolean)
  const maps = new Set()
  for (const c of sets) for (const m of readTable(out, c)?.find((e) => e.Properties?.Collection)?.Properties.Collection ?? []) { const p = pkgOfPath(m.ObjectPath); if (p) maps.add(p) }
  return { tables: [...new Set(sets), ...maps], bytes: [...maps] }
}
/**
 * тип мітки спавнера (m_MapMarkerType вузла, m_MarkerType підбирання) і предмет, який точка дає (m_ResourceIdentifier):
 * спершу шаблон компонента в самому спавнері (гра там перевизначає, напр. Stravidium/Titanium), далі налаштування класу
 * компонента за замовчуванням. → { type, item } або null
 */
function markerOfSpawner(out, classPath) {
  const exp = readTable(out, pkgOfPath(classPath) ?? '') ?? []
  const typeOf = (p) => { const t = p?.m_MapMarkerType?.Name ?? p?.m_MarkerType?.Name; return t && t !== 'None' ? t : null }
  const itemOf = (p) => { const i = p?.m_ResourceIdentifier?.Name; return i && i !== 'None' ? i : null }
  for (const e of exp) {
    const c = e.Type === 'SCS_Node' && pkgOfPath(e.Properties?.ComponentClass?.ObjectPath)
    if (!c) continue
    const tpl = /:([^:']+)'?$/.exec(e.Properties?.ComponentTemplate?.ObjectName ?? '')?.[1]
    const own = tpl ? exp.find((x) => x.Name === tpl)?.Properties : null
    const cdo = readTable(out, c)?.find((x) => String(x.Name ?? '').startsWith('Default__'))?.Properties
    const type = typeOf(own) ?? typeOf(cdo)
    if (type) return { type, item: itemOf(own) ?? itemOf(cdo) }
  }
  return null
}
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

/** пакет «DuneSandbox/Content/Dune/X/Y» → шлях об'єкта, яким на нього посилаються таблиці: «/Game/Dune/X/Y.0» */
export const objectPath = (pkg) => pkg.replace(/^DuneSandbox\/Content\//, '/Game/') + '.0'

/** образ експортера є? нема — зібрати з tools/game-extractor/export */
export async function ensureImage(image, dir, { platform } = {}) {
  await run('docker', ['image', 'inspect', image]).catch(() => run('docker', ['build', ...(platform ? ['--platform', platform] : []), '-t', image, dir], { timeoutMs: 3 * 3600_000 }))
}

export async function exportRaw({ work, build, root, usmap, docker = (args) => run('docker', args, { timeoutMs: 3600_000 }), ensure = ensureImage }) {
  const out = path.join(work, 'raw', String(build))
  // експорт збірки вже є: досвантажити лише таблиці, яких у ньому ще нема (видобувач навчився нового розділу)
  const done = fs.existsSync(path.join(out, '.done'))
  // таблиця, що минулого разу впала (.error), — пробуємо знову
  const has = (pkg) => fs.existsSync(path.join(out, 'tables', path.basename(pkg) + '.json'))
  // рівень є — лише без давньої помилки (пачка могла впасти вже після запису частини рівнів)
  const hasLevel = (pkg) => fs.existsSync(path.join(out, 'levels', levelFile(pkg) + '.json')) && !fs.existsSync(path.join(out, 'levels', levelFile(pkg) + '.error'))
  const todo = [...Object.values(TABLES), ...LAYOUTS, MARKER_TYPES, MAP_LEGEND, ...Object.values(MAP_TABLES)].filter((pkg) => !done || !has(pkg))
  const mapDone = () => {
    const m = mapPackages(out)
    const ok = (p) => has(p) && !fs.existsSync(path.join(out, 'tables', path.basename(p) + '.error'))
    const bm = bitmapPackages(out)
    const hasBytes = (p) => fs.existsSync(path.join(out, 'bytes', path.basename(p) + '.bin'))
    return !!m && [...m.configs, ...m.blocks, ...m.poiCats, ...m.loot, ...layoutPackages(out), ...clustersOf(out), ...resourcePackages(out), ...bm.tables].every(ok) && bm.bytes.every(hasBytes) && [...m.regions, ...m.ddRegions, ...m.worlds.flatMap((w) => w.levels), ...blockLevels(out, m.blocks)].every(hasLevel)
  }
  if (done && !todo.length && spiceClustersOf(out).every(has) && mapDone()) return out
  if (!done) fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(path.join(out, 'tables'), { recursive: true })
  // ini — одразу: з нього розкладки ГП і їхні групи карт (експорт ресурсів нижче)
  if (!fs.existsSync(path.join(out, 'DefaultGame.ini'))) fs.copyFileSync(path.join(root, 'Config', 'DefaultGame.ini'), path.join(out, 'DefaultGame.ini'))
  await ensure(EXPORT_IMAGE, path.join(import.meta.dirname, '..', 'export'))
  // від імені поточного користувача (на Linux docker інакше пише root-ом — prune не зможе стерти), без мережі
  const user = process.getuid ? ['--user', `${process.getuid()}:${process.getgid()}`] : []
  const exp = (...args) => docker(['run', '--rm', ...user, '--network', 'none', '-v', `${path.join(root, 'Content/Paks')}:/paks:ro`, '-v', `${usmap}:/map.usmap:ro`, '-v', `${out}:/out`, EXPORT_IMAGE, ...args])
  // кожна таблиця окремо: зламана (патч перейменував чи прибрав) не зупиняє інші — лише її розділ
  const mark = (file, e) => fs.writeFileSync(path.join(out, file), String(e?.message || e))
  const one = async (pkg) => {
    fs.rmSync(path.join(out, 'tables', path.basename(pkg) + '.error'), { force: true })
    await exp('tables', pkg).catch((e) => mark(`tables/${path.basename(pkg)}.error`, e))
  }
  for (const pkg of todo) await one(pkg)
  // кластери меланжу — ті, на які посилаються розкладки (уже експортовані)
  for (const pkg of spiceClustersOf(out).filter((p) => !has(p))) await one(pkg)
  // мапа: список пакетів → описи блоків і налаштування міток → рівні (регіони й рівні блоків); пачками — один запуск
  // образу на сотні пакетів, зламаний пакет — свій .error (пише сам експортер)
  if (!fs.existsSync(path.join(out, 'files.txt'))) await exp('files').catch((e) => mark('files.error', e))
  const m = mapPackages(out)
  if (m) {
    // пачкою: давні помилки її пакетів — геть; впала — помилка лише тим, хто не встиг записатися
    const batchOf = async (cmd, list, file) => {
      for (const batch of chunks(list, 300)) {
        for (const p of batch) fs.rmSync(path.join(out, file(p) + '.error'), { force: true })
        await exp(cmd, ...batch).catch((e) => batch.filter((p) => !fs.existsSync(path.join(out, file(p) + '.json'))).forEach((p) => mark(file(p) + '.error', e)))
      }
    }
    const tableOk = (p) => has(p) && !fs.existsSync(path.join(out, 'tables', path.basename(p) + '.error'))
    // розкладки ГП (з ini) — до їхніх кластерів
    await batchOf('tables', layoutPackages(out).filter((p) => !tableOk(p)), (p) => `tables/${path.basename(p)}`)
    await batchOf('tables', [...m.configs, ...m.blocks, ...m.poiCats, ...m.loot, ...clustersOf(out)].filter((p) => !tableOk(p)), (p) => `tables/${path.basename(p)}`)
    // ресурси: кожен прохід додає те, що стало відомо з попереднього (світ → таблиці → спавнери → компоненти)
    // прохід без поступу (пакет не експортується) — далі не крутимо
    let prev = ''
    for (let pass = 0; pass < 6; pass++) {
      // разом із ресурсами — набори бітових карт зон і самі карти (набір → карти)
      const todoRes = [...resourcePackages(out), ...bitmapPackages(out).tables].filter((p) => !tableOk(p))
      if (!todoRes.length || todoRes.join('\n') === prev) break
      prev = todoRes.join('\n')
      await batchOf('tables', todoRes, (p) => `tables/${path.basename(p)}`)
    }
    // біти карт зон (дані поза властивостями пакета)
    await batchOf('bytes', bitmapPackages(out).bytes.filter((p) => !fs.existsSync(path.join(out, 'bytes', path.basename(p) + '.bin'))), (p) => `bytes/${path.basename(p)}`)
    fs.mkdirSync(path.join(out, 'levels'), { recursive: true })
    await batchOf('levels', [...new Set([...m.regions, ...m.ddRegions, ...m.worlds.flatMap((w) => w.levels), ...blockLevels(out, m.blocks)])].filter((p) => !hasLevel(p)), (p) => `levels/${levelFile(p)}`)
  }
  if (done) return out
  await exp('locres').catch((e) => mark('loc.error', e))
  await exp('stations', TABLES.placeables).catch((e) => mark('stations.error', e))
  fs.copyFileSync(path.join(root, 'Config', 'DefaultGame.ini'), path.join(out, 'DefaultGame.ini'))
  fs.writeFileSync(path.join(out, '.done'), new Date().toISOString())
  return out
}

/** сирий експорт → розділи пакета; збій розділу — Error цього розділу (інші не страждають) */
export function normalizeRaw({ work, build }) {
  const raw = path.join(work, 'raw', String(build))
  const failed = (rel) => { try { return fs.readFileSync(path.join(raw, rel), 'utf8') } catch { return null } }
  const read = (rel, err) => {
    const e = err && failed(err)
    if (e) throw new Error(e)
    return JSON.parse(fs.readFileSync(path.join(raw, rel), 'utf8'))
  }
  const table = (k) => { const n = path.basename(TABLES[k]); return rowsOf(read(`tables/${n}.json`, `tables/${n}.error`)) }
  const safe = (f) => { try { return f() } catch (e) { return e instanceof Error ? e : new Error(String(e)) } }
  const out = {}
  const items = safe(() => table('items'))
  const placeables = safe(() => table('placeables'))
  const building = safe(() => table('building'))
  const need = (x) => { if (x instanceof Error) throw x; return x }
  out.items = safe(() => ({ records: normalizeItems(need(items)) }))
  out.placeables = safe(() => ({ records: normalizePlaceables(need(placeables)) }))
  out.recipes = safe(() => {
    if (out.items instanceof Error) throw new Error('нема предметів: ' + out.items.message)
    return { records: normalizeRecipes(table('recipes'), { items: out.items.records, stations: read('stations.json', 'stations.error') }) }
  })
  const loc = {}
  for (const l of Object.keys(LANG_DIRS)) { try { loc[l] = read(`loc/${l}.json`, `loc/${l}.error`) } catch { /* мова не вдалася — перевірка обсягу пакета скаже яка */ } }
  const modules = safe(() => table('modules'))
  out.skills = safe(() => ({
    records: normalizeSkills({
      modules: need(modules),
      curves: Object.fromEntries(['skillCosts', 'abilityTuning', 'abilityStats'].map((k) => [objectPath(TABLES[k]), table(k)])),
      en: loc.en ?? {},
    }),
  }))
  out.spice = safe(() => {
    const layouts = Object.fromEntries(LAYOUTS.map((pkg) => [Number(pkg.slice(-2)), read(`tables/${path.basename(pkg)}.json`, `tables/${path.basename(pkg)}.error`)]))
    const clusters = Object.fromEntries(spiceClustersOf(raw).map((pkg) => [path.basename(pkg), read(`tables/${path.basename(pkg)}.json`, `tables/${path.basename(pkg)}.error`)]))
    return { records: normalizeSpice({ layouts, clusters }) }
  })
  out.buildables = safe(() => ({
    records: normalizeBuildables({ building: need(building), placeables: need(placeables), group: table('group'), sets: table('sets'), subcat: table('subcat') }),
  }))
  const legend = safe(() => rowsOf(read(`tables/${path.basename(MAP_LEGEND)}.json`, `tables/${path.basename(MAP_LEGEND)}.error`)))
  const mapTab = (k) => safe(() => rowsOf(read(`tables/${path.basename(MAP_TABLES[k])}.json`, `tables/${path.basename(MAP_TABLES[k])}.error`)))
  const presets = mapTab('presets'), factions = mapTab('factions'), keyCodes = mapTab('keyCodes')
  // тип мітки спавнера; заодно — предмет, який точки цього типу дають (назва підбирань у перекладах)
  const markerItems = {}
  const markerOf = (p) => { const m = markerOfSpawner(raw, p); if (m?.item) markerItems[m.type] ??= m.item; return m?.type ?? null }
  // ресурси розкладки ГП → стислий файл { types: { тип: { kind, core: [x, y, z, вага, …], aux: […] } } } (вид — у кожної
  // точки свій), кількість і хеш
  let ddRows = null, ddWorld = null
  const ddTyped = (st, points) => {
    const tab = (p) => read(`tables/${path.basename(p)}.json`, `tables/${path.basename(p)}.error`)
    if (!ddWorld) {
      ddWorld = worldOf(tab(DD_WORLD))
      if (!ddWorld?.types || !ddWorld.sizeM) throw new Error('deepdesert_1: нема WorldGenerator (таблиці типів чи геометрії карт тепла)')
      ddRows = rowsOf(tab(ddWorld.types))
    }
    if (!st.group) throw new Error(`розкладка ${st.layout}: нема групи карт тепла`)
    const heatmaps = {}
    for (const h of tab(st.group).find((e) => e.Properties?.m_ResourceDistributionHeatMapData)?.Properties.m_ResourceDistributionHeatMapData ?? []) {
      heatmaps[h.Key] = tab(pkgOfPath(h.Value?.ObjectPath)).find((e) => e.Type === 'HeatMapData')?.Properties
    }
    const types = {}
    let count = 0
    for (const r of normalizeResources({ points, rows: ddRows, world: ddWorld, heatmaps, markerOf })) {
      const t = (types[r.type] ??= {})
      ;(t[r.kind] ??= []).push(r.x, r.y, r.z, r.weight)
      count++
    }
    if (!count) throw new Error(`розкладка ${st.layout}: жодної руди за картами тепла`)
    // вид типу — за більшістю його точок (брухт-підбирання буває й основною точкою)
    for (const t of Object.values(types)) t.kind = (t.core?.length ?? 0) >= (t.aux?.length ?? 0) ? 'core' : 'aux'
    const json = JSON.stringify({ types })
    return { gz: zlib.gzipSync(json), count, hash: createHash('sha256').update(json).digest('hex'), kinds: Object.fromEntries(Object.entries(types).map(([t, v]) => [t, v.kind])) }
  }
  // лут контейнерів: таблиці луту (за іменем пакета, лінькома), розподіл за типом контейнера, теги зон місця
  const lootTab = (name) => { try { return rowsOf(read(`tables/${name}.json`, `tables/${name}.error`)) } catch { return undefined } }
  const lootTables = new Proxy({}, { get: (c, n) => (n in c ? c[n] : (c[n] = lootTab(String(n)))) })
  const lootMemo = new Map()
  /** теги місця: бітові карти набору світу (зони, тири) за геометрією світу + власні теги світу */
  function tagSampler(worldPkg, setPkg) {
    const tab = (p) => read(`tables/${path.basename(p)}.json`, `tables/${path.basename(p)}.error`)
    let w = null
    try { w = worldOf(tab(worldPkg)) } catch { /* світу нема — без тегів зон */ }
    const set = setPkg ?? w?.tagsBitmap
    const fallback = w?.fallbackTags ?? []
    const maps = set && w?.sizeM ? (tab(set).find((e) => e.Properties?.Collection)?.Properties.Collection ?? []).map((c) => {
      const p = pkgOfPath(c.ObjectPath)
      const props = tab(p).find((e) => e.Type === 'BitMapData')?.Properties
      const buf = fs.readFileSync(path.join(raw, 'bytes', path.basename(p) + '.bin'))
      return { s: bitmapSampler(props, buf), W: Number(props?.m_SizeX ?? 0), H: Number(props?.m_SizeY ?? 0) }
    }) : []
    const sx = (w?.sizeM?.X ?? 0) * 100, sy = (w?.sizeM?.Y ?? 0) * 100
    const x0 = (w?.origin?.X ?? 0) - sx / 2, y0 = (w?.origin?.Y ?? 0) - sy / 2
    return (r) => {
      const tags = new Set(fallback)
      // сайт: x — Y гри, y — X гри
      for (const m of maps) for (const t of m.s(Math.floor(((r.y - x0) / sx) * m.W), Math.floor(((r.x - y0) / sy) * m.H))) tags.add(t)
      return tags
    }
  }
  /** лут кожного контейнера: своя таблиця чи таблиця розподілу типу (override, далі загальна) за тегами місця */
  /**
   * правила зон безпеки (DT_SecurityZones: тип → PvP / PvE / City) і тип зони поза об'ємами (ini); таблиці правил нема
   * (давній експорт) — null
   */
  const zoneRules = (() => {
    let rows = {}
    try { rows = rowsOf(read(`tables/${path.basename(MAP_TABLES.securityZones)}.json`)) } catch { /* нема — давній експорт */ }
    const rules = Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, /::(\w+)$/.exec(r.m_SecurityZoneRulesType ?? '')?.[1]]).filter(([, v]) => v))
    const def = /m_DefaultSecurityZoneType=\(Name="([^"]+)"\)/.exec(iniOf(raw) ?? '')?.[1] ?? 'NullSec'
    return Object.keys(rules).length ? { rules, def } : null
  })()
  function applyLoot(records, tagsOf, m, zones = []) {
    const containers = rowsOf((() => { try { return read(`tables/${path.basename(MAP_TABLES.lootContainers)}.json`) } catch { return [] } })())
    const settingsPkg = m.loot.find((p) => path.basename(p) === 'DT_LootDistributionSettings')
    // таблиці, якої нема серед пакетів збірки (на неї лише посилаються) — гра там нічого не дає
    const inBuild = new Set(m.loot.map((p) => path.basename(p)))
    const absent = (name) => !inBuild.has(name)
    const settings = Object.values(settingsPkg ? lootTables[path.basename(settingsPkg)] ?? {} : {})
    for (const r of records) {
      if (r.kind !== 'loot') continue
      const tags = tagsOf(r)
      // зона безпеки місця — об'єм зони, у якому стоїть контейнер (Хаґґа — великий PvE-об'єм із PvP-острівцями, ГП —
      // PvP; PvE-сервер ГП лише вимикає бої — тип зони й лут ті самі): рядки луту PvP і PvE різні. Правил зон нема
      // (давній експорт) — як раніше: ГП — PvP, решта — PvE
      const zone = zoneRules ? zoneAt(zones, [r.y, r.x, r.z ?? 0], zoneRules.rules, zoneRules.def) : r.map === 'deepdesert_1' ? 'PvP' : 'PvE'
      const ov = pkgOfPath(containers[r.type]?.LootDistributionSettingsOverride?.ObjectPath)
      const table = r.lootTable ?? (ov && pickDistribution(Object.values(lootTables[path.basename(ov)] ?? {}), r.type, tags, { own: true, zone })) ?? pickDistribution(settings, r.type, tags, { zone })
      delete r.lootTable
      if (!table) continue
      const key = `${table}|${zone}|${[...tags].sort().join(',')}`
      // лут для всіх і з умовою гравця (з позначкою)
      if (!lootMemo.has(key)) lootMemo.set(key, lootWithBonus(lootTables, table, tags, { zone, absent }))
      r.loot = lootMemo.get(key)
    }
  }
  const map = safe(() => {
    const m = mapPackages(raw)
    if (!m) throw new Error(failed('files.error') || 'нема списку пакетів збірки')
    const tab = (p) => read(`tables/${path.basename(p)}.json`, `tables/${path.basename(p)}.error`)
    // рівень: зламаний — помилка з причиною, нема — null (normalizeMap скаже, якого рівня бракує)
    const level = (p) => {
      const f = levelFile(p)
      const e = failed(`levels/${f}.error`)
      if (e) throw new Error(`рівень ${p}: ${e}`)
      try { return JSON.parse(fs.readFileSync(path.join(raw, 'levels', f + '.json'), 'utf8')) } catch { return null }
    }
    const need = (p) => level(p) ?? (() => { throw new Error(`нема рівня ${p}`) })()
    const configs = {}
    for (const p of m.configs) { const t = tab(p).find((e) => e.Properties?.m_MarkerTypeDisplayed)?.Properties.m_MarkerTypeDisplayed.Name; if (t) configs[path.basename(p)] = t }
    const blocks = Object.fromEntries(m.blocks.map((p) => [path.basename(p), tab(p).find((e) => e.Properties?.m_Data)?.Properties.m_Data]))
    // іменовані NPC гри: фракція й назва з рядка NPC
    const named = new Set(Object.keys(rowsOf(tab(MAP_TABLES.named))))
    const npcs = {}
    for (const [k, r] of Object.entries(rowsOf(tab(MAP_TABLES.npcs)))) {
      const n = r.m_DisplayName
      if (named.has(k) && r.m_Faction?.Name && n?.Key) npcs[k] = { faction: r.m_Faction.Name, name: `${String(n.TableId).split('.').pop()}:${n.Key}` }
    }
    const regions = Object.fromEntries(m.regions.map((p) => [p, need(p)]))
    // поля меланжу й борошнистий пісок Хаґґи — загальні актори світу (як у розкладках ГП)
    // світу ще нема (лише точки без ресурсів) — без загальних акторів; таблиці акторів світ назвав, а їх нема — помилка
    let hw = null
    try { hw = worldOf(tab(MAP_WORLD)) } catch { /* світ — для ресурсів; тут необов'язковий */ }
    const [gt, gi] = hw?.generic ?? []
    const generic = gt && gi ? layoutGenericPoints({ m_GenericActorsTemplates: Object.entries(rowsOf(tab(gt))).map(([Key, Value]) => ({ Key, Value })), m_GenericActorsInstances: Object.values(rowsOf(tab(gi))) }) : []
    const maps = [{ id: 'survival_1', world: MAP_WORLD, ...normalizeMap({ map: 'survival_1', regions, points: generic, blocks, level, configs, npcs }) }]
    // категорії огляду: дерево й категорії за іменем пакета
    const cats = () => Object.fromEntries(m.poiCats.map((p) => [path.basename(p) === 'DA_PoiCategoryTree' ? 'tree' : path.basename(p), tab(p)[0]?.Properties ?? {}]))
    for (const w of m.worlds) {
      const r = normalizeMap({ map: w.id, regions: Object.fromEntries(w.levels.map((p) => [p, need(p)])), blocks, level, configs, npcs })
      // точки мап подорожей (огляд) — у кореневому рівні, з компонентами (повний експорт)
      const root = tab(w.world)
      if (root.some((e) => e.Type === 'BP_OvermapPoi_C')) r.markers.push(...normalizeOvermap(root, cats()))
      maps.push({ id: w.id, world: w.world, ...r })
    }
    // Глибока пустеля: розкладки з ini (вміст і група карт) → кластери → блоки
    const clusters = Object.fromEntries(clustersOf(raw).map((p) => [path.basename(p), tab(p).find((e) => e.Properties?.m_Variations)?.Properties ?? {}]))
    const ddRegions = Object.fromEntries(m.ddRegions.map((p) => [p, need(p)]))
    // ресурси кожної розкладки типізуються й стискаються одразу (17 розкладок сирих точок разом не влазять у пам'ять);
    // збій типізації — помилка лише розділу ddResources
    const dd = ddLayoutSettings(iniOf(raw)).map((st) => {
      const props = tab(st.content).find?.((e) => e.Type === 'WorldLayoutDataAsset')?.Properties
      // розкладка зі списку гри без вмісту — збій експорту, а не порожня розкладка
      if (!props) throw new Error(`розкладка ${st.layout}: нема вмісту ${path.basename(st.content)}`)
      const r = normalizeMap({ map: 'deepdesert_1', layout: st.layout, regions: ddRegions, placements: layoutPlacements(props, clusters), points: layoutGenericPoints(props), blocks, level, configs, npcs })
      let res
      try {
        if (!r.resources.length) throw new Error(`розкладка ${st.layout}: нема точок ресурсів`)
        res = ddTyped(st, r.resources)
      } catch (e) { res = e instanceof Error ? e : new Error(String(e)) }
      return { ...st, markers: r.markers, zones: r.zones, res }
    })
    // лут: Хаґґа й малі мапи — теги зон свого світу; розкладки ГП — свій набір карт за геометрією світу ГП
    for (const x of maps) applyLoot(x.markers, tagSampler(x.world), m, x.zones)
    for (const x of dd) applyLoot(x.markers, tagSampler(DD_WORLD, x.tags), m, x.zones)
    return { maps, dd }
  })
  out.markers = map instanceof Error ? map : { records: [...map.maps, ...map.dd].flatMap((x) => x.markers) }
  // ресурси: тип руди кожної точки — з карт тепла гри (кожен можливий), світ і група — свої в кожної мапи
  out.resources = map instanceof Error ? map : safe(() => {
    const tab = (p) => read(`tables/${path.basename(p)}.json`, `tables/${path.basename(p)}.error`)
    const records = []
    for (const x of map.maps) {
      if (!x.resources.length) continue
      const w = worldOf(tab(x.world))
      if (!w?.types) throw new Error(`${x.id}: нема WorldGenerator мапи (таблиці типів ресурсів)`)
      if (x.id === 'survival_1' && (!w.group || !w.sizeM)) throw new Error('survival_1: нема групи чи геометрії карт тепла')
      const heatmaps = {}
      for (const h of (w.group ? tab(w.group) : []).find((e) => e.Properties?.m_ResourceDistributionHeatMapData)?.Properties.m_ResourceDistributionHeatMapData ?? []) {
        heatmaps[h.Key] = tab(pkgOfPath(h.Value?.ObjectPath)).find((e) => e.Type === 'HeatMapData')?.Properties
      }
      // сотні тисяч записів — не через розгортання аргументів (переповнить стек)
      for (const r of normalizeResources({ points: x.resources, rows: rowsOf(tab(w.types)), world: w, heatmaps, markerOf })) records.push(r)
    }
    return { records }
  })
  // ресурси ГП: сотні тисяч записів на розкладку × 17 — не записами, а стислим файлом на розкладку
  // ({ types: { тип: { kind, pts: [x, y, z, вага, …] } } }); у розділі — лише перелік розкладок з хешем і кількістю
  out.ddResources = map instanceof Error ? map : safe(() => {
    // кожна розкладка зі списку гри — зі своїм файлом; у переліку — типи розкладки (сайту не розпаковувати) і загальна
    // кількість (запобіжник обсягу реєстру)
    const layouts = {}, files = {}
    let count = 0
    for (const x of map.dd) {
      if (x.res instanceof Error) throw x.res
      files[x.layout] = x.res.gz
      layouts[x.layout] = { count: x.res.count, hash: x.res.hash, types: x.res.kinds }
      count += x.res.count
    }
    return { blob: { count, layouts }, files }
  })
  // типи міток (рецепт іконки — DT_IconPreset) і типи точок, яких гра не позначає (фракції NPC, ключі): ті, що є в точках
  out.markerTypes = safe(() => {
    // типи NPC і ключів беруться з точок: без точок типи не застосовуємо (давні точки лишились би без своїх типів)
    if (out.markers instanceof Error) throw new Error('нема точок мапи: ' + out.markers.message)
    const or = (x) => (x instanceof Error ? {} : x)
    const types = normalizeMarkerTypes(rowsOf(read(`tables/${path.basename(MARKER_TYPES)}.json`, `tables/${path.basename(MARKER_TYPES)}.error`)), or(legend), or(presets))
    const pts = out.markers.records
    const used = { npc: pts.filter((r) => r.kind === 'npc').map((r) => r.type), key: pts.filter((r) => r.kind === 'key').map((r) => r.type) }
    const extra = normalizeMapKinds({ factions: or(factions), keyCodes: or(keyCodes), used })
    const clash = extra.find((e) => types.some((t) => t.id === e.id))
    if (clash) throw new Error(`тип ${clash.id}: і мітка гри, і ${clash.kind}`)
    return { records: [...types.map((t) => (markerItems[t.id] ? { ...t, item: markerItems[t.id] } : t)), ...extra] }
  })
  // переклади — для тих видів, що вдалися (зламаний розділ не забирає тексти інших)
  out.texts = safe(() => {
    const ok = (k) => (out[k] instanceof Error ? [] : out[k].records)
    if (!Object.keys(loc).length) throw new Error(failed('loc.error') || 'нема жодної мови')
    const or = (x) => (x instanceof Error ? {} : x)
    const markerRows = safe(() => rowsOf(read(`tables/${path.basename(MARKER_TYPES)}.json`)))
    const rows = { items: or(items), placeables: or(placeables), building: or(building), modules: or(modules), markerTypes: or(markerRows), legend: or(legend), factions: or(factions), keyCodes: or(keyCodes) }
    return { records: normalizeTexts({ loc, rows, records: { items: ok('items'), placeables: ok('placeables'), recipes: ok('recipes'), buildables: ok('buildables'), skills: ok('skills'), markers: ok('markers'), markerTypes: ok('markerTypes') } }) }
  })
  out.config = safe(() => normalizeConfig(fs.readFileSync(path.join(raw, 'DefaultGame.ini'), 'utf8')))
  out.ddLayouts = safe(() => normalizeDdLayouts(fs.readFileSync(path.join(raw, 'DefaultGame.ini'), 'utf8')))
  return out
}

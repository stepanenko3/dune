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
import { normalizeDdLayouts } from '../normalize/ddlayouts.mjs'
import { normalizeMap } from '../normalize/map.mjs'
import { normalizeMarkerTypes } from '../normalize/markertypes.mjs'

export const EXPORT_IMAGE = 'sandwalkers/gd-export:2'
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
/** кластери меланжу, на які посилаються вже експортовані розкладки (тож новий кластер патча підхопиться сам) */
export function spiceClustersOf(out) {
  const names = new Set()
  for (const pkg of LAYOUTS) {
    let exp
    try { exp = JSON.parse(fs.readFileSync(path.join(out, 'tables', path.basename(pkg) + '.json'), 'utf8')) } catch { continue }
    for (const c of exp.find((e) => e.Type === 'WorldLayoutDataAsset')?.Properties?.m_Clusters ?? []) {
      const n = String(c.Value?.ClusterDataAsset?.ObjectPath ?? '').split('/').pop().replace(/\.\d+$/, '')
      if (/^WLC_Spice_/.test(n)) names.add(SOS + n)
    }
  }
  return [...names].sort()
}

/** типи міток мапи (DefaultGame.ini m_MapMarkerTypesDataTable) */
export const MARKER_TYPES = `${SYS}/FullscreenMap/DataTables/FullscreenMapMarkers/CDT_FullscreenMapMarkers`
/** легенда мапи гри: категорії (Місцевість, NPC, Ресурси…) з перекладом і іконки типів */
export const MAP_LEGEND = `${SYS}/FullscreenMap/DataTables/DT_MapLegend`
/**
 * Мапа з контент-блоків — зі списку пакетів збірки (files.txt), тож нові регіони, блоки й мітки патча підхопляться самі:
 * регіони Хаґґи (без звуку, подій MTX, туману, ефектів), описи блоків, налаштування міток.
 */
const MAP = {
  regions: /^DuneSandbox\/Content\/Dune\/Maps\/Arrakis\/SOC_1\/SubLevels\/Survival_1_[^/]+\.umap$/,
  skip: /Audio|MTX|FogCards|VFX|Cinematic/,
  blocks: /^DuneSandbox\/Content\/Dune\/Systems\/DynamicContent\/TerrainBlocks\/Collection\/[^/]+\.uasset$/,
  configs: /^DuneSandbox\/Content\/Dune\/Systems\/StaticMarkers\/StaticMarker_[^/]+\.uasset$/,
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
    blocks: list.filter((p) => MAP.blocks.test(p)).map(noExt),
    configs: list.filter((p) => MAP.configs.test(p)).map(noExt),
  }
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
  const todo = [...Object.values(TABLES), ...LAYOUTS, MARKER_TYPES, MAP_LEGEND].filter((pkg) => !done || !has(pkg))
  const mapDone = () => {
    const m = mapPackages(out)
    const ok = (p) => has(p) && !fs.existsSync(path.join(out, 'tables', path.basename(p) + '.error'))
    return !!m && [...m.configs, ...m.blocks].every(ok) && [...m.regions, ...blockLevels(out, m.blocks)].every(hasLevel)
  }
  if (done && !todo.length && spiceClustersOf(out).every(has) && mapDone()) return out
  if (!done) fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(path.join(out, 'tables'), { recursive: true })
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
    await batchOf('tables', [...m.configs, ...m.blocks].filter((p) => !tableOk(p)), (p) => `tables/${path.basename(p)}`)
    fs.mkdirSync(path.join(out, 'levels'), { recursive: true })
    await batchOf('levels', [...m.regions, ...blockLevels(out, m.blocks)].filter((p) => !hasLevel(p)), (p) => `levels/${levelFile(p)}`)
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
  // легенда не вдалася — типи без категорій (групи на мапі тоді за тегом), але не без типів
  out.markerTypes = safe(() => ({ records: normalizeMarkerTypes(rowsOf(read(`tables/${path.basename(MARKER_TYPES)}.json`, `tables/${path.basename(MARKER_TYPES)}.error`)), legend instanceof Error ? {} : legend) }))
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
    const configs = {}
    for (const p of m.configs) { const t = tab(p).find((e) => e.Properties?.m_MarkerTypeDisplayed)?.Properties.m_MarkerTypeDisplayed.Name; if (t) configs[path.basename(p)] = t }
    const blocks = Object.fromEntries(m.blocks.map((p) => [path.basename(p), tab(p).find((e) => e.Properties?.m_Data)?.Properties.m_Data]))
    const regions = {}
    for (const p of m.regions) regions[p] = level(p) ?? (() => { throw new Error(`нема рівня ${p}`) })()
    return normalizeMap({ map: 'survival_1', regions, blocks, level, configs })
  })
  out.markers = map instanceof Error ? map : { records: map.markers }
  out.resources = map instanceof Error ? map : { records: map.resources }
  // переклади — для тих видів, що вдалися (зламаний розділ не забирає тексти інших)
  out.texts = safe(() => {
    const ok = (k) => (out[k] instanceof Error ? [] : out[k].records)
    if (!Object.keys(loc).length) throw new Error(failed('loc.error') || 'нема жодної мови')
    const or = (x) => (x instanceof Error ? {} : x)
    const markerRows = safe(() => rowsOf(read(`tables/${path.basename(MARKER_TYPES)}.json`)))
    const rows = { items: or(items), placeables: or(placeables), building: or(building), modules: or(modules), markerTypes: or(markerRows), legend: or(legend) }
    return { records: normalizeTexts({ loc, rows, records: { items: ok('items'), placeables: ok('placeables'), recipes: ok('recipes'), buildables: ok('buildables'), skills: ok('skills'), markers: ok('markers') } }) }
  })
  out.config = safe(() => normalizeConfig(fs.readFileSync(path.join(raw, 'DefaultGame.ini'), 'utf8')))
  out.ddLayouts = safe(() => normalizeDdLayouts(fs.readFileSync(path.join(raw, 'DefaultGame.ini'), 'utf8')))
  return out
}

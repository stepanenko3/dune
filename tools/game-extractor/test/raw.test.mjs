// Сирий експорт і нормалізація: зламана таблиця, мова чи станції не блокують інші розділи; файли експорту — від імені
// поточного користувача (на Linux docker інакше пише root-ом, і prune не може їх стерти).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { exportRaw, LAYOUTS, MAP_LEGEND, MARKER_TYPES, normalizeRaw, TABLES } from '../lib/raw.mjs'
import { LANG_DIRS } from '../normalize/texts.mjs'

const FX = new URL('./fixtures/', import.meta.url)
const fx = (f) => fs.readFileSync(new URL(f, FX), 'utf8')
const FILES = { items: 'items.json', placeables: 'placeables.json', recipes: 'recipes.json', building: 'building.json', group: 'group.json', sets: 'sets.json', subcat: 'subcat.json' }

/** сирий експорт збірки 7 з фікстур */
function makeRaw(work) {
  const raw = path.join(work, 'raw', '7')
  fs.mkdirSync(path.join(raw, 'tables'), { recursive: true })
  fs.mkdirSync(path.join(raw, 'loc'), { recursive: true })
  for (const [k, f] of Object.entries(FILES)) fs.writeFileSync(path.join(raw, 'tables', path.basename(TABLES[k]) + '.json'), fx(f))
  for (const l of Object.keys(LANG_DIRS)) fs.writeFileSync(path.join(raw, 'loc', l + '.json'), fx('loc-uk.json'))
  fs.writeFileSync(path.join(raw, 'stations.json'), fx('stations.json'))
  fs.writeFileSync(path.join(raw, 'DefaultGame.ini'), fx('DefaultGame.ini'))
  fs.writeFileSync(path.join(raw, '.done'), 'x')
  return raw
}

describe('нормалізація сирого експорту', () => {
  let work
  beforeEach(() => { work = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-raw-')) })

  it('нема таблиці рецептів — помилка лише рецептів', () => {
    const raw = makeRaw(work)
    fs.rmSync(path.join(raw, 'tables', 'DT_ItemsCraftingRecipes.json'))
    const s = normalizeRaw({ work, build: '7' })
    expect(s.recipes).toBeInstanceOf(Error)
    expect(s.items.records.length).toBeGreaterThan(0)
    expect(s.config.blob).toBeTruthy()
    // розклад розкладок ГП — з того самого DefaultGame.ini
    expect(s.ddLayouts.blob.seeds.length).toBeGreaterThan(0)
  })

  it('зламані модулі — переклади предметів лишаються', () => {
    const raw = makeRaw(work)
    fs.rmSync(path.join(raw, 'tables', 'DT_DuneBuildableUiSubcategory.json'))
    const s = normalizeRaw({ work, build: '7' })
    expect(s.buildables).toBeInstanceOf(Error)
    expect(s.texts.records.map((r) => r.id)).toContain('item:AluminiumBar:uk')
  })
})

describe('сирий експорт', () => {
  let work, root
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-exp-'))
    root = path.join(work, 'game')
    fs.mkdirSync(path.join(root, 'Config'), { recursive: true })
    fs.writeFileSync(path.join(root, 'Config', 'DefaultGame.ini'), fx('DefaultGame.ini'))
  })

  it('таблиця й станції, що впали, — позначені помилкою, решта експортовано; від імені користувача', async () => {
    const calls = []
    const docker = async (args) => {
      calls.push(args)
      if (args.includes(TABLES.recipes) && args.includes('tables')) throw new Error('нема пакета')
      if (args.includes('stations')) throw new Error('нема BP')
      return { code: 0, out: '' }
    }
    const out = await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker, ensure: async () => {} })
    expect(fs.existsSync(path.join(out, '.done'))).toBe(true)
    expect(fs.readFileSync(path.join(out, 'tables', 'DT_ItemsCraftingRecipes.error'), 'utf8')).toContain('нема пакета')
    expect(fs.readFileSync(path.join(out, 'stations.error'), 'utf8')).toContain('нема BP')
    // кожна таблиця — окремим запуском
    expect(calls.filter((a) => a.includes('tables'))).toHaveLength(Object.keys(TABLES).length + LAYOUTS.length + 2)
    if (process.getuid) expect(calls[0]).toEqual(expect.arrayContaining(['--user', `${process.getuid()}:${process.getgid()}`]))
    expect(calls[0]).toEqual(expect.arrayContaining(['--network', 'none']))
  })

  it('експорт уже є, а нових таблиць нема — досвантажуються лише вони', async () => {
    const out = path.join(work, 'raw', '7')
    fs.mkdirSync(path.join(out, 'tables'), { recursive: true })
    for (const k of ['items', 'placeables', 'recipes', 'building', 'group', 'sets', 'subcat']) fs.writeFileSync(path.join(out, 'tables', path.basename(TABLES[k]) + '.json'), '[]')
    for (const pkg of [...LAYOUTS, MARKER_TYPES, MAP_LEGEND]) fs.writeFileSync(path.join(out, 'tables', path.basename(pkg) + '.json'), '[]')
    fs.writeFileSync(path.join(out, 'files.txt'), '')
    fs.writeFileSync(path.join(out, '.done'), 'x')
    const calls = []
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker: async (args) => { calls.push(args); return { code: 0, out: '' } }, ensure: async () => {} })
    expect(calls.map((a) => a.at(-1)).sort()).toEqual([TABLES.abilityStats, TABLES.abilityTuning, TABLES.modules, TABLES.skillCosts].sort())
    expect(calls.every((a) => a.includes('tables'))).toBe(true)
  })

  it('таблиця, що впала минулого разу, експортується знову; стара помилка прибрана', async () => {
    const out = path.join(work, 'raw', '7')
    fs.mkdirSync(path.join(out, 'tables'), { recursive: true })
    for (const pkg of [...Object.values(TABLES), ...LAYOUTS, MARKER_TYPES, MAP_LEGEND]) if (pkg !== TABLES.modules) fs.writeFileSync(path.join(out, 'tables', path.basename(pkg) + '.json'), '[]')
    fs.writeFileSync(path.join(out, 'files.txt'), '')
    fs.writeFileSync(path.join(out, 'tables', 'DT_TrainingModules.error'), 'docker впав')
    fs.writeFileSync(path.join(out, '.done'), 'x')
    const calls = []
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker: async (args) => { calls.push(args); return { code: 0, out: '' } }, ensure: async () => {} })
    expect(calls.map((a) => a.at(-1))).toEqual([TABLES.modules])
    expect(fs.existsSync(path.join(out, 'tables', 'DT_TrainingModules.error'))).toBe(false)
  })

  it('нормалізація бачить причину збою таблиці', async () => {
    const docker = async (args) => { if (args.includes(TABLES.items) && args.includes('tables')) throw new Error('пак зламано'); return { code: 0, out: '' } }
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker, ensure: async () => {} })
    const s = normalizeRaw({ work, build: '7' })
    expect(s.items).toBeInstanceOf(Error)
    expect(s.items.message).toContain('пак зламано')
  })
})

describe('мапа: експорт і нормалізація', () => {
  const C = 'DuneSandbox/Content/Dune'
  const REG = `${C}/Maps/Arrakis/SOC_1/SubLevels/Survival_1_Sheol.umap`
  const BLK = `${C}/Systems/DynamicContent/TerrainBlocks/Collection/CB_X`
  const CFG = `${C}/Systems/StaticMarkers/StaticMarker_Cave`
  const lvl = (n) => ({ AssetPathName: `/Game/Dune/Maps/Biomes/X/CB/${n}.${n}`, SubPathString: '' })
  const blockJson = [{ Type: 'TerrainBlockDataAsset', Properties: { m_Data: { Versions: [{ Level: lvl('CB_X'), SubLevels: [{ Level: lvl('CB_X_Foliage_NE'), GroupsNames: [] }, { Level: lvl('CB_X_Gameplay'), RelativeLocation: { X: 0, Y: 0, Z: 0 }, GroupsNames: [] }], SubLevelsGroups: [], SubContentBlocksSettings: [] }] } } }]
  const files = [REG, `${C}/Maps/Arrakis/SOC_1/SubLevels/Survival_1_Sheol_Audio.umap`, BLK + '.uasset', CFG + '.uasset', `${C}/Other/Thing.uasset`].join('\n')
  let work, root
  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-map-'))
    root = path.join(work, 'game')
    fs.mkdirSync(path.join(root, 'Config'), { recursive: true })
    fs.writeFileSync(path.join(root, 'Config', 'DefaultGame.ini'), fx('DefaultGame.ini'))
  })
  const fakeDocker = (calls) => async (args) => {
    calls.push(args)
    const dir = args.find((a) => a.endsWith(':/out')).slice(0, -5)
    const i = args.indexOf('sandwalkers/gd-export:2')
    const cmd = args[i + 1]
    if (cmd === 'files') fs.writeFileSync(path.join(dir, 'files.txt'), files)
    if (cmd === 'tables') for (const p of args.slice(i + 2)) if (p === BLK) fs.writeFileSync(path.join(dir, 'tables', 'CB_X.json'), JSON.stringify(blockJson))
    return { code: 0, out: '' }
  }

  it('список пакетів → описи блоків і налаштування міток одним запуском; рівні — регіони й рівні блоків (без звуку, світла, листя)', async () => {
    const calls = []
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker: fakeDocker(calls), ensure: async () => {} })
    const cmd = (c) => calls.filter((a) => a[a.indexOf('sandwalkers/gd-export:2') + 1] === c).map((a) => a.slice(a.indexOf('sandwalkers/gd-export:2') + 2))
    expect(cmd('files')).toHaveLength(1)
    expect(cmd('tables')).toContainEqual([CFG, BLK])
    expect(cmd('levels')).toEqual([[REG, `${C}/Maps/Biomes/X/CB/CB_X.umap`, `${C}/Maps/Biomes/X/CB/CB_X_Gameplay.umap`]])
  })

  it('нормалізація: точки з блоків і типи міток; рівня нема — помилка лише розділу markers', async () => {
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker: fakeDocker([]), ensure: async () => {} })
    const raw = path.join(work, 'raw', '7')
    fs.mkdirSync(path.join(raw, 'levels'), { recursive: true })
    fs.writeFileSync(path.join(raw, 'tables', 'StaticMarker_Cave.json'), JSON.stringify([{ Type: 'DuneStaticMarkerActorDataAsset', Properties: { m_MarkerTypeDisplayed: { Name: 'Cave' } } }]))
    fs.writeFileSync(path.join(raw, 'tables', path.basename(MARKER_TYPES) + '.json'), JSON.stringify([{ Rows: { Cave: { m_MarkerFilterTag: { TagName: 'MapMarkers.Location.Static.Cave' }, m_bIsStatic: true } } }]))
    const actor = { c: 'BP_TerrainBlockActor_C', n: 'B', l: [10, 20, 0], r: [0, 0, 0], p: { m_TerrainBlockAsset: { ObjectPath: '/Game/Dune/Systems/DynamicContent/TerrainBlocks/Collection/CB_X.0' } } }
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Arrakis~SOC_1~SubLevels~Survival_1_Sheol.json'), JSON.stringify({ actors: [actor], nodes: [] }))
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X.json'), JSON.stringify({ actors: [{ c: 'DuneStaticMarkerActor', n: 'M', l: [1, 2, 3], p: { m_ConfigurationAsset: { AssetPathName: '/Game/Dune/Systems/StaticMarkers/StaticMarker_Cave.StaticMarker_Cave' } } }], nodes: [] }))
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X_Gameplay.error'), 'зламаний рівень')
    let s = normalizeRaw({ work, build: '7' })
    expect(s.markers).toBeInstanceOf(Error)
    expect(s.markers.message).toContain('зламаний рівень')
    expect(s.markerTypes.records).toEqual([{ id: 'Cave', tag: 'MapMarkers.Location.Static.Cave', icon: null, static: true, legend: null }])
    fs.rmSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X_Gameplay.error'))
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X_Gameplay.json'), JSON.stringify({ actors: [], nodes: [] }))
    s = normalizeRaw({ work, build: '7' })
    expect(s.markers.records).toEqual([{ id: 'survival_1@22:11', map: 'survival_1', kind: 'marker', type: 'Cave', x: 22, y: 11, z: 3 }])
  })

  it('пачка рівнів упала посередині: помилка — лише тим, хто не записався; повторний запуск прибирає давні помилки', async () => {
    let fail = true
    const calls = []
    const docker = async (args) => {
      calls.push(args)
      const i = args.indexOf('sandwalkers/gd-export:2')
      const dir = args.find((a) => a.endsWith(':/out')).slice(0, -5)
      if (args[i + 1] === 'files') fs.writeFileSync(path.join(dir, 'files.txt'), files)
      if (args[i + 1] === 'tables') for (const p of args.slice(i + 2)) if (p === BLK) fs.writeFileSync(path.join(dir, 'tables', 'CB_X.json'), JSON.stringify(blockJson))
      if (args[i + 1] === 'levels') {
        // перший рівень пачки записався, далі docker упав
        fs.mkdirSync(path.join(dir, 'levels'), { recursive: true })
        fs.writeFileSync(path.join(dir, 'levels', 'Dune~Maps~Arrakis~SOC_1~SubLevels~Survival_1_Sheol.json'), '{"actors":[],"nodes":[]}')
        if (fail) throw new Error('docker впав')
        for (const n of ['Dune~Maps~Biomes~X~CB~CB_X', 'Dune~Maps~Biomes~X~CB~CB_X_Gameplay']) fs.writeFileSync(path.join(dir, 'levels', n + '.json'), '{"actors":[],"nodes":[]}')
      }
      return { code: 0, out: '' }
    }
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker, ensure: async () => {} })
    const lv = path.join(work, 'raw', '7', 'levels')
    expect(fs.existsSync(path.join(lv, 'Dune~Maps~Arrakis~SOC_1~SubLevels~Survival_1_Sheol.error'))).toBe(false)
    expect(fs.readFileSync(path.join(lv, 'Dune~Maps~Biomes~X~CB~CB_X.error'), 'utf8')).toContain('docker впав')
    fail = false
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker, ensure: async () => {} })
    expect(fs.readdirSync(lv).filter((f) => f.endsWith('.error'))).toEqual([])
  })
})

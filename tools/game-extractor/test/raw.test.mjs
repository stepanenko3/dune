// Сирий експорт і нормалізація: зламана таблиця, мова чи станції не блокують інші розділи; файли експорту — від імені
// поточного користувача (на Linux docker інакше пише root-ом, і prune не може їх стерти).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { DD_WORLD, exportRaw, LAYOUTS, MAP_LEGEND, MAP_TABLES, MAP_WORLD, mapPackages, MARKER_TYPES, normalizeRaw, TABLES } from '../lib/raw.mjs'
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
    expect(calls.filter((a) => a.includes('tables'))).toHaveLength(Object.keys(TABLES).length + LAYOUTS.length + 2 + Object.keys(MAP_TABLES).length)
    if (process.getuid) expect(calls[0]).toEqual(expect.arrayContaining(['--user', `${process.getuid()}:${process.getgid()}`]))
    expect(calls[0]).toEqual(expect.arrayContaining(['--network', 'none']))
  })

  it('експорт уже є, а нових таблиць нема — досвантажуються лише вони', async () => {
    const out = path.join(work, 'raw', '7')
    fs.mkdirSync(path.join(out, 'tables'), { recursive: true })
    for (const k of ['items', 'placeables', 'recipes', 'building', 'group', 'sets', 'subcat']) fs.writeFileSync(path.join(out, 'tables', path.basename(TABLES[k]) + '.json'), '[]')
    for (const pkg of [...LAYOUTS, MARKER_TYPES, MAP_LEGEND, MAP_WORLD, DD_WORLD, ...Object.values(MAP_TABLES)]) fs.writeFileSync(path.join(out, 'tables', path.basename(pkg) + '.json'), '[]')
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
    for (const pkg of [...Object.values(TABLES), ...LAYOUTS, MARKER_TYPES, MAP_LEGEND, MAP_WORLD, DD_WORLD, ...Object.values(MAP_TABLES)]) if (pkg !== TABLES.modules) fs.writeFileSync(path.join(out, 'tables', path.basename(pkg) + '.json'), '[]')
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
    const i = args.indexOf('sandwalkers/gd-export:3')
    const cmd = args[i + 1]
    if (cmd === 'files') fs.writeFileSync(path.join(dir, 'files.txt'), files)
    if (cmd === 'tables') for (const p of args.slice(i + 2)) {
      if (p === BLK) fs.writeFileSync(path.join(dir, 'tables', 'CB_X.json'), JSON.stringify(blockJson))
      if ([...Object.values(MAP_TABLES), ...LAYOUTS].includes(p)) fs.writeFileSync(path.join(dir, 'tables', path.basename(p) + '.json'), '[]')
    }
    return { code: 0, out: '' }
  }

  it('список пакетів → описи блоків і налаштування міток одним запуском; рівні — регіони й рівні блоків (без звуку, світла, листя)', async () => {
    const calls = []
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker: fakeDocker(calls), ensure: async () => {} })
    const cmd = (c) => calls.filter((a) => a[a.indexOf('sandwalkers/gd-export:3') + 1] === c).map((a) => a.slice(a.indexOf('sandwalkers/gd-export:3') + 2))
    expect(cmd('files')).toHaveLength(1)
    expect(cmd('tables')).toContainEqual([CFG, BLK])
    expect(cmd('levels')).toEqual([[REG, `${C}/Maps/Biomes/X/CB/CB_X.umap`, `${C}/Maps/Biomes/X/CB/CB_X_Gameplay.umap`]])
  })

  it('регіони Хаґґи: постійний вміст DLC (Survival_1_MTX_Journey — звичайні блоки, уламок «Мітри») — так; сезонні події (*_MTXEvent) — ні', () => {
    const dir = path.join(work, 'pk')
    fs.mkdirSync(dir)
    const sub = `${C}/Maps/Arrakis/SOC_1/SubLevels`
    fs.writeFileSync(path.join(dir, 'files.txt'), [REG, `${sub}/Survival_1_MTX_Journey.umap`, `${sub}/Survival_1_Sheol_MTXEvent.umap`, `${sub}/Survival_1_Global_MTXEvent.umap`].join('\n'))
    expect(mapPackages(dir).regions).toEqual([REG, `${sub}/Survival_1_MTX_Journey.umap`])
  })

  it('нормалізація: точки з блоків і типи міток; рівня нема — помилка розділу markers (і типів: вони з точок)', async () => {
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
    // типи точок без точок не застосовуються: інакше типи NPC і ключів (з точок) зникли б при давніх точках
    expect(s.markerTypes).toBeInstanceOf(Error)
    fs.rmSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X_Gameplay.error'))
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X_Gameplay.json'), JSON.stringify({ actors: [], nodes: [] }))
    s = normalizeRaw({ work, build: '7' })
    expect(s.markers.records).toEqual([{ id: 'survival_1@22:11', map: 'survival_1', kind: 'marker', type: 'Cave', x: 22, y: 11, z: 3 }])
    expect(s.markerTypes.records).toEqual([{ id: 'Cave', tag: 'MapMarkers.Location.Static.Cave', icon: null, static: true, legend: null, look: null }])
  })

  it('пачка рівнів упала посередині: помилка — лише тим, хто не записався; повторний запуск прибирає давні помилки', async () => {
    let fail = true
    const calls = []
    const docker = async (args) => {
      calls.push(args)
      const i = args.indexOf('sandwalkers/gd-export:3')
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

  it('ресурси: світ мапи → таблиця типів і група карт тепла → карти, спавнери → компоненти (тип мітки); тип руди в точках', async () => {
    const G = '/Game/Dune/Systems/GlobalDistribution'
    const json = {
      'Survival_1.umap': [{ Type: 'DuneWorldGenerator', Properties: {
        m_WorldOriginOffset: { X: 0, Y: 0, Z: 0 }, m_WorldSizeInMeters: { X: 400, Y: 400 }, m_ResourceTypesTable: { AssetPathName: `${G}/DT_ResourceTypes.DT_ResourceTypes` }, m_WorldHeatMaps: [{ ResourceDistributionGroup: { AssetPathName: `${G}/Groups/DA_Group.DA_Group` } }],
        m_GenericActorsTemplatesTable: { AssetPathName: '/Game/Dune/Maps/Arrakis/SOC_1/DataTables/GeneratedContent/DT_GA_T.DT_GA_T' },
        m_GenericActorsInstancesTable: { AssetPathName: '/Game/Dune/Maps/Arrakis/SOC_1/DataTables/GeneratedContent/DT_GA_I.DT_GA_I' },
      } }],
      DT_GA_T: [{ Rows: { SpiceSand_Small: { ActorClass: { AssetPathName: '/Game/Dune/Systems/SpiceHarvesting/SmallSpiceField/BP_SpiceField_Small.BP_SpiceField_Small_C' } }, DE_Tn: { ActorClass: { AssetPathName: '' }, Factory: { AssetPathName: '/Game/X/GAF.GAF' } } } }],
      DT_GA_I: [{ Rows: { a: { TemplateName: 'SpiceSand_Small', Location: { X: 11, Y: 22, Z: 0 } }, b: { TemplateName: 'DE_Tn', Location: { X: 1, Y: 1, Z: 0 } } } }],
      DT_ResourceTypes: [{ Rows: { Azurite: { ResourcePointGroupName: 'Minerals', SpawnerVariants: [{ HeatmapName: 'Azurite', ResourceSpawnerClassCore: { AssetPathName: `${G}/BP_Az_Spawner.BP_Az_Spawner_C` }, ResourceSpawnerClassAux: { AssetPathName: '' } }] } } }],
      DA_Group: [{ Properties: { m_ResourceDistributionHeatMapData: [{ Key: 'Azurite', Value: { ObjectPath: '/Game/Dune/Tools/HM/BP_HM_Copper.0' } }] } }],
      BP_HM_Copper: [{ Type: 'HeatMapData', Properties: { m_SizeX: 1, m_SizeY: 1, m_bStoredAsPalette: true, m_PaletteBitDepth: 1, m_PaletteColors: [0, 77], m_PackedColorIndices: [1] } }],
      // шаблон компонента в самому спавнері перевизначає тип мітки класу компонента (так у грі зі Stravidium/Titanium)
      BP_Az_Spawner: [
        { Type: 'SCS_Node', Properties: { ComponentClass: { ObjectPath: '/Game/Dune/Systems/Harvesting/BP_Az_Component.0' }, ComponentTemplate: { ObjectName: "BP_Az_Component_C'BP_Az_Spawner_C:BP_Az_Component_GEN_VARIABLE'" } } },
        { Type: 'SCS_Node', Properties: { ComponentClass: { ObjectPath: '/Script/Engine' } } },
        { Type: 'BP_Az_Component_C', Name: 'BP_Az_Component_GEN_VARIABLE', Properties: { m_MapMarkerType: { Name: 'AzuriteOreRich' }, m_ResourceIdentifier: { Name: 'AzuriteOre' } } },
      ],
      BP_Az_Component: [{ Type: 'BP_Az_Component_C', Name: 'Default__BP_Az_Component_C', Properties: { m_MapMarkerType: { Name: 'AzuriteOre' } } }],
    }
    const passes = []
    const docker = async (args) => {
      const i = args.indexOf('sandwalkers/gd-export:3')
      const dir = args.find((a) => a.endsWith(':/out')).slice(0, -5)
      if (args[i + 1] === 'files') fs.writeFileSync(path.join(dir, 'files.txt'), files)
      if (args[i + 1] === 'tables') {
        passes.push(args.slice(i + 2).map((p) => path.basename(p)))
        for (const p of args.slice(i + 2)) {
          const b = path.basename(p)
          if (p === BLK) fs.writeFileSync(path.join(dir, 'tables', 'CB_X.json'), JSON.stringify(blockJson))
          if ([...Object.values(MAP_TABLES), ...LAYOUTS].includes(p)) fs.writeFileSync(path.join(dir, 'tables', b + '.json'), '[]')
          if (json[b]) fs.writeFileSync(path.join(dir, 'tables', b + '.json'), JSON.stringify(json[b]))
        }
      }
      return { code: 0, out: '' }
    }
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker, ensure: async () => {} })
    const order = passes.flat()
    for (const n of ['Survival_1.umap', 'DT_ResourceTypes', 'DA_Group', 'BP_HM_Copper', 'BP_Az_Spawner', 'BP_Az_Component', 'DT_GA_T', 'DT_GA_I']) expect(order).toContain(n)
    expect(order.indexOf('BP_Az_Component')).toBeGreaterThan(order.indexOf('BP_Az_Spawner'))
    // нормалізація: точка Minerals (core) у межах світу → AzuriteOre з вагою карти
    const raw = path.join(work, 'raw', '7')
    fs.mkdirSync(path.join(raw, 'levels'), { recursive: true })
    fs.writeFileSync(path.join(raw, 'tables', 'StaticMarker_Cave.json'), JSON.stringify([{ Properties: { m_MarkerTypeDisplayed: { Name: 'Cave' } } }]))
    const actor = { c: 'BP_TerrainBlockActor_C', n: 'B', l: [0, 0, 0], r: [0, 0, 0], p: { m_TerrainBlockAsset: { ObjectPath: '/Game/Dune/Systems/DynamicContent/TerrainBlocks/Collection/CB_X.0' } } }
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Arrakis~SOC_1~SubLevels~Survival_1_Sheol.json'), JSON.stringify({ actors: [actor], nodes: [] }))
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X.json'), JSON.stringify({ actors: [], nodes: [{ k: 'Minerals', pts: [[100, 200, 0, 1]] }] }))
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X_Gameplay.json'), JSON.stringify({ actors: [], nodes: [] }))
    const s = normalizeRaw({ work, build: '7' })
    expect(s.resources.records).toEqual([{ id: 'survival_1@200:100~AzuriteOreRich', map: 'survival_1', kind: 'core', type: 'AzuriteOreRich', weight: 77, x: 200, y: 100, z: 0 }])
    // поля меланжу Хаґґи — із загальних акторів світу (виняток користувача: клас поля → тип мітки); події — ні
    expect(s.markers.records.filter((r) => r.type === 'SpiceFieldSmall').map((r) => r.id)).toEqual(['survival_1@22:11'])
    // тип мітки знає предмет, який точка дає (назва підбирань — з нього)
    fs.writeFileSync(path.join(raw, 'tables', path.basename(MARKER_TYPES) + '.json'), JSON.stringify([{ Rows: { AzuriteOreRich: { m_MarkerFilterTag: { TagName: 'MapMarkers.Resource.Node.Ores' } } } }]))
    expect(normalizeRaw({ work, build: '7' }).markerTypes.records.find((r) => r.id === 'AzuriteOreRich').item).toBe('AzuriteOre')
  })

  it('місто (World Composition): корінь і рівні теки експортуються; NPC — тип фракції з іконкою, ключ — з кольором і назвою', async () => {
    const CITY = `${C}/Maps/SocialHubs/Town/SH_Town`
    const cityFiles = [files, `${CITY}.umap`, `${CITY}_Gameplay.umap`, `${CITY}_Audio.umap`].join('\n')
    const ROW = (o) => [{ Rows: o }]
    const json = {
      CDT_NPCConfigs: ROW({ n1: { m_Faction: { Name: 'Atreides' }, m_DisplayName: { TableId: '/Game/Dune/Localization/ST_NPCs.ST_NPCs', Key: 'NPC/REP' } }, g1: { m_Faction: { Name: 'Atreides' }, m_DisplayName: { TableId: '/Game/Dune/Localization/ST_NPCs.ST_NPCs', Key: 'NPC/GUARD' } } }),
      DT_NPCConfigs_Named: ROW({ n1: {} }),
      DT_FactionData: ROW({ Atreides: { m_FactionIcon: { AssetPathName: '/Game/Dune/GUI/Textures/Icons/Gameplay/Factions/T_UI_IconsFactionsArtreides_D.T_UI_IconsFactionsArtreides_D' }, m_DisplayName: { CultureInvariantString: 'Atreides' } } }),
      DT_InteractionKeyCodes: ROW({ Code_EcoLab_Green: { m_KeyColor: { Hex: '11B000' }, m_DisplayName: { TableId: '/Game/Dune/Localization/ST_Localization_Items.ST_Localization_Items', Key: 'ITEMS/KEYCODE_GREEN' } } }),
      DT_IconPreset: ROW({}),
      'SH_Town.umap': [],
    }
    const calls = []
    const docker = async (args) => {
      calls.push(args)
      const i = args.indexOf('sandwalkers/gd-export:3')
      const dir = args.find((a) => a.endsWith(':/out')).slice(0, -5)
      if (args[i + 1] === 'files') fs.writeFileSync(path.join(dir, 'files.txt'), cityFiles)
      if (args[i + 1] === 'tables') for (const p of args.slice(i + 2)) {
        const b = path.basename(p)
        if (p === BLK) fs.writeFileSync(path.join(dir, 'tables', 'CB_X.json'), JSON.stringify(blockJson))
        if (LAYOUTS.includes(p)) fs.writeFileSync(path.join(dir, 'tables', b + '.json'), '[]')
        if (json[b]) fs.writeFileSync(path.join(dir, 'tables', b + '.json'), JSON.stringify(json[b]))
      }
      return { code: 0, out: '' }
    }
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker, ensure: async () => {} })
    const levels = calls.filter((a) => a[a.indexOf('sandwalkers/gd-export:3') + 1] === 'levels').flatMap((a) => a.slice(a.indexOf('sandwalkers/gd-export:3') + 2))
    expect(levels).toEqual(expect.arrayContaining([`${CITY}.umap`, `${CITY}_Gameplay.umap`]))
    expect(levels).not.toContain(`${CITY}_Audio.umap`)
    const raw = path.join(work, 'raw', '7')
    fs.mkdirSync(path.join(raw, 'levels'), { recursive: true })
    fs.mkdirSync(path.join(raw, 'loc'), { recursive: true })
    fs.writeFileSync(path.join(raw, 'loc', 'uk.json'), JSON.stringify({ ST_Localization_Items: { 'ITEMS/KEYCODE_GREEN': 'Зелений браслет' } }))
    fs.writeFileSync(path.join(raw, 'tables', 'StaticMarker_Cave.json'), '[]')
    fs.writeFileSync(path.join(raw, 'tables', path.basename(MARKER_TYPES) + '.json'), '[]')
    for (const n of ['Dune~Maps~Arrakis~SOC_1~SubLevels~Survival_1_Sheol', 'Dune~Maps~SocialHubs~Town~SH_Town']) fs.writeFileSync(path.join(raw, 'levels', n + '.json'), '{"actors":[],"nodes":[]}')
    const npc = (row, l) => ({ c: 'BP_AiSpawnLocation_C', n: 'N', l, p: { m_bIsStatic: true, NPCType: { RowName: row } } })
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~SocialHubs~Town~SH_Town_Gameplay.json'), JSON.stringify({ actors: [npc('n1', [1, 2, 0]), npc('g1', [3, 4, 0]), { c: 'BP_PentashieldKey_C', n: 'K', l: [5, 6, 0], p: { m_NeededKey: { Name: 'Code_EcoLab_Green' } } }], nodes: [] }))
    const s = normalizeRaw({ work, build: '7' })
    expect(s.markers.records).toEqual([
      { id: 'sh_town@2:1', map: 'sh_town', kind: 'npc', type: 'Atreides', name: 'ST_NPCs:NPC/REP', x: 2, y: 1, z: 0 },
      { id: 'sh_town@6:5', map: 'sh_town', kind: 'key', type: 'Code_EcoLab_Green', x: 6, y: 5, z: 0 },
    ])
    expect(s.markerTypes.records.map((r) => [r.id, r.kind, r.icon?.split('/').pop(), r.color])).toEqual([['Atreides', 'npc', 'T_UI_IconsFactionsArtreides_D', null], ['Code_EcoLab_Green', 'key', 'T_UI_IconPickupKeycode_D', '#11B000']])
    const t = Object.fromEntries(s.texts.records.map((r) => [r.id, r.name]))
    expect(t['markerType:Atreides:uk']).toBe('Atreides')
    expect(t['markerType:Code_EcoLab_Green:uk']).toBe('Зелений браслет')
  })

  it('Глибока пустеля: розкладка з ini → кластери → блоки; місця з номером розкладки, ресурси — за картами розкладки, файлом на розкладку', async () => {
    const G = '/Game/Dune/Systems/GlobalDistribution'
    const SOS = '/Game/Dune/Maps/Arrakis/SeaOfSand'
    fs.appendFileSync(path.join(root, 'Config', 'DefaultGame.ini'), `\n[/Script/DuneSandbox.WorldLayoutSubsystem]\nm_WorldLayoutsPerWorld=(("/Game/Dune/Maps/Arrakis/DeepDesert_1/DeepDesert_1.DeepDesert_1", (WorldLayoutsSettingsList=((Content="/Game/Dune/Maps/Arrakis/DeepDesert_1/Layouts/DA_DeepDesert_1_Layout_11.DA_DeepDesert_1_Layout_11",HeatMapSettings=(ResourceDistributionGroup="${G}/Groups/DA_DD11.DA_DD11"))))))\n`)
    const json = {
      DA_DeepDesert_1_Layout_11: [{ Type: 'WorldLayoutDataAsset', Properties: {
        m_Clusters: [{ Key: '1', Value: { ClusterAnchor: { X: 0, Y: 0 }, ClusterDataAsset: { ObjectPath: `${SOS}/WLC_T.0` }, ClusterVariation: 'Default' } }],
        m_GenericActorsTemplates: [{ Key: 'SpiceSand_Small', Value: { ActorClass: { AssetPathName: '/Game/Dune/Systems/SpiceHarvesting/SmallSpiceField/BP_SpiceField_Small.BP_SpiceField_Small_C' } } }],
        m_GenericActorsInstances: [{ TemplateName: 'SpiceSand_Small', Location: { X: 30, Y: 40, Z: 0 } }],
      } }],
      WLC_T: [{ Type: 'WorldLayoutClusterDataAsset', Properties: { m_Variations: [{ Key: 'Default', Value: { TerrainBlocks: [{ bIsEnabled: true, Location: { X: 0, Y: 0, Z: 0 }, Rotation: { Pitch: 0, Yaw: 0, Roll: 0 }, TerrainBlockDataAsset: { ObjectPath: '/Game/Dune/Systems/DynamicContent/TerrainBlocks/Collection/CB_X.0' } }] } }] } }],
      'DeepDesert_1.umap': [{ Type: 'DuneWorldGenerator', Properties: { m_WorldOriginOffset: { X: 0, Y: 0, Z: 0 }, m_WorldSizeInMeters: { X: 400, Y: 400 }, m_ResourceTypesTable: { AssetPathName: `${G}/DT_ResourceTypes.DT_ResourceTypes` }, m_WorldHeatMaps: [{ ResourceDistributionGroup: { AssetPathName: `${G}/Groups/DA_Base.DA_Base` } }] } }],
      DT_ResourceTypes: [{ Rows: { Azurite: { ResourcePointGroupName: 'Minerals', SpawnerVariants: [{ HeatmapName: 'Azurite', ResourceSpawnerClassCore: { AssetPathName: `${G}/BP_Az_Spawner.BP_Az_Spawner_C` }, ResourceSpawnerClassAux: { AssetPathName: `${G}/BP_Az_Spawner.BP_Az_Spawner_C` } }] } } }],
      DA_DD11: [{ Properties: { m_ResourceDistributionHeatMapData: [{ Key: 'Azurite', Value: { ObjectPath: '/Game/Dune/Tools/HM/BP_HM_DD11.0' } }] } }],
      BP_HM_DD11: [{ Type: 'HeatMapData', Properties: { m_SizeX: 1, m_SizeY: 1, m_bStoredAsPalette: true, m_PaletteBitDepth: 1, m_PaletteColors: [0, 55], m_PackedColorIndices: [1] } }],
      BP_Az_Spawner: [{ Type: 'SCS_Node', Properties: { ComponentClass: { ObjectPath: '/Game/Dune/Systems/Harvesting/BP_Az_Component.0' } } }],
      BP_Az_Component: [{ Type: 'BP_Az_Component_C', Name: 'Default__BP_Az_Component_C', Properties: { m_MapMarkerType: { Name: 'AzuriteOre' } } }],
    }
    // постійні підрівні ГП (кільце щитової стіни) — у кожній розкладці
    const ddFiles = [files, `${C}/Maps/Arrakis/DeepDesert_1/SubLevels/DeepDesert_ShieldWall_01.umap`, `${C}/Maps/Arrakis/DeepDesert_1/SubLevels/DeepDesert_1_Fog.umap`].join('\n')
    const passes = [], lv = []
    const docker = async (args) => {
      const i = args.indexOf('sandwalkers/gd-export:3')
      const dir = args.find((a) => a.endsWith(':/out')).slice(0, -5)
      if (args[i + 1] === 'files') fs.writeFileSync(path.join(dir, 'files.txt'), ddFiles)
      if (args[i + 1] === 'levels') lv.push(...args.slice(i + 2))
      if (args[i + 1] === 'tables') for (const p of args.slice(i + 2)) {
        const b = path.basename(p)
        passes.push(b)
        if (p === BLK) fs.writeFileSync(path.join(dir, 'tables', 'CB_X.json'), JSON.stringify(blockJson))
        if ([...Object.values(MAP_TABLES), ...LAYOUTS].includes(p)) fs.writeFileSync(path.join(dir, 'tables', b + '.json'), '[]')
        if (json[b]) fs.writeFileSync(path.join(dir, 'tables', b + '.json'), JSON.stringify(json[b]))
      }
      return { code: 0, out: '' }
    }
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker, ensure: async () => {} })
    for (const n of ['WLC_T', 'DeepDesert_1.umap', 'DA_DD11', 'BP_HM_DD11']) expect(passes).toContain(n)
    expect(lv).toContain(`${C}/Maps/Arrakis/DeepDesert_1/SubLevels/DeepDesert_ShieldWall_01.umap`)
    expect(lv).not.toContain(`${C}/Maps/Arrakis/DeepDesert_1/SubLevels/DeepDesert_1_Fog.umap`)
    const raw = path.join(work, 'raw', '7')
    fs.mkdirSync(path.join(raw, 'levels'), { recursive: true })
    fs.writeFileSync(path.join(raw, 'tables', 'StaticMarker_Cave.json'), '[]')
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Arrakis~SOC_1~SubLevels~Survival_1_Sheol.json'), '{"actors":[],"nodes":[]}')
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X.json'), JSON.stringify({ actors: [{ c: 'BP_PentashieldKey_C', n: 'K', l: [5, 6, 0], p: { m_NeededKey: { Name: 'Code_EcoLab_Green' } } }], nodes: [{ k: 'Minerals', pts: [[100, 200, 0, 1], [101, 200, 0, 0], [102, 200, 0, 0]] }] }))
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X_Gameplay.json'), '{"actors":[],"nodes":[]}')
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Arrakis~DeepDesert_1~SubLevels~DeepDesert_ShieldWall_01.json'), JSON.stringify({ actors: [{ c: 'TemporaryLootSpawner', n: 'L', l: [70, 80, 0], p: { m_LootConfig: { LootContainerType: { Name: 'BasicContainer' } } } }], nodes: [] }))
    const s = normalizeRaw({ work, build: '7' })
    expect(s.markers.records).toEqual([
      { id: 'deepdesert_1/11@80:70', map: 'deepdesert_1', layout: 11, kind: 'loot', type: 'BasicContainer', x: 80, y: 70, z: 0 },
      { id: 'deepdesert_1/11@6:5', map: 'deepdesert_1', layout: 11, kind: 'key', type: 'Code_EcoLab_Green', x: 6, y: 5, z: 0 },
      { id: 'deepdesert_1/11@40:30', map: 'deepdesert_1', layout: 11, kind: 'marker', type: 'SpiceFieldSmall', x: 40, y: 30, z: 0 },
    ])
    // у переліку — типи кожної розкладки (сайту не треба розпаковувати файли) і загальна кількість (запобіжник обсягу)
    // точки одного типу обох видів (основна й підбирання) — кожна під своїм видом; вид типу — за більшістю його точок
    expect(s.ddResources.blob).toEqual({ count: 3, layouts: { 11: { count: 3, hash: expect.any(String), types: { AzuriteOre: 'aux' } } } })
    expect(JSON.parse(zlib.gunzipSync(s.ddResources.files['11']))).toEqual({ types: { AzuriteOre: { kind: 'aux', core: [200, 100, 0, 55], aux: [200, 101, 0, 55, 200, 102, 0, 55] } } })
    // розкладка без ресурсів — помилка розділу ресурсів ГП; без вмісту — помилка точок (а не мовчки менше розкладок)
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X.json'), JSON.stringify({ actors: [], nodes: [] }))
    expect(normalizeRaw({ work, build: '7' }).ddResources.message).toContain('розкладка 11')
    fs.writeFileSync(path.join(raw, 'tables', 'DA_DeepDesert_1_Layout_11.json'), '[]')
    expect(normalizeRaw({ work, build: '7' }).markers.message).toContain('розкладка 11')
  })

  it('нова розкладка ГП у патчі (лише в ini) — її вміст експортується', async () => {
    fs.appendFileSync(path.join(root, 'Config', 'DefaultGame.ini'), `\n[/Script/DuneSandbox.WorldLayoutSubsystem]\nm_WorldLayoutsPerWorld=(("/Game/Dune/Maps/Arrakis/DeepDesert_1/DeepDesert_1.DeepDesert_1", (WorldLayoutsSettingsList=((Content="/Game/Dune/Maps/Arrakis/DeepDesert_1/Layouts/DA_DeepDesert_1_Layout_19.DA_DeepDesert_1_Layout_19",HeatMapSettings=(ResourceDistributionGroup="/Game/G/DA_DD19.DA_DD19"))))))\n`)
    const calls = []
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker: fakeDocker(calls), ensure: async () => {} })
    const tables = calls.filter((a) => a[a.indexOf('sandwalkers/gd-export:3') + 1] === 'tables').flatMap((a) => a.slice(a.indexOf('sandwalkers/gd-export:3') + 2))
    expect(tables).toContain(`${C}/Maps/Arrakis/DeepDesert_1/Layouts/DA_DeepDesert_1_Layout_19`)
  })

  it('лут: своя таблиця спавнера чи таблиця розподілу типу контейнера за зоною (бітова карта світу) → предмети з шансом', async () => {
    const G = '/Game/Dune/Systems/GlobalDistribution'
    const LT = `${C}/Systems/LootTables/X`
    const LOOT = [`${LT}/DT_LootTable_Rare_T3.uasset`, `${LT}/DT_LootTable_B4.uasset`, `${LT}/DT_LootTable_B1.uasset`, `${C}/Systems/Looting/Loot_Distribution_Override/DT_LootDistributionOverride_Basic.uasset`, `${C}/Systems/Looting/DT_LootDistributionSettings.uasset`]
    const lootFiles = [files, ...LOOT].join('\n')
    const row = (item) => ({ NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: item } })
    const json = {
      'Survival_1.umap': [{ Type: 'DuneWorldGenerator', Properties: { m_WorldOriginOffset: { X: 0, Y: 0, Z: 0 }, m_WorldSizeInMeters: { X: 400, Y: 400 }, m_WorldHeatMaps: [{ TagsDistributionBitMap: { AssetPathName: '/Game/Dune/Maps/Arrakis/SOC_1/DataTables/DA_C.DA_C' } }] } }],
      DA_C: [{ Type: 'BitMapCollection', Properties: { Collection: [{ ObjectPath: '/Game/Dune/Tools/HeatmapTool/Data/T4/BMD_T4.0' }] } }],
      BMD_T4: [{ Type: 'BitMapData', Properties: { m_SizeX: '1', m_SizeY: '1', m_BitsPerWord: '1', m_Tags: [{ TagName: 'LootTier.4' }] } }],
      DT_LootTable_Rare_T3: [{ Rows: { a: row('Gun') } }],
      DT_LootTable_B4: [{ Rows: { a: row('Fuel') } }],
      DT_LootTable_B1: [{ Rows: { a: row('Rock') } }],
      DT_LootContainerActorsTable: [{ Rows: { BasicContainer: { LootDistributionSettingsOverride: { ObjectPath: '/Game/Dune/Systems/Looting/Loot_Distribution_Override/DT_LootDistributionOverride_Basic.0' } } } }],
      DT_LootDistributionOverride_Basic: [{ Rows: { t1: { bIsEnabled: true, Priority: 0, RequiredTags: ['LootTier.1'], LootContainerType: { Name: 'None' }, LootTable: { AssetPathName: `/Game/Dune/Systems/LootTables/X/DT_LootTable_B1.DT_LootTable_B1` } }, t4: { bIsEnabled: true, Priority: 0, RequiredTags: ['LootTier.4'], LootContainerType: { Name: 'None' }, LootTable: { AssetPathName: `/Game/Dune/Systems/LootTables/X/DT_LootTable_B4.DT_LootTable_B4` } } } }],
      DT_LootDistributionSettings: [{ Rows: {} }],
    }
    const bytesCalls = []
    const docker = async (args) => {
      const i = args.indexOf('sandwalkers/gd-export:3')
      const dir = args.find((a) => a.endsWith(':/out')).slice(0, -5)
      if (args[i + 1] === 'files') fs.writeFileSync(path.join(dir, 'files.txt'), lootFiles)
      if (args[i + 1] === 'bytes') for (const p of args.slice(i + 2)) {
        bytesCalls.push(path.basename(p))
        fs.mkdirSync(path.join(dir, 'bytes'), { recursive: true })
        fs.writeFileSync(path.join(dir, 'bytes', path.basename(p) + '.bin'), Buffer.from([7, 7, 7, 1]))
      }
      if (args[i + 1] === 'tables') for (const p of args.slice(i + 2)) {
        const b = path.basename(p)
        if (p === BLK) fs.writeFileSync(path.join(dir, 'tables', 'CB_X.json'), JSON.stringify(blockJson))
        if ([...Object.values(MAP_TABLES), ...LAYOUTS].includes(p) && !json[b]) fs.writeFileSync(path.join(dir, 'tables', b + '.json'), '[]')
        if (json[b]) fs.writeFileSync(path.join(dir, 'tables', b + '.json'), JSON.stringify(json[b]))
      }
      return { code: 0, out: '' }
    }
    await exportRaw({ work, build: '7', root, usmap: '/u.usmap', docker, ensure: async () => {} })
    expect(bytesCalls).toEqual(['BMD_T4'])
    const raw = path.join(work, 'raw', '7')
    fs.mkdirSync(path.join(raw, 'levels'), { recursive: true })
    fs.writeFileSync(path.join(raw, 'tables', 'StaticMarker_Cave.json'), '[]')
    const actor = { c: 'BP_TerrainBlockActor_C', n: 'B', l: [0, 0, 0], r: [0, 0, 0], p: { m_TerrainBlockAsset: { ObjectPath: '/Game/Dune/Systems/DynamicContent/TerrainBlocks/Collection/CB_X.0' } } }
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Arrakis~SOC_1~SubLevels~Survival_1_Sheol.json'), JSON.stringify({ actors: [actor], nodes: [] }))
    const spawner = (l, type, table) => ({ c: 'TemporaryLootSpawner', n: 'L', l, p: { m_LootConfig: { LootContainerType: { Name: type }, ...(table ? { LootTable: { AssetPathName: `/Game/Dune/Systems/LootTables/X/${table}.${table}` } } : {}) } } })
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X.json'), JSON.stringify({ actors: [spawner([10, 20, 0], 'RareContainer', 'DT_LootTable_Rare_T3'), spawner([30, 40, 0], 'BasicContainer')], nodes: [] }))
    fs.writeFileSync(path.join(raw, 'levels', 'Dune~Maps~Biomes~X~CB~CB_X_Gameplay.json'), '{"actors":[],"nodes":[]}')
    const s = normalizeRaw({ work, build: '7' })
    expect(s.markers.records.map((r) => [r.type, r.loot, r.lootTable])).toEqual([
      ['RareContainer', [['Gun', 100, 1]], undefined],
      ['BasicContainer', [['Fuel', 100, 1]], undefined],
    ])
  })
})

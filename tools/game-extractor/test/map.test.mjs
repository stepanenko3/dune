// Точки мапи з контент-блоків гри: регіон ставить блок (поворот, зсув, групи) → рівні блоку за групами → вкладені
// блоки → актори в світі; сайт тримає мапу як [Y гри, X гри]. Тип — ігровий: тип мітки, тип контейнера луту, ключ.
import { describe, expect, it } from 'vitest'
import { layoutGenericPoints, layoutPlacements, normalizeMap } from '../normalize/map.mjs'
import { zoneAt } from '../normalize/zones.mjs'

const lv = (name, dir = 'CB') => ({ AssetPathName: `/Game/Dune/Maps/${dir}/${name}.${name}`, SubPathString: '' })
const block = ({ base, subs = [], groups = {}, nested = [] }) => ({
  Versions: [{
    Level: lv(base),
    SubLevelsGroups: Object.entries(groups).map(([Key, on]) => ({ Key, Value: { bIsEnabled: on } })),
    SubLevels: subs.map(([name, [X, Y, Z], g = []]) => ({ Level: lv(name), RelativeLocation: { X, Y, Z }, GroupsNames: g })),
    SubContentBlocksSettings: nested,
  }],
})
const asset = (n) => ({ ObjectName: `TerrainBlockDataAsset'${n}'`, ObjectPath: `/Game/Dune/Systems/DynamicContent/TerrainBlocks/Collection/${n}.0` })
const marker = (l, extra = {}) => ({ c: 'DuneStaticMarkerActor', n: 'M', l, p: { m_ConfigurationAsset: { AssetPathName: '/Game/Dune/Systems/StaticMarkers/StaticMarker_Cave.StaticMarker_Cave' }, m_DisplayName: { TableId: '/Game/Dune/Localization/ST_World.ST_World', Key: 'LOC/Cave1' }, ...extra } })
const loot = (l) => ({ c: 'TemporaryLootSpawner', n: 'L', l, p: { m_LootConfig: { LootContainerType: { Name: 'BasicContainer' } } } })
const key = (l) => ({ c: 'BP_PentashieldKey_C', n: 'K', l, p: { m_NeededKey: { Name: 'Code_EcoLab_Green' } } })
const sub = (actor, { on, groupsOff = [] } = {}) => ({
  ContentBlockActor: { AssetPathName: lv('L1').AssetPathName, SubPathString: `PersistentLevel.${actor}` },
  GroupsNames: [], bShouldOverrideIsEnabled: on != null, bIsEnabled: on ?? true, TerrainBlockAsset: asset('B2'),
  SubLevelsGroupsOverride: groupsOff.map((g) => ({ GroupName: g, bShouldOverrideIsEnabled: true, bIsEnabled: false })),
})

const blocks = {
  B1: block({ base: 'L1', subs: [['L2', [0, 50, 0], ['G']]], groups: { G: false }, nested: [sub('BP_TerrainBlockActor_C_1')] }),
  B2: block({ base: 'L3' }),
}
const levels = {
  L1: { actors: [marker([100, 0, 0]), { c: 'BP_TerrainBlockActor_C', n: 'BP_TerrainBlockActor_C_1', l: [0, 200, 0], r: [0, 0, 0], p: {} }], nodes: [] },
  L2: { actors: [loot([10, 0, 0])], nodes: [] },
  L3: { actors: [key([0, 0, 0])], nodes: [{ k: 'Minerals', pts: [[0, 10, 0, 1], [0, 20, 0, 0]] }] },
}
const region = (props = {}) => ({ actors: [{ c: 'BP_TerrainBlockActor_C', n: 'B', l: [1000, 0, 0], r: [0, 90, 0], p: { m_TerrainBlockAsset: asset('B1'), m_SubLevelGroupsSettings: [{ Key: 'G', Value: { bIsEnabled: true } }], ...props } }], nodes: [] })
// рівні шукаються за шляхом (/Game/Dune/Maps/CB/L1): однакові імена в різних теках — різні рівні
const byPath = (n) => (n.startsWith('/Game/Dune/Maps/CB/') ? levels[n.split('/').pop()] ?? null : null)
const all = (over = {}) => normalizeMap({ map: 'survival_1', regions: { R: region() }, blocks, level: byPath, configs: { StaticMarker_Cave: 'Cave' }, ...over })
const run = (over = {}) => all(over).markers
const at = (r) => `${r.type}@${r.x}:${r.y}`

describe('точки мапи з контент-блоків', () => {
  it('поворот і зсув блоку, зсув рівня, вкладений блок; сайт = [Y, X] гри', () => {
    const r = run()
    expect(r.map(at).sort()).toEqual(['BasicContainer@10:950', 'Cave@100:1000', 'Code_EcoLab_Green@0:800'])
    expect(r.find((x) => x.type === 'Cave')).toMatchObject({ id: 'survival_1@100:1000', map: 'survival_1', kind: 'marker', name: 'ST_World:LOC/Cave1', z: 0 })
    expect(r.find((x) => x.type === 'BasicContainer').kind).toBe('loot')
    expect(r.find((x) => x.type === 'Code_EcoLab_Green').kind).toBe('key')
  })

  it('зони безпеки — об’єми BP_SecurityZone_C рівнів у світі (з трансформом блоку): зона місця — за ними', () => {
    const zone = { c: 'BP_SecurityZone_C', n: 'Z', l: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1], p: { m_SecurityZoneType: { Name: 'NullSec' }, m_SecurityZonePriority: 20 } }
    const r = all({ regions: { R: { actors: [...region().actors, { ...zone, l: [5000, 5000, 0] }], nodes: [] } } })
    expect(r.zones).toHaveLength(1)
    expect(r.zones[0]).toMatchObject({ type: 'NullSec', prio: 20, T: [5000, 5000, 0] })
    const RULES = { NullSec: 'PvP', Security: 'PvE' }
    expect(zoneAt(r.zones, [5050, 4950, 0], RULES, 'Security')).toBe('PvP')
    expect(zoneAt(r.zones, [5150, 5000, 0], RULES, 'Security')).toBe('PvE')
  })

  it('точки ресурсів рівнів — розділ resources: тип — група точок гри, основна (Core) чи додаткова', () => {
    expect(all().resources).toEqual([
      { id: 'survival_1@0:790', map: 'survival_1', kind: 'core', type: 'Minerals', x: 0, y: 790, z: 0 },
      { id: 'survival_1@0:780', map: 'survival_1', kind: 'aux', type: 'Minerals', x: 0, y: 780, z: 0 },
    ])
  })

  it('група рівня вимкнена (розміщення не вмикає) — його акторів нема; вимкнений вкладений блок — теж', () => {
    const r = run({ regions: { R: region({ m_SubLevelGroupsSettings: [] }) }, blocks: { ...blocks, B1: { ...blocks.B1, Versions: [{ ...blocks.B1.Versions[0], SubContentBlocksSettings: [sub('BP_TerrainBlockActor_C_1', { on: false })] }] } } })
    expect(r.map(at)).toEqual(['Cave@100:1000'])
  })

  it('тип мітки, перевизначений на акторі, — сильніший за тип з налаштувань мітки', () => {
    const l1 = { ...levels.L1, actors: [marker([100, 0, 0], { m_bOverrideMarkerType: true, m_MarkerTypeDisplayed: { Name: 'Sietch' } }), levels.L1.actors[1]] }
    expect(run({ level: (n) => (n.endsWith('/L1') ? l1 : byPath(n)) }).map((x) => x.type)).toContain('Sietch')
  })

  it('рівень з тим самим іменем в іншій теці — інший рівень (його точок тут нема)', () => {
    const b2 = block({ base: 'L3' })
    b2.Versions[0].Level = lv('L3', 'Other')
    expect(() => run({ blocks: { ...blocks, B2: b2 } })).toThrow('/Game/Dune/Maps/Other/L3')
  })

  it('мітка з невідомими налаштуванням (патч переніс StaticMarker_*) чи перевизначенням без типу — помилка, а не зникле місце', () => {
    expect(() => run({ configs: {} })).toThrow('StaticMarker_Cave')
    const l1 = { ...levels.L1, actors: [marker([100, 0, 0], { m_bOverrideMarkerType: true }), levels.L1.actors[1]] }
    expect(() => run({ level: (n) => (n.endsWith('/L1') ? l1 : byPath(n)) })).toThrow('тип')
  })

  it('блоку чи рівня нема в експорті — помилка, а не мовчки менше точок', () => {
    expect(() => run({ level: (n) => (n.endsWith('/L3') ? null : byPath(n)) })).toThrow('L3')
    expect(() => run({ blocks: { B1: blocks.B1 } })).toThrow('B2')
  })
})

describe('міста й малі мапи (World Composition): рівні мапи — це й є мапа', () => {
  const npc = (l, row, extra = {}) => ({ c: 'BP_AiSpawnLocation_C', n: 'N', l, p: { m_bIsStatic: true, NPCType: { DataTable: { ObjectPath: '/Game/Dune/AI/Config/CDT_NPCConfigs.0' }, RowName: row }, ...extra } })
  // іменовані NPC гри (DT_NPCConfigs_Named): фракція й назва з рядка CDT_NPCConfigs
  const npcs = { u135q: { faction: 'Unaffiliated', name: 'ST_Localization_NPCs_World:NPCS_AND_WORLD/LANDSRAAD_REP' } }
  const city = { actors: [marker([5, 6, 0]), npc([7, 8, 0], 'u135q'), npc([9, 9, 0], 'guard01'), npc([1, 1, 0], 'u135q', { m_bIsStatic: false })], nodes: [{ k: 'Minerals', pts: [[1, 2, 3, 1]] }] }
  const go = () => normalizeMap({ map: 'sh_arrakeen', regions: { SH: city }, blocks, level: byPath, configs: { StaticMarker_Cave: 'Cave' }, npcs })

  it('мітка — й підклас мітки гри з її полями (таксі ГП: BP_AutoDiscoveredStaticMarkerActor_C)', () => {
    const taxi = { c: 'BP_AutoDiscoveredStaticMarkerActor_C', n: 'T', l: [3, 4, 0], p: { m_bOverrideMarkerType: true, m_MarkerTypeDisplayed: { Name: 'TaxiService' } } }
    const zone = { c: 'BP_MapMarkerZone_C', n: 'Z', l: [9, 9, 0], p: {} }
    const r = normalizeMap({ map: 'sh_arrakeen', regions: { SH: { actors: [taxi, zone], nodes: [] } }, blocks, level: byPath, configs: {} })
    expect(r.markers.map((m) => m.type)).toEqual(['TaxiService'])
  })

  it('точки й ресурси — і в самих рівнях мапи, без блоків', () => {
    expect(go().markers.find((r) => r.kind === 'marker')).toMatchObject({ id: 'sh_arrakeen@6:5', map: 'sh_arrakeen', type: 'Cave', x: 6, y: 5 })
    expect(go().resources).toEqual([{ id: 'sh_arrakeen@2:1', map: 'sh_arrakeen', kind: 'core', type: 'Minerals', x: 2, y: 1, z: 3 }])
  })

  it('іменований NPC на сталому місці — точка: тип — фракція гри, назва — ключ рядка гри; безіменний чи рухливий — ні', () => {
    expect(go().markers.filter((r) => r.kind === 'npc')).toEqual([{ id: 'sh_arrakeen@8:7', map: 'sh_arrakeen', kind: 'npc', type: 'Unaffiliated', name: 'ST_Localization_NPCs_World:NPCS_AND_WORLD/LANDSRAAD_REP', x: 8, y: 7, z: 0 }])
  })
})

describe('Глибока пустеля: розкладка → кластери → блоки', () => {
  // кластер WLC_A на якорі (1, 2): варіант B ставить блок B2 на (10, 20) з поворотом 90° — світ = локальне + якір × 101600
  const clusters = {
    WLC_A: { m_Variations: [
      { Key: 'Default', Value: { TerrainBlocks: [{ bIsEnabled: true, Location: { X: 0, Y: 0, Z: 0 }, Rotation: { Pitch: 0, Yaw: 0, Roll: 0 }, TerrainBlockDataAsset: asset('B1') }] } },
      { Key: 'B', Value: { TerrainBlocks: [
        { bIsEnabled: true, Location: { X: 10, Y: 20, Z: 0 }, Rotation: { Pitch: 0, Yaw: 90, Roll: 0 }, TerrainBlockDataAsset: asset('B2') },
        { bIsEnabled: false, Location: { X: 0, Y: 0, Z: 0 }, Rotation: { Pitch: 0, Yaw: 0, Roll: 0 }, TerrainBlockDataAsset: asset('B1') },
      ] } },
    ] },
  }
  const layoutProps = { m_Clusters: [{ Key: '1', Value: { ClusterAnchor: { X: 1, Y: 2 }, ClusterDataAsset: { ObjectPath: '/Game/Dune/Maps/Arrakis/SeaOfSand/WLC_A.0' }, ClusterVariation: 'B' } }] }

  it('варіант кластера, увімкнені блоки; id і записи — з номером розкладки', () => {
    const r = normalizeMap({ map: 'deepdesert_1', layout: 11, placements: layoutPlacements(layoutProps, clusters), blocks, level: byPath, configs: {} })
    expect(r.markers).toEqual([{ id: 'deepdesert_1/11@203220:101610', map: 'deepdesert_1', layout: 11, kind: 'key', type: 'Code_EcoLab_Green', x: 203220, y: 101610, z: 0 }])
    expect(r.resources[0]).toEqual({ id: 'deepdesert_1/11@203220:101600', map: 'deepdesert_1', layout: 11, kind: 'core', type: 'Minerals', x: 203220, y: 101600, z: 0 })
  })

  it('кластера чи варіанта нема в експорті — помилка, а не порожня розкладка', () => {
    expect(() => layoutPlacements(layoutProps, {})).toThrow('WLC_A')
    expect(() => layoutPlacements({ m_Clusters: [{ ...layoutProps.m_Clusters[0], Value: { ...layoutProps.m_Clusters[0].Value, ClusterVariation: 'Z' } }] }, clusters)).toThrow('Z')
  })
})

describe('Глибока пустеля: поля прянощів і борошнистий пісок розкладки (виняток користувача)', () => {
  const cls = (n) => ({ AssetPathName: `/Game/Dune/Systems/SpiceHarvesting/X/${n}.${n}_C`, SubPathString: '' })
  const props = {
    m_GenericActorsTemplates: [
      { Key: 'SpiceSand_Small', Value: { ActorClass: cls('BP_SpiceField_Small'), Factory: { AssetPathName: '' } } },
      { Key: 'SpiceSand_Medium', Value: { ActorClass: cls('BP_SpiceField_Medium'), Factory: { AssetPathName: '' } } },
      { Key: 'FlourSand_Small', Value: { ActorClass: cls('BP_FlourSandField_Small'), Factory: { AssetPathName: '' } } },
      { Key: 'SmallShipwreck_120m', Value: { ActorClass: { AssetPathName: '' }, Factory: { AssetPathName: '/Game/Dune/Systems/DynamicContent/WorldGenerator/GAF_DE_120x120_Desert.GAF_DE_120x120_Desert' } } },
      { Key: 'Other', Value: { ActorClass: cls('BP_Something'), Factory: { AssetPathName: '' } } },
    ],
    m_GenericActorsInstances: [
      { TemplateName: 'SpiceSand_Small', Location: { X: 100, Y: 200, Z: 5 } },
      { TemplateName: 'SpiceSand_Medium', Location: { X: 300, Y: 400, Z: 0 } },
      { TemplateName: 'FlourSand_Small', Location: { X: 100, Y: 200, Z: 5 } },
      { TemplateName: 'SmallShipwreck_120m', Location: { X: 1, Y: 1, Z: 0 } },
      { TemplateName: 'Other', Location: { X: 2, Y: 2, Z: 0 } },
    ],
  }
  it('клас поля — тип мітки гри (лише ці три); уламки (фабрика подій) й інші — ні; id — як у решти точок розкладки', () => {
    const r = normalizeMap({ map: 'deepdesert_1', layout: 11, placements: [], points: layoutGenericPoints(props), blocks, level: byPath, configs: {} })
    expect(r.markers).toEqual([
      { id: 'deepdesert_1/11@200:100', map: 'deepdesert_1', layout: 11, kind: 'marker', type: 'SpiceFieldSmall', x: 200, y: 100, z: 5 },
      { id: 'deepdesert_1/11@400:300', map: 'deepdesert_1', layout: 11, kind: 'marker', type: 'SpiceFieldMedium', x: 400, y: 300, z: 0 },
      { id: 'deepdesert_1/11@200:100#2', map: 'deepdesert_1', layout: 11, kind: 'marker', type: 'FlourSand', x: 200, y: 100, z: 5 },
    ])
  })
})

describe('лут: своя таблиця спавнера йде з точкою (лут рахує видобувач за тегами місця)', () => {
  it('явна таблиця луту — у записі (lootTable); без неї — нема', () => {
    const spawner = (l, table) => ({ c: 'TemporaryLootSpawner', n: 'L', l, p: { m_LootConfig: { LootContainerType: { Name: 'RareContainer' }, ...(table ? { LootTable: { AssetPathName: `/Game/Dune/Systems/LootTables/X/${table}.${table}` } } : {}) } } })
    const r = normalizeMap({ map: 'sh_x', regions: { R: { actors: [spawner([1, 2, 0], 'DT_LootTable_Rare_T3'), spawner([3, 4, 0])], nodes: [] } }, blocks, level: byPath, configs: {} })
    expect(r.markers.map((m) => [m.type, m.lootTable ?? null])).toEqual([['RareContainer', 'DT_LootTable_Rare_T3'], ['RareContainer', null]])
  })
})

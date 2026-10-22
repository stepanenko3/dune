// Точки мапи з контент-блоків гри: регіон ставить блок (поворот, зсув, групи) → рівні блоку за групами → вкладені
// блоки → актори в світі; сайт тримає мапу як [Y гри, X гри]. Тип — ігровий: тип мітки, тип контейнера луту, ключ.
import { describe, expect, it } from 'vitest'
import { normalizeMap } from '../normalize/map.mjs'

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

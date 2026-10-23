// Карта світу: місця карти поверхні (компонент місця + коло посадки), переходи за назвою точки прибуття (без регістру),
// запит без точки прибуття — до місця, в чиєму колі він стоїть; одне місце для двох фракцій; повтор сюжетної мапи — те
// саме місце; таксі — стоянки поселень ↔ посадки; тексти — 14 мов із .locres.
import { describe, expect, it } from 'vitest'
import { gamePath, normalizeWorld, plainText, worldLevels, worldTables } from '../normalize/world.mjs'

const ST = '/Game/Dune/Localization/ST_Localization_UI.ST_Localization_UI'
const ft = (Key, s = Key) => ({ TableId: ST, Key, SourceString: s })
const row = (path, name, extra = {}) => ({ m_Map: { AssetPathName: `${path}.${path.split('/').pop()}` }, m_DisplayName: ft(name), m_Description: ft('Thopter'), m_RecommendedGroupSize: 'EGroupSize::Solo', ...extra })
const mapsInfo = {
  Overland: row('/Game/Dune/Systems/Overmap/Overmap', 'Over'),
  MainMenu: { m_Map: { AssetPathName: '/Game/Dune/Maps/MainMenu.MainMenu' }, m_DisplayName: { CultureInvariantString: null } },
  Hagga: row('/Game/Dune/Maps/Arrakis/SOC_1/Survival_1', 'HaggaName'),
  City: row('/Game/Dune/Maps/SocialHubs/City/SH_City', 'CityName'),
  Lab: row('/Game/Dune/Maps/Dungeons/Lab_1/CB_Lab_1', 'LabTitle', { m_RecommendedGroupSize: 'EGroupSize::Party' }),
  LabReplay: row('/Game/DLC/Maps/LabAgain/CB_LabAgain', 'LabTitle'),
  OutA: row('/Game/Dune/Maps/Out_A/Out_A', 'OutTitle'),
  OutB: row('/Game/Dune/Maps/Out_B/Out_B', 'OutTitle'),
}

/** повний експорт рівня карти поверхні: актори з кореневим компонентом */
function level(actors) {
  const out = []
  for (const a of actors) {
    const lvl = 'Overmap:PersistentLevel'
    const props = { RootComponent: { ObjectName: `SceneComponent'${lvl}.${a.n}.Root'` }, ...a.p }
    out.push({ Type: a.c, Name: a.n, Outer: { ObjectName: `Level'${lvl}'` }, Properties: props })
    out.push({ Type: 'SceneComponent', Name: 'Root', Outer: { ObjectName: `${a.c}'${lvl}.${a.n}'` }, Properties: { RelativeLocation: { X: a.l[0], Y: a.l[1], Z: 0 }, RelativeScale3D: a.s ? { X: a.s, Y: a.s, Z: 1 } : undefined, OverrideMaterials: a.mat ? [{ ObjectName: `Material'${a.mat}'` }] : undefined, AttachParent: a.att ? { ObjectName: 'x' } : undefined } })
    if (a.poi) out.push({ Type: 'OvermapPoiComponent', Name: 'Poi', Outer: { ObjectName: `${a.c}'${lvl}.${a.n}'` }, Properties: a.poi })
  }
  return out
}
const poi = (n, l, map, name, tags, extra = {}) => ({ c: 'BP_OvermapPoi_C', n, l, p: { m_PoiComponent: { ObjectName: `OvermapPoiComponent'Overmap:PersistentLevel.${n}.Poi'` } }, poi: { m_MapId: { Name: map }, m_LocationName: ft(name), m_LocationDescription: ft(name + 'Desc'), m_PoiCategoryTags: tags, ...extra } })
const overmap = {
  'DuneSandbox/Content/Dune/Systems/Overmap/Overmap.umap': level([
    poi('P1', [-1000, -9000], 'Hagga', 'Hagga', ['Poi.Location.Regions']),
    poi('P2', [5000, -9000], 'City', 'City', ['Poi.Location.Cities']),
    poi('P3', [9000, -2000], 'Lab', 'Lab', ['Poi.Dungeons'], { m_bEnabled: false }),
    poi('P4', [0, 0], 'OutA', 'Out', ['Poi.PointsOfInterest']),
    poi('P5', [10, 0], 'OutB', 'Out', ['Poi.PointsOfInterest']),
    { c: 'StaticMeshActor', n: 'C1', l: [-1000, -9000], s: 40, mat: 'M_POI_TravelVolume_Circular' },
    { c: 'StaticMeshActor', n: 'C2', l: [9000, -2000], s: 25, mat: 'M_POI_TravelVolume_Circular' },
    // запит до Западини (точка прибуття в її рівні, інший регістр) і до міста (точка без назви — за колом посадки)
    { c: 'BP_TravelRequestVolume_Overmap_C', n: 'R1', l: [0, 0], att: true, p: { DestinationName: 'Overland_to_Survival1_N1' } },
    { c: 'BP_TravelRequestVolume_Overmap_C', n: 'R2', l: [5100, -9000], p: { DestinationName: 'Overland_to_City', TravelRequirements: [{ Type: 'ETravelRequirementType::MapIsActiveJourneyTarget', FailReason: ft('NeedMission') }] } },
    { c: 'BP_TravelRequestVolume_Conditional_C', n: 'R3', l: [9000, -2000], p: { m_DestinationOptions: [{ DestinationName: 'Overland_to_Lab', TravelRequirements: [] }] } },
    { c: 'BP_TravelDestination_C', n: 'D1', l: [-3000, -9000], p: { TravelDestinationNameOverride: 'Survival1_to_Overland_N1' } },
    { c: 'BP_TravelDestination_C', n: 'D2', l: [9500, -2000], p: { TravelDestinationNameOverride: 'LabAgain_to_Overland' } },
  ]),
}
const levels = {
  'DuneSandbox/Content/Dune/Maps/Arrakis/SOC_1/SubLevels/Survival_1_Travel.umap': { actors: [
    { c: 'BP_TravelRequestByDestination_C', n: 'X', p: { DestinationName: 'survival1_to_overland_n1', TravelRequirements: [{ Type: 'ETravelRequirementType::NavigationType', FailReason: ft('Vehicle') }] } },
    { c: 'BP_TravelDestinationWithVehicleSpawner_C', n: 'Y', p: { TravelDestinationName: 'Overland_to_Survival1_N1' } },
  ] },
  'DuneSandbox/Content/DLC/Maps/LabAgain/CB_LabAgain_Travel.umap': { actors: [{ c: 'BP_TravelRequestByDestination_C', n: 'Z', p: { DestinationName: 'LabAgain_to_Overland' } }] },
  'DuneSandbox/Content/Dune/Maps/SocialHubs/City/SH_City_Gameplay.umap': { actors: [
    { c: 'BP_TravelDestination_C', n: 'T', p: { TravelDestinationNameOverride: 'Travel_To_City' } },
    { c: 'DuneStaticMarkerActor', n: 'M', p: { m_bOverrideMarkerType: true, m_MarkerTypeDisplayed: { Name: 'TaxiService' } } },
  ] },
}
const extra = [{ map: 'DuneSandbox/Content/Dune/Maps/Arrakis/SOC_1/Survival_1.umap', levels: { tp: { actors: [{ c: 'BP_TravelDestination_C', n: 'TP', p: { TravelDestinationNameOverride: 'Travel_To_HaggaBasin_Post' } }] } } }]
const categories = {
  'x/DA_PoiCategoryData_Locations.uasset': [{ Properties: { m_ItemFilter: { TagDictionary: [{ TagName: 'Poi.Location' }] }, m_DisplayName: ft('Cat_Locations'), m_SubCategories: [{ ObjectName: "GuiCategoryData'DA_PoiCategoryData_Regions'" }] } }],
  'x/DA_PoiCategoryData_Regions.uasset': [{ Properties: { m_ItemFilter: { TagDictionary: [{ TagName: 'Poi.Location.Regions' }] }, m_DisplayName: ft('Cat_Regions') } }],
}
const loc = {
  uk: { ST_Localization_UI: { Hagga: 'Западина', HaggaDesc: '<b>Землі</> війни', HaggaName: 'Западина Хаґґа', Vehicle: 'Потрібен літальний апарат.', NeedMission: 'Потрібне завдання', LabTitle: 'Станція', Lab: 'Станція 1', Out: 'Гарнізон', Cat_Regions: 'Регіони', Cat_Locations: 'Містини' } },
  en: { ST_Localization_UI: { Hagga: 'Hagga Basin', Vehicle: 'A flying vehicle is required.' } },
}

describe('карта світу з файлів гри', () => {
  const w = normalizeWorld({ mapsInfo, overmap, levels, extra, categories, loc })
  const at = (id) => w.locations.find((l) => l.id === id)
  const link = (from, to, mode = 'travel') => w.links.find((l) => l.from === from && l.to === to && l.mode === mode)

  it('місця карти поверхні: категорія, коло посадки, група, прихованість, мапа', () => {
    expect(at('Hagga')).toMatchObject({ tag: 'Poi.Location.Regions', pos: [-1000, -9000], r: 2000, map: 'Survival_1', group: 'solo', hidden: false })
    expect(at('Lab')).toMatchObject({ tag: 'Poi.Dungeons', r: 1250, group: 'party', hidden: true })
    expect(w.categories.find((c) => c.tag === 'Poi.Location.Regions')).toMatchObject({ parent: 'Poi.Location', name: 'ST_Localization_UI:Cat_Regions' })
  })
  it('одна назва в тому самому місці — одне місце; повтор сюжетної мапи з тією самою назвою — теж', () => {
    expect(at('OutA').ids).toEqual(['OutA', 'OutB'])
    expect(at('OutB')).toBeUndefined()
    expect(at('Lab').ids).toEqual(['Lab', 'LabReplay'])
    expect(link('Lab', 'Overland')).toBeTruthy()
  })
  it('переходи: за назвою точки прибуття без регістру; без неї — за колом посадки; умови й точки виходу', () => {
    expect(link('Overland', 'Hagga')).toMatchObject({ points: 1 })
    expect(link('Hagga', 'Overland').options).toEqual([[{ type: 'NavigationType', text: 'ST_Localization_UI:Vehicle' }]])
    expect(at('Hagga').exits).toEqual([[-3000, -9000]])
    expect(link('Overland', 'City').options[0][0]).toMatchObject({ type: 'MapIsActiveJourneyTarget', text: 'ST_Localization_UI:NeedMission' })
    expect(link('Overland', 'Lab')).toBeTruthy()
  })
  it('таксі: стоянка поселення ↔ посадка в Западині', () => {
    expect(link('City', 'Hagga', 'taxi')).toMatchObject({ points: 1 })
    expect(link('Hagga', 'City', 'taxi')).toBeTruthy()
  })
  it('тексти мовами, без розмітки; ключа нема в мові — нема', () => {
    expect(w.texts['ST_Localization_UI:Hagga']).toEqual({ uk: 'Западина', en: 'Hagga Basin' })
    expect(w.texts['ST_Localization_UI:HaggaDesc']).toEqual({ uk: 'Землі війни' })
    expect(at('City').name).toBeNull()
    expect(w.locations[0].id).toBe('Overland')
    expect(w.bounds[0]).toBeLessThan(-3000)
  })
  it('без карти поверхні чи місць — помилка, а не порожня карта', () => {
    expect(() => normalizeWorld({ mapsInfo: { Hagga: mapsInfo.Hagga }, overmap })).toThrow(/карти поверхні/)
    expect(() => normalizeWorld({ mapsInfo, overmap: {} })).toThrow(/жодного місця/)
  })
})

describe('пакети карти світу', () => {
  const files = [
    'DuneSandbox/Content/Dune/Maps/DT_MapsInfo.uasset', 'DuneSandbox/Content/Dune/Maps/DT_MapsInfo_1-5-0-0.uasset',
    'DuneSandbox/Content/Dune/Systems/Overmap/Overmap.umap', 'DuneSandbox/Content/Dune/Systems/Overmap/Overmap_Audio.umap',
    'DuneSandbox/Content/Dune/Systems/Overmap/Sublevels/Overmap_WindPass.umap',
    'DuneSandbox/Content/Dune/GUI/Data/CategoryData/DA_PoiCategoryData_Regions.uasset',
    'DuneSandbox/Content/Dune/Maps/Arrakis/SOC_1/Survival_1.umap', 'DuneSandbox/Content/Dune/Maps/Arrakis/SOC_1/SubLevels/Survival_1_Travel.umap',
    'DuneSandbox/Content/Dune/Maps/Arrakis/SOC_1/SubLevels/Survival_1_Art.umap',
    'DuneSandbox/Content/Dune/Maps/Biomes/X/CB_X_Gameplay.umap',
  ]
  it('таблиці, категорії й рівні карти поверхні (без звуку й світла)', () => {
    expect(worldTables(files)).toEqual([files[0], files[1], files[2], files[4], files[5]])
  })
  it('рівні мап із переходами — у теках мап; головне меню в «Maps/» теки не має', () => {
    expect(worldLevels(files, { Hagga: mapsInfo.Hagga, MainMenu: mapsInfo.MainMenu, Overland: mapsInfo.Overland })).toEqual([files[6], files[7]])
  })
  it('шлях гри й чистий текст', () => {
    expect(gamePath('DuneSandbox/Content/Dune/A/B.umap')).toBe('/Game/Dune/A/B')
    expect(gamePath('/Game/Dune/A/B.B')).toBe('/Game/Dune/A/B')
    expect(plainText('<b>Летіть</> до краю\n\nмапи')).toBe('Летіть до краю мапи')
  })
})

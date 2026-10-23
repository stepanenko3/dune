// Типи міток мапи з таблиці гри CDT_FullscreenMapMarkers: id — рядок таблиці, тег фільтра (групи на мапі), текстура
// іконки (картинка — файл awakening.wiki з тим самим іменем), статична мітка. Назва — переклад (розділ texts).
import { describe, expect, it } from 'vitest'
import { normalizeMapKinds, normalizeMarkerTypes } from '../normalize/markertypes.mjs'

const row = (tag, icon, extra = {}) => ({
  m_MarkerDisplayName: { TableId: '/Game/Dune/Localization/ST_World.ST_World', Key: 'K' },
  m_MarkerFilterTag: { TagName: tag },
  m_IconTexture: { AssetPathName: icon ? `/Game/Dune/GUI/Textures/Icons/Gameplay/Map/${icon}.${icon}` : 'None' },
  m_bIsStatic: true,
  ...extra,
})

describe('типи міток мапи', () => {
  it('рядок → id, тег, іконка, статична; тег None — null; без іконки — null', () => {
    const r = normalizeMarkerTypes({
      Cave: row('MapMarkers.Location.Static.Cave', 'T_UI_IconMapMarkerCave_D'),
      Debug: row('None', null, { m_bIsStatic: false }),
    })
    expect(r).toEqual([
      { id: 'Cave', tag: 'MapMarkers.Location.Static.Cave', icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerCave_D', static: true, legend: null, look: null },
      { id: 'Debug', tag: null, icon: null, static: false, legend: null, look: null },
    ])
  })

  it('категорія легенди мапи гри — за тією самою текстурою іконки (перший рядок легенди з нею); нема — null', () => {
    const cat = (k) => ({ TableId: '/Game/Dune/Localization/ST_Localization_UI.ST_Localization_UI', Key: k })
    const legend = {
      L1: { m_MarkerCategoryDisplayName: cat('UI/Map_Legend_Category_Location'), m_IconTexture: { AssetPathName: '/Game/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerCave_D.T_UI_IconMapMarkerCave_D' } },
      L2: { m_MarkerCategoryDisplayName: cat('UI/Map_Legend_Category_Other'), m_IconTexture: { AssetPathName: '/Game/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerCave_D.T_UI_IconMapMarkerCave_D' } },
    }
    const r = normalizeMarkerTypes({ Cave: row('MapMarkers.Location.Static.Cave', 'T_UI_IconMapMarkerCave_D'), Debug: row('None', null) }, legend)
    expect(r.map((x) => x.legend)).toEqual(['ST_Localization_UI:UI/Map_Legend_Category_Location', null])
  })

  it('без власної категорії — найчастіша категорія типів з тим самим тегом без останньої частини (не коротшим за MapMarkers.X)', () => {
    const cat = (k) => ({ TableId: '/Game/Dune/Localization/ST_Localization_UI.ST_Localization_UI', Key: k })
    const ic = (n) => ({ AssetPathName: `/Game/Dune/GUI/Textures/Icons/Gameplay/Map/${n}.${n}` })
    const legend = { T: { m_MarkerCategoryDisplayName: cat('UI/NPCs'), m_IconTexture: ic('T_Trainer') }, V: { m_MarkerCategoryDisplayName: cat('UI/NPCs'), m_IconTexture: ic('T_Vendor') }, W: { m_MarkerCategoryDisplayName: cat('UI/Hazard'), m_IconTexture: ic('T_Storm') } }
    const r = normalizeMarkerTypes({
      Trainer: row('MapMarkers.Characters.Trainer', 'T_Trainer'),
      Vendor: row('MapMarkers.Characters.Vendor.Weapons', 'T_Vendor'),
      SpiceVendor: row('MapMarkers.Characters.Vendor.Spice', 'T_None'),
      HouseRep: row('MapMarkers.Characters.HouseRepresentative', 'T_House'),
      Hazard: row('MapMarkers.Events.Hazards', 'T_Haz'),
      Storm: row('MapMarkers.Storm', 'T_Storm'),
      Contract: row('MapMarkers.Contract', 'T_C'),
    }, legend)
    // HouseRep — сусіди за MapMarkers.Characters (тренери, торговці); Contract — сусіди за самим MapMarkers: будь-що — ні
    expect(Object.fromEntries(r.map((x) => [x.id, x.legend]))).toEqual({ Trainer: 'ST_Localization_UI:UI/NPCs', Vendor: 'ST_Localization_UI:UI/NPCs', SpiceVendor: 'ST_Localization_UI:UI/NPCs', HouseRep: 'ST_Localization_UI:UI/NPCs', Hazard: null, Storm: 'ST_Localization_UI:UI/Hazard', Contract: null })
  })
})

describe('вигляд іконки — рецепт гри (DT_IconPreset за m_IconAppearance типу)', () => {
  const tint = (Hex) => ({ SpecifiedColor: { Hex }, ColorUseRule: 'ESlateColorStylingMode::UseColor_Specified' })
  const presets = {
    MapLocationSmall_Cave: { m_IconSize: { X: 20, Y: 20 }, m_IsIconTinted: true, m_IconTint: tint('E17737'), m_Background: { AssetPathName: '/Game/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapLocationBGManufacturer_D.T_UI_IconMapLocationBGManufacturer_D' }, m_BackgroundSize: { X: 40, Y: 40 }, m_BackgroundTint: tint('8D4A20') },
    MapResourceMinerals: { m_IconSize: { X: 45, Y: 45 }, m_IsIconTinted: false, m_IconTint: tint('C2A671'), m_Background: { AssetPathName: '' }, m_BackgroundSize: { X: 50, Y: 50 }, m_BackgroundTint: tint('FF00FF') },
  }
  it('гліф (тон, розмір) і фон (текстура, тон, розмір); без фону — лише гліф; не тоноване — без тону; пресета нема — null', () => {
    const r = normalizeMarkerTypes({
      Cave: row('MapMarkers.Location.Static.Cave', 'T_UI_IconMapMarkerCave_D', { m_IconAppearance: { Name: 'MapLocationSmall_Cave' } }),
      AzuriteOre: row('MapMarkers.Resource.Node.Ores', 'T_UI_IconMapMarkerMineralAzurite_D', { m_IconAppearance: { Name: 'MapResourceMinerals' } }),
      Odd: row('MapMarkers.X.Y', 'T_UI_X_D', { m_IconAppearance: { Name: 'Gone' } }),
    }, {}, presets)
    expect(r.map((t) => t.look)).toEqual([
      { size: 20, tint: '#E17737', bg: 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapLocationBGManufacturer_D', bgSize: 40, bgTint: '#8D4A20' },
      { size: 45, tint: null, bg: null, bgSize: null, bgTint: null },
      null,
    ])
  })
})

describe('типи точок, яких гра на мапі не позначає: NPC і ключі', () => {
  const tex = (n) => ({ AssetPathName: `/Game/Dune/GUI/Textures/Icons/Gameplay/Factions/${n}.${n}` })
  const factions = { Atreides: { m_FactionIcon: tex('T_UI_IconsFactionsArtreides_D') }, Ixian: { m_FactionIcon: { AssetPathName: '' } } }
  const keyCodes = { Code_EcoLab_Green: { m_DisplayName: { TableId: '/Game/Dune/Localization/ST_Localization_Items.ST_Localization_Items', Key: 'ITEMS/KEYCODE_GREEN' }, m_KeyColor: { Hex: '11B000' } }, ExampleKey: { m_KeyColor: { Hex: '000000' } } }

  it('фракція NPC — іконка фракції гри (точний ключ DT_FactionData); нема іконки чи рядка — мітка NPC гри', () => {
    const r = normalizeMapKinds({ factions, keyCodes, used: { npc: ['Atreides', 'Ixian', 'CHOAM'], key: [] } })
    expect(r).toEqual([
      { id: 'Atreides', kind: 'npc', tag: null, icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Factions/T_UI_IconsFactionsArtreides_D', static: true, legend: null, color: null, look: { size: 32, tint: null, bg: null, bgSize: null, bgTint: null } },
      { id: 'Ixian', kind: 'npc', tag: null, icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerNpc_D', static: true, legend: null, color: null, look: { size: 32, tint: null, bg: null, bgSize: null, bgTint: null } },
      { id: 'CHOAM', kind: 'npc', tag: null, icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerNpc_D', static: true, legend: null, color: null, look: { size: 32, tint: null, bg: null, bgSize: null, bgTint: null } },
    ])
  })

  it('ключ — іконка ключа-коду гри в кольорі ключа гри; ключа нема в таблиці — без кольору', () => {
    const r = normalizeMapKinds({ factions, keyCodes, used: { npc: [], key: ['Code_EcoLab_Green', 'Code_Gone'] } })
    expect(r).toEqual([
      { id: 'Code_EcoLab_Green', kind: 'key', tag: null, icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/PickupNotifications/T_UI_IconPickupKeycode_D', static: true, legend: null, color: '#11B000', look: { size: 32, tint: '#11B000', bg: null, bgSize: null, bgTint: null } },
      { id: 'Code_Gone', kind: 'key', tag: null, icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/PickupNotifications/T_UI_IconPickupKeycode_D', static: true, legend: null, color: null, look: { size: 32, tint: null, bg: null, bgSize: null, bgTint: null } },
    ])
  })
})

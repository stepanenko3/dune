// Типи міток мапи з таблиці гри CDT_FullscreenMapMarkers: id — рядок таблиці, тег фільтра (групи на мапі), текстура
// іконки (картинка — файл awakening.wiki з тим самим іменем), статична мітка. Назва — переклад (розділ texts).
import { describe, expect, it } from 'vitest'
import { normalizeMarkerTypes } from '../normalize/markertypes.mjs'

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
      { id: 'Cave', tag: 'MapMarkers.Location.Static.Cave', icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerCave_D', static: true, legend: null },
      { id: 'Debug', tag: null, icon: null, static: false, legend: null },
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

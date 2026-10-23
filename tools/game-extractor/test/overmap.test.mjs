// Огляд (мапа подорожей): точки — BP_OvermapPoi_C; тип — тип мітки категорії гри (DA_PoiCategoryTree: тег точки
// входить у фільтр категорії верхнього рівня, як теги гри: Poi.Location.Cities — під Poi.Location); назва — ключ рядка.
import { describe, expect, it } from 'vitest'
import { normalizeOvermap } from '../normalize/overmap.mjs'

const L = "Level'Overmap:PersistentLevel'"
const poi = (n, tag, key, loc) => [
  { Type: 'BP_OvermapPoi_C', Name: n, Outer: { ObjectName: L }, Properties: { RootComponent: { ObjectName: `StaticMeshComponent'Overmap:PersistentLevel.${n}.StaticMesh'` } } },
  { Type: 'StaticMeshComponent', Name: 'StaticMesh', Outer: { ObjectName: `BP_OvermapPoi_C'Overmap:PersistentLevel.${n}'` }, Properties: { RelativeLocation: loc } },
  { Type: 'OvermapPoiComponent', Name: 'PoiComponent', Outer: { ObjectName: `BP_OvermapPoi_C'Overmap:PersistentLevel.${n}'` }, Properties: { m_LocationName: { TableId: '/Game/Dune/Localization/ST_Localization_UI.ST_Localization_UI', Key: key }, m_PoiCategoryTags: [tag] } },
]
const cat = (n) => ({ ObjectPath: `/Game/Dune/GUI/Data/CategoryData/${n}.0` })
const categories = {
  tree: { m_SubCategories: [cat('DA_Loc'), cat('DA_Dun')] },
  DA_Loc: { m_MarkerType: { Name: 'Overmap_Poi_Location' }, m_ItemFilter: { TagDictionary: [{ TagName: 'Poi.Location' }] }, m_SubCategories: [cat('DA_Cities')] },
  DA_Cities: { m_ItemFilter: { TagDictionary: [{ TagName: 'Poi.Location.Cities' }] } },
  DA_Dun: { m_MarkerType: { Name: 'Overmap_Poi_Dungeon' }, m_ItemFilter: { TagDictionary: [{ TagName: 'Poi.Dungeons' }] } },
}

describe('огляд: точки мап подорожей', () => {
  it('тип — мітка категорії гри за тегом (з підкатегоріями), назва — ключ рядка; сайт = [Y, X]', () => {
    const exp = [...poi('P_0', 'Poi.Location.Cities', 'UI/Arrakeen', { X: 44014.8, Y: -99042.5, Z: 138 }), ...poi('P_1', 'Poi.Dungeons', 'UI/Fire', { X: 1, Y: 2, Z: 0 })]
    expect(normalizeOvermap(exp, categories)).toEqual([
      { id: 'overmap@-99042:44015', map: 'overmap', kind: 'marker', type: 'Overmap_Poi_Location', name: 'ST_Localization_UI:UI/Arrakeen', x: -99042, y: 44015, z: 138 },
      { id: 'overmap@2:1', map: 'overmap', kind: 'marker', type: 'Overmap_Poi_Dungeon', name: 'ST_Localization_UI:UI/Fire', x: 2, y: 1, z: 0 },
    ])
  })
  it('дві точки в одному місці — різні id (як у решти точок: #2)', () => {
    const exp = [...poi('P_0', 'Poi.Dungeons', 'UI/A', { X: 1, Y: 2, Z: 0 }), ...poi('P_1', 'Poi.Dungeons', 'UI/B', { X: 1, Y: 2, Z: 0 })]
    expect(normalizeOvermap(exp, categories).map((r) => r.id)).toEqual(['overmap@2:1', 'overmap@2:1#2'])
  })

  it('тег без категорії — помилка розділу, а не точка без типу', () => {
    expect(() => normalizeOvermap(poi('P_2', 'Poi.Unknown', 'UI/X', { X: 0, Y: 0, Z: 0 }), categories)).toThrow('Poi.Unknown')
  })
})

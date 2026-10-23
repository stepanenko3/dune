// Переклади: тексти таблиць рядків гри мовами сайту для випущених предметів, пристроїв, модулів і рецептів.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeTexts } from '../normalize/texts.mjs'

const fx = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))
const NAME = (k) => ({ TableId: '/Game/Dune/Localization/ST_Localization_Items.ST_Localization_Items', Key: k })
const rows = {
  items: {
    AluminiumBar: { StaticData: { Name: NAME('ITEMS/RESOURCE_ALUMINUM_INGOT_NAME'), LongDesc: NAME('ITEMS/RESOURCE_ALUMINUM_INGOT_LONGDESC') } },
    OldThing: { StaticData: { Name: NAME('ITEMS/RESOURCE_ALUMINUM_INGOT_NAME') } },
  },
  placeables: { MediumOreRefinery_Placeable: { m_DisplayName: { TableId: '/Game/Dune/Localization/ST_Localization_Buildings.ST_Localization_Buildings', Key: 'BUILDINGS/MEDIUMOREREFINERY_PLACEABLE' } } },
  building: { Col_Center: { m_DisplayName: { TableId: '/Game/Dune/Localization/ST_Localization_Buildings.ST_Localization_Buildings', Key: 'C' } } },
}
const records = {
  items: [{ id: 'AluminiumBar', released: true }, { id: 'OldThing', released: false }],
  placeables: [{ id: 'MediumOreRefinery_Placeable', released: true }],
  recipes: [{ id: 'AluminiumBarRecipe', out: [['AluminiumBar', 1]], released: true }],
  buildables: [{ id: 'Col_Center', released: true }],
}
const t = Object.fromEntries(normalizeTexts({ loc: { uk: fx('loc-uk.json'), 'zh-Hans': fx('loc-zh-Hans.json') }, rows, records }).map((x) => [x.id, x]))

describe('переклади', () => {
  it('предмет українською: назва й опис з таблиці рядків', () => {
    expect(t['item:AluminiumBar:uk']).toEqual({ id: 'item:AluminiumBar:uk', name: 'Алюмінієвий злиток', description: 'Злиток алюмінію.' })
  })
  it('пристрій, модуль, рецепт (назва першого виходу)', () => {
    expect(t['placeable:MediumOreRefinery_Placeable:uk'].name).toBe('Середній переробник руди')
    expect(t['buildable:Col_Center:uk'].name).toBe('Центральна колона')
    expect(t['recipe:AluminiumBarRecipe:uk']).toEqual({ id: 'recipe:AluminiumBarRecipe:uk', name: 'Алюмінієвий злиток', description: null })
  })
  it('китайська спрощена; без опису — null; нема тексту — нема запису', () => {
    expect(t['item:AluminiumBar:zh-Hans']).toEqual({ id: 'item:AluminiumBar:zh-Hans', name: '铝锭', description: null })
    expect(t['placeable:MediumOreRefinery_Placeable:zh-Hans']).toBeUndefined()
  })
  it('невипущене — без текстів', () => {
    expect(t['item:OldThing:uk']).toBeUndefined()
  })
})

describe('переклади вмінь', () => {
  const AB = '/Game/Dune/Localization/ST_Localization_Abilities.ST_Localization_Abilities'
  const loc = { uk: { ST_Localization_Abilities: { 'SKILLS/TECHNIQUE_X_NAME': 'Центр мас', 'SKILLS/TECHNIQUE_X_LONGDESC': 'Цільтеся в тіло.', 'SKILLS/H_NAME': 'Прихована' } } }
  const modules = {
    NewRow_1: { Tag: { TagName: 'Skills.Perk.X' }, DisplayName: { TableId: AB, Key: 'SKILLS/TECHNIQUE_X_NAME' } },
    NewRow_2: { Tag: { TagName: 'Skills.Perk.H' }, DisplayName: { TableId: AB, Key: 'SKILLS/H_NAME' } },
  }
  const out = normalizeTexts({ loc, rows: { items: {}, placeables: {}, building: {}, modules }, records: { items: [], placeables: [], recipes: [], buildables: [], skills: [{ id: 'skills_perk_x', released: true }, { id: 'skills_perk_h', released: false }] } })
  it('назва й опис за ключем _NAME → _LONGDESC; невипущене — без текстів', () => {
    expect(out).toEqual([{ id: 'skill:skills_perk_x:uk', name: 'Центр мас', description: 'Цільтеся в тіло.' }])
  })
})

describe('переклади мапи', () => {
  const W = '/Game/Dune/Localization/ST_Localization_NPCs_World.ST_Localization_NPCs_World'
  const loc = { uk: { ST_Localization_NPCs_World: { 'NPCS_AND_WORLD/WORLD_MAP_MARKER_LOCATION_CAVE': 'Печера', 'NPCS_AND_WORLD/WORLD_MAP_LOCATION_Cave1': 'Сідниці Серрона' }, ST_Localization_UI: { 'UI/Map_Legend_Category_Location': 'Місцевість' } } }
  const LEG = { TableId: '/Game/Dune/Localization/ST_Localization_UI.ST_Localization_UI', Key: 'UI/Map_Legend_Category_Location' }
  const m = Object.fromEntries(normalizeTexts({
    loc,
    rows: { markerTypes: { Cave: { m_MarkerDisplayName: { TableId: W, Key: 'NPCS_AND_WORLD/WORLD_MAP_MARKER_LOCATION_CAVE' } }, Debug: {} }, legend: { L1: { m_MarkerCategoryDisplayName: LEG }, L2: { m_MarkerCategoryDisplayName: LEG } } },
    records: { items: [], placeables: [], recipes: [], buildables: [], markers: [{ name: 'ST_Localization_NPCs_World:NPCS_AND_WORLD/WORLD_MAP_LOCATION_Cave1' }, { name: 'ST_Localization_NPCs_World:NPCS_AND_WORLD/WORLD_MAP_LOCATION_Cave1' }, { name: 'ST_X:NOPE' }, {}] },
  }).map((x) => [x.id, x]))
  it('категорія легенди мапи (одна на ключ)', () => {
    expect(m['legend:ST_Localization_UI:UI/Map_Legend_Category_Location:uk'].name).toBe('Місцевість')
  })
  it('тип мітки й назва місця (одна на ключ); нема тексту — нема запису', () => {
    expect(m['markerType:Cave:uk']).toEqual({ id: 'markerType:Cave:uk', name: 'Печера', description: null })
    expect(m['place:ST_Localization_NPCs_World:NPCS_AND_WORLD/WORLD_MAP_LOCATION_Cave1:uk'].name).toBe('Сідниці Серрона')
    expect(Object.keys(m)).toHaveLength(3)
  })
})


describe('назви фракцій NPC і ключів мапи', () => {
  const loc = { uk: { ST_Localization_Items: { 'ITEMS/KEYCODE_GREEN': 'Зелений браслет' } }, en: { ST_Localization_Items: { 'ITEMS/KEYCODE_GREEN': 'Green ID Band' } } }
  const rows = { items: {}, placeables: {}, building: {}, factions: { Atreides: { m_DisplayName: { CultureInvariantString: 'Atreides' } }, Ixian: { m_DisplayName: {} } }, keyCodes: { Code_EcoLab_Green: { m_DisplayName: { TableId: '/Game/Dune/Localization/ST_Localization_Items.ST_Localization_Items', Key: 'ITEMS/KEYCODE_GREEN' } } } }
  const m = Object.fromEntries(normalizeTexts({ loc, rows, records: { items: [], placeables: [], recipes: [], buildables: [], markerTypes: [{ id: 'Atreides', kind: 'npc' }, { id: 'Ixian', kind: 'npc' }, { id: 'Code_EcoLab_Green', kind: 'key' }] } }).map((x) => [x.id, x.name]))
  it('фракція — назва гри (однакова всіма мовами), ключ — переклад рядка; без назви — нема запису', () => {
    expect(m['markerType:Atreides:uk']).toBe('Atreides')
    expect(m['markerType:Code_EcoLab_Green:uk']).toBe('Зелений браслет')
    expect(m['markerType:Code_EcoLab_Green:en']).toBe('Green ID Band')
    expect(m['markerType:Ixian:uk']).toBeUndefined()
  })
})

describe('назви типів міток без рядка таблиці', () => {
  const loc = { uk: { ST_Localization_Items: { 'ITEMS/COPPER_ORE': 'Мідна руда' } }, en: { ST_Localization_Items: { 'ITEMS/COPPER_ORE': 'Copper Ore' } } }
  const rows = {
    items: { AzuriteOre: { StaticData: { Name: { TableId: '/Game/Dune/Localization/ST_Localization_Items.ST_Localization_Items', Key: 'ITEMS/COPPER_ORE' } } } },
    placeables: {}, building: {},
    markerTypes: {
      AzuritePickup: { m_MarkerDisplayName: { Namespace: 'DT_FullscreenMapMarkers', Key: '6614', SourceString: 'XX_Copper Ore' } },
      EnemyLaborOutpost: { m_MarkerDisplayName: { Namespace: '', Key: 'B391', SourceString: 'Enemy Labor Outpost' } },
      LootContainer: { m_MarkerDisplayName: { Namespace: '', Key: '40F3', SourceString: 'LOC_LootContainer' } },
    },
  }
  const records = { items: [], placeables: [], recipes: [], buildables: [], markerTypes: [{ id: 'AzuritePickup', item: 'AzuriteOre' }, { id: 'EnemyLaborOutpost' }, { id: 'LootContainer' }] }
  const m = Object.fromEntries(normalizeTexts({ loc, rows, records }).map((x) => [x.id, x.name]))
  it('підбирання (заглушка XX_) — назва предмета, який воно дає; текст без таблиці — англійський оригінал гри; LOC_ — нічого', () => {
    expect(m['markerType:AzuritePickup:uk']).toBe('Мідна руда')
    expect(m['markerType:AzuritePickup:en']).toBe('Copper Ore')
    expect(m['markerType:EnemyLaborOutpost:en']).toBe('Enemy Labor Outpost')
    expect(m['markerType:EnemyLaborOutpost:uk']).toBeUndefined()
    expect(m['markerType:LootContainer:en']).toBeUndefined()
  })
})

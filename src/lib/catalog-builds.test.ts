// Будівельні модулі на ігрових id: ключ — id рядка гри, пристрій — за суфіксом _Placeable, назва набору — з предмета-патенту
// гри (мовою сайту), а без нього чи з заглушкою — читабельний id; пошук бачить слова з id.
import { describe, expect, it } from 'vitest'
import { buildWords, isDevEntry, isDevice, rememberSets, setLabel, type Catalog, type CBuild } from './catalog'
import { buildKey } from './calc'

const b = (id: string, set: string): CBuild => ({ id, set, group: 'wall', name: null, health: 1, img: null, cost: [] })

describe('модулі на ігрових id', () => {
  it('ключ — id гри; пристрій — рядок _Placeable', () => {
    expect(buildKey(b('Sardaukar_Wall_01', 'MTX_Sardaukar_BuildingSet_Patent'))).toBe('Sardaukar_Wall_01')
    expect(isDevice(b('Fabricator_Placeable', 'BasicFabricator_Patent'))).toBe(true)
    expect(isDevice(b('Sardaukar_Wall_01', 'X'))).toBe(false)
  })

  it('назва набору — з предмета гри мовою сайту; заглушка чи нема предмета — читабельний id', () => {
    rememberSets({
      items: [
        { id: 'HarkonnenSet', name: 'Harkonnen Building Set', loc: 'Будівельний набір Харконненів' },
        { id: 'MTX_Atre_BreakfastRoomSet_Patent', name: 'EMPTY_TEXT' },
        { id: 'MTX_ChoamExtention_Column_Patent', name: 'NA_ChoamExtention_Column_Patent' },
      ],
      buildables: [b('a', 'HarkonnenSet'), b('b', 'MTX_Atre_BreakfastRoomSet_Patent'), b('c', 'MTX_Neut_DesertMechanicSet02_Patent'), b('d', 'MTX_ChoamExtention_Column_Patent')],
    } as unknown as Catalog)
    expect(setLabel('HarkonnenSet')).toBe('Будівельний набір Харконненів')
    expect(setLabel('MTX_Atre_BreakfastRoomSet_Patent')).toBe('Atre Breakfast Room Set')
    expect(setLabel('MTX_Neut_DesertMechanicSet02_Patent')).toBe('Neut Desert Mechanic Set 02')
    expect(setLabel('MTX_ChoamExtention_Column_Patent')).toBe('Choam Extention Column')
  })

  it('набір без назви в грі (заглушка «N/A…» чи її нема) — назва його першого модуля мовою сайту, а не id англійською', () => {
    rememberSets({
      items: [{ id: 'MTX_Movie_Patent', name: 'N/A - Auto generated', loc: 'N/A - Auto generated' }],
      buildables: [{ ...b('m', 'MTX_Movie_Patent'), name: 'Movie Teaser', loc: 'Тизер фільму' }, { ...b('x', 'MTX_Twitch_Patent'), name: 'Observer Floor', loc: 'Підлога спостерігача' }],
    } as unknown as Catalog)
    expect(setLabel('MTX_Movie_Patent')).toBe('Тизер фільму')
    expect(setLabel('MTX_Twitch_Patent')).toBe('Підлога спостерігача')
  })

  it('заглушки розробників (предмет без назви жодною мовою гри) — не в довіднику; англійською — за назвою', () => {
    expect(isDevEntry({ name: 'PH_Advanced Heat Pack', loc: null }, 'uk')).toBe(true)
    expect(isDevEntry({ name: 'Cinematic Minotaur Sword', loc: null }, 'uk')).toBe(true)
    expect(isDevEntry({ name: 'Copper Ore', loc: 'Мідна руда' }, 'uk')).toBe(false)
    expect(isDevEntry({ name: 'Copper Ore', loc: null }, 'en')).toBe(false)
    expect(isDevEntry({ name: 'XX_CUT', loc: null }, 'en')).toBe(true)
    // прибране з гри (гра так і пише в назві)
    expect(isDevEntry({ name: '[DEPRECATED] Regis Tank Hull', loc: '[DEPRECATED] Regis Tank Hull' }, 'uk')).toBe(true)
  })

  it('слова для пошуку — з id гри (підкреслення й ВеликіЛітери)', () => {
    expect(buildWords('LargeOreRefinery_Placeable')).toBe('large ore refinery placeable')
    expect(buildWords('Sardaukar_Foundation_Wedge')).toBe('sardaukar foundation wedge')
  })
})

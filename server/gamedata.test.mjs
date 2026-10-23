// Дані гри в базі: перенесення з давніх catalog.json / skills.json (зокрема перерване), збір не переписує закріплене,
// довідник мовою з запасними назвами рецептів, тексти мовами. На тимчасовій SQLite.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from './lib/sql.mjs'
import { createPlacesStore } from './lib/db.mjs'
import { createGameData } from './lib/gamedata.mjs'

const CATALOG = {
  syncedAt: '2026-10-01T00:00:00.000Z',
  items: [
    // kind — клас предмета з вікі: при перенесенні він не має підмінити вид запису тексту
    { id: 'IronOre', name: 'Iron Ore', uk: 'Залізна руда', icon: 'a/T_UI_Iron_D', grade: 1, cat: 'misc', sub: null, kind: 'RawResources', rarity: null, stack: '500', volume: '0.5' },
    { id: 'IronBar', name: 'Iron Ingot', uk: null, icon: null, grade: 1, cat: 'misc', sub: null, kind: null, rarity: null, stack: null, volume: null },
  ],
  placeables: [{ id: 'Refinery_Placeable', name: 'Small Ore Refinery', uk: 'Малий переробник руди', icon: null, grade: 1, cat: 'refinery', sub: null, power: -15, water: null, waterRate: null }],
  recipes: [{ id: 'IronBarRecipe', name: 'Iron Ingot', time: 20, water: 50, at: ['Refinery_Placeable'], in: [['IronOre', 2]], out: [['IronBar', 1]] }],
  buildables: [{ set: 'structures/dune man', group: 'wall', id: 'wall', name: null, health: 7000, img: null, cost: [['IronBar', 4]] }],
}
const SKILLS = { syncedAt: '2026-10-02T00:00:00.000Z', skills: [{ id: 'skills_perk_x', name: 'Center Mass', icon: null, school: 'trooper', kind: 'perk', desc: 'Body shots', x: 1, y: 2, max: 3, levels: [{ cost: 2 }], and: [], or: [] }] }

describe('дані гри', () => {
  let dir, db, game
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-game-'))
    fs.mkdirSync(path.join(dir, 'catalog'))
    fs.mkdirSync(path.join(dir, 'skills'))
    fs.writeFileSync(path.join(dir, 'catalog', 'catalog.json'), JSON.stringify(CATALOG))
    fs.writeFileSync(path.join(dir, 'skills', 'skills.json'), JSON.stringify(SKILLS))
    db = await openDb({ dataDir: dir, pg: null })
    await createPlacesStore(db) // таблиця meta
    game = await createGameData(db, { dataDir: dir, log: {} })
    await game.importCatalog(CATALOG)
    await game.importSkills(SKILLS)
  })
  afterAll(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('набір довідника: предмети з числами, дата', async () => {
    const c = await game.catalog('uk')
    expect(c.syncedAt).toBe(CATALOG.syncedAt)
    expect(c.items.find((i) => i.id === 'IronOre')).toMatchObject({ stack: 500, volume: 0.5, kind: 'RawResources' })
    // будівельні модулі — лише з файлів гри (збору вікі нема)
    expect(c.buildables).toEqual([])
    expect((await game.skills('en')).skills[0]).toMatchObject({ id: 'skills_perk_x', desc: 'Body shots', levels: [{ cost: 2 }] })
  })

  it('рецепт без свого перекладу бере назву свого предмета', async () => {
    await game.putTexts('de', [{ kind: 'item', id: 'IronBar', name: 'Eisenbarren' }], 'gamingtools')
    expect((await game.catalog('de')).recipes[0].loc).toBe('Eisenbarren')
  })

  it('назви записів одного виду мовою — лише перекладені', async () => {
    await game.putTexts('de', [{ kind: 'item', id: 'IronBar', name: 'Eisenbarren' }], 'gamingtools')
    expect([...(await game.names('de', 'item', ['IronBar', 'Nope']))]).toEqual([['IronBar', 'Eisenbarren']])
    expect((await game.names('de', 'item', [])).size).toBe(0)
  })

  it('збір не переписує закріплене вручну, а приховане сайт не бачить', async () => {
    await db.run("UPDATE game_items SET name = 'Iron Ore (fixed)', locked = 1 WHERE id = 'IronOre'")
    await db.run("UPDATE game_items SET hidden = 1 WHERE id = 'IronBar'")
    game.invalidate()
    await game.importCatalog(CATALOG)
    const c = await game.catalog('en')
    expect(c.items.find((i) => i.id === 'IronOre').name).toBe('Iron Ore (fixed)')
    expect(c.items.find((i) => i.id === 'IronBar')).toBeUndefined()
    expect(c.items.find((i) => i.id === 'IronOre').loc).toBe(null) // англійською — без перекладу
  })

  it('тексти: опис мовою, порожнє не затирає, закріплене не переписується', async () => {
    await game.putTexts('uk', [{ kind: 'item', id: 'IronOre', description: 'Руда для злитків' }], 'gamingtools')
    expect(await game.description('item', 'IronOre', 'uk')).toBe('Руда для злитків')
    await game.putTexts('uk', [{ kind: 'item', id: 'IronOre', name: 'Залізна руда (gt)' }], 'gamingtools')
    expect(await game.description('item', 'IronOre', 'uk')).toBe('Руда для злитків')
    await db.run("UPDATE game_texts SET locked = 1 WHERE kind = 'item' AND id = 'IronOre' AND lang = 'uk'")
    await game.putTexts('uk', [{ kind: 'item', id: 'IronOre', name: 'Інше' }], 'gamingtools')
    game.invalidate()
    expect((await game.catalog('uk')).items.find((i) => i.id === 'IronOre').loc).toBe('Залізна руда (gt)')
  })

  it('основне джерело: за замовчуванням не вибрано; давнє «community» — як не вибрано; для групи — на всі її розділи', async () => {
    expect(await game.getPrimary('items')).toBeNull()
    await game.setMeta('primary:catalog', 'community')
    expect(await game.getPrimary('items')).toBeNull()
    await game.setPrimary('catalog', 'gamefiles')
    expect(await game.getPrimary('recipes')).toBe('gamefiles')
  })
})

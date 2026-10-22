// Таблиці гри під файли гри: невипущене приховане (адмін може відкрити), тексти гри не перезаписують нижчі джерела,
// збір questlog пропускає розділи, де основне — файли гри, відкат бере дані з catalog.json. На тимчасовій SQLite.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './lib/sql.mjs'
import { createPlacesStore } from './lib/db.mjs'
import { createGameData } from './lib/gamedata.mjs'
import { createCatalog } from './lib/catalog.mjs'

const CATALOG = {
  syncedAt: '2026-10-01T00:00:00.000Z',
  items: [
    { id: 'IronOre', name: 'Iron Ore', uk: null, icon: null, grade: 1, cat: 'misc', sub: null, kind: null, rarity: null, stack: '500', volume: '0.5' },
    { id: 'IronBar', name: 'Iron Ingot', uk: null, icon: null, grade: 1, cat: 'misc', sub: null, kind: null, rarity: null, stack: null, volume: null },
  ],
  placeables: [{ id: 'Refinery_Placeable', name: 'Small Ore Refinery', uk: null, icon: null, grade: 1, cat: 'refinery', sub: null, power: -15, water: null, waterRate: null }],
  recipes: [{ id: 'IronBarRecipe', name: 'Iron Ingot', time: 20, water: 50, at: ['Refinery_Placeable'], in: [['IronOre', 2]], out: [['IronBar', 1]] }],
  buildables: [{ set: 'structures/dune man', group: 'wall', id: 'wall', name: null, health: 7000, img: null, cost: [['IronBar', 4]] }],
}

describe('таблиці гри під файли гри', () => {
  let dir, db, game
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-gt-'))
    fs.mkdirSync(path.join(dir, 'catalog'))
    fs.writeFileSync(path.join(dir, 'catalog', 'catalog.json'), JSON.stringify(CATALOG))
    db = await openDb({ dataDir: dir, pg: null })
    await createPlacesStore(db)
    game = await createGameData(db, { dataDir: dir, log: {} })
    await game.importCatalog(CATALOG)
  })
  afterEach(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const ids = async () => (await game.catalog('en')).items.map((i) => i.id).sort()

  it('невипущене не видно; відкрите адміном — видно', async () => {
    await game.markReleased('item', { released: ['IronOre'], unreleased: ['IronBar'] })
    expect(await ids()).toEqual(['IronOre'])
    await db.run("UPDATE game_items SET revealed = 1 WHERE id = 'IronBar'")
    game.invalidate()
    expect(await ids()).toEqual(['IronBar', 'IronOre'])
  })

  it('тексти гри: нижчі джерела їх не перезаписують, гра перезаписує нижчі, закріплене — ніхто', async () => {
    await game.putTexts('uk', [{ kind: 'item', id: 'IronOre', name: 'Залізна руда' }], 'game')
    await game.putTexts('uk', [{ kind: 'item', id: 'IronOre', name: 'gt' }], 'gamingtools')
    const name = async () => (await db.get("SELECT name, source FROM game_texts WHERE kind = 'item' AND id = 'IronOre' AND lang = 'uk'"))
    expect(await name()).toEqual({ name: 'Залізна руда', source: 'game' })
    await game.putTexts('uk', [{ kind: 'item', id: 'IronBar', name: 'gt' }], 'gamingtools')
    await game.putTexts('uk', [{ kind: 'item', id: 'IronBar', name: 'Залізний злиток' }], 'game')
    expect((await db.get("SELECT name FROM game_texts WHERE kind = 'item' AND id = 'IronBar' AND lang = 'uk'")).name).toBe('Залізний злиток')
    await db.run("UPDATE game_texts SET locked = 1 WHERE kind = 'item' AND id = 'IronOre' AND lang = 'uk'")
    await game.putTexts('uk', [{ kind: 'item', id: 'IronOre', name: 'інше' }], 'game')
    expect((await name()).name).toBe('Залізна руда')
  })

})

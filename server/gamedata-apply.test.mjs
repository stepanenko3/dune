// Застосування даних файлів гри в таблиці сайту: нові значення, невипущене приховане, відкрите адміном лишається,
// закріплене вручну не чіпається, чого в даних нема — прибране, порожнє не затирає відоме. На тимчасовій SQLite.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './lib/sql.mjs'
import { createPlacesStore } from './lib/db.mjs'
import { createGameData } from './lib/gamedata.mjs'
import { createAppliers } from './lib/gamedata/apply.mjs'

const CATALOG = {
  syncedAt: '2026-10-01T00:00:00.000Z',
  items: [
    { id: 'IronOre', name: 'Iron Ore', uk: null, icon: 'assets/x/T_Iron_D', grade: 1, cat: 'misc', sub: null, kind: null, rarity: null, stack: '500', volume: '0.5' },
    { id: 'IronBar', name: 'Iron Ingot', uk: null, icon: null, grade: 1, cat: 'misc', sub: null, kind: null, rarity: null, stack: null, volume: null },
  ],
  placeables: [{ id: 'Refinery_Placeable', name: 'Small Ore Refinery', uk: null, icon: 'assets/x/T_Ref_D', grade: 1, cat: 'refinery', sub: null, power: -15, water: null, waterRate: null }],
  recipes: [{ id: 'IronBarRecipe', name: 'Iron Ingot', time: 20, water: 50, at: ['Refinery_Placeable'], in: [['IronOre', 2]], out: [['IronBar', 1]] }],
  buildables: [{ set: 'structures/dune man', group: 'wall', id: 'wall', name: null, health: 7000, img: 'https://media.awakening.wiki/w/T_UI_Wall_D.png', cost: [['IronBar', 4]] }],
}
const item = (id, o = {}) => ({ id, name: id, icon: null, grade: 2, cat: 'misc', sub: null, kind: 'RawResources', rarity: null, stack: 100, volume: 1, released: true, ...o })

describe('застосування файлів гри', () => {
  let dir, db, game, ap
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-ap-'))
    fs.mkdirSync(path.join(dir, 'catalog'))
    fs.writeFileSync(path.join(dir, 'catalog', 'catalog.json'), JSON.stringify(CATALOG))
    db = await openDb({ dataDir: dir, pg: null })
    await createPlacesStore(db)
    game = await createGameData(db, { dataDir: dir, log: {} })
    await game.importCatalog(CATALOG)
    ap = createAppliers({ db, game })
  })
  afterEach(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const items = async () => Object.fromEntries((await game.catalog('en')).items.map((i) => [i.id, i]))

  it('предмети: нові значення, невипущене приховане, зникле — прибране, іконка не затирається порожнім', async () => {
    await db.run("UPDATE game_items SET description = 'Руда.' WHERE id = 'IronOre'")
    await ap.items({ records: [item('IronOre', { name: 'Iron Ore', stack: 750 }), item('AluminiumBar'), item('OldThing', { released: false })] })
    const it = await items()
    expect(it.IronOre).toMatchObject({ stack: 750, grade: 2, icon: 'assets/x/T_Iron_D' })
    expect(it.AluminiumBar).toBeTruthy()
    expect(it.OldThing).toBeUndefined()
    expect(it.IronBar).toBeUndefined()
    expect((await db.get("SELECT gone FROM game_items WHERE id = 'IronBar'")).gone).not.toBeNull()
    expect((await db.get("SELECT description FROM game_items WHERE id = 'IronOre'")).description).toBe('Руда.')
  })

  it('закріплене вручну не змінюється', async () => {
    await db.run("UPDATE game_items SET name = 'Моя назва', locked = 1 WHERE id = 'IronOre'")
    await ap.items({ records: [item('IronOre', { name: 'Iron Ore', stack: 750 }), item('IronBar')] })
    expect((await items()).IronOre.name).toBe('Моя назва')
  })

  it('відкрите адміном невипущене лишається видимим після оновлення', async () => {
    const data = { records: [item('IronOre'), item('IronBar'), item('OldThing', { released: false })] }
    await ap.items(data)
    await db.run("UPDATE game_items SET revealed = 1 WHERE id = 'OldThing'")
    await ap.items(data)
    expect((await items()).OldThing).toBeTruthy()
  })

  it('пристрої й рецепти', async () => {
    await ap.placeables({ records: [{ id: 'Refinery_Placeable', name: 'Small Ore Refinery', icon: null, grade: 1, cat: 'orerefinery', sub: 'tier1', power: -45, water: null, waterRate: null, released: true }] })
    const p = (await game.catalog('en')).placeables[0]
    expect(p).toMatchObject({ cat: 'orerefinery', power: -45, icon: 'assets/x/T_Ref_D' })
    await ap.recipes({ records: [{ id: 'IronBarRecipe', name: 'Iron Ingot', time: 30, water: 150, at: ['MediumOreRefinery_Placeable'], in: [['IronOre', 7]], out: [['IronBar', 1]], released: true }] })
    expect((await game.catalog('en')).recipes[0]).toMatchObject({ time: 30, water: 150, at: ['MediumOreRefinery_Placeable'], in: [['IronOre', 7]] })
  })

  it('переклади: source=game; нижчі джерела перезаписує, закріплене — ні; модуль — під своїм id гри', async () => {
    await game.putTexts('uk', [{ kind: 'item', id: 'IronBar', name: 'gt' }], 'gamingtools')
    await game.putTexts('de', [{ kind: 'item', id: 'IronOre', name: 'Mein' }], 'manual')
    await db.run("UPDATE game_texts SET locked = 1 WHERE lang = 'de'")
    await ap.texts({ records: [
      { id: 'item:IronOre:uk', name: 'Залізна руда', description: 'Руда.' },
      { id: 'item:IronBar:uk', name: 'Залізний злиток', description: null },
      { id: 'item:IronOre:de', name: 'Eisenerz', description: null },
      { id: 'buildable:Sardaukar_Wall_01:uk', name: 'Стіна', description: null },
    ] })
    const t = async (kind, id, lang) => db.get('SELECT name, description, source FROM game_texts WHERE kind = ? AND id = ? AND lang = ?', kind, id, lang)
    expect(await t('item', 'IronOre', 'uk')).toEqual({ name: 'Залізна руда', description: 'Руда.', source: 'game' })
    expect((await t('item', 'IronBar', 'uk')).name).toBe('Залізний злиток')
    expect((await t('item', 'IronOre', 'de')).name).toBe('Mein')
    expect((await t('buildable', 'Sardaukar_Wall_01', 'uk')).name).toBe('Стіна')
  })

  it('модулі: під id гри, картинка — файл вікі з іменем текстури, давні рядки вікі прибрано', async () => {
    // так лежать давні модулі вікі на живій базі
    await game.upsert('buildable', [{ key: 'structures/dune man|wall', set_id: 'structures/dune man', grp: 'wall', id: 'wall', name: null, health: 7000, img: null, cost: [] }])
    await db.run("UPDATE game_buildables SET updated = 1 WHERE key = 'structures/dune man|wall'")
    await ap.buildables({ records: [
      { id: 'Sardaukar_Wall_01', set: 'MTX_Sardaukar_BuildingSet_Patent', group: 'wall', name: 'Wall', img: 'assets/DLC/B1C5/Ui/T_UI_IconPlayerPBSardWall01R_D', health: 7000, cost: [['IronBar', 4]], released: true },
      { id: 'Blockout_Wall', set: 'BlockoutSet', group: 'wall', name: 'Wall', img: null, health: 1, cost: [], released: false },
    ] })
    const b = (await game.catalog('en')).buildables
    expect(b.map((x) => x.id)).toEqual(['Sardaukar_Wall_01'])
    expect(b[0]).toMatchObject({ set: 'MTX_Sardaukar_BuildingSet_Patent', group: 'wall', health: 7000, cost: [['IronBar', 4]] })
    // MediaWiki: wiki/<md5[0]>/<md5[0..1]>/<файл>
    expect(b[0].img).toMatch(/^https:\/\/media\.awakening\.wiki\/wiki\/[0-9a-f]\/[0-9a-f]{2}\/T_UI_IconPlayerPBSardWall01R_D\.png$/)
    expect((await db.get("SELECT gone FROM game_buildables WHERE key = 'structures/dune man|wall'")).gone).not.toBeNull()
  })
})

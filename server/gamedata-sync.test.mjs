// Дані гри після збору: частковий збій не затирає відоме порожнім, прибране з гри позначається gone (і повертається),
// запобіжник від «половинного» збору, рецепти мертвих предметів не йдуть на сайт, запасна назва за тією самою
// англійською; пауза після невдалого збору вмінь; білди й розрахунки — знімок, указ, порожній розрахунок.
// node --test server/gamedata-sync.test.mjs; той самий файл іде й у vitest — раннер за оточенням.
// Обв'язка — як у cron.test.mjs: SQLite у тимчасовій теці і Postgres <DB_DATABASE>_testing у власній схемі.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb } from './lib/sql.mjs'
import { createPlacesStore } from './lib/db.mjs'
import { createGameData, sameName } from './lib/gamedata.mjs'
import { createSkills, RETRY } from './lib/skills.mjs'
import { cleanBuild, cleanCalc } from './lib/docs.mjs'

const T = process.env.VITEST ? await import('vitest') : await import('node:test')
const { describe, it } = T
const before = T.beforeAll || T.before, after = T.afterAll || T.after
const quiet = { info() {}, warn() {}, error() {}, log() {} }

const item = (id, name, extra = {}) => ({ id, name, uk: null, icon: `a/${id}_D`, grade: 1, cat: 'misc', sub: null, kind: 'RawResources', rarity: null, stack: 500, volume: 0.5, ...extra })
const CATALOG = (over = {}) => ({
  syncedAt: '2026-10-01T00:00:00.000Z',
  complete: true,
  items: [item('IronOre', 'Iron Ore'), item('IronBar', 'Iron Ingot'), item('OldPart', 'Old Part')],
  placeables: [{ id: 'Ref', name: 'Small Ore Refinery', icon: null, grade: 1, cat: 'refinery', sub: null, power: -15, water: null, waterRate: null }],
  recipes: [
    { id: 'Bar', name: 'Iron Ingot', time: 20, water: 50, at: ['Ref'], in: [['IronOre', 2]], out: [['IronBar', 1]] },
    { id: 'Dead', name: 'Gone Thing', time: 5, water: null, at: ['Ref'], in: [['IronOre', 1]], out: [['GoneThing', 1]] },
  ],
  buildables: [{ set: 'structures/dune man', group: 'wall', id: 'wall', name: null, health: 7000, img: null, cost: [['IronBar', 4]] }],
  ...over,
})

describe('запасна назва за тією самою англійською', () => {
  it('без перекладу — переклад запису з тією самою назвою; кілька — той, де номер моделі з назви', () => {
    const rows = sameName([
      { name: 'Hajra Literjon Mk6', loc: 'Літреджон Хаджра (модель 6)' },
      { name: 'Hajra Literjon Mk6', loc: null },
      { name: 'Clapper Mk4', loc: 'Плескун (модель 1)' },
      { name: 'Clapper Mk4', loc: 'Плескун (модель 4)' },
      { name: 'Clapper Mk4', loc: null },
      { name: 'Unique Thing', loc: null },
    ])
    assert.deepEqual(rows.map((r) => r.loc), ['Літреджон Хаджра (модель 6)', 'Літреджон Хаджра (модель 6)', 'Плескун (модель 1)', 'Плескун (модель 4)', 'Плескун (модель 4)', null])
  })
})

describe('білди й розрахунки: що зберігає сервер', () => {
  it('білд — знімок «вузол: ранг» лише з відомими полями й у межах', () => {
    const b = cleanBuild({ name: 'Мечник', code: '3Ab', snap: { nodes: { skills_a: 2, 'bad id!': 1, skills_b: 0, skills_c: 99 }, eq: { a: ['skills_a', 'skills_x'], t: [] }, spec: { lv: [120, 5], got: [[1, 1, 70], [2]] }, ver: 'x1', at: '2026', pts: 7, names: { skills_a: '<b>Blade</b>' }, extra: 1 } })
    assert.deepEqual(b.snap, { nodes: { skills_a: 2 }, eq: { a: ['skills_a'], t: [] }, spec: { lv: [100, 5, 0, 0, 0], got: [[1], [2], [], [], []] }, ver: 'x1', at: '2026', pts: 7, names: { skills_a: 'Blade' } })
    assert.equal('snap' in cleanBuild({ name: 'Без знімка', code: '3Ab' }), false)
  })
  it('розрахунок: порожній не зберігається; указ — лише той, що міняє числа; давній без поля — без поля', () => {
    assert.throws(() => cleanCalc({ name: 'Порожній', code: '' }), (e) => e.status === 400)
    assert.equal(cleanCalc({ name: 'А', code: 'i~IronBar~5', decree: 'production' }).decree, 'production')
    assert.equal(cleanCalc({ name: 'А', code: 'i~IronBar~5', decree: 'xp' }).decree, null)
    assert.equal('decree' in cleanCalc({ name: 'А', code: 'i~IronBar~5' }), false)
  })
})

const SCHEMA = `gdsync_${process.pid}_${Date.now().toString(36)}`
let pg = null
try {
  const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  if (env.DB_HOST && env.DB_CONNECTION !== 'sqlite') {
    pg = { host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: `${env.DB_DATABASE || 'dune'}_testing`, user: env.DB_USERNAME || 'postgres', password: env.DB_PASSWORD || undefined }
    const probe = await openDb({ pg }).catch(() => null)
    if (probe) {
      await probe.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`)
      await probe.close()
      pg = { ...pg, options: `-c search_path=${SCHEMA}` }
    } else pg = null
  }
} catch { pg = null }

const ENGINES = [['SQLite', null], ...(pg ? [['Postgres', pg]] : [])]

for (const [engine, pgCfg] of ENGINES) {
  describe(`збір довідника в базу (${engine})`, () => {
    let dir, db, game
    before(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-gdsync-'))
      db = await openDb({ dataDir: dir, pg: pgCfg })
      await createPlacesStore(db)
      game = await createGameData(db, { dataDir: dir, log: quiet })
      await game.importCatalog(CATALOG())
    })
    after(async () => {
      if (db?.kind === 'pg') await db.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {})
      await db?.close()
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it('рецепт предмета, якого нема в довіднику, на сайт не йде (сирих id не буде)', async () => {
      const c = await game.catalog('en')
      assert.deepEqual(c.recipes.map((r) => r.id), ['Bar'])
    })

    it('частковий збій (вікі, деталі пристрою) не затирає стос, об’єм і станції порожнім', async () => {
      await new Promise((r) => setTimeout(r, 5))
      const c = CATALOG()
      c.items = c.items.map((i) => ({ ...i, stack: null, volume: null, kind: null }))
      c.recipes = c.recipes.map((r) => ({ ...r, at: [], water: null }))
      await game.importCatalog(c)
      const cat = await game.catalog('en')
      assert.deepEqual(cat.items.find((i) => i.id === 'IronOre'), { ...cat.items.find((i) => i.id === 'IronOre'), stack: 500, volume: 0.5, kind: 'RawResources' })
      assert.deepEqual(cat.recipes.find((r) => r.id === 'Bar').at, ['Ref'])
      assert.equal(cat.recipes.find((r) => r.id === 'Bar').water, 50)
    })

    it('прибране з гри — gone (сайт не бачить, рядок лишається); повернулось — знову видно', async () => {
      await new Promise((r) => setTimeout(r, 5))
      const c = CATALOG()
      c.items = c.items.filter((i) => i.id !== 'OldPart')
      await game.importCatalog(c)
      assert.equal((await game.catalog('en')).items.some((i) => i.id === 'OldPart'), false)
      assert.ok((await db.get("SELECT gone FROM game_items WHERE id = 'OldPart'")).gone > 0)
      await new Promise((r) => setTimeout(r, 5))
      await game.importCatalog(CATALOG())
      assert.equal((await game.catalog('en')).items.some((i) => i.id === 'OldPart'), true)
    })

    it('закріплене вручну не позначається прибраним; «половинний» збір нічого не прибирає', async () => {
      await db.run("UPDATE game_items SET locked = 1 WHERE id = 'OldPart'")
      await new Promise((r) => setTimeout(r, 5))
      await game.importCatalog(CATALOG({ items: CATALOG().items.filter((i) => i.id !== 'OldPart') }))
      assert.equal((await db.get("SELECT gone FROM game_items WHERE id = 'OldPart'")).gone, null)
      // збір з одним предметом із трьох — схоже на збій джерела: прибраним нічого не позначаємо
      await new Promise((r) => setTimeout(r, 5))
      await game.importCatalog(CATALOG({ items: [item('IronOre', 'Iron Ore')] }))
      assert.equal((await game.catalog('en')).items.length, 3)
      // не повний збір (давній файл) — теж ні
      await game.importCatalog(CATALOG({ complete: false, items: [item('IronOre', 'Iron Ore')] }))
      assert.equal((await game.catalog('en')).items.length, 3)
    })

    it('назва мовою: без власного перекладу — переклад запису з тією самою англійською назвою', async () => {
      await game.importCatalog(CATALOG({ complete: false, items: [...CATALOG().items, item('IronBar_Schematic', 'Iron Ingot', { cat: 'schematic' })] }))
      await game.putTexts('uk', [{ kind: 'item', id: 'IronBar', name: 'Залізний злиток' }], 'gamingtools')
      const c = await game.catalog('uk')
      assert.equal(c.items.find((i) => i.id === 'IronBar_Schematic').loc, 'Залізний злиток')
      assert.equal((await game.catalog('en')).items.find((i) => i.id === 'IronBar_Schematic').loc, null)
    })
  })
}

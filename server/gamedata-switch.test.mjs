// Джерела даних гри: усе, що є у файлах гри, — з них (без перемикань і без сторонніх сайтів); винятки (TH.GL, Red-Blink) —
// лише свої розділи; групи розділів, що мусять мати одне джерело, перемикаються разом. Тимчасова SQLite і пакет-фікстура.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './lib/sql.mjs'
import { createPlacesStore } from './lib/db.mjs'
import { createGameData } from './lib/gamedata.mjs'
import { compareReport, createGameDataSources, sectionsReport, switchPrimary } from './lib/gamedata/index.mjs'

const rec = (id, o = {}) => ({ id, name: id, icon: null, grade: 1, cat: 'misc', sub: null, kind: 'RawResources', rarity: null, stack: 100, volume: 1, released: true, ...o })
const skill = (id, o = {}) => ({ id, name: id, icon: null, school: 'trooper', kind: 'ability', desc: 'Опис.', x: 1, y: 1, max: 1, levels: [{ cost: 5, bonuses: [], perks: [], buffs: [] }], and: [], or: [], released: true, ...o })

function writeBundle(dir, opts = {}) {
  const b = path.join(dir, '7')
  fs.mkdirSync(path.join(b, 'sections'), { recursive: true })
  const put = (id, data) => fs.writeFileSync(path.join(b, 'sections', id + '.json.gz'), zlib.gzipSync(JSON.stringify(data)))
  put('items', { records: [rec('IronOre', { stack: 750 }), rec('IronBar')] })
  put('skills', { records: [skill('skills_ability_x'), skill('skills_ability_h', { released: false })] })
  put('texts', { records: [{ id: 'item:IronOre:uk', name: 'Залізна руда', description: null }] })
  put('spice', { records: [{ id: '2@1:2', layout: 2, x: 1, y: 2, size: 'large' }] })
  put('markers', { records: [{ id: 'survival_1@1:2', map: 'survival_1', kind: 'marker', type: 'Cave', x: 1, y: 2, z: 0 }, ...(opts.dd === false ? [] : [{ id: 'deepdesert_1@1:2', map: 'deepdesert_1', layout: 11, kind: 'marker', type: 'Cave', x: 1, y: 2, z: 0 }])] })
  put('markerTypes', { records: [{ id: 'Cave', tag: 'MapMarkers.Location.Static.Cave', icon: null, static: true }] })
  put('resources', { records: [{ id: 'survival_1@5:5', map: 'survival_1', kind: 'core', type: 'Minerals', x: 5, y: 5, z: 0 }] })
  put('ddLayouts', { blob: { cycleStart: '2024-12-03T05:00:00Z', cycleDays: 7, regional: true, seeds: [1], layouts: [0, 11] } })
  const sections = Object.fromEntries(['items', 'skills', 'texts', 'spice', 'markers', 'markerTypes', 'resources', 'ddLayouts'].map((id) => [id, { file: `sections/${id}.json.gz`, schema: 1, hash: 'h' + id, count: 1 }]))
  fs.writeFileSync(path.join(b, 'manifest.json'), JSON.stringify({ schema: 1, game: { build: '7', version: '1.5.15', manifestId: 'm1' }, extractedAt: '2026-10-21T13:53:28.867Z', extractor: { version: '1' }, sections }))
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ build: '7', dir: b }))
}

describe('джерела даних гри', () => {
  let dir, db, game, sources, known, applied
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-src-'))
    fs.mkdirSync(path.join(dir, 'map'))
    writeBundle(path.join(dir, 'bundles'))
    db = await openDb({ dataDir: dir, pg: null })
    await createPlacesStore(db)
    game = await createGameData(db, { dataDir: dir, log: {} })
    const mapData = {
      source: { syncedAt: 'x', maps: [{ id: 'survival_1', title: 'H', bounds: [], transformation: [], nodes: 'n', tiles: 't' }, { id: 'deepdesert_1', title: 'DD', bounds: [], transformation: [], nodes: 'd', tiles: 'd', layout: 11, layouts: [{ id: 11 }] }, { id: 'overmap', title: 'O', bounds: [], transformation: [], nodes: 'o', tiles: 'o' }], groups: [{ id: 'locations', types: [{ id: 'cave' }] }] },
      dir: path.join(dir, 'map'),
      // у TH.GL точок оглядової мапи нема — у файлів гри теж: на перемикання це не впливає
      raw: async (map) => (map === 'overmap' ? {} : { cave: { pts: [1, 2, 0], ids: [] } }),
    }
    applied = {}
    const gamemap = { setPoints: async (r, part) => { applied[part] = r }, setTypes: async (r) => { applied.types = r }, setSchedule: async (b) => { applied.schedule = b } }
    known = null
    const spice = { setKnown: async (r) => { known = r } }
    sources = await createGameDataSources({ db, dataDir: dir, game, mapData, spice, gamemap, log: {}, enabled: true, bundleDir: path.join(dir, 'bundles') })
  })
  afterEach(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('драйвери — файли гри й винятки; сторонніх зборів нема', () => {
    expect(Object.keys(sources.drivers)).toEqual(['gamefiles', 'thgl'])
  })

  it('усе, що є у файлах гри, — з них одразу, без перемикання; невипущене сховане', async () => {
    const r = await sources.registry.check(['items', 'skills', 'texts'])
    expect(r.map((x) => x.driver)).toEqual(['gamefiles', 'gamefiles', 'gamefiles'])
    expect((await game.catalog('en')).items.find((i) => i.id === 'IronOre').stack).toBe(750)
    expect((await game.skills('en')).skills.map((s) => s.id)).toEqual(['skills_ability_x'])
    expect((await game.catalog('uk')).items.find((i) => i.id === 'IronOre').loc).toBe('Залізна руда')
  })

  it('винятки — лише свої розділи; поля меланжу — з файлів гри у відомі місця', async () => {
    const r = await sources.registry.check(['maps', 'spice'])
    expect(r.map((x) => x.driver)).toEqual(['thgl', 'gamefiles'])
    expect(known).toEqual([{ id: '2@1:2', layout: 2, x: 1, y: 2, size: 'large' }])
  })

  it('звіт: групи з розділами й варіантами джерел; розділ з одним джерелом — без вибору', async () => {
    await sources.registry.check()
    const rep = await sectionsReport(sources)
    expect(rep.groups.find((g) => g.id === 'catalog')).toMatchObject({ sections: ['items', 'placeables', 'recipes'], switchable: false })
    // група «Мапа» — точки, їхні типи, розкладки ГП, ресурси; межі тайлів (maps) — окремо, поряд з картинками (виняток TH.GL)
    expect(rep.groups.find((g) => g.id === 'map')).toMatchObject({ sections: ['markers', 'markerTypes', 'ddLayouts', 'resources'] })
    expect(rep.sections.find((s) => s.id === 'maps')).toMatchObject({ group: null })
    expect(rep.sections.find((s) => s.id === 'items')).toMatchObject({ group: 'catalog', switchable: false, available: ['gamefiles'], applies: true })
    expect(rep.sections.find((s) => s.id === 'maps')).toMatchObject({ applies: false })
    expect(rep.sections.find((s) => s.id === 'spice')).toMatchObject({ group: null, available: ['gamefiles'], applies: true })
  })

  it('основне — на групу: усі її розділи; поза групою — свій розділ', async () => {
    await game.setPrimary('catalog', 'gamefiles')
    expect(await game.getPrimary('recipes')).toBe('gamefiles')
    expect(await game.getPrimary('skills')).toBeNull()
  })

  it('джерело, якого нема для всіх розділів групи, — відмова', async () => {
    await expect(switchPrimary(sources, { game }, 'catalog', 'thgl')).rejects.toThrow('нема')
    expect(await game.getPrimary('items')).toBeNull()
  })

  it('мапа — з TH.GL, доки адмін не перемкне групу; перемкнув — точки, типи, ресурси й розклад гри застосовано', async () => {
    expect((await sources.registry.check(['markers'])).map((x) => x.driver)).toEqual(['thgl'])
    expect(applied.markers).toBeUndefined()
    await switchPrimary(sources, { game }, 'map', 'gamefiles')
    expect(await game.getPrimary('markers')).toBe('gamefiles')
    // місця й ресурси — кожне своєю частиною таблиці точок мапи
    expect(applied.markers.map((p) => p.type)).toEqual(['Cave', 'Cave'])
    expect(applied.resources.map((p) => p.type)).toEqual(['Minerals'])
    expect(applied.types.map((t) => t.id)).toEqual(['Cave'])
    expect(applied.schedule.layouts).toEqual([0, 11])
    expect(applied.markers.map((p) => p.map)).toEqual(['survival_1', 'deepdesert_1'])
    // і назад на TH.GL
    await switchPrimary(sources, { game }, 'map', 'thgl')
    expect(await game.getPrimary('resources')).toBe('thgl')
  })

  it('у файлів гри ще нема точок якоїсь мапи (міста, Глибока пустеля) — групу «Мапа» на них не перемкнути', async () => {
    writeBundle(path.join(dir, 'bundles'), { dd: false })
    await expect(switchPrimary(sources, { game }, 'map', 'gamefiles')).rejects.toThrow('deepdesert_1')
    expect(await game.getPrimary('markers')).toBe('thgl')
  })

  it('порівняння — лише між двома різними джерелами розділу', async () => {
    expect(await compareReport(sources, 'items')).toBeNull()
  })
})

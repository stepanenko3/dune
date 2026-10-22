// Мапа з файлів гри: точки й типи з розділів реєстру → у формі даних мапи TH.GL (групи й типи, точки за типами, назви
// мовою, спрайт іконок); тайли й межі мап — з TH.GL (виняток). Групи — за тегом мітки гри, без зіставлення з TH.GL.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './lib/sql.mjs'
import { createPlacesStore } from './lib/db.mjs'
import { createGameData } from './lib/gamedata.mjs'
import { createGameMap, currentLayout } from './lib/gamemap.mjs'

const MAPS = [
  { id: 'survival_1', title: 'Hagga Basin', tiles: 'survival_1-aa', bounds: [[0, 0], [1, 1]], transformation: [1, 0, 1, 0], nodes: 'x.raw', layout: null, layouts: [] },
  { id: 'deepdesert_1', title: 'Deep Desert', tiles: 'dd-aa', bounds: [[0, 0], [1, 1]], transformation: [1, 0, 1, 0], nodes: null, layout: 11, layouts: [{ id: 2, tiles: 'dd2' }, { id: 11, tiles: 'dd11' }] },
]
const mapData = { source: { syncedAt: 'T', maps: MAPS, groups: [] }, labels: async () => ({ survival_1: { loc: 'Хаґґа', en: 'Hagga Basin' }, cave: { loc: 'Печера TH.GL', en: 'Cave' }, resources: { loc: 'Ресурси TH.GL', en: 'Resources' } }) }
const TYPES = [
  { id: 'Cave', tag: 'MapMarkers.Location.Static.Cave', icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerCave_D', static: true, legend: 'ST_UI:UI/Map_Legend_Category_Location' },
  { id: 'TrainerMentat', tag: 'MapMarkers.Characters.Trainer.Mentat', icon: null, static: true, legend: null },
  { id: 'LootContainer', tag: 'MapMarkers.Events.Encounter.Loot', icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerLoot_D', static: false },
]
const POINTS = [
  { id: 'survival_1@100:200', map: 'survival_1', kind: 'marker', type: 'Cave', name: 'ST_W:CAVE1', x: 100, y: 200, z: 5 },
  { id: 'survival_1@300:400', map: 'survival_1', kind: 'loot', type: 'BasicContainer', x: 300, y: 400, z: 0 },
  { id: 'survival_1@1:1', map: 'survival_1', kind: 'key', type: 'Code_EcoLab_Green', x: 1, y: 1, z: 0 },
  { id: 'survival_1@2:2', map: 'survival_1', kind: 'marker', type: 'TrainerMentat', x: 2, y: 2, z: 0 },
]

describe('мапа з файлів гри', () => {
  let dir, db, game, gm, fetched, png, t, failLoot
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-gm-'))
    db = await openDb({ dataDir: dir, pg: null })
    await createPlacesStore(db)
    game = await createGameData(db, { dataDir: dir, log: {} })
    await game.putTexts('uk', [{ kind: 'markerType', id: 'Cave', name: 'Печера' }, { kind: 'place', id: 'ST_W:CAVE1', name: 'Гнів' }, { kind: 'legend', id: 'ST_UI:UI/Map_Legend_Category_Location', name: 'Місцевість' }], 'game')
    await game.putTexts('en', [{ kind: 'markerType', id: 'Cave', name: 'Cave' }, { kind: 'place', id: 'ST_W:CAVE1', name: 'Wrath' }], 'game')
    fetched = []
    t = 1_000_000
    failLoot = false
    png = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ff0000' } }).png().toBuffer()
    gm = await createGameMap({ db, mapData, dataDir: dir, now: () => t, fetchIcon: async (url) => { fetched.push(url); if (failLoot && url.includes('Loot')) throw new Error('503'); return png } })
    await gm.setTypes(TYPES)
    await gm.setPoints(POINTS, 'markers')
  })
  afterEach(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('групи за тегом мітки гри; лут, ключі й ресурси — своїми групами; місця (статичні мітки) — увімкнені на свіжій мапі', async () => {
    await gm.setPoints([
      { id: 'survival_1@9:9', map: 'survival_1', kind: 'core', type: 'Minerals', x: 9, y: 9, z: 0 },
      { id: 'survival_1@8:8', map: 'survival_1', kind: 'aux', type: 'Minerals', x: 8, y: 8, z: 0 },
    ], 'resources')
    const s = await gm.source()
    expect(s.maps.map((m) => m.id)).toEqual(['survival_1', 'deepdesert_1'])
    expect(s.groups.map((g) => [g.id, g.types.map((t) => t.id)])).toEqual([
      ['ST_UI:UI/Map_Legend_Category_Location', ['Cave']], ['MapMarkers.Characters.Trainer', ['TrainerMentat']], ['loot', ['BasicContainer']], ['keys', ['Code_EcoLab_Green']], ['resources', ['Minerals']],
    ])
    expect(s.groups[4]).toMatchObject({ defaultOn: false, types: [{ id: 'Minerals', on: false }] })
    expect(s.groups[0].types[0]).toMatchObject({ on: true })
    expect(s.groups[2].types[0]).toMatchObject({ on: false })
  })

  it('точки за типами; назва місця мовою (нема перекладу — англійською)', async () => {
    const P = await gm.points('survival_1', undefined, 'uk')
    expect(P.types.Cave).toEqual({ pts: [100, 200, 5], info: { 0: ['Гнів', null, 'Wrath', null] } })
    expect(P.types.BasicContainer.pts).toEqual([300, 400, 0])
    expect(await gm.points('nope')).toBeNull()
  })

  it('місця й ресурси пишуться окремо: нові ресурси не стирають місць, нові місця — ресурсів', async () => {
    await gm.setPoints([{ id: 'survival_1@9:9', map: 'survival_1', kind: 'core', type: 'Minerals', x: 9, y: 9, z: 0 }], 'resources')
    await gm.setPoints([POINTS[0]], 'markers')
    const P = await gm.points('survival_1', undefined, 'en')
    expect(Object.keys(P.types).sort()).toEqual(['Cave', 'Minerals'])
  })

  it('однакові назви різних типів (гра всіх представників Домів зве однаково) — з уточненням з id', async () => {
    const extra = ['TrainerTrooper', 'HouseRepresentativeAlexin', 'HouseRepresentativeArgosaz']
    await gm.setTypes([...TYPES, ...extra.map((id) => ({ id, tag: null, icon: null, static: true, legend: null }))])
    await gm.setPoints([...POINTS, ...extra.map((type, i) => ({ id: `survival_1@3:${i}`, map: 'survival_1', kind: 'marker', type, x: 3, y: i, z: 0 }))], 'markers')
    await game.putTexts('uk', [['TrainerMentat', 'Тренер'], ['TrainerTrooper', 'Тренер'], ['HouseRepresentativeAlexin', 'Представник Дому'], ['HouseRepresentativeArgosaz', 'Представник Дому']].map(([id, name]) => ({ kind: 'markerType', id, name })), 'game')
    const L = await gm.labels('uk')
    expect([L.TrainerMentat.loc, L.TrainerTrooper.loc]).toEqual(['Тренер (Mentat)', 'Тренер (Trooper)'])
    // межа — ціле слово id («Alexin», а не «lexin»)
    expect([L.HouseRepresentativeAlexin.loc, L.HouseRepresentativeArgosaz.loc]).toEqual(['Представник Дому (Alexin)', 'Представник Дому (Argosaz)'])
    expect(L.Cave.loc).toBe('Печера')
  })

  it('назви типів: переклад гри; мапи — з TH.GL', async () => {
    const L = await gm.labels('uk')
    expect(L.Cave).toEqual({ loc: 'Печера', en: 'Cave', uk: 'Печера' })
    expect(L.survival_1.loc).toBe('Хаґґа')
    // з TH.GL — лише назви мап: типи й групи — свої (не змішуємо два джерела)
    expect(L.cave).toBeUndefined()
    // група — категорія легенди гри мовою сайту; без категорії — частина тегу
    expect(L['ST_UI:UI/Map_Legend_Category_Location'].loc).toBe('Місцевість')
    expect(L['MapMarkers.Characters.Trainer'].en).toBe('Characters · Trainer')
  })

  it('спрайт іконок — з текстур гри (awakening.wiki за іменем текстури); лут — іконкою мітки луту гри; ключ без іконки — без', async () => {
    const s = await gm.source()
    const t = Object.fromEntries(s.groups.flatMap((g) => g.types).map((x) => [x.id, x.icon]))
    expect(t.Cave).toEqual([0, 0, 64, 64])
    expect(t.BasicContainer).toEqual([64, 0, 64, 64])
    expect(t.Code_EcoLab_Green).toBeNull()
    expect(fetched.every((u) => u.startsWith('https://media.awakening.wiki/wiki/'))).toBe(true)
    const meta = await sharp(await gm.icons()).metadata()
    expect(meta.format).toBe('webp')
  })

  it('іконка не завантажилась — у типу без іконки, решта на сталих місцях; версія спрайту — за вмістом; повтор — згодом', async () => {
    failLoot = true
    const s1 = await gm.source()
    const ic = (s) => Object.fromEntries(s.groups.flatMap((g) => g.types).map((x) => [x.id, x.icon]))
    expect(ic(s1)).toMatchObject({ Cave: [0, 0, 64, 64], BasicContainer: null })
    failLoot = false
    expect((await gm.source()).sprite).toBe(s1.sprite)
    t += 11 * 60_000
    const s2 = await gm.source()
    expect(ic(s2)).toMatchObject({ Cave: [0, 0, 64, 64], BasicContainer: [64, 0, 64, 64] })
    expect(s2.sprite).not.toBe(s1.sprite)
    expect(s2.sprite).toBe(`/api/map/icons.webp?v=${(await gm.sprite()).hash}`)
  })

  it('одночасні запити — спрайт складається раз', async () => {
    await Promise.all([gm.source(), gm.source(), gm.labels('uk'), gm.icons()])
    expect(fetched).toHaveLength(2)
  })

  it('поточна розкладка ГП — з розкладу гри: тиждень від старту циклу → сід → номер розкладки', () => {
    const blob = { cycleStart: '2024-12-03T05:00:00Z', cycleDays: 7, seeds: [3, 1, 0], layouts: [0, 11, 2, 18] }
    expect(currentLayout(blob, Date.parse('2024-12-03T06:00:00Z'))).toBe(18)
    expect(currentLayout(blob, Date.parse('2024-12-10T06:00:00Z'))).toBe(11)
    expect(currentLayout(blob, Date.parse('2024-12-17T04:59:00Z'))).toBe(11)
    expect(currentLayout(blob, Date.parse('2024-12-24T06:00:00Z'))).toBe(18)
  })
})

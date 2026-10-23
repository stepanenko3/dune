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
      ['ST_UI:UI/Map_Legend_Category_Location', ['Cave']], ['MapMarkers.Characters.Trainer', ['TrainerMentat']], ['loot', ['BasicContainer']], ['keys', ['Code_EcoLab_Green']], ['resourcePoints', ['Minerals']],
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

  it('ресурс із типом мітки гри (AzuriteOre) — у групі видобутку різопроменем з іконкою гри, вимкнений на свіжій мапі; без типу — своя група точок ресурсів гри', async () => {
    await gm.setTypes([...TYPES, { id: 'AzuriteOre', tag: 'MapMarkers.Resource.Node.Ores', icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerMineralAzurite_D', static: false, legend: 'ST_UI:UI/Map_Legend_Category_Resources' }])
    await gm.setPoints([
      { id: 'a~AzuriteOre', map: 'survival_1', kind: 'core', type: 'AzuriteOre', weight: 77, x: 5, y: 5, z: 0 },
      { id: 'b', map: 'survival_1', kind: 'core', type: 'Minerals', weight: 0, x: 6, y: 6, z: 0 },
    ], 'resources')
    const g = Object.fromEntries((await gm.source()).groups.map((x) => [x.id, x]))
    // руда (основна точка) — у групі видобутку різопроменем (огляд 23.10)
    expect(g.cutteray).toMatchObject({ defaultOn: false, types: [{ id: 'AzuriteOre', on: false }] })
    expect(g.cutteray.types[0].icon).toEqual(expect.any(Array))
    // своя група (не «ресурси» TH.GL з тією самою назвою на сайті)
    expect(g.resourcePoints.types.map((t) => t.id)).toEqual(['Minerals'])
  })

  it('точка ресурсу з кількома можливими рудами — у картці вузла всі можливі руди місця з вагою (за спаданням); одна — без опису; підбирання — лише частка', async () => {
    await game.putTexts('uk', [{ kind: 'markerType', id: 'AzuriteOre', name: 'Азуритова руда' }, { kind: 'markerType', id: 'RhyoliteOre', name: 'Ріоліт' }], 'game')
    await gm.setPoints([
      { id: 'a~AzuriteOre', map: 'survival_1', kind: 'core', type: 'AzuriteOre', weight: 77, x: 5, y: 5, z: 0 },
      { id: 'a~RhyoliteOre', map: 'survival_1', kind: 'core', type: 'RhyoliteOre', weight: 40, x: 5, y: 5, z: 0 },
      { id: 'b~AzuriteOre', map: 'survival_1', kind: 'core', type: 'AzuriteOre', weight: 12, x: 7, y: 7, z: 0 },
      // підбирання (дрібні камінці, сотні тисяч) — без переліку (шар не роздувається), лише частка: фільтр «лише ймовірні»
      { id: 'c~AzuritePickup', map: 'survival_1', kind: 'aux', type: 'AzuritePickup', weight: 77, x: 5, y: 5, z: 0 },
      { id: 'c~RhyolitePickup', map: 'survival_1', kind: 'aux', type: 'RhyolitePickup', weight: 40, x: 5, y: 5, z: 0 },
    ], 'resources')
    const P = await gm.points('survival_1', undefined, 'uk')
    // частка руди в місці (вага / сума ваг можливих руд), %; місце з однією рудою — 100 % і без переліку
    const ores = [null, 'Азуритова руда — 66 %<br>Ріоліт — 34 %', null, null]
    expect(P.types.AzuriteOre).toMatchObject({ pts: [5, 5, 0, 7, 7, 0], info: { 0: ores }, share: [66, 100] })
    expect(P.types.RhyoliteOre).toMatchObject({ pts: [5, 5, 0], info: { 0: ores }, share: [34] })
    // жереб місця: у спільному місці — рівно одна з двох руд; місце з однією рудою — вона
    expect(P.types.AzuriteOre.pick[0] + P.types.RhyoliteOre.pick[0]).toBe(1)
    expect(P.types.AzuriteOre.pick[1]).toBe(1)
    expect(P.types.AzuritePickup).toMatchObject({ pts: [5, 5, 0], info: {}, share: [66] })
  })

  it('очікувана кількість: кожне місце руди — рівно одна руда за жеребом з вагами (стабільно); частка руди серед місць ≈ її вага', async () => {
    const zlib = await import('node:zlib')
    const A = [], B = [], C = []
    for (let i = 0; i < 2000; i++) { A.push(i, 0, 0, 25); B.push(i, 0, 0, 75) }
    C.push(9999, 9, 9, 40)
    const gz = zlib.gzipSync(JSON.stringify({ types: { TitaniumOre: { kind: 'core', core: A }, BasaltOre: { kind: 'core', core: B }, StravidiumOre: { kind: 'core', core: C } } }))
    await gm.setDdResources({ count: 4001, layouts: { 11: { count: 4001, hash: 'hpick', types: { TitaniumOre: 'core', BasaltOre: 'core', StravidiumOre: 'core' } } } }, () => gz)
    const P = await gm.points('deepdesert_1', 11, 'uk')
    const ti = P.types.TitaniumOre.pick, ba = P.types.BasaltOre.pick
    expect(ti.length).toBe(2000)
    // рівно одна руда в кожному місці
    expect(ti.every((v, i) => v + ba[i] === 1)).toBe(true)
    const n = ti.reduce((a, b) => a + b, 0)
    expect(n).toBeGreaterThan(400)
    expect(n).toBeLessThan(600)
    // місце з однією рудою — завжди вона
    expect(P.types.StravidiumOre.pick).toEqual([1])
    // стабільно: та сама картина знову
    const again = await createGameMap({ db, mapData, dataDir: dir, fetchIcon: async () => png })
    expect((await again.points('deepdesert_1', 11, 'en')).types.TitaniumOre.pick).toEqual(ti)
  })

  it('ресурси ГП у файлі з видом кожної точки: основні й підбирання — кожні зі своєю часткою місця', async () => {
    const zlib = await import('node:zlib')
    const gz = zlib.gzipSync(JSON.stringify({ types: {
      TitaniumOre: { kind: 'core', core: [1, 2, 3, 40, 7, 8, 9, 10] }, StravidiumOre: { kind: 'core', core: [1, 2, 3, 30] },
      // те саме місце (1, 2, 3), але підбирання — своє місце: частки не змішуються з основними
      TitaniumPickup: { kind: 'aux', aux: [1, 2, 3, 10] }, StravidiumPickup: { kind: 'aux', aux: [1, 2, 3, 30] },
      ScrapMetalPart: { kind: 'aux', core: [5, 5, 5, 10], aux: [6, 6, 6, 10] },
    } }))
    await gm.setDdResources({ count: 8, layouts: { 11: { count: 8, hash: 'h11k', types: { TitaniumOre: 'core', StravidiumOre: 'core', TitaniumPickup: 'aux', StravidiumPickup: 'aux', ScrapMetalPart: 'aux' } } } }, () => gz)
    const P = await gm.points('deepdesert_1', 11, 'uk')
    expect(P.types.TitaniumOre.share).toEqual([57, 100])
    expect(P.types.TitaniumPickup).toMatchObject({ pts: [1, 2, 3], info: {}, share: [25] })
    expect(P.types.ScrapMetalPart.pts).toEqual([5, 5, 5, 6, 6, 6])
  })

  it('ресурси Глибокої пустелі — файл на розкладку: точки вибраної розкладки з файлу разом з місцями цієї розкладки; тип — у групах', async () => {
    const zlib = await import('node:zlib')
    await gm.setTypes([...TYPES, { id: 'TitaniumOre', tag: 'MapMarkers.Resource.Node.Ores', icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerMineralTitaniumOre_D', static: false, legend: 'ST_UI:UI/Map_Legend_Category_Resources' }])
    await gm.setPoints([...POINTS, { id: 'deepdesert_1/11@5:5', map: 'deepdesert_1', layout: 11, kind: 'marker', type: 'Cave', x: 5, y: 5, z: 0 }], 'markers')
    const gz = zlib.gzipSync(JSON.stringify({ types: { TitaniumOre: { kind: 'core', pts: [1, 2, 3, 40, 7, 8, 9, 10] }, StravidiumOre: { kind: 'core', pts: [1, 2, 3, 30] } } }))
    await gm.setDdResources({ count: 3, layouts: { 11: { count: 3, hash: 'h11', types: { TitaniumOre: 'core', StravidiumOre: 'core' } } } }, () => gz)
    const P = await gm.points('deepdesert_1', 11, 'uk')
    expect(P.types.Cave.pts).toEqual([5, 5, 0])
    expect(P.types.TitaniumOre.pts).toEqual([1, 2, 3, 7, 8, 9])
    expect(P.types.TitaniumOre.info).toEqual({ 0: [null, 'TitaniumOre — 57 %<br>StravidiumOre — 43 %', null, null] })
    expect(P.types.TitaniumOre.share).toEqual([57, 100])
    expect((await gm.points('deepdesert_1', 2, 'uk')).types.TitaniumOre).toBeUndefined()
    const g = Object.fromEntries((await gm.source()).groups.map((x) => [x.id, x]))
    expect(g.cutteray.types.map((t) => t.id)).toContain('TitaniumOre')
    // файл — у теці сайту: новий запуск сервера бачить ту саму розкладку
    const again = await createGameMap({ db, mapData, dataDir: dir, fetchIcon: async () => png })
    expect((await again.points('deepdesert_1', 11, 'uk')).types.TitaniumOre.pts).toEqual([1, 2, 3, 7, 8, 9])
  })

  it('ресурси ГП: у пам’яті лише 2 розкладки (решта читається знову); файлу нема — мапа без ресурсів розкладки, розділ — на повтор', async () => {
    const zlib = await import('node:zlib')
    const gz = zlib.gzipSync(JSON.stringify({ types: { TitaniumOre: { kind: 'core', pts: [1, 2, 3, 40] } } }))
    const reads = []
    const g2 = await createGameMap({ db, mapData, dataDir: dir, fetchIcon: async () => png, readFile: async (f) => { reads.push(path.basename(f)); return fs.promises.readFile(f) } })
    const L = (k) => ({ count: 1, hash: 'h' + k, types: { TitaniumOre: 'core' } })
    await g2.setDdResources({ count: 3, layouts: { 2: L(2), 11: L(11), 3: L(3) } }, () => gz)
    for (const k of [11, 11, 2, 3, 11]) await g2.points('deepdesert_1', k, 'uk')
    expect(reads.map((f) => f.split('-')[0])).toEqual(['11', '2', '3', '11'])
    await db.exec('CREATE TABLE IF NOT EXISTS gamedata_sections (section TEXT PRIMARY KEY, content TEXT)')
    await db.run("INSERT INTO gamedata_sections (section, content) VALUES ('ddResources', 'b:x')")
    fs.rmSync(path.join(dir, 'map', 'dd'), { recursive: true, force: true })
    const g3 = await createGameMap({ db, mapData, dataDir: dir, fetchIcon: async () => png })
    expect((await g3.points('deepdesert_1', 11, 'uk')).types.TitaniumOre).toBeUndefined()
    expect((await db.get("SELECT content FROM gamedata_sections WHERE section = 'ddResources'")).content).toBeNull()
  })

  it('де випадає предмет: мапи з контейнерами, у луті яких він є (за назвою мовою чи англійською); ГП — поточна чи вибрана розкладка', async () => {
    await game.putTexts('uk', [{ kind: 'item', id: 'Hedgehog_Top', name: 'Їжачий нагрудник' }, { kind: 'item', id: 'SolarisCoin', name: 'Солярії' }], 'game')
    await game.putTexts('en', [{ kind: 'item', id: 'Hedgehog_Top', name: 'Pincushion Chestpiece' }], 'game')
    await gm.setSchedule({ cycleStart: new Date(t - 86_400_000).toISOString(), cycleDays: 7, seeds: [0], layouts: { 0: 11 } })
    await gm.setPoints([
      { id: 'a', map: 'survival_1', kind: 'loot', type: 'BasicContainer', loot: [['SolarisCoin', 100, 40]], x: 1, y: 1, z: 0 },
      { id: 'b', map: 'deepdesert_1', layout: 11, kind: 'loot', type: 'SmallUltraRare', loot: [['Hedgehog_Top', 5.7, 1]], x: 2, y: 2, z: 0 },
      { id: 'c', map: 'deepdesert_1', layout: 11, kind: 'loot', type: 'SmallUltraRare', loot: [['Hedgehog_Top', 3, 1]], x: 3, y: 3, z: 0 },
      { id: 'd', map: 'deepdesert_1', layout: 2, kind: 'loot', type: 'SmallUltraRare', loot: [['Hedgehog_Top', 9, 1]], x: 4, y: 4, z: 0 },
    ], 'markers')
    expect(await gm.lootMaps('їжачий', 'uk')).toEqual([{ map: 'deepdesert_1', layout: 11, n: 2, best: 5.7 }])
    expect(await gm.lootMaps('pincushion', 'uk')).toEqual([{ map: 'deepdesert_1', layout: 11, n: 2, best: 5.7 }])
    expect(await gm.lootMaps('їжачий', 'uk', 2)).toEqual([{ map: 'deepdesert_1', layout: 2, n: 1, best: 9 }])
    expect(await gm.lootMaps('солярії', 'uk')).toEqual([{ map: 'survival_1', layout: null, n: 1, best: 100 }])
  })

  it('назви точок для уточнення — один запит до бази на збірку груп, а не на кожен запит назв', async () => {
    let n = 0
    const all = db.all.bind(db)
    db.all = (sql, ...a) => { if (/GROUP BY type, name/.test(sql)) n++; return all(sql, ...a) }
    await gm.labels('uk')
    await gm.labels('en')
    db.all = all
    expect(n).toBe(1)
  })

  it('лут контейнера — рядки «предмет (шанс %)» мовою й англійською (назви предметів гри); кількість — коли більше одного', async () => {
    await game.putTexts('uk', [{ kind: 'item', id: 'HealthPack', name: 'Аптечка' }, { kind: 'item', id: 'SolarisCoin', name: 'Солярії' }], 'game')
    await game.putTexts('en', [{ kind: 'item', id: 'HealthPack', name: 'Healkit' }, { kind: 'item', id: 'SolarisCoin', name: 'Solari' }], 'game')
    await gm.setPoints([{ id: 'l', map: 'survival_1', kind: 'loot', type: 'MedicalContainer', loot: [['SolarisCoin', 100, 40], ['HealthPack', 46.9, 1]], x: 9, y: 9, z: 0 }], 'markers')
    const P = await gm.points('survival_1', undefined, 'uk')
    expect(P.types.MedicalContainer.info[0]).toEqual([null, 'Солярії (100%) ×40<br>Аптечка (46.9%)', null, 'Solari (100%) ×40<br>Healkit (46.9%)'])
  })

  it('лут з умовою гравця — з позначкою мовою', async () => {
    await game.putTexts('uk', [{ kind: 'item', id: 'Pattern', name: 'Візерунок' }, { kind: 'item', id: 'Pin', name: 'Їжачий нагрудник' }, { kind: 'item', id: 'Climb', name: 'Рукавиці скелелаза' }], 'game')
    const tr = { 'бонус спеціалізації': 'бонус спеціалізації (uk)', 'з активним контрактом': 'з контрактом (uk)' }
    const g2 = await createGameMap({ db, mapData, dataDir: dir, fetchIcon: async () => png, t: (lang, k) => (lang === 'uk' ? tr[k] ?? k : k) })
    await g2.setSchedule({ cycleStart: new Date(t - 86_400_000).toISOString(), cycleDays: 7, seeds: [0], layouts: { 0: 11 } })
    await g2.setPoints([
      { id: 'h', map: 'survival_1', kind: 'loot', type: 'RareContainer', loot: [['Pattern', 50, 1, 'k']], x: 9, y: 9, z: 0 },
      { id: 'd', map: 'deepdesert_1', layout: 11, kind: 'loot', type: 'SmallUltraRare', loot: [['Pin', 5.7, 1]], x: 2, y: 2, z: 0 },
    ], 'markers')
    expect((await g2.points('survival_1', undefined, 'uk')).types.RareContainer.info[0][1]).toBe('Візерунок (50%) — бонус спеціалізації (uk)')
    expect((await g2.points('deepdesert_1', 11, 'uk')).types.SmallUltraRare.info[0][1]).toBe('Їжачий нагрудник (5.7%)')
    expect(await g2.lootMaps('їжачий', 'uk')).toHaveLength(1)
  })

  it('місця й ресурси пишуться окремо: нові ресурси не стирають місць, нові місця — ресурсів', async () => {
    await gm.setPoints([{ id: 'survival_1@9:9', map: 'survival_1', kind: 'core', type: 'Minerals', x: 9, y: 9, z: 0 }], 'resources')
    await gm.setPoints([POINTS[0]], 'markers')
    const P = await gm.points('survival_1', undefined, 'en')
    expect(Object.keys(P.types).sort()).toEqual(['Cave', 'Minerals'])
  })

  it('однакові назви різних типів (гра всіх представників Домів зве однаково) — з уточненням з id', async () => {
    const extra = ['TrainerTrooper', 'HouseRepresentativeAlexin', 'HouseRepresentativeArgosaz']
    // в одній групі (як у грі: тренери — під одним тегом)
    await gm.setTypes([...TYPES, ...extra.map((id) => ({ id, tag: id.startsWith('Trainer') ? 'MapMarkers.Characters.Trainer.Trooper' : null, icon: null, static: true, legend: null }))])
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

describe('іконки мапи з файлів гри — за рецептом гри (DT_IconPreset)', () => {
  let dir, db, gm
  const BG = 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapLocationBGManufacturer_D'
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-gm-look-'))
    db = await openDb({ dataDir: dir, pg: null })
    await createPlacesStore(db)
    await createGameData(db, { dataDir: dir, log: {} })
    // усі текстури гри білі (як гліфи гри): колір дає лише тон рецепта
    const white = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ffffff' } }).png().toBuffer()
    gm = await createGameMap({ db, mapData, dataDir: dir, fetchIcon: async () => white })
    await gm.setTypes([
      { id: 'Cave', tag: 'MapMarkers.Location.Static.Cave', icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerCave_D', static: true, legend: null, look: { size: 20, tint: '#E17737', bg: BG, bgSize: 40, bgTint: '#8D4A20' } },
      { id: 'Atreides', kind: 'npc', tag: null, icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Factions/T_UI_IconsFactionsArtreides_D', static: true, legend: null, color: null, look: { size: 32, tint: null, bg: null, bgSize: null, bgTint: null } },
      { id: 'Code_EcoLab_Green', kind: 'key', tag: null, icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/PickupNotifications/T_UI_IconPickupKeycode_D', static: true, legend: null, color: '#11B000', look: { size: 32, tint: '#11B000', bg: null, bgSize: null, bgTint: null } },
    ])
    await gm.setPoints([
      { id: 'a', map: 'survival_1', kind: 'marker', type: 'Cave', x: 1, y: 1, z: 0 },
      { id: 'b', map: 'sh_arrakeen', kind: 'npc', type: 'Atreides', name: 'ST_NPCs:NPC/REP', x: 2, y: 2, z: 0 },
      { id: 'c', map: 'survival_1', kind: 'key', type: 'Code_EcoLab_Green', x: 3, y: 3, z: 0 },
    ], 'markers')
  })
  afterEach(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const px = async (rect, x, y) => {
    const { data, info } = await sharp(await gm.icons()).raw().toBuffer({ resolveWithObject: true })
    const i = ((rect[1] + y) * info.width + rect[0] + x) * info.channels
    return '#' + [0, 1, 2].map((c) => data[i + c].toString(16).padStart(2, '0')).join('').toUpperCase()
  }

  it('мітка: фон рецепта в тоні фону, гліф по центру в тоні гліфа (розміри — з рецепта)', async () => {
    const t = Object.fromEntries((await gm.source()).groups.flatMap((g) => g.types).map((x) => [x.id, x.icon]))
    expect(await px(t.Cave, 3, 3)).toBe('#8D4A20')
    expect(await px(t.Cave, 32, 32)).toBe('#E17737')
  })

  it('NPC — своя група з іконкою фракції (увімкнена: місця в містах); ключ — гліф у кольорі ключа', async () => {
    const g = Object.fromEntries((await gm.source()).groups.map((x) => [x.id, x]))
    expect(g.npcs).toMatchObject({ defaultOn: true, types: [{ id: 'Atreides', on: true }] })
    expect(g.npcs.types[0].icon).toEqual(expect.any(Array))
    const key = g.keys.types[0]
    expect(key.id).toBe('Code_EcoLab_Green')
    expect(await px(key.icon, 32, 32)).toBe('#11B000')
  })
})

describe('групи й назви мапи з файлів гри (огляд 23.10)', () => {
  let dir, db, game, gm
  const T = (id, tag, legend, extra = {}) => ({ id, tag, icon: null, static: false, legend, ...extra })
  const RES = 'ST_UI:UI/Map_Legend_Category_Resources', NPC = 'ST_UI:UI/Map_Legend_Category_NPCs'
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-gm-groups-'))
    db = await openDb({ dataDir: dir, pg: null })
    await createPlacesStore(db)
    game = await createGameData(db, { dataDir: dir, log: {} })
    gm = await createGameMap({ db, mapData, dataDir: dir, fetchIcon: async () => { throw new Error('offline') } })
    await gm.setTypes([
      T('TitaniumOre', 'MapMarkers.Resource.Node.Ores', RES), T('TitaniumPickup', 'MapMarkers.Resource.Node.Ores', RES),
      T('ScrapMetalWreckage', 'MapMarkers.Resource.Node.Salvage', RES), T('BrittleBush', 'MapMarkers.Resource.Node.Foliage', RES),
      T('SpiceFieldSmall', 'MapMarkers.Resource.Compacted.Spice', RES), T('SpiceFieldLarge', 'MapMarkers.Resource.Compacted.Spice', RES),
      T('TrainerMentat', 'MapMarkers.Characters.Trainer', NPC, { static: true }), T('TrainerTrooper', 'MapMarkers.Characters.Trainer', NPC, { static: true }),
      { id: 'Atreides', kind: 'npc', tag: null, icon: null, static: true, legend: null },
    ])
    await gm.setPoints([
      { id: 'n', map: 'survival_1', kind: 'npc', type: 'Atreides', x: 1, y: 1, z: 0 },
      { id: 'm', map: 'survival_1', kind: 'marker', type: 'TrainerMentat', name: 'ST_NPCs:SAMIN', x: 2, y: 2, z: 0 },
      { id: 't', map: 'survival_1', kind: 'marker', type: 'TrainerTrooper', name: 'ST_NPCs:GHAVOURI', x: 3, y: 3, z: 0 },
      { id: 's', map: 'survival_1', kind: 'marker', type: 'SpiceFieldSmall', x: 4, y: 4, z: 0 },
    ], 'markers')
    await gm.setPoints([
      { id: 'a', map: 'survival_1', kind: 'core', type: 'TitaniumOre', weight: 10, x: 5, y: 5, z: 0 },
      { id: 'b', map: 'survival_1', kind: 'aux', type: 'TitaniumPickup', weight: 10, x: 6, y: 6, z: 0 },
      { id: 'c', map: 'survival_1', kind: 'core', type: 'ScrapMetalWreckage', weight: 10, x: 7, y: 7, z: 0 },
      { id: 'd', map: 'survival_1', kind: 'core', type: 'BrittleBush', weight: 10, x: 8, y: 8, z: 0 },
    ], 'resources')
    await game.putTexts('uk', [['TrainerMentat', 'Тренер'], ['TrainerTrooper', 'Тренер']].map(([id, name]) => ({ kind: 'markerType', id, name })), 'game')
    await game.putTexts('uk', [{ kind: 'place', id: 'ST_NPCs:SAMIN', name: 'Самін Моро' }, { kind: 'place', id: 'ST_NPCs:GHAVOURI', name: 'Ґавурі' }], 'game')
  })
  afterEach(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const groups = async () => Object.fromEntries((await gm.source()).groups.map((g) => [g.id, g.types.map((t) => t.id)]))

  it('ресурси — видобуток різопроменем, збір руками, рослини; поля меланжу — завжди в даних (своїм блоком на клієнті)', async () => {
    const g = await groups()
    expect(g.cutteray).toEqual(['ScrapMetalWreckage', 'TitaniumOre'])
    expect(g.hand).toEqual(['TitaniumPickup'])
    expect(g.plants).toEqual(['BrittleBush'])
    expect(g[RES]).toEqual(['SpiceFieldSmall', 'SpiceFieldLarge'])
  })

  it('NPC за фракцією — у категорії легенди гри «NPC» (а не другою групою «NPC»)', async () => {
    const g = await groups()
    expect(g[NPC]).toContain('Atreides')
    expect(g.npcs).toBeUndefined()
  })

  it('однакові назви різних типів — з назвою їхніх точок у грі (а не з id)', async () => {
    const L = await gm.labels('uk')
    expect(L.TrainerMentat.loc).toBe('Тренер (Самін Моро)')
    expect(L.TrainerTrooper.loc).toBe('Тренер (Ґавурі)')
  })

  it('однакові назви в різних групах — без уточнення (руда різопроменем і та сама руда руками)', async () => {
    await game.putTexts('uk', [['TitaniumOre', 'Титанова руда'], ['TitaniumPickup', 'Титанова руда']].map(([id, name]) => ({ kind: 'markerType', id, name })), 'game')
    const L = await gm.labels('uk')
    expect([L.TitaniumOre.loc, L.TitaniumPickup.loc]).toEqual(['Титанова руда', 'Титанова руда'])
  })

  it('уточнення — з назви точок у грі для кожного типу, що її має; без неї — з id лише для того типу', async () => {
    await gm.setTypes([...['HouseRepresentativeAlexin', 'HouseRepresentativeArgosaz', 'HouseRepresentativeSpinette'].map((id) => T(id, 'MapMarkers.Characters.House', NPC, { static: true }))])
    await gm.setPoints([
      { id: 'a', map: 'survival_1', kind: 'marker', type: 'HouseRepresentativeAlexin', name: 'ST_UI:REP_ALEXIN', x: 1, y: 1, z: 0 },
      { id: 'g', map: 'survival_1', kind: 'marker', type: 'HouseRepresentativeArgosaz', name: 'ST_UI:REP_ARGOSAZ', x: 1, y: 2, z: 0 },
      // гра зве точку загальною назвою — уточнення з неї нема
      { id: 's', map: 'sh_harkovillage', kind: 'marker', type: 'HouseRepresentativeSpinette', name: 'ST_UI:REP', x: 2, y: 2, z: 0 },
    ], 'markers')
    await game.putTexts('uk', [['HouseRepresentativeAlexin', 'Представник Дому'], ['HouseRepresentativeArgosaz', 'Представник Дому'], ['HouseRepresentativeSpinette', 'Представник Дому']].map(([id, name]) => ({ kind: 'markerType', id, name })), 'game')
    await game.putTexts('uk', [{ kind: 'place', id: 'ST_UI:REP_ALEXIN', name: 'Представник Дому Алексін' }, { kind: 'place', id: 'ST_UI:REP_ARGOSAZ', name: 'Представниця Дому Аргосаз' }, { kind: 'place', id: 'ST_UI:REP', name: 'Представник Дому' }], 'game')
    const L = await gm.labels('uk')
    expect(L.HouseRepresentativeAlexin.loc).toBe('Представник Дому Алексін')
    // власна назва з тим самим словом («Дому») — сама собою, а не «Представник Дому (Представниця Дому Аргосаз)»
    expect(L.HouseRepresentativeArgosaz.loc).toBe('Представниця Дому Аргосаз')
    expect(L.HouseRepresentativeSpinette.loc).toBe('Представник Дому (Spinette)')
  })

  it('борошнистий пісок (і інші ущільнені ресурси, крім меланжу) — у «Ресурсах» з рудами різопроменем', async () => {
    await gm.setTypes([T('FlourSand', 'MapMarkers.Resource.Compacted.FlourSand', RES), T('SpiceFieldSmall', 'MapMarkers.Resource.Compacted.Spice', RES)])
    await gm.setPoints([{ id: 'f', map: 'survival_1', kind: 'marker', type: 'FlourSand', x: 1, y: 1, z: 0 }], 'markers')
    const g = await groups()
    expect(g.cutteray).toContain('FlourSand')
    expect(g[RES]).toEqual(['SpiceFieldSmall'])
  })

  it('тип ресурсу з точками обох видів — в одній групі, за більшістю точок (брухт-підбирання, що зрідка й основна точка)', async () => {
    await gm.setTypes([T('ScrapMetalPart', 'MapMarkers.Resource.Node.Salvage', RES)])
    await gm.setPoints([
      { id: 'p1', map: 'survival_1', kind: 'aux', type: 'ScrapMetalPart', weight: 10, x: 1, y: 1, z: 0 },
      { id: 'p2', map: 'survival_1', kind: 'aux', type: 'ScrapMetalPart', weight: 10, x: 2, y: 1, z: 0 },
      { id: 'p3', map: 'survival_1', kind: 'core', type: 'ScrapMetalPart', weight: 10, x: 3, y: 1, z: 0 },
    ], 'resources')
    const g = await groups()
    expect(g.hand).toEqual(['ScrapMetalPart'])
    expect(g.cutteray).toBeUndefined()
  })
})

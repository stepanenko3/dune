// Мапа сайту бере точки з файлів гри, лише коли адмін перемкнув групу «Мапа» на файли гри і точки вже застосовано;
// інакше — TH.GL. Тайли й межі мап — завжди TH.GL (виняток).
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMapRoutes } from './routes/map.mjs'

const MAPS = [{ id: 'survival_1', title: 'H', tiles: 't', bounds: [[0, 0], [1, 1]], transformation: [1, 0, 1, 0], nodes: 'n', layout: null, layouts: [] }]
const thglPoints = { map: 'survival_1', layout: null, types: { cave: { pts: [1, 2, 0], info: {} } } }
const gamePoints = { map: 'survival_1', layout: null, types: { Cave: { pts: [3, 4, 0], info: { 0: ['Гнів', null, 'Wrath', null] } } } }
const mapData = {
  source: { syncedAt: 'T', maps: MAPS, groups: [{ id: 'locations', defaultOn: true, types: [{ id: 'cave', icon: [0, 0, 64, 64], size: 2 }] }] },
  refresh: async () => {}, labels: async () => ({ cave: { loc: 'Печера', en: 'Cave' } }), points: async () => thglPoints, icons: async () => Buffer.from('thgl'), ddHistory: () => [],
}
let primary = null, ready = true
const game = { getPrimary: async () => primary }
const gamemap = {
  ready: async () => ready,
  source: async () => ({ syncedAt: 'T', maps: MAPS, groups: [{ id: 'MapMarkers.Location.Static', defaultOn: true, types: [{ id: 'Cave', icon: null, size: 2, on: true }] }], sprite: '/api/map/icons.webp?v=abc' }),
  labels: async () => ({ Cave: { loc: 'Печера', en: 'Cave' } }),
  points: async () => gamePoints,
  icons: async () => Buffer.from('game'),
  sprite: async () => ({ buf: Buffer.from('game'), hash: 'abc' }),
}

describe('мапа: TH.GL чи файли гри', () => {
  let srv, base
  beforeAll(async () => {
    const app = express()
    app.use((req, res, next) => { req.lang = 'uk'; req.t = (s) => s; next() })
    app.use(createMapRoutes({ mapData, game, gamemap }))
    srv = app.listen(0)
    base = `http://127.0.0.1:${srv.address().port}`
  })
  afterAll(() => srv?.close())
  const get = async (p) => (await fetch(base + p)).json()

  it('не перемкнуто — TH.GL', async () => {
    primary = null
    expect((await get('/api/map/source')).source.groups[0].id).toBe('locations')
    expect((await get('/api/map/points/survival_1/cave')).pts).toEqual([1, 2, 0])
    expect(await (await fetch(base + '/api/map/icons.webp')).text()).toBe('thgl')
    expect((await fetch(base + '/api/map/icons.webp?v=abc')).headers.get('cache-control')).toBe('no-store')
  })

  it('перемкнуто на файли гри — групи, точки й іконки гри; межі мап — ті самі', async () => {
    primary = 'gamefiles'
    const s = await get('/api/map/source')
    expect(s.source.groups[0].id).toBe('MapMarkers.Location.Static')
    expect(s.source.sprite).toBe('/api/map/icons.webp?v=abc')
    expect(s.source.maps).toEqual(MAPS)
    expect((await get('/api/map/points/survival_1/Cave')).pts).toEqual([3, 4, 0])
    expect((await get('/api/map/index/survival_1')).named).toEqual([['Cave', 0, 'Гнів', 'Wrath', 3, 4]])
    const ok = await fetch(base + '/api/map/icons.webp?v=abc')
    expect(await ok.text()).toBe('game')
    expect(ok.headers.get('cache-control')).toContain('immutable')
    // давня чи чужа версія — не на тиждень
    expect((await fetch(base + '/api/map/icons.webp?v=old')).headers.get('cache-control')).toBe('no-store')
  })

  it('перемкнуто, але точок гри ще нема — лишається TH.GL', async () => {
    primary = 'gamefiles'
    ready = false
    expect((await get('/api/map/source')).source.groups[0].id).toBe('locations')
    ready = true
  })
})

describe('мапа з файлів гри: шари й лут на всіх мапах', () => {
  let srv, base
  const asked = []
  const MAPS2 = [...MAPS, { id: 'deepdesert_1', title: 'DD', tiles: 'd', bounds: [[0, 0], [1, 1]], transformation: [1, 0, 1, 0], nodes: null, layout: 11, layouts: [{ id: 11, tiles: 'd11' }] }]
  const box = (desc) => ({ pts: [5, 5, 0], info: { 0: [null, desc, null, desc] } })
  const pts = {
    survival_1: { map: 'survival_1', layout: null, types: { TitaniumOre: { pts: [1, 1, 0, 2, 2, 0, 3, 3, 0], info: { 0: [null, 'Титанова руда — 40 %<br>Мідна руда — 60 %', null, null] }, share: [10, 20, 100], pick: [0, 1, 1] }, BasicContainer: box('Солярії (100%)<br>Титанова руда (12%) ×3') } },
    deepdesert_1: { map: 'deepdesert_1', layout: 11, types: { SmallUltraRare: box('Солярії (100%)<br>Їжачий нагрудник (5.7%)'), RareContainer: box('Їжачий нагрудник (2%)') } },
  }
  beforeAll(async () => {
    primary = 'gamefiles'
    const app = express()
    app.use((req, res, next) => { req.lang = 'uk'; req.t = (s) => s; next() })
    const gm2 = { ...gamemap, source: async () => ({ syncedAt: 'T', maps: MAPS2, groups: [], sprite: '' }), points: async (m) => pts[m] ?? null, lootMaps: async (q, lang, layout) => (asked.push([q, lang, layout]), [{ map: 'deepdesert_1', layout: 11, n: 2, best: 5.7 }]) }
    app.use(createMapRoutes({ mapData: { ...mapData, source: { ...mapData.source, maps: MAPS2 } }, game, gamemap: gm2 }))
    srv = app.listen(0)
    base = `http://127.0.0.1:${srv.address().port}`
  })
  afterAll(() => srv?.close())
  const get = async (p) => (await fetch(base + p)).json()

  it('зведення мапи — і розподіл часток руди за кроком 5 % (лічильники шару для будь-якого порогу повзунка)', async () => {
    const ix = await get('/api/map/index/survival_1')
    expect(ix.counts.TitaniumOre).toBe(3)
    const h = new Array(21).fill(0)
    h[2] = 1; h[4] = 1; h[20] = 1
    expect(ix.shares).toEqual({ TitaniumOre: h })
    // очікувана кількість: лише місця, де жереб випав на цю руду, — так само кроками 5 %
    const hp = new Array(21).fill(0)
    hp[4] = 1; hp[20] = 1
    expect(ix.picks).toEqual({ TitaniumOre: hp })
    expect((await get('/api/map/points/survival_1/TitaniumOre')).pick).toEqual([0, 1, 1])
  })

  it('предмет з довідника: на яких мапах він випадає — з луту файлів гри (без завантаження точок усіх мап); розкладка ГП — вибрана', async () => {
    expect(await get('/api/map/loot-maps?q=' + encodeURIComponent('Їжачий нагрудник') + '&layout=3')).toEqual({ maps: [{ map: 'deepdesert_1', layout: 11, n: 2, best: 5.7 }] })
    expect(asked).toEqual([['їжачий нагрудник', 'uk', 3]])
    expect(await get('/api/map/loot-maps?q=ab')).toEqual({ maps: [] })
  })

  it('пошук луту — лише рядки луту контейнерів («предмет (шанс %)»), не перелік руд вузла', async () => {
    const r = await get('/api/map/loot/survival_1?q=' + encodeURIComponent('титанова'))
    expect(r.hits.map((h) => [h.type, h.chance])).toEqual([['BasicContainer', 12]])
  })
})

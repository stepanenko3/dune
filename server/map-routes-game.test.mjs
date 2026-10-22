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

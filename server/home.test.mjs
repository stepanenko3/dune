// Головна бере Глибоку пустелю з тих самих даних, що й мапа: точки — з джерела мапи (файли гри, коли адмін перемкнув
// групу «Мапа» і точки застосовано, інакше — основне), великі поля — ще й місця з файлів гри та позначок гравців,
// активні поля — ті, що бачить людина.
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHomeRoutes } from './routes/home.mjs'

// межі 0…9000 по обох осях: сектор — 1000×1000; ряд A — найбільший x, стовпець 1 — найменший y
const DDMAP = { id: 'deepdesert_1', tiles: 'dd', bounds: [[0, 0], [9000, 9000]], transformation: [1, 0, 1, 0], layout: 2, layouts: [{ id: 2, tiles: 'dd-2' }, { id: 3, tiles: 'dd-3' }] }
const base = {
  map: 'deepdesert_1', layout: 2,
  types: { titanium: { pts: [8500, 500, 0, 8400, 600, 0, 100, 8900, 0], info: {} }, spice_field_medium: { pts: [4500, 4500, 0], info: {} }, cave: { pts: [1, 1, 0], info: {} } },
}
const gamePts = { map: 'deepdesert_1', layout: 3, types: { TitaniumOre: { pts: [100, 100, 0], info: {} }, StravidiumOre: { pts: [200, 200, 0, 300, 300, 0], info: {} } } }
const mapData = {
  source: { syncedAt: 'T', maps: [DDMAP] },
  refresh: async () => {}, ddHistory: () => [{ layout: 2, seenAt: 'S2' }],
  points: async (m, l) => (l === 2 ? base : null),
}
let primary = null
const game = { getPrimary: async () => primary }
const gamemap = { ready: async () => true, source: async () => ({ syncedAt: 'G', maps: [{ ...DDMAP, layout: 3 }] }), points: async () => gamePts }
const now = Date.now()
const views = []
const spice = {
  async view(ctx, map, layout) {
    views.push([ctx?.user?.id ?? null, map, layout])
    return {
      spots: [{ x: 8800, y: 8800, src: 'known' }, { x: 500, y: 500, src: 'marked' }],
      fields: ctx?.user ? [{ size: 'large', x: 8800, y: 8800, first: now - 60_000, expires: now + 3_600_000, n: 2 }, { size: 'small', x: 99999, y: 0, first: now, expires: now + 1, n: 1 }] : [],
    }
  },
}
const items = { list: async () => [] }
const places = { many: async () => [] }

describe('головна: Глибока пустеля з даних мапи', () => {
  let srv, url
  beforeAll(async () => {
    const app = express()
    // «увійшла» людина — заголовком (як req.ctx від сеансу)
    app.use((req, res, next) => { req.lang = 'uk'; req.ctx = req.get('x-user') ? { user: { id: req.get('x-user') } } : {}; next() })
    app.use(createHomeRoutes({ mapData, places, items, spice, game, gamemap }))
    srv = app.listen(0)
    url = `http://127.0.0.1:${srv.address().port}/api/home`
  })
  afterAll(() => srv?.close())
  const get = async (user) => (await fetch(url, { headers: user ? { 'x-user': user } : {} })).json()

  it('основне джерело: титан за секторами, великі поля — місця з файлів гри й позначок', async () => {
    primary = null
    const r = await get()
    expect(r.dd.layout).toBe(2)
    expect(r.dd.since).toBe('S2')
    expect(r.dd.tiles).toBe('dd-2')
    expect(r.dd.layers.titanium).toBe('titanium')
    expect(r.dd.counts).toMatchObject({ titanium: 3, spice_medium: 1, spice_large: 2, cave: 1, stravidium: 0 })
    // x 8500/8400 → ряд A, y 500/600 → стовпець 1
    expect(r.dd.top.titanium[0]).toEqual(['A1', 2])
    expect(r.dd.top.spice_large.map(([s]) => s).sort()).toEqual(['A9', 'I1'])
    expect(r.dd.dots.spice_large).toHaveLength(2)
    expect(views.at(-1)).toEqual([null, 'deepdesert_1', 2])
    // анонім активних полів (лише публічні — тут жодного) не бачить
    expect(r.active).toMatchObject({ total: 0, fields: [] })
  })

  it('активні поля — ті, що бачить людина, лише в межах мапи', async () => {
    const r = await get('u1')
    expect(views.at(-1)).toEqual(['u1', 'deepdesert_1', 2])
    expect(r.active.total).toBe(1)
    expect(r.active.fields[0]).toMatchObject({ size: 'large', sector: 'A9', n: 2 })
  })

  it('мапу перемкнуто на файли гри — розкладка й точки гри, шари — типами міток гри', async () => {
    primary = 'gamefiles'
    const r = await get()
    expect(r.dd.layout).toBe(3)
    expect(r.dd.tiles).toBe('dd-3')
    expect(r.dd.layers.titanium).toBe('TitaniumOre')
    expect(r.dd.counts).toMatchObject({ titanium: 1, stravidium: 2, spice_large: 2 })
    expect(views.at(-1)).toEqual([null, 'deepdesert_1', 3])
    expect(r.syncedAt).toBe('G')
    primary = null
  })

  it('файли гри: руда — очікувана кількість (жереб місця), найкращий сектор — де руда найпевніша (чисті острівці), а не де найбільше можливих місць', async () => {
    primary = 'gamefiles'
    const was = gamePts.types.TitaniumOre
    // A1: 10 змішаних місць (16 %), жереб випав на титан у 2; I9: чистий острівець — 3 місця по 100 %
    const pts = [], share = [], pick = []
    for (let i = 0; i < 10; i++) { pts.push(8500, 500 + i, 0); share.push(16); pick.push(i < 2 ? 1 : 0) }
    for (let i = 0; i < 3; i++) { pts.push(500, 8500 + i, 0); share.push(100); pick.push(1) }
    gamePts.types.TitaniumOre = { pts, info: {}, share, pick }
    const r = await get()
    gamePts.types.TitaniumOre = was
    primary = null
    expect(r.dd.counts.titanium).toBe(5)
    expect(r.dd.top.titanium[0]).toEqual(['I9', 3])
    expect(r.dd.top.titanium[1]).toEqual(['A1', 2])
    expect(r.dd.dots.titanium).toHaveLength(5)
  })

  it('меланж: найкраща точка — звідки в межах радіуса найбільше середніх і великих полів (не сектор)', async () => {
    primary = 'gamefiles'
    const was = gamePts.types.SpiceFieldMedium
    gamePts.types.SpiceFieldMedium = { pts: [4400, 4400, 0, 4600, 4600, 0, 4500, 4300, 0, 100, 100, 0], info: {} }
    const r = await get()
    gamePts.types.SpiceFieldMedium = was
    primary = null
    expect(r.dd.spiceSpot).toMatchObject({ n: 3, sector: 'E5' })
    expect(r.dd.spiceSpot.radius).toBeGreaterThan(0)
  })

  it('чисті острівці (місця, де руда завжди одна) — усі такі сектори першими й з позначкою; змішані — після', async () => {
    primary = 'gamefiles'
    const was = gamePts.types.TitaniumOre
    const pts = [], share = [], pick = []
    const add = (x, y, n, sh) => { for (let i = 0; i < n; i++) { pts.push(x, y + i, 0); share.push(sh); pick.push(1) } }
    add(500, 8500, 30, 100) // I9 — чистий острівець
    add(1500, 4500, 25, 100) // H5 — чистий острівець
    add(8500, 500, 60, 50) // A1 — пояс 50/50
    add(4500, 4500, 5, 100) // E5 — кілька чистих місць, не острівець
    gamePts.types.TitaniumOre = { pts, info: {}, share, pick }
    const r = await get()
    gamePts.types.TitaniumOre = was
    primary = null
    expect(r.dd.top.titanium.slice(0, 3)).toEqual([['I9', 30, 1], ['H5', 25, 1], ['A1', 60]])
  })
})

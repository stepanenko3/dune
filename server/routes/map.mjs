/*
 * Мапа: опис мап і шарів, точки за типами, пошук по луту, тайли й іконки з кешем на диску.
 */
import express from 'express'

const TILE_DIR = /^[a-z0-9_]+-[0-9a-f]{32}$/

export function createMapRoutes({ mapData }) {
  const r = express.Router()
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next)
  const layoutOf = (req) => (req.query.layout === undefined || req.query.layout === '' ? undefined : Number(req.query.layout))

  r.get('/api/map/source', wrap(async (req, res) => {
    mapData.refresh().catch(() => {})
    res.json({ source: mapData.source, labels: await mapData.labels(), ddHistory: mapData.ddHistory() })
  }))

  r.post('/api/map/refresh', wrap(async (req, res) => {
    const s = await mapData.refresh(true)
    res.json({ syncedAt: s.syncedAt, dd: s.maps.find((m) => m.id === 'deepdesert_1')?.layout ?? null })
  }))

  // зведення мапи: скільки точок кожного типу + усі іменовані місця (для пошуку)
  r.get('/api/map/index/:map', wrap(async (req, res) => {
    const P = await mapData.points(req.params.map, layoutOf(req))
    if (!P) return res.status(404).json({ error: 'немає такої мапи або розкладки' })
    const counts = {}, named = []
    for (const [type, T] of Object.entries(P.types)) {
      counts[type] = T.pts.length / 3
      for (const [i, [name, , en]] of Object.entries(T.info)) if (name) named.push([type, +i, name, en, T.pts[i * 3], T.pts[i * 3 + 1]])
    }
    res.set('cache-control', 'max-age=300').json({ map: P.map, layout: P.layout, counts, named })
  }))

  r.get('/api/map/points/:map/:type', wrap(async (req, res) => {
    const P = await mapData.points(req.params.map, layoutOf(req))
    const T = P?.types[req.params.type]
    if (!T) return res.json({ pts: [], info: {} })
    const info = {}
    for (const [i, [name, desc, en]] of Object.entries(T.info)) info[i] = [name, desc, en]
    res.set('cache-control', 'max-age=300').json({ pts: T.pts, info })
  }))

  // контейнери, у луті яких є предмет: «Промислова помпа» → точки з відсотком випадіння
  r.get('/api/map/loot/:map', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase()
    const P = await mapData.points(req.params.map, layoutOf(req))
    if (!P || q.length < 3) return res.json({ hits: [] })
    const hits = []
    for (const [type, T] of Object.entries(P.types)) {
      for (const [i, [name, uk, , en]] of Object.entries(T.info)) {
        const desc = uk?.toLowerCase().includes(q) ? uk : en?.toLowerCase().includes(q) ? en : null
        if (!desc) continue
        const line = desc.split(/<br\s*\/?>/i).find((l) => l.toLowerCase().includes(q)) || ''
        const pc = /\((\d+(?:[.,]\d+)?)%\)/.exec(line)
        hits.push({ type, i: +i, x: T.pts[i * 3], y: T.pts[i * 3 + 1], name, item: line.replace(/<[^>]+>/g, '').replace(/\s*\(\d.*$/, '').trim(), chance: pc ? Number(pc[1].replace(',', '.')) : null })
        if (hits.length >= 3000) break
      }
    }
    res.json({ hits })
  }))

  r.get('/api/map/icons.webp', wrap(async (req, res) => {
    res.type('image/webp').set('cache-control', 'max-age=86400').send(await mapData.icons())
  }))

  r.get('/map-tiles/:dir/:z/:y/:x.webp', wrap(async (req, res) => {
    const { dir } = req.params
    const [z, y, x] = [req.params.z, req.params.y, req.params.x].map(Number)
    if (!TILE_DIR.test(dir) || ![z, y, x].every(Number.isInteger) || z < 0 || z > 8) return res.status(400).end()
    const buf = await mapData.tile(dir, z, y, x)
    if (!buf) return res.status(404).end()
    res.type('image/webp').set('cache-control', 'public, max-age=604800, immutable').send(buf)
  }))

  return r
}

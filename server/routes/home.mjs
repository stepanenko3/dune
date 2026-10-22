/*
 * Зведення для головної: що зараз у Глибокій пустелі (тиждень, руда й меланж за секторами)
 * і стан «Наших ресурсів» (того, що бачить людина). Рахується з тих самих даних, що й мапа.
 */
import express from 'express'

const N = 9
/** сектор A1…I9: ряд A — знизу (найбільший x гри), стовпці 1…9 — зліва (найменший y) */
function sector(b, x, y) {
  const ch = (b[1][0] - b[0][0]) / N, cw = (b[1][1] - b[0][1]) / N
  const r = Math.floor((b[1][0] - x) / ch), c = Math.floor((y - b[0][1]) / cw)
  return r < 0 || c < 0 || r >= N || c >= N ? null : String.fromCharCode(65 + r) + (c + 1)
}

export function createHomeRoutes({ mapData, places, items }) {
  const r = express.Router()
  r.get('/api/home', async (req, res, next) => {
    try {
      mapData.refresh().catch(() => {}) // головна теж показує тиждень DD — хай підтягує нову розкладку
      const src = mapData.source
      const dd = src.maps.find((m) => m.id === 'deepdesert_1')
      const lay = dd?.layouts.find((l) => l.id === dd.layout)
      const P = dd ? await mapData.points(dd.id, dd.layout) : null
      const seen = [...mapData.ddHistory()].reverse().find((h) => h.layout === dd?.layout)
      const bySector = (type) => {
        const T = P?.types[type]
        const m = new Map()
        for (let i = 0; T && i < T.pts.length; i += 3) {
          const s = sector(dd.bounds, T.pts[i], T.pts[i + 1])
          if (s) m.set(s, (m.get(s) || 0) + 1)
        }
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      }
      const count = (t) => (P?.types[t]?.pts.length ?? 0) / 3
      // точки для hero: поля меланжу і титан — лише координати, без підписів
      const dots = (t, max) => {
        const T = P?.types[t]
        const out = []
        if (!T) return out
        const step = Math.max(1, Math.floor(T.pts.length / 3 / max))
        for (let i = 0; i < T.pts.length / 3; i += step) out.push([T.pts[i * 3], T.pts[i * 3 + 1]])
        return out
      }
      // «Наші ресурси» — те, що людина бачить (свої й гільдій)
      const mine = new Set((await items.list(req.ctx, { kind: 'place', scope: 'shared' })).map((it) => it.id))
      const rows = await places.many([...mine])
      res.set({ 'cache-control': 'private, max-age=30', vary: 'Cookie' }).json({
        dd: dd && {
          layout: dd.layout,
          layouts: dd.layouts.length,
          since: seen?.seenAt ?? null,
          tiles: lay?.tiles ?? dd.tiles,
          bounds: dd.bounds,
          transformation: dd.transformation,
          counts: {
            titanium: count('titanium'), stravidium: count('stravidium'),
            spice_small: count('spice_field_small'), spice_medium: count('spice_field_medium'), spice_large: count('spice_field_large'),
            shipwreck: count('shipwreck'), ecolab: count('ecolab'), cave: count('cave'),
          },
          top: { titanium: bySector('titanium'), stravidium: bySector('stravidium'), spice_medium: bySector('spice_field_medium'), spice_large: bySector('spice_field_large') },
          dots: {
            spice_large: dots('spice_field_large', 80), spice_medium: dots('spice_field_medium', 140),
            spice_small: dots('spice_field_small', 200), titanium: dots('titanium', 450), stravidium: dots('stravidium', 450),
          },
        },
        places: {
          total: rows.length,
          ok: rows.filter((p) => p.ok).length,
          recent: [...rows].sort((a, b) => b.updated - a.updated).slice(0, 5).map((p) => ({ id: p.id, res: p.res, place: p.place, zone: p.zone, ok: p.ok, updated: p.updated })),
        },
        syncedAt: src.syncedAt,
      })
    } catch (e) { next(e) }
  })
  return r
}

/*
 * Активні поля меланжу (lib/spice.mjs): GET /api/map/spice/:map?layout= — що бачить глядач (поля зі строком і
 * людьми, місця великих полів); POST /api/map/spice { map, layout?, size, x, y, visibility } — позначити активним
 * (або змінити видимість своєї позначки); DELETE /api/map/spice/:id — зняти свою. Зміни розлітаються через SSE
 * (/api/map/spice/stream) подією { type: 'spice', map, layout } — лише тим, хто позначку бачить (до чи після зміни);
 * клієнт сам перечитує поля цієї мапи.
 */
import express from 'express'
import { need, wrap } from './auth.mjs'

export function createSpiceRoutes({ spice, mapData, hub }) {
  const r = express.Router()
  const layoutOf = (v) => (v === undefined || v === null || v === '' ? null : Number(v))
  const tell = (...rows) => {
    const [row] = rows
    hub.emitWhere({ type: 'spice', map: row.map, layout: row.layout ?? null }, (ctx) => rows.some((x) => x && spice.sees(ctx, x))).catch(() => {})
  }

  r.get('/api/map/spice/stream', (req, res) => hub.open(req, res))

  r.get('/api/map/spice/:map', wrap(async (req, res) => {
    const layout = layoutOf(req.query.layout)
    if (!mapData.source?.maps.some((m) => m.id === req.params.map) || (layout != null && !Number.isInteger(layout))) return res.status(404).json({ error: req.t('немає такої мапи або розкладки') })
    res.set('cache-control', 'no-store').json(await spice.view(req.ctx, req.params.map, layout))
  }))

  r.post('/api/map/spice', need(), wrap(async (req, res) => {
    const b = req.body || {}
    // мапа, межі й розкладка — як у позначок (у мапи без розкладок її не буде)
    const p = mapData.cleanPoint({ map: b.map, x: b.x, y: b.y, layout: b.layout })
    // у Глибокій пустелі поле — лише своєї розкладки
    if (p.layout == null && mapData.source.maps.find((m) => m.id === p.map)?.layouts?.length) return res.status(400).json({ error: req.t('хибна точка на мапі') })
    const { row, before } = await spice.mark(req.ctx, { ...p, layout: p.layout ?? null, size: b.size, visibility: b.visibility })
    tell(row, before)
    res.json(await spice.view(req.ctx, row.map, row.layout ?? null))
  }))

  r.delete('/api/map/spice/:id', need(), wrap(async (req, res) => {
    const row = await spice.unmark(req.ctx, req.params.id)
    if (!row) return res.status(404).json({ error: req.t('немає такої позначки') })
    tell(row)
    res.json(await spice.view(req.ctx, row.map, row.layout ?? null))
  }))

  return r
}

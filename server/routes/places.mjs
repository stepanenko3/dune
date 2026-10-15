/*
 * Записи «Ресурсів»: де брати унікальні ресурси. Спільні для всіх, хто відкриває сайт.
 * Зміни розлітаються по відкритих вкладках через SSE (/api/places/stream).
 *
 * Запис: res, place, area, zone ('hagga' | 'dd' | 'city'), how, ok (перевірено в грі),
 *   pins  — точки на мапі [{ map, x, y, layout? }]; layout лише для Deep Desert: її розкладка
 *           змінюється щотижня, тож точка показується тільки на своїй розкладці;
 *   types — типи точок мапи, що підходять завжди [{ map, type }] (усі печери, усі уламки…);
 *   loot  — назва предмета з гри: мапа підсвітить контейнери, у луті яких він є.
 */
import express from 'express'

const LIM = { res: 160, place: 160, area: 200, zone: 16, how: 2000, loot: 120 }
const ZONES = new Set(['hagga', 'dd', 'city'])

function clean(body, partial, maps) {
  const out = {}
  const err = (m) => { const e = new Error(m); e.status = 400; throw e }
  for (const [k, max] of Object.entries(LIM)) {
    if (!(k in body)) { if (!partial && (k === 'res' || k === 'place')) err(`потрібне поле ${k}`); continue }
    const v = String(body[k] ?? '').trim()
    if (v.length > max) err(`${k}: задовге`)
    out[k] = v
  }
  if (out.zone !== undefined && !ZONES.has(out.zone)) out.zone = 'hagga'
  if (!partial && (!out.res || !out.place)) err('потрібні ресурс і місце')
  if ('ok' in body) out.ok = !!body.ok
  if ('pins' in body) {
    if (!Array.isArray(body.pins) || body.pins.length > 60) err('pins: список до 60 точок')
    out.pins = body.pins.map((p) => {
      if (!maps.has(p?.map) || !Number.isFinite(+p.x) || !Number.isFinite(+p.y)) err('pins: хибна точка')
      const pin = { map: p.map, x: Math.round(+p.x), y: Math.round(+p.y) }
      if (Number.isInteger(p.layout)) pin.layout = p.layout
      if (p.label) pin.label = String(p.label).slice(0, 120)
      return pin
    })
  }
  if ('types' in body) {
    if (!Array.isArray(body.types) || body.types.length > 20) err('types: список до 20')
    out.types = body.types.map((t) => {
      if (!maps.has(t?.map) || typeof t.type !== 'string' || !/^[a-z0-9_]{1,64}$/.test(t.type)) err('types: хибний тип')
      return { map: t.map, type: t.type }
    })
  }
  return out
}

export function createPlacesRoutes({ places, mapData }) {
  const r = express.Router()
  const clients = new Set()
  const maps = () => new Set(mapData.source.maps.map((m) => m.id))
  const emit = (ev) => { const s = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) c.write(s) }
  const wrap = (fn) => (req, res, next) => { try { fn(req, res) } catch (e) { next(e) } }

  r.get('/api/places', (req, res) => res.json({ rows: places.list() }))

  r.get('/api/places/stream', (req, res) => {
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
    res.flushHeaders()
    res.write(': ok\n\n')
    clients.add(res)
    const ping = setInterval(() => res.write(': ping\n\n'), 25000)
    req.on('close', () => { clearInterval(ping); clients.delete(res) })
  })

  r.post('/api/places', wrap((req, res) => {
    const doc = clean(req.body || {}, false, maps())
    const row = places.add({ ok: false, zone: 'hagga', area: '', how: '', pins: [], types: [], loot: '', ...doc })
    emit({ op: 'put', row })
    res.status(201).json(row)
  }))

  r.patch('/api/places/:id', wrap((req, res) => {
    const row = places.patch(req.params.id, clean(req.body || {}, true, maps()))
    if (!row) return res.status(404).json({ error: 'немає такого запису' })
    emit({ op: 'put', row })
    res.json(row)
  }))

  r.delete('/api/places/:id', wrap((req, res) => {
    if (!places.remove(req.params.id)) return res.status(404).json({ error: 'немає такого запису' })
    emit({ op: 'del', id: req.params.id })
    res.json({ ok: true })
  }))

  return r
}

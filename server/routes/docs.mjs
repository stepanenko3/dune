/*
 * Невеликі документи з власником і видимістю — білди умінь (/api/builds) і позначки на мапі (/api/markers):
 * GET ?scope= — що людина бачить (моє й гільдій; public — публічне), GET /:id, POST { …документ, owner, visibility },
 * PUT /:id { …документ }, DELETE /:id. Живі оновлення (/stream) — лише тим, хто річ бачить.
 */
import express from 'express'
import { can } from '../lib/items.mjs'
import { rightsOf } from '../lib/roadmap-access.mjs'
import { fail } from '../lib/util.mjs'
import { need, wrap } from './auth.mjs'

// label з app.mjs («білду», «позначки») більше не потрібен: повідомлення — цілі фрази за видом речі (їх перекладають)
export function createDocRoutes({ kind, path, store, clean, items, content, hub }) {
  const r = express.Router()
  const load = async (req, right = 'view') => {
    const d = await store.get(req.params.id)
    const it = d && (await items.get(kind, d.id))
    // змінювати — за правами самої речі (вікно «Доступ»); решта — за власником
    const c = it ? { ...can(req.ctx, it), edit: rightsOf(req.ctx, it).edit } : can(req.ctx, it)
    if (!d || !c.view) throw kind === 'build' ? fail('немає такого білду', 404) : kind === 'marker' ? fail('немає такої позначки', 404) : fail('немає такого запису', 404)
    if (!c[right]) throw right === 'edit' ? fail('змінювати це тобі не можна', 403) : fail('це може лише власник (у гільдії — офіцер чи лідер)', 403)
    return { d, it }
  }
  const out = async (d, it, ctx, starred) => ({ ...d, item: await items.view(it, ctx, starred) })

  r.get(`/api/${path}`, wrap(async (req, res) => {
    // усе публічне одним списком не віддаємо (тисячі чужих позначок) — для цього є свої сторінки й /shown
    const scopes = String(req.query.scope || 'shared').split(',').slice(0, 3).filter((s) => s !== 'public')
    const seen = new Map()
    for (const s of scopes) for (const it of await items.list(req.ctx, { kind, scope: s })) seen.set(it.id, it)
    const starred = await items.starredBy(req.user?.id)
    const docs = await store.many([...seen.keys()])
    res.json({ rows: await Promise.all(docs.map((d) => out(d, seen.get(d.id), req.ctx, starred))) })
  }))

  if (hub) r.get(`/api/${path}/stream`, (req, res) => hub.open(req, res))

  r.get(`/api/${path}/:id`, wrap(async (req, res) => {
    const { d, it } = await load(req)
    res.json(await out(d, it, req.ctx, await items.starredBy(req.user?.id)))
  }))

  r.post(`/api/${path}`, need(), wrap(async (req, res) => {
    const { owner, visibility, ...body } = req.body || {}
    const o = await content.ownerFor(req, owner)
    const doc = clean(body)
    const d = await store.get(await content.H[kind].create(doc))
    const it = await items.add(kind, d.id, { owner: o, visibility, by: req.user.id, ...content.H[kind].meta(doc, req.t) })
    // подія — одразу з рядком (без прав: вони в кожного свої), щоб вкладки не дочитували його окремим запитом
    hub?.emit({ op: 'put', kind, id: d.id, row: await out(d, it, null) }, it)
    res.status(201).json(await out(d, it, req.ctx))
  }))

  r.put(`/api/${path}/:id`, need(), wrap(async (req, res) => {
    const { d: cur, it } = await load(req, 'edit')
    // base — «updated», з яким клієнт відкрив запис: хтось змінив його тим часом — 409 і свіжий стан
    const { owner, visibility, item, id, created, updated, base, ...body } = req.body || {}
    const { created: _c, updated: _u, item: _i, ...curDoc } = cur
    const doc = clean({ ...curDoc, ...body })
    const d = await store.put(cur.id, doc, Number.isFinite(base) ? base : null)
    if (!d) throw fail('немає такого запису', 404)
    if (d.conflict) return res.status(409).json({ error: req.t('цей запис щойно змінили — ось його нова версія'), row: await out(d, it, req.ctx) })
    const now = (await items.touch(kind, d.id, content.H[kind].meta(doc, req.t))) || it
    hub?.emit({ op: 'put', kind, id: d.id, row: await out(d, now, null) }, now)
    res.json(await out(d, now, req.ctx))
  }))

  r.delete(`/api/${path}/:id`, need(), wrap(async (req, res) => {
    const { d, it } = await load(req, 'manage')
    await content.purge(kind, d.id)
    hub?.emit({ op: 'del', kind, id: d.id }, it)
    res.json({ ok: true })
  }))

  return r
}

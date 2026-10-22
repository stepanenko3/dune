/*
 * Реєстр речей для клієнта: списки «моє / гільдія / усе моє», одна річ із правами, зміна власника й видимості
 * («Доступ»), зірки, копія собі; бібліотека — публічні бази, білди, роадмапи й розрахунки.
 * Після зміни доступу вид отримує подію { op: 'access', kind, id } у свій живий потік (hubs[kind]) — і ті, хто бачив
 * річ раніше, і ті, хто бачить тепер, перечитують її.
 */
import express from 'express'
import { can, KINDS, LIBRARY_KINDS } from '../lib/items.mjs'
import { effectiveAccess, levelsFor, normAccess, patchAccess, rightsFor, rightsOf } from '../lib/roadmap-access.mjs'
import { fail } from '../lib/util.mjs'
import { need, wrap } from './auth.mjs'

export function createItemRoutes({ items, content, hubs, auth, roadmapService, progress, revisions }) {
  const r = express.Router()
  const kindOf = (k) => { if (!KINDS.includes(k)) throw fail('невідомий вид', 404); return k }
  /** річ, яку контекст бачить (інакше 404 — не видаємо, що вона є) */
  const visible = async (req) => {
    const kind = kindOf(req.params.kind)
    const it = await items.get(kind, req.params.id)
    if (!it || !can(req.ctx, it).view) throw fail('немає такої речі', 404)
    return it
  }

  r.get('/api/items', wrap(async (req, res) => {
    const kind = req.query.kind ? kindOf(String(req.query.kind)) : undefined
    const scope = String(req.query.scope || 'shared')
    const starred = await items.starredBy(req.user?.id)
    res.json({ rows: await items.views(await items.list(req.ctx, { kind, scope }), req.ctx, starred) })
  }))

  /** права речі для клієнта: що людина може, і (тим, хто керує) — збережені права й які рівні є (вікно «Доступ») */
  const rightsView = (req, it) => {
    const rt = rightsOf(req.ctx, it)
    const { scope, mode, whose, ...rights } = rt
    return {
      rights,
      ...(rt.settings || rt.manage ? { access: normAccess(it.access, it.owner_kind, it.kind), keys: rightsFor(it.kind), levels: Object.fromEntries(rightsFor(it.kind).map((k) => [k, levelsFor(k, it.owner_kind, it.visibility)])) } : {}),
    }
  }

  r.get('/api/items/:kind/:id', wrap(async (req, res) => {
    const it = await visible(req)
    res.json({ item: await items.view(it, req.ctx, await items.starredBy(req.user?.id)), ...rightsView(req, it) })
  }))

  /** змінити права речі (частину): хто міняє права — за ними ж; «хто міняє права» — лише власник (у гільдії — лідер) */
  r.patch('/api/items/:kind/:id/rights', need(), wrap(async (req, res) => {
    const it = await visible(req)
    const rt = rightsOf(req.ctx, it)
    if (!rt.settings) throw fail('міняти права цього тобі не можна', 403)
    const body = req.body || {}
    if ('settings' in body && body.settings !== effectiveAccess(it.access, it.owner_kind, it.visibility, it.kind).settings && !rt.settingsLevel) throw fail('хто міняє права, вирішує власник (у гільдії — лідер)', 403)
    const cur = normAccess(it.access, it.owner_kind, it.kind)
    const next = patchAccess(cur, body, it.owner_kind, it.visibility, it.kind)
    await items.setRights(it.kind, it.id, next)
    await revisions?.record(`items`, JSON.stringify([it.kind, it.id]), 'access-settings', { title: it.title, access: cur }, { title: it.title, access: next }, req.user.id)
    const now = await items.get(it.kind, it.id)
    // хто бачить річ, перечитає її (права могли змінитись)
    hubs[it.kind]?.emit({ op: 'access', kind: it.kind, id: it.id }, now)
    res.json({ item: await items.view(now, req.ctx), ...rightsView(req, now) })
  }))

  r.patch('/api/items/:kind/:id/access', need(), wrap(async (req, res) => {
    const before = await visible(req)
    if (!can(req.ctx, before).manage) throw fail('міняти доступ може власник (у гільдії — офіцер чи лідер)', 403)
    const owner = req.body?.owner ? await content.ownerFor(req, req.body.owner) : { kind: before.owner_kind, id: before.owner_id }
    // інший власник — незворотно: у гільдії це вирішує лідер, не офіцер
    if ((owner.kind !== before.owner_kind || owner.id !== before.owner_id) && !can(req.ctx, before).own) throw fail('віддати гільдійську річ іншому власнику може лише лідер гільдії', 403)
    const after = await items.setAccess(before.kind, before.id, owner, req.body?.visibility ?? before.visibility)
    hubs[before.kind]?.emit({ op: 'access', kind: before.kind, id: before.id }, before, after)
    res.json({ item: await items.view(after, req.ctx) })
  }))

  r.post('/api/items/:kind/:id/star', need(), wrap(async (req, res) => {
    const it = await visible(req)
    if (!LIBRARY_KINDS.includes(it.kind)) throw fail('зірки — лише для баз, білдів, роадмапів і розрахунків')
    res.json(await items.star(it.kind, it.id, req.user.id, req.body?.on !== false))
  }))

  r.post('/api/items/:kind/:id/copy', need(), wrap(async (req, res) => {
    const it = await visible(req)
    const owner = await content.ownerFor(req, req.body?.owner)
    // хто й куди може копіювати — за правами речі; роадмап: позначки, які людина бачить, — у копію, якщо просить
    const rt = rightsOf(req.ctx, it)
    if (!rt.copy) throw fail('копіювати це власник не дозволив', 403)
    if (owner.kind === 'guild' && !rt.copyTo.includes('guild')) throw fail('це можна скопіювати лише в особисте', 403)
    if (owner.kind === 'user' && !rt.copyTo.includes('user')) throw fail('це можна скопіювати лише в гільдію', 403)
    let state = null
    if (it.kind === 'roadmap' && req.body?.progress && rt.scope) state = await progress.state(it.id, rt.scope)
    const out = await content.copy(it.kind, it.id, owner, req.user.id, req.t)
    if (state) await roadmapService.copied(out, state)
    hubs[it.kind]?.emit({ op: 'access', kind: it.kind, id: out.id }, out)
    res.status(201).json({ item: await items.view(out, req.ctx) })
  }))

  r.get('/api/library', wrap(async (req, res) => {
    const kind = req.query.kind ? String(req.query.kind) : undefined
    if (kind && !LIBRARY_KINDS.includes(kind)) throw fail('у бібліотеці — бази, білди, роадмапи й розрахунки')
    const { rows, total } = await items.library({ kind, q: String(req.query.q || ''), sort: String(req.query.sort || 'new'), offset: Math.max(0, Number(req.query.offset) || 0) })
    const starred = await items.starredBy(req.user?.id)
    res.json({ rows: await items.views(rows, req.ctx, starred), total })
  }))

  return r
}

/*
 * Роадмапи — їх багато, у кожного власник і видимість (реєстр речей) і свої права (lib/roadmap-access). GET
 * /api/roadmaps?scope= — список; POST { title, owner, visibility } — новий; GET /api/roadmaps/:id — документ із
 * версією, правами й прогресом, який людині показано; PUT { doc, version } — зберегти (409, якщо версія застаріла);
 * DELETE — стерти; історія й відновлення; прогрес — POST …/progress (одна позначка), …/progress/import (давні з
 * браузера), DELETE …/progress (скинути), …/progress/restore («Повернути»), GET …/progress/members (прогрес учасників
 * чи журнал); PATCH …/access-settings — права. Зміни розлітаються через SSE (/api/roadmaps/stream) — лише тим, хто
 * роадмап бачить; позначки — лише тим, кому показано той самий запис прогресу.
 * Усі права перевіряє сервер: інтерфейс лише ховає недоступне.
 */
import express from 'express'
import { can } from '../lib/items.mjs'
import { effectiveAccess, levelsFor, modesFor, normAccess, ownerScope, patchAccess, RIGHTS, rightsOf } from '../lib/roadmap-access.mjs'
import { KINDS } from '../lib/roadmap-progress.mjs'
import { blankRoadmap, localSummary, roadmapSummary } from '../lib/roadmap.mjs'
import { fail, plain } from '../lib/util.mjs'
import { createLimiter } from '../lib/auth.mjs'
import { need, wrap } from './auth.mjs'

export function createRoadmapRoutes({ roadmaps, items, content, hub, progress, service, guilds, revisions }) {
  const r = express.Router()
  /** роадмап, який контекст бачить (інакше 404 — не видаємо, що він є), його права й налаштування */
  const load = async (req) => {
    const d = await roadmaps.get(String(req.params.id))
    const it = d && (await items.get('roadmap', d.id))
    if (!d || !can(req.ctx, it).view) throw fail('немає такого роадмапу', 404)
    const access = await roadmaps.access(d.id)
    return { d, it, access, rt: rightsOf(req.ctx, it, access) }
  }
  const touch = async (d, req, it, access) => items.touch('roadmap', d.id, { ...content.H.roadmap.meta(d.doc, req.t), summary: roadmapSummary(d.doc, await service.ownerState(it, access)) })
  const put = (out) => ({ op: 'put', id: out.id, doc: out.doc, version: out.version, updated: out.updated })
  /** роадмап для клієнта: реєстр (can.edit — за правами роадмапу), права, налаштування (тим, хто їх міняє) і прогрес */
  async function envelope(req, d, it, access, rt) {
    const view = await items.view(it, req.ctx, await items.starredBy(req.user?.id))
    view.can = { ...view.can, edit: rt.edit }
    const a = effectiveAccess(access, it.owner_kind, it.visibility)
    // збережені права (вікно «Доступ» саме рахує, що з них діятиме за вибраної видимості — src/lib/roadmapLevels.ts)
    const stored = normAccess(access, it.owner_kind)
    const state = await progress.state(d.id, rt.scope)
    let people = 0
    if (rt.mode === 'each') people = (await progress.people(d.id)).length
    else if (rt.scope) people = await progress.markers(d.id, rt.scope)
    const { scope, mode, whose, ...rights } = rt
    return {
      ...d,
      item: view,
      rights,
      progress: { mode, scope, whose, state, people, mark: a.mark, seeProgress: a.seeProgress },
      // права, що діють, які рівні та режими є для цього власника й видимості і типові (основа готових наборів) — тим, хто може їх міняти
      ...(rt.settings || rt.manage ? { access: stored, levels: Object.fromEntries(RIGHTS.map((k) => [k, levelsFor(k, it.owner_kind, it.visibility)])), modes: modesFor(it.visibility), defaults: effectiveAccess(null, it.owner_kind, it.visibility) } : {}),
    }
  }
  /** чи є такий етап / задача / картка «зібрано» в документі (сміття в прогрес не пишемо) */
  const exists = (doc, kind, id) =>
    kind === 's' ? doc.stages.some((s) => s.id === id)
      : kind === 't' ? doc.stages.some((s) => s.tasks.some((t) => t.id === id))
        : doc.sections.some((s) => s.collect && s.columns.some((c) => c.id === id))
  /** позначку — тим вкладкам, кому показано той самий запис */
  const emitMark = (it, access, scope, ev) => hub.emitWhere({ op: 'progress', id: it.id, scope, ...ev }, (ctx) => rightsOf(ctx, it, access).scope === scope)
  /** після зміни прогресу власника — опис у реєстрі (списки, пошук) */
  const afterMark = async (req, d, it, access, scope) => { if (scope === ownerScope(it)) await touch(d, req, it, access) }

  r.get('/api/roadmaps', wrap(async (req, res) => {
    const starred = await items.starredBy(req.user?.id)
    res.json({ rows: await items.views(await items.list(req.ctx, { kind: 'roadmap', scope: String(req.query.scope || 'shared') }), req.ctx, starred) })
  }))

  r.get('/api/roadmaps/stream', (req, res) => hub.open(req, res))

  r.post('/api/roadmaps', need(), wrap(async (req, res) => {
    const { title, owner, visibility } = req.body || {}
    const o = await content.ownerFor(req, owner)
    const id = await content.H.roadmap.create(blankRoadmap(plain(title, 120) || req.t('Новий роадмап')))
    const d = await roadmaps.get(id)
    const it = await items.add('roadmap', id, { owner: o, visibility, by: req.user.id, ...content.H.roadmap.meta(d.doc, req.t) })
    hub.emit({ op: 'access', kind: 'roadmap', id }, it)
    res.status(201).json(await envelope(req, d, it, null, rightsOf(req.ctx, it, null)))
  }))

  r.get('/api/roadmaps/:id', wrap(async (req, res) => {
    const { d, it, access, rt } = await load(req)
    res.json(await envelope(req, d, it, access, rt))
  }))

  r.put('/api/roadmaps/:id', need(), wrap(async (req, res) => {
    const { it, access, rt } = await load(req)
    if (!rt.edit) throw fail('змінювати цей роадмап тобі не можна', 403)
    const { doc, version } = req.body || {}
    if (!Number.isInteger(version)) throw fail('не вистачає версії, від якої ти редагував — онови сторінку й спробуй ще раз')
    const out = await roadmaps.put(String(req.params.id), doc, version)
    if (!out) throw fail('немає такого роадмапу', 404)
    if (out.conflict) return res.status(409).json({ error: req.t('хтось уже змінив роадмап'), doc: out.doc, version: out.version, updated: out.updated })
    const now = (await touch(out, req, it, access)) || it
    hub.emit(put(out), now)
    const view = await items.view(now, req.ctx)
    res.json({ ...out, item: { ...view, can: { ...view.can, edit: rt.edit } } })
  }))

  r.delete('/api/roadmaps/:id', need(), wrap(async (req, res) => {
    const { d, it, rt } = await load(req)
    if (!rt.manage) throw fail('це може лише власник (у гільдії — офіцер чи лідер)', 403)
    await content.purge('roadmap', d.id)
    hub.emit({ op: 'del', kind: 'roadmap', id: d.id }, it)
    res.json({ ok: true })
  }))

  r.get('/api/roadmaps/:id/history', wrap(async (req, res) => {
    const { d, rt } = await load(req)
    if (!rt.history) throw fail('історію цього роадмапу тобі не відкрито', 403)
    res.json({ rows: (await roadmaps.history(d.id)).map((h) => ({ ...h, summary: localSummary(h.summary, req.t, req.lang) })) })
  }))

  r.post('/api/roadmaps/:id/history/:hid/restore', need(), wrap(async (req, res) => {
    const { d, it, access, rt } = await load(req)
    if (!rt.edit) throw fail('змінювати цей роадмап тобі не можна', 403)
    // давню версію відновлює той, хто й бачить історію
    if (!rt.history) throw fail('історію цього роадмапу тобі не відкрито', 403)
    const out = await roadmaps.restore(d.id, Number(req.params.hid))
    if (!out) throw fail('немає такої версії', 404)
    const now = (await touch(out, req, it, access)) || it
    hub.emit(put(out), now)
    const view = await items.view(now, req.ctx)
    res.json({ ...out, item: { ...view, can: { ...view.can, edit: rt.edit } } })
  }))

  // ---------- прогрес ----------
  // відмічати можна часто, але не без кінця (спільний «на всіх» — від залпу з одного облікового запису)
  const marks = createLimiter({ max: 600, ms: 60_000 })
  const canMark = (req, rt) => {
    if (!marks.hit(req.user.id)) throw fail('забагато позначок поспіль — зачекай хвилинку', 429)
    if (!rt.scope) throw fail('прогрес цього роадмапу тобі не показано', 403)
    if (!rt.mark) throw fail('відмічати прогрес цього роадмапу тобі не можна', 403)
  }

  r.post('/api/roadmaps/:id/progress', need(), wrap(async (req, res) => {
    const { d, it, access, rt } = await load(req)
    canMark(req, rt)
    const { kind, id, value } = req.body || {}
    if (!KINDS.includes(kind)) throw fail('невідомий вид позначки')
    if (!exists(d.doc, kind, String(id ?? ''))) throw fail('у роадмапі нема такого етапу, задачі чи картки', 404)
    // запис — той, що діє для людини (з клієнта scope не приймаємо)
    await progress.mark(d.id, rt.scope, kind, String(id), value, req.user.id, service.logged(req.ctx, it, rt.scope))
    await afterMark(req, d, it, access, rt.scope)
    emitMark(it, access, rt.scope, { kind, item: String(id), value })
    res.json({ state: await progress.state(d.id, rt.scope) })
  }))

  // давні позначки «зібрано» з браузера (до перенесення прогресу в базу) — раз, лише у свій особистий запис
  r.post('/api/roadmaps/:id/progress/import', need(), wrap(async (req, res) => {
    const { d, rt } = await load(req)
    canMark(req, rt)
    if (rt.scope !== `u:${req.user.id}`) throw fail('давні позначки переносяться лише у твій особистий прогрес', 403)
    const n = await progress.merge(d.id, rt.scope, req.body || {}, req.user.id)
    res.json({ state: await progress.state(d.id, rt.scope), imported: n })
  }))

  /** скинути свій чи спільний: свій — сам; спільний — хто міняє права (спільний «на всіх» — ще й модератор) */
  const resetRight = (req, it, rt, which) => {
    if (!rt.scope) throw fail('прогрес цього роадмапу тобі не показано', 403)
    const mine = rt.scope === `u:${req.user.id}`
    if (which === 'mine') { if (!mine) throw fail('тут прогрес не твій особистий — скинути можна лише спільний'); return }
    if (mine) throw fail('це твій особистий прогрес')
    if (!(rt.settings || (rt.scope === 'all' && req.ctx.moderate))) throw fail('скинути спільний прогрес можуть ті, хто міняє права роадмапу', 403)
  }

  r.delete('/api/roadmaps/:id/progress', need(), wrap(async (req, res) => {
    const { d, it, access, rt } = await load(req)
    const which = req.query.which === 'shared' ? 'shared' : 'mine'
    resetRight(req, it, rt, which)
    const before = await progress.reset(d.id, rt.scope)
    if (which === 'shared') await revisions?.record('roadmaps', d.id, 'progress-reset', { title: it.title, scope: rt.scope, state: before }, null, req.user.id)
    await afterMark(req, d, it, access, rt.scope)
    emitMark(it, access, rt.scope, { reset: true })
    res.json({ state: await progress.state(d.id, rt.scope), before })
  }))

  r.post('/api/roadmaps/:id/progress/restore', need(), wrap(async (req, res) => {
    const { d, it, access, rt } = await load(req)
    resetRight(req, it, rt, req.body?.which === 'shared' ? 'shared' : 'mine')
    await progress.merge(d.id, rt.scope, req.body?.state || {}, req.user.id)
    await afterMark(req, d, it, access, rt.scope)
    emitMark(it, access, rt.scope, { reset: true })
    res.json({ state: await progress.state(d.id, rt.scope) })
  }))

  /**
   * Прогрес учасників: у «кожен свій» — свої роадмапу (учасники гільдії-власника, власник) з їхніми позначками й скільки
   * ще людей веде прогрес; у спільному — журнал «хто відмічав». Чужий прогрес сторонніх — нікому.
   */
  r.get('/api/roadmaps/:id/progress/members', need(), wrap(async (req, res) => {
    const { d, it, rt } = await load(req)
    if (!rt.members) throw fail('прогрес учасників цього роадмапу тобі не відкрито', 403)
    if (rt.mode === 'each') {
      const people = it.owner_kind === 'guild' ? await guilds.members(it.owner_id) : []
      if (it.owner_kind === 'user') { const o = await items.owner('user', it.owner_id, req.t); people.push({ id: o.id, login: o.login, name: o.name, color: o.color }) }
      const states = await progress.states(d.id, people.map((p) => `u:${p.id}`))
      const inside = new Set(people.map((p) => `u:${p.id}`))
      const others = (await progress.people(d.id)).filter((p) => !inside.has(p.scope)).length
      return res.json({ mode: 'each', people: people.map((p) => ({ id: p.id, login: p.login, name: p.name, color: p.color, role: p.role ?? null, state: states.get(`u:${p.id}`) })), others })
    }
    if (!rt.scope) throw fail('прогрес цього роадмапу тобі не показано', 403)
    const log = await progress.log(d.id, rt.scope)
    res.json({ mode: rt.mode, log: log.map((l) => ({ at: l.at, kind: l.kind, item: l.item, value: l.value || null, by: l.actor ? { id: l.actor, name: l.name, login: l.login, color: l.color } : null })) })
  }))

  // ---------- права ----------
  r.patch('/api/roadmaps/:id/access-settings', need(), wrap(async (req, res) => {
    const { d, it, access, rt } = await load(req)
    if (!rt.settings) throw fail('міняти права цього роадмапу тобі не можна', 403)
    // зміни лягають на збережене (а не на те, що діє за поточної видимості): решта збереженого не губиться
    const cur = normAccess(access, it.owner_kind)
    const body = req.body || {}
    if ('settings' in body && body.settings !== effectiveAccess(access, it.owner_kind, it.visibility).settings && !rt.settingsLevel) throw fail('хто міняє права, вирішує власник (у гільдії — лідер)', 403)
    const next = patchAccess(cur, body, it.owner_kind, it.visibility)
    await roadmaps.setAccess(d.id, next)
    await revisions?.record('roadmaps', d.id, 'access-settings', { title: it.title, access: cur }, { title: it.title, access: next }, req.user.id)
    const now = (await touch(d, req, it, next)) || it
    hub.emit({ op: 'access', kind: 'roadmap', id: d.id }, now)
    res.json(await envelope(req, d, now, next, rightsOf(req.ctx, now, next)))
  }))

  return r
}

/** Указ тижня: GET — той, що діє для людини (основної гільдії чи особистий); PUT { id, until } — вибрати чи зняти. */
/**
 * Указ Ландсрааду (lib/decree.mjs): GET /api/decree — указ сайту з домом-переможцем, чи можна мені його міняти, мій дім
 * (me: { own, guild, house } — свій, гільдії, який діє; анонім — null); PUT /api/decree { id, until, house } — вибрати
 * (дозвіл site.decree); PUT /api/me/house { house } — свій дім (порожньо — як у гільдії).
 */
export function createDecreeRoutes({ decrees, roles }) {
  const r = express.Router()
  const view = async (req, d) => ({ ...d, canSet: !!req.user && (await roles.can(req.user, 'site.decree')), me: await decrees.houseOf(req.user?.id) })
  r.get('/api/decree', wrap(async (req, res) => res.set('cache-control', 'no-store').json(await view(req, await decrees.current()))))
  // указ сайту виставляє адміністрація (дозвіл site.decree; адміністратор має всі) — разом із домом, що виграв
  r.put('/api/decree', need(), wrap(async (req, res) => {
    if (!(await roles.can(req.user, 'site.decree'))) throw fail('указ виставляє адміністрація сайту', 403)
    const { id = null, until = null, house = null } = req.body || {}
    res.json(await view(req, await decrees.set(req.user, id, until, house)))
  }))
  r.put('/api/me/house', need(), wrap(async (req, res) => {
    await decrees.setHouse(req.user.id, req.body?.house ?? null)
    res.json(await view(req, await decrees.current()))
  }))
  return r
}

/** Нагадування про бурю (Web Push): ключ, підписка з регіоном і «за скільки годин», відписка, пробне. */
export function createPushRoutes({ push }) {
  const r = express.Router()
  r.get('/api/push/key', (req, res) => res.json({ key: push.publicKey }))
  // нагадування про бурю — лише після входу (підписка — людини); і не без кінця з однієї адреси
  const perIp = createLimiter({ max: 20, ms: 60 * 60_000 })
  const limited = (req) => { if (!perIp.hit(req.ip)) throw fail('забагато спроб — спробуй трохи згодом', 429) }
  r.post('/api/push/subscribe', need(), wrap(async (req, res) => {
    limited(req)
    const { sub, region, lead } = req.body || {}
    await push.subscribe(sub, region, lead, req.lang, req.user.id)
    res.json({ ok: true })
  }))
  // відписатись — і без входу (вийшов з облікового запису, а сповіщення в браузері ще є)
  r.post('/api/push/unsubscribe', wrap(async (req, res) => { await push.unsubscribe(req.body?.endpoint); res.json({ ok: true }) }))
  r.post('/api/push/test', need(), wrap(async (req, res) => { limited(req); res.json({ ok: await push.test(req.body?.endpoint, req.lang, req.user.id) }) }))
  return r
}

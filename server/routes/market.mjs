/*
 * Біржа (/api/market): стрічка оголошень (те, що людина бачить: публічне, своє, своїх гільдій) з фільтрами, оголошення
 * (створити, змінити, закрити, продовжити, стерти — власник і видимість у реєстрі, змінювати — за правами речі),
 * сторінка предмета (книга заявок, медіана, історія угод), угоди («запропонувати» → «прийнято» → «завершено», листування,
 * оцінки), репутація людини, скарги й черга модератора, заборони. Живі оновлення стрічки — /stream (лише тим, хто
 * оголошення бачить).
 *
 * Сторони угоди: той, хто запропонував (maker), і сторона оголошення — до прийняття всі, хто може змінювати оголошення
 * (автор; у гільдійського — учасники з правом edit), після — та людина, що прийняла (taker). Зміни угод і залишку —
 * по черзі в межах оголошення (withLock): дві одночасні «Прийняти» не пообіцяють більше, ніж лишилось.
 */
import express from 'express'
import { can } from '../lib/items.mjs'
import { rightsOf } from '../lib/roadmap-access.mjs'
import { cleanBarter, cleanListing, goodsOf, PAYS, REASONS, REGIONS, RMT_AUTOHIDE, rmtHit, SECTIONS, SIDES, TTL_DAYS } from '../lib/market.mjs'
import { fail, plain, withLock } from '../lib/util.mjs'
import { need, wrap } from './auth.mjs'

const BAN_DAYS = [1, 7, 30, 0]
const DAY = 86400_000

export function createMarketRoutes({ market, items, content, hub, mapData, db, game, notifications, access, auth }) {
  const r = express.Router()
  const lock = (id, fn) => withLock(`listing:${id}`, fn)
  const goods = async () => goodsOf(await game.catalog('en'))
  const notify = (uid, kind, data, opts) => notifications?.notify(uid, kind, data, opts).catch(() => {})
  const emit = async (id, op = 'put') => { const it = await items.get('listing', id); if (it) await hub?.emit({ op, kind: 'listing', id }, it) }
  /** хто відповідає за оголошення: людина-власник чи автор гільдійського */
  const authorOf = (it) => (it.owner_kind === 'user' ? it.owner_id : it.created_by)
  const isMod = (req) => !!(req.ctx?.moderate || req.ctx?.superuser || req.user?.role === 'admin')
  const now = () => Date.now()

  /** заборона біржі — лише на записи */
  async function noBan(req) {
    const b = await market.banOf(req.user?.id)
    if (!b) return
    if (b.until == null) throw fail('тобі заборонено торгувати на біржі. Причина: {reason}', 403, { reason: b.reason || '—' })
    throw fail('тобі заборонено торгувати на біржі до {until}. Причина: {reason}', 403, { until: new Date(b.until).toISOString().slice(0, 10), reason: b.reason || '—' })
  }

  /** оголошення, яке людина бачить (інакше 404); right: edit — за правами речі, manage — власник */
  async function load(req, right = 'view', id = req.params.id) {
    const l = await market.get(id)
    const it = l && (await items.get('listing', l.id))
    const c = it ? can(req.ctx, it) : { view: false }
    if (!l || !c.view) throw fail('немає такого оголошення', 404)
    const edit = rightsOf(req.ctx, it).edit
    if (right === 'edit' && !edit) throw fail('змінювати це оголошення тобі не можна', 403)
    if (right === 'manage' && !c.manage) throw fail('це може лише власник (у гільдії — офіцер чи лідер)', 403)
    return { l, it, edit, manage: c.manage }
  }
  const live = (l, t = now()) => l.status === 'open' && l.expires > t

  const people = async (ids) => {
    const list = [...new Set(ids.filter(Boolean))]
    const out = new Map()
    for (let i = 0; i < list.length; i += 500) {
      const part = list.slice(i, i + 500)
      for (const u of await db.all(`SELECT id, login, name, color FROM users WHERE id IN (${part.map(() => '?').join(',')})`, ...part)) out.set(u.id, { id: u.id, login: u.login, name: u.name, color: u.color })
    }
    return out
  }

  /** оголошення для списку: без місця, контакту й примітки; власник (з реєстру) і його репутація */
  const light = (l) => ({ id: l.id, side: l.side, gid: l.gid, qty: l.qty, left: l.left, minQty: l.minQty, pay: l.pay, price: l.price, barter: l.barter, negotiable: l.negotiable, region: l.region, world: l.world, server: l.server, status: l.status, expires: l.expires, fresh: l.fresh, created: l.created, updated: l.updated })
  async function rowsView(req, regs, listings) {
    const views = await items.views(regs, req.ctx)
    const reps = await market.reputation(regs.map(authorOf))
    return regs.map((it, i) => ({ ...light(listings[i]), item: views[i], rep: reps.get(authorOf(it)) || null }))
  }
  async function listView(req, q) {
    const { rows, total } = await market.list(q)
    const seen = rows.filter((it) => can(req.ctx, it).view)
    return { rows: await rowsView(req, seen, seen.map(market.fromList)), total }
  }
  const scopeArgs = (req) => ({ uid: req.user?.id || null, gids: [...(req.ctx?.ranks?.keys() || [])] })

  /** зустрічні, які людина бачить (не свої й не своєї гільдії, не сховані) */
  async function visibleCounters(req, l, it) {
    const cands = await market.counterOf(l)
    if (!cands.length) return []
    const regs = (await Promise.all(cands.map((c) => items.get('listing', c.id)))).map((x, i) => [x, cands[i]])
      .filter(([x]) => x && !x.hidden && can(req.ctx, x).view && !(x.owner_kind === it.owner_kind && x.owner_id === it.owner_id))
    return rowsView(req, regs.map(([x]) => x), regs.map(([, c]) => c))
  }

  /**
   * Збіг: авторам зустрічних, які бачать нове оголошення, — «Зустрічна заявка» (раз на пару); автору нового — одне
   * сповіщення, якщо з'явились нові пари.
   */
  async function runMatch(l, it) {
    if (it.hidden || !live(l)) return
    const cands = await market.counterOf(l)
    let fresh = 0
    for (const c of cands) {
      const other = await items.get('listing', c.id)
      if (!other || other.hidden || (other.owner_kind === it.owner_kind && other.owner_id === it.owner_id)) continue
      if (await market.matched(l.id, c.id)) continue
      const who = authorOf(other), me = authorOf(it)
      const ctxOther = who ? await access.byId(who) : null
      const ctxMe = me ? await access.byId(me) : null
      const theySee = ctxOther && can(ctxOther, it).view
      const iSee = ctxMe && can(ctxMe, other).view
      if (!theySee && !iSee) continue
      await market.markMatched(l.id, c.id)
      if (theySee && who !== me) await notify(who, 'market.match', { listing: c.id, other: l.id, gid: l.gid, side: c.side })
      if (iSee) fresh++
    }
    if (fresh && authorOf(it)) await notify(authorOf(it), 'market.match', { listing: l.id, gid: l.gid, side: l.side, n: fresh }, { ref: `match:${l.id}` })
  }

  /** база як місце передачі: автор має її бачити; іншим — назва, а посилання — лише якщо бачать і вони */
  async function placeView(req, l) {
    if (l.place?.kind !== 'base') return l.place
    const b = await items.get('base', l.place.base)
    if (!b) return null
    return { kind: 'base', base: can(req.ctx, b).view ? b.id : null, title: b.title }
  }

  /** оголошення цілком: документ, річ реєстру, права, контакт (нік — лише тим, хто увійшов), збіги (тим, хто веде) і угоди */
  async function full(req, l, it, edit, manage) {
    const uid = req.user?.id || null
    const [view] = await rowsView(req, [it], [l])
    const deals = edit ? await market.dealsOfListing(l.id) : uid ? (await market.dealsOfListing(l.id)).filter((d) => d.maker === uid) : []
    return {
      ...view,
      place: await placeView(req, l), ttl: l.ttl, note: l.note,
      contact: { site: l.contact.site, ...(uid && l.contact.nick ? { nick: l.contact.nick } : {}), hidden: !uid && !!l.contact.nick },
      rights: { edit, manage, offer: !!uid && !edit && live(l) && !it.hidden },
      matches: edit ? await visibleCounters(req, l, it) : [],
      deals: await dealsView(req, deals),
      myOffer: uid && !edit ? (await market.activeOffer(l.id, uid))?.id ?? null : null,
    }
  }

  // ---------- угоди: хто я в угоді ----------
  /** роль людини в угоді: maker | taker | owner (веде оголошення, поки пропозиція чекає) | mod | null */
  async function roleIn(req, d) {
    const uid = req.user?.id
    if (!uid) return null
    if (d.maker === uid) return 'maker'
    if (d.taker === uid) return 'taker'
    const it = await items.get('listing', d.listingId)
    if (it && !d.taker && rightsOf(req.ctx, it).edit && can(req.ctx, it).view) return 'owner'
    if (isMod(req) && (await market.hasReports([['deal', d.id], ['listing', d.listingId], ['user', d.maker], ['user', d.taker]]))) return 'mod'
    return null
  }
  async function loadDeal(req) {
    const d = await market.getDeal(req.params.did)
    const role = d && (await roleIn(req, d))
    if (!d || !role) throw fail('немає такої угоди', 404)
    return { d, role }
  }
  async function dealsView(req, deals) {
    const ps = await people(deals.flatMap((d) => [d.maker, d.taker]))
    const reps = await market.reputation(deals.flatMap((d) => [d.maker, d.taker]))
    return Promise.all(deals.map(async (d) => {
      const { pub, by, ...rest } = d
      return { ...rest, maker: ps.get(d.maker) || null, taker: d.taker ? ps.get(d.taker) || null : null, owner: await items.owner(d.owner.kind, d.owner.id, req.t), reps: { maker: reps.get(d.maker) || null, taker: d.taker ? reps.get(d.taker) || null : null } }
    }))
  }
  /** інша сторона (хто має дізнатись): для maker — taker чи автор оголошення; для решти — maker */
  async function otherSide(d, role) {
    if (role !== 'maker') return [d.maker]
    if (d.taker) return [d.taker]
    const it = await items.get('listing', d.listingId)
    return it ? [authorOf(it)].filter(Boolean) : []
  }
  async function dealFull(req, d, role) {
    const uid = req.user.id
    const [view] = await dealsView(req, [d])
    const msgs = await market.messages(d.id)
    const ps = await people(msgs.map((m) => m.user))
    const party = role === 'maker' || role === 'taker'
    const other = party ? (role === 'maker' ? d.taker : d.maker) : null
    const it = await items.get('listing', d.listingId)
    const l = await market.get(d.listingId)
    return {
      ...view, role,
      listing: l && it && can(req.ctx, it).view ? { id: l.id, status: l.status, left: l.left, expires: l.expires, pay: l.pay, price: l.price, barter: l.barter, minQty: l.minQty } : null,
      messages: msgs.map((m) => ({ ...m, user: m.user ? ps.get(m.user) || null : null })),
      canRate: party && d.status === 'done' && !!other,
      myRating: party ? await market.ratingOf(d.id, uid) : null,
      theirRating: party && other ? await market.ratingOf(d.id, other) : null,
    }
  }

  // ---------- стрічка ----------
  /** назви предметів мовою людини й англійською → id гри (пошук «смола», «resin») */
  async function gidsByText(req, text) {
    const q = String(text || '').trim().toLowerCase()
    if (!q) return null
    const [loc, en, g] = await Promise.all([game.catalog(req.lang), game.catalog('en'), goods()])
    const out = new Set()
    for (const c of [loc, en]) for (const i of c?.items || []) if (g.has(i.id) && ((i.loc || i.name || '').toLowerCase().includes(q) || i.name.toLowerCase().includes(q))) out.add(i.id)
    return [...out]
  }
  r.get('/api/market', wrap(async (req, res) => {
    const q = req.query
    const scope = ['mine', 'guild'].includes(q.scope) ? String(q.scope) : 'all'
    const { uid, gids } = scopeArgs(req)
    const guild = scope === 'guild' ? String(q.guild || gids[0] || '') : null
    res.json(await listView(req, {
      scope, uid, gids, guild, side: String(q.side || ''), gid: String(q.gid || ''), gidsIn: q.gid ? null : await gidsByText(req, q.q),
      cat: String(q.cat || ''), region: String(q.region || ''), world: String(q.world || ''), server: String(q.server || ''),
      min: q.min, max: q.max, fresh: Number(q.fresh) || 0, sort: String(q.sort || 'new'), state: ['closed', 'all'].includes(q.state) ? String(q.state) : 'open',
      limit: Number(q.limit) || 30, offset: Number(q.offset) || 0,
    }))
  }))
  if (hub) r.get('/api/market/stream', (req, res) => hub.open(req, res))

  /** для нового оголошення: останні регіон / світ / сервер / нік, заборона, підказки світів */
  r.get('/api/market/me', wrap(async (req, res) => {
    const uid = req.user?.id || null
    const [defaults, ban, worlds] = await Promise.all([uid ? market.defaultsOf(uid) : null, market.banOf(uid), market.worlds()])
    res.set('cache-control', 'no-store').json({ defaults: defaults || (uid ? { region: '', world: '', server: '', nick: req.user.nick || '' } : null), ban, worlds, moderator: isMod(req) })
  }))

  // ---------- предмет: книга, медіана, історія ----------
  r.get('/api/market/item/:gid', wrap(async (req, res) => {
    const g = (await goods()).get(req.params.gid)
    if (!g) throw fail('цей предмет не продається на біржі', 404)
    const region = String(req.query.region || ''), world = String(req.query.world || '')
    const base = { ...scopeArgs(req), scope: 'all', gid: g.id, region, world, limit: 100 }
    const [buy, sell] = await Promise.all([listView(req, { ...base, side: 'buy', sort: 'dear' }), listView(req, { ...base, side: 'sell', sort: 'cheap' })])
    const priced = (rows) => rows.filter((x) => x.price != null)
    const barter = [...buy.rows, ...sell.rows].filter((x) => x.price == null)
    const publicSell = priced(sell.rows).filter((x) => x.item.visibility === 'public').map((x) => x.price)
    const [stats, history] = await Promise.all([market.stats(g.id, { region, world, publicSell }), market.history(g.id, { region, world })])
    res.json({ gid: g.id, book: { buy: priced(buy.rows), sell: priced(sell.rows), barter }, stats, history })
  }))

  // ---------- угоди (мої) ----------
  r.get('/api/market/deals', need(), wrap(async (req, res) => {
    // оголошення, які людина веде (свої й гільдій, де вона може змінювати): пропозиції на них — теж її
    const { uid, gids } = scopeArgs(req)
    const mine = (await market.list({ scope: 'mine', uid, gids, state: 'all', limit: 100 })).rows.filter((it) => rightsOf(req.ctx, it).edit).map((it) => it.id)
    const state = ['done', 'all'].includes(req.query.state) ? String(req.query.state) : 'active'
    res.json({ rows: await dealsView(req, await market.dealsFor(uid, mine, state)) })
  }))
  r.get('/api/market/deals/:did', need(), wrap(async (req, res) => {
    const { d, role } = await loadDeal(req)
    res.json(await dealFull(req, d, role))
  }))

  /** умови пропозиції з запиту за правилами оголошення: кількість, Solari чи бартер */
  async function terms(l, body) {
    const avail = l.left
    const qty = Number(body.qty)
    if (!Number.isInteger(qty) || qty < 1) throw fail('кількість — ціле число від 1')
    if (qty > avail) throw fail('стільки нема — лишилось {n}', 400, { n: avail })
    if (l.minQty && qty < Math.min(l.minQty, avail)) throw fail('мінімальна партія — {n}', 400, { n: l.minQty })
    const pay = l.pay === 'both' ? (body.pay === 'barter' ? 'barter' : 'solari') : l.pay
    let price = null, barter = []
    if (pay === 'solari') {
      price = body.price == null || body.price === '' ? l.price : Number(body.price)
      if (!Number.isInteger(price) || price < 1 || price > 1e12) throw fail('ціна за штуку — ціле число соларів від 1')
    } else {
      barter = cleanBarter(body.barter ?? l.barter, await goods(), l.gid)
      if (!barter.length) throw fail('для бартеру вкажи хоча б один предмет')
    }
    return { qty, price, barter }
  }
  const messageText = (v) => {
    const text = plain(v, 1000, true)
    const hit = rmtHit(text)
    if (hit) throw fail('схоже на торгівлю за реальні гроші («{word}») — на біржі це заборонено', 400, { word: hit })
    return text
  }

  /** запропонувати угоду на чуже відкрите оголошення (одна активна пропозиція від людини) */
  r.post('/api/market/:id/deals', need(), wrap(async (req, res) => {
    await noBan(req)
    const d = await lock(req.params.id, async () => {
      const { l, it, edit } = await load(req)
      if (edit) throw fail('це твоє оголошення — пропонують інші')
      if (it.hidden) throw fail('оголошення сховане модератором', 409)
      if (!live(l)) throw fail('оголошення вже не діє', 409)
      if (!l.contact.site) throw fail('автор просить писати йому в грі — нік на сторінці оголошення', 409)
      if (await market.activeOffer(l.id, req.user.id)) throw fail('ти вже маєш пропозицію на це оголошення', 409)
      const body = req.body || {}
      const tm = await terms(l, body)
      const text = messageText(body.text)
      const deal = await market.addDeal(l, { maker: req.user.id, owner: { kind: it.owner_kind, id: it.owner_id }, ...tm, pub: it.visibility === 'public' && !it.hidden })
      if (text) await market.addMessage(deal.id, req.user.id, text)
      if (authorOf(it)) await notify(authorOf(it), 'market.offer', { deal: deal.id, listing: l.id, gid: l.gid })
      return deal
    })
    await emit(req.params.id)
    res.status(201).json(await dealFull(req, d, 'maker'))
  }))

  /** змінити свою пропозицію, поки її не прийняли */
  r.patch('/api/market/deals/:did', need(), wrap(async (req, res) => {
    await noBan(req)
    const { d, role } = await loadDeal(req)
    if (role !== 'maker') throw fail('змінювати пропозицію може лише той, хто її зробив', 403)
    const out = await lock(d.listingId, async () => {
      const l = await market.get(d.listingId)
      if (!l || !live(l)) throw fail('оголошення вже не діє', 409)
      const tm = await terms(l, { qty: d.qty, price: d.price, barter: d.barter, pay: d.price == null ? 'barter' : 'solari', ...req.body })
      const next = await market.amendDeal(d.id, tm)
      if (next.status !== 'offered') throw fail('пропозицію вже розглянули — зміни не можна', 409)
      return next
    })
    for (const u of await otherSide(out, 'maker')) await notify(u, 'market.offer', { deal: d.id, listing: d.listingId, gid: d.gid }, { ref: `offer:${d.id}` })
    res.json(await dealFull(req, out, role))
  }))

  /** сторона оголошення приймає: залишку має вистачити з урахуванням уже прийнятих */
  r.post('/api/market/deals/:did/accept', need(), wrap(async (req, res) => {
    await noBan(req)
    const { d, role } = await loadDeal(req)
    if (role !== 'owner') throw fail('прийняти може лише той, хто веде оголошення', 403)
    const out = await lock(d.listingId, async () => {
      const l = await market.get(d.listingId)
      if (!l || !live(l)) throw fail('оголошення вже не діє', 409)
      if (d.qty > l.left - (await market.promised(l.id))) throw fail('залишку не вистачає — частину вже пообіцяно в інших угодах', 409)
      const next = await market.moveDeal(d.id, ['offered'], 'accepted', { taker: req.user.id, by: req.user.id })
      if (!next) throw fail('пропозицію вже розглянули', 409)
      return next
    })
    await notify(out.maker, 'market.accepted', { deal: out.id, gid: out.gid })
    await emit(d.listingId)
    res.json(await dealFull(req, out, 'taker'))
  }))
  r.post('/api/market/deals/:did/decline', need(), wrap(async (req, res) => {
    const { d, role } = await loadDeal(req)
    if (role !== 'owner') throw fail('відхилити може лише той, хто веде оголошення', 403)
    const out = await market.moveDeal(d.id, ['offered'], 'declined', { reason: req.body?.reason, by: req.user.id })
    if (!out) throw fail('пропозицію вже розглянули', 409)
    await notify(out.maker, 'market.declined', { deal: out.id, gid: out.gid })
    res.json(await dealFull(req, out, role))
  }))
  /** скасувати до завершення: той, хто запропонував (будь-коли), чи той, хто прийняв */
  r.post('/api/market/deals/:did/cancel', need(), wrap(async (req, res) => {
    const { d, role } = await loadDeal(req)
    if (role !== 'maker' && role !== 'taker') throw fail('скасувати може сторона угоди', 403)
    const out = await market.moveDeal(d.id, role === 'maker' ? ['offered', 'accepted'] : ['accepted'], 'cancelled', { reason: req.body?.reason, by: req.user.id })
    if (!out) throw fail('угоду вже завершено чи скасовано', 409)
    for (const u of await otherSide(d, role)) await notify(u, 'market.cancelled', { deal: out.id, gid: out.gid })
    await emit(d.listingId)
    res.json(await dealFull(req, out, role))
  }))
  /** «Завершено»: кожна сторона; обидві — угода завершена, залишок менше */
  r.post('/api/market/deals/:did/done', need(), wrap(async (req, res) => {
    const { d, role } = await loadDeal(req)
    if (role !== 'maker' && role !== 'taker') throw fail('завершити може сторона угоди', 403)
    if (d.status !== 'accepted') throw fail('завершити можна лише прийняту угоду', 409)
    const { deal, finished } = await lock(d.listingId, () => market.confirmDone(d.id, role))
    if (finished) {
      for (const u of [deal.maker, deal.taker]) await notify(u, 'market.rate', { deal: deal.id, gid: deal.gid })
      await emit(d.listingId)
    } else for (const u of await otherSide(deal, role)) await notify(u, 'market.done', { deal: deal.id, gid: deal.gid })
    res.json(await dealFull(req, deal, role))
  }))
  r.post('/api/market/deals/:did/messages', need(), wrap(async (req, res) => {
    await noBan(req)
    const { d, role } = await loadDeal(req)
    if (role === 'mod') throw fail('модератор читає листування, але не пише в нього', 403)
    const text = messageText(req.body?.text)
    if (!text) throw fail('порожнє повідомлення')
    await market.addMessage(d.id, req.user.id, text)
    for (const u of await otherSide(d, role)) if (u !== req.user.id) await notify(u, 'market.message', { deal: d.id, gid: d.gid }, { ref: d.id })
    res.status(201).json(await dealFull(req, await market.getDeal(d.id), role))
  }))
  r.post('/api/market/deals/:did/rate', need(), wrap(async (req, res) => {
    await noBan(req)
    const { d, role } = await loadDeal(req)
    if (role !== 'maker' && role !== 'taker') throw fail('оцінює сторона угоди', 403)
    if (d.status !== 'done') throw fail('оцінити можна завершену угоду', 409)
    const score = Number(req.body?.score)
    if (!Number.isInteger(score) || score < 1 || score > 5) throw fail('оцінка — від 1 до 5 зірок')
    const to = role === 'maker' ? d.taker : d.maker
    if (!to) throw fail('цієї людини вже нема на сайті', 409)
    await market.rate(d.id, req.user.id, to, score, messageText(String(req.body?.text ?? '').slice(0, 300)))
    res.json(await dealFull(req, d, role))
  }))

  // ---------- людина: репутація ----------
  r.get('/api/market/users/:login', wrap(async (req, res) => {
    const u = await auth.byLogin(req.params.login)
    if (!u || u.banned) throw fail('немає такої людини', 404)
    const [rep, ratings] = await Promise.all([market.reputation([u.id]), market.ratingsOf(u.id)])
    const ps = await people(ratings.map((x) => x.from))
    const listings = await listView(req, { scope: 'user', uidOf: u.id, limit: 12 })
    res.json({ rep: rep.get(u.id), ratings: ratings.map((x) => ({ ...x, from: ps.get(x.from) || null })), listings: listings.rows, total: listings.total })
  }))

  // ---------- скарги ----------
  r.post('/api/market/reports', need(), wrap(async (req, res) => {
    const b = req.body || {}
    const kind = ['listing', 'deal', 'user'].includes(b.target?.kind) ? b.target.kind : null
    if (!kind || typeof b.target.id !== 'string') throw fail('на що скарга?')
    if (!REASONS.includes(b.reason)) throw fail('вибери причину скарги')
    let target = b.target.id, author = null
    if (kind === 'listing') { const { l, it } = await load(req, 'view', target); target = l.id; author = authorOf(it) }
    else if (kind === 'deal') { req.params.did = target; const { d } = await loadDeal(req); target = d.id }
    else {
      const u = (await auth.get(target)) || (await auth.byLogin(target))
      if (!u) throw fail('немає такої людини', 404)
      target = u.id
    }
    if (author === req.user.id || (kind === 'user' && target === req.user.id)) throw fail('на себе скаржитись не можна')
    await market.report({ kind, target, reason: b.reason, note: plain(b.note, 500, true), by: req.user.id })
    // три різні людини кажуть «RMT» — оголошення ховається до рішення модератора
    if (kind === 'listing' && b.reason === 'rmt' && (await market.rmtVotes(kind, target)) >= RMT_AUTOHIDE) {
      const it = await items.get('listing', target)
      if (it && !it.hidden) {
        await items.moderate('listing', target, { hidden: true })
        if (author) await notify(author, 'market.moderated', { listing: target, action: 'autohide' })
        await hub?.emit({ op: 'put', kind: 'listing', id: target }, it)
      }
    }
    res.status(201).json({ ok: true })
  }))

  const needMod = (req) => { if (!isMod(req)) throw fail('це для модераторів біржі', 403) }
  /** черга: скарги, згруповані за ціллю (що, скільки за причинами, хто й що написав) */
  r.get('/api/market/reports', need(), wrap(async (req, res) => {
    needMod(req)
    const status = req.query.status === 'closed' ? 'closed' : 'open'
    const rows = await market.reports(status)
    const groups = new Map()
    for (const x of rows) {
      const k = `${x.kind}:${x.target}`
      if (!groups.has(k)) groups.set(k, { kind: x.kind, target: x.target, reasons: {}, notes: [], first: Number(x.created), last: Number(x.created), id: x.id, action: x.action, status: x.status })
      const g = groups.get(k)
      g.reasons[x.reason] = (g.reasons[x.reason] || 0) + 1
      g.notes.push({ by: x.by_user, reason: x.reason, note: x.note, at: Number(x.created) })
      g.first = Math.min(g.first, Number(x.created))
    }
    const list = [...groups.values()]
    const ps = await people(list.flatMap((g) => [...g.notes.map((n) => n.by), g.kind === 'user' ? g.target : null]))
    const out = await Promise.all(list.map(async (g) => {
      let subject = null
      if (g.kind === 'listing') {
        const l = await market.get(g.target), it = await items.get('listing', g.target)
        if (l && it) { const [v] = await rowsView(req, [it], [l]); subject = { ...v, note: l.note, author: (await people([authorOf(it)])).get(authorOf(it)) || null } }
      } else if (g.kind === 'deal') {
        const d = await market.getDeal(g.target)
        if (d) subject = (await dealsView(req, [d]))[0]
      } else subject = ps.get(g.target) ? { ...ps.get(g.target), ban: await market.banOf(g.target) } : null
      return { ...g, subject, notes: g.notes.map((n) => ({ ...n, by: ps.get(n.by) || null })) }
    }))
    res.json({ rows: out })
  }))

  /**
   * Рішення модератора за скаргою (на всю ціль): dismiss — відхилити; hide / unhide / close — оголошення; ban (days:
   * 1 / 7 / 30 / 0 — назавжди; user — кого, якщо ціль не людина) і unban; unrate — прибрати оцінки угоди.
   */
  r.post('/api/market/reports/:rid/resolve', need(), wrap(async (req, res) => {
    needMod(req)
    const rep = await market.getReport(req.params.rid)
    if (!rep) throw fail('немає такої скарги', 404)
    const action = String(req.body?.action || '')
    const note = plain(req.body?.note, 300, true)
    const { kind, target } = rep
    const listing = kind === 'listing' ? await market.get(target) : null
    const deal = kind === 'deal' ? await market.getDeal(target) : null
    const it = listing ? await items.get('listing', target) : null
    const author = it ? authorOf(it) : null
    if (['hide', 'unhide', 'close'].includes(action)) {
      if (!it) throw fail('ця дія — для оголошення')
      if (action === 'close') await market.setStatus(target, 'closed')
      else await items.moderate('listing', target, { hidden: action === 'hide' })
      if (author) await notify(author, 'market.moderated', { listing: target, action, note })
      await hub?.emit({ op: 'put', kind: 'listing', id: target }, it)
    } else if (action === 'ban' || action === 'unban') {
      const allowed = new Set([kind === 'user' ? target : null, author, deal?.maker, deal?.taker].filter(Boolean))
      const uid = kind === 'user' ? target : String(req.body?.user || '')
      if (!allowed.has(uid)) throw fail('кого саме? Вибери автора чи сторону угоди')
      if (action === 'unban') await market.unban(uid)
      else {
        const days = Number(req.body?.days)
        if (!BAN_DAYS.includes(days)) throw fail('на скільки днів?')
        await market.ban(uid, days ? Date.now() + days * DAY : null, note, req.user.id)
        // її відкриті особисті оголошення — закрито
        for (const row of (await market.list({ scope: 'mine', uid, gids: [], state: 'open', limit: 100 })).rows) {
          if (row.owner_kind === 'user' && row.owner_id === uid) { await market.setStatus(row.id, 'closed'); await hub?.emit({ op: 'put', kind: 'listing', id: row.id }, row) }
        }
        await notify(uid, 'market.banned', { until: days ? Date.now() + days * DAY : null, note })
      }
    } else if (action === 'unrate') {
      if (!deal) throw fail('ця дія — для угоди')
      await market.dropRatings(deal.id)
    } else if (action !== 'dismiss') throw fail('невідома дія')
    // розблокування — не закриває скарг (людину можуть розблокувати й пізніше)
    const n = action === 'unban' || action === 'unhide' ? 0 : await market.resolve(kind, target, action, req.user.id)
    res.json({ ok: true, resolved: n })
  }))

  // ---------- оголошення ----------
  r.get('/api/market/:id', wrap(async (req, res) => {
    const { l, it, edit, manage } = await load(req)
    res.json(await full(req, l, it, edit, manage))
  }))

  /** перевірити місце-базу: автор її бачить */
  async function checkBase(req, doc) {
    if (doc.place?.kind !== 'base') return
    const b = await items.get('base', doc.place.base)
    if (!b || !can(req.ctx, b).view) throw fail('немає такої бази', 404)
  }
  const meta = (doc, g) => content.H.listing.meta(doc, g)

  r.post('/api/market', need(), wrap(async (req, res) => {
    await noBan(req)
    const { owner, visibility, rules, ...body } = req.body || {}
    if (rules !== true) throw fail('підтверди правило біржі: торгівля за реальні гроші заборонена')
    const o = await content.ownerFor(req, owner)
    const g = await goods()
    const doc = cleanListing(body, { goods: g, maps: mapData })
    await checkBase(req, doc)
    const l = await market.create(doc, g.get(doc.gid))
    const it = await items.add('listing', l.id, { owner: o, visibility: visibility || (o.kind === 'guild' ? 'guild' : 'public'), by: req.user.id, ...meta(doc, g.get(doc.gid)) })
    await hub?.emit({ op: 'put', kind: 'listing', id: l.id }, it)
    await runMatch(l, it)
    res.status(201).json(await full(req, l, it, rightsOf(req.ctx, it).edit, can(req.ctx, it).manage))
  }))

  r.put('/api/market/:id', need(), wrap(async (req, res) => {
    await noBan(req)
    const out = await lock(req.params.id, async () => {
      const { l: cur, it, edit, manage } = await load(req, 'edit')
      const { owner, visibility, rules, base, item, rights, matches, deals, rep, ...body } = req.body || {}
      const g = await goods()
      const { id, left, status, expires, fresh, created, updated, ...curDoc } = cur
      const doc = cleanListing({ ...curDoc, ...body }, { goods: g, maps: mapData })
      if (doc.gid !== cur.gid || doc.side !== cur.side) {
        if (await market.hasDeals(cur.id)) throw fail('предмет і вид не змінюються, коли вже є угоди — закрий це й розмісти нове', 409)
      }
      await checkBase(req, doc)
      const next = await market.put(cur.id, doc, g.get(doc.gid), Number.isFinite(base) ? base : null)
      if (next.conflict) return { conflict: true, body: await full(req, next, it, edit, manage) }
      const now2 = (await items.touch('listing', cur.id, meta(doc, g.get(doc.gid)))) || it
      return { body: await full(req, next, now2, edit, manage), l: next, it: now2 }
    })
    if (out.conflict) return res.status(409).json({ error: req.t('це оголошення щойно змінили — ось його нова версія'), row: out.body })
    await emit(req.params.id)
    await runMatch(out.l, out.it)
    res.json(out.body)
  }))

  r.post('/api/market/:id/close', need(), wrap(async (req, res) => {
    const { l, it, edit, manage } = await load(req, 'edit')
    const next = await market.setStatus(l.id, 'closed')
    await emit(l.id)
    res.json(await full(req, next, it, edit, manage))
  }))
  /** продовжити (і відкрити закрите чи минуле): ліміт відкритих перевіряється знову */
  r.post('/api/market/:id/renew', need(), wrap(async (req, res) => {
    await noBan(req)
    const { l, it, edit, manage } = await load(req, 'edit')
    if (it.hidden && !isMod(req)) throw fail('оголошення сховане модератором', 409)
    if (l.left <= 0) throw fail('усе вже продано — розмісти нове оголошення', 409)
    const o = { kind: it.owner_kind, id: it.owner_id }
    const next = await withLock(`limit:${o.kind}:${o.id}`, async () => {
      if (!live(l)) await content.checkLimit(req, 'listing', o)
      return market.renew(l.id, TTL_DAYS.includes(Number(req.body?.ttl)) ? Number(req.body.ttl) : l.ttl)
    })
    await emit(l.id)
    await runMatch(next, it)
    res.json(await full(req, next, it, edit, manage))
  }))
  /** стерти можна, лише поки немає угод (інакше — закрити: угодам потрібна їхня історія) */
  r.delete('/api/market/:id', need(), wrap(async (req, res) => {
    const { l, it } = await load(req, 'manage')
    if (await market.hasDeals(l.id)) throw fail('за цим оголошенням уже були угоди — його можна лише закрити', 409)
    await content.purge('listing', l.id)
    await hub?.emit({ op: 'del', kind: 'listing', id: l.id }, it)
    res.json({ ok: true })
  }))

  return r
}

/** для перевірок і клієнта: що з чого складається */
export const MARKET_ENUMS = { SIDES, PAYS, TTL_DAYS, REASONS, SECTIONS, REGIONS, BAN_DAYS }

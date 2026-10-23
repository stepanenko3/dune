/*
 * Події спільноти (/api/events): списки «найближчі / минулі» (усе, що людина бачить, її, гільдії), подія з командами,
 * створення й зміна (власник і видимість — у реєстрі, як у всіх речей; змінювати — за правами речі), реєстрація команд
 * (капітан; согравці з сайту приєднуються кодом), рішення організатора (підтвердити, резерв, відхилити), «Піду
 * дивитись», файл календаря. Живі оновлення (/stream) — лише тим, хто подію бачить.
 *
 * Хто що бачить у команді: склад підтверджених і резерву — усі, хто бачить подію (це ніки в грі); заявки, що чекають, і
 * відхилені — організатори й сама команда; примітку — вони ж; код приєднання — капітан і організатори.
 * Реєстрація — по черзі в межах події (withLock): місця, резерв і «одна команда на людину» перевіряються без перегонів.
 */
import express from 'express'
import { can } from '../lib/items.mjs'
import { rightsOf } from '../lib/roadmap-access.mjs'
import { cleanEvent, cleanMembers, endsOf, EVENT_TYPE_L, formatOf, icsOf, regState, TEAM_STATUS } from '../lib/events.mjs'
import { fail, plain, withLock } from '../lib/util.mjs'
import { eventData, scopeOf } from '../lib/notify/topics.mjs'
import { need, wrap } from './auth.mjs'

export function createEventRoutes({ events, items, content, hub, mapData, db, notify = null }) {
  const r = express.Router()
  const lock = (id, fn) => withLock(`event:${id}`, fn)

  /** подія, яку людина бачить (інакше 404 — не видаємо, що вона є); right — що ще треба: edit (права речі) чи manage */
  const load = async (req, right = 'view') => {
    const ev = await events.get(req.params.id)
    const it = ev && (await items.get('event', ev.id))
    const c = it ? can(req.ctx, it) : { view: false }
    if (!ev || !c.view) throw fail('немає такої події', 404)
    const edit = rightsOf(req.ctx, it).edit
    if (right === 'edit' && !edit) throw fail('змінювати цю подію тобі не можна', 403)
    if (right === 'manage' && !c.manage) throw fail('це може лише власник (у гільдії — офіцер чи лідер)', 403)
    return { ev, it, edit, manage: c.manage }
  }
  const userMap = async (ids) => {
    const list = [...new Set(ids.filter(Boolean))]
    const out = new Map()
    for (let i = 0; i < list.length; i += 500) {
      const part = list.slice(i, i + 500)
      for (const u of await db.all(`SELECT id, login, name, color FROM users WHERE id IN (${part.map(() => '?').join(',')})`, ...part)) out.set(u.id, u)
    }
    return out
  }
  const person = (u) => (u ? { id: u.id, login: u.login, name: u.name, color: u.color } : null)
  /** команди, які людина бачить, для клієнта */
  async function teamsView(ev, edit, uid) {
    const all = await events.teams(ev.id)
    const own = (tm) => !!uid && (tm.captain === uid || tm.members.some((m) => m.user === uid))
    const shown = all.filter((tm) => edit || tm.status === 'confirmed' || tm.status === 'reserve' || own(tm))
    const users = await userMap(shown.flatMap((tm) => [tm.captain, ...tm.members.map((m) => m.user)]))
    return shown.map((tm) => ({
      id: tm.id, name: tm.name, status: tm.status, created: tm.created,
      captain: person(users.get(tm.captain)),
      members: tm.members.map((m) => ({ nick: m.nick, user: m.user ? person(users.get(m.user)) : null })),
      mine: own(tm),
      ...(edit || own(tm) ? { note: tm.note } : {}),
      ...(edit || tm.captain === uid ? { code: tm.code } : {}),
    }))
  }
  /** подія для клієнта: документ, річ реєстру, права, команди, лічильники, «я» */
  async function full(req, ev, it, edit, manage) {
    const uid = req.user?.id || null
    const [teams, counts, team, watching] = await Promise.all([teamsView(ev, edit, uid), events.counts([ev.id]), events.playerTeam(ev.id, uid), events.watching(ev.id, uid)])
    return {
      ...ev, ends: endsOf(ev), regState: regState(ev),
      item: await items.view(it, req.ctx, await items.starredBy(uid)),
      rights: { edit, manage },
      teams, counts: counts.get(ev.id), me: { team, watching },
    }
  }
  const meta = (doc) => content.H.event.meta(doc)
  const emit = async (id, kind = 'put') => { const it = await items.get('event', id); if (it) await hub?.emit({ op: kind, kind: 'event', id }, it) }

  /** місце звільнилось: без підтвердження організатором — перший із резерву бере участь сам (лише під lock) */
  async function fillNow(ev) {
    if (ev.reg.approval) return
    const teams = await events.teams(ev.id)
    let free = ev.reg.slots ? ev.reg.slots - teams.filter((x) => x.status === 'confirmed').length : Infinity
    for (const tm of teams) {
      if (free <= 0) break
      if (tm.status !== 'reserve') continue
      await events.saveTeam({ ...tm, status: 'confirmed' })
      free--
    }
  }
  /** статус нової (чи переведеної) команди: місць нема — резерв; інакше — чекає організатора або одразу бере участь */
  const statusFor = (ev, teams, self = null) => {
    const taken = teams.filter((x) => x.status === 'confirmed' && x.id !== self).length
    if (ev.reg.slots && taken >= ev.reg.slots) return 'reserve'
    return ev.reg.approval ? 'pending' : 'confirmed'
  }
  const sameName = (teams, name, self = null) => teams.some((x) => x.id !== self && x.status !== 'rejected' && x.name.toLowerCase() === name.toLowerCase())

  // ---------- списки ----------
  r.get('/api/events', wrap(async (req, res) => {
    const uid = req.user?.id || null
    const gids = [...(req.ctx?.ranks?.keys() || [])]
    const scope = ['mine', 'guild'].includes(req.query.scope) ? String(req.query.scope) : 'all'
    // події гільдії (за замовчуванням — своєї): учасникам — усі, решті — лише публічні
    const guild = scope === 'guild' ? String(req.query.guild || gids[0] || '') : null
    const { rows, total } = await events.list({
      when: req.query.when === 'past' ? 'past' : 'upcoming', scope, uid, gids, guild,
      type: String(req.query.type || ''), region: String(req.query.region || ''), q: String(req.query.q || ''),
      limit: Number(req.query.limit) || 30, offset: Number(req.query.offset) || 0,
    })
    const seen = rows.filter((it) => can(req.ctx, it).view)
    const ids = seen.map((x) => x.id)
    const [counts, mine, views] = await Promise.all([events.counts(ids), events.mineIn(ids, uid), items.views(seen, req.ctx, await items.starredBy(uid))])
    res.json({
      total,
      rows: seen.map((it, i) => {
        const { about, rules, bracket, resultsNote, ...light } = JSON.parse(it.e_doc)
        return { ...light, id: it.id, ends: it.e_ends, regState: regState(light), item: views[i], counts: counts.get(it.id), me: mine.get(it.id) || null, bracket: !!bracket }
      }),
    })
  }))

  if (hub) r.get('/api/events/stream', (req, res) => hub.open(req, res))

  // ---------- подія ----------
  r.get('/api/events/:id', wrap(async (req, res) => {
    const { ev, it, edit, manage } = await load(req)
    res.json(await full(req, ev, it, edit, manage))
  }))

  /** файл календаря (Google, Apple, Outlook): з нагадуванням за 30 хв */
  r.get('/api/events/:id/calendar.ics', wrap(async (req, res) => {
    const { ev } = await load(req)
    const origin = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    const t = req.t
    const description = [`${t(EVENT_TYPE_L[ev.type] || 'Подія')} · ${formatOf(ev, t)}`, ...ev.prizes.map((p) => `${p.label ? p.label + ': ' : ''}${p.prize}`)].join('\n')
    const host = origin.replace(/^https?:\/\//, '')
    res.set({ 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="event-${ev.id}.ics"`, 'cache-control': 'no-store' })
      .send(icsOf(ev, { url: `${origin}/events/${ev.id}`, uid: `${ev.id}@${host}`, description }))
  }))

  r.post('/api/events', need(), wrap(async (req, res) => {
    const { owner, visibility, ...body } = req.body || {}
    const o = await content.ownerFor(req, owner)
    // нова подія — лише на майбутнє (минулу записують, змінивши наявну)
    const doc = cleanEvent(body, { maps: mapData })
    if (endsOf(doc) <= Date.now()) throw fail('ця подія вже минула — вибери час у майбутньому')
    const ev = await events.get(await content.H.event.create(doc))
    const it = await items.add('event', ev.id, { owner: o, visibility, by: req.user.id, ...meta(doc) })
    await hub?.emit({ op: 'put', kind: 'event', id: ev.id }, it)
    // сповіщення в Discord / Telegram — у фоні (служби не затримують відповідь)
    const scope = notify && scopeOf(it)
    if (scope) notify.emit('event.new', eventData(ev), scope).catch(() => {})
    const rt = rightsOf(req.ctx, it)
    res.status(201).json(await full(req, ev, it, rt.edit, can(req.ctx, it).manage))
  }))

  r.put('/api/events/:id', need(), wrap(async (req, res) => {
    const out = await lock(req.params.id, async () => {
      const { ev: cur, it, edit, manage } = await load(req, 'edit')
      const { owner, visibility, item, id, created, updated, ends, base, teams: _t, counts, me, rights, regState: _r, ...body } = req.body || {}
      const { created: _c, updated: _u, id: _i, ...curDoc } = cur
      const teams = await events.teams(cur.id)
      const doc = cleanEvent({ ...curDoc, ...body }, { maps: mapData, teams: new Set(teams.map((x) => x.id)), confirmed: new Set(teams.filter((x) => x.status === 'confirmed').map((x) => x.id)) })
      const ev = await events.put(cur.id, doc, Number.isFinite(base) ? base : null)
      if (!ev) throw fail('немає такої події', 404)
      if (ev.conflict) return { conflict: true, body: await full(req, ev, it, edit, manage) }
      // місць стало більше — резерв проходить сам (якщо без підтвердження)
      await fillNow(ev)
      const now = (await items.touch('event', ev.id, meta(doc))) || it
      return { body: await full(req, await events.get(ev.id), now, edit, manage) }
    })
    if (out.conflict) return res.status(409).json({ error: req.t('цю подію щойно змінили — ось її нова версія'), row: out.body })
    await emit(req.params.id)
    res.json(out.body)
  }))

  r.delete('/api/events/:id', need(), wrap(async (req, res) => {
    const { ev, it } = await load(req, 'manage')
    await content.purge('event', ev.id)
    await hub?.emit({ op: 'del', kind: 'event', id: ev.id }, it)
    res.json({ ok: true })
  }))

  // ---------- глядачі ----------
  r.post('/api/events/:id/watch', need(), wrap(async (req, res) => {
    const { ev } = await load(req)
    const on = req.body?.on !== false
    if (on && regState(ev) === 'cancelled') throw fail('подію скасовано')
    await events.watch(ev.id, req.user.id, on)
    await emit(ev.id)
    res.json({ watching: on, watchers: (await events.counts([ev.id])).get(ev.id).watchers })
  }))

  // ---------- команди ----------
  /** реєстрація: капітан — той, хто реєструє (перший гравець — він); місць нема — резерв */
  r.post('/api/events/:id/teams', need(), wrap(async (req, res) => {
    await lock(req.params.id, async () => {
      const { ev } = await load(req)
      const st = regState(ev)
      if (st === 'cancelled') throw fail('подію скасовано', 409)
      if (st !== 'open') throw fail('реєстрацію на цю подію закрито', 409)
      if (await events.playerTeam(ev.id, req.user.id)) throw fail('ти вже в команді цієї події', 409)
      const body = req.body || {}
      const list = Array.isArray(body.members) ? body.members : []
      // перший гравець — сам капітан (його нік — з запиту чи профілю)
      const first = typeof list[0] === 'string' ? list[0] : list[0]?.nick
      const members = cleanMembers([{ nick: first || req.user.nick || req.user.name, user: req.user.id }, ...list.slice(1).map((m) => ({ nick: typeof m === 'string' ? m : m?.nick }))], ev.reg.teamSize, new Set([req.user.id]))
      if (members[0].user !== req.user.id) throw fail('потрібен хоч один гравець — твій нік у грі')
      const name = ev.reg.teamSize > 1 ? plain(body.name, 40) : members[0].nick
      if (name.length < 2) throw fail('назва команди — щонайменше 2 знаки')
      const teams = await events.teams(ev.id)
      if (sameName(teams, name)) throw fail(ev.reg.teamSize > 1 ? 'команда з такою назвою вже є' : 'гравець із таким ніком уже зареєструвався', 409)
      await events.addTeam(ev.id, { captain: req.user.id, name, members, note: plain(body.note, 300, true), status: statusFor(ev, teams) })
    })
    await emit(req.params.id)
    const { ev, it, edit, manage } = await load(req)
    res.status(201).json(await full(req, ev, it, edit, manage))
  }))

  /** зміна команди: капітан — назва, гравці, примітка (до початку); організатор — те саме й статус */
  r.patch('/api/events/:id/teams/:tid', need(), wrap(async (req, res) => {
    await lock(req.params.id, async () => {
      const { ev, edit } = await load(req)
      const tm = await events.team(req.params.tid)
      if (!tm || tm.eventId !== ev.id) throw fail('немає такої команди', 404)
      const captain = tm.captain === req.user.id
      if (!captain && !edit) throw fail('змінювати команду може її капітан чи організатор', 403)
      const body = req.body || {}
      const next = { ...tm }
      const teams = await events.teams(ev.id)
      if ('status' in body) {
        if (!edit) throw fail('рішення про команду — за організатором', 403)
        if (!TEAM_STATUS.includes(body.status)) throw fail('невідомий статус')
        if (body.status === 'confirmed' && tm.status !== 'confirmed' && ev.reg.slots && teams.filter((x) => x.status === 'confirmed').length >= ev.reg.slots) throw fail('усі місця зайняті — спершу звільни місце або постав команду в резерв', 409)
        next.status = body.status
      }
      if ('name' in body || 'members' in body || 'note' in body) {
        if (!edit && Date.now() >= ev.starts) throw fail('подія вже почалась — склад змінює організатор', 409)
        if ('members' in body) {
          // гравці з сайту лишаються на своїх місцях (додати чужого не можна — він приєднується сам кодом); капітан — у складі
          const linked = new Set(tm.members.map((m) => m.user).filter(Boolean))
          const members = cleanMembers(body.members, ev.reg.teamSize, linked)
          if (!members.some((m) => m.user === tm.captain)) throw fail('капітан має лишитись у команді')
          next.members = members
        }
        if (ev.reg.teamSize === 1) next.name = next.members[0].nick
        else if ('name' in body) {
          next.name = plain(body.name, 40)
          if (next.name.length < 2) throw fail('назва команди — щонайменше 2 знаки')
        }
        if (sameName(teams, next.name, tm.id)) throw fail(ev.reg.teamSize > 1 ? 'команда з такою назвою вже є' : 'гравець із таким ніком уже зареєструвався', 409)
        if ('note' in body) next.note = plain(body.note, 300, true)
      }
      await events.saveTeam(next)
      if (tm.status === 'confirmed' && next.status !== 'confirmed') await fillNow(ev)
    })
    await emit(req.params.id)
    const { ev, it, edit, manage } = await load(req)
    res.json(await full(req, ev, it, edit, manage))
  }))

  /** зняти команду: капітан (відмовитись) чи організатор; місце звільняється */
  r.delete('/api/events/:id/teams/:tid', need(), wrap(async (req, res) => {
    await lock(req.params.id, async () => {
      const { ev, edit } = await load(req)
      const tm = await events.team(req.params.tid)
      if (!tm || tm.eventId !== ev.id) throw fail('немає такої команди', 404)
      if (tm.captain !== req.user.id && !edit) throw fail('зняти команду може її капітан чи організатор', 403)
      await events.removeTeam(tm.id)
      if (tm.status === 'confirmed') await fillNow(ev)
    })
    await emit(req.params.id)
    const { ev, it, edit, manage } = await load(req)
    res.json(await full(req, ev, it, edit, manage))
  }))

  /**
   * Приєднатися до команди кодом від капітана: місце з твоїм ніком у грі (вписане капітаном) — твоє; інакше — нове
   * місце, якщо склад ще не повний. Склад повний, а ніки вписав капітан (нік на сайті не збігся чи не вказаний) —
   * 409 з переліком таких місць (pick), людина вибирає своє (slot).
   */
  r.post('/api/events/:id/teams/:tid/join', need(), wrap(async (req, res) => {
    await lock(req.params.id, async () => {
      const { ev } = await load(req)
      const tm = await events.team(req.params.tid)
      if (!tm || tm.eventId !== ev.id || typeof req.body?.code !== 'string' || req.body.code !== tm.code) throw fail('посилання в команду недійсне — попроси в капітана нове', 404)
      if (tm.status === 'rejected') throw fail('цю команду відхилено', 409)
      const st = regState(ev)
      if (st === 'cancelled' || st === 'ended' || Date.now() >= ev.starts) throw fail('подія вже почалась — склад змінює організатор', 409)
      const have = await events.playerTeam(ev.id, req.user.id)
      if (have === tm.id) return
      if (have) throw fail('ти вже в команді цієї події', 409)
      const nick = plain(req.user.nick, 40)
      const members = [...tm.members]
      const at = nick ? members.findIndex((m) => !m.user && m.nick.toLowerCase() === nick.toLowerCase()) : -1
      const open = members.flatMap((m, i) => (m.user ? [] : [{ i, nick: m.nick }]))
      const slot = req.body.slot
      if (slot !== undefined && slot !== null) {
        if (!open.some((x) => x.i === slot)) throw fail('це місце вже зайняте — онови сторінку', 409)
        members[slot] = { ...members[slot], user: req.user.id }
      } else if (at >= 0) members[at] = { ...members[at], user: req.user.id }
      else if (members.length < ev.reg.teamSize) {
        const mine = nick || plain(req.user.name, 40)
        if (members.some((m) => m.nick.toLowerCase() === mine.toLowerCase())) throw fail('нік «{nick}» у команді двічі', 400, { nick: mine })
        members.push({ nick: mine, user: req.user.id })
      } else if (open.length) throw fail('хто з них ти? Вибери свій нік у грі', 409, { pick: open })
      else throw fail('у команді вже повний склад — попроси капітана звільнити місце', 409)
      await events.saveTeam({ ...tm, members })
    })
    await emit(req.params.id)
    const { ev, it, edit, manage } = await load(req)
    res.json(await full(req, ev, it, edit, manage))
  }))

  /** вийти з команди (не капітану — той знімає всю команду): місце звільняється */
  r.post('/api/events/:id/teams/:tid/leave', need(), wrap(async (req, res) => {
    await lock(req.params.id, async () => {
      const { ev } = await load(req)
      const tm = await events.team(req.params.tid)
      if (!tm || tm.eventId !== ev.id || !tm.members.some((m) => m.user === req.user.id)) throw fail('ти не в цій команді', 404)
      if (tm.captain === req.user.id) throw fail('капітан не виходить, а знімає команду')
      await events.saveTeam({ ...tm, members: tm.members.filter((m) => m.user !== req.user.id) })
    })
    await emit(req.params.id)
    const { ev, it, edit, manage } = await load(req)
    res.json(await full(req, ev, it, edit, manage))
  }))

  return r
}

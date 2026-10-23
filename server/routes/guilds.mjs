/*
 * Гільдії: список і створення; сторінка гільдії (учасники, запрошення й заявки — офіцерам); налаштування й видалення —
 * лідеру; ролі й вигнання — за рангом; запрошення-посилання; заявки; вихід; указ тижня гільдії.
 * Адміністратор сайту в будь-якій гільдії діє як лідер.
 *
 * Ролі: лідер (4) → офіцер (3) → учасник (2) → новобранець (1). Офіцер приймає, виганяє й міняє ролі тих, хто нижче,
 * але не призначає офіцерів; лідер — усе, зокрема передає лідерство. Прийнятий за заявкою — новобранець (лише
 * дивиться), за запрошенням офіцера — учасник.
 *
 * Як у грі: людина — лише в одній гільдії (вступ, заявка, запрошення й створення нової, поки вона в гільдії, —
 * помилка «Спершу вийди з поточної гільдії»), а в гільдії — не більше guildCap людей (налаштування сайту).
 *
 * Каталог і набір: картка гільдії (lib/guild-profile.mjs) — офіцерам; чужим — лише блоки «для всіх». Заявка — за
 * анкетою гільдії; офіцери бачать чергу з відповідями й своїми коментарями, приймають (новобранцем) чи відхиляють з
 * причиною. Що сталося з заявкою — у шину гільдії (lib/guild-bus.mjs): на неї підписані сповіщення (і згодом бот).
 */
import crypto from 'node:crypto'
import express from 'express'
import sharp from 'sharp'
import { can } from '../lib/items.mjs'
import { RANK, guildCan } from '../lib/guilds.mjs'
import { profileFor } from '../lib/guild-profile.mjs'
import { fail } from '../lib/util.mjs'
import { need, wrap } from './auth.mjs'

export function createGuildRoutes({ auth, guilds, items, deleteGuild, decrees, db, markers, storage, bus }) {
  const r = express.Router()
  const load = async (req) => {
    const g = await guilds.get(req.params.slug)
    if (!g) throw fail('немає такої гільдії', 404)
    const may = guildCan(req.ctx, g)
    return { g, rank: may.rank, may, admin: req.user?.role === 'admin' || !!req.ctx?.superuser }
  }
  const needRank = (rank, min) => { if (rank < min) throw fail('бракує прав у гільдії', 403) }
  const brief = (g) => ({ id: g.id, slug: g.slug, name: g.name, tag: g.tag })
  const emit = (ev) => (bus ? bus.emit(ev) : null)
  /** заявка для офіцерів: людина, відповіді, коментарі */
  const forOfficer = (x, notes) => ({
    id: x.user_id, login: x.login, name: x.name, nick: x.nick, color: x.color, note: x.note, created: x.created, status: x.status, answers: x.answers, tz: x.tz,
    reason: x.reason, decided: x.decided, decidedBy: x.decided_name, comments: notes.get(x.user_id) || [],
  })
  /** мітки гільдійної бази на мапі (позначки гільдії виду «база»), які глядач бачить */
  async function mapBases(req, g) {
    if (!db || !markers) return []
    const rows = (await db.all("SELECT * FROM items WHERE kind = 'marker' AND owner_kind = 'guild' AND owner_id = ? ORDER BY updated DESC LIMIT 50", g.id)).filter((it) => can(req.ctx, it).view)
    if (!rows.length) return []
    return (await markers.many(rows.map((x) => x.id))).filter((m) => m.kind === 'base').slice(0, 5).map((m) => ({ id: m.id, title: m.title, map: m.map }))
  }

  r.get('/api/guilds', wrap(async (req, res) => {
    const mine = req.user ? await guilds.ofOne(req.user.id) : null
    res.json({
      guild: mine,
      mine: mine ? [mine] : [],
      list: await guilds.list({ q: req.query.q || '' }),
      requests: req.user ? await guilds.requestsOfUser(req.user.id) : [],
      myRequests: req.user ? await guilds.myRequests(req.user.id) : [],
      cap: await auth.guildCap(),
    })
  }))

  r.post('/api/guilds', need(), wrap(async (req, res) => {
    const g = await guilds.create(req.body || {}, req.user.id)
    res.status(201).json({ guild: await guilds.view(g) })
  }))

  r.get('/api/guilds/:slug', wrap(async (req, res) => {
    const { g, rank, may } = await load(req)
    const members = (await guilds.members(g.id)).map((m) => ({ id: m.id, login: m.login, name: m.name, nick: m.nick, color: m.color, role: m.role, joined: m.joined, seen: rank >= RANK.officer ? m.seen : undefined }))
    const starred = await items.starredBy(req.user?.id)
    const own = req.user ? await guilds.roleOf(g.id, req.user.id) : null
    const profile = profileFor(await guilds.profile(g.id), { member: may.member, officer: may.review })
    const mine = req.user ? await guilds.requestOf(g.id, req.user.id) : null
    const pending = may.review ? await guilds.requests(g.id) : []
    const notes = may.review ? await guilds.comments(g.id, pending.map((x) => x.user_id)) : new Map()
    const view = await guilds.view(g)
    res.json({
      // опис гільдії — теж блок картки: сховали від чужих — порожньо
      guild: profile.show.about === 'hidden' ? { ...view, about: '' } : view,
      role: rank ? (req.user?.role === 'admin' && !own ? 'admin' : own) : null,
      rank,
      profile,
      // склад — учасникам (чи всім, якщо гільдія так вирішила); решті — лише лідера й офіцерів (якщо їх видно)
      members: rank || profile.show.members === 'public' ? members : profile.show.officers === 'public' ? members.filter((m) => m.role === 'leader' || m.role === 'officer') : [],
      cap: await auth.guildCap(),
      // власна заявка кандидата: стан і причина відмови (коментарі офіцерів — ні)
      request: mine ? { status: mine.status, reason: mine.reason, created: mine.created, decided: mine.decided, note: mine.note, answers: mine.answers } : null,
      requests: pending.map((x) => forOfficer(x, notes)),
      mapBases: profile.show.map === 'hidden' ? [] : await mapBases(req, g),
      invites: rank >= RANK.officer
        ? await Promise.all((await guilds.invites(g.id)).map(async (i) => ({ code: i.code, created: i.created, expires: i.expires, uses: i.uses, maxUses: i.max_uses, role: i.role || 'member', by: i.by_name || null, live: !!(await guilds.inviteInfo(i.code)) })))
        : [],
      // публічне гільдії; бази гільдія може сховати від чужих (блок «Публічні бази»), навіть публічні
      public: await items.views((await items.library({ owner: { kind: 'guild', id: g.id }, limit: 100 })).rows.filter((it) => profile.show.bases !== 'hidden' || it.kind !== 'base'), req.ctx, starred),
    })
  }))

  /**
   * налаштування: назва, тег, колір і дім — лідер; опис, «набір відкрито» і картка гільдії (profile: частина, решта
   * лишається) — офіцер і лідер
   */
  r.patch('/api/guilds/:slug', need(), wrap(async (req, res) => {
    const { g, may } = await load(req)
    const body = req.body || {}
    if (!may.profile) throw fail('бракує прав у гільдії', 403)
    if (['name', 'tag', 'color', 'house'].some((k) => k in body) && !may.identity) throw fail('назву, тег, колір і дім міняє лідер', 403)
    const core = Object.fromEntries(['name', 'tag', 'color', 'house', 'about', 'open'].filter((k) => k in body).map((k) => [k, body[k]]))
    // картку перевіряємо до будь-якого запису: хибне посилання не лишить половину змін збереженою
    if (body.profile && typeof body.profile === 'object') await guilds.nextProfile(g.id, body.profile)
    const out = Object.keys(core).length ? await guilds.update(g.id, core) : g
    const profile = body.profile && typeof body.profile === 'object' ? await guilds.setProfile(g.id, body.profile) : await guilds.profile(g.id)
    res.json({ guild: await guilds.view(out), profile })
  }))

  // ---------- герб: зображення → квадрат 512 px WebP у сховищі (/media/uploads/…) ----------
  const rawImage = express.raw({ type: ['image/*', 'application/octet-stream'], limit: '8mb' })
  r.post('/api/guilds/:slug/emblem', need(), rawImage, wrap(async (req, res) => {
    const { g, may } = await load(req)
    if (!may.profile) throw fail('бракує прав у гільдії', 403)
    if (!storage) throw fail('сховище файлів зараз недоступне', 503)
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw fail('порожній файл — вибери зображення')
    let out
    try {
      out = await sharp(req.body, { limitInputPixels: 64e6 }).rotate().resize(512, 512, { fit: 'cover', position: 'attention' }).webp({ quality: 88 }).toBuffer()
    } catch { throw fail('це не зображення — підійде PNG, JPEG, WebP, GIF чи AVIF', 415) }
    const key = `uploads/${crypto.createHash('sha256').update(out).digest('hex').slice(0, 24)}.webp`
    if (!(await storage.has(key))) await storage.put(key, out, 'image/webp')
    const profile = await guilds.setEmblem(g.id, `/media/${key}`)
    res.json({ emblem: profile.emblem })
  }))
  r.delete('/api/guilds/:slug/emblem', need(), wrap(async (req, res) => {
    const { g, may } = await load(req)
    if (!may.profile) throw fail('бракує прав у гільдії', 403)
    await guilds.setEmblem(g.id, null)
    res.json({ emblem: null })
  }))

  r.delete('/api/guilds/:slug', need(), wrap(async (req, res) => {
    const { g, rank } = await load(req)
    needRank(rank, RANK.leader)
    await deleteGuild(g.id)
    res.json({ ok: true })
  }))

  r.post('/api/guilds/:slug/leave', need(), wrap(async (req, res) => {
    const g = await guilds.get(req.params.slug)
    if (!g) throw fail('немає такої гільдії', 404)
    const role = await guilds.roleOf(g.id, req.user.id)
    if (!role) throw fail('ти не в цій гільдії')
    if (role === 'leader') throw fail('лідер не може просто вийти — передай лідерство або видали гільдію')
    await guilds.removeMember(g.id, req.user.id)
    res.json({ ok: true })
  }))

  // ---------- учасники ----------
  r.patch('/api/guilds/:slug/members/:uid', need(), wrap(async (req, res) => {
    const { g, rank } = await load(req)
    const role = req.body?.role
    if (!RANK[role]) throw fail('невідома роль')
    const cur = await guilds.roleOf(g.id, req.params.uid)
    if (!cur) throw fail('ця людина не в гільдії', 404)
    needRank(rank, RANK.officer)
    if (req.params.uid === req.user.id && req.user.role !== 'admin') throw fail('свою роль змінити не можна')
    // офіцер: лише тих, хто нижче, і лише до учасника
    if (rank < RANK.leader && (RANK[cur] >= RANK.officer || RANK[role] >= RANK.officer)) throw fail('офіцерів призначає лідер', 403)
    // передати лідерство: попередній лідер стає офіцером
    if (role === 'leader') for (const m of await guilds.members(g.id)) if (m.role === 'leader') await guilds.setRole(g.id, m.id, 'officer')
    await guilds.setRole(g.id, req.params.uid, role)
    res.json({ ok: true })
  }))

  r.delete('/api/guilds/:slug/members/:uid', need(), wrap(async (req, res) => {
    const { g, rank } = await load(req)
    const cur = await guilds.roleOf(g.id, req.params.uid)
    if (!cur) throw fail('ця людина не в гільдії', 404)
    needRank(rank, RANK.officer)
    if (cur === 'leader') throw fail('лідера вигнати не можна')
    if (rank < RANK.leader && RANK[cur] >= RANK.officer) throw fail('офіцера виганяє лідер', 403)
    await guilds.removeMember(g.id, req.params.uid)
    res.json({ ok: true })
  }))

  // ---------- запрошення ----------
  r.post('/api/guilds/:slug/invites', need(), wrap(async (req, res) => {
    const { g, rank } = await load(req)
    needRank(rank, RANK.officer)
    const i = await guilds.invite(g.id, req.user.id, req.body || {})
    res.status(201).json({ code: i.code, expires: i.expires, maxUses: i.max_uses, role: i.role })
  }))
  r.delete('/api/guilds/:slug/invites/:code', need(), wrap(async (req, res) => {
    const { g, rank } = await load(req)
    needRank(rank, RANK.officer)
    res.json({ ok: await guilds.revokeInvite(g.id, req.params.code) })
  }))
  r.get('/api/invites/:code', wrap(async (req, res) => {
    const i = await guilds.inviteInfo(req.params.code)
    if (!i) throw fail('запрошення недійсне або вже минуло', 404)
    const g = await guilds.get(i.guild_id)
    res.json({ guild: await guilds.view(g), member: !!(req.user && (await guilds.roleOf(g.id, req.user.id))), cap: await auth.guildCap() })
  }))
  r.post('/api/invites/:code/accept', need(), wrap(async (req, res) => {
    const i = await guilds.inviteInfo(req.params.code)
    if (!i) throw fail('запрошення недійсне або вже минуло', 404)
    const g = await guilds.get(i.guild_id)
    if (!(await guilds.roleOf(g.id, req.user.id))) {
      // використання запрошення займаємо атомарно до вступу (інакше одночасні вступи перевищили б ліміт запрошення);
      // одна гільдія на людину і є місце — перевіряє addMember, і якщо вступ не вдався — використання повертаємо
      if (!(await guilds.takeInvite(i.code))) throw fail('запрошення недійсне або вже минуло', 404)
      try {
        await guilds.addMember(g.id, req.user.id, i.role === 'recruit' ? 'recruit' : 'member', { cap: await auth.guildCap(), by: i.by_user || null })
      } catch (e) {
        await guilds.untakeInvite(i.code)
        throw e
      }
    }
    res.json({ guild: await guilds.view(g) })
  }))

  // ---------- заявки ----------
  /** подати (чи подати знову після рішення): { note, answers — за анкетою гільдії, tz — пояс кандидата } */
  r.post('/api/guilds/:slug/requests', need(), wrap(async (req, res) => {
    const g = await guilds.get(req.params.slug)
    if (!g) throw fail('немає такої гільдії', 404)
    const cur = await guilds.current(req.user.id)
    if (cur?.guild_id === g.id) throw fail('ти вже в цій гільдії')
    await guilds.assertFree(req.user.id)
    // чекаючу заявку можна змінити й тоді, коли набір закрили чи гільдія заповнилась (нову — ні)
    const editing = (await guilds.requestOf(g.id, req.user.id))?.status === 'pending'
    if (!editing) {
      if (!g.open) throw fail('гільдія не приймає заявок — потрібне запрошення', 403)
      await guilds.assertRoom(g.id, await auth.guildCap())
    }
    await guilds.request(g.id, req.user.id, { note: req.body?.note, answers: req.body?.answers, tz: req.body?.tz })
    // змінена заявка — без нових сповіщень (офіцери її вже бачать у черзі)
    await emit({ type: editing ? 'edited' : 'submitted', guild: brief(g), user: req.user.id, by: req.user.id })
    res.status(editing ? 200 : 201).json({ ok: true })
  }))
  /** кандидат відкликає свою заявку */
  r.delete('/api/guilds/:slug/requests', need(), wrap(async (req, res) => {
    const g = await guilds.get(req.params.slug)
    if (!g) throw fail('немає такої гільдії', 404)
    const ok = await guilds.dropRequest(g.id, req.user.id)
    if (ok) await emit({ type: 'withdrawn', guild: brief(g), user: req.user.id, by: req.user.id })
    res.json({ ok })
  }))
  /** черга офіцерів: ?show=done — розглянуті (останнє рішення щодо кожного) */
  r.get('/api/guilds/:slug/requests', need(), wrap(async (req, res) => {
    const { g, may } = await load(req)
    if (!may.review) throw fail('бракує прав у гільдії', 403)
    const rows = await guilds.requests(g.id, req.query.show === 'done' ? 'done' : 'pending')
    const notes = await guilds.comments(g.id, rows.map((x) => x.user_id))
    res.json({ rows: rows.map((x) => forOfficer(x, notes)), form: (await guilds.profile(g.id)).form })
  }))
  /** рішення: { accept: true } — новобранцем; { accept: false, reason } — відхилити (причину побачить кандидат) */
  r.post('/api/guilds/:slug/requests/:uid', need(), wrap(async (req, res) => {
    const { g, rank } = await load(req)
    needRank(rank, RANK.officer)
    const uid = req.params.uid
    const x = await guilds.requestOf(g.id, uid)
    if (!x) throw fail('немає такої заявки', 404)
    if (x.status !== 'pending') throw fail('цю заявку вже розглянули', 409)
    // стан перевіряє саме рішення (під замком гільдії): поки думав, заявку могли розглянути чи відкликати
    if (req.body?.accept) {
      if (!(await guilds.acceptRequest(g.id, uid, { cap: await auth.guildCap(), by: req.user.id }))) throw fail('цю заявку вже розглянули', 409)
      await emit({ type: 'accepted', guild: brief(g), user: uid, by: req.user.id })
    } else {
      const reason = String(req.body?.reason ?? '').trim()
      if (!reason) throw fail('напиши причину — її побачить кандидат')
      if (!(await guilds.decide(g.id, uid, { status: 'rejected', reason, by: req.user.id }))) throw fail('цю заявку вже розглянули', 409)
      await emit({ type: 'rejected', guild: brief(g), user: uid, by: req.user.id, reason })
    }
    res.json({ ok: true })
  }))
  /** коментар офіцера до заявки (кандидат не бачить) */
  r.post('/api/guilds/:slug/requests/:uid/comments', need(), wrap(async (req, res) => {
    const { g, may } = await load(req)
    if (!may.review) throw fail('бракує прав у гільдії', 403)
    if (!(await guilds.requestOf(g.id, req.params.uid))) throw fail('немає такої заявки', 404)
    const id = await guilds.comment(g.id, req.params.uid, req.user.id, req.body?.text)
    await emit({ type: 'commented', guild: brief(g), user: req.params.uid, by: req.user.id })
    res.status(201).json({ id })
  }))

  return r
}

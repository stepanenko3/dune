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
 */
import express from 'express'
import { RANK } from '../lib/guilds.mjs'
import { fail } from '../lib/util.mjs'
import { need, wrap } from './auth.mjs'

export function createGuildRoutes({ auth, guilds, items, deleteGuild, decrees }) {
  const r = express.Router()
  const load = async (req) => {
    const g = await guilds.get(req.params.slug)
    if (!g) throw fail('немає такої гільдії', 404)
    const admin = req.user?.role === 'admin' || !!req.ctx?.superuser
    const rank = admin ? RANK.leader : await guilds.rankOf(g.id, req.user?.id)
    return { g, rank, admin }
  }
  const needRank = (rank, min) => { if (rank < min) throw fail('бракує прав у гільдії', 403) }

  r.get('/api/guilds', wrap(async (req, res) => {
    const mine = req.user ? await guilds.ofOne(req.user.id) : null
    res.json({
      guild: mine,
      mine: mine ? [mine] : [],
      list: await guilds.list({ q: req.query.q || '' }),
      requests: req.user ? await guilds.requestsOfUser(req.user.id) : [],
      cap: await auth.guildCap(),
    })
  }))

  r.post('/api/guilds', need(), wrap(async (req, res) => {
    const g = await guilds.create(req.body || {}, req.user.id)
    res.status(201).json({ guild: await guilds.view(g) })
  }))

  r.get('/api/guilds/:slug', wrap(async (req, res) => {
    const { g, rank } = await load(req)
    const members = (await guilds.members(g.id)).map((m) => ({ id: m.id, login: m.login, name: m.name, nick: m.nick, color: m.color, role: m.role, joined: m.joined, seen: rank >= RANK.officer ? m.seen : undefined }))
    const starred = await items.starredBy(req.user?.id)
    const own = req.user ? await guilds.roleOf(g.id, req.user.id) : null
    res.json({
      guild: await guilds.view(g),
      role: rank ? (req.user?.role === 'admin' && !own ? 'admin' : own) : null,
      rank,
      // склад бачать учасники; решта — лише лідера й офіцерів
      members: rank ? members : members.filter((m) => m.role === 'leader' || m.role === 'officer'),
      cap: await auth.guildCap(),
      request: req.user ? !!(await guilds.requestOf(g.id, req.user.id)) : false,
      requests: rank >= RANK.officer ? (await guilds.requests(g.id)).map((x) => ({ id: x.user_id, login: x.login, name: x.name, nick: x.nick, color: x.color, note: x.note, created: x.created })) : [],
      invites: rank >= RANK.officer
        ? await Promise.all((await guilds.invites(g.id)).map(async (i) => ({ code: i.code, created: i.created, expires: i.expires, uses: i.uses, maxUses: i.max_uses, role: i.role || 'member', by: i.by_name || null, live: !!(await guilds.inviteInfo(i.code)) })))
        : [],
      public: await items.views((await items.library({ owner: { kind: 'guild', id: g.id }, limit: 100 })).rows, req.ctx, starred),
    })
  }))

  r.patch('/api/guilds/:slug', need(), wrap(async (req, res) => {
    const { g, rank } = await load(req)
    needRank(rank, RANK.leader)
    const out = await guilds.update(g.id, req.body || {})
    res.json({ guild: await guilds.view(out) })
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
        await guilds.addMember(g.id, req.user.id, i.role === 'recruit' ? 'recruit' : 'member', { cap: await auth.guildCap() })
      } catch (e) {
        await guilds.untakeInvite(i.code)
        throw e
      }
    }
    res.json({ guild: await guilds.view(g) })
  }))

  // ---------- заявки ----------
  r.post('/api/guilds/:slug/requests', need(), wrap(async (req, res) => {
    const g = await guilds.get(req.params.slug)
    if (!g) throw fail('немає такої гільдії', 404)
    const cur = await guilds.current(req.user.id)
    if (cur?.guild_id === g.id) throw fail('ти вже в цій гільдії')
    await guilds.assertFree(req.user.id)
    if (!g.open) throw fail('гільдія не приймає заявок — потрібне запрошення', 403)
    await guilds.assertRoom(g.id, await auth.guildCap())
    await guilds.request(g.id, req.user.id, req.body?.note)
    res.status(201).json({ ok: true })
  }))
  r.delete('/api/guilds/:slug/requests', need(), wrap(async (req, res) => {
    const g = await guilds.get(req.params.slug)
    if (!g) throw fail('немає такої гільдії', 404)
    res.json({ ok: await guilds.dropRequest(g.id, req.user.id) })
  }))
  r.post('/api/guilds/:slug/requests/:uid', need(), wrap(async (req, res) => {
    const { g, rank } = await load(req)
    needRank(rank, RANK.officer)
    if (!(await guilds.requestOf(g.id, req.params.uid))) throw fail('немає такої заявки', 404)
    if (req.body?.accept) {
      // за цей час людина могла вступити деінде (тоді заявка зайва) чи гільдія — заповнитись
      if (await guilds.current(req.params.uid)) { await guilds.dropRequest(g.id, req.params.uid); throw fail('ця людина вже в гільдії', 409) }
      await guilds.addMember(g.id, req.params.uid, 'recruit', { cap: await auth.guildCap() })
    } else await guilds.dropRequest(g.id, req.params.uid)
    res.json({ ok: true })
  }))

  return r
}

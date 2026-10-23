/*
 * Розмови (/api/chats): список своїх (особисті, угоди, гільдійська) з непрочитаними, особиста розмова з людиною,
 * повідомлення (написати, відповісти, змінити своє 15 хв, видалити своє), реакції, «прочитано», «друкує…», без звуку,
 * блокування людини. Миттєво — WebSocket /api/chats/ws (lib/ws.mjs): нові / змінені / видалені повідомлення, реакції,
 * «друкує…», «прочитано». Панель керування — /api/admin/chats: будь-яка розмова лише для читання (дозвіл site.chats).
 *
 * Хто бачить і пише — за видом: особиста — двоє (заблокував хтось — писати не можна); гільдія — її учасники зараз;
 * угода — як скаже біржа (hooks.deal: сторони угоди, до прийняття — ті, хто веде оголошення; модератор за скаргою —
 * лише читає). Сповіщення про нове (особисті й угоди) — тим, хто не дивиться саме цю розмову й не вимкнув звук.
 */
import express from 'express'
import { EDIT_MIN, MAX_TEXT, pairRef, REACTIONS } from '../lib/chats.mjs'
import { acceptWs } from '../lib/ws.mjs'
import { createLimiter } from '../lib/auth.mjs'
import { fail, plain } from '../lib/util.mjs'
import { COOKIE, cookieOf, need, wrap } from './auth.mjs'

const WS_PATH = '/api/chats/ws'

export function createChatRoutes({ db, chats, auth, access, guilds, notifications, roles, hooks = {} }) {
  const r = express.Router()
  const writes = createLimiter({ max: 300, ms: 60 * 60_000 })
  const typingGap = new Map()

  // ---------- хто що може ----------
  /** доступ контексту ctx ({ user, ranks… }) до розмови: { read, write, members, … } (members — кому розсилати) */
  async function resolve(ctx, chat) {
    const uid = ctx?.user?.id
    if (!chat) return { read: false, write: false, members: [] }
    if (chat.kind === 'direct') {
      const pair = chat.ref.split(':')
      if (!uid || !pair.includes(uid)) return { read: false, write: false, members: pair }
      const other = pair.find((x) => x !== uid) ?? uid
      const b = await chats.blocks(uid, other)
      return { read: true, write: !b.byMe && !b.byThem, members: pair, other, blocked: b }
    }
    if (chat.kind === 'guild') {
      const rank = uid ? ctx.ranks?.get(chat.ref) || 0 : 0
      const members = (await guilds.members(chat.ref)).map((m) => m.id)
      return { read: rank >= 1, write: rank >= 1, members }
    }
    if (chat.kind === 'deal' && hooks.deal) return hooks.deal(ctx, chat)
    return { read: false, write: false, members: [] }
  }
  async function load(req) {
    const chat = await chats.get(req.params.id)
    const acc = chat ? await resolve(req.ctx, chat) : { read: false }
    if (!chat || !acc.read) throw fail('немає такої розмови', 404)
    // рядок учасника — для «прочитано» й «без звуку» (гільдійська: усе давнє — вже прочитане)
    if (!(await chats.member(chat.id, req.user.id))) {
      await chats.join(chat.id, req.user.id)
      if (chat.kind === 'guild') await chats.markRead(chat.id, req.user.id, Date.now())
    }
    return { chat, acc }
  }

  // ---------- люди ----------
  const people = async (ids) => {
    const list = [...new Set(ids.filter(Boolean))]
    const out = new Map()
    for (let i = 0; i < list.length; i += 400) {
      const part = list.slice(i, i + 400)
      for (const u of await db.all(`SELECT id, login, name, color FROM users WHERE id IN (${part.map(() => '?').join(',')})`, ...part)) out.set(u.id, { id: u.id, login: u.login, name: u.name, color: u.color })
    }
    return out
  }
  /** повідомлення для клієнта: хто (людина), цитата з її автором, реакції з «моя» */
  async function msgsView(list, uid) {
    const ps = await people(list.flatMap((m) => [m.user, m.quote?.user]))
    return list.map((m) => ({
      id: m.id, chat: m.chat, user: m.user ? ps.get(m.user) || null : null, text: m.text, at: m.at, edited: m.edited, deleted: m.deleted,
      reply: m.reply, quote: m.quote ? { ...m.quote, user: m.quote.user ? ps.get(m.quote.user) || null : null } : null,
      reactions: (m.reactions || []).map((x) => ({ emoji: x.emoji, n: x.n, mine: x.users.includes(uid) })),
    }))
  }
  /** розмова для клієнта: хто співрозмовник / яка гільдія / яка угода, непрочитані, чи можна писати */
  async function chatView(chat, acc, uid, unread = 0) {
    const me = await chats.member(chat.id, uid)
    const out = { id: chat.id, kind: chat.kind, lastAt: chat.lastAt, lastText: chat.lastText, unread, muted: !!me?.muted, canWrite: !!acc.write, created: chat.created }
    if (chat.lastUser) out.lastUser = (await people([chat.lastUser])).get(chat.lastUser) || null
    if (chat.kind === 'direct') {
      out.other = (await people([acc.other])).get(acc.other) || null
      out.blocked = acc.blocked
      // «переглянуто»: до якої миті прочитав співрозмовник
      out.otherRead = (await chats.member(chat.id, acc.other))?.lastRead ?? 0
    } else if (chat.kind === 'guild') {
      const g = await guilds.get(chat.ref)
      out.guild = g ? { id: g.id, slug: g.slug, name: g.name, tag: g.tag, color: g.color } : null
      out.members = acc.members.length
    } else if (chat.kind === 'deal') {
      out.deal = acc.deal || { id: chat.ref }
      const ps = await people(acc.members)
      out.others = acc.members.filter((x) => x !== uid).map((x) => ps.get(x)).filter(Boolean)
    }
    return out
  }

  // ---------- миттєві події (WebSocket) ----------
  /** id людини → її з'єднання ({ send, focus — яку розмову зараз дивиться }) */
  const socks = new Map()
  const sendTo = (uid, ev) => { for (const c of socks.get(uid) || []) c.send(ev) }
  const watching = (uid, chatId) => [...(socks.get(uid) || [])].some((c) => c.focus === chatId)
  const fanout = (members, ev, except = null) => { for (const uid of new Set(members)) if (uid !== except) sendTo(uid, ev) }

  /** «друкує…» — іншим учасникам, не частіше разу на 2 с від людини */
  async function typing(user, ctx, chatId) {
    const k = `${user.id}:${chatId}`
    if (Date.now() - (typingGap.get(k) || 0) < 2000) return
    typingGap.set(k, Date.now())
    const chat = await chats.get(chatId)
    const acc = chat ? await resolve(ctx, chat) : null
    if (!acc?.write) return
    fanout(acc.members, { t: 'typing', chat: chatId, user: { id: user.id, name: user.name } }, user.id)
  }

  /** під'єднати WebSocket до HTTP-сервера (index.mjs і тести) */
  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      if (!String(req.url || '').startsWith(WS_PATH)) return
      Promise.resolve().then(async () => {
        // лише з цього сайту (інакше чужа сторінка відкрила б з'єднання з cookie людини)
        const origin = req.headers.origin
        if (origin) {
          let host = ''
          try { host = new URL(origin).host.toLowerCase() } catch { /* хибний Origin */ }
          const ours = [req.headers.host, ...String(req.headers['x-forwarded-host'] || '').split(',')]
          try { ours.push(new URL(process.env.APP_URL || 'https://dune.test').host) } catch { /* хибний APP_URL */ }
          if (!host || !ours.map((h) => String(h || '').trim().toLowerCase()).includes(host)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
        }
        const s = await auth.bySession(cookieOf(req, COOKIE))
        if (!s?.user) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return }
        const conn = acceptWs(req, socket, head)
        if (!conn) return
        const user = s.user
        conn.focus = null
        conn.ctx = await access.ctxOf(user)
        conn.at = Date.now()
        if (!socks.has(user.id)) socks.set(user.id, new Set())
        socks.get(user.id).add(conn)
        conn.on('close', () => { socks.get(user.id)?.delete(conn); if (!socks.get(user.id)?.size) socks.delete(user.id) })
        conn.on('message', (text) => Promise.resolve().then(async () => {
          let ev
          try { ev = JSON.parse(text) } catch { return }
          // права (гільдія, ранги) — свіжі раз на хвилину; сеанс закрили — і з'єднання теж
          if (Date.now() - conn.at > 60_000) {
            if (!(await auth.sessionAlive(s.session.id).catch(() => true))) return conn.close(4001)
            conn.ctx = await access.ctxOf(await auth.get(user.id)); conn.at = Date.now()
          }
          if (ev.t === 'focus') {
            const chat = typeof ev.chat === 'string' ? await chats.get(ev.chat) : null
            conn.focus = chat && (await resolve(conn.ctx, chat)).read ? chat.id : null
          } else if (ev.t === 'typing' && typeof ev.chat === 'string') await typing(user, conn.ctx, ev.chat)
          else if (ev.t === 'ping') conn.send({ t: 'pong' })
        }).catch(() => {}))
        conn.send({ t: 'hello' })
      }).catch(() => socket.destroy())
    })
  }

  /** нове повідомлення: усім учасникам миттєво; сповіщення — тим, хто не дивиться цю розмову й не вимкнув звук */
  async function delivered(chat, acc, msg, sender) {
    const [view] = await msgsView([msg], null)
    for (const uid of new Set(acc.members)) {
      if (!uid) continue
      sendTo(uid, { t: 'msg', chat: chat.id, message: { ...view, reactions: [] } })
      if (uid === sender.id) continue
      // рядок учасника — щоб непрочитане рахувалось (гільдійська — лише в тих, хто її вже відкривав)
      if (chat.kind !== 'guild') await chats.join(chat.id, uid)
      const m = await chats.member(chat.id, uid)
      if (chat.kind === 'guild' || m?.muted || watching(uid, chat.id)) continue
      await notifications?.notify(uid, 'chat.message', { chat: chat.id, kind: chat.kind, from: sender.name, ...(acc.deal?.gid ? { gid: acc.deal.gid } : {}) }, { ref: chat.id }).catch(() => {})
    }
  }

  // ---------- HTTP ----------
  r.get('/api/chats', need(), wrap(async (req, res) => {
    const uid = req.user.id
    // гільдійська розмова моєї гільдії — завжди в списку
    const extra = []
    for (const gid of req.ctx.ranks.keys()) extra.push((await chats.ensure('guild', gid)).id)
    const list = await chats.listFor(uid, extra)
    const accs = await Promise.all(list.map((c) => resolve(req.ctx, c)))
    const seen = list.filter((c, i) => accs[i].read)
    const unread = await chats.unread(uid, seen.map((c) => c.id))
    // гільдійська, яку ще не відкривали: давнє — не «непрочитане»
    for (const c of seen) if (c.kind === 'guild' && !(await chats.member(c.id, uid))) unread.set(c.id, 0)
    const rows = await Promise.all(seen.map((c) => chatView(c, accs[list.indexOf(c)], uid, unread.get(c.id) || 0)))
    res.set('cache-control', 'no-store').json({ rows, unread: rows.reduce((n, x) => n + (x.muted ? 0 : x.unread), 0) })
  }))
  r.get('/api/chats/unread', need(), wrap(async (req, res) => {
    const list = (await chats.listFor(req.user.id)).filter((c) => c.kind !== 'guild')
    const accs = await Promise.all(list.map((c) => resolve(req.ctx, c)))
    const seen = list.filter((c, i) => accs[i].read)
    const unread = await chats.unread(req.user.id, seen.map((c) => c.id))
    let n = 0
    for (const c of seen) if (!(await chats.member(c.id, req.user.id))?.muted) n += unread.get(c.id) || 0
    res.set('cache-control', 'no-store').json({ n })
  }))

  /** особиста розмова з людиною (id чи логін): є — та сама, нема — нова */
  r.post('/api/chats/direct', need(), wrap(async (req, res) => {
    const who = String(req.body?.user || '')
    const u = (await auth.get(who)) || (await auth.byLogin(who))
    if (!u || u.banned) throw fail('немає такої людини', 404)
    if (u.id === req.user.id) throw fail('написати самому собі не можна')
    const chat = await chats.ensure('direct', pairRef(req.user.id, u.id))
    await chats.join(chat.id, req.user.id)
    res.json({ id: chat.id })
  }))
  /** розмова моєї гільдії */
  r.post('/api/chats/guild', need(), wrap(async (req, res) => {
    const gid = String(req.body?.guild || [...req.ctx.ranks.keys()][0] || '')
    if (!(req.ctx.ranks.get(gid) >= 1)) throw fail('ти не в цій гільдії', 403)
    res.json({ id: (await chats.ensure('guild', gid)).id })
  }))
  r.post('/api/chats/block', need(), wrap(async (req, res) => {
    const u = (await auth.get(String(req.body?.user || ''))) || (await auth.byLogin(String(req.body?.user || '')))
    if (!u || u.id === req.user.id) throw fail('немає такої людини', 404)
    await chats.block(req.user.id, u.id, req.body?.on !== false)
    const chat = await chats.byRef('direct', pairRef(req.user.id, u.id))
    if (chat) fanout([req.user.id, u.id], { t: 'chat', chat: chat.id })
    res.json({ blocked: req.body?.on !== false })
  }))

  r.get('/api/chats/:id', need(), wrap(async (req, res) => {
    const { chat, acc } = await load(req)
    const unread = (await chats.unread(req.user.id, [chat.id])).get(chat.id) || 0
    const page = await chats.messages(chat.id, { before: req.query.before ? Number(req.query.before) : null })
    res.set('cache-control', 'no-store').json({ chat: await chatView(chat, acc, req.user.id, unread), messages: await msgsView(page.rows, req.user.id), more: page.more })
  }))
  r.get('/api/chats/:id/messages', need(), wrap(async (req, res) => {
    const { chat } = await load(req)
    const page = await chats.messages(chat.id, { before: req.query.before ? Number(req.query.before) : null })
    res.json({ messages: await msgsView(page.rows, req.user.id), more: page.more })
  }))

  /** текст повідомлення: обрізаний, не порожній; у розмові угоди — без ознак торгівлі за реальні гроші */
  const textOf = (chat, v) => {
    const text = plain(v, MAX_TEXT, true)
    if (!text) throw fail('порожнє повідомлення')
    const hit = chat.kind === 'deal' && hooks.rmt ? hooks.rmt(text) : null
    if (hit) throw fail('схоже на торгівлю за реальні гроші («{word}») — на біржі це заборонено', 400, { word: hit })
    return text
  }
  const canWrite = (acc) => {
    if (acc.write) return
    if (acc.blocked?.byMe) throw fail('ти заблокував цю людину — розблокуй, щоб писати', 403)
    if (acc.blocked?.byThem) throw fail('ця людина обмежила, хто може їй писати', 403)
    throw fail(acc.why || 'писати в цю розмову тобі не можна', 403)
  }

  r.post('/api/chats/:id/messages', need(), wrap(async (req, res) => {
    if (!writes.hit(req.user.id)) throw fail('забагато повідомлень за годину — спробуй трохи згодом', 429)
    const { chat, acc } = await load(req)
    canWrite(acc)
    const text = textOf(chat, req.body?.text)
    let reply = null
    if (typeof req.body?.reply === 'string') {
      const q = await chats.message(req.body.reply)
      if (q?.chat === chat.id) reply = q.id
    }
    const m = await chats.add(chat.id, req.user.id, text, reply)
    await chats.markRead(chat.id, req.user.id, m.at)
    const [full] = await chats.decorate([m])
    await delivered(chat, acc, full, req.user)
    const [view] = await msgsView([full], req.user.id)
    res.status(201).json(view)
  }))
  r.patch('/api/chats/:id/messages/:mid', need(), wrap(async (req, res) => {
    const { chat, acc } = await load(req)
    const m = await chats.message(req.params.mid)
    if (!m || m.chat !== chat.id || m.user !== req.user.id || m.deleted) throw fail('немає такого повідомлення', 404)
    if (Date.now() - m.at > EDIT_MIN * 60_000) throw fail('змінити можна протягом {n} хв після надсилання', 409, { n: EDIT_MIN })
    canWrite(acc)
    const [full] = await chats.decorate([await chats.edit(m.id, textOf(chat, req.body?.text))])
    const [view] = await msgsView([full], req.user.id)
    fanout(acc.members, { t: 'edit', chat: chat.id, message: { ...view, reactions: view.reactions.map(({ mine, ...x }) => x) } })
    res.json(view)
  }))
  r.delete('/api/chats/:id/messages/:mid', need(), wrap(async (req, res) => {
    const { chat, acc } = await load(req)
    const m = await chats.message(req.params.mid)
    if (!m || m.chat !== chat.id || m.user !== req.user.id) throw fail('немає такого повідомлення', 404)
    await chats.remove(m.id)
    fanout(acc.members, { t: 'del', chat: chat.id, id: m.id })
    res.json({ ok: true })
  }))
  r.post('/api/chats/:id/messages/:mid/react', need(), wrap(async (req, res) => {
    const { chat, acc } = await load(req)
    canWrite(acc)
    const m = await chats.message(req.params.mid)
    if (!m || m.chat !== chat.id || m.deleted) throw fail('немає такого повідомлення', 404)
    if (!REACTIONS.includes(req.body?.emoji)) throw fail('такої реакції нема')
    const list = await chats.react(m.id, req.user.id, req.body.emoji, req.body?.on !== false)
    fanout(acc.members, { t: 'react', chat: chat.id, id: m.id, reactions: list.map((x) => ({ emoji: x.emoji, n: x.n, users: x.users })) })
    res.json({ reactions: list.map((x) => ({ emoji: x.emoji, n: x.n, mine: x.users.includes(req.user.id) })) })
  }))
  /** прочитано до at (за замовчуванням — усе): співрозмовникам — «переглянуто», своїм вкладкам — новий лічильник */
  r.post('/api/chats/:id/read', need(), wrap(async (req, res) => {
    const { chat, acc } = await load(req)
    const at = Math.min(Date.now(), Number(req.body?.at) || Date.now())
    await chats.markRead(chat.id, req.user.id, at)
    fanout(acc.members, { t: 'read', chat: chat.id, user: req.user.id, at })
    res.json({ ok: true })
  }))
  r.post('/api/chats/:id/typing', need(), wrap(async (req, res) => {
    await typing(req.user, req.ctx, req.params.id)
    res.json({ ok: true })
  }))
  r.post('/api/chats/:id/mute', need(), wrap(async (req, res) => {
    const { chat } = await load(req)
    await chats.mute(chat.id, req.user.id, req.body?.on !== false)
    sendTo(req.user.id, { t: 'chat', chat: chat.id })
    res.json({ muted: req.body?.on !== false })
  }))

  // ---------- панель керування: будь-яка розмова, лише читання ----------
  const adminOnly = async (req) => { if (!(await roles.can(req.user, 'site.chats'))) throw fail('бракує прав', 403) }
  r.get('/api/admin/chats', need(), wrap(async (req, res) => {
    await adminOnly(req)
    const { rows, total } = await chats.listAll({ kind: String(req.query.kind || ''), q: String(req.query.q || ''), offset: Number(req.query.offset) || 0 })
    const sys = { user: { id: '', role: 'admin' }, ranks: new Map(), superuser: true }
    const out = await Promise.all(rows.map(async (c) => {
      const acc = await resolve(sys, c)
      const ps = await people(c.kind === 'direct' ? c.ref.split(':') : acc.members?.slice(0, 6) || [])
      const g = c.kind === 'guild' ? await guilds.get(c.ref) : null
      return { id: c.id, kind: c.kind, ref: c.ref, lastAt: c.lastAt, lastText: c.lastText, created: c.created, messages: await chats.count(c.id), people: [...ps.values()], guild: g ? { name: g.name, tag: g.tag, color: g.color } : null, deal: acc.deal || null }
    }))
    res.json({ rows: out, total })
  }))
  r.get('/api/admin/chats/:id', need(), wrap(async (req, res) => {
    await adminOnly(req)
    const chat = await chats.get(req.params.id)
    if (!chat) throw fail('немає такої розмови', 404)
    const sys = { user: { id: '', role: 'admin' }, ranks: new Map(), superuser: true }
    const acc = await resolve(sys, chat)
    const page = await chats.messages(chat.id, { before: req.query.before ? Number(req.query.before) : null })
    const ps = await people(chat.kind === 'direct' ? chat.ref.split(':') : acc.members || [])
    res.json({ chat: { id: chat.id, kind: chat.kind, ref: chat.ref, lastAt: chat.lastAt, created: chat.created, people: [...ps.values()], deal: acc.deal || null, canWrite: false, readOnly: true }, messages: await msgsView(page.rows, null), more: page.more })
  }))

  return { router: r, attach, resolve, sendTo }
}


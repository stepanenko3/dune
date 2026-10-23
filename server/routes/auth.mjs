/*
 * Вхід і профіль.
 *   sessionMiddleware — людина з cookie сеансу (req.user, req.session, req.ctx — контекст доступу);
 *   sameSite — зміни (POST/PUT/PATCH/DELETE) лише з самого сайту: Sec-Fetch-Site чи Origin проти Host;
 *   POST /api/auth/code { email } — код у лист; POST /api/auth/verify { email, code } — вхід (нова пошта — нова
 *   людина, якщо реєстрацію не закрито); POST /api/auth/logout; GET/PATCH /api/me; сеанси; видалення себе;
 *   GET /api/users/:login — сторінка людини (публічне). Паскеї й двофакторна перевірка — routes/security.mjs: з увімкненою
 *   перевіркою /api/auth/verify відповідає { twoFactor, ticket } — сеанс відкриває /api/auth/2fa з кодом застосунку.
 * У /api/me гільдія людини — `guild` (одна, з роллю, чи null); `guilds` — той самий вибір масивом з 0–1 елемента.
 */
import express from 'express'
import { createLimiter, normEmail, publicUser, SESSION_MS } from '../lib/auth.mjs'
import { closedLetter, codeLetter } from '../lib/mail.mjs'
import { fail } from '../lib/util.mjs'
import { mountSecurity } from './security.mjs'

export const COOKIE = 'sw_session'

export const cookieOf = (req, name) => {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}
const isHttps = (req) => req.secure || req.get('x-forwarded-proto') === 'https' || /^https:/.test(req.get('origin') || req.get('referer') || '')
const setCookie = (req, res, token) =>
  res.append('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}${isHttps(req) ? '; Secure' : ''}`)
const clearCookie = (req, res) => res.append('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`)
const ipOf = (req) => req.ip || req.socket?.remoteAddress || ''
export const wrap = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next)

export function sessionMiddleware({ auth, access }) {
  return (req, res, next) => {
    Promise.resolve()
      .then(async () => {
        const token = cookieOf(req, COOKIE)
        const s = await auth.bySession(token)
        req.user = s?.user || null
        req.session = s?.session || null
        if (s?.extended) setCookie(req, res, token)
        // t і lang — щоб тексти, які реєстр речей віддає людям (напр. «Гільдію видалено»), були її мовою
        req.ctx = { ...(await access.ctxOf(req.user)), t: req.t, lang: req.lang }
      })
      .then(() => next(), next)
  }
}

/**
 * адреси, з якими браузер міг прийти до нас: Host, а за проксі (dune.test → Vite → API, LAN-доступ з телефона) —
 * X-Forwarded-Host, бо Vite переписує Host на адресу API; плюс APP_URL
 */
export function ourHosts(req) {
  const list = [req.get('host'), ...String(req.get('x-forwarded-host') || '').split(',')]
  try { list.push(new URL(process.env.APP_URL || 'https://dune.test').host) } catch { /* хибний APP_URL */ }
  return list.map((h) => String(h || '').trim().toLowerCase()).filter(Boolean)
}

/**
 * підробка запитів з чужих сайтів: зміни приймаємо лише з того самого сайту. Sec-Fetch-Site браузер шле лише на
 * https (і localhost) — по http з телефона в локальній мережі лишається Origin, і його звіряємо з ourHosts
 */
export function sameSite() {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
    const site = req.get('sec-fetch-site')
    if (site) return site === 'same-origin' || site === 'same-site' || site === 'none' ? next() : next(fail('запит не з цього сайту', 403))
    const origin = req.get('origin')
    if (origin) {
      let host = ''
      try { host = new URL(origin).host.toLowerCase() } catch { /* хибний Origin */ }
      if (!host || !ourHosts(req).includes(host)) return next(fail('запит не з цього сайту', 403))
    }
    next()
  }
}

/** потрібен вхід (і, якщо задано, роль на сайті) */
export const need = (...roles) => (req, res, next) => {
  if (!req.user) return next(fail('потрібно увійти', 401))
  if (roles.length && !roles.includes(req.user.role)) return next(fail('бракує прав', 403))
  next()
}

export function createAuthRoutes({ auth, security, guilds, items, roles, content, mailer, onFirst, removeUser, site = 'dune.test' }) {
  /** назва ролі на сайті (своя роль — її назва; вбудовані перекладає клієнт) */
  const roleName = async (role) => (role && role !== 'user' && roles ? (await roles.list()).find((r) => r.key === role)?.name ?? null : null)
  const r = express.Router()
  const codeIp = createLimiter({ max: 10, ms: 15 * 60_000 })
  const codeMail = createLimiter({ max: 5, ms: 60 * 60_000 })
  const verifyIp = createLimiter({ max: 30, ms: 15 * 60_000 })
  // і на пошту: код до однієї адреси не підбирають з багатьох IP
  const verifyMail = createLimiter({ max: 10, ms: 15 * 60_000 })
  // листів на одну пошту — не більше 20 на добу, а всього — 2000 на добу (поштова служба не забанить сайт за розсилку)
  const codeMailDay = createLimiter({ max: 20, ms: 24 * 3600_000 })
  const mailDay = createLimiter({ max: 2000, ms: 24 * 3600_000 })
  const tooMany = () => fail('забагато спроб — спробуй трохи згодом', 429)
  const banned = (u) => (u.ban_reason ? fail('обліковий запис заблоковано: {reason}', 403, { reason: u.ban_reason }) : fail('обліковий запис заблоковано', 403))

  /** відкрити сеанс і відповісти, як /api/me (+ extra); passkeys — скільки в людини паскеїв (сторінка входу пропонує створити) */
  async function signIn(req, res, u, extra = {}, status = 200) {
    if (u.banned) throw banned(u)
    // вхід на пристрої, де вже був чийсь сеанс (свій чи чужий), — старий закриваємо, щоб не висів у «Де ти увійшов»
    const prevToken = cookieOf(req, COOKIE)
    if (prevToken) await auth.closeSession(prevToken)
    setCookie(req, res, await auth.openSession(u.id, { agent: req.get('user-agent'), ip: ipOf(req) }))
    const passkeys = security ? await security.passkeys.count(u.id) : 0
    res.status(status).json({ ...(await me(u)), created: false, ...extra, passkeys })
  }

  const me = async (u) => {
    const guild = u ? await guilds.ofOne(u.id) : null
    return {
      // perms — дозволи ролі: що показувати (панель керування) вирішують вони, а не назва ролі
      user: u ? { ...publicUser(u, true), roleName: await roleName(u.role), perms: roles ? [...(await roles.permsOf(u.role))] : [] } : null,
      guild,
      guilds: guild ? [guild] : [],
      requests: u ? await guilds.requestsOfUser(u.id) : [],
      site: {
        registration: (await auth.count()) === 0 ? 'open' : await auth.settings.get('registration', 'open'),
        defaultLang: await auth.settings.get('defaultLang', 'uk'),
        name: await auth.settings.get('siteName', 'Sandwalkers'),
        guildCap: await auth.guildCap(),
      },
    }
  }

  r.get('/api/me', wrap(async (req, res) => res.set('cache-control', 'no-store').json(await me(req.user))))

  /** код у лист: і для входу, і для нової людини */
  r.post('/api/auth/code', wrap(async (req, res) => {
    const email = normEmail(req.body?.email)
    if (!codeIp.hit(ipOf(req)) || !codeMail.hit(email) || !codeMailDay.hit(email) || !mailDay.hit('all')) throw tooMany()
    // відповідь однакова для будь-якої пошти: сторонній не дізнається, чи є така людина (чи заблокована вона);
    // що це нова пошта чи що реєстрацію закрито — каже сам лист, а блокування — вже після введення коду
    const known = await auth.byEmail(email)
    const name = await auth.settings.get('siteName', 'Sandwalkers')
    const closed = !known && (await auth.count()) > 0 && (await auth.settings.get('registration', 'open')) !== 'open'
    const letter = closed ? closedLetter({ site, name, t: req.t }) : codeLetter(await auth.makeCode(email), { site, name, t: req.t, fresh: !known })
    try {
      await mailer.send({ to: email, ...letter })
    } catch (e) {
      // причину (SMTP) бачить лише журнал сервера; людині — що робити
      console.warn('[mail] не вдалося надіслати код:', String(e?.message || e).split('\n')[0])
      return res.status(502).json({ error: req.t('не вдалося надіслати лист — спробуй ще раз трохи згодом') })
    }
    res.json({ ok: true })
  }))

  /** код із листа → вхід; немає людини з такою поштою — з'являється */
  r.post('/api/auth/verify', wrap(async (req, res) => {
    const email = normEmail(req.body?.email)
    if (!verifyIp.hit(ipOf(req)) || !verifyMail.hit(email)) throw tooMany()
    await auth.checkCode(email, req.body?.code)
    let u = await auth.byEmail(email)
    let created = false
    if (!u) {
      if ((await auth.count()) > 0 && (await auth.settings.get('registration', 'open')) !== 'open') throw fail('реєстрацію зараз закрито', 403)
      const r0 = await auth.create(email)
      u = r0.user
      created = true
      if (r0.first) await onFirst?.(u)
      u = await auth.get(u.id)
    }
    if (u.banned) throw banned(u)
    // увімкнено двофакторну перевірку — пошту підтверджено, але сеанс відкриє лише код застосунку (/api/auth/2fa)
    if (security && !created && (await security.twoFactor.on(u.id))) return res.json({ twoFactor: true, ticket: await security.tickets.make(u.id) })
    await signIn(req, res, u, { created }, created ? 201 : 200)
  }))

  if (security) mountSecurity(r, { auth, security, need, wrap, me, signIn, ipOf })

  r.post('/api/auth/logout', wrap(async (req, res) => {
    await auth.closeSession(cookieOf(req, COOKIE))
    clearCookie(req, res)
    res.json({ ok: true })
  }))

  r.patch('/api/me', need(), wrap(async (req, res) => {
    res.json(await me(await auth.updateProfile(req.user.id, req.body || {})))
  }))

  r.get('/api/me/sessions', need(), wrap(async (req, res) =>
    res.json({ rows: (await auth.sessions(req.user.id)).map((s) => ({ id: s.id.slice(0, 16), created: s.created, seen: s.seen, agent: s.agent, ip: s.ip, current: s.id === req.session.id })) })))
  r.delete('/api/me/sessions/:id', need(), wrap(async (req, res) => {
    const s = String(req.params.id).length >= 16 && (await auth.sessions(req.user.id)).find((x) => x.id.startsWith(String(req.params.id)))
    if (!s) throw fail('немає такого сеансу', 404)
    await auth.closeSessionById(req.user.id, s.id)
    res.json({ ok: true })
  }))
  r.post('/api/me/sessions/others', need(), wrap(async (req, res) => {
    await auth.closeOtherSessions(req.user.id, req.session.id)
    res.json({ ok: true })
  }))

  /** видалити себе — підтвердження своєю поштою; особисте зникає, гільдії, де ти лідер, — іншим */
  r.delete('/api/me', need(), wrap(async (req, res) => {
    if (normEmail(req.body?.confirm) !== req.user.email) throw fail('для підтвердження введи свою пошту')
    if (req.user.role === 'admin' && (await auth.admins()) < 2) throw fail('ти єдиний адміністратор — спершу признач іншого')
    await removeUser(req.user.id)
    res.locals.forgetActor = true
    clearCookie(req, res)
    res.json({ ok: true })
  }))

  /** сторінка людини: профіль, гільдії, публічне */
  /** усе своє одним файлом: профіль, свої речі з вмістом, гільдія, сеанси, зірки (видалити все — у профілі) */
  r.get('/api/me/export', need(), wrap(async (req, res) => {
    const u = req.user
    const own = await items.ownedBy({ kind: 'user', id: u.id })
    const things = await Promise.all(own.map(async (it) => ({
      kind: it.kind, id: it.id, title: it.title, visibility: it.visibility, created: it.created, updated: it.updated,
      doc: content ? await content.H[it.kind]?.read(it.id).catch(() => null) : null,
    })))
    const starred = await items.starredBy(u.id)
    res.set('cache-control', 'no-store')
    res.set('content-disposition', `attachment; filename="sandwalkers-${u.login}.json"`)
    res.json({
      exportedAt: new Date().toISOString(),
      profile: publicUser(u, true),
      guild: await guilds.ofOne(u.id),
      sessions: (await auth.sessions(u.id)).map((s) => ({ created: s.created, seen: s.seen, agent: s.agent, ip: s.ip })),
      // паскеї — без ключів (лише назви й дати), двофакторна перевірка — лише чи ввімкнена
      ...(security ? { passkeys: (await security.passkeys.list(u.id)).map(({ name, created, lastUsed, backedUp }) => ({ name, created, lastUsed, backedUp })), twoFactor: (await security.twoFactor.status(u.id)).enabled } : {}),
      stars: starred ? [...starred] : [],
      items: things,
    })
  }))

  r.get('/api/users/:login', wrap(async (req, res) => {
    const u = await auth.byLogin(req.params.login)
    if (!u) throw fail('немає такої людини', 404)
    const starred = await items.starredBy(req.user?.id)
    // склад гільдії стороннім не показують (див. сторінку гільдії) — тож і тут рядових учасників видно лише своїм
    const mine = new Set(req.ctx?.ranks ? [...req.ctx.ranks.keys()] : [])
    const staff = req.user?.role === 'admin' || !!req.ctx?.superuser
    res.json({
      user: { ...publicUser(u), roleName: await roleName(u.role) },
      guilds: (await guilds.of(u.id)).filter((g) => staff || mine.has(g.id) || g.role === 'leader' || g.role === 'officer').map(({ id, slug, name, tag, color, role }) => ({ id, slug, name, tag, color, role })),
      items: await items.views((await items.library({ owner: { kind: 'user', id: u.id }, limit: 100 })).rows, req.ctx, starred),
    })
  }))

  return r
}

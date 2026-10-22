/*
 * Облікові записи: люди, сеанси, коди входу з пошти, налаштування сайту й журнал дій.
 *
 * Вхід і реєстрація — одне й те саме: пошта → 6-значний код у листі (діє 10 хв, 5 спроб, новий — не частіше, ніж
 * раз на 45 с) → вхід; немає людини з такою поштою — з'являється (якщо реєстрацію не закрито). Паролів нема.
 * Логін для адреси сторінки (/u/<логін>) і ім'я — з пошти, змінити можна в профілі. У базі лише хеші кодів і токенів
 * сеансів. Сеанс живе 30 днів і подовжується, поки ним користуються. Перший — адміністратор сайту.
 */
import crypto from 'node:crypto'
import { color, fail, newId, paletteFor, plain } from './util.mjs'
import { langOf } from './gamedata.mjs'

const DAY = 86400_000
export const SESSION_MS = 30 * DAY
export const ROLES = ['user', 'moderator', 'admin']
export const LOGIN_RE = /^[a-z0-9][a-z0-9_.-]{2,23}$/
/** логіни служб сайту (без «.», «_», «-»): їх не взяти собі */
const RESERVED = new Set(['admin', 'administrator', 'root', 'support', 'help', 'moderator', 'mod', 'staff', 'system', 'official', 'sandwalkers', 'sandwalker', 'api', 'me', 'null', 'undefined'])
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const CODE_MS = 10 * 60_000, CODE_TRIES = 5, CODE_GAP = 45_000

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
export const normEmail = (e) => String(e || '').trim().toLowerCase()

/** ліміт учасників гільдії за замовчуванням — як у грі (змінюється налаштуванням сайту guildCap) */
export const GUILD_CAP = 32

/** людина для клієнта; full — ще й пошта, гільдія людини (mainGuild) й службове (для себе й адміністратора) */
export function publicUser(u, full = false) {
  if (!u) return null
  const out = { id: u.id, login: u.login, name: u.name, nick: u.nick, bio: u.bio, color: u.color, role: u.role, created: u.created }
  if (full) Object.assign(out, { email: u.email, mainGuild: u.main_guild || null, banned: u.banned || null, banReason: u.ban_reason || '', seen: u.seen || null, lang: u.lang || null })
  return out
}

export async function createAuth(db, { codeGap = CODE_GAP } = {}) {
  // давня таблиця людей з паролями (порожня — облікові записи тоді ще ніхто не завів) — замінити новою
  try { await db.get('SELECT email FROM users LIMIT 1') } catch {
    const n = (await db.get('SELECT COUNT(*) AS n FROM users').catch(() => ({ n: 0 }))).n
    if (!n) await db.exec('DROP TABLE IF EXISTS users; DROP TABLE IF EXISTS resets;')
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, nick TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '', color TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', main_guild TEXT, decree TEXT,
      banned BIGINT, ban_reason TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL, seen BIGINT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created BIGINT NOT NULL, seen BIGINT NOT NULL,
      expires BIGINT NOT NULL, agent TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);
    CREATE TABLE IF NOT EXISTS login_codes (email TEXT PRIMARY KEY, code TEXT NOT NULL, expires BIGINT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, sent BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (
      id {{SERIAL}}, at BIGINT NOT NULL, actor TEXT, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS audit_by_actor ON audit (actor, id);
    CREATE INDEX IF NOT EXISTS audit_by_at ON audit (at);
    CREATE INDEX IF NOT EXISTS audit_by_action ON audit (action, id);
    CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `)
  // мова сайту людини (порожньо — з браузера)
  await db.addColumn('users', 'lang', 'TEXT')
  await db.run('DELETE FROM sessions WHERE expires < ?', Date.now())
  await db.run('DELETE FROM login_codes WHERE expires < ?', Date.now())

  const get = async (id) => (id ? (await db.get('SELECT * FROM users WHERE id = ?', id)) || null : null)
  const byLogin = async (login) => (await db.get('SELECT * FROM users WHERE login = ?', String(login || '').trim().toLowerCase())) || null
  const byEmail = async (email) => (await db.get('SELECT * FROM users WHERE email = ?', normEmail(email))) || null
  const count = async () => (await db.get('SELECT COUNT(*) AS n FROM users')).n

  /** логін з пошти: латиниця, цифри, «_.-», 3–24 знаки, вільний */
  /** вільний логін «sw-xxxxx» (випадковий) */
  async function freshLogin() {
    for (;;) {
      const login = 'sw-' + crypto.randomBytes(4).toString('hex').slice(0, 5)
      if (!(await byLogin(login))) return login
    }
  }

  /** зміни профілю: лише відомі поля, очищені */
  async function cleanProfile(id, p) {
    const out = {}
    if ('name' in p) { out.name = plain(p.name, 40); if (!out.name) throw fail("ім'я не може бути порожнім") }
    if ('nick' in p) out.nick = plain(p.nick, 40)
    if ('lang' in p) out.lang = p.lang ? langOf(p.lang) : null
    if ('bio' in p) out.bio = plain(p.bio, 500, true)
    if ('color' in p) { out.color = color(p.color); if (!out.color) throw fail('хибний колір') }
    if ('login' in p) {
      out.login = String(p.login || '').trim().toLowerCase()
      if (!LOGIN_RE.test(out.login)) throw fail('адреса сторінки — 3–24 знаки: латинські літери, цифри, «_», «.», «-»')
      // адреси, що видавали б себе за сайт чи його службу (чужу сторінку «/u/admin» легко прийняти за офіційну)
      const was = (await get(id))?.login
      if (RESERVED.has(out.login.replace(/[._-]/g, '')) && out.login !== was) throw fail('така адреса зарезервована — обери іншу')
      const other = await byLogin(out.login)
      if (other && other.id !== id) throw fail('така адреса вже зайнята', 409)
    }
    return out
  }

  const settings = {
    get: async (k, def) => { const r = await db.get('SELECT v FROM settings WHERE k = ?', k); return r ? JSON.parse(r.v) : def },
    set: (k, v) => db.run('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v)),
  }

  return {
    get,
    byLogin,
    byEmail,
    count,
    settings,

    // ---------- коди входу ----------
    /** новий код для пошти (його шлють листом); повертає сам код */
    async makeCode(email) {
      email = normEmail(email)
      if (email.length > 254 || !EMAIL_RE.test(email)) throw fail('це не схоже на пошту')
      const cur = await db.get('SELECT sent FROM login_codes WHERE email = ?', email)
      // already — код уже в листі: сторінка входу одразу переходить до його введення
      if (cur && Date.now() - cur.sent < codeGap) throw fail('код уже надіслано — новий можна через {n} с', 429, { n: Math.ceil((codeGap - (Date.now() - cur.sent)) / 1000), already: 1 })
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
      const now = Date.now()
      await db.run(`INSERT INTO login_codes (email, code, expires, tries, sent) VALUES (?, ?, ?, 0, ?)
        ON CONFLICT (email) DO UPDATE SET code = excluded.code, expires = excluded.expires, tries = 0, sent = excluded.sent`, email, sha(`${email}:${code}`), now + CODE_MS, now)
      return code
    },
    /** перевірити код; правильний — зникає (одноразовий) */
    async checkCode(email, code) {
      email = normEmail(email)
      const r = await db.get('SELECT * FROM login_codes WHERE email = ?', email)
      if (!r || r.expires < Date.now()) throw fail('код недійсний або вже минув — надішли новий', 400)
      // спроба рахується ДО порівняння й одним запитом: паралельні запити не обійдуть ліміт спроб
      const took = await db.get('UPDATE login_codes SET tries = tries + 1 WHERE email = ? AND tries < ? RETURNING tries', email, CODE_TRIES)
      if (!took) { await db.run('DELETE FROM login_codes WHERE email = ?', email); throw fail('забагато спроб — надішли новий код', 429) }
      const want = Buffer.from(r.code, 'hex'), got = Buffer.from(sha(`${email}:${String(code || '').replace(/\D/g, '')}`), 'hex')
      if (!crypto.timingSafeEqual(want, got)) throw fail('невірний код (спроб лишилось: {n})', 400, { n: Math.max(0, CODE_TRIES - Number(took.tries)) })
      // код одноразовий: забирає його лише один запит
      if (!(await db.run('DELETE FROM login_codes WHERE email = ? AND code = ?', email, r.code)).changes) throw fail('код недійсний або вже минув — надішли новий', 400)
    },
    /** нова людина з пошти; перший — адміністратор */
    async create(email) {
      email = normEmail(email)
      const first = (await count()) === 0
      const id = newId('u')
      // логін і ім'я — нейтральні, не з пошти (інакше пів адреси пошти стає публічним); людина змінює їх у профілі,
      // куди сайт веде одразу після першого входу
      const login = await freshLogin()
      await db.run('INSERT INTO users (id, email, login, name, color, role, created) VALUES (?, ?, ?, ?, ?, ?, ?)', id, email, login, `Sandwalker ${login.slice(3).toUpperCase()}`, paletteFor(email), first ? 'admin' : 'user', Date.now())
      return { user: await get(id), first }
    },

    // ---------- профіль і ролі ----------
    async updateProfile(id, patch) {
      const p = await cleanProfile(id, patch || {})
      const keys = Object.keys(p)
      if (keys.length) await db.run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => p[k]), id)
      return get(id)
    },
    /**
     * Гільдія людини (users.main_guild) — завжди та одна, у якій вона є: цей виклик лише перечитує її з членства
     * (значення, яке передали, не береться — хто в якій гільдії, вирішує вступ і вихід, а не поле в профілі).
     */
    setMainGuild: (id) => db.run('UPDATE users SET main_guild = (SELECT m.guild_id FROM members m WHERE m.user_id = users.id) WHERE id = ?', id),
    /** ліміт учасників гільдії: налаштування сайту guildCap (хибне чи менше за 1 — як у грі, 32) */
    async guildCap() {
      const n = Math.floor(Number(await settings.get('guildCap', GUILD_CAP)))
      return n >= 1 ? n : GUILD_CAP
    },
    setDecree: (id, d) => db.run('UPDATE users SET decree = ? WHERE id = ?', d ? JSON.stringify(d) : null, id),
    async setRole(id, role) {
      // ролі — з таблиці roles (server/lib/roles.mjs); без неї (давні тести) — вбудовані
      const known = (await db.get('SELECT key FROM roles WHERE key = ?', role).catch(() => null)) || ROLES.includes(role)
      if (!known) throw fail('невідома роль')
      await db.run('UPDATE users SET role = ? WHERE id = ?', role, id)
    },
    async ban(id, reason) {
      await db.run('UPDATE users SET banned = ?, ban_reason = ? WHERE id = ?', Date.now(), plain(reason, 300), id)
      await db.run('DELETE FROM sessions WHERE user_id = ?', id)
    },
    unban: (id) => db.run("UPDATE users SET banned = NULL, ban_reason = '' WHERE id = ?", id),
    async remove(id) {
      const u = await get(id)
      await db.run('DELETE FROM sessions WHERE user_id = ?', id)
      if (u) await db.run('DELETE FROM login_codes WHERE email = ?', u.email)
      await db.run('DELETE FROM users WHERE id = ?', id)
    },
    admins: async () => (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")).n,
    async list({ q: text = '', limit = 50, offset = 0 } = {}) {
      const like = `%${String(text).trim().toLowerCase()}%`
      const W = 'WHERE login LIKE ? OR email LIKE ? OR lower(name) LIKE ? OR lower(nick) LIKE ?'
      const rows = await db.all(`SELECT * FROM users ${W} ORDER BY created DESC LIMIT ? OFFSET ?`, like, like, like, like, Math.min(200, limit), offset)
      const total = (await db.get(`SELECT COUNT(*) AS n FROM users ${W}`, like, like, like, like)).n
      return { rows, total }
    },

    // ---------- сеанси ----------
    /** новий сеанс: токен — для cookie (у базі лише його хеш) */
    async openSession(userId, { agent = '', ip = '' } = {}) {
      const token = crypto.randomBytes(32).toString('base64url')
      const now = Date.now()
      await db.run('INSERT INTO sessions (id, user_id, created, seen, expires, agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)', sha(token), userId, now, now, now + SESSION_MS, String(agent).slice(0, 200), String(ip).slice(0, 64))
      await db.run('UPDATE users SET seen = ? WHERE id = ?', now, userId)
      return token
    },
    /** людина за токеном: { user, session } або null (сеансу нема, сплив, людину заблоковано) */
    async bySession(token) {
      if (!token || token.length > 100) return null
      const s = await db.get('SELECT * FROM sessions WHERE id = ?', sha(token))
      if (!s) return null
      const now = Date.now()
      if (s.expires < now) { await db.run('DELETE FROM sessions WHERE id = ?', s.id); return null }
      const u = await get(s.user_id)
      if (!u || u.banned) { await db.run('DELETE FROM sessions WHERE id = ?', s.id); return null }
      // подовжуємо не частіше, ніж раз на 10 хвилин — щоб не писати в базу на кожен запит; extended — cookie теж
      // треба подовжити, інакше браузер викине її через 30 днів після входу, хоч людина й заходить щодня
      let extended = false
      if (now - s.seen > 10 * 60_000) {
        await db.run('UPDATE sessions SET seen = ?, expires = ? WHERE id = ?', now, now + SESSION_MS, s.id)
        await db.run('UPDATE users SET seen = ? WHERE id = ?', now, u.id)
        extended = true
      }
      return { user: u, session: s, extended }
    },
    /** чи сеанс ще живий (не закритий, не сплив, людину не заблоковано) — для живих оновлень */
    async sessionAlive(id) {
      const r = await db.get('SELECT s.expires, u.banned FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?', id)
      return !!r && r.expires > Date.now() && !r.banned
    },
    closeSession: (token) => (token ? db.run('DELETE FROM sessions WHERE id = ?', sha(token)) : null),
    closeSessionById: (userId, id) => db.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', id, userId),
    closeOtherSessions: (userId, keepId) => db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', userId, keepId),
    sessions: (userId) => db.all('SELECT * FROM sessions WHERE user_id = ? AND expires > ? ORDER BY seen DESC', userId, Date.now()),

    // ---------- журнал ----------
    log: (actor, action, target = '', detail = '') =>
      db.run('INSERT INTO audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)', Date.now(), actor || null, action, String(target), String(detail).slice(0, 500)),
    audit: ({ limit = 100, offset = 0 } = {}) =>
      db.all('SELECT a.*, u.login AS actor_login, u.name AS actor_name FROM audit a LEFT JOIN users u ON u.id = a.actor ORDER BY a.id DESC LIMIT ? OFFSET ?', Math.min(500, limit), offset),
  }
}

/** обмеження спроб: не більше max за вікно ms на ключ (IP, пошта) */
export function createLimiter({ max, ms }) {
  const hits = new Map()
  const sweep = setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.until < now) hits.delete(k) }, ms)
  sweep.unref?.()
  return {
    /** true — ще можна; false — забагато */
    hit(key) {
      const now = Date.now()
      const h = hits.get(key)
      if (!h || h.until < now) { hits.set(key, { n: 1, until: now + ms }); return true }
      h.n++
      return h.n <= max
    },
    reset: (key) => hits.delete(key),
  }
}

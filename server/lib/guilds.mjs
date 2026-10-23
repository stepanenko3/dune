/*
 * Гільдії: назва, тег, опис, колір, «відкрита для заявок»; учасники з ролями (лідер → офіцер → учасник →
 * новобранець), запрошення-посилання (термін і кількість використань), заявки на вступ, указ тижня гільдії.
 * Хто що може — вирішують маршрути (routes/guilds.mjs) за рангом ролі (RANK).
 *
 * Як у грі: людина — лише в одній гільдії (унікальний індекс на members.user_id, а вступ ще й перевіряється з
 * зрозумілою помилкою), у гільдії — не більше guildCap людей (ліміт передають ті, хто вводить людей). users.main_guild
 * тримається синхронно з членством — це й є «гільдія людини» (на нього спираються указ і сторінки-списки).
 */
import crypto from 'node:crypto'
import { color, fail, newId, paletteFor, plain, slugify, withLock } from './util.mjs'
import { HOUSES } from './decree.mjs'
import { cardProfile, cleanAnswers, cleanProfile, cleanTz, readProfile } from './guild-profile.mjs'

export const RANK = { recruit: 1, member: 2, officer: 3, leader: 4 }
export const GUILD_ROLES = Object.keys(RANK)
/** стани заявки: чекає; прийнята; відхилена (з причиною); відкликана кандидатом; закрита (вступив деінде чи задовго чекала) */
export const REQUEST_STATUS = ['pending', 'accepted', 'rejected', 'withdrawn', 'closed']

/**
 * що людина (контекст запиту: ctx.user, ctx.ranks) може з гільдією: member — бачить гільдійське; review — розглядає
 * заявки й запрошує; profile — міняє картку гільдії, набір і анкету; identity — назву, тег, колір, дім; remove — видаляє.
 * Адміністратор сайту — як лідер.
 */
export function guildCan(ctx, g) {
  const admin = ctx?.user?.role === 'admin' || !!ctx?.superuser
  const rank = admin ? RANK.leader : (g && ctx?.ranks?.get(g.id)) || 0
  return { rank, member: rank >= RANK.recruit, review: rank >= RANK.officer, profile: rank >= RANK.officer, identity: rank >= RANK.leader, remove: rank >= RANK.leader }
}
const TAG_RE = /^[\p{L}\p{N}]{2,5}$/u

function cleanGuild(p, partial) {
  const out = {}
  if ('name' in p || !partial) {
    out.name = plain(p.name, 40)
    if (out.name.length < 3) throw fail('назва гільдії — щонайменше 3 знаки')
  }
  if ('tag' in p || !partial) {
    out.tag = plain(p.tag, 5).toUpperCase()
    if (!TAG_RE.test(out.tag)) throw fail('тег — 2–5 літер чи цифр')
  }
  if ('about' in p) out.about = plain(p.about, 1000, true)
  if ('color' in p) { out.color = color(p.color); if (!out.color) throw fail('хибний колір') }
  if ('open' in p) out.open = p.open ? 1 : 0
  // Великий дім гільдії (союз у Ландсрааді): atreides | harkonnen | порожньо — від нього залежить, чи діє указ тижня
  if ('house' in p) {
    out.house = p.house === null || p.house === '' ? null : String(p.house)
    if (out.house && !HOUSES.includes(out.house)) throw fail('невідомий дім')
  }
  return out
}

export async function createGuilds(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS guilds (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, tag TEXT NOT NULL, about TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL, open INTEGER NOT NULL DEFAULT 0, created BIGINT NOT NULL, decree TEXT
    );
    CREATE TABLE IF NOT EXISTS members (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined BIGINT NOT NULL, PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY, guild_id TEXT NOT NULL, by_user TEXT, created BIGINT NOT NULL, expires BIGINT,
      uses INTEGER NOT NULL DEFAULT 0, max_uses INTEGER
    );
    CREATE TABLE IF NOT EXISTS requests (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL, PRIMARY KEY (guild_id, user_id)
    );
  `)
  // з якою роллю вступає той, хто відкрив запрошення (давні — учасником)
  await db.addColumn('invites', 'role', 'TEXT')
  // дім гільдії в Ландсрааді (lib/decree.mjs)
  await db.addColumn('guilds', 'house', 'TEXT')
  // картка гільдії для каталогу й набору (lib/guild-profile.mjs): JSON, порожньо — усе за замовчуванням
  await db.addColumn('guilds', 'profile', 'TEXT')
  // заявки — з анкетою й рішенням (давні рядки — чекають); коментарі офіцерів до заявки — окремо
  await db.addColumn('requests', 'status', "TEXT NOT NULL DEFAULT 'pending'")
  await db.addColumn('requests', 'answers', 'TEXT')
  await db.addColumn('requests', 'tz', 'TEXT')
  await db.addColumn('requests', 'reason', 'TEXT')
  await db.addColumn('requests', 'decided', 'BIGINT')
  await db.addColumn('requests', 'decided_by', 'TEXT')
  await db.exec(`
    CREATE TABLE IF NOT EXISTS request_comments (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, by_user TEXT, text TEXT NOT NULL, created BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS request_comments_by_guild ON request_comments (guild_id, user_id);
  `)
  /** назва й тег — неповторні (без різниці великих і малих літер): «[SW] Sandwalkers» не підробити другою гільдією */
  async function assertUnique(c, self = '') {
    if (c.name && (await db.get('SELECT id FROM guilds WHERE lower(name) = ? AND id <> ?', c.name.toLowerCase(), self))) throw fail('гільдія з такою назвою вже є', 409)
    if (c.tag && (await db.get('SELECT id FROM guilds WHERE upper(tag) = ? AND id <> ?', c.tag.toUpperCase(), self))) throw fail('такий тег уже має інша гільдія', 409)
  }
  /** людину заблокували: лідерство переходить до наступного (сама лишається учасником, поки її не вигнали) */
  async function stepDown(uid) {
    for (const r of await db.all("SELECT m.guild_id, g.slug FROM members m LEFT JOIN guilds g ON g.id = m.guild_id WHERE m.user_id = ? AND m.role = 'leader'", uid)) {
      await db.run("UPDATE members SET role = 'member' WHERE guild_id = ? AND user_id = ?", r.guild_id, uid)
      await journal('guild.role', `${r.slug || r.guild_id}/${uid}`, 'member')
      await heir(r.guild_id, r.slug)
      // нікого іншого нема — лишається лідером (гільдію без лідера ніхто б не повів)
      if (!(await db.get("SELECT COUNT(*) AS n FROM members WHERE guild_id = ? AND role = 'leader'", r.guild_id)).n) await db.run("UPDATE members SET role = 'leader' WHERE guild_id = ? AND user_id = ?", r.guild_id, uid)
    }
  }
  // ---------- давні дані: людина лише в одній гільдії ----------
  /** запис у журнал (таблицю audit створює createAuth, що йде раніше) — від імені сайту */
  const journal = (action, target, detail) => db.run('INSERT INTO audit (at, actor, action, target, detail) VALUES (?, NULL, ?, ?, ?)', Date.now(), action, target, detail)
  /** гільдія лишилась без лідера — лідером стає найстарший за рангом, хто є (і не заблокований) */
  async function heir(gid, slug) {
    if ((await db.get("SELECT COUNT(*) AS n FROM members WHERE guild_id = ? AND role = 'leader'", gid)).n) return
    const next = await db.get("SELECT m.user_id FROM members m JOIN users u ON u.id = m.user_id WHERE m.guild_id = ? AND u.banned IS NULL ORDER BY CASE m.role WHEN 'officer' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, m.joined LIMIT 1", gid)
    if (!next) return
    await db.run("UPDATE members SET role = 'leader' WHERE guild_id = ? AND user_id = ?", gid, next.user_id)
    await journal('guild.role', `${slug || gid}/${next.user_id}`, 'leader')
  }
  /** кілька членств у людини → лишаємо одне: де вона лідер, інакше users.main_guild, інакше найдавніше; решту — геть, у журнал */
  async function keepOne() {
    for (const { user_id: uid } of await db.all('SELECT user_id FROM members GROUP BY user_id HAVING COUNT(*) > 1')) {
      const main = (await db.get('SELECT main_guild FROM users WHERE id = ?', uid))?.main_guild
      const rows = await db.all('SELECT m.guild_id, m.role, m.joined, g.slug FROM members m LEFT JOIN guilds g ON g.id = m.guild_id WHERE m.user_id = ?', uid)
      const key = (r) => [r.role === 'leader' ? 0 : 1, r.guild_id === main ? 0 : 1, r.joined]
      rows.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (a.guild_id < b.guild_id ? -1 : 1) })
      const [keep, ...drop] = rows
      for (const r of drop) {
        await db.run('DELETE FROM members WHERE guild_id = ? AND user_id = ?', r.guild_id, uid)
        await journal('guild.leave', `${r.slug || r.guild_id}/${uid}`, `давні дані: лише одна гільдія на людину, лишилась ${keep.slug || keep.guild_id}`)
        if (r.role === 'leader') await heir(r.guild_id, r.slug)
      }
    }
  }
  await keepOne()
  await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS members_one_guild ON members (user_id); DROP INDEX IF EXISTS members_by_user;')
  // чекаючі заявки тих, хто вже в гільдії, — зайві (розглянуті лишаються історією)
  await db.run("DELETE FROM requests WHERE status = 'pending' AND user_id IN (SELECT user_id FROM members)")
  // основна гільдія = гільдія людини
  await db.run(`UPDATE users SET main_guild = (SELECT m.guild_id FROM members m WHERE m.user_id = users.id)
    WHERE COALESCE(main_guild, '') <> COALESCE((SELECT m.guild_id FROM members m WHERE m.user_id = users.id), '')`)
  /** users.main_guild — за членством (гільдія людини чи порожньо) */
  const syncMain = (uid) => db.run('UPDATE users SET main_guild = (SELECT m.guild_id FROM members m WHERE m.user_id = users.id) WHERE id = ?', uid)
  /** людина вступила в гільдію gid (null — створила свою): заявка туди — прийнята, решта чекаючих — закриті */
  async function closeRequests(uid, gid, by = null) {
    const now = Date.now()
    if (gid) await db.run("UPDATE requests SET status = 'accepted', decided = ?, decided_by = ?, reason = NULL WHERE guild_id = ? AND user_id = ? AND status = 'pending'", now, by, gid, uid)
    await db.run("UPDATE requests SET status = 'closed', decided = ? WHERE user_id = ? AND status = 'pending'", now, uid)
  }
  /** заявка для клієнта (рядок БД → об'єкт) */
  const reqRow = (r) => {
    if (!r) return null
    let answers = {}
    try { answers = r.answers ? JSON.parse(r.answers) : {} } catch { answers = {} }
    return {
      guild_id: r.guild_id, user_id: r.user_id, note: r.note || '', created: Number(r.created), status: r.status || 'pending', answers, tz: r.tz || null,
      reason: r.reason || '', decided: r.decided == null ? null : Number(r.decided), decided_by: r.decided_by || null, decided_name: r.decided_name || null,
      login: r.login, name: r.name, nick: r.nick, color: r.color,
    }
  }

  // спершу за id, потім за адресою: адреса, що збіглася з чужим id, не підмінить ту гільдію
  const get = async (idOrSlug) => (idOrSlug ? (await db.get('SELECT * FROM guilds WHERE id = ?', idOrSlug)) || (await db.get('SELECT * FROM guilds WHERE slug = ?', idOrSlug)) || null : null)
  const memberCount = async (gid) => (await db.get('SELECT COUNT(*) AS n FROM members WHERE guild_id = ?', gid)).n
  /** гільдія для клієнта; n — число учасників, якщо вже відоме (список) */
  const view = async (g, n) => (g ? { id: g.id, slug: g.slug, name: g.name, tag: g.tag, about: g.about, color: g.color, open: !!g.open, house: HOUSES.includes(g.house) ? g.house : null, created: g.created, members: n ?? (await memberCount(g.id)) } : null)
  const current = async (uid) => (uid ? (await db.get('SELECT guild_id, role FROM members WHERE user_id = ?', uid)) || null : null)
  /** людина вже в якійсь гільдії — вступати, подавати заявку чи створювати нову не можна */
  const assertFree = async (uid) => { if (await current(uid)) throw fail('Спершу вийди з поточної гільдії', 409) }
  /** у гільдії є місце (cap — ліміт сайту; без нього не перевіряємо) */
  const assertRoom = async (gid, cap) => {
    if (!cap) return
    const n = await memberCount(gid)
    if (n >= cap) throw fail('Гільдія заповнена ({n} з {cap})', 409, { n, cap })
  }
  const roleOf = async (gid, uid) => (gid && uid ? (await db.get('SELECT role FROM members WHERE guild_id = ? AND user_id = ?', gid, uid))?.role || null : null)
  const ofUser = (uid) => db.all('SELECT g.*, m.role, m.joined FROM members m JOIN guilds g ON g.id = m.guild_id WHERE m.user_id = ? ORDER BY m.joined', uid)

  // вступ — по черзі в межах гільдії (перевірка місця й запис), див. withLock
  let addMemberNow = null
  const api = {
    stepDown,
    get,
    view,
    /** нова гільдія; той, хто створив, — лідер (і не може вже бути в іншій гільдії) */
    async create(p, userId, { id, slug } = {}) {
      const c = cleanGuild(p || {}, false)
      await assertUnique(c)
      if (userId) await assertFree(userId)
      const gid = id || newId('g')
      const taken = new Set((await db.all('SELECT slug FROM guilds')).map((r) => r.slug))
      // адреса не має бути схожою на id гільдії (g + 11 знаків) — інакше пошук «за id чи адресою» їх сплутав би
      const s = slug || slugify(c.name, (x) => taken.has(x) || /^g[a-z0-9]{11}$/.test(x), 'guild')
      await db.run('INSERT INTO guilds (id, slug, name, tag, about, color, open, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', gid, s, c.name, c.tag, c.about || '', c.color || paletteFor(c.name), c.open ?? 0, Date.now())
      if (userId) {
        try {
          await db.run('INSERT INTO members (guild_id, user_id, role, joined) VALUES (?, ?, ?, ?)', gid, userId, 'leader', Date.now())
        } catch (e) {
          // одночасно вступив деінде (ловить унікальний індекс) — нову гільдію не лишаємо порожньою
          await db.run('DELETE FROM guilds WHERE id = ?', gid)
          if (await current(userId)) throw fail('Спершу вийди з поточної гільдії', 409)
          throw e
        }
        await closeRequests(userId, null)
        await syncMain(userId)
      }
      return get(gid)
    },
    async update(id, p) {
      const c = cleanGuild(p || {}, true)
      // перевіряємо лише те, що змінилось (давні однакові назви не заважають міняти опис чи колір)
      const cur = await db.get('SELECT name, tag FROM guilds WHERE id = ?', id)
      await assertUnique({ name: c.name !== cur?.name ? c.name : undefined, tag: c.tag !== cur?.tag ? c.tag : undefined }, id)
      const keys = Object.keys(c)
      if (keys.length) await db.run(`UPDATE guilds SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => c[k]), id)
      return get(id)
    },
    async remove(id) {
      await db.run('DELETE FROM invites WHERE guild_id = ?', id)
      await db.run('DELETE FROM requests WHERE guild_id = ?', id)
      await db.run('DELETE FROM request_comments WHERE guild_id = ?', id)
      await db.run('DELETE FROM members WHERE guild_id = ?', id)
      await db.run('DELETE FROM guilds WHERE id = ?', id)
      await db.run('UPDATE users SET main_guild = NULL WHERE main_guild = ?', id)
    },
    async list({ q: text = '', open = false } = {}) {
      const like = `%${String(text).trim().toLowerCase()}%`
      const rows = await db.all(`SELECT g.*, (SELECT COUNT(*) FROM members m WHERE m.guild_id = g.id) AS n FROM guilds g
        WHERE (lower(g.name) LIKE ? OR lower(g.tag) LIKE ? OR lower(g.about) LIKE ?) ${open ? 'AND g.open = 1' : ''} ORDER BY g.name`, like, like, like)
      return Promise.all(rows.map(async (g) => ({ ...(await view(g, g.n)), profile: cardProfile(readProfile(g.profile)) })))
    },

    // ---------- картка гільдії ----------
    /** повна картка (з видимістю блоків і анкетою); що з неї бачить глядач — profileFor */
    profile: async (gid) => readProfile((await db.get('SELECT profile FROM guilds WHERE id = ?', gid))?.profile),
    /** змінити картку: patch — частина, решта лишається; герб — лише через setEmblem */
    async setProfile(gid, patch) {
      const cur = await api.profile(gid)
      const { emblem, ...rest } = patch && typeof patch === 'object' ? patch : {}
      // видимість і посилання — частинами (змінили один блок — решта лишається)
      if (rest.show && typeof rest.show === 'object') rest.show = { ...cur.show, ...rest.show }
      if (rest.links && typeof rest.links === 'object') rest.links = { ...cur.links, ...rest.links }
      const next = cleanProfile({ ...rest, emblem: cur.emblem }, cur)
      await db.run('UPDATE guilds SET profile = ? WHERE id = ?', JSON.stringify(next), gid)
      return next
    },
    async setEmblem(gid, url) {
      const cur = await api.profile(gid)
      const next = cleanProfile({ emblem: url }, cur)
      await db.run('UPDATE guilds SET profile = ? WHERE id = ?', JSON.stringify(next), gid)
      return next
    },

    // ---------- учасники ----------
    roleOf,
    rankOf: async (gid, uid) => RANK[(await roleOf(gid, uid)) || ''] || 0,
    members: (gid) => db.all(`SELECT m.role, m.joined, u.id, u.login, u.name, u.nick, u.color, u.seen FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.guild_id = ? ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, m.joined`, gid),
    memberCount,
    current,
    assertFree,
    assertRoom,
    /** гільдія людини з її роллю в масиві з 0–1 елемента: [{ ...гільдія, role }] (давні виклики чекають масив) */
    of: async (uid) => (uid ? Promise.all((await ofUser(uid)).map(async (g) => ({ ...(await view(g)), role: g.role, joined: g.joined }))) : []),
    /** гільдія людини з її роллю чи null */
    ofOne: async (uid) => { const [g] = uid ? await ofUser(uid) : []; return g ? { ...(await view(g)), role: g.role, joined: g.joined } : null },
    /** ранги людини в її гільдіях: Map(guildId → ранг) — для перевірок доступу */
    ranks: async (uid) => new Map((uid ? await db.all('SELECT guild_id, role FROM members WHERE user_id = ?', uid) : []).map((m) => [m.guild_id, RANK[m.role] || 0])),
    /** вступ: лише в одну гільдію і лише якщо є місце (cap — ліміт сайту); уже учаснику — міняє роль */
    addMember: (gid, uid, role = 'member', opts = {}) => withLock(`guild:${gid}`, () => addMemberNow(gid, uid, role, opts)),
    async _addMember(gid, uid, role = 'member', { cap, by = null } = {}) {
      if (!RANK[role]) throw fail('невідома роль')
      const cur = await current(uid)
      if (cur && cur.guild_id !== gid) throw fail('Спершу вийди з поточної гільдії', 409)
      if (!cur) await assertRoom(gid, cap)
      try {
        await db.run('INSERT INTO members (guild_id, user_id, role, joined) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET role = excluded.role', gid, uid, role, Date.now())
      } catch (e) {
        // одночасно вступив деінде — це вже ловить унікальний індекс
        if (await current(uid)) throw fail('Спершу вийди з поточної гільдії', 409)
        throw e
      }
      // тепер він у гільдії: заявка сюди — прийнята (за заявкою чи запрошенням), в інші — закриті
      await closeRequests(uid, gid, by)
      await syncMain(uid)
    },
    async setRole(gid, uid, role) {
      if (!RANK[role]) throw fail('невідома роль')
      await db.run('UPDATE members SET role = ? WHERE guild_id = ? AND user_id = ?', role, gid, uid)
    },
    async removeMember(gid, uid) {
      await db.run('DELETE FROM members WHERE guild_id = ? AND user_id = ?', gid, uid)
      await syncMain(uid)
    },
    async leaveAll(uid) {
      await db.run('DELETE FROM members WHERE user_id = ?', uid)
      await db.run('DELETE FROM requests WHERE user_id = ?', uid)
      await db.run('DELETE FROM request_comments WHERE user_id = ?', uid)
      await syncMain(uid)
    },

    // ---------- запрошення ----------
    /**
     * нове запрошення: days — термін (0 — безстрокове), uses — скільки разів (0 — без обмеження; за замовчуванням —
     * один: посилання, що втекло в чат, не впустить усіх), role — новобранець чи учасник (офіцером через посилання — ні)
     */
    async invite(gid, by, { days = 7, uses = 1, role = 'member' } = {}) {
      const code = crypto.randomBytes(9).toString('base64url')
      const d = Math.max(0, Math.min(90, Number(days) || 0)), n = Math.max(0, Math.min(500, Number(uses) || 0))
      const r = role === 'recruit' ? 'recruit' : 'member'
      await db.run('INSERT INTO invites (code, guild_id, by_user, created, expires, max_uses, role) VALUES (?, ?, ?, ?, ?, ?, ?)', code, gid, by || null, Date.now(), d ? Date.now() + d * 86400_000 : null, n || null, r)
      return db.get('SELECT * FROM invites WHERE code = ?', code)
    },
    invites: (gid) => db.all('SELECT i.*, u.login AS by_login, u.name AS by_name FROM invites i LEFT JOIN users u ON u.id = i.by_user WHERE i.guild_id = ? ORDER BY i.created DESC', gid),
    revokeInvite: async (gid, code) => (await db.run('DELETE FROM invites WHERE code = ? AND guild_id = ?', code, gid)).changes > 0,
    /** запрошення, якщо ще діє */
    async inviteInfo(code) {
      const i = typeof code === 'string' && code.length < 40 ? await db.get('SELECT * FROM invites WHERE code = ?', code) : null
      if (!i) return null
      if ((i.expires && i.expires < Date.now()) || (i.max_uses && i.uses >= i.max_uses)) return null
      return i
    },
    /** зайняти одне використання запрошення (атомарно): false — запрошення вже вичерпане чи минуло */
    takeInvite: async (code) => (await db.run('UPDATE invites SET uses = uses + 1 WHERE code = ? AND (max_uses IS NULL OR uses < max_uses) AND (expires IS NULL OR expires > ?)', code, Date.now())).changes > 0,
    /** повернути використання (вступ не вдався) */
    untakeInvite: (code) => db.run('UPDATE invites SET uses = uses - 1 WHERE code = ? AND uses > 0', code),
    useInvite: (code) => db.run('UPDATE invites SET uses = uses + 1 WHERE code = ?', code),

    // ---------- заявки ----------
    /**
     * подати (чи подати знову — після рішення): note — кілька слів, answers — відповіді за анкетою гільдії (перевіряє
     * cleanAnswers), tz — пояс кандидата (для годин онлайну). Давні клієнти шлють лише рядок note.
     */
    async request(gid, uid, p) {
      const o = typeof p === 'string' || p == null ? { note: p } : p
      const answers = cleanAnswers((await api.profile(gid)).form, o.answers)
      await db.run(`INSERT INTO requests (guild_id, user_id, note, created, status, answers, tz, reason, decided, decided_by) VALUES (?, ?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL)
        ON CONFLICT (guild_id, user_id) DO UPDATE SET note = excluded.note, created = excluded.created, status = 'pending', answers = excluded.answers, tz = excluded.tz, reason = NULL, decided = NULL, decided_by = NULL`,
      gid, uid, plain(o.note, 1000, true), Date.now(), JSON.stringify(answers), cleanTz(o.tz))
    },
    /** заявки гільдії: status — 'pending' (черга) чи 'done' (розглянуті); з людиною й тим, хто вирішив */
    requests: async (gid, status = 'pending') => (await db.all(`SELECT r.*, u.login, u.name, u.nick, u.color, d.name AS decided_name FROM requests r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.decided_by
      WHERE r.guild_id = ? AND ${status === 'done' ? "r.status <> 'pending'" : "r.status = 'pending'"} ORDER BY ${status === 'done' ? 'r.decided DESC, r.created DESC' : 'r.created'} LIMIT 200`, gid)).map(reqRow),
    pendingCount: async (gid) => Number((await db.get("SELECT COUNT(*) AS n FROM requests WHERE guild_id = ? AND status = 'pending'", gid)).n),
    requestOf: async (gid, uid) => reqRow(await db.get('SELECT * FROM requests WHERE guild_id = ? AND user_id = ?', gid, uid)),
    /** гільдії, куди в людини чекають заявки (для кнопок «Скасувати заявку») */
    requestsOfUser: async (uid) => (await db.all("SELECT guild_id FROM requests WHERE user_id = ? AND status = 'pending'", uid)).map((r) => r.guild_id),
    /** усі заявки людини з гільдіями — «Мої заявки» */
    myRequests: async (uid) => (await db.all('SELECT r.guild_id, r.status, r.reason, r.created, r.decided, g.slug, g.name, g.tag, g.color FROM requests r JOIN guilds g ON g.id = r.guild_id WHERE r.user_id = ? ORDER BY COALESCE(r.decided, r.created) DESC LIMIT 50', uid))
      .map((r) => ({ guild: { id: r.guild_id, slug: r.slug, name: r.name, tag: r.tag, color: r.color }, status: r.status, reason: r.reason || '', created: Number(r.created), decided: r.decided == null ? null : Number(r.decided) })),
    /** кандидат відкликав: чекаюча — 'withdrawn' (true), інакше нічого */
    dropRequest: async (gid, uid) => (await db.run("UPDATE requests SET status = 'withdrawn', decided = ?, decided_by = ? WHERE guild_id = ? AND user_id = ? AND status = 'pending'", Date.now(), uid, gid, uid)).changes > 0,
    /** рішення офіцера: відхилити (з причиною) чи закрити; прийняття — через addMember (він ставить 'accepted') */
    async decide(gid, uid, { status, reason = '', by = null }) {
      if (!REQUEST_STATUS.includes(status) || status === 'pending') throw fail('невідомий стан заявки')
      return (await db.run("UPDATE requests SET status = ?, reason = ?, decided = ?, decided_by = ? WHERE guild_id = ? AND user_id = ? AND status = 'pending'", status, plain(reason, 500, true) || null, Date.now(), by, gid, uid)).changes > 0
    },
    /** коментар офіцера до заявки (кандидат не бачить) */
    async comment(gid, uid, by, text) {
      const s = plain(text, 1000, true)
      if (!s) throw fail('порожній коментар')
      const id = newId('rc')
      await db.run('INSERT INTO request_comments (id, guild_id, user_id, by_user, text, created) VALUES (?, ?, ?, ?, ?, ?)', id, gid, uid, by, s, Date.now())
      return id
    },
    /** коментарі до заявок гільдії: Map(людина → [{ id, by, text, created }]) */
    async comments(gid, uids) {
      const m = new Map()
      if (!uids?.length) return m
      const rows = await db.all(`SELECT c.*, u.name AS by_name, u.color AS by_color FROM request_comments c LEFT JOIN users u ON u.id = c.by_user WHERE c.guild_id = ? AND c.user_id IN (${uids.map(() => '?').join(',')}) ORDER BY c.created`, gid, ...uids)
      for (const r of rows) {
        if (!m.has(r.user_id)) m.set(r.user_id, [])
        m.get(r.user_id).push({ id: r.id, by: r.by_name || null, color: r.by_color || null, text: r.text, created: Number(r.created) })
      }
      return m
    },
    /** щоденне прибирання: розглянуті — старші за keep геть; чекаючі задовго — закриті */
    async tidyRequests(now = Date.now(), keep = 180 * 86400_000) {
      const gone = (await db.run("DELETE FROM requests WHERE status <> 'pending' AND COALESCE(decided, created) < ?", now - keep)).changes
      const closed = (await db.run("UPDATE requests SET status = 'closed', decided = ? WHERE status = 'pending' AND created < ?", now, now - keep)).changes
      await db.run('DELETE FROM request_comments WHERE NOT EXISTS (SELECT 1 FROM requests r WHERE r.guild_id = request_comments.guild_id AND r.user_id = request_comments.user_id)')
      return gone + closed
    },

    // ---------- указ тижня гільдії ----------
    decree: async (gid) => { const g = await db.get('SELECT decree FROM guilds WHERE id = ?', gid); return g?.decree ? JSON.parse(g.decree) : null },
    setDecree: (gid, d) => db.run('UPDATE guilds SET decree = ? WHERE id = ?', d ? JSON.stringify(d) : null, gid),
  }
  addMemberNow = (...a) => api._addMember(...a)
  return api
}

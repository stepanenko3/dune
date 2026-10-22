/*
 * Події спільноти — бій 2 на 2, турнір, перегони, вилазка, ярмарок, збір гільдії — у визначений час, з призовим
 * фондом, місцем на мапі гри й зоною для глядачів. Власник і видимість — у реєстрі речей (kind 'event', lib/items.mjs);
 * тут — сам документ і реєстрація.
 *
 * Таблиці: events — документ (JSON) і окремо starts / ends / type / region (списки «найближчі» й «минулі» — за часом);
 * event_teams — команда: капітан, назва, гравці [{ nick, user }] (ніки в грі — не всі гравці є на сайті; user — хто з
 * сайту зайняв це місце), статус і код, за яким согравці з сайту приєднуються; event_players — подія + людина → команда
 * (первинний ключ: людина лише в одній команді події); event_watch — хто йде дивитись.
 * Статус команди: pending — чекає рішення організатора, confirmed — бере участь, reserve — у резерві (місць нема),
 * rejected — відхилено. Команда з одного гравця — «кожен сам за себе».
 */
import crypto from 'node:crypto'
import { cleanPicks } from '../../src/engine/bracket.mjs'
import { STORM_REGIONS } from './storm.mjs'
import { fail, newId, plain } from './util.mjs'

export const EVENT_TYPES = ['pvp', 'tournament', 'race', 'pve', 'spice', 'build', 'trade', 'meet', 'other']
export const TEAM_STATUS = ['pending', 'confirmed', 'reserve', 'rejected']
export const REGIONS = Object.keys(STORM_REGIONS)
/** вид події українською — для календаря й прев'ю (переклад — req.t) */
export const EVENT_TYPE_L = { pvp: 'Бій', tournament: 'Турнір', race: 'Перегони', pve: 'PvE-вилазка', spice: 'Спайс-ран', build: 'Конкурс баз', trade: 'Ярмарок', meet: 'Збір', other: 'Подія' }

/** формат: «2 на 2» чи «кожен сам за себе» (t — перекладач) */
export const formatOf = (ev, t) => (ev.reg.teamSize > 1 ? t('{n} на {n}', { n: ev.reg.teamSize }) : t('кожен сам за себе'))

const DAY = 86400_000
const TEAM_ID = /^t[a-z0-9]{6,24}$/
const MAX_TEAM = 10

const int = (v, lo, hi, def) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && v !== null && v !== '' ? Math.max(lo, Math.min(hi, n)) : def
}
/** кінець події (мс) */
export const endsOf = (ev) => ev.starts + ev.duration * 60_000

/** посилання на трансляцію: лише повна адреса https (у сторінку йде як посилання) */
function httpsUrl(v) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  let u
  try { u = new URL(s) } catch { throw fail('посилання на трансляцію — повна адреса https://…') }
  if (u.protocol !== 'https:' || s.length > 300) throw fail('посилання на трансляцію — повна адреса https://…')
  return u.href
}

/** сітка: перший раунд (лише підтверджені команди цієї події) і вибір переможців — перераховано (engine/bracket) */
function cleanBracket(b, confirmed) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.seed)) return null
  const n = b.seed.length
  if (n < 2 || n > 64 || (n & (n - 1))) throw fail('хибна сітка турніру')
  const seen = new Set()
  const seed = b.seed.map((id) => {
    if (typeof id !== 'string' || !TEAM_ID.test(id) || seen.has(id) || (confirmed && !confirmed.has(id))) return null
    seen.add(id)
    return id
  })
  // команд лишилось менше двох (їх відхилили чи вони знялись) — сітки вже нема
  if (seen.size < 2) return null
  const picks = Array.isArray(b.picks) ? b.picks.slice(0, 7).map((r) => (Array.isArray(r) ? r.slice(0, 32).map((x) => (x === 'a' || x === 'b' ? x : null)) : [])) : []
  return { seed, picks: cleanPicks(seed, picks) }
}

/**
 * Документ події: лише відомі поля, тексти обрізані, точки — у межах мапи (maps.cleanPoint, як у позначок). teams —
 * id усіх команд події (результати посилаються лише на них), confirmed — підтверджених (лише вони в сітці).
 */
export function cleanEvent(d, { maps, teams = null, confirmed = null, now = Date.now() } = {}) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw fail('порожня подія')
  const title = plain(d.title, 120)
  if (title.length < 3) throw fail('назва події — щонайменше 3 знаки')
  const starts = Math.round(Number(d.starts))
  if (!Number.isFinite(starts) || starts < now - 365 * DAY || starts > now + 730 * DAY) throw fail('хибний час початку')
  const duration = int(d.duration, 15, 7 * 24 * 60, 120)
  const ends = starts + duration * 60_000
  const r = d.reg && typeof d.reg === 'object' ? d.reg : {}
  let closes = r.closes == null || r.closes === '' ? null : Math.round(Number(r.closes))
  if (closes != null && !Number.isFinite(closes)) throw fail('хибний час кінця реєстрації')
  if (closes != null && closes > ends) throw fail('реєстрація має закритись до кінця події')
  const point = (p) => (p && typeof p === 'object' ? maps.cleanPoint(p) : null)
  const team = (v) => (typeof v === 'string' && TEAM_ID.test(v) && (!teams || teams.has(v)) ? v : null)
  return {
    title,
    type: EVENT_TYPES.includes(d.type) ? d.type : 'other',
    about: plain(d.about, 4000, true),
    rules: plain(d.rules, 4000, true),
    starts,
    duration,
    region: REGIONS.includes(d.region) ? d.region : '',
    server: plain(d.server, 60),
    place: plain(d.place, 200),
    arena: point(d.arena),
    watch: point(d.watch),
    watchNote: plain(d.watchNote, 300, true),
    reg: {
      open: r.open !== false,
      teamSize: int(r.teamSize, 1, MAX_TEAM, 1),
      slots: int(r.slots, 0, 256, 0),
      approval: !!r.approval,
      closes,
    },
    prizes: (Array.isArray(d.prizes) ? d.prizes : []).slice(0, 10)
      .map((p) => ({ label: plain(p?.label, 60), prize: plain(p?.prize, 200) })).filter((p) => p.prize),
    fee: plain(d.fee, 120),
    contact: plain(d.contact, 200),
    stream: httpsUrl(d.stream),
    cancelled: !!d.cancelled,
    cancelNote: d.cancelled ? plain(d.cancelNote, 300, true) : '',
    results: (Array.isArray(d.results) ? d.results : []).slice(0, 16)
      .map((x) => ({ team: team(x?.team), name: plain(x?.name, 80) })).filter((x) => x.team || x.name),
    resultsNote: plain(d.resultsNote, 1000, true),
    bracket: cleanBracket(d.bracket, confirmed),
  }
}

/** гравці команди з запиту: ніки в грі (1…teamSize, неповторні); user лишається лише в тих, кого дозволено (keep) */
export function cleanMembers(list, teamSize, keep = new Set()) {
  if (!Array.isArray(list)) throw fail('потрібні гравці команди')
  const seen = new Set(), users = new Set()
  const out = []
  for (const m of list.slice(0, MAX_TEAM)) {
    const nick = plain(typeof m === 'string' ? m : m?.nick, 40)
    if (!nick) continue
    if (seen.has(nick.toLowerCase())) throw fail('нік «{nick}» у команді двічі', 400, { nick })
    seen.add(nick.toLowerCase())
    const user = typeof m?.user === 'string' && keep.has(m.user) && !users.has(m.user) ? m.user : null
    if (user) users.add(user)
    out.push({ nick, user })
  }
  if (!out.length) throw fail('потрібен хоч один гравець — твій нік у грі')
  if (out.length > teamSize) throw fail('у команді — не більше {n} гравців', 400, { n: teamSize })
  return out
}

/** стан реєстрації зараз: open | closed (вимкнено чи минув строк) | ended | cancelled */
export function regState(ev, now = Date.now()) {
  if (ev.cancelled) return 'cancelled'
  if (now >= endsOf(ev)) return 'ended'
  if (!ev.reg.open || now >= (ev.reg.closes ?? ev.starts)) return 'closed'
  return 'open'
}

const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
/** рядок календаря довший за 75 байтів — переноситься (продовження з пробілу), не розриваючи літер */
function fold(line) {
  const out = []
  let cur = '', size = 0
  for (const ch of line) {
    const n = Buffer.byteLength(ch)
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0 }
    cur += ch
    size += n
  }
  out.push(cur)
  return out.join('\r\n ')
}
/** подія файлом календаря (.ics) — з нагадуванням за 30 хв; url — сторінка події, uid — неповторний для неї */
export function icsOf(ev, { url, uid, description = '' }) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sandwalkers//Events//UK', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsTime(Date.now())}`,
    `DTSTART:${icsTime(ev.starts)}`,
    `DTEND:${icsTime(endsOf(ev))}`,
    `SUMMARY:${icsText(ev.title)}`,
    `DESCRIPTION:${icsText([description, url].filter(Boolean).join('\n\n'))}`,
    ...(ev.server || ev.place ? [`LOCATION:${icsText([ev.server, ev.place].filter(Boolean).join(' · '))}`] : []),
    `URL:${url}`,
    `STATUS:${ev.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(ev.cancelled ? [] : ['BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(ev.title)}`, 'END:VALARM']),
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

export async function createEvents(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, doc TEXT NOT NULL, starts BIGINT NOT NULL, ends BIGINT NOT NULL, type TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL, updated BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_by_time ON events (ends, starts);
    CREATE TABLE IF NOT EXISTS event_teams (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, captain TEXT NOT NULL, name TEXT NOT NULL, members TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, code TEXT NOT NULL, created BIGINT NOT NULL, updated BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS event_teams_by_event ON event_teams (event_id, created);
    CREATE TABLE IF NOT EXISTS event_players (event_id TEXT NOT NULL, user_id TEXT NOT NULL, team_id TEXT NOT NULL, PRIMARY KEY (event_id, user_id));
    CREATE INDEX IF NOT EXISTS event_players_by_user ON event_players (user_id);
    CREATE INDEX IF NOT EXISTS event_players_by_team ON event_players (team_id);
    CREATE TABLE IF NOT EXISTS event_watch (event_id TEXT NOT NULL, user_id TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (event_id, user_id));
    CREATE INDEX IF NOT EXISTS event_watch_by_user ON event_watch (user_id);
  `)
  const row = (r) => (r ? { id: r.id, ...JSON.parse(r.doc), created: r.created, updated: r.updated } : null)
  const get = async (id) => row(await db.get('SELECT * FROM events WHERE id = ?', String(id)))
  const teamRow = (r) => (r ? { id: r.id, eventId: r.event_id, captain: r.captain, name: r.name, members: JSON.parse(r.members), note: r.note, status: r.status, code: r.code, created: r.created, updated: r.updated } : null)
  /** пачками: у SQLite обмеження на кількість «?» у запиті */
  const chunks = async (ids, fn) => { for (let i = 0; i < ids.length; i += 500) await fn(ids.slice(i, i + 500).map(String)) }
  const qs = (a) => a.map(() => '?').join(',')
  /** гравці з сайту — у event_players (людина лише в одній команді події) */
  const syncPlayers = async (t, tm) => {
    await t.run('DELETE FROM event_players WHERE team_id = ?', tm.id)
    for (const m of tm.members) if (m.user) await t.run('INSERT INTO event_players (event_id, user_id, team_id) VALUES (?, ?, ?)', tm.eventId, m.user, tm.id)
  }

  const api = {
    get,
    async many(ids) {
      const m = new Map()
      await chunks(ids, async (part) => { for (const r of await db.all(`SELECT * FROM events WHERE id IN (${qs(part)})`, ...part)) m.set(r.id, row(r)) })
      return ids.map((id) => m.get(String(id))).filter(Boolean)
    },
    async create(doc) {
      const id = newId('e')
      const now = Date.now()
      await db.run('INSERT INTO events (id, doc, starts, ends, type, region, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, JSON.stringify(doc), doc.starts, endsOf(doc), doc.type, doc.region || '', now, now)
      return get(id)
    },
    /** зберегти; base — «updated», від якого правили (змінили тим часом — { conflict, ...поточна }) */
    async put(id, doc, base = null) {
      const now = Date.now()
      const cols = 'doc = ?, starts = ?, ends = ?, type = ?, region = ?, updated = ?'
      const vals = [JSON.stringify(doc), doc.starts, endsOf(doc), doc.type, doc.region || '']
      const r = base == null
        ? await db.run(`UPDATE events SET ${cols} WHERE id = ?`, ...vals, now, String(id))
        : await db.run(`UPDATE events SET ${cols} WHERE id = ? AND updated = ?`, ...vals, Math.max(now, Number(base) + 1), String(id), Number(base))
      if (r.changes) return get(id)
      const cur = await get(id)
      return cur && base != null ? { conflict: true, ...cur } : null
    },
    async remove(id) {
      return db.tx(async (t) => {
        await t.run('DELETE FROM event_players WHERE event_id = ?', String(id))
        await t.run('DELETE FROM event_teams WHERE event_id = ?', String(id))
        await t.run('DELETE FROM event_watch WHERE event_id = ?', String(id))
        return (await t.run('DELETE FROM events WHERE id = ?', String(id))).changes > 0
      })
    },

    /**
     * Події для списків: when — upcoming (ще не скінчились, найближчі першими) чи past (найсвіжіші першими); scope —
     * all (публічне, своє, своєї гільдії і те, де людина грає чи дивиться), mine (своє, створене нею, де грає чи
     * дивиться), guild (гільдії guild). Рядки — з реєстру (i.*) і e_doc, e_starts, e_ends; права перевіряє маршрут.
     */
    async list({ when = 'upcoming', scope = 'all', uid = null, gids = [], guild = null, type = '', region = '', q = '', limit = 30, offset = 0, now = Date.now() } = {}) {
      // події чужої гільдії — лише публічні («за посиланням» у списки не потрапляє)
      const insider = guild && gids.includes(guild)
      const where = [], args = []
      const own = "(i.owner_kind = 'user' AND i.owner_id = ?)"
      const takes = '(e.id IN (SELECT event_id FROM event_players WHERE user_id = ?) OR e.id IN (SELECT event_id FROM event_watch WHERE user_id = ?))'
      if (scope === 'mine') {
        if (!uid) return { rows: [], total: 0 }
        where.push(`(${own} OR i.created_by = ? OR ${takes})`); args.push(uid, uid, uid, uid)
      } else if (scope === 'guild') {
        if (!guild) return { rows: [], total: 0 }
        where.push(`i.owner_kind = 'guild' AND i.owner_id = ?${insider ? '' : " AND i.visibility = 'public' AND i.hidden IS NULL"}`); args.push(guild)
      } else {
        const parts = ["(i.visibility = 'public' AND i.hidden IS NULL)"]
        if (uid) { parts.push(own, takes); args.push(uid, uid, uid) }
        if (gids.length) { parts.push(`(i.owner_kind = 'guild' AND i.owner_id IN (${qs(gids)}))`); args.push(...gids) }
        where.push(`(${parts.join(' OR ')})`)
      }
      if (when === 'past') { where.push('e.ends <= ?'); args.push(now) } else { where.push('e.ends > ?'); args.push(now) }
      if (EVENT_TYPES.includes(type)) { where.push('e.type = ?'); args.push(type) }
      if (REGIONS.includes(region)) { where.push('e.region = ?'); args.push(region) }
      const text = String(q).trim().toLowerCase()
      if (text) { where.push('lower(i.title) LIKE ?'); args.push(`%${text}%`) }
      const from = `FROM events e JOIN items i ON i.kind = 'event' AND i.id = e.id WHERE ${where.join(' AND ')}`
      const order = when === 'past' ? 'e.starts DESC' : 'e.starts ASC'
      const rows = await db.all(`SELECT i.*, e.doc AS e_doc, e.starts AS e_starts, e.ends AS e_ends ${from} ORDER BY ${order}, e.id LIMIT ? OFFSET ?`, ...args, Math.min(60, Math.max(1, limit)), Math.max(0, offset))
      const total = Number((await db.get(`SELECT COUNT(*) AS n ${from}`, ...args)).n)
      return { rows, total }
    },
    /** скільки команд за статусами й глядачів у кожної події: Map(id → { confirmed, pending, reserve, rejected, watchers }) */
    async counts(ids) {
      const out = new Map(ids.map((id) => [String(id), { confirmed: 0, pending: 0, reserve: 0, rejected: 0, watchers: 0 }]))
      await chunks(ids, async (part) => {
        for (const r of await db.all(`SELECT event_id, status, COUNT(*) AS n FROM event_teams WHERE event_id IN (${qs(part)}) GROUP BY event_id, status`, ...part)) {
          const c = out.get(r.event_id)
          if (c && r.status in c) c[r.status] = Number(r.n)
        }
        for (const r of await db.all(`SELECT event_id, COUNT(*) AS n FROM event_watch WHERE event_id IN (${qs(part)}) GROUP BY event_id`, ...part)) {
          const c = out.get(r.event_id)
          if (c) c.watchers = Number(r.n)
        }
      })
      return out
    },
    /** де людина серед цих подій: Map(id → { team, watching }) */
    async mineIn(ids, uid) {
      const out = new Map()
      if (!uid) return out
      await chunks(ids, async (part) => {
        for (const r of await db.all(`SELECT event_id, team_id FROM event_players WHERE user_id = ? AND event_id IN (${qs(part)})`, uid, ...part)) out.set(r.event_id, { ...(out.get(r.event_id) || {}), team: r.team_id })
        for (const r of await db.all(`SELECT event_id FROM event_watch WHERE user_id = ? AND event_id IN (${qs(part)})`, uid, ...part)) out.set(r.event_id, { ...(out.get(r.event_id) || {}), watching: true })
      })
      return out
    },

    // ---------- команди ----------
    teams: async (eid) => (await db.all('SELECT * FROM event_teams WHERE event_id = ? ORDER BY created, id', String(eid))).map(teamRow),
    team: async (tid) => teamRow(await db.get('SELECT * FROM event_teams WHERE id = ?', String(tid))),
    /** у якій команді події людина (id чи null) */
    playerTeam: async (eid, uid) => (uid ? (await db.get('SELECT team_id FROM event_players WHERE event_id = ? AND user_id = ?', String(eid), uid))?.team_id ?? null : null),
    async addTeam(eid, { captain, name, members, note = '', status }) {
      const now = Date.now()
      const tm = { id: newId('t'), eventId: String(eid), captain, name, members, note, status, code: crypto.randomBytes(6).toString('base64url'), created: now, updated: now }
      await db.tx(async (t) => {
        await t.run('INSERT INTO event_teams (id, event_id, captain, name, members, note, status, code, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          tm.id, tm.eventId, captain, name, JSON.stringify(members), note, status, tm.code, now, now)
        await syncPlayers(t, tm)
      })
      return api.team(tm.id)
    },
    /** зберегти команду цілком (назва, гравці, примітка, статус, капітан) */
    async saveTeam(tm) {
      await db.tx(async (t) => {
        await t.run('UPDATE event_teams SET captain = ?, name = ?, members = ?, note = ?, status = ?, updated = ? WHERE id = ?', tm.captain, tm.name, JSON.stringify(tm.members), tm.note, tm.status, Date.now(), tm.id)
        await syncPlayers(t, tm)
      })
      return api.team(tm.id)
    },
    async removeTeam(tid) {
      return db.tx(async (t) => {
        await t.run('DELETE FROM event_players WHERE team_id = ?', String(tid))
        return (await t.run('DELETE FROM event_teams WHERE id = ?', String(tid))).changes > 0
      })
    },

    // ---------- глядачі ----------
    async watch(eid, uid, on) {
      if (on) await db.run('INSERT INTO event_watch (event_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', String(eid), uid, Date.now())
      else await db.run('DELETE FROM event_watch WHERE event_id = ? AND user_id = ?', String(eid), uid)
    },
    watching: async (eid, uid) => (uid ? !!(await db.get('SELECT 1 AS x FROM event_watch WHERE event_id = ? AND user_id = ?', String(eid), uid)) : false),

    /**
     * Людину видалено: її глядацьке — геть; її місця в командах — геть (команда лишається); де вона капітан —
     * капітаном стає наступний гравець із сайту, а якщо такого нема — команда знімається.
     */
    async forgetUser(uid) {
      await db.run('DELETE FROM event_watch WHERE user_id = ?', uid)
      const ids = (await db.all('SELECT DISTINCT team_id FROM event_players WHERE user_id = ? UNION SELECT id AS team_id FROM event_teams WHERE captain = ?', uid, uid)).map((r) => r.team_id)
      const touched = new Set()
      for (const tid of ids) {
        const tm = await api.team(tid)
        if (!tm) continue
        touched.add(tm.eventId)
        const members = tm.members.filter((m) => m.user !== uid)
        const heir = tm.captain === uid ? members.find((m) => m.user)?.user : tm.captain
        if (!heir || !members.length) await api.removeTeam(tid)
        else await api.saveTeam({ ...tm, captain: heir, members })
      }
      return [...touched]
    },
  }
  return api
}

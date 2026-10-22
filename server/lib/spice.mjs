/*
 * Активні поля меланжу — позначки гравців: «це поле зараз є». Позначити можна мале, середнє й велике поле
 * (свої з мапи TH.GL, велике — ще й на можливому місці чи просто на мапі). Позначка — для себе, гільдії чи всіх.
 *
 * Поле активне від ПЕРШОЇ позначки, яку глядач бачить: наступні лише підтверджують його (лічильник і список людей),
 * строку не подовжують; строк — перша позначка + час життя поля за величиною (TTL). Позначка після строку починає
 * нове «вікно». Рахується окремо для кожного глядача з тих позначок, які він бачить (приватна чужа позначка не
 * зсуває відлік публічного глядача). Давні позначки лишаються в базі: з них мапа знає місця великих полів, яких
 * немає у відомих. Відомі місця великих полів за розкладкою Глибокої пустелі — з файлів гри (game_spice_spots: розділ
 * spice реєстру джерел пише їх сюди, setKnown).
 */
import { fail } from './util.mjs'

const MIN = 60_000

export const SPICE_SIZES = ['small', 'medium', 'large']
/**
 * Скільки поле вважаємо активним від першої позначки. Офіційного таймера немає: поле живе, доки його не виберуть, а
 * нове з'являється в межах ліміту полів мапи (SpiceHarvestingSystem, оновлення раз на 90–120 с); гравці кажуть про
 * 20–40 хв на нове поле, велике — за 5–10 хв після того, як попереднє з'їли. Тож строки — наш вибір із запасом.
 */
export const SPICE_TTL = { small: 30 * MIN, medium: 60 * MIN, large: 120 * MIN }
/** позначка ближче за стільки (одиниці гри, см) до відомого місця чи давньої позначки — те саме поле */
const SNAP = { small: 1500, medium: 3000, large: 25_000 }
/** скільки давніх позначок дивимось, щоб знайти поточне «вікно» поля */
const LOOKBACK = 4 * SPICE_TTL.large
/** найбільше позначок від людини за годину */
const PER_HOUR = 60
/** скільки імен показуємо в підказці */
const NAMES = 6
const VIS = new Set(['private', 'guild', 'public'])

export async function createSpice({ db, guilds }) {
  await db.exec(`CREATE TABLE IF NOT EXISTS spice_marks (
    id {{SERIAL}}, map TEXT NOT NULL, layout INTEGER, size TEXT NOT NULL, x BIGINT NOT NULL, y BIGINT NOT NULL,
    user_id TEXT NOT NULL, visibility TEXT NOT NULL, guild_id TEXT, created BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS spice_marks_map ON spice_marks (map, created);
    CREATE INDEX IF NOT EXISTS spice_marks_user ON spice_marks (user_id, created);
    CREATE TABLE IF NOT EXISTS game_spice_spots (layout INTEGER NOT NULL, x BIGINT NOT NULL, y BIGINT NOT NULL, size TEXT NOT NULL);`)
  /** відомі місця великих полів розкладки (координати сайту): з файлів гри; кеш до наступного setKnown */
  const knownCache = new Map()
  async function known(layout) {
    if (layout == null) return []
    if (!knownCache.has(layout)) knownCache.set(layout, (await db.all("SELECT x, y FROM game_spice_spots WHERE layout = ? AND size = 'large' ORDER BY x, y", layout)).map((r) => [Number(r.x), Number(r.y)]))
    return knownCache.get(layout)
  }
  /** відомі місця з файлів гри — замість усіх попередніх */
  async function setKnown(records) {
    await db.tx(async (t) => {
      await t.run('DELETE FROM game_spice_spots')
      for (const r of records) await t.run('INSERT INTO game_spice_spots (layout, x, y, size) VALUES (?, ?, ?, ?)', r.layout, r.x, r.y, r.size)
    })
    knownCache.clear()
  }
  const keyOf = (r) => `${r.size}@${r.x}:${r.y}`
  /** глядач бачить позначку: публічна, своя чи його гільдії */
  const sees = (ctx, r) => r.visibility === 'public' || (!!ctx?.user && (r.user_id === ctx.user.id || (r.visibility === 'guild' && !!r.guild_id && ctx.ranks?.has(r.guild_id))))
  const layoutSql = (layout) => (layout == null ? ['layout IS NULL', []] : ['layout = ?', [layout]])

  async function recent(map, layout, now) {
    const [w, a] = layoutSql(layout)
    return db.all(`SELECT * FROM spice_marks WHERE map = ? AND ${w} AND created > ? ORDER BY created, id`, map, ...a, now - LOOKBACK)
  }

  /** поточне вікно поля з позначок, які бачить глядач (за часом): позначки з created < першої + TTL */
  function windows(rows, now) {
    const by = new Map()
    for (const r of rows) {
      const k = keyOf(r)
      let f = by.get(k)
      if (!f || r.created >= f.first + SPICE_TTL[r.size]) by.set(k, (f = { size: r.size, x: r.x, y: r.y, first: r.created, marks: [] }))
      f.marks.push(r)
    }
    return [...by.values()].filter((f) => f.first + SPICE_TTL[f.size] > now)
  }

  async function names(ids) {
    if (!ids.length) return new Map()
    const rows = await db.all(`SELECT id, name, login FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
    return new Map(rows.map((u) => [u.id, u.name || u.login]))
  }

  /** відомі й «вивчені» з позначок місця великих полів, які бачить глядач */
  async function largeSpots(ctx, map, layout) {
    if (layout == null) return []
    const out = new Map()
    for (const [x, y] of await known(layout)) out.set(`${x}:${y}`, { x, y, src: 'known' })
    const rows = await db.all("SELECT x, y, user_id, visibility, guild_id FROM spice_marks WHERE map = ? AND layout = ? AND size = 'large' ORDER BY created DESC LIMIT 2000", map, layout)
    for (const r of rows) if (sees(ctx, r) && !out.has(`${r.x}:${r.y}`)) out.set(`${r.x}:${r.y}`, { x: r.x, y: r.y, src: 'marked' })
    return [...out.values()]
  }

  /** що бачить глядач на мапі: активні поля (зі строком і людьми) і місця великих полів */
  async function view(ctx, map, layout, now = Date.now()) {
    const rows = (await recent(map, layout, now)).filter((r) => sees(ctx, r))
    const fields = windows(rows, now)
    const who = await names([...new Set(fields.flatMap((f) => f.marks.map((m) => m.user_id)))])
    const rank = { private: 0, guild: 1, public: 2 }
    return {
      ttl: SPICE_TTL,
      now,
      spots: await largeSpots(ctx, map, layout),
      fields: fields.map((f) => {
        const users = [...new Set(f.marks.map((m) => m.user_id))]
        const mine = ctx?.user ? f.marks.find((m) => m.user_id === ctx.user.id) : null
        return {
          size: f.size, x: f.x, y: f.y, first: f.first, expires: f.first + SPICE_TTL[f.size], last: f.marks.at(-1).created,
          n: users.length,
          names: users.slice(0, NAMES).map((id) => who.get(id) || '—'),
          // найширша видимість серед позначок: значок «для себе / гільдії / усім»
          vis: f.marks.reduce((v, m) => (rank[m.visibility] > rank[v] ? m.visibility : v), 'private'),
          mine: mine ? { id: mine.id, visibility: mine.visibility } : null,
        }
      }),
    }
  }

  /** найближче відоме місце чи давня позначка тієї ж величини (з тих, що людина бачить) — до них «прилипаємо» */
  async function snap(ctx, p) {
    const R = SNAP[p.size]
    let best = null, bd = R
    const near = (x, y) => { const d = Math.hypot(x - p.x, y - p.y); if (d <= bd) { bd = d; best = { x, y } } }
    if (p.size === 'large' && p.layout != null) for (const [x, y] of await known(p.layout)) near(x, y)
    if (best) return best
    const [w, a] = layoutSql(p.layout)
    const rows = await db.all(`SELECT x, y, user_id, visibility, guild_id FROM spice_marks WHERE map = ? AND ${w} AND size = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ? ORDER BY created DESC LIMIT 200`,
      p.map, ...a, p.size, p.x - R, p.x + R, p.y - R, p.y + R)
    for (const r of rows) if (sees(ctx, r)) near(r.x, r.y)
    return best || { x: p.x, y: p.y }
  }

  return {
    setKnown,
    sees,
    view,
    /**
     * Позначити поле активним (p — { map, layout, size, x, y, visibility }, точка вже перевірена мапою). Людина вже
     * позначила це поле в поточному вікні — лише змінюється видимість її позначки. → { row, before }
     */
    async mark(ctx, p, now = Date.now()) {
      if (!ctx?.user) throw fail('потрібно увійти', 401)
      if (!SPICE_SIZES.includes(p.size)) throw fail('невідома величина поля')
      if (!VIS.has(p.visibility)) throw fail('невідома видимість')
      let guild = null
      if (p.visibility === 'guild') {
        guild = (await guilds.ofOne(ctx.user.id))?.id || null
        if (!guild) throw fail('ти не в гільдії — познач для себе чи для всіх')
      }
      const at = await snap(ctx, p)
      const x = Math.round(at.x), y = Math.round(at.y)
      const rows = (await recent(p.map, p.layout ?? null, now)).filter((r) => sees(ctx, r))
      const f = windows(rows, now).find((w) => w.size === p.size && w.x === x && w.y === y)
      const mine = f?.marks.find((m) => m.user_id === ctx.user.id)
      if (mine) {
        await db.run('UPDATE spice_marks SET visibility = ?, guild_id = ? WHERE id = ?', p.visibility, guild, mine.id)
        return { row: { ...mine, visibility: p.visibility, guild_id: guild }, before: mine }
      }
      const n = (await db.get('SELECT COUNT(*) AS n FROM spice_marks WHERE user_id = ? AND created > ?', ctx.user.id, now - 60 * MIN)).n
      if (n >= PER_HOUR) throw fail('забагато позначок за годину — спробуй трохи згодом', 429)
      const row = { map: p.map, layout: p.layout ?? null, size: p.size, x, y, user_id: ctx.user.id, visibility: p.visibility, guild_id: guild, created: now }
      await db.run('INSERT INTO spice_marks (map, layout, size, x, y, user_id, visibility, guild_id, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        row.map, row.layout, row.size, row.x, row.y, row.user_id, row.visibility, row.guild_id, row.created)
      return { row, before: null }
    },
    /** зняти свою позначку → рядок, який зняли, чи null */
    async unmark(ctx, id) {
      if (!ctx?.user) throw fail('потрібно увійти', 401)
      const row = await db.get('SELECT * FROM spice_marks WHERE id = ? AND user_id = ?', Number(id) || 0, ctx.user.id)
      if (!row) return null
      await db.run('DELETE FROM spice_marks WHERE id = ?', row.id)
      return row
    },
    /** людину видалено — її позначки теж */
    forgetUser: (uid) => db.run('DELETE FROM spice_marks WHERE user_id = ?', String(uid)),
  }
}

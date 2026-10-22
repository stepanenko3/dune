/*
 * Оголошення на сайті: смужка вгорі сторінки з датами показу. Кому (усім, гостям, тим, хто увійшов, учасникам
 * гільдії, адміністрації), якою мовою (порожньо — усім мовам), тон (інформація, успіх, увага, тривога), посилання.
 * Показується, поки зараз між «з» і «до» (порожнє — без меж) і воно не вимкнене. Масове створення — серією
 * (те саме щотижня/щодня N разів) чи списком (кілька різних одним махом): обидва — одним пакетом (batch).
 */
import { fail, newId, plain } from './util.mjs'

export const TONES = ['info', 'success', 'warning', 'critical']
export const AUDIENCES = ['all', 'guests', 'users', 'guild', 'staff']

export async function createAnnouncements(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id {{SERIAL}}, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', tone TEXT NOT NULL DEFAULT 'info',
      audience TEXT NOT NULL DEFAULT 'all', guild_id TEXT, lang TEXT NOT NULL DEFAULT '', link_url TEXT NOT NULL DEFAULT '',
      link_label TEXT NOT NULL DEFAULT '', starts BIGINT, ends BIGINT, dismissible INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1, batch TEXT, created_by TEXT, created BIGINT NOT NULL, updated BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS announcements_window ON announcements (enabled, starts, ends);
  `)

  /** очистити й перевірити одне оголошення */
  function clean(a) {
    const title = plain(a.title, 160)
    if (!title) throw fail('потрібен заголовок оголошення')
    const starts = a.starts == null || a.starts === '' ? null : Number(typeof a.starts === 'string' ? Date.parse(a.starts) : a.starts)
    const ends = a.ends == null || a.ends === '' ? null : Number(typeof a.ends === 'string' ? Date.parse(a.ends) : a.ends)
    if (starts != null && !Number.isFinite(starts)) throw fail('хибна дата початку')
    if (ends != null && !Number.isFinite(ends)) throw fail('хибна дата кінця')
    if (starts != null && ends != null && ends <= starts) throw fail('кінець має бути пізніше за початок')
    const url = plain(a.link_url ?? a.linkUrl ?? '', 400)
    // «//чужий» і «/\чужий» браузер вважає чужим сайтом — такі як шлях не приймаємо
    if (url && !(/^https?:\/\//.test(url) || (/^\/(?![\/\\])/.test(url) && !/[\u0000-\u001f\\]/.test(url)))) throw fail('посилання — https://… чи /шлях на сайті')
    return {
      title, body: plain(a.body, 1000, true), tone: TONES.includes(a.tone) ? a.tone : 'info',
      audience: AUDIENCES.includes(a.audience) ? a.audience : 'all', guild_id: a.audience === 'guild' ? String(a.guild_id || a.guildId || '') || null : null,
      lang: plain(a.lang, 12), link_url: url, link_label: plain(a.link_label ?? a.linkLabel ?? '', 60),
      starts, ends, dismissible: a.dismissible === false || a.dismissible === 0 ? 0 : 1, enabled: a.enabled === false || a.enabled === 0 ? 0 : 1,
    }
  }

  async function insert(t, a, by, batch) {
    const now = Date.now()
    const c = clean(a)
    // id — з самої вставки (MAX(id) після неї при одночасних вставках дав би чужий)
    const r = await t.get(`INSERT INTO announcements (title, body, tone, audience, guild_id, lang, link_url, link_label, starts, ends, dismissible, enabled, batch, created_by, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    c.title, c.body, c.tone, c.audience, c.guild_id, c.lang, c.link_url, c.link_label, c.starts, c.ends, c.dismissible, c.enabled, batch, by, now, now)
    return r?.id
  }

  return {
    clean,
    /** одне; повертає id */
    async create(a, by) {
      return db.tx((t) => insert(t, a, by, null))
    },
    /**
     * Багато одним пакетом: items — список різних; або repeat { every: 'day'|'week'|'month', count } — копії
     * шаблону, зсунуті на крок (дати початку й кінця йдуть разом). Повертає { batch, created }.
     */
    async bulk({ items = [], template, repeat } = {}, by) {
      let list = items
      if (template && repeat) {
        const n = Math.min(100, Math.max(1, Number(repeat.count) || 1))
        const shift = (ms, i) => {
          if (ms == null) return null
          const d = new Date(ms)
          if (repeat.every === 'month') d.setMonth(d.getMonth() + i)
          else d.setDate(d.getDate() + i * (repeat.every === 'day' ? 1 : 7))
          return d.getTime()
        }
        const s = template.starts == null || template.starts === '' ? null : Number(typeof template.starts === 'string' ? Date.parse(template.starts) : template.starts)
        const e = template.ends == null || template.ends === '' ? null : Number(typeof template.ends === 'string' ? Date.parse(template.ends) : template.ends)
        if (s == null) throw fail('для серії потрібна дата початку')
        list = Array.from({ length: n }, (_, i) => ({ ...template, starts: shift(s, i), ends: shift(e, i) }))
      }
      if (!list.length) throw fail('порожній список')
      if (list.length > 200) throw fail('за раз — щонайбільше 200')
      list.forEach(clean) // спершу перевіряємо все: пакет або цілий, або ніякий
      const batch = newId('a')
      await db.tx(async (t) => { for (const a of list) await insert(t, a, by, batch) })
      return { batch, created: list.length }
    },
    /** що показати людині зараз */
    async active({ user, guildIds = [], lang, staff }) {
      const now = Date.now()
      const rows = await db.all(`SELECT * FROM announcements WHERE enabled = 1 AND (starts IS NULL OR starts <= ?) AND (ends IS NULL OR ends > ?) ORDER BY
        CASE tone WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, COALESCE(starts, created) DESC LIMIT 20`, now, now)
      return rows.filter((a) => {
        if (a.lang && a.lang !== lang) return false
        if (a.audience === 'guests') return !user
        if (a.audience === 'users') return !!user
        if (a.audience === 'staff') return !!staff
        if (a.audience === 'guild') return !!a.guild_id && guildIds.includes(a.guild_id)
        return true
      }).map((a) => ({ id: a.id, title: a.title, body: a.body, tone: a.tone, link: a.link_url ? { url: a.link_url, label: a.link_label } : null, dismissible: !!a.dismissible, ends: a.ends }))
    },
  }
}

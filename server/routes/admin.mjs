/*
 * Панель керування: усі таблиці сайту як ресурси (../admin/resources.mjs, рушій — ../admin/engine.mjs), огляд,
 * масове створення оголошень, тексти гри мовами (імпорт з gaming.tools іде з браузера адміністратора), налаштування.
 * Модератор бачить людей, гільдії, вміст, гру, журнал і веде оголошення; решта — адміністратор. Кожна зміна — у журнал.
 */
import express from 'express'
import { DEFAULT_LIMITS } from '../lib/content.mjs'
import { createEngine } from '../admin/engine.mjs'
import { buildResources } from '../admin/resources.mjs'
import { GAME, LANGS, langOf } from '../lib/gamedata.mjs'
import { KINDS } from '../lib/items.mjs'
import { fail } from '../lib/util.mjs'
import { jsonDiff } from '../lib/revisions.mjs'
import { wrap } from './auth.mjs'

/** відомі налаштування сайту: ключ → { тип, типове значення } */
export const SITE_SETTINGS = {
  registration: { type: 'select', options: ['open', 'closed'], def: 'open' },
  defaultLang: { type: 'select', options: LANGS.map((l) => l.code), def: 'uk' },
  siteName: { type: 'text', def: 'Sandwalkers', required: true },
  // як у грі: гільдія — до 32 людей (ліміт — тут, щоб підлаштувати під гру)
  guildCap: { type: 'int', def: 32, min: 1, max: 1000 },
  // скільки днів зберігати журнал дій та історію змін (0 — завжди); старше прибирає фонова задача «Прибирання»
  auditDays: { type: 'int', def: 180, min: 0, max: 3650 },
  revisionDays: { type: 'int', def: 365, min: 0, max: 3650 },
  // скільки речей кожного виду може мати людина й гільдія (0 — без обмежень); адміністрація й сам сайт — без лімітів
  limits: { type: 'limits', def: DEFAULT_LIMITS },
}

export function createAdminRoutes(deps) {
  const { db, auth, items, game, i18n, announcements, roles, revisions, cron } = deps
  const engine = createEngine({ db, auth, roles, revisions, resources: buildResources(deps) })
  const r = express.Router()
  /** доступ до панелі й окремих можливостей — за дозволами ролі (server/lib/roles.mjs) */
  const allow = (perm) => async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: req.t('потрібно увійти') })
    if (!(await roles.can(req.user, perm))) return res.status(403).json({ error: req.t('бракує прав') })
    next()
  }
  const mod = allow('admin')

  r.get('/api/admin/meta', mod, wrap(async (req, res) => res.json({
    resources: await engine.meta(req.user), langs: LANGS, role: req.user.role, permissions: [...(await roles.permsOf(req.user.role))],
  })))
  /** усі розділи й можливості — для матриці дозволів ролі */
  r.get('/api/admin/permissions-catalog', allow('roles.view'), (req, res) => res.json({
    sections: engine.catalog(),
    site: [
      { key: 'admin', label: 'Вхід у панель керування' }, { key: 'site.moderate', label: 'Бачити сховане модерацією' },
      { key: 'site.settings', label: 'Налаштування сайту' }, { key: 'site.decree', label: 'Указ Ландсрааду' },
      { key: 'site.content', label: 'Вміст від імені сайту' }, { key: 'site.owners', label: 'Віддавати речі будь-кому в панелі' },
    ],
  }))

  // ---------- історія змін запису й порівняння версій ----------
  r.get('/api/admin/history/:res', allow('revisions.view'), wrap(async (req, res) => {
    if (!(await engine.allowed(req.user, req.params.res, 'view'))) throw fail('бракує прав', 403)
    // сторінками по 50 (+1 — щоб знати, чи є ще)
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const rows = await revisions.list(req.params.res, String(req.query.id || ''), 51, offset)
    res.json({ rows: rows.slice(0, 50), more: rows.length > 50 })
  }))
  r.get('/api/admin/revisions/:id/diff', allow('revisions.view'), wrap(async (req, res) => {
    const rev = await revisions.get(req.params.id)
    // різницю бачить лише той, хто бачить і сам розділ запису
    if (!rev || !(await engine.allowed(req.user, rev.entity, 'view'))) throw fail('немає такої зміни', 404)
    res.json({ revision: { ...rev, before: undefined, after: undefined }, changes: jsonDiff(rev.before ?? {}, rev.after ?? {}) })
  }))
  /** версія бази чи роадмапу проти наступної (чи поточної) — що змінилось у документі */
  r.get('/api/admin/version-diff/:kind/:hid', mod, wrap(async (req, res) => {
    const kind = req.params.kind === 'roadmap' ? 'roadmap' : 'base'
    if (!(await engine.allowed(req.user, kind === 'base' ? 'base-history' : 'roadmap-history', 'view'))) throw fail('бракує прав', 403)
    const [tbl, col, main] = kind === 'base' ? ['base_history', 'base_id', 'bases'] : ['roadmap_history', 'roadmap_id', 'roadmaps']
    const h = await db.get(`SELECT * FROM ${tbl} WHERE hid = ?`, Number(req.params.hid))
    if (!h) throw fail('немає такої версії', 404)
    const next = (await db.get(`SELECT * FROM ${tbl} WHERE ${col} = ? AND hid > ? ORDER BY hid LIMIT 1`, h[col], h.hid)) || (await db.get(`SELECT * FROM ${main} WHERE id = ?`, h[col]))
    const parse = (v) => { try { return JSON.parse(v) } catch { return null } }
    res.json({ from: { version: h.version, updated: h.updated }, to: next ? { version: next.version, updated: next.updated } : null, changes: next ? jsonDiff(parse(h.doc), parse(next.doc)) : [] })
  }))

  // ---------- огляд ----------
  r.get('/api/admin/overview', mod, wrap(async (req, res) => {
    const n = async (sql, ...a) => Number((await db.get(sql, ...a))?.n || 0)
    const t = Date.now(), DAY = 86400_000, week = t - 7 * DAY, day = t - DAY
    const can = (name) => engine.allowed(req.user, name, 'view')
    // графік реєстрацій — по календарних днях людини (tz — її зсув від UTC у хвилинах, як getTimezoneOffset)
    const off = -(Number(req.query.tz) || 0) * 60_000
    const today = Math.floor((t + off) / DAY) * DAY - off, since = today - 29 * DAY
    const [counts, cover, signups, total, wk, active, banned, sessions, gTotal, gReq, annLive, annSched, catalogSynced, skillsSynced, audit, recent, cronRows] = await Promise.all([
      items.counts(), game.coverage(), db.all('SELECT created FROM users WHERE created >= ?', since), auth.count(),
      n('SELECT COUNT(*) AS n FROM users WHERE created >= ?', week), n('SELECT COUNT(*) AS n FROM users WHERE seen >= ?', day), n('SELECT COUNT(*) AS n FROM users WHERE banned IS NOT NULL'),
      n('SELECT COUNT(*) AS n FROM sessions WHERE expires > ?', t), n('SELECT COUNT(*) AS n FROM guilds'), n('SELECT COUNT(*) AS n FROM requests'),
      n('SELECT COUNT(*) AS n FROM announcements WHERE enabled = 1 AND (starts IS NULL OR starts <= ?) AND (ends IS NULL OR ends > ?)', t, t), n('SELECT COUNT(*) AS n FROM announcements WHERE enabled = 1 AND starts > ?', t),
      game.getMeta('catalogSynced'), game.getMeta('skillsSynced'),
      // останні дії — людською мовою, як у «Журналі дій»; новенькі й задачі — лише тим, хто бачить ці розділи
      can('audit').then((ok) => (ok ? engine.list('audit', req.user, { size: 12 }).then((x) => x.rows) : [])),
      can('users').then((ok) => (ok ? db.all('SELECT id, login, name, color, created FROM users ORDER BY created DESC LIMIT 8') : [])),
      can('cron-jobs').then((ok) => (ok ? db.all('SELECT key, name, enabled, last_run, last_status, last_ms, next_run, runs, fails FROM cron_jobs ORDER BY key') : [])),
    ])
    const by = (k) => counts.filter((c) => c.kind === k).reduce((s, c) => s + Number(c.n), 0)
    const perDay = Array.from({ length: 30 }, (_, i) => {
      const from = since + i * DAY
      return { day: from, n: signups.filter((u) => u.created >= from && u.created < from + DAY).length }
    })
    res.json({
      users: { total, week: wk, active, banned, perDay },
      sessions,
      guilds: { total: gTotal, requests: gReq },
      items: Object.fromEntries(KINDS.map((k) => [k, by(k)])),
      public: counts.filter((c) => c.visibility === 'public').reduce((s, c) => s + Number(c.n), 0),
      announcements: { live: annLive, scheduled: annSched },
      game: { counts: cover.totals, catalogSynced, skillsSynced, syncing: { catalog: deps.catalog.syncing, skills: deps.skills.syncing } },
      i18n: i18n.coverage(),
      texts: cover.rows,
      audit,
      recent,
      cron: cronRows,
      running: cron.running(),
    })
  }))

  // ---------- ресурси ----------
  const q = (req) => {
    let filters = {}
    try { filters = req.query.f ? JSON.parse(String(req.query.f)) : {} } catch { throw fail('хибні фільтри') }
    let fixed = {}
    try { fixed = req.query.fixed ? JSON.parse(String(req.query.fixed)) : {} } catch { throw fail('хибні фільтри') }
    return { page: req.query.page, size: req.query.size, search: req.query.search, sort: req.query.sort, desc: req.query.desc === '1' || req.query.desc === 'true', filters, fixed }
  }
  r.get('/api/admin/r/:res', mod, wrap(async (req, res) => res.json(await engine.list(req.params.res, req.user, q(req)))))
  /** список як є (той самий пошук і фільтри) — файлом CSV для таблиць; назви стовпців і значення — мовою людини */
  r.get('/api/admin/r/:res/export.csv', mod, wrap(async (req, res) => {
    const rows = await engine.listAll(req.params.res, req.user, q(req))
    const resource = engine.resource(req.params.res)
    const fields = resource.fields.filter((f) => f.list !== false && f.type !== 'permissions')
    const t = req.t || ((k) => k)
    const text = (f, row) => {
      const v = row[f.key]
      if (f.ref) { const l = row[f.key + '__label']; return l != null ? (row[f.key + '__tr'] ? t(String(l)) : String(l)) : Array.isArray(row[f.key + '__ref']) ? String(row[f.key + '__ref'][1] ?? '') : '' }
      if (v == null || v === '') return ''
      switch (f.type) {
        case 'datetime': case 'flag': return new Date(Number(v)).toISOString().replace('T', ' ').slice(0, 16)
        case 'bool': return v ? t('Так') : t('Ні')
        case 'select': { const o = (f.options || []).find((x) => x.value === String(v) || x.also?.includes(String(v))); return o ? t(o.label) : String(v) }
        case 'owner': return f.kindField && row[f.kindField] === 'site' ? t('Сайт') : String(row[f.key + '__label'] ?? v)
        case 'relation': return String(row[f.key + '__label'] ?? v)
        case 'json': case 'pairs': case 'list': return JSON.stringify(v)
        default: return f.tr ? t(String(v)) : String(v)
      }
    }
    // лапки для CSV; «=», «+», «-», «@» на початку — як текст (інакше таблиця прийме за формулу)
    const cell = (s) => { const x = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x }
    const csv = [fields.map((f) => cell(t(f.label))).join(','), ...rows.map((row) => fields.map((f) => cell(text(f, row))).join(','))].join('\r\n')
    res.set('cache-control', 'no-store')
    res.set('content-disposition', `attachment; filename="${req.params.res}-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.type('text/csv; charset=utf-8').send('\ufeff' + csv)
  }))
  /** пошук по всій панелі (Ctrl/⌘+K): записи всіх розділів, які людина бачить */
  r.get('/api/admin/search', mod, wrap(async (req, res) => res.json({ rows: await engine.search(req.user, String(req.query.q || '').slice(0, 100)) })))
  r.get('/api/admin/r/:res/options', mod, wrap(async (req, res) => res.json(await engine.options(req.params.res, req.user, req.query.q, req.query.ids ? String(req.query.ids).split(',').filter(Boolean).slice(0, 50) : []))))
  r.get('/api/admin/r/:res/one', mod, wrap(async (req, res) => res.json(await engine.get(req.params.res, req.user, String(req.query.id)))))
  r.post('/api/admin/r/:res', mod, wrap(async (req, res) => res.json(await engine.create(req.params.res, req.user, req.body || {}))))
  r.patch('/api/admin/r/:res/one', mod, wrap(async (req, res) => res.json(await engine.update(req.params.res, req.user, String(req.query.id), req.body || {}))))
  r.post('/api/admin/r/:res/delete', mod, wrap(async (req, res) => res.json(await engine.remove(req.params.res, req.user, (req.body?.ids || []).map(String)))))
  r.post('/api/admin/r/:res/action/:key', mod, wrap(async (req, res) => res.json(await engine.action(req.params.res, req.user, req.params.key, (req.body?.ids || []).map(String), req.body?.input || {}))))

  // ---------- оголошення: масово ----------
  r.post('/api/admin/announcements/bulk', allow('announcements.create'), wrap(async (req, res) => {
    const out = await announcements.bulk(req.body || {}, req.user.id)
    await auth.log(req.user.id, 'admin.announcements.bulk', out.batch, String(out.created))
    res.json(out)
  }))

  // ---------- тексти гри мовами ----------
  r.get('/api/admin/game-texts/:kind', allow('game-texts.view'), wrap(async (req, res) => {
    const kind = req.params.kind
    if (!GAME[kind]) throw fail('невідомий вид', 404)
    const id = String(req.query.id || '')
    const rows = await db.all('SELECT * FROM game_texts WHERE kind = ? AND id = ?', kind, id)
    res.json({ langs: LANGS, texts: Object.fromEntries(rows.map((x) => [x.lang, { name: x.name || '', description: x.description || '', source: x.source, locked: !!x.locked, updated: x.updated }])) })
  }))
  r.put('/api/admin/game-texts/:kind', allow('game-texts.edit'), wrap(async (req, res) => {
    const kind = req.params.kind
    if (!GAME[kind]) throw fail('невідомий вид', 404)
    const id = String(req.query.id || '')
    const t = Date.now()
    for (const [lang, v] of Object.entries(req.body?.texts || {})) {
      if (!langOf(lang)) continue
      const name = String(v?.name || '').slice(0, 300) || null, description = String(v?.description || '').slice(0, 4000) || null
      if (!name && !description) { await db.run('DELETE FROM game_texts WHERE kind = ? AND id = ? AND lang = ?', kind, id, lang); continue }
      await db.run(`INSERT INTO game_texts (kind, id, lang, name, description, source, locked, updated) VALUES (?, ?, ?, ?, ?, 'manual', 1, ?)
        ON CONFLICT (kind, id, lang) DO UPDATE SET name = excluded.name, description = excluded.description, source = 'manual', locked = 1, updated = excluded.updated`, kind, id, lang, name, description, t)
    }
    game.invalidate()
    await auth.log(req.user.id, 'admin.game-texts', `${kind}/${id}`)
    res.json({ ok: true })
  }))

  // ---------- налаштування сайту (зручна форма) ----------
  const readSettings = async () => Object.fromEntries(await Promise.all(Object.entries(SITE_SETTINGS).map(async ([k, s]) => [k, await auth.settings.get(k, s.def)])))
  r.get('/api/admin/site-settings', allow('site.settings'), wrap(async (req, res) => res.json({ values: await readSettings(), schema: SITE_SETTINGS })))
  r.patch('/api/admin/site-settings', allow('site.settings'), wrap(async (req, res) => {
    // спершу перевіряємо все, потім пишемо — щоб хибне поле не лишило половину змін
    const next = {}
    for (const [k, v] of Object.entries(req.body || {})) {
      const s = SITE_SETTINGS[k]
      if (!s) continue
      if (s.type === 'select') {
        if (!s.options.includes(v)) throw fail('невідоме значення «{key}»', 400, { key: k })
        next[k] = v
      } else if (s.type === 'int') {
        const n = v === '' || v == null ? NaN : Number(v)
        if (!Number.isInteger(n) || (s.min != null && n < s.min) || (s.max != null && n > s.max)) throw fail('«{key}» — ціле число від {min} до {max}', 400, { key: k, min: s.min ?? 0, max: s.max ?? 100000 })
        next[k] = n
      } else if (s.type === 'limits') {
        // { user: { base: 10, … }, guild: { … } } — лише відомі види, цілі від 0 до 100 000
        const out = {}
        for (const who of ['user', 'guild']) {
          out[who] = {}
          for (const kind of Object.keys(DEFAULT_LIMITS[who])) {
            const n = Number(v?.[who]?.[kind] ?? DEFAULT_LIMITS[who][kind])
            if (!Number.isInteger(n) || n < 0 || n > 100000) throw fail('ліміт — ціле число від 0 до 100 000', 400)
            out[who][kind] = n
          }
        }
        next[k] = out
      } else {
        const t = String(v ?? '').trim().slice(0, 200)
        if (s.required && !t) throw fail('«{key}» не може бути порожнім', 400, { key: k })
        next[k] = t
      }
    }
    const before = await readSettings()
    for (const [k, v] of Object.entries(next)) {
      if (JSON.stringify(before[k]) === JSON.stringify(v)) continue
      await auth.settings.set(k, v)
      // налаштування теж мають історію змін, як і все інше
      await revisions.record('settings', k, 'update', { k, v: before[k] }, { k, v }, req.user.id)
    }
    await auth.log(req.user.id, 'admin.settings', '', JSON.stringify(req.body).slice(0, 300))
    res.json({ values: await readSettings() })
  }))

  return r
}

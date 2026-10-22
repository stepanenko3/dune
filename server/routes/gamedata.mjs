/*
 * Стан ігрових даних для індикатора оновлень (spec §5): GET /api/gamedata/status — розділи, джерело, коли змінились;
 * GET /api/gamedata/changes — журнал реальних змін сторінками. Адмінське: перевірити зараз, прийняти розділ, що чекає
 * підтвердження, звірити запасне з файлами гри, перемкнути основне джерело розділу. Реєстр вимкнено (нема GAMEDATA=1) —
 * порожній стан.
 */
import express from 'express'
import { wrap } from './auth.mjs'
import { SECTIONS } from '../lib/gamedata/sections.mjs'
import { compareReport, sectionsReport, switchPrimary } from '../lib/gamedata/index.mjs'
import { GROUPS, groupOf } from '../lib/gamedata/sections.mjs'
import { APPLIED } from '../lib/gamedata/apply.mjs'

const EMPTY = { game: { version: null, build: null }, updatedAt: null, sections: [] }

export function createGameDataRoutes({ sources, roles, game }) {
  const registry = sources?.registry ?? null
  const r = express.Router()
  const allow = (perm) => async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: req.t('потрібно увійти') })
    if (!(await roles.can(req.user, perm))) return res.status(403).json({ error: req.t('бракує прав') })
    next()
  }
  const off = (req, res) => res.status(409).json({ error: req.t('перевірку даних гри вимкнено') })
  const known = (section) => SECTIONS.includes(section)

  r.get('/api/gamedata/status', wrap(async (req, res) => {
    if (!registry) return res.set('cache-control', 'no-cache').json(EMPTY)
    const s = await registry.status()
    // текст помилки джерела (шляхи на сервері, повідомлення бази) — лише тим, хто керує даними
    const admin = !!req.user && (await roles.can(req.user, 'gamedata.manage'))
    res.set('cache-control', 'no-cache').json(admin ? s : { ...s, sections: s.sections.map((x) => ({ ...x, error: null })) })
  }))
  r.get('/api/gamedata/changes', wrap(async (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30))
    const before = req.query.before != null && Number.isFinite(Number(req.query.before)) ? Number(req.query.before) : null
    res.set('cache-control', 'no-cache').json(registry ? await registry.changes({ limit, before }) : { items: [], next: null })
  }))

  r.post('/api/admin/gamedata/check', allow('gamedata.manage'), wrap(async (req, res) => {
    if (!registry) return off(req, res)
    res.json({ results: await registry.check() })
  }))
  r.post('/api/admin/gamedata/accept/:section', allow('gamedata.manage'), wrap(async (req, res) => {
    if (!known(req.params.section)) return res.status(400).json({ error: req.t('немає такого розділу') })
    if (!registry) return off(req, res)
    res.json({ ok: await registry.accept(req.params.section) })
  }))
  r.get('/api/admin/gamedata/sections', allow('gamedata.manage'), wrap(async (req, res) => {
    if (!registry) return off(req, res)
    res.json(await sectionsReport(sources))
  }))
  r.post('/api/admin/gamedata/compare/:section', allow('gamedata.manage'), express.json(), wrap(async (req, res) => {
    if (!known(req.params.section)) return res.status(400).json({ error: req.t('немає такого розділу') })
    if (!registry) return off(req, res)
    const id = (v) => (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v) ? v : null)
    const rep = await compareReport(sources, req.params.section, { a: id(req.body?.a), b: id(req.body?.b) })
    if (!rep) return res.status(409).json({ error: req.t('для звірки потрібні обидва джерела') })
    res.json(rep)
  }))
  r.post('/api/admin/gamedata/reapply/:section', allow('gamedata.manage'), wrap(async (req, res) => {
    const { section } = req.params
    if (!APPLIED.includes(section)) return res.status(400).json({ error: req.t('цей розділ не застосовується в таблиці сайту') })
    if (!registry) return off(req, res)
    try { res.json({ ok: await registry.reapply(section) }) } catch (e) { res.status(409).json({ error: e.message }) }
  }))
  // основне джерело групи (довідник, мапа) чи окремого розділу
  r.post('/api/admin/gamedata/primary/:target', allow('gamedata.manage'), express.json(), wrap(async (req, res) => {
    const { target } = req.params
    // розділ з групи окремо не перемикається — лише вся група
    if (!GROUPS[target] && (!known(target) || groupOf(target))) return res.status(400).json({ error: req.t('немає такого розділу') })
    const driver = req.body?.driver
    if (!registry) return off(req, res)
    if (typeof driver !== 'string' || !sources.drivers?.[driver]) return res.status(400).json({ error: req.t('невідоме джерело') })
    try {
      res.json({ ok: true, results: await switchPrimary(sources, { game }, target, driver) })
    } catch (e) {
      res.status(409).json({ error: e.message })
    }
  }))
  return r
}

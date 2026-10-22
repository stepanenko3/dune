/*
 * Загальне для всього сайту: словник перекладу інтерфейсу мовою (з правками з панелі) і оголошення, які зараз
 * показувати цій людині.
 */
import express from 'express'
import { DEFAULT_LANG, langOf } from '../lib/gamedata.mjs'
import { hash } from '../lib/gamedata.mjs'
import { wrap } from './auth.mjs'

export function createSiteRoutes({ i18n, announcements, auth }) {
  const r = express.Router()

  // відбиток словника рахуємо раз, поки він той самий (правка в панелі дає новий об'єкт), а не хешем на кожен запит
  const etags = new WeakMap()
  const EMPTY = {}
  r.get('/api/i18n/:lang', (req, res) => {
    const lang = langOf(req.params.lang)
    if (!lang) return res.status(404).json({ error: req.t('невідома мова') })
    const dict = lang === DEFAULT_LANG ? EMPTY : i18n.dict(lang)
    if (!etags.has(dict)) etags.set(dict, `"i${lang}-${hash(JSON.stringify(dict))}"`)
    const etag = etags.get(dict)
    res.set('cache-control', 'no-cache').set('etag', etag)
    if (req.headers['if-none-match'] === etag) return res.status(304).end()
    res.json({ lang, dict })
  })

  // мова за замовчуванням (налаштування сайту) — для тих, чий браузер не каже жодної відомої сайту мови
  r.get('/api/i18n-default', wrap(async (req, res) => res.json({ lang: langOf(await auth.settings.get('defaultLang', DEFAULT_LANG)) || DEFAULT_LANG })))

  r.get('/api/announcements', wrap(async (req, res) => {
    const guildIds = req.ctx?.ranks ? [...req.ctx.ranks.keys()] : []
    const list = await announcements.active({ user: req.user, guildIds, lang: req.lang, staff: !!req.user && (req.ctx?.superuser || req.ctx?.moderate || req.user.role === 'admin') })
    res.set('cache-control', 'no-store').json({ list })
  }))

  return r
}

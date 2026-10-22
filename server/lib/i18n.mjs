/*
 * Переклади інтерфейсу (як gettext): ключ — сам український текст (як він у коді: t('Бази')), переклад — словник мови.
 * Словники в repo: locales/<мова>.json (їх доповнює scripts/i18n-extract.mjs і перекладачі); поверх них — правки з
 * панелі керування (таблиця translations), вони важливіші. Українська — мова коду, її словник порожній.
 * Мова запиту: ?lang= → cookie sw_lang → Accept-Language → українська.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_LANG, LANGS, langOf } from './gamedata.mjs'
import { fail, fill } from './util.mjs'

export async function createI18n(db, { dir }) {
  await db.exec(`CREATE TABLE IF NOT EXISTS translations (
    lang TEXT NOT NULL, key TEXT NOT NULL, text TEXT NOT NULL, by_user TEXT, updated BIGINT NOT NULL, PRIMARY KEY (lang, key)
  )`)
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } }
  let files = new Map()
  let overrides = new Map()
  const merged = new Map()
  async function load() {
    files = new Map(LANGS.map((l) => [l.code, read(`${l.code}.json`) || {}]))
    overrides = new Map()
    for (const r of await db.all('SELECT lang, key, text FROM translations')) {
      if (!overrides.has(r.lang)) overrides.set(r.lang, {})
      overrides.get(r.lang)[r.key] = r.text
    }
    merged.clear()
  }
  await load()

  /** словник мови: файл + правки з панелі */
  const dict = (lang) => {
    if (!merged.has(lang)) merged.set(lang, { ...(files.get(lang) || {}), ...(overrides.get(lang) || {}) })
    return merged.get(lang)
  }
  /** перекласти: немає перекладу — український текст (ключ) */
  const t = (lang, key, vars) => fill((lang && lang !== DEFAULT_LANG && dict(lang)[key]) || key, vars)

  /** усі ключі: з locales/keys.json (збирач тексту з коду) і з правок панелі; файл перечитуємо, лише коли він змінився */
  let keysCache = null, keysAt = 0
  const keysFile = () => {
    let at = 0
    try { at = fs.statSync(path.join(dir, 'keys.json')).mtimeMs } catch { /* файлу нема */ }
    if (!keysCache || at !== keysAt) { keysCache = read('keys.json') || {}; keysAt = at }
    return keysCache
  }
  const keys = () => {
    const k = { ...keysFile() }
    for (const o of overrides.values()) for (const key of Object.keys(o)) if (!(key in k)) k[key] = []
    return k
  }

  return {
    t,
    dict,
    keys,
    fileText: (lang, key) => files.get(lang)?.[key] ?? null,
    override: (lang, key) => overrides.get(lang)?.[key] ?? null,
    async set(lang, key, text, by) {
      if (!langOf(lang)) throw fail('невідома мова')
      if (text == null || text === '') await db.run('DELETE FROM translations WHERE lang = ? AND key = ?', lang, key)
      else await db.run(`INSERT INTO translations (lang, key, text, by_user, updated) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (lang, key) DO UPDATE SET text = excluded.text, by_user = excluded.by_user, updated = excluded.updated`, lang, key, String(text), by || null, Date.now())
      await load()
    },
    reload: load,
    /** скільки перекладено кожною мовою */
    coverage() {
      const all = Object.keys(keys())
      return LANGS.map((l) => ({ lang: l.code, total: all.length, done: l.code === DEFAULT_LANG ? all.length : all.filter((k) => dict(l.code)[k]).length }))
    },
  }
}

/** мова запиту */
export function pickLang(req) {
  const q = langOf(req.query?.lang)
  if (q) return q
  const c = /(?:^|;\s*)sw_lang=([\w-]+)/.exec(req.headers.cookie || '')?.[1]
  if (langOf(c)) return langOf(c)
  for (const part of String(req.headers['accept-language'] || '').split(',')) {
    const tag = part.split(';')[0].trim()
    const l = langOf(tag) || langOf(tag.split('-')[0]) || (tag.startsWith('zh') ? (/TW|HK|Hant/i.test(tag) ? 'zh-Hant' : 'zh-Hans') : null) || (tag.startsWith('pt') ? 'pt-BR' : null)
    if (l) return l
  }
  return DEFAULT_LANG
}

export function langMiddleware(i18n) {
  return (req, res, next) => {
    req.lang = pickLang(req)
    req.t = (key, vars) => i18n.t(req.lang, key, vars)
    next()
  }
}

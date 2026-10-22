/*
 * Зливає частини перекладів locales/parts/<щось>.<мова>.json у locales/<мова>.json (нове — додає, наявне в
 * основному файлі не переписує, якщо не --force). Частини пишуть ті, хто перекладав окремі розділи сайту.
 * Запуск: node scripts/i18n-merge.mjs [--force] [--clean] (--clean — видалити злиті частини)
 */
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(import.meta.dirname, '../locales')
const parts = path.join(dir, 'parts')
const force = process.argv.includes('--force')
const clean = process.argv.includes('--clean')
if (!fs.existsSync(parts)) { console.log('[i18n] частин нема'); process.exit(0) }

const byLang = new Map()
for (const f of fs.readdirSync(parts).filter((x) => x.endsWith('.json'))) {
  const m = /^(.+)\.([\w-]+)\.json$/.exec(f)
  if (!m) continue
  const lang = m[2]
  let d
  try { d = JSON.parse(fs.readFileSync(path.join(parts, f), 'utf8')) } catch (e) { console.warn(`  ! ${f}: ${e.message}`); continue }
  if (!byLang.has(lang)) byLang.set(lang, [])
  byLang.get(lang).push([f, d])
}
for (const [lang, list] of byLang) {
  const file = path.join(dir, `${lang}.json`)
  const cur = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  let added = 0, changed = 0
  for (const [, d] of list) {
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== 'string' || !v.trim()) continue
      if (!(k in cur)) { cur[k] = v; added++ } else if (force && cur[k] !== v) { cur[k] = v; changed++ }
    }
  }
  const sorted = Object.fromEntries(Object.entries(cur).sort(([a], [b]) => a.localeCompare(b, 'uk')))
  fs.writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n')
  console.log(`[i18n] ${lang}: +${added}${force ? `, змінено ${changed}` : ''} (усього ${Object.keys(sorted).length}) з ${list.map(([f]) => f).join(', ')}`)
  if (clean) for (const [f] of list) fs.rmSync(path.join(parts, f))
}

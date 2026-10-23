/*
 * Пакет розділів (spec §4.3): <work>/bundles/<збірка>/manifest.json + sections/<розділ>.json.gz. Хеш і лічильник — тим
 * самим кодом, що й у реєстрі сайту (server/lib/gamedata/hash.mjs), тож однакові дані дають однаковий хеш. Розділ, що
 * зламався чи підозріло малий, у пакет не йде (у маніфесті — { error }), решта йде; усі зламані — пакета нема.
 * Запис атомарний: тимчасова тека → rename, потім latest.json → rename.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { normalizeSection, sectionHash } from '../../../server/lib/gamedata/hash.mjs'
import { DEPOT } from './steam.mjs'
import { LANG_DIRS } from '../normalize/texts.mjs'

/** мінімум випущених записів — менше схоже на збій розбору, а не на патч */
export const MIN = { items: 1000, placeables: 500, recipes: 500, buildables: 300, skills: 80, spice: 50, markers: 1000, markerTypes: 100, resources: 10000, texts: 14 * 1000 }

/** мова перекладу, що має менше за цю частку записів англійської, — зламана (а не просто неповна) */
const LANG_MIN = 0.5

/** причина, чому розділ не годиться (null — годиться) */
function problem(id, data) {
  if (data instanceof Error) return data.message || String(data)
  if (id === 'ddResources') return Object.keys(data?.blob?.layouts ?? {}).length ? null : 'нема жодної розкладки з ресурсами'
  if (id === 'config') {
    const b = data?.blob
    if (!b?.spice || !Object.keys(b.spice.maps ?? {}).length) return 'нема лімітів полів меланжу'
    if (!b.coriolis?.seeds?.length || b.coriolis.cycleDays == null) return 'нема циклу Коріоліса чи сідів'
    return null
  }
  const n = normalizeSection(data).count
  if (MIN[id] != null && n < MIN[id]) return `${n} < ${MIN[id]}`
  if (id === 'texts') {
    // кожна з 14 мов — не менше половини англійської: зламана мова не має тихо зникнути з сайту
    const by = {}
    for (const r of data.records) { const l = String(r.id).split(':').pop(); by[l] = (by[l] ?? 0) + 1 }
    const en = by.en ?? 0
    const bad = Object.keys(LANG_DIRS).filter((l) => (by[l] ?? 0) < en * LANG_MIN)
    if (!en || bad.length) return `мало перекладів: ${(en ? bad : ['en']).map((l) => `${l} ${by[l] ?? 0}`).join(', ')} (en ${en})`
  }
  return null
}

const writeJsonAtomic = (file, value) => {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 1))
  fs.renameSync(file + '.tmp', file)
}

export async function writeBundle({ work, build, version, manifestId, sections, extractor }) {
  const root = path.join(work, 'bundles')
  const dir = path.join(root, String(build))
  const tmp = dir + '.tmp'
  const out = {}
  // розділ з файлами (ресурси ГП: файл на розкладку, уже стиснений) — у переліку розділу шлях кожного файлу; хеш розділу
  // — з переліку (у ньому хеш кожного файлу), самі файли — поруч
  const extra = {}
  for (const [id, data] of Object.entries(sections)) {
    if (data instanceof Error || !data?.files) continue
    const layouts = { ...data.blob.layouts }
    for (const k of Object.keys(data.files)) { const file = `sections/${id}-${k}.json.gz`; layouts[k] = { ...layouts[k], file }; extra[file] = data.files[k] }
    sections = { ...sections, [id]: { blob: { ...data.blob, layouts } } }
  }
  for (const [id, data] of Object.entries(sections)) {
    const p = problem(id, data)
    out[id] = p ? { error: p } : { file: `sections/${id}.json.gz`, schema: 1, hash: sectionHash(data), count: normalizeSection(data).count }
  }
  if (Object.values(out).every((s) => s.error)) {
    throw new Error('пакет не складено: ' + Object.entries(out).map(([k, s]) => `${k}: ${s.error}`).join('; '))
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.mkdirSync(path.join(tmp, 'sections'), { recursive: true })
  for (const [id, s] of Object.entries(out)) if (!s.error) fs.writeFileSync(path.join(tmp, s.file), zlib.gzipSync(JSON.stringify(sections[id])))
  for (const [file, gz] of Object.entries(extra)) if (!out[file.slice(9).split('-')[0]]?.error) fs.writeFileSync(path.join(tmp, file), gz)
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({
    schema: 1, game: { build: String(build), version: version ?? null, manifestId: manifestId ?? null, depot: DEPOT },
    extractedAt: new Date().toISOString(), extractor, sections: out,
  }, null, 1))
  fs.rmSync(dir, { recursive: true, force: true })
  fs.renameSync(tmp, dir)
  writeJsonAtomic(path.join(root, 'latest.json'), { build: String(build), dir })
  return dir
}

/** лишити keep найновіших збірок (і поточну з latest.json) у bundles/, raw/, extract/ */
export function prune(work, keep = 2) {
  let current = null
  try { current = JSON.parse(fs.readFileSync(path.join(work, 'bundles', 'latest.json'), 'utf8')).build } catch { /* пакета ще нема */ }
  const dirs = ['bundles', 'raw', 'extract']
  const builds = new Set()
  for (const d of dirs) {
    try { for (const x of fs.readdirSync(path.join(work, d))) if (/^\d+$/.test(x)) builds.add(x) } catch { /* теки ще нема */ }
  }
  const sorted = [...builds].sort((a, b) => Number(b) - Number(a))
  const stay = new Set([...sorted.slice(0, keep), ...(current ? [current] : [])])
  for (const b of sorted) if (!stay.has(b)) for (const d of dirs) fs.rmSync(path.join(work, d, b), { recursive: true, force: true })
  // недорозпаковане (обірвана розпаковка — до 4 GB) і недописане (обірваний запис пакета)
  const leftovers = (d, re) => { try { for (const x of fs.readdirSync(path.join(work, d))) if (re.test(x)) fs.rmSync(path.join(work, d, x), { recursive: true, force: true }) } catch { /* теки нема */ } }
  leftovers('extract', /^sha-/)
  leftovers('bundles', /\.tmp$/)
}

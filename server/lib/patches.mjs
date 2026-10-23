/*
 * «Що змінилось у патчі»: різниця між пакетами видобувача двох сусідніх збірок гри (GAMEDATA_BUNDLE_DIR/<збірка>).
 * Видобувач тримає лише дві останні збірки, тож порахований патч лежить у базі (game_patches) і живе далі за пакет.
 *
 * Що рахуємо: предмети, пристрої, рецепти, будівельні модулі, уміння — нове (і вперше випущене), прибране, змінене
 * (поле: було → стало); назви й описи — усіма мовами гри, але змінене вирішує англійська (виправлення перекладу — не
 * патч). Мапа — лише лічильники точок за типом і лише коли код видобувача той самий (manifest.extractor.code): інакше
 * покращення видобувача виглядали б як патч.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { stableStringify } from './gamedata/hash.mjs'

/** версія формату записаного патча: інша — перераховуємо (поки обидва пакети є) */
export const PATCH_SCHEMA = 1
export const PATCH_SECTIONS = ['items', 'placeables', 'recipes', 'buildables', 'skills']
/** вид текстів гри для записів розділу */
export const TEXT_KIND = { items: 'item', placeables: 'placeable', recipes: 'recipe', buildables: 'buildable', skills: 'skill' }
/** поля, що для гравця не зміна */
const IGNORE = new Set(['id', 'released'])
/** уміння: ранги — за ціною й бонусами (тексти perks/buffs — службові) */
const VIEW = {
  skills: ({ levels, ...rest }) => ({ ...rest, levels: (levels ?? []).map((l) => ({ cost: l.cost, bonuses: l.bonuses ?? [] })) }),
}
/** що з запису лишити для показу (картка в списку) */
const CARD = ['name', 'icon', 'img', 'grade', 'rarity', 'cat', 'school', 'kind', 'set', 'group', 'out']
/** точки мапи: розділ → поле типу */
const MAP_SECTIONS = { markers: 'type', resources: 'type' }

const same = (a, b) => stableStringify(a ?? null) === stableStringify(b ?? null)
const released = (r) => r && r.released !== false

/** пакети в теці: [{ build, root, manifest }] за номером збірки */
export function listBundles(dir) {
  if (!dir) return []
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out = []
  for (const x of names) {
    if (!/^\d+$/.test(x)) continue
    const root = path.join(dir, x)
    try { out.push({ build: x, root, manifest: JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) }) } catch { /* пакет недописаний */ }
  }
  return out.sort((a, b) => Number(a.build) - Number(b.build))
}

function readSection(bundle, section) {
  const s = bundle.manifest.sections?.[section]
  if (!s?.file || s.error) return null
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(bundle.root, s.file))).toString('utf8'))
}

/** тексти пакета: Map `${вид}:${id}` → { lang: { name, description } } — лише види розділів патчу */
function textsOf(bundle) {
  const kinds = new Set(Object.values(TEXT_KIND))
  const out = new Map()
  for (const r of readSection(bundle, 'texts')?.records ?? []) {
    const parts = String(r.id).split(':')
    if (parts.length !== 3 || !kinds.has(parts[0])) continue
    const key = parts[0] + ':' + parts[1]
    if (!out.has(key)) out.set(key, {})
    out.get(key)[parts[2]] = { name: r.name ?? null, description: r.description ?? null }
  }
  return out
}

const card = (r) => Object.fromEntries(CARD.filter((k) => r[k] != null).map((k) => [k, r[k]]))
/** картка з назвами всіма мовами гри (з текстів пакета): сайт покаже назву мовою людини, без англійської */
const named = (r, kind, texts) => {
  const t = texts.get(`${kind}:${r.id}`)
  const names = t ? Object.fromEntries(Object.entries(t).filter(([, x]) => x.name).map(([lang, x]) => [lang, x.name])) : {}
  return { id: String(r.id), ...card(r), names }
}

/**
 * Різниця одного розділу. Записи — без невипущеного; desc — англійський опис з текстів (якщо є), інакше з запису.
 * Повертає { added: [card+id], removed: [...], changed: [{ id, ...card, fields: [[поле, було, стало]], texts? }] }
 */
export function diffSection(section, prevRecords, nextRecords, { prevTexts = new Map(), nextTexts = new Map() } = {}) {
  const kind = TEXT_KIND[section]
  const view = VIEW[section] ?? ((r) => r)
  const en = (texts, id) => texts.get(`${kind}:${id}`)?.en ?? null
  const prep = (r, texts) => {
    const v = view(r)
    const d = en(texts, r.id)
    return d ? { ...v, name: d.name ?? v.name, desc: d.description ?? v.desc ?? null } : v
  }
  const a = new Map(prevRecords.filter(released).map((r) => [String(r.id), r]))
  const b = new Map(nextRecords.filter(released).map((r) => [String(r.id), r]))
  const out = { added: [], removed: [], changed: [] }
  for (const [id, rb] of b) {
    const ra = a.get(id)
    if (!ra) { out.added.push(named(rb, kind, nextTexts)); continue }
    const va = prep(ra, prevTexts), vb = prep(rb, nextTexts)
    const keys = [...new Set([...Object.keys(va), ...Object.keys(vb)])].filter((k) => !IGNORE.has(k) && !same(va[k], vb[k])).sort()
    if (!keys.length) continue
    const item = { ...named(rb, kind, nextTexts), fields: keys.map((k) => [k, va[k] ?? null, vb[k] ?? null]) }
    // назва чи опис змінились — усіма мовами (сайт показує мовою людини)
    if (keys.includes('name') || keys.includes('desc')) {
      const ta = prevTexts.get(`${kind}:${id}`) ?? {}, tb = nextTexts.get(`${kind}:${id}`) ?? {}
      const texts = {}
      for (const lang of new Set([...Object.keys(ta), ...Object.keys(tb)])) {
        const x = ta[lang] ?? {}, y = tb[lang] ?? {}
        const t = {}
        if (x.name !== y.name) t.name = [x.name ?? null, y.name ?? null]
        if (x.description !== y.description) t.desc = [x.description ?? null, y.description ?? null]
        if (Object.keys(t).length) texts[lang] = t
      }
      if (Object.keys(texts).length) item.texts = texts
    }
    out.changed.push(item)
  }
  for (const [id, ra] of a) if (!b.has(id)) out.removed.push(named(ra, kind, prevTexts))
  return out
}

/** лічильники точок мапи за (мапа, тип) і різниця: [{ map, type, was, now }] */
export function diffMapCounts(prevRecords, nextRecords, field = 'type') {
  const count = (rs) => {
    const m = new Map()
    for (const r of rs ?? []) { const k = `${r.map}|${r[field]}`; m.set(k, (m.get(k) ?? 0) + 1) }
    return m
  }
  const a = count(prevRecords), b = count(nextRecords)
  const out = []
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const was = a.get(k) ?? 0, now = b.get(k) ?? 0
    if (was === now) continue
    const [map, type] = k.split('|')
    out.push({ map, type, was, now })
  }
  return out.sort((x, y) => Math.abs(y.now - y.was) - Math.abs(x.now - x.was))
}

/** предмети й пристрої, на які посилаються рецепти й модулі (для показу інгредієнтів): id → картка */
function refsOf(notes, bundles, texts) {
  const want = new Set()
  // рецепт у списку веде на свій результат
  for (const r of [...(notes.sections.recipes?.added ?? []), ...(notes.sections.recipes?.removed ?? []), ...(notes.sections.recipes?.changed ?? [])]) for (const [id] of r.out ?? []) want.add(id)
  for (const sec of ['recipes', 'buildables']) {
    const s = notes.sections[sec]
    if (!s) continue
    for (const r of s.changed) for (const [k, x, y] of r.fields) {
      if (k === 'in' || k === 'out' || k === 'cost') for (const v of [x, y]) for (const [id] of v ?? []) want.add(id)
      if (k === 'at') for (const v of [x, y]) for (const id of v ?? []) want.add(id)
    }
  }
  const refs = {}
  for (const b of bundles) {
    for (const sec of ['items', 'placeables']) {
      for (const r of b[sec] ?? []) if (want.has(r.id) && !refs[r.id]) refs[r.id] = { kind: TEXT_KIND[sec], ...named(r, TEXT_KIND[sec], texts) }
    }
  }
  return refs
}

/** патч між двома пакетами: { build, prevBuild, version, prevVersion, extractedAt, summary, notes } */
export function computePatch(prev, next) {
  const pt = textsOf(prev), nt = textsOf(next)
  const notes = { sections: {}, map: null, refs: {} }
  const loaded = { prev: {}, next: {} }
  for (const s of PATCH_SECTIONS) {
    const a = readSection(prev, s), b = readSection(next, s)
    if (!a?.records || !b?.records) continue
    loaded.prev[s] = a.records
    loaded.next[s] = b.records
    notes.sections[s] = diffSection(s, a.records, b.records, { prevTexts: pt, nextTexts: nt })
  }
  // мапа — лише тим самим видобувачем (код відомий з обох боків і однаковий)
  const ca = prev.manifest.extractor?.code ?? null, cb = next.manifest.extractor?.code ?? null
  if (ca && cb && ca === cb) {
    notes.map = { counts: {} }
    for (const [s, field] of Object.entries(MAP_SECTIONS)) {
      const a = readSection(prev, s), b = readSection(next, s)
      if (a?.records && b?.records) notes.map.counts[s] = diffMapCounts(a.records, b.records, field)
    }
  } else {
    notes.map = { skipped: 'extractor' }
  }
  notes.refs = refsOf(notes, [loaded.next, loaded.prev], new Map([...pt, ...nt]))
  const summary = {}
  for (const [s, d] of Object.entries(notes.sections)) summary[s] = { added: d.added.length, removed: d.removed.length, changed: d.changed.length }
  return {
    build: next.build, prevBuild: prev.build,
    version: next.manifest.game?.version ?? null, prevVersion: prev.manifest.game?.version ?? null,
    extractedAt: Date.parse(next.manifest.extractedAt) || null,
    summary, notes,
  }
}

/** у патчі є що показати гравцю (довідник; мапа — не рахується) */
export const hasChanges = (summary) => Object.values(summary ?? {}).some((x) => x.added || x.removed || x.changed)

/**
 * Сховище патчів. onNew(patch) — щойно порахований патч свіжої збірки (для сповіщень); давні пари, які сайт побачив
 * уперше (перший запуск), — без сповіщення.
 */
export async function createPatches({ db, bundleDir = process.env.GAMEDATA_BUNDLE_DIR || null, log = console, now = Date.now, onNew = null, freshMs = 3 * 86400_000 }) {
  await db.exec(`CREATE TABLE IF NOT EXISTS game_patches (
    build TEXT PRIMARY KEY, prev_build TEXT NOT NULL, version TEXT, prev_version TEXT, extracted_at BIGINT,
    created BIGINT NOT NULL, schema INTEGER NOT NULL, summary TEXT NOT NULL, notes TEXT NOT NULL
  )`)
  let running = null

  /** порахувати патчі збірок, яких ще нема (чи записаних давнім форматом); результат — нові збірки */
  async function scan() {
    if (running) return running
    running = (async () => {
      const bundles = listBundles(bundleDir)
      const made = []
      for (let i = 1; i < bundles.length; i++) {
        const prev = bundles[i - 1], next = bundles[i]
        const row = await db.get('SELECT prev_build, schema FROM game_patches WHERE build = ?', next.build)
        if (row && Number(row.schema) === PATCH_SCHEMA && row.prev_build === prev.build) continue
        // записаний від іншої попередньої збірки (тієї вже нема в теці) — лишаємо, поки формат той самий
        if (row && Number(row.schema) === PATCH_SCHEMA) continue
        try {
          const p = computePatch(prev, next)
          await db.run(
            `INSERT INTO game_patches (build, prev_build, version, prev_version, extracted_at, created, schema, summary, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (build) DO UPDATE SET prev_build = excluded.prev_build, version = excluded.version, prev_version = excluded.prev_version,
               extracted_at = excluded.extracted_at, schema = excluded.schema, summary = excluded.summary, notes = excluded.notes`,
            p.build, p.prevBuild, p.version, p.prevVersion, p.extractedAt, now(), PATCH_SCHEMA, JSON.stringify(p.summary), JSON.stringify(p.notes),
          )
          made.push(p.build)
          log.info?.(`[patches] ${p.prevBuild} → ${p.build}: ${JSON.stringify(p.summary)}`)
          // сповіщаємо лише про свіже: уперше порахований давній патч (перший запуск, перерахунок формату) — мовчки
          if (!row && onNew && hasChanges(p.summary) && p.extractedAt && now() - p.extractedAt < freshMs) {
            await Promise.resolve(onNew({ build: p.build, prevBuild: p.prevBuild, version: p.version, summary: p.summary })).catch((e) => log.warn?.(`[patches] сповіщення: ${e?.message || e}`))
          }
        } catch (e) {
          log.warn?.(`[patches] ${prev.build} → ${next.build}: ${e?.message || e}`)
        }
      }
      return made
    })()
    try { return await running } finally { running = null }
  }

  const head = (r) => ({
    build: r.build, prevBuild: r.prev_build, version: r.version ?? null, prevVersion: r.prev_version ?? null,
    extractedAt: r.extracted_at == null ? null : Number(r.extracted_at), summary: JSON.parse(r.summary),
  })

  async function list() {
    const rows = await db.all('SELECT build, prev_build, version, prev_version, extracted_at, summary FROM game_patches')
    return rows.map(head).sort((a, b) => Number(b.build) - Number(a.build))
  }

  async function get(build) {
    const r = await db.get('SELECT * FROM game_patches WHERE build = ?', String(build))
    return r ? { ...head(r), notes: JSON.parse(r.notes) } : null
  }

  return { scan, list, get }
}

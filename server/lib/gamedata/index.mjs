/*
 * Джерела ігрових даних сайту: файли гри (пакет видобувача з GAMEDATA_BUNDLE_DIR) — основне для всього, що в них є, і
 * винятки там, де в серверних файлах нема пікселів чи дані ще не видобуто: TH.GL (мапа, точки, розкладки ГП, картинки мапи). Сторонніх зборів довідника, умінь і перекладів нема. Кілька джерел для розділу —
 * на майбутнє: тоді основне вибирає адмін, а розділи однієї групи (довідник, мапа) перемикаються разом. Дані файлів гри
 * реєстр застосовує в таблиці сайту. Вмикається GAMEDATA=1 (до того — жодних таблиць і записів).
 */
import { createRegistry } from './registry.mjs'
import { createGamefilesDriver } from './drivers/gamefiles.mjs'
import { createThglDriver } from './drivers/thgl.mjs'
import { APPLIED, createAppliers } from './apply.mjs'
import { compareSection } from './compare.mjs'
import { GROUPS, SECTIONS, groupOf } from './sections.mjs'

export async function createGameDataSources({ db, dataDir, game, mapData, spice, gamemap, log = console, enabled = process.env.GAMEDATA === '1', bundleDir = process.env.GAMEDATA_BUNDLE_DIR || null }) {
  if (!enabled) return null
  const drivers = { gamefiles: createGamefilesDriver({ dir: bundleDir }), thgl: createThglDriver({ mapData }) }
  const registry = await createRegistry({
    db, dataDir, log,
    drivers: Object.values(drivers),
    primaryOf: (section) => game.getPrimary(section),
    apply: createAppliers({ game, spice, gamemap }),
  })
  return { registry, drivers, db, game }
}

/** доступні джерела розділу (у порядку пріоритету: файли гри, винятки) */
const available = (sources, section) => Object.values(sources.drivers).filter((d) => d.sections().includes(section)).map((d) => d.id)
/** джерела, що мають усі розділи групи (лише їх і можна вибрати для групи) */
const groupAvailable = (sources, ids) => Object.values(sources.drivers).filter((d) => ids.every((s) => d.sections().includes(s) || !SECTIONS.includes(s) || !available(sources, s).length)).map((d) => d.id)
const optionsOf = (sources, section) => Object.values(sources.drivers).map((d) => d.sections().includes(section) && d.describe?.(section)).filter(Boolean)

/** звіт для адмінки: групи й розділи (основне, звідки зараз, доступні джерела), пакет */
export async function sectionsReport(sources) {
  const st = await sources.registry.status()
  const by = new Map(st.sections.map((s) => [s.id, s]))
  const sections = SECTIONS.filter((id) => by.has(id) || available(sources, id).length).map((id) => ({
    id, group: groupOf(id), available: available(sources, id), switchable: available(sources, id).length > 1,
    // дані файлів гри цього розділу пишуться в таблиці сайту («Перезаписати з файлів гри» має сенс)
    applies: APPLIED.includes(id),
    // варіанти: кожне джерело, що зараз має цей розділ, з конкретною назвою
    options: optionsOf(sources, id),
    ...(by.get(id) ?? { primary: null, driver: null, status: null, count: null, changedAt: null, checkedAt: null, error: null }),
  }))
  const groups = Object.entries(GROUPS).map(([id, ids]) => {
    const can = groupAvailable(sources, ids.filter((s) => available(sources, s).length))
    return { id, sections: ids, available: can, switchable: can.length > 1 }
  })
  const m = sources.drivers.gamefiles.manifest()
  const bundle = m ? { build: m.game?.build ?? null, version: m.game?.version ?? null, manifestId: m.game?.manifestId ?? null, extractedAt: m.extractedAt ?? null } : null
  return { sections, groups, bundle, game: st.game }
}

/**
 * Порівняння розділу: a — звідки зараз (за замовчуванням — поточне джерело розділу), b — вибране інше (за замовчуванням —
 * перше інше, що має розділ). null — нема з чим порівнювати (одне джерело, однакові, розділ без записів — мапа, картинки).
 */
export async function compareReport(sources, section, { a = null, b = null } = {}) {
  const ids = available(sources, section)
  const from = a ?? (await sources.registry.status()).sections.find((s) => s.id === section)?.driver ?? null
  const to = b ?? ids.find((x) => x !== from) ?? null
  if (!from || !to || from === to || !ids.includes(from) || !ids.includes(to)) return null
  const load = (id) => sources.drivers[id].load(section, { fresh: true })
  const [da, db] = await Promise.all([load(from), load(to)])
  if (!Array.isArray(da.data?.records) || !Array.isArray(db.data?.records)) return null
  return compareSection(section, { a: { id: from, records: da.data.records }, b: { id: to, records: db.data.records } })
}

/**
 * Перемкнути основне джерело групи (довідник, мапа) чи окремого розділу: джерело мусить мати всі розділи групи, що взагалі
 * десь є. Розділи перевіряються одразу (дані файлів гри застосовуються); не вдалося — основне назад.
 */
export async function switchPrimary(sources, { game }, target, driver) {
  const ids = GROUPS[target] ?? (SECTIONS.includes(target) && !groupOf(target) ? [target] : null)
  if (!ids) throw new Error(`розділ ${target} не перемикається окремо`)
  if (!sources.drivers[driver]) throw new Error(`нема джерела ${driver}`)
  const real = ids.filter((s) => available(sources, s).length)
  const lack = real.filter((s) => !sources.drivers[driver].sections().includes(s))
  if (!real.length || lack.length) throw new Error(`у джерела ${driver} нема: ${(lack.length ? lack : ids).join(', ')}`)
  // мапа: нове джерело мусить мати точки (місця чи ресурси) всіх мап, де вони є в іншого джерела, — інакше міста й
  // Глибока пустеля лишились би порожніми
  if (target === 'map') {
    const mapsOf = async (d) => {
      const out = new Set()
      for (const s of ['markers', 'resources']) if (d.sections().includes(s)) for (const r of (await d.load(s)).data.records ?? []) out.add(r.map)
      return out
    }
    const have = await mapsOf(sources.drivers[driver])
    const lack = new Set()
    for (const d of Object.values(sources.drivers)) if (d.id !== driver) for (const m of await mapsOf(d)) if (!have.has(m)) lack.add(m)
    if (lack.size) throw new Error(`у джерела ${driver} ще нема точок мап: ${[...lack].join(', ')}`)
  }
  const prev = await game.getPrimary(real[0])
  await game.setPrimary(target, driver)
  // перемикання адміном — не збій джерела: спад обсягу тут не на підтвердженні
  const results = await sources.registry.check(real, { switched: true })
  const bad = results.find((r) => r.driver !== driver || !['first', 'changed', 'same'].includes(r.status))
  if (bad) {
    await game.setPrimary(target, prev)
    game.invalidate()
    throw new Error(`не перемкнуто: ${bad.section} — ${bad.status}`)
  }
  for (const r of results) if (r.status === 'same') await sources.registry.reapply(r.section)
  game.invalidate()
  return results
}

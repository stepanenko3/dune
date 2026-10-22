/*
 * Генератор баз — вхід: generateBase(параметри, рушій) → { doc, report, notes, errors, params, plan }.
 * Рушій — { PIECES, STABILITY, BASEDATA, CONVERT, PRESETS }: у браузері — з lib/engine.ts і палітри станцій, на
 * сервері — ті самі файли через require (server/lib/basegen.mjs). report — правила гри (rules.mjs): база з помилками
 * не створюється.
 */
import { createKit } from './kit.mjs'
import { generate, normalizeParams, DEFAULTS, LIMITS, G, SHAPES, AIR, GROUND, CONTAINER, BAY_TYPES, STATION_TYPES, STATION_SETS, OUTDOOR, bayCells, bayList, regroup } from './generate.mjs'
import { rules, RULES } from './rules.mjs'
import { STYLE_PRESETS, STYLE_ENUMS, STYLE_FLAGS, STYLE_DEFAULT, normalizeStyle, presetOf, randomStyle } from './style.mjs'

export { STYLE_PRESETS, STYLE_ENUMS, STYLE_FLAGS, STYLE_DEFAULT, normalizeStyle, presetOf, randomStyle }

export { normalizeParams, DEFAULTS, LIMITS, G, SHAPES, AIR, GROUND, CONTAINER, BAY_TYPES, STATION_TYPES, STATION_SETS, OUTDOOR, bayCells, bayList, regroup, rules, RULES }

export function generateBase(raw, E) {
  const kit = createKit(E)
  const out = generate(raw, kit)
  if (!out.doc) return { ...out, report: null }
  return { ...out, report: rules(out.doc, E) }
}

/**
 * «Рандом» — змінює все, що задає вигляд бази: розкладку ділянок (скільки й як складені), форми ділянок, як техніка
 * розкладена по ангарах і гаражах і як вони відкриваються (наскрізь, з одного боку, щит у даху), стиль (пресет чи свій
 * набір) і варіант. Лишається те, що людині потрібно мати: скільки якої техніки, станції й кімнати житла. Пробує, доки
 * база не пройде всі правила гри (до tries разів); не вийшло — ті самі ділянки й ангари з новим стилем і варіантом.
 * rand — () → [0, 1). Повертає параметри.
 */
export function randomize(raw, E, rand = Math.random, tries = 40) {
  const { params: n0 } = normalizeParams(raw)
  const p = { cells: n0.cells, shapes: n0.shapes, bays: n0.bays, stations: n0.stations, rooms: n0.rooms, style: n0.style, seed: n0.seed, name: n0.name }
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const seed = () => 1 + Math.floor(rand() * 999999)
  // скільки ділянок щонайменше: ангари поспіль (орні — нагорі, над першим поверхом) і гаражі на першому
  const need = (bays) => Math.max(1, ...['air', 'ground'].map((k) => bays.filter((b) => b.kind === k).reduce((s, b) => s + Math.max(1, bayCells(b)), 0)))
  for (let n = 0; n < tries; n++) {
    // ангари й гаражі: інше групування, інший вхід
    let bays = p.bays.length ? regroup(p.bays, pick(['type', 'small', 'all', 'pairs']), pick(['all', 'type'])) : []
    bays = bays.map((b) => {
      if (b.kind === 'ground') return { ...b, portals: 1, roof: b.roof || rand() < 0.2 }
      const r = rand()
      return { ...b, portals: r < 0.55 ? 2 : r < 0.8 ? 1 : 0, roof: r >= 0.7 }
    })
    // розкладка: від однієї ділянки — до сусідньої випадкової, поки не набереться
    const size = Math.min(LIMITS.cells, Math.max(need(bays), 2) + Math.floor(rand() * (LIMITS.cells - Math.max(need(bays), 2) + 1)))
    const cells = [[0, 0]]
    const has = (i, j) => cells.some((c) => c[0] === i && c[1] === j)
    while (cells.length < size) {
      const [i, j] = pick(cells), [di, dj] = pick([[1, 0], [-1, 0], [0, 1], [0, -1]])
      if (!has(i + di, j + dj)) cells.push([i + di, j + dj])
    }
    // форми: здебільшого квадрати, часом одна чи дві фігурні
    const shapes = {}
    const fancy = rand() < 0.45 ? (rand() < 0.3 ? 2 : 1) : 0
    for (let k = 0; k < fancy; k++) { const [i, j] = pick(cells); shapes[i + ',' + j] = pick(['hex', 'dodeca', 'yard', 'atrium']) }
    const norm = normalizeParams({ ...p, cells, shapes }).params
    const next = { ...p, cells: norm.cells, shapes: norm.shapes, bays, style: randomStyle(rand), seed: seed() }
    const g = generateBase(next, E)
    if (g.doc && !g.report.errors.length) return next
  }
  return { ...p, style: randomStyle(rand), seed: seed() }
}

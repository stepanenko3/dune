/*
 * Генератор баз: параметри людини → документ бази з деталей гри (format 2).
 *   - ділянки 10 × 10 і форма кожної: квадрат, шестикутник, дванадцятикутник, прямокутник із двором, квадрат із
 *     внутрішнім двором (атріум); ангари й гаражі — лише на квадратах (пентащит у грі — лише на квадратах);
 *   - ангари й гаражі списком: що в кожному стоїть, скільки ділянок поспіль він займає (1–3, з того, що в ньому),
 *     вхід — наскрізні портали, портал з одного боку, пентащит у даху (горизонтальний) чи портал і щит у даху;
 *   - станції поштучно (тип → кількість), житло (кімнати), стиль (стіни, дахи), варіант (seed).
 * Кожна ділянка — перший поверх (висота G) і, можливо, верхній модуль (ангар чи житло); квадратні ділянки без
 * верхнього модуля — тераси з вітропастками й вітряками (якщо верхній рівень є).
 * Порядок: форми → ангари й гаражі → житло → сходи → призначення решти ділянок → блоки й правки конструктора
 * (kit.mjs) → станції (пакувальник geom.fit) → документ. Правила гри перевіряє rules.mjs на готовому документі.
 * Той самий вхід (разом із seed) — та сама база.
 */
import { DIRS, OPP, SIDES, doorU, fit, frame, obb, overlap, rectPoly, rng } from './geom.mjs'
import { normalizeStyle, roofBase, roofRound, varyStyle } from './style.mjs'

/** висота першого поверху */
export const G = 4
const H_LIVING = 3

export const SHAPES = ['square', 'hex', 'dodeca', 'yard', 'atrium']
export const AIR = ['OrnithopterLight', 'OrnithopterMedium', 'OrnithopterTransport']
export const GROUND = ['Sandbike', 'Buggy', 'Sandcrawler']
/** вантажний контейнер грузового — місце стоянки в ангарі чи гаражі; забирає його грузовий згори (щит у даху) */
export const CONTAINER = 'ContainerVehicle'
/** що може стояти в ангарі (air) і гаражі (ground) */
export const BAY_TYPES = { air: [...AIR, CONTAINER], ground: [...GROUND, CONTAINER] }
/** станції гри (палітра builder/presets.json без техніки) — тест звіряє з палітрою */
export const STATION_TYPES = [
  'Fabricator_Placeable', 'WearablesFabricator_Placeable', 'AdvancedWearablesFabricator_Placeable', 'SurvivalFabricator_Placeable', 'Advanced_SurvivalFabricator_Placeable', 'WeaponsFabricator_Placeable', 'AdvancedWeaponsFabricator_Placeable', 'VehiclesFabricator_Placeable', 'Advanced_VehiclesFabricator_Placeable',
  'SmallOreRefinery_Placeable', 'MediumOreRefinery_Placeable', 'LargeOreRefinery_Placeable', 'SmallChemicalRefinery_Placeable', 'MediumChemicalRefinery_Placeable', 'SpiceRefinery_Placeable', 'MediumSpiceRefinery_Placeable', 'LargeSpiceRefinery_Placeable',
  'SpiceSilo_Placeable', 'GenericContainer_Placeable', 'StorageContainer_Placeable', 'MediumStorageContainer_Placeable',
  'Windtrap_Placeable', 'LargeWindtrap_Placeable', 'BloodWaterExtractor_Placeable', 'BloodWaterExtractionAdvanced_Placeable', 'Fremen_Deathstill_Placeable', 'Deathstill_Placeable', 'WaterCistern_Placeable', 'MediumWaterCistern_Placeable', 'LargeWaterCistern_Placeable',
  'Generator_Placeable', 'SpiceGenerator_Placeable', 'WindTurbineDirectional_Placeable', 'WindTurbineOmnidirectional_Placeable',
  'Totem_Small_Placeable', 'Totem_Placeable', 'RepairStation_Placeable', 'Recycler_Placeable', 'ModdingStation_Placeable',
]
/** надворі (тераси, двори) */
export const OUTDOOR = new Set(['Windtrap_Placeable', 'LargeWindtrap_Placeable', 'WindTurbineDirectional_Placeable', 'WindTurbineOmnidirectional_Placeable'])
/** куди станцію ставити спершу */
const ROLE_OF = (type) => (/Fabricator_Placeable$/.test(type) || type === 'Recycler_Placeable' || type === 'RepairStation_Placeable' ? 'workshop'
  : /Refinery_Placeable$/.test(type) ? 'refinery'
    : ['SpiceSilo_Placeable', 'StorageContainer_Placeable', 'MediumStorageContainer_Placeable'].includes(type) ? 'storage'
      : /BloodWater|Deathstill|Cistern|Generator_Placeable$/.test(type) ? 'water'
        : 'hall')

export const LIMITS = { cells: 6, bays: 8, perBayAir: 6, perBayGround: 8, orni: 8, carrier: 2, ground: 12, rooms: 8, station: 12, stations: 90, name: 120, bayCells: 3 }

/** готові набори станцій (кнопки «Нічого / Базове / Удосконалене») */
const count = (list) => list.reduce((o, t) => ((o[t] = (o[t] || 0) + 1), o), {})
const rep = (t, n) => Array.from({ length: n }, () => t)
export const STATION_SETS = {
  none: count(['Totem_Placeable', 'GenericContainer_Placeable', 'GenericContainer_Placeable']),
  basic: count([
    'Totem_Placeable', 'GenericContainer_Placeable', 'GenericContainer_Placeable', 'GenericContainer_Placeable',
    'Fabricator_Placeable', 'WeaponsFabricator_Placeable', 'WearablesFabricator_Placeable', 'SurvivalFabricator_Placeable', 'Recycler_Placeable', 'RepairStation_Placeable',
    'MediumOreRefinery_Placeable', 'MediumOreRefinery_Placeable', 'SmallChemicalRefinery_Placeable', 'SpiceRefinery_Placeable',
    ...rep('MediumStorageContainer_Placeable', 4),
    'WaterCistern_Placeable', 'Fremen_Deathstill_Placeable', 'BloodWaterExtractor_Placeable', ...rep('Windtrap_Placeable', 2),
    'Generator_Placeable', ...rep('WindTurbineDirectional_Placeable', 6),
  ]),
  advanced: count([
    'Totem_Placeable', 'GenericContainer_Placeable', 'GenericContainer_Placeable', 'GenericContainer_Placeable', 'ModdingStation_Placeable',
    'Advanced_VehiclesFabricator_Placeable', 'AdvancedWeaponsFabricator_Placeable', 'AdvancedWearablesFabricator_Placeable', 'Advanced_SurvivalFabricator_Placeable', 'Fabricator_Placeable', 'Recycler_Placeable', 'RepairStation_Placeable',
    'LargeOreRefinery_Placeable', 'LargeOreRefinery_Placeable', 'MediumChemicalRefinery_Placeable', 'MediumChemicalRefinery_Placeable', 'MediumSpiceRefinery_Placeable',
    ...rep('MediumStorageContainer_Placeable', 8),
    'LargeWaterCistern_Placeable', 'LargeWaterCistern_Placeable', 'Deathstill_Placeable', 'BloodWaterExtractionAdvanced_Placeable', ...rep('LargeWindtrap_Placeable', 4),
    'SpiceGenerator_Placeable', 'SpiceGenerator_Placeable', 'Generator_Placeable',
  ]),
  // фінальний набір: усе, що стоїть на базі гільдії наприкінці гри (удосконалені фабрикатори, великі переробники,
  // великий переробник спайсу, вода й енергія на спайсі, склад)
  endgame: count([
    'Totem_Placeable', 'ModdingStation_Placeable', 'GenericContainer_Placeable', 'GenericContainer_Placeable',
    'AdvancedWeaponsFabricator_Placeable', 'AdvancedWearablesFabricator_Placeable', 'Advanced_SurvivalFabricator_Placeable', 'Advanced_VehiclesFabricator_Placeable', 'Fabricator_Placeable', 'Recycler_Placeable', 'RepairStation_Placeable', 'RepairStation_Placeable',
    'LargeOreRefinery_Placeable', 'LargeOreRefinery_Placeable', 'MediumChemicalRefinery_Placeable', 'MediumChemicalRefinery_Placeable', 'LargeSpiceRefinery_Placeable',
    ...rep('MediumStorageContainer_Placeable', 8),
    'LargeWaterCistern_Placeable', 'LargeWaterCistern_Placeable', 'Deathstill_Placeable', 'BloodWaterExtractionAdvanced_Placeable', ...rep('LargeWindtrap_Placeable', 4),
    'SpiceGenerator_Placeable', 'SpiceGenerator_Placeable', 'Generator_Placeable', ...rep('WindTurbineDirectional_Placeable', 4),
  ]),
}

export const DEFAULTS = {
  cells: [[0, 0], [1, 0], [0, 1], [1, 1]],
  shapes: {},
  bays: [
    { kind: 'air', items: { OrnithopterLight: 1, OrnithopterMedium: 1 }, portals: 2, roof: false },
    { kind: 'ground', items: { Sandbike: 2, Buggy: 1 }, portals: 1, roof: false },
  ],
  stations: STATION_SETS.endgame,
  rooms: 4, style: { preset: 'sandwalkers' }, seed: 1, name: '',
}
const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d }

/** ширина техніки поперек ряду (у ряду вона стоїть носом до порталу) */
const WIDE = { OrnithopterLight: 2.4, OrnithopterMedium: 2.7, OrnithopterTransport: 4, Sandbike: 1, Buggy: 2, Sandcrawler: 2.6, ContainerVehicle: 2.5 }

/** техніка ангара списком */
export const bayList = (bay) => BAY_TYPES[bay.kind === 'ground' ? 'ground' : 'air'].flatMap((t) => rep(t, bay.items?.[t] || 0))
/** ряд під щитом у даху (а не біля порталу): ангар без порталів чи гараж зі щитом (техніку забирає грузовий згори) */
const skyRow = (kind, portals, roof) => !portals || (kind === 'ground' && roof)
/** де в ангарі стоять ряди: під щитом у даху — один ряд [2, L − 2], інакше — у прорізах порталів */
export const parkSpans = (kind, k, portals, roof) => (skyRow(kind, portals, roof) ? [[2, 10 * k - 2]] : bayBays(kind, k, portals))

/**
 * Прорізи порталів уздовж довгої сторони ангара з k ділянок ([u0, u1] у рамці сторони). Одна ділянка: орні — 6,
 * гараж — 4 посередині. Кілька: по прорізу на ділянку, між ними — стовп стіни на межі ділянок (на ньому й на колоні
 * посередині межі тримається дах: інакше середина даху над прольотом у 20 впала б); перший і останній — від стіни в
 * одну плитку. Лише щит у даху — один ряд під щитом [2, L − 2].
 */
export function bayBays(kind, k, portals) {
  const L = 10 * k
  if (!portals) return [[2, L - 2]]
  if (k === 1) return kind === 'air' ? [[2, 8]] : [[3, 7]]
  return Array.from({ length: k }, (_, m) => [m === 0 ? 1 : 10 * m + 1, m === k - 1 ? L - 1 : 10 * (m + 1)])
}
/** скільки місця в ряду займає техніка: під щитом у даху (без порталу) грузовий стоїть уздовж ангара — 9 */
const wideIn = (t, roofOnly) => (roofOnly && t === 'OrnithopterTransport' ? 9 : WIDE[t])
/**
 * Розкласти техніку по прорізах: у кожному — ряд носом до порталу (зазор між машинами gap, по 0,2 від країв);
 * грузовий — лише в проріз ≥ 9 (портал 9 × 6); roofOnly — один ряд під щитом у даху, грузовий уздовж.
 * Повертає масив списків по прорізах чи null — не вміщається.
 */
export function packBays(list, spans, kind, roofOnly = false) {
  const gap = kind === 'air' ? 0.5 : 0.4
  const out = spans.map(() => [])
  const used = spans.map(() => 0)
  for (const t of list.slice().sort((a, b) => wideIn(b, roofOnly) - wideIn(a, roofOnly))) {
    let ok = false
    for (let i = 0; i < spans.length && !ok; i++) {
      const w = spans[i][1] - spans[i][0]
      if (t === 'OrnithopterTransport' && !roofOnly && w < 9 - 1e-9) continue
      const need = used[i] + (out[i].length ? gap : 0) + wideIn(t, roofOnly)
      if (need <= w - 0.4 + 1e-9) { out[i].push(t); used[i] = need; ok = true }
    }
    if (!ok) return null
  }
  return out
}
/**
 * Скільки ділянок поспіль потрібно ангару чи гаражу (1–3; −1 — не вміщається, 0 — порожній). Техніка стоїть рядами
 * носом до порталу, ряд — у межах прорізу; грузовому потрібен проріз ≥ 9, тож — від двох ділянок.
 */
export function bayCells(bay) {
  const list = bayList(bay)
  if (!list.length) return 0
  for (let k = 1; k <= LIMITS.bayCells; k++) {
    if (bay.kind === 'ground' && k === 1 && !bay.roof) {
      // одна ділянка: ряд біля задньої стіни на всю ширину (з запасом на двері в куті)
      if (list.reduce((s, t) => s + WIDE[t], 0) + 0.4 * (list.length - 1) <= 8.3) return 1
      continue
    }
    if (packBays(list, parkSpans(bay.kind, k, bay.portals, bay.roof), bay.kind, skyRow(bay.kind, bay.portals, bay.roof))) return k
  }
  return -1
}

/**
 * Згрупувати техніку заново (кнопки над списком ангарів): airMode — 'type' (кожен тип окремо, усі такі разом),
 * 'small' (розвідники й штурмові разом, грузовий окремо), 'all' (усі орні разом), 'pairs' (по двоє); наземна — 'type'
 * (кожен тип окремо) чи 'all' (разом). Вхід — наскрізні портали (гаражі — портал з одного боку).
 */
export function regroup(bays, airMode, groundMode = 'all') {
  const tot = {}
  for (const b of bays) for (const [t, n] of Object.entries(b.items || {})) tot[t] = (tot[t] || 0) + n
  const out = []
  const air = (items) => out.push({ kind: 'air', items, portals: 2, roof: false })
  const small = { OrnithopterLight: tot.OrnithopterLight || 0, OrnithopterMedium: tot.OrnithopterMedium || 0 }
  const carriers = tot.OrnithopterTransport || 0
  if (airMode === 'all') {
    if (carriers || small.OrnithopterLight || small.OrnithopterMedium) air({ ...small, ...(carriers ? { OrnithopterTransport: 1 } : {}) })
    for (let i = 1; i < carriers; i++) air({ OrnithopterTransport: 1 })
  } else {
    for (let i = 0; i < carriers; i++) air({ OrnithopterTransport: 1 })
    if (airMode === 'small') { if (small.OrnithopterLight || small.OrnithopterMedium) air({ ...small }) }
    else if (airMode === 'pairs') {
      const list = [...rep('OrnithopterMedium', small.OrnithopterMedium), ...rep('OrnithopterLight', small.OrnithopterLight)]
      for (let i = 0; i < list.length; i += 2) air(count(list.slice(i, i + 2)))
    } else for (const t of ['OrnithopterLight', 'OrnithopterMedium']) if (small[t]) air({ [t]: small[t] })
  }
  const ground = (items, roof = false) => out.push({ kind: 'ground', items, portals: 1, roof })
  const g = { Sandcrawler: tot.Sandcrawler || 0, Buggy: tot.Buggy || 0, Sandbike: tot.Sandbike || 0 }
  // контейнери — до грузового, якщо він є; інакше — у гараж зі щитом у даху (грузовий забере згори)
  const box = tot[CONTAINER] || 0
  const withCarrier = box && out.find((b) => b.items.OrnithopterTransport)
  if (withCarrier) withCarrier.items[CONTAINER] = box
  if (groundMode === 'type') {
    for (const t of GROUND) if (g[t]) ground({ [t]: g[t] })
    if (box && !withCarrier) ground({ [CONTAINER]: box }, true)
  } else if (g.Sandcrawler + g.Buggy + g.Sandbike + (withCarrier ? 0 : box)) ground(Object.fromEntries(Object.entries({ ...g, ...(withCarrier ? {} : { [CONTAINER]: box }) }).filter(([, n]) => n)), !!box && !withCarrier)
  return out.map((b) => ({ ...b, items: Object.fromEntries(Object.entries(b.items).filter(([, n]) => n)) }))
}

/**
 * Параметри з будь-якого входу (форма, тіло запиту, давні параметри першої версії) → чисті; errors — що не так
 * (ключі перекладу з {змінними}). Ділянки зсуваються так, щоб найменші i, j були 0 (форми — разом із ними).
 */
export function normalizeParams(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const p = { ...DEFAULTS }
  const errors = []
  // стиль (пресет і перемикачі, style.mjs); давні walls / roof першої версії — у нього ж
  p.style = normalizeStyle(src.style, { walls: src.walls, roof: src.roof })
  p.walls = p.style.walls === 'lean' ? 'lean' : 'straight'
  // дах блоку (пласкі, скатні, піраміди) і чи скати заокруглені (склепіння, куполи)
  p.roof = roofBase(p.style.roof)
  p.roundRoof = roofRound(p.style.roof)
  p.rooms = int(src.rooms ?? p.rooms, 0, LIMITS.rooms, p.rooms)
  p.seed = int(src.seed ?? p.seed, 1, 1e6, 1)
  p.name = typeof src.name === 'string' ? src.name.replace(/<[^>]*>/g, '').trim().slice(0, LIMITS.name) : ''

  // ангари й гаражі; давні параметри (scout, assault, carrier, sandbike…) — по двоє орні, грузовий окремо, наземна разом
  let bays = src.bays
  if (!Array.isArray(bays) && ['scout', 'assault', 'carrier', 'sandbike', 'buggy', 'sandcrawler'].some((k) => k in src)) {
    bays = regroup([{ items: { OrnithopterLight: int(src.scout, 0, 8, 0), OrnithopterMedium: int(src.assault, 0, 8, 0), OrnithopterTransport: src.carrier ? 1 : 0, Sandbike: int(src.sandbike, 0, 12, 0), Buggy: int(src.buggy, 0, 12, 0), Sandcrawler: int(src.sandcrawler, 0, 12, 0) } }], 'pairs')
  }
  if (!Array.isArray(bays)) bays = DEFAULTS.bays
  p.bays = bays.slice(0, LIMITS.bays).map((b) => {
    const kind = b?.kind === 'ground' ? 'ground' : 'air'
    const items = {}
    for (const t of BAY_TYPES[kind]) { const n = int(b?.items?.[t], 0, t === CONTAINER ? 2 : kind === 'air' ? LIMITS.perBayAir : LIMITS.perBayGround, 0); if (n) items[t] = n }
    if (items.OrnithopterTransport > 1) items.OrnithopterTransport = 1
    let portals = int(b?.portals, 0, 2, kind === 'air' ? 2 : 1)
    let roof = !!b?.roof
    // наземна — крізь портал (і, якщо є щит у даху, — грузовим згори); контейнер у гаражі забирає лише грузовий
    // згори — щит у даху обов'язковий. Грузовому досить будь-якого виходу: портал ≥ 9 × 6 чи щит у даху над ним
    if (kind === 'ground') { portals = Math.max(1, portals); if (items[CONTAINER]) roof = true }
    if (!portals && !roof) portals = 1
    return { kind, items, portals, roof }
  }).filter((b) => Object.keys(b.items).length)
  const tot = (types) => p.bays.reduce((s, b) => s + types.reduce((q, t) => q + (b.items[t] || 0), 0), 0)
  if (tot(AIR) > LIMITS.orni) errors.push({ code: 'orni', text: 'Орні — не більше {n}', vars: { n: LIMITS.orni } })
  if (tot(['OrnithopterTransport']) > LIMITS.carrier) errors.push({ code: 'carrier', text: 'Грузових — не більше {n}', vars: { n: LIMITS.carrier } })
  if (tot(GROUND) > LIMITS.ground) errors.push({ code: 'vehicles', text: 'Техніки — не більше {n}', vars: { n: LIMITS.ground } })
  p.bays.forEach((b, i) => { if (bayCells(b) < 0) errors.push({ code: 'bay', text: b.kind === 'air' ? 'Ангар №{n}: забагато техніки — розбий на два' : 'Гараж №{n}: забагато техніки — розбий на два', vars: { n: i + 1 } }) })

  // станції; давні рівні (production) — з готових наборів
  let st = src.stations
  if ((!st || typeof st !== 'object') && ['production', 'water', 'power'].some((k) => k in src)) {
    const lvl = (v) => (v === 'advanced' || v === 'large' ? 'advanced' : v === 'none' ? 'none' : 'basic')
    st = { ...STATION_SETS[lvl(src.production)] }
  }
  if (!st || typeof st !== 'object') st = DEFAULTS.stations
  p.stations = {}
  let total = 0
  for (const t of STATION_TYPES) { const n = int(st[t], 0, LIMITS.station, 0); if (n) { p.stations[t] = n; total += n } }
  if (total > LIMITS.stations) errors.push({ code: 'stations', text: 'Станцій — не більше {n}', vars: { n: LIMITS.stations } })

  // ділянки й форми
  let cells = Array.isArray(src.cells) ? src.cells : p.cells
  cells = cells.filter((c) => Array.isArray(c) && c.length === 2 && c.every((v) => Number.isInteger(v) && Math.abs(v) <= 50))
  const seen = new Set()
  cells = cells.filter(([i, j]) => !seen.has(i + ',' + j) && seen.add(i + ',' + j))
  const shapesIn = src.shapes && typeof src.shapes === 'object' ? src.shapes : {}
  p.shapes = {}
  if (!cells.length) errors.push({ code: 'cells', text: 'Познач хоча б одну ділянку' })
  if (cells.length > LIMITS.cells) errors.push({ code: 'cells', text: 'Ділянок — не більше {n}', vars: { n: LIMITS.cells } })
  if (cells.length) {
    const mi = Math.min(...cells.map((c) => c[0])), mj = Math.min(...cells.map((c) => c[1]))
    for (const [i, j] of cells) { const s = shapesIn[i + ',' + j]; if (SHAPES.includes(s) && s !== 'square') p.shapes[(i - mi) + ',' + (j - mj)] = s }
    cells = cells.map(([i, j]) => [i - mi, j - mj]).sort((a, b) => a[1] - b[1] || a[0] - b[0])
    const key = (i, j) => i + ',' + j
    const all = new Set(cells.map(([i, j]) => key(i, j)))
    const reach = new Set([key(...cells[0])]), queue = [cells[0]]
    while (queue.length) {
      const [i, j] = queue.shift()
      for (const d of Object.values(DIRS)) { const k = key(i + d.x, j + d.y); if (all.has(k) && !reach.has(k)) { reach.add(k); queue.push([i + d.x, j + d.y]) } }
    }
    if (reach.size !== all.size) errors.push({ code: 'cells', text: 'Ділянки мають прилягати одна до одної цілою стороною' })
  }
  p.cells = cells.slice(0, LIMITS.cells)
  // давній перемикач гекс-залу (перша версія)
  if (src.hex === true && !Object.keys(p.shapes).length && p.cells.length > 1) p.hexAuto = true
  return { params: p, errors }
}

/** назви приміщень і групи (кольори плану) */
const ROLE = {
  hall: ['Зал гільдії', 'core'], workshop: ['Майстерня', 'craft'], refinery: ['Переробка', 'refine'],
  water: ['Вода й енергія', 'craft'], storage: ['Склад', 'store'], living: ['Житло', 'core'], spare: ['Вільне приміщення', 'core'],
}
const SHAPE_NAME = { hex: 'шестикутний', dodeca: 'дванадцятикутний', yard: 'з двором', atrium: 'з атріумом' }

/**
 * Згенерувати базу. kit — createKit(рушій). Повертає { doc, plan, notes, errors, params }: errors — план неможливий
 * (документа нема), notes — що не вмістилось (документ є).
 */
export function generate(raw, kit) {
  const { params: P, errors } = normalizeParams(raw)
  if (errors.length) return { doc: null, errors, notes: [], params: P }
  const notes = []
  const pl = planCells(P, rng(P.seed), notes)
  if (pl.errors.length) return { doc: null, errors: pl.errors, notes, params: P }
  // стиль цього варіанта: пресет — з варіаціями (style.mjs STYLE_VARY), свій — як задано
  const S = varyStyle(P.style, rng(P.seed * 104729 + 31))
  const PB = { ...P, style: S, roof: roofBase(S.roof), roundRoof: roofRound(S.roof), walls: S.walls === 'lean' ? 'lean' : 'straight', orig: P }
  const out = build(PB, pl, kit, notes)
  // техніка, що не стала в ангар чи гараж, — не база (стояла б надворі)
  const lost = notes.filter((n) => n.code === 'vehicle')
  if (lost.length) return { doc: null, errors: lost, notes: notes.filter((n) => n.code !== 'vehicle'), params: P }
  return { ...out, errors: [], notes, params: P, plan: summarize(pl) }
}

// ---------- план ----------
const LONG = { x: ['S', 'N'], y: ['W', 'E'] }

function planCells(P, rnd, notes) {
  const errors = []
  const cells = P.cells.map(([i, j], k) => ({ k, i, j, R: { x0: i * 10, y0: j * 10, x1: i * 10 + 10, y1: j * 10 + 10 }, nb: {}, shape: P.shapes[i + ',' + j] || 'square', role: null, up: null, down: null, noUpper: false, h0: G }))
  const at = new Map(cells.map((c) => [c.i + ',' + c.j, c]))
  for (const c of cells) for (const s of SIDES) c.nb[s] = at.get(c.i + DIRS[s].x + ',' + (c.j + DIRS[s].y)) || null
  const jitter = () => rnd() * 0.01
  // варіативність: серед рівноцінних (чи майже) варіантів — випадковий; кожен варіант (seed) — інша база
  const noise = (a) => rnd() * a
  const deg = (c) => SIDES.filter((s) => c.nb[s]).length
  const pick = (list, score) => list.map((c) => [c, score(c) + jitter()]).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  const sq = (c) => c.shape === 'square'
  const free = (ln, s) => ln.cells.filter((c) => !c.nb[s]).length

  // давній гекс-зал: ділянка, без якої решта лишається зв'язною
  if (P.hexAuto) {
    const h = pick(cells.filter((c) => connectedWithout(cells, c)), (c) => (deg(c) === 1 ? 2 : 0) - deg(c) * 0.2)
    if (h) h.shape = 'hex'
  }

  // 1. форми: прямокутник із двором — будівля 10 × 6 уздовж сторони до сусіда (двір — з протилежного боку);
  //    шестикутник і дванадцятикутник — коридор до одного сусіда, що торкається спільної сторони
  for (const c of cells.filter((x) => x.shape === 'yard')) {
    c.strip = SIDES.map((s) => [s, (c.nb[s] ? (sq(c.nb[s]) ? 2 : 1) : 0) + (c.nb[OPP[s]] ? -0.5 : 0) + jitter()]).sort((a, b) => b[1] - a[1])[0][0]
    c.yardOpen = OPP[c.strip]
  }
  /** чи будівля ділянки c торкається своєї сторони s (на першому поверсі) */
  const touches = (c, s) => c.shape === 'square' || c.shape === 'atrium' || (c.shape === 'yard' && s !== c.yardOpen) || ((c.shape === 'hex' || c.shape === 'dodeca') && c.to === s)
  for (const c of cells.filter((x) => x.shape === 'hex' || x.shape === 'dodeca')) {
    const opts = SIDES.filter((s) => c.nb[s] && c.nb[s].shape !== 'hex' && c.nb[s].shape !== 'dodeca' && touches(c.nb[s], OPP[s]))
    const to = opts.map((s) => [s, (sq(c.nb[s]) ? 1 : 0) + noise(1.2)]).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!to) { errors.push({ code: 'shape', text: 'Фігурній ділянці ({i}, {j}) нема сусіда для коридору — поруч потрібна квадратна, з двором чи з атріумом', vars: { i: c.i + 1, j: c.j + 1 } }); continue }
    c.to = to
  }
  if (errors.length) return { errors }
  // перший поверх зв'язний: двері лише там, де обидві будівлі торкаються спільної сторони
  {
    const link = (a, s) => { const b = a.nb[s]; return b && touches(a, s) && touches(b, OPP[s]) }
    const seen = new Set([cells[0]]), q = [cells[0]]
    while (q.length) { const c = q.shift(); for (const s of SIDES) if (link(c, s) && !seen.has(c.nb[s])) { seen.add(c.nb[s]); q.push(c.nb[s]) } }
    if (seen.size !== cells.length) errors.push({ code: 'shape', text: 'Форми ділянок роз’єднують базу — зміни форму однієї з них' })
  }
  if (errors.length) return { errors }

  /** відкрита сторона: на висоті G (над сусідом нічого — смуга польоту вільна) чи на землі (виїхати можна) */
  const openAtG = (c, s) => { const x = c.nb[s]; return !x || !sq(x) || (!x.up && x.h0 === G) }
  const openAt0 = (c, s) => { const x = c.nb[s]; return !x || !touches(x, OPP[s]) }

  // 2. ангари й гаражі: грузові й найбільші — першими; орні — нагорі, якщо можна, інакше — на першому поверсі
  const bays = P.bays.map((b, idx) => ({ ...b, idx, list: bayList(b), k: bayCells(b) }))
  bays.sort((a, b) => (b.items.OrnithopterTransport ? 1 : 0) - (a.items.OrnithopterTransport ? 1 : 0) || (a.kind === b.kind ? b.k - a.k : a.kind === 'air' ? -1 : 1))
  const lines = (k) => {
    const out = []
    for (const c of cells) for (const axis of ['x', 'y']) {
      const run = [c]
      for (let n = 1; n < k; n++) { const nx = run[n - 1].nb[axis === 'x' ? 'E' : 'N']; if (!nx) break; run.push(nx) }
      if (run.length === k && run.every(sq)) out.push({ cells: run, axis })
    }
    return out
  }
  for (const b of bays) {
    const opts = []
    for (const ln of lines(b.k)) {
      for (const level of b.kind === 'air' ? [G, 0] : [0]) {
        if (level === G && ln.cells.some((c) => c.up || c.noUpper || c.h0 !== G)) continue
        if (level === 0 && ln.cells.some((c) => c.down)) continue
        // ангар із щитом у даху на першому поверсі — лише якщо над ним нічого нема
        if (level === 0 && b.roof && ln.cells.some((c) => c.up)) continue
        const open = level === G ? openAtG : openAt0
        const sides = LONG[ln.axis].filter((s) => ln.cells.every((c) => open(c, s)))
        if (sides.length < b.portals) continue
        const portalSides = sides.slice().sort((p, q) => free(ln, q) - free(ln, p)).slice(0, b.portals)
        const score = (level === G ? 3 : 0) + portalSides.reduce((s, x) => s + free(ln, x), 0) * 0.5 - ln.cells.reduce((s, c) => s + deg(c), 0) * 0.1 + noise(1.4)
        opts.push({ ...ln, level, portalSides, score })
      }
    }
    const best = opts.sort((p, q) => q.score - p.score)[0]
    if (!best) {
      errors.push({ code: b.kind === 'air' ? 'orni' : 'garage', text: b.kind === 'air' ? 'Ангару №{n} нема місця: потрібно {k} квадратних ділянок поспіль із вільними сторонами для порталів' : 'Гаражу №{n} нема місця: потрібно {k} квадратних ділянок поспіль із зовнішньою стіною', vars: { n: b.idx + 1, k: b.k } })
      continue
    }
    Object.assign(b, best)
    const rs = b.cells.map((c) => c.R)
    b.R = { x0: Math.min(...rs.map((r) => r.x0)), y0: Math.min(...rs.map((r) => r.y0)), x1: Math.max(...rs.map((r) => r.x1)), y1: Math.max(...rs.map((r) => r.y1)) }
    b.h = b.items.OrnithopterTransport ? 6 : G
    for (const c of b.cells) {
      if (b.level === G) c.up = { kind: 'bay', bay: b }
      // зі щитом у даху над першим поверхом — ні верхнього модуля, ні тераси (cap: дах зі щитом)
      else { c.down = { kind: 'bay', bay: b }; c.role = 'bay'; if (b.h !== G || b.roof) { c.noUpper = true; c.h0 = b.h; c.cap = !!b.roof } }
      // смуга польоту над сусідами навпроти порталів — вільна: верхніх модулів там не буде
      if (b.kind === 'air') for (const s of b.portalSides) if (c.nb[s]) c.nb[s].noUpper = true
    }
  }
  if (errors.length) return { errors }

  // 3. великий переробник спайсу (5 заввишки) — окрема ділянка з високим першим поверхом без верхнього модуля
  if (P.stations.LargeSpiceRefinery_Placeable) {
    // не на смузі польоту перед порталом ангара (там лише тераса: 6 заввишки закрив би проріз)
    const c = pick(cells.filter((x) => sq(x) && !x.down && !x.up && !x.noUpper), (x) => -deg(x) * 0.1 + noise(1))
    if (c) { c.role = 'refinery'; c.h0 = 6; c.noUpper = true; c.tall = true }
    else notes.push({ code: 'tall', text: 'Великому переробнику спайсу (5 заввишки) потрібна окрема квадратна ділянка без верхнього поверху' })
  }

  // 4. житло нагорі (по 4 кімнати на ділянку)
  let livingCells = Math.ceil(P.rooms / 4)
  while (livingCells > 0) {
    const c = pick(cells.filter((x) => sq(x) && !x.up && !x.noUpper && x.h0 === G), (x) => deg(x) + SIDES.filter((s) => x.nb[s]?.up).length + noise(2))
    if (!c) break
    c.up = { kind: 'living' }
    livingCells--
  }
  const anyUpper = cells.some((c) => c.up)

  // 5. сходи: по одних у кожній зв'язній частині верхнього рівня (квадратні ділянки з терасою чи модулем і будівлі
  //    прямокутників із двором) — у ділянці з верхнім модулем
  const walkG = (c) => (sq(c) && c.h0 === G && !c.cap) || (c.shape === 'yard' && anyUpper)
  /** сторона для сходів: не портал (ні нагорі, ні внизу), не між ділянками одного ангара */
  const sideFor = (c) => {
    const bad = new Set()
    for (const u of [c.up, c.down]) if (u?.kind === 'bay') {
      for (const s of u.bay.portalSides) bad.add(s)
      for (const s of SIDES) if (c.nb[s] && u.bay.cells.includes(c.nb[s])) bad.add(s)
    }
    return SIDES.filter((s) => !bad.has(s)).map((s) => [s, (c.nb[s] ? 0.3 : 0) + noise(0.6)]).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  }
  const stairs = []
  if (anyUpper) {
    const seen = new Set()
    for (const c0 of cells.filter(walkG)) {
      if (seen.has(c0)) continue
      const comp = [c0], q = [c0]
      seen.add(c0)
      while (q.length) {
        const c = q.shift()
        for (const s of SIDES) { const x = c.nb[s]; if (x && walkG(x) && !seen.has(x) && touches(c, s) && touches(x, OPP[s])) { seen.add(x); comp.push(x); q.push(x) } }
      }
      if (!comp.some((c) => c.up)) continue
      const sc = pick(comp.filter((c) => c.up && sideFor(c)), (c) => (c.up.kind === 'living' ? 1 : c.up.bay.k === 1 ? 3 : 2) - (c.down?.kind === 'bay' ? 1 : 0) + noise(1.5))
      if (!sc) { notes.push({ code: 'stairs', text: 'Частина верхнього рівня без сходів — додай їх у будівельнику' }); continue }
      sc.stairSide = sideFor(sc)
      stairs.push(sc)
    }
  }

  // 6. призначення решти: зал (краще — у фігурній ділянці), далі — за тим, які станції замовлено
  const rest = () => cells.filter((c) => !c.role)
  const want = new Set(Object.keys(P.stations).filter((t) => !OUTDOOR.has(t)).map(ROLE_OF))
  {
    const h = pick(rest(), (c) => (c.shape !== 'square' && c.shape !== 'yard' ? 2 : 0) + deg(c) * 0.3 + (SIDES.some((s) => openAt0(c, s)) ? 0.5 : 0) + noise(1.2))
    if (h) h.role = 'hall'
  }
  for (const role of ['workshop', 'water', 'refinery', 'storage']) {
    if (!want.has(role) || cells.some((c) => c.role === role)) continue
    const c = pick(rest(), (x) => deg(x) * 0.1 + (x.shape === 'square' ? 0.2 : 0) + noise(1))
    if (!c) break
    c.role = role
  }
  if (P.rooms > cells.filter((c) => c.up?.kind === 'living').length * 4) { const c = pick(rest(), () => 0); if (c) c.role = 'living' }
  for (const c of rest()) c.role = 'spare'

  // вхід: зовнішня стіна (не портал) — краще залу
  for (const c of [...cells.filter((x) => x.role === 'hall'), ...cells]) {
    if (c.shape === 'hex' || c.shape === 'dodeca') continue
    const portal = c.down?.kind === 'bay' ? c.down.bay.portalSides : []
    const ok = SIDES.filter((x) => !c.nb[x] && touches(c, x) && !portal.includes(x) && !(stairs.includes(c) && x === c.stairSide))
    const s = ok[Math.floor(rnd() * ok.length)]
    if (s) { c.entry = s; break }
  }
  return { cells, bays, stairs, errors, anyUpper, touches }
}

function connectedWithout(cells, skip) {
  const rest = cells.filter((c) => c !== skip)
  if (!rest.length) return false
  const seen = new Set([rest[0]]), q = [rest[0]]
  while (q.length) { const c = q.shift(); for (const s of SIDES) { const x = c.nb[s]; if (x && x !== skip && !seen.has(x)) { seen.add(x); q.push(x) } } }
  return seen.size === rest.length
}

function summarize(pl) {
  return {
    cells: pl.cells.map((c) => ({
      i: c.i, j: c.j, shape: c.shape,
      ground: c.down?.kind === 'bay' ? (c.down.bay.kind === 'air' ? 'hangar' : 'garage') : c.role,
      upper: c.up ? (c.up.kind === 'living' ? 'living' : c.up.bay.items.OrnithopterTransport ? 'carrier' : 'orni') : null,
      bay: c.down?.kind === 'bay' ? c.down.bay.idx : c.up?.kind === 'bay' ? c.up.bay.idx : null,
      stairs: pl.stairs.includes(c),
    })),
    bays: pl.bays.map((b) => ({ idx: b.idx, k: b.k, level: b.level, cells: b.cells.map((c) => [c.i, c.j]), portalSides: b.portalSides })),
  }
}

// ---------- побудова ----------
function build(P, pl, kit, notes) {
  const L = kit
  const B = L.createBase('g')
  // склепіння й куполи — заокруглені скати в кожного блоку з дахом
  const block0 = B.block
  B.block = (spec) => block0({ round: P.roundRoof, ...spec })
  // варіативність деталей (окремо від плану): де вежі й зикурат, висота веж, візерунок вікон, двері, навіси
  const V = rng(P.seed * 7919 + 13)
  const merlonPhase = Math.floor(V() * 4)
  const { cells, bays, stairs, anyUpper, touches } = pl
  const claims = cells.map((c) => ({ x: c.R.x0, y: c.R.y0, w: 10, d: 10 }))
  const leanOn = P.walls === 'lean'
  const S = P.style
  // краї терас і пласких дахів — зубці чи парапет (замість поручнів)
  const walled = S.battlements || S.parapets
  /** скляна стеля посередині прямокутника R (рамка першої сторони): u0…u1 × v0…v1 */
  const skyIn = (R, u0, u1, v0, v1) => { const f = frame(R, 'S'); const Q = minmaxR([f.at(u0, v0), f.at(u1, v1)]); return (q) => q.x > Q.x0 && q.x < Q.x1 && q.y > Q.y0 && q.y < Q.y1 }
  const pr = (type) => L.PRESETS.items.find((x) => x.type === type)
  // приміщення для пакувальника: { poly, z, ceil, reserved, placed, outdoor }
  const rooms = []
  const room = (poly, z, extra = {}) => { const r = { poly, z, ceil: G, reserved: [], placed: [], ...extra }; rooms.push(r); return r }
  const later = []
  const doors = [] // { a, b, z } — відступи від дверей
  const doorAt = (a, b, z) => doors.push({ a, b, z })
  const reserveQ = []
  const reserve = (z, poly) => reserveQ.push([z, poly])
  const straight = new Map() // c.k|z → сторони без похилих стін
  const keep = (c, z, s) => { const k = c.k + '|' + z; if (!straight.has(k)) straight.set(k, new Set()); straight.get(k).add(s) }
  const kept = (c, z) => straight.get(c.k + '|' + z) || new Set()
  const sq = (c) => c.shape === 'square'
  const mid0 = { x: cells.reduce((a, c) => a + c.R.x0 + 5, 0) / cells.length, y: cells.reduce((a, c) => a + c.R.y0 + 5, 0) / cells.length }
  const bayOf = (c, z) => (z === 0 ? (c.down?.kind === 'bay' ? c.down.bay : null) : (c.up?.kind === 'bay' ? c.up.bay : null))

  // терасна ділянка, якщо верхнього рівня нема, а зовнішні станції є і двору нема (дах залу — терасою з драбиною)
  const outdoorWanted = Object.keys(P.stations).some((t) => OUTDOOR.has(t))
  const hasCourt = cells.some((c) => c.shape === 'yard' || c.shape === 'atrium')
  let ladderCell = null
  if (!anyUpper && outdoorWanted && !hasCourt) ladderCell = cells.find((c) => c.role === 'hall' && sq(c)) || cells.find((c) => sq(c) && c.role !== 'bay' && !c.tall) || null
  // плитки терас на висоті G (поручні — там, де за краєм не тераса)
  const terraceTiles = []
  /** пласкі дахи нагорі (для зубців): { tiles, z } */
  const flatTops = []
  for (const c of cells) {
    if (sq(c) && !c.up && c.h0 === G && !c.cap && (anyUpper || c === ladderCell)) terraceTiles.push(...L.rect(c.R.x0, c.R.x1, c.R.y0, c.R.y1))
    if (c.shape === 'yard' && anyUpper) terraceTiles.push(...stripTiles(c))
  }
  const terraceKeys = new Set(terraceTiles.map((t) => t.key))
  // що стоїть на висоті G і вище (тераси, верхні модулі, високі приміщення першого поверху) — за цим краєм поручень не треба
  const occupiedG = new Set(terraceKeys)
  for (const c of cells) if (sq(c) && (c.up || c.h0 > G)) for (const t of L.rect(c.R.x0, c.R.x1, c.R.y0, c.R.y1)) occupiedG.add(t.key)

  // ---------- двері першого поверху ----------
  /** двері ангара чи гаража на стороні s: на стороні з порталом — нема (null); задня — біля кута; торцева — біля порталу */
  const bayDoorU = (c, s, z) => {
    const b = bayOf(c, z)
    if (!b) return undefined
    if (b.portalSides.includes(s)) return null
    if (!b.portals) return undefined
    // не в самому куті: там похила стіна сусідньої сторони кінчається трикутною стіною, а не стіною
    if (b.portalSides.length === 1 && OPP[b.portalSides[0]] === s) return 1
    return b.portalSides.some((p) => onSide(c.R, p, frame(c.R, s).at(0, 0))) ? 1 : 8
  }
  const doorUnit = (c, s, z) => {
    const mine = bayDoorU(c, s, z)
    const x = c.nb[s]
    const theirs = x ? bayDoorU(x, OPP[s], z) : undefined
    if (mine === null || theirs === null) return null
    const u = mine !== undefined ? mine : theirs !== undefined ? 9 - theirs : doorU(s)
    // будівля з двором на бічній стороні займає лише 6 від своєї стіни — двері в її межах
    const yard = c.shape === 'yard' ? c : x?.shape === 'yard' ? x : null
    if (!yard || yard.strip === s || yard.strip === OPP[s]) return u
    const f = frame(c.R, s)
    const [lo, hi] = onSide(yard.R, yard.strip, f.at(0, 0)) ? [1, 5] : [5, 9]
    return Math.max(lo, Math.min(hi - 1, u))
  }
  const groundDoor = {}
  for (const c of cells) for (const s of ['E', 'N']) {
    const x = c.nb[s]
    if (!x || !touches(c, s) || !touches(x, OPP[s])) continue
    if (c.shape === 'hex' || c.shape === 'dodeca' || x.shape === 'hex' || x.shape === 'dodeca') continue // двері коридору ставить buildRound
    const b = bayOf(c, 0)
    if (b && b === bayOf(x, 0)) continue
    const u = doorUnit(c, s, 0)
    if (u === null) continue
    groundDoor[c.k + '|' + s] = u
    groundDoor[x.k + '|' + OPP[s]] = 9 - u
    const [a, bb] = frame(c.R, s).seg(u, u + 1)
    later.push(() => B.door(a, bb, 0))
    doorAt(a, bb, 0)
    keep(c, 0, s); keep(x, 0, OPP[s])
  }
  for (const c of cells) if (c.entry) {
    // вхід у квадратну ділянку (не ангар) — будь-де посередині сторони, за варіантом
    const u = sq(c) && c.down?.kind !== 'bay' ? 2 + Math.floor(V() * 6) : doorUnit(c, c.entry, 0)
    if (u === null) continue
    groundDoor[c.k + '|' + c.entry] = u
    const f = frame(c.R, c.entry)
    // ганок (стиль): двері в ніші 3 × 1 під навісом на двох колонах — лише де над першим поверхом пласко (тераса, модуль
    // чи плаский дах)
    const porch = S.porch && sq(c) && c.down?.kind !== 'bay' && !c.tall && u >= 1 && u + 2 <= 10 && (!!c.up || anyUpper || c === ladderCell || P.roof === 'flat')
    if (porch) c.porch = { f, u, tiles: L.rect(...minmax(f.at(u - 1, 0), f.at(u + 2, 1))) }
    const [a, b] = porch ? [f.at(u, 1), f.at(u + 1, 1)] : f.seg(u, u + 1)
    later.push(() => B.door(a, b, 0))
    doorAt(a, b, 0)
    keep(c, 0, c.entry)
    if (porch) {
      later.push((B) => {
        for (const t of c.porch.tiles) { B.slab(t, 0, 'found'); B.slab(t, c.h0, 'roof') }
        for (const q of [f.at(u - 1, 0), f.at(u + 2, 0)]) B.column(q.x, q.y, 0, c.h0)
      })
      reserve(0, f.box(u - 1.2, u + 2.2, -0.01, 1.05))
    }
  }
  for (const c of cells) for (const s of SIDES) if (c.nb[s] && (c.nb[s].shape === 'hex' || c.nb[s].shape === 'dodeca') && c.nb[s].to === OPP[s]) keep(c, 0, s)
  // площадки сходів: біля дверей на стороні сходів, а якщо двері скраю — марш з протилежного боку
  for (const c of stairs) {
    const du = groundDoor[c.k + '|' + c.stairSide]
    c.Lnd = du === undefined ? doorU(c.stairSide) : du <= 3 ? 4 : du >= 6 ? 5 : du
    keep(c, 0, c.stairSide); keep(c, G, c.stairSide)
  }

  // ---------- перший поверх ----------
  for (const c of cells) {
    if (c.down?.kind === 'bay') continue
    if (c.shape === 'hex' || c.shape === 'dodeca') { buildRound(c); continue }
    const terrace = (anyUpper && !c.up && !c.tall) || c === ladderCell
    const top = !c.up && !terrace
    const roof = top ? P.roof : 'flat'
    const name = ROLE[c.role][0] + (c.shape !== 'square' ? ` (${SHAPE_NAME[c.shape]})` : '')
    const lean = leanOn && top
    // ніша ганку — прямі стіни (у задній — двері)
    const inPorch = (q) => !!c.porch && pointInRect(q, c.porch.f.box(c.porch.u - 1.01, c.porch.u + 2.01, -0.01, 1.01))
    const leanSkip = (e) => [...kept(c, 0)].some((s) => onSide(c.R, s, e.m)) || inPorch(e.m)
    const leanS = lean ? SIDES.filter((s) => !kept(c, 0).has(s) && (!c.nb[s] || !touches(c.nb[s], OPP[s]))) : []
    if (c.shape === 'square') {
      // над першим поверхом щось є (модуль чи тераса) — можна колонади й обернені похилі (верх нависає)
      const above = !!c.up || (anyUpper && !c.tall)
      const free = (q) => (!c.nb[q] || !touches(c.nb[q], OPP[q])) && q !== c.entry && !stairs.includes(c) && c !== ladderCell && !c.tall
      // нависання (консоль): перший поверх відступає на дві плитки — верх висить над затіненим підсіннями на колонах
      const cant = S.cantilever && above ? SIDES.filter(free) : []
      const inv = S.walls === 'inverted' && above && !cant.length ? SIDES.filter(free) : []
      const por = S.columns && above && !inv.length && !cant.length ? SIDES.filter(free) : []
      const tiles0 = cant.length ? L.rect(...flatX(insetRect2(c.R, [...cant, ...cant]))) : por.length ? L.rect(...flatX(insetRect2(c.R, por))) : L.rect(c.R.x0, c.R.x1, c.R.y0, c.R.y1)
      const tiles = c.porch ? L.without(tiles0, c.porch.tiles) : tiles0
      const skip = inv.length ? (e, i) => (i < 3 && inv.some((q) => onSide(c.R, q, e.m)) ? 'skip' : null) : null
      // скляна стеля: квадрат посередині, смуга вздовж чи впоперек, великий квадрат — за варіантом
      const sq0 = [[3, 7, 3, 7], [2, 8, 4, 6], [4, 6, 2, 8], [2, 8, 2, 8]][Math.floor(V() * 4)]
      const sky = top && S.skylights && roof !== 'pyramid' ? skyIn(c.R, ...sq0) : null
      B.block({
        tiles, z: 0, h: c.h0, roof, lean, leanSkip, wall: skip || undefined,
        sky: sky && roof !== 'flat' ? (t) => sky(cent(t.p)) : undefined, zone: { name, group: ROLE[c.role][1] },
      })
      if (sky && roof === 'flat') later.push((B) => { for (const t of L.rect(c.R.x0 + sq0[0], c.R.x0 + sq0[1], c.R.y0 + sq0[2], c.R.y0 + sq0[3])) B.shieldFloor(t, c.h0) })
      if (top && roof === 'flat') flatTops.push({ tiles: L.rect(...flatX(insetRect2(c.R, leanS))), z: c.h0 })
      if (inv.length) invertedWalls(c, inv)
      if (por.length) portico(c, por)
      if (cant.length) portico(c, cant, 2)
      c.room0 = room(insetRect(c.R, [...new Set([...leanS, ...inv, ...por, ...cant]), ...cant]), 0, { ceil: c.h0, name })
      c.rooms0 = [c.room0]
    } else if (c.shape === 'yard') {
      const f = frame(c.R, c.strip)
      // вхід із двору — посеред будівлі
      const ya = f.at(4, 6), yb = f.at(5, 6)
      later.push(() => B.door(yb, ya, 0))
      doorAt(yb, ya, 0)
      B.block({ tiles: stripTiles(c), z: 0, h: G, roof, lean, leanSkip: (e) => leanSkip(e) || Math.abs(distTo(f, e.m) - 6) < 1e-6, zone: { name, group: ROLE[c.role][1] } })
      B.block({ tiles: courtTiles(c), z: 0, h: 0, roof: 'none', floor: true })
      c.room0 = room(insetRect(minmaxR(f.box(0, 10, 0, 6)), leanS.filter((s) => s !== c.yardOpen)), 0, { name })
      c.rooms0 = [c.room0]
      c.court = room(rectPoly(...flatR(minmaxR(f.box(0, 10, 6, 10)))), 0, { outdoor: true, ceil: Infinity, name: 'Двір' })
    } else if (c.shape === 'atrium') {
      const inner = { x0: c.R.x0 + 3, y0: c.R.y0 + 3, x1: c.R.x1 - 3, y1: c.R.y1 - 3 }
      B.block({ tiles: L.without(L.rect(c.R.x0, c.R.x1, c.R.y0, c.R.y1), L.rect(inner.x0, inner.x1, inner.y0, inner.y1)), z: 0, h: G, roof: roof === 'pyramid' ? 'hip' : roof, lean, leanSkip, zone: { name, group: ROLE[c.role][1] } })
      B.block({ tiles: L.rect(inner.x0, inner.x1, inner.y0, inner.y1), z: 0, h: 0, roof: 'none', floor: true })
      // двері в атріум — з південного крила
      const aa = { x: c.R.x0 + 5, y: inner.y0 }, ab = { x: c.R.x0 + 6, y: inner.y0 }
      later.push(() => B.door(aa, ab, 0))
      doorAt(aa, ab, 0)
      const ins = (s) => (leanS.includes(s) ? 1 : 0)
      c.rooms0 = [
        room(rectPoly(c.R.x0 + ins('W'), c.R.y0 + ins('S'), c.R.x1 - ins('E'), inner.y0), 0, { name }),
        room(rectPoly(c.R.x0 + ins('W'), inner.y1, c.R.x1 - ins('E'), c.R.y1 - ins('N')), 0, { name }),
        room(rectPoly(c.R.x0 + ins('W'), inner.y0, inner.x0, inner.y1), 0, { name }),
        room(rectPoly(inner.x1, inner.y0, c.R.x1 - ins('E'), inner.y1), 0, { name }),
      ]
      c.room0 = c.rooms0[0]
      c.court = room(rectPoly(inner.x0, inner.y0, inner.x1, inner.y1), 0, { outdoor: true, ceil: Infinity, name: 'Атріум' })
    }
  }

  // ---------- ангари й гаражі ----------
  for (const b of bays) {
    const z = b.level
    const lean = leanOn && b.kind === 'air' && (z === G || (b.cells.every((c) => !c.up) && !(anyUpper && b.h === G && !b.roof)))
    const long = LONG_OF(b)
    const fr = frame(b.R, long[0])
    // похилі — лише на сторонах без прорізів (портали, двері, сходи), уся сторона ангара однаково
    const openSides = new Set(b.portalSides)
    for (const c of b.cells) for (const s of SIDES) {
      if (b.cells.includes(c.nb[s])) continue
      if (z === G && walkSide(c, s)) openSides.add(s)
      if (stairs.includes(c) && s === c.stairSide) openSides.add(s)
    }
    // грузовий носом до порталу займає 9 з 10 глибини — обидві довгі стіни прямі (під похилою він не стане)
    if (b.items.OrnithopterTransport && b.portals) for (const s of long) openSides.add(s)
    const leanSkip = (e) => [...openSides].some((s) => onSide(b.R, s, e.m))
    const skyR = b.roof ? minmaxR([fr.at(2, 2), fr.at(fr.len - 2, 8)]) : null
    const inSky = (q) => q.x > skyR.x0 && q.x < skyR.x1 && q.y > skyR.y0 && q.y < skyR.y1
    // гараж чи ангар першого поверху без щита в даху: над ним верхній модуль чи тераса — пласко
    const under = z === 0 && b.h === G && !b.roof && (anyUpper || b.cells.some((c) => c.up))
    let roof = under ? 'flat' : P.roof
    if (b.roof && roof === 'pyramid') roof = 'hip' // пірамідою щит ліг би сходинками
    const name = b.kind === 'air' ? (b.items.OrnithopterTransport ? 'Ангар грузового' : 'Ангар орні') : 'Гараж'
    B.block({
      tiles: L.rect(b.R.x0, b.R.x1, b.R.y0, b.R.y1), z, h: b.h, roof, lean, leanSkip,
      sky: b.roof && roof !== 'flat' ? (t) => inSky(cent(t.p)) : undefined,
      zone: { name, group: b.kind === 'air' ? 'air' : 'drive' },
    })
    if (b.roof && roof === 'flat') later.push((B) => { for (const t of L.rect(skyR.x0, skyR.x1, skyR.y0, skyR.y1)) B.shieldFloor(t, z + b.h) })
    if (roof === 'flat' && !under) flatTops.push({ tiles: L.rect(...flatX(insetRect2(b.R, lean ? SIDES.filter((q) => !openSides.has(q)) : []))), z: z + b.h })
    // портали — на довгих сторонах, по прорізу на ділянку (bayBays); у грузового — на всю висоту
    b.spans = bayBays(b.kind, b.k, b.portals)
    b.lane = []
    for (const s of b.portalSides) {
      const f = frame(b.R, s), fl = frame(b.R, LONG_OF(b)[0])
      for (const [p0, p1] of b.spans) {
        // проріз задано в рамці першої довгої сторони; у протилежної рамки u іде навпаки
        const [u0, u1] = s === LONG_OF(b)[0] ? [p0, p1] : [fl.len - p1, fl.len - p0]
        const rows = b.items.OrnithopterTransport ? b.h : 3
        later.push((B) => B.shield(...f.seg(u0, u1), z, z + rows))
        b.lane.push({ s, u0, u1 })
      }
    }
    // наскрізний ангар на кілька ділянок: колона посеред кожної межі ділянок (дах між стовпами порталів)
    // колона — до самої поверхні даху над межею: плаский — верх стін, скатний — плаский верх на блок вище, піраміда
    // (глибина 10) — гребінь на 5 вище
    const rise = roof === 'flat' ? 0 : roof === 'hip' ? 1 : 5
    if (b.portals === 2 && b.k > 1) for (let m = 1; m < b.k; m++) {
      const q = fr.at(10 * m, 5)
      later.push((B) => B.column(q.x, q.y, z, z + b.h + rise))
      reserve(z, rectPoly(q.x - 0.3, q.y - 0.3, q.x + 0.3, q.y + 0.3))
    }
    const leanSides = lean ? SIDES.filter((s) => !openSides.has(s)) : []
    b.room = room(insetRect(b.R, leanSides), z, { ceil: b.h, name })
    for (const c of b.cells) { if (z === 0) { c.room0 = b.room; c.rooms0 = [b.room] } else c.roomG = b.room }
  }

  // ---------- житло нагорі ----------
  for (const c of cells.filter((x) => x.up?.kind === 'living')) {
    const ws = SIDES.filter((s) => walkSide(c, s))
    // коридор — між двома протилежними виходами (котрими — за варіантом)
    const pairs = ws.filter((s) => ws.includes(OPP[s]))
    const pool = pairs.length ? pairs : ws
    let fs = pool.length ? pool[Math.floor(V() * pool.length)] : 'S'
    if (stairs.includes(c) && (fs === c.stairSide || OPP[fs] === c.stairSide)) fs = SIDES[(SIDES.indexOf(c.stairSide) + 1) % 4]
    c.livFs = fs
    c.doorSides = [fs, OPP[fs], ...(stairs.includes(c) ? [c.stairSide] : [])]
  }
  for (const c of cells.filter((x) => x.up?.kind === 'living')) {
    buildLiving(c)
  }
  // двері верхнього рівня: між модулями й на тераси (по одних на спільну сторону)
  const doneG = new Set()
  for (const c of cells) {
    if (!c.up) continue
    for (const s of SIDES) {
      if (!walkSide(c, s)) continue
      const b = bayOf(c, G), x = c.nb[s]
      if (b && b.cells.includes(x)) continue
      if (c.doorSides && !c.doorSides.includes(s)) continue
      if (x.doorSides && !x.doorSides.includes(OPP[s])) continue
      const st = stairs.includes(c) && s === c.stairSide ? c.Lnd : stairs.includes(x) && OPP[s] === x.stairSide ? 9 - x.Lnd : undefined
      const u = st ?? doorUnit(c, s, G)
      if (u === null) continue
      const [a, bb] = frame(c.R, s).seg(u, u + 1)
      const key = [a, bb].map((q) => q.x + ',' + q.y).sort().join('|')
      if (doneG.has(key)) continue
      doneG.add(key)
      doorAt(a, bb, G)
      later.push((B) => B.door(a, bb, G))
    }
  }

  // ---------- тераси ----------
  for (const c of cells) {
    if (sq(c) && !c.up && c.h0 === G && !c.cap && (anyUpper || c === ladderCell)) c.roomG = room(rectPoly(c.R.x0, c.R.y0, c.R.x1, c.R.y1), G, { outdoor: true, ceil: Infinity, name: 'Тераса' })
    if (c.shape === 'yard' && anyUpper) c.roomG = room(rectPoly(...flatR(minmaxR(frame(c.R, c.strip).box(0, 10, 0, 6)))), G, { outdoor: true, ceil: Infinity, name: 'Тераса' })
  }
  // смуги польоту над терасами: там лише поручні (зубці заважали б орні)
  const laneRects = bays.filter((b) => b.kind === 'air' && b.level === G).flatMap((b) => b.lane.map((ln) => frame(b.R, ln.s).box(ln.u0 - 0.5, ln.u1 + 0.5, -10, 20)))
  const inLane = (q) => laneRects.some((r) => pointInRect(q, r))
  later.push((B) => {
    for (const e of L.boundary(terraceTiles)) {
      if (B.edgeAt(e.m, G)) continue
      if (occupiedG.has(L.kp({ x: 2 * e.m.x - e.t.x, y: 2 * e.m.y - e.t.y }))) continue
      if (walled && !inLane(e.m)) merlon(B, e, G)
      else B.rail(e.a, e.b, G)
    }
  })

  // ---------- сходи ----------
  for (const c of stairs) {
    const f = frame(c.R, c.stairSide)
    const Lnd = c.Lnd
    const climb = Lnd >= 5 ? 1 : -1
    const u0 = Lnd >= 5 ? Lnd - 4 : Lnd + 1
    const tiles = [0, 1, 2, 3].map((i) => (climb > 0 ? u0 + i : u0 + 3 - i))
    const first = f.at(tiles[0] + 0.5, 0.5)
    const dir = climb > 0 ? f.ang : f.ang + 180
    const exitM = f.at(climb > 0 ? Lnd : Lnd + 1, 0.5)
    later.push((B) => {
      const holes = B.stairs(first.x, first.y, dir, 0, G)
      B.railAround(holes, G, (e) => Math.hypot(e.m.x - exitM.x, e.m.y - exitM.y) < 1e-3)
    })
    const lo = Math.min(...tiles), hi = Math.max(...tiles) + 1
    reserve(0, f.box(climb > 0 ? Math.max(0, lo - 1) : lo, climb > 0 ? hi : Math.min(f.len, hi + 1), 0, 1.3))
    reserve(G, f.box(Math.min(lo + (climb > 0 ? 1 : 0), Lnd) - 0.2, Math.max(hi - (climb > 0 ? 0 : 1), Lnd + 1) + 0.2, 0, 1.6))
  }
  // драбина з люком на терасу одноповерхової бази: на стіні без порталу, подалі від дверей
  if (ladderCell) {
    const spots = []
    for (const s of SIDES) for (const u of [1, 8]) {
      const du = groundDoor[ladderCell.k + '|' + s]
      if (du !== undefined && Math.abs(du - u) < 3) continue
      spots.push([s, u])
    }
    const [s, u] = spots[0] || ['S', 1]
    const f = frame(ladderCell.R, s)
    const hatch = L.sq(f.at(u + 0.5, 0.5).x, f.at(u + 0.5, 0.5).y)
    later.push((B) => B.ladder(...f.seg(u, u + 1), 0, G, hatch))
    reserve(0, f.box(u - 0.4, u + 1.4, 0, 1.3))
    reserve(G, f.box(u - 0.2, u + 1.2, 0, 1.2))
  }

  // ---------- зикурат і вежі на терасах (після сходів і дверей: на них не стають) ----------
  const zigOk = S.ziggurat && anyUpper ? placeZiggurat() : false
  const towersN = S.towers !== 'none' && anyUpper ? placeTowers() : 0
  if (S.canopies && anyUpper) placeCanopies()
  // корона на даху житла (ближчого до середини бази): павільйон стилю — чи замість веж і зикурата, що не вмістились
  // (мала база: тераси зайняті смугами польоту); над пірамідою — ні, вона й так вершина
  if (P.roof !== 'pyramid') {
    const cap = S.towerCap === 'roof' ? P.roof : S.towerCap
    const byCap = cap === 'room' ? 'room' : cap === 'spires' ? 'spires' : 'open'
    const kind = S.pavilion || (S.towers !== 'none' && !towersN) ? byCap : S.ziggurat && !zigOk ? 'lean' : null
    const c = kind && cells.filter((x) => x.up?.kind === 'living').map((x) => [x, Math.hypot(x.R.x0 + 5 - mid0.x, x.R.y0 + 5 - mid0.y) + V() * 8]).sort((a, b) => a[1] - b[1])[0]?.[0]
    if (c) buildCrown(c, kind)
  }

  // зубці на пласких дахах (верхи модулів, ангарів, одноповерхових приміщень, веж)
  if (walled) later.push((B) => {
    for (const { tiles, z } of flatTops) for (const e of L.boundary(tiles)) {
      if (B.edgeAt(e.m, z)) continue
      const across = { x: 2 * e.m.x - e.t.x, y: 2 * e.m.y - e.t.y }
      if (B.slabAt(L.sq(across.x, across.y), z)) continue
      merlon(B, e, z)
    }
  })

  B.after((B) => { for (const fn of later) fn(B) })

  // ---------- відступи для станцій ----------
  for (const d of doors) {
    const U = unit(d.a, d.b), N = { x: -U.y, y: U.x }
    for (const sgn of [1, -1]) {
      const p = (s, v) => ({ x: d.a.x + U.x * s + N.x * v * sgn, y: d.a.y + U.y * s + N.y * v * sgn })
      const poly = [p(-0.25, 0), p(1.25, 0), p(1.25, 1.4), p(-0.25, 1.4)]
      reserve(d.z, sgn > 0 ? poly : [poly[0], poly[3], poly[2], poly[1]])
    }
  }
  // смуги польоту й заїзду: від порталів через увесь ангар і далі над сусідами; під щитом у даху — вільно
  for (const b of bays) {
    for (const ln of b.lane) {
      const f = frame(b.R, ln.s)
      reserve(b.level, f.box(ln.u0 - 0.2, ln.u1 + 0.2, b.kind === 'air' ? -10 : -0.01, b.kind === 'air' ? 20 : 1.6))
    }
    if (b.roof) { const f = frame(b.R, LONG_OF(b)[0]); reserve(b.level, f.box(1.8, f.len - 1.8, 1.8, 8.2)) }
  }
  for (const [z, poly] of reserveQ) for (const r of rooms) if (Math.abs(r.z - z) < 1e-6) r.reserved.push(poly)

  // ---------- техніка ----------
  for (const b of bays) park(b)

  // ---------- станції ----------
  const roleRooms = (role) => cells.filter((c) => c.role === role).flatMap((c) => c.rooms0 || [])
  const indoor = () => ['hall', 'spare', 'storage', 'workshop', 'refinery', 'water', 'living'].flatMap(roleRooms)
  const put = (type, first) => {
    const p = pr(type)
    const list = [...first, ...indoor().filter((r) => !first.includes(r))]
    for (const r of list) {
      if (p.h > r.ceil - 0.2) continue
      const at = fit(r, p.w, p.d)
      if (at) { r.placed.push(at.poly); B.item(type, at.c.x, at.c.y, r.z, at.ang); return true }
    }
    notes.push({ code: 'fit', text: 'Не вмістилось: {what}', vars: { what: p.name } })
    return false
  }
  // спершу великі (щоб не лишились без місця)
  const order = Object.entries(P.stations).filter(([t]) => !OUTDOOR.has(t)).flatMap(([t, n]) => rep(t, n))
  order.sort((a, b) => pr(b).w * pr(b).d - pr(a).w * pr(a).d || STATION_TYPES.indexOf(a) - STATION_TYPES.indexOf(b))
  for (const t of order) put(t, roleRooms(ROLE_OF(t)))
  // кімнати житла: скриня й контейнер у кожній
  let roomsLeft = P.rooms
  for (const r of cells.flatMap((c) => c.livingRooms || [])) { if (roomsLeft <= 0) break; put('GenericContainer_Placeable', [r]); put('StorageContainer_Placeable', [r]); roomsLeft-- }
  for (let k = 0; k < roomsLeft; k++) { put('GenericContainer_Placeable', roleRooms('living')); put('StorageContainer_Placeable', roleRooms('living')) }
  // ремонт в ангарах і гаражах (поза смугами)
  for (const b of bays) { const p = pr('RepairStation_Placeable'); const at = fit(b.room, p.w, p.d, { island: false }); if (at) { b.room.placed.push(at.poly); B.item('RepairStation_Placeable', at.c.x, at.c.y, b.room.z, at.ang) } }
  // надворі: двори, атріуми, тераси; нема — вітропастки всередину, вітряки — паливними генераторами
  const outdoorRooms = rooms.filter((r) => r.outdoor)
  for (const [t, n] of Object.entries(P.stations).filter(([t]) => OUTDOOR.has(t))) {
    for (let i = 0; i < n; i++) {
      if (outdoorRooms.length) put(t, outdoorRooms)
      else if (/windtrap/.test(t)) put(t, roleRooms('water'))
      else { if (i === 0) notes.push({ code: 'wind', text: 'Нема тераси для вітряків — замість них паливні генератори' }); if (i % 3 === 0) put('Generator_Placeable', roleRooms('water')) }
    }
  }

  let pieces = B.finish()
  // камери — далі, ніж для звичайної бази: генератор будує вище (вежі, зикурат), а перегляд у ньому нижчий
  const topZ = Math.max(G, ...pieces.map((q) => q.z))
  const views = (() => {
    const v = L.BASEDATA.viewsOf(L.BASEDATA.boundsOf(claims))
    const k = 1.2 + Math.max(0, topZ - 10) / 25
    for (const name of ['quarter', 'front', 'back']) {
      const { pos, target } = v[name]
      target[1] = Math.max(target[1], topZ * 0.3)
      v[name] = { pos: pos.map((x, i) => +(target[i] + (x - target[i]) * k).toFixed(2)), target }
    }
    return v
  })()
  const doc = L.makeDoc({ claims, pieces, items: B.items, zones: B.zones, ui: describe(P, pl), levelNames: levelNames(pl), views })
  doc.ui.generator = { v: 2, params: { ...(P.orig || P), name: undefined, hexAuto: undefined } }
  return { doc }

  // ---------- допоміжне (замикання) ----------
  /** з верхнього рівня ділянки c на її сторону s можна вийти: за нею тераса, модуль чи будівля з двором */
  function walkSide(c, s) {
    const x = c.nb[s]
    if (!x) return false
    if (x.shape === 'yard') return anyUpper && touches(x, OPP[s])
    return sq(x) && x.h0 === G && !x.cap
  }
  /**
   * Обернені похилі стіни першого поверху (Харконнени): на зовнішніх сторонах sides — похилі панелі назовні (низ — на
   * внутрішній лінії, верх — на межі ділянки), над ними ряд стіни; приміщення — всередині. Кут, де сходяться дві такі
   * сторони, — відкритий ганок: колона в куті тримає верх, усередину — стіни.
   */
  /** край даху чи тераси: зубці — через одну плитку стіна й напівстіна (силует фортеці); парапет — суцільна напівстіна */
  function merlon(B, e, z) {
    const k = Math.round((e.m.x + e.m.y) * 2)
    B.edge(e, z, S.battlements && (k + merlonPhase) % 4 < 2 ? 'Sardaukar_Wall_01' : 'Sardaukar_Wall_Half')
  }
  /**
   * Вежі 4 × 4 на терасах (стиль): «одна» — на найкращому куті, «кутові» — на кожному зовнішньому куті тераси (до 4).
   * Не на смугах польоту, не на дверях і прорізах сходів. Поверхи по 4, драбина з люком на кожен поверх,
   * дах — за стилем (пласкі — з люком і зубцями чи поручнями); балкончик 2 × 1 на верхньому поверсі.
   */
  function placeTowers() {
    const T = 4, F = S.towerFloors
    const cx = cells.reduce((a, c) => a + c.R.x0 + 5, 0) / cells.length, cy = cells.reduce((a, c) => a + c.R.y0 + 5, 0) / cells.length
    const doorRects = doors.filter((d) => d.z === G).map((d) => { const m = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 }; return rectPoly(m.x - 1.6, m.y - 1.6, m.x + 1.6, m.y + 1.6) })
    const blocked = (rect) => [...laneRects, ...doorRects].some((r) => overlap(r, rect, -0.01)) || reserveQ.some(([z, poly]) => z === G && overlap(poly, rect, -0.01))
    const extG = (c, q) => !c.nb[q] || !sq(c.nb[q]) || c.nb[q].cap || c.nb[q].h0 !== G
    const cand = []
    for (const c of cells) {
      if (!(sq(c) && !c.up && c.h0 === G && !c.cap) || c.zig) continue
      for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const hs = sx ? 'E' : 'W', vs = sy ? 'N' : 'S'
        const both = extG(c, hs) && extG(c, vs)
        if (S.towers === 'corners' && !both) continue
        const R = { x0: sx ? c.R.x1 - T : c.R.x0, y0: sy ? c.R.y1 - T : c.R.y0 }
        R.x1 = R.x0 + T; R.y1 = R.y0 + T
        const poly = rectPoly(R.x0 - 0.3, R.y0 - 0.3, R.x1 + 0.3, R.y1 + 0.3)
        if (blocked(poly)) continue
        cand.push({ c, R, hs, vs, score: (both ? 10 : 0) + Math.hypot(R.x0 + 2 - cx, R.y0 + 2 - cy) + V() * 9 })
      }
    }
    cand.sort((a, b) => b.score - a.score)
    const picked = []
    for (const t of cand) {
      // між вежами — щонайменше 4: дві вежі впритул (на кутах сусідніх ділянок) читаються однією брилою
      if (picked.some((p) => overlap(rectPoly(p.R.x0 - 4, p.R.y0 - 4, p.R.x1 + 4, p.R.y1 + 4), rectPoly(t.R.x0, t.R.y0, t.R.x1, t.R.y1)))) continue
      picked.push(t)
      if (S.towers === 'one' || picked.length >= 4) break
    }
    // кутові — різної висоти (за варіантом): перша — повна, решта — на поверх нижча чи така сама
    picked.forEach((t, i) => buildTower(t, T, i === 0 ? F : Math.max(1, F - Math.floor(V() * 2))))
    return picked.length
  }
  /**
   * Навіси на терасах (стиль): пласкі дахи 3 × 3, 4 × 2 чи 2 × 4 на чотирьох колонах — один-два на базу, на різних
   * ділянках, у кутах чи посередині країв тераси (за варіантом), не на смугах польоту, дверях, сходах, вежах; під навісом
   * станцій нема.
   */
  function placeCanopies() {
    const doorRects = doors.filter((d) => d.z === G).map((d) => { const m = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 }; return rectPoly(m.x - 1.6, m.y - 1.6, m.x + 1.6, m.y + 1.6) })
    const blocked = (rect) => [...laneRects, ...doorRects].some((r) => overlap(r, rect, -0.01)) || reserveQ.some(([z, poly]) => z === G && overlap(poly, rect, -0.01))
    const cand = []
    for (const c of cells) {
      if (!(sq(c) && !c.up && c.h0 === G && !c.cap) || c.zig) continue
      // 3 × 3, 4 × 2 чи 2 × 4 — у кутах і посередині країв
      const [w, d] = [[3, 3], [4, 2], [2, 4]][Math.floor(V() * 3)]
      for (const a of [0, Math.floor((10 - w) / 2), 10 - w]) for (const b of [0, Math.floor((10 - d) / 2), 10 - d]) {
        if (a > 0 && a < 10 - w && b > 0 && b < 10 - d) continue
        const R = { x0: c.R.x0 + a, y0: c.R.y0 + b, x1: c.R.x0 + a + w, y1: c.R.y0 + b + d }
        if (blocked(rectPoly(R.x0 - 0.3, R.y0 - 0.3, R.x1 + 0.3, R.y1 + 0.3))) continue
        cand.push({ c, R, score: V() })
      }
    }
    cand.sort((a, b) => b.score - a.score)
    const n = 1 + Math.floor(V() * 2), picked = []
    for (const t of cand) {
      if (picked.some((p) => p.c === t.c)) continue
      picked.push(t)
      if (picked.length >= n) break
    }
    for (const { R } of picked) {
      later.push((B) => {
        for (const q of [[R.x0, R.y0], [R.x1, R.y0], [R.x0, R.y1], [R.x1, R.y1]]) B.column(q[0], q[1], G, G + 3)
        for (const t of L.rect(R.x0, R.x1, R.y0, R.y1)) B.slab(t, G + 3, 'roof')
      })
      reserve(G, rectPoly(R.x0 - 0.3, R.y0 - 0.3, R.x1 + 0.3, R.y1 + 0.3))
    }
  }
  /**
   * Зикурат на терасі (стиль): ділянка ближче до середини бази, де вільно від смуг польоту, дверей і сходів. Три яруси
   * похилих стін — 8 × 8 (+4…+8), 6 × 6 (+8…+12) і корона 4 × 4 (+12…+15) з дахом за стилем; сторона до середини
   * бази — пряма на всіх ярусах: у ній двері, над ними — уступ-виступ з поручнями, усередині — драбина з люком на нього.
   */
  function placeZiggurat() {
    const cx = cells.reduce((a, c) => a + c.R.x0 + 5, 0) / cells.length, cy = cells.reduce((a, c) => a + c.R.y0 + 5, 0) / cells.length
    const doorRects = doors.filter((d) => d.z === G).map((d) => { const m = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 }; return rectPoly(m.x - 1.6, m.y - 1.6, m.x + 1.6, m.y + 1.6) })
    const cand = cells.filter((c) => sq(c) && !c.up && c.h0 === G && !c.cap).filter((c) => {
      const poly = rectPoly(c.R.x0 + 0.7, c.R.y0 + 0.7, c.R.x1 - 0.7, c.R.y1 - 0.7)
      return ![...laneRects, ...doorRects].some((r) => overlap(r, poly, -0.01)) && !reserveQ.some(([z, q]) => z === G && overlap(q, poly, -0.01))
    }).map((c) => [c, Math.hypot(c.R.x0 + 5 - cx, c.R.y0 + 5 - cy) + V() * 12]).sort((a, b) => a[1] - b[1]).map(([c]) => c)
    const c = cand[0]
    if (!c) return false
    c.zig = true
    // пряма сторона — до середини бази (чи до сусіда, звідки приходять)
    const ds = SIDES.map((q) => [q, (c.nb[q] && sq(c.nb[q]) ? 2 : 0) + (DIRS[q].x * (cx - c.R.x0 - 5) + DIRS[q].y * (cy - c.R.y0 - 5)) * 0.01]).sort((a, b) => b[1] - a[1])[0][0]
    const tiers = [[1, G, 4], [2, G + 4, 4], [3, G + 8, 3]]
    tiers.forEach(([d, z, h], k) => {
      const R = insetN(c.R, d)
      const last = k === tiers.length - 1
      const roof = last ? P.roof : 'flat'
      B.block({
        tiles: L.rect(R.x0, R.x1, R.y0, R.y1), z, h, roof, lean: true,
        leanSkip: (e) => onSide(R, ds, e.m),
        zone: { name: last ? 'Корона зикурата' : `Зикурат, ярус ${k + 1}`, group: last ? 'crown' : 'tower' },
      })
      const f = frame(R, ds), w = f.len
      const du = Math.floor(w / 2)
      const [da, db] = f.seg(du, du + 1)
      doorAt(da, db, z)
      later.push((B) => {
        B.door(da, db, z)
        if (last) return
        // драбина нагору біля дверей, люк — на уступ перед наступним ярусом; уступ з поручнями
        const q = f.at(1.5, 0.5)
        B.ladder(...f.seg(1, 2), z, z + h, L.sq(q.x, q.y))
        const ledge = L.rect(...minmax(f.at(1, 0), f.at(w - 1, 1)))
        // з боку наступного ярусу — його стіна (й трикутні торці похилих), поручні лише по краю уступу
        const N = insetN(c.R, d + 1)
        B.railAround(ledge, z + h, (e) => { const q = { x: 2 * e.m.x - e.t.x, y: 2 * e.m.y - e.t.y }; return q.x > N.x0 && q.x < N.x1 && q.y > N.y0 && q.y < N.y1 })
      })
    })
    reserve(G, rectPoly(c.R.x0 + 0.8, c.R.y0 + 0.8, c.R.x1 - 0.8, c.R.y1 - 0.8))
    return true
  }
  /**
   * Вежа на місці R (4 × 4). Квадратна — 4 × 4 на всю висоту; келих (goblet) — стовбур 2 × 2 посередині, нагорі —
   * оглядовий майданчик 4 × 4 на консолях (як вежа Sandwalkers Main): з поручнями й павільйоном на кутових колонах
   * (дах за верхом вежі), кімната — закрита оглядова, голки — колони-шпилі на кутах.
   */
  function buildTower({ c, R, hs, vs }, T, F) {
    void c; void T
    const goblet = S.towerShape === 'goblet'
    // уступом: на F поверхах 4 × 4 — кімната 2 × 2 (3 заввишки), довкола — майданчик із поручнями
    const stepped = S.towerShape === 'stepped'
    const Top = insetN(R, 1), topTiles = L.rect(Top.x0, Top.x1, Top.y0, Top.y1)
    const Sh = goblet ? insetN(R, 1) : R
    const tiles = L.rect(Sh.x0, Sh.x1, Sh.y0, Sh.y1)
    const crown = L.rect(R.x0, R.x1, R.y0, R.y1)
    const topZ = G + 4 * F
    // верх: за дахами стилю, піраміда, скатний, пласкі, голки (колони-шпилі на кутах), ліхтар (останній поверх — скло)
    const cap = S.towerCap === 'roof' ? P.roof : S.towerCap
    const roof = cap === 'pyramid' || cap === 'hip' ? cap : 'flat'
    // вхід і балкон — з боку тераси (внутрішні сторони вежі), драбина — на зовнішній стіні
    const inner = [OPP[hs], OPP[vs]]
    const fDoor = frame(Sh, inner[0]), fBal = frame(Sh, inner[1]), fLad = frame(Sh, hs)
    for (let k = 0; k < F; k++) {
      B.block({ tiles, z: G + 4 * k, h: 4, roof: goblet || k < F - 1 ? 'none' : stepped ? 'flat' : roof, zone: k === 0 ? { name: 'Вежа', group: 'tower' } : null })
    }
    if (goblet) {
      // майданчик: кімната — закрита оглядова 3 заввишки; інакше відкритий, з поручнями, павільйон на кутових колонах
      if (cap === 'room') B.block({ tiles: crown, z: topZ, h: 3, roof: 'flat', zone: { name: 'Оглядова', group: 'crown' } })
      else if (cap !== 'spires') B.block({ tiles: crown, z: topZ + 3, h: 0, floor: false, roof })
    } else if (stepped) {
      B.block({ tiles: topTiles, z: topZ, h: 3, roof, zone: { name: 'Верх вежі', group: 'crown' } })
      const [ta, tb] = frame(Top, hs).seg(1, 2)
      doorAt(ta, tb, topZ)
      later.push((B) => {
        B.door(ta, tb, topZ)
        if (walled) for (const e of L.boundary(crown)) merlon(B, e, topZ)
        else B.railAround(crown, topZ)
        if (cap === 'spires') for (const q of [[Top.x0, Top.y0], [Top.x1, Top.y0], [Top.x0, Top.y1], [Top.x1, Top.y1]]) B.column(q[0], q[1], topZ + 3, topZ + 6)
      })
    } else if (roof === 'flat') flatTops.push({ tiles, z: topZ })
    const [da, db] = fDoor.seg(1, 2)
    doorAt(da, db, G)
    reserve(G, rectPoly(R.x0 - 0.2, R.y0 - 0.2, R.x1 + 0.2, R.y1 + 0.2))
    const bal = !goblet && !stepped && S.balconies && F >= 2
    later.push((B) => {
      B.door(da, db, G)
      // драбина нагору поверх за поверхом; на пласкому даху (і на майданчик келиха) — люк і нагору
      const lu = 1
      for (let k = 0; k < F; k++) {
        const z0 = G + 4 * k, z1 = z0 + 4
        if (!goblet && !stepped && k === F - 1 && roof !== 'flat') break
        const q = fLad.at(lu + 0.5, 0.5)
        B.ladder(...fLad.seg(lu, lu + 1), z0, z1, L.sq(q.x, q.y))
      }
      if (stepped) return
      if (goblet) {
        const hk = L.sq(fLad.at(lu + 0.5, 0.5).x, fLad.at(lu + 0.5, 0.5).y).key
        if (cap !== 'room') for (const t of crown) if (t.key !== hk) B.slab(t, topZ, 'roof')
        if (cap !== 'room') { if (walled) for (const e of L.boundary(crown)) merlon(B, e, topZ); else B.railAround(crown, topZ) }
        const corners = [[R.x0, R.y0], [R.x1, R.y0], [R.x0, R.y1], [R.x1, R.y1]]
        if (cap !== 'room') for (const q of corners) B.column(q[0], q[1], topZ, topZ + 3)
        if (cap === 'room' && S.skylights) for (const t of L.rect(R.x0 + 1, R.x1 - 1, R.y0 + 1, R.y1 - 1)) B.shieldFloor(t, topZ + 3)
        return
      }
      if (roof === 'flat' && !walled) B.railAround(tiles, topZ)
      // голки: колони-шпилі на кутах даху; ліхтар — скляна стеля посередині
      if (cap === 'spires') for (const q of [[R.x0, R.y0], [R.x1, R.y0], [R.x0, R.y1], [R.x1, R.y1]]) B.column(q[0], q[1], topZ, topZ + 3)
      if (cap === 'room' && S.skylights) for (const t of L.rect(R.x0 + 1, R.x1 - 1, R.y0 + 1, R.y1 - 1)) if (!(Math.abs(t.x - fLad.at(1.5, 0.5).x) < 1e-6 && Math.abs(t.y - fLad.at(1.5, 0.5).y) < 1e-6)) B.shieldFloor(t, topZ)
      if (bal) {
        const z = G + 4 * (F - 1)
        const btiles = [fBal.at(1.5, -0.5), fBal.at(2.5, -0.5)].map((q) => L.sq(q.x, q.y))
        for (const t of btiles) B.slab(t, z, 'roof')
        B.door(...fBal.seg(1, 2), z)
        B.railAround(btiles, z, (e) => onSide(R, inner[1], e.m))
      }
    })
    if (bal) doorAt(...fBal.seg(1, 2), G + 4 * (F - 1))
  }
  /**
   * Корона на даху житла c: open — павільйон (чотири колони й дах за верхом веж), room — кімната нагорі, spires —
   * голки на кутах даху, lean — похила корона (як верх зикурата). Драбина зі стіни коридору (між дверима
   * кімнат) і люк нагору; скатний дах — корона на його пласкому верху (на блок вище), стіна під драбиною — до нього.
   */
  function buildCrown(c, kind) {
    const { f, M, halves } = c.liv
    c.crown = kind
    const wu = halves.find((h) => !h.hall).wallU
    const zt = G + H_LIVING + (P.roof === 'hip' ? 1 : 0)
    const [la, lb] = wu === 4 ? [f.at(4, 6), f.at(4, 5)] : [f.at(6, 5), f.at(6, 6)]
    const hq = f.at(wu === 4 ? 4.5 : 5.5, 5.5)
    const Q = minmaxR([f.at(3, 3), f.at(7, 7)])
    const tiles = L.rect(Q.x0, Q.x1, Q.y0, Q.y1)
    const cap = S.towerCap === 'roof' ? P.roof : S.towerCap
    if (kind === 'open') B.block({ tiles, z: zt + 3, h: 0, floor: false, roof: cap === 'pyramid' ? 'pyramid' : cap === 'flat' ? 'flat' : 'hip' })
    if (kind === 'room') B.block({ tiles, z: zt, h: 3, roof: 'flat', zone: { name: 'Оглядова', group: 'crown' } })
    if (kind === 'lean') B.block({ tiles, z: zt, h: 3, roof: 'flat', lean: true, zone: { name: 'Корона', group: 'crown' } })
    later.push((B) => {
      if (zt > G + H_LIVING) B.fill(la, lb, G + H_LIVING, zt)
      B.ladder(la, lb, G, zt, L.sq(hq.x, hq.y))
      if (kind === 'open') for (const q of [[Q.x0, Q.y0], [Q.x1, Q.y0], [Q.x0, Q.y1], [Q.x1, Q.y1]]) B.column(q[0], q[1], zt, zt + 3)
      // голки: на кутах плаского даху; на скатному — на кутах його плаского верху (кути карниза — скати, стати нема на що)
      const T = P.roof === 'hip' ? insetN(M, 1) : M
      if (kind === 'spires') for (const q of [[T.x0, T.y0], [T.x1, T.y0], [T.x0, T.y1], [T.x1, T.y1]]) B.column(q[0], q[1], zt, zt + 3)
      if ((kind === 'open' || kind === 'spires') && P.roof === 'flat' && !walled) B.railAround(L.rect(M.x0, M.x1, M.y0, M.y1), zt)
    })
  }
  function invertedWalls(c, sides) {
    const corners = new Set()
    later.push((B) => {
      for (const s of sides) {
        const f = frame(c.R, s)
        const endSide = (u) => SIDES.find((q) => q !== s && onSide(c.R, q, f.at(u, 0)))
        for (let k = 0; k < 10; k++) {
          const porch = (k === 0 && sides.includes(endSide(0))) || (k === 9 && sides.includes(endSide(10)))
          if (porch) { corners.add(L.kp(f.at(k === 0 ? 0 : 10, 0))); continue }
          const q = f.at(k + 0.5, 0.5)
          B.tileShape(L.sq(q.x, q.y), 0, 'Harkonnen_Outpost_Wall_Inclined_Tall', f.ang + 180)
        }
      }
      // ганки в кутах: колона й дві стіни всередину
      for (const k of corners) {
        const [x, y] = k.split(',').map((v) => Number(v) / 1000)
        const sx = Math.abs(x - c.R.x0) < 1e-6 ? 1 : -1, sy = Math.abs(y - c.R.y0) < 1e-6 ? 1 : -1
        B.column(x, y, 0, 3)
        B.fill({ x: x + sx, y }, { x: x + sx, y: y + sy }, 0, G)
        B.fill({ x, y: y + sy }, { x: x + sx, y: y + sy }, 0, G)
      }
    })
  }
  /**
   * Колонада (Атріди, Імперський): перший поверх відступає від сторін sides на плитку; верх (модуль чи тераса) — на
   * колонах через дві плитки по межі ділянки; під ним — вимощена галерея, над нею — тераса чи балкон (дах-плити).
   * depth 2 — консоль (нависання): відступ на дві плитки, колони лише по кутах і посередині сторони.
   */
  function portico(c, sides, depth = 1) {
    const inner = insetRect2(c.R, sides.flatMap((s) => rep(s, depth)))
    const strip = L.without(L.rect(c.R.x0, c.R.x1, c.R.y0, c.R.y1), L.rect(...flatX(inner)))
    // колонада — колона через дві плитки; консоль (depth 2) — по кутах і посередині: верх нависає над підсінням
    const us = depth > 1 ? [0, 5, 10] : [0, 2, 4, 6, 8, 10]
    later.push((B) => {
      // над галереєю — тераса чи балкон уступу (дах-плита); під верхнім модулем плиту лишає його підлога (сильніша)
      for (const t of strip) { B.slab(t, 0, 'found'); B.slab(t, G, 'roof') }
      const done = new Set()
      for (const s of sides) {
        const f = frame(c.R, s)
        for (const u of us) {
          const q = f.at(u, 0), k = L.kp(q)
          if (done.has(k)) continue
          done.add(k)
          // кут біля спільної стіни з сусідом — там стоїть його стіна
          if (SIDES.some((o) => o !== s && onSide(c.R, o, q) && c.nb[o] && touches(c.nb[o], OPP[o]))) continue
          B.column(q.x, q.y, 0, G)
        }
      }
    })
    for (const s of sides) { const f = frame(c.R, s); for (const u of us) { const q = f.at(u, 0); reserve(0, rectPoly(q.x - 0.3, q.y - 0.3, q.x + 0.3, q.y + 0.3)) } }
  }
  function stripTiles(c) { const R = minmaxR(frame(c.R, c.strip).box(0, 10, 0, 6)); return L.rect(R.x0, R.x1, R.y0, R.y1) }
  function courtTiles(c) { const R = minmaxR(frame(c.R, c.strip).box(0, 10, 6, 10)); return L.rect(R.x0, R.x1, R.y0, R.y1) }
  function park(b) {
    // рамка першої довгої сторони: у ній задано прорізи (b.spans)
    const fr = frame(b.R, LONG_OF(b)[0])
    const r = b.room
    if (b.kind === 'air' || b.roof) {
      // у кожному прорізі (чи під щитом у даху) — ряд посередині глибини: грузовий у центрі, решта обабіч, носом до
      // порталу; під щитом у даху без порталу грузовий стоїть уздовж ангара (під щитом 6 завглибшки він інакше не стане)
      const roofOnly = skyRow(b.kind, b.portals, b.roof)
      const spans = parkSpans(b.kind, b.k, b.portals, b.roof)
      const gap = b.kind === 'air' ? 0.5 : 0.4
      const groups = packBays(b.list, spans, b.kind, roofOnly) || [b.list]
      if (b.kind === 'ground') r.reserved.push(fr.box(0, fr.len, 1.6, 8.4))
      groups.forEach((g, i) => {
        const [s0, s1] = spans[i] || [0, fr.len]
        const order = g.filter((t) => t === 'OrnithopterTransport')
        for (const t of g.filter((x) => x !== 'OrnithopterTransport')) { if (order.length % 2) order.push(t); else order.unshift(t) }
        const total = order.reduce((s, t) => s + wideIn(t, roofOnly), 0) + gap * (Math.max(order.length, 1) - 1)
        let u = (s0 + s1) / 2 - total / 2
        for (const t of order) {
          const along = roofOnly && t === 'OrnithopterTransport'
          const ang = along ? fr.ang : fr.angN
          const p = pr(t), at = fr.at(u + wideIn(t, roofOnly) / 2, 5)
          B.item(t, at.x, at.y, b.level, ang)
          r.placed.push(obb(at, p.w, p.d, ang))
          u += wideIn(t, roofOnly) + gap
        }
      })
      return
    }
    if (b.k > 1) {
      // гараж на кілька ділянок: по прорізу на ділянку — ряд у межах прорізу (біля задньої стіни чи посередині)
      const groups = packBays(b.list, b.spans, 'ground')
      const through = b.portalSides.length === 2
      const pf = frame(b.R, b.portalSides[0])
      const flip = b.portalSides[0] !== LONG_OF(b)[0]
      groups.forEach((g, i) => {
        const [s0, s1] = flip ? [pf.len - b.spans[i][1], pf.len - b.spans[i][0]] : b.spans[i]
        let u = s0 + 0.2
        for (const t of g) {
          const p = pr(t), cv = through ? 5 : 9.85 - p.w / 2
          const at = pf.at(u + WIDE[t] / 2, cv)
          B.item(t, at.x, at.y, b.level, pf.angN + 180)
          r.placed.push(obb(at, p.w, p.d, pf.angN))
          u += WIDE[t] + 0.4
        }
        void s1
      })
      r.reserved.push(through ? pf.box(0, pf.len, 1.6, 8.4) : pf.box(0, pf.len, 1.6, 9.85 - Math.max(...b.list.map((t) => pr(t).w)) - 0.1))
      return
    }
    // наземна: з одним порталом — ряд біля задньої стіни, наскрізний гараж — ряд посередині
    const through = b.portalSides.length === 2
    const pf = frame(b.R, b.portalSides[0])
    let u = 0.15
    for (const t of b.list) {
      const p = pr(t), depth = p.w, wide = p.d
      let placed = false
      const tryAt = (cu, cv) => {
        const poly = obb(pf.at(cu, cv), p.w, p.d, pf.angN)
        if (r.reserved.some((q) => overlapQ(q, poly)) || r.placed.some((q) => overlapQ(q, poly, 0.3))) return false
        const at = pf.at(cu, cv)
        B.item(t, at.x, at.y, b.level, pf.angN + 180)
        r.placed.push(poly)
        return true
      }
      const cv0 = through ? 5 : 9.85 - depth / 2
      for (; u + wide <= pf.len - 0.15 + 1e-9; u += 0.05) if (tryAt(u + wide / 2, cv0)) { u += wide + 0.4; placed = true; break }
      for (let back = 9.85 - 0.1; !placed && back - depth >= 1.6 - 1e-9; back -= 0.1) {
        for (let uu = 0.15; uu + wide <= pf.len - 0.15 + 1e-9; uu += 0.05) if (tryAt(uu + wide / 2, back - depth / 2)) { placed = true; break }
      }
      if (!placed) notes.push({ code: 'vehicle', text: '{what} не вміщається в гараж — додай ділянку чи зменш техніку', vars: { what: p.name } })
    }
    // смуга від порталу до техніки
    if (!through) {
      const front = 9.85 - Math.max(...b.list.map((t) => pr(t).w), 0)
      r.reserved.push(pf.box(0, pf.len, 1.6, Math.max(1.6, front - 0.1)))
    } else r.reserved.push(pf.box(0, pf.len, 1.6, 8.4))
  }
  function buildLiving(c) {
    // коридор 2 завширшки від сторони з дверима до протилежної; кімнати обабіч; зі сходами — половина з боку сходів
    // лишається холом. Уступи (стиль): зовнішні сторони — на плитку всередину, довкола — балкон із поручнями, з кожної
    // кімнати на нього двері
    const f = frame(c.R, c.livFs)
    let stairHalf = null
    if (stairs.includes(c)) {
      const sp = frame(c.R, c.stairSide).at(5, 0.5)
      stairHalf = (sp.x - f.a.x) * f.U.x + (sp.y - f.a.y) * f.U.y < 5 ? 0 : 1
    }
    const sideAt = (u, v) => SIDES.find((q) => onSide(c.R, q, f.at(u, v)))
    const out = (q) => S.setbacks && !walkSide(c, q)
    // поперек коридору — обидві сторони разом (кімнати 3 завширшки), щоб коридор лишився на місці
    const cross = stairHalf === null && out(sideAt(0, 5)) && out(sideAt(10, 5))
    const ul = cross ? 1 : 0, ur = cross ? 9 : 10
    const vf = out(c.livFs) ? 1 : 0, vb = out(OPP[c.livFs]) ? 9 : 10
    const M = minmaxR([f.at(ul, vf), f.at(ur, vb)])
    // скляна стеля над коридором; з короною на даху (buildCrown, вирішується пізніше) — лише за нею: щит — суцільний
    // прямокутник, а корона стала б на нього
    const skyQ = () => minmaxR([f.at(4, c.crown ? 7 : vf + 1), f.at(6, vb - 1)])
    const sky = S.skylights && P.roof !== 'pyramid' ? (q) => { const Q = skyQ(); return q.x > Q.x0 && q.x < Q.x1 && q.y > Q.y0 && q.y < Q.y1 } : null
    B.block({
      tiles: L.rect(M.x0, M.x1, M.y0, M.y1), z: G, h: H_LIVING, roof: P.roof, lean: false,
      sky: sky && P.roof !== 'flat' ? (t) => sky(cent(t.p)) : undefined,
    })
    if (sky && P.roof === 'flat') later.push((B) => { const Q = skyQ(); for (const t of L.rect(Q.x0, Q.x1, Q.y0, Q.y1)) B.shieldFloor(t, G + H_LIVING) })
    if (P.roof === 'flat') flatTops.push({ tiles: L.rect(M.x0, M.x1, M.y0, M.y1), z: G + H_LIVING })
    // балкон: кільце між модулем і межею ділянки — пішохідне, з поручнями по краю
    if (ul || vf || vb < 10) {
      const ring = L.without(L.rect(c.R.x0, c.R.x1, c.R.y0, c.R.y1), L.rect(M.x0, M.x1, M.y0, M.y1))
      for (const t of ring) { terraceTiles.push(t); terraceKeys.add(t.key) }
    }
    const halves = [0, 1].map((half) => (half === stairHalf ? { hall: true, poly: f.box(half ? 6 : 0, half ? 10 : 4, 0, 10) } : { u0: half ? 6 : ul, u1: half ? ur : 4, wallU: half ? 6 : 4, outU: half ? ur : ul }))
    c.livingRooms = []
    later.push((B) => {
      for (const h of halves) {
        if (h.hall) continue
        B.fill(f.at(h.wallU, vf), f.at(h.wallU, vb), G, G + H_LIVING)
        B.fill(f.at(h.u0, 5), f.at(h.u1, 5), G, G + H_LIVING)
        for (const v of [2, 7]) B.door(f.at(h.wallU, v), f.at(h.wallU, v + 1), G, 'Choam_Level2_Door_Frame')
        // з кімнат — на балкон
        if (cross) for (const v of [2, 7]) B.door(f.at(h.outU, v), f.at(h.outU, v + 1), G, 'Choam_Level2_Door_Frame')
      }
      if (vb < 10) B.door(f.at(5, vb), f.at(4, vb), G, 'Choam_Level2_Door_Frame')
      if (vf > 0) B.door(f.at(4, vf), f.at(5, vf), G, 'Choam_Level2_Door_Frame')
    })
    if (cross) for (const h of halves) if (!h.hall) for (const v of [2, 7]) doorAt(f.at(h.outU, v), f.at(h.outU, v + 1), G)
    if (vb < 10) doorAt(f.at(5, vb), f.at(4, vb), G)
    if (vf > 0) doorAt(f.at(4, vf), f.at(5, vf), G)
    c.liv = { f, M, halves }
    let n = 0
    for (const h of halves) {
      if (h.hall) { room(h.poly, G, { ceil: H_LIVING, name: 'Сходовий хол' }); continue }
      for (const [v0, v1] of [[vf, 5], [5, vb]]) {
        const r = room(f.box(h.u0, h.u1, v0, v1), G, { ceil: H_LIVING, name: 'Кімната' })
        c.livingRooms.push(r)
        const v = v0 < 5 ? 2 : 7
        doorAt(f.at(h.wallU, v), f.at(h.wallU, v + 1), G)
        B.zone(`Кімната ${++n}`, 'core', G, L.rect(...minmax(f.at(h.u0, v0), f.at(h.u1, v1))))
      }
    }
    B.zone('Коридор', 'core', G, L.rect(...minmax(f.at(4, vf), f.at(6, vb))))
    if (stairHalf !== null) B.zone('Сходовий хол', 'core', G, L.rect(...minmax(f.at(stairHalf ? 6 : 0, 0), f.at(stairHalf ? 10 : 4, 10))))
  }
  /** шестикутник (сторона 4) чи дванадцятикутник (гекс зі стороною 3, обкладений смугами квадратів): пласка сторона —
   *  до сусіда c.to, коридор до межі ділянки; вхід — з протилежного боку */
  function buildRound(c) {
    const d = DIRS[c.to], lat = { x: -d.y, y: d.x }
    const phi = (Math.atan2(d.y, d.x) * 180) / Math.PI
    const cc = { x: (c.R.x0 + c.R.x1) / 2, y: (c.R.y0 + c.R.y1) / 2 }
    const name = ROLE[c.role][0] + ` (${SHAPE_NAME[c.shape]})`
    let ctr, tiles, poly, apo, corrW, corrLen
    if (c.shape === 'hex') {
      apo = 2 * Math.sqrt(3); corrW = 4; corrLen = 2
      ctr = { x: cc.x + d.x * (5 - corrLen - apo), y: cc.y + d.y * (5 - corrLen - apo) }
      tiles = L.hexTiles(ctr, 4, phi - 90)
      poly = L.ngon(ctr, 4, 6, phi - 90)
    } else {
      // гекс зі стороною 3 і смуги по 1: зовнішній край смуги — на відстані 3√3/2 + 1 від центру
      apo = (3 * Math.sqrt(3)) / 2 + 1; corrW = 3; corrLen = 1
      ctr = { x: cc.x + d.x * (5 - corrLen - apo) + lat.x * 0.5, y: cc.y + d.y * (5 - corrLen - apo) + lat.y * 0.5 }
      tiles = L.dodecaTiles(ctr, 3, phi - 30)
      // обрис — опуклий: зовнішні кути смуг
      const V = L.ngon(ctr, 3, 6, phi - 30)
      poly = []
      for (let i = 0; i < 6; i++) {
        const a = V[i], b = V[(i + 1) % 6], L1 = Math.hypot(b.x - a.x, b.y - a.y), n = { x: (b.y - a.y) / L1, y: -(b.x - a.x) / L1 }
        poly.push({ x: a.x + n.x, y: a.y + n.y }, { x: b.x + n.x, y: b.y + n.y })
      }
      if (area(poly) < 0) poly.reverse()
    }
    if (c.shape === 'hex' && S.dome) {
      // ступінчастий купол: шестикутники 4 → 3 → 2 по блоку, ліхтар — шестикутник 1 зі склом, усередині — один простір
      const tiers = [[4, 0, G], [3, G, 1], [2, G + 1, 1], [1, G + 2, 2]].map(([sd, z, h]) => ({ sd, z, h, tiles: L.hexTiles(ctr, sd, phi - 90) }))
      tiers.forEach((tr, k) => B.block({
        tiles: tr.tiles, z: tr.z, h: tr.h, floor: k === 0, roof: k === tiers.length - 1 ? 'flat' : 'none',
        zone: k === 0 ? { name, group: ROLE[c.role][1] } : null,
      }))
      later.push((B) => { for (let k = 0; k < tiers.length - 1; k++) for (const t of L.without(tiers[k].tiles, tiers[k + 1].tiles)) B.slab(t, tiers[k].z + tiers[k].h, 'roof') })
    } else B.block({ tiles, z: 0, h: G, roof: 'flat', zone: { name, group: ROLE[c.role][1] } })
    const e0 = { x: ctr.x + d.x * apo, y: ctr.y + d.y * apo }
    const p1 = { x: e0.x + lat.x * (corrW / 2), y: e0.y + lat.y * (corrW / 2) }, p2 = { x: e0.x - lat.x * (corrW / 2) + d.x * corrLen, y: e0.y - lat.y * (corrW / 2) + d.y * corrLen }
    const [x0, x1, y0, y1] = minmax(p1, p2)
    B.block({ tiles: L.rect(Math.round(x0), Math.round(x1), Math.round(y0), Math.round(y1)), z: 0, h: G, roof: 'flat', zone: { name: 'Коридор', group: 'core' } })
    const ea = { x: e0.x - lat.x * (corrW / 2), y: e0.y - lat.y * (corrW / 2) }, eb = { x: e0.x + lat.x * (corrW / 2), y: e0.y + lat.y * (corrW / 2) }
    later.push((B) => B.open(ea, eb, 0, G))
    const side = frame(c.R, c.to), u = doorU(c.to)
    const [da, db] = side.seg(u, u + 1)
    later.push((B) => B.door(da, db, 0))
    doorAt(da, db, 0)
    // вхід — з протилежного боку, одинична ділянка від середини пласкої сторони
    const back = { x: ctr.x - d.x * apo, y: ctr.y - d.y * apo }
    const half = c.shape === 'dodeca' ? 0.5 : 0
    const ua = { x: back.x - lat.x * half, y: back.y - lat.y * half }, ub = { x: ua.x + lat.x, y: ua.y + lat.y }
    later.push((B) => B.door(ub, ua, 0))
    doorAt(ub, ua, 0)
    c.room0 = room(poly, 0, { name })
    c.rooms0 = [c.room0]
  }
}

const LONG_OF = (b) => LONG[b.axis]

// ---------- тексти ----------
function describe(P, pl) {
  const n = pl.cells.length
  const sum = (types) => P.bays.reduce((s, b) => s + types.reduce((q, t) => q + (b.items[t] || 0), 0), 0)
  const orni = sum(AIR), veh = sum(GROUND), car = sum(['OrnithopterTransport'])
  const air = pl.bays.filter((b) => b.kind === 'air').length, gar = pl.bays.filter((b) => b.kind === 'ground').length
  const parts = []
  if (orni) parts.push(`${orni} орні в ${air} ${air === 1 ? 'ангарі' : 'ангарах'}${car ? ` (грузових — ${car})` : ''}`)
  if (veh) parts.push(`${veh} од. наземної техніки в ${gar} ${gar === 1 ? 'гаражі' : 'гаражах'}`)
  if (P.rooms) parts.push(`${P.rooms} кімнат`)
  const shapes = [...new Set(pl.cells.filter((c) => c.shape !== 'square').map((c) => SHAPE_NAME[c.shape]))]
  if (shapes.length) parts.push(`приміщення: ${shapes.join(', ')}`)
  const lead = `Згенерована база на ${n} ділянк${n === 1 ? 'у' : n < 5 ? 'и' : ''}: ${parts.length ? parts.join('; ') : 'зал, склад і майстерня'}. Уся техніка — під дахом, вихід — крізь пентащит.`
  const facts = [`<b>${n}</b> ділянок`]
  if (orni) facts.push(`<b>${orni}</b> орні`)
  if (veh) facts.push(`<b>${veh}</b> техніки`)
  if (P.rooms) facts.push(`<b>${P.rooms}</b> кімнат`)
  return { name: P.name || 'Згенерована база', lead, facts }
}
function levelNames(pl) {
  const out = { 0: ['Рівень 0', 'гаражі, майстерня, переробка, вода, склад'] }
  if (pl.anyUpper) out[G] = [`Рівень +${G}`, [pl.bays.some((b) => b.level === G) && 'ангари', pl.cells.some((c) => c.up?.kind === 'living') && 'житло', 'тераси'].filter(Boolean).join(', ')]
  out.roof = 'дахи'
  return out
}

// ---------- дрібниці ----------
const unit = (a, b) => { const L = Math.hypot(b.x - a.x, b.y - a.y); return { x: (b.x - a.x) / L, y: (b.y - a.y) / L } }
const cent = (ps) => ({ x: ps.reduce((s, q) => s + q.x, 0) / ps.length, y: ps.reduce((s, q) => s + q.y, 0) / ps.length })
const minmax = (a, b) => [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)]
const minmaxR = (pts) => ({ x0: Math.min(...pts.map((q) => q.x)), y0: Math.min(...pts.map((q) => q.y)), x1: Math.max(...pts.map((q) => q.x)), y1: Math.max(...pts.map((q) => q.y)) })
const flatR = (R) => [R.x0, R.y0, R.x1, R.y1]
const area = (poly) => poly.reduce((s, a, i) => { const b = poly[(i + 1) % poly.length]; return s + a.x * b.y - b.x * a.y }, 0) / 2
/** відстань точки від сторони рамки (уздовж N) */
const distTo = (f, q) => (q.x - f.a.x) * f.N.x + (q.y - f.a.y) * f.N.y
const overlapQ = (P, Q, gap = 0) => {
  for (const poly of [P, Q]) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], Ln = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = -(b.y - a.y) / Ln, ny = (b.x - a.x) / Ln
    let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity
    for (const q of P) { const s = q.x * nx + q.y * ny; p0 = Math.min(p0, s); p1 = Math.max(p1, s) }
    for (const q of Q) { const s = q.x * nx + q.y * ny; q0 = Math.min(q0, s); q1 = Math.max(q1, s) }
    if (p1 + gap <= q0 + 1e-9 || q1 + gap <= p0 + 1e-9) return false
  }
  return true
}
/** точка m лежить на стороні s прямокутника R */
function onSide(R, s, m) {
  const e = 1e-6
  if (s === 'S') return Math.abs(m.y - R.y0) < e && m.x >= R.x0 - e && m.x <= R.x1 + e
  if (s === 'N') return Math.abs(m.y - R.y1) < e && m.x >= R.x0 - e && m.x <= R.x1 + e
  if (s === 'W') return Math.abs(m.x - R.x0) < e && m.y >= R.y0 - e && m.y <= R.y1 + e
  if (s === 'E') return Math.abs(m.x - R.x1) < e && m.y >= R.y0 - e && m.y <= R.y1 + e
  return false
}
/** прямокутник R, звужений на d з усіх боків */
const insetN = (R, d) => ({ x0: R.x0 + d, y0: R.y0 + d, x1: R.x1 - d, y1: R.y1 - d })
/** точка всередині опуклого чотирикутника (рамка f.box) */
function pointInRect(q, poly) {
  let sg = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const c = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)
    if (Math.abs(c) < 1e-9) continue
    if (!sg) sg = Math.sign(c)
    else if (Math.sign(c) !== sg) return false
  }
  return true
}
/** прямокутник R, звужений зі сторін sides (як об'єкт { x0, y0, x1, y1 }): на плитку за кожну згадку сторони */
function insetRect2(R, sides) {
  const n = (s) => sides.filter((q) => q === s).length
  return { x0: R.x0 + n('W'), y0: R.y0 + n('S'), x1: R.x1 - n('E'), y1: R.y1 - n('N') }
}
/** аргументи L.rect(x0, x1, y0, y1) з прямокутника */
const flatX = (R) => [R.x0, R.x1, R.y0, R.y1]
/** прямокутник без кільця похилих стін (сторони sides — на плитку всередину за кожну згадку) */
function insetRect(R, sides) {
  const Q = insetRect2(R, sides)
  return rectPoly(Q.x0, Q.y0, Q.x1, Q.y1)
}

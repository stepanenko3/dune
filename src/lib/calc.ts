/**
 * Калькулятор виробництва: скільки сировини, крафтів, води й часу на набір цілей — по всьому дереву рецептів.
 * Цілі — предмети («T6RefinedResourceA» × 300), будівлі довідника (їхня вартість × кількість) або будівлі
 * з власною ціною (custom: напр. деталі й пристрої бази — ціна з кошторису, з правками і знижкою DD).
 *
 * Спільні проміжні предмети рахуються один раз (топологічний порядок), крафти — цілими (вгору), як у грі.
 * Рецепт з кількома виходами (переробка спайсу: меланж + залишки) — побічний вихід іде в запас і покриває потребу в
 * ньому, а не крафтиться вдруге тим самим рецептом (інакше фільтр Mk4 рахував подвійний пісок і час).
 * Указ тижня береться з головної (useDecree) і застосовується скрізь однаково — decreeFx():
 *   «Виробничий контракт CHOAM» — −25% входів і води за крафт, вгору (562,5 → 563), лише від тіру 4
 *   (у вікі — «не діє, коли базовий матеріал нижче тіру 4»; беремо тір предмета, що виходить);
 *   «Контракт на переробку CHOAM» — −75% часу на переробниках.
 * Вартість самої будівлі указ не знижує (будівництво він не здешевлює) — лише крафт її матеріалів.
 */
import type { CatalogIndex, CBuild, CRecipe } from '@/lib/catalog'
import type { DecreeId } from '@/lib/decree'

export interface Target {
  /** item — предмет; build — модуль довідника, id — рядок гри; custom — будівля з ціною cost */
  kind: 'item' | 'build' | 'custom'
  id: string
  qty: number
  /** custom: назва і ціна за штуку (предмети довідника) */
  name?: string
  cost?: [string, number][]
  /** категорія ліміту бази (prod, store, light, decor…) — для «Будівельних елементів» */
  cat?: string | null
  /** custom: іконка і відповідна будівля довідника («набір|елемент») — щоб пошук не пропонував її вдруге */
  icon?: string | null
  ref?: string
  /** custom без ref: запис довідника, який відкрити по кліку (пристрій чи предмет) */
  see?: ['item' | 'place', string]
  /** чи діє знижка Глибокої пустелі (будівництво −50%); за замовчуванням — для будівель (build і custom) */
  dd?: boolean
}
/** знижка на будівництво в Глибокій пустелі */
export const DD_FACTOR = 0.5
export interface Fx {
  production: boolean
  refining: boolean
}
export const decreeFx = (d: DecreeId | null): Fx => ({ production: d === 'production', refining: d === 'refining' })

/** скільки інгредієнта на один крафт з урахуванням указу */
export const inputQty = (q: number, outGrade: number, fx: Fx) => (fx.production && outGrade >= 4 ? Math.ceil(q * 0.75) : q)
/** вода на один крафт з указом — як і входи, цілими вгору (150 мл → 113, а не 112,5) */
export const waterQty = (w: number, outGrade: number, fx: Fx) => (fx.production && outGrade >= 4 ? Math.ceil(w * 0.75) : w)
/** ціна однієї будівлі в Глибокій пустелі: платиш за кожну окремо й цілими (37,5 → 38), тож округлюємо за штуку, а не від суми */
export const ddQty = (q: number, dd: boolean) => (dd ? Math.ceil(q * DD_FACTOR) : q)

export interface Step {
  item: string
  qty: number
  crafts: number
  recipe: CRecipe
  time: number
  water: number
  /** скільки чого йде на цей крок (з урахуванням указу) */
  inputs: [string, number][]
  /** побічні виходи рецепта (залишки спайсу при меланжі): скільки вийде разом із головним */
  by: [string, number][]
  /** етап у ланцюжку: 1 — із самої сировини, далі — з того, що зроблено на попередніх */
  depth: number
}
export interface CalcResult {
  /** що потрібно безпосередньо (цілі-предмети і вартість будівель), разом */
  direct: [string, number][]
  raw: [string, number][]
  steps: Step[]
  water: number
  /** побічне, що лишиться після всіх крафтів (вийшло більше, ніж треба) */
  spare: [string, number][]
}

/** цілі сторінки калькулятора в адресі: «i~T6RefinedResourceA~300.b~placeables%2Fore refineries|large_ore_refinery~2» */
export const encodeTargets = (ts: Target[]) =>
  ts.filter((t) => t.kind !== 'custom').map((t) => [t.kind === 'item' ? 'i' : 'b', encodeURIComponent(t.id), t.qty].join('~')).join('.')
export function decodeTargets(s: string | null): Target[] | null {
  if (!s) return null
  const out: Target[] = []
  for (const part of s.split('.')) {
    const [k, id, q] = part.split('~')
    const qty = Math.floor(Number(q))
    if ((k === 'i' || k === 'b') && id && qty > 0) out.push({ kind: k === 'i' ? 'item' : 'build', id: decodeURIComponent(id), qty: Math.min(qty, 100000) })
  }
  return out.length ? out : null
}

/** ключ модуля — id рядка гри (унікальний між наборами) */
export const buildKey = (b: CBuild) => b.id
export const findBuild = (ix: CatalogIndex, key: string) => ix.cat.buildables.find((b) => b.id === key)

/** найощадливіший рецепт: найменше входів на одиницю виходу, далі — найшвидший */
export function defaultRecipe(rs: CRecipe[], item: string): CRecipe {
  const cost = (r: CRecipe) => r.in.reduce((n, [, q]) => n + q, 0) / (r.out.find(([id]) => id === item)?.[1] || 1)
  return [...rs].sort((a, b) => cost(a) - cost(b) || (a.time ?? 0) - (b.time ?? 0))[0]
}

export function calc(ix: CatalogIndex, targets: Target[], fx: Fx, pick: Record<string, string> = {}, dd = false): CalcResult {
  // цілі → потреба в предметах: будівлі розгортаються у свою вартість (у Глибокій пустелі — зі знижкою)
  const direct = new Map<string, number>()
  for (const t of targets) {
    if (!(t.qty > 0)) continue
    if (t.kind === 'item') { direct.set(t.id, (direct.get(t.id) ?? 0) + t.qty); continue }
    const off = dd && t.dd !== false
    for (const [id, q] of (t.kind === 'custom' ? t.cost : findBuild(ix, t.id)?.cost) ?? []) direct.set(id, (direct.get(id) ?? 0) + ddQty(q, off) * t.qty)
  }
  // ціна з правками бази буває дробова — у грі платиш цілими
  for (const [id, q] of direct) direct.set(id, Math.ceil(q))

  const recipeOf = new Map<string, CRecipe | null>()
  const order: string[] = []
  const state = new Map<string, 1 | 2>() // 1 — у стеку (цикл → сировина), 2 — готово
  const visit = (id: string) => {
    if (state.get(id) === 2) return
    if (state.get(id) === 1) { recipeOf.set(id, null); return }
    state.set(id, 1)
    const rs = ix.makes.get(id) ?? []
    const r = rs.length ? rs.find((x) => x.id === pick[id]) ?? defaultRecipe(rs, id) : null
    if (!recipeOf.has(id)) recipeOf.set(id, r)
    if (recipeOf.get(id)) for (const [inp] of recipeOf.get(id)!.in) visit(inp)
    state.set(id, 2)
    order.push(id) // пост-порядок: інгредієнти раніше за те, що з них роблять
  }
  for (const id of direct.keys()) visit(id)

  const demand = new Map(direct)
  const steps: Step[] = []
  const raw = new Map<string, number>()
  /** побічне з уже порахованих крафтів: спершу береться звідси */
  const spare = new Map<string, number>()
  let water = 0
  for (const id of order.reverse()) {
    let need = demand.get(id) ?? 0
    const got = Math.min(need, spare.get(id) ?? 0)
    if (got > 0) { need -= got; spare.set(id, (spare.get(id) ?? 0) - got) }
    if (need <= 0) continue
    const r = recipeOf.get(id)
    if (!r) { raw.set(id, (raw.get(id) ?? 0) + need); continue }
    const per = r.out.find(([x]) => x === id)?.[1] || 1
    const crafts = Math.ceil(need / per)
    const grade = ix.item.get(id)?.grade ?? 0
    const inputs: [string, number][] = r.in.map(([inp, q]) => [inp, crafts * inputQty(q, grade, fx)])
    for (const [inp, q] of inputs) demand.set(inp, (demand.get(inp) ?? 0) + q)
    // решта виходів рецепта — у запас: потребу в них покриє цей самий крафт
    const by: [string, number][] = r.out.filter(([x]) => x !== id).map(([x, q]) => [x, crafts * q])
    for (const [x, q] of by) spare.set(x, (spare.get(x) ?? 0) + q)
    const refinery = /refiner/i.test(ix.place.get(r.at[0])?.cat ?? '')
    const time = (r.time ?? 0) * crafts * (fx.refining && refinery ? 0.25 : 1)
    const w = waterQty(r.water ?? 0, grade, fx) * crafts
    water += w
    steps.push({ item: id, qty: crafts * per, crafts, recipe: r, time, water: w, inputs, by, depth: 0 })
  }
  // етапи: сировина — 0, крок — на 1 глибше за найглибший свій вхід; від сировини до фіналу
  const depthOf = new Map<string, number>()
  const dep = (id: string): number => {
    if (depthOf.has(id)) return depthOf.get(id)!
    const s = steps.find((x) => x.item === id)
    depthOf.set(id, 0) // захист від циклу
    const d = s ? 1 + Math.max(0, ...s.inputs.map(([i]) => dep(i))) : 0
    depthOf.set(id, d)
    return d
  }
  for (const s of steps) s.depth = dep(s.item)
  steps.sort((a, b) => a.depth - b.depth)
  return {
    direct: [...direct.entries()],
    raw: [...raw.entries()].sort((a, b) => b[1] - a[1]),
    steps,
    water,
    spare: [...spare.entries()].filter(([, q]) => q > 0),
  }
}

// ---------- станції різного розміру ----------
/**
 * Той самий предмет на станціях різного розміру — окремі рецепти: на більшій менше сировини й швидше (залізний
 * злиток: мала — 5 руди за 10 с, середня — 4 за 7, велика — 3 за 5). Розмір — з назви станції: малі — 1,
 * середні — 2, великі — 3; інші (фабрикатори) — 0, вони на вибір не впливають.
 */
export function stationTier(ix: CatalogIndex, placeId: string | undefined): number {
  const n = (ix.place.get(placeId ?? '')?.name ?? placeId ?? '').toLowerCase()
  // «Spice Refinery» без розміру — найменший переробник спайсу (є ще Medium і Large)
  return /^small\b/.test(n) || n === 'spice refinery' ? 1 : /^medium\b/.test(n) ? 2 : /^large\b/.test(n) ? 3 : 0
}
/** родина станції — назва без розміру: «Large Ore Refinery» → «Ore Refinery» (мала, середня й велика — одна родина) */
export const familyOf = (ix: CatalogIndex, placeId: string | undefined) => (ix.place.get(placeId ?? '')?.name ?? placeId ?? '').replace(/^(small|medium|large)\s+/i, '')

/**
 * Усі станції гри того самого виду — той самий розділ довідника (cat): малий, середній і великий переробник руди;
 * фабрикатор виживання й розширений. Лише ті, на яких щось крафтиться. Для «Показати всі» на кроці «Станції»
 */
export function kinOf(ix: CatalogIndex, placeId: string): string[] {
  const cat = ix.place.get(placeId)?.cat
  if (!cat) return [placeId]
  return [...ix.place].filter(([id, p]) => p.cat === cat && ix.craftsAt.has(id)).map(([id]) => id)
}

/**
 * Вибір станцій за родинами (переробник руди — великий, хімічний — середній…) → рецепти: для кожного предмета з
 * кількома рецептами — рецепт станції вибраного розміру в його родині; такого нема — найближчого (при рівності —
 * більшого). Родина без вибору — найбільша станція
 */
export function pickStations(ix: CatalogIndex, items: Iterable<string>, choice: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of items) {
    const rs = ix.makes.get(id) ?? []
    if (rs.length < 2) continue
    const tiers = rs.map((r) => stationTier(ix, r.at[0]))
    if (!tiers.some(Boolean)) continue // лише фабрикатори — лишається найощадливіший рецепт (defaultRecipe)
    const fam = familyOf(ix, rs.find((r) => stationTier(ix, r.at[0]))?.at[0])
    const T = choice[fam] ?? Math.max(...tiers)
    const best = [...rs].sort((a, b) => {
      const ta = stationTier(ix, a.at[0]), tb = stationTier(ix, b.at[0])
      return Math.abs(ta - T) - Math.abs(tb - T) || tb - ta
    })[0]
    out[id] = best.id
  }
  return out
}

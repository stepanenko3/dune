/**
 * Налаштування мапи: яка мапа, які типи точок увімкнено (окремо для кожної мапи), розкладка
 * Глибокої пустелі, позначки «зібрано». Особисте — у prefs; адреса /map?m=…&w=…&l=…&r=…&marker=…&pt=… переносить вид
 * (посилання з роадмапу, поділитися з другом). Мапа (m) і розкладка (w) — кроки історії («назад» повертає попередню
 * мапу, useUrlParam у MapPage); вибране й шари — без нових кроків (writeUrl).
 */
import { prefGet, prefSet } from '@/lib/prefs'
import type { GroupDef } from './data'

/** Що видно на свіжій мапі: місця і люди, без густих шарів руди, рослин і луту. */
const DEFAULT_ON = new Set([
  'cave', 'shipwreck', 'enemyoutpost', 'tradingpost', 'sietch', 'ecolab', 'explorationpointofinterest',
  'enemylaboroutpost', 'atreides', 'harkonnen', 'taxiservice', 'bank', 'landsraad_control_point', 'secret_door',
  'trainerstrooper', 'trainersplanetologist', 'trainersbenegesserit', 'trainersmentat', 'trainersswordmaster',
  'vehiclevendor', 'structurevendor', 'spicevendor', 'survivalvendor', 'resourcevendor', 'barkeepvendor', 'weaponsvendor', 'landsraadvendor',
])

/** Групи, вимкнені на свіжій мапі будь-якого розміру: «Підбирання з землі» (TH.GL) і «Підбирання руками» (файли гри) — дрібниця, що лише засмічує мапу. */
const OFF_BY_DEFAULT = new Set(['resources_pickup', 'hand'])

/**
 * Типові шари: на великих мапах (Хагга, Глибока пустеля) — місця й люди, без густих шарів; на малих
 * (міста, підземелля, печери) точок небагато — показуємо все відразу (крім OFF_BY_DEFAULT).
 */
export const defaultOn = (groups: GroupDef[], small = false) => {
  const all = groups.filter((g) => !OFF_BY_DEFAULT.has(g.id)).flatMap((g) => g.types)
  return (small ? all : all.filter((t) => t.on ?? DEFAULT_ON.has(t.id))).map((t) => t.id)
}

/**
 * Шари з адреси чи збереженого вибору — лише ті типи, що є в даних мапи. Мапа могла перейти на інше джерело (TH.GL →
 * файли гри) з іншими id типів: тоді жодного відомого — null (типові шари, а не порожня мапа). Порожній вибір (людина
 * сама все вимкнула) лишається порожнім.
 */
export function knownLayers(list: string[], groups: GroupDef[]): string[] | null {
  if (!list.length) return []
  const ids = new Set(groups.flatMap((g) => g.types.map((t) => t.id)))
  const ok = list.filter((x) => ids.has(x))
  return ok.length ? ok : null
}

// вибір шарів малих мап — окремим ключем: давні збережені вибори не перекривають «усе відразу»
const onKey = (small: boolean) => (small ? 'map:onSmall' : 'map:on')
export function enabledFor(map: string, groups: GroupDef[], small = false): string[] {
  dropOldPickups(groups)
  const saved = prefGet<Record<string, string[]>>(onKey(small), {})[map]
  return (saved && knownLayers(saved, groups)) ?? defaultOn(groups, small)
}
/**
 * Раз: «Підбирання з землі» в збереженому виборі малих мап — спадок давнього «усе відразу», а не вибір людини (тоді
 * там усі типи групи разом; сама людина вмикає лише ті, що є на мапі) — прибираємо. Увімкнене самою — лишається.
 */
function dropOldPickups(groups: GroupDef[]) {
  if (prefGet('map:pickupsOff', false)) return
  const pick = groups.filter((g) => OFF_BY_DEFAULT.has(g.id)).flatMap((g) => g.types.map((t) => t.id))
  if (!pick.length) return
  const all = prefGet<Record<string, string[]>>(onKey(true), {})
  const next = Object.fromEntries(Object.entries(all).map(([m, l]) => [m, pick.every((id) => l.includes(id)) ? l.filter((id) => !pick.includes(id)) : l]))
  prefSet(onKey(true), next)
  prefSet('map:pickupsOff', true)
}
export function saveEnabled(map: string, types: string[], small = false) {
  prefSet(onKey(small), { ...prefGet<Record<string, string[]>>(onKey(small), {}), [map]: types })
}

/**
 * Порядок груп шарів (поля меланжу — окремим блоком над ними): локації, ресурси, рослини, лут, підбирання руками, ключі;
 * решта (NPC, інше) — далі у своєму порядку. TH.GL: locations і resources — так само на початку.
 */
const RANK: [RegExp, number][] = [[/^locations$|Map_Legend_Category_Location$/, 1], [/^(cutteray|resources)$/, 2], [/^plants$/, 3], [/^loot$/, 4], [/^hand$/, 5], [/^keys$/, 6]]
const rankOf = (id: string) => RANK.find(([re]) => re.test(id))?.[1] ?? 7
export const orderGroups = <G extends { id: string }>(groups: G[]) => groups.map((g, i) => [g, i] as const).sort((a, b) => rankOf(a[0].id) - rankOf(b[0].id) || a[1] - b[1]).map(([g]) => g)

/**
 * «Де найкраще» — лише там, де точок багато й вони розкидані: руда, рослини, лут, підбирання. Локаціям, ключам, NPC,
 * торговцям шукати «найкраще місце» нема сенсу, як і типу з кількома точками
 */
const FINDABLE = /^(cutteray|resources|resources_pickup|plants|loot|hand)$/
export const FIND_MIN = 10
export const findable = (group: string, count: number) => FINDABLE.test(group) && count >= FIND_MIN

/** скільки місць типу з шансом руди від min % — з розподілу часток кроками 5 % (зведення мапи); min 0 — усі */
export const countFromShare = (hist: number[], min: number) => hist.slice(Math.floor(min / 5)).reduce((a, b) => a + b, 0)

/**
 * непрозорість точки руди за шансом руди в місці, %: чисті острівці (уся руда одна, 100 %) — повні, пояс титан/стравідій
 * (50 %) — блідіші, змішані острівці (руда з 4–6 можливих, ~10–25 %) — бліді: на мапі одразу видно, де руда напевно
 */
export const shareAlpha = (p: number) => 0.3 + 0.7 * Math.min(1, Math.max(0, p) / 100)

export interface UrlState {
  m?: string
  l?: string[]
  r?: string
  w?: number
  /** предмет із довідника: підсвітити скрині, у луті яких він є */
  loot?: string
  /** вибрана позначка */
  marker?: string
  /** точка гри за стабільним ключем, «тип.ключ» (npc_unaffiliated.weapon_vendor — торговець указу Ландсрааду) */
  pt?: string
  /** просто точка (x, y) — з події: місце бою, зона для глядачів */
  at?: [number, number]
}
export function readUrl(): UrlState {
  const p = new URLSearchParams(location.search)
  const out: UrlState = {}
  const m = p.get('m')
  if (m && /^[a-z0-9_]+$/.test(m)) out.m = m
  const l = p.get('l')
  // id типів: TH.GL — snake_case, файли гри — CamelCase (Cave, TitaniumOre)
  if (l) out.l = l.split(',').filter((x) => /^[A-Za-z0-9_]+$/.test(x))
  const r = p.get('r')
  if (r && /^[\w-]{1,40}$/.test(r)) out.r = r
  const w = p.get('w')
  if (w && /^\d{1,2}$/.test(w)) out.w = Number(w)
  const loot = p.get('loot')
  if (loot && loot.length <= 120) out.loot = loot
  const marker = p.get('marker')
  if (marker && /^[\w-]{1,64}$/.test(marker)) out.marker = marker
  const pt = p.get('pt')
  if (pt && /^[a-z0-9_]{1,64}\.[a-z0-9_]{1,64}$/.test(pt)) out.pt = pt
  const at = /^(-?\d{1,8}),(-?\d{1,8})$/.exec(p.get('at') || '')
  if (at) out.at = [Number(at[1]), Number(at[2])]
  return out
}
/** мапа: id з адреси — лише такий, як у TH.GL */
export const okMap = (v: string) => /^[a-z0-9_]{1,64}$/.test(v)
/** розкладка Глибокої пустелі з адреси: номер */
export const okWeek = (v: string) => /^\d{1,2}$/.test(v)

/** адреса мапи з кількома зміненими параметрами (null — прибрати); решта лишається як є */
export function mapUrl(changes: Record<string, string | null | undefined>) {
  const p = new URLSearchParams(location.search)
  for (const [k, v] of Object.entries(changes)) {
    if (v == null || v === '') p.delete(k)
    else p.set(k, v)
  }
  const q = p.toString().replace(/%2C/g, ',')
  return '/map' + (q ? '?' + q : '')
}

/**
 * Вибране (запис, позначка, точка гри), шари й лут — в адресу без нового кроку історії. Мапу, розкладку й вкладки панелі пишуть
 * їхні useUrlParam — їх тут не чіпаємо.
 */
export function writeUrl(s: Pick<UrlState, 'r' | 'l' | 'loot' | 'marker' | 'pt'>) {
  if (!location.pathname.startsWith('/map')) return
  const url = mapUrl({ r: s.r, l: s.l?.join(','), loot: s.loot, marker: s.marker, pt: s.pt })
  if (url !== location.pathname + location.search) history.replaceState(history.state, '', url)
}

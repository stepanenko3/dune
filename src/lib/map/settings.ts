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

/** Групи, вимкнені на свіжій мапі будь-якого розміру: «Підбирання з землі» — дрібниця, що лише засмічує мапу. */
const OFF_BY_DEFAULT = new Set(['resources_pickup'])

/**
 * Типові шари: на великих мапах (Хагга, Глибока пустеля) — місця й люди, без густих шарів; на малих
 * (міста, підземелля, печери) точок небагато — показуємо все відразу (крім OFF_BY_DEFAULT).
 */
export const defaultOn = (groups: GroupDef[], small = false) => {
  const all = groups.filter((g) => !OFF_BY_DEFAULT.has(g.id)).flatMap((g) => g.types)
  return (small ? all : all.filter((t) => t.on ?? DEFAULT_ON.has(t.id))).map((t) => t.id)
}

// вибір шарів малих мап — окремим ключем: давні збережені вибори не перекривають «усе відразу»
const onKey = (small: boolean) => (small ? 'map:onSmall' : 'map:on')
export function enabledFor(map: string, groups: GroupDef[], small = false): string[] {
  dropOldPickups(groups)
  const all = prefGet<Record<string, string[]>>(onKey(small), {})
  return all[map] ?? defaultOn(groups, small)
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

/** Ключ позначок «зібрано»: у Deep Desert — окремо на кожну розкладку тижня. */
export const doneKey = (map: string, layout: number | null) => (layout == null ? map : `${map}#${layout}`)
export const pointKey = (x: number, y: number) => `${x},${y}`

export function loadDone(key: string): Record<string, string[]> {
  return prefGet<Record<string, Record<string, string[]>>>('map:done', {})[key] ?? {}
}
export function saveDone(key: string, v: Record<string, string[]>) {
  prefSet('map:done', { ...prefGet<Record<string, Record<string, string[]>>>('map:done', {}), [key]: v })
}

/**
 * Коли вузол руди позначили «зібрано» — «тип|x,y» → мс. За цим часом рахується відновлення:
 * мине respawnMin() хвилин — позначка знімається сама. Старі позначки без часу — назавжди, як і були.
 */
export function loadDoneAt(key: string): Record<string, number> {
  return prefGet<Record<string, Record<string, number>>>('map:doneAt', {})[key] ?? {}
}
export function saveDoneAt(key: string, v: Record<string, number>) {
  prefSet('map:doneAt', { ...prefGet<Record<string, Record<string, number>>>('map:doneAt', {}), [key]: v })
}
/** скільки хвилин відновлюється вузол (у PvE Глибокої пустелі — 45) */
export const respawnMin = () => prefGet<number>('map:respawn', 45)
export const setRespawnMin = (m: number) => prefSet('map:respawn', m)

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
  if (l) out.l = l.split(',').filter((x) => /^[a-z0-9_]+$/.test(x))
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

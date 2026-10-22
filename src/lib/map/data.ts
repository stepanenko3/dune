/**
 * Дані мапи з нашого API (server/routes/map.mjs), яке кешує TH.GL:
 *   • source — мапи, тайли, групи й типи точок, розкладки Deep Desert;
 *   • index  — скільки точок кожного типу на мапі + усі іменовані місця (для пошуку);
 *   • points — точки одного типу, вантажаться лише коли тип увімкнули;
 *   • loot   — контейнери, у луті яких є предмет.
 * Назви й опис луту сервер віддає мовою сайту (як у грі): ?lang= у кожному запиті.
 */
import { currentLang, t } from '../i18n'

export type Box = [[number, number], [number, number]]

export interface MapDef {
  id: string
  title: string
  tiles: string
  minNativeZoom: number
  maxNativeZoom: number
  tileSize: number
  bounds: Box
  transformation: [number, number, number, number]
  nodes: string | null
  /** поточна розкладка Deep Desert (буря перебудовує мапу щотижня) */
  layout: number | null
  layouts: { id: number; tiles: string; nodes: string; dicts: string; resources: boolean }[]
}

export interface TypeDef {
  id: string
  /** x, y, w, h у спрайті icons.webp */
  icon: [number, number, number, number] | null
  size: number
  /** видно на свіжій мапі (дані з файлів гри: місця — так, лут і ключі — ні); нема — наш список для TH.GL */
  on?: boolean
}
export interface GroupDef {
  id: string
  defaultOn: boolean
  types: TypeDef[]
}

export interface Source {
  syncedAt: string
  maps: MapDef[]
  groups: GroupDef[]
  /** спрайт іконок цих даних (файли гри — з ?v=); нема — /api/map/icons.webp (TH.GL) */
  sprite?: string
}

export interface SourceResp {
  source: Source
  /** loc — мовою сайту (як у грі), en — англійською */
  labels: Record<string, { loc: string | null; en: string | null }>
  ddHistory: { layout: number; seenAt: string }[]
}

/** [тип, індекс, назва мовою сайту, назва англ., x, y] */
export type Named = [string, number, string, string | null, number, number]
export interface MapIndex {
  map: string
  layout: number | null
  counts: Record<string, number>
  named: Named[]
  /** межі всіх точок [[xmin, ymin], [xmax, ymax]] — для центрування міст і підземель */
  bbox: Box | null
}

/** точки одного типу: pts — плоский масив x, y, z; info[i] = [назва, лут/опис — мовою сайту, назва англ.] */
export interface TypePoints {
  pts: number[]
  info: Record<string, [string | null, string | null, string | null]>
}

export interface LootHit {
  type: string
  i: number
  x: number
  y: number
  name: string | null
  item: string
  chance: number | null
}
/** локація (печера, аванпост…), де лежать контейнери з предметом */
export interface LootPlace {
  type: string
  i: number
  x: number
  y: number
  name: string | null
  best: number
  n: number
}
export interface Loot {
  hits: LootHit[]
  places: LootPlace[]
}

/** «що тут є» для локації: лут контейнерів поблизу і руда / рослини довкола */
export interface LocSummary {
  boxes: number
  /** [предмет, найбільший шанс %, у скількох контейнерах] */
  loot: [string, number, number][]
  /** [тип ресурсу, скільки вузлів] */
  res: [string, number][]
}
export type Summaries = Record<string, Record<string, LocSummary>>

const json = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json() as Promise<T>
}

/** Параметри запиту: розкладка Deep Desert і мова сайту (від неї залежать назви й опис луту). */
const q = (layout: number | null, extra = '') => `?${layout == null ? '' : `layout=${layout}&`}${extra}lang=${encodeURIComponent(currentLang())}`

/** точка гри: тип, номер у шарі, координати */
export type Spot = { type: string; i: number; x: number; y: number }
/** точка гри за стабільним ключем — id TH.GL без координат (`weapon_vendor`) у типі точок `type`; немає такої — null */
export async function loadSpot(map: string, layout: number | null, type: string, key: string): Promise<Spot | null> {
  const r = await fetch(`/api/map/spot/${map}/${type}/${key}${q(layout)}`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`${r.status} /api/map/spot`)
  return r.json() as Promise<Spot>
}

let sourceP: Promise<SourceResp> | null = null
export const loadSource = () => (sourceP ||= json<SourceResp>(`/api/map/source${q(null)}`).catch((e) => { sourceP = null; throw e }))
/** розкладка Глибокої пустелі в описі мап (змінюється після бурі) */
const ddLayout = (s: SourceResp) => s.source.maps.find((m) => m.id === 'deepdesert_1')?.layout ?? null
/**
 * Перечитати опис мап (після бурі виходить нова розкладка Глибокої пустелі): якщо він змінився — скинути кеші точок,
 * зведень і луту, щоб відкрита мапа показала нове без перезавантаження сторінки. Повертає свіжий опис і чи він інший.
 */
export async function reloadSource(): Promise<{ resp: SourceResp; changed: boolean }> {
  const old = sourceP ? await sourceP.catch(() => null) : null
  const fresh = await json<SourceResp>(`/api/map/source${q(null)}`)
  const changed = !old || ddLayout(old) !== ddLayout(fresh) || old.source.syncedAt !== fresh.source.syncedAt
  sourceP = Promise.resolve(fresh)
  if (changed) { indexCache.clear(); ptsCache.clear(); lootCache.clear(); sumCache.clear() }
  return { resp: fresh, changed }
}

/**
 * Кеші точок, зведень і луту — лише для трьох останніх мап (розкладок): точок Хагги — сотні тисяч, і після кількох
 * печер та давніх розкладок пустелі вкладка тримала б у пам'яті все побачене.
 */
const recent: string[] = []
function touchMap(map: string, layout: number | null) {
  const k = `${map}|${layout}|`
  const i = recent.indexOf(k)
  if (i >= 0) recent.splice(i, 1)
  recent.push(k)
  while (recent.length > 3) {
    const old = recent.shift()!
    for (const c of [indexCache, ptsCache, lootCache, sumCache] as Map<string, unknown>[]) for (const key of [...c.keys()]) if (key.startsWith(old)) c.delete(key)
  }
}

const indexCache = new Map<string, Promise<MapIndex>>()
export function loadIndex(map: string, layout: number | null) {
  touchMap(map, layout)
  const k = `${map}|${layout}|`
  if (!indexCache.has(k)) indexCache.set(k, json<MapIndex>(`/api/map/index/${map}${q(layout)}`).catch((e) => { indexCache.delete(k); throw e }))
  return indexCache.get(k)!
}

const ptsCache = new Map<string, Promise<TypePoints>>()
export function loadPoints(map: string, layout: number | null, type: string) {
  touchMap(map, layout)
  const k = `${map}|${layout}|${type}`
  if (!ptsCache.has(k)) ptsCache.set(k, json<TypePoints>(`/api/map/points/${map}/${type}${q(layout)}`).catch((e) => { ptsCache.delete(k); throw e }))
  return ptsCache.get(k)!
}

const lootCache = new Map<string, Promise<Loot>>()
export function loadLoot(map: string, layout: number | null, query: string) {
  touchMap(map, layout)
  const k = `${map}|${layout}|${query.toLowerCase()}`
  if (!lootCache.has(k)) {
    lootCache.set(k, json<Loot>(`/api/map/loot/${map}${q(layout, `q=${encodeURIComponent(query)}&`)}`).catch((e) => { lootCache.delete(k); throw e }))
  }
  return lootCache.get(k)!
}

const sumCache = new Map<string, Promise<Summaries>>()
export function loadSummary(map: string, layout: number | null) {
  touchMap(map, layout)
  const k = `${map}|${layout}|`
  if (!sumCache.has(k)) sumCache.set(k, json<Summaries>(`/api/map/summary/${map}${q(layout)}`).catch((e) => { sumCache.delete(k); throw e }))
  return sumCache.get(k)!
}

/** Наші переклади там, де TH.GL українською не має (або має не так, як кажуть у грі) — лише для української. */
const UK: Record<string, string> = {
  secret_door: 'Таємні двері',
  items: 'Предмети й лут',
  primitive: 'Примітивна скриня',
  basic: 'Звичайна скриня',
  rare: 'Рідкісна скриня',
  small_ultra_rare: 'Мала дуже рідкісна скриня',
  ultra_rare: 'Дуже рідкісна скриня',
  water_tank: 'Цистерна з водою',
  medical: 'Аптечка',
  wreck: 'Уламки (розбирати різаком)',
  refinery: 'Скриня переробника',
  npc_unaffiliated: 'Незалежні',
  npc_smugglers: 'Контрабандисти',
  resources_pickup: 'Підбирання з землі',
  resources: 'Ресурси',
  house_representatives: 'Представники Домів',
  trainers: 'Тренери',
  vendors: 'Торговці',
  vehicles: 'Техніка',
  locations: 'Локації',
  npcs: 'NPC',
  pentashield_keys: 'Ключі пентащитів (ID-стрічки)',
  // групи мапи з файлів гри, яких нема в легенді гри
  loot: 'Лут',
  keys: 'Ключі пентащитів (ID-стрічки)',
  discoverable: 'Відкриття',
  // у TH.GL без назви Дому — лише «House Representative»
  house_representativesalexin: 'Представник Дому Алексін',
  house_representativesspinette: 'Представник Дому Спінетт',
}

/**
 * Різні типи, які гра (і TH.GL) називає однаково — «Уламок корабля» двічі, «Ворожий аванпост» двічі, «Дослідження»
 * двічі: до назви — уточнення, лише коли назви справді збігаються.
 */
const CLARIFY: Record<string, { twin: string; note: () => string }> = {
  small_shipwreck: { twin: 'shipwreck', note: () => t('малий') },
  enemylaboroutpost: { twin: 'enemyoutpost', note: () => t('табір робітників') },
  exploration: { twin: 'explorationpointofinterest', note: () => t('мале') },
}

const baseLabel = (labels: SourceResp['labels'], id: string): string => {
  const own = currentLang() === 'uk' ? UK[id] : null
  if (own) return own
  // представник Дому без назви Дому — назва з id («house_representativesalexin» → «Alexin»)
  const house = /^house_representatives(\w+)$/.exec(id)?.[1]
  if (house && /^house representatives?$/i.test(labels[id]?.loc || labels[id]?.en || '')) return t('Представник Дому {name}', { name: house[0].toUpperCase() + house.slice(1) })
  const l = labels[id]?.loc || labels[id]?.en
  if (l) return l
  // назви взагалі нема (новий тип TH.GL чи id гри) — хоч би читабельно: «Treasure loot container», «Basic Container»
  const h = id.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  return h.charAt(0).toUpperCase() + h.slice(1)
}

/** Підпис мовою сайту (як у грі, із TH.GL), далі англійський; однакові назви різних типів — з уточненням. */
export const labelOf = (labels: SourceResp['labels'], id: string) => {
  const l = baseLabel(labels, id)
  const c = CLARIFY[id]
  return c && baseLabel(labels, c.twin) === l ? `${l} (${c.note()})` : l
}

/** Наші короткі українські назви мап для вкладок; іншими мовами — назви гри з TH.GL (labelOf). */
const MAP_SHORT: Record<string, string> = {
  survival_1: 'Хагга',
  deepdesert_1: 'Глибока пустеля',
  sh_arrakeen: 'Арракін',
  sh_harkovillage: 'Харко',
}
/** Коротка назва мапи для вкладки, підказки в списках і підписів: українською — наша, іншими мовами — з гри. */
export const mapName = (labels: SourceResp['labels'], id: string) => (currentLang() === 'uk' ? MAP_SHORT[id] : null) || labelOf(labels, id)
/** порядок вкладок; «Карта поверхні» (overmap) у TH.GL має порожні тайли — не показуємо */
export const MAP_ORDER = ['survival_1', 'deepdesert_1', 'sh_arrakeen', 'sh_harkovillage']
export const HIDDEN_MAPS = new Set(['overmap'])
/** великі відкриті мапи центруються за межами тайлів, міста й підземелля — за точками */
export const OPEN_MAPS = new Set(['survival_1', 'deepdesert_1'])

/** Зона запису «Ресурсів» → мапа, на якій його показувати, навіть якщо точок ще немає. */
export const ZONE_MAPS: Record<string, string[]> = {
  hagga: ['survival_1'],
  dd: ['deepdesert_1'],
  city: ['sh_arrakeen', 'sh_harkovillage'],
}

/** Опис точки з TH.GL — HTML лише з <b> і <br>; усе інше екрануємо. */
export function safeDesc(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
    .replace(/&lt;(\/?)b&gt;/gi, '<$1b>')
}

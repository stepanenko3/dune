/**
 * Дані мапи з нашого API (server/routes/map.mjs), яке кешує TH.GL:
 *   • source — мапи, тайли, групи й типи точок, розкладки Deep Desert;
 *   • index  — скільки точок кожного типу на мапі + усі іменовані місця (для пошуку);
 *   • points — точки одного типу, вантажаться лише коли тип увімкнули;
 *   • loot   — контейнери, у луті яких є предмет.
 */

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
}

export interface SourceResp {
  source: Source
  labels: Record<string, { uk: string | null; en: string | null }>
  ddHistory: { layout: number; seenAt: string }[]
}

/** [тип, індекс, назва, назва англ., x, y] */
export type Named = [string, number, string, string | null, number, number]
export interface MapIndex {
  map: string
  layout: number | null
  counts: Record<string, number>
  named: Named[]
}

/** точки одного типу: pts — плоский масив x, y, z; info[i] = [назва, лут/опис, назва англ.] */
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

const json = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json() as Promise<T>
}

const q = (layout: number | null) => (layout == null ? '' : `?layout=${layout}`)

let sourceP: Promise<SourceResp> | null = null
export const loadSource = () => (sourceP ||= json<SourceResp>('/api/map/source').catch((e) => { sourceP = null; throw e }))

const indexCache = new Map<string, Promise<MapIndex>>()
export function loadIndex(map: string, layout: number | null) {
  const k = `${map}|${layout}`
  if (!indexCache.has(k)) indexCache.set(k, json<MapIndex>(`/api/map/index/${map}${q(layout)}`).catch((e) => { indexCache.delete(k); throw e }))
  return indexCache.get(k)!
}

const ptsCache = new Map<string, Promise<TypePoints>>()
export function loadPoints(map: string, layout: number | null, type: string) {
  const k = `${map}|${layout}|${type}`
  if (!ptsCache.has(k)) ptsCache.set(k, json<TypePoints>(`/api/map/points/${map}/${type}${q(layout)}`).catch((e) => { ptsCache.delete(k); throw e }))
  return ptsCache.get(k)!
}

const lootCache = new Map<string, Promise<LootHit[]>>()
export function loadLoot(map: string, layout: number | null, query: string) {
  const k = `${map}|${layout}|${query.toLowerCase()}`
  if (!lootCache.has(k)) {
    const sep = layout == null ? '?' : '&'
    lootCache.set(k, json<{ hits: LootHit[] }>(`/api/map/loot/${map}${q(layout)}${sep}q=${encodeURIComponent(query)}`).then((r) => r.hits).catch((e) => { lootCache.delete(k); throw e }))
  }
  return lootCache.get(k)!
}

/** Наші переклади там, де TH.GL українською не має (або має не так, як кажуть у грі). */
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
  pentashield_keys: 'Ключі пентащитів (ID-стрічки)',
  discoverable: 'Відкриття',
}

/** Підпис: наш переклад, далі українська TH.GL, англійська, сам ключ. */
export const labelOf = (labels: SourceResp['labels'], id: string) =>
  UK[id] || (labels[id]?.uk !== labels[id]?.en ? labels[id]?.uk : null) || labels[id]?.uk || labels[id]?.en || id.replace(/_/g, ' ')

/** Наші короткі назви мап для вкладок; решта — з TH.GL. */
export const MAP_SHORT: Record<string, string> = {
  survival_1: 'Хагга',
  deepdesert_1: 'Глибока пустеля',
  sh_arrakeen: 'Арракін',
  sh_harkovillage: 'Харко',
}
export const MAIN_MAPS = ['survival_1', 'deepdesert_1', 'sh_arrakeen', 'sh_harkovillage']

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

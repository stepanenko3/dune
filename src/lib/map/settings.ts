/**
 * Налаштування мапи: яка мапа, які типи точок увімкнено (окремо для кожної мапи), тиждень
 * Deep Desert, позначки «зібрано». Особисте — у prefs; адреса /map?m=…&l=…&r=…&w=… лише
 * переносить вид (посилання з «Плану розвитку», поділитися з другом).
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

export const defaultOn = (groups: GroupDef[]) => groups.flatMap((g) => g.types.map((t) => t.id)).filter((id) => DEFAULT_ON.has(id))

export function enabledFor(map: string, groups: GroupDef[]): string[] {
  const all = prefGet<Record<string, string[]>>('map:on', {})
  return all[map] ?? defaultOn(groups)
}
export function saveEnabled(map: string, types: string[]) {
  prefSet('map:on', { ...prefGet<Record<string, string[]>>('map:on', {}), [map]: types })
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

export interface UrlState {
  m?: string
  l?: string[]
  r?: string
  w?: number
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
  return out
}
export function writeUrl(s: UrlState) {
  if (!location.pathname.startsWith('/map')) return
  const p = new URLSearchParams()
  if (s.m) p.set('m', s.m)
  if (s.w != null) p.set('w', String(s.w))
  if (s.r) p.set('r', s.r)
  if (s.l) p.set('l', s.l.join(','))
  const q = p.toString().replace(/%2C/g, ',')
  history.replaceState(null, '', '/map' + (q ? '?' + q : ''))
}

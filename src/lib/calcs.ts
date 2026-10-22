/**
 * Збережені розрахунки калькулятора (річ виду 'calc' у реєстрі речей): цілі — той самий код, що в адресі (?t=…),
 * вибрані рецепти (picks: предмет → рецепт), прапорець «Глибока пустеля», назва, нотатки й коротко про розрахунок.
 * Станції в калькуляторі вибирають за родинами (переробник руди — великий…), а зберігаємо рецепти — тож тут і
 * дорога назад: з рецептів — вибір станцій (stationsOf). Указ (decree) — той, з яким рахували: у кого інший указ
 * тижня, побачить ті самі числа. Опис — українською (calcAbout), показуємо мовою сайту (calcAboutText).
 */
import { del, get, post, put } from './api'
import { decodeTargets, encodeTargets, familyOf, pickStations, stationTier, type CalcResult, type Target } from './calc'
import type { CatalogIndex } from './catalog'
import type { DecreeId } from './decree'
import { locale, t } from './i18n'
import type { Item, Owner, Visibility } from './items'

export interface SavedCalc {
  id: string
  name: string
  code: string
  picks: Record<string, string>
  dd: boolean
  /** указ, з яким рахували; нема поля — давній розрахунок, рахується з поточним */
  decree?: DecreeId | null
  notes: string
  about: string
  created: number
  updated: number
  item: Item
}
export type CalcDoc = Pick<SavedCalc, 'name' | 'code' | 'picks' | 'dd' | 'decree' | 'notes' | 'about'>

export const getCalc = (id: string) => get<SavedCalc>(`/api/calcs/${encodeURIComponent(id)}`)
export const createCalc = (doc: CalcDoc, owner: Pick<Owner, 'kind' | 'id'>, visibility: Visibility) => post<SavedCalc>('/api/calcs', { ...doc, owner, visibility })
export const updateCalc = (id: string, doc: Partial<CalcDoc>) => put<SavedCalc>(`/api/calcs/${encodeURIComponent(id)}`, doc)
export const deleteCalc = (id: string) => del<{ ok: true }>(`/api/calcs/${encodeURIComponent(id)}`)
/** мої й гільдійські (рядки реєстру — без самих розрахунків) */
export const myCalcs = () => get<{ rows: Item[] }>('/api/items?kind=calc&scope=shared').then((r) => r.rows)

/** сервер бере до 300 рецептів */
const MAX_PICKS = 300

/** вибрані рецепти розрахунку: лише предмети ланцюжка, де рецептів кілька (де один — вибору нема) */
export function picksOf(ix: CatalogIndex, res: CalcResult): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of res.steps) {
    if ((ix.makes.get(s.item)?.length ?? 0) < 2) continue
    out[s.item] = s.recipe.id
    if (Object.keys(out).length >= MAX_PICKS) break
  }
  return out
}

/**
 * Що в збереженому розрахунку вже не з цього довідника (гру оновили): цілі, яких нема, і рецепти, яких нема.
 * Їх не показуємо — і не рахуємо «незбереженою зміною» (fresh — збережене без них, для порівняння)
 */
export function staleOf(ix: CatalogIndex, c: Pick<SavedCalc, 'code' | 'picks'>) {
  const all = decodeTargets(c.code) ?? []
  const has = (x: Target) => (x.kind === 'item' ? ix.item.has(x.id) : ix.cat.buildables.some((b) => b.id === x.id))
  const picks: Record<string, string> = {}
  let recipes = 0
  for (const [k, v] of Object.entries(c.picks ?? {})) {
    if (ix.makes.get(k)?.some((r) => r.id === v)) picks[k] = v
    else recipes++
  }
  return { gone: all.filter((x) => !has(x)), recipes, fresh: { code: encodeTargets(all.filter(has)), picks } }
}

/** опис розрахунку українською (кожен побачить своєю мовою — calcAboutText): «3 цілі · 120 крафтів» */
const ukForm = (n: number, [one, few, many]: [string, string, string]) => {
  const a = n % 10, b = n % 100
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many
}
export const calcAbout = (goals: number, crafts: number) =>
  [`${goals} ${ukForm(goals, ['ціль', 'цілі', 'цілей'])}`, crafts ? `${crafts} ${ukForm(crafts, ['крафт', 'крафти', 'крафтів'])}` : ''].filter(Boolean).join(' · ')
/** опис мовою сайту; чужий текст (давні розрахунки, написані мовою автора) — як є */
export function calcAboutText(s: string | null | undefined): string {
  const m = /^(\d+) ціл(?:ь|і|ей)(?: · (\d+) крафт(?:|и|ів))?$/.exec(String(s ?? '').trim())
  if (!m) return s ?? ''
  const form = (n: number, f: [string, string, string]) => { const c = new Intl.PluralRules(locale()).select(n); return `${n.toLocaleString(locale())} ${c === 'one' ? f[0] : c === 'few' ? f[1] : f[2]}` }
  return [form(Number(m[1]), [t('ціль'), t('цілі'), t('цілей')]), m[2] ? form(Number(m[2]), [t('крафт'), t('крафти'), t('крафтів')]) : ''].filter(Boolean).join(' · ')
}

export function samePicks(a: Record<string, string>, b: Record<string, string>) {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/**
 * Вибір станцій за родинами з рецептів. У родині — той розмір, з яким pickStations повторює найбільше збережених
 * рецептів: предмет, якого на вибраному розмірі нема, стоїть на сусідньому (вибрано великий хімічний, а волокно —
 * на середньому), тож «найбільший» чи «останній» розмір серед рецептів не годиться
 */
export function stationsOf(ix: CatalogIndex, picks: Record<string, string>): Record<string, number> {
  const fams = new Map<string, { tiers: Set<number>; items: string[] }>()
  for (const [item, rid] of Object.entries(picks)) {
    const at = ix.makes.get(item)?.find((r) => r.id === rid)?.at[0]
    const T = stationTier(ix, at)
    if (!T) continue
    const fam = familyOf(ix, at)
    if (!fams.has(fam)) fams.set(fam, { tiers: new Set(), items: [] })
    fams.get(fam)!.tiers.add(T)
    fams.get(fam)!.items.push(item)
  }
  const out: Record<string, number> = {}
  for (const [fam, { tiers, items }] of fams) {
    let best = 0
    let score = -1
    // при рівності — більший (так само вибирає й pickStations)
    for (const T of [...tiers].sort((a, b) => b - a)) {
      const got = pickStations(ix, items, { [fam]: T })
      const n = items.filter((i) => got[i] === picks[i]).length
      if (n > score) { best = T; score = n }
    }
    out[fam] = best
  }
  return out
}

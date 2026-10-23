/*
 * Порівняння розділу між двома джерелами (адмінка «Дані гри»): поточне (a) з вибраним (b) — що додасться (+, є лише в b),
 * зникне (−, є лише в a), зміниться (поле: було → стане). Невипущене в грі не рахується. Числа порівнюються як числа
 * («1.0» = 1), null = відсутнє; «було порожньо, стало» — окремо (filled). Список обрізано, лічильники — повні.
 */
import { stableStringify } from './hash.mjs'

const IGNORE = { _: ['id', 'released'], buildables: ['id', 'released', 'key', 'img'], markers: ['id', 'x', 'y', 'z', 'kind', 'name'], resources: ['id', 'x', 'y', 'z', 'kind', 'group', 'weight'] }
/**
 * точки мапи: те саме місце — та сама мапа й розкладка, ближче за PLACE_TOL (см): джерела округлюють координати
 * по-різному, тож ключ «мапа@x:y» з обох боків збігається не завжди. Тип точки в джерел свій (без зіставлення) —
 * інший тип на тому самому місці показується зміною.
 */
const POINTS = new Set(['markers', 'resources'])
const PLACE_TOL = 300
/** скільки записів віддати списком (лічильники рахують усе) */
const MAX_ITEMS = 1500
/** довжина значення в «було → стане» */
const MAX_VALUE = 160

/**
 * Що з запису порівнювати: уміння — ранги за ціною й бонусами (текстів perks/buffs не всі джерела дають), опису нема з
 * одного боку — не зміна (сайт тоді лишає відомий)
 */
const VIEW = {
  skills: (ra, rb) => {
    const both = ra.desc != null && rb.desc != null
    const one = ({ desc, levels, ...rest }) => ({ ...rest, ...(both ? { desc } : {}), levels: (levels ?? []).map((l) => ({ cost: l.cost, bonuses: l.bonuses ?? [] })) })
    return [one(ra), one(rb)]
  },
}

/** значення для порівняння: числові рядки — числа, порожнє — null, складне — стабільний JSON */
function norm(v) {
  if (v == null || v === '') return null
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  if (typeof v === 'object') return stableStringify(v)
  return v
}

/** значення для показу: текстом, довге — обрізане */
function show(v) {
  const n = norm(v)
  if (n == null) return null
  const s = String(n)
  return s.length > MAX_VALUE ? s.slice(0, MAX_VALUE) + '…' : s
}

const released = (r) => r.released !== false

/** записи b з id того запису a, що на тому самому місці (кожен запис a — щонайбільше раз) */
function pairByPlace(ar, br) {
  const cell = (r, dx = 0, dy = 0) => `${r.map}|${r.layout ?? ''}|${Math.floor(r.x / PLACE_TOL) + dx}|${Math.floor(r.y / PLACE_TOL) + dy}`
  const grid = new Map()
  for (const r of ar) { const k = cell(r); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(r) }
  const used = new Set()
  const ids = new Set(ar.map((r) => String(r.id)))
  return br.map((r) => {
    let best = null, bd = PLACE_TOL
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const c of grid.get(cell(r, dx, dy)) ?? []) {
        const d = Math.hypot(c.x - r.x, c.y - r.y)
        if (!used.has(c) && d <= bd) { best = c; bd = d }
      }
    }
    // без пари — свій id (той самий id у a — інше місце: розрізняємо)
    if (!best) return ids.has(String(r.id)) ? { ...r, id: `${r.id}#b` } : r
    used.add(best)
    return { ...r, id: best.id }
  })
}

/** назва запису в списку: точка мапи — її тип (name точки — ключ перекладу назви місця) */
const nameOf = (section, r) => (POINTS.has(section) ? r.type ?? null : r.name ?? null)

/** a, b — { id: драйвер, records } */
export function compareSection(section, { a: A, b: B }) {
  const ignore = new Set(IGNORE[section] ?? IGNORE._)
  const view = VIEW[section]
  let ar = (A?.records ?? []).filter(released)
  let br = (B?.records ?? []).filter(released)
  // переклади: лише види, що є в обох джерелах (у когось уміння ще не перекладені — це не «прибрано»)
  if (section === 'texts') {
    const kinds = (rs) => new Set(rs.map((r) => String(r.id).split(':')[0]))
    const ka = kinds(ar), kb = kinds(br)
    ar = ar.filter((r) => kb.has(String(r.id).split(':')[0]))
    br = br.filter((r) => ka.has(String(r.id).split(':')[0]))
  }
  if (POINTS.has(section)) br = pairByPlace(ar, br)
  const a = new Map(ar.map((r) => [String(r.id), r]))
  const b = new Map(br.map((r) => [String(r.id), r]))
  const fields = {}
  const filledFields = {}
  const out = { '+': [], '-': [], '~': [] }
  let added = 0, removed = 0, changed = 0, filled = 0
  for (const [id, rb0] of b) {
    const ra0 = a.get(id)
    if (!ra0) { added++; out['+'].push({ id, name: nameOf(section, rb0), op: '+' }); continue }
    const [ra, rb] = view ? view(ra0, rb0) : [ra0, rb0]
    const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter((k) => !ignore.has(k) && norm(ra[k]) !== norm(rb[k])).sort()
    if (!keys.length) continue
    // було порожньо, а стало — окремо: це доповнення, а не зміна
    const fill = keys.filter((k) => norm(ra[k]) === null)
    const diff = keys.filter((k) => norm(ra[k]) !== null)
    for (const k of fill) filledFields[k] = (filledFields[k] ?? 0) + 1
    for (const k of diff) fields[k] = (fields[k] ?? 0) + 1
    if (fill.length) filled++
    if (diff.length) changed++
    const item = { id, name: nameOf(section, rb) ?? nameOf(section, ra), op: '~', changes: diff.map((k) => [k, show(ra[k]), show(rb[k])]) }
    if (fill.length) item.filled = fill.map((k) => [k, null, show(rb[k])])
    out['~'].push(item)
  }
  for (const [id, ra] of a) if (!b.has(id)) { removed++; out['-'].push({ id, name: nameOf(section, ra), op: '-' }) }
  const all = [...out['+'], ...out['-'], ...out['~']]
  const items = all.slice(0, MAX_ITEMS)
  return { section, a: A?.id ?? null, b: B?.id ?? null, added, removed, changed, filled, fields, filledFields, items, truncated: all.length - items.length }
}

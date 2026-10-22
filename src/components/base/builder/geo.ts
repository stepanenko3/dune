/**
 * Геометрія редактора: плитки чіпляються до країв наявних (як у грі — тому трикутні гратки й повороти на 30°
 * виходять самі), перевірка, що нова плитка ні на що не налазить (лише з тим, що на тій самій висоті: палуба
 * над нижчим ярусом даху — не перетин), сітка клітинок рамки (як у приміщення поруч: піраміда й зал Main
 * зсунуті на пів плитки), прорізи на окремий край, влучання курсором у плитку, край і пристрій.
 * Одиниці — як у моделі: 1 = сторона плитки, y — углиб бази, висоти — у блоках гри.
 */
import { GEOM } from '@/lib/engine'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface P { x: number; y: number }
export interface Tile { k: 's' | 't'; p: P[] }
export type OpenType = 'wall' | 'door' | 'shield' | 'open' | 'balcony'
/** тип одного блоку стіни (парапет — це вже пів блоку стіни внизу, а не окремий тип) */
export type PieceType = Exclude<OpenType, 'balcony'>

const round = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6
  return r === 0 ? 0 : r
}
export const pt = (x: number, y: number): P => ({ x: round(x), y: round(y) })
export const centroid = (p: P[]): P => GEOM.centroid(p)
const area2 = (p: P[]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y }, 0)
/** проти годинникової стрілки (y — угору), як плитки моделі */
const ccw = (p: P[]) => (area2(p) < 0 ? [...p].reverse() : p)
export const inPoly = (p: P, poly: P[]): boolean => GEOM.pointInPoly(p, poly)
export const keyOf = (p: P): string => GEOM.keyOf(p)
export const edgeKey = (a: P, b: P): string => GEOM.edgeKey(a, b)

export function distSeg(p: P, a: P, b: P) {
  const dx = b.x - a.x, dy = b.y - a.y
  const L2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2))
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y)
}

/** плитка, прикріплена до краю a–b з того боку, де немає точки inside (центр плитки, якій край належить) */
export function attach(a: P, b: P, inside: P | null, k: 's' | 't'): Tile {
  const dx = b.x - a.x, dy = b.y - a.y
  const L = Math.hypot(dx, dy) || 1
  let nx = -dy / L, ny = dx / L
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  if (inside && (inside.x - mx) * nx + (inside.y - my) * ny > 0) { nx = -nx; ny = -ny }
  const p =
    k === 's'
      ? [a, b, { x: b.x + nx * L, y: b.y + ny * L }, { x: a.x + nx * L, y: a.y + ny * L }]
      : [a, b, { x: mx + nx * L * Math.sqrt(3) / 2, y: my + ny * L * Math.sqrt(3) / 2 }]
  return { k, p: ccw(p.map((q) => pt(q.x, q.y))) }
}

/** квадрат клітинки сітки (для порожнього місця й заливки прямокутником) */
export const cellSquare = (x: number, y: number): Tile => ({ k: 's', p: [pt(x, y), pt(x + 1, y), pt(x + 1, y + 1), pt(x, y + 1)] })

// ---------- сітка клітинок ----------
/** зсув сітки: дробові частини x і y вершин плиток (ціла сітка — 0, 0; піраміда й зал Main — 0.5, 0) */
export type Grid = P
const frac = (v: number) => {
  const f = round(((v % 1) + 1) % 1)
  return f >= 1 - 1e-6 ? 0 : f
}
/**
 * Сітка приміщення: найчастіші дробові частини x і y на його краях уздовж осей (квадрат дає чотири такі краї,
 * трикутник — один, тож у змішаному приміщенні вирішують квадрати); null — таких країв немає (усе повернуте)
 */
export function gridOf(r: { tiles: Tile[] }): Grid | null {
  const xs = new Map<number, { v: number; n: number }>(), ys = new Map<number, { v: number; n: number }>()
  const vote = (m: typeof xs, v: number) => {
    const k = Math.round(v * 1e4), e = m.get(k)
    if (e) e.n++
    else m.set(k, { v, n: 1 })
  }
  for (const t of r.tiles)
    for (let i = 0; i < t.p.length; i++) {
      const a = t.p[i], b = t.p[(i + 1) % t.p.length]
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y)
      if (!((dy < 1e-6 && Math.abs(dx - 1) < 1e-6) || (dx < 1e-6 && Math.abs(dy - 1) < 1e-6))) continue
      vote(xs, frac(a.x))
      vote(ys, frac(a.y))
    }
  const top = (m: typeof xs) => [...m.values()].reduce((s, e) => (e.n > s.n ? e : s)).v
  return xs.size ? { x: top(xs), y: top(ys) } : null
}
/** точка в опуклому многокутнику (на краю — теж) */
const inConvex = (p: P, poly: P[]) => {
  let pos = false, neg = false
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (c > 1e-9) pos = true
    if (c < -1e-9) neg = true
  }
  return !(pos && neg)
}
/** відстань від точки до приміщення (зсередини — 0) */
const distRoom = (p: P, r: { tiles: Tile[] }) => {
  let d = Infinity
  for (const t of r.tiles) {
    if (inConvex(p, t.p)) return 0
    for (let i = 0; i < t.p.length; i++) d = Math.min(d, distSeg(p, t.p[i], t.p[(i + 1) % t.p.length]))
  }
  return d
}
/**
 * У якій сітці класти клітинки рамки a–b (одна клітинка — a = b): приміщення first (те, що будуємо), якщо воно
 * не далі за near від рамки; інакше — найближче до a з тих, що не далі за near (рамку почали біля нього чи
 * дотягли до нього); нікого — ціла сітка. Порядок rooms вирішує, коли однаково близько
 */
export function gridNear(rooms: { tiles: Tile[] }[], a: P, b: P = a, first?: { tiles: Tile[] } | null, near = 2): Grid {
  const x0 = Math.min(a.x, b.x) - near, x1 = Math.max(a.x, b.x) + near, y0 = Math.min(a.y, b.y) - near, y1 = Math.max(a.y, b.y) + near
  const box = [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]
  const close = (r: { tiles: Tile[] }) => r.tiles.some((t) => overlaps(t.p, box))
  const fg = first && close(first) ? gridOf(first) : null
  if (fg) return fg
  let best: Grid | null = null, d = Infinity
  for (const r of rooms) {
    if (!close(r)) continue
    const g = gridOf(r)
    const dr = g ? distRoom(a, r) : Infinity
    if (g && dr < d) { d = dr; best = g }
  }
  return best ?? { x: 0, y: 0 }
}
/** клітинка сітки g, у якій точка p */
export const cellAt = (p: P, g: Grid): Tile => cellSquare(Math.floor(round(p.x - g.x)) + g.x, Math.floor(round(p.y - g.y)) + g.y)
/** клітинки сітки g, яких торкається рамка a–b (рядами по x, у кожному — по y); більше за max — жодної */
export function cellsIn(a: P, b: P, g: Grid, max = 900): Tile[] {
  const x0 = Math.floor(round(Math.min(a.x, b.x) - g.x)), x1 = Math.floor(round(Math.max(a.x, b.x) - g.x))
  const y0 = Math.floor(round(Math.min(a.y, b.y) - g.y)), y1 = Math.floor(round(Math.max(a.y, b.y) - g.y))
  const out: Tile[] = []
  if ((x1 - x0 + 1) * (y1 - y0 + 1) <= max) for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(cellSquare(x + g.x, y + g.y))
  return out
}

/** опуклі многокутники перекриваються площею (дотик краями чи вершинами — ні): розділювальна вісь */
export function overlaps(A: P[], B: P[], eps = 1e-3): boolean {
  for (const poly of [A, B])
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      const nx = -(b.y - a.y), ny = b.x - a.x
      const L = Math.hypot(nx, ny) || 1
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity
      for (const q of A) { const v = (q.x * nx + q.y * ny) / L; a0 = Math.min(a0, v); a1 = Math.max(a1, v) }
      for (const q of B) { const v = (q.x * nx + q.y * ny) / L; b0 = Math.min(b0, v); b1 = Math.max(b1, v) }
      if (a1 <= b0 + eps || b1 <= a0 + eps) return false // є вісь, на якій вони не перекриваються
    }
  return true
}

/** приміщення, видимі на рівні плану (підлога в межах рівня; на «Даху» — усе від його висоти вгору) */
export const onLevel = (rooms: any[], L: { z0: number; z1: number }) => rooms.filter((r) => r.z0 >= L.z0 && r.z0 < L.z1)

// ---------- висоти ----------
export type Span = readonly [number, number]
/** палуба без стін (h = 0) теж займає місце по висоті — тонкий шар */
export const DECK = 0.1
/** від підлоги до верху стін */
export const spanOf = (r: { z0: number; h?: number }): Span => [r.z0, r.z0 + Math.max(r.h ?? 0, DECK)]
/** чи перетинаються по висоті; дотик — ні (палуба на даху нижчого приміщення — можна) */
export const spansMeet = (a: Span, b: Span) => a[0] < b[1] - 1e-6 && b[0] < a[1] - 1e-6
export const spanText = (s: Span) => (s[1] - s[0] <= DECK + 1e-6 ? `+${s[0]}` : `+${s[0]}…+${Math.round(s[1] * 100) / 100}`)

/** на що плитка налізе: приміщення, з яким перекривається на плані (і по висоті, якщо її задано), чи null */
export const blocker = (tile: Tile, rooms: any[], z?: Span): any | null =>
  rooms.find((r) => (!z || spansMeet(spanOf(r), z)) && r.tiles.some((t: Tile) => overlaps(tile.p, t.p))) ?? null
/** вільне місце для плитки: ні з чим на цьому рівні (на цій висоті) не перекривається */
export const fits = (tile: Tile, rooms: any[], z?: Span) => !blocker(tile, rooms, z)

/** краї межі кожного приміщення разом із плиткою, якій край належить (щоб знати, куди «назовні») */
export function boundaryWithOwner(rooms: any[]) {
  const out: { room: string; a: P; b: P; inside: P }[] = []
  for (const r of rooms) {
    const m = new Map<string, { a: P; b: P; inside: P; n: number }>()
    for (const t of r.tiles as Tile[]) {
      const c = centroid(t.p)
      for (let i = 0; i < t.p.length; i++) {
        const a = t.p[i], b = t.p[(i + 1) % t.p.length]
        const k = edgeKey(a, b)
        const e = m.get(k)
        if (e) e.n++
        else m.set(k, { a, b, inside: c, n: 1 })
      }
    }
    for (const e of m.values()) if (e.n === 1) out.push({ room: r.id, a: e.a, b: e.b, inside: e.inside })
  }
  return out
}

/** найближчий край межі до точки, не далі за max */
export function nearestEdge<E extends { a: P; b: P }>(edges: E[], p: P, max: number): E | null {
  let best: E | null = null, d = max
  for (const e of edges) {
    const x = distSeg(p, e.a, e.b)
    if (x < d) { d = x; best = e }
  }
  return best
}

/** плитка під точкою (з приміщенням) */
export function tileAt(rooms: any[], p: P): { room: any; i: number } | null {
  for (let k = rooms.length - 1; k >= 0; k--) {
    const r = rooms[k]
    const i = (r.tiles as Tile[]).findIndex((t) => inPoly(p, t.p))
    if (i >= 0) return { room: r, i }
  }
  return null
}

// ---------- пристрої ----------
export function itemCorners(it: any): P[] {
  const a = (it.ang * Math.PI) / 180
  const u = { x: Math.cos(a), y: Math.sin(a) }, v = { x: -Math.sin(a), y: Math.cos(a) }
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => ({ x: it.c.x + (u.x * s * it.w) / 2 + (v.x * t * it.d) / 2, y: it.c.y + (u.y * s * it.w) / 2 + (v.y * t * it.d) / 2 }))
}
export const inItem = (it: any, p: P) => inPoly(p, itemCorners(it))

// ---------- прорізи ----------
/**
 * Проріз на один край: вирізаємо край із наявних прорізів (ширші розрізаються, решта лишається), тоді —
 * новий, якщо це не «стіна». Рушій шукає прорізи краю за його серединою, тож так ніщо зайве не зачепиться
 */
export function setOpening(room: any, a: P, b: P, type: OpenType) {
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const out: any[] = []
  for (const o of room.open || []) {
    if (o.box) { out.push(o); continue }
    const dx = o.b.x - o.a.x, dy = o.b.y - o.a.y
    const L2 = dx * dx + dy * dy || 1
    const tm = ((m.x - o.a.x) * dx + (m.y - o.a.y) * dy) / L2
    const on = tm >= -0.01 && tm <= 1.01 && Math.hypot(o.a.x + dx * tm - m.x, o.a.y + dy * tm - m.y) < 0.06
    if (!on) { out.push(o); continue }
    const ta = ((a.x - o.a.x) * dx + (a.y - o.a.y) * dy) / L2
    const tb = ((b.x - o.a.x) * dx + (b.y - o.a.y) * dy) / L2
    const t0 = Math.min(ta, tb), t1 = Math.max(ta, tb)
    const at = (t: number) => pt(o.a.x + dx * t, o.a.y + dy * t)
    if (t0 > 0.01) out.push({ ...o, a: o.a, b: at(t0) })
    if (t1 < 0.99) out.push({ ...o, a: at(t1), b: o.b })
  }
  if (type !== 'wall') out.push({ a: pt(a.x, a.y), b: pt(b.x, b.y), type })
  room.open = out
  if (room.openAll) delete room.openAll // відкриті всі краї — більше не правда, далі — як позначили
}

/** який проріз зараз на краї (для підказки й картки) */
export function openingOf(room: any, a: P, b: P): OpenType {
  const types = (GEOM.edgeOpenings(room, a, b) as any[]).map((o) => o.type)
  return types.includes('open') ? 'open' : types.includes('shield') ? 'shield' : types.includes('balcony') ? 'balcony' : types.includes('door') ? 'door' : 'wall'
}

/** приміщення, крізь стіни яких станція може пройти: «дахова» (зі своєю висотою z) — лише ті, що на її висоті
 * (вітропастка на +9 під балконом +15 — не через стіну); станція приміщення — усі */
export const roomsAtItem = (rooms: any[], it: any) =>
  it.z === undefined ? rooms : rooms.filter((r) => spansMeet(spanOf(r), [it.z, it.z + Math.max(it.h ?? 0, DECK)]))

/** станція на місці: цілком в одному приміщенні чи цілком надворі; «wall» — через стіну; «overlap» — налазить на іншу */
export type Fit = 'ok' | 'overlap' | 'wall'
/** точки станції, що мають лежати в одному приміщенні: центр, трохи стягнуті кути й середини сторін (торкатися стіни можна) */
function probePoints(it: any): P[] {
  const c = it.c
  const k = itemCorners(it).map((q) => ({ x: c.x + (q.x - c.x) * 0.94, y: c.y + (q.y - c.y) * 0.94 }))
  return [c, ...k, ...k.map((q, i) => ({ x: (q.x + k[(i + 1) % 4].x) / 2, y: (q.y + k[(i + 1) % 4].y) / 2 }))]
}
export function fitOf(it: any, rooms: any[], others: any[]): Fit {
  const ids = probePoints(it).map((q) => tileAt(rooms, q)?.room.id ?? null)
  if (ids.some((id) => id !== ids[0])) return 'wall'
  const box = itemCorners(it)
  return others.some((o) => overlaps(itemCorners(o), box)) ? 'overlap' : 'ok'
}


// ---------- блоки стін ----------
/**
 * Блок стіни — сторона плитки на периметрі приміщення (як у грі: стіна завширшки в плиту). Спільна стіна двох
 * приміщень — одна на двох (рушій рахує й малює її раз, відкритіший тип перемагає), тож і правиться разом.
 */
export interface Edge { a: P; b: P }
const OPEN_RANK: OpenType[] = ['wall', 'door', 'balcony', 'shield', 'open'] // як openingOf: відкритіший — далі

/**
 * приміщення, що ділять цей блок стіни з room (з самим room): той самий край на периметрі й та сама підлога —
 * сусіди поруч. Галерея на +5 усередині залу з підлогою 0 стоїть на тій самій лінії, але це інший поверх: двері
 * на галереї не мають пробивати стіну залу внизу
 */
export function wallOwners(rooms: any[], room: any, a: P, b: P): any[] {
  const k = edgeKey(a, b)
  const rest = rooms.filter((r) => r.id !== room.id && Math.abs(r.z0 - room.z0) < 0.01 && boundaryWithOwner([r]).some((e) => edgeKey(e.a, e.b) === k))
  return [room, ...rest]
}
/** що в блоці стіни, з урахуванням сусіда за спільною стіною (як у 3D: відкритіший тип перемагає) */
export function wallType(owners: any[], a: P, b: P): OpenType {
  return owners.map((r) => openingOf(r, a, b)).reduce((best, t) => (OPEN_RANK.indexOf(t) > OPEN_RANK.indexOf(best) ? t : best), 'wall' as OpenType)
}
/** уся сторона: блоки периметра приміщення на одній прямій з вибраним, що йдуть поспіль (без розривів), по порядку */
export function sideRun(room: any, a: P, b: P): Edge[] {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const on = (q: P) => Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / len < 1e-3
  const line = boundaryWithOwner([room]).filter((e) => on(e.a) && on(e.b))
  const run: Edge[] = [{ a, b }]
  const ends = new Set([keyOf(a), keyOf(b)])
  for (let grew = true; grew; ) {
    grew = false
    for (const e of line) {
      if (run.some((x) => edgeKey(x.a, x.b) === edgeKey(e.a, e.b))) continue
      if (ends.has(keyOf(e.a)) || ends.has(keyOf(e.b))) {
        run.push({ a: e.a, b: e.b })
        ends.add(keyOf(e.a))
        ends.add(keyOf(e.b))
        grew = true
      }
    }
  }
  const t = (q: P) => (q.x - a.x) * dx + (q.y - a.y) * dy
  return run.sort((u, v) => Math.min(t(u.a), t(u.b)) - Math.min(t(v.a), t(v.b)))
}
/** сусідній блок по периметру приміщення: dir 1 — той, що починається в кінці b, -1 — у початку a (зорієнтований) */
export function nextEdge(room: any, a: P, b: P, dir: 1 | -1): Edge | null {
  const at = dir === 1 ? b : a
  const k = edgeKey(a, b)
  const e = boundaryWithOwner([room]).find((x) => edgeKey(x.a, x.b) !== k && (keyOf(x.a) === keyOf(at) || keyOf(x.b) === keyOf(at)))
  if (!e) return null
  const fromAt = keyOf(e.a) === keyOf(at)
  return dir === 1 ? (fromAt ? { a: e.a, b: e.b } : { a: e.b, b: e.a }) : fromAt ? { a: e.b, b: e.a } : { a: e.a, b: e.b }
}

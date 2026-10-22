/**
 * Вирівнювання станцій у будівельнику — «розумні напрямні»: поки станцію ставлять чи тягнуть, її центр притягується
 * (до ALIGN_SNAP блоку) до найближчого з:
 *   - лінії іншої станції на тому самому рівні — центр до центру, край до краю (з тим самим поворотом, з кроком 90°);
 *   - відступу EDGE_GAP від стіни чи поручня, вздовж якого вона стоїть («від краю»);
 *   - рівного кроку: проміжок до сусіда в ряду — такий, як між ним і наступним, або посередині між двома.
 * Кожна вісь станції (уздовж ширини й глибини) — окремо. Повертає новий центр і напрямні — що показати в 3D (лінії
 * на підлозі) і коротко в підписі біля курсора.
 */
import { PIECES, type Model, type Piece } from '@/lib/engine'

/* eslint-disable @typescript-eslint/no-explicit-any */
type P = { x: number; y: number }
export type GuideKind = 'line' | 'edge' | 'gap'
export interface Guide { a: P; b: P; z: number; kind: GuideKind }
export interface Aligned { c: P; guides: Guide[]; kinds: GuideKind[] }

/** на скільки блоків притягує */
export const ALIGN_SNAP = 0.25
/** відступ від стіни чи поручня */
export const EDGE_GAP = 0.1
/** сусіди далі — не враховуємо */
const REACH = 8
const PRIO: Record<GuideKind, number> = { gap: 3, edge: 2, line: 1 }
const r3 = (v: number) => Math.round(v * 1000) / 1000

interface Box { cu: number; cv: number; hu: number; hv: number }
interface Cand { off: number; kind: GuideKind; make: (g: Box) => Guide[] }

export function alignItem(M: Pick<Model, 'pieces' | 'items'>, it: any, skip?: number): Aligned {
  const z = it.z ?? 0
  const ang = ((it.ang || 0) * Math.PI) / 180
  const u = { x: Math.cos(ang), y: Math.sin(ang) }, v = { x: -Math.sin(ang), y: Math.cos(ang) }
  const U = (p: P) => p.x * u.x + p.y * u.y, V = (p: P) => p.x * v.x + p.y * v.y
  const W = (a: number, b: number): P => ({ x: r3(a * u.x + b * v.x), y: r3(a * u.y + b * v.y) })
  const g0: Box = { cu: U(it.c), cv: V(it.c), hu: it.w / 2, hv: it.d / 2 }
  const zg = z + 0.03

  // сусіди: той самий рівень, поворот кратний 90° до цієї
  const boxes: Box[] = []
  ;(M.items || []).forEach((o: any, i: number) => {
    if (i === skip || o === it || o.kind === 'light' || !o.c) return
    if (Math.abs((o.z ?? 0) - z) > 0.5 || Math.hypot(o.c.x - it.c.x, o.c.y - it.c.y) > REACH) return
    const rel = ((((o.ang || 0) - (it.ang || 0)) % 90) + 90) % 90
    if (rel > 1 && rel < 89) return
    const turned = Math.round((((o.ang || 0) - (it.ang || 0)) % 180 + 180) % 180) === 90
    boxes.push({ cu: U(o.c), cv: V(o.c), hu: (turned ? o.d : o.w) / 2, hv: (turned ? o.w : o.d) / 2 })
  })

  // краї: стіни (на висоті станції) і поручні (на її рівні), паралельні одній з осей
  const edges: { a: P; b: P }[] = []
  for (const p of M.pieces as Piece[]) {
    if (Math.abs(p.x - it.c.x) > REACH || Math.abs(p.y - it.c.y) > REACH) continue
    const s = PIECES.SHAPES[p.shape]
    if (!s || s.at !== 'edge') continue
    const f = PIECES.footprint(p)
    if (!f.seg) continue
    const onLevel = s.family === 'rail' ? Math.abs(f.z0 - z) < 0.05 : f.z0 < z + 0.5 && f.z1 > z + 0.05
    if (onLevel) edges.push(f.seg)
  }

  /** кандидати на одній осі: ax — 'u' чи 'v' (уздовж неї зсуваємо), інша — поперечна */
  function axis(ax: 'u' | 'v'): Cand[] {
    const c = (b: Box) => (ax === 'u' ? b.cu : b.cv), h = (b: Box) => (ax === 'u' ? b.hu : b.hv)
    const oc = (b: Box) => (ax === 'u' ? b.cv : b.cu), oh = (b: Box) => (ax === 'u' ? b.hv : b.hu)
    const pt = (along: number, across: number) => (ax === 'u' ? W(along, across) : W(across, along))
    const out: Cand[] = []
    const gc = c(g0), gh = h(g0)
    // в лінію з сусідом: центр, ближній чи дальній край
    for (const n of boxes) {
      for (const [t, r] of [[c(n), gc], [c(n) - h(n), gc - gh], [c(n) + h(n), gc + gh]] as const) {
        const ref = r - gc
        out.push({ off: t - r, kind: 'line', make: (g) => {
          const at = c(g) + ref
          const lo = Math.min(oc(g) - oh(g), oc(n) - oh(n)) - 0.3, hi = Math.max(oc(g) + oh(g), oc(n) + oh(n)) + 0.3
          return [{ a: pt(at, lo), b: pt(at, hi), z: zg, kind: 'line' }]
        } })
      }
    }
    // від краю: край поперек цієї осі, навпроти станції (перекриває її поперечний розмір), не далі за 1,5
    for (const e of edges) {
      const da = Math.abs((ax === 'u' ? U(e.b) - U(e.a) : V(e.b) - V(e.a)))
      if (da > 1e-3) continue
      const L = ax === 'u' ? U(e.a) : V(e.a)
      const o1 = ax === 'u' ? V(e.a) : U(e.a), o2 = ax === 'u' ? V(e.b) : U(e.b)
      if (Math.max(o1, o2) < oc(g0) - oh(g0) + 0.05 || Math.min(o1, o2) > oc(g0) + oh(g0) - 0.05) continue
      const side = gc >= L ? 1 : -1
      const want = L + side * (EDGE_GAP + gh)
      if (Math.abs(want - gc) > 1.5) continue
      out.push({ off: want - gc, kind: 'edge', make: (g) => {
        const near = c(g) - side * h(g)
        return [
          { a: pt(L, Math.min(o1, o2)), b: pt(L, Math.max(o1, o2)), z: zg, kind: 'edge' },
          { a: pt(L, oc(g)), b: pt(near, oc(g)), z: zg, kind: 'edge' },
        ]
      } })
    }
    // рівний крок: сусіди в ряду (поперек — у межах 0,3 від цієї)
    const row = boxes.filter((n) => Math.abs(oc(n) - oc(g0)) < 0.3).sort((a, b) => c(a) - c(b))
    const gapGuide = (x0: number, x1: number, g: Box): Guide => ({ a: pt(x0, oc(g)), b: pt(x1, oc(g)), z: zg, kind: 'gap' })
    for (const side of [1, -1]) {
      // найближчий сусід з цього боку і наступний за ним
      const list = side > 0 ? row.filter((n) => c(n) < gc).reverse() : row.filter((n) => c(n) > gc)
      const [a, b] = list
      if (!a || !b) continue
      const gap = side > 0 ? (c(a) - h(a)) - (c(b) + h(b)) : (c(b) - h(b)) - (c(a) + h(a))
      if (gap < -1e-6) continue
      const want = side > 0 ? c(a) + h(a) + gap + gh : c(a) - h(a) - gap - gh
      out.push({ off: want - gc, kind: 'gap', make: (g) => side > 0
        ? [gapGuide(c(b) + h(b), c(a) - h(a), g), gapGuide(c(a) + h(a), c(g) - h(g), g)]
        : [gapGuide(c(a) + h(a), c(b) - h(b), g), gapGuide(c(g) + h(g), c(a) - h(a), g)] })
    }
    // посередині між двома
    const l = row.filter((n) => c(n) < gc).pop(), r = row.find((n) => c(n) > gc)
    if (l && r) {
      const want = (c(l) + h(l) + c(r) - h(r)) / 2
      out.push({ off: want - gc, kind: 'gap', make: (g) => [gapGuide(c(l) + h(l), c(g) - h(g), g), gapGuide(c(g) + h(g), c(r) - h(r), g)] })
    }
    return out
  }

  const pick = (list: Cand[]) => {
    let best: Cand | null = null
    for (const k of list) {
      if (Math.abs(k.off) > ALIGN_SNAP) continue
      if (!best || Math.abs(k.off) < Math.abs(best.off) - 0.02 || (Math.abs(k.off) <= Math.abs(best.off) + 0.02 && PRIO[k.kind] > PRIO[best.kind])) best = k
    }
    return best
  }
  const bu = pick(axis('u')), bv = pick(axis('v'))
  const g: Box = { ...g0, cu: g0.cu + (bu?.off ?? 0), cv: g0.cv + (bv?.off ?? 0) }
  const c = W(g.cu, g.cv)
  return {
    c: { x: Math.round(c.x * 100) / 100, y: Math.round(c.y * 100) / 100 },
    guides: [...(bu ? bu.make(g) : []), ...(bv ? bv.make(g) : [])],
    kinds: [...new Set([bu?.kind, bv?.kind].filter(Boolean) as GuideKind[])],
  }
}

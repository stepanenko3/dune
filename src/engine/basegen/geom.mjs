/*
 * Геометрія генератора баз: рамки сторін ділянки (локальні u — уздовж сторони, v — всередину), прямокутники станцій
 * (повернуті), перетин опуклих многокутників і пакувальник — станції вздовж стін приміщення з відступами від стін,
 * дверей, сходів, смуг польоту й одна від одної.
 */

export const DIRS = { S: { x: 0, y: -1 }, E: { x: 1, y: 0 }, N: { x: 0, y: 1 }, W: { x: -1, y: 0 } }
export const SIDES = ['S', 'E', 'N', 'W']
export const OPP = { S: 'N', N: 'S', E: 'W', W: 'E' }
const r6 = (v) => Math.round(v * 1e6) / 1e6

/**
 * рамка сторони прямокутника { x0, y0, x1, y1 }: a — початок сторони (обхід проти годинникової, приміщення ліворуч),
 * U — уздовж сторони, N — всередину; at(u, v) — точка; len — довжина сторони, depth — глибина приміщення
 */
export function frame(R, side) {
  const W = R.x1 - R.x0, D = R.y1 - R.y0
  const f = {
    S: { a: { x: R.x0, y: R.y0 }, U: { x: 1, y: 0 }, N: { x: 0, y: 1 }, len: W, depth: D },
    E: { a: { x: R.x1, y: R.y0 }, U: { x: 0, y: 1 }, N: { x: -1, y: 0 }, len: D, depth: W },
    N: { a: { x: R.x1, y: R.y1 }, U: { x: -1, y: 0 }, N: { x: 0, y: -1 }, len: W, depth: D },
    W: { a: { x: R.x0, y: R.y1 }, U: { x: 0, y: -1 }, N: { x: 1, y: 0 }, len: D, depth: W },
  }[side]
  const at = (u, v) => ({ x: r6(f.a.x + f.U.x * u + f.N.x * v), y: r6(f.a.y + f.U.y * u + f.N.y * v) })
  return {
    ...f, side, at,
    ang: deg(f.U),
    /** кут, коли довша сторона станції — уздовж N (носом до стіни) */
    angN: deg(f.N),
    /** прямокутник у локальних координатах → многокутник (проти годинникової) */
    box: (u0, u1, v0, v1) => [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)],
    /** відрізок на стіні (v = 0) */
    seg: (u0, u1) => [at(u0, 0), at(u1, 0)],
  }
}
export const deg = (v) => r6((Math.atan2(v.y, v.x) * 180) / Math.PI)

/** одинична ділянка дверей на стороні: та, що починається з середини сторони за світовою віссю (від обох сусідів — та сама) */
export const doorU = (side, len = 10) => (side === 'S' || side === 'E' ? len / 2 : len / 2 - 1)

/** прямокутник станції: центр c, w — уздовж кута ang, d — поперек */
export function obb(c, w, d, ang) {
  const t = (ang * Math.PI) / 180, ux = Math.cos(t), uy = Math.sin(t), vx = -uy, vy = ux
  const hw = w / 2, hd = d / 2
  return [
    { x: c.x - ux * hw - vx * hd, y: c.y - uy * hw - vy * hd },
    { x: c.x + ux * hw - vx * hd, y: c.y + uy * hw - vy * hd },
    { x: c.x + ux * hw + vx * hd, y: c.y + uy * hw + vy * hd },
    { x: c.x - ux * hw + vx * hd, y: c.y - uy * hw + vy * hd },
  ]
}
export const rectPoly = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]

/** перетин опуклих многокутників (розділова вісь); gap — скільки ще має бути між ними */
export function overlap(P, Q, gap = 0) {
  for (const poly of [P, Q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L
      let p0 = Infinity, p1 = -Infinity, q0 = Infinity, q1 = -Infinity
      for (const q of P) { const s = q.x * nx + q.y * ny; p0 = Math.min(p0, s); p1 = Math.max(p1, s) }
      for (const q of Q) { const s = q.x * nx + q.y * ny; q0 = Math.min(q0, s); q1 = Math.max(q1, s) }
      if (p1 + gap <= q0 + 1e-9 || q1 + gap <= p0 + 1e-9) return false
    }
  }
  return true
}

/** усі точки pts усередині опуклого многокутника poly (проти годинникової) з відступом m від кожного краю */
export function insideConvex(pts, poly, m = 0) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
    for (const q of pts) if (((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) / L < m - 1e-9) return false
  }
  return true
}

/**
 * Пакувальник. Приміщення — { poly (опуклий, проти годинникової), reserved: [многокутники], placed: [многокутники] }.
 * Станція — { w, d }: шукаємо місце спершу вздовж стін (довша сторона вздовж стіни, потім поперек), потім посередині;
 * відступ від стін WALL, між станціями GAP. Повертає { c, ang, poly } чи null.
 */
// сітка кроків зсунута на NUDGE: центр станції не лягає точно на край чи вершину плитки (там «під нею підлога» неоднозначне)
const WALL = 0.15, GAP = 0.12, STEP = 0.1, NUDGE = 0.013
export function fit(room, w, d, { island = true } = {}) {
  const P = room.poly
  const free = (poly) => insideConvex(poly, P, WALL) && !room.reserved.some((r) => overlap(r, poly, 0.02)) && !room.placed.some((r) => overlap(r, poly, GAP))
  for (const turn of [false, true]) {
    const along = turn ? d : w, depth = turn ? w : d
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length]
      const L = Math.hypot(b.x - a.x, b.y - a.y)
      const U = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, N = { x: -U.y, y: U.x }
      const ang = deg(U) + (turn ? 90 : 0)
      for (let s = WALL + along / 2 + NUDGE; s <= L - WALL - along / 2 + 1e-9; s += STEP) {
        const c = { x: r6(a.x + U.x * s + N.x * (WALL + depth / 2)), y: r6(a.y + U.y * s + N.y * (WALL + depth / 2)) }
        const poly = obb(c, w, d, ang)
        if (free(poly)) return { c, ang: r6(ang), poly }
      }
    }
  }
  if (!island) return null
  // посередині: сітка з кроком 0,25 від центру назовні
  const cx = P.reduce((s, q) => s + q.x, 0) / P.length, cy = P.reduce((s, q) => s + q.y, 0) / P.length
  const pts = []
  for (let dx = -6; dx <= 6; dx += 0.25) for (let dy = -6; dy <= 6; dy += 0.25) pts.push({ x: cx + dx + NUDGE, y: cy + dy + NUDGE, r: dx * dx + dy * dy })
  pts.sort((p, q) => p.r - q.r)
  const base = deg({ x: P[1].x - P[0].x, y: P[1].y - P[0].y })
  for (const q of pts) for (const ang of [base, base + 90]) {
    const c = { x: r6(q.x), y: r6(q.y) }
    const poly = obb(c, w, d, ang)
    if (free(poly)) return { c, ang: r6(ang), poly }
  }
  return null
}

/** детермінований генератор випадкових чисел (варіант бази) */
export function rng(seed) {
  let a = (seed >>> 0) || 1
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

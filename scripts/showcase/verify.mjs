/*
 * Перевірки показових баз понад перетини й стабільність (lib.check):
 *   - техніка (vehicle, air) — під дахом і в стінах: над нею плита чи щит, на всі чотири боки — стіна, щит чи ворота;
 *   - станції не врізаються в стіни, ворота й похилі стіни, під кожною — підлога на її висоті;
 *   - двері й ворота ведуть на підлогу з обох боків; сходи виходять на плиту без стіни поперек виходу.
 * Повертає список проблем людською мовою (порожній — усе гаразд).
 */
import { PIECES, unitEdges, kp } from './lib.mjs'

const S = PIECES.SHAPES
const EPS = 1e-6

export function verify(pieces, items) {
  const out = []
  const slabs = pieces.filter((p) => PIECES.isSlab(S[p.shape]))
  const slopes = pieces.filter((p) => S[p.shape].family === 'slope')
  const edges = pieces.filter((p) => S[p.shape].at === 'edge' && S[p.shape].family !== 'rail' && S[p.shape].family !== 'ladder').map((p) => ({ p, f: PIECES.footprint(p) }))
  const polyOf = (p) => PIECES.tilePoly(S[p.shape].tile === 'r' || S[p.shape].tile === 'ri' ? 's' : S[p.shape].tile, p.x, p.y, p.rot)
  const inPoly = (q, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c } return c }
  const slabAt = (q, z, tol = 0.05) => slabs.some((p) => Math.abs(p.z - z) < tol && inPoly(q, polyOf(p)))
  const label = (it) => `«${it.name}» (${it.c.x.toFixed(1)}, ${it.c.y.toFixed(1)}, +${it.z})`
  /** кути (і середини сторін) прямокутника станції */
  const corners = (it, shrink = 0) => {
    const a = ((it.ang || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
    const w = it.w / 2 - shrink, d = it.d / 2 - shrink
    return [[-w, -d], [w, -d], [w, d], [-w, d], [0, -d], [w, 0], [0, d], [-w, 0]].map(([x, y]) => ({ x: it.c.x + x * c - y * s, y: it.c.y + x * s + y * c }))
  }
  const segX = (p1, p2, q1, q2) => {
    const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    const d1 = d(q1, q2, p1), d2 = d(q1, q2, p2), d3 = d(p1, p2, q1), d4 = d(p1, p2, q2)
    return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
  }

  for (const it of items) {
    const z = it.z || 0
    // підлога під станцією
    if (!slabAt(it.c, z)) out.push(`${label(it)}: під станцією нема підлоги на її висоті`)
    // стіни поперек станції (на її висоті)
    const box = corners(it, 0.02)
    const sides = box.slice(0, 4).map((q, i, a) => [q, a[(i + 1) % 4]])
    for (const { p, f } of edges) {
      if (!(f.z0 < z + it.h - EPS && f.z1 > z + EPS)) continue
      if (S[p.shape].shield && (it.kind === 'air' || it.kind === 'vehicle')) continue // крізь щит техніка проходить, але стояти в ньому — ні
      const crosses = sides.some(([a, b]) => segX(a, b, f.seg.a, f.seg.b)) || inPoly(f.seg.a, box.slice(0, 4)) || inPoly(f.seg.b, box.slice(0, 4))
      if (crosses) { out.push(`${label(it)}: перетинає ${S[p.shape].name.toLowerCase()} (${p.x}, ${p.y}, +${p.z})`); break }
    }
    // похилі стіни: панель на висоті h — на h/3 від зовнішнього краю
    for (const p of slopes) {
      const s = S[p.shape]
      if (!s.wall || !(p.z < z + it.h - EPS && p.z + 3 > z + EPS)) continue
      const a = (p.rot * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a)
      for (const q of corners(it, 0.02)) {
        const lx = (q.x - p.x) * c + (q.y - p.y) * sn, ly = -(q.x - p.x) * sn + (q.y - p.y) * c
        if (Math.abs(lx) > 0.5 || Math.abs(ly) > 0.5) continue
        const hh = Math.min(3, z + it.h - p.z)
        // tall_ramp: низ на ly = −½, верх (3) на ly = +½ — на висоті hh панель на ly = −½ + hh/3, кімната — далі;
        // кутова (верх лише у вершині (½, ½)) — так само по обох осях
        const need = -0.5 + hh / 3
        const corner = s.hs[3] === 0
        if (ly < need || (corner && lx < need)) { out.push(`${label(it)}: врізається в похилу стіну (${p.x}, ${p.y})`); break }
      }
    }
  }

  // техніка — під дахом і за стінами
  const covers = pieces.filter((p) => PIECES.isSlab(S[p.shape]) || S[p.shape].family === 'slope')
  const blocker = edges
  for (const it of items.filter((x) => x.kind === 'vehicle' || x.kind === 'air')) {
    const z = it.z || 0
    const roofed = covers.some((p) => p.z > z + 0.5 && p.z < z + 9 && inPoly(it.c, polyOf(p)))
    if (!roofed) out.push(`${label(it)}: техніка без даху над собою`)
    const zc = z + 1
    // промінь трохи збоку від центру — не точно у вершину між двома стінами
    const o = { x: it.c.x + 0.0137, y: it.c.y + 0.0191 }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const far = { x: o.x + dx * 40, y: o.y + dy * 40 }
      const hit = blocker.some(({ f }) => f.z0 <= zc + EPS && f.z1 >= zc - EPS && segX(o, far, f.seg.a, f.seg.b))
      // похила стіна теж закриває
      const lean = !hit && slopes.some((p) => S[p.shape].wall && p.z <= zc && p.z + 3 >= zc && (() => { for (let k = 0.25; k < 40; k += 0.25) { if (inPoly({ x: it.c.x + dx * k, y: it.c.y + dy * k }, polyOf(p))) return true } return false })())
      if (!hit && !lean) { out.push(`${label(it)}: техніка відкрита з боку (${dx}, ${dy})`); break }
    }
  }

  // двері й ворота: з обох боків підлога (чи верх сходів); на рівні землі назовні — пісок, це нормально
  const stairs = pieces.filter((p) => p.shape === 'Sardaukar_Stairs')
  const stairTop = (q, z) => stairs.some((p) => p.z + 1 === z && inPoly(q, polyOf(p)))
  for (const p of pieces.filter((x) => S[x.shape].panel === 'door' || S[x.shape].panel === 'gate')) {
    const f = PIECES.footprint(p)
    const ux = (f.seg.b.x - f.seg.a.x), uy = (f.seg.b.y - f.seg.a.y), L = Math.hypot(ux, uy)
    const n = { x: -uy / L, y: ux / L }
    const ok = [1, -1].map((sgn) => { const q = { x: p.x + n.x * 0.5 * sgn, y: p.y + n.y * 0.5 * sgn }; return slabAt(q, p.z) || stairTop(q, p.z) })
    if (p.z > 0 ? !(ok[0] && ok[1]) : !(ok[0] || ok[1])) out.push(`${S[p.shape].name} (${p.x}, ${p.y}, +${p.z}): веде в порожнечу`)
  }

  // сходи: вихід угорі — на плиту, без стіни поперек (двері й прорізи — прохідні)
  const stairAt = new Set(stairs.map((p) => kp(p) + '|' + p.z))
  for (const p of stairs) {
    const a = ((p.rot + 90) * Math.PI) / 180, u = { x: Math.cos(a), y: Math.sin(a) }
    const next = { x: p.x + u.x, y: p.y + u.y }
    if (stairAt.has(kp(next) + '|' + (p.z + 1))) continue // марш триває
    const doorAhead = edges.some(({ p: w, f }) => S[w.shape].hole && Math.abs(f.z0 - p.z - 1) < EPS && unitEdges(f.seg.a, f.seg.b).some((e) => kp(e.m) === kp({ x: p.x + u.x / 2, y: p.y + u.y / 2 })))
    if (!slabAt(next, p.z + 1) && !doorAhead) out.push(`Сходи (${p.x}, ${p.y}, +${p.z}): угорі нема плити, куди вийти`)
    const m = { x: p.x + u.x / 2, y: p.y + u.y / 2 }
    const wall = edges.find(({ p: w, f }) => !S[w.shape].hole && f.z0 < p.z + 1 + 1.5 && f.z1 > p.z + 1 + EPS && unitEdges(f.seg.a, f.seg.b).some((e) => kp(e.m) === kp(m)))
    if (wall) out.push(`Сходи (${p.x}, ${p.y}, +${p.z}): вихід угорі закриває ${S[wall.p.shape].name.toLowerCase()}`)
  }
  return out
}

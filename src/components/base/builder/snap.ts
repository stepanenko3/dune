/**
 * Прив'язка примари деталі, як у грі: куди стане вибрана форма, якщо клацнути там, де курсор.
 *   - на плитці (фундамент, перекриття, дах, скат, сходи): наведено на верх плити — сусідня плитка через найближчий
 *     край (на тій самій висоті; біля ската — на висоті того його краю: біля верхнього — угорі, як пласка середина
 *     даху; сходи й скати — на саму плиту); на бік плити — сусідня через цей край; на стіну —
 *     плитка на верху стіни з боку, звідки дивимось (R — з іншого боку); на землю — клітинка сітки, висота 0;
 *   - на краю (стіни, прорізи, скісні, поручні, щит): наведено на плиту — її найближчий край, на верху плити; знизу
 *     чи збоку (не фундамент) — під плиту, звисає з її краю; на стіну — вище (на її верху), на нижню половину стіни —
 *     під неї; на землю — край клітинки (без опори — червона). Заокруглений поручень — на дугу заокругленої плити;
 *     на заокругленій плиті інші деталі — лише на її прямих краях;
 *   - у вершині (колони): найближчий до курсора кут плити чи її центр (як у грі — і посеред трикутника), на її верху;
 *     на колону — вище.
 * Перевірка: не налазить на наявну деталь і має опору (плиту чи стіну під собою, сусідню плиту на тій самій висоті;
 * деталь на краю — ще й плиту чи деталь над собою: звисає з краю даху, як у грі).
 * R — поворот: плитка — на 90° (трикутник — 120°), край — інший бік (ліва ↔ права).
 */
import { PIECES, type Hit, type Piece } from '@/lib/engine'
import { t } from '@/lib/i18n'
import { lab, low } from '../tr'
import { attach, cellAt, cellSquare, centroid, type P } from './geo'

const EPS = 1e-4
const r6 = (v: number) => Math.round(v * 1e6) / 1e6
const deg = (dx: number, dy: number) => r6((Math.atan2(dy, dx) * 180) / Math.PI)
const norm = (d: number) => { let x = ((d % 360) + 360) % 360; if (x > 180) x -= 360; return r6(x) }
const dist2 = (a: P, b: P) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2
function distSeg(p: P, a: P, b: P) {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y)
}
const edgesOf = (poly: P[]) => poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length] }))
/** край многокутника, найближчий до точки */
const nearestEdge = (poly: P[], p: P) => edgesOf(poly).reduce((m, e) => (distSeg(p, e.a, e.b) < distSeg(p, m.a, m.b) ? e : m))

export interface Ghost { piece: Piece; ok: boolean; why?: string }

/**
 * плитка, приєднана до краю a–b з боку away (точка, від якої — геть; null — будь-який): центр і поворот так, що
 * локальна нижня сторона лежить на краю, а +y — усередину нової плитки (скати й сходи піднімаються від краю)
 */
function tileOnEdge(a: P, b: P, away: P | null, kind: 's' | 't') {
  const t = attach(a, b, away, kind)
  const c = centroid(t.p)
  const dx = b.x - a.x, dy = b.y - a.y
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  // ліва нормаль напряму має дивитись усередину плитки
  const into = (c.x - m.x) * -dy + (c.y - m.y) * dx > 0
  return { x: r6(c.x), y: r6(c.y), rot: into ? deg(dx, dy) : deg(-dx, -dy), poly: t.p }
}

/** куди стане форма shape під курсором (hit); turn — скільки разів натиснуто R */
export function snap(shape: string, hit: Hit, pieces: Piece[], turn = 0): Ghost | null {
  const s = PIECES.SHAPES[shape]
  if (!s || !hit) return null
  const byId = new Map(pieces.map((p) => [p.id, p]))
  const on = hit.piece ? byId.get(hit.piece) ?? null : null
  const onS = on ? PIECES.SHAPES[on.shape] : null
  const onF = on ? PIECES.footprint(on) : null
  const pt: P = { x: hit.point.x, y: hit.point.y }
  const up = hit.normal.z > 0.5
  const kind: 's' | 't' = s.tile === 't' ? 't' : 's'
  let cand: Piece | null = null
  const mk = (o: Omit<Piece, 'id' | 'shape'>): Piece => ({ id: '', shape, ...o, rot: norm(o.rot) })

  if (s.at === 'tile') {
    const step = kind === 't' ? 120 : 90
    if (on && onF?.at === 'tile' && onF.poly) {
      const top = onF.z1
      const c = centroid(onF.poly)
      const e = nearestEdge(onF.poly, pt)
      const m = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }
      const sameKind = (onS?.tile === 't' ? 't' : 's') === kind
      if (up && s.family === 'slope' && onS?.family !== 'slope' && sameKind) {
        // сходи, пандус, скат — на саму плиту; піднімаються від найближчого краю
        const T = tileOnEdge(e.a, e.b, { x: 2 * m.x - c.x, y: 2 * m.y - c.y }, kind)
        cand = mk({ x: r6(c.x), y: r6(c.y), z: top, rot: T.rot + turn * step })
      } else {
        // поруч: сусідня плитка через найближчий край, на тій самій висоті; біля ската — на висоті цього його краю, якщо
        // він рівний (верхній — пласка середина даху на верху скатів), інакше — на висоті низу ската
        const T = tileOnEdge(e.a, e.b, c, kind)
        let z = top
        if (onS?.family === 'slope') {
          const poly = onF.poly, hs = (onS as unknown as { hs: number[] }).hs
          const i = poly.findIndex((q) => dist2(q, e.a) < 1e-6), j = poly.findIndex((q) => dist2(q, e.b) < 1e-6)
          z = i >= 0 && j >= 0 && Math.abs(hs[i] - hs[j]) < 1e-6 ? r6(on.z + hs[i]) : on.z
        }
        cand = mk({ x: T.x, y: T.y, z, rot: T.rot + turn * step })
      }
    } else if (on && onF?.at === 'edge' && onF.seg) {
      // на верх стіни: плитка з боку, звідки дивимось (R — з іншого)
      const { a, b } = onF.seg
      const side = { x: pt.x - hit.normal.x, y: pt.y - hit.normal.y } // точка трохи «за» гранню — від неї геть
      const away = turn % 2 ? { x: 2 * pt.x - side.x, y: 2 * pt.y - side.y } : side
      const T = tileOnEdge(a, b, away, kind)
      cand = mk({ x: T.x, y: T.y, z: onF.z1, rot: T.rot + Math.floor(turn / 2) * (kind === 't' ? 120 : 90) })
    } else if (hit.ground || on) {
      // на землю — клітинка сітки (трикутник — на найближчому її краї)
      const cell = cellAt(pt, { x: 0, y: 0 })
      if (kind === 's') {
        const c = centroid(cell.p)
        cand = mk({ x: r6(c.x), y: r6(c.y), z: 0, rot: turn * 90 })
      } else {
        const e = nearestEdge(cell.p, pt)
        const T = tileOnEdge(e.a, e.b, null, 't')
        const inCell = tileOnEdge(e.a, e.b, { x: 2 * (e.a.x + e.b.x) / 2 - T.x, y: 2 * (e.a.y + e.b.y) / 2 - T.y }, 't')
        cand = mk({ x: inCell.x, y: inCell.y, z: 0, rot: inCell.rot + turn * 120 })
      }
    }
    if (cand && s.cat === 'found') cand.z = 0
  } else if (s.at === 'edge') {
    let e: { a: P; b: P } | null = null, z = 0
    let under: number | null = null // спершу спробувати звісити під плиту чи деталь (верх — на цій висоті)
    const h = s.h || 1
    const hangs = s.family === 'wall' || s.family === 'wedge' || s.family === 'shield' // поручні й драбини не звисають
    const chord = on ? PIECES.arcChord(on) : null
    if (on && onF?.at === 'tile' && onF.poly) {
      if (s.arc) { if (chord) { e = chord; z = onF.z1 } }
      else {
        // заокруглена плита: лише прямі краї (дуга — для заокругленого поручня)
        const real = chord ? PIECES.tilePoly('r', on.x, on.y, on.rot) : null
        const cands = real ? [{ a: real[real.length - 1], b: real[0] }, { a: real[0], b: real[1] }] : edgesOf(onF.poly)
        e = cands.reduce((m, q) => (distSeg(pt, q.a, q.b) < distSeg(pt, m.a, m.b) ? q : m))
        z = onF.z1
        if (!up && onS?.cat !== 'found' && hangs) under = onF.z1 - h
      }
    } else if (on && onF?.at === 'edge' && onF.seg && !s.arc) {
      e = onF.seg; z = onF.z1
      if (hangs && hit.point.z < (onF.z0 + onF.z1) / 2) under = onF.z0 - h
    }
    else if (hit.ground && !s.arc) { e = nearestEdge(cellSquare(Math.floor(pt.x), Math.floor(pt.y)).p, pt); z = 0 }
    if (e && s.arc) {
      // дуга: бік не перемикається (вигин — завжди назовні)
      const { a, b } = e
      cand = mk({ x: r6((a.x + b.x) / 2), y: r6((a.y + b.y) / 2), z, rot: deg(b.x - a.x, b.y - a.y) })
    } else if (e) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y
      let a = e.a, b = e.b
      const len = s.len || 1
      if (len > 1 && Math.hypot(dx, dy) < len - EPS) {
        // широка деталь: на кілька країв поспіль — у бік курсора
        const t = ((pt.x - e.a.x) * dx + (pt.y - e.a.y) * dy) / (dx * dx + dy * dy)
        if (t > 0.5) b = { x: e.a.x + dx * len, y: e.a.y + dy * len }
        else a = { x: e.b.x - dx * len, y: e.b.y - dy * len }
      }
      const rot = deg(b.x - a.x, b.y - a.y) + (turn % 2) * 180
      const at = (zz: number) => mk({ x: r6((a.x + b.x) / 2), y: r6((a.y + b.y) / 2), z: r6(zz), rot })
      if (under !== null && under >= -EPS) {
        const hang = at(under)
        const r = check(hang, pieces)
        if (r.ok) return { piece: hang, ...r }
      }
      cand = at(z)
    }
  } else {
    // колона: найближчий кут плити чи її центр, на її верху; на колону — вище
    if (on && onF?.at === 'tile' && onF.poly) {
      const v = [...onF.poly, centroid(onF.poly)].reduce((m, q) => (dist2(q, pt) < dist2(m, pt) ? q : m))
      cand = mk({ x: r6(v.x), y: r6(v.y), z: onF.z1, rot: 0 })
    } else if (on && onF?.at === 'vertex' && onF.pt) cand = mk({ x: onF.pt.x, y: onF.pt.y, z: onF.z1, rot: 0 })
    else if (hit.ground) cand = mk({ x: Math.round(pt.x), y: Math.round(pt.y), z: 0, rot: 0 })
  }
  if (!cand) return null
  return { piece: cand, ...check(cand, pieces) }
}

/** чи можна поставити: не налазить і має опору */
export function check(p: Piece, pieces: Piece[]): { ok: boolean; why?: string } {
  const s = PIECES.SHAPES[p.shape]
  const near = pieces.filter((q) => Math.abs(q.x - p.x) < 2.6 && Math.abs(q.y - p.y) < 2.6)
  const by = near.find((q) => q.id !== p.id && PIECES.clash(p, q))
  if (by) return { ok: false, why: t('Тут уже {shape}', { shape: PIECES.SHAPES[by.shape] ? low(lab(PIECES.SHAPES[by.shape].name)) : t('деталь') }) }
  if (s.cat === 'found') return p.z === 0 ? { ok: true } : { ok: false, why: t('Фундамент — лише на землі') }
  const f = PIECES.footprint(p)
  const base = f.at === 'tile' && (s.family === 'slab' || s.family === 'shield') ? p.z : f.z0 // низ: плита — її верх, решта — низ
  // на землю (без фундаменту під собою) — лише фундамент; решта шукає опору нижче, як у грі
  const tops = (q: Piece) => PIECES.footprint(q).z1
  const sameZ = (v: number) => Math.abs(v - base) < 1e-3
  const segs = (q: Piece) => {
    const fq = PIECES.footprint(q)
    if (fq.seg) return [fq.seg]
    const chord = PIECES.arcChord(q)
    if (chord) { const real = PIECES.tilePoly('r', q.x, q.y, q.rot); return [chord, { a: real[real.length - 1], b: real[0] }, { a: real[0], b: real[1] }] }
    if (fq.poly) return edgesOf(fq.poly)
    return []
  }
  const onLine = (e: { a: P; b: P }, g: { a: P; b: P }) => distSeg(e.a, g.a, g.b) < 1e-3 && distSeg(e.b, g.a, g.b) < 1e-3
  const myEdges = f.seg ? [f.seg] : f.poly ? edgesOf(f.poly) : []
  const myPts: P[] = f.pt ? [f.pt] : f.poly ? f.poly : f.seg ? [f.seg.a, f.seg.b] : []
  for (const q of near) {
    if (q.id === p.id) continue
    const qs = PIECES.SHAPES[q.shape]
    if (!qs) continue
    const fq = PIECES.footprint(q)
    // стоїть на верху деталі: край на краю (стіна на плиті, плита на стіні), точка на вершині
    if (sameZ(tops(q))) {
      if (myEdges.some((e) => segs(q).some((g) => onLine(e, g) || onLine(g, e)))) return { ok: true }
      if (fq.pt && myPts.some((v) => dist2(v, fq.pt!) < 1e-6)) return { ok: true }
      if (f.at === 'tile' && fq.poly && dist2(centroid(fq.poly), { x: p.x, y: p.y }) < 1e-6) return { ok: true }
      if (f.at === 'vertex' && fq.poly && (fq.poly.some((v) => dist2(v, f.pt!) < 1e-6) || dist2(centroid(fq.poly), f.pt!) < 1e-6)) return { ok: true }
    }
    // звисає: верх деталі на краю — на рівні верху плити над нею чи низу деталі над нею на тому ж краї
    if (f.at === 'edge' && f.seg) {
      const slabAbove = (qs.family === 'slab' || (qs.family === 'shield' && qs.at === 'tile')) && Math.abs(q.z - f.z1) < 1e-3
      const pieceAbove = fq.at === 'edge' && Math.abs(fq.z0 - f.z1) < 1e-3
      if ((slabAbove || pieceAbove) && segs(q).some((g) => onLine(f.seg!, g) || onLine(g, f.seg!))) return { ok: true }
    }
    // плита поруч на тій самій висоті (перекриття тримається за сусіднє)
    if (f.at === 'tile' && fq.at === 'tile' && (qs.family === 'slab') && sameZ(q.z) && fq.poly && myEdges.some((e) => edgesOf(fq.poly!).some((g) => onLine(e, g)))) return { ok: true }
  }
  return { ok: false, why: base <= EPS ? t('На голу землю — лише фундамент: спершу постав фундамент') : t('Нема опори: постав на плиту, стіну чи поруч із плитою на тій самій висоті') }
}

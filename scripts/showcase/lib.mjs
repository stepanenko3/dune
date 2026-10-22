/*
 * Конструктор показових баз з деталей гри (format 2) — для scripts/seed-showcase.mjs. Базу описують блоками (плитки,
 * висота, дах, похилі стіни), а finish() перетворює їх на деталі гри: фундаменти й перекриття, стіни по межі блоку
 * (спільна стіна двох блоків — одна), похилі стіни й скатні дахи (як у конвертері), потім виконує правки по черзі
 * (прорізи, щити, сходи, поручні, колони) і перевіряє результат: деталі не перетинаються (PIECES.clash), стабільність
 * (STABILITY) не нижча за поріг, усе — в межах ділянок.
 *
 * Плитки — { k: 's' | 't', x, y, rot, p, key }: квадрати на сітці й трикутники, прикладені до краю; сітки можна
 * повертати (крила під 30°, шестикутники). Висоти — у блоках (стіна = 1).
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
export const PIECES = require('../../src/engine/pieces.js')
export const STABILITY = require('../../src/engine/stability.js')
export const BASEDATA = require('../../src/engine/hydrate.js')
const CONVERT = require('../../src/engine/convert.js')
const PRESETS = require('../../src/components/base/builder/presets.json')

export const RT3 = Math.sqrt(3)
const RI = PIECES.RI
export const r6 = (v) => Math.round(v * 1e6) / 1e6
const deg = (a, b) => r6((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI)
export const kp = (q) => PIECES.keyOf(q)
export const ek = (a, b) => { const ka = kp(a), kb = kp(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka }
const zk = (z) => String(Math.round(z * 100) / 100)
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const centroid = (ps) => ({ x: ps.reduce((s, q) => s + q.x, 0) / ps.length, y: ps.reduce((s, q) => s + q.y, 0) / ps.length })

// ---------- плитки ----------
export function tile(k, x, y, rot = 0) {
  const p = PIECES.tilePoly(k, x, y, rot)
  return { k, x: r6(x), y: r6(y), rot: r6(rot), p, key: kp({ x, y }) }
}
export const sq = (x, y, rot = 0) => tile('s', x, y, rot)
/** квадрати прямокутника з цілими межами [x0, x1) × [y0, y1) */
export function rect(x0, x1, y0, y1) {
  const out = []
  for (let x = x0; x < x1 - 1e-9; x++) for (let y = y0; y < y1 - 1e-9; y++) out.push(sq(x + 0.5, y + 0.5))
  return out
}
/** трикутник на краю a → b, вершина — ліворуч від напряму */
export function triOn(a, b) {
  const L = Math.hypot(b.x - a.x, b.y - a.y)
  const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L
  const m = mid(a, b)
  return tile('t', m.x - uy * RI, m.y + ux * RI, deg(a, b))
}
/** квадрат на краю a → b, ліворуч від напряму */
export function sqOn(a, b) {
  const L = Math.hypot(b.x - a.x, b.y - a.y)
  const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L
  const m = mid(a, b)
  return sq(m.x - uy * 0.5, m.y + ux * 0.5, deg(a, b))
}
/** трикутна сітка від точки o під кутом th (градуси): трикутники, чий центр задовольняє pred */
export function triGrid(o, th, pred, R = 30) {
  const t = (th * Math.PI) / 180
  const U = { x: Math.cos(t), y: Math.sin(t) }, V = { x: Math.cos(t + Math.PI / 3), y: Math.sin(t + Math.PI / 3) }
  const at = (i, j) => ({ x: o.x + i * U.x + j * V.x, y: o.y + i * U.y + j * V.y })
  const out = []
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
    const A = at(i, j), B = at(i + 1, j), C = at(i, j + 1), D = at(i + 1, j + 1)
    for (const tr of [triOn(A, B), triOn(D, C)]) if (pred(tr)) out.push(tr)
  }
  return out
}
/** квадратна сітка від точки o під кутом th: квадрати (i, j), що задовольняють pred(tile, i, j) */
export function sqGrid(o, th, i0, i1, j0, j1, pred = () => true) {
  const t = (th * Math.PI) / 180
  const U = { x: Math.cos(t), y: Math.sin(t) }, W = { x: -Math.sin(t), y: Math.cos(t) }
  const out = []
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
    const s = sq(o.x + (i + 0.5) * U.x + (j + 0.5) * W.x, o.y + (i + 0.5) * U.y + (j + 0.5) * W.y, th)
    if (pred(s, i, j)) out.push(s)
  }
  return out
}
/** точка всередині опуклого многокутника (вершини проти годинникової) */
export function inConvex(q, poly, eps = 1e-6) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    if ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x) < -eps) return false
  }
  return true
}
/** вершини правильного многокутника */
export function ngon(c, r, n, th0 = 0) {
  return Array.from({ length: n }, (_, i) => { const t = ((th0 + (360 * i) / n) * Math.PI) / 180; return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) } })
}
/** шестикутник зі стороною s (трикутна сітка): центр c — вершина сітки; th — кут першої вершини */
export function hexTiles(c, s, th = 0) {
  const poly = ngon(c, s, 6, th)
  return triGrid(c, th, (t) => inConvex({ x: t.x, y: t.y }, poly))
}
/**
 * дванадцятикутник: шестикутник зі стороною s, на кожній стороні — смуга квадратів (s × 1) назовні, між смугами —
 * трикутник. Вершини шестикутника — від кута th
 */
export function dodecaTiles(c, s, th = 0) {
  const hex = hexTiles(c, s, th)
  const V = ngon(c, s, 6, th)
  const out = [...hex]
  for (let i = 0; i < 6; i++) {
    const a = V[i], b = V[(i + 1) % 6]
    // смуга на стороні a→b назовні: зовнішня нормаль — праворуч від a→b (шестикутник проти годинникової)
    for (let k = 0; k < s; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / s, y: a.y + ((b.y - a.y) * k) / s }, q = { x: a.x + ((b.x - a.x) * (k + 1)) / s, y: a.y + ((b.y - a.y) * (k + 1)) / s }
      out.push(sqOn(q, p))
    }
  }
  // кутові трикутники: між зовнішніми кутами сусідніх смуг
  for (let i = 0; i < 6; i++) {
    const v = V[i], prev = V[(i + 5) % 6], next = V[(i + 1) % 6]
    const nOut = (a, b) => { const L = Math.hypot(b.x - a.x, b.y - a.y); return { x: (b.y - a.y) / L, y: -(b.x - a.x) / L } }
    const n1 = nOut(prev, v), n2 = nOut(v, next)
    const p1 = { x: v.x + n1.x, y: v.y + n1.y }, p2 = { x: v.x + n2.x, y: v.y + n2.y }
    // вершина трикутника — v, основа p1–p2 (назовні); вершина ліворуч від напряму основи
    out.push((p2.x - p1.x) * (v.y - p1.y) - (p2.y - p1.y) * (v.x - p1.x) > 0 ? triOn(p1, p2) : triOn(p2, p1))
  }
  return out
}
/** межові краї набору плиток: { a, b } — усередині ліворуч від a → b */
export function boundary(tiles) {
  const cnt = new Map()
  for (const t of tiles) for (let i = 0; i < t.p.length; i++) { const k = ek(t.p[i], t.p[(i + 1) % t.p.length]); cnt.set(k, (cnt.get(k) || 0) + 1) }
  const out = []
  for (const t of tiles) for (let i = 0; i < t.p.length; i++) {
    const a = t.p[i], b = t.p[(i + 1) % t.p.length]
    if (cnt.get(ek(a, b)) === 1) out.push(edgeInfo(a, b, t))
  }
  return out
}
function edgeInfo(a, b, t) {
  const m = mid(a, b), L = Math.hypot(b.x - a.x, b.y - a.y)
  return { a, b, m, rot: deg(a, b), out: { x: (b.y - a.y) / L, y: -(b.x - a.x) / L }, t, key: ek(a, b) }
}
/** ділимо відрізок на одиничні краї */
export function unitEdges(a, b) {
  const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)))
  const out = []
  for (let i = 0; i < n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, q = { x: a.x + ((b.x - a.x) * (i + 1)) / n, y: a.y + ((b.y - a.y) * (i + 1)) / n }
    out.push(edgeInfo(p, q, null))
  }
  return out
}
export const without = (tiles, drop) => { const k = new Set(drop.map((t) => t.key)); return tiles.filter((t) => !k.has(t.key)) }
export const uniq = (tiles) => { const seen = new Set(); return tiles.filter((t) => !seen.has(t.key) && seen.add(t.key)) }

// ---------- база ----------
const SLAB = { found: { s: 'Sardaukar_Foundation', t: 'Sardaukar_Foundation_Wedge' }, floor: { s: 'Sardaukar_Floor_02', t: 'Sardaukar_Floor_Wedge' }, roof: { s: 'Sardaukar_Rooftop_01', t: 'Sardaukar_Rooftop_Wedge' } }
const RANK = { found: 3, floor: 2, roof: 1 }

export function createBase(prefix) {
  const slabs = new Map() // плитка|z → деталь (і cat)
  const edges = new Map() // середина краю|z → деталь
  const tilesAt = new Map() // скати, сходи, похилі стіни: плитка|z → деталь
  const verts = new Map()
  const extra = [] // широкі деталі (ворота) і все інше
  const blocks = []
  const later = []
  const items = []
  const zones = []
  const notes = []
  let n = 0
  const id = () => `${prefix}${(n++).toString(36)}`

  const mk = (shape, x, y, z, rot = 0) => ({ id: id(), shape, x: r6(x), y: r6(y), z: r6(z), rot: r6(((rot % 360) + 540) % 360 - 180) })
  const B = {
    blocks, items, zones, notes,
    /** плита на плитці: фундамент, перекриття чи дах; сильніша (фундамент > перекриття > дах) витісняє слабшу */
    slab(t, z, cat) {
      const k = t.key + '|' + zk(z)
      const was = slabs.get(k)
      if (was && RANK[was.cat] >= RANK[cat]) return was
      const p = mk(SLAB[cat][t.k], t.x, t.y, z, t.rot)
      p.cat = cat
      slabs.set(k, p)
      return p
    },
    slabAt: (t, z) => slabs.get(t.key + '|' + zk(z)),
    dropSlab(t, z) { slabs.delete(t.key + '|' + zk(z)) },
    shieldFloor(t, z) { const p = mk('Choam_PentashieldSurfaceHorizontal_Placeable', t.x, t.y, z, t.rot); p.cat = 'shield'; slabs.set(t.key + '|' + zk(z), p) },
    /** деталь на краю (одиничному) на висоті z; force — замінити наявну */
    edge(e, z, shape, force = false) {
      const k = kp(e.m) + '|' + zk(z)
      if (edges.has(k) && !force) return edges.get(k)
      const p = mk(shape, e.m.x, e.m.y, z, e.rot)
      edges.set(k, p)
      return p
    },
    edgeAt: (m, z) => edges.get(kp(m) + '|' + zk(z)),
    dropEdge(m, z) { return edges.delete(kp(m) + '|' + zk(z)) },
    /** деталь на плитці (скат, сходи, похила стіна) */
    tileShape(t, z, shape, rot) {
      const k = t.key + '|' + zk(z) + '|' + shape
      const p = mk(shape, t.x, t.y, z, rot ?? t.rot)
      tilesAt.set(k, p)
      return p
    },
    raw(shape, x, y, z, rot = 0) { const p = mk(shape, x, y, z, rot); extra.push(p); return p },
    vertex(shape, x, y, z) { const p = mk(shape, x, y, z, 0); verts.set(kp({ x, y }) + '|' + zk(z), p); return p },

    /**
     * блок: плитки, низ z, висота h (стіни), дах ('flat' | 'hip' | 'pyramid' | 'none'), похилі стіни (lean: true —
     * на всіх зовнішніх краях, крім leanSkip(e)), wall(e, i) — що на краї e в i-му ряду: назва форми, null — стіна,
     * 'skip' — нічого; zone — { name, group } приміщення
     */
    block(spec) { blocks.push({ roof: 'flat', floor: true, ...spec }); return spec },
    /** правка після того, як блоки стали деталями (по черзі) */
    after(fn) { later.push(fn) },

    // ---------- правки ----------
    /** прибрати стіни на одиничних краях відрізка a → b у рядах z0 … z1 − 1 */
    open(a, b, z0, z1) { for (const e of unitEdges(a, b)) for (let z = z0; z < z1; z++) B.dropEdge(e.m, z) },
    /** заповнити відрізок деталлю (стіна, вікно…) у рядах z0 … z1 − 1, замінюючи наявне */
    fill(a, b, z0, z1, shape = 'Sardaukar_Wall_01') { for (const e of unitEdges(a, b)) for (let z = z0; z < z1; z++) B.edge(e, z, shape, true) },
    /** двері на одиничному краї з серединою m: висока (2 ряди) чи звичайна */
    door(a, b, z, shape = 'Atreides_Outpost_Door_Frame_Tall') {
      const [e] = unitEdges(a, b)
      const h = PIECES.SHAPES[shape].h
      if (!B.edgeAt(e.m, z)) throw new Error(`двері: на краї ${kp(e.m)} z${z} нема стіни`)
      for (let i = 0; i < h; i++) B.dropEdge(e.m, z + i)
      return B.edge(e, z, shape, true)
    },
    /** великі ворота 3 × 2: a → b — три одиничні краї поспіль */
    gate(a, b, z) {
      for (const e of unitEdges(a, b)) for (const dz of [0, 1]) B.dropEdge(e.m, z + dz)
      const g = mk('Atreides_Outpost_Gate_Big', (a.x + b.x) / 2, (a.y + b.y) / 2, z, deg(a, b))
      extra.push(g)
      return g
    },
    /** вертикальний пентащит: прямокутник a → b, ряди z0 … z1 − 1 */
    shield(a, b, z0, z1) { for (const e of unitEdges(a, b)) for (let z = z0; z < z1; z++) B.edge(e, z, 'Choam_PentashieldSurfaceVertical_Placeable', true) },
    /** поручні по відрізку на висоті z, де нема стіни */
    rail(a, b, z, shape = 'Sardaukar_Railing') { for (const e of unitEdges(a, b)) if (!B.edgeAt(e.m, z)) B.edge(e, z, shape) },
    /** поручні по межі плиток (тераса, балкон), крім країв, де skip(e) */
    railAround(tiles, z, skip = () => false) { for (const e of boundary(tiles)) if (!skip(e) && !B.edgeAt(e.m, z)) B.edge(e, z, 'Sardaukar_Railing') },
    /** колона у вершині від z0 до z1 */
    column(x, y, z0, z1) {
      const h = z1 - z0
      for (let i = 0; i < h; i++) B.vertex(h === 1 ? 'Sardaukar_Pillar_Middle' : i === 0 ? 'Sardaukar_Pillar_Bottom' : i === h - 1 ? 'Sardaukar_Pillar_Top' : 'Sardaukar_Pillar_Middle', x, y, z0 + i)
    },
    /**
     * сходи: перша плитка — центр (x, y), далі в напрямку dir (градуси), кожна на блок вище; прибирає плиту над
     * трьома верхніми сходинками (проріз у перекритті) — повертає плитки прорізу
     */
    stairs(x, y, dir, z0, n, { shape = 'Sardaukar_Stairs', hole = 3, rot0 = 0 } = {}) {
      const t = (dir * Math.PI) / 180, u = { x: Math.cos(t), y: Math.sin(t) }
      const holes = []
      for (let i = 0; i < n; i++) {
        const tl = sq(x + u.x * i, y + u.y * i, rot0)
        B.tileShape(tl, z0 + i, shape, dir - 90)
        if (i >= n - hole) { B.dropSlab(tl, z0 + n); holes.push(tl) }
        // плита на рівні сходинки (крім низу) — заважала б
        for (let z = z0 + 1; z < z0 + n; z++) if (z <= z0 + i) B.dropSlab(tl, z)
      }
      return holes
    },
    /** драбина по краю a → b (на лиці стіни) від z0 до z1 і люк над нею на плитці t */
    ladder(a, b, z0, z1, hatchTile) {
      const [e] = unitEdges(a, b)
      for (let z = z0; z < z1; z++) extra.push(mk('Choam_Level2_Ladder', e.m.x, e.m.y, z, e.rot))
      if (hatchTile) { B.dropSlab(hatchTile, z1); const p = mk('Choam_Level2_Hatch', hatchTile.x, hatchTile.y, z1, hatchTile.rot); p.cat = 'floor'; slabs.set(hatchTile.key + '|' + zk(z1), p) }
    },

    /** люк на плитці t на висоті z (замість плити) */
    ladderHatch(t, z) { B.dropSlab(t, z); const p = mk('Choam_Level2_Hatch', t.x, t.y, z, t.rot); p.cat = 'floor'; slabs.set(t.key + '|' + zk(z), p) },

    // ---------- станції й приміщення ----------
    /** станція з палітри: type — вид гри (presets.json), c — центр, z — підлога, ang — поворот */
    item(type, x, y, z = 0, ang = 0, name) {
      const pr = PRESETS.items.find((p) => p.type === type)
      if (!pr) throw new Error('нема станції ' + type)
      const it = { type, name: name || pr.name, kind: pr.kind, group: pr.group, w: pr.w, d: pr.d, h: pr.h, c: { x: r6(x), y: r6(y) }, z, ang }
      items.push(it)
      return it
    },
    /** ряд однакових станцій від (x, y) з кроком (dx, dy) */
    row(type, x, y, z, nItems, dx, dy, ang = 0) { for (let i = 0; i < nItems; i++) B.item(type, x + dx * i, y + dy * i, z, ang) },
    zone(name, group, z, tiles, extraFields = {}) { zones.push({ id: 'z' + prefix + zones.length, name, group, z, tiles: [...new Set(tiles.map((t) => t.key))], ...extraFields }) },

    finish() {
      materialize()
      for (const fn of later) fn(B)
      const pieces = [...slabs.values(), ...edges.values(), ...tilesAt.values(), ...verts.values(), ...extra].map(({ cat, ...p }) => p) // eslint-disable-line no-unused-vars
      return pieces
    },
  }

  /** блоки → деталі */
  function materialize() {
    // хто ще стоїть на краї: для похилих стін (поруч інший блок на тій самій висоті — не похила)
    const edgeOwners = new Map()
    blocks.forEach((b, bi) => {
      for (const t of b.tiles) for (let i = 0; i < t.p.length; i++) {
        const k = ek(t.p[i], t.p[(i + 1) % t.p.length])
        if (!edgeOwners.has(k)) edgeOwners.set(k, [])
        edgeOwners.get(k).push({ bi, z0: b.z, z1: b.z + Math.max(b.h, 0.5) })
      }
    })
    // плити: спершу всі підлоги, потім стіни, потім дахи (дах не лягає туди, де вже підлога вищого блоку)
    for (const b of blocks) if (b.floor) for (const t of b.tiles) B.slab(t, b.z, b.z === 0 ? 'found' : 'floor')
    const roofs = []
    blocks.forEach((b, bi) => {
      const ext = boundary(b.tiles)
      const z = b.z, h = b.h
      let ring = new Set(), leanEdges = new Set(), inner = []
      const endWedge = new Map() // зовнішній торець плитки з похилою стіною: висока трикутна стіна по профілю
      if (b.lean && h >= 3) {
        const shared = (e) => (edgeOwners.get(e.key) || []).some((o) => o.bi !== bi && o.z0 < z + 3 - 1e-6 && o.z1 > z + 1e-6)
        const ok = ext.filter((e) => !shared(e) && !(b.leanSkip && b.leanSkip(e)))
        const okK = new Set(ok.map((e) => e.key))
        for (const t of b.tiles) {
          if (t.k !== 's') continue
          const es = t.p.map((a, i) => edgeInfo(a, t.p[(i + 1) % t.p.length], t))
          const oe = es.filter((e) => okK.has(e.key))
          const c = { x: t.x, y: t.y }
          let shape = null, rot = 0
          if (oe.length === 1) { shape = b.leanShape || 'Harkonnen_Outpost_Wall_Inclined_Tall'; rot = oe[0].rot }
          else if (oe.length === 2) {
            const sh = [oe[0].a, oe[0].b].find((q) => kp(q) === kp(oe[1].a) || kp(q) === kp(oe[1].b))
            if (sh) {
              const u1 = kp(oe[0].a) === kp(sh) ? oe[0].b : oe[0].a, u2 = kp(oe[1].a) === kp(sh) ? oe[1].b : oe[1].a
              shape = 'Harkonnen_Outpost_Wall_Corner_Tall'
              const dx = u1.x - sh.x, dy = u1.y - sh.y
              rot = (u2.x - sh.x) * -dy + (u2.y - sh.y) * dx > 0 ? deg(sh, u1) : deg(sh, u2)
            }
          }
          if (!shape) continue
          void c
          ring.add(t.key)
          for (const e of oe) leanEdges.add(e.key)
          B.tileShape(t, z, shape, rot)
          // торці: зовнішній край цієї ж плитки без похилої (і без сусіднього блоку), що сходиться з похилою кутом —
          // не пряма стіна на всю висоту (стирчала б за похилу), а висока трикутна стіна: низ — на лінії фасаду, верх —
          // на внутрішній лінії
          for (const f of es) {
            if (okK.has(f.key) || shared(f) || !ext.some((g) => g.key === f.key)) continue
            for (const g of oe) {
              const P = [g.a, g.b].find((q) => kp(q) === kp(f.a) || kp(q) === kp(f.b))
              if (!P) continue
              const I = kp(f.a) === kp(P) ? f.b : f.a
              endWedge.set(f.key, { O: P, I, m: f.m })
            }
          }
        }
        // внутрішня лінія — краї між плиткою з похилою стіною і плиткою без неї
        const own = new Map()
        for (const t of b.tiles) for (let i = 0; i < t.p.length; i++) {
          const k = ek(t.p[i], t.p[(i + 1) % t.p.length])
          if (!own.has(k)) own.set(k, [])
          own.get(k).push({ t, a: t.p[i], b: t.p[(i + 1) % t.p.length] })
        }
        for (const list of own.values()) {
          if (list.length !== 2) continue
          const inA = ring.has(list[0].t.key), inB = ring.has(list[1].t.key)
          // напрям: «усередині» (не кільце) — ліворуч
          if (inA !== inB) { const it = inA ? list[1] : list[0]; inner.push(edgeInfo(it.a, it.b, it.t)) }
        }
        // кінці похилої ділянки біля прямої стіни — висока трикутна стіна
        const le = ext.filter((e) => leanEdges.has(e.key))
        for (const e of inner) for (const [P, I] of [[e.a, e.b], [e.b, e.a]]) {
          const f = le.find((g) => kp(g.a) === kp(P) || kp(g.b) === kp(P))
          if (!f) continue
          const ux = f.b.x - f.a.x, uy = f.b.y - f.a.y, vx = I.x - P.x, vy = I.y - P.y
          if (Math.abs(ux * vy - uy * vx) < 1e-6) continue
          B.tileShape({ key: kp(mid(P, I)) + 'tw', x: (P.x + I.x) / 2, y: (P.y + I.y) / 2 }, z, 'Sardaukar_Wall_Triangle_Top_Tall_Left', deg(P, I))
        }
      }
      for (const { O, I, m } of endWedge.values()) B.tileShape({ key: kp(m) + 'ew', x: m.x, y: m.y }, z, 'Sardaukar_Wall_Triangle_Bottom_Tall_Right', deg(O, I))
      // стіни по межі (крім похилих рядів і торців похилих)
      for (const e of ext) for (let i = 0; i < h; i++) {
        if (endWedge.has(e.key)) continue
        if (leanEdges.has(e.key) && i < 3) continue
        if (leanEdges.has(e.key)) continue // вище похилої — стіна на внутрішній лінії
        const w = b.wall ? b.wall(e, i) : null
        if (w === 'skip') continue
        B.edge(e, z + i, w || 'Sardaukar_Wall_01')
      }
      for (const e of inner) for (let i = 3; i < h; i++) {
        const w = b.wall ? b.wall(e, i) : null
        if (w === 'skip') continue
        B.edge(e, z + i, w || 'Sardaukar_Wall_01')
      }
      const top = b.lean && h >= 3 ? b.tiles.filter((t) => !ring.has(t.key)) : b.tiles
      // похила стіна до самого верху (h = 3) — над кільцем дах не потрібен
      if (b.roof !== 'none') roofs.push({ b, tiles: top, z: z + h })
      if (b.zone) B.zone(b.zone.name, b.zone.group, z, b.tiles, b.zone.extra || {})
    })
    for (const { b, tiles, z } of roofs) {
      const above = (t) => { const s = B.slabAt(t, z); return s && s.cat !== 'roof' }
      if (b.roof === 'flat') { for (const t of tiles) if (!above(t)) B.slab(t, z, 'roof'); continue }
      const rr = CONVERT.ringRoof(tiles.map((t) => ({ k: t.k, p: t.p })), z, b.roof === 'pyramid', (t) => above(tile(t.k, centroid(t.p).x, centroid(t.p).y)), b.sky || (() => false))
      for (const p of rr) {
        const t = { key: kp(p), x: p.x, y: p.y, k: PIECES.SHAPES[p.shape].tile === 't' ? 't' : 's', rot: p.rot }
        if (p.shape === 'Sardaukar_Rooftop_01' || p.shape === 'Sardaukar_Rooftop_Wedge') B.slab(t, p.z, 'roof')
        else if (p.shape === 'Choam_PentashieldSurfaceHorizontal_Placeable') B.shieldFloor(t, p.z)
        else B.tileShape(t, p.z, p.shape, p.rot)
      }
    }
  }
  return B
}

// ---------- перевірки ----------
/** перетини деталей, стабільність, межі ділянок */
export function check(pieces, items, claims, { minStab = 20 } = {}) {
  const S = PIECES.SHAPES
  const bad = pieces.filter((p) => !S[p.shape])
  if (bad.length) throw new Error('невідомі форми: ' + [...new Set(bad.map((p) => p.shape))].join(', '))
  // перетини: кошики за точкою прив'язки (одиничні краї широких деталей — окремо)
  const bucket = new Map()
  const add = (k, p) => { if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(p) }
  for (const p of pieces) {
    const f = PIECES.footprint(p)
    if (f.at === 'edge') for (const e of unitEdges(f.seg.a, f.seg.b)) add('e' + kp(e.m), p)
    else if (f.at === 'tile') add('t' + kp(p), p)
    else add('v' + kp(p), p)
  }
  const clashes = []
  for (const list of bucket.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (PIECES.clash(list[i], list[j])) clashes.push([list[i], list[j]])
  // стабільність
  const st = STABILITY.compute(pieces)
  const weak = pieces.filter((p) => !S[p.shape].shield && S[p.shape].family !== 'rail' && S[p.shape].family !== 'ladder' && (st.get(p.id) ?? 0) < minStab)
  // межі
  const inClaims = (q) => claims.some((c) => q.x >= c.x - 1e-6 && q.x <= c.x + c.w + 1e-6 && q.y >= c.y - 1e-6 && q.y <= c.y + c.d + 1e-6)
  const outside = pieces.filter((p) => {
    const f = PIECES.footprint(p)
    const pts = f.at === 'tile' ? f.poly : f.at === 'edge' ? [f.seg.a, f.seg.b] : [f.pt]
    return !pts.every(inClaims)
  })
  const itemsOut = items.filter((it) => !inClaims(it.c))
  let min = 100
  for (const p of pieces) { const v = st.get(p.id); if (v !== undefined && !S[p.shape].shield && S[p.shape].family !== 'rail' && S[p.shape].family !== 'ladder') min = Math.min(min, v) }
  return { clashes, weak, outside, itemsOut, min, st }
}

/** документ бази: деталі, станції, приміщення, рівні (назви по висотах), підписи */
export function makeDoc({ claims, pieces, items, zones, ui, levelNames = {}, views }) {
  const doc = { format: 2, claims, pieces, items, zones, heights: {}, ui: { ...ui } }
  const zs = PIECES.floorHeights(pieces)
  const KEYS = 'gutabcdefhijklmnopqsvwxyz'
  doc.levels = zs.map((z, i) => {
    const nm = levelNames[z] || []
    return { key: KEYS[i], name: nm[0] || (z === 0 ? 'Рівень 0' : `Рівень +${String(z).replace('.', ',')}`), sub: nm[1] || '', z0: z, z1: zs[i + 1] ?? z + 3 }
  })
  if (levelNames.roof) doc.levels.push({ key: 'r', name: 'Дах', sub: levelNames.roof, z0: 0, z1: 99 })
  BASEDATA.syncDoc(doc)
  doc.bounds = BASEDATA.boundsOf(claims)
  // камери: свої (висока база) чи типові від ділянок
  doc.ui.views = views || BASEDATA.viewsOf(doc.bounds)
  doc.ui.claimsText = `${claims.length} ділянок`
  return doc
}
export const claim = (cx, cy) => ({ x: cx * 10, y: cy * 10, w: 10, d: 10 })

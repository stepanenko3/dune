// Перевірка моделі: межі ділянок, перекриття плиток, предмети всередині приміщень.
// Запуск: node tools/check-model.js
'use strict';
const M = require('../src/model.js');

const EPS = 1e-6;
const fmt = (n) => n.toFixed(2);

function shrink(poly, k = 0.02) {
  const c = M.centroid(poly);
  return poly.map((p) => M.V(p.x + (c.x - p.x) * k, p.y + (c.y - p.y) * k));
}
function axes(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    out.push(M.V(-(b.y - a.y), b.x - a.x));
  }
  return out;
}
function overlap(p, q) {
  for (const ax of [...axes(p), ...axes(q)]) {
    let pmin = Infinity, pmax = -Infinity, qmin = Infinity, qmax = -Infinity;
    for (const v of p) { const d = v.x * ax.x + v.y * ax.y; pmin = Math.min(pmin, d); pmax = Math.max(pmax, d); }
    for (const v of q) { const d = v.x * ax.x + v.y * ax.y; qmin = Math.min(qmin, d); qmax = Math.max(qmax, d); }
    if (pmax <= qmin + EPS || qmax <= pmin + EPS) return false;
  }
  return true;
}
const bbox = (poly) => ({
  x0: Math.min(...poly.map((p) => p.x)), x1: Math.max(...poly.map((p) => p.x)),
  y0: Math.min(...poly.map((p) => p.y)), y1: Math.max(...poly.map((p) => p.y)),
});

let problems = 0;
const warn = (msg) => { problems++; console.log('  ! ' + msg); };

// 1. межі ділянок
console.log('Межі ділянок (x -10..10, y 0..30):');
for (const r of M.rooms)
  for (const t of r.tiles)
    for (const p of t.p)
      if (p.x < M.bounds.x0 - EPS || p.x > M.bounds.x1 + EPS || p.y < M.bounds.y0 - EPS || p.y > M.bounds.y1 + EPS) {
        warn(`${r.id}: вершина (${fmt(p.x)}, ${fmt(p.y)}) поза ділянками`);
        break;
      }

// 2. перекриття в межах однієї приміщення і між приміщеннями з перетином по висоті
console.log('Перекриття плиток:');
const zr = (r) => (r.h === 0 ? [r.z0, r.z0 + 0.01] : [r.z0, r.z0 + r.h]);
const flat = [];
for (const r of M.rooms) for (const t of r.tiles) flat.push({ r, t: shrink(t.p), b: bbox(t.p) });
let pairs = 0;
for (let i = 0; i < flat.length; i++)
  for (let j = i + 1; j < flat.length; j++) {
    const A = flat[i], B = flat[j];
    const [a0, a1] = zr(A.r), [b0, b1] = zr(B.r);
    if (a1 <= b0 + EPS || b1 <= a0 + EPS) continue;
    if (A.r.inside === B.r.id || B.r.inside === A.r.id) continue;
    if (A.b.x1 < B.b.x0 || B.b.x1 < A.b.x0 || A.b.y1 < B.b.y0 || B.b.y1 < A.b.y0) continue;
    if (overlap(A.t, B.t)) {
      pairs++;
      if (pairs <= 12) warn(`${A.r.id} x ${B.r.id} біля (${fmt(M.centroid(A.t).x)}, ${fmt(M.centroid(A.t).y)})`);
    }
  }
if (pairs > 12) console.log(`  ... всього пар: ${pairs}`);

// 3. предмети всередині своїх приміщень (по кутах прямокутника)
console.log('Предмети в приміщеннях:');
const corners = (it) => {
  const a = (it.ang * Math.PI) / 180;
  const u = M.V(Math.cos(a), Math.sin(a)), v = M.V(-Math.sin(a), Math.cos(a));
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) =>
    M.V(it.c.x + (u.x * s * it.w) / 2 + (v.x * t * it.d) / 2, it.c.y + (u.y * s * it.w) / 2 + (v.y * t * it.d) / 2)
  );
};
const inTiles = (p, tiles) => tiles.some((t) => M.pointInPoly(p, shrink(t.p, -0.001)));
// точки по периметру предмета: ловлять і западини зубчастих стін між кутами
const rim = (it) => {
  const c = corners(it), out = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2));
    for (let k = 0; k < n; k++) out.push(M.V(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n));
  }
  return out;
};
for (const r of M.rooms)
  for (const it of r.items || []) {
    const bad = rim(it).filter((p) => !inTiles(p, r.tiles));
    if (bad.length) warn(`${r.id}: «${it.name}» виходить за підлогу (${bad.length} точ.)`);
  }

// 3b. предмети в одному приміщенні не перетинаються (крім світла й люків)
for (const r of M.rooms) {
  const its = (r.items || []).filter((it) => !['light', 'hatch'].includes(it.kind));
  for (let i = 0; i < its.length; i++)
    for (let j = i + 1; j < its.length; j++)
      if (overlap(corners(its[i]), corners(its[j]))) warn(`${r.id}: «${its[i].name}» перетинає «${its[j].name}»`);
}

// 4. вітряки і пастки на дахах
const roofOf = (it) => M.rooms.filter((r) => (r.roof === 'solid' && Math.abs(r.z0 + r.h - it.z) < 0.01) || (r.h === 0 && Math.abs(r.z0 - it.z) < 0.01));
const rimOf = (r) => new Set((r.rim || []).map((t) => M.centroid(t.p).x.toFixed(3) + ',' + M.centroid(t.p).y.toFixed(3)));
for (const it of M.roofItems) {
  const rs = roofOf(it);
  const bad = corners(it).filter((p) => !rs.some((r) => { const rim = rimOf(r); return inTiles(p, r.tiles.filter((t) => !rim.has(M.centroid(t.p).x.toFixed(3) + ',' + M.centroid(t.p).y.toFixed(3)))); }));
  if (bad.length) warn(`дах: «${it.name}» у (${fmt(it.c.x)}, ${fmt(it.c.y)}) виходить за дах`);
}
for (let i = 0; i < M.roofItems.length; i++)
  for (let j = i + 1; j < M.roofItems.length; j++)
    if (overlap(corners(M.roofItems[i]), corners(M.roofItems[j]))) warn(`дах: перетин ${i} і ${j}`);

// 5. зведення
console.log('\nПриміщення:');
let sq = 0, tr = 0;
for (const r of M.rooms) {
  const s = r.tiles.filter((t) => t.k === 's').length, t = r.tiles.filter((t) => t.k === 't').length;
  sq += s; tr += t;
  console.log(`  ${r.id.padEnd(10)} z${String(r.z0).padStart(2)}+${String(r.h).padEnd(2)} кв ${String(s).padStart(4)}  тр ${String(t).padStart(4)}  площа ${fmt(s + t * Math.sqrt(3) / 4)}`);
}
const turb = M.roofItems.filter((i) => i.kind === 'turbine').length;
const wt = M.roofItems.filter((i) => i.kind === 'windtrap').length;
console.log(`\nУсього: квадратів ${sq}, трикутників ${tr}; вітряків ${turb}, вітропасток ${wt}`);
console.log(problems ? `\nПроблем: ${problems}` : '\nПроблем не знайдено');
process.exitCode = problems ? 1 : 0;

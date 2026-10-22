/*
 * Спільна геометрія баз: плитки (квадрати й рівносторонні трикутники зі стороною 1),
 * предмети, межі приміщень і прорізи. Нею користуються моделі обох баз.
 */
(function (root) {
  'use strict';

  const R3 = Math.sqrt(3) / 2;
  const V = (x, y) => ({ x, y });
  const add = (a, b) => V(a.x + b.x, a.y + b.y);
  const sub = (a, b) => V(a.x - b.x, a.y - b.y);
  const mul = (a, k) => V(a.x * k, a.y * k);
  const clean = (v) => (Math.abs(v) < 1e-9 ? 0 : v);
  const dir = (deg) => {
    const r = (deg * Math.PI) / 180;
    return V(clean(Math.cos(r)), clean(Math.sin(r)));
  };
  const mirrorPt = (p) => V(-p.x, p.y);
  const centroid = (pts) =>
    V(pts.reduce((s, p) => s + p.x, 0) / pts.length, pts.reduce((s, p) => s + p.y, 0) / pts.length);

  function pointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function distToSeg(p, a, b) {
    const d = sub(b, a);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / (d.x * d.x + d.y * d.y)));
    return Math.hypot(a.x + d.x * t - p.x, a.y + d.y * t - p.y);
  }
  const distToPoly = (p, poly) => Math.min(...poly.map((a, i) => distToSeg(p, a, poly[(i + 1) % poly.length])));
  const inOrOn = (p, poly) => pointInPoly(p, poly) || distToPoly(p, poly) < 1e-6;

  // ---------- генератори плиток ----------

  // Квадрати w x d від точки o уздовж векторів u (ширина) і v (глибина).
  function squares(o, u, v, w, d) {
    const out = [];
    for (let i = 0; i < w; i++)
      for (let j = 0; j < d; j++) {
        const p = add(o, add(mul(u, i), mul(v, j)));
        out.push({ k: 's', p: [p, add(p, u), add(add(p, u), v), add(p, v)] });
      }
    return out;
  }
  const rect = (x, y, w, d) => squares(V(x, y), V(1, 0), V(0, 1), w, d);

  // Трикутна гратка з початком o і базисом a = dir(aDeg), b = dir(aDeg + 60).
  // strict = false: трикутник береться, якщо його центр усередині полігона;
  // strict = true: тільки якщо всі три вершини всередині або на межі.
  function triangles(o, aDeg, poly, strict = false) {
    const a = dir(aDeg), b = dir(aDeg + 60);
    const det = a.x * b.y - a.y * b.x;
    let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    for (const q of poly) {
      const r = sub(q, o);
      const i = (r.x * b.y - r.y * b.x) / det;
      const j = (a.x * r.y - a.y * r.x) / det;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i);
      j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
    const out = [];
    for (let i = Math.floor(i0) - 1; i <= Math.ceil(i1) + 1; i++)
      for (let j = Math.floor(j0) - 1; j <= Math.ceil(j1) + 1; j++) {
        const P = add(o, add(mul(a, i), mul(b, j)));
        const up = [P, add(P, a), add(P, b)];
        const dn = [add(P, a), add(add(P, a), b), add(P, b)];
        for (const tri of [up, dn]) {
          const ok = strict ? tri.every((q) => inOrOn(q, poly)) && pointInPoly(centroid(tri), poly) : pointInPoly(centroid(tri), poly);
          if (ok) out.push({ k: 't', p: tri });
        }
      }
    return out;
  }

  // Кутова вставка для "округлення": повернутий квадрат + трикутник (як на скріні 4).
  // Базовий випадок — кут (x1, y0) прямокутника; sx, sy віддзеркалюють для інших кутів.
  function cornerPiece(c, sx, sy) {
    const f = (p) => V(c.x + sx * p.x, c.y + sy * p.y);
    const a = dir(240), b = dir(330), t = dir(30);
    return [
      { k: 's', p: [V(0, 0), a, add(a, b), b].map(f) },
      { k: 't', p: [V(0, 0), b, t].map(f) },
    ];
  }

  // Ряд трикутників уздовж відрізка p -> q (довжина ціла), назовні ліворуч від напрямку.
  // Виходить трапеція з кутами 60 градусів, як "закруглені" краї на скріні 1.
  function strip(p, q, rows = 1) {
    const ang = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
    const poly = [p, q, add(q, mul(dir(ang + 120), rows)), add(p, mul(dir(ang + 60), rows))];
    return triangles(p, ang, poly);
  }

  // "Кругла" башта: ядро w x d + ряд трикутників по периметру + кутові вставки.
  function roundedBlock(x0, y0, w, d) {
    const x1 = x0 + w, y1 = y0 + d;
    return [
      ...rect(x0, y0, w, d),
      ...strip(V(x1, y0), V(x0, y0)),
      ...strip(V(x0, y1), V(x1, y1)),
      ...strip(V(x1, y1), V(x1, y0)),
      ...strip(V(x0, y0), V(x0, y1)),
      ...cornerPiece(V(x1, y0), 1, 1),
      ...cornerPiece(V(x0, y0), -1, 1),
      ...cornerPiece(V(x1, y1), 1, -1),
      ...cornerPiece(V(x0, y1), -1, -1),
    ];
  }

  const mirrorTiles = (tiles) => tiles.map((t) => ({ k: t.k, p: t.p.map(mirrorPt) }));
  const mirrorSeg = (o) =>
    o.box ? { ...o, box: [-o.box[1], -o.box[0], o.box[2], o.box[3]] } : { ...o, a: mirrorPt(o.a), b: mirrorPt(o.b) };

  // Предмет (техніка, обладнання) як прямокутник у власних осях.
  // c — центр, w — уздовж кута ang, d — поперек, h — висота в рівнях, z — рівень підлоги.
  // Сходи: kind 'stairs', w — довжина маршу в напрямку підйому ang, from/to — рівні.
  const item = (name, kind, c, w, d, h, ang = 0, extra = {}) => ({ name, kind, c, w, d, h, ang, ...extra });
  const mirrorItem = (it) => ({ ...it, c: mirrorPt(it.c), ang: 180 - it.ang });
  const stairs = (name, c, run, width, ang, from, to) =>
    item(name, 'stairs', c, run, width, to - from, ang, { from, to, z: from });
  // Точка біля стіни a -> b: s — уздовж стіни від a, o — відступ усередину (приміщення праворуч від напрямку).
  const wallPt = (a, b, s, o) => {
    const L = Math.hypot(b.x - a.x, b.y - a.y), u = V((b.x - a.x) / L, (b.y - a.y) / L);
    return V(a.x + u.x * s + u.y * o, a.y + u.y * s - u.x * o);
  };

  // Проріз у стіні: тип 'open' | 'shield' | 'door' | 'balcony', z0/z1 — абсолютні рівні.
  const seg = (a, b, type, z0, z1) => ({ a, b, type, ...(z0 !== undefined ? { z0, z1 } : {}) });

  // ---------- службове: межі приміщень і прорізи ----------
  const keyOf = (p) => {
    const kx = Math.round(p.x * 1000), ky = Math.round(p.y * 1000);
    return (kx === 0 ? 0 : kx) + ',' + (ky === 0 ? 0 : ky);
  };
  const edgeKey = (a, b) => {
    const ka = keyOf(a), kb = keyOf(b);
    return ka < kb ? ka + '|' + kb : kb + '|' + ka;
  };
  function boundaryEdges(tiles) {
    const m = new Map();
    for (const t of tiles)
      for (let i = 0; i < t.p.length; i++) {
        const a = t.p[i], b = t.p[(i + 1) % t.p.length];
        const k = edgeKey(a, b);
        const e = m.get(k);
        if (e) e.n++;
        else m.set(k, { a, b, n: 1 });
      }
    return [...m.values()].filter((e) => e.n === 1).map(({ a, b }) => ({ a, b }));
  }
  // ---------- стіна поштучно ----------
  // Стіна на краю — стовпчик блоків від підлоги приміщення до верху стін: кожен 1 чи 0,5 заввишки, з типом
  // (стіна, двері, пентащит, прохід). Редактор записує стовпчик краю в room.walls: [{ a, b, s: [{ h, type }] }]
  // (знизу вгору); край без запису — як було: прорізи з room.open. Стовпчик коротший за стіни — далі суцільна
  // стіна, довший — обрізаний: висоту приміщення можна міняти, не переписуючи стовпчики.
  const PIECE_TYPES = ['wall', 'door', 'shield', 'open'];
  const PIECE_RANK = { wall: 0, door: 1, shield: 2, open: 3 }; // відкритіший перемагає (як у прорізах)
  const EPS = 1e-6;
  const wsCache = new WeakMap(); // за масивом room.walls: редактор щоразу записує новий
  function wallStack(room, a, b) {
    const list = room.walls;
    if (!list || !list.length) return null;
    let m = wsCache.get(list);
    if (!m) { m = new Map(list.map((w) => [edgeKey(w.a, w.b), w.s])); wsCache.set(list, m); }
    return m.get(edgeKey(a, b)) || null;
  }
  // тип блоку з давніх прорізів (за серединою блоку): двері без висоти — 2,5 від підлоги, парапет — пів блоку стіни
  function legacyType(room, a, b) {
    const ops = legacyOpenings(room, a, b);
    if (!ops.length) return null;
    const top = room.z0 + room.h;
    return (mid) => {
      let t = 'wall';
      for (const o of ops) {
        const lo = o.z0 !== undefined ? o.z0 : room.z0;
        const hi = o.z1 !== undefined ? o.z1 : o.type === 'door' ? room.z0 + 2.5 : top;
        if (mid < lo || mid > hi) continue;
        const k = o.type === 'balcony' ? (mid > room.z0 + 0.5 ? 'open' : 'wall') : PIECE_TYPES.includes(o.type) ? o.type : 'wall';
        if (PIECE_RANK[k] > PIECE_RANK[t]) t = k;
      }
      return t;
    };
  }
  /** блоки краю знизу вгору: [{ z0, z1, h, type }]; у палуби (без стін) — жодного */
  function edgePieces(room, a, b) {
    const H = room.h || 0;
    if (!(H > 0)) return [];
    const out = [];
    let z = room.z0;
    const left = () => room.z0 + H - z;
    const push = (h, type) => { out.push({ z0: z, z1: z + h, h, type }); z += h; };
    const s = wallStack(room, a, b);
    if (s) for (const p of s) {
      if (left() < 0.5 - EPS) break;
      push(p.h > 0.5 + EPS && left() >= 1 - EPS ? 1 : 0.5, PIECE_TYPES.includes(p.type) ? p.type : 'wall');
    }
    const old = s ? null : legacyType(room, a, b);
    while (left() >= 1 - EPS) push(1, old ? old(z + 0.5) : 'wall');
    if (left() >= 0.5 - EPS) push(0.5, old ? old(z + 0.25) : 'wall');
    return out;
  }
  // прорізи краю зі стовпчика: блоки одного типу поспіль — один проріз; увесь край відкритий — прохід без висот
  function stackOpenings(room, a, b) {
    const ps = edgePieces(room, a, b);
    if (ps.length && ps.every((p) => p.type === 'open')) return [{ a, b, type: 'open' }];
    const out = [];
    for (const p of ps) {
      if (p.type === 'wall') continue;
      const last = out[out.length - 1];
      if (last && last.type === p.type && Math.abs(last.z1 - p.z0) < EPS) last.z1 = p.z1;
      else out.push({ a, b, type: p.type, z0: p.z0, z1: p.z1 });
    }
    return out;
  }
  const edgeOpenings = (room, a, b) => (wallStack(room, a, b) ? stackOpenings(room, a, b) : legacyOpenings(room, a, b));
  function legacyOpenings(room, a, b) {
    const m = V((a.x + b.x) / 2, (a.y + b.y) / 2);
    const out = [];
    for (const o of room.open || []) {
      if (o.box) {
        if (m.x >= o.box[0] && m.x <= o.box[1] && m.y >= o.box[2] && m.y <= o.box[3]) out.push(o);
        continue;
      }
      const dd = sub(o.b, o.a);
      const t = ((m.x - o.a.x) * dd.x + (m.y - o.a.y) * dd.y) / (dd.x * dd.x + dd.y * dd.y);
      if (t < -0.01 || t > 1.01) continue;
      if (Math.hypot(o.a.x + dd.x * t - m.x, o.a.y + dd.y * t - m.y) < 0.06) out.push(o);
    }
    return out;
  }
  const roomEdges = (room) => boundaryEdges(room.tiles).map((ed) => ({ ...ed, open: edgeOpenings(room, ed.a, ed.b) }));
  function tileArea(t) {
    let s = 0;
    for (let i = 0; i < t.p.length; i++) {
      const a = t.p[i], b = t.p[(i + 1) % t.p.length];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  }
  function labelPoint(room) {
    if (room.label) return room.label;
    let Ar = 0, x = 0, y = 0;
    for (const t of room.tiles) {
      const a = tileArea(t), c = centroid(t.p);
      Ar += a; x += c.x * a; y += c.y * a;
    }
    return V(x / Ar, y / Ar);
  }
  const roomArea = (room) => room.tiles.reduce((s, t) => s + tileArea(t), 0);

  // ---------- зовнішні стіни ----------
  // Ребро зовнішнє, якщо його не накриває межа іншого приміщення на тих самих висотах.
  const beCache = new WeakMap(); // за об'єктом приміщення: редактор замінює змінені приміщення новими — старі звільняються
  const bEdges = (r) => { if (!beCache.has(r)) beCache.set(r, boundaryEdges(r.tiles)); return beCache.get(r); };
  const overlapsZ = (a, b) => a.z0 < b.z0 + Math.max(b.h, 0.01) - 1e-6 && b.z0 < a.z0 + Math.max(a.h, 0.01) - 1e-6;
  function collinearOverlap(e1, f) {
    const L = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y);
    const ux = (f.b.x - f.a.x) / L, uy = (f.b.y - f.a.y) / L;
    const off = (p) => Math.abs((p.x - f.a.x) * uy - (p.y - f.a.y) * ux);
    if (off(e1.a) > 1e-3 || off(e1.b) > 1e-3) return false;
    const t1 = (e1.a.x - f.a.x) * ux + (e1.a.y - f.a.y) * uy, t2 = (e1.b.x - f.a.x) * ux + (e1.b.y - f.a.y) * uy;
    return Math.min(Math.max(t1, t2), L) - Math.max(Math.min(t1, t2), 0) > 1e-3;
  }
  const exteriorEdgesIn = (rooms) => function exteriorEdges(room) {
    const others = rooms.filter((o) => o !== room && o.h > 0 && overlapsZ(o, room) && o.inside !== room.id && room.inside !== o.id);
    const segs = others.flatMap(bEdges);
    return roomEdges(room).filter((ed) => !segs.some((f) => collinearOverlap(ed, f)));
  };

  const GEOM = { R3, V, add, sub, mul, clean, dir, mirrorPt, centroid, pointInPoly, distToSeg, distToPoly, inOrOn, squares, rect, triangles, cornerPiece, strip, roundedBlock, mirrorTiles, mirrorSeg, item, mirrorItem, stairs, wallPt, seg, keyOf, edgeKey, boundaryEdges, edgeOpenings, legacyOpenings, wallStack, edgePieces, PIECE_TYPES, roomEdges, tileArea, labelPoint, roomArea, exteriorEdgesIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = GEOM;
  else root.GEOM = GEOM;
})(typeof window !== 'undefined' ? window : globalThis);

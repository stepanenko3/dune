/*
 * Модель бази "Цитадель Харконненів" для Dune: Awakening. Версія 2.
 *
 * Одиниці: 1 = сторона квадратного фундаменту (і трикутного теж).
 * Висота: 1 рівень = висота однієї стіни.
 * План: x — вправо, y — вглиб бази (фронт на y = 0, тил на y = 30).
 * Ділянки: 6 штук по 10x10, сітка 2 x 3 (x від -10 до 10, y від 0 до 30).
 *
 * Усі приміщення складені тільки з квадратів ('s') і рівносторонніх
 * трикутників ('t') зі стороною 1. Повернуті під 30 градусів ангари
 * прикріплені до шестикутного Великого залу, як рукави на скріні 4.
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

  // ---------- висоти ----------
  const G = 5;            // нижній ярус: заїзд, гаражі, цоколі, склади
  const HANG = 3;         // ангари орні: +5 .. +8 (під підлогою наскрізного ангара)
  const TUN = 8;          // наскрізний ангар: +8 .. +12
  const BACK = 8;         // зал меланжу, майстерня, Великий зал
  const TOWER = 12;       // шахти башт, далі ліхтарі до +14.5

  const claims = [];
  for (const cx of [-10, 0]) for (const cy of [0, 10, 20]) claims.push({ x: cx, y: cy, w: 10, d: 10 });

  // ---------- ключові точки ----------
  // Великий зал: шестикутник зі сторонами 5-6-3-8-3-6 на трикутній гратці.
  const H0 = V(-2.5, 12);                    // лівий кут нижньої сторони (центральний вхід)
  const hexPoly = [V(-2.5, 12), V(2.5, 12), V(5.5, 12 + 6 * R3), V(4, 12 + 9 * R3), V(-4, 12 + 9 * R3), V(-5.5, 12 + 6 * R3)];
  const Y2 = 12 + 9 * R3;                    // верхня сторона залу = початок заднього корпусу

  // Ангар: прикріплений до лівої нижньої сторони залу (6 плит), виходить уперед-ліворуч під 30°.
  const A = V(-2.5, 12), B = V(-5.5, 12 + 6 * R3);
  const d = dir(210), e = dir(120);
  const hL = (t, s) => add(A, add(mul(d, t), mul(e, s)));     // точка в осях ангара
  const A1 = hL(4, 0), B1 = hL(4, 6);
  const F1 = add(A1, mul(dir(180), 2)), F2 = add(B1, mul(dir(240), 2)); // фронт 4 плити
  const hangarSq = squares(A, d, e, 4, 6);
  const hangarNose = triangles(A1, 120, [A1, B1, F2, F1]);    // 2 ряди: 6 -> 4, "закруглення" по 2
  const apronPoly = [F1, V(-10, 10), V(-10, F2.y), F2];
  const apronTri = triangles(A1, 120, apronPoly, true);
  const sandPoly = [B, V(-4, Y2), V(-10, Y2), V(-10, F2.y), F2, B1];
  const sandTri = triangles(H0, 0, sandPoly, true);
  const hexTri = triangles(H0, 0, hexPoly);

  // Галерея всередині залу на +5: перший ряд трикутників уздовж стін.
  const hexEdges = hexPoly.map((p, i) => [p, hexPoly[(i + 1) % hexPoly.length]]);
  const galleryTri = hexTri.filter((t) => {
    const c = centroid(t.p);
    return Math.min(...hexEdges.map(([a, b]) => distToSeg(c, a, b))) < 0.6;
  });

  // Задній корпус: квадрати від верхньої сторони залу (y = Y2) + округлені краї.
  const towerCoreL = rect(-6.5, Y2, 3, 3);
  const inBox = (t, x0, x1, y0, y1) => {
    const c = centroid(t.p);
    return c.x > x0 && c.x < x1 && c.y > y0 && c.y < y1;
  };
  const backCoreL = rect(-8.5, Y2, 5, 8).filter((t) => !inBox(t, -6.5, -3.5, Y2, Y2 + 3));
  const backRimL = [
    ...strip(V(-8.5, Y2), V(-8.5, Y2 + 8)),
    ...strip(V(-8.5, Y2 + 8), V(-3.5, Y2 + 8)),
    ...cornerPiece(V(-8.5, Y2 + 8), -1, -1),
  ];
  const storeCore = rect(-3.5, Y2, 7, 8);
  const storeNose = strip(V(-3.5, Y2 + 8), V(3.5, Y2 + 8), 2);

  // Гараж: ядро 6 x 10 + закруглений зовнішній бік.
  const garageCoreL = rect(-8.5, 0, 6, 10);
  const garageRimL = strip(V(-8.5, 0), V(-8.5, 10));

  // ---------- приміщення ----------
  // h = 0 — відкрита палуба з парапетом. roof: 'solid' | 'none' | 'shield' | 'pyramid'.
  // open: прорізи у стінах: 'open', 'shield' (пентащит), 'glass', 'door', 'balcony' (парапет).
  // z0/z1 у прорізі — абсолютні рівні; без них двері мають висоту 2.5 від підлоги.
  // rim: плитки з нижчим дахом на rimDrop рівнів (уступ, щоб корпус не був коробкою).
  // profile: заокруглений переріз (похилі плити знизу і зверху), як на скрінах 3 і 5.
  const rooms = [];
  const addRoom = (r) => { rooms.push(r); return r; };
  const both = (r, mirror) => { addRoom(r); addRoom(mirror(r)); };
  const mirrorRoom = (id, name, extra = {}) => (r) => ({
    ...r,
    id, name,
    tiles: mirrorTiles(r.tiles),
    rim: r.rim ? mirrorTiles(r.rim) : undefined,
    open: (r.open || []).map(mirrorSeg),
    items: (r.items || []).map(mirrorItem),
    label: r.label ? mirrorPt(r.label) : undefined,
    ...extra,
  });
  const seg = (a, b, type, z0, z1) => ({ a, b, type, ...(z0 !== undefined ? { z0, z1 } : {}) });

  // ===== Рівень 0 =====
  addRoom({
    id: 'corridor', name: 'Центральний заїзд', group: 'drive', z0: 0, h: G, roof: 'none',
    tiles: rect(-2.5, 0, 5, 12), label: V(0, 10.6),
    profile: { x0: -2.5, x1: 2.5, ch: 1, lo: 1, hi: 1 },
    note: '3 рівні плити + по 1 похилій з боків, знизу і зверху (скрін 3). Похилі плити внизу — пандуси в гаражі.',
    open: [
      seg(V(-2.5, 0), V(2.5, 0), 'open'),
      seg(V(-1.5, 12), V(1.5, 12), 'door', 0, 3),
      seg(V(-2.5, 1), V(-2.5, 9), 'open', 1, 4),
      seg(V(2.5, 1), V(2.5, 9), 'open', 1, 4),
    ],
    items: [item('Світлові панелі', 'light', V(0, 6), 11, 2.4, 0.02, 90, { z: G - 0.08 })],
  });

  both(
    {
      id: 'garageL', name: 'Гараж краулера', group: 'drive', z0: 1, h: G - 1, roof: 'none', solidBase: true,
      tiles: [...garageCoreL, ...garageRimL], rim: garageRimL, rimDrop: 1, label: V(-5.5, 8.55),
      note: 'Заїзд тільки із центрального заїзду по похилій плиті. Стеля — горизонтальний пентащит 6×9: грузовий спускається і забирає краулер.',
      open: [
        seg(V(-2.5, 1), V(-2.5, 9), 'open', 1, 4),
        seg(V(-7.96, 10), V(-6, 10), 'door', 1, 3.5),
        seg(V(-7.5, 0), V(-3.5, 0), 'glass', 2.2, 4),
      ],
      items: [
        item('Краулер', 'vehicle', V(-5.5, 4.2), 7, 3.5, 2.2, 90),
        stairs('Сходи на +5', V(-6.2, 9.5), 4, 0.95, 0, 1, 5),
      ],
    },
    mirrorRoom('garageR', 'Гараж: багі + піскоцикл', {
      short: 'Гараж багі',
      note: 'Заїзд тільки із центрального заїзду по похилій плиті. Сходи на терасу.',
      items: [
        item('Багі', 'vehicle', V(4.6, 4.2), 3, 2, 1.4, 90),
        item('Піскоцикл', 'vehicle', V(7.2, 3.7), 2, 1, 1.1, 90),
        item('Ремонтна станція', 'craft', V(7.0, 7.2), 2, 1.2, 1.2, 0),
        stairs('Сходи на +5', V(6.2, 9.5), 4, 0.95, 180, 1, 5),
      ],
    })
  );

  both(
    {
      id: 'plinthL', name: 'Водний блок', group: 'craft', z0: 0, h: G, roof: 'none',
      tiles: [...hangarSq, ...hangarNose, ...apronTri], label: hL(2.0, 3.0),
      note: 'Цоколь під ангаром скаутів. Цистерни і Deathstill: вода для переробки спайсу.',
      open: [
        seg(hL(0, 2), hL(0, 4), 'door', 0, 2.5),
        seg(V(-7.96, 10), V(-6, 10), 'door', 1, 3.5),
      ],
      items: [
        item('Цистерна', 'water', hL(1.0, 1.0), 1.8, 1.8, 2.5, 210),
        item('Цистерна', 'water', hL(1.0, 5.0), 1.8, 1.8, 2.5, 210),
        item('Цистерна', 'water', hL(3.1, 1.0), 1.8, 1.8, 2.5, 210),
        item('Цистерна', 'water', hL(3.1, 5.0), 1.8, 1.8, 2.5, 210),
        item('Deathstill', 'refine', hL(4.6, 3.0), 1.2, 2.0, 2, 210),
      ],
    },
    mirrorRoom('plinthR', 'Фабрикатори', {
      note: 'Цоколь під ангаром асаултів. Фабрикатори поруч із гаражем багі і складом руди.',
      items: [
        item('Фаб. виживання', 'craft', mirrorPt(hL(1.0, 1.0)), 1.8, 1.8, 1.6, -30),
        item('Фаб. зброї', 'craft', mirrorPt(hL(1.0, 5.0)), 1.8, 1.8, 1.6, -30),
        item('Фаб. одягу', 'craft', mirrorPt(hL(3.1, 1.0)), 1.8, 1.8, 1.6, -30),
        item('Склад деталей', 'storage', mirrorPt(hL(3.1, 5.0)), 1.8, 1.8, 1.2, -30),
      ],
    })
  );

  addRoom({
    id: 'hall', name: 'Великий зал', group: 'core', z0: 0, h: BACK, roof: 'solid',
    tiles: hexTri, label: V(0, 12.9),
    note: 'Шестикутник із трикутників (скрін 4), 8 рівнів у висоту. До нього прикріплені обидва ангари. Усередині галерея на +5 і парадні сходи.',
    open: [
      seg(V(-1.5, 12), V(1.5, 12), 'door', 0, 3),
      seg(V(-1.5, 12), V(1.5, 12), 'door', G, G + 2.5),
      seg(hL(0, 2), hL(0, 4), 'door', 0, 2.5),
      seg(mirrorPt(hL(0, 2)), mirrorPt(hL(0, 4)), 'door', 0, 2.5),
      seg(hL(0, 2), hL(0, 4), 'door', G, G + 2.5),
      seg(mirrorPt(hL(0, 2)), mirrorPt(hL(0, 4)), 'door', G, G + 2.5),
      seg(V(-5, 12 + 7 * R3), V(-4.5, 12 + 8 * R3), 'door', 0, 2.5),
      seg(V(5, 12 + 7 * R3), V(4.5, 12 + 8 * R3), 'door', 0, 2.5),
      seg(V(-5, 12 + 7 * R3), V(-4.5, 12 + 8 * R3), 'door', G, G + 2.5),
      seg(V(5, 12 + 7 * R3), V(4.5, 12 + 8 * R3), 'door', G, G + 2.5),
      seg(V(-3, Y2), V(-2, Y2), 'door', 0, 2.5),
      seg(V(2, Y2), V(3, Y2), 'door', 0, 2.5),
      seg(V(-1, Y2), V(1, Y2), 'door', G, G + 2.5),
    ],
    items: [
      item('Консоль суб-фіфу', 'console', V(0, 13.6), 1, 1, 1.4, 0),
      stairs('Парадні сходи на галерею +5', V(0, 16.5), 4.6, 2, 90, 0, G),
    ],
  });

  addRoom({
    id: 'gallery', name: 'Галерея залу', short: 'Галерея', group: 'deck', z0: G, h: 0, roof: 'none', inside: 'hall',
    tiles: galleryTri, label: V(0, 18.95),
    note: 'Кільце на +5 уздовж стін залу: з’єднує балкон, обидва ангари, задні майданчики і задню терасу.',
    open: hexEdges.map(([a, b]) => seg(a, b, 'open')),
    items: [],
  });

  both(
    {
      id: 'sandL', name: 'Склад спайсового піску', short: 'Склад піску', group: 'store', z0: 0, h: G, roof: 'none',
      tiles: sandTri, label: V(-7.4, 17.3),
      note: 'Між водним блоком, Великим залом і залом меланжу: пісок із краулера йде найкоротшим шляхом.',
      open: [
        seg(V(-5, 12 + 7 * R3), V(-4.5, 12 + 8 * R3), 'door', 0, 2.5),
        seg(V(-8.2, Y2), V(-7, Y2), 'door', 0, 2.5),
        seg(V(-5.5, Y2), V(-4.5, Y2), 'door', 0, 2.5),
      ],
      items: [
        item('Контейнери', 'storage', V(-9.2, 17.6), 0.9, 3.2, 1.2, 0),
        item('Контейнери', 'storage', V(-7.3, 18.95), 2.6, 0.8, 1.2, 0),
      ],
    },
    mirrorRoom('oreR', 'Склад руди', { short: 'Склад руди', note: 'Між фабрикаторами, Великим залом і рудним цехом.' })
  );

  both(
    {
      id: 'towerL', name: 'Ліва башта', short: 'Башта', group: 'tower', z0: 0, h: TOWER, roof: 'none',
      tiles: towerCoreL, label: V(-5, Y2 + 1.5),
      note: 'Сходи з землі до +12: склад, задня тераса, зал меланжу, наскрізний ангар, дах із вітряками.',
      open: [
        seg(V(-5.5, Y2), V(-4.5, Y2), 'door', 0, 2.5),
        seg(V(-3.5, Y2 + 1), V(-3.5, Y2 + 2), 'door', 0, 2.5),
        seg(V(-3.5, Y2 + 1), V(-3.5, Y2 + 2), 'door', G, G + 2.5),
        seg(V(-3.5, 20.2), V(-3.5, 21), 'door', TUN + 1, TUN + 3),
        seg(V(-6.5, Y2 + 1), V(-6.5, Y2 + 2), 'door', 0, 2.5),
        seg(V(-5.5, Y2 + 3), V(-4.5, Y2 + 3), 'door', BACK, BACK + 2),
      ],
      items: [stairs('Сходи 0 → +12', V(-5, Y2 + 1.5), 2.4, 2.4, 90, 0, TOWER)],
    },
    mirrorRoom('towerR', 'Права башта', {
      note: 'Сходи з землі до +12: склад, задня тераса, майстерня, наскрізний ангар, дах із вітряками.',
    })
  );

  addRoom({
    id: 'store', name: 'Головний склад', group: 'store', z0: 0, h: G, roof: 'none',
    tiles: [...storeCore, ...storeNose], label: V(0, Y2 + 4.2),
    note: 'За Великим залом, між переробкою і фабрикаторами. Задній вихід назовні.',
    open: [
      seg(V(-3, Y2), V(-2, Y2), 'door', 0, 2.5),
      seg(V(2, Y2), V(3, Y2), 'door', 0, 2.5),
      seg(V(-3.5, Y2 + 1), V(-3.5, Y2 + 2), 'door', 0, 2.5),
      seg(V(3.5, Y2 + 1), V(3.5, Y2 + 2), 'door', 0, 2.5),
      seg(V(-3.5, Y2 + 4), V(-3.5, Y2 + 6), 'door', 0, 2.5),
      seg(V(3.5, Y2 + 4), V(3.5, Y2 + 6), 'door', 0, 2.5),
      seg(V(-1, Y2 + 8 + 2 * R3), V(1, Y2 + 8 + 2 * R3), 'door', 0, 2.5),
    ],
    items: [
      item('Контейнери', 'storage', V(-2.9, Y2 + 4), 0.9, 5.6, 1.2, 0),
      item('Контейнери', 'storage', V(2.9, Y2 + 4), 0.9, 5.6, 1.2, 0),
      item('Контейнери', 'storage', V(-1.3, Y2 + 7.4), 1.6, 0.8, 1.2, 0),
      item('Контейнери', 'storage', V(1.3, Y2 + 7.4), 1.6, 0.8, 1.2, 0),
    ],
  });

  addRoom({
    id: 'spice', name: 'Зал меланжу', group: 'refine', z0: 0, h: BACK, roof: 'solid',
    tiles: [...backCoreL, ...backRimL], rim: backRimL, rimDrop: 1, label: V(-6.0, Y2 + 4.2),
    note: '2 великі переробники спайсу (3×2, 5 стін), вода, хімічний переробник, Deathstill. Округлені краї з уступом даху.',
    open: [
      seg(V(-8.2, Y2), V(-7, Y2), 'door', 0, 2.5),
      seg(V(-6.5, Y2 + 1), V(-6.5, Y2 + 2), 'door', 0, 2.5),
      seg(V(-3.5, Y2 + 4), V(-3.5, Y2 + 6), 'door', 0, 2.5),
    ],
    items: [
      item('Переробник спайсу', 'refine', V(-7.5, Y2 + 1.5), 2.9, 1.9, 5, 90, { full: 'Великий переробник спайсу' }),
      item('Переробник спайсу', 'refine', V(-5.0, Y2 + 4.1), 2.9, 1.9, 5, 0, { full: 'Великий переробник спайсу' }),
      item('Цистерна', 'water', V(-7.5, Y2 + 4.1), 1.8, 1.8, 2.5, 0),
      item('Цистерна', 'water', V(-7.5, Y2 + 6.4), 1.8, 1.6, 2.5, 0),
      item('Хімічний', 'refine', V(-5.0, Y2 + 6.6), 2.9, 1.8, 2.4, 0, { full: 'Хімічний переробник' }),
    ],
  });

  addRoom({
    id: 'ore', name: 'Рудний цех', group: 'refine', z0: 0, h: G, roof: 'none',
    tiles: mirrorTiles([...backCoreL, ...backRimL]), label: V(6.0, Y2 + 4.2),
    note: '3 великі переробники руди (3×2, до 2 стін), середній переробник і генератор. Над цехом — майстерня техніки.',
    open: [
      seg(V(8.2, Y2), V(7, Y2), 'door', 0, 2.5),
      seg(V(6.5, Y2 + 1), V(6.5, Y2 + 2), 'door', 0, 2.5),
      seg(V(3.5, Y2 + 4), V(3.5, Y2 + 6), 'door', 0, 2.5),
    ],
    items: [
      item('Переробник руди', 'refine', V(7.5, Y2 + 1.5), 2.9, 1.9, 2, 90, { full: 'Великий переробник руди' }),
      item('Переробник руди', 'refine', V(5.0, Y2 + 4.1), 2.9, 1.9, 2, 0, { full: 'Великий переробник руди' }),
      item('Переробник руди', 'refine', V(5.0, Y2 + 6.6), 2.9, 1.9, 2, 0, { full: 'Великий переробник руди' }),
      item('Середній', 'refine', V(7.5, Y2 + 4.1), 1.8, 1.8, 2, 0, { full: 'Середній переробник руди' }),
      item('Генератор', 'power', V(7.5, Y2 + 6.4), 1.8, 1.6, 1.8, 0),
    ],
  });

  // ===== Рівень +5 =====
  addRoom({
    id: 'balcony', name: 'Балкон', group: 'core', z0: G, h: TUN - G, roof: 'none',
    tiles: rect(-2.5, 0, 5, 12), label: V(-0.6, 4.2),
    note: 'Над центральним заїздом і під наскрізним ангаром. Спереду відкритий з парапетом, з боків вихід на терасу і перехід, позаду галерея залу, сходи вгору в наскрізний ангар.',
    open: [
      seg(V(-2.5, 0), V(2.5, 0), 'balcony'),
      seg(V(-2.5, 9), V(-2.5, 10), 'door'),
      seg(V(-2.5, 1), V(-2.5, 8), 'glass', G + 0.8, TUN - 0.2),
      seg(V(2.5, 4), V(2.5, 6), 'door'),
      seg(V(2.5, 1), V(2.5, 3.5), 'glass', G + 0.8, TUN - 0.2),
      seg(V(2.5, 6.5), V(2.5, 9), 'glass', G + 0.8, TUN - 0.2),
      seg(V(-1.5, 12), V(1.5, 12), 'door'),
    ],
    items: [stairs('Сходи в наскрізний ангар', V(1.7, 8.65), 3.5, 1.4, 90, G, TUN)],
  });

  addRoom({
    id: 'shield', name: 'Пентащит над краулером', short: 'Пентащит', group: 'shield', z0: G, h: 0, roof: 'none',
    tiles: rect(-8.5, 0, 6, 9), label: V(-5.5, 4.6), note: 'Горизонтальний пентащит 6×9 у стелі гаража краулера.',
    open: [], items: [],
  });

  addRoom({
    id: 'walkway', name: 'Перехід до ангара скаутів', short: 'Перехід', group: 'deck', z0: G, h: 0, roof: 'none',
    tiles: rect(-8.5, 9, 6, 1), label: V(-5.5, 9.5),
    note: 'Вздовж задньої стінки гаража: балкон ↔ ангар скаутів ↔ передній майданчик. Сюди виходять сходи з гаража.',
    open: [seg(V(-2.5, 9), V(-2.5, 10), 'open'), seg(V(-8.5, 10), V(-5.96, 10), 'open')],
    items: [],
  });

  addRoom({
    id: 'terrace', name: 'Тераса', group: 'deck', z0: G, h: 0, roof: 'none',
    tiles: rect(2.5, 0, 6, 10), label: V(5.6, 8.4),
    note: 'Дах гаража багі між нижніми ангарами: балкон ↔ ангар асаултів ↔ передній майданчик. Сюди виходять сходи з гаража.',
    open: [seg(V(2.5, 0), V(2.5, 10), 'open'), seg(V(5.96, 10), V(8.5, 10), 'open')],
    items: [],
  });

  both(
    {
      id: 'hangarL', name: 'Ангар скаутів', group: 'air', z0: G, h: HANG, roof: 'shield',
      tiles: [...hangarSq, ...hangarNose], label: hL(2.3, 3.0),
      note: 'Прикріплений до Великого залу. Фронт 4 плити, закруглення по 2, далі рівні боки. Виліт спереду, з боків і вгору (стіни й дах — пентащит).',
      open: [
        seg(A, A1, 'shield'), seg(B, B1, 'shield'),
        seg(A1, F1, 'shield'), seg(F1, F2, 'shield'), seg(F2, B1, 'shield'),
        seg(hL(0, 2), hL(0, 4), 'door'),
      ],
      items: [
        item('Скаут', 'air', hL(2.25, 1.5), 3.6, 2.5, 1.5, 210),
        item('Скаут', 'air', hL(2.25, 4.5), 3.6, 2.5, 1.5, 210),
      ],
    },
    mirrorRoom('hangarR', 'Ангар асаултів', {
      items: [
        item('Асаулт', 'air', mirrorPt(hL(2.4, 1.6)), 4.0, 2.7, 1.8, -30),
        item('Асаулт', 'air', mirrorPt(hL(2.4, 4.4)), 4.0, 2.7, 1.8, -30),
      ],
    })
  );

  both(
    {
      id: 'apronL', name: 'Передній майданчик скаутів', short: 'Майданчик', group: 'deck', z0: G, h: 0, roof: 'none',
      tiles: apronTri, label: V(-9.0, 11.2),
      note: 'Перед фронтом ангара, на даху водного блоку.',
      open: [seg(F1, F2, 'open'), seg(F1, V(-8.5, 10), 'open')],
      items: [],
    },
    mirrorRoom('apronR', 'Передній майданчик асаултів')
  );

  both(
    {
      id: 'backApronL', name: 'Задній майданчик', short: 'Задній майданчик', group: 'deck', z0: G, h: 0, roof: 'none',
      tiles: sandTri, label: V(-7.6, 17.6),
      note: 'Дах складу піску: бічний виліт ангара, двері галереї і башти.',
      open: [seg(B, B1, 'open'), seg(B1, F2, 'open'), seg(B, V(-4, Y2), 'open'), seg(V(-10, Y2), V(-4, Y2), 'open')],
      items: [],
    },
    mirrorRoom('backApronR', 'Задній майданчик')
  );

  addRoom({
    id: 'backTerrace', name: 'Задня тераса', group: 'deck', z0: G, h: 0, roof: 'none',
    tiles: [...storeCore, ...storeNose], label: V(0, Y2 + 2.0),
    note: 'Дах головного складу за виходом наскрізного ангара: вітропастки, вихід із галереї і башт.',
    open: [seg(V(-4, Y2), V(4, Y2), 'open'), seg(V(-3.5, Y2), V(-3.5, Y2 + 8), 'open'), seg(V(3.5, Y2), V(3.5, Y2 + 8), 'open')],
    items: [],
  });

  addRoom({
    id: 'workshop', name: 'Майстерня техніки', group: 'craft', z0: G, h: BACK - G, roof: 'solid',
    tiles: mirrorTiles([...backCoreL, ...backRimL]), rim: mirrorTiles(backRimL), rimDrop: 1, label: V(6.0, Y2 + 3.4),
    note: 'Над рудним цехом: фабрикатор техніки, ремонт, ресайклер. Вхід із правої башти.',
    open: [seg(V(6.5, Y2 + 1), V(6.5, Y2 + 2), 'door')],
    items: [
      item('Фабрикатор техніки', 'craft', V(5.4, Y2 + 5.0), 3.6, 2.6, 2, 0),
      item('Ремонт', 'craft', V(7.5, Y2 + 1.5), 2.8, 1.8, 1.4, 90, { full: 'Ремонтна станція' }),
      item('Ресайклер', 'craft', V(7.6, Y2 + 7.15), 1.7, 1.7, 1.6, 0),
    ],
  });

  // ===== Рівень +8 =====
  addRoom({
    id: 'tunnel', name: 'Наскрізний ангар', group: 'air', z0: TUN, h: 4, roof: 'solid',
    tiles: rect(-3.5, 0, 7, 21), label: V(0, 10.4),
    profile: { x0: -3.5, x1: 3.5, ch: 1, lo: 1, hi: 1 },
    note: 'Як на скріні 5: восьмикутний переріз (похилі плити знизу і зверху), пролітає крізь усю базу над балконом і Великим залом. Два грузові 4×9 одне за одним: передній вилітає вперед, задній — назад.',
    open: [
      seg(V(-3.5, 0), V(3.5, 0), 'open'),
      seg(V(-3.5, 21), V(3.5, 21), 'open'),
      seg(V(-3.5, 20.2), V(-3.5, 21), 'door', TUN + 1, TUN + 3),
      seg(V(3.5, 20.2), V(3.5, 21), 'door', TUN + 1, TUN + 3),
    ],
    items: [
      item('Грузовий', 'air', V(0, 4.8), 9, 4, 2.2, 90),
      item('Грузовий', 'air', V(0, 16.0), 9, 4, 2.2, 90),
      item('Люк сходів', 'hatch', V(1.7, 10.4), 1.6, 1.4, 0.05, 90),
    ],
  });

  both(
    {
      id: 'lanternL', name: 'Ліхтар лівої башти', short: 'Ліхтар', group: 'tower', z0: TOWER, h: 2.5, roof: 'pyramid',
      tiles: roundedBlock(-6.5, Y2, 3, 3), label: V(-5, Y2 + 1.5),
      note: 'Верх башти на рівні даху наскрізного ангара: звідси вихід до вітряків.',
      open: [seg(V(-3.5 + R3, Y2 + 0.5), V(-3.5 + R3, Y2 + 2.5), 'door')],
      items: [],
    },
    mirrorRoom('lanternR', 'Ліхтар правої башти')
  );

  // ---------- дахи: вітряки і пастки ----------
  const roofItems = [];
  // 20 спрямованих вітряків на даху наскрізного ангара (+12), 2 ряди по 10.
  for (const x of [-1.25, 1.25])
    for (let k = 0; k < 10; k++)
      roofItems.push(item('Спрямований вітряк', 'turbine', V(x, 1.05 + k * 2.1), 1.8, 1.8, 3, 0, { z: TUN + 4 }));
  // 15 великих вітропасток: задня тераса (+5) і дахи бічних корпусів (+8).
  for (const [x, y] of [[-2.3, Y2 + 2.6], [0, Y2 + 2.6], [2.3, Y2 + 2.6], [-2.3, Y2 + 5.0], [0, Y2 + 5.0], [2.3, Y2 + 5.0], [0, Y2 + 7.4]])
    roofItems.push(item('Велика вітропастка', 'windtrap', V(x, y), 2, 2, 2.6, 0, { z: G }));
  for (const s of [-1, 1])
    for (const [x, y] of [[7.4, Y2 + 4.9], [5.0, Y2 + 4.9], [7.4, Y2 + 7.0], [5.0, Y2 + 7.0]])
      roofItems.push(item('Велика вітропастка', 'windtrap', V(s * x, y), 2, 2, 2.6, 0, { z: BACK }));

  // Пункт 17: балкон між нижніми ангарами — тераса або додатковий вхід.
  const variants = {
    terrace: {
      label: 'Тераса',
      note: 'Балкон і тераса як оглядовий майданчик. Для бази на краю скелі, коли фронт недоступний пішки.',
      items: [
        item('Лава', 'furniture', V(-0.9, 1.6), 2.4, 0.7, 0.5, 0, { z: G }),
        item('Лава', 'furniture', V(5.2, 1.4), 2.4, 0.7, 0.5, 0, { z: G }),
        item('Лава', 'furniture', V(7.6, 4.4), 2.4, 0.7, 0.5, 90, { z: G }),
      ],
    },
    entrance: {
      label: 'Додатковий вхід',
      note: 'Посадка скаута на терасу, пішохідний шлюз у балконі. Для бази, до якої підходять з фронту.',
      items: [
        item('Посадка скаута', 'pad', V(5.5, 4.4), 4, 4, 0.05, 0, { z: G }),
        item('Пішохідний шлюз', 'gate', V(0, 0.7), 2.6, 0.8, 2.5, 0, { z: G }),
      ],
    },
  };

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
  function edgeOpenings(room, a, b) {
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

  // Рівні для плану: підлоги з z0 у [z0, z1).
  const levels = [
    { key: 'g', name: 'Рівень 0', sub: 'земля', z0: 0, z1: G },
    { key: 'u', name: 'Рівень +5', sub: 'ангари, балкон, тераси', z0: G, z1: TUN },
    { key: 't', name: 'Рівень +8', sub: 'наскрізний ангар', z0: TUN, z1: TOWER },
    { key: 'r', name: 'Дах', sub: 'вітряки і пастки', z0: TOWER, z1: 99 },
  ];

  const model = {
    R3, V, add, sub, mul, dir, centroid, pointInPoly,
    claims, rooms, roofItems, levels, variants,
    boundaryEdges, roomEdges, labelPoint, roomArea, tileArea, edgeKey,
    heights: { G, HANG, TUN, BACK, TOWER },
    bounds: { x0: -10, x1: 10, y0: 0, y1: 30 },
    key: { A, B, A1, B1, F1, F2, Y2 },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else root.BASE = model;
})(typeof window !== 'undefined' ? window : globalThis);

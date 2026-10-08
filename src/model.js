/*
 * Модель бази "Цитадель Харконненів" для Dune: Awakening. Версія 4.
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
  const HANG = 3;         // ангари орні: скло +5 .. +8, дах у 2 яруси: +8 і +9
  const CAR = 9;          // ангар грузових: +9 .. +13 (стоїть на верхньому ярусі дахів ангарів), над ним піраміда
  const BACK = 9;         // Великий зал, зал меланжу, майстерня
  const TOWER = 15;       // шахти веж; балкони й місток на +13, ліхтарі +15 .. +17.5
  const DECK = 13;        // рівень балконів веж і містка: над верхом ангара грузових

  const claims = [];
  for (const cx of [-10, 0]) for (const cy of [0, 10, 20]) claims.push({ x: cx, y: cy, w: 10, d: 10 });

  // ---------- ключові точки ----------
  // Великий зал: шестикутник зі сторонами 5-6-3-8-3-6 на трикутній гратці.
  const H0 = V(-2.5, 12);                    // лівий кут нижньої сторони (центральний вхід)
  const hexPoly = [V(-2.5, 12), V(2.5, 12), V(5.5, 12 + 6 * R3), V(4, 12 + 9 * R3), V(-4, 12 + 9 * R3), V(-5.5, 12 + 6 * R3)];
  const Y2 = 12 + 9 * R3;                    // верхня сторона залу = початок заднього корпусу
  const hexTri = triangles(H0, 0, hexPoly);
  const hexEdges = hexPoly.map((p, i) => [p, hexPoly[(i + 1) % hexPoly.length]]);
  const galleryTri = hexTri.filter((t) => {
    const c = centroid(t.p);
    return Math.min(...hexEdges.map(([a, b]) => distToSeg(c, a, b))) < 0.6;
  });

  // Ангар грузових: 9 x 11 над Великим залом + розтруби-воронки спереду і ззаду (скрін 2).
  const CY0 = Y2 - 9, CY1 = Y2 + 2;
  const carBody = rect(-4.5, CY0, 9, 11);
  const flareF = triangles(V(-4.5, CY0), 0, [V(-4.5, CY0), V(4.5, CY0), V(5.5, CY0 - 2 * R3), V(-5.5, CY0 - 2 * R3)]);
  const flareR = triangles(V(-4.5, CY1), 0, [V(-4.5, CY1), V(4.5, CY1), V(5.5, CY1 + 2 * R3), V(-5.5, CY1 + 2 * R3)]);
  const carFoot = [
    V(-5.5, CY0 - 2 * R3), V(5.5, CY0 - 2 * R3), V(4.5, CY0), V(4.5, CY1),
    V(5.5, CY1 + 2 * R3), V(-5.5, CY1 + 2 * R3), V(-4.5, CY1), V(-4.5, CY0),
  ];
  const underCarrier = (t) => t.p.some((q) => pointInPoly(q, carFoot) && distToPoly(q, carFoot) > 1e-6);

  // Ангар орні: прикріплений до лівої нижньої сторони залу (6 плит), виходить уперед-ліворуч під 30°.
  const A = V(-2.5, 12), B = V(-5.5, 12 + 6 * R3);
  const d = dir(210), e = dir(120);
  const hL = (t, s) => add(A, add(mul(d, t), mul(e, s)));     // точка в осях ангара
  const A1 = hL(4, 0), B1 = hL(4, 6);
  const F1 = add(A1, mul(dir(180), 2)), F2 = add(B1, mul(dir(240), 2)); // фронт 4 плити
  const hangarSq = squares(A, d, e, 4, 6);                    // порядок: i (уздовж d) * 6 + j (уздовж e)
  const hangarNose = triangles(A1, 120, [A1, B1, F2, F1]);    // 2 ряди: 6 -> 4, "закруглення" по 2
  // Дах ангара у 2 яруси (скріни 1 і 3): нижній +8 на весь контур, верхній +9 з відступом на плиту
  // від боків і фронту; у верхньому — пентащит-світлик 2×4. Ангар грузових стоїть на верхньому ярусі.
  const sq = (i, j) => hangarSq[i * 6 + j];
  const upperL = [];
  for (let i = 0; i < 4; i++) for (let j = 1; j <= 4; j++) upperL.push(sq(i, j));
  upperL.push(...hangarSq.filter((t) => underCarrier(t) && !upperL.includes(t)));
  upperL.push(...triangles(A1, 120, [hL(4, 1), hL(4, 5), add(hL(4, 5), dir(240)), add(hL(4, 1), dir(180))]));
  const skylightL = [];
  for (let i = 2; i < 4; i++) for (let j = 1; j <= 4; j++) skylightL.push(sq(i, j));
  const crownL = upperL;
  const apronTri = triangles(A1, 120, [F1, V(-10, 10), V(-10, F2.y), F2], true);
  const backTri = triangles(H0, 0, [B, V(-4, Y2), V(-10, Y2), V(-10, F2.y), F2, B1], true);

  // Задній корпус: квадрати від верхньої сторони залу (y = Y2).
  const inBox = (t, x0, x1, y0, y1) => {
    const c = centroid(t.p);
    return c.x > x0 && c.x < x1 && c.y > y0 && c.y < y1;
  };
  const towerCoreL = rect(-8.5, Y2 + 5, 3, 3);
  // Тил: два ряди трикутників з кутами 60° — заокруглені задні кути корпусів
  // і вхід-воронка зі скошеними укосами посередині (скрін 2).
  const YB = Y2 + 8, YT = Y2 + 8 + 2 * R3;
  const sideRimL = strip(V(-9.5, YB), V(-4.5, YB), 2);
  const sideL = [...rect(-9.5, Y2, 5, 8).filter((t) => !inBox(t, -8.5, -5.5, Y2 + 5, YB)), ...sideRimL];
  const jambL = triangles(V(-4.5, YB), 0, [V(-4.5, YB), V(-1.5, YB), V(-2.5, YT), V(-5.5, YT)]);
  const storeTiles = [...rect(-4.5, Y2, 9, 8), ...jambL, ...mirrorTiles(jambL)];
  // Балкон навколо вежі: заокруглений ряд трикутників із трьох боків (з четвертого — місток).
  const towerBalconyL = [
    ...strip(V(-5.5, Y2 + 5), V(-8.5, Y2 + 5)),
    ...strip(V(-8.5, Y2 + 5), V(-8.5, Y2 + 8)),
    ...strip(V(-8.5, Y2 + 8), V(-5.5, Y2 + 8)),
    ...cornerPiece(V(-8.5, Y2 + 5), -1, 1),
    ...cornerPiece(V(-8.5, Y2 + 8), -1, -1),
  ];

  // Гараж: ядро 6 x 10 + закруглений зовнішній бік.
  const garageCoreL = rect(-8.5, 0, 6, 10);
  const garageRimL = strip(V(-8.5, 0), V(-8.5, 10));

  // ---------- приміщення ----------
  // h = 0 — відкрита палуба з парапетом. roof: 'solid' | 'none' | 'shield' | 'pyramid'.
  // open: прорізи у стінах: 'open', 'shield' (пентащит), 'glass', 'door', 'balcony' (парапет).
  // z0/z1 у прорізі — абсолютні рівні; без них двері мають висоту 2.5 від підлоги.
  // rim: плитки з нижчим дахом на rimDrop рівнів (уступ, щоб корпус не був коробкою).
  // crown: другий ярус даху над частиною плиток; skylight: пентащит у даху.
  // profile: заокруглений переріз (похилі плити знизу і зверху), як на скріні 3; flat — де пандус прибрано.
  const rooms = [];
  const addRoom = (r) => { rooms.push(r); return r; };
  const both = (r, mirror) => { addRoom(r); addRoom(mirror(r)); };
  const mirrorRoom = (id, name, extra = {}) => (r) => ({
    ...r,
    id, name,
    tiles: mirrorTiles(r.tiles),
    rim: r.rim ? mirrorTiles(r.rim) : undefined,
    skylight: r.skylight ? mirrorTiles(r.skylight) : undefined,
    crown: r.crown ? { ...r.crown, tiles: mirrorTiles(r.crown.tiles) } : undefined,
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
    profile: { x0: -2.5, x1: 2.5, ch: 1, lo: 1, hi: 1, flat: [[4, 6]] },
    note: '3 рівні плити + по 1 похилій з боків, знизу і зверху (скрін 3). Заїзди в гаражі 2 плити завширшки на рівні підлоги: там похилі плити прибрано.',
    open: [
      seg(V(-2.5, 0), V(2.5, 0), 'open'),
      seg(V(-1.5, 12), V(1.5, 12), 'door', 0, 3),
      seg(V(-2.5, 4), V(-2.5, 6), 'open', 0, 4),
      seg(V(2.5, 4), V(2.5, 6), 'open', 0, 4),
      seg(V(-2.5, 1), V(-2.5, 4), 'glass', 1, 4),
      seg(V(-2.5, 6), V(-2.5, 9), 'glass', 1, 4),
      seg(V(2.5, 1), V(2.5, 4), 'glass', 1, 4),
      seg(V(2.5, 6), V(2.5, 9), 'glass', 1, 4),
    ],
    items: [item('Світлові панелі', 'light', V(0, 6), 11, 2.4, 0.02, 90, { z: G - 0.08 })],
  });

  both(
    {
      id: 'garageL', name: 'Гараж краулера', group: 'drive', z0: 0, h: G, roof: 'none',
      tiles: [...garageCoreL, ...garageRimL], rim: garageRimL, rimDrop: 1, label: V(-5.5, 7.7),
      note: 'Заїзд 2 плити завширшки із центрального заїзду, на рівні підлоги. Стеля — горизонтальний пентащит 6×9: грузовий спускається і забирає краулер.',
      open: [
        seg(V(-2.5, 4), V(-2.5, 6), 'open', 0, 4),
        seg(V(-2.5, 1), V(-2.5, 4), 'glass', 1, 4),
        seg(V(-2.5, 6), V(-2.5, 9), 'glass', 1, 4),
        seg(V(-7.96, 10), V(-6, 10), 'door', 0, 2.5),
        seg(V(-7.5, 0), V(-3.5, 0), 'glass', 2.2, 4),
      ],
      items: [
        item('Краулер', 'vehicle', V(-5.6, 5.0), 5.5, 2.6, 2.2, 0),
        stairs('Сходи на +5', V(-5.9, 9.5), 5, 0.95, 0, 0, G),
      ],
    },
    mirrorRoom('garageR', 'Гараж: багі + піскоцикл', {
      short: 'Гараж багі', label: V(4.9, 5.0),
      note: 'Заїзд 2 плити завширшки із центрального заїзду, на рівні підлоги. Сходи на дах гаража.',
      items: [
        item('Багі', 'vehicle', V(6.0, 2.8), 3, 2, 1.4, 0),
        item('Піскоцикл', 'vehicle', V(6.0, 7.3), 2, 1, 1.1, 0),
        item('Ремонтна станція', 'craft', V(7.7, 5.0), 2, 1.2, 1.2, 90),
        stairs('Сходи на +5', V(5.9, 9.5), 5, 0.95, 180, 0, G),
      ],
    })
  );

  both(
    {
      id: 'plinthL', name: 'Склад піску', group: 'store', z0: 0, h: G, roof: 'none',
      tiles: [...hangarSq, ...hangarNose, ...apronTri], label: hL(1.9, 3.0),
      note: 'Цоколь під ангаром скаутів, двері просто з гаража краулера: спайсовий пісок одразу на склад.',
      open: [
        seg(hL(0, 2), hL(0, 4), 'door', 0, 2.5),
        seg(V(-7.96, 10), V(-6, 10), 'door', 0, 2.5),
      ],
      items: [
        item('Контейнери', 'storage', hL(0.7, 3.0), 0.9, 5.2, 1.2, 210),
        item('Контейнери', 'storage', hL(3.1, 3.0), 0.9, 5.2, 1.2, 210),
        item('Контейнери', 'storage', hL(4.4, 3.0), 0.9, 4.2, 1.2, 210),
      ],
    },
    mirrorRoom('plinthR', 'Фабрикатори', {
      group: 'craft',
      note: 'Цоколь під ангаром асаултів, поруч гараж багі і склад руди.',
      items: [
        item('Фаб. виживання', 'craft', mirrorPt(hL(1.0, 1.0)), 1.8, 1.8, 1.6, -30),
        item('Фаб. зброї', 'craft', mirrorPt(hL(1.0, 5.0)), 1.8, 1.8, 1.6, -30),
        item('Фаб. одягу', 'craft', mirrorPt(hL(3.1, 1.0)), 1.8, 1.8, 1.6, -30),
        item('Ресайклер', 'craft', mirrorPt(hL(3.1, 5.0)), 1.8, 1.8, 1.6, -30),
        item('Склад деталей', 'storage', mirrorPt(hL(4.6, 3.0)), 1.0, 2.6, 1.2, -30),
      ],
    })
  );

  addRoom({
    id: 'hall', name: 'Великий зал', group: 'core', z0: 0, h: BACK, roof: 'solid', covered: true,
    tiles: hexTri, label: V(0, 12.9),
    note: 'Шестикутник із трикутників (скрін 4), 8 рівнів. До нього прикріплені обидва ангари. Галерея на +5, парадні сходи, над залом ангар грузових і піраміда.',
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
    note: 'Кільце на +5 уздовж стін залу: з’єднує балкон, обидва ангари, задні майданчики і задній двір.',
    open: hexEdges.map(([a, b]) => seg(a, b, 'open')),
    items: [],
  });

  both(
    {
      id: 'waterL', name: 'Водний блок', group: 'craft', z0: 0, h: G, roof: 'none',
      tiles: backTri, label: V(-7.3, 16.9),
      note: 'Між Великим залом і залом меланжу: вода для переробки спайсу.',
      open: [
        seg(V(-5, 12 + 7 * R3), V(-4.5, 12 + 8 * R3), 'door', 0, 2.5),
        seg(V(-8, Y2), V(-7, Y2), 'door', 0, 2.5),
      ],
      items: [
        item('Цистерна', 'water', V(-8.6, 17.4), 1.5, 1.5, 2.5, 0),
        item('Цистерна', 'water', V(-7.2, 19.0), 1.5, 1.4, 2.5, 0),
        item('Deathstill', 'refine', V(-5.6, 19.1), 1.2, 1.2, 2, 0),
      ],
    },
    mirrorRoom('oreR', 'Руда і хімія', {
      short: 'Руда і хімія', group: 'refine',
      note: 'Між Великим залом і рудним цехом: склад руди, хімічний і середній переробники, генератор.',
      items: [
        item('Переробник руди', 'refine', V(8.0, 18.75), 2.9, 1.9, 2, 0, { full: 'Великий переробник руди' }),
        item('Хімічний', 'refine', V(5.7, 18.9), 1.5, 1.4, 2.2, 0, { full: 'Хімічний переробник' }),
      ],
    })
  );

  both(
    {
      id: 'towerL', name: 'Ліва вежа', short: 'Вежа', group: 'tower', z0: 0, h: TOWER, roof: 'none',
      tiles: towerCoreL, label: V(-7, Y2 + 6.5),
      note: 'Гвинтові сходи 0 → +15: зал меланжу, дах корпусу (+9), балкон і місток (+13), ліхтар (+15).',
      open: [
        seg(V(-7.5, Y2 + 5), V(-6.5, Y2 + 5), 'door', 0, 2.5),
        seg(V(-5.5, Y2 + 6), V(-5.5, Y2 + 7), 'door', BACK, BACK + 2.5),
        seg(V(-5.5, Y2 + 6), V(-5.5, Y2 + 7), 'door', DECK, DECK + 2),
        seg(V(-8.5, Y2 + 6), V(-8.5, Y2 + 7), 'door', DECK, DECK + 2),
        seg(V(-7.5, Y2 + 8), V(-6.5, Y2 + 8), 'door', DECK, DECK + 2),
        seg(V(-7.5, Y2 + 5), V(-6.5, Y2 + 5), 'door', DECK, DECK + 2),
      ],
      items: [stairs('Гвинтові сходи 0 → +15', V(-7, Y2 + 6.5), 2.4, 2.4, 90, 0, TOWER)],
    },
    mirrorRoom('towerR', 'Права вежа', {
      note: 'Гвинтові сходи 0 → +15: рудний цех, майстерня (+5), дах (+9), балкон і місток (+13), ліхтар (+15).',
      open: [
        seg(V(7.5, Y2 + 5), V(6.5, Y2 + 5), 'door', 0, 2.5),
        seg(V(7.5, Y2 + 5), V(6.5, Y2 + 5), 'door', G, G + 2.5),
        seg(V(5.5, Y2 + 6), V(5.5, Y2 + 7), 'door', BACK, BACK + 2.5),
        seg(V(5.5, Y2 + 6), V(5.5, Y2 + 7), 'door', DECK, DECK + 2),
        seg(V(8.5, Y2 + 6), V(8.5, Y2 + 7), 'door', DECK, DECK + 2),
        seg(V(7.5, Y2 + 8), V(6.5, Y2 + 8), 'door', DECK, DECK + 2),
        seg(V(7.5, Y2 + 5), V(6.5, Y2 + 5), 'door', DECK, DECK + 2),
      ],
    })
  );

  addRoom({
    id: 'store', name: 'Головний склад', group: 'store', z0: 0, h: G, roof: 'none',
    tiles: storeTiles, label: V(0, Y2 + 4.6),
    note: 'За Великим залом, між залом меланжу і рудним цехом. Позаду — вхід-воронка зі скошеними укосами (скрін 2).',
    open: [
      seg(V(-3, Y2), V(-2, Y2), 'door', 0, 2.5),
      seg(V(2, Y2), V(3, Y2), 'door', 0, 2.5),
      seg(V(-4.5, Y2 + 3), V(-4.5, Y2 + 5), 'door', 0, 2.5),
      seg(V(4.5, Y2 + 3), V(4.5, Y2 + 5), 'door', 0, 2.5),
      seg(V(-1.5, YB), V(1.5, YB), 'door', 0, 3),
      { ...seg(V(-2.5, YT), V(2.5, YT), 'open'), frame: { n: [0, 1], c: 1.2, fill: true } },
    ],
    items: [
      item('Контейнери', 'storage', V(-3.9, Y2 + 1.6), 0.9, 2.6, 1.2, 0),
      item('Контейнери', 'storage', V(3.9, Y2 + 1.6), 0.9, 2.6, 1.2, 0),
      item('Контейнери', 'storage', V(-3.9, Y2 + 6.3), 0.9, 2.4, 1.2, 0),
      item('Контейнери', 'storage', V(3.9, Y2 + 6.3), 0.9, 2.4, 1.2, 0),
      item('Контейнери', 'storage', V(-2.2, Y2 + 7.4), 2.4, 0.8, 1.2, 0),
      item('Контейнери', 'storage', V(2.2, Y2 + 7.4), 2.4, 0.8, 1.2, 0),
      item('Контейнери', 'storage', V(-1.4, Y2 + 3.8), 0.9, 3.0, 1.2, 0),
      item('Контейнери', 'storage', V(1.4, Y2 + 3.8), 0.9, 3.0, 1.2, 0),
      item('Генератор', 'power', V(2.4, Y2 + 6.0), 1.2, 1.2, 1.8, 0),
    ],
  });

  addRoom({
    id: 'spice', name: 'Зал меланжу', group: 'refine', z0: 0, h: BACK, roof: 'solid',
    tiles: sideL, rim: sideRimL, rimDrop: 1, label: V(-6.6, Y2 + 4.7),
    note: '2 великі переробники спайсу (3×2, 5 стін) біля входу, цистерна за вежею. Поруч водний блок і склад піску. Задні кути заокруглені трикутниками.',
    open: [
      seg(V(-8, Y2), V(-7, Y2), 'door', 0, 2.5),
      seg(V(-4.5, Y2 + 3), V(-4.5, Y2 + 5), 'door', 0, 2.5),
      seg(V(-7.5, Y2 + 5), V(-6.5, Y2 + 5), 'door', 0, 2.5),
    ],
    items: [
      item('Переробник спайсу', 'refine', V(-8.5, Y2 + 2.6), 2.9, 1.9, 5, 90, { full: 'Великий переробник спайсу' }),
      item('Переробник спайсу', 'refine', V(-6.3, Y2 + 2.6), 2.9, 1.9, 5, 90, { full: 'Великий переробник спайсу' }),
      item('Цистерна', 'water', V(-7.0, Y2 + 8.8), 1.5, 1.5, 2.5, 0),
    ],
  });

  addRoom({
    id: 'ore', name: 'Рудний цех', group: 'refine', z0: 0, h: G, roof: 'none',
    tiles: mirrorTiles(sideL), label: V(6.6, Y2 + 4.7),
    note: '2 великі переробники руди (3×2, до 2 стін) біля входу, середній — за вежею. Третій великий — у сусідньому блоці руди. Над цехом — майстерня техніки.',
    open: [
      seg(V(8, Y2), V(7, Y2), 'door', 0, 2.5),
      seg(V(4.5, Y2 + 3), V(4.5, Y2 + 5), 'door', 0, 2.5),
      seg(V(7.5, Y2 + 5), V(6.5, Y2 + 5), 'door', 0, 2.5),
    ],
    items: [
      item('Переробник руди', 'refine', V(8.5, Y2 + 2.4), 2.9, 1.9, 2, 90, { full: 'Великий переробник руди' }),
      item('Переробник руди', 'refine', V(6.3, Y2 + 2.4), 2.9, 1.9, 2, 90, { full: 'Великий переробник руди' }),
      item('Середній переробник', 'refine', V(7.0, Y2 + 8.8), 1.5, 1.5, 2, 0, { full: 'Середній переробник руди' }),
    ],
  });

  // ===== Рівень +5 =====
  addRoom({
    id: 'balcony', name: 'Балкон', group: 'core', z0: G, h: CAR - G, roof: 'none',
    tiles: rect(-2.5, 0, 5, 12), label: V(-0.6, 4.2),
    note: 'Над центральним заїздом і під ангаром грузових. Спереду відкритий з парапетом. З боків — перехід до ангара скаутів і дах гаража багі, позаду галерея залу, сходи вгору в ангар грузових.',
    open: [
      seg(V(-2.5, 0), V(2.5, 0), 'balcony'),
      seg(V(-2.5, 9), V(-2.5, 10), 'door'),
      seg(V(-2.5, 1), V(-2.5, 8), 'glass', G + 0.8, CAR - 0.2),
      seg(V(2.5, 4), V(2.5, 6), 'door'),
      seg(V(2.5, 1), V(2.5, 3.5), 'glass', G + 0.8, CAR - 0.2),
      seg(V(2.5, 6.5), V(2.5, 9), 'glass', G + 0.8, CAR - 0.2),
      seg(V(-1.5, 12), V(1.5, 12), 'door'),
    ],
    items: [stairs('Сходи в ангар грузових', V(1.7, 9.45), 3.5, 1.4, 90, G, CAR)],
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
    id: 'garageRoof', name: 'Дах гаража багі', short: 'Дах гаража', group: 'deck', z0: G, h: 0, roof: 'none',
    tiles: rect(2.5, 0, 6, 10), label: V(5.25, 9.3),
    note: '8 вітропасток із проходом: балкон ↔ ангар асаултів ↔ передній майданчик. Сюди виходять сходи з гаража.',
    open: [seg(V(2.5, 0), V(2.5, 10), 'open'), seg(V(5.96, 10), V(8.5, 10), 'open')],
    items: [],
  });

  both(
    {
      id: 'hangarL', name: 'Ангар скаутів', group: 'air', z0: G, h: HANG, roof: 'solid',
      tiles: [...hangarSq, ...hangarNose], label: hL(1.2, 3.0),
      skylight: skylightL, crown: { tiles: crownL, h: 1 }, eave: true,
      note: 'Скляний бокс на цоколі (скрін 1): фронт 4 плити, закруглення по 2, далі рівні боки. Стіни — пентащит. Дах у 2 яруси (скрін 3): нижній +8 на весь контур, верхній +9 з відступом на плиту і пентащитом-світликом 2×4. Виліт спереду, з боків і вгору.',
      open: [
        seg(A, A1, 'shield', G, G + HANG - 0.3), seg(B, B1, 'shield', G, G + HANG - 0.3),
        seg(A1, F1, 'shield', G, G + HANG - 0.3), seg(F1, F2, 'shield', G, G + HANG - 0.3), seg(F2, B1, 'shield', G, G + HANG - 0.3),
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
      note: 'Перед фронтом ангара, на даху складу піску.',
      open: [seg(F1, F2, 'open'), seg(F1, V(-8.5, 10), 'open')],
      items: [],
    },
    mirrorRoom('apronR', 'Передній майданчик асаултів')
  );

  both(
    {
      id: 'backApronL', name: 'Задній майданчик', short: 'Задній майданчик', group: 'deck', z0: G, h: 0, roof: 'none',
      tiles: backTri, label: V(-7.2, 16.4),
      note: 'Дах водного блоку: бічний виліт ангара, двері галереї.',
      open: [seg(B, B1, 'open'), seg(B1, F2, 'open'), seg(B, V(-4, Y2), 'open'), seg(V(-10, Y2), V(-4, Y2), 'open')],
      items: [],
    },
    mirrorRoom('backApronR', 'Задній майданчик')
  );

  addRoom({
    id: 'backCourt', name: 'Задній двір', group: 'deck', z0: G, h: 0, roof: 'none',
    tiles: storeTiles, label: V(0, Y2 + 7.5),
    note: 'Дах складу між задньою воронкою ангара грузових і воронкою заднього входу: вітряки, вітропастка, вихід із галереї, місток над головою.',
    open: [seg(V(-4.5, Y2), V(4.5, Y2), 'open'), seg(V(-4.5, Y2), V(-4.5, Y2 + 8), 'open'), seg(V(4.5, Y2), V(4.5, Y2 + 8), 'open')],
    items: [],
  });

  addRoom({
    id: 'workshop', name: 'Майстерня техніки', group: 'craft', z0: G, h: BACK - G, roof: 'solid',
    tiles: mirrorTiles(sideL), rim: mirrorTiles(sideRimL), rimDrop: 1, label: V(6.6, Y2 + 4.7),
    note: 'Над рудним цехом: фабрикатор техніки і ремонт. Вхід із правої вежі.',
    open: [seg(V(7.5, Y2 + 5), V(6.5, Y2 + 5), 'door')],
    items: [
      item('Фабрикатор техніки', 'craft', V(8.1, Y2 + 2.1), 3.6, 2.6, 2, 90),
      item('Ремонт', 'craft', V(5.3, Y2 + 2.1), 2.6, 1.4, 1.4, 90, { full: 'Ремонтна станція' }),
    ],
  });

  // ===== Рівень +9 =====
  addRoom({
    id: 'carrier', name: 'Ангар грузових', group: 'air', z0: CAR, h: 4, roof: 'solid',
    tiles: [...carBody, ...flareF, ...flareR], label: V(0, 16.3), label3d: V(0, CY1 - 0.3),
    roofSlope: { x: 4.5, w: 1, drop: 1 },
    note: 'Два грузові 4×9 поруч, 9 плит завширшки. Наскрізний: спереду виліт над злітною терасою, ззаду — між вежами під містком. На кінцях розтруби під 60° з рамками зі зрізаними кутами (скрін 5), по боках скляна смуга. Над ангаром ступінчаста піраміда (скрін 4).',
    open: [
      { ...seg(V(-5.5, CY0 - 2 * R3), V(5.5, CY0 - 2 * R3), 'open'), frame: { c: 1, fill: false } },
      { ...seg(V(-5.5, CY1 + 2 * R3), V(5.5, CY1 + 2 * R3), 'open'), frame: { c: 1, fill: false } },
      seg(V(-4.5, Y2), V(-4.5, Y2 + 1), 'door', CAR, CAR + 2.5),
      seg(V(4.5, Y2), V(4.5, Y2 + 1), 'door', CAR, CAR + 2.5),
      seg(V(-4.5, CY0), V(-4.5, Y2), 'glass', CAR + 0.7, CAR + 3.3),
      seg(V(4.5, CY0), V(4.5, Y2), 'glass', CAR + 0.7, CAR + 3.3),
    ],
    items: [
      item('Грузовий', 'air', V(-2.35, Y2 - 3.3), 9, 4, 2.2, 90),
      item('Грузовий', 'air', V(2.35, Y2 - 3.3), 9, 4, 2.2, 90),
      item('Люк сходів', 'hatch', V(1.7, 10.4), 1.6, 1.4, 0.05, 90),
      stairs('Сходи на дах між грузовими', V(0, CY1 - 4.8), 3, 0.6, 90, CAR, CAR + 4),
    ],
  });

  addRoom({
    id: 'launchDeck', name: 'Злітна тераса', short: 'Злітна тераса', group: 'deck', z0: CAR, h: 0, roof: 'none',
    tiles: rect(-2.5, 0, 5, 9), label: V(0, 3.0),
    note: 'Дах балкона на +9, урівень з підлогою ангара грузових: грузові виїжджають просто на терасу.',
    open: [seg(V(-2.5, 9), V(2.5, 9), 'open')],
    items: [],
  });

  both(
    {
      id: 'towerBalconyL', name: 'Балкон лівої вежі', short: 'Балкон вежі', group: 'deck', z0: DECK, h: 0, roof: 'none',
      tiles: towerBalconyL, label: V(-9.0, Y2 + 8.4),
      note: 'Заокруглений балкон навколо вежі на +13, під навісом ліхтаря. З вежі виходиш на балкон з трьох боків, з четвертого — на місток.',
      open: [
        seg(V(-8.5, Y2 + 5), V(-5.5, Y2 + 5), 'open'),
        seg(V(-8.5, Y2 + 5), V(-8.5, Y2 + 8), 'open'),
        seg(V(-8.5, Y2 + 8), V(-5.5, Y2 + 8), 'open'),
      ],
      items: [],
    },
    mirrorRoom('towerBalconyR', 'Балкон правої вежі')
  );

  addRoom({
    id: 'bridge', name: 'Місток між вежами', short: 'Місток', group: 'deck', z0: DECK, h: 0, roof: 'none',
    tiles: rect(-5.5, Y2 + 6, 11, 1), label: V(0, Y2 + 6.5),
    note: 'На +13 між вежами, над заднім двором: грузові вилітають із задньої воронки під ним.',
    open: [seg(V(-5.5, Y2 + 6), V(-5.5, Y2 + 7), 'open'), seg(V(5.5, Y2 + 6), V(5.5, Y2 + 7), 'open')],
    items: [],
  });

  // ===== Піраміда над центром (скрін 4) =====
  // Ступінчаста гора над порталом ангара грузових на всю його ширину (скрін 4): кожен ярус — низька
  // стінка і скошений уступ на 1 плиту, нагорі пологий гребінь. Позаду гори — ряди вітряків.
  addRoom({
    id: 'pyrA', name: 'Піраміда, ярус 1', group: 'crown', z0: CAR + 4, h: 1, roof: 'tier',
    tiles: rect(-4.5, CY0, 9, 5), note: 'Перший ярус на всю ширину ангара грузових: стінка і скошений уступ.', open: [], items: [],
  });
  addRoom({
    id: 'pyrB', name: 'Піраміда, ярус 2', group: 'crown', z0: CAR + 5, h: 1, roof: 'tier',
    tiles: rect(-3.5, CY0 + 1, 7, 3), note: 'Другий ярус.', open: [], items: [],
  });
  addRoom({
    id: 'pyrC', name: 'Піраміда, гребінь', group: 'crown', z0: CAR + 6, h: 0.4, roof: 'pyramid', apex: 0.8,
    tiles: rect(-2.5, CY0 + 2, 5, 1), note: 'Пологий гребінь-купол.', open: [], items: [],
  });

  both(
    {
      id: 'lanternL', name: 'Ліхтар лівої вежі', short: 'Ліхтар', group: 'tower', z0: TOWER, h: 2.5, roof: 'pyramid',
      tiles: roundedBlock(-8.5, Y2 + 5, 3, 3), label: V(-7, Y2 + 6.5),
      note: 'Верх вежі: круглий з трикутників, нависає над балконом.',
      open: [], items: [],
    },
    mirrorRoom('lanternR', 'Ліхтар правої вежі')
  );

  // ---------- дахи: вітряки і пастки ----------
  const roofItems = [];
  const turbine = (x, y, z) => roofItems.push(item('Спрямований вітряк', 'turbine', V(x, y), 1.8, 1.8, 3, 0, { z }));
  const windtrap = (x, y, z) => roofItems.push(item('Велика вітропастка', 'windtrap', V(x, y), 2, 2, 2.6, 0, { z }));
  // 20 вітряків: 12 рядами на даху ангара грузових за пірамідою (+13), дахи бічних корпусів (+9),
  // задній двір (+5), задні майданчики біля залу (+5).
  for (const x of [-3.4, -1.3, 1.3, 3.4]) for (const y of [CY1 - 4.9, CY1 - 2.95, CY1 - 1.0]) turbine(x, y, CAR + 4);
  for (const sx of [-1, 1]) for (const y of [Y2 + 0.95, Y2 + 2.95]) turbine(sx * 6.6, y, BACK);
  for (const x of [-3.0, 3.0]) turbine(x, Y2 + 7.95, G);
  for (const sx of [-1, 1]) turbine(sx * 6.0, 18.85, G);
  // 15 вітропасток: дах гаража багі (+5), дахи бічних корпусів (+9), задній двір (+5).
  for (const [x, y] of [[3.5, 1.1], [5.5, 1.1], [7.5, 1.1], [3.5, 3.1], [5.5, 3.1], [7.5, 3.1], [3.5, 7.0], [5.5, 7.0]]) windtrap(x, y, G);
  for (const sx of [-1, 1]) for (const y of [Y2 + 1.0, Y2 + 3.05]) windtrap(sx * 8.5, y, BACK);
  for (const x of [-2.2, 0, 2.2]) windtrap(x, Y2 + 4.85, G);

  // Пункт 17: балкон між нижніми ангарами — тераса або додатковий вхід.
  const variants = {
    terrace: {
      label: 'Балкон-тераса',
      note: 'Балкон і злітна тераса як оглядові майданчики. Для бази на краю скелі, коли фронт недоступний пішки.',
      items: [
        item('Лава', 'furniture', V(-0.9, 1.6), 2.4, 0.7, 0.5, 0, { z: G }),
        item('Лава', 'furniture', V(-0.9, 1.4), 2.4, 0.7, 0.5, 0, { z: CAR }),
      ],
    },
    entrance: {
      label: 'Балкон-вхід',
      note: 'Посадка скаута на злітну терасу, пішохідний шлюз у балконі. Для бази, до якої підходять з фронту.',
      items: [
        item('Посадка скаута', 'pad', V(0, 4.0), 4, 4, 0.05, 0, { z: CAR }),
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

  // ---------- зубчасті боки: колони, вікна, карниз ----------
  // Трикутні фундаменти не дають рівної стіни вздовж межі ділянок x = ±10: між гаражем і залом меланжу
  // стіна виходить зубчастою (виступ — западина через кожні 0,87 плити). Тому на кожному виступі —
  // колона Harkonnen Stronghold (Pillar Bottom / Middle / Top), у западинах — вікна (Window),
  // зверху рівний карниз (Roof Cover). Зубці стають ритмом колон, як ребра на стінах зі скрінів.
  const decor = [];
  for (const [id, mid] of [['plinthL', 'plinthR'], ['waterL', 'oreR']]) {
    const r = rooms.find((x) => x.id === id), rm = rooms.find((x) => x.id === mid);
    for (const e of boundaryEdges(r.tiles)) {
      if (Math.max(e.a.x, e.b.x) > -9.4) continue;
      const w = seg(e.a, e.b, 'glass', 1.2, 3.6);
      r.open.push(w);
      rm.open.push(mirrorSeg(w));
    }
  }
  const tips = new Map();
  for (const id of ['plinthL', 'waterL'])
    for (const t of rooms.find((x) => x.id === id).tiles)
      for (const q of t.p) if (q.x < -9.8) tips.set(keyOf(q), q);
  const tipList = [...tips.values()].sort((a, b) => a.y - b.y);
  // у широкому проміжку на стику двох трикутних граток — ще одна колона, щоб ритм був рівний
  for (let i = tipList.length - 1; i > 0; i--)
    if (tipList[i].y - tipList[i - 1].y > 2.2) tipList.splice(i, 0, V(-9.98, (tipList[i].y + tipList[i - 1].y) / 2));
  for (const q of tipList)
    for (const sx of [1, -1]) decor.push({ kind: 'pillar', name: 'Колона Харконненів (Pillar)', c: V(sx * q.x, q.y), z0: 0, z1: G + 0.75 });
  const cy0 = tipList[0].y, cy1 = tipList[tipList.length - 1].y;
  for (const sx of [1, -1])
    decor.push({ kind: 'cornice', name: 'Карниз (Roof Cover)', x0: sx * -10.05, x1: sx * -9.4, y0: cy0, y1: cy1, z: G - 0.2, h: 0.75 });

  // Рівні для плану: підлоги з z0 у [z0, z1).
  const levels = [
    { key: 'g', name: 'Рівень 0', sub: 'земля', z0: 0, z1: G },
    { key: 'u', name: 'Рівень +5', sub: 'ангари, балкон, двір', z0: G, z1: CAR },
    { key: 't', name: 'Рівень +9', sub: 'ангар грузових, злітна тераса', z0: CAR, z1: CAR + 4 },
    { key: 'r', name: 'Дах', sub: 'піраміда, балкони веж, місток, пристрої', z0: CAR + 4, z1: 99 },
  ];

  const model = {
    R3, V, add, sub, mul, dir, centroid, pointInPoly,
    claims, rooms, roofItems, levels, variants, decor,
    boundaryEdges, roomEdges, labelPoint, roomArea, tileArea, edgeKey,
    heights: { G, HANG, CAR, BACK, TOWER, DECK, TOP: CAR + 4 },
    bounds: { x0: -10, x1: 10, y0: 0, y1: 30 },
    key: { A, B, A1, B1, F1, F2, Y2, CY0, CY1 },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else root.BASE = model;
})(typeof window !== 'undefined' ? window : globalThis);

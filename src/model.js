/*
 * Модель бази "Цитадель Харконненів" для Dune: Awakening.
 *
 * Одиниці: 1 = сторона квадратного фундаменту (і трикутного теж).
 * Висота: 1 рівень = висота однієї стіни.
 * План: x — вправо, y — вглиб бази (фронт на y = 0, тил на y = 20).
 * Ділянки: 6 штук по 10x10, сітка 3 x 2 (x від -15 до 15, y від 0 до 20).
 *
 * Усі приміщення складені тільки з квадратів ('s') і рівносторонніх
 * трикутників ('t') зі стороною 1. Повернуті під 30 градусів частини
 * (ангари) і шестикутний зал отримані так само, як у грі:
 * квадрат -> трикутник -> повернутий квадрат.
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
  // Повертає трикутники, центр яких лежить усередині полігона.
  function triangles(o, aDeg, poly) {
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
        for (const tri of [up, dn]) if (pointInPoly(centroid(tri), poly)) out.push({ k: 't', p: tri });
      }
    return out;
  }

  // "Округлена" башта: ядро w x d + ряд трикутників по периметру + кутові вставки
  // (повернутий квадрат + трикутник), як на скріншоті 4. Виходить майже 12-кутник.
  function roundedBlock(x0, y0, w, d) {
    const out = rect(x0, y0, w, d);
    const x1 = x0 + w, y1 = y0 + d;
    out.push(...triangles(V(x0, y0), 0, [V(x0, y0), V(x1, y0), V(x1 - 0.5, y0 - R3), V(x0 + 0.5, y0 - R3)]));
    out.push(...triangles(V(x0, y1), 0, [V(x0, y1), V(x1, y1), V(x1 - 0.5, y1 + R3), V(x0 + 0.5, y1 + R3)]));
    out.push(...triangles(V(x1, y0), 90, [V(x1, y0), V(x1, y1), V(x1 + R3, y1 - 0.5), V(x1 + R3, y0 + 0.5)]));
    out.push(...triangles(V(x0, y0), 90, [V(x0, y0), V(x0, y1), V(x0 - R3, y1 - 0.5), V(x0 - R3, y0 + 0.5)]));
    // кутові вставки: для кута (x1, y0) вільний сектор 240..390 градусів
    const corner = (c, sx, sy) => {
      const f = (p) => V(c.x + sx * p.x, c.y + sy * p.y);
      const a = dir(240), b = dir(330), t = dir(30);
      out.push({ k: 's', p: [V(0, 0), a, add(a, b), b].map(f) });
      out.push({ k: 't', p: [V(0, 0), b, t].map(f) });
    };
    corner(V(x1, y0), 1, 1);
    corner(V(x0, y0), -1, 1);
    corner(V(x1, y1), 1, -1);
    corner(V(x0, y1), -1, -1);
    return out;
  }

  const mirrorTiles = (tiles) => tiles.map((t) => ({ k: t.k, p: t.p.map(mirrorPt) }));
  const mirrorSeg = (o) =>
    o.box ? { ...o, box: [-o.box[1], -o.box[0], o.box[2], o.box[3]] } : { ...o, a: mirrorPt(o.a), b: mirrorPt(o.b) };

  // Предмет (техніка, обладнання) як прямокутник у власних осях.
  // c — центр, w — уздовж кута ang, d — поперек, h — висота в рівнях, z — рівень підлоги.
  const item = (name, kind, c, w, d, h, ang = 0, extra = {}) => ({ name, kind, c, w, d, h, ang, ...extra });
  const mirrorItem = (it) => ({ ...it, c: mirrorPt(it.c), ang: 180 - it.ang });

  // ---------- геометрія ----------

  const claims = [];
  for (const cx of [-15, -5, 5]) for (const cy of [0, 10]) claims.push({ x: cx, y: cy, w: 10, d: 10 });

  const G = 4;      // висота першого ярусу (заїзд, гаражі, Великий зал, цоколі ангарів)
  const UP = 4;     // висота верхнього ярусу (ангари, наскрізний ангар)
  const SIDE = 7;   // висота бічних корпусів (зал меланжу, рудний цех + майстерня)

  // Крило: внутрішній передній кут на стіні гаража, лицьова сторона під 30 градусів.
  const I = V(-7.5, 6);
  const u1 = dir(210); // уздовж лицьової сторони, назовні й уперед
  const u2 = dir(120); // углиб крила
  const OF = add(I, mul(u1, 6));
  const OB = add(OF, mul(u2, 4));
  const IB = add(I, mul(u2, 4));
  const wingSq = squares(I, u1, u2, 6, 4);
  const apronTri = triangles(I, 210, [I, V(-7.5, 0), OF]);
  const stripPoly = [OB, IB, add(IB, dir(150)), add(OB, dir(90))];
  const stripTri = triangles(OB, 30, stripPoly);
  const wingLocal = (a, b) => add(I, add(mul(u1, a), mul(u2, b))); // точка в осях крила

  // Великий зал: шестикутник (5-3-3-5-3-3) на трикутній гратці + ніші + неф.
  const A0 = V(-2.5, 10);
  const yTop = 10 + 6 * R3;
  const hexPoly = [V(-2.5, 10), V(2.5, 10), V(4, 10 + 3 * R3), V(2.5, yTop), V(-2.5, yTop), V(-4, 10 + 3 * R3)];
  const fillerL = [V(-7.5, 10), V(-2.5, 10), V(-5, 10 + 5 * R3)];
  const chapelL = [V(-7.49, 10), V(-5, 10 + 5 * R3), V(-4, 10 + 3 * R3), V(-2.5, yTop), V(-7.49, yTop)];

  const towerCore = (x) => rect(x, 10, 3, 3);
  const inTower = (t) => {
    const c = centroid(t.p);
    return c.x > -10.5 && c.x < -7.5 && c.y > 10 && c.y < 13;
  };
  const sideBlockL = rect(-14.5, 10, 7, 10).filter((t) => !inTower(t));

  // ---------- приміщення ----------
  // h = 0 означає відкритий майданчик (палуба) з парапетом.
  // roof: 'solid' | 'none' | 'shield' | 'pyramid'
  // open: прорізи у стінах: 'open' (без стіни), 'shield' (пентащит), 'glass', 'door'.
  const rooms = [];
  const addRoom = (r) => { rooms.push(r); return r; };
  const both = (r, mirror) => { addRoom(r); addRoom(mirror(r)); };
  const mirrorRoom = (id, name, extra = {}) => (r) => ({
    ...r,
    id, name,
    tiles: mirrorTiles(r.tiles),
    open: (r.open || []).map(mirrorSeg),
    items: (r.items || []).map(mirrorItem),
    label: r.label ? mirrorPt(r.label) : undefined,
    ...extra,
  });

  // === Перший ярус (z 0..4) ===
  addRoom({
    id: 'corridor', name: 'Центральний заїзд', group: 'drive', z0: 0, h: G, roof: 'none',
    tiles: rect(-2.5, 0, 5, 10), slopes: true,
    note: '3 плити рівної підлоги + 2 похилі, разом 5. Попереду виїзд, позаду центральний вхід, з боків гаражі (скрін 3).',
    open: [
      { a: V(-2.5, 0), b: V(2.5, 0), type: 'open' },
      { a: V(-1.5, 10), b: V(1.5, 10), type: 'door' },
      { a: V(-2.5, 1), b: V(-2.5, 9), type: 'glass' },
      { a: V(2.5, 1), b: V(2.5, 9), type: 'glass' },
    ],
    items: [item('Світлова стеля', 'light', V(0, 5), 9, 2.4, 0.02, 90, { z: G - 0.1 })],
  });

  addRoom({
    id: 'garageL', name: 'Гараж краулера', group: 'drive', z0: 0, h: G, roof: 'none',
    tiles: rect(-7.5, 0, 5, 10), label: V(-5, 9.1),
    note: 'Стеля над краулером — горизонтальний пентащит: грузовий орні спускається і забирає краулер.',
    open: [
      { a: V(-7, 0), b: V(-3, 0), type: 'shield' },
      { a: V(-6, 10), b: V(-4, 10), type: 'door' },
    ],
    items: [item('Краулер', 'vehicle', V(-5, 4.6), 7, 3.5, 2.2, 90)],
  });

  addRoom({
    id: 'garageR', name: 'Гараж: багі + піскоцикл', short: 'Гараж багі', group: 'drive', z0: 0, h: G, roof: 'none',
    tiles: rect(2.5, 0, 5, 10), label: V(5, 7.2),
    note: 'Прямий виїзд уперед + вихід у заїзд. Позаду двері до складу руди.',
    open: [
      { a: V(3, 0), b: V(7, 0), type: 'shield' },
      { a: V(4, 10), b: V(6, 10), type: 'door' },
    ],
    items: [
      item('Багі', 'vehicle', V(4.25, 4.5), 3, 2, 1.4, 90),
      item('Піскоцикл', 'vehicle', V(6.5, 4), 2, 1, 1.1, 90),
      item('Ремонтна станція', 'craft', V(5, 8.6), 2, 1.2, 1.2, 0),
    ],
  });

  both(
    {
      id: 'plinthL', name: 'Водний блок', group: 'craft', z0: 0, h: G, roof: 'none',
      tiles: [...wingSq, ...apronTri, ...stripTri],
      label: V(-9.3, 2.9),
      note: 'Цоколь під ангаром скаутів. Вода для переробки спайсу: цистерни + дистилятор (Deathstill).',
      open: [{ a: V(-7.5, 1), b: V(-7.5, 3), type: 'door' }],
      items: [
        item('Цистерна', 'water', wingLocal(1, 1.2), 2, 2, 2.5, 210),
        item('Цистерна', 'water', wingLocal(3, 1.2), 2, 2, 2.5, 210),
        item('Цистерна', 'water', wingLocal(5, 1.2), 2, 2, 2.5, 210),
        item('Deathstill', 'refine', wingLocal(4.6, 3.2), 2, 1.4, 2, 210),
        item('Цистерна', 'water', wingLocal(1.6, 3.2), 2, 1.4, 2.5, 210),
      ],
    },
    mirrorRoom('plinthR', 'Фабрикатори', {
      group: 'craft',
      note: 'Цоколь під ангаром асаултів. Фабрикатори поруч із гаражем і складом руди.',
      items: [
        item('Фаб. виживання', 'craft', mirrorPt(wingLocal(1, 1.2)), 2, 2, 1.6, -30),
        item('Фаб. зброї', 'craft', mirrorPt(wingLocal(3, 1.2)), 2, 2, 1.6, -30),
        item('Фаб. одягу', 'craft', mirrorPt(wingLocal(5, 1.2)), 2, 2, 1.6, -30),
        item('Склад компонентів', 'storage', mirrorPt(wingLocal(3, 3.3)), 4, 1, 1.2, -30),
      ],
    })
  );

  addRoom({
    id: 'hall', name: 'Великий зал', group: 'core', z0: 0, h: G, roof: 'none',
    tiles: triangles(A0, 0, hexPoly),
    label: V(0, 14.1),
    note: 'Шестикутник із трикутників, як на скріні 4. В центрі консоль суб-фіфу. Над залом — наскрізний ангар.',
    open: [
      { a: V(-1.5, 10), b: V(1.5, 10), type: 'door' },
      { a: V(-1.5, yTop), b: V(1.5, yTop), type: 'open' },
      { a: V(-3.5, 10 + 4 * R3), b: V(-3, 10 + 5 * R3), type: 'open' },
      { a: V(3.5, 10 + 4 * R3), b: V(3, 10 + 5 * R3), type: 'open' },
      { a: V(-3, 10 + R3), b: V(-3.5, 10 + 2 * R3), type: 'open' },
      { a: V(3, 10 + R3), b: V(3.5, 10 + 2 * R3), type: 'open' },
    ],
    items: [item('Консоль суб-фіфу', 'console', V(0, 12.6), 1, 1, 1.4, 0)],
  });

  both(
    {
      id: 'sandL', name: 'Склад спайсового піску', short: 'Склад піску', group: 'store', z0: 0, h: G, roof: 'none',
      tiles: triangles(A0, 0, fillerL), label: V(-5, 12.25),
      note: 'Між гаражем краулера і залом меланжу: пісок їде найкоротшим шляхом.',
      open: [
        { a: V(-6, 10), b: V(-4, 10), type: 'door' },
        { a: V(-7, 10 + R3), b: V(-6, 10 + 3 * R3), type: 'door' },
        { a: V(-3, 10 + R3), b: V(-3.5, 10 + 2 * R3), type: 'open' },
      ],
      items: [item('Контейнери', 'storage', V(-5, 10.6), 3.4, 0.9, 1.2, 0)],
    },
    mirrorRoom('oreR', 'Склад руди', {
      short: 'Склад руди',
      note: 'Між гаражем багі (лазер) і рудним цехом.',
    })
  );

  both(
    {
      id: 'lobbyL', name: 'Вестибюль лівої башти', short: 'Вестибюль', group: 'core', z0: 0, h: G, roof: 'none',
      tiles: triangles(A0, 0, chapelL), label: V(-5.9, 14.55),
      note: 'Ніша між залом і баштою: прохід до башти, залу меланжу та енергоблоку.',
      open: [
        { box: [-7.6, -6.4, 10.8, 13], type: 'open' },
        { a: V(-6.5, yTop), b: V(-4.5, yTop), type: 'door' },
        { a: V(-3.5, 10 + 4 * R3), b: V(-3, 10 + 5 * R3), type: 'open' },
        { a: V(-7, 10 + R3), b: V(-6, 10 + 3 * R3), type: 'door' },
      ],
      items: [],
    },
    mirrorRoom('lobbyR', 'Вестибюль правої башти')
  );

  addRoom({
    id: 'store', name: 'Головний склад', group: 'store', z0: 0, h: G, roof: 'none',
    tiles: rect(-2.5, yTop, 5, 4), label: V(0, yTop + 1.6),
    note: 'Неф за шестикутником. Склад між переробкою і фабрикаторами.',
    open: [{ a: V(-1, yTop + 4), b: V(1, yTop + 4), type: 'door' }],
    items: [
      item('Контейнери', 'storage', V(-1.95, yTop + 2), 0.9, 3.6, 1.2, 0),
      item('Контейнери', 'storage', V(1.95, yTop + 2), 0.9, 3.6, 1.2, 0),
      item('Контейнери', 'storage', V(0, yTop + 3.5), 2.8, 0.8, 1.2, 0),
    ],
  });

  addRoom({
    id: 'power', name: 'Енергоблок', group: 'refine', z0: 0, h: G, roof: 'none',
    tiles: rect(-7.5, yTop, 5, 4), label: V(-5, yTop + 1.5),
    note: 'Генератори (спайсові/паливні) як резерв до вітряків на даху.',
    open: [{ a: V(-2.5, yTop + 1), b: V(-2.5, yTop + 3), type: 'door' }, { a: V(-6.5, yTop), b: V(-4.5, yTop), type: 'door' }],
    items: [
      item('Генератор', 'power', V(-6.35, yTop + 3), 2, 1.7, 1.8, 0),
      item('Генератор', 'power', V(-4.1, yTop + 3), 2, 1.7, 1.8, 0),
    ],
  });

  addRoom({
    id: 'chem', name: 'Хімічна переробка', group: 'refine', z0: 0, h: G, roof: 'none',
    tiles: rect(2.5, yTop, 5, 4), label: V(5, yTop + 1.5),
    note: 'Хімічний переробник + середні переробники (руда/спайс) — усе, що не велике.',
    open: [{ a: V(2.5, yTop + 1), b: V(2.5, yTop + 3), type: 'door' }, { a: V(6.5, yTop), b: V(4.5, yTop), type: 'door' }],
    items: [
      item('Хім. переробник', 'refine', V(4.15, yTop + 2.95), 3, 1.8, 2.4, 0),
      item('Середні', 'refine', V(6.55, yTop + 2.95), 1.6, 1.8, 2, 0),
    ],
  });

  addRoom({
    id: 'spice', name: 'Зал меланжу', group: 'refine', z0: 0, h: SIDE, roof: 'solid',
    tiles: sideBlockL,
    label: V(-9.9, 15.6),
    note: '7 рівнів у висоту: великий переробник спайсу потребує 5. Поруч вода і склад піску.',
    open: [{ a: V(-7.5, 13.5), b: V(-7.5, 15), type: 'door' }, { a: V(-10.5, 10.5), b: V(-10.5, 12.5), type: 'door' }],
    items: [
      item('Переробник спайсу', 'refine', V(-12.5, 18.4), 3, 2, 5, 0, { full: 'Великий переробник спайсу' }),
      item('Переробник спайсу', 'refine', V(-9, 18.4), 3, 2, 5, 0, { full: 'Великий переробник спайсу' }),
      item('Цистерна', 'water', V(-13.25, 11.4), 2, 2, 2.5, 0),
      item('Цистерна', 'water', V(-13.25, 14), 2, 2, 2.5, 0),
    ],
  });

  addRoom({
    id: 'ore', name: 'Рудний цех', group: 'refine', z0: 0, h: G, roof: 'none',
    tiles: mirrorTiles(sideBlockL),
    label: V(9.3, 15.1),
    note: '3 великі переробники руди. Над цехом — майстерня техніки.',
    open: [{ a: V(7.5, 13.5), b: V(7.5, 15), type: 'door' }, { a: V(10.5, 10.5), b: V(10.5, 12.5), type: 'door' }],
    items: [
      item('Переробник руди', 'refine', V(12.75, 18.3), 3, 3, 3, 0, { full: 'Великий переробник руди' }),
      item('Переробник руди', 'refine', V(12.75, 14.6), 3, 3, 3, 0, { full: 'Великий переробник руди' }),
      item('Переробник руди', 'refine', V(9.25, 18.3), 3, 3, 3, 0, { full: 'Великий переробник руди' }),
      item('Середній', 'refine', V(12.9, 11.4), 2, 2, 2, 0, { full: 'Середній переробник руди' }),
    ],
  });

  both(
    {
      id: 'towerL', name: 'Ліва башта', short: 'Башта', group: 'tower', z0: 0, h: 8, roof: 'none',
      tiles: towerCore(-10.5), label: V(-9, 11.5),
      note: 'Сходи з землі в наскрізний ангар, на дахи і в оглядовий ліхтар.',
      open: [
        { a: V(-7.5, 10.5), b: V(-7.5, 12.5), type: 'door', z0: 0, z1: 2.5 },
        { a: V(-7.5, 10.5), b: V(-7.5, 12.5), type: 'door', z0: G, z1: G + 2.5 },
        { a: V(-10.5, 10.5), b: V(-10.5, 12.5), type: 'door', z0: 0, z1: 2.5 },
        { a: V(-10, 13), b: V(-8, 13), type: 'door', z0: SIDE, z1: 8 },
      ],
      items: [item('Сходи', 'stairs', V(-9, 11.5), 2.4, 2.4, 0.2, 0)],
    },
    mirrorRoom('towerR', 'Права башта')
  );

  // === Верхній ярус (z 4..8) ===
  both(
    {
      id: 'hangarL', name: 'Ангар скаутів', group: 'air', z0: G, h: UP, roof: 'solid',
      tiles: [...wingSq, ...stripTri],
      label: wingLocal(3, 2.4),
      note: 'Крило під 30 градусів, як на скрінах 1–2. Лицьова сторона — пентащит на посадковий майданчик.',
      open: [{ a: I, b: OF, type: 'shield' }],
      items: [
        item('Скаут', 'air', wingLocal(1.5, 2.2), 3.6, 2.5, 1.5, 120),
        item('Скаут', 'air', wingLocal(4.5, 2.2), 3.6, 2.5, 1.5, 120),
      ],
    },
    mirrorRoom('hangarR', 'Ангар асаултів', {
      items: [
        item('Асаулт', 'air', mirrorPt(wingLocal(1.6, 2.15)), 4.1, 2.8, 1.8, 60),
        item('Асаулт', 'air', mirrorPt(wingLocal(4.4, 2.15)), 4.1, 2.8, 1.8, 60),
      ],
    })
  );

  addRoom({
    id: 'tunnel', name: 'Наскрізний ангар', group: 'air', z0: G, h: UP, roof: 'solid',
    tiles: rect(-7.5, 10, 15, 10),
    label: V(0, 15),
    note: 'Як на скріні 5: проліт крізь будівлю. Дві смуги по 7,5 плити, грузові орні влітають спереду і вилітають ззаду.',
    open: [
      { a: V(-7.5, 10), b: V(7.5, 10), type: 'open' },
      { a: V(-7.5, 20), b: V(7.5, 20), type: 'open' },
      { a: V(-7.5, 10.5), b: V(-7.5, 12.5), type: 'door' },
      { a: V(7.5, 10.5), b: V(7.5, 12.5), type: 'door' },
    ],
    items: [
      item('Грузовий', 'air', V(-3.75, 15), 9, 4.5, 2.2, 90),
      item('Грузовий', 'air', V(3.75, 15), 9, 4.5, 2.2, 90),
    ],
  });

  addRoom({
    id: 'workshop', name: 'Майстерня техніки', group: 'craft', z0: G, h: SIDE - G, roof: 'solid',
    tiles: mirrorTiles(sideBlockL),
    label: V(10.2, 14.7),
    note: 'На рівні ангарів: фабрикатор техніки, ремонт, ресайклер. Двері в наскрізний ангар.',
    open: [{ a: V(7.5, 13.5), b: V(7.5, 16), type: 'door' }],
    items: [
      item('Фабрикатор техніки', 'craft', V(12, 17.8), 4, 3, 2, 0),
      item('Ремонтна станція', 'craft', V(9, 17.9), 2, 2, 1.4, 0),
      item('Ресайклер', 'craft', V(13.2, 13.4), 2, 2, 1.6, 0),
      item('Контейнери', 'storage', V(13.9, 11), 1, 1.8, 1.2, 0),
    ],
  });

  // Палуби (z = 4): тераса між ангарами, посадкові майданчики, пентащит над краулером.
  addRoom({
    id: 'terrace', name: 'Тераса', group: 'deck', z0: G, h: 0, roof: 'none',
    tiles: [...rect(-2.5, 0, 5, 10), ...rect(2.5, 0, 5, 10), ...rect(-7.5, 0, 5, 1)],
    label: V(2.5, 5),
    note: 'Між нижніми ангарами, перед пащею наскрізного ангара.',
    open: [
      { a: V(-7.5, 10), b: V(7.5, 10), type: 'open' },
      { a: V(-7.5, 0), b: V(-7.5, 1), type: 'open' },
      { a: V(7.5, 0), b: V(7.5, 6), type: 'open' },
    ],
    items: [],
  });

  both(
    {
      id: 'apronL', name: 'Майданчик скаутів', short: 'Майданчик', group: 'deck', z0: G, h: 0, roof: 'none',
      tiles: apronTri, label: add(I, add(mul(u1, 2.6), V(0.2, -1.6))),
      note: 'Майданчик перед склом ангара.',
      open: [{ a: I, b: OF, type: 'open' }, { a: V(-7.5, 0), b: V(-7.5, 1), type: 'open' }],
      items: [],
    },
    mirrorRoom('apronR', 'Майданчик асаултів', {
      open: [{ a: mirrorPt(I), b: mirrorPt(OF), type: 'open' }, { a: V(7.5, 0), b: V(7.5, 6), type: 'open' }],
    })
  );

  addRoom({
    id: 'shield', name: 'Пентащит над краулером', short: 'Пентащит', group: 'shield', z0: G, h: 0, roof: 'none',
    tiles: rect(-7.5, 1, 5, 9), label: V(-5, 5.5), deckless: true,
    note: 'Горизонтальний пентащит 5 x 9: грузовий орні проходить крізь нього до краулера.',
    open: [], items: [],
  });

  // Ліхтарі башт над дахом (z 8..11), "круглі" з трикутників.
  both(
    {
      id: 'lanternL', name: 'Ліхтар лівої башти', short: 'Ліхтар', group: 'tower', z0: 8, h: 3, roof: 'pyramid',
      tiles: roundedBlock(-10.5, 10, 3, 3), label: V(-9, 11.5),
      note: 'Верх башти над дахами: круглий з трикутників, дах-піраміда.',
      open: [], items: [],
    },
    mirrorRoom('lanternR', 'Ліхтар правої башти')
  );

  // ---------- дахи: вітряки і пастки ----------
  const roofItems = [];
  // 20 спрямованих вітряків: по 10 на дахах бічних корпусів (z = 7).
  // Слоти 2 x 2 у сітці 3 x 5, крім тих, що під ліхтарем башти.
  for (const side of [-1, 1]) {
    let placed = 0;
    for (let r = 4; r >= 0 && placed < 10; r--)
      for (const x of [13.4, 10.9, 8.5]) {
        const y = 11.2 + r * 1.95;
        const underLantern = x - 0.9 < 11.4 && y - 0.9 < 13.9;
        if (underLantern || placed >= 10) continue;
        roofItems.push(item('Спрямований вітряк', 'turbine', V(side * x, y), 1.8, 1.8, 3, 0, { z: SIDE }));
        placed++;
      }
  }
  // 15 великих вітропасток: дах наскрізного ангара (z = 8), сітка 5 x 3.
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 5; c++)
      roofItems.push(item('Велика вітропастка', 'windtrap', V(-5.6 + c * 2.8, 11.6 + r * 3.4), 2, 2, 2.6, 0, { z: G + UP }));

  // Пункт 17: між нижніми ангарами — тераса або додатковий вхід.
  const variants = {
    terrace: {
      label: 'Тераса',
      note: 'Оглядовий майданчик з парапетом. Для бази на краю скелі, коли фронт недоступний пішки.',
      items: [
        item('Лава', 'furniture', V(4, 2.2), 2.4, 0.7, 0.5, 0, { z: G }),
        item('Лава', 'furniture', V(6.2, 4.5), 2.4, 0.7, 0.5, 90, { z: G }),
        item('Лава', 'furniture', V(-0.2, 1.6), 2.4, 0.7, 0.5, 0, { z: G }),
      ],
    },
    entrance: {
      label: 'Додатковий вхід',
      note: 'Посадка скаута на терасу + пішохідний шлюз у наскрізний ангар і башту. Для бази, до якої підходять з фронту.',
      items: [
        item('Посадка скаута', 'pad', V(4.6, 4.6), 4, 4, 0.05, 0, { z: G }),
        item('Пішохідний шлюз', 'gate', V(6.75, 10.7), 1.3, 1.2, 2.5, 0, { z: G }),
        item('Пішохідний шлюз', 'gate', V(-6.75, 10.7), 1.3, 1.2, 2.5, 0, { z: G }),
      ],
    },
  };

  // ---------- службове: межі приміщень і прорізи ----------
  const keyOf = (p) => {
    const kx = Math.round(p.x * 1000), ky = Math.round(p.y * 1000);
    return (kx === 0 ? 0 : kx) + ',' + (ky === 0 ? 0 : ky);
  };
  function boundaryEdges(tiles) {
    const m = new Map();
    for (const t of tiles)
      for (let i = 0; i < t.p.length; i++) {
        const a = t.p[i], b = t.p[(i + 1) % t.p.length];
        const ka = keyOf(a), kb = keyOf(b);
        const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
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
      const d = sub(o.b, o.a);
      const t = ((m.x - o.a.x) * d.x + (m.y - o.a.y) * d.y) / (d.x * d.x + d.y * d.y);
      if (t < -0.01 || t > 1.01) continue;
      if (Math.hypot(o.a.x + d.x * t - m.x, o.a.y + d.y * t - m.y) < 0.06) out.push(o);
    }
    return out;
  }
  const roomEdges = (room) => boundaryEdges(room.tiles).map((e) => ({ ...e, open: edgeOpenings(room, e.a, e.b) }));
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
    let A = 0, x = 0, y = 0;
    for (const t of room.tiles) {
      const a = tileArea(t), c = centroid(t.p);
      A += a; x += c.x * a; y += c.y * a;
    }
    return V(x / A, y / A);
  }
  const roomArea = (room) => room.tiles.reduce((s, t) => s + tileArea(t), 0);

  const levels = [
    { key: 'g', name: 'Рівень 0', sub: 'земля, висота 4', zMin: 0, zMax: G },
    { key: 'u', name: 'Рівень +4', sub: 'ангари і тераса', zMin: G, zMax: G + UP },
    { key: 'r', name: 'Дах', sub: 'вітряки і пастки', zMin: G + UP, zMax: 99 },
  ];

  const model = {
    R3, V, add, sub, mul, dir, centroid, pointInPoly,
    claims, rooms, roofItems, levels, variants,
    boundaryEdges, roomEdges, labelPoint, roomArea, tileArea,
    heights: { G, UP, SIDE },
    bounds: { x0: -15, x1: 15, y0: 0, y1: 20 },
    key: { I, OF, OB, IB, yTop },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else root.BASE = model;
})(typeof window !== 'undefined' ? window : globalThis);

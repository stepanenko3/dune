/*
 * Модель форпосту Sandwalkers DD у Глибокій пустелі (Deep Desert) для Dune: Awakening (сардаукарський набір).
 *
 * Одна ділянка 10 x 10 (x від -5 до 5, y від 0 до 10, фронт на y = 0), уся забудована квадратами —
 * без трикутників, щоб щотижня ставити швидко. Переробки немає: руду і спайс веземо на Main.
 *
 *   Ліворуч ангар важкої техніки 6 x 10 на 5 стін, у даху пентащит 4 x 9: краулер і вантажний контейнер
 *   або грузовий (4 x 9) — усі троє разом не вміщаються.
 *   Праворуч 2 поверхи по стіні x = 1 і y = 4 (стіна над стіною):
 *     0 … +2  гараж багі з пентащитом у фронті, майстерня з генераторами;
 *     +2 … +5 склад, ангар асаулта з вильотом угору крізь пентащит у даху.
 */
(function (root) {
  'use strict';

  const GEOM = typeof module !== 'undefined' && module.exports ? require('./geom.js') : root.GEOM;
  const { R3, V, add, sub, mul, dir, centroid, pointInPoly, rect, item, stairs, seg, boundaryEdges, roomEdges, tileArea, labelPoint, roomArea, edgeKey, exteriorEdgesIn } = GEOM;

  // ---------- висоти ----------
  const G = 2;    // правий блок: 0 … +2 гараж і майстерня, +2 … +5 склад і ангар асаулта
  const TOP = 5;  // дах; ангар важкої техніки — на всю висоту 0 … +5

  const claims = [{ x: -5, y: 0, w: 10, d: 10 }];

  // ---------- приміщення ----------
  const rooms = [];
  const addRoom = (r) => { rooms.push(r); return r; };
  const box = (x, y) => item('Контейнер', 'storage', V(x, y), 0.9, 0.9, 2, 0);
  const gen = (x, y) => item('Генератор', 'power', V(x, y), 1.2, 1.2, 1.8, 0, { full: 'Паливний генератор (75)' });
  const sky = rect(-4, 1, 4, 9);   // пентащит над важкою технікою: грузовий 4×9 опускається крізь нього
  const skyA = rect(1, 5, 4, 5);   // пентащит над асаултом 4×5

  // ===== Ангар важкої техніки: 0 … +5 =====
  addRoom({
    id: 'bay', name: 'Ангар важкої техніки', short: 'Важка техніка', group: 'drive', z0: 0, h: TOP, roof: 'solid', eave: true,
    tiles: rect(-5, 0, 6, 10), skylight: sky, label: V(-2.0, 6.27), label3d: V(-2.0, 9.6),
    note: 'Грузовий опускає краулер і контейнер крізь пентащит 4×9 у даху і забирає їх так само. Або тут стоїть сам грузовий — тоді краулер і контейнер лишаються надворі. Двері в майстерню.',
    open: [seg(V(1, 6), V(1, 7), 'door', 0, G)],
    items: [
      item('Краулер', 'vehicle', V(-2.0, 3.3), 5.5, 2.6, 2.2, 90),
      item('Контейнер', 'vehicle', V(-2.0, 8.0), 3, 2.4, 2, 90, { full: 'Вантажний контейнер грузового' }),
      item('Місце грузового 4×9', 'spot', V(-2.0, 5.5), 9, 4, 0.02, 90, { full: 'Місце грузового (замість краулера й контейнера)' }),
    ],
  });

  // ===== Правий блок, рівень 0 (2 стіни) =====
  addRoom({
    id: 'garage', name: 'Гараж багі', short: 'Гараж багі', group: 'drive', z0: 0, h: G, roof: 'solid', eave: true,
    tiles: rect(1, 0, 4, 4), label: V(3.0, 3.72),
    note: 'Заїзд крізь пентащит на 3 плити у фронті — це і вхід пішки. Двері в майстерню.',
    open: [seg(V(2, 0), V(5, 0), 'shield', 0, G - 0.3), seg(V(4, 4), V(5, 4), 'door', 0, G)],
    items: [item('Багі', 'vehicle', V(3.5, 2.0), 3, 2, 1.4, 90)],
  });
  addRoom({
    id: 'works', name: 'Майстерня', short: 'Майстерня', group: 'craft', z0: 0, h: G, roof: 'solid', eave: true,
    tiles: rect(1, 4, 4, 6), label: V(4.3, 5.55),
    note: 'Базовий верстак, ремонтна станція, 5 паливних генераторів по 75 і паливо. Двері в гараж і в ангар важкої техніки, сходи на +2.',
    open: [seg(V(4, 4), V(5, 4), 'door', 0, G), seg(V(1, 6), V(1, 7), 'door', 0, G)],
    items: [
      stairs('Сходи на +2', V(1.5, 5.0), 2, 0.95, 270, 0, G),
      item('Верстак', 'craft', V(2.9, 5.4), 1.4, 1.6, 1.6, 0, { full: 'Базовий верстак' }),
      item('Ремонт', 'craft', V(1.55, 8.1), 2, 1.0, 1.2, 90, { full: 'Ремонтна станція' }),
      gen(3.0, 9.3), gen(4.3, 9.3), gen(3.0, 8.0), gen(4.3, 8.0), gen(4.3, 6.7),
      item('Паливо', 'storage', V(2.6, 6.9), 0.9, 0.9, 1.2, 0, { full: 'Паливні елементи' }),
      item('Паливо', 'storage', V(1.5, 9.55), 0.9, 0.9, 1.2, 0, { full: 'Паливні елементи' }),
    ],
  });

  // ===== Правий блок, рівень +2 (3 стіни) =====
  addRoom({
    id: 'store', name: 'Склад', short: 'Склад', group: 'store', z0: G, h: TOP - G, roof: 'solid', eave: true,
    tiles: rect(1, 0, 4, 4), label: V(2.3, 3.0),
    note: 'Над гаражем: 8 контейнерів і консоль. Двері в ангар асаулта, туди ж виходять сходи.',
    open: [seg(V(1, 4), V(3, 4), 'door', G, G + 2.5)],
    items: [
      ...[1.5, 2.5, 3.5, 4.5].flatMap((x) => [0.6, 1.6].map((y) => box(x, y))),
      item('Консоль суб-фіфу', 'console', V(4.4, 3.4), 1, 1, 1.4, 0),
    ],
  });
  addRoom({
    id: 'hangar', name: 'Ангар асаулта', short: 'Ангар асаулта', group: 'air', z0: G, h: TOP - G, roof: 'solid', eave: true,
    tiles: rect(1, 4, 4, 6), skylight: skyA, label: V(3.3, 5.3), label3d: V(3.0, 7.5),
    note: 'Над майстернею. Асаулт сідає і злітає вертикально крізь пентащит 4×5 у даху (довгою стороною вздовж корпусу). Сходи з майстерні виходять біля дверей складу.',
    open: [seg(V(1, 4), V(3, 4), 'door', G, G + 2.5)],
    items: [
      item('Асаулт', 'air', V(3.3, 8.0), 4.0, 2.7, 1.8, 90),
      item('Проріз сходів', 'hatch', V(1.5, 5.0), 2, 0.95, 0.05, 90),
    ],
  });

  const roofItems = [];
  const exteriorEdges = exteriorEdgesIn(rooms);

  const levels = [
    { key: 'g', name: 'Рівень 0', sub: 'важка техніка, гараж багі, майстерня', z0: 0, z1: G },
    { key: 't', name: 'Рівень +2', sub: 'склад, ангар асаулта', z0: G, z1: TOP },
    { key: 'r', name: 'Дах', sub: 'пентащити над технікою', z0: TOP, z1: 99 },
  ];

  // Тексти й налаштування сторінки для цієї бази.
  const notSky = (t) => ![...sky, ...skyA].some((s) => Math.abs(centroid(s.p).x - centroid(t.p).x) < 1e-6 && Math.abs(centroid(s.p).y - centroid(t.p).y) < 1e-6);
  const ui = {
    name: 'Sandwalkers DD',
    lead: 'Форпост у Глибокій пустелі на 1 ділянку 10×10, лише квадрати. Без переробки: руду і спайс грузовий везе на Main. Будівництво тут удвічі дешевше.',
    facts: ['<b>10 × 10</b> плит', 'дах <b>+5</b>', 'краулер · контейнер · грузовий', 'багі · асаулт', '<b>5</b> генераторів × 75'],
    store: 'dd:',
    all: 8,
    costFactor: 0.5,
    planScale: 46,
    claimsText: '1 ділянка',
    levelButtons: { g: 'Рівень 0', t: '+2', r: 'Дах' },
    cutButtons: { 'cut-g': 'Рівень 0', 'cut-t': '+2' },
    levelNames: { g: 'Рівень 0 · техніка, гараж, майстерня', t: 'Рівень +2 · склад, асаулт', r: 'Дах' },
    captions: {
      g: '<span><strong>Рівень 0.</strong> Ліворуч ангар важкої техніки на 5 стін: краулер і контейнер, або грузовий (пунктир). Праворуч гараж багі з пентащитом у фронті і майстерня з генераторами.</span>',
      t: '<span><strong>Рівень +2, 3 стіни.</strong> Над гаражем склад із консоллю, над майстернею ангар асаулта з вильотом угору.</span>',
      r: '<span><strong>Дах +5.</strong> Пентащит 4×9 над важкою технікою і 4×5 над асаултом.</span>',
    },
    cuts: { 'cut-g': [1.9, 0], 'cut-t': [4.9, G] },
    views: {
      quarter: { pos: [-15, 11, 8], target: [0, 2.0, -5] },
      front: { pos: [0, 3.5, 13], target: [0, 2.2, -5] },
      back: { pos: [8, 10, -23], target: [0, 2.2, -5] },
      top: { pos: [0, 34, -4.9], target: [0, 0, -5] },
    },
    roofTags: [[0, -0.9, 'Пентащит 4×9 над технікою · 4×5 над асаултом', 'решта даху суцільна, без пристроїв']],
    pieceRows: [
      ['Фундамент, рівень 0', (rs) => rs.filter((r) => r.z0 === 0).map((r) => r.tiles)],
      ['Перекриття +2', (rs) => rs.filter((r) => r.z0 === G).map((r) => r.tiles)],
      ['Дах +5', (rs) => rs.filter((r) => r.z0 + r.h === TOP).map((r) => r.tiles.filter(notSky))],
      ['Пентащит у дахах', (rs) => rs.filter((r) => r.skylight).map((r) => r.skylight)],
    ],
    stages: {
      found: { note: 'Уся ділянка 10×10 квадратами, одним шаром.' },
      ground: { name: 'Стіни першого поверху', note: 'Зовнішні стіни 0…+2, стіна x = 1 і перегородка гараж | майстерня, пентащит гаража, двері.' },
      deck1: { name: 'Перекриття +2', note: 'Над гаражем і майстернею, крім прорізу над сходами.' },
      upper: { name: 'Стіни ангара важкої техніки', note: 'Від +2 до +5 по колу ангара.' },
      orni: { name: 'Ангар асаулта', note: 'Стіни +2…+5 над майстернею, дах із пентащитом 4×5.' },
      car: { name: 'Склад', note: 'Стіни +2…+5 над гаражем, дах.' },
      tops: { name: 'Дах ангара важкої техніки', note: 'Дах +5 із пентащитом 4×9 для грузового.' },
    },
  };

  const model = {
    R3, V, add, sub, mul, dir, centroid, pointInPoly,
    claims, rooms, roofItems, levels,
    boundaryEdges, roomEdges, exteriorEdges, labelPoint, roomArea, tileArea, edgeKey,
    // ангар асаулта стоїть на G — у кошторисі він іде етапом «орні», як ангари на головній базі
    heights: { G, HANG: TOP - G, CAR: G, BACK: G, TOWER: 99, DECK: 99, TOP },
    bounds: { x0: -5, x1: 5, y0: 0, y1: 10 },
    key: {},
    ui,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else (root.BASES || (root.BASES = {})).dd = model;
})(typeof window !== 'undefined' ? window : globalThis);

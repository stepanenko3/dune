/*
 * Модель форпосту Sandwalkers DD у Глибокій пустелі (Deep Desert) для Dune: Awakening (сардаукарський набір).
 *
 * Одна ділянка 10 x 10 (x від -5 до 5, y від 0 до 10, фронт на y = 0).
 * Корпус — «кругла» вежа: ядро 8 x 7 квадратів, по колу ряд трикутників, на кутах вставки
 * (повернутий квадрат + трикутник). Від межі ділянки до корпусу по 0,13 плити з усіх боків.
 *
 * Низько, як будують у Deep Desert: 2 яруси, корпус навпіл середньою стіною, кожна стіна стоїть на стіні нижче.
 *   0 … +2  ліворуч гараж багі і генератори, праворуч склад, вода і консоль;
 *   +2 … +5 ліворуч ангар на 1 орні з вильотом угору крізь пентащит у даху, праворуч переробка;
 *   дах +5: вітряки і вітропастки над переробкою.
 */
(function (root) {
  'use strict';

  const GEOM = typeof module !== 'undefined' && module.exports ? require('./geom.js') : root.GEOM;
  const { R3, V, add, sub, mul, dir, centroid, pointInPoly, rect, roundedBlock, item, stairs, seg, boundaryEdges, roomEdges, tileArea, labelPoint, roomArea, edgeKey, exteriorEdgesIn } = GEOM;

  // ---------- висоти ----------
  const G = 2;    // цех 0 … +2, на +2 підлога ангара
  const TOP = 5;  // ангар +2 … +5, дах

  const claims = [{ x: -5, y: 0, w: 10, d: 10 }];

  // ---------- корпус ----------
  const X1 = 4, Y0 = 1.5, Y1 = 8.5;   // ядро квадратів: x -4 … 4, y 1,5 … 8,5
  const YF = Y0 - R3;                 // фронт: зовнішній край ряду трикутників
  const body = roundedBlock(-X1, Y0, 2 * X1, Y1 - Y0);
  // кутові вставки фронту: повернутий квадрат і трикутник, як на скріні 4
  const cR = [V(X1 - 0.5, YF), V(X1 + R3 - 0.5, Y0 - R3 - 0.5), V(X1 + R3, Y0 - 0.5)];
  const cL = cR.map((p) => V(-p.x, p.y));

  // ---------- приміщення ----------
  // Корпус ділиться навпіл стіною по x = 0 на обох ярусах (стіна над стіною). У рядах трикутників спереду
  // і ззаду вона йде навскіс: середній трикутник ряду дістається лівій половині.
  const cx = (t) => centroid(t.p).x;
  const left = body.filter((t) => cx(t) < 1e-6), right = body.filter((t) => cx(t) > 1e-6);
  const rooms = [];
  const addRoom = (r) => { rooms.push(r); return r; };
  // проліт: 1 плита на 1 рівень, як у грі
  const flight = (name, x, y, ang, from, to) => stairs(name, V(x, y), to - from, 0.95, ang, from, to);
  const hatch = (name, x, y, w, z) => item(name, 'hatch', V(x, y), w, 0.95, 0.05, 0, z !== undefined ? { z } : {});
  const box = (x, y) => item('Контейнер', 'storage', V(x, y), 0.9, 0.9, 2, 0);
  const doorG = seg(V(0, 3.5), V(0, 4.5), 'door', 0, G);           // гараж ↔ склад
  const doorU = seg(V(0, 5.5), V(0, 6.5), 'door', G, G + 2.5);     // ангар ↔ цех

  // ===== Рівень 0 (2 стіни) =====
  addRoom({
    id: 'garage', name: 'Гараж і генераторна', short: 'Гараж', group: 'drive', z0: 0, h: G, roof: 'solid', eave: true,
    tiles: left, label: V(-2.3, 4.6),
    note: 'Ліва половина. Спереду багі, заїзд крізь пентащит на 3 плити у фронті. За багі 4 паливні генератори і паливо. Двері в склад у середній стіні — це і вхід пішки.',
    open: [seg(V(-3.5, YF), V(-0.5, YF), 'shield', 0, G - 0.3), doorG],
    items: [
      item('Багі', 'vehicle', V(-2.0, 2.6), 3, 2, 1.4, 90),
      ...[[-3.6, 5.6], [-2.3, 5.6], [-3.6, 6.9], [-2.3, 6.9]].map(([x, y]) => item('Генератор', 'power', V(x, y), 1.2, 1.2, 1.8, 0, { full: 'Паливний генератор' })),
      item('Паливо', 'storage', V(-3.6, 8.2), 0.9, 0.9, 1.2, 0, { full: 'Паливні елементи' }),
      item('Паливо', 'storage', V(-2.6, 8.2), 0.9, 0.9, 1.2, 0, { full: 'Паливні елементи' }),
    ],
  });
  addRoom({
    id: 'store', name: 'Склад і вода', short: 'Склад і вода', group: 'store', z0: 0, h: G, roof: 'solid', eave: true,
    tiles: right, label: V(1.15, 3.6),
    note: 'Права половина: консоль біля дверей із гаража, 8 середніх цистерн уздовж правої стіни, 4 контейнери посередині. Сходи вздовж задньої стіни справа наліво на +2.',
    open: [doorG],
    items: [
      item('Консоль суб-фіфу', 'console', V(1.2, 2.3), 1, 1, 1.4, 0),
      ...[2.4, 3.7, 5.0, 6.3].flatMap((y) => [2.9, 4.2].map((x) => item('Цистерна', 'water', V(x, y), 1.2, 1.2, 1.8, 0, { full: 'Середня цистерна' }))),
      box(0.55, 5.4), box(1.45, 5.4), box(0.55, 6.3), box(1.45, 6.3),
      flight('Сходи на +2', 2.0, 8.0, 180, 0, G),
    ],
  });

  // ===== Рівень +2 (3 стіни) =====
  const sky = rect(-4, 2.5, 4, 5); // пентащит у даху ангара 4×5: асаулт вертикально злітає і сідає крізь нього
  addRoom({
    id: 'bay', name: 'Ангар орні', short: 'Ангар орні', group: 'air', z0: G, h: TOP - G, roof: 'solid', eave: true,
    tiles: left, skylight: sky, label: V(-2.0, 7.25), label3d: V(-2.0, 7.6),
    note: 'Над гаражем, стіни над його стінами, 3 стіни заввишки. Виліт угору: у даху пентащит 4×5 над асаултом (довгою стороною вздовж корпусу орні — у гравців 3 плити виявилось замало). Збоку ремонтна станція і 2 контейнери, двері в переробний цех.',
    open: [doorU],
    items: [
      item('Асаулт', 'air', V(-2.0, 4.6), 4.0, 2.7, 1.8, 90),
      item('Ремонтна станція', 'craft', V(-2.0, 1.95), 2, 0.9, 1.2, 0),
      box(-3.4, 8.0), box(-2.4, 8.0),
    ],
  });
  addRoom({
    id: 'refinery', name: 'Переробний цех', short: 'Переробка', group: 'refine', z0: G, h: TOP - G, roof: 'solid', eave: true,
    tiles: right, label: V(1.5, 5.9),
    note: 'Над складом: праворуч два середні переробники спайсу, ліворуч середній рудний і хімічний, контейнери під меланж. Двері в ангар, сходи на дах.',
    open: [doorU],
    items: [
      hatch('Проріз сходів', 2.0, 8.0, 2),
      flight('Сходи на дах', 2.5, 7.0, 0, G, TOP),
      item('Переробник спайсу', 'refine', V(3.6, 2.7), 2.0, 1.6, 2, 90, { full: 'Середній переробник спайсу' }),
      item('Переробник спайсу', 'refine', V(3.6, 5.0), 2.0, 1.6, 2, 90, { full: 'Середній переробник спайсу' }),
      item('Переробник руди', 'refine', V(1.4, 2.4), 1.5, 1.5, 2, 0, { full: 'Середній переробник руди' }),
      item('Хімічний', 'refine', V(1.4, 4.3), 1.5, 1.4, 2, 0, { full: 'Хімічний переробник' }),
      box(3.5, 8.0), box(4.4, 8.0),
    ],
  });

  // ---------- дах: вітряки і вітропастки — тільки над цехом, над ангаром вільно для вильоту ----------
  const roofItems = [];
  const turbine = (x, y) => roofItems.push(item('Спрямований вітряк', 'turbine', V(x, y), 1, 1, 3, 0, { z: TOP }));
  const windtrap = (x, y) => roofItems.push(item('Велика вітропастка', 'windtrap', V(x, y), 1.5, 1.5, 2.6, 0, { z: TOP }));
  windtrap(1.1, 2.3);
  windtrap(3.3, 2.3);
  for (const y of [4.0, 5.2, 8.3]) for (const x of [0.6, 1.7, 2.8, 3.9]) turbine(x, y);
  roofItems.push(hatch('Люк на дах', 2.5, 7.0, 3, TOP));

  const exteriorEdges = exteriorEdgesIn(rooms);

  const levels = [
    { key: 'g', name: 'Рівень 0', sub: 'гараж, генератори, склад, вода', z0: 0, z1: G },
    { key: 't', name: 'Рівень +2', sub: 'ангар орні і переробка', z0: G, z1: TOP },
    { key: 'r', name: 'Дах', sub: 'вітряки, вітропастки, пентащит над ангаром', z0: TOP, z1: 99 },
  ];

  // Тексти й налаштування сторінки для цієї бази.
  const skyKeys = new Set(sky.map((t) => centroid(t.p).x.toFixed(3) + ',' + centroid(t.p).y.toFixed(3)));
  const notSky = (t) => !skyKeys.has(centroid(t.p).x.toFixed(3) + ',' + centroid(t.p).y.toFixed(3));
  const ui = {
    name: 'Sandwalkers DD',
    lead: 'Форпост у Глибокій пустелі на 1 ділянку 10×10, сардаукарський набір. Будівництво тут удвічі дешевше.',
    facts: ['<b>10 × 10</b> плит', '<b>2</b> яруси · дах <b>+5</b>', 'багі · асаулт', '<b>12</b> вітряків · <b>2</b> вітропастки'],
    store: 'dd:',
    all: 8,
    costFactor: 0.5,
    planScale: 46,
    claimsText: '1 ділянка',
    levelButtons: { g: 'Рівень 0', t: '+2', r: 'Дах' },
    cutButtons: { 'cut-g': 'Рівень 0', 'cut-t': '+2' },
    levelNames: { g: 'Рівень 0 · гараж, енергія, склад', t: 'Рівень +2 · ангар орні, переробка', r: 'Дах · вітряки, вітропастки' },
    captions: {
      g: '<span><strong>Рівень 0, 2 стіни.</strong> Ліворуч гараж багі з пентащитом у фронті і генератори, праворуч склад, вода і консоль.</span>',
      t: '<span><strong>Рівень +2, 3 стіни.</strong> Ліворуч ангар на один асаулт із вильотом угору крізь пентащит у даху, праворуч переробний цех.</span>',
      r: '<span><strong>Дах +5.</strong> Над ангаром пентащит 4×5, над цехом 12 вітряків і 2 вітропастки.</span>',
    },
    cuts: { 'cut-g': [1.9, 0], 'cut-t': [4.9, G] },
    views: {
      quarter: { pos: [-15, 11, 8], target: [0, 2.0, -5] },
      front: { pos: [0, 3.5, 13], target: [0, 2.2, -5] },
      back: { pos: [8, 10, -23], target: [0, 2.2, -5] },
      top: { pos: [0, 34, -4.9], target: [0, 0, -5] },
    },
    roofTags: [[0, -0.9, 'Вітряки ×12 (1×1) · вітропастки ×2 (1,5×1,5)', 'дах цеху +5; над ангаром пентащит — вільно для вильоту']],
    pieceRows: [
      ['Фундамент, рівень 0', (rs) => rs.filter((r) => r.z0 === 0).map((r) => r.tiles)],
      ['Перекриття +2', (rs) => rs.filter((r) => r.z0 === G).map((r) => r.tiles)],
      ['Дах +5', (rs) => rs.filter((r) => r.z0 === G).map((r) => r.tiles.filter(notSky))],
      ['Пентащит у даху ангара', (rs) => rs.filter((r) => r.skylight).map((r) => r.skylight)],
    ],
    stages: {
      found: { note: 'Ядро 8×7 квадратів, по колу трикутники, на кутах вставки. Перший фундамент — точно по центру ділянки.' },
      ground: { name: 'Стіни першого поверху', note: 'Зовнішні стіни 0…+2 і середня стіна, пентащит гаража, двері гараж ↔ склад.' },
      deck1: { name: 'Перекриття +2', note: 'На всю площу, крім прорізу над сходами.' },
      orni: { name: 'Ангар орні', note: 'Стіни +2…+5 над стінами гаража, дах із пентащитом 4×5.' },
      car: { name: 'Переробний цех і дах', note: 'Стіни +2…+5 над стінами складу, сходи на дах, дах +5 із люком.' },
    },
  };

  const model = {
    R3, V, add, sub, mul, dir, centroid, pointInPoly,
    claims, rooms, roofItems, levels,
    boundaryEdges, roomEdges, exteriorEdges, labelPoint, roomArea, tileArea, edgeKey,
    // ангар стоїть на G — у кошторисі він іде окремим етапом «орні», як ангари на головній базі
    heights: { G, HANG: TOP - G, CAR: G, BACK: G, TOWER: 99, DECK: 99, TOP },
    bounds: { x0: -5, x1: 5, y0: 0, y1: 10 },
    key: { Y0, Y1, YF },
    ui,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else (root.BASES || (root.BASES = {})).dd = model;
})(typeof window !== 'undefined' ? window : globalThis);

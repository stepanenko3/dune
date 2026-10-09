/*
 * Модель бази "Цитадель Харконненів" для Dune: Awakening. Версія 7.
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
  const CAR = 9;          // ангар грузових: +9 .. +13, над ним піраміда
  const BACK = 9;         // Великий зал, задній зал, двоповерхові бічні блоки
  const TOWER = 17;       // шахти веж; балкони й місток на +15, ліхтарі +17 .. +19.5
  const DECK = 15;        // рівень балконів веж і містка: над ангаром грузових

  const claims = [];
  for (const cx of [-10, 0]) for (const cy of [0, 10, 20]) claims.push({ x: cx, y: cy, w: 10, d: 10 });

  // ---------- ключові точки ----------
  // Великий зал: шестикутник зі сторонами 5-6-3-8-3-6 на трикутній гратці.
  const H0 = V(-2.5, 12);                    // лівий кут нижньої сторони (центральний вхід)
  const hexPoly = [V(-2.5, 12), V(2.5, 12), V(5.5, 12 + 6 * R3), V(4, 12 + 9 * R3), V(-4, 12 + 9 * R3), V(-5.5, 12 + 6 * R3)];
  const Y2 = 12 + 9 * R3;                    // верхня сторона залу = нижня сторона заднього залу
  const hexTri = triangles(H0, 0, hexPoly);
  const hexEdges = hexPoly.map((p, i) => [p, hexPoly[(i + 1) % hexPoly.length]]);
  const galleryTri = hexTri.filter((t) => {
    const c = centroid(t.p);
    return Math.min(...hexEdges.map(([a, b]) => distToSeg(c, a, b))) < 0.6;
  });

  // Задній зал — перевернутий шестикутник 8-3-6-5-6-3 за Великим залом. До його довгих скошених
  // граней кріпляться ангари орні, що розходяться назад-назовні під кутом (скрін); між ними
  // коротка задня сторона — задній вхід, над ним виліт ангара грузових.
  const YK = Y2 + 9 * R3;
  const keepPoly = [V(-4, Y2), V(4, Y2), V(5.5, Y2 + 3 * R3), V(2.5, YK), V(-2.5, YK), V(-5.5, Y2 + 3 * R3)];
  const keepTri = triangles(H0, 0, keepPoly);

  // Ангар грузових: 9 x 11 над обома залами, розтруб ззаду закінчується урівень із задньою стороною.
  const CY1 = YK - 2 * R3, CY0 = CY1 - 11;
  const carBody = rect(-4.5, CY0, 9, 11);
  const flareF = triangles(V(-4.5, CY0), 0, [V(-4.5, CY0), V(4.5, CY0), V(5.5, CY0 - 2 * R3), V(-5.5, CY0 - 2 * R3)]);
  const flareR = triangles(V(-4.5, CY1), 0, [V(-4.5, CY1), V(4.5, CY1), V(5.5, CY1 + 2 * R3), V(-5.5, CY1 + 2 * R3)]);
  const carFoot = [
    V(-5.5, CY0 - 2 * R3), V(5.5, CY0 - 2 * R3), V(4.5, CY0), V(4.5, CY1),
    V(5.5, CY1 + 2 * R3), V(-5.5, CY1 + 2 * R3), V(-4.5, CY1), V(-4.5, CY0),
  ];
  const underCarrier = (t) => t.p.some((q) => pointInPoly(q, carFoot) && distToPoly(q, carFoot) > 1e-6);

  // Ангар орні на тилу: осі t — назовні від грані заднього залу (150°), s — уздовж грані (60°).
  // 4 x 6 квадратів + ніс 2 ряди: фронт 4 плити, закруглення по 2, далі рівні боки.
  const P = V(-5.5, Y2 + 3 * R3);
  const ht = dir(150), hs = dir(60);
  const hB = (t, s) => add(P, add(mul(ht, t), mul(hs, s)));
  const P4 = hB(4, 0), Q4 = hB(4, 6);
  const N1 = add(P4, mul(dir(120), 2)), N2 = add(Q4, mul(dir(180), 2));
  const hangarSq = squares(P, ht, hs, 4, 6);                  // порядок: t * 6 + s
  const hangarL = [...hangarSq, ...triangles(P4, 0, [P4, Q4, N2, N1])];
  const hq = (t, s) => hangarSq[t * 6 + s];
  const hangarUpperL = [];
  for (let t = 0; t < 4; t++) for (let s = 1; s <= 4; s++) hangarUpperL.push(hq(t, s));
  hangarUpperL.push(...hangarSq.filter((q) => underCarrier(q) && !hangarUpperL.includes(q)));
  hangarUpperL.push(...triangles(P4, 0, [hB(4, 1), hB(4, 5), add(hB(4, 5), dir(180)), add(hB(4, 1), dir(120))]));
  const skylightL = [];
  for (let t = 2; t < 4; t++) for (let s = 1; s <= 4; s++) if (!underCarrier(hq(t, s))) skylightL.push(hq(t, s));

  // Центр з боків — прямі корпуси: вежа 3x3 одразу за гаражем, навколо неї двоповерховий бічний блок.
  // Між блоком і скошеними гранями залу — трикутний дворик просто неба: усі стіни прямі.
  const towerL = rect(-8.5, 11, 3, 3);
  const blockTiles = [...rect(-9.5, 10, 7, 1), ...rect(-5.5, 11, 3, 1), ...rect(-9.5, 11, 1, 3), ...rect(-9.5, 14, 4, 5)];
  const towerBalconyL = [
    ...strip(V(-5.5, 11), V(-8.5, 11)),
    ...strip(V(-8.5, 11), V(-8.5, 14)),
    ...strip(V(-8.5, 14), V(-5.5, 14)),
    ...cornerPiece(V(-8.5, 11), -1, 1),
    ...cornerPiece(V(-8.5, 14), -1, -1),
  ];
  const lanternL = roundedBlock(-8, 11.5, 2, 2);

  // Гараж: ядро 6 x 10 + закруглений зовнішній бік (нижчий на рівень).
  const garageCoreL = rect(-8.5, 0, 6, 10);
  const garageRimL = strip(V(-8.5, 0), V(-8.5, 10));

  // ---------- приміщення ----------
  // h = 0 — відкрита палуба з парапетом. roof: 'solid' | 'none' | 'shield' | 'pyramid' | 'tier'.
  // open: прорізи у стінах: 'open', 'shield' (пентащит), 'glass', 'door', 'balcony' (парапет).
  // z0/z1 у прорізі — абсолютні рівні; без них двері мають висоту 2.5 від підлоги.
  // rim: плитки з нижчим дахом на rimDrop рівнів (уступ, щоб корпус не був коробкою).
  // crown: другий ярус даху над частиною плиток; skylight: пентащит у даху; eave: скошений карниз.
  // tier: дах зі скошеним уступом по периметру (tierS — висота скосу).
  // windows: [z0, z1] — вікна на всіх зовнішніх стінах без інших прорізів.
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

  // ===== Перед: заїзд і гаражі =====
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
      id: 'garageL', name: 'Гараж краулера', group: 'drive', z0: 0, h: G, roof: 'solid',
      tiles: [...garageCoreL, ...garageRimL], rim: garageRimL, rimDrop: 1, label: V(-5.5, 7.7),
      skylight: rect(-7.5, 1, 4, 9), eave: true,
      note: 'Заїзд 2 плити завширшки із центрального заїзду, на рівні підлоги. Дах зі скошеним карнизом, у ньому пентащит 4×9 з відступом від країв: грузовий спускається і забирає краулер.',
      open: [
        seg(V(-2.5, 4), V(-2.5, 6), 'open', 0, 4),
        seg(V(-2.5, 1), V(-2.5, 4), 'glass', 1, 4),
        seg(V(-2.5, 6), V(-2.5, 9), 'glass', 1, 4),
        seg(V(-6.5, 10), V(-4.5, 10), 'door', 0, 2.5),
        seg(V(-7.5, 0), V(-3.5, 0), 'glass', 2.2, 4),
      ],
      items: [item('Краулер', 'vehicle', V(-5.6, 5.0), 5.5, 2.6, 2.2, 0)],
    },
    mirrorRoom('garageR', 'Гараж: багі + піскоцикл', {
      short: 'Гараж багі', label: V(4.9, 5.0), roof: 'none', skylight: undefined, eave: false,
      note: 'Заїзд 2 плити завширшки із центрального заїзду, на рівні підлоги. Сходи на дах гаража.',
      items: [
        item('Багі', 'vehicle', V(6.0, 2.8), 3, 2, 1.4, 0),
        item('Піскоцикл', 'vehicle', V(6.0, 7.3), 2, 1, 1.1, 0),
        item('Ремонтна станція', 'craft', V(7.7, 5.0), 2, 1.2, 1.2, 90),
        stairs('Сходи на +5', V(5.9, 9.5), 5, 0.95, 180, 0, G),
      ],
    })
  );

  addRoom({
    id: 'passage', name: 'Перехід', group: 'core', z0: G, h: CAR - G, roof: 'tier', tierS: 1,
    tiles: rect(-2.5, 0, 5, 12).filter((t) => !(Math.abs(centroid(t.p).x) < 1.5 && centroid(t.p).y < 2)),
    label: V(0, 6.5),
    note: 'Над центральним заїздом: перехід від ангара грузових (сходи нагору, вихід перед його порталом під містком) до галереї залу, звідки парадні сходи ведуть у заїзд, до другого поверху бічних блоків і даху гаража багі. Дах скошений з усіх боків. Посередині фронту — виріз 3 плити з круглим балконом.',
    open: [
      seg(V(2.5, 8), V(2.5, 9), 'door'),
      seg(V(-0.5, 2), V(0.5, 2), 'door'),
      seg(V(-1.5, 2), V(-0.5, 2), 'glass', G + 0.6, CAR - 1.2),
      seg(V(0.5, 2), V(1.5, 2), 'glass', G + 0.6, CAR - 1.2),
      seg(V(-2.5, 1), V(-2.5, 10), 'glass', G + 0.8, CAR - 1.3),
      seg(V(-2.5, 10), V(-2.5, 11), 'door'),
      seg(V(2.5, 1), V(2.5, 8), 'glass', G + 0.8, CAR - 1.3),
      seg(V(2.5, 9), V(2.5, 10), 'glass', G + 0.8, CAR - 1.3),
      seg(V(2.5, 10), V(2.5, 11), 'door'),
      seg(V(-2.5, 0), V(-1.5, 0), 'glass', G + 0.8, CAR - 1.3),
      seg(V(1.5, 0), V(2.5, 0), 'glass', G + 0.8, CAR - 1.3),
      seg(V(-1.5, 12), V(1.5, 12), 'door'),
    ],
    items: [
      stairs('Сходи до ангара грузових', V(1.7, 10.25), 3.5, 1.4, 90, G, CAR),
      item('Люк на дах', 'hatch', V(1.7, 11.3), 1.2, 1.2, 0.05, 90, { z: CAR }),
      item('Лава', 'furniture', V(-1.6, 6.5), 2.4, 0.7, 0.5, 90),
    ],
  });

  addRoom({
    id: 'frontBalcony', name: 'Круглий балкон', short: 'Балкон', group: 'deck', z0: G, h: 0, roof: 'none',
    tiles: [...rect(-1.5, 1, 3, 1), ...strip(V(1.5, 1), V(-1.5, 1))], label: V(0, 1.2),
    note: 'У вирізі посередині переходу, над порталом заїзду. Вихід із переходу.',
    open: [seg(V(-1.5, 2), V(1.5, 2), 'open'), seg(V(-1.5, 1), V(-1.5, 2), 'open'), seg(V(1.5, 1), V(1.5, 2), 'open')],
    items: [],
  });

  addRoom({
    id: 'garageRoof', name: 'Дах гаража багі', short: 'Дах гаража', group: 'deck', z0: G, h: 0, roof: 'none',
    tiles: rect(2.5, 0, 6, 10), label: V(5.5, 4.95),
    note: 'Тераса з вітропастками, вихід із переходу. Сюди виходять сходи з гаража.',
    open: [seg(V(2.5, 0), V(2.5, 10), 'open')],
    items: [],
  });

  // ===== Центр: зал, прямі бічні блоки, вежі =====
  addRoom({
    id: 'hall', name: 'Великий зал', group: 'core', z0: 0, h: BACK, roof: 'solid', covered: true,
    tiles: hexTri, label: V(0, 12.9),
    note: 'Шестикутник із трикутників (скрін 4), 9 рівнів. Галерея на +5, парадні сходи. Скошені грані виходять у трикутні дворики. Над залом ангар грузових і піраміда.',
    open: [
      seg(V(-1.5, 12), V(1.5, 12), 'door', 0, 3),
      seg(V(-1.5, 12), V(1.5, 12), 'door', G, G + 2.5),
      seg(V(-3.5, 12 + 2 * R3), V(-4, 12 + 3 * R3), 'door', 0, 2.5),
      seg(V(3.5, 12 + 2 * R3), V(4, 12 + 3 * R3), 'door', 0, 2.5),
      seg(V(-3, Y2), V(-2, Y2), 'door', 0, 2.5),
      seg(V(2, Y2), V(3, Y2), 'door', 0, 2.5),
      seg(V(-1, Y2), V(1, Y2), 'door', G, G + 2.5),
      seg(V(-3, 12 + R3), V(-4.5, 12 + 4 * R3), 'glass', G + 0.8, BACK - 0.8),
      seg(V(3, 12 + R3), V(4.5, 12 + 4 * R3), 'glass', G + 0.8, BACK - 0.8),
    ],
    items: [
      item('Консоль суб-фіфу', 'console', V(0, 13.6), 1, 1, 1.4, 0),
      stairs('Парадні сходи на галерею +5', V(0, 16.5), 4.6, 2, 90, 0, G),
    ],
  });

  addRoom({
    id: 'gallery', name: 'Галерея залу', short: 'Галерея', group: 'deck', z0: G, h: 0, roof: 'none', inside: 'hall',
    tiles: galleryTri, label: V(0, 18.95),
    note: 'Кільце на +5 уздовж стін залу: перехід над заїздом ↔ задній зал (ангари орні, ангар грузових).',
    open: hexEdges.map(([a, b]) => seg(a, b, 'open')),
    items: [],
  });

  both(
    {
      id: 'blockL', name: 'Склад піску', group: 'store', z0: 0, h: G, roof: 'none',
      tiles: blockTiles, label: V(-7.5, 16.6), windows: [1.2, 3.6],
      note: 'Прямий бічний блок, перший поверх, обіймає вежу. Двері з гаража краулера — пісок одразу на склад, у вежу і в дворик.',
      open: [
        seg(V(-6.5, 10), V(-4.5, 10), 'door', 0, 2.5),
        seg(V(-7.5, 14), V(-6.5, 14), 'door', 0, 2.5),
        seg(V(-5.5, 15), V(-5.5, 16), 'door', 0, 2.5),
      ],
      items: [
        item('Контейнери', 'storage', V(-9.0, 16.5), 0.9, 4.6, 1.2, 0),
        item('Контейнери', 'storage', V(-7.2, 17.6), 2.4, 0.9, 1.2, 0),
        item('Контейнери', 'storage', V(-8.0, 10.5), 2.8, 0.8, 1.2, 0),
      ],
    },
    mirrorRoom('blockR', 'Фабрикатори', {
      group: 'craft',
      note: 'Прямий бічний блок, перший поверх: фабрикатори і ресайклер. Двері з гаража багі, у вежу і в дворик.',
      items: [
        item('Фаб. виживання', 'craft', V(8.5, 15.1), 1.8, 1.8, 1.6, 0),
        item('Фаб. зброї', 'craft', V(8.5, 17.5), 1.8, 1.8, 1.6, 0),
        item('Фаб. одягу', 'craft', V(6.5, 17.5), 1.8, 1.8, 1.6, 0),
        item('Ресайклер', 'craft', V(7.3, 10.5), 2.2, 0.9, 1.4, 0),
        item('Склад деталей', 'storage', V(9.0, 12.5), 0.9, 2.6, 1.2, 0),
      ],
    })
  );

  both(
    {
      id: 'upperL', name: 'Водний блок', group: 'craft', z0: G, h: BACK - G, roof: 'solid', eave: true,
      tiles: blockTiles, label: V(-7.5, 16.6), windows: [G + 0.9, BACK - 0.8],
      note: 'Другий поверх бічного блоку: цистерни і deathstill. Вхід із переходу над заїздом і з вежі. На даху — вітропастки.',
      open: [
        seg(V(-2.5, 10), V(-2.5, 11), 'door', G, G + 2.5),
        seg(V(-7.5, 14), V(-6.5, 14), 'door', G, G + 2.5),
      ],
      items: [
        item('Цистерна', 'water', V(-8.6, 15.2), 1.5, 1.5, 2.5, 0),
        item('Цистерна', 'water', V(-6.5, 17.8), 1.5, 1.5, 2.5, 0),
        item('Deathstill', 'refine', V(-8.6, 17.8), 1.2, 1.2, 2, 0),
      ],
    },
    mirrorRoom('upperR', 'Майстерня техніки', {
      note: 'Другий поверх бічного блоку: фабрикатор техніки і ремонт. Вхід із переходу над заїздом і з вежі.',
      items: [
        item('Фабрикатор техніки', 'craft', V(7.5, 16.9), 3.0, 2.4, 2, 0),
        item('Ремонт', 'craft', V(6.0, 10.5), 2.4, 0.9, 1.4, 0, { full: 'Ремонтна станція' }),
      ],
    })
  );

  both(
    {
      id: 'towerL', name: 'Ліва вежа', short: 'Вежа', group: 'tower', z0: 0, h: TOWER, roof: 'none',
      tiles: towerL, label: V(-7, 12.5),
      note: 'Гвинтові сходи 0 → +17: склад піску, дворик, водний блок (+5), балкони і місток (+15), ліхтар (+17).',
      open: [
        seg(V(-7.5, 14), V(-6.5, 14), 'door', 0, 2.5),
        seg(V(-5.5, 13), V(-5.5, 14), 'door', 0, 2.5),
        seg(V(-7.5, 14), V(-6.5, 14), 'door', G, G + 2.5),
        seg(V(-5.5, 12), V(-5.5, 13), 'door', DECK, DECK + 2),
        seg(V(-7.5, 11), V(-6.5, 11), 'door', DECK, DECK + 2),
        seg(V(-8.5, 12), V(-8.5, 13), 'door', DECK, DECK + 2),
        seg(V(-7.5, 14), V(-6.5, 14), 'door', DECK, DECK + 2),
      ],
      items: [stairs('Гвинтові сходи 0 → +17', V(-7, 12.5), 2.4, 2.4, 90, 0, TOWER)],
    },
    mirrorRoom('towerR', 'Права вежа', {
      note: 'Гвинтові сходи 0 → +17: фабрикатори, дворик, майстерня (+5), балкони і місток (+15), ліхтар (+17).',
    })
  );

  // ===== Тил: задній зал і ангари орні під кутом =====
  addRoom({
    id: 'rearHall', name: 'Задній зал', group: 'store', z0: 0, h: G, roof: 'none',
    tiles: keepTri, label: V(0, 24.6),
    note: 'Перевернутий шестикутник за Великим залом: головний склад, хімічний переробник, генератор. Позаду — задній вхід у воронці між ангарами. Двері в цехи під ангарами.',
    open: [
      seg(V(-3, Y2), V(-2, Y2), 'door', 0, 2.5),
      seg(V(2, Y2), V(3, Y2), 'door', 0, 2.5),
      seg(hB(0, 2), hB(0, 4), 'door', 0, 2.5),
      seg(mirrorPt(hB(0, 2)), mirrorPt(hB(0, 4)), 'door', 0, 2.5),
      seg(V(-1.5, YK), V(1.5, YK), 'door', 0, 3),
      { ...seg(V(-2.5, YK), V(2.5, YK), 'open'), frame: { n: [0, 1], c: 1.2, fill: true } },
    ],
    items: [
      stairs('Сходи на +5', V(-2.6, 23.3), 4.6, 1.4, 90, 0, G),
      item('Контейнери', 'storage', V(-0.6, 21.9), 0.9, 3.4, 1.2, 0),
      item('Контейнери', 'storage', V(0.8, 21.9), 0.9, 3.4, 1.2, 0),
      item('Хімічний', 'refine', V(3.6, 22.7), 1.5, 1.4, 2.2, 0, { full: 'Хімічний переробник' }),
      item('Генератор', 'power', V(1.7, 25.3), 1.2, 1.2, 1.8, 0),
    ],
  });

  addRoom({
    id: 'rearGallery', name: 'Задня галерея', short: 'Задня галерея', group: 'core', z0: G, h: BACK - G, roof: 'solid',
    tiles: keepTri, label: V(0, 24.6), windows: [G + 0.9, BACK - 0.8],
    note: 'Другий поверх заднього залу: галерея Великого залу ↔ обидва ангари орні ↔ круглий балкон над заднім входом. Сходи нагору в ангар грузових.',
    open: [
      seg(V(-1, Y2), V(1, Y2), 'door', G, G + 2.5),
      seg(hB(0, 2), hB(0, 4), 'door', G, G + 2.5),
      seg(mirrorPt(hB(0, 2)), mirrorPt(hB(0, 4)), 'door', G, G + 2.5),
      seg(V(-0.5, YK), V(0.5, YK), 'door', G, G + 2.5),
    ],
    items: [stairs('Сходи в ангар грузових', V(1.7, 25.2), 3.6, 1.2, 90, G, CAR)],
  });

  addRoom({
    id: 'rearBalcony', name: 'Задній балкон', short: 'Балкон', group: 'deck', z0: G, h: 0, roof: 'none',
    tiles: strip(V(-1.5, YK), V(1.5, YK), 2), label: V(0, YK + 0.9),
    note: 'Маленький круглий балкон над заднім входом, між ангарами. Вихід із задньої галереї.',
    open: [seg(V(-1.5, YK), V(1.5, YK), 'open')],
    items: [],
  });

  both(
    {
      id: 'spice', name: 'Зал меланжу', group: 'refine', z0: 0, h: G, roof: 'none',
      tiles: hangarL, label: hB(2.6, 3.0), windows: [1.2, 3.6],
      note: 'Під ангаром скаутів: 2 великі переробники спайсу (3×2, 5 стін) і цистерна. Вхід із заднього залу.',
      open: [seg(hB(0, 2), hB(0, 4), 'door', 0, 2.5)],
      items: [
        item('Переробник спайсу', 'refine', hB(1.65, 1.0), 2.9, 1.9, 5, 150, { full: 'Великий переробник спайсу' }),
        item('Переробник спайсу', 'refine', hB(1.65, 5.0), 2.9, 1.9, 5, 150, { full: 'Великий переробник спайсу' }),
        item('Цистерна', 'water', hB(3.3, 3.0), 1.5, 1.5, 2.5, 150),
      ],
    },
    mirrorRoom('ore', 'Рудний цех', {
      note: 'Під ангаром асаултів: 3 великі переробники руди (3×2, до 2 стін) і середній. Вхід із заднього залу.',
      items: [
        item('Переробник руди', 'refine', mirrorPt(hB(1.65, 1.0)), 2.9, 1.9, 2, 30, { full: 'Великий переробник руди' }),
        item('Переробник руди', 'refine', mirrorPt(hB(2.15, 3.0)), 2.9, 1.9, 2, 30, { full: 'Великий переробник руди' }),
        item('Переробник руди', 'refine', mirrorPt(hB(1.65, 5.0)), 2.9, 1.9, 2, 30, { full: 'Великий переробник руди' }),
        item('Середній переробник', 'refine', mirrorPt(hB(4.65, 3.0)), 1.5, 1.5, 2, 30, { full: 'Середній переробник руди' }),
      ],
    })
  );

  both(
    {
      id: 'hangarL', name: 'Ангар скаутів', group: 'air', z0: G, h: HANG, roof: 'solid',
      tiles: hangarL, label: hB(2.2, 3.0),
      skylight: skylightL, crown: { tiles: hangarUpperL, h: 1 }, eave: true,
      note: 'Скляний бокс під кутом (скрін): прикріплений до скошеної грані заднього залу, розходиться назад-назовні. Фронт 4 плити, закруглення по 2, рівні боки. Стіни — пентащит: виліт назад, убік і вгору. Дах у 2 яруси: +8 на весь контур, +9 з відступом і світликом.',
      open: [
        seg(hB(0, 0), P4, 'shield', G, G + HANG - 0.3),
        seg(P4, N1, 'shield', G, G + HANG - 0.3),
        seg(N1, N2, 'shield', G, G + HANG - 0.3),
        seg(N2, Q4, 'shield', G, G + HANG - 0.3),
        seg(Q4, hB(0, 6), 'shield', G, G + HANG - 0.3),
        seg(hB(0, 2), hB(0, 4), 'door'),
      ],
      items: [
        item('Скаут', 'air', hB(2.25, 1.5), 3.6, 2.5, 1.5, 150),
        item('Скаут', 'air', hB(2.25, 4.5), 3.6, 2.5, 1.5, 150),
      ],
    },
    mirrorRoom('hangarR', 'Ангар асаултів', {
      items: [
        item('Асаулт', 'air', mirrorPt(hB(2.4, 1.6)), 4.0, 2.7, 1.8, 30),
        item('Асаулт', 'air', mirrorPt(hB(2.4, 4.4)), 4.0, 2.7, 1.8, 30),
      ],
    })
  );

  // ===== Рівень +9: ангар грузових =====
  addRoom({
    id: 'carrier', name: 'Ангар грузових', group: 'air', z0: CAR, h: 4, roof: 'solid',
    tiles: [...carBody, ...flareF, ...flareR], label: V(0, 20.4), label3d: V(0, CY1 - 0.3),
    roofSlope: { x: 4.5, w: 1, drop: 1 },
    note: 'Два грузові 4×9 поруч, 9 плит завширшки, над Великим і заднім залами. Наскрізний: спереду виліт над переходом під містком, ззаду — між ангарами орні. На кінцях розтруби з рамками зі зрізаними кутами (скрін 5), по боках скляна смуга.',
    open: [
      { ...seg(V(-5.5, CY0 - 2 * R3), V(5.5, CY0 - 2 * R3), 'open'), frame: { c: 1, fill: false } },
      { ...seg(V(-5.5, CY1 + 2 * R3), V(5.5, CY1 + 2 * R3), 'open'), frame: { c: 1, fill: false } },
      seg(V(-4.5, CY0), V(-4.5, CY1), 'glass', CAR + 0.7, CAR + 3.3),
      seg(V(4.5, CY0), V(4.5, CY1), 'glass', CAR + 0.7, CAR + 3.3),
    ],
    items: [
      item('Грузовий', 'air', V(-2.35, (CY0 + CY1) / 2), 9, 4, 2.2, 90),
      item('Грузовий', 'air', V(2.35, (CY0 + CY1) / 2), 9, 4, 2.2, 90),
      item('Люк сходів', 'hatch', V(1.7, 26.6), 1.4, 1.2, 0.05, 90),
      stairs('Сходи на дах між грузовими', V(0, 20.4), 3, 0.6, 90, CAR, CAR + 4),
    ],
  });

  // Ступінчаста гора над переднім порталом ангара грузових на всю його ширину (скрін 4).
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

  // ===== Вежі: балкони, місток-брама над переходом, ліхтарі =====
  both(
    {
      id: 'towerBalconyL', name: 'Балкон лівої вежі', short: 'Балкон вежі', group: 'deck', z0: DECK, h: 0, roof: 'none',
      tiles: towerBalconyL, label: V(-9.2, 14.6),
      note: 'Заокруглений балкон на +15 з трьох боків вежі, з четвертого — місток.',
      open: [seg(V(-8.5, 11), V(-5.5, 11), 'open'), seg(V(-8.5, 11), V(-8.5, 14), 'open'), seg(V(-8.5, 14), V(-5.5, 14), 'open')],
      items: [],
    },
    mirrorRoom('towerBalconyR', 'Балкон правої вежі')
  );

  addRoom({
    id: 'bridge', name: 'Місток між вежами', short: 'Місток', group: 'deck', z0: DECK, h: 0, roof: 'none',
    tiles: rect(-5.5, 12, 11, 1), label: V(0, 12.5),
    note: 'На +15 над переходом, перед переднім порталом ангара грузових — як брама. Грузові вилітають під ним.',
    open: [seg(V(-5.5, 12), V(-5.5, 13), 'open'), seg(V(5.5, 12), V(5.5, 13), 'open')],
    items: [],
  });

  both(
    {
      id: 'lanternL', name: 'Ліхтар лівої вежі', short: 'Ліхтар', group: 'tower', z0: TOWER, h: 2.5, roof: 'pyramid',
      tiles: lanternL, label: V(-7, 12.5),
      note: 'Верх вежі: круглий з трикутників.',
      open: [], items: [],
    },
    mirrorRoom('lanternR', 'Ліхтар правої вежі')
  );

  // ---------- дахи: вітряки і пастки ----------
  const roofItems = [];
  // Пристрої — тільки там, де не заважають залітати в ангари. Вітряк займає 1×1, вітропастка 1,5×1,5.
  const turbine = (x, y, z) => roofItems.push(item('Спрямований вітряк', 'turbine', V(x, y), 1, 1, 3, 0, { z }));
  const windtrap = (x, y, z) => roofItems.push(item('Велика вітропастка', 'windtrap', V(x, y), 1.5, 1.5, 2.6, 0, { z }));
  // 20 вітряків: 4 стовпці по 5 на даху ангара грузових за пірамідою (+13), посередині прохід до сходів.
  for (const x of [-3.5, -2.1, 2.1, 3.5]) for (const y of [20.6, 21.8, 23.0, 24.2, 25.4]) turbine(x, y, CAR + 4);
  // 15 вітропасток: 7 у глибині даху гаража багі (+5), по 4 на дахах бічних блоків (+9).
  for (const [x, y] of [[3.5, 4.6], [5.3, 4.6], [7.1, 4.6], [5.3, 6.4], [7.1, 6.4], [5.3, 8.2], [7.1, 8.2]]) windtrap(x, y, G);
  for (const sx of [-1, 1]) for (const [x, y] of [[8.6, 16.2], [6.4, 16.2], [8.6, 18.0], [6.4, 18.0]]) windtrap(sx * x, y, BACK);

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

  // ---------- зовнішні стіни ----------
  // Ребро зовнішнє, якщо його не накриває межа іншого приміщення на тих самих висотах.
  const beCache = new Map();
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
  function exteriorEdges(room) {
    const others = rooms.filter((o) => o !== room && o.h > 0 && overlapsZ(o, room) && o.inside !== room.id && room.inside !== o.id);
    const segs = others.flatMap(bEdges);
    return roomEdges(room).filter((ed) => !segs.some((f) => collinearOverlap(ed, f)));
  }

  // Вікна (Harkonnen Stronghold Window) на зовнішніх стінах без інших прорізів.
  for (const r of rooms)
    if (r.windows)
      for (const ed of exteriorEdges(r)) if (!ed.open.length) r.open.push(seg(ed.a, ed.b, 'glass', r.windows[0], r.windows[1]));

  // Рівні для плану: підлоги з z0 у [z0, z1).
  const levels = [
    { key: 'g', name: 'Рівень 0', sub: 'земля', z0: 0, z1: G },
    { key: 'u', name: 'Рівень +5', sub: 'ангари орні, перехід, галереї, другі поверхи', z0: G, z1: CAR },
    { key: 't', name: 'Рівень +9', sub: 'ангар грузових', z0: CAR, z1: CAR + 4 },
    { key: 'r', name: 'Дах', sub: 'піраміда, вежі, місток, пристрої', z0: CAR + 4, z1: 99 },
  ];

  const model = {
    R3, V, add, sub, mul, dir, centroid, pointInPoly,
    claims, rooms, roofItems, levels,
    boundaryEdges, roomEdges, exteriorEdges, labelPoint, roomArea, tileArea, edgeKey,
    heights: { G, HANG, CAR, BACK, TOWER, DECK, TOP: CAR + 4 },
    bounds: { x0: -10, x1: 10, y0: 0, y1: 30 },
    key: { P, P4, Q4, N1, N2, Y2, YK, CY0, CY1 },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else root.BASE = model;
})(typeof window !== 'undefined' ? window : globalThis);

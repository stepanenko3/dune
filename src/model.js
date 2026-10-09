/*
 * Модель бази "Цитадель Харконненів" для Dune: Awakening. Версія 11.
 *
 * Одиниці: 1 = сторона квадратного фундаменту (і трикутного теж).
 * Висота: 1 рівень = висота однієї стіни.
 * План: x — вправо, y — вглиб бази (фронт на y = 0, тил на y = 30).
 * Ділянки: 6 штук по 10x10, сітка 2 x 3 (x від -10 до 10, y від 0 до 30).
 *
 * Усі приміщення складені тільки з квадратів ('s') і рівносторонніх
 * трикутників ('t') зі стороною 1. Ангари орні під кутом кріпляться до скошених
 * граней заднього залу і звисають над обривом: під ними нічого немає.
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
  // Фундамент має скластися без жодної щілини. Квадратна гратка (заїзд, гаражі, блоки) і трикутна
  // (зал, задній зал, двори) стикуються без залишку тільки по горизонтальних лініях, тому:
  // Великий зал — витягнутий шестикутник: передня частина з квадратів 11 x 5 зі спільними прямими
  // стінами з блоками, задня — трикутна фаска на 3 ряди, що звужується до 8 плит.
  const YH = 17;                             // межа квадратної і трикутної частин залу = тил блоків
  const H0 = V(-5.5, YH);                    // початок трикутної гратки: фаска залу, задній зал, двори
  const Y2 = YH + 3 * R3;                    // задня сторона залу = передня сторона заднього залу
  const hallPoly = [V(-5.5, 12), V(5.5, 12), V(5.5, YH), V(4, Y2), V(-4, Y2), V(-5.5, YH)];
  const hallTiles = [...rect(-5.5, 12, 11, YH - 12), ...triangles(H0, 0, [V(-5.5, YH), V(5.5, YH), V(4, Y2), V(-4, Y2)])];
  const hallEdges = hallPoly.map((p, i) => [p, hallPoly[(i + 1) % hallPoly.length]]);
  const galleryTiles = hallTiles.filter((t) => {
    const c = centroid(t.p);
    return Math.min(...hallEdges.map(([a, b]) => distToSeg(c, a, b))) < 0.6;
  });

  // Задній зал — перевернутий шестикутник 8-3-6-5-6-3 за Великим залом. До його довгих скошених
  // граней кріпляться ангари орні, що розходяться назад-назовні під кутом (скрін); між ними
  // коротка задня сторона — задній вхід, над ним виліт ангара грузових.
  const YK = Y2 + 9 * R3;
  const keepPoly = [V(-4, Y2), V(4, Y2), V(5.5, Y2 + 3 * R3), V(2.5, YK), V(-2.5, YK), V(-5.5, Y2 + 3 * R3)];
  const keepTri = triangles(H0, 0, keepPoly);

  // Ангар грузових: 9 x 11 над обома залами. Ззаду закінчується там, де задній зал звужується до 9 плит
  // (кути стоять на його скошених гранях), тож над ангарами орні нічого немає. Спереду розтруб на 1 ряд.
  const CY1 = Y2 + 5 * R3, CY0 = CY1 - 11, CYF = CY0 - R3;
  const carBody = rect(-4.5, CY0, 9, 11);
  const flareF = triangles(V(-4.5, CY0), 0, [V(-4.5, CY0), V(4.5, CY0), V(5, CYF), V(-5, CYF)]);
  const carFoot = [V(-5, CYF), V(5, CYF), V(4.5, CY0), V(4.5, CY1), V(-4.5, CY1), V(-4.5, CY0)];
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

  // Задній вхід заглиблено в будівлю на 2 ряди: воронка між ангарами продовжується всередину,
  // над нею — підлога задньої галереї (навіс) і круглий балкон.
  const YD = YK - 2 * R3;
  const porchPoly = [V(-2.5, YK), V(2.5, YK), V(1.5, YD), V(-1.5, YD)];
  const storeTri = keepTri.filter((t) => !pointInPoly(centroid(t.p), porchPoly));

  // Центр з боків — прямі двоповерхові корпуси 4 x 7 + смуга до заїзду, впритул до залу (спільна стіна).
  // Вежа 3x3 стоїть на даху блоку і починається з +9.
  const towerL = rect(-8.5, 11, 3, 3);
  const blockTiles = [...rect(-9.5, 10, 7, 1), ...rect(-5.5, 11, 3, 1), ...rect(-9.5, 11, 4, YH - 11)];
  // Крило складу: перший поверх між тилом цеху, фаскою залу і переднею гранню заднього залу.
  // Зовнішня стіна — пряма від кута заднього залу навскіс до тилу цеху (півшестикутник 3-3-3-6),
  // на тій самій трикутній гратці, тож фундамент стикується без щілин і нічого зайвого назовні.
  const wingA = V(-8.5, YH);
  const wingL = triangles(H0, 0, [wingA, V(-5.5, YH), V(-4, Y2), V(-5.5, Y2 + 3 * R3)]);
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
    overhang: r.overhang ? { ...r.overhang, a: mirrorPt(r.overhang.a), b: mirrorPt(r.overhang.b), out: V(-r.overhang.out.x, r.overhang.out.y) } : undefined,
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
        seg(V(-4.5, 10), V(-2.5, 10), 'door', 0, 2.5),
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
  // Фабрикатори вздовж прямих бічних стін залу, ресайклер і склад деталей — біля фасок.
  const fA = V(-5.5, YH), fB = V(-4, Y2);                 // ліва фаска залу
  addRoom({
    id: 'hall', name: 'Великий зал', group: 'core', z0: 0, h: BACK, roof: 'solid', covered: true,
    tiles: hallTiles, label: V(0, 12.6),
    note: 'Витягнутий шестикутник, 9 рівнів: спереду квадрати 11×5 зі спільними стінами з цехами, ззаду трикутна фаска (так фундамент складається без щілин). Унизу фабрикатори, ресайклер і склад деталей, двері в обидва цехи і на склад. Галерея на +5 з виходами в другі поверхи блоків, парадні сходи. Над залом ангар грузових і піраміда.',
    open: [
      seg(V(-1.5, 12), V(1.5, 12), 'door', 0, 3),
      seg(V(-1.5, 12), V(1.5, 12), 'door', G, G + 2.5),
      seg(V(-5.5, 12), V(-5.5, 13), 'door', 0, 2.5),
      seg(V(5.5, 12), V(5.5, 13), 'door', 0, 2.5),
      seg(V(-5.5, 13), V(-5.5, 14), 'door', G, G + 2.5),
      seg(V(5.5, 13), V(5.5, 14), 'door', G, G + 2.5),
      seg(V(-3, Y2), V(-2, Y2), 'door', 0, 2.5),
      seg(V(2, Y2), V(3, Y2), 'door', 0, 2.5),
      seg(V(-1, Y2), V(1, Y2), 'door', G, G + 2.5),
      seg(fA, fB, 'glass', G + 0.8, BACK - 0.8),
      seg(mirrorPt(fA), mirrorPt(fB), 'glass', G + 0.8, BACK - 0.8),
    ],
    items: [
      item('Консоль суб-фіфу', 'console', V(0, 13.2), 1, 1, 1.4, 0),
      stairs('Парадні сходи на галерею +5', V(0, 16.3), 4.6, 2, 90, 0, G),
      item('Фаб. виживання', 'craft', V(-4.75, 14.0), 1.4, 1.6, 1.6, 0, { full: 'Фабрикатор виживання' }),
      item('Фаб. зброї', 'craft', V(-4.75, 15.85), 1.4, 1.6, 1.6, 0, { full: 'Фабрикатор зброї' }),
      item('Фаб. одягу', 'craft', V(4.75, 14.0), 1.4, 1.6, 1.6, 0, { full: 'Фабрикатор одягу' }),
      item('Склад деталей', 'storage', V(5.05, 15.85), 0.8, 1.6, 1.2, 0),
      item('Ресайклер', 'craft', wallPt(fA, fB, 1.2, 0.5), 1.6, 0.9, 1.4, 60),
      mirrorItem(item('Склад деталей', 'storage', wallPt(fA, fB, 1.2, 0.45), 1.6, 0.8, 1.2, 60)),
    ],
  });

  addRoom({
    id: 'gallery', name: 'Галерея залу', short: 'Галерея', group: 'deck', z0: G, h: 0, roof: 'none', inside: 'hall',
    tiles: galleryTiles, label: V(0, 19.0),
    note: 'Кільце на +5 уздовж стін залу: перехід над заїздом ↔ водний блок і майстерня ↔ задній зал (ангари орні, ангар грузових).',
    open: hallEdges.map(([a, b]) => seg(a, b, 'open')),
    items: [],
  });

  both(
    {
      id: 'blockL', name: 'Цех меланжу', group: 'refine', z0: 0, h: G, roof: 'none',
      tiles: blockTiles, label: V(-7.5, 13.4), windows: [1.2, 3.6],
      note: 'Перший поверх лівого блоку, впритул до Великого залу: 2 великі переробники спайсу 3×2 заввишки 5 стін — впритул до стелі. Двері з гаража краулера і в зал, сходи на другий поверх.',
      open: [
        seg(V(-4.5, 10), V(-2.5, 10), 'door', 0, 2.5),
        seg(V(-5.5, 12), V(-5.5, 13), 'door', 0, 2.5),
      ],
      items: [
        stairs('Сходи на +5', V(-7.0, 10.5), 4.6, 0.95, 0, 0, G),
        item('Переробник спайсу', 'refine', V(-8.45, 15.5), 1.9, 2.9, 5, 0, { full: 'Великий переробник спайсу' }),
        item('Переробник спайсу', 'refine', V(-6.5, 15.5), 1.9, 2.9, 5, 0, { full: 'Великий переробник спайсу' }),
        item('Цистерна', 'water', V(-8.6, 12.5), 1.5, 1.5, 2.5, 0),
        item('Контейнери меланжу', 'storage', V(-7.0, 12.5), 0.8, 1.6, 1.2, 0),
      ],
    },
    mirrorRoom('blockR', 'Рудний цех', {
      note: 'Перший поверх правого блоку, впритул до Великого залу: 3 великі переробники руди 3×2 (до 2 стін) і середній. Двері з гаража багі і в зал, сходи на другий поверх.',
      items: [
        stairs('Сходи на +5', V(7.0, 10.5), 4.6, 0.95, 180, 0, G),
        item('Переробник руди', 'refine', V(6.5, 15.5), 2.9, 1.9, 2, 90, { full: 'Великий переробник руди' }),
        item('Переробник руди', 'refine', V(8.45, 15.5), 2.9, 1.9, 2, 90, { full: 'Великий переробник руди' }),
        item('Переробник руди', 'refine', V(8.45, 12.5), 2.9, 1.9, 2, 90, { full: 'Великий переробник руди' }),
        item('Середній переробник', 'refine', V(6.6, 12.4), 1.5, 1.5, 2, 0, { full: 'Середній переробник руди' }),
      ],
    })
  );

  both(
    {
      id: 'upperL', name: 'Водний блок', group: 'craft', z0: G, h: BACK - G, roof: 'solid', eave: true,
      tiles: blockTiles, label: V(-7.5, 15.6), windows: [G + 0.9, BACK - 0.8],
      note: 'Другий поверх лівого блоку: цистерни і deathstill. Входи з переходу над заїздом і з галереї залу, сходи знизу з цеху меланжу і нагору у вежу (люк у її підлозі на +9). На даху — вітропастки.',
      open: [
        seg(V(-2.5, 10), V(-2.5, 11), 'door', G, G + 2.5),
        seg(V(-5.5, 13), V(-5.5, 14), 'door', G, G + 2.5),
      ],
      items: [
        stairs('Сходи у вежу', V(-7.0, 11.5), 2.9, 0.95, 180, G, CAR),
        item('Цистерна', 'water', V(-8.7, 13.4), 1.5, 1.5, 2.5, 0),
        item('Цистерна', 'water', V(-8.7, 15.2), 1.5, 1.5, 2.5, 0),
        item('Цистерна', 'water', V(-6.4, 16.0), 1.5, 1.5, 2.5, 0),
        item('Deathstill', 'refine', V(-6.6, 14.3), 1.2, 1.2, 2, 0),
      ],
    },
    mirrorRoom('upperR', 'Майстерня техніки', {
      note: 'Другий поверх правого блоку: фабрикатор техніки (великий, тому не в залі) і ремонт. Входи з переходу над заїздом і з галереї залу, сходи знизу з рудного цеху і нагору у вежу.',
      items: [
        stairs('Сходи у вежу', V(7.0, 11.5), 2.9, 0.95, 0, G, CAR),
        item('Фабрикатор техніки', 'craft', V(7.6, 15.6), 3.0, 2.4, 2, 0),
        item('Ремонт', 'craft', V(8.95, 13.05), 2.4, 0.9, 1.4, 90, { full: 'Ремонтна станція' }),
      ],
    })
  );

  both(
    {
      id: 'towerL', name: 'Ліва вежа', short: 'Вежа', group: 'tower', z0: CAR, h: TOWER - CAR, roof: 'none',
      tiles: towerL, label: V(-7, 12.5),
      note: 'Стоїть на даху бічного блоку і починається з рівня ангара грузових (+9). Знизу — сходи з водного блоку через люк. Двері на дах блоку (звідти до порталу ангара грузових). Гвинтові сходи +9 → +17: балкони і місток (+15), ліхтар (+17).',
      open: [
        seg(V(-5.5, 11), V(-5.5, 12), 'door', CAR, CAR + 2.5),
        seg(V(-8.5, 12), V(-8.5, 13), 'door', CAR, CAR + 2.5),
        seg(V(-5.5, 12), V(-5.5, 13), 'door', DECK, DECK + 2),
        seg(V(-7.5, 11), V(-6.5, 11), 'door', DECK, DECK + 2),
        seg(V(-8.5, 12), V(-8.5, 13), 'door', DECK, DECK + 2),
        seg(V(-7.5, 14), V(-6.5, 14), 'door', DECK, DECK + 2),
      ],
      items: [
        stairs('Гвинтові сходи +9 → +17', V(-6.6, 12.9), 1.9, 1.9, 90, CAR, TOWER),
        item('Люк зі сходів', 'hatch', V(-7.9, 11.5), 1.0, 0.9, 0.05, 0),
      ],
    },
    mirrorRoom('towerR', 'Права вежа', {
      note: 'Стоїть на даху бічного блоку і починається з +9. Знизу — сходи з майстерні через люк. Двері на дах блоку. Гвинтові сходи +9 → +17: балкони і місток (+15), ліхтар (+17).',
    })
  );

  // ===== Тил: задній зал і ангари орні під кутом =====
  // Склад: контейнери вздовж стін; кути біля воронки входу — гострі, там вільно.
  const kL0 = keepPoly[0], kL1 = keepPoly[5], kL2 = keepPoly[4], kR2 = keepPoly[3], kR1 = keepPoly[2];
  addRoom({
    id: 'rearHall', name: 'Головний склад', short: 'Склад', group: 'store', z0: 0, h: G, roof: 'none',
    tiles: storeTri, label: V(0, Y2 + 4.6), windows: [1.2, 3.6],
    note: 'Перший поверх заднього залу — головний склад бази, окремого складу піску немає. Обабіч відкритий прохід у два крила складу. Задній вхід заглиблено на 2 ряди: портал на рівні задньої сторони, двері глибше, над ними навіс галереї. Хімічний переробник і генератор. Сходи на +5.',
    open: [
      seg(V(-3, Y2), V(-2, Y2), 'door', 0, 2.5),
      seg(V(2, Y2), V(3, Y2), 'door', 0, 2.5),
      seg(V(-1.5, YD), V(1.5, YD), 'door', 0, 3),
      { ...seg(V(-2.5, YK), V(2.5, YK), 'open'), frame: { n: [0, 1], c: 1.2, fill: true } },
      seg(kL0, kL1, 'open'),
      seg(mirrorPt(kL0), mirrorPt(kL1), 'open'),
    ],
    items: [
      stairs('Сходи на +5', V(-2.6, Y2 + 3.5), 4.6, 1.4, 90, 0, G),
      item('Контейнери', 'storage', V(-0.6, Y2 + 2.1), 0.9, 3.4, 1.2, 0),
      item('Контейнери', 'storage', V(0.8, Y2 + 2.1), 0.9, 3.4, 1.2, 0),
      item('Контейнери', 'storage', wallPt(kL1, kL2, 1.7, 0.4), 1.8, 0.8, 1.2, 60),
      item('Контейнери', 'storage', wallPt(kR2, kR1, 2.6, 0.45), 2.0, 0.9, 1.2, -60),
      item('Хімічний', 'refine', V(3.5, Y2 + 3.1), 1.5, 1.4, 2.2, 0, { full: 'Хімічний переробник' }),
      item('Генератор', 'power', V(1.8, Y2 + 5.1), 1.2, 1.2, 1.8, 0),
    ],
  });

  both(
    {
      id: 'wingL', name: 'Ліве крило складу', short: 'Крило складу', group: 'store', z0: 0, h: G, roof: 'solid',
      tiles: wingL, label: V(-5.9, 19.1), windows: [1.2, 3.6],
      note: 'Одноповерхове крило головного складу між тилом цеху меланжу, фаскою Великого залу і заднім залом. Відкрите в склад на всю ширину грані. Зовнішня стіна — пряма навскіс від кута заднього залу до тилу цеху.',
      open: [seg(kL0, kL1, 'open')],
      items: [
        item('Контейнери', 'storage', wallPt(wingA, kL1, 1.8, 0.45), 2.0, 0.9, 1.2, 60),
        item('Контейнери', 'storage', wallPt(wingA, kL1, 3.9, 0.45), 2.0, 0.9, 1.2, 60),
        item('Контейнери', 'storage', V(-6.15, YH + 0.45), 1.2, 0.9, 1.2, 0),
      ],
    },
    mirrorRoom('wingR', 'Праве крило складу', {
      note: 'Одноповерхове крило головного складу між тилом рудного цеху, фаскою Великого залу і заднім залом. Відкрите в склад на всю ширину грані.',
    })
  );

  addRoom({
    id: 'rearGallery', name: 'Задня галерея', short: 'Задня галерея', group: 'core', z0: G, h: BACK - G, roof: 'solid',
    tiles: keepTri, label: V(0, Y2 + 4.8), windows: [G + 0.9, BACK - 0.8],
    note: 'Другий поверх заднього залу: галерея Великого залу ↔ обидва ангари орні ↔ круглий балкон над заднім входом. Сходи нагору в ангар грузових.',
    open: [
      seg(V(-1, Y2), V(1, Y2), 'door', G, G + 2.5),
      seg(hB(0, 2), hB(0, 4), 'door', G, G + 2.5),
      seg(mirrorPt(hB(0, 2)), mirrorPt(hB(0, 4)), 'door', G, G + 2.5),
      seg(V(-0.5, YK), V(0.5, YK), 'door', G, G + 2.5),
    ],
    items: [stairs('Сходи в ангар грузових', V(1.7, Y2 + 5.4), 3.6, 1.2, 90, G, CAR)],
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
      id: 'hangarL', name: 'Ангар скаутів', group: 'air', z0: G, h: HANG, roof: 'solid',
      tiles: hangarL, label: hB(2.2, 3.0),
      skylight: skylightL, crown: { tiles: hangarUpperL, h: 1 }, eave: true,
      overhang: { a: hB(0, 0), b: hB(0, 6), out: ht, at: [0.5, 2.0, 4.0, 5.5], len: 2.6, drop: 2.4 },
      note: 'Скляний бокс під кутом (скрін): прикріплений до скошеної грані заднього залу на +5 і звисає над обривом — під ним нічого немає, знизу консолі. Фронт 4 плити, закруглення по 2, рівні боки. Стіни — пентащит: виліт назад, убік і вгору. Дах у 2 яруси: +8 на весь контур, +9 з відступом і світликом.',
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
    tiles: [...carBody, ...flareF], label: V(0, 20.4), label3d: V(0, CY1 - 0.3),
    roofSlope: { x: 4, w: 1, drop: 1 },
    note: 'Два грузові 4×9 поруч, 9 плит завширшки, над Великим і заднім залами. Наскрізний: спереду розтруб і виліт під містком, ззаду портал на задній майданчик — грузові вилітають над ним і над дахами ангарів орні. Задній край стоїть там, де задній зал звужується до 9 плит, тож світлики ангарів орні згори вільні. По боках скляна смуга.',
    open: [
      { ...seg(V(-5, CYF), V(5, CYF), 'open'), frame: { c: 1, fill: false } },
      { ...seg(V(-4.5, CY1), V(4.5, CY1), 'open'), frame: { n: [0, -1], c: 0.5, g: 0.25, fill: false } },
      seg(V(-4.5, CY0), V(-4.5, CY1), 'glass', CAR + 0.7, CAR + 3.3),
      seg(V(4.5, CY0), V(4.5, CY1), 'glass', CAR + 0.7, CAR + 3.3),
    ],
    items: [
      item('Грузовий', 'air', V(-2.35, (CY0 + CY1) / 2), 9, 4, 2.2, 90),
      item('Грузовий', 'air', V(2.35, (CY0 + CY1) / 2), 9, 4, 2.2, 90),
      stairs('Сходи на дах між грузовими', V(0, 20.4), 3, 0.6, 90, CAR, CAR + 4),
    ],
  });

  addRoom({
    id: 'rearDeck', name: 'Задній майданчик', short: 'Майданчик', group: 'deck', z0: CAR, h: 0, roof: 'none', openAll: true, onRoof: true,
    tiles: keepTri.filter((t) => centroid(t.p).y > CY1), label: V(0, CY1 + 1.5),
    note: 'Дах заднього залу за ангаром грузових, урівень з верхнім ярусом дахів ангарів орні. Сюди виходять сходи із задньої галереї, звідси вхід у задній портал ангара грузових. Грузові вилітають назад над майданчиком.',
    open: [],
    items: [item('Люк сходів', 'hatch', V(1.7, Y2 + 6.8), 1.4, 1.2, 0.05, 90)],
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
  for (const x of [-3.5, -2.1, 2.1, 3.5]) for (let k = 0; k < 5; k++) turbine(x, CY0 + 5.65 + 1.2 * k, CAR + 4);
  // 15 вітропасток: 7 у глибині даху гаража багі (+5), по 4 на дахах бічних блоків (+9).
  for (const [x, y] of [[3.5, 4.6], [5.3, 4.6], [7.1, 4.6], [5.3, 6.4], [7.1, 6.4], [5.3, 8.2], [7.1, 8.2]]) windtrap(x, y, G);
  for (const sx of [-1, 1]) for (const [x, y] of [[8.6, 14.75], [6.4, 14.75], [8.6, 16.25], [6.4, 16.25]]) windtrap(sx * x, y, BACK);

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

  // Палуби без парапетів (двори, майданчик): усі краї відкриті.
  for (const r of rooms) if (r.openAll) r.open = boundaryEdges(r.tiles).map((e) => seg(e.a, e.b, 'open'));

  // Вікна (Harkonnen Stronghold Window) на зовнішніх стінах без інших прорізів.
  for (const r of rooms)
    if (r.windows)
      for (const ed of exteriorEdges(r)) if (!ed.open.length) r.open.push(seg(ed.a, ed.b, 'glass', r.windows[0], r.windows[1]));

  // Рівні для плану: підлоги з z0 у [z0, z1).
  const levels = [
    { key: 'g', name: 'Рівень 0', sub: 'земля', z0: 0, z1: G },
    { key: 'u', name: 'Рівень +5', sub: 'ангари орні, перехід, галереї, другі поверхи', z0: G, z1: CAR },
    { key: 't', name: 'Рівень +9', sub: 'ангар грузових, вежі', z0: CAR, z1: CAR + 4 },
    { key: 'r', name: 'Дах', sub: 'піраміда, вежі, місток, пристрої', z0: CAR + 4, z1: 99 },
  ];

  const model = {
    R3, V, add, sub, mul, dir, centroid, pointInPoly,
    claims, rooms, roofItems, levels,
    boundaryEdges, roomEdges, exteriorEdges, labelPoint, roomArea, tileArea, edgeKey,
    heights: { G, HANG, CAR, BACK, TOWER, DECK, TOP: CAR + 4 },
    bounds: { x0: -10, x1: 10, y0: 0, y1: 30 },
    key: { P, P4, Q4, N1, N2, Y2, YK, YD, CY0, CY1, CYF },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  else root.BASE = model;
})(typeof window !== 'undefined' ? window : globalThis);

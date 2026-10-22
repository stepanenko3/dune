/**
 * Стабільність деталей, як у грі (наближено): фундамент на землі — 100 %; угору (стіна на плиті, плита на стіні, колона,
 * скат на плиті, стіна на стіні) — без втрат; убік (плита поруч на тій самій висоті, скат поруч рівним краєм) — мінус
 * STEP за кожну деталь, тож від опори виходить до 9 деталей; звисання під плитою чи деталлю — мінус HANG. Пентащит,
 * поручні й драбини опору отримують, але нічого не тримають. Колона й трикутна плита тримають одна одну лише через
 * центр трикутника — дотик кутом (кінчиком) не рахується, як і між трикутниками (лише спільна сторона). Так у грі
 * (2026-10-18, база main): колона посеред трикутника тримає дах ангара грузових, а колони в кутах трикутників по краях
 * прольоту — ні, середина впала. Деталь без шляху до фундаменту чи з 0 % — нестабільна.
 *   compute(pieces) → Map id → 0…100;  of(piece, pieces, values) — для примари: скільки вона мала б, якщо поставити
 */
(function (root) {
  const PIECES = typeof module !== 'undefined' && module.exports ? require('./pieces.js') : root.PIECES;
  const FULL = 100, STEP = 10, HANG = 10, EPS = 1e-3;
  /** колона на куті плитки: квадрат — тримає; трикутник — ні (лише з-під центру) */
  const cornerHolds = (t) => t.s.tile !== 't';
  const S = PIECES.SHAPES;
  const keyOf = PIECES.keyOf;
  const same = (a, b) => Math.abs(a - b) < EPS;

  /** опис деталі для перевірок дотику: вид, висоти, точки (для пошуку сусідів), краї */
  function info(p) {
    const s = S[p.shape];
    if (!s) return null;
    const f = PIECES.footprint(p);
    const gives = !(s.family === 'rail' || s.family === 'ladder' || s.family === 'shield');
    const shield = s.family === 'shield';
    if (s.at === 'tile') {
      let poly = f.poly;
      const chord = PIECES.arcChord(p);
      // заокруглена плита: справжні прямі краї й хорда дуги
      let edges, hts;
      if (chord) {
        const real = PIECES.tilePoly('r', p.x, p.y, p.rot);
        edges = [{ a: real[real.length - 1], b: real[0], h: [0, 0] }, { a: real[0], b: real[1], h: [0, 0] }, { a: chord.a, b: chord.b, h: [0, 0] }];
        poly = [real[0], chord.a, chord.b];
        hts = [p.z, p.z, p.z];
      } else {
        const hs = s.family === 'slope' ? s.hs : poly.map(() => 0);
        edges = poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length], h: [hs[i], hs[(i + 1) % poly.length]] }));
        hts = hs.map((h) => p.z + h);
      }
      const kind = s.family === 'slope' ? 'slope' : 'slab';
      // hts — абсолютні висоти кутів (скат — різні), для колон під кутом
      // ctr — центр плитки: колону ставлять і посеред трикутника
      return { p, s, kind, gives, shield, found: s.cat === 'found', z: p.z, edges, pts: poly, hts, ctr: { x: p.x, y: p.y }, ipts: [...poly, { x: p.x, y: p.y }] };
    }
    if (s.at === 'edge') {
      const { a, b } = f.seg;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const pts = [];
      const n = Math.max(1, Math.round(L));
      for (let i = 0; i <= n; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
      return { p, s, kind: 'edge', gives, shield, z0: f.z0, z1: f.z1, seg: f.seg, pts };
    }
    return { p, s, kind: 'vertex', gives, shield, z0: f.z0, z1: f.z1, pt: f.pt, pts: [f.pt] };
  }

  const distSeg = (q, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a.x + dx * t - q.x, a.y + dy * t - q.y);
  };
  /** відрізок e лежить на g (обидва кінці на g) */
  const onSeg = (e, g) => distSeg(e.a, g.a, g.b) < EPS && distSeg(e.b, g.a, g.b) < EPS;
  const overlapLine = (e, g) => onSeg(e, g) || onSeg(g, e);
  const sameEdge = (e, g) => (keyOf(e.a) === keyOf(g.a) && keyOf(e.b) === keyOf(g.b)) || (keyOf(e.a) === keyOf(g.b) && keyOf(e.b) === keyOf(g.a));
  /** висоти кінців краю плитки (абсолютні) у порядку e.a, e.b */
  const levelOf = (t, e) => (same(e.h[0], e.h[1]) ? t.z + e.h[0] : null);
  const heightsMatch = (t, e, u, g) => {
    const ha = t.z + e.h[0], hb = t.z + e.h[1];
    const ga = keyOf(g.a) === keyOf(e.a) ? u.z + g.h[0] : u.z + g.h[1];
    const gb = keyOf(g.a) === keyOf(e.a) ? u.z + g.h[1] : u.z + g.h[0];
    return same(ha, ga) && same(hb, gb);
  };

  /** втрата, з якою a тримає b (null — не тримає) */
  function link(a, b) {
    if (a.p.id === b.p.id) return null;
    // пентащит тримає лише пентащит (секції одна на одній); поручні й драбини — нічого
    if (!a.gives && !(a.shield && b.shield)) return null;
    const tile = (x) => x.kind === 'slab' || x.kind === 'slope';
    // плитка під плиткою на тій самій клітинці: скат чи похила стіна на плиті
    if (a.kind === 'slab' && b.kind === 'slope' && same(a.z, b.z) && keyOf(a.p) === keyOf(b.p)) return 0;
    if (tile(a) && b.kind === 'edge') {
      // стіна на рівному краї плитки (верх плити чи ската — низ стіни)
      for (const e of a.edges) { const lv = levelOf(a, e); if (lv !== null && same(lv, b.z0) && overlapLine(b.seg, e)) return 0; }
      // звисає з рівного краю плити чи ската: верх стіни — на рівні краю
      for (const e of a.edges) { const lv = levelOf(a, e); if (lv !== null && same(lv, b.z1) && overlapLine(b.seg, e)) return HANG; }
      return null;
    }
    if (a.kind === 'edge' && tile(b)) {
      // плитка на верху стіни: її рівний край на висоті верху стіни
      for (const e of b.edges) { const lv = levelOf(b, e); if (lv !== null && same(lv, a.z1) && overlapLine(a.seg, e)) return 0; }
      // перекриття чи скат рівним краєм біля низу стіни, що сама тримається (висить), — стіна тримає їх
      for (const e of b.edges) { const lv = levelOf(b, e); if (lv !== null && same(lv, a.z0) && overlapLine(a.seg, e)) return HANG; }
      return null;
    }
    if (a.kind === 'edge' && b.kind === 'edge') {
      if (!overlapLine(a.seg, b.seg)) return null;
      if (same(a.z1, b.z0)) return 0; // стіна на стіні
      if (same(a.z0, b.z1)) return HANG; // звисає під деталлю
      return null;
    }
    if (tile(a) && tile(b)) {
      // поруч через спільний край — убік
      for (const e of a.edges) for (const g of b.edges) if (sameEdge(e, g) && heightsMatch(a, e, b, g)) return STEP;
      return null;
    }
    if (b.kind === 'vertex') {
      if (a.kind === 'vertex') return same(a.z1, b.z0) && keyOf(a.pt) === keyOf(b.pt) ? 0 : null;
      if (a.kind === 'slab') return same(a.z, b.z0) && ((cornerHolds(a) && a.pts.some((q) => keyOf(q) === keyOf(b.pt))) || keyOf(a.ctr) === keyOf(b.pt)) ? 0 : null;
      if (a.kind === 'edge') return same(a.z1, b.z0) && [a.seg.a, a.seg.b].some((q) => keyOf(q) === keyOf(b.pt)) ? 0 : null;
      return null;
    }
    if (a.kind === 'vertex') {
      // плита чи скат кутом на колоні: кут на висоті верху колони
      if (tile(b)) return (cornerHolds(b) && b.pts.some((q, i) => keyOf(q) === keyOf(a.pt) && same(b.hts[i], a.z1))) || (b.kind === 'slab' && keyOf(b.ctr) === keyOf(a.pt) && same(b.z, a.z1)) ? 0 : null;
      if (b.kind === 'edge') return same(a.z1, b.z0) && [b.seg.a, b.seg.b].some((q) => keyOf(q) === keyOf(a.pt)) ? 0 : null;
    }
    return null;
  }

  /** сусіди за спільними точками (кути плиток, кінці й проміжні точки країв) */
  function index(infos) {
    const byPt = new Map();
    for (const x of infos) for (const q of x.ipts || x.pts) { const k = keyOf(q); if (!byPt.has(k)) byPt.set(k, []); byPt.get(k).push(x); }
    return (x) => {
      const out = new Set();
      for (const q of x.ipts || x.pts) for (const y of byPt.get(keyOf(q)) || []) if (y !== x) out.add(y);
      return out;
    };
  }

  function compute(pieces) {
    const infos = pieces.map(info).filter(Boolean);
    const near = index(infos);
    const val = new Map();
    // черга за спаданням стабільності (кошики по 1 %)
    const buckets = Array.from({ length: FULL + 1 }, () => []);
    for (const x of infos) if (x.found && x.kind === 'slab') { val.set(x.p.id, FULL); buckets[FULL].push(x); }
    for (let v = FULL; v > 0; v--) {
      for (let i = 0; i < buckets[v].length; i++) {
        const x = buckets[v][i];
        if (val.get(x.p.id) !== v) continue;
        for (const y of near(x)) {
          const loss = link(x, y);
          if (loss === null) continue;
          const nv = v - loss;
          if (nv > (val.get(y.p.id) || 0)) { val.set(y.p.id, nv); buckets[nv].push(y); }
        }
      }
    }
    for (const x of infos) if (!val.has(x.p.id)) val.set(x.p.id, 0);
    return val;
  }

  /** стабільність нової деталі p серед pieces (values — уже пораховані): найкраща опора мінус втрата */
  function of(p, pieces, values) {
    const x = info(p);
    if (!x) return 0;
    if (x.found && x.kind === 'slab') return FULL;
    let best = 0;
    for (const q of pieces) {
      if (Math.abs(q.x - p.x) > 3.2 || Math.abs(q.y - p.y) > 3.2) continue;
      const y = info(q);
      if (!y) continue;
      const loss = link(y, x);
      if (loss === null) continue;
      best = Math.max(best, (values.get(q.id) || 0) - loss);
    }
    return best;
  }

  const api = { compute, of, FULL, STEP, HANG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.STABILITY = api;
})(typeof window !== 'undefined' ? window : globalThis);

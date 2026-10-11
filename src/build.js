/*
 * План будівництва по етапах і підрахунок деталей для кошторису.
 * Стіни рахуються секціями: 1 плита завширшки x 1 рівень заввишки; спільна стіна двох приміщень — один раз.
 */
(function (root) {
  'use strict';
  const M = root.BASE;
  const { G, CAR, DECK } = M.heights;
  const top = (r) => r.z0 + r.h;
  const tileKey = (t) => M.centroid(t.p).x.toFixed(3) + ',' + M.centroid(t.p).y.toFixed(3);

  // Типи деталей (порядок — як у кошторисі).
  const KINDS = [
    { id: 'fsq', name: 'Фундамент, квадрат' },
    { id: 'ftri', name: 'Фундамент, трикутник' },
    { id: 'ramp', name: 'Похила плита (заїзд)' },
    { id: 'csq', name: 'Перекриття / дах, квадрат' },
    { id: 'ctri', name: 'Перекриття / дах, трикутник' },
    { id: 'wall', name: 'Стіна (секція)' },
    { id: 'window', name: 'Вікно (секція)' },
    { id: 'door', name: 'Дверний проріз' },
    { id: 'shield', name: 'Пентащит (секція)' },
    { id: 'rail', name: 'Парапет (секція)' },
    { id: 'stairs', name: 'Сходи (проліт на 1 рівень)' },
  ];

  // Ліміти бази з гри, по категоріях.
  const LIMITS = [
    { id: 'build', name: 'Будівельні елементи', cap: 5000 },
    { id: 'prod', name: 'Виробництво', cap: 80 },
    { id: 'light', name: 'Освітлення', cap: 60 },
    { id: 'store', name: 'Склад', cap: 150 },
    { id: 'decor', name: 'Прикраси', cap: 700 },
    { id: 'doors', name: 'Двері', cap: 70 },
    { id: 'proj', name: 'Проєкція', cap: 20 },
  ];
  // Категорія ліміту для пристрою з моделі; null — не рахується (консоль, техніка, сходи).
  const CAT = { turbine: 'prod', windtrap: 'prod', craft: 'prod', refine: 'prod', power: 'prod', water: 'store', storage: 'store', light: 'light', furniture: 'decor' };

  // До якого етапу належить приміщення.
  function stageOf(r) {
    if (r.group === 'air' && r.z0 === G) return 'orni';
    if (r.z0 === 0) return 'ground';
    if (r.z0 < CAR) return 'upper';
    if (r.z0 < DECK && r.id !== 'towerL' && r.id !== 'towerR') return 'car';
    return 'tops';
  }

  const STAGES = [
    { id: 'found', name: 'Фундамент', note: 'Спершу весь рівень 0 одним шаром: спереду квадрати (гаражі, заїзд, цехи, перед залу), ззаду трикутники (фаска залу, задній зал, крила). Стик — одна горизонтальна лінія на 17-му ряду від фронту.' },
    { id: 'ground', name: 'Стіни першого поверху', note: 'Гаражі, заїзд, Великий зал до +5, цехи, склад і крила — 5 рівнів. У кожному крилі діагональна перегородка з дверима: на ній стоятиме стіна прибудови. Дверні прорізи одразу, щоб не перебудовувати.' },
    { id: 'deck1', name: 'Перекриття +5', note: 'Підлога переходу над заїздом, тераса на даху гаража багі, галерея залу, підлоги других поверхів блоків, задньої галереї і прибудов над крилами, дахи гаража краулера (з пентащитом), паливної і комори.' },
    { id: 'upper', name: 'Другий поверх', note: 'Перехід, водний блок, майстерня, задня галерея, прибудови над крилами (стіни точно над стінами крил і перегородкою), стіни Великого залу від +5 до +9, круглі балкони.' },
    { id: 'orni', name: 'Ангари орні', note: 'Підлога на +5 від скошених граней заднього залу над обривом, стіни-пентащити, дах у 2 яруси зі світликом.' },
    { id: 'car', name: 'Дахи +9 і ангар грузових', note: 'Дахи залів, блоків і прибудов на +9 — вони ж підлога ангара грузових, окремої підлоги немає. Стіни ангара ставляться тільки над стінами нижче: спереду над стінами залу, розширення над прибудовами, задні скоси над гранями заднього залу. Потім дах і задній майданчик.' },
    { id: 'tops', name: 'Вежі, гора, балкони, місток', note: 'Вежі від +9 на дахах блоків, ступінчаста гора на даху ангара грузових, балкони веж і місток на +15, ліхтарі.' },
  ];

  function blank() { const o = {}; for (const k of KINDS) o[k.id] = 0; return o; }

  function compute() {
    const st = {};
    for (const s of STAGES) st[s.id] = blank();
    const add = (s, k, n = 1) => { st[s][k] += n; };

    // підлоги
    for (const r of M.rooms) {
      if (r.onRoof || r.inside || r.group === 'crown') continue;
      const sg = stageOf(r);
      if (r.z0 === 0) {
        for (const t of r.tiles) {
          const ramp = r.profile && (M.centroid(t.p).x < r.profile.x0 + r.profile.ch || M.centroid(t.p).x > r.profile.x1 - r.profile.ch);
          const flat = ramp && (r.profile.flat || []).some(([a, b]) => M.centroid(t.p).y > a && M.centroid(t.p).y < b);
          if (ramp && !flat) add('found', 'ramp');
          else add('found', t.k === 's' ? 'fsq' : 'ftri');
        }
        continue;
      }
      // підлога над чужим дахом не рахується двічі (ангар грузових стоїть на дахах залів)
      if (r.id === 'carrier') continue;
      const s = sg === 'upper' ? 'deck1' : sg;
      for (const t of r.tiles) add(s, t.k === 's' ? 'csq' : 'ctri');
    }
    // галерея залу — теж підлога +5
    for (const r of M.rooms.filter((x) => x.inside)) for (const t of r.tiles) add('deck1', t.k === 's' ? 'csq' : 'ctri');

    // дахи
    for (const r of M.rooms) {
      if (r.h <= 0 || r.roof === 'none') continue;
      const tp = top(r);
      const s = r.group === 'crown' ? 'tops' : stageOf(r) === 'orni' ? 'orni' : tp <= G ? 'deck1' : tp <= CAR ? 'car' : stageOf(r) === 'car' ? 'car' : 'tops';
      const sky = new Set((r.skylight || []).map(tileKey));
      for (const t of r.tiles) {
        if (sky.has(tileKey(t)) && !r.crown) add(s, 'shield');
        else add(s, t.k === 's' ? 'csq' : 'ctri');
      }
      if (r.crown) for (const t of r.crown.tiles) add(s, sky.has(tileKey(t)) ? 'shield' : t.k === 's' ? 'csq' : 'ctri');
    }

    // стіни: секції по рівнях, спільні — один раз; більш відкритий тип перемагає
    const RANK = { none: 0, door: 1, shield: 2, window: 3, wall: 4, rail: 5 };
    const cells = new Map();
    const doors = new Map();
    for (const r of M.rooms) {
      const sg = stageOf(r);
      for (const e of M.roomEdges(r)) {
        const ek = M.edgeKey(e.a, e.b);
        if (r.h === 0) {
          if (r.group === 'deck' && !e.open.some((o) => o.type === 'open')) {
            const key = ek + '@deck' + r.z0;
            if (!cells.has(key)) cells.set(key, { type: 'rail', s: r.z0 === 0 ? 'ground' : r.z0 < CAR ? 'upper' : 'tops' });
          }
          continue;
        }
        const hi = Math.ceil(top(r) - 0.5);
        for (let z = Math.floor(r.z0); z < hi; z++) {
          const mid = z + 0.5;
          let type = 'wall';
          for (const o of e.open) {
            const a = o.z0 !== undefined ? o.z0 : r.z0;
            const b = o.z1 !== undefined ? o.z1 : o.type === 'door' ? r.z0 + 2.5 : top(r);
            if (mid < a || mid > b) continue;
            const t = o.type === 'open' || o.type === 'balcony' ? 'none' : o.type === 'glass' ? 'window' : o.type;
            if (RANK[t] < RANK[type]) type = t;
            if (o.type === 'door') doors.set(ek + '@' + a.toFixed(1), true);
          }
          const s = sg === 'ground' ? (z < G ? 'ground' : 'upper') : sg === 'tops' && r.group === 'crown' ? 'tops' : sg;
          const key = ek + '@' + z;
          const prev = cells.get(key);
          if (!prev || RANK[type] < RANK[prev.type]) cells.set(key, { type, s: prev ? prev.s : s });
        }
      }
    }
    for (const c of cells.values()) if (c.type !== 'none' && c.type !== 'door') add(c.s, c.type);
    // дверні прорізи — по одному на отвір
    const doorStage = new Map();
    for (const c of cells.entries()) if (c[1].type === 'door') doorStage.set(c[0].split('@')[0], c[1].s);
    for (const [k, s] of doorStage) add(s, 'door');

    // сходи — проліт на кожен рівень підйому
    for (const r of M.rooms) for (const it of r.items || []) {
      if (it.kind !== 'stairs') continue;
      const sg = stageOf(r);
      add(sg === 'ground' ? 'ground' : sg, 'stairs', Math.ceil(it.to - it.from));
    }

    const total = blank();
    for (const s of STAGES) for (const k of KINDS) total[k.id] += st[s.id][k.id];
    return { stages: STAGES.map((s) => ({ ...s, n: st[s.id] })), total };
  }

  // Пристрої й обладнання — окремий етап, без кошторису плит.
  function equipment() {
    const m = new Map();
    const put = (n) => m.set(n, (m.get(n) || 0) + 1);
    for (const it of M.roofItems) put(it.name);
    for (const r of M.rooms) for (const it of r.items || []) if (!['stairs', 'hatch', 'light', 'furniture', 'vehicle', 'air'].includes(it.kind)) put(it.full || it.name);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  // Пристрої по категоріях лімітів: { prod: [[назва, к-сть], ...], ... }
  function placeables() {
    const out = {};
    const put = (cat, n) => {
      if (!cat) return;
      const m = out[cat] || (out[cat] = new Map());
      m.set(n, (m.get(n) || 0) + 1);
    };
    for (const it of M.roofItems) put(CAT[it.kind], it.name);
    for (const r of M.rooms) for (const it of r.items || []) put(CAT[it.kind], it.full || it.name);
    for (const k of Object.keys(out)) out[k] = [...out[k].entries()].sort((a, b) => b[1] - a[1]);
    return out;
  }

  // Скільки деталей піде з урахуванням запасів.
  // found — додаткових фундаментів під кожну нижню плиту (вирівнювання під рельєф), decor — % на декор від конструкції.
  function budget(res, { found = 4, decor = 10 } = {}) {
    const t = res.total;
    const base = KINDS.reduce((s, k) => s + t[k.id], 0);
    const bottom = t.fsq + t.ramp + t.ftri; // плити рівня 0, під кожною — стовпчик фундаментів
    const resSq = found * (t.fsq + t.ramp), resTri = found * t.ftri;
    const dec = Math.round((base * decor) / 100);
    const groups = [
      { id: 'f', name: 'Фундамент', n: t.fsq + t.ftri + t.ramp },
      { id: 'd', name: 'Перекриття й дахи', n: t.csq + t.ctri },
      { id: 'w', name: 'Стіни', n: t.wall },
      { id: 'g', name: 'Вікна й пентащити', n: t.window + t.shield },
      { id: 'o', name: 'Двері, парапети, сходи', n: t.door + t.rail + t.stairs },
      { id: 'rf', name: 'Запас фундаментів', n: resSq + resTri },
      { id: 'rd', name: 'Запас на декор', n: dec },
    ];
    const total = groups.reduce((s, g) => s + g.n, 0);
    // решта категорій: пристрої з моделі, двері — по одній на дверний проріз
    const pl = placeables();
    if (t.door) (pl.doors || (pl.doors = [])).unshift(['Двері в прорізах', t.door]);
    const cats = LIMITS.map((l) => {
      if (l.id === 'build') return { ...l, n: total, items: [] };
      const items = pl[l.id] || [];
      return { ...l, n: items.reduce((s, [, c]) => s + c, 0), items };
    });
    return { base, bottom, resSq, resTri, decor: dec, groups, total, cats };
  }

  root.BUILD = { KINDS, LIMITS, compute, equipment, budget };
})(typeof window !== 'undefined' ? window : globalThis);

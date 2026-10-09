/*
 * План будівництва по етапах і підрахунок деталей для кошторису.
 * Стіни рахуються секціями: 1 плита завширшки x 1 рівень заввишки; спільна стіна двох приміщень — один раз.
 */
(function (root) {
  'use strict';
  const M = root.BASE;
  const { G, SH, CAR, DECK } = M.heights;
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
  ];

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
    { id: 'ground', name: 'Стіни першого поверху', note: 'Гаражі, заїзд, Великий зал до +6, цехи (6 рівнів), склад і крила (5 рівнів). Дверні прорізи одразу, щоб не перебудовувати.' },
    { id: 'deck1', name: 'Перекриття +5 / +6', note: 'Підлога переходу над заїздом, тераса на даху гаража багі, галерея залу, підлоги других поверхів блоків (+6) і задньої галереї, дахи гаража краулера (з пентащитом) і крил складу.' },
    { id: 'upper', name: 'Другий поверх', note: 'Перехід, водний блок, майстерня, задня галерея, стіни Великого залу від +6 до +9, круглі балкони.' },
    { id: 'orni', name: 'Ангари орні', note: 'Підлога на +5 від скошених граней заднього залу над обривом, стіни-пентащити, дах у 2 яруси зі світликом.' },
    { id: 'car', name: 'Дахи +9 і ангар грузових', note: 'Дахи залів і блоків на +9 (вони ж підлога ангара грузових), стіни і дах ангара грузових, задній майданчик.' },
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
      const s = r.group === 'crown' ? 'tops' : stageOf(r) === 'orni' ? 'orni' : tp <= SH ? 'deck1' : tp <= CAR ? 'car' : stageOf(r) === 'car' ? 'car' : 'tops';
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
          const s = sg === 'ground' ? (z < SH ? 'ground' : 'upper') : sg === 'tops' && r.group === 'crown' ? 'tops' : sg;
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

  root.BUILD = { KINDS, compute, equipment };
})(typeof window !== 'undefined' ? window : globalThis);

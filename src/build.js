/*
 * План будівництва по етапах і підрахунок деталей для кошторису.
 * Стіни рахуються секціями: 1 плита завширшки x 1 рівень заввишки; спільна стіна двох приміщень — один раз.
 */
(function (root) {
  'use strict';
  // Усе нижче будується для однієї бази: make(M) повертає її екземпляр.
  function make(M) {
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
      { id: 'door', name: 'Дверний проріз і двері' },
      { id: 'shield', name: 'Пентащит (секція)' },
      { id: 'rail', name: 'Парапет (секція)' },
      { id: 'stairs', name: 'Сходи (проліт на 1 рівень)' },
      { id: 'pillar', name: 'Колона (секція на 1 рівень)' },
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
      if (r.group === 'crown') return 'tops'; // піраміда / гора: і стіни, і дахи — в останньому етапі
      if (r.group === 'air' && r.z0 === G) return 'orni';
      if (r.z0 === 0) return 'ground';
      if (r.z0 < CAR) return 'upper';
      if (r.z0 < DECK && r.id !== 'towerL' && r.id !== 'towerR') return 'car';
      return 'tops';
    }

    const STAGES_BASE = [
      { id: 'found', name: 'Фундамент', note: 'Весь рівень 0 одним шаром: спереду квадрати, ззаду трикутники, стик по горизонталі.' },
      { id: 'ground', name: 'Стіни першого поверху', note: 'Гаражі, заїзд, Великий зал до +5, склад, цех меланжу, рудний цех, крила. Дверні прорізи одразу.' },
      { id: 'deck1', name: 'Перекриття +5', note: 'Перехід, тераса гаража багі, галерея залу, підлоги других поверхів, дахи крил і гаража краулера.' },
      { id: 'upper', name: 'Другий поверх', note: 'Перехід, водний блок, майстерня, задня галерея, прибудови, зал до +9, другий марш сходів.' },
      { id: 'orni', name: 'Ангари орні', note: 'Підлога на +5 над обривом, стіни-пентащити, дах у 2 яруси.' },
      { id: 'car', name: 'Дахи +9 і ангар грузових', note: 'Дахи на +9 — підлога ангара грузових; стіни над стінами нижче, колона, трикутний дах.' },
      { id: 'tops', name: 'Вежі, гора, балкони, місток', note: 'Вежі від +9, гора на даху ангара грузових, балкони і місток на +15.' },
    ];

    // інша база може перейменувати етапи й дати свої пояснення (M.ui.stages); порожні етапи не показуються
    const STAGES = STAGES_BASE.map((s) => ({ ...s, ...((M.ui && M.ui.stages && M.ui.stages[s.id]) || {}) }));

    function blank() { const o = {}; for (const k of KINDS) o[k.id] = 0; return o; }

    function compute() {
      const st = {};
      for (const s of STAGES) st[s.id] = blank();
      const add = (s, k, n = 1) => { st[s][k] += n; };

      // плитки дахів за висотою — щоб підлога зверху не рахувалась удруге
      const roofAt = new Set();
      for (const r of M.rooms) if (r.h > 0 && r.roof !== 'none' && r.group !== 'crown') for (const t of r.tiles) roofAt.add(tileKey(t) + '@' + top(r));
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
        // підлога, що лежить на даху приміщення нижче, — це та сама плита: не рахується двічі
        // (ангар грузових на дахах залів, прибудови на даху крил)
        const s = sg === 'upper' ? 'deck1' : sg;
        for (const t of r.tiles) if (!roofAt.has(tileKey(t) + '@' + r.z0)) add(s, t.k === 's' ? 'csq' : 'ctri');
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
      const RANK = { none: 0, door: 1, shield: 2, wall: 4, rail: 5 };
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
              const t = o.type === 'open' || o.type === 'balcony' ? 'none' : o.type;
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

      // сходи — проліт на кожен рівень підйому; колони — секція на рівень
      for (const r of M.rooms) for (const it of r.items || []) {
        const z = it.z !== undefined ? it.z : r.z0;
        const sg = z < G ? 'ground' : z < CAR ? 'upper' : stageOf(r);
        if (it.kind === 'stairs') add(sg, 'stairs', Math.ceil(it.to - it.from));
        if (it.kind === 'pillar') add(sg, 'pillar', Math.ceil(it.h));
      }

      const total = blank();
      for (const s of STAGES) for (const k of KINDS) total[k.id] += st[s.id][k.id];
      const used = (s) => KINDS.some((k) => st[s.id][k.id]);
      return { stages: STAGES.filter(used).map((s) => ({ ...s, n: st[s.id] })), total };
    }

    // Пристрої й обладнання — окремий етап, без кошторису плит.
    function equipment() {
      const m = new Map();
      const put = (n) => m.set(n, (m.get(n) || 0) + 1);
      for (const it of M.roofItems) if (it.kind !== 'hatch') put(it.name);
      for (const r of M.rooms) for (const it of r.items || []) if (!['stairs', 'hatch', 'light', 'furniture', 'vehicle', 'air', 'pillar'].includes(it.kind)) put(it.full || it.name);
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
    // Ціни сардаукарського набору в гранітному камені за деталь (база в Хагга; у Deep Desert — M.ui.costFactor).
    // Двері: проріз 10 + стулка 17. Парапет — напівстіна. Запас на декор — клиноподібні стіни по 10.
    const PRICES = { fsq: 15, ftri: 15, ramp: 10, csq: 10, ctri: 10, wall: 10, door: 27, rail: 10, stairs: 10, pillar: 10, decor: 10 };
    // Пентащит — не з каменю: матеріали за одну секцію.
    const SHIELD = [['сталевих злитків', 2], ['кобальтової пасти', 20], ['каліброваних серво', 6]];

    // Кошторис: рядки деталей із ціною в камені, разом каменю і окремо матеріали на пентащити.
    function cost(res, lim) {
      const k = (M.ui && M.ui.costFactor) || 1, t = res.total, bud = budget(res, lim);
      const rows = [];
      for (const kd of KINDS) {
        if (kd.id === 'shield' || !t[kd.id]) continue;
        rows.push({ id: kd.id, name: kd.name, n: t[kd.id], price: PRICES[kd.id] * k });
        if (kd.id === 'ftri' && lim.found > 0) {
          rows.push({ id: 'rsq', name: `Запас фундаментів, кв. (×${lim.found})`, n: bud.resSq, price: PRICES.fsq * k, sub: true });
          rows.push({ id: 'rtri', name: `Запас фундаментів, тр. (×${lim.found})`, n: bud.resTri, price: PRICES.ftri * k, sub: true });
        }
      }
      if (bud.decor) rows.push({ id: 'rdec', name: `Запас на декор, клиноподібні стіни (${lim.decor}%)`, n: bud.decor, price: PRICES.decor * k });
      for (const r of rows) r.sum = r.n * r.price;
      const stone = rows.reduce((a, r) => a + r.sum, 0);
      const shield = t.shield ? SHIELD.map(([name, per]) => ({ name, n: Math.ceil(t.shield * per * k) })) : [];
      return { rows, stone, shields: t.shield, shield, factor: k };
    }

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
        { id: 'g', name: 'Пентащити', n: t.shield },
        { id: 'o', name: 'Двері, парапети, сходи, колони', n: t.door + t.rail + t.stairs + t.pillar },
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

    return { KINDS, LIMITS, PRICES, compute, equipment, budget, cost };
  }

  root.BUILD = { make };
})(typeof window !== 'undefined' ? window : globalThis);

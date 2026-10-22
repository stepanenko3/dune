/*
 * План будівництва по етапах і підрахунок деталей для кошторису.
 * Стіни рахуються секціями: 1 плита завширшки x 1 рівень заввишки; спільна стіна двох приміщень — один раз.
 * Стіна поштучно (room.walls, з редактора) — блок за блоком: пів блоку стіни — напівстіна (як парапет).
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
      { id: 'shield', name: 'Пентащит (секція)' }, // секції — лише для енергії: по 3 на секцію
      { id: 'penta', name: 'Пентащит' },           // цілий пентащит будь-якого розміру — у дасі чи в стіні
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
    // Категорія ліміту для пристрою з моделі; null — не рахується (консоль; техніка й сходи — без ключа).
    const CAT = { turbine: 'prod', windtrap: 'prod', craft: 'prod', refine: 'prod', power: 'prod', water: 'store', storage: 'store', light: 'light', furniture: 'decor', console: null };

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
        let any = false;
        for (const t of r.tiles) {
          if (sky.has(tileKey(t)) && !r.crown) { add(s, 'shield'); any = true; }
          else add(s, t.k === 's' ? 'csq' : 'ctri');
        }
        if (r.crown) for (const t of r.crown.tiles) {
          if (sky.has(tileKey(t))) { add(s, 'shield'); any = true; }
          else add(s, t.k === 's' ? 'csq' : 'ctri');
        }
        if (any) add(s, 'penta'); // пентащит у дасі приміщення — один на весь отвір
      }

      // стіни: секції по рівнях, спільні — один раз; більш відкритий тип перемагає
      const RANK = { none: 0, door: 1, shield: 2, wall: 4, rail: 5 };
      const cells = new Map();
      const doors = new Map();
      // пентащит у стіні — один на проріз (сегмент open), хоч би скільки секцій він займав
      const pentas = new Map();
      const segKey = (o) => [o.a, o.b].map((p) => p.x.toFixed(2) + ',' + p.y.toFixed(2)).sort().join('|') + '@' + o.z0;
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
          // стіна поштучно (з редактора): кожен блок — секція; пів блоку стіни — як парапет (напівстіна);
          // пентащит — один на кожен стовпчик блоків-щитів поспіль
          if (M.wallStack && M.wallStack(r, e.a, e.b)) {
            let shieldRun = null;
            for (const p of M.edgePieces(r, e.a, e.b)) {
              const type = p.type === 'open' ? 'none' : p.type === 'wall' && p.h < 1 - 1e-6 ? 'rail' : p.type;
              const s = sg === 'ground' ? (p.z0 < G ? 'ground' : 'upper') : sg === 'tops' && r.group === 'crown' ? 'tops' : sg;
              if (type === 'door') doors.set(ek + '@' + p.z0.toFixed(1), true);
              if (type === 'shield') { if (!shieldRun) { shieldRun = ek + '@p' + p.z0.toFixed(2); pentas.set(shieldRun, s); } } else shieldRun = null;
              const key = ek + '@' + Math.round(p.z0 * 100) / 100;
              const prev = cells.get(key);
              if (!prev || RANK[type] < RANK[prev.type]) cells.set(key, { type, s: prev ? prev.s : s });
            }
            continue;
          }
          const hi = Math.ceil(top(r) - 0.5);
          for (let z = Math.floor(r.z0); z < hi; z++) {
            const mid = z + 0.5;
            let type = 'wall', sh = null;
            for (const o of e.open) {
              const a = o.z0 !== undefined ? o.z0 : r.z0;
              const b = o.z1 !== undefined ? o.z1 : o.type === 'door' ? r.z0 + 2.5 : top(r);
              if (mid < a || mid > b) continue;
              const t = o.type === 'open' || o.type === 'balcony' ? 'none' : o.type;
              if (RANK[t] < RANK[type]) type = t;
              if (o.type === 'door') doors.set(ek + '@' + a.toFixed(1), true);
              if (o.type === 'shield') sh = o;
            }
            const s = sg === 'ground' ? (z < G ? 'ground' : 'upper') : sg === 'tops' && r.group === 'crown' ? 'tops' : sg;
            if (type === 'shield' && sh) pentas.set(segKey(sh), s); // ставиться, коли стіни довкола вже до верху прорізу
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
      for (const s of pentas.values()) add(s, 'penta');

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
      for (const r of M.rooms) for (const it of r.items || []) if (!['stairs', 'hatch', 'light', 'furniture', 'vehicle', 'air', 'pillar', 'spot'].includes(it.kind)) put(it.full || it.name);
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

    // Ціни сардаукарського набору в гранітному камені за деталь (база в Хагга; у Deep Desert — M.ui.costFactor).
    // Двері: проріз 10 + стулка 17. Парапет — напівстіна.
    const PRICES = { fsq: 15, ftri: 15, ramp: 10, csq: 10, ctri: 10, wall: 10, door: 27, rail: 10, stairs: 10, pillar: 10 };
    // Матеріали пентащитів і пристроїв: назва в підсумку і коротка — у таблиці.
    const MATS = [
      { id: 'steel', name: 'сталевих злитків', short: 'сталь' },
      { id: 'cobalt', name: 'кобальтової пасти', short: 'кобальт. паста' },
      { id: 'servo', name: 'каліброваних серво', short: 'серво' },
      { id: 'scrap', name: 'утилізованого металу', short: 'утиль. метал' },
      { id: 'iron', name: 'залізних злитків', short: 'залізо' },
      { id: 'alu', name: 'алюмінієвих злитків', short: 'алюміній' },
      { id: 'silicone', name: 'силіконових блоків', short: 'силікон' },
    ];
    // Рецепти з гри за одиницю (база в Хагга; у Deep Desert — M.ui.costFactor; fixed — без знижки).
    // power: скільки дає (+) чи бере (−) енергії (запасне — калькулятор бере потужність із довідника); cat — категорія
    // ліміту. Пентащит будь-якого розміру — 2 сталі, 20 пасти, 6 серво, а енергії бере по 3 на кожну секцію (SHIELD_POWER).
    const RECIPES = {
      shield: { name: 'Пентащит (будь-якого розміру)', mats: { steel: 2, cobalt: 20, servo: 6 }, fixed: true, cat: null },
      generator: { name: 'Паливний генератор', mats: { scrap: 45 }, power: 75, cat: 'prod' },
      fabricator: { name: 'Фабрикатор (базовий верстак)', mats: { scrap: 75 }, power: -10, cat: 'prod' },
      repair: { name: 'Ремонтна станція', mats: { iron: 40 }, power: -20, cat: 'prod' },
      storage: { name: 'Контейнер для зберігання', mats: { alu: 35, silicone: 5 }, cat: 'store' },
      console: { name: 'Розширена консоль суб-фіфу', mats: { scrap: 40 }, cat: null },
      replicator: { name: 'Солідо-реплікатор (з собою)', mats: { scrap: 20 }, fixed: true, cat: null },
    };
    const SHIELD_POWER = 3;   // енергії на секцію пентащита
    const SHIELD_ELEMS = 2;   // будівельних елементів на пентащит будь-якого розміру
    const FUEL_WEEK = 24 * 7; // паливний елемент горить 1 год — стільки на генератор за тиждень

    // Кошторис: рядки деталей із ціною в камені, разом каменю і окремо пентащити й пристрої з моделі (item.recipe).
    function cost(res) {
      const k = (M.ui && M.ui.costFactor) || 1, t = res.total;
      const rows = KINDS.filter((kd) => PRICES[kd.id] && t[kd.id]).map((kd) => ({ id: kd.id, name: kd.name, n: t[kd.id], price: PRICES[kd.id] * k }));
      for (const r of rows) r.sum = r.n * r.price;
      const stone = rows.reduce((a, r) => a + r.sum, 0);
      const cnt = { shield: t.penta };
      for (const r of M.rooms) for (const it of r.items || []) if (it.recipe) cnt[it.recipe] = (cnt[it.recipe] || 0) + 1;
      for (const [id, n] of Object.entries((M.ui && M.ui.extras) || {})) cnt[id] = (cnt[id] || 0) + n;
      const devices = Object.keys(RECIPES).filter((id) => cnt[id]).map((id) => {
        const R = RECIPES[id], f = R.fixed ? 1 : k;
        return { id, name: R.name, n: cnt[id], power: R.power || 0, cat: R.cat, mats: Object.fromEntries(Object.entries(R.mats).map(([m, q]) => [m, q * f])) };
      });
      return { rows, stone, devices, MATS, shieldDraw: t.shield * SHIELD_POWER, fuelWeek: FUEL_WEEK, factor: k };
    }

    // Будівельні елементи проти ліміту; декор до них не належить. GROUP_OF — у яку групу йде вид (і рядок
    // калькулятора з цим id): той самий розподіл і в картці «Будівельні елементи», і тут.
    const GROUP_OF = { fsq: 'f', ftri: 'f', ramp: 'f', csq: 'd', ctri: 'd', wall: 'w', door: 'o', rail: 'o', stairs: 'o', pillar: 'o' };
    const groupSum = (t, g) => Object.keys(GROUP_OF).reduce((s, k) => s + (GROUP_OF[k] === g ? t[k] || 0 : 0), 0);
    function budget(res) {
      const t = res.total;
      const groups = [
        { id: 'f', name: 'Фундамент', n: groupSum(t, 'f') },
        { id: 'd', name: 'Перекриття й дахи', n: groupSum(t, 'd') },
        { id: 'w', name: 'Стіни', n: groupSum(t, 'w') },
        { id: 'g', name: 'Пентащити', n: t.penta * SHIELD_ELEMS },
        { id: 'o', name: 'Двері, парапети, сходи, колони', n: groupSum(t, 'o') },
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
      return { groups, total, cats };
    }

    // ---------- база з деталей (format 2): рахуємо самі деталі, етапи — за рівнями ----------
    if (M.format === 2) return makePieces();

    return { KINDS, LIMITS, PRICES, CAT, compute, equipment, budget, cost, groupOf: (id) => GROUP_OF[id] || null };

    function makePieces() {
      const P = (typeof module !== 'undefined' && module.exports) ? require('./pieces.js') : root.PIECES;
      const KINDS2 = [
        { id: 'fsq', name: 'Фундамент, квадрат' },
        { id: 'ftri', name: 'Фундамент, трикутник' },
        { id: 'csq', name: 'Перекриття / дах, квадрат' },
        { id: 'ctri', name: 'Перекриття / дах, трикутник' },
        { id: 'slope', name: 'Скат даху' },
        { id: 'wall', name: 'Стіна' },
        { id: 'window', name: 'Вікно' },
        { id: 'door', name: 'Двері й ворота' },
        { id: 'open', name: 'Прохід, арка' },
        { id: 'wedge', name: 'Скісна стіна' },
        { id: 'lean', name: 'Похила стіна' },
        { id: 'stairs', name: 'Сходи' },
        { id: 'ramp', name: 'Пандус' },
        { id: 'pillar', name: 'Колона' },
        { id: 'rail', name: 'Поручень, драбина' },
        { id: 'shield', name: 'Пентащит (секція)' },
        { id: 'penta', name: 'Пентащит' },
      ];
      const blank2 = () => Object.fromEntries(KINDS2.map((k) => [k.id, 0]));
      const floors = M.levels.filter((l) => l.key !== 'r');
      const stageOfPiece = (p) => {
        const s = P.SHAPES[p.shape];
        if (s && s.cat === 'found') return 'found';
        const z = p.z;
        const L = floors.find((l) => z >= l.z0 - 1e-6 && z < l.z1 - 1e-6) || floors[floors.length - 1];
        return L ? 'lvl-' + L.key : 'found';
      };
      /** пентащити: клітинки, що торкаються (на одній прямій поруч чи одна над одною; плитки — спільним краєм), — одна поверхня */
      function shieldGroups() {
        const cells = M.pieces.filter((p) => P.SHAPES[p.shape] && P.SHAPES[p.shape].family === 'shield');
        const parent = cells.map((_, i) => i);
        const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
        const fp = cells.map((c) => P.footprint(c));
        const same = (a, b) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;
        const sharedEdge = (pa, pb) => pa.some((q, i) => { const q2 = pa[(i + 1) % pa.length]; return pb.some((r, j) => { const r2 = pb[(j + 1) % pb.length]; return (same(q, r) && same(q2, r2)) || (same(q, r2) && same(q2, r)); }); });
        for (let i = 0; i < cells.length; i++)
          for (let j = i + 1; j < cells.length; j++) {
            const a = fp[i], b = fp[j];
            if (a.at !== b.at) continue;
            let touch = false;
            if (a.at === 'edge') {
              const col = P.segsOverlap(a.seg, b.seg) || (P.segsOverlap({ a: a.seg.a, b: { x: 2 * a.seg.b.x - a.seg.a.x, y: 2 * a.seg.b.y - a.seg.a.y } }, b.seg) || P.segsOverlap({ a: { x: 2 * a.seg.a.x - a.seg.b.x, y: 2 * a.seg.a.y - a.seg.b.y }, b: a.seg.b }, b.seg));
              const sameSeg = P.segsOverlap(a.seg, b.seg);
              touch = (sameSeg && (Math.abs(a.z1 - b.z0) < 1e-6 || Math.abs(b.z1 - a.z0) < 1e-6)) || (col && !sameSeg && a.z0 < b.z1 && b.z0 < a.z1);
            } else touch = Math.abs(a.z1 - b.z1) < 1e-6 && sharedEdge(a.poly, b.poly);
            if (touch) parent[find(i)] = find(j);
          }
        const groups = new Map();
        cells.forEach((c, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
        return [...groups.values()];
      }
      function compute2() {
        const st = new Map();
        const stage = (id) => {
          if (!st.has(id)) st.set(id, blank2());
          return st.get(id);
        };
        stage('found');
        for (const p of M.pieces) {
          const s = P.SHAPES[p.shape];
          if (!s) continue;
          stage(stageOfPiece(p))[s.kind] += 1;
        }
        for (const g of shieldGroups()) stage(stageOfPiece(g[0])).penta += 1;
        // сходи й колони, поставлені станціями (давні бази): проліт на кожен блок підйому, колона — секція на блок
        const fromItems = new Map();
        for (const it of M.items || []) {
          if (it.kind !== 'stairs' && it.kind !== 'pillar') continue;
          const at = stage(stageOfPiece({ shape: '', z: it.z !== undefined ? it.z : 0 }));
          const n = it.kind === 'stairs' ? Math.ceil((it.to || 0) - (it.from || 0)) : Math.ceil(it.h || 1);
          at[it.kind] += n;
          const shape = it.kind === 'stairs' ? 'Sardaukar_Stairs' : 'Sardaukar_Pillar_Middle';
          fromItems.set(shape, (fromItems.get(shape) || 0) + n);
        }
        const names = { found: { name: 'Фундамент', note: 'Плити на землі: спершу фундамент, далі — стіни на ньому.' } };
        for (const l of floors) names['lvl-' + l.key] = { name: l.name + (l.sub ? ' · ' + l.sub : ''), note: '' };
        const custom = (M.ui && M.ui.stages) || {};
        const order = ['found', ...floors.map((l) => 'lvl-' + l.key)];
        const stages = order.filter((id) => st.has(id) && KINDS2.some((k) => st.get(id)[k.id])).map((id) => ({ id, ...names[id], ...(custom[id] || {}), n: st.get(id) }));
        const total = blank2();
        for (const x of stages) for (const k of KINDS2) total[k.id] += x.n[k.id];
        const byShape = new Map();
        for (const p of M.pieces) if (P.SHAPES[p.shape] && P.SHAPES[p.shape].family !== 'shield') byShape.set(p.shape, (byShape.get(p.shape) || 0) + 1);
        for (const [shape, n] of fromItems) byShape.set(shape, (byShape.get(shape) || 0) + n);
        return { stages, total, byShape };
      }
      function cost2(res) {
        const k = (M.ui && M.ui.costFactor) || 1, t = res.total;
        // рядки — за формами: ціна з довідника (камінь; інші матеріали — у cost рядка)
        const rows = [...res.byShape].sort((a, b) => b[1] - a[1]).map(([id, n]) => {
          const s = P.SHAPES[id];
          const stone = (s.cost.find(([i]) => i === 'Stone') || [, 0])[1];
          return { id, ref: id, name: s.name, n, price: stone * k, sum: stone * k * n, cost: s.cost.map(([i, q]) => [i, q * k]) };
        });
        const stone = rows.reduce((a, r) => a + r.sum, 0);
        const cnt = { shield: t.penta };
        for (const r of M.rooms) for (const it of r.items || []) if (it.recipe) cnt[it.recipe] = (cnt[it.recipe] || 0) + 1;
        for (const it of M.roofItems || []) if (it.recipe) cnt[it.recipe] = (cnt[it.recipe] || 0) + 1;
        for (const [id, n] of Object.entries((M.ui && M.ui.extras) || {})) cnt[id] = (cnt[id] || 0) + n;
        const devices = Object.keys(RECIPES).filter((id) => cnt[id]).map((id) => {
          const R = RECIPES[id], f = R.fixed ? 1 : k;
          return { id, name: R.name, n: cnt[id], power: R.power || 0, cat: R.cat, mats: Object.fromEntries(Object.entries(R.mats).map(([m, q]) => [m, q * f])) };
        });
        return { rows, stone, devices, MATS, shieldDraw: t.shield * SHIELD_POWER, fuelWeek: FUEL_WEEK, factor: k };
      }
      // вид деталі → група ліміту; рядки калькулятора тут — форми деталей, їхня група — за видом форми (groupOf).
      // Похилі стіни («Високий пандус») — теж стіни: раніше вони не входили в жодну групу.
      const KIND_GROUP = { fsq: 'f', ftri: 'f', csq: 'd', ctri: 'd', slope: 'd', wall: 'w', window: 'w', open: 'w', wedge: 'w', lean: 'w', door: 'o', rail: 'o', stairs: 'o', ramp: 'o', pillar: 'o' };
      const kindSum = (t, g) => Object.keys(KIND_GROUP).reduce((s, k) => s + (KIND_GROUP[k] === g ? t[k] || 0 : 0), 0);
      const groupOf2 = (shape) => KIND_GROUP[(P.SHAPES[shape] || {}).kind] || null;
      function budget2(res) {
        const t = res.total;
        const groups = [
          { id: 'f', name: 'Фундамент', n: kindSum(t, 'f') },
          { id: 'd', name: 'Перекриття й дахи', n: kindSum(t, 'd') },
          { id: 'w', name: 'Стіни', n: kindSum(t, 'w') },
          { id: 'g', name: 'Пентащити', n: t.penta * SHIELD_ELEMS },
          { id: 'o', name: 'Двері, поручні, сходи, колони', n: kindSum(t, 'o') },
        ];
        const total = groups.reduce((s, g) => s + g.n, 0);
        const pl = placeables();
        if (t.door) (pl.doors || (pl.doors = [])).unshift(['Двері', t.door]);
        const cats = LIMITS.map((l) => {
          if (l.id === 'build') return { ...l, n: total, items: [] };
          const items = pl[l.id] || [];
          return { ...l, n: items.reduce((s, [, c]) => s + c, 0), items };
        });
        return { groups, total, cats };
      }
      return { KINDS: KINDS2, LIMITS, PRICES, CAT, compute: compute2, equipment, budget: budget2, cost: cost2, shieldGroups, groupOf: groupOf2 };
    }
  }

  root.BUILD = { make };
})(typeof window !== 'undefined' ? window : globalThis);

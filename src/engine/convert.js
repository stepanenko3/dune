/*
 * Перетворення бази зі старої моделі (приміщення з плитками, висотами, прорізами, стовпчиками стін) у деталі гри
 * (format 2: pieces, items, zones). Коли стара форма не складається з деталей, перемагають деталі гри: двері —
 * деталь дверей (високі, якщо проріз від 2 блоків) і стіна над нею; дахи-піраміди, скоси, обідки, профіль заїзду —
 * найближчими пласкими формами. Усе таке — переліком у notes (для примітки до версії).
 *   плитки на землі → фундаменти, вище → перекриття; верх стін з дахом → плаский дах (світлові вікна — пентащит);
 *   периметр × висота → стіни поштучно (і половинки), прорізи — двері, пентащит, прохід (порожньо);
 *   палуби — перекриття й поручні по краях (крім проходів); станції → items; приміщення → zones (явні плитки).
 */
(function (root) {
  'use strict';

  const GEOM = typeof module !== 'undefined' && module.exports ? require('./geom.js') : root.GEOM;
  const PIECES = typeof module !== 'undefined' && module.exports ? require('./pieces.js') : root.PIECES;
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const r2 = (v) => Math.round(v * 2) / 2; // висоти — до пів блоку
  const deg = (a, b) => r6((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
  const keyOf = (q) => PIECES.keyOf(q);
  const OPEN_RANK = { wall: 0, door: 1, shield: 2, open: 3 };

  function toPieces(doc) {
    if (doc.format === 2) return { doc2: doc, notes: [] };
    const notes = new Set();
    const pieces = [];
    let n = 0;
    const id = () => 'p' + (++n).toString(36);
    const keyOf = PIECES.keyOf;

    // ---------- плити: фундаменти, перекриття, дахи (одна на плитку й висоту) ----------
    const slabs = new Map(); // ключ плитки@z → деталь
    const RANK_SLAB = { foundation: 4, floor: 3, shield: 2, roof: 1 };
    const tileShape = (t, what) => {
      const tri = t.k === 't';
      if (what === 'foundation') return tri ? 'Sardaukar_Foundation_Wedge' : 'Sardaukar_Foundation';
      if (what === 'floor') return tri ? 'Sardaukar_Floor_Wedge' : 'Sardaukar_Floor_02';
      if (what === 'shield') return tri ? 'Sardaukar_Rooftop_Wedge' : 'Choam_PentashieldSurfaceHorizontal_Placeable'; // трикутного пентащита в грі нема
      return tri ? 'Sardaukar_Rooftop_Wedge' : 'Sardaukar_Rooftop_01';
    };
    const tileAnchor = (t) => {
      const c = GEOM.centroid(t.p);
      // квадрат — за першою стороною; трикутник — вершина p0 на локальному куті 90°
      const rot = t.k === 't' ? r6((Math.atan2(t.p[0].y - c.y, t.p[0].x - c.x) * 180) / Math.PI - 90) : deg(t.p[0], t.p[1]);
      return { x: r6(c.x), y: r6(c.y), rot };
    };
    const putSlab = (t, z, what) => {
      const k = keyOf(GEOM.centroid(t.p)) + '@' + z;
      const have = slabs.get(k);
      if (have && RANK_SLAB[have.what] >= RANK_SLAB[what]) return;
      const a = tileAnchor(t);
      const p = { id: have ? have.p.id : id(), shape: tileShape(t, what), x: a.x, y: a.y, z, rot: a.rot };
      slabs.set(k, { what, p });
    };

    const edges = new Map(); // ключ краю@z → { a, b, z, type (wall|door|shield|open), h }
    const railJobs = []; // поручні по краю плаского даху (r.roofRail): { tiles, z }
    const roofJobs = []; // скатні дахи: { tiles, sky (ключі світлових вікон — пентащит), z, full (шатро до верху), name }
    const rooms = doc.rooms || [];
    // хто з приміщень має край (для похилих стін: зовнішній край — де по той бік нема приміщення на тій самій висоті)
    // (сітки сусідів можуть бути зсунуті на пів блока — тож не за ключем краю, а за перекриттям відрізків на одній прямій)
    const allEdges = [];
    for (const q of rooms) if (q.h > 0) for (const e of GEOM.boundaryEdges(q.tiles || [])) allEdges.push({ ...e, q });
    /**
     * похилі стіни приміщення (r.lean — висота похилої частини, блоки): на плитках уздовж зовнішніх країв — похила панель
     * від краю до лінії на блок усередині (кути — кутовими), вище — звичайна стіна на тій лінії. Зовнішній край — без
     * прорізу й без іншого приміщення по той бік на тій самій висоті (палуби не рахуються)
     */
    function leanOf(r, z0) {
      const H = r2(r.lean || 0);
      if (!(H > 0) || !(r.h >= H)) return null;
      const tiles = r.tiles || [];
      // прорізи й r.leanSkip (відрізки, де стіни лишаються прямими) — не похилі
      const keep = [...(r.open || []).filter((o) => o.type && o.type !== 'wall'), ...(r.leanSkip || [])];
      const near = (e, f) => Math.max(e.a.x, e.b.x) >= Math.min(f.a.x, f.b.x) - 1e-3 && Math.min(e.a.x, e.b.x) <= Math.max(f.a.x, f.b.x) + 1e-3 && Math.max(e.a.y, e.b.y) >= Math.min(f.a.y, f.b.y) - 1e-3 && Math.min(e.a.y, e.b.y) <= Math.max(f.a.y, f.b.y) + 1e-3;
      const ext = GEOM.boundaryEdges(tiles).filter((e) => {
        const shared = allEdges.some((f) => f.q !== r && r2(f.q.z0 || 0) < z0 + H - 1e-6 && r2(f.q.z0 || 0) + f.q.h > z0 + 1e-6 && near(e, f) && PIECES.segsOverlap(e, f));
        return !shared && !keep.some((o) => PIECES.segsOverlap(e, o));
      });
      if (!ext.length) return null;
      const extK = new Set(ext.map((e) => GEOM.edgeKey(e.a, e.b)));
      const out = [], ring = new Set(), skip = new Set();
      for (const t of tiles) {
        const es = t.p.map((a, i) => ({ a, b: t.p[(i + 1) % t.p.length] }));
        const oe = es.filter((e) => extK.has(GEOM.edgeKey(e.a, e.b)));
        const c = GEOM.centroid(t.p);
        let shape = null, rot = 0;
        if (t.k === 't') {
          // трикутних похилих стін у грі нема: на трикутній підлозі — звичайні стіни
        } else if (oe.length === 1) {
          shape = 'Harkonnen_Outpost_Wall_Inclined_Tall'; rot = rotInto(oe[0].a, oe[0].b, c);
        } else if (oe.length === 2) {
          const sh = [oe[0].a, oe[0].b].find((q) => keyOf(q) === keyOf(oe[1].a) || keyOf(q) === keyOf(oe[1].b));
          if (sh) {
            const u1 = keyOf(oe[0].a) === keyOf(sh) ? oe[0].b : oe[0].a, u2 = keyOf(oe[1].a) === keyOf(sh) ? oe[1].b : oe[1].a;
            shape = 'Harkonnen_Outpost_Wall_Corner_Tall'; rot = rotCorner(sh, u1, u2);
          }
        }
        // внутрішнього кута похилої стіни в грі нема: плитку біля внутрішнього кута лишаємо без неї
        if (!shape) continue;
        ring.add(keyOf(c));
        for (const e of oe) skip.add(GEOM.edgeKey(e.a, e.b));
        out.push({ shape, x: r6(c.x), y: r6(c.y), z: z0, rot });
      }
      // внутрішня лінія: краї між плиткою з похилою стіною й плиткою всередині
      const tileOf = new Map();
      for (const t of tiles) for (let i = 0; i < t.p.length; i++) {
        const k = GEOM.edgeKey(t.p[i], t.p[(i + 1) % t.p.length]);
        if (!tileOf.has(k)) tileOf.set(k, []);
        tileOf.get(k).push({ t, a: t.p[i], b: t.p[(i + 1) % t.p.length] });
      }
      const inner = [];
      for (const list of tileOf.values()) {
        if (list.length !== 2) continue;
        const inA = ring.has(keyOf(GEOM.centroid(list[0].t.p))), inB = ring.has(keyOf(GEOM.centroid(list[1].t.p)));
        if (inA !== inB) inner.push({ a: list[0].a, b: list[0].b });
      }
      // кінець похилої ділянки, де далі по краю пряма стіна: трикутник між нею й похилою — висока трикутна стіна
      // (прямий бік — на краї приміщення, верх — уздовж внутрішнього краю на висоті похилої)
      if (H === 3) {
        const leanEdges = ext.filter((e) => skip.has(GEOM.edgeKey(e.a, e.b)));
        for (const e of inner) for (const [B, I] of [[e.a, e.b], [e.b, e.a]]) {
          const le = leanEdges.find((f) => keyOf(f.a) === keyOf(B) || keyOf(f.b) === keyOf(B));
          if (!le) continue;
          const ux = le.b.x - le.a.x, uy = le.b.y - le.a.y, vx = I.x - B.x, vy = I.y - B.y;
          if (Math.abs(ux * vy - uy * vx) < 1e-6) continue; // уздовж похилої — не кінець
          out.push({ shape: 'Sardaukar_Wall_Triangle_Top_Tall_Left', x: r6((B.x + I.x) / 2), y: r6((B.y + I.y) / 2), z: z0, rot: deg(B, I) });
        }
      }
      notes.add(`Похилі стіни «${r.name}» — на ${String(H).replace('.', ',')} блоки, вище — стіна на блок усередині`);
      return { pieces: out, ring, skip, inner, H };
    }
    const leans = new Map(); // приміщення → { skip (зовнішні краї під похилими стінами), inner (краї, де вище стоїть стіна), H }
    for (const r of rooms) {
      const z0 = r2(r.z0 || 0);
      if (r.profile) notes.add('Заокруглений профіль заїзду (пандуси по боках) — рівним фундаментом');
      for (const t of r.tiles || []) {
        if (r.group === 'shield' && !(r.h > 0)) putSlab(t, z0, 'shield'); // стеля-пентащит
        else putSlab(t, z0, z0 <= 0 ? 'foundation' : 'floor');
      }
      if (!(r.h > 0)) continue;
      const ln = leanOf(r, z0);
      let roofTiles = r.tiles || [];
      if (ln) {
        leans.set(r, ln);
        for (const p of ln.pieces) pieces.push({ id: id(), ...p });
        roofTiles = roofTiles.filter((t) => !ln.ring.has(keyOf(GEOM.centroid(t.p)))); // дах — над тим, що всередині похилих стін
      }
      if (r.roof === 'none') continue;
      const top = r2(z0 + r.h);
      const sky = new Set((r.skylight || []).map((t) => keyOf(GEOM.centroid(t.p))));
      // скатні дахи (шатро, скошений ярус, карниз, обідок) — кільцями скатів пізніше, коли відомо, де підлоги
      const sloped = r.roof === 'pyramid' || r.roof === 'tier' || r.eave || (r.rim && r.rim.length) || r.roofSlope
      if (sloped) {
        const all = r.roof === 'shield' ? new Set(roofTiles.map((t) => keyOf(GEOM.centroid(t.p)))) : sky;
        roofJobs.push({ tiles: roofTiles, sky: all, z: top, full: r.roof === 'pyramid', name: r.name });
      } else for (const t of roofTiles) putSlab(t, top, sky.has(keyOf(GEOM.centroid(t.p))) || r.roof === 'shield' ? 'shield' : 'roof');
      if (r.roofRail) railJobs.push({ tiles: roofTiles, z: top });
      if (r.crown && r.crown.tiles && r.crown.h > 0) {
        // другий ярус даху: стінки по периметру корони й дах угорі
        const ch = Math.max(0.5, r2(r.crown.h));
        if (ch !== r.crown.h) notes.add(`Ярус даху «${r.name}» — ${String(ch).replace('.', ',')} блока замість ${String(r.crown.h).replace('.', ',')}`);
        roofJobs.push({ tiles: r.crown.tiles, sky: new Set(), z: top + ch, full: false, name: r.name });
        for (const e of GEOM.boundaryEdges(r.crown.tiles)) for (let z = 0; z < ch - 1e-6; z += 1) addEdge(e.a, e.b, top + z, ch - z >= 1 ? 'wall' : 'half_wall', r);
      }
    }

    // ---------- стіни й прорізи: блоки стовпчика кожного краю; спільний край — один раз (відкритіший тип) ----------
    function addEdge(a, b, z, kind, r) {
      const k = GEOM.edgeKey(a, b) + '@' + r6(z);
      const type = kind === 'half_wall' ? 'wall' : kind;
      const h = kind === 'half_wall' ? 0.5 : 1;
      const have = edges.get(k);
      if (have && OPEN_RANK[have.type] >= OPEN_RANK[type]) return;
      edges.set(k, { a, b, z: r6(z), type, h, room: r });
    }
    for (const r of rooms) {
      if (!(r.h > 0)) continue;
      const ln = leans.get(r);
      if (ln) {
        // над похилими стінами — стіна на внутрішній лінії до верху приміщення
        const top = r2(r2(r.z0 || 0) + r.h);
        for (const e of ln.inner) for (let z = r2(r.z0 || 0) + ln.H; z < top - 1e-6; z += 1) addEdge(e.a, e.b, z, top - z >= 1 - 1e-6 ? 'wall' : 'half_wall', r);
      }
      for (const e of GEOM.boundaryEdges(r.tiles || [])) {
        if (ln && ln.skip.has(GEOM.edgeKey(e.a, e.b))) continue;
        const ps = GEOM.edgePieces({ ...r, z0: r2(r.z0 || 0), h: r2(r.h) || 0.5 }, e.a, e.b);
        for (const q of ps) addEdge(e.a, e.b, q.z0, q.h < 1 ? (q.type === 'wall' ? 'half_wall' : q.type) : q.type, r);
      }
      if (r.h !== r2(r.h)) notes.add(`Висота «${r.name}» — ${String(r2(r.h)).replace('.', ',')} блока замість ${String(r.h).replace('.', ',')}`);
    }
    // двері: стовпчик дверних блоків поспіль — високі двері (2 блоки) чи двері (1), решта — стіна
    const byEdge = new Map();
    for (const e of edges.values()) {
      const k = GEOM.edgeKey(e.a, e.b);
      if (!byEdge.has(k)) byEdge.set(k, []);
      byEdge.get(k).push(e);
    }
    let tallDoors = 0;
    for (const list of byEdge.values()) {
      list.sort((u, v) => u.z - v.z);
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const at = { x: r6((e.a.x + e.b.x) / 2), y: r6((e.a.y + e.b.y) / 2), rot: deg(e.a, e.b) };
        if (e.type === 'open') continue; // прохід — порожній край
        if (e.type === 'door') {
          let j = i;
          while (j + 1 < list.length && list[j + 1].type === 'door' && Math.abs(list[j + 1].z - list[j].z - list[j].h) < 1e-6) j++;
          const run = list.slice(i, j + 1);
          const height = run.reduce((s, x) => s + x.h, 0);
          const tall = height >= 2 - 1e-6;
          if (tall) tallDoors++;
          pieces.push({ id: id(), shape: tall ? 'Atreides_Outpost_Door_Frame_Tall' : 'Choam_Level2_Door_Frame', ...at, z: e.z });
          // над дверима — стіна до верху прорізу
          for (let z = e.z + (tall ? 2 : 1); z < e.z + height - 1e-6; z += 1) pieces.push({ id: id(), shape: e.z + height - z >= 1 - 1e-6 ? 'Sardaukar_Wall_01' : 'Sardaukar_Wall_Half', ...at, z: r6(z) });
          i = j;
          continue;
        }
        const half = e.h < 1;
        const shape = e.type === 'shield' && !half ? 'Choam_PentashieldSurfaceVertical_Placeable' : half ? 'Sardaukar_Wall_Half' : 'Sardaukar_Wall_01'; // пів-пентащита в грі нема
        pieces.push({ id: id(), shape, ...at, z: e.z });
      }
    }
    if (tallDoors) notes.add(`Двері — деталями гри: високі двері на 2 блоки, вище — стіна (${tallDoors} прорізів)`);

    // ---------- палуби: поручні по краях без проходу, де нема стіни ----------
    for (const r of rooms) {
      if (r.h > 0 || r.group === 'shield') continue;
      const z0 = r2(r.z0 || 0);
      const same = rooms.filter((o) => o !== r && Math.abs(r2(o.z0 || 0) - z0) < 1e-6);
      const sameEdges = new Set(same.flatMap((o) => GEOM.boundaryEdges(o.tiles || []).map((e) => GEOM.edgeKey(e.a, e.b))));
      for (const e of GEOM.roomEdges(r)) {
        if (e.open.some((o) => o.type === 'open')) continue;
        if (sameEdges.has(GEOM.edgeKey(e.a, e.b))) continue; // підлога тягнеться далі
        pieces.push({ id: id(), shape: 'Sardaukar_Railing', x: r6((e.a.x + e.b.x) / 2), y: r6((e.a.y + e.b.y) / 2), rot: deg(e.a, e.b), z: z0 });
      }
    }

    // ---------- плаский дах із поручнями: по краях, за якими нема плити на тій самій висоті (там дах чи підлога тягнеться далі) ----------
    for (const job of railJobs) {
      const at = (q) => keyOf(q) + '@' + job.z;
      // плитка по той бік краю — дзеркало центру відносно прямої краю (і для квадрата, і для трикутника)
      const across = (c, a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
        const t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / L2;
        const fx = a.x + t * dx, fy = a.y + t * dy;
        return { x: 2 * fx - c.x, y: 2 * fy - c.y };
      };
      // лише плитки, де дах справді лежить (не перекриті підлогою приміщення вище)
      const mine = job.tiles.filter((t) => { const sl = slabs.get(at(GEOM.centroid(t.p))); return sl && (sl.what === 'roof' || sl.what === 'shield'); });
      for (const e of GEOM.boundaryEdges(mine)) {
        const t = mine.find((q) => q.p.some((v) => keyOf(v) === keyOf(e.a)) && q.p.some((v) => keyOf(v) === keyOf(e.b)));
        if (!t) continue;
        if (slabs.has(at(across(GEOM.centroid(t.p), e.a, e.b)))) continue;
        pieces.push({ id: id(), shape: 'Sardaukar_Railing', x: r6((e.a.x + e.b.x) / 2), y: r6((e.a.y + e.b.y) / 2), rot: deg(e.a, e.b), z: job.z });
      }
    }

    // ---------- скатні дахи: кільцями від краю всередину (скат на плитку — блок угору), шатро — до верху ----------
    for (const job of roofJobs) {
      const covered = new Set();
      // перекрито підлогою вище в межах висоти скату (блок; шатро — будь-що вище): тут даху не кладемо
      for (const [k, sl] of slabs) {
        if (sl.what !== 'floor' && sl.what !== 'foundation') continue;
        const zz = Number(k.slice(k.lastIndexOf('@') + 1));
        if (zz >= job.z - 1e-6 && (job.full || zz <= job.z + 1 + 1e-6)) covered.add(k.slice(0, k.lastIndexOf('@')));
      }
      const k = (t) => keyOf(GEOM.centroid(t.p));
      for (const p of ringRoof(job.tiles, job.z, job.full, (t) => covered.has(k(t)), (t) => job.sky.has(k(t)))) pieces.push({ id: id(), ...p });
    }

    for (const s of slabs.values()) pieces.push(s.p);
    // поручень, що збігся зі стіною (балкон біля вежі), — геть
    const walls = pieces.filter((p) => p.shape !== 'Sardaukar_Railing' && PIECES.SHAPES[p.shape].at === 'edge');
    const kept = pieces.filter((p) => p.shape !== 'Sardaukar_Railing' || !walls.some((w) => PIECES.clash(p, w)));

    // ---------- станції й приміщення ----------
    const items = [];
    for (const r of rooms) for (const it of r.items || []) items.push({ ...it, z: it.z !== undefined ? it.z : r.z0 || 0 });
    for (const it of doc.roofItems || []) items.push({ ...it });
    const zones = rooms.map((r) => ({
      id: r.id,
      name: r.name,
      ...(r.short ? { short: r.short } : {}),
      group: r.group,
      ...(r.note ? { note: r.note } : {}),
      z: r2(r.z0 || 0),
      h: r.h || 0,
      tiles: (r.tiles || []).map((t) => keyOf(GEOM.centroid(t.p))),
      ...(r.label ? { label: r.label } : {}),
      ...(r.label3d ? { label3d: r.label3d } : {}),
      ...(r.covered ? { covered: true } : {}),
    }));

    const { rooms: _r, roofItems: _ri, ...rest } = doc; // eslint-disable-line no-unused-vars
    return { doc2: { ...rest, format: 2, pieces: kept, items, zones }, notes: [...notes] };
  }

  /** поворот плитки так, щоб локальна нижня сторона лежала на a–b, а +y дивилась до inside */
  function rotInto(a, b, inside) {
    const dx = b.x - a.x, dy = b.y - a.y, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    return (inside.x - mx) * -dy + (inside.y - my) * dx > 0 ? deg(a, b) : deg(b, a);
  }
  /** поворот квадрата так, щоб локальна вершина (−½, −½) була v, нижня сторона — до u1 чи u2, а +y — до іншої */
  function rotCorner(v, u1, u2) {
    const dx = u1.x - v.x, dy = u1.y - v.y;
    return (u2.x - v.x) * -dy + (u2.y - v.y) * dx > 0 ? deg(v, u1) : deg(v, u2);
  }
  /**
   * Скатний дах на плитках tiles (верх стін z): кільце крайніх квадратів — скати від краю всередину (кут — кутовий,
   * увігнутий кут — внутрішній), усередині — плаский дах на блок вище; трикутники — пласко на висоті стін; full (шатро) — кільця
   * далі всередину до верху. skip(t) — плитка, де дах не кладемо (там підлога вище), але межу вона не робить;
   * sky(t) — світлове вікно: пентащит пласко на висоті свого кільця (без щілин між скатом і щитом)
   */
  function ringRoof(tiles, z, full, skip, sky = () => false) {
    const out = [];
    const R = 1;
    // трикутних скатів у грі нема: трикутні плитки — пласко на висоті стін (уступ), кільця скатів — лише з квадратів
    let rest = tiles.filter((t) => t.k !== 't'), lvl = 0;
    for (const t of tiles) if (t.k === 't' && !skip(t)) {
      const c = GEOM.centroid(t.p);
      out.push({ shape: 'Sardaukar_Rooftop_Wedge', x: r6(c.x), y: r6(c.y), z: r6(z), rot: r6((Math.atan2(t.p[0].y - c.y, t.p[0].x - c.x) * 180) / Math.PI - 90) });
    }
    const ekOf = (a, b) => GEOM.edgeKey(a, b);
    while (rest.length) {
      const cnt = new Map();
      for (const t of rest) for (let i = 0; i < t.p.length; i++) { const k = ekOf(t.p[i], t.p[(i + 1) % t.p.length]); cnt.set(k, (cnt.get(k) || 0) + 1); }
      const bpts = new Set();
      const outer = (t) => t.p.map((a, i) => ({ a, b: t.p[(i + 1) % t.p.length] })).filter((e) => cnt.get(ekOf(e.a, e.b)) === 1);
      for (const t of rest) for (const e of outer(t)) { bpts.add(keyOf(e.a)); bpts.add(keyOf(e.b)); }
      const ring = [], inner = [];
      for (const t of rest) (outer(t).length || t.p.some((q) => bpts.has(keyOf(q))) ? ring : inner).push(t);
      const flat = (t, zz) => {
        const c = GEOM.centroid(t.p), tri = t.k === 't';
        const shape = tri ? 'Sardaukar_Rooftop_Wedge' : sky(t) ? 'Choam_PentashieldSurfaceHorizontal_Placeable' : 'Sardaukar_Rooftop_01';
        return { shape, x: r6(c.x), y: r6(c.y), z: r6(zz), rot: tri ? r6((Math.atan2(t.p[0].y - c.y, t.p[0].x - c.x) * 180) / Math.PI - 90) : deg(t.p[0], t.p[1]) };
      };
      for (const t of ring) {
        if (skip(t)) continue;
        const c = GEOM.centroid(t.p), at = { x: r6(c.x), y: r6(c.y) }, zz = r6(z + lvl), oe = outer(t);
        if (sky(t)) { out.push(flat(t, zz)); continue; }
        if (oe.length === 1) { out.push({ shape: 'Sardaukar_Roof_01', ...at, z: zz, rot: rotInto(oe[0].a, oe[0].b, c) }); continue; }
        const shared = oe.length === 2 ? [oe[0].a, oe[0].b].find((q) => keyOf(q) === keyOf(oe[1].a) || keyOf(q) === keyOf(oe[1].b)) : null;
        if (shared) {
          const u1 = keyOf(oe[0].a) === keyOf(shared) ? oe[0].b : oe[0].a, u2 = keyOf(oe[1].a) === keyOf(shared) ? oe[1].b : oe[1].a;
          out.push({ shape: 'Sardaukar_Roof_Corner', ...at, z: zz, rot: rotCorner(shared, u1, u2) });
          continue;
        }
        if (!oe.length) {
          const i = t.p.findIndex((q) => bpts.has(keyOf(q)));
          const v = t.p[i], n1 = t.p[(i + 1) % t.p.length], n2 = t.p[(i + t.p.length - 1) % t.p.length];
          out.push({ shape: 'Sardaukar_Roof_Corner_Inward', ...at, z: zz, rot: rotCorner(v, n1, n2) });
          continue;
        }
        out.push(flat(t, zz)); // вузька смуга — плаский
      }
      if (!full || !inner.length) {
        for (const t of inner) if (!skip(t)) out.push(flat(t, z + lvl + R));
        break;
      }
      rest = inner;
      lvl += R;
    }
    return out;
  }

  const api = { toPieces, ringRoof };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CONVERT = api;
})(typeof window !== 'undefined' ? window : globalThis);

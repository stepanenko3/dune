/*
 * База з даних: документ (JSON із сервера чи редактора) → модель, яку читають план, 3D і підрахунки.
 * У документі лише дані — приміщення, плитки, прорізи, пристрої, рівні; функції-помічники моделі
 * (V, boundaryEdges, exteriorEdges…) підставляємо тут. Межі й камери 3D нової бази рахуються з ділянок.
 */
(function (root) {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const GEOM = node ? require('./geom.js') : root.GEOM;
  // деталі й перетворювач — ліниво: у браузері файли рушія підключаються по черзі
  const PIECES = () => (node ? require('./pieces.js') : root.PIECES);
  const CONVERT = () => (node ? require('./convert.js') : root.CONVERT);
  const { R3, V, add, sub, mul, dir, centroid, pointInPoly, boundaryEdges, roomEdges, labelPoint, roomArea, tileArea, edgeKey, exteriorEdgesIn, wallStack, edgePieces } = GEOM;

  /** межі плану — прямокутник довкола ділянок */
  function boundsOf(claims) {
    if (!claims || !claims.length) return { x0: -5, x1: 5, y0: 0, y1: 10 };
    return {
      x0: Math.min(...claims.map((c) => c.x)),
      x1: Math.max(...claims.map((c) => c.x + c.w)),
      y0: Math.min(...claims.map((c) => c.y)),
      y1: Math.max(...claims.map((c) => c.y + c.d)),
    };
  }

  /**
   * Камери 3D від меж: ті самі ракурси, що в Main (20×30 плит), зсунуті до центру й масштабовані за розміром.
   * Координати three: x — праворуч, y — угору, z = −y плану
   */
  function viewsOf(B) {
    const cx = (B.x0 + B.x1) / 2, cz = -(B.y0 + B.y1) / 2;
    const k = Math.max(0.45, Math.max(B.x1 - B.x0, B.y1 - B.y0) / 30);
    const at = (dx, dy, dz) => [+(cx + dx * k).toFixed(2), +(dy * k).toFixed(2), +(cz + dz * k).toFixed(2)];
    return {
      quarter: { pos: at(-30, 27, 33), target: at(0, 3.5, 1) },
      front: { pos: at(0, 8, 41), target: at(0, 5, 5) },
      back: { pos: at(12, 22, -45), target: at(0, 5, -1) },
      top: { pos: at(0, 70, 0.1), target: at(0, 0, 0) },
    };
  }

  const KEYS = 'gutabcdefhijklmnopqsvwxyz';
  const fmtZ = (z) => (z === 0 ? '0' : `+${String(Math.round(z * 100) / 100).replace('.', ',')}`);
  const short = (name) => name.replace(/^Рівень\s+(?=[+−-])/i, '') || name;

  /**
   * Рівні — висоти підлог (фундаменти, перекриття): лише для зрізу й планів. Назви й підписи наявних рівнів тих самих
   * висот лишаються (doc.levels), нові — «Рівень +7». Межа рівня — до наступної підлоги; найвищий — до верху всього;
   * «Дах» — над усім. Разом — підписи кнопок, зрізи 3D і висота даху
   */
  function levelsOf(doc, pieces) {
    const P = PIECES();
    const zs = P.floorHeights(pieces);
    if (!zs.length) zs.push(0);
    const top = Math.max(zs[zs.length - 1] + 1, ...pieces.map((p) => P.zRange(p)[1]));
    const old = (doc.levels || []).filter((l) => l.key !== 'r');
    const taken = new Set();
    const keep = zs.map((z) => old.find((l) => Math.abs(l.z0 - z) < 0.01 && !taken.has(l.key) && taken.add(l.key)));
    const fresh = [...KEYS].filter((k) => !taken.has(k) && k !== 'r');
    const floors = zs.map((z, i) => {
      const was = keep[i];
      return { ...(was || {}), key: was ? was.key : fresh.shift() || 'f' + i, name: was ? was.name : `Рівень ${fmtZ(z)}`, sub: was ? was.sub || '' : '', z0: z, z1: i < zs.length - 1 ? zs[i + 1] : Math.round(top * 100) / 100 };
    });
    const roofOld = (doc.levels || []).find((l) => l.key === 'r');
    const roof = { ...(roofOld || { name: 'Дах', sub: '' }), key: 'r', z0: floors[floors.length - 1].z1, z1: 99 };
    return { levels: [...floors, roof], top };
  }
  /** підписи рівнів і зрізи 3D у ui (як було в старих даних): кнопки, повні назви, межі зрізів */
  function levelUi(ui, levels, top) {
    const floors = levels.filter((l) => l.key !== 'r');
    const was = ui.cuts || {};
    return {
      ...ui,
      levelButtons: Object.fromEntries(levels.map((l) => [l.key, l.key === 'r' ? l.name : short(l.name)])),
      levelNames: Object.fromEntries(levels.map((l) => [l.key, l.key === 'r' ? l.name : `${l.name}${l.sub ? ' · ' + l.sub : ''}`])),
      cutButtons: Object.fromEntries(floors.map((l) => [`cut-${l.key}`, short(l.name)])),
      cuts: Object.fromEntries(floors.map((l) => {
        const c = was[`cut-${l.key}`];
        return [`cut-${l.key}`, c && c[1] === l.z0 && c[0] > l.z0 && c[0] < l.z1 ? c : [Math.round((l.z1 - 0.1) * 100) / 100, l.z0]];
      })),
      all: Math.ceil(top + 1),
      captions: ui.captions || {},
    };
  }

  function hydrate(doc) {
    // стара модель (приміщення) — у деталі; що наближено — у M.convertNotes (для примітки до версії)
    let convertNotes = [];
    if (doc.format !== 2) {
      const r = CONVERT().toPieces(doc);
      doc = r.doc2;
      convertNotes = r.notes;
    }
    return hydratePieces(doc, convertNotes);
  }

  /** модель бази з деталей: зони з плитками й висотою, псевдокімнати (для списків і підписів), рівні */
  function hydratePieces(doc, convertNotes) {
    const P = PIECES();
    const pieces = doc.pieces || [];
    const items = doc.items || [];
    const zones = P.zonesOf(pieces, doc.zones || []);
    const { levels, top } = levelsOf(doc, pieces);
    const inPoly = (q, poly) => pointInPoly(q, poly);
    const used = new Set();
    const rooms = zones.map((zn) => {
      const z0 = zn.z, h = zn.h;
      const mine = [];
      items.forEach((it, i) => {
        if (used.has(i)) return;
        const z = it.z !== undefined ? it.z : 0;
        if (z < z0 - 0.01 || z > z0 + Math.max(h, 1) - 0.01) return;
        if (!zn.polys.some((poly) => inPoly(it.c, poly))) return;
        used.add(i);
        mine.push(it);
      });
      return {
        id: zn.id, name: zn.name, ...(zn.short ? { short: zn.short } : {}), group: zn.group || 'core', ...(zn.note ? { note: zn.note } : {}),
        z0, h, tiles: zn.polys.map((p) => ({ k: p.length === 3 ? 't' : 's', p })), items: mine, open: [],
        ...(zn.label ? { label: zn.label } : {}), ...(zn.label3d ? { label3d: zn.label3d } : {}), ...(zn.covered ? { covered: true } : {}),
      };
    });
    const roofItems = items.filter((_, i) => !used.has(i));
    const floors = levels.filter((l) => l.key !== 'r');
    const M = {
      ...doc,
      format: 2,
      R3, V, add, sub, mul, dir, centroid, pointInPoly,
      boundaryEdges, roomEdges, labelPoint, roomArea, tileArea, edgeKey, wallStack, edgePieces,
      pieces, items, zones, rooms, roofItems, levels, convertNotes,
      ui: levelUi(doc.ui || {}, levels, top),
      heights: { ...(doc.heights || {}), G: floors[1] ? floors[1].z0 : 5, CAR: floors[2] ? floors[2].z0 : 9, TOP: levels[levels.length - 1].z0 },
    };
    if (!M.bounds) M.bounds = boundsOf(M.claims || []);
    M.claims = M.claims || [];
    M.exteriorEdges = exteriorEdgesIn(M.rooms);
    return M;
  }

  /** документ із деталей → рівні й підписи в даних (зберігаються з базою: назви рівнів, зрізи) */
  function syncDoc(doc) {
    const { levels, top } = levelsOf(doc, doc.pieces || []);
    doc.levels = levels.map(({ key, name, sub, z0, z1 }) => ({ key, name, sub, z0, z1 }));
    doc.ui = levelUi(doc.ui || {}, levels, top);
    doc.heights = { ...(doc.heights || {}), TOP: levels[levels.length - 1].z0 };
    return doc;
  }

  function hydrateLegacy(doc) {
    const M = {
      ...doc,
      R3, V, add, sub, mul, dir, centroid, pointInPoly,
      boundaryEdges, roomEdges, labelPoint, roomArea, tileArea, edgeKey, wallStack, edgePieces,
      roofItems: doc.roofItems || [],
      ui: doc.ui || {},
    };
    if (!M.bounds) M.bounds = boundsOf(M.claims);
    M.exteriorEdges = exteriorEdgesIn(M.rooms);
    return M;
  }

  const api = { hydrate, hydrateLegacy, syncDoc, levelsOf, boundsOf, viewsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BASEDATA = api;
})(typeof window !== 'undefined' ? window : globalThis);

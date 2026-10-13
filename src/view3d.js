/*
 * 3D-перегляд бази (three.js r128 + OrbitControls).
 * План (x, y) і рівень z -> three (x, z * LH, -y): фронт бази дивиться на +Z.
 */
(function (root) {
  'use strict';
  const M = root.BASE;
  const LH = 0.85; // висота рівня відносно сторони плити (умовно)
  const DOOR = 2.5; // висота дверей у рівнях
  const PARAPET = 0.5; // висота парапету в рівнях

  const ITEM_COLORS = {
    vehicle: 0xc9a46a, air: 0x9fb0c2, refine: 0xb5523b, water: 0x3f8fc9, storage: 0x8a8f5a,
    craft: 0x9b7fc4, power: 0xd6b13a, console: 0xe4572e, stairs: 0x8b8f96, turbine: 0xe3e7ec,
    windtrap: 0xcfd6dc, furniture: 0x6b5b4b, pillar: 0x585c64, pad: 0xf2f2f2, gate: 0x2dd4bf, light: 0xfff6d8, hatch: 0x30333a,
  };
  const MINOR = /^(gallery|lantern|towerBalcony|pyr|lobby|rearBalcony|frontBalcony|court|rearDeck)/;
  // Відтінки стін за типом блоку: збоку видно, де закінчується один корпус і починається інший.
  const WALL_TONES = { drive: 0x605b54, core: 0x4d5058, store: 0x5b6169, craft: 0x535b64, refine: 0x5d5351, tower: 0x6b6256, air: 0x4b4f57, crown: 0x4b4e56 };

  function create(container, opts = {}) {
    const THREE = root.THREE;
    // центр і розмір ділянки: камери, сонце, земля і сітка рахуються від них
    const B = M.bounds, CX = (B.x0 + B.x1) / 2, CY = (B.y0 + B.y1) / 2;
    const v3 = (x, y, z) => new THREE.Vector3(x, z * LH, -y);
    const top = (r) => r.z0 + r.h;
    const tileKey = (t) => M.centroid(t.p).x.toFixed(3) + ',' + M.centroid(t.p).y.toFixed(3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(root.devicePixelRatio || 1, 2));
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'gl';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 500);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 5;
    controls.maxDistance = 150;

    const VIEWS = (M.ui && M.ui.views) || {
      quarter: { pos: [-30, 27, 18], target: [0, 3.5, -14] },
      front: { pos: [0, 8, 26], target: [0, 5, -10] },
      back: { pos: [12, 22, -60], target: [0, 5, -16] },
      top: { pos: [0, 70, -14.9], target: [0, 0, -15] },
    };
    function setView(name) {
      const v = VIEWS[name] || VIEWS.quarter;
      camera.position.set(...v.pos);
      controls.target.set(...v.target);
      controls.update();
    }
    setView('quarter');

    // світло
    scene.add(new THREE.HemisphereLight(0xfff1dc, 0x6f5638, 0.62));
    const sun = new THREE.DirectionalLight(0xffe6c8, 0.78);
    sun.position.set(-30, 48, 22);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 1, far: 160 });
    sun.shadow.bias = -0.0008;
    sun.target.position.set(CX, 0, -CY);
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xc9d6ff, 0.32);
    fill.position.set(30, 22, -60);
    scene.add(fill);

    // зрізи: верхній (бачимо все нижче) і нижній (лише один поверх)
    const clipTop = new THREE.Plane(new THREE.Vector3(0, -1, 0), 99);
    const clipBottom = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1);
    const planes = [clipTop, clipBottom];
    const std = (color, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.18, side: THREE.DoubleSide, clippingPlanes: planes, clipShadows: true, ...extra });

    // Плити трохи відсунуті в глибину, щоб шви й ребра поверх них не миготіли пунктиром.
    const behind = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    const mats = {
      sq: std(0x2f6fd0, { roughness: 0.9, metalness: 0, ...behind }),
      tri: std(0xe0812a, { roughness: 0.9, metalness: 0, ...behind }),
      wall: std(0x585c64, { metalness: 0.3 }),
      wallLight: std(0x80848b, { metalness: 0.2, ...behind }),
      roof: std(0x3a3d43, { metalness: 0.3, ...behind }),
      frame: std(0x2a2c31, { metalness: 0.45, roughness: 0.55 }),
      shield: std(0x2dd4bf, { transparent: true, opacity: 0.24, emissive: 0x0d6b60, emissiveIntensity: 0.6, depthWrite: false, roughness: 0.2 }),
      // пісок відсунутий у глибину сильніше за плити, інакше під кутом він перекриває підлогу рівня 0
      ground: new THREE.MeshStandardMaterial({ color: 0xa07d55, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 6, polygonOffsetUnits: 12 }),
    };
    const toneMats = {};
    const wallMat = (r) => {
      const c = WALL_TONES[r.group];
      if (!c) return mats.wall;
      if (!toneMats[r.group]) toneMats[r.group] = std(c, { metalness: 0.3 });
      return toneMats[r.group];
    };
    const seamMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, clippingPlanes: planes });
    const seamMatShield = new THREE.LineBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.8, clippingPlanes: planes });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x15171b, transparent: true, opacity: 0.7, clippingPlanes: planes });

    // збирач геометрії по шарах: 'base' видно завжди (його ріжуть площини зрізу), 'roof:<id>' — дах приміщення:
    // при зрізі нижче верху приміщення він ховається цілком, щоб не лишалось шматків стелі (обідки, скоси, уступи).
    let layer = 'base';
    const layers = new Map();
    const L = () => {
      if (!layers.has(layer)) layers.set(layer, { mats: new Map(), seams: [], seamsShield: [], edges: [] });
      return layers.get(layer);
    };
    const bucket = (mat) => {
      const m = L().mats;
      if (!m.has(mat)) m.set(mat, []);
      return m.get(mat);
    };
    const S = () => L().seams, SS = () => L().seamsShield, E = () => L().edges;
    const roofTop = new Map(); // шар даху -> верх приміщення (з другим ярусом)
    const floorZ = new Map(); // шар плити -> рівень підлоги: торці, днища і консолі ховаються, коли зріз нижче підлоги
    const tri = (arr, a, b, c) => arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const quad = (arr, a, b, c, d) => { tri(arr, a, b, c); tri(arr, a, c, d); };
    // плити підлоги окремо: режим «тільки плити» показує лише їх
    const floorBuckets = new Map(), floorSeams = [];
    const floorBucket = (mat) => {
      if (!floorBuckets.has(mat)) floorBuckets.set(mat, []);
      return floorBuckets.get(mat);
    };
    const line = (arr, a, b) => arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const tileMat = (t) => (t.k === 's' ? mats.sq : mats.tri);

    function floorTiles(tiles, zOf, matFor, seamArr = S(), lift = 0.004) {
      for (const t of tiles) {
        const p = t.p.map((q) => v3(q.x, q.y, zOf(q)));
        const m = matFor(t), isFloor = m === mats.sq || m === mats.tri;
        const arr = isFloor ? floorBucket(m) : bucket(m);
        for (let i = 1; i < p.length - 1; i++) tri(arr, p[0], p[i], p[i + 1]);
        const s = t.p.map((q) => v3(q.x, q.y, zOf(q) + lift));
        for (let i = 0; i < s.length; i++) line(isFloor ? floorSeams : seamArr, s[i], s[(i + 1) % s.length]);
      }
    }
    const flat = (z) => () => z;
    const pkey = (q) => q.x.toFixed(3) + ',' + q.y.toFixed(3);
    // Зовнішні ребра набору плиток з нормаллю назовні.
    function outerEdges(tiles) {
      const m = new Map();
      for (const t of tiles)
        for (let i = 0; i < t.p.length; i++) {
          const a = t.p[i], b = t.p[(i + 1) % t.p.length], k = M.edgeKey(a, b);
          if (m.has(k)) m.get(k).n++;
          else m.set(k, { a, b, t, n: 1 });
        }
      return [...m.values()].filter((e) => e.n === 1).map(({ a, b, t }) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        let n = M.V((b.y - a.y) / len, -(b.x - a.x) / len);
        const c = M.centroid(t.p), mid = M.V((a.x + b.x) / 2, (a.y + b.y) / 2);
        if ((mid.x - c.x) * n.x + (mid.y - c.y) * n.y < 0) n = M.V(-n.x, -n.y);
        return { a, b, n, t };
      });
    }
    // Скошений карниз (скріни 1 і 3): від краю даху на z вниз-назовні.
    function eave(tiles, z, out, drop, mat, keep = null) {
      const es = outerEdges(tiles).filter((e) => !keep || keep.has(M.edgeKey(e.a, e.b)));
      const at = new Map();
      const arr = bucket(mat);
      for (const e of es) {
        const a2 = M.V(e.a.x + e.n.x * out, e.a.y + e.n.y * out), b2 = M.V(e.b.x + e.n.x * out, e.b.y + e.n.y * out);
        quad(arr, v3(e.a.x, e.a.y, z), v3(e.b.x, e.b.y, z), v3(b2.x, b2.y, z - drop), v3(a2.x, a2.y, z - drop));
        quad(arr, v3(a2.x, a2.y, z - drop), v3(b2.x, b2.y, z - drop), v3(b2.x, b2.y, z - drop - 0.12), v3(a2.x, a2.y, z - drop - 0.12));
        line(E(), v3(a2.x, a2.y, z - drop), v3(b2.x, b2.y, z - drop));
        for (const [q, q2] of [[e.a, a2], [e.b, b2]]) {
          const k = pkey(q);
          if (!at.has(k)) at.set(k, []);
          at.get(k).push({ q, q2 });
        }
      }
      // клинці на кутах між сусідніми скатами
      for (const list of at.values())
        if (list.length === 2) {
          const [u, w] = list;
          tri(arr, v3(u.q.x, u.q.y, z), v3(u.q2.x, u.q2.y, z - drop), v3(w.q2.x, w.q2.y, z - drop));
          quad(arr, v3(u.q2.x, u.q2.y, z - drop), v3(w.q2.x, w.q2.y, z - drop), v3(w.q2.x, w.q2.y, z - drop - 0.12), v3(u.q2.x, u.q2.y, z - drop - 0.12));
        }
    }
    const TIER_S = 0.5; // висота скошеного уступу ярусу піраміди
    // Торець плити, трохи винесений назовні, щоб не лежав в одній площині зі стіною під ним.
    function slabSides(tiles, z, thick, mat, out = 0.02, keep = null) {
      for (const e of outerEdges(tiles)) {
        if (keep && !keep(e)) continue;
        const A = M.V(e.a.x + e.n.x * out, e.a.y + e.n.y * out), B = M.V(e.b.x + e.n.x * out, e.b.y + e.n.y * out);
        quad(bucket(mat), v3(A.x, A.y, z - thick), v3(B.x, B.y, z - thick), v3(B.x, B.y, z), v3(A.x, A.y, z));
      }
    }
    // Прорізи на кожному ребрі від усіх приміщень, що його ділять (абсолютні висоти): двері в спільній стіні
    // видно з обох боків, навіть якщо записані лише в одному приміщенні.
    const edgeHoles = new Map();
    for (const r of M.rooms) {
      if (!(r.h > 0)) continue;
      for (const e of M.roomEdges(r)) {
        const k = M.edgeKey(e.a, e.b);
        for (const o of e.open) {
          const a = o.z0 !== undefined ? o.z0 : r.z0;
          const b = o.z1 !== undefined ? o.z1 : o.type === 'door' ? r.z0 + DOOR : top(r);
          if (!edgeHoles.has(k)) edgeHoles.set(k, []);
          edgeHoles.get(k).push({ a: o.type === 'balcony' ? r.z0 + PARAPET : a, b, type: o.type === 'balcony' ? 'open' : o.type });
        }
      }
    }
    // Спільна стіна двох приміщень малюється один раз: інакше дві площини в одному місці мерехтять.
    const drawnWalls = new Map();
    const freeSpans = (k, lo, hi) => subtract(drawnWalls.get(k) || [], lo, hi);
    // [lo, hi] мінус уже зайняті проміжки
    function subtract(spans, lo, hi) {
      const used = spans.slice().sort((p, q) => p[0] - q[0]);
      const out = [];
      let z = lo;
      for (const [a, b] of used) {
        if (b <= z + 1e-6) continue;
        if (a >= hi - 1e-6) break;
        if (a > z + 1e-6) out.push([z, Math.min(a, hi)]);
        z = Math.max(z, b);
        if (z >= hi - 1e-6) break;
      }
      if (z < hi - 1e-6) out.push([z, hi]);
      return out;
    }
    // Стіни приміщень по ребрах (номінальна висота) — щоб рамки, парапети й другі яруси дахів не лягали на них.
    const roomWalls = new Map();
    for (const r of M.rooms) {
      if (!(r.h > 0) || r.group === 'crown') continue;
      for (const e of M.boundaryEdges(r.tiles)) {
        const k = M.edgeKey(e.a, e.b);
        if (!roomWalls.has(k)) roomWalls.set(k, []);
        roomWalls.get(k).push([r.z0, top(r)]);
      }
    }
    const wallFree = (a, b, lo, hi) => subtract(roomWalls.get(M.edgeKey(a, b)) || [], lo, hi);
    // Горизонтальні плити (підлоги і дахи) за висотою: кришки ребер і карнизів під ними не малюються.
    const horiz = new Map();
    const addH = (tiles, z) => {
      const k = z.toFixed(2);
      if (!horiz.has(k)) horiz.set(k, []);
      horiz.get(k).push(...tiles);
    };
    for (const r of M.rooms) {
      if (r.group !== 'crown' && !r.profile) addH(r.tiles, r.z0);
      if (!(r.h > 0) || r.roof === 'none') continue;
      const z1 = top(r);
      if (r.roof === 'tier') addH(r.tiles, z1 - (r.tierS || TIER_S));
      if (r.rim && r.rimDrop) addH(r.rim, z1 - r.rimDrop);
      addH(r.tiles, z1);
    }
    const coveredAt = (pt, z) => (horiz.get(z.toFixed(2)) || []).some((t) => M.pointInPoly(pt, t.p));
    const seenPanes = new Set();
    function wallQuad(a, b, lo, hi, mat) {
      if (mat.transparent) {
        // спільна прозора стіна (пентащит) двох приміщень малюється один раз
        const k = M.edgeKey(a, b) + '@' + lo.toFixed(2) + '-' + hi.toFixed(2);
        if (seenPanes.has(k)) return;
        seenPanes.add(k);
      }
      quad(bucket(mat), v3(a.x, a.y, lo), v3(b.x, b.y, lo), v3(b.x, b.y, hi), v3(a.x, a.y, hi));
    }

    // проміжки стіни по висоті з урахуванням прорізів (усіх приміщень на цьому ребрі)
    function wallParts(room, e, lo0, hi0) {
      const z0 = lo0, z1 = hi0;
      const holes = (edgeHoles.get(M.edgeKey(e.a, e.b)) || [])
        .map((h) => ({ a: Math.max(h.a, z0), b: Math.min(h.b, z1), type: h.type }))
        .filter((h) => h.b > h.a);
      const cuts = [...new Set([z0, z1, ...holes.flatMap((h) => [h.a, h.b])])].filter((z) => z >= z0 && z <= z1).sort((a, b) => a - b);
      const parts = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const lo = cuts[i], hi = cuts[i + 1];
        if (hi - lo < 1e-6) continue;
        const over = holes.filter((h) => h.a <= lo + 1e-6 && h.b >= hi - 1e-6).map((h) => h.type);
        if (over.includes('open') || over.includes('door')) continue;
        parts.push({ lo, hi, kind: over.includes('shield') ? 'shield' : 'solid' });
      }
      return parts;
    }
    function renderWall(room, e, lo, hi) {
      const k = M.edgeKey(e.a, e.b);
      for (const part of wallParts(room, e, lo, hi)) {
        for (const [a, b] of freeSpans(k, part.lo, part.hi)) {
          wallQuad(e.a, e.b, a, b, part.kind === 'solid' ? wallMat(room) : mats[part.kind]);
          if (part.kind === 'solid') line(E(), v3(e.a.x, e.a.y, b), v3(e.b.x, e.b.y, b));
        }
        if (!drawnWalls.has(k)) drawnWalls.set(k, []);
        drawnWalls.get(k).push([part.lo, part.hi]);
      }
    }

    // Заокруглений переріз (скріни 3 і 5): похилі плити знизу і зверху.
    function buildProfile(r, roomEdges) {
      const p = r.profile, z0 = r.z0, z1 = top(r);
      const inStrip = (t) => {
        const c = M.centroid(t.p);
        return c.x < p.x0 + p.ch ? -1 : c.x > p.x1 - p.ch ? 1 : 0;
      };
      // flat: ділянки по y, де нижній пандус прибрано (заїзди в гаражі)
      const isFlatY = (y) => (p.flat || []).some(([a, b]) => y > a + 1e-6 && y < b - 1e-6);
      const lowFlat = (t) => !inStrip(t) || isFlatY(M.centroid(t.p).y);
      const flatTiles = r.tiles.filter((t) => inStrip(t) === 0);
      floorTiles(r.tiles.filter(lowFlat), flat(z0), tileMat);
      for (const t of r.tiles) {
        const s = inStrip(t);
        if (!s) continue;
        const frac = (q) => Math.abs(q.x - (s < 0 ? p.x0 + p.ch : p.x1 - p.ch)) / p.ch;
        if (!lowFlat(t)) floorTiles([t], (q) => z0 + frac(q) * p.lo, tileMat);
      }
      // верхні скоси і дах — шар даху
      layer = 'roof:' + r.id;
      roofTop.set(layer, z1);
      for (const t of r.tiles) {
        const s = inStrip(t);
        if (!s) continue;
        const frac = (q) => Math.abs(q.x - (s < 0 ? p.x0 + p.ch : p.x1 - p.ch)) / p.ch;
        floorTiles([t], (q) => z1 - frac(q) * p.hi, () => mats.wallLight, E(), -0.004);
      }
      if (r.roof === 'solid') floorTiles(flatTiles, flat(z1 - RZ), () => mats.roof, E(), 0.006);
      layer = 'base';
      // трикутні щічки пандуса біля рівних заїздів
      for (const [ya, yb] of p.flat || [])
        for (const y of [ya, yb])
          for (const [xe, xi] of [[p.x0, p.x0 + p.ch], [p.x1, p.x1 - p.ch]]) {
            const arr = bucket(mats.wallLight);
            tri(arr, v3(xi, y, z0), v3(xe, y, z0), v3(xe, y, z0 + p.lo));
            line(E(), v3(xi, y, z0), v3(xe, y, z0 + p.lo));
          }
      for (const e of roomEdges) {
        const vertical = Math.abs(e.a.x - e.b.x) < 1e-6 && (Math.abs(e.a.x - p.x0) < 1e-6 || Math.abs(e.a.x - p.x1) < 1e-6);
        if (vertical) { renderWall(r, e, isFlatY((e.a.y + e.b.y) / 2) ? z0 : z0 + p.lo, z1 - p.hi); continue; }
        // торці: відкриті — з порталом, інакше стіна з дверима
        const isOpen = e.open.some((o) => o.type === 'open');
        if (!isOpen) renderWall(r, e, z0, z1);
      }
      for (const yEnd of endYs(r)) {
        const endOpen = roomEdges.some((e) => Math.abs(e.a.y - yEnd) < 1e-6 && Math.abs(e.b.y - yEnd) < 1e-6 && e.open.some((o) => o.type === 'open'));
        if (endOpen) portal(p, yEnd, z0, z1, yEnd < 1 ? 1 : -1);
      }
    }
    function endYs(r) {
      const ys = r.tiles.flatMap((t) => t.p.map((q) => q.y));
      return [Math.min(...ys), Math.max(...ys)];
    }
    // Восьмикутна рамка порталу.
    function portal(p, y, z0, z1, outward) {
      const oct = (g) => [
        [p.x0 + p.ch, z0 - g], [p.x1 - p.ch, z0 - g], [p.x1 + g, z0 + p.lo], [p.x1 + g, z1 - p.hi],
        [p.x1 - p.ch, z1 + g], [p.x0 + p.ch, z1 + g], [p.x0 - g, z1 - p.hi], [p.x0 - g, z0 + p.lo],
      ];
      const inner = oct(0), outer = oct(0.45);
      const y0 = y - outward * 0.055, yo = y - outward * 0.405; // не в площині стін над порталом
      for (const yy of [y0, yo])
        for (let i = 0; i < 8; i++) {
          const j = (i + 1) % 8;
          quad(bucket(mats.frame), v3(inner[i][0], yy, inner[i][1]), v3(inner[j][0], yy, inner[j][1]), v3(outer[j][0], yy, outer[j][1]), v3(outer[i][0], yy, outer[i][1]));
        }
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        quad(bucket(mats.frame), v3(outer[i][0], y0, outer[i][1]), v3(outer[j][0], y0, outer[j][1]), v3(outer[j][0], yo, outer[j][1]), v3(outer[i][0], yo, outer[i][1]));
      }
    }

    // Рамка відкритого торця ангара грузових (скрін 5): зрізані верхні кути, виступ назовні.
    function mouth(r, a, b, z0, z1, opt) {
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const u = M.V((b.x - a.x) / L, (b.y - a.y) / L);
      let n = M.V(u.y, -u.x);
      const probe = M.V((a.x + b.x) / 2 + n.x * 0.3, (a.y + b.y) / 2 + n.y * 0.3);
      if (opt.n) n = M.V(opt.n[0], opt.n[1]);
      else if (r.tiles.some((t) => M.pointInPoly(probe, t.p))) n = M.V(-n.x, -n.y); // рамка виступає назовні
      const cx = opt.c || 1.2, cz = opt.c || 1.2, g = opt.g || 0.42;
      // рамка трохи відступає від площин стін (і від сусідніх веж), щоб не мерехтіла з ними
      const P = (s, z, off = 0) => v3(a.x + u.x * s + n.x * (off + 0.055), a.y + u.y * s + n.y * (off + 0.055), z);
      const W = (s, z) => v3(a.x + u.x * s, a.y + u.y * s, z); // у площині стіни
      const si = 0.02, zt = z1 - 0.03; // і нижче від підлоги над порталом
      const inner = [[si, z0], [si, zt - cz], [cx, zt], [L - cx, zt], [L - si, zt - cz], [L - si, z0]];
      const outer = [[-g, z0], [-g, z1 - cz + g * 0.4], [cx - g * 0.4, z1 + g], [L - cx + g * 0.4, z1 + g], [L + g, z1 - cz + g * 0.4], [L + g, z0]];
      const arr = bucket(mats.frame);
      // зрізані кути (якщо дах сам не скошений під рамку)
      if (opt.fill !== false) {
        tri(bucket(mats.wall), W(si, zt), W(cx, zt), W(si, zt - cz));
        tri(bucket(mats.wall), W(L - si, zt), W(L - si, zt - cz), W(L - cx, zt));
      }
      for (const off of [0, 0.45])
        for (let i = 0; i < inner.length - 1; i++) {
          const j = i + 1;
          quad(arr, P(...inner[i], off), P(...inner[j], off), P(...outer[j], off), P(...outer[i], off));
        }
      for (const ring of [inner, outer])
        for (let i = 0; i < ring.length - 1; i++) {
          const j = i + 1;
          quad(arr, P(...ring[i], 0), P(...ring[j], 0), P(...ring[j], 0.45), P(...ring[i], 0.45));
          line(E(), P(...ring[i], 0.45), P(...ring[j], 0.45));
        }
    }

    // Пентащит у даху зі світною рамкою (світлики ангарів, дах гаража краулера).
    function skylightFrame(skyTiles, z) {
      floorTiles(skyTiles, flat(z - 0.002), () => mats.shield, SS(), 0.006);
      for (const e of M.boundaryEdges(skyTiles)) {
        for (const [lo, hi] of wallFree(e.a, e.b, z, z + 0.14)) wallQuad(e.a, e.b, lo, hi, mats.frame);
        line(SS(), v3(e.a.x, e.a.y, z + 0.15), v3(e.b.x, e.b.y, z + 0.15));
      }
    }

    const ribs = new Map();
    function freeRib(k, lo, hi) {
      const used = (ribs.get(k) || []).slice().sort((p, q) => p[0] - q[0]);
      const out = [];
      let z = lo;
      for (const [a, b] of used) {
        if (b <= z + 1e-6) continue;
        if (a >= hi - 1e-6) break;
        if (a > z + 1e-6) out.push([z, Math.min(a, hi)]);
        z = Math.max(z, b);
      }
      if (z < hi - 1e-6) out.push([z, hi]);
      return out;
    }
    // Оформлення зовнішніх стін: ребра (пілястри) на кутах, на стиках з іншими корпусами і через крок,
    // цокольний пояс і карниз. Так блоки читаються збоку, а не лише згори.
    function articulate(r, topOf) {
      if (!(r.h > 0) || r.group === 'crown' || r.profile) return;
      const ext = M.exteriorEdges(r).filter((e) => !e.open.some((o) => o.type === 'open'));
      if (!ext.length) return;
      const owner = new Map();
      for (const t of r.tiles) for (let i = 0; i < t.p.length; i++) owner.set(M.edgeKey(t.p[i], t.p[(i + 1) % t.p.length]), t);
      const normal = (e) => {
        const t = owner.get(M.edgeKey(e.a, e.b)), c = M.centroid(t.p);
        const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
        let n = M.V((e.b.y - e.a.y) / L, -(e.b.x - e.a.x) / L);
        if (((e.a.x + e.b.x) / 2 - c.x) * n.x + ((e.a.y + e.b.y) / 2 - c.y) * n.y < 0) n = M.V(-n.x, -n.y);
        return n;
      };
      const fr = bucket(mats.frame);
      const at = new Map();
      for (const e of ext) {
        const n = normal(e), hi = topOf(e), lo = r.z0;
        const parts = wallParts(r, e, lo, hi);
        const o = 0.07;
        const A = M.V(e.a.x + n.x * o, e.a.y + n.y * o), B = M.V(e.b.x + n.x * o, e.b.y + n.y * o);
        // карниз: якщо верх стіни суцільний і над ним не лежить плита (інакше верх карниза мерехтить з нею)
        const topPart = parts[parts.length - 1];
        const probe = [0.5, 0.15, 0.85].map((f) => M.V(e.a.x + (e.b.x - e.a.x) * f + n.x * 0.035, e.a.y + (e.b.y - e.a.y) * f + n.y * 0.035));
        if (topPart && topPart.kind === 'solid' && Math.abs(topPart.hi - hi) < 1e-6 && hi - lo > 1.2 && !probe.some((pt) => coveredAt(pt, hi))) {
          const ht = hi - 0.02; // на 2 см нижче плити над стіною
          quad(fr, v3(A.x, A.y, hi - 0.2), v3(B.x, B.y, hi - 0.2), v3(B.x, B.y, ht), v3(A.x, A.y, ht));
          quad(fr, v3(e.a.x, e.a.y, ht), v3(e.b.x, e.b.y, ht), v3(B.x, B.y, ht), v3(A.x, A.y, ht));
        }
        // цокольний пояс
        const bot = parts[0];
        if (bot && bot.kind === 'solid' && Math.abs(bot.lo - lo) < 1e-6 && bot.hi - lo > 0.3)
          quad(fr, v3(A.x, A.y, lo), v3(B.x, B.y, lo), v3(B.x, B.y, lo + 0.22), v3(A.x, A.y, lo + 0.22));
        for (const q of [e.a, e.b]) {
          const k = pkey(q);
          if (!at.has(k)) at.set(k, { q, list: [] });
          at.get(k).list.push({ e, n, hi });
        }
      }
      // ребра
      let step = 0;
      for (const { q, list } of at.values()) {
        let rib = false;
        if (list.length === 1) rib = true; // стик із сусіднім корпусом
        else {
          const [u, w] = list;
          const cross = Math.abs(u.n.x * w.n.y - u.n.y * w.n.x);
          rib = cross > 0.05 || step++ % 3 === 0; // кут або через дві плити
        }
        if (!rib) continue;
        let nx = list.reduce((s, x) => s + x.n.x, 0), ny = list.reduce((s, x) => s + x.n.y, 0);
        const L = Math.hypot(nx, ny) || 1;
        nx /= L; ny /= L;
        const hi = Math.min(...list.map((x) => x.hi));
        const tx = -ny, ty = nx, w = 0.09, dpt = 0.1;
        const p1 = M.V(q.x + tx * w, q.y + ty * w), p2 = M.V(q.x - tx * w, q.y - ty * w);
        const p3 = M.V(p2.x + nx * dpt, p2.y + ny * dpt), p4 = M.V(p1.x + nx * dpt, p1.y + ny * dpt);
        // на стику двох корпусів ребро ставить кожен — малюємо лише ту висоту, якої ще немає
        const rk = pkey(q);
        const spans = freeRib(rk, r.z0, hi);
        if (!ribs.has(rk)) ribs.set(rk, []);
        ribs.get(rk).push([r.z0, hi]);
        for (const [lo2, hi2] of spans) {
          for (const [a, b] of [[p1, p4], [p4, p3], [p3, p2]])
            quad(fr, v3(a.x, a.y, lo2), v3(b.x, b.y, lo2), v3(b.x, b.y, hi2), v3(a.x, a.y, hi2));
          const c = M.V(q.x + nx * dpt * 0.5, q.y + ny * dpt * 0.5);
          const hc = hi - 0.02;
          if (Math.abs(hi2 - hi) < 1e-6 && ![c, p1, p2, p3, p4].some((pt) => coveredAt(pt, hi))) quad(fr, v3(p1.x, p1.y, hc), v3(p4.x, p4.y, hc), v3(p3.x, p3.y, hc), v3(p2.x, p2.y, hc));
        }
      }
    }

    // Ангар над обривом: суцільне днище і консолі від стіни, до якої він кріпиться.
    function overhang(r, thick) {
      const o = r.overhang, zb = r.z0 - thick;
      const under = bucket(mats.roof);
      for (const t of r.tiles) {
        const p = t.p.map((q) => v3(q.x, q.y, zb));
        for (let i = 1; i < p.length - 1; i++) tri(under, p[0], p[i], p[i + 1]);
      }
      const L = Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y);
      const u = M.V((o.b.x - o.a.x) / L, (o.b.y - o.a.y) / L), tw = 0.13; // не в площині ребер стіни (±0.09)
      const fr = bucket(mats.frame);
      for (const s of o.at) {
        const side = (k) => {
          const w = M.V(o.a.x + u.x * (s + k), o.a.y + u.y * (s + k));
          return [v3(w.x, w.y, zb), v3(w.x + o.out.x * o.len, w.y + o.out.y * o.len, zb), v3(w.x, w.y, zb - o.drop)];
        };
        const A = side(-tw), B = side(tw);
        tri(fr, A[0], A[1], A[2]);
        tri(fr, B[0], B[1], B[2]);
        quad(fr, A[1], B[1], B[2], A[2]);
        line(E(), A[1], A[2]);
        line(E(), B[1], B[2]);
      }
    }

    const labelPts = [];
    // base — сходи, люки, світло і пристрої на дахах; interior — техніка й обладнання всередині (можна вимкнути).
    const itemGroups = { base: new THREE.Group(), interior: new THREE.Group() };
    const STRUCTURAL = ['stairs', 'hatch', 'light', 'pillar'];
    const hoverables = [];

    // Плитки даху, на яких лежить підлога приміщення вище, не малюються: дві площини майже в одній висоті мерехтять.
    const RZ = 0.004; // дах трохи нижче верху стін
    const upperFloors = new Set();
    for (const r of M.rooms) if (r.z0 > 0 && r.group !== 'crown' && !r.profile) for (const t of r.tiles) upperFloors.add(tileKey(t) + '@' + r.z0);
    const covered = (t, z) => upperFloors.has(tileKey(t) + '@' + z);

    function buildRoom(r) {
      const z0 = r.z0, z1 = top(r);
      const roomEdges = M.roomEdges(r);
      if (r.group === 'shield') {
        floorTiles(r.tiles, flat(z0), () => mats.shield, SS(), 0.01);
      } else if (r.profile) {
        buildProfile(r, roomEdges);
      } else if (r.group !== 'crown') {
        floorTiles(r.tiles, flat(z0), tileMat);
        // високі палуби (балкони веж, місток) і ангари над обривом — товща плита, щоб читалась знизу
        const thick = r.solidBase ? z0 * LH : r.overhang ? 0.45 : r.h === 0 && z0 > M.heights.CAR ? 0.32 : 0.14;
        if (z0 > 0) {
          layer = 'floor:' + r.id;
          floorZ.set(layer, z0);
          slabSides(r.tiles, z0, thick, r.solidBase ? mats.wall : r.overhang ? mats.frame : mats.roof);
          if (r.overhang) overhang(r, thick);
          layer = 'base';
        }
      }

      const rimKeys = new Set((r.rim || []).map(tileKey));
      const drop = r.rimDrop || 0;
      const edgeTile = new Map();
      for (const t of r.tiles) for (let i = 0; i < t.p.length; i++) edgeTile.set(M.edgeKey(t.p[i], t.p[(i + 1) % t.p.length]), t);

      // roofSlope: дах опускається від |x| = x до |x| = x + w на drop рівнів (скоси під рамки порталів)
      const rs = r.roofSlope;
      const roofZ = (q) => (rs ? z1 - Math.min(1, Math.max(0, (Math.abs(q.x) - rs.x) / rs.w)) * rs.drop : z1);
      if (r.h > 0 && !r.profile && rs) {
        for (const e of roomEdges) {
          const ha = roofZ(e.a), hb = roofZ(e.b), lo = Math.min(ha, hb);
          if (e.open.some((o) => o.type === 'open')) continue;
          renderWall(r, e, z0, lo);
          if (Math.abs(ha - hb) > 1e-6) {
            const arr = bucket(mats.wall);
            tri(arr, v3(e.a.x, e.a.y, lo), v3(e.b.x, e.b.y, lo), ha > hb ? v3(e.a.x, e.a.y, ha) : v3(e.b.x, e.b.y, hb));
          }
          line(E(), v3(e.a.x, e.a.y, ha), v3(e.b.x, e.b.y, hb));
        }
      } else if (r.h > 0 && !r.profile) {
        for (const e of roomEdges) {
          const t = edgeTile.get(M.edgeKey(e.a, e.b));
          const top1 = r.roof === 'tier' ? z1 - (r.tierS || TIER_S) : z1;
          const hi = t && rimKeys.has(tileKey(t)) ? top1 - drop : top1;
          renderWall(r, e, z0, hi);
        }
      } else if (r.h === 0 && r.group !== 'shield') {
        for (const e of roomEdges) {
          if (e.open.some((o) => o.type === 'open')) continue;
          for (const [lo, hi] of wallFree(e.a, e.b, z0, z0 + PARAPET)) wallQuad(e.a, e.b, lo, hi, mats.wallLight);
        }
      }

      // дахи: ядро на z1, обідок нижче на rimDrop, між ними уступ. Усе це — шар даху приміщення.
      layer = 'roof:' + r.id;
      roofTop.set(layer, z1 + (r.crown ? r.crown.h : 0) + (r.roof === 'pyramid' ? r.apex || 2.4 : 0));
      const open = (t) => !covered(t, z1);
      if (r.rim && drop) {
        const rimTiles = r.tiles.filter((t) => rimKeys.has(tileKey(t)));
        const core = r.tiles.filter((t) => !rimKeys.has(tileKey(t)));
        floorTiles(rimTiles, flat(z1 - drop - RZ), () => mats.roof, E(), 0.006);
        const outer = new Set(M.boundaryEdges(r.tiles).map((e) => M.edgeKey(e.a, e.b)));
        if (r.roof === 'solid') {
          const sky = new Set((r.skylight || []).map(tileKey));
          floorTiles(core.filter((t) => !sky.has(tileKey(t)) && open(t)), flat(z1 - RZ), () => mats.roof, E(), 0.006);
          for (const e of M.boundaryEdges(core)) if (!outer.has(M.edgeKey(e.a, e.b))) wallQuad(e.a, e.b, z1 - drop - RZ, z1 - RZ, wallMat(r));
          if (r.eave) {
            eave(core, z1, 0.3, 0.38, mats.frame, outer);
            eave(rimTiles, z1 - drop, 0.3, 0.38, mats.frame, outer);
          }
          if (sky.size) skylightFrame(r.tiles.filter((t) => sky.has(tileKey(t))), z1 - RZ);
        }
      } else if (r.roof === 'solid' && rs) {
        floorTiles(r.tiles, (q) => roofZ(q) - RZ, () => mats.roof, E(), 0.006);
        for (const e of M.boundaryEdges(r.tiles)) {
          const ha = roofZ(e.a) - RZ, hb = roofZ(e.b) - RZ;
          quad(bucket(mats.frame), v3(e.a.x, e.a.y, ha - 0.2), v3(e.b.x, e.b.y, hb - 0.2), v3(e.b.x, e.b.y, hb), v3(e.a.x, e.a.y, ha));
        }
      } else if (r.roof === 'solid' && (r.skylight || r.crown)) {
        // дах ангара у 2 яруси (скріни 1 і 3): нижній на весь контур, верхній з відступом, у ньому світлик
        const sky = new Set((r.skylight || []).map(tileKey));
        const crown = r.crown ? r.crown.tiles : [];
        const crownKeys = new Set(crown.map(tileKey));
        const ch = r.crown ? r.crown.h : 0, zc = z1 + ch - RZ;
        floorTiles(r.tiles.filter((t) => !crownKeys.has(tileKey(t)) && open(t)), flat(z1 - RZ), () => mats.roof, E(), 0.006);
        if (r.eave) eave(r.tiles, z1, 0.32, 0.4, mats.frame);
        else slabSides(r.tiles, z1 - RZ, 0.3, mats.frame, 0.035);
        if (crown.length) {
          floorTiles(crown.filter((t) => !sky.has(tileKey(t))), flat(zc), () => mats.roof, E(), 0.006);
          for (const e of M.boundaryEdges(crown)) for (const [lo, hi] of wallFree(e.a, e.b, z1 - RZ, zc)) wallQuad(e.a, e.b, lo, hi, mats.wall);
          if (r.eave) eave(crown, zc, 0.24, 0.3, mats.frame);
        }
        skylightFrame(r.tiles.filter((t) => sky.has(tileKey(t))), zc);
      } else if (r.roof === 'solid' && !r.profile) {
        floorTiles(r.tiles.filter(open), flat(z1 - RZ), () => mats.roof, E(), 0.006);
        if (r.eave) eave(r.tiles, z1, 0.28, 0.34, mats.frame);
        else slabSides(r.tiles, z1 - RZ, 0.16, mats.roof, 0.035, (e) => open(e.t));
      } else if (r.roof === 'shield') {
        floorTiles(r.tiles, flat(z1 - RZ), () => mats.shield, SS(), 0.006);
      } else if (r.roof === 'tier') {
        // ярус піраміди: по периметру скошений уступ на 1 плиту, посередині рівно
        const ts = r.tierS || TIER_S;
        const rimPts = new Set(M.boundaryEdges(r.tiles).flatMap((e) => [pkey(e.a), pkey(e.b)]));
        const onRim = (t) => t.p.some((q) => rimPts.has(pkey(q)));
        floorTiles(r.tiles, (q) => (rimPts.has(pkey(q)) ? z1 - ts : z1), (t) => (onRim(t) ? mats.wallLight : mats.roof), E(), 0.006);
      } else if (r.roof === 'pyramid') {
        const c = M.labelPoint(r);
        const apex = v3(c.x, c.y, z1 + (r.apex || 2.4));
        for (const e of roomEdges) tri(bucket(mats.roof), v3(e.a.x, e.a.y, z1), v3(e.b.x, e.b.y, z1), apex);
        for (const e of roomEdges) line(E(), v3(e.a.x, e.a.y, z1), apex);
      }
      layer = 'base';

      for (const o of r.open || []) if (o.frame) mouth(r, o.a, o.b, z0, z1, o.frame === true ? {} : o.frame);
      articulate(r, (e) => {
        if (rs) return Math.min(roofZ(e.a), roofZ(e.b));
        const t = edgeTile.get(M.edgeKey(e.a, e.b));
        const top1 = r.roof === 'tier' ? z1 - (r.tierS || TIER_S) : z1;
        return t && rimKeys.has(tileKey(t)) ? top1 - drop : top1;
      });

      const lp = M.labelPoint(r);
      labelPts.push({ id: r.id, name: r.name, z0, h: r.h, minor: MINOR.test(r.id), covered: !!r.covered, at: r.label3d || lp, p: new THREE.Vector3() });
      for (const it of r.items || []) addItem(it, z0, STRUCTURAL.includes(it.kind) ? itemGroups.base : itemGroups.interior);
    }

    function addItem(it, baseZ, group) {
      const z = (it.z !== undefined ? it.z : baseZ) * LH;
      const color = ITEM_COLORS[it.kind] || 0x999999;
      const mat = std(color, { roughness: 0.6, metalness: 0.25, side: THREE.FrontSide });
      const g = new THREE.Group();
      g.position.set(it.c.x, z, -it.c.y);
      g.rotation.y = (it.ang * Math.PI) / 180;
      const h = it.h * LH;
      const box = (w, hh, dd, y, m = mat, x = 0, zz = 0) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hh, dd), m);
        mesh.position.set(x, y + hh / 2, zz);
        mesh.castShadow = mesh.receiveShadow = true;
        g.add(mesh);
        return mesh;
      };
      if (it.kind === 'stairs') {
        const steep = h / it.w > 1.6;
        if (steep) {
          // гвинтові сходи в шахті башти
          const n = Math.round(it.h * 3);
          for (let i = 0; i < n; i++) {
            const a = (i * Math.PI) / 4;
            const step = box(it.d * 0.45, 0.08, 0.5, ((i + 1) * h) / n - 0.08, mat, Math.cos(a) * it.d * 0.24, Math.sin(a) * it.d * 0.24);
            step.rotation.y = -a;
          }
          const core = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h, 8), mat);
          core.position.y = h / 2;
          g.add(core);
        } else {
          // марш: сходинки зверху, під ними рівна похила плита, знизу порожньо (як у грі)
          const n = Math.max(4, Math.round(it.h * 2.5)), w = it.w, r = h / n, x = (i) => -w / 2 + (w / n) * i;
          const sv = Math.max(0.22, r * 0.8); // товщина плити під кутами сходинок, по вертикалі
          const sh = new THREE.Shape();
          sh.moveTo(-w / 2, 0);
          for (let i = 0; i < n; i++) { sh.lineTo(x(i), (i + 1) * r); sh.lineTo(x(i + 1), (i + 1) * r); }
          sh.lineTo(w / 2, h - sv);
          sh.lineTo(-w / 2 + (sv * w) / h, 0);
          sh.lineTo(-w / 2, 0);
          const geo = new THREE.ExtrudeGeometry(sh, { depth: it.d, bevelEnabled: false });
          geo.translate(0, 0, -it.d / 2);
          const flight = new THREE.Mesh(geo, mat);
          flight.castShadow = flight.receiveShadow = true;
          g.add(flight);
        }
      } else if (it.kind === 'turbine') {
        // спрямований вітряк на плиті 1×1
        const k = it.w;
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * k, 0.12 * k, h, 10), mat);
        mast.position.y = h / 2;
        mast.castShadow = true;
        g.add(mast);
        box(0.28 * k, 0.26 * k, 0.6 * k, h - 0.1);
        const bladeMat = std(0xf1f3f5);
        for (let b = 0; b < 3; b++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1 * k, 0.62 * k, 0.03), bladeMat);
          blade.geometry.translate(0, 0.31 * k, 0);
          blade.position.set(0, h + 0.05, 0.32 * k);
          blade.rotation.z = (b * 2 * Math.PI) / 3 + 0.3;
          blade.castShadow = true;
          g.add(blade);
        }
        box(it.w, 0.08, it.d, 0, std(0x55595f));
      } else if (it.kind === 'windtrap') {
        // велика вітропастка на плиті 1,5×1,5
        const rr = it.w / 2;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.72 * rr, 0.95 * rr, h * 0.85, 16), mat);
        body.position.y = (h * 0.85) / 2;
        body.castShadow = true;
        g.add(body);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.82 * rr, h * 0.3, 16), std(0xa7b0b8));
        cap.position.y = h * 0.85 + h * 0.15;
        g.add(cap);
      } else if (it.kind === 'pad') {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.05, 40), std(0xeeeeee, { roughness: 0.5 }));
        pad.position.y = 0.03;
        g.add(pad);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.06, 6, 40), std(0xf0963a));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.07;
        g.add(ring);
      } else if (it.kind === 'light') {
        box(it.w, 0.02, it.d, 0, std(0xfff6d8, { emissive: 0xfff1c4, emissiveIntensity: 0.6 }));
      } else if (it.kind === 'gate') {
        box(it.w, h, it.d, 0, std(0x2dd4bf, { transparent: true, opacity: 0.35, emissive: 0x0d6b60, emissiveIntensity: 0.5 }));
      } else if (it.kind === 'hatch') {
        box(it.w, 0.03, it.d, 0.01, std(0x30333a));
      } else if (it.kind === 'air') {
        box(it.w, h * 0.55, it.d * 0.55, 0);
        box(it.w * 0.55, 0.08, it.d, h * 0.45, std(0xd5dde6));
      } else {
        box(it.w, h, it.d, 0);
      }
      const nm = it.kind === 'stairs' ? `${it.name} (+${it.from} → +${it.to})` : it.full || it.name;
      g.traverse((o) => { if (o.isMesh) { o.userData.name = nm; hoverables.push(o); } });
      group.add(g);
    }

    for (const r of M.rooms) buildRoom(r);
    for (const it of M.roofItems) addItem(it, it.z, itemGroups.base);

    const mkLines = (arr, mat) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(geo, mat);
    };
    const structure = new THREE.Group();
    const roofGroups = [], floorGroups = [];
    for (const [key, lay] of layers) {
      const g = new THREE.Group();
      for (const [mat, arr] of lay.mats) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = !mat.transparent;
        mesh.receiveShadow = true;
        g.add(mesh);
      }
      for (const [arr, mat] of [[lay.seams, seamMat], [lay.seamsShield, seamMatShield], [lay.edges, edgeMat]]) if (arr.length) g.add(mkLines(arr, mat));
      if (roofTop.has(key)) roofGroups.push({ g, top: roofTop.get(key) });
      if (floorZ.has(key)) floorGroups.push({ g, z: floorZ.get(key) });
      structure.add(g);
    }
    const visibleMeshes = (root) => {
      const out = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        for (let p = o; p; p = p.parent) if (p.visible === false) return;
        out.push(o);
      });
      return out;
    };
    const floors = new THREE.Group();
    for (const [mat, arr] of floorBuckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      floors.add(mesh);
    }
    floors.add(mkLines(floorSeams, seamMat));
    scene.add(structure, floors, itemGroups.base, itemGroups.interior);

    // земля, сітка і ділянки
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), mats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(CX, -0.06, -CY);
    ground.receiveShadow = true;
    scene.add(ground);
    const gridArr = [];
    const gx0 = B.x0 - 2, gx1 = B.x1 + 2, gy0 = B.y0 - 3, gy1 = B.y1 + 3;
    for (let x = gx0; x <= gx1; x++) line(gridArr, v3(x, gy0, 0), v3(x, gy1, 0));
    for (let y = gy0; y <= gy1; y++) line(gridArr, v3(gx0, y, 0), v3(gx1, y, 0));
    const grid = mkLines(gridArr, new THREE.LineBasicMaterial({ color: 0x8f7457, transparent: true, opacity: 0.28 }));
    grid.position.y = -0.005;
    scene.add(grid);
    const claimArr = [];
    for (const c of M.claims) {
      const q = [v3(c.x, c.y, 0), v3(c.x + c.w, c.y, 0), v3(c.x + c.w, c.y + c.d, 0), v3(c.x, c.y + c.d, 0)];
      for (let i = 0; i < 4; i++) line(claimArr, q[i], q[(i + 1) % 4]);
    }
    scene.add(mkLines(claimArr, new THREE.LineBasicMaterial({ color: 0x24222e })));

    // підписи
    const labelLayer = document.createElement('div');
    labelLayer.className = 'labels3d';
    container.appendChild(labelLayer);
    for (const L of labelPts) {
      L.el = document.createElement('div');
      L.el.className = 'lbl3d';
      L.el.textContent = L.name;
      labelLayer.appendChild(L.el);
    }
    const tip = document.createElement('div');
    tip.className = 'tip3d';
    tip.hidden = true;
    container.appendChild(tip);

    const state = { cut: 99, floor: -1, labels: true, running: false, w: 1, h: 1, interior: true, found: false, colors: true };
    function setInterior(on) {
      state.interior = on;
      itemGroups.interior.visible = on && !state.found;
    }
    // Тільки плити підлоги (фундамент і підлоги поверхів): без стін, дахів, техніки і підписів.
    function setFoundation(on) {
      state.found = on;
      structure.visible = !on;
      itemGroups.base.visible = !on;
      itemGroups.interior.visible = state.interior && !on;
      labelLayer.hidden = on || !state.labels;
      seamMat.opacity = on ? 0.9 : state.colors ? 0.55 : 0.18;
    }
    // cut — верхня межа в рівнях; floor — нижня межа (-1 = показувати все нижче).
    // Площина зрізу ніколи не лягає на плиту: зріз рівно на +5 чи +9 інакше рве підлогу в шум.
    const CUT_EPS = 0.03;
    function setCut(levels, floor = -1) {
      state.cut = levels;
      state.floor = floor;
      const c = levels - CUT_EPS;
      clipTop.constant = c * LH;
      clipBottom.constant = -floor * LH;
      // дах приміщення, яке перетинає зріз, ховаємо цілком
      for (const R of roofGroups) R.g.visible = levels >= 98 || R.top <= c;
      // плита приміщення вище зрізу (торці, днище ангара, консолі звисають нижче підлоги) — теж
      for (const F of floorGroups) F.g.visible = levels >= 98 || F.z <= c;
    }
    function setTileColors(on) {
      state.colors = on;
      mats.sq.color.set(on ? 0x2f6fd0 : 0x50545b);
      mats.tri.color.set(on ? 0xe0812a : 0x5a5650);
      seamMat.opacity = state.found ? 0.9 : on ? 0.55 : 0.18;
    }
    function setLabels(on) {
      state.labels = on;
      labelLayer.hidden = !on || state.found;
    }

    function resize() {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      state.w = w; state.h = h;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + 'px';
      renderer.domElement.style.height = h + 'px';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const tmp = new THREE.Vector3();
    // Які підписи показувати: верхній видимий ярус + високі зали, що крізь нього проходять.
    function activeLevel() {
      const lv = M.levels.filter((l) => l.z0 < state.cut - 0.05);
      return lv[lv.length - 1] || M.levels[0];
    }
    function labelVisible(L) {
      if (L.minor || L.z0 >= state.cut - 0.05 || L.z0 < state.floor - 0.05) return false;
      if (L.covered && state.cut > L.z0 + L.h + 0.05) return false; // зал під іншим приміщенням
      const lv = activeLevel();
      const base = state.cut >= M.heights.TOP ? M.heights.G : lv.z0;
      return L.z0 >= base || (L.h >= 6 && L.z0 + L.h > base && state.floor < 0);
    }
    function labelAnchor(L) {
      const z = L.h > 0 ? Math.min(L.z0 + L.h + 0.45, state.cut - 0.3) : L.z0 + 0.6;
      L.p.copy(v3(L.at.x, L.at.y, Math.max(z, L.z0 + 0.4)));
    }
    const occRay = new THREE.Raycaster();
    let occTick = 0;
    function updateOcclusion() {
      if (occTick++ % 8 !== 0) return;
      const solids = visibleMeshes(structure).filter((o) => !o.material.transparent);
      for (const L of labelPts) {
        if (!labelVisible(L)) continue;
        labelAnchor(L);
        const d = L.p.clone().sub(camera.position);
        const dist = d.length();
        occRay.set(camera.position, d.normalize());
        occRay.far = dist - 0.6;
        const hits = occRay.intersectObjects(solids, false).filter((hh) => hh.point.y < state.cut * LH && hh.point.y > state.floor * LH);
        L.hiddenByWall = hits.length > 0;
      }
    }
    function placeLabels() {
      if (!state.labels || state.found) return;
      updateOcclusion();
      const shown = [];
      for (const L of labelPts) {
        labelAnchor(L);
        tmp.copy(L.p).project(camera);
        const on = labelVisible(L) && !L.hiddenByWall && tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
        if (!on) { L.el.hidden = true; continue; }
        const x = ((tmp.x + 1) / 2) * state.w, y = ((1 - tmp.y) / 2) * state.h;
        if (L.el.hidden) L.el.hidden = false;
        const w = (L.w = L.el.offsetWidth || L.w || 90), h = 22;
        const b = { x0: x - w / 2 - 4, x1: x + w / 2 + 4, y0: y - h / 2, y1: y + h / 2 };
        const clash = shown.some((s) => s.x0 < b.x1 && b.x0 < s.x1 && s.y0 < b.y1 && b.y0 < s.y1);
        L.el.hidden = clash;
        if (clash) continue;
        shown.push(b);
        L.el.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -50%)`;
      }
    }

    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hoverReq = null;
    renderer.domElement.addEventListener('pointermove', (ev) => {
      const rect = renderer.domElement.getBoundingClientRect();
      hoverReq = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    });
    renderer.domElement.addEventListener('pointerleave', () => { hoverReq = null; tip.hidden = true; });
    function hover() {
      if (!hoverReq) return;
      mouse.set((hoverReq.x / state.w) * 2 - 1, -(hoverReq.y / state.h) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(hoverables, false).filter((hh) => {
        let o = hh.object, visible = true;
        while (o) { if (o.visible === false) visible = false; o = o.parent; }
        return visible && hh.point.y < state.cut * LH && hh.point.y > state.floor * LH - 0.01;
      });
      if (hits.length) {
        tip.textContent = hits[0].object.userData.name;
        tip.style.transform = `translate(${hoverReq.x + 12}px, ${hoverReq.y + 12}px)`;
        tip.hidden = false;
      } else tip.hidden = true;
      hoverReq = null;
    }

    function frame() {
      if (!state.running) return;
      controls.update();
      renderer.render(scene, camera);
      placeLabels();
      hover();
      requestAnimationFrame(frame);
    }
    function start() {
      if (state.running) return;
      state.running = true;
      resize();
      requestAnimationFrame(frame);
    }
    function stop() { state.running = false; }

    // довільна камера (для знімків): pos і target у координатах three
    function setCamera(pos, target) {
      camera.position.set(...pos);
      controls.target.set(...target);
      controls.update();
    }

    return { start, stop, setCut, setInterior, setFoundation, setTileColors, setLabels, setView, setCamera, LH, debug: { scene, structure, floors, roofGroups } };
  }

  root.VIEW3D = { create };
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * 3D-перегляд бази (three.js r128 + OrbitControls).
 * План (x, y) і рівень z -> three (x, z * LH, -y): фронт бази дивиться на +Z.
 */
(function (root) {
  'use strict';
  const LH = 0.85; // висота рівня відносно сторони плити (умовно)
  const DOOR = 2.5; // висота дверей у рівнях
  const PARAPET = 0.5; // висота парапету в рівнях

  const ITEM_COLORS = {
    vehicle: 0xc9a46a, air: 0x9fb0c2, refine: 0xb5523b, water: 0x3f8fc9, storage: 0x8a8f5a,
    craft: 0x9b7fc4, power: 0xd6b13a, console: 0xe4572e, stairs: 0x8b8f96, turbine: 0xe3e7ec,
    windtrap: 0xcfd6dc, furniture: 0x6b5b4b, pillar: 0x585c64, pad: 0xf2f2f2, gate: 0x2dd4bf, light: 0xfff6d8, hatch: 0x30333a,
  };
  // підказки мовою сайту (як у plan2d.js: root.BASE_T — перекладач сайту, BASE_LAB — підписи станцій, BASE_NUM — числа)
  const fillT = (k, v) => String(k).replace(/\{(\w+)\}/g, (m, x) => (v && x in v ? v[x] : m));
  const T = (k, v) => (root.BASE_T ? root.BASE_T(k, v) : fillT(k, v));
  const LAB = (s) => (root.BASE_LAB ? root.BASE_LAB(s) : s);
  const NUM = (v) => (root.BASE_NUM ? root.BASE_NUM(v) : String(Math.round(v * 100) / 100));
  const MINOR = /^(gallery|lantern|towerBalcony|pyr|lobby|rearBalcony|frontBalcony|court|rearDeck)/;
  // Відтінки стін за типом блоку: збоку видно, де закінчується один корпус і починається інший.
  const WALL_TONES = { drive: 0x605b54, core: 0x4d5058, store: 0x5b6169, craft: 0x535b64, refine: 0x5d5351, tower: 0x6b6256, air: 0x4b4f57, crown: 0x4b4e56 };

  function create(container, opts = {}, M0 = root.BASE) {
    let M = M0;
    const THREE = root.THREE;
    // центр і розмір ділянки: камери, сонце, земля і сітка рахуються від них
    const B = M.bounds, CX = (B.x0 + B.x1) / 2, CY = (B.y0 + B.y1) / 2;
    const v3 = (x, y, z) => new THREE.Vector3(x, z * LH, -y);
    const top = (r) => r.z0 + r.h;
    const tileKey = (t) => M.centroid(t.p).x.toFixed(3) + ',' + M.centroid(t.p).y.toFixed(3);

    // кадр малюємо лише при змінах (камера, зріз, шари, правка) — без обмеження частоти, поки щось рухається;
    // буфер кадру після показу не зберігаємо (знімки малює сервер)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
    // будівельник: камера може дивитися й знизу вгору (днище ангарів, звисання) і підходити ближче, але не під пісок
    if (opts && opts.freeLook) {
      controls.maxPolarAngle = Math.PI * 0.97;
      controls.minDistance = 1.5;
      controls.addEventListener('change', () => { if (camera.position.y < 0.25) camera.position.y = 0.25; });
      // м'яке світло знизу — днище й звисання видно, а не чорну тінь
      const under = new THREE.DirectionalLight(0xfff1dc, 0.45);
      under.position.set(0.3, -1, 0.2);
      scene.add(under);
    }

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
      // від першої особи — той самий погляд, але центр обертання — одразу перед камерою
      if (navFly) controls.target.sub(camera.position).normalize().multiplyScalar(0.05).add(camera.position);
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

    /** матеріали обрисів станцій — спільні на всю сцену (сотні станцій — кілька матеріалів) */
    const stationMats = new Map();
    const stationMat = (color, extra = {}) => {
      const k = color + JSON.stringify(extra);
      if (!stationMats.has(k)) stationMats.set(k, std(color, { roughness: 0.62, metalness: 0.22, side: THREE.FrontSide, ...extra }));
      return stationMats.get(k);
    };

    // Плити трохи відсунуті в глибину, щоб шви й ребра поверх них не миготіли пунктиром. Стіни — ще глибше: торець
    // стіни, що впирається верхом у плиту (стіна під дахом, напівстіна, що звисає під підлогою), лежить у площині плити
    // й інакше просвічує крізь неї смугою.
    const behind = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    const deeper = { polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 3 };
    const mats = {
      sq: std(0x2f6fd0, { roughness: 0.9, metalness: 0, ...behind }),
      tri: std(0xe0812a, { roughness: 0.9, metalness: 0, ...behind }),
      wall: std(0x585c64, { metalness: 0.3, ...deeper }),
      wallLight: std(0x80848b, { metalness: 0.2, ...behind }),
      roof: std(0x3a3d43, { metalness: 0.3, ...behind }),
      frame: std(0x2a2c31, { metalness: 0.45, roughness: 0.55 }),
      shield: std(0x2dd4bf, { transparent: true, opacity: 0.24, emissive: 0x0d6b60, emissiveIntensity: 0.6, depthWrite: false, roughness: 0.2 }),
      // деталі будівельника: скло вікон, стулки дверей і воріт
      glass: std(0x9fd4e8, { transparent: true, opacity: 0.35, depthWrite: false, roughness: 0.1, metalness: 0.1 }),
      door: std(0x6b4f35, { metalness: 0.2 }),
      gate: std(0x45494f, { metalness: 0.5 }),
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
    const tri = (arr, a, b, c) => {
      arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      if (owner >= 0) {
        let o = owners.get(arr);
        if (!o) { o = new Array(arr.length / 9 - 1).fill(-1); owners.set(arr, o); }
        while (o.length < arr.length / 9 - 1) o.push(-1);
        o.push(owner);
      } else { const o = owners.get(arr); if (o) o.push(-1); }
    };
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
    const mkLines = (arr, mat) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(geo, mat);
    };
    const visibleMeshes = (root) => {
      const out = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        for (let p = o; p; p = p.parent) if (p.visible === false) return;
        out.push(o);
      });
      return out;
    };
    // хто власник трикутника (деталь у M.pieces) — для вибору й заміни в будівельнику: масив буфера → індекси деталей
    const owners = new Map();
    let owner = -1;
    // рамки деталей (у координатах three): вибір під курсором і перевірка «підпис за стіною» — спершу рамки, а точні
    // трикутники — лише кількох найближчих (на тисячах деталей промінь крізь усі трикутники гальмує кадр)
    let boxes = [];

    // ---------- збирання будови з моделі: на старті й після кожної правки (update) ----------
    function buildAll() {
    layer = 'base';
    layers.clear();
    floorBuckets.clear();
    floorSeams.length = 0;
    roofTop.clear();
    floorZ.clear();
    owners.clear();
    owner = -1;
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
    const skyEdges = new Set(); // рамка на стику двох світликів — одна на обидва
    function skylightFrame(skyTiles, z) {
      floorTiles(skyTiles, flat(z - 0.002), () => mats.shield, SS(), 0.006);
      for (const e of M.boundaryEdges(skyTiles)) {
        const k = M.edgeKey(e.a, e.b) + '@' + z.toFixed(3);
        if (skyEdges.has(k)) continue;
        skyEdges.add(k);
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
        // світлик без верхнього ярусу — прямо в нижньому даху (ангар орні з вильотом угору)
        floorTiles(r.tiles.filter((t) => !crownKeys.has(tileKey(t)) && !sky.has(tileKey(t)) && open(t)), flat(z1 - RZ), () => mats.roof, E(), 0.006);
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

    function addItem(it, baseZ, group, idx) {
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
      // пристрій гри — його обрис (stations3d.js); інші станції — як були
      const ST = root.STATIONS3D;
      const gameType = ST && ST.typeOf(it);
      if (gameType && ST.build(gameType, g, it.w, it.d, h, { THREE, mat: stationMat })) mat.dispose();
      else if (it.kind === 'stairs') {
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
        box(it.w, 0.02, it.d, 0.012, std(0xfff6d8, { emissive: 0xfff1c4, emissiveIntensity: 0.6 })); // трохи над підлогою — не мерехтить
      } else if (it.kind === 'gate') {
        box(it.w, h, it.d, 0, std(0x2dd4bf, { transparent: true, opacity: 0.35, emissive: 0x0d6b60, emissiveIntensity: 0.5 }));
      } else if (it.kind === 'hatch') {
        box(it.w, 0.03, it.d, 0.01, std(0x30333a));
      } else if (it.kind === 'spot') {
        // місце для техніки, що стоїть тут не завжди: лише рамка на підлозі
        const fm = std(0x2dd4bf, { emissive: 0x0d6b60, emissiveIntensity: 0.4 }), t = 0.07;
        box(it.w, 0.02, t, 0.006, fm, 0, -it.d / 2 + t / 2);
        box(it.w, 0.02, t, 0.006, fm, 0, it.d / 2 - t / 2);
        box(t, 0.02, it.d, 0.006, fm, -it.w / 2 + t / 2, 0);
        box(t, 0.02, it.d, 0.006, fm, it.w / 2 - t / 2, 0);
      } else if (it.kind === 'air') {
        box(it.w, h * 0.55, it.d * 0.55, 0);
        box(it.w * 0.55, 0.08, it.d, h * 0.45, std(0xd5dde6));
      } else {
        box(it.w, h, it.d, 0);
      }
      const nm = it.kind === 'stairs' ? T('{name} (+{from} → +{to})', { name: LAB(it.name), from: NUM(it.from), to: NUM(it.to) }) : LAB(it.full || it.name);
      g.traverse((o) => { if (o.isMesh) { o.userData.name = nm; if (idx !== undefined) o.userData.item = idx; hoverables.push(o); } });
      group.add(g);
    }

    if (M.format === 2) buildPieces();
    else {
      for (const r of M.rooms) buildRoom(r);
      for (const it of M.roofItems) addItem(it, it.z, itemGroups.base);
    }

    // верх стіни чи напівстіни, що впирається в підлогу знизу (днище ангара, стіна під дахом), лежить точно в площині
    // плити: його ребра й торець проступають крізь неї подвійним швом і штрихами. Їх і не видно ні звідки — не малюємо:
    // край плити й так обведено її власним контуром. covered(x, y, z) — чи точка в площині якоїсь плити (верх) і в ній
    function underSlab(P) {
      const cells = new Map();
      const key = (z, x, y) => z.toFixed(3) + '|' + Math.floor(x) + '|' + Math.floor(y);
      for (const p of M.pieces) {
        const s = P.SHAPES[p.shape];
        if (!s || s.family !== 'slab') continue;
        const poly = P.footprint(p).poly;
        const xs = poly.map((q) => q.x), ys = poly.map((q) => q.y);
        for (let cx = Math.floor(Math.min(...xs) - 0.01); cx <= Math.floor(Math.max(...xs) + 0.01); cx++)
          for (let cy = Math.floor(Math.min(...ys) - 0.01); cy <= Math.floor(Math.max(...ys) + 0.01); cy++) {
            const k = key(p.z, cx, cy);
            if (!cells.has(k)) cells.set(k, []);
            cells.get(k).push(poly);
          }
      }
      const E = 1e-3;
      const nearSeg = (x, y, a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(a.x + dx * t - x, a.y + dy * t - y) < E;
      };
      const inside = (x, y, poly) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const a = poly[i], b = poly[j];
          if (nearSeg(x, y, a, b)) return true;
          if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
        }
        return c;
      };
      const covered = (x, y, z) => {
        for (const dx of [-E, E]) for (const dy of [-E, E]) for (const poly of cells.get(key(z, x + dx, y + dy)) || []) if (inside(x, y, poly)) return true;
        return false;
      };
      return covered;
    }

    // база з деталей: геометрія кожної деталі (PIECES.geom) у ті самі кошики матеріалів; плити й скати вище землі —
    // окремими шарами за висотою (зріз нижче ховає їх цілком); власник кожного трикутника — для вибору
    function buildPieces() {
      const P = root.PIECES;
      const MAT = { sq: mats.sq, tri: mats.tri, roof: mats.roof, wall: mats.wall, wallLight: mats.wallLight, trim: mats.wallLight, frame: mats.frame, glass: mats.glass, door: mats.door, gate: mats.gate, shield: mats.shield };
      const covered = underSlab(P);
      const flat = (t, k, n) => { for (let i = 1; i < n; i++) if (Math.abs(t[k + 3 * i + 2] - t[k + 2]) > 1e-4) return false; return true; };
      // ребро чи трикутник у площині плити й під нею цілком (точки, а для ребра — і середина)
      const hidden = (t, k, n) => {
        if (!flat(t, k, n)) return false;
        let cx = 0, cy = 0;
        for (let i = 0; i < n; i++) { if (!covered(t[k + 3 * i], t[k + 3 * i + 1], t[k + 2])) return false; cx += t[k + 3 * i] / n; cy += t[k + 3 * i + 1] / n; }
        return covered(cx, cy, t[k + 2]);
      };
      // деталь, що впирається верхом у плиту знизу, з плитою по обидва боки (стіна між плитами, ребра днища ангара), —
      // верх у товщу плити: плита відсунута в глибину (щоб шви на ній не миготіли), і під кутом крізь неї проступав
      // верхній край бічних граней такої стіни штрихами. Кінець, що виходить за край плити, і стіна по краю плити
      // (наполовину назовні) лишаються як є.
      const sink = (p, s, g) => {
        let top = -Infinity;
        for (const f of g.faces) for (let k = 2; k < f.tris.length; k += 3) top = Math.max(top, f.tris[k]);
        if (!Number.isFinite(top)) return;
        if (s.at === 'edge') {
          const { a, b } = P.edgeSeg(p.x, p.y, p.rot, s.len || 1);
          const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = (a.y - b.y) / L * 0.15, ny = (b.x - a.x) / L * 0.15;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (!covered(mx + nx, my + ny, top) || !covered(mx - nx, my - ny, top)) return;
        } else if (!covered(p.x, p.y, top)) return;
        const low = top - P.DIM.slab;
        const lower = (t) => { for (let k = 0; k < t.length; k += 3) if (Math.abs(t[k + 2] - top) < 1e-4 && covered(t[k], t[k + 1], top)) t[k + 2] = low; };
        for (const f of g.faces) lower(f.tris);
        lower(g.lines);
      };
      boxes = [];
      M.pieces.forEach((p, i) => {
        const s = P.SHAPES[p.shape];
        if (!s) return;
        const g = P.geom(p);
        if (s.at !== 'tile' && s.family !== 'shield') sink(p, s, g);
        const bx = new THREE.Box3();
        for (const f of g.faces) for (let k = 0; k < f.tris.length; k += 3) bx.expandByPoint(v3(f.tris[k], f.tris[k + 1], f.tris[k + 2]));
        bx.expandByScalar(0.01);
        boxes.push({ i, box: bx, opaque: s.family !== 'shield', lifted: false, top: 0 });
        const lifted = p.z > 0.01 && (s.family === 'slab' || (s.family === 'slope' && s.cat === 'roof') || (s.family === 'shield' && s.at === 'tile'));
        boxes[boxes.length - 1].lifted = lifted;
        boxes[boxes.length - 1].top = p.z + (s.family === 'slope' ? s.h : 0);
        layer = lifted ? 'slab:' + (p.z + (s.family === 'slope' ? s.h : 0)).toFixed(2) : 'base';
        if (lifted) roofTop.set(layer, p.z + (s.family === 'slope' ? s.h : 0));
        owner = i;
        for (const f of g.faces) {
          const m = MAT[f.mat] || mats.wall;
          const isFloor = m === mats.sq || m === mats.tri;
          const arr = isFloor && !lifted ? floorBucket(m) : bucket(m);
          const t = f.tris;
          for (let k = 0; k < t.length; k += 9) {
            if (s.family !== 'slab' && hidden(t, k, 3)) continue;
            tri(arr, v3(t[k], t[k + 1], t[k + 2]), v3(t[k + 3], t[k + 4], t[k + 5]), v3(t[k + 6], t[k + 7], t[k + 8]));
          }
        }
        const ln = g.lines, ea = s.family === 'shield' ? SS() : E();
        for (let k = 0; k < ln.length; k += 6) {
          if (s.family !== 'slab' && hidden(ln, k, 2)) continue;
          line(ea, v3(ln[k], ln[k + 1], ln[k + 2]), v3(ln[k + 3], ln[k + 4], ln[k + 5]));
        }
      });
      owner = -1;
      layer = 'base';
      M.items.forEach((it, i) => addItem(it, it.z !== undefined ? it.z : 0, STRUCTURAL.includes(it.kind) ? itemGroups.base : itemGroups.interior, i));
      for (const r of M.rooms) {
        if (!r.tiles.length) continue;
        labelPts.push({ id: r.id, name: r.short || r.name, z0: r.z0, h: r.h, minor: MINOR.test(r.id), covered: !!r.covered, at: r.label3d || M.labelPoint(r), p: new THREE.Vector3() });
      }
    }

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
        mesh.userData.owners = owners.get(arr) || null;
        g.add(mesh);
      }
      for (const [arr, mat] of [[lay.seams, seamMat], [lay.seamsShield, seamMatShield], [lay.edges, edgeMat]]) if (arr.length) g.add(mkLines(arr, mat));
      if (roofTop.has(key)) roofGroups.push({ g, top: roofTop.get(key) });
      if (floorZ.has(key)) floorGroups.push({ g, z: floorZ.get(key) });
      structure.add(g);
    }
    const floors = new THREE.Group();
    for (const [mat, arr] of floorBuckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.userData.owners = owners.get(arr) || null;
      floors.add(mesh);
    }
    floors.add(mkLines(floorSeams, seamMat));
    scene.add(structure, floors, itemGroups.base, itemGroups.interior);
    return { structure, floors, itemGroups, labelPts, hoverables, roofGroups, floorGroups };
    }
    let { structure, floors, itemGroups, labelPts, hoverables, roofGroups, floorGroups } = buildAll();

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
    function mountLabels() {
      labelLayer.textContent = '';
      for (const L of labelPts) {
        L.el = document.createElement('div');
        L.el.className = 'lbl3d';
        L.el.textContent = L.name;
        labelLayer.appendChild(L.el);
      }
    }
    mountLabels();
    const tip = document.createElement('div');
    tip.className = 'tip3d';
    tip.hidden = true;
    container.appendChild(tip);

    const state = { cut: 99, floor: -1, labels: true, running: false, w: 1, h: 1, interior: true, found: false, colors: true, lost: false };
    // цикл кадрів (див. frame нижче): запланований кадр, чи треба перемалювати, чи камера рухалась минулого кадру
    let raf = 0, dirty = true, wasMoving = false;
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
      invalidate(); // нове полотно порожнє
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
    // force — камера зупинилась: перевірити зараз, а не на восьмому кадрі
    function updateOcclusion(force) {
      if (occTick++ % 8 !== 0 && !force) return;
      const solids = M.format === 2 ? null : visibleMeshes(structure).filter((o) => !o.material.transparent);
      for (const L of labelPts) {
        if (!labelVisible(L)) continue;
        labelAnchor(L);
        const d = L.p.clone().sub(camera.position);
        const dist = d.length();
        occRay.set(camera.position, d.normalize());
        occRay.far = dist - 0.6;
        if (!solids) { L.hiddenByWall = !!rayPieces(occRay.ray, dist - 0.6, true, true); continue; }
        const hits = occRay.intersectObjects(solids, false).filter((hh) => hh.point.y < state.cut * LH && hh.point.y > state.floor * LH);
        L.hiddenByWall = hits.length > 0;
      }
    }
    function placeLabels(force) {
      if (!state.labels || state.found) return;
      updateOcclusion(force);
      const shown = [];
      for (const L of labelPts) {
        labelAnchor(L);
        tmp.copy(L.p).project(camera);
        const on = labelVisible(L) && !L.hiddenByWall && tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05;
        if (!on) { L.el.hidden = true; continue; }
        const x = ((tmp.x + 1) / 2) * state.w, y = ((1 - tmp.y) / 2) * state.h;
        if (L.el.hidden) L.el.hidden = false;
        // ширину підпису міряємо раз (текст не змінюється), а не щокадру — інакше кожен кадр перераховує розкладку
        if (!L.w) L.w = L.el.offsetWidth;
        const w = L.w || 90, h = 22;
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
      wake();
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

    // Кадр — лише коли щось змінилось (dirty) чи камера ще рухається (тягнуть, гасне інерція); у спокої — нічого.
    // Поки рухається — кадр за кадром, без обмеження частоти.
    const RAF = (f) => (root.requestAnimationFrame ? root.requestAnimationFrame(f) : 0);
    function frame() {
      raf = -1; // поки кадр іде, invalidate() нового не планує — вирішуємо в кінці
      if (!state.running || state.lost) { raf = 0; return; }
      const flying = stepNav();
      const moving = controls.update() === true || flying;
      if (moving || dirty) {
        dirty = false;
        renderer.render(scene, camera);
        placeLabels(!moving);
      } else if (wasMoving) placeLabels(true); // камера зупинилась — які підписи за стінами, перевіряємо востаннє
      wasMoving = moving;
      hover();
      raf = moving || dirty ? RAF(frame) : 0;
    }
    /** щось змінилось — намалювати наступним кадром */
    function invalidate() {
      dirty = true;
      wake();
    }
    /** кадр без перемальовки (підказка під курсором) */
    function wake() {
      if (state.running && !raf) raf = RAF(frame);
    }
    controls.addEventListener('change', invalidate);
    // браузер забрав контекст WebGL (забагато відкритих сцен, сон) — кажемо власнику; повернув — малюємо знову
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      state.lost = true;
      if (opts && opts.onContextLost) opts.onContextLost();
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => { state.lost = false; invalidate(); });
    function start() {
      if (state.running) return;
      state.running = true;
      resize();
      invalidate();
    }
    function stop() {
      state.running = false;
      if (raf > 0 && root.cancelAnimationFrame) root.cancelAnimationFrame(raf);
      raf = 0;
    }


    // ---------- рух камери ----------
    // Два режими (setNav): «orbit» — крутити навколо центру (як було), «fly» — від першої особи: тягни — погляд з місця
    // (центр обертання — за 0,05 перед камерою), коліщатко — крок уперед чи назад туди, куди курсор.
    // Від першої особи: WASD — уперед, назад, убік (по землі, куди дивиться камера), Q/E — нижче, вище, Shift — утричі
    // швидше (фізичні клавіші — працює й на кирилиці); навколо центру клавіші камеру не рухають. В обох: пробіл + тягни — зсув; коліщатко миші — до точки під курсором;
    // трекпад: два пальці — зсув, щипок — масштаб; подвійний клік — камера туди (не під час будування).
    // Лише в будівельнику (opts.freeLook): звичайний перегляд бази — тільки обертання навколо центру, як було.
    // var, а не let: setView (вище) читає його ще до цього рядка, на старті сцени
    var navFly = false; // eslint-disable-line no-var
    const nav = { mode: 'orbit', keys: new Set(), fast: false, hover: false, space: false, last: 0, trackpad: false, mouse: 'view', glide: null };
    const NAV_KEYS = { KeyW: [0, 1, 0], KeyS: [0, -1, 0], KeyA: [-1, 0, 0], KeyD: [1, 0, 0], KeyQ: [0, 0, -1], KeyE: [0, 0, 1] };
    const FLY_GAP = 0.05;
    const NAV_ON = !!(opts && opts.freeLook);
    const navNow = () => (root.performance ? root.performance.now() : Date.now());
    const typingIn = (e) => {
      const el = (e.composedPath && e.composedPath()[0]) || e.target;
      const host = e.target;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return true;
      return !!host && /^SN-(INPUT|TEXTAREA|SELECT|NUMBER-FIELD|COMBOBOX)/.test(host.tagName || '');
    };
    /** куди дивиться камера по землі (одиничний, у координатах three) і праворуч від нього */
    function groundAxes() {
      const d = new THREE.Vector3().subVectors(controls.target, camera.position);
      d.y = 0;
      if (d.lengthSq() < 1e-9) camera.getWorldDirection(d), (d.y = 0);
      d.normalize();
      return { fwd: d, right: new THREE.Vector3(-d.z, 0, d.x) };
    }
    /** зсунути камеру й центр разом (не нижче піску) */
    function shiftBy(v) {
      camera.position.add(v);
      controls.target.add(v);
      const lowCam = opts && opts.freeLook ? 0.25 : 1;
      if (camera.position.y < lowCam) { const dy = lowCam - camera.position.y; camera.position.y += dy; controls.target.y += dy; }
      if (nav.mode === 'orbit' && controls.target.y < 0) controls.target.y = 0;
    }
    /** крок руху за кадр: клавіші й плавний переліт; true — камера рухалась */
    function stepNav() {
      let moved = false;
      const t = navNow();
      if (nav.glide) {
        const g = nav.glide, k = Math.min(1, (t - g.t0) / 320), e = 1 - Math.pow(1 - k, 3);
        camera.position.lerpVectors(g.p0, g.p1, e);
        controls.target.lerpVectors(g.c0, g.c1, e);
        if (k >= 1) nav.glide = null;
        moved = true;
      }
      if (!nav.keys.size) { nav.last = 0; return moved; }
      const dt = nav.last ? Math.min(0.05, (t - nav.last) / 1000) : 1 / 60;
      nav.last = t;
      let mx = 0, my = 0, mz = 0;
      for (const k of nav.keys) { const m = NAV_KEYS[k]; mx += m[0]; my += m[1]; mz += m[2]; }
      if (!mx && !my && !mz) return moved;
      const dist = camera.position.distanceTo(controls.target);
      const speed = (nav.mode === 'fly' ? 7 : Math.min(60, Math.max(4, dist * 0.9))) * (nav.fast ? 3 : 1) * dt;
      const { fwd, right } = groundAxes();
      const v = new THREE.Vector3().addScaledVector(right, mx).addScaledVector(fwd, my);
      if (v.lengthSq() > 1) v.normalize();
      v.multiplyScalar(speed);
      v.y += mz * speed * 0.7;
      shiftBy(v);
      return true;
    }
    /** точка під курсором у координатах three: поверхня, а як нема — пісок */
    function pointUnder(cx, cy) {
      const h = pick(cx, cy);
      if (h) return v3(h.point.x, h.point.y, h.point.z);
      const q = planeAt(cx, cy, 0);
      return q ? v3(q.x, q.y, 0) : null;
    }
    /** масштаб до точки під курсором: k < 1 — ближче */
    function zoomAt(cx, cy, k) {
      const P = pointUnder(cx, cy);
      if (!P) return;
      if (nav.mode === 'fly') {
        // від першої особи — крок уперед чи назад у бік курсора, не ближче за пів блоку до поверхні
        const dir = new THREE.Vector3().subVectors(P, camera.position);
        const len = dir.length();
        if (len < 1e-6) return;
        dir.normalize();
        let step = (1 - k) * Math.max(4, len * 0.6);
        if (step > 0) step = Math.min(step, Math.max(0, len - 0.5));
        shiftBy(dir.multiplyScalar(step));
      } else {
        const dist = camera.position.distanceTo(controls.target);
        const nd = Math.min(controls.maxDistance, Math.max(controls.minDistance, dist * k));
        const s = nd / (dist || 1);
        camera.position.sub(P).multiplyScalar(s).add(P);
        controls.target.sub(P).multiplyScalar(s).add(P);
      }
      controls.update();
      invalidate();
    }
    /** зсув у площині землі на dx, dy пікселів (трекпад) */
    function panPixels(dx, dy) {
      const dist = Math.max(2, camera.position.distanceTo(nav.mode === 'fly' ? (pointUnder(state.w / 2 + renderer.domElement.getBoundingClientRect().left, state.h / 2 + renderer.domElement.getBoundingClientRect().top) || controls.target) : controls.target));
      const px = (2 * Math.tan((camera.fov * Math.PI) / 360) * dist) / Math.max(1, state.h);
      const { fwd, right } = groundAxes();
      shiftBy(new THREE.Vector3().addScaledVector(right, dx * px).addScaledVector(fwd, -dy * px));
      invalidate();
    }
    /** кнопки миші: режим власника (build/view) і пробіл (ліва — зсув) */
    function applyButtons() {
      const MO = THREE.MOUSE;
      const b = nav.mouse === 'build' ? { LEFT: -1, MIDDLE: MO.PAN, RIGHT: MO.ROTATE } : { LEFT: MO.ROTATE, MIDDLE: nav.mode === 'fly' ? MO.PAN : MO.DOLLY, RIGHT: MO.PAN };
      if (nav.space) b.LEFT = MO.PAN;
      controls.mouseButtons = b;
      renderer.domElement.style.cursor = nav.space ? 'grab' : '';
    }
    /** режим камери: «orbit» — навколо центру, «fly» — від першої особи */
    function setNav(mode) {
      const next = NAV_ON && mode === 'fly' ? 'fly' : 'orbit';
      if (next === nav.mode) return;
      nav.mode = next;
      navFly = next === 'fly';
      nav.glide = null;
      nav.keys.clear(); // натиснуте в іншому режимі не має їхати далі
      const dir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
      if (next === 'fly') {
        controls.minDistance = 0;
        controls.enableZoom = false;
        controls.rotateSpeed = 0.6; // мишу праворуч — погляд праворуч, як у грі
        controls.minPolarAngle = Math.PI * 0.03;
        controls.maxPolarAngle = Math.PI * 0.97; // і вгору, і вниз
        controls.target.copy(camera.position).addScaledVector(dir, FLY_GAP);
      } else {
        controls.minDistance = opts && opts.freeLook ? 1.5 : 5;
        controls.enableZoom = true;
        controls.rotateSpeed = 1;
        controls.minPolarAngle = 0;
        controls.maxPolarAngle = Math.PI * (opts && opts.freeLook ? 0.97 : 0.495);
        // назад до обертання навколо центру — у стартове положення (центр бази), а не там, де стоїш: інакше
        // центр обертання опиняється збоку і крутить дивно
        setView('quarter');
      }
      controls.screenSpacePanning = next === 'fly';
      applyButtons();
      controls.update();
      invalidate();
    }
    const cvs = renderer.domElement;
    // від першої особи центр обертання — за 0,05 перед камерою, а OrbitControls зсувають пропорційно до відстані до
    // нього: на початку кожного жесту — швидкість зсуву як для того, що в середині кадру
    controls.addEventListener('start', () => {
      if (nav.mode !== 'fly') { controls.panSpeed = 1; return; }
      const r = cvs.getBoundingClientRect();
      const P = r.width ? pointUnder(r.left + r.width / 2, r.top + r.height / 2) : null;
      const d = P ? Math.min(80, Math.max(3, P.distanceTo(camera.position))) : 15;
      controls.panSpeed = d / FLY_GAP;
    });
    if (NAV_ON) {
      cvs.addEventListener('pointerenter', () => { nav.hover = true; });
      cvs.addEventListener('pointerleave', () => { nav.hover = false; });
    }
    // коліщатко — раніше за OrbitControls (вони слухають саме полотно): ловимо на контейнері в фазі захоплення
    const onWheel = (e) => {
      if (e.target !== cvs) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.ctrlKey && !e.shiftKey && e.deltaMode === 0 && e.deltaX !== 0) nav.trackpad = true;
      else if (!e.ctrlKey && e.deltaX === 0 && Math.abs(e.deltaY) >= 100 && Number.isInteger(e.deltaY)) nav.trackpad = false;
      if (nav.trackpad && !e.ctrlKey) return panPixels(e.deltaX, e.deltaY);
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      zoomAt(e.clientX, e.clientY, Math.exp(Math.max(-3, Math.min(3, dy * (e.ctrlKey ? 0.01 : 0.0015)))));
    };
    if (NAV_ON) container.addEventListener('wheel', onWheel, { capture: true, passive: false });
    const onKeyDown = (e) => {
      if (!state.running || e.metaKey || e.ctrlKey || e.altKey || typingIn(e)) return;
      nav.fast = e.shiftKey;
      if (e.code === 'Space') {
        if (!nav.hover && !nav.space) return;
        e.preventDefault();
        if (!nav.space) { nav.space = true; applyButtons(); }
        return;
      }
      // ходити клавішами (WASD, Q/E) — лише від першої особи; навколо центру клавіші камеру не рухають
      if (!NAV_KEYS[e.code] || nav.mode !== 'fly' || (!nav.hover && !nav.keys.size)) return;
      e.preventDefault();
      if (!nav.keys.has(e.code)) { nav.keys.add(e.code); wake(); }
    };
    const onKeyUp = (e) => {
      nav.fast = e.shiftKey;
      if (e.code === 'Space' && nav.space) { nav.space = false; applyButtons(); }
      nav.keys.delete(e.code);
    };
    const onBlur = () => { nav.keys.clear(); if (nav.space) { nav.space = false; applyButtons(); } };
    if (NAV_ON && root.addEventListener) {
      root.addEventListener('keydown', onKeyDown);
      root.addEventListener('keyup', onKeyUp);
      root.addEventListener('blur', onBlur);
    }
    // подвійний клік — плавно туди (будування — ні: там клік ставить деталь)
    cvs.addEventListener('dblclick', (e) => {
      if (!NAV_ON || nav.mouse === 'build' || !state.running) return;
      const P = pointUnder(e.clientX, e.clientY);
      if (!P) return;
      const p0 = camera.position.clone(), c0 = controls.target.clone();
      let p1, c1;
      if (nav.mode === 'fly') {
        const dir = new THREE.Vector3().subVectors(P, p0);
        const len = dir.length();
        dir.normalize();
        p1 = p0.clone().addScaledVector(dir, Math.max(0, len - 3));
        c1 = p1.clone().add(new THREE.Vector3().subVectors(c0, p0));
      } else {
        c1 = P.clone();
        p1 = p0.clone().add(new THREE.Vector3().subVectors(P, c0));
      }
      if (p1.y < 0.25) p1.y = 0.25;
      nav.glide = { p0, p1, c0, c1, t0: navNow() };
      invalidate();
    });
    /** пробіл затиснуто — ліва кнопка зсуває камеру (будівельник тоді не ставить і не вибирає) */
    const navBusy = () => nav.space;

    // довільна камера (для знімків): pos і target у координатах three
    function setCamera(pos, target) {
      camera.position.set(...pos);
      controls.target.set(...target);
      controls.update();
    }
    // поточна камера — щоб нова сцена (редактор перебудовує її після правок) стала там само
    function getCamera() {
      return { pos: camera.position.toArray(), target: controls.target.toArray() };
    }
    // прибрати сцену цілком: геометрія, матеріали, контекст WebGL, підписи — інакше після кількох перебудов
    // браузер вичерпає контексти
    function dispose() {
      stop();
      ro.disconnect();
      container.removeEventListener('wheel', onWheel, { capture: true });
      if (root.removeEventListener) { root.removeEventListener('keydown', onKeyDown); root.removeEventListener('keyup', onKeyUp); root.removeEventListener('blur', onBlur); }
      controls.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else if (m) m.dispose();
      });
      for (const m of Object.values(mats)) m.dispose();
      for (const m of Object.values(toneMats)) m.dispose();
      seamMat.dispose(); seamMatShield.dispose(); edgeMat.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      labelLayer.remove();
      tip.remove();
    }

    // позначка вибраного в редакторі (блок стіни, приміщення й плитка, станція) — бірюзою поверх усього, щоб було
    // видно, що саме вибрано, навіть під дахом. m: { walls: [{a,b,z0,z1}], tiles: [{p,z,strong}], boxes: [{p,z0,z1}], guides: [{a,b,z,kind}] }
    const markGroup = new THREE.Group();
    scene.add(markGroup);
    function setMark(m) {
      for (const o of [...markGroup.children]) { markGroup.remove(o); o.geometry.dispose(); o.material.dispose(); }
      if (!m) return;
      const tris = [], soft = [], lines = [];
      const poly = (q, out) => { for (let i = 1; i < q.length - 1; i++) out.push(q[0], q[i], q[i + 1]); };
      const loop = (q) => { for (let i = 0; i < q.length; i++) lines.push(q[i], q[(i + 1) % q.length]); };
      for (const w of m.walls || []) {
        const q = [v3(w.a.x, w.a.y, w.z0), v3(w.b.x, w.b.y, w.z0), v3(w.b.x, w.b.y, w.z1), v3(w.a.x, w.a.y, w.z1)];
        poly(q, tris); loop(q);
      }
      for (const t of m.tiles || []) {
        const q = t.p.map((p) => v3(p.x, p.y, t.z));
        poly(q, t.strong ? tris : soft);
        if (t.strong) loop(q);
      }
      for (const b of m.boxes || []) {
        const lo = b.p.map((p) => v3(p.x, p.y, b.z0)), hi = b.p.map((p) => v3(p.x, p.y, b.z1));
        poly(lo, tris); poly(hi, tris); loop(lo); loop(hi);
        for (let i = 0; i < lo.length; i++) { const j = (i + 1) % lo.length; poly([lo[i], lo[j], hi[j], hi[i]], soft); lines.push(lo[i], hi[i]); }
      }
      const add = (pts, opacity) => {
        if (!pts.length) return;
        const me = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(pts), new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
        me.renderOrder = 20;
        markGroup.add(me);
      };
      add(soft, 0.22);
      add(tris, 0.45);
      if (lines.length) {
        const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), new THREE.LineBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.95, depthTest: false }));
        ls.renderOrder = 21;
        markGroup.add(ls);
      }
      // напрямні вирівнювання (станції): малинові смужки на підлозі (лінії WebGL — завжди в 1 px і губляться на піску) —
      // суцільна «в лінію», штрихова — відступ від краю й рівний крок, з рисками на кінцях; поверх усього
      const rib = [];
      const strip = (a, b, z, w) => {
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
        if (L < 1e-6) return;
        const nx = (-dy / L) * w / 2, ny = (dx / L) * w / 2;
        poly([v3(a.x - nx, a.y - ny, z), v3(b.x - nx, b.y - ny, z), v3(b.x + nx, b.y + ny, z), v3(a.x + nx, a.y + ny, z)], rib);
      };
      for (const g of m.guides || []) {
        const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y, L = Math.hypot(dx, dy);
        if (L < 1e-6) continue;
        const ux = dx / L, uy = dy / L;
        if (g.kind === 'line') strip(g.a, g.b, g.z, 0.035);
        else {
          for (let t = 0; t < L; t += 0.22) strip({ x: g.a.x + ux * t, y: g.a.y + uy * t }, { x: g.a.x + ux * Math.min(L, t + 0.14), y: g.a.y + uy * Math.min(L, t + 0.14) }, g.z, 0.05);
          for (const q of [g.a, g.b]) strip({ x: q.x + uy * 0.16, y: q.y - ux * 0.16 }, { x: q.x - uy * 0.16, y: q.y + ux * 0.16 }, g.z, 0.05);
        }
      }
      if (rib.length) {
        const me = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(rib), new THREE.MeshBasicMaterial({ color: 0xe11d74, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
        me.renderOrder = 22;
        markGroup.add(me);
      }
    }

    // ---------- будівельник: перебудова, вибір під курсором, примара, підсвітка ----------
    const own = (m) => Object.values(mats).includes(m) || [...stationMats.values()].includes(m) || Object.values(toneMats).includes(m) || m === seamMat || m === seamMatShield || m === edgeMat;
    /** нова модель (після правки) — та сама сцена, камера, зріз; будова й станції — наново */
    function update(M2) {
      M = M2;
      for (const g of [structure, floors, itemGroups.base, itemGroups.interior]) {
        scene.remove(g);
        g.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material && !own(o.material)) o.material.dispose();
        });
      }
      ({ structure, floors, itemGroups, labelPts, hoverables, roofGroups, floorGroups } = buildAll());
      mountLabels();
      setCut(state.cut, state.floor);
      setInterior(state.interior);
      setFoundation(state.found);
    }

    /**
     * промінь по деталях: рамки → кандидати за відстанню → точні трикутники (PIECES.geom); враховує зріз (деталі над
     * ним сховані, плити вище — цілком) і far; opaqueOnly — без прозорих (щит)
     */
    const triA = new THREE.Vector3(), triB = new THREE.Vector3(), triC = new THREE.Vector3(), hitP = new THREE.Vector3(), boxHit = new THREE.Vector3();
    function rayPieces(ray, far = Infinity, opaqueOnly = false, firstAny = false) {
      const cutY = (state.cut - CUT_EPS) * LH;
      const cand = [];
      for (const b of boxes) {
        if (opaqueOnly && !b.opaque) continue;
        if (b.lifted && state.cut < 98 && b.top > state.cut - CUT_EPS) continue; // плита над зрізом — схована цілком
        if (b.box.min.y > cutY) continue;
        const at = ray.intersectBox(b.box, boxHit);
        if (!at) continue;
        const d = at.distanceTo(ray.origin);
        if (d < far) cand.push({ b, d });
      }
      cand.sort((u, w) => u.d - w.d);
      let best = null;
      for (const { b, d } of cand) {
        if (best && d > best.dist) break;
        const g = root.PIECES.geom(M.pieces[b.i]);
        for (const f of g.faces) {
          const t = f.tris;
          for (let k = 0; k < t.length; k += 9) {
            triA.copy(v3(t[k], t[k + 1], t[k + 2])); triB.copy(v3(t[k + 3], t[k + 4], t[k + 5])); triC.copy(v3(t[k + 6], t[k + 7], t[k + 8]));
            const q = ray.intersectTriangle(triA, triB, triC, false, hitP);
            if (!q || q.y > cutY + 1e-4) continue;
            const dist = q.distanceTo(ray.origin);
            if (dist >= far || (best && dist >= best.dist)) continue;
            const n = new THREE.Vector3().subVectors(triC, triB).cross(new THREE.Vector3().subVectors(triA, triB)).normalize();
            best = { i: b.i, dist, point: q.clone(), normal: n };
            if (firstAny) return best;
          }
        }
      }
      return best;
    }
    const pickRay = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const toPlan = (v) => ({ x: v.x, y: -v.z, z: v.y / LH });
    /** що під курсором: деталь (id), станція (індекс у M.items) чи земля; точка й нормаль — у координатах плану; зріз враховано */
    function pick(cx, cy) {
      const rect = renderer.domElement.getBoundingClientRect();
      pickRay.setFromCamera({ x: ((cx - rect.left) / rect.width) * 2 - 1, y: -((cy - rect.top) / rect.height) * 2 + 1 }, camera);
      const cut = (state.cut - CUT_EPS) * LH, low = state.floor * LH - 0.01;
      const targets = M.format === 2 ? [...visibleMeshes(itemGroups.base), ...visibleMeshes(itemGroups.interior)] : [...visibleMeshes(structure), ...visibleMeshes(floors), ...visibleMeshes(itemGroups.base), ...visibleMeshes(itemGroups.interior)];
      const hits = pickRay.intersectObjects(targets, false).filter((h) => h.point.y <= cut + 1e-4 && h.point.y > low);
      if (M.format === 2) {
        const hp = rayPieces(pickRay.ray);
        if (hp && (!hits[0] || hp.dist < hits[0].distance)) {
          const n = hp.normal;
          if (n.dot(pickRay.ray.direction) > 0) n.negate();
          const gd = new THREE.Vector3();
          const og = pickRay.ray.intersectPlane(groundPlane, gd);
          if (!og || hp.dist <= pickRay.ray.origin.distanceTo(gd) + 1e-3)
            return { piece: M.pieces[hp.i].id, item: null, ground: false, point: toPlan(hp.point), normal: { x: n.x, y: -n.z, z: n.y } };
        }
      }
      const g = new THREE.Vector3();
      const onGround = pickRay.ray.intersectPlane(groundPlane, g);
      const h = hits[0];
      if (h && (!onGround || h.distance <= pickRay.ray.origin.distanceTo(g) + 1e-3)) {
        const ow = h.object.userData.owners;
        const pi = ow && h.faceIndex != null ? ow[h.faceIndex] : -1;
        const n = h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0);
        if (n.dot(pickRay.ray.direction) > 0) n.negate(); // двобічні грані — нормаль до камери
        const item = h.object.userData.item;
        return { piece: pi >= 0 && M.pieces && M.pieces[pi] ? M.pieces[pi].id : null, item: item !== undefined ? item : null, ground: false, point: toPlan(h.point), normal: { x: n.x, y: -n.z, z: n.y } };
      }
      if (onGround) return { piece: null, item: null, ground: true, point: toPlan(g), normal: { x: 0, y: 0, z: 1 } };
      return null;
    }

    const clearGroup = (grp) => { for (const o of [...grp.children]) { grp.remove(o); o.geometry.dispose(); o.material.dispose(); } };
    /** трикутники й лінії деталей (у координатах three) */
    function pieceMesh(ps) {
      const tris = [], lines = [];
      for (const p of ps) {
        const g = root.PIECES.geom(p);
        for (const f of g.faces) for (let k = 0; k < f.tris.length; k += 3) tris.push(v3(f.tris[k], f.tris[k + 1], f.tris[k + 2]));
        for (let k = 0; k < g.lines.length; k += 3) lines.push(v3(g.lines[k], g.lines[k + 1], g.lines[k + 2]));
      }
      return { tris, lines };
    }
    const overlay = (grp, pts, color, opacity, depthTest, order) => {
      if (!pts.length) return;
      const me = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(pts), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthTest, depthWrite: false }));
      me.renderOrder = order;
      grp.add(me);
    };
    const overlayLines = (grp, pts, color, depthTest, order) => {
      if (!pts.length) return;
      const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest }));
      ls.renderOrder = order;
      grp.add(ls);
    };
    const ghostGroup = new THREE.Group();
    scene.add(ghostGroup);
    /** примара деталей під курсором: зелена — можна поставити, червона — ні */
    function setGhost(ps, ok = true) {
      clearGroup(ghostGroup);
      if (!ps || !ps.length) return;
      const { tris, lines } = pieceMesh(ps);
      overlay(ghostGroup, tris, ok ? 0x4ade80 : 0xef4444, 0.5, true, 12);
      overlayLines(ghostGroup, lines, ok ? 0x16a34a : 0xb91c1c, true, 13);
    }
    const tintGroup = new THREE.Group();
    scene.add(tintGroup);
    /** забарвлення деталей групами (стабільність): [{ ids, color, alpha }]; null — прибрати */
    function setTint(groups) {
      clearGroup(tintGroup);
      if (!groups) return;
      const byId = new Map((M.pieces || []).map((p) => [p.id, p]));
      groups.forEach((g, i) => {
        const { tris } = pieceMesh(g.ids.map((id) => byId.get(id)).filter(Boolean));
        overlay(tintGroup, tris, g.color, g.alpha, true, 10 + i * 0.01);
      });
    }
    const hlGroup = new THREE.Group();
    scene.add(hlGroup);
    /** підсвітка: наведене (помаранчеве) і вибране (бірюзове, видно крізь стіни); плитки зони */
    function setHighlight(o) {
      clearGroup(hlGroup);
      if (!o) return;
      const byId = new Map((M.pieces || []).map((p) => [p.id, p]));
      const of = (ids) => (ids || []).map((id) => byId.get(id)).filter(Boolean);
      const hov = pieceMesh(of(o.hover)), sel = pieceMesh(of(o.sel));
      overlay(hlGroup, hov.tris, 0xf0963a, 0.35, true, 14);
      overlayLines(hlGroup, hov.lines, 0xf0963a, true, 15);
      overlay(hlGroup, sel.tris, 0x2dd4bf, 0.42, false, 16);
      overlayLines(hlGroup, sel.lines, 0x5eead4, false, 17);
      const tp = [];
      for (const t of o.tiles || []) { const q = t.p.map((p) => v3(p.x, p.y, t.z + 0.02)); for (let i = 1; i < q.length - 1; i++) tp.push(q[0], q[i], q[i + 1]); }
      overlay(hlGroup, tp, 0x2dd4bf, 0.3, false, 16);
    }

    /** будівельник: точка плану під курсором на горизонтальній площині висоти z (перетягування вибраного) */
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    function planeAt(cx, cy, z) {
      const rect = renderer.domElement.getBoundingClientRect();
      pickRay.setFromCamera({ x: ((cx - rect.left) / rect.width) * 2 - 1, y: -((cy - rect.top) / rect.height) * 2 + 1 }, camera);
      dragPlane.constant = -z * LH;
      const g = new THREE.Vector3();
      return pickRay.ray.intersectPlane(dragPlane, g) ? toPlan(g) : null;
    }
    /**
     * напрямки екрана на землі (у координатах плану, одиничні): right — праворуч, forward — «від себе» (угору екрана);
     * forward — з осі «вгору» й погляду камери разом, тож і згори, і збоку він визначений
     */
    function screenAxes() {
      camera.updateMatrixWorld();
      const e = camera.matrixWorld.elements;
      const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
      return { right: unit(e[0], -e[2]), forward: unit(e[4] - e[8], -(e[6] - e[10])) };
    }

    /** кнопки миші для камери: build — ліва зайнята будуванням (камера — права й середня), view — як завжди */
    function setMouse(mode) {
      nav.mouse = mode === 'build' ? 'build' : 'view';
      applyButtons();
    }

    // усе, що змінює картинку, — з перемальовкою наступним кадром
    const redraw = (fn) => (...a) => { const r = fn(...a); invalidate(); return r; };
    return {
      start, stop, dispose, pick, planeAt, screenAxes, setMouse, getCamera, invalidate, navBusy, setNav: redraw(setNav), getNav: () => nav.mode,
      setCut: redraw(setCut), setInterior: redraw(setInterior), setFoundation: redraw(setFoundation), setTileColors: redraw(setTileColors),
      setLabels: redraw(setLabels), setView: redraw(setView), setCamera: redraw(setCamera), setMark: redraw(setMark), update: redraw(update),
      setGhost: redraw(setGhost), setHighlight: redraw(setHighlight), setTint: redraw(setTint),
      canvas: renderer.domElement, LH, debug: { scene, camera, get structure() { return structure; }, get floors() { return floors; }, get roofGroups() { return roofGroups; } },
    };
  }

  root.VIEW3D = { create, ITEM_COLORS };
})(typeof window !== 'undefined' ? window : globalThis);

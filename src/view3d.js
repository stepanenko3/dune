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
    windtrap: 0xcfd6dc, furniture: 0x6b5b4b, pad: 0xf2f2f2, gate: 0x2dd4bf, light: 0xfff6d8, hatch: 0x30333a,
  };
  const MINOR = /^(apron|backApron|walkway|gallery|lantern|towerBalcony|pyr)/;

  function create(container, opts = {}) {
    const THREE = root.THREE;
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

    const VIEWS = {
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
    sun.target.position.set(0, 0, -15);
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

    const mats = {
      sq: std(0x2f6fd0, { roughness: 0.9, metalness: 0 }),
      tri: std(0xe0812a, { roughness: 0.9, metalness: 0 }),
      wall: std(0x585c64, { metalness: 0.3 }),
      wallLight: std(0x80848b, { metalness: 0.2 }),
      roof: std(0x3a3d43, { metalness: 0.3 }),
      frame: std(0x2a2c31, { metalness: 0.45, roughness: 0.55 }),
      glass: std(0xa9d4f0, { transparent: true, opacity: 0.22, roughness: 0.08, metalness: 0.1, depthWrite: false }),
      shield: std(0x2dd4bf, { transparent: true, opacity: 0.24, emissive: 0x0d6b60, emissiveIntensity: 0.6, depthWrite: false, roughness: 0.2 }),
      ground: new THREE.MeshStandardMaterial({ color: 0xa07d55, roughness: 1, metalness: 0 }),
    };
    const seamMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, clippingPlanes: planes });
    const seamMatShield = new THREE.LineBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.8, clippingPlanes: planes });
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x15171b, transparent: true, opacity: 0.7, clippingPlanes: planes });

    // збирач геометрії
    const buckets = new Map();
    const bucket = (mat) => {
      if (!buckets.has(mat)) buckets.set(mat, []);
      return buckets.get(mat);
    };
    const tri = (arr, a, b, c) => arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const quad = (arr, a, b, c, d) => { tri(arr, a, b, c); tri(arr, a, c, d); };
    const seams = [], seamsShield = [], edges = [];
    const line = (arr, a, b) => arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const tileMat = (t) => (t.k === 's' ? mats.sq : mats.tri);

    function floorTiles(tiles, zOf, matFor, seamArr = seams, lift = 0.004) {
      for (const t of tiles) {
        const p = t.p.map((q) => v3(q.x, q.y, zOf(q)));
        const arr = bucket(matFor(t));
        for (let i = 1; i < p.length - 1; i++) tri(arr, p[0], p[i], p[i + 1]);
        const s = t.p.map((q) => v3(q.x, q.y, zOf(q) + lift));
        for (let i = 0; i < s.length; i++) line(seamArr, s[i], s[(i + 1) % s.length]);
      }
    }
    const flat = (z) => () => z;
    function slabSides(tiles, z, thick, mat) {
      for (const e of M.boundaryEdges(tiles)) {
        const a = v3(e.a.x, e.a.y, z), b = v3(e.b.x, e.b.y, z);
        const a2 = a.clone(), b2 = b.clone();
        a2.y -= thick; b2.y -= thick;
        quad(bucket(mat), a2, b2, b, a);
      }
    }
    const seenPanes = new Set();
    function wallQuad(a, b, lo, hi, mat) {
      if (mat.transparent) {
        // спільна скляна стіна двох приміщень малюється один раз
        const k = M.edgeKey(a, b) + '@' + lo.toFixed(2) + '-' + hi.toFixed(2);
        if (seenPanes.has(k)) return;
        seenPanes.add(k);
      }
      quad(bucket(mat), v3(a.x, a.y, lo), v3(b.x, b.y, lo), v3(b.x, b.y, hi), v3(a.x, a.y, hi));
    }

    // проміжки стіни по висоті з урахуванням прорізів
    function wallParts(room, e, lo0, hi0) {
      const z0 = lo0, z1 = hi0;
      const holes = e.open.map((o) => {
        const a = o.z0 !== undefined ? o.z0 : room.z0;
        const b = o.z1 !== undefined ? o.z1 : o.type === 'door' ? room.z0 + DOOR : top(room);
        const lo = o.type === 'balcony' ? room.z0 + PARAPET : a;
        return { a: Math.max(lo, z0), b: Math.min(b, z1), type: o.type === 'balcony' ? 'open' : o.type };
      }).filter((h) => h.b > h.a);
      const cuts = [...new Set([z0, z1, ...holes.flatMap((h) => [h.a, h.b])])].filter((z) => z >= z0 && z <= z1).sort((a, b) => a - b);
      const parts = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const lo = cuts[i], hi = cuts[i + 1];
        if (hi - lo < 1e-6) continue;
        const over = holes.filter((h) => h.a <= lo + 1e-6 && h.b >= hi - 1e-6).map((h) => h.type);
        if (over.includes('open') || over.includes('door')) continue;
        parts.push({ lo, hi, kind: over.includes('shield') ? 'shield' : over.includes('glass') ? 'glass' : 'solid' });
      }
      return parts;
    }
    function renderWall(room, e, lo, hi) {
      for (const part of wallParts(room, e, lo, hi)) {
        wallQuad(e.a, e.b, part.lo, part.hi, part.kind === 'solid' ? mats.wall : mats[part.kind]);
        if (part.kind === 'solid') line(edges, v3(e.a.x, e.a.y, part.hi), v3(e.b.x, e.b.y, part.hi));
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
        floorTiles([t], (q) => z1 - frac(q) * p.hi, () => mats.wallLight, edges, -0.004);
      }
      // трикутні щічки пандуса біля рівних заїздів
      for (const [ya, yb] of p.flat || [])
        for (const y of [ya, yb])
          for (const [xe, xi] of [[p.x0, p.x0 + p.ch], [p.x1, p.x1 - p.ch]]) {
            const arr = bucket(mats.wallLight);
            tri(arr, v3(xi, y, z0), v3(xe, y, z0), v3(xe, y, z0 + p.lo));
            line(edges, v3(xi, y, z0), v3(xe, y, z0 + p.lo));
          }
      if (r.roof === 'solid') {
        floorTiles(flatTiles, flat(z1), () => mats.roof, edges, 0.006);
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
      const yo = y - outward * 0.35;
      for (const yy of [y, yo])
        for (let i = 0; i < 8; i++) {
          const j = (i + 1) % 8;
          quad(bucket(mats.frame), v3(inner[i][0], yy, inner[i][1]), v3(inner[j][0], yy, inner[j][1]), v3(outer[j][0], yy, outer[j][1]), v3(outer[i][0], yy, outer[i][1]));
        }
      for (let i = 0; i < 8; i++) {
        const j = (i + 1) % 8;
        quad(bucket(mats.frame), v3(outer[i][0], y, outer[i][1]), v3(outer[j][0], y, outer[j][1]), v3(outer[j][0], yo, outer[j][1]), v3(outer[i][0], yo, outer[i][1]));
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
      const cx = opt.c || 1.2, cz = opt.c || 1.2, g = 0.42;
      const P = (s, z, off = 0) => v3(a.x + u.x * s + n.x * off, a.y + u.y * s + n.y * off, z);
      const inner = [[0, z0], [0, z1 - cz], [cx, z1], [L - cx, z1], [L, z1 - cz], [L, z0]];
      const outer = [[-g, z0], [-g, z1 - cz + g * 0.4], [cx - g * 0.4, z1 + g], [L - cx + g * 0.4, z1 + g], [L + g, z1 - cz + g * 0.4], [L + g, z0]];
      const arr = bucket(mats.frame);
      // зрізані кути (якщо дах сам не скошений під рамку)
      if (opt.fill !== false) {
        tri(bucket(mats.wall), P(0, z1), P(cx, z1), P(0, z1 - cz));
        tri(bucket(mats.wall), P(L, z1), P(L, z1 - cz), P(L - cx, z1));
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
          line(edges, P(...ring[i], 0.45), P(...ring[j], 0.45));
        }
    }

    const labelPts = [];
    const itemGroups = { base: new THREE.Group(), terrace: new THREE.Group(), entrance: new THREE.Group() };
    const hoverables = [];

    function buildRoom(r) {
      const z0 = r.z0, z1 = top(r);
      const roomEdges = M.roomEdges(r);
      if (r.group === 'shield') {
        floorTiles(r.tiles, flat(z0), () => mats.shield, seamsShield, 0.01);
      } else if (r.profile) {
        buildProfile(r, roomEdges);
      } else if (r.group !== 'crown') {
        floorTiles(r.tiles, flat(z0), tileMat);
        // високі палуби (балкони веж, місток) — товща плита, щоб читалась знизу
        const thick = r.solidBase ? z0 * LH : r.h === 0 && z0 > M.heights.CAR ? 0.32 : 0.14;
        if (z0 > 0) slabSides(r.tiles, z0, thick, r.solidBase ? mats.wall : mats.roof);
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
          line(edges, v3(e.a.x, e.a.y, ha), v3(e.b.x, e.b.y, hb));
        }
      } else if (r.h > 0 && !r.profile) {
        for (const e of roomEdges) {
          const t = edgeTile.get(M.edgeKey(e.a, e.b));
          const hi = t && rimKeys.has(tileKey(t)) ? z1 - drop : z1;
          renderWall(r, e, z0, hi);
        }
      } else if (r.h === 0 && r.group !== 'shield') {
        for (const e of roomEdges) {
          if (e.open.some((o) => o.type === 'open')) continue;
          wallQuad(e.a, e.b, z0, z0 + PARAPET, mats.wallLight);
        }
      }

      // дахи: ядро на z1, обідок нижче на rimDrop, між ними уступ
      if (r.rim && drop) {
        const rimTiles = r.tiles.filter((t) => rimKeys.has(tileKey(t)));
        const core = r.tiles.filter((t) => !rimKeys.has(tileKey(t)));
        floorTiles(rimTiles, flat(z1 - drop - 0.02), () => mats.roof, edges, 0.006);
        const outer = new Set(M.boundaryEdges(r.tiles).map((e) => M.edgeKey(e.a, e.b)));
        if (r.roof === 'solid') {
          floorTiles(core, flat(z1 - 0.02), () => mats.roof, edges, 0.006);
          for (const e of M.boundaryEdges(core)) if (!outer.has(M.edgeKey(e.a, e.b))) wallQuad(e.a, e.b, z1 - drop - 0.02, z1 - 0.02, mats.wall);
        }
      } else if (r.roof === 'solid' && rs) {
        floorTiles(r.tiles, (q) => roofZ(q) - 0.02, () => mats.roof, edges, 0.006);
        for (const e of M.boundaryEdges(r.tiles)) {
          const ha = roofZ(e.a) - 0.02, hb = roofZ(e.b) - 0.02;
          quad(bucket(mats.frame), v3(e.a.x, e.a.y, ha - 0.2), v3(e.b.x, e.b.y, hb - 0.2), v3(e.b.x, e.b.y, hb), v3(e.a.x, e.a.y, ha));
        }
      } else if (r.roof === 'solid' && (r.skylight || r.crown)) {
        // ярусний дах ангара (скріни 1 і 3): нижній ярус, вищий ярус-підкова, пентащит-світлик
        const sky = new Set((r.skylight || []).map(tileKey));
        const crown = r.crown ? r.crown.tiles : [];
        const crownKeys = new Set(crown.map(tileKey));
        const ch = r.crown ? r.crown.h : 0;
        floorTiles(r.tiles.filter((t) => !sky.has(tileKey(t)) && !crownKeys.has(tileKey(t))), flat(z1 - 0.02), () => mats.roof, edges, 0.006);
        slabSides(r.tiles, z1 - 0.02, 0.3, mats.frame);
        floorTiles(r.tiles.filter((t) => sky.has(tileKey(t))), flat(z1 - 0.04), () => mats.shield, seamsShield, 0.006);
        if (crown.length) {
          floorTiles(crown, flat(z1 + ch), () => mats.roof, edges, 0.006);
          for (const e of M.boundaryEdges(crown)) {
            wallQuad(e.a, e.b, z1 - 0.02, z1 + ch, mats.wall);
            line(edges, v3(e.a.x, e.a.y, z1 + ch), v3(e.b.x, e.b.y, z1 + ch));
          }
          slabSides(crown, z1 + ch, 0.18, mats.frame);
        }
      } else if (r.roof === 'solid' && !r.profile) {
        floorTiles(r.tiles, flat(z1 - 0.02), () => mats.roof, edges, 0.006);
        slabSides(r.tiles, z1 - 0.02, 0.16, mats.roof);
      } else if (r.roof === 'shield') {
        floorTiles(r.tiles, flat(z1 - 0.02), () => mats.shield, seamsShield, 0.006);
      } else if (r.roof === 'pyramid') {
        const c = M.labelPoint(r);
        const apex = v3(c.x, c.y, z1 + 2.4);
        for (const e of roomEdges) tri(bucket(mats.roof), v3(e.a.x, e.a.y, z1), v3(e.b.x, e.b.y, z1), apex);
        for (const e of roomEdges) line(edges, v3(e.a.x, e.a.y, z1), apex);
      }

      for (const o of r.open || []) if (o.frame) mouth(r, o.a, o.b, z0, z1, o.frame === true ? {} : o.frame);

      const lp = M.labelPoint(r);
      labelPts.push({ id: r.id, name: r.name, z0, h: r.h, minor: MINOR.test(r.id), covered: !!r.covered, at: r.label3d || lp, p: new THREE.Vector3() });
      for (const it of r.items || []) addItem(it, z0, itemGroups.base);
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
          const n = Math.max(4, Math.round(it.h * 2.5));
          for (let i = 0; i < n; i++) box(it.w / n, ((i + 1) * h) / n, it.d, 0, mat, -it.w / 2 + (it.w / n) * (i + 0.5));
        }
      } else if (it.kind === 'turbine') {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, h, 10), mat);
        mast.position.y = h / 2;
        mast.castShadow = true;
        g.add(mast);
        box(0.4, 0.35, 0.9, h - 0.1);
        const bladeMat = std(0xf1f3f5);
        for (let k = 0; k < 3; k++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.95, 0.04), bladeMat);
          blade.geometry.translate(0, 0.47, 0);
          blade.position.set(0, h + 0.07, 0.48);
          blade.rotation.z = (k * 2 * Math.PI) / 3 + 0.3;
          blade.castShadow = true;
          g.add(blade);
        }
        box(1.8, 0.08, 1.8, 0, std(0x55595f));
      } else if (it.kind === 'windtrap') {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.82, h * 0.85, 16), mat);
        body.position.y = (h * 0.85) / 2;
        body.castShadow = true;
        g.add(body);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.7, h * 0.3, 16), std(0xa7b0b8));
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
        box(it.w * 0.55, 0.08, it.d, h * 0.45, std(0xd5dde6, { transparent: true, opacity: 0.8 }));
      } else {
        box(it.w, h, it.d, 0);
      }
      const nm = it.kind === 'stairs' ? `${it.name} (+${it.from} → +${it.to})` : it.full || it.name;
      g.traverse((o) => { if (o.isMesh) { o.userData.name = nm; hoverables.push(o); } });
      group.add(g);
    }

    for (const r of M.rooms) buildRoom(r);
    for (const it of M.roofItems) addItem(it, it.z, itemGroups.base);
    for (const key of ['terrace', 'entrance']) for (const it of M.variants[key].items) addItem(it, it.z, itemGroups[key]);

    const structure = new THREE.Group();
    for (const [mat, arr] of buckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !mat.transparent;
      mesh.receiveShadow = true;
      structure.add(mesh);
    }
    const mkLines = (arr, mat) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      return new THREE.LineSegments(geo, mat);
    };
    structure.add(mkLines(seams, seamMat), mkLines(seamsShield, seamMatShield), mkLines(edges, edgeMat));
    scene.add(structure, itemGroups.base, itemGroups.terrace, itemGroups.entrance);

    // земля, сітка і ділянки
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), mats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -15);
    ground.receiveShadow = true;
    scene.add(ground);
    const gridArr = [];
    for (let x = -12; x <= 12; x++) line(gridArr, v3(x, -3, 0), v3(x, 33, 0));
    for (let y = -3; y <= 33; y++) line(gridArr, v3(-12, y, 0), v3(12, y, 0));
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

    const state = { cut: 99, floor: -1, labels: true, running: false, variant: 'terrace', w: 1, h: 1 };
    function setVariant(k) {
      state.variant = k;
      itemGroups.terrace.visible = k === 'terrace';
      itemGroups.entrance.visible = k === 'entrance';
      const t = labelPts.find((l) => l.id === 'balcony');
      if (t) t.el.textContent = M.variants[k].label;
    }
    setVariant(opts.variant || 'terrace');
    // cut — верхня межа в рівнях; floor — нижня межа (-1 = показувати все нижче).
    function setCut(levels, floor = -1) {
      state.cut = levels;
      state.floor = floor;
      clipTop.constant = levels * LH;
      clipBottom.constant = -floor * LH;
    }
    function setTileColors(on) {
      mats.sq.color.set(on ? 0x2f6fd0 : 0x50545b);
      mats.tri.color.set(on ? 0xe0812a : 0x5a5650);
      seamMat.opacity = on ? 0.55 : 0.18;
    }
    function setLabels(on) {
      state.labels = on;
      labelLayer.hidden = !on;
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
      const solids = structure.children.filter((o) => o.isMesh && !o.material.transparent);
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
      if (!state.labels) return;
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

    return { start, stop, setCut, setVariant, setTileColors, setLabels, setView, LH };
  }

  root.VIEW3D = { create };
})(typeof window !== 'undefined' ? window : globalThis);

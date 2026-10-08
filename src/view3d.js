/*
 * 3D-перегляд бази (three.js r128 + OrbitControls).
 * План (x, y) і рівень z -> three (x, z * LH, -y): фронт бази дивиться на +Z.
 */
(function (root) {
  'use strict';
  const M = root.BASE;
  const LH = 0.85; // висота рівня відносно сторони плити (умовно)
  const DOOR = 2.5; // висота дверей у рівнях

  const ITEM_COLORS = {
    vehicle: 0xc9a46a, air: 0x9fb0c2, refine: 0xb5523b, water: 0x3f8fc9, storage: 0x8a8f5a,
    craft: 0x9b7fc4, power: 0xd6b13a, console: 0xe4572e, stairs: 0x7a7f88, turbine: 0xe3e7ec,
    windtrap: 0xcfd6dc, furniture: 0x6b5b4b, pad: 0xf2f2f2, gate: 0x2dd4bf, light: 0xfff6d8,
  };

  function create(container, opts = {}) {
    const THREE = root.THREE;
    const v3 = (x, y, z) => new THREE.Vector3(x, z * LH, -y);

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
    controls.minDistance = 6;
    controls.maxDistance = 140;

    const VIEWS = {
      quarter: { pos: [-29, 25, 23], target: [0, 2.4, -9.5] },
      front: { pos: [0, 9, 34], target: [0, 4, -8] },
      top: { pos: [0, 58, -9.9], target: [0, 0, -10] },
      back: { pos: [24, 22, -46], target: [0, 3, -10] },
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
    sun.position.set(-30, 45, 28);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 140 });
    sun.shadow.bias = -0.0008;
    sun.target.position.set(0, 0, -10);
    scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xc9d6ff, 0.32);
    fill.position.set(30, 22, -50);
    scene.add(fill);

    // зріз по висоті
    const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 99);
    const planes = [clip];
    const std = (color, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.18, side: THREE.DoubleSide, clippingPlanes: planes, clipShadows: true, ...extra });

    const mats = {
      sq: std(0x2f6fd0, { roughness: 0.9, metalness: 0 }),
      tri: std(0xe0812a, { roughness: 0.9, metalness: 0 }),
      floorDark: std(0x4a4d53, { roughness: 0.92, metalness: 0.1 }),
      wall: std(0x585c64, { metalness: 0.3 }),
      wallLight: std(0x80848b, { metalness: 0.2 }),
      roof: std(0x3a3d43, { metalness: 0.3 }),
      glass: std(0xa9d4f0, { transparent: true, opacity: 0.22, roughness: 0.08, metalness: 0.1, depthWrite: false }),
      shield: std(0x2dd4bf, { transparent: true, opacity: 0.26, emissive: 0x0d6b60, emissiveIntensity: 0.6, depthWrite: false, roughness: 0.2 }),
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

    function floor(tiles, z, matFor, seamArr = seams, lift = 0.004) {
      for (const t of tiles) {
        const p = t.p.map((q) => v3(q.x, q.y, z));
        const arr = bucket(matFor(t));
        for (let i = 1; i < p.length - 1; i++) tri(arr, p[0], p[i], p[i + 1]);
        const s = t.p.map((q) => v3(q.x, q.y, z + lift));
        for (let i = 0; i < s.length; i++) line(seamArr, s[i], s[(i + 1) % s.length]);
      }
    }
    function slabSides(room, z, thick, mat) {
      for (const e of M.boundaryEdges(room.tiles)) {
        const a = v3(e.a.x, e.a.y, z), b = v3(e.b.x, e.b.y, z);
        const a2 = a.clone(), b2 = b.clone();
        a2.y -= thick; b2.y -= thick;
        quad(bucket(mat), a2, b2, b, a);
      }
    }

    // проміжки стіни по висоті з урахуванням прорізів
    function wallParts(room, e) {
      const z0 = room.z0, z1 = room.z0 + room.h;
      const holes = e.open.map((o) => {
        const a = o.z0 !== undefined ? o.z0 : z0;
        const b = o.z1 !== undefined ? o.z1 : o.type === 'door' ? Math.min(z0 + DOOR, z1) : z1;
        return { a: Math.max(a, z0), b: Math.min(b, z1), type: o.type };
      });
      const cuts = [...new Set([z0, z1, ...holes.flatMap((h) => [h.a, h.b])])].filter((z) => z >= z0 && z <= z1).sort((a, b) => a - b);
      const parts = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const lo = cuts[i], hi = cuts[i + 1];
        if (hi - lo < 1e-6) continue;
        const over = holes.filter((h) => h.a <= lo + 1e-6 && h.b >= hi - 1e-6).map((h) => h.type);
        let kind = 'solid';
        if (over.includes('open') || over.includes('door')) continue;
        if (over.includes('shield')) kind = 'shield';
        else if (over.includes('glass')) kind = 'glass';
        parts.push({ lo, hi, kind });
      }
      return parts;
    }

    const labelPts = [];
    const itemGroups = { base: new THREE.Group(), terrace: new THREE.Group(), entrance: new THREE.Group() };
    const hoverables = [];

    function buildRoom(r) {
      const z0 = r.z0, z1 = r.z0 + r.h;
      const tileMat = (t) => (t.k === 's' ? mats.sq : mats.tri);
      if (r.group === 'shield') {
        floor(r.tiles, z0, () => mats.shield, seamsShield, 0.01);
      } else {
        floor(r.tiles, z0, tileMat);
        if (z0 > 0) slabSides(r, z0, 0.14, mats.roof);
      }
      if (r.slopes) {
        // похилі смуги заїзду (скрін 3): від рівної підлоги до стіни на висоту 1
        for (const s of [-1, 1]) {
          const xi = s * 1.5, xo = s * 2.5, arr = bucket(mats.wallLight);
          quad(arr, v3(xi, 0, 0.01), v3(xi, 10, 0.01), v3(xo, 10, 1), v3(xo, 0, 1));
          tri(arr, v3(xi, 0, 0.01), v3(xo, 0, 1), v3(xo, 0, 0.01));
          tri(arr, v3(xi, 10, 0.01), v3(xo, 10, 1), v3(xo, 10, 0.01));
        }
      }
      const roomEdges = M.roomEdges(r);
      if (r.h > 0) {
        for (const e of roomEdges)
          for (const part of wallParts(r, e)) {
            const mat = part.kind === 'solid' ? mats.wall : mats[part.kind];
            quad(bucket(mat), v3(e.a.x, e.a.y, part.lo), v3(e.b.x, e.b.y, part.lo), v3(e.b.x, e.b.y, part.hi), v3(e.a.x, e.a.y, part.hi));
            if (part.kind === 'solid') line(edges, v3(e.a.x, e.a.y, part.hi), v3(e.b.x, e.b.y, part.hi));
          }
      } else if (r.group === 'deck') {
        for (const e of roomEdges) {
          if (e.open.some((o) => o.type === 'open')) continue;
          const h = 0.42 / LH;
          quad(bucket(mats.wallLight), v3(e.a.x, e.a.y, z0), v3(e.b.x, e.b.y, z0), v3(e.b.x, e.b.y, z0 + h), v3(e.a.x, e.a.y, z0 + h));
        }
      }
      if (r.roof === 'solid') {
        floor(r.tiles, z1 - 0.02, () => mats.roof, edges, 0.006);
        slabSides(r, z1 - 0.02, 0.16, mats.roof);
      } else if (r.roof === 'pyramid') {
        const c = M.labelPoint(r);
        const apex = v3(c.x, c.y, z1 + 2.2);
        for (const e of roomEdges) tri(bucket(mats.roof), v3(e.a.x, e.a.y, z1), v3(e.b.x, e.b.y, z1), apex);
        for (const e of roomEdges) line(edges, v3(e.a.x, e.a.y, z1), apex);
      }
      const lp = M.labelPoint(r);
      const minor = /^(lobby|apron|lantern)/.test(r.id);
      labelPts.push({ id: r.id, name: r.name, z0, h: r.h, minor, at: lp, p: new THREE.Vector3() });
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
      const box = (w, hh, d, y, m = mat) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m);
        mesh.position.y = y + hh / 2;
        mesh.castShadow = mesh.receiveShadow = true;
        g.add(mesh);
        return mesh;
      };
      if (it.kind === 'turbine') {
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
      } else if (it.kind === 'air') {
        box(it.w, h * 0.55, it.d * 0.55, 0);
        box(it.w * 0.55, 0.08, it.d, h * 0.45, std(0xd5dde6, { transparent: true, opacity: 0.8 }));
      } else {
        box(it.w, h, it.d, 0);
      }
      const nm = it.full || it.name;
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
    const seamLines = mkLines(seams, seamMat);
    structure.add(seamLines, mkLines(seamsShield, seamMatShield), mkLines(edges, edgeMat));
    scene.add(structure, itemGroups.base, itemGroups.terrace, itemGroups.entrance);

    // земля, сітка і ділянки
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), mats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, -10);
    ground.receiveShadow = true;
    scene.add(ground);
    const gridArr = [];
    for (let x = -17; x <= 17; x++) line(gridArr, v3(x, -3, 0), v3(x, 23, 0));
    for (let y = -3; y <= 23; y++) line(gridArr, v3(-17, y, 0), v3(17, y, 0));
    const grid = mkLines(gridArr, new THREE.LineBasicMaterial({ color: 0x8f7457, transparent: true, opacity: 0.28 }));
    grid.position.y = -0.005;
    scene.add(grid);
    const claimArr = [];
    for (const c of M.claims) {
      const q = [v3(c.x, c.y, 0), v3(c.x + c.w, c.y, 0), v3(c.x + c.w, c.y + c.d, 0), v3(c.x, c.y + c.d, 0)];
      for (let i = 0; i < 4; i++) line(claimArr, q[i], q[(i + 1) % 4]);
    }
    const claimsLines = mkLines(claimArr, new THREE.LineBasicMaterial({ color: 0x24222e }));
    claimsLines.position.y = 0.0;
    scene.add(claimsLines);

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

    const state = { cut: 99, labels: true, running: false, variant: 'terrace', w: 1, h: 1 };
    function setVariant(k) {
      state.variant = k;
      itemGroups.terrace.visible = k === 'terrace';
      itemGroups.entrance.visible = k === 'entrance';
      const t = labelPts.find((l) => l.id === 'terrace');
      if (t) t.el.textContent = M.variants[k].label;
    }
    setVariant(opts.variant || 'terrace');
    function setCut(levels) {
      state.cut = levels;
      clip.constant = levels * LH;
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
    function labelVisible(L) {
      const cut = state.cut;
      if (L.minor || L.z0 >= cut - 0.05) return false;
      const base = cut > M.heights.G + 0.05 ? M.heights.G : 0;
      return L.z0 >= base || (L.h > M.heights.G && L.z0 + L.h > base);
    }
    // Підпис ховається, якщо між камерою і ним стоїть стіна (перевірка раз на кілька кадрів).
    const occRay = new THREE.Raycaster();
    let occTick = 0;
    // Точка підпису: над дахом, якщо дах видно, інакше трохи нижче площини зрізу.
    function labelAnchor(L) {
      const z = L.h > 0 ? Math.min(L.z0 + L.h + 0.45, state.cut - 0.3) : L.z0 + 0.6;
      L.p.copy(v3(L.at.x, L.at.y, Math.max(z, L.z0 + 0.4)));
    }
    function updateOcclusion() {
      if (occTick++ % 8 !== 0) return;
      const solids = structure.children.filter((o) => o.isMesh && !o.material.transparent);
      for (const L of labelPts) {
        if (!labelVisible(L)) continue;
        labelAnchor(L);
        const dir = L.p.clone().sub(camera.position);
        const dist = dir.length();
        occRay.set(camera.position, dir.normalize());
        occRay.far = dist - 0.6;
        const hits = occRay.intersectObjects(solids, false).filter((h) => h.point.y < state.cut * LH);
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
      const hits = ray.intersectObjects(hoverables, false).filter((h) => h.point.y < state.cut * LH && h.object.parent.parent.visible !== false);
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
    function renderOnce() { resize(); controls.update(); renderer.render(scene, camera); placeLabels(); }

    return { start, stop, setCut, setVariant, setTileColors, setLabels, setView, renderOnce, LH };
  }

  root.VIEW3D = { create };
})(typeof window !== 'undefined' ? window : globalThis);

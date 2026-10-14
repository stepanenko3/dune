// 3D без мерехтіння: шукає пари трикутників, що лежать в одній (або майже в одній) площині і перекриваються.
// Запуск: THREE_DIR=<шлях до three@0.128.0> node tools/check-3d.js [main|dd]. Очікується «overlapping pairs 0».
const path = require('path'); const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith('file:')) return r.continue();
    if (u.includes('three@0.128.0/')) return r.fulfill({ path: path.join(process.env.THREE_DIR, u.split('three@0.128.0/')[1]), contentType: 'application/javascript' });
    return r.abort(); });
  await p.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html') + '#' + (process.argv[2] || 'main'));
  await p.evaluate(() => window.SANDWALKERS.setTab('3d'));
  await p.waitForTimeout(800);
  const res = await p.evaluate(() => {
    const v = window.SANDWALKERS.view(), THREE = window.THREE;
    const tris = [];
    const meshes = [];
    for (const root of [v.debug.structure, v.debug.floors]) root.traverse((o) => { if (o.isMesh) meshes.push(o); });
    meshes.forEach((m, mi) => {
      const pos = m.geometry.attributes.position.array;
      let layer = m.parent && m.parent !== v.debug.structure && m.parent !== v.debug.floors ? m.parent.uuid.slice(0, 4) : '';
      const roof = v.debug.roofGroups.find((R) => R.g === m.parent);
      for (let i = 0; i < pos.length; i += 9) {
        const A = new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]), B = new THREE.Vector3(pos[i + 3], pos[i + 4], pos[i + 5]), C = new THREE.Vector3(pos[i + 6], pos[i + 7], pos[i + 8]);
        const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
        const area = n.length() / 2;
        if (area < 1e-5) continue;
        n.normalize();
        // канонічний знак
        if (n.x < -1e-6 || (Math.abs(n.x) < 1e-6 && (n.y < -1e-6 || (Math.abs(n.y) < 1e-6 && n.z < 0)))) n.negate();
        tris.push({ mi, A, B, C, n, d: n.dot(A), mat: m.material.color ? m.material.color.getHexString() : '?', tr: !!m.material.transparent, roof: roof ? roof.top : null });
      }
    });
    // групи за нормаллю
    const key = (n) => [n.x, n.y, n.z].map((x) => Math.round(x * 200)).join(',');
    const groups = new Map();
    for (const t of tris) { const k = key(t.n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    // 2D проєкція на площину
    const proj = (t, n) => {
      const u = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(n).normalize() : new THREE.Vector3(1, 0, 0).cross(n).normalize();
      const w = new THREE.Vector3().crossVectors(n, u);
      return [t.A, t.B, t.C].map((P) => [P.dot(u), P.dot(w)]);
    };
    const areaOf = (poly) => { let s = 0; for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; s += x1 * y2 - x2 * y1; } return s / 2; };
    const ccw = (poly) => (areaOf(poly) < 0 ? poly.slice().reverse() : poly);
    function clip(subject, clipper) {
      let out = subject;
      for (let i = 0; i < clipper.length; i++) {
        const [ax, ay] = clipper[i], [bx, by] = clipper[(i + 1) % clipper.length];
        const inside = ([x, y]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= -1e-9;
        const inter = ([px, py], [qx, qy]) => { const a1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax), a2 = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax); const t = a1 / (a1 - a2); return [px + (qx - px) * t, py + (qy - py) * t]; };
        const inp = out; out = [];
        if (!inp.length) break;
        for (let j = 0; j < inp.length; j++) {
          const P = inp[j], Q = inp[(j + 1) % inp.length];
          if (inside(Q)) { if (!inside(P)) out.push(inter(P, Q)); out.push(Q); } else if (inside(P)) out.push(inter(P, Q));
        }
      }
      return out;
    }
    const TOL = 0.012; // відстань між площинами, за якої можливе мерехтіння
    const hits = [];
    for (const list of groups.values()) {
      list.sort((a, b) => a.d - b.d);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length && list[j].d - list[i].d < TOL; j++) {
          const a = list[i], bb = list[j];
          if (a.mi === bb.mi && Math.abs(a.d - bb.d) < 1e-6) continue; // одна сітка, одна площина — суміжні трикутники
          // лише якщо обидва можуть бути видимі разом: дахи ховаються тільки цілком
          const pa = ccw(proj(a, a.n)), pb = ccw(proj(bb, a.n));
          const ov = clip(pa, pb);
          const ar = ov.length > 2 ? Math.abs(areaOf(ov)) : 0;
          if (ar > 1e-3) {
            const c = new THREE.Vector3().add(a.A).add(a.B).add(a.C).multiplyScalar(1 / 3);
            const P = (t) => [t.A, t.B, t.C].map((q) => [+q.x.toFixed(2), +(-q.z).toFixed(2), +(q.y / v.LH).toFixed(3)]);
            hits.push({ ta: P(a), tb: P(bb), mats: a.mat + (a.tr ? 'T' : '') + '/' + bb.mat + (bb.tr ? 'T' : ''), same: a.mi === bb.mi, gap: +(bb.d - a.d).toFixed(4), area: +ar.toFixed(3), at: [+(c.x).toFixed(2), +(-c.z).toFixed(2), +(c.y / v.LH).toFixed(2)], n: [a.n.x, a.n.y, a.n.z].map((x) => +x.toFixed(2)), roofs: [a.roof, bb.roof] });
          }
        }
      }
    }
    return { tris: tris.length, hits };
  });
  console.log('triangles', res.tris, 'overlapping pairs', res.hits.length);
  const agg = new Map();
  for (const h of res.hits) { const k = h.mats + ' n' + h.n.join(',') + (h.same ? ' same' : ''); if (!agg.has(k)) agg.set(k, []); agg.get(k).push(h); }
  for (const [k, l] of [...agg].sort((a, b) => b[1].length - a[1].length).slice(0, 30)) console.log(String(l.length).padStart(4), k, 'e.g.', JSON.stringify(l[0].at), 'gap', l[0].gap, 'roofs', JSON.stringify(l[0].roofs), '\n      A', JSON.stringify(l[0].ta), '\n      B', JSON.stringify(l[0].tb));
  await b.close();
})();

/*
 * Програмний растеризатор сцени three.js — знімки баз на сервері без браузера й відеокарти. Малює ту саму сцену, що
 * й WebGL на сайті (її будує src/engine/view3d.js): сітки з MeshStandardMaterial — розсіяне світло від неба й
 * напрямлених ламп, як у three r128 без фізичних одиниць (дзеркальні відблиски не рахуємо); тінь від сонця — карта
 * глибини з боку світла, PCF 3×3; лінії (шви, ребра, сітка на піску); прозорі пентащити й скло — поверх, від дальніх.
 * Видимість — z-буфер (1/глибина), polygonOffset — як у WebGL: на схил глибини грані в точках екрана (factor) і
 * найменший крок буфера (units). Освітлення — у вершинах (сцена з
 * пласких граней), тінь — у кожній точці. Кадр — RGB без згладжування: його дає рендер у більшому розмірі й
 * зменшення (робить виклик).
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const THREE = require('three')

const SM = 2048 // карта тіні
const V = 12 // на вершину: sx, sy, 1/z, база rgb, сонце rgb, світло xyz
const T = 3 * V + 2 // + матеріал, прапорці

/** render(scene, camera, { width, height, sky: [[r,g,b] верх, [r,g,b] низ] }) → Uint8ClampedArray RGB */
export function render(scene, camera, { width: W, height: H, sky }) {
  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  camera.updateProjectionMatrix()

  // ---------- світло ----------
  const hemis = [], dirs = [], ambient = [0, 0, 0]
  let sun = null
  scene.traverseVisible((o) => {
    if (o.isHemisphereLight) {
      const u = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).normalize()
      hemis.push({ u, s: o.color, g: o.groundColor, i: o.intensity })
    } else if (o.isAmbientLight) {
      ambient[0] += o.color.r * o.intensity; ambient[1] += o.color.g * o.intensity; ambient[2] += o.color.b * o.intensity
    } else if (o.isDirectionalLight) {
      o.target.updateMatrixWorld(true)
      const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld)
      const t = new THREE.Vector3().setFromMatrixPosition(o.target.matrixWorld)
      const d = { l: p.sub(t).normalize(), c: o.color, i: o.intensity, shadow: false }
      if (o.castShadow && !sun) { d.shadow = true; sun = o; o.shadow.camera.updateProjectionMatrix(); o.shadow.updateMatrices(o) }
      dirs.push(d)
    }
  })
  const lightMat = sun ? new THREE.Matrix4().multiplyMatrices(sun.shadow.camera.projectionMatrix, sun.shadow.camera.matrixWorldInverse).elements : null

  // ---------- матеріали ----------
  const mats = [], matIdx = new Map()
  const matOf = (m) => {
    if (matIdx.has(m)) return matIdx.get(m)
    const k = m.metalness !== undefined ? 1 - m.metalness : 1
    const ei = m.emissiveIntensity ?? 1
    mats.push({
      d: [m.color.r * k, m.color.g * k, m.color.b * k],
      e: m.emissive ? [m.emissive.r * ei, m.emissive.g * ei, m.emissive.b * ei] : [0, 0, 0],
      lit: !m.isMeshBasicMaterial,
      c: [m.color.r, m.color.g, m.color.b],
      a: m.transparent ? m.opacity : 1,
      side: m.side,
      factor: m.polygonOffset ? m.polygonOffsetFactor : 0,
      units: m.polygonOffset ? m.polygonOffsetUnits : 0,
      depthTest: m.depthTest !== false,
      depthWrite: m.depthWrite !== false,
      transparent: !!m.transparent,
    })
    matIdx.set(m, mats.length - 1)
    return mats.length - 1
  }

  // ---------- трикутники: у камеру, відсікання ближньою площиною, на екран ----------
  const view = camera.matrixWorldInverse.elements, proj = camera.projectionMatrix.elements, near = camera.near
  const opaque = [], glass = []
  const pushTri = (list, data) => list.push(data)
  const casters = [] // світові координати для карти тіні
  const nm = new THREE.Matrix3()
  const vw = new Float64Array(9), nv = new Float64Array(9)

  function vertex(m, wx, wy, wz, nx, ny, nz, recv) {
    // освітлення у вершині: небо + лампи; сонце — окремо, його множить тінь
    let r = ambient[0], g = ambient[1], b = ambient[2], sr = 0, sg = 0, sb = 0
    if (m.lit) {
      for (const h of hemis) {
        const t = 0.5 * (nx * h.u.x + ny * h.u.y + nz * h.u.z) + 0.5
        r += (h.g.r + (h.s.r - h.g.r) * t) * h.i; g += (h.g.g + (h.s.g - h.g.g) * t) * h.i; b += (h.g.b + (h.s.b - h.g.b) * t) * h.i
      }
      for (const d of dirs) {
        const dot = nx * d.l.x + ny * d.l.y + nz * d.l.z
        if (dot <= 0) continue
        if (d.shadow && recv) { sr += d.c.r * d.i * dot; sg += d.c.g * d.i * dot; sb += d.c.b * d.i * dot }
        else { r += d.c.r * d.i * dot; g += d.c.g * d.i * dot; b += d.c.b * d.i * dot }
      }
    }
    const base = m.lit ? [m.d[0] * r + m.e[0], m.d[1] * g + m.e[1], m.d[2] * b + m.e[2]] : m.c
    let lx = 0, ly = 0, lz = 0
    if (lightMat && recv) {
      const e = lightMat
      lx = e[0] * wx + e[4] * wy + e[8] * wz + e[12]; ly = e[1] * wx + e[5] * wy + e[9] * wz + e[13]; lz = e[2] * wx + e[6] * wy + e[10] * wz + e[14]
    }
    // у камері
    const cx = view[0] * wx + view[4] * wy + view[8] * wz + view[12]
    const cy = view[1] * wx + view[5] * wy + view[9] * wz + view[13]
    const cz = view[2] * wx + view[6] * wy + view[10] * wz + view[14]
    return [cx, cy, cz, base[0], base[1], base[2], m.d[0] * sr, m.d[1] * sg, m.d[2] * sb, lx, ly, lz]
  }
  const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t)
  function emit(list, poly, mi, flags) {
    // відсікання ближньою площиною (z ≤ −near)
    const out = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      const ia = a[2] <= -near, ib = b[2] <= -near
      if (ia) out.push(a)
      if (ia !== ib) out.push(lerp(a, b, (-near - a[2]) / (b[2] - a[2])))
    }
    if (out.length < 3) return
    const s = out.map((v) => {
      const w = -v[2]
      const x = (proj[0] * v[0] + proj[8] * v[2]) / w, y = (proj[5] * v[1] + proj[9] * v[2]) / w
      return [(x * 0.5 + 0.5) * W, (0.5 - y * 0.5) * H, 1 / w, v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11]]
    })
    for (let i = 1; i < s.length - 1; i++) pushTri(list, [...s[0], ...s[i], ...s[i + 1], mi, flags])
  }

  scene.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return
    const geo = o.geometry, pos = geo.attributes.position, nor = geo.attributes.normal, idx = geo.index
    const e = o.matrixWorld.elements
    nm.getNormalMatrix(o.matrixWorld)
    const n3 = nm.elements
    const groups = Array.isArray(o.material) ? (geo.groups.length ? geo.groups : [{ start: 0, count: Infinity, materialIndex: 0 }]) : [{ start: 0, count: Infinity, materialIndex: -1 }]
    const count = idx ? idx.count : pos.count
    for (const gr of groups) {
      const mat = gr.materialIndex < 0 ? o.material : o.material[gr.materialIndex]
      if (!mat || mat.visible === false || mat.isShadowMaterial) continue
      const mi = matOf(mat), m = mats[mi]
      const end = Math.min(count, gr.start + gr.count)
      for (let k = gr.start; k + 2 < end + 0 && k + 2 < count; k += 3) {
        for (let j = 0; j < 3; j++) {
          const vi = idx ? idx.getX(k + j) : k + j
          const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi)
          vw[j * 3] = e[0] * x + e[4] * y + e[8] * z + e[12]
          vw[j * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
          vw[j * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
          if (nor) {
            const a = nor.getX(vi), b = nor.getY(vi), c = nor.getZ(vi)
            const nx = n3[0] * a + n3[3] * b + n3[6] * c, ny = n3[1] * a + n3[4] * b + n3[7] * c, nz = n3[2] * a + n3[5] * b + n3[8] * c
            const L = Math.hypot(nx, ny, nz) || 1
            nv[j * 3] = nx / L; nv[j * 3 + 1] = ny / L; nv[j * 3 + 2] = nz / L
          }
        }
        // грань: нормаль і чи дивиться на камеру
        const ux = vw[3] - vw[0], uy = vw[4] - vw[1], uz = vw[5] - vw[2], wx = vw[6] - vw[0], wy = vw[7] - vw[1], wz = vw[8] - vw[2]
        let fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx
        const fl = Math.hypot(fx, fy, fz)
        if (fl < 1e-12) continue
        fx /= fl; fy /= fl; fz /= fl
        const cam = camera.position
        const front = fx * (cam.x - vw[0]) + fy * (cam.y - vw[1]) + fz * (cam.z - vw[2]) > 0
        if (o.castShadow && !m.transparent) casters.push(vw[0], vw[1], vw[2], vw[3], vw[4], vw[5], vw[6], vw[7], vw[8])
        if ((m.side === THREE.FrontSide && !front) || (m.side === THREE.BackSide && front)) continue
        const flip = !front ? -1 : 1
        const poly = []
        for (let j = 0; j < 3; j++) {
          let nx = nor ? nv[j * 3] : fx, ny = nor ? nv[j * 3 + 1] : fy, nz = nor ? nv[j * 3 + 2] : fz
          nx *= flip; ny *= flip; nz *= flip
          poly.push(vertex(m, vw[j * 3], vw[j * 3 + 1], vw[j * 3 + 2], nx, ny, nz, o.receiveShadow))
        }
        emit(m.transparent ? glass : opaque, poly, mi, o.receiveShadow ? 1 : 0)
      }
    }
  })

  // ---------- карта тіні ----------
  let smap = null
  if (sun && casters.length) {
    smap = new Float32Array(SM * SM).fill(Infinity)
    const e = lightMat
    for (let k = 0; k < casters.length; k += 9) {
      const p = []
      for (let j = 0; j < 3; j++) {
        const x = casters[k + j * 3], y = casters[k + j * 3 + 1], z = casters[k + j * 3 + 2]
        p.push([((e[0] * x + e[4] * y + e[8] * z + e[12]) * 0.5 + 0.5) * SM, ((e[1] * x + e[5] * y + e[9] * z + e[13]) * 0.5 + 0.5) * SM, e[2] * x + e[6] * y + e[10] * z + e[14]])
      }
      triRaster(p[0], p[1], p[2], SM, SM, (i, w0, w1, w2) => {
        const z = w0 * p[0][2] + w1 * p[1][2] + w2 * p[2][2]
        if (z < smap[i]) smap[i] = z
      })
    }
  }
  const shadowAt = (lx, ly, lz) => {
    if (!smap) return 1
    const sx = (lx * 0.5 + 0.5) * SM - 0.5, sy = (ly * 0.5 + 0.5) * SM - 0.5
    const x0 = Math.round(sx), y0 = Math.round(sy)
    let lit = 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = x0 + dx, y = y0 + dy
      if (x < 0 || y < 0 || x >= SM || y >= SM) { lit++; continue }
      if (lz - 0.0025 <= smap[y * SM + x]) lit++
    }
    return lit / 9
  }

  // ---------- видимість: z-буфер і номер трикутника ----------
  const N = W * H
  const zbuf = new Float32Array(N), ids = new Int32Array(N).fill(-1)
  const ot = Float64Array.from(opaque.flat())
  const nOpaque = opaque.length
  for (let t = 0; t < nOpaque; t++) {
    const o = t * T, m = mats[ot[o + 3 * V]]
    const p0 = [ot[o], ot[o + 1]], p1 = [ot[o + V], ot[o + V + 1]], p2 = [ot[o + 2 * V], ot[o + 2 * V + 1]]
    let z0 = ot[o + 2], z1 = ot[o + V + 2], z2 = ot[o + 2 * V + 2]
    if (m.factor || m.units) {
      // зсув углиб: factor — на найбільший схил 1/z за точку екрана, units — на крок 24-бітного буфера (у 1/z)
      const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])
      const dx = area ? ((z1 - z0) * (p2[1] - p0[1]) - (z2 - z0) * (p1[1] - p0[1])) / area : 0
      const dy = area ? ((p1[0] - p0[0]) * (z2 - z0) - (p2[0] - p0[0]) * (z1 - z0)) / area : 0
      const off = m.factor * Math.max(Math.abs(dx), Math.abs(dy)) + (m.units * 2 ** -24) / near
      z0 -= off; z1 -= off; z2 -= off
    }
    triRaster(p0, p1, p2, W, H, (i, w0, w1, w2) => {
      const z = w0 * z0 + w1 * z1 + w2 * z2
      if (m.depthTest && z <= zbuf[i]) return
      zbuf[i] = z
      ids[i] = t
    })
  }

  // ---------- кольори: небо, освітлені грані з тінню ----------
  const rgb = new Float32Array(N * 3)
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1)
    const r = sky[0][0] + (sky[1][0] - sky[0][0]) * t, g = sky[0][1] + (sky[1][1] - sky[0][1]) * t, b = sky[0][2] + (sky[1][2] - sky[0][2]) * t
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b }
  }
  const bary = new Float64Array(3)
  const shadeAt = (tri, o, px, py, out) => {
    const x0 = tri[o], y0 = tri[o + 1], x1 = tri[o + V], y1 = tri[o + V + 1], x2 = tri[o + 2 * V], y2 = tri[o + 2 * V + 1]
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
    let w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area
    let w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area
    let w2 = 1 - w0 - w1
    // з урахуванням перспективи
    w0 *= tri[o + 2]; w1 *= tri[o + V + 2]; w2 *= tri[o + 2 * V + 2]
    const s = w0 + w1 + w2 || 1
    bary[0] = w0 / s; bary[1] = w1 / s; bary[2] = w2 / s
    const at = (k) => bary[0] * tri[o + k] + bary[1] * tri[o + V + k] + bary[2] * tri[o + 2 * V + k]
    const sh = tri[o + 3 * V + 1] && smap ? shadowAt(at(9), at(10), at(11)) : 1
    out[0] = at(3) + at(6) * sh; out[1] = at(4) + at(7) * sh; out[2] = at(5) + at(8) * sh
  }
  const c3 = [0, 0, 0]
  for (let i = 0; i < N; i++) {
    const t = ids[i]
    if (t < 0) continue
    shadeAt(ot, t * T, (i % W) + 0.5, Math.floor(i / W) + 0.5, c3)
    rgb[i * 3] = c3[0]; rgb[i * 3 + 1] = c3[1]; rgb[i * 3 + 2] = c3[2]
  }

  // ---------- лінії: шви, ребра, сітка — з перевіркою глибини, товщиною у 2 точки ----------
  scene.traverseVisible((o) => {
    if (!o.isLineSegments || !o.geometry?.attributes?.position) return
    const m = o.material
    if (!m || m.visible === false) return
    const pos = o.geometry.attributes.position, e = o.matrixWorld.elements
    const a = m.transparent ? m.opacity : 1, col = [m.color.r, m.color.g, m.color.b], test = m.depthTest !== false
    for (let k = 0; k + 1 < pos.count; k += 2) {
      const pts = []
      for (let j = 0; j < 2; j++) {
        const x = pos.getX(k + j), y = pos.getY(k + j), z = pos.getZ(k + j)
        const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14]
        pts.push([view[0] * wx + view[4] * wy + view[8] * wz + view[12], view[1] * wx + view[5] * wy + view[9] * wz + view[13], view[2] * wx + view[6] * wy + view[10] * wz + view[14]])
      }
      let [p, q] = pts
      if (p[2] > -near && q[2] > -near) continue
      if (p[2] > -near) p = lerp(p, q, (-near - p[2]) / (q[2] - p[2]))
      else if (q[2] > -near) q = lerp(q, p, (-near - q[2]) / (p[2] - q[2]))
      const sp = project(p), sq = project(q)
      const dx = sq[0] - sp[0], dy = sq[1] - sp[1], n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))) || 1
      const thickX = Math.abs(dy) > Math.abs(dx) // крок по y — товщина по x
      for (let s = 0; s <= n; s++) {
        const t = s / n
        const x = Math.floor(sp[0] + dx * t), y = Math.floor(sp[1] + dy * t), iz = sp[2] + (sq[2] - sp[2]) * t
        for (let d = 0; d < 2; d++) {
          const xx = thickX ? x + d : x, yy = thickX ? y : y + d
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
          const i = yy * W + xx
          if (test && iz < zbuf[i] * 0.9998) continue
          const j = i * 3
          rgb[j] += (col[0] - rgb[j]) * a; rgb[j + 1] += (col[1] - rgb[j + 1]) * a; rgb[j + 2] += (col[2] - rgb[j + 2]) * a
        }
      }
    }
  })
  function project(v) {
    const w = -v[2]
    return [((proj[0] * v[0] + proj[8] * v[2]) / w * 0.5 + 0.5) * W, (0.5 - (proj[5] * v[1] + proj[9] * v[2]) / w * 0.5) * H, 1 / w]
  }

  // ---------- прозоре: від дальніх до ближніх, без запису глибини ----------
  const gt = Float64Array.from(glass.flat())
  const order = glass.map((_, t) => t).sort((a, b) => {
    const o = a * T, q = b * T
    return (gt[o + 2] + gt[o + V + 2] + gt[o + 2 * V + 2]) - (gt[q + 2] + gt[q + V + 2] + gt[q + 2 * V + 2])
  })
  for (const t of order) {
    const o = t * T, m = mats[gt[o + 3 * V]]
    const p0 = [gt[o], gt[o + 1]], p1 = [gt[o + V], gt[o + V + 1]], p2 = [gt[o + 2 * V], gt[o + 2 * V + 1]]
    const z0 = gt[o + 2], z1 = gt[o + V + 2], z2 = gt[o + 2 * V + 2]
    triRaster(p0, p1, p2, W, H, (i, w0, w1, w2) => {
      if (m.depthTest && w0 * z0 + w1 * z1 + w2 * z2 <= zbuf[i]) return
      shadeAt(gt, o, (i % W) + 0.5, Math.floor(i / W) + 0.5, c3)
      const j = i * 3
      rgb[j] += (c3[0] - rgb[j]) * m.a; rgb[j + 1] += (c3[1] - rgb[j + 1]) * m.a; rgb[j + 2] += (c3[2] - rgb[j + 2]) * m.a
    })
  }

  const out = new Uint8ClampedArray(N * 3)
  for (let i = 0; i < N * 3; i++) out[i] = rgb[i] * 255 + 0.5
  return out
}

/** трикутник на сітці w×h: для кожної точки, центр якої всередині, — f(індекс, w0, w1, w2) (лінійні ваги) */
function triRaster(a, b, c, w, h, f) {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
  if (!area || !Number.isFinite(area)) return
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])))
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])))
  if (minX > maxX || minY > maxY) return
  const inv = 1 / area
  // ваги як лінійні функції точки: w = A·x + B·y + C
  const A0 = (b[1] - c[1]) * inv, B0 = (c[0] - b[0]) * inv, C0 = (b[0] * c[1] - c[0] * b[1]) * inv
  const A1 = (c[1] - a[1]) * inv, B1 = (a[0] - c[0]) * inv, C1 = (c[0] * a[1] - a[0] * c[1]) * inv
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5
    let w0 = A0 * (minX + 0.5) + B0 * py + C0, w1 = A1 * (minX + 0.5) + B1 * py + C1
    for (let x = minX; x <= maxX; x++, w0 += A0, w1 += A1) {
      const w2 = 1 - w0 - w1
      if (w0 < 0 || w1 < 0 || w2 < 0) continue
      f(y * w + x, w0, w1, w2)
    }
  }
}

// Атрейдесівський орні: праві крила — дзеркало лівих, у даних анімації (а не під час показу).
//
// У моделі ключові кадри правих крил трохи криві: кінчики (кістки «…1.3») у перевороті згинаються
// сильніше, ніж ліві, і праві лопаті перехрещуються (так і в оригіналі на Sketchfab). Модель у спокої
// симетрична, тож для кожної анімації переписуємо повороти правих кісток крил так, щоб у кожен момент
// вони були дзеркальним відображенням лівих відносно площини симетрії корпусу. Ліва сторона, решта
// кісток, час і кількість ключів — без змін.
//
// Дзеркалимо так, щоб дзеркальною була сітка крила: S_R(t) = M·S_L(t)·Mₛ, де S = W·IBM — матриця
// скінінгу кістки, M — відбиття відносно площини симетрії у світі, Mₛ — те саме відбиття в просторі сітки
// (поза прив'язки сітки в моделі не збігається з позою спокою, тож поправку беремо з матриць прив'язки):
//   W_R(t) = M·W_L(t)·C,  C = IBM_L·Mₛ·IBM_R⁻¹  (беремо лише поворот).
// Локальний поворот правої кістки = (світовий поворот батька)ᵀ·W_R(t); від кореня крила до кінчика.

const WING = /^Ala (lateral|Up) ([12])\.([123]) ([RL])_\d/

// ---------- 3×3 (масиви по рядках) ----------
const mul = (a, b) => {
  const o = new Array(9)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
  return o
}
const tr = (a) => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]
/** лінійна частина 4×4 (по стовпцях) як 3×3 по рядках, з масштабом */
const lin = (m) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => m[c * 4 + r]))
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((x) => x / det)
}
/** нормалізувати стовпці (прибрати масштаб, лишити поворот чи відбиття) */
const ortho = (m) => {
  const n = [0, 1, 2].map((c) => Math.hypot(m[c], m[3 + c], m[6 + c]) || 1)
  return m.map((x, k) => x / n[k % 3])
}
/** поворот зі світової матриці вузла (gl-matrix, по стовпцях), без масштабу */
function rotOf(m) {
  const cols = [0, 1, 2].map((c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]])
  const n = cols.map((v) => Math.hypot(...v) || 1)
  return [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => cols[c][r] / n[c]))
}
/** кватерніон [x, y, z, w] з матриці повороту */
function quatOf(m) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m
  const t = m00 + m11 + m22
  let x, y, z, w
  if (t > 0) { const s = 0.5 / Math.sqrt(t + 1); w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s }
  const k = Math.hypot(x, y, z, w)
  return [x / k, y / k, z / k, w / k]
}

/** значення каналу в момент t (лінійно; повороти — найкоротшим шляхом) */
function sample(ch, t) {
  const s = ch.getSampler(), T = s.getInput().getArray(), V = s.getOutput().getArray(), n = s.getOutput().getElementSize()
  let k = 0
  while (k < T.length && T[k] < t) k++
  if (k === 0) return [...V.slice(0, n)]
  if (k >= T.length) return [...V.slice((T.length - 1) * n, T.length * n)]
  const u = (t - T[k - 1]) / (T[k] - T[k - 1] || 1)
  const a = [...V.slice((k - 1) * n, k * n)], b = [...V.slice(k * n, k * n + n)]
  if (n !== 4) return a.map((x, i) => x * (1 - u) + b[i] * u)
  const d = a.reduce((x, v, i) => x + v * b[i], 0) < 0 ? -1 : 1
  const q = a.map((x, i) => x * (1 - u) + b[i] * d * u)
  const m = Math.hypot(...q)
  return q.map((x) => x / m)
}

export function mirrorWings(doc, log = console.log) {
  const root = doc.getRoot()
  const nodes = root.listNodes()
  const bone = new Map() // «lateral:1:2:R» → вузол
  for (const n of nodes) { const x = WING.exec(n.getName()); if (x) bone.set(x.slice(1, 5).join(':'), n) }
  const rest = new Map(nodes.map((n) => [n, { r: n.getRotation(), t: n.getTranslation(), s: n.getScale() }]))
  const toRest = () => { for (const [n, v] of rest) { n.setRotation(v.r); n.setTranslation(v.t); n.setScale(v.s) } }
  const pos = (n) => { const m = n.getWorldMatrix(); return [m[12], m[13], m[14]] }

  // площина симетрії й поправки спокою
  toRest()
  const pr = bone.get('lateral:1:1:R'), pl = bone.get('lateral:1:1:L')
  if (!pr || !pl) { log('[mirror] немає кісток крил — пропускаю'); return }
  const d = pos(pr).map((x, i) => x - pos(pl)[i])
  const len = Math.hypot(...d)
  const nv = d.map((x) => x / len)
  const M = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => (r === c ? 1 : 0) - 2 * nv[r] * nv[c]))
  // матриці прив'язки (inverse bind) кісток і простір сітки
  const skin = root.listSkins()[0]
  const body = nodes.find((x) => /^Cuerpo_/.test(x.getName()))
  if (!skin || !body) { log('[mirror] немає скіна чи корпусу — пропускаю'); return }
  const ibmArr = skin.getInverseBindMatrices().getArray(), joints = skin.listJoints()
  const IBM = (n) => { const i = joints.indexOf(n); return lin([...ibmArr.slice(i * 16, i * 16 + 16)]) }
  // простір сітки (поза прив'язки) → світ у спокої: через корпус, він не рухається: T = W_корпусу·IBM_корпусу
  const T = mul(lin(body.getWorldMatrix()), IBM(body))
  const Ms = mul(mul(inv3(T), M), T) // те саме відбиття в просторі сітки
  const pairs = [] // від кореня до кінчика
  for (const type of ['lateral', 'Up']) for (const i of ['1', '2']) for (const j of ['1', '2', '3']) {
    const R = bone.get(`${type}:${i}:${j}:R`), L = bone.get(`${type}:${i}:${j}:L`)
    if (!R || !L) continue
    const C = ortho(mul(mul(IBM(L), Ms), inv3(IBM(R))))
    pairs.push({ R, L, C })
  }

  let touched = 0
  for (const anim of root.listAnimations()) {
    const chans = anim.listChannels()
    const rotCh = new Map(chans.filter((c) => c.getTargetPath() === 'rotation').map((c) => [c.getTargetNode(), c]))
    const work = pairs.filter((p) => rotCh.has(p.L) && rotCh.has(p.R))
    if (!work.length) continue
    // моменти — ключі лівого кореня крила (усі канали крил цієї анімації записані з однаковим кроком)
    const times = [...new Set(work.flatMap((p) => [...rotCh.get(p.L).getSampler().getInput().getArray()]))].sort((a, b) => a - b)
    const out = new Map(work.map((p) => [p.R, []]))
    for (const t of times) {
      toRest()
      for (const c of chans) {
        const v = sample(c, t), p = c.getTargetPath(), n = c.getTargetNode()
        if (p === 'rotation') n.setRotation(v)
        else if (p === 'translation') n.setTranslation(v)
        else if (p === 'scale') n.setScale(v)
      }
      for (const { R, L, C } of work) {
        const WR = mul(mul(M, rotOf(L.getWorldMatrix())), C)
        const parent = R.getParentNode()
        const local = parent ? mul(tr(rotOf(parent.getWorldMatrix())), WR) : WR
        let q = quatOf(local)
        const prev = out.get(R)
        if (prev.length) { const p = prev.slice(-4); if (p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3] < 0) q = q.map((x) => -x) }
        prev.push(...q)
        R.setRotation(q) // дочірні кістки правого крила рахуються вже від нового повороту
      }
    }
    for (const { R } of work) {
      const s = rotCh.get(R).getSampler()
      const buf = s.getInput().getBuffer()
      s.setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buf))
      s.setOutput(doc.createAccessor().setType('VEC4').setArray(new Float32Array(out.get(R))).setBuffer(buf))
      s.setInterpolation('LINEAR')
    }
    touched++
  }
  toRest()
  log(`[mirror] праві крила — дзеркало лівих: ${pairs.length} кісток, анімацій ${touched}`)
}

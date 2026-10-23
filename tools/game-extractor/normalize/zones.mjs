/*
 * Зона безпеки місця (для луту: рядки таблиць бувають лише для PvP чи лише для PvE). Зони — об'єми BP_SecurityZone_C у
 * рівнях гри: тип зони (m_SecurityZoneType) і пріоритет; форма — куб пензля ±100 одиниць у власних осях об'єму
 * (масштаб і поворот — у світовому трансформі). Місце в кількох об'ємах — найвищий пріоритет; поза всіма — тип зони за
 * замовчуванням (ini SecurityZonesSubsystem). Правила типу (PvP / PvE / місто) — DT_SecurityZones.
 */
const HALF = 100

/** обернена 3×3 (рядки) */
function inv(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!det) return null
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det], [B / det, (a * i - c * g) / det, -(a * f - c * d) / det], [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]]
}

/** об'єм зони зі світового трансформу актора { M, T } (точка світу = локальна · M + T) */
export function zoneOf(type, prio, t) {
  return { type, prio: Number(prio ?? 0), M: t.M, T: t.T, I: inv(t.M) }
}

/** правила зони в точці світу p [X, Y, Z]: зони, правила { тип: 'PvP' | 'PvE' | 'City' }, тип за замовчуванням */
export function zoneAt(zones, p, rules, fallback) {
  let best = null
  for (const z of zones) {
    const I = z.I ?? inv(z.M)
    if (!I) continue
    const d = [p[0] - z.T[0], p[1] - z.T[1], p[2] - z.T[2]]
    const l = [0, 1, 2].map((c) => d[0] * I[0][c] + d[1] * I[1][c] + d[2] * I[2][c])
    if (l.every((v) => Math.abs(v) <= HALF) && (!best || z.prio > best.prio)) best = z
  }
  return rules[best?.type ?? fallback] ?? null
}

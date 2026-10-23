/**
 * Тижневий розклад (гільдія грає, кандидат онлайн): рядки { days: [0–6, 0 — неділя], from: 'HH:MM', to: 'HH:MM' } у
 * поясі того, хто їх вписав; to ≤ from — через північ (22:00–02:00 — до другої ночі наступного дня). Глядач бачить
 * дні й години у своєму поясі: зсув поясів береться на цьому тижні (перехід на літній час — на годину, як у грі).
 */
import { locale } from './i18n'

export interface Slot { days: number[]; from: string; to: string }
/** відрізок доби у хвилинах: day — день тижня (0 — неділя), from < to ≤ 1440 */
export interface Span { day: number; from: number; to: number }

const DAY = 1440, WEEK = 7 * DAY
const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

/** зсув поясу від UTC у хвилинах на мить at (невідомий пояс — 0) */
export function tzOffset(tz: string | null | undefined, at = Date.now()): number {
  if (!tz) return 0
  try {
    const p: Record<string, string> = {}
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(at)) p[x.type] = x.value
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(at / 60000) * 60000) / 60000)
  } catch { return 0 }
}

/** пояс браузера */
export const myZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

/** розклад з поясу fromTz у пояс toTz: відрізки по днях (перехід через північ — два відрізки), відсортовані й злиті */
export function toViewer(slots: Slot[], fromTz: string | null, toTz: string = myZone(), now = Date.now()): Span[] {
  const shift = tzOffset(toTz, now) - tzOffset(fromTz || toTz, now)
  const raw: [number, number][] = []
  for (const s of slots) {
    const a = mins(s.from)
    let b = mins(s.to)
    if (b <= a) b += DAY
    for (const d of s.days) raw.push([d * DAY + a + shift, d * DAY + b + shift])
  }
  // на тижні по колу: усе, що вийшло за неділю чи перед нею, — на інший кінець
  const out: Span[] = []
  for (const [x, y] of raw) {
    let a = ((x % WEEK) + WEEK) % WEEK, b = a + (y - x)
    while (a < b) {
      const day = Math.floor(a / DAY) % 7, end = Math.min(b, (Math.floor(a / DAY) + 1) * DAY)
      out.push({ day, from: a % DAY, to: end - Math.floor(a / DAY) * DAY })
      a = end
    }
  }
  out.sort((p, q) => p.day - q.day || p.from - q.from)
  const merged: Span[] = []
  for (const s of out) {
    const last = merged[merged.length - 1]
    if (last && last.day === s.day && s.from <= last.to) last.to = Math.max(last.to, s.to)
    else merged.push({ ...s })
  }
  return merged
}

/** хвилини доби → «20:30»; рівно кінець доби — «24:00» (а не «00:00» того самого дня) */
export const hhmm = (m: number) => (m === 1440 ? '24:00' : `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)

/** назви днів тижня мовою сайту: короткі («пн») чи повні; індекс — день (0 — неділя) */
export function weekdays(style: 'short' | 'long' = 'short'): string[] {
  // 2023-01-01 — неділя
  try { return Array.from({ length: 7 }, (_, d) => new Intl.DateTimeFormat(locale(), { weekday: style, timeZone: 'UTC' }).format(Date.UTC(2023, 0, 1 + d))) } catch { return ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] }
}
/** порядок днів у тижні — з понеділка (як у грі й у більшості мов сайту) */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/**
 * коротко: «пн–пт 20:00–23:00, сб 14:00–02:00» — однакові години на кількох днях поспіль зводяться в діапазон;
 * перехід через північ — одним відрізком (до години наступного дня)
 */
export function summary(spans: Span[]): string {
  const names = weekdays('short')
  // склеїти відрізки, що переходять через північ: … до 24:00 + наступний день з 00:00
  const tail = new Map<number, number>() // відрізок до півночі → його продовження наступного дня
  const used = new Set<number>()
  spans.forEach((s, i) => {
    if (s.to !== DAY || s.from === 0) return
    const j = spans.findIndex((n, k) => !used.has(k) && k !== i && n.day === (s.day + 1) % 7 && n.from === 0 && n.to < DAY)
    if (j >= 0) { used.add(j); tail.set(i, j) }
  })
  const joined: Span[] = spans.flatMap((s, i) => (used.has(i) ? [] : [tail.has(i) ? { day: s.day, from: s.from, to: DAY + spans[tail.get(i)!].to } : s]))
  const byTime = new Map<string, number[]>()
  for (const s of joined) {
    const k = `${hhmm(s.from)}–${hhmm(s.to)}`
    if (!byTime.has(k)) byTime.set(k, [])
    byTime.get(k)!.push(s.day)
  }
  const parts: [number, string][] = []
  for (const [k, days] of byTime) {
    const order = WEEK_ORDER.filter((d) => days.includes(d))
    const runs: number[][] = []
    for (const d of order) {
      const r = runs[runs.length - 1]
      if (r && WEEK_ORDER.indexOf(d) === WEEK_ORDER.indexOf(r[r.length - 1]) + 1) r.push(d)
      else runs.push([d])
    }
    parts.push([WEEK_ORDER.indexOf(runs[0][0]), `${runs.map((r) => (r.length > 2 ? `${names[r[0]]}–${names[r[r.length - 1]]}` : r.map((d) => names[d]).join(', '))).join(', ')} ${k}`])
  }
  // з понеділка: будні раніше за вихідні
  return parts.sort((a, b) => a[0] - b[0]).map(([, x]) => x).join('; ')
}

/** «UTC+3», «UTC−5:30» */
export function utcLabel(tz: string | null | undefined, at = Date.now()): string {
  const o = tzOffset(tz, at)
  if (!o) return 'UTC'
  const a = Math.abs(o)
  return `UTC${o > 0 ? '+' : '−'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`
}
/** назва поясу мовою сайту («за східноєвропейським часом») — Intl; не знає — порожньо */
export function tzName(tz: string | null | undefined): string {
  if (!tz) return ''
  try {
    const p = new Intl.DateTimeFormat(locale(), { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(Date.now()).find((x) => x.type === 'timeZoneName')
    return p?.value && !/^GMT|^UTC/.test(p.value) ? p.value : ''
  } catch { return '' }
}

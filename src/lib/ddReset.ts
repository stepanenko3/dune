/**
 * Скидання Глибокої пустелі — буря Коріоліса: щотижня, під час щоденного перезапуску серверів регіону у вівторок
 * вранці (офіційно — «Tuesday morning during the server daily restart»). Гра живе за місцевим часом серверів, тож
 * буря — о 05:00 вівторка в часовому поясі регіону і з переходом на зимовий / літній час зсувається в UTC разом із ним
 * (Європа й Америка восени — на годину пізніше, Океанія — на годину раніше). Улітку це збігається з годинами з
 * фанатських трекерів (Європа 03:00 UTC, Пн. Америка 10:00, Пд. Америка 08:00, Океанія — 19:00 понеділка); офіційно
 * години не підтверджені — в інтерфейсі є приписка звірятися з Communinet у грі (він попереджає за 6 год).
 * Ті самі правила — на сервері (server/lib/storm.mjs: нагадування й частіша перевірка TH.GL після бурі).
 */
import { create } from 'zustand'
import { prefGet, prefSet } from '@/lib/prefs'
import { locale, t } from './i18n'

export type Region = 'eu' | 'na' | 'sa' | 'oce'
/** часовий пояс серверів регіону, день тижня (0 — неділя) і година бурі за місцевим часом */
export const REGIONS: Record<Region, { label: string; tz: string; day: number; hour: number }> = {
  eu: { label: t('Європа'), tz: 'Europe/Berlin', day: 2, hour: 5 },
  na: { label: t('Пн. Америка'), tz: 'America/Chicago', day: 2, hour: 5 },
  sa: { label: t('Пд. Америка'), tz: 'America/Sao_Paulo', day: 2, hour: 5 },
  oce: { label: t('Океанія'), tz: 'Australia/Sydney', day: 2, hour: 5 },
}
/** якщо браузер не знає часових поясів — літні години UTC */
const FIXED: Record<Region, [number, number]> = { eu: [2, 3], na: [2, 10], sa: [2, 8], oce: [1, 19] }
export const WEEK = 7 * 24 * 3600 * 1000
const HOUR = 3600 * 1000
/** Communinet попереджає про бурю за стільки до неї */
export const WARN = 6 * 3600 * 1000

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const fmts = new Map<string, Intl.DateTimeFormat>()
/** місцевий час у поясі tz */
function wall(tz: string, ms: number) {
  let f = fmts.get(tz)
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })))
  const p: Record<string, string> = {}
  for (const x of f.formatToParts(ms)) p[x.type] = x.value
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd: WD.indexOf(p.weekday) }
}
const offset = (tz: string, ms: number) => {
  const w = wall(tz, ms)
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(ms / 60000) * 60000
}
/** місцеві дата й година → мить */
const instant = (tz: string, y: number, mo: number, d: number, h: number) => {
  const guess = Date.UTC(y, mo - 1, d, h)
  return guess - offset(tz, guess - offset(tz, guess))
}

/** найближча буря регіону після now */
export function nextReset(region: Region, now = Date.now()): number {
  const r = REGIONS[region] ?? REGIONS.eu
  try {
    const w = wall(r.tz, now)
    for (let add = (r.day - w.wd + 7) % 7; ; add += 7) {
      const at = instant(r.tz, w.y, w.mo, w.d + add, r.hour)
      if (at > now) return at
    }
  } catch {
    const [day, hour] = FIXED[region] ?? FIXED.eu
    const d = new Date(now)
    const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + ((day - d.getUTCDay() + 7) % 7), hour)
    return at > now ? at : at + WEEK
  }
}

/** остання буря регіону до now (сусідні бурі — за тиждень ± година переходу на інший час) */
export const lastReset = (region: Region, now = Date.now()) => nextReset(region, nextReset(region, now) - WEEK - 2 * HOUR)

/**
 * Перша буря цього тижня в будь-якому регіоні (Океанія — раніше за всіх): розкладка мапи одна на всіх, і TH.GL
 * міняє її вже після першої бурі, тож «мапа з минулого тижня» — лише якщо її бачили ще до неї.
 */
export const firstStormOfWeek = (prev: number) => Math.min(...(Object.keys(REGIONS) as Region[]).map((r) => nextReset(r, prev - 2 * 24 * HOUR)))

export const useDDRegion = create<{ region: Region; setRegion: (r: Region) => void }>((set) => ({
  region: prefGet<Region>('dd:region', 'eu') in REGIONS ? prefGet<Region>('dd:region', 'eu') : 'eu',
  setRegion: (region) => { prefSet('dd:region', region); set({ region }) },
}))

/** «2 д 14 год», «5 год 03 хв», «12 хв 40 с» — дві найстарші одиниці */
export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  if (d) return t('{d} д {h} год', { d, h })
  if (h) return t('{h} год {m} хв', { h, m: p(m) })
  return t('{m} хв {s} с', { m, s: p(sec) })
}

/** коли буря за місцевим часом: «вівторок, 06:00» */
export const fmtWhen = (ms: number) => new Date(ms).toLocaleString(locale(), { weekday: 'long', hour: '2-digit', minute: '2-digit' })

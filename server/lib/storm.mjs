/*
 * Буря Коріоліса (скидання Глибокої пустелі) — щотижня, у вівторок під час щоденного перезапуску серверів регіону,
 * о 05:00 за їхнім місцевим часом. Тому з переходом на зимовий / літній час буря зсувається в UTC разом із ним
 * (Європа й Америка — восени на годину пізніше, Океанія — на годину раніше). Ті самі правила — у src/lib/ddReset.ts
 * (тест звіряє обидва).
 */
export const STORM_REGIONS = {
  eu: { tz: 'Europe/Berlin', day: 2, hour: 5 },
  na: { tz: 'America/Chicago', day: 2, hour: 5 },
  sa: { tz: 'America/Sao_Paulo', day: 2, hour: 5 },
  oce: { tz: 'Australia/Sydney', day: 2, hour: 5 },
}
/** якщо часових поясів немає (дуже старе середовище) — літні години UTC, як було раніше */
const FIXED = { eu: [2, 3], na: [2, 10], sa: [2, 8], oce: [1, 19] }
export const WEEK = 7 * 24 * 3600 * 1000
const HOUR = 3600 * 1000
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const fmts = new Map()
/** місцевий час у поясі tz: рік, місяць (1–12), день, година, хвилина, день тижня (0 — неділя) */
function wall(tz, ms) {
  let f = fmts.get(tz)
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })))
  const p = {}
  for (const x of f.formatToParts(ms)) p[x.type] = x.value
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, wd: WD.indexOf(p.weekday) }
}
/** зсув поясу від UTC у мить ms */
const offset = (tz, ms) => {
  const w = wall(tz, ms)
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(ms / 60000) * 60000
}
/** місцеві дата й година в поясі tz → мить (день може виходити за межі місяця — Date.UTC перенесе) */
function instant(tz, y, mo, d, h) {
  const guess = Date.UTC(y, mo - 1, d, h)
  return guess - offset(tz, guess - offset(tz, guess))
}

/** найближча буря регіону після now */
export function nextReset(region, now = Date.now()) {
  const r = STORM_REGIONS[region] ?? STORM_REGIONS.eu
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
export const lastReset = (region, now = Date.now()) => nextReset(region, nextReset(region, now) - WEEK - 2 * HOUR)

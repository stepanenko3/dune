// Буря Коріоліса за місцевим часом регіону: літо збігається з годинами трекерів, після переходу на зимовий час —
// на годину інакше; клієнт (ddReset.ts) і сервер (server/lib/storm.mjs — нагадування, перевірка TH.GL) рахують однаково.
import { describe, expect, it } from 'vitest'
import { firstStormOfWeek, lastReset, nextReset, REGIONS, type Region } from './ddReset'
// @ts-expect-error — серверний модуль без типів
import { lastReset as srvLast, nextReset as srvNext } from '../../server/lib/storm.mjs'

const at = (iso: string) => Date.parse(iso)
const iso = (ms: number) => new Date(ms).toISOString().replace('.000', '')
const ALL = Object.keys(REGIONS) as Region[]

describe('буря Коріоліса', () => {
  it('улітку — як у трекерах (червень 2025)', () => {
    const now = at('2025-06-23T00:00:00Z')
    expect(iso(nextReset('eu', now))).toBe('2025-06-24T03:00:00Z')
    expect(iso(nextReset('na', now))).toBe('2025-06-24T10:00:00Z')
    expect(iso(nextReset('sa', now))).toBe('2025-06-24T08:00:00Z')
    expect(iso(nextReset('oce', now))).toBe('2025-06-23T19:00:00Z')
  })

  it('після переходу на зимовий час: Європа й Америка — на годину пізніше, Океанія (літо там) — раніше', () => {
    const now = at('2026-11-02T00:00:00Z')
    expect(iso(nextReset('eu', now))).toBe('2026-11-03T04:00:00Z')
    expect(iso(nextReset('na', now))).toBe('2026-11-03T11:00:00Z')
    expect(iso(nextReset('sa', now))).toBe('2026-11-03T08:00:00Z')
    expect(iso(nextReset('oce', now))).toBe('2026-11-02T18:00:00Z')
  })

  it('тиждень з переходом: між бурями тиждень і година; остання буря — до now', () => {
    const now = at('2026-10-21T00:00:00Z')
    expect(iso(lastReset('eu', now))).toBe('2026-10-20T03:00:00Z')
    expect(iso(nextReset('eu', now))).toBe('2026-10-27T04:00:00Z')
    // рівно в мить бурі — наступна вже за тиждень
    const storm = at('2026-10-27T04:00:00Z')
    expect(iso(nextReset('eu', storm))).toBe('2026-11-03T04:00:00Z')
    expect(iso(lastReset('eu', storm))).toBe('2026-10-27T04:00:00Z')
  })

  it('перша буря тижня — в Океанії', () => {
    expect(iso(firstStormOfWeek(at('2026-10-20T03:00:00Z')))).toBe('2026-10-19T18:00:00Z')
    expect(iso(firstStormOfWeek(at('2025-06-24T10:00:00Z')))).toBe('2025-06-23T19:00:00Z')
  })

  it('клієнт і сервер рахують однаково (рік щогодини)', () => {
    const start = at('2026-01-01T00:30:00Z')
    for (let k = 0; k < 365 * 24; k += 7) {
      const now = start + k * 3600_000
      for (const r of ALL) {
        expect(nextReset(r, now)).toBe(srvNext(r, now))
        expect(lastReset(r, now)).toBe(srvLast(r, now))
        expect(nextReset(r, now)).toBeGreaterThan(now)
        expect(lastReset(r, now)).toBeLessThanOrEqual(now)
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import { COMBAT, atLevel, combatPoints, fmtKey, fmtPassive, keepGot, noSpecs, type Track } from './specs'

const t: Track = {
  id: 'x', name: 'X', icon: null, passive: [], xp: [0, 100, 205, 315],
  keys: [
    { level: 1, type: 'SkillPoints', name: 'Очки навичок', desc: '', icon: null, stats: [], sp: 3, spice: 2 },
    { level: 2, type: 'AttributeMod', name: 'Здоров\'я', desc: '', icon: null, stats: [{ name: 'Здоров\'я', value: 15, pct: false }], sp: 0, spice: 2 },
    { level: 3, type: 'AttributeMod', name: 'Здоров\'я', desc: '', icon: null, stats: [{ name: 'Здоров\'я', value: 5, pct: false }], sp: 0, spice: 5 },
  ],
}

describe('спеціалізації', () => {
  it('очки навичок — лише з куплених бойових рис (запасний розклад, поки даних немає)', () => {
    const s = noSpecs()
    expect(combatPoints(s)).toBe(0)
    s.lv[COMBAT] = 100
    expect(combatPoints(s)).toBe(0) // рівень сам очок не дає — риси треба купити
    s.got[COMBAT] = Array.from({ length: 41 }, (_, i) => i)
    expect(combatPoints(s)).toBe(54)
    s.got[COMBAT] = [0, 2]
    expect(combatPoints(s)).toBe(4)
    expect(combatPoints(s, t)).toBe(3) // з даними: риса 0 — 3 очки, риса 2 — без очок
  })
  it('пасивні бонуси й стати рис — як у грі', () => {
    expect(fmtPassive([0, 0.01, 0.02], 2)).toBe('+2%') // прибавка
    expect(fmtPassive([1, 1.005, 1.01], 1)).toBe('+0,5%') // множник
    expect(fmtKey({ name: '', value: -0.15, pct: true })).toBe('−15%')
    expect(fmtKey({ name: '', value: 5, pct: false })).toBe('+5')
  })
  it('куплені риси: сума однакових статів, меланж, очки; доступні — за рівнем', () => {
    const a = atLevel(t, 3, [1, 2])
    expect(a.sp).toBe(0)
    expect(a.spice).toBe(7)
    expect(a.stats).toEqual([{ name: 'Здоров\'я', value: 20, pct: false }])
    expect(a.open).toBe(3)
    expect(a.xp).toBe(315)
    expect(atLevel(t, 1, []).open).toBe(1)
  })
  it('рівень знизили — риси вище нього злітають', () => {
    expect(keepGot(t, 1, [0, 1, 2])).toEqual([0])
    expect(keepGot(null, 1, [0, 1, 2])).toEqual([0, 1, 2]) // без даних не знаємо рівнів — лишаємо
  })
})

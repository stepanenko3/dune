// Налаштування гри з DefaultGame.ini: ліміти полів меланжу по мапах, шторм Коріоліса й послідовність сідів.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseIni, parseUeStruct } from '../normalize/ini.mjs'
import { normalizeConfig } from '../normalize/config.mjs'

const ini = fs.readFileSync(new URL('./fixtures/DefaultGame.ini', import.meta.url), 'utf8')

describe('ini', () => {
  it('секції, ключі; масиви: ! очищує, . додає завжди, + — лише нове', () => {
    const s = parseIni(ini)['/Script/DuneSandbox.CoriolisSubsystem']
    expect(s.m_CycleDurationInDays).toEqual(['7'])
    expect(s.m_CycleSeeds).toEqual(['3', '4', '3'])
  })
  it('літерали структур UE', () => {
    expect(parseUeStruct('(("A", (B=1,C="x")),("D", (B=2)))')).toEqual([['A', { B: 1, C: 'x' }], ['D', { B: 2 }]])
  })
})

describe('налаштування гри', () => {
  const { blob } = normalizeConfig(ini)
  it('меланж: мапа → розмір → primed/active; темп', () => {
    expect(blob.spice.maps.DeepDesert_1.Large).toEqual({ primed: 1, active: 1 })
    expect(blob.spice.maps.Survival_1).toEqual({ Small: { primed: 5, active: 5 } })
    expect(blob.spice.primeRateSec).toBe(30)
  })
  it('Коріоліс: попередження, стадії (мультиплеєр), цикл і сіди', () => {
    expect(blob.coriolis).toEqual({ warningsHours: 6, stagesSec: [32400, 3540, 60, 60, 1740], sandstormPreventionSec: 600, cycleDays: 7, cycleStart: '2024-12-03T05:00:00Z', seeds: [3, 4, 3] })
  })
})

// Розклад розкладок Глибокої пустелі з DefaultGame.ini: цикл Коріоліса (старт, тривалість, сіди) і список розкладок
// WorldLayoutSubsystem (сід = індекс у списку; номер розкладки — з імені DA_DeepDesert_1_Layout_NN, тестові — без номера).
import { describe, expect, it } from 'vitest'
import { normalizeDdLayouts } from '../normalize/ddlayouts.mjs'

const L = (n) => `(Content="/Game/Dune/Maps/Arrakis/DeepDesert_1/Layouts/DA_DeepDesert_1_${n}.DA_DeepDesert_1_${n}",HeatMapSettings=(X="a"))`
const INI = `[/Script/DuneSandbox.CoriolisSubsystem]
m_CycleStartYear=2024
m_CycleStartMonth=12
m_CycleStartDay=3
m_CycleStartHour=5
m_CycleStartMinute=0
m_CycleDurationInDays=7
m_bUseRegionalOffset=True
!m_CycleSeeds=ClearArray
.m_CycleSeeds=3
.m_CycleSeeds=17

[/Script/DuneSandbox.WorldLayoutSubsystem]
m_WorldLayoutsPerWorld=(("/Game/Dune/Maps/Arrakis/DeepDesert_1/DeepDesert_1.DeepDesert_1", (WorldLayoutsSettingsList=(${[L('Layout_00'), L('Layout_03'), L('QA_Clusters'), L('Layout_18')].join(',')}),WorldLayoutIndexInSingleplayer=1)))
`

describe('розклад розкладок ГП', () => {
  it('цикл, сіди й номер розкладки кожного індексу', () => {
    expect(normalizeDdLayouts(INI)).toEqual({
      blob: { cycleStart: '2024-12-03T05:00:00Z', cycleDays: 7, regional: true, seeds: [3, 17], layouts: [0, 3, null, 18] },
    })
  })
  it('нема циклу чи списку — помилка розділу', () => {
    expect(() => normalizeDdLayouts('[/Script/DuneSandbox.CoriolisSubsystem]\nm_CycleDurationInDays=7')).toThrow()
  })
})

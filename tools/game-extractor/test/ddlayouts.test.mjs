// Розклад розкладок Глибокої пустелі з DefaultGame.ini: цикл Коріоліса (старт, тривалість, сіди) і список розкладок
// WorldLayoutSubsystem (сід = індекс у списку; номер розкладки — з імені DA_DeepDesert_1_Layout_NN, тестові — без номера).
import { describe, expect, it } from 'vitest'
import { ddLayoutSettings, normalizeDdLayouts } from '../normalize/ddlayouts.mjs'

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

describe('налаштування розкладок ГП: вміст і група карт тепла ресурсів', () => {
  const G = (n) => `/Game/Dune/Systems/GlobalDistribution/ResourceDistributionGroups/DA_DeepDesert_${n}DistributionGroup.DA_DeepDesert_${n}DistributionGroup`
  const S = (n, g) => `(Content="/Game/Dune/Maps/Arrakis/DeepDesert_1/Layouts/DA_DeepDesert_1_${n}.DA_DeepDesert_1_${n}",HeatMapSettings=(TagsDistributionBitMap="/Game/X.X",ResourceDistributionGroup="${g}",SandstormTreasureHeatMap="/Game/Y.Y"),MapLayerActor="/Game/Z.Z_C")`
  const ini = `[/Script/DuneSandbox.WorldLayoutSubsystem]\nm_WorldLayoutsPerWorld=(("/Game/Dune/Maps/Arrakis/DeepDesert_1/DeepDesert_1.DeepDesert_1", (WorldLayoutsSettingsList=(${[S('Layout_00', G('Layout00')), S('QA_Clusters', G('Layout01')), S('Layout_11', G('Layout11'))].join(',')}))))\n`
  it('номерна розкладка → пакет вмісту, групи й набору карт зон (тестові — ні)', () => {
    expect(ddLayoutSettings(ini)).toEqual([
      { layout: 0, content: 'DuneSandbox/Content/Dune/Maps/Arrakis/DeepDesert_1/Layouts/DA_DeepDesert_1_Layout_00', group: 'DuneSandbox/Content/Dune/Systems/GlobalDistribution/ResourceDistributionGroups/DA_DeepDesert_Layout00DistributionGroup', tags: 'DuneSandbox/Content/X' },
      { layout: 11, content: 'DuneSandbox/Content/Dune/Maps/Arrakis/DeepDesert_1/Layouts/DA_DeepDesert_1_Layout_11', group: 'DuneSandbox/Content/Dune/Systems/GlobalDistribution/ResourceDistributionGroups/DA_DeepDesert_Layout11DistributionGroup', tags: 'DuneSandbox/Content/X' },
    ])
  })
})

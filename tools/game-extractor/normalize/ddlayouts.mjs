/*
 * Розклад розкладок Глибокої пустелі з DefaultGame.ini: цикл Коріоліса (CoriolisSubsystem: старт, тривалість у днях,
 * регіональний зсув, сіди по тижнях) і список розкладок (WorldLayoutSubsystem: сід — індекс у списку). Номер розкладки —
 * з імені вмісту DA_DeepDesert_1_Layout_NN; тестові розкладки (QA) — null. Поточна розкладка = layouts[seeds[тиждень]].
 */
import { parseIni } from './ini.mjs'

const S = '/Script/DuneSandbox.'

export function normalizeDdLayouts(iniText) {
  const ini = parseIni(iniText)
  const c = ini[S + 'CoriolisSubsystem'] ?? {}
  const one = (k) => c[k]?.at(-1)
  const num = (k) => (one(k) == null ? null : Number(one(k)))
  const pad = (n) => String(n).padStart(2, '0')
  const seeds = (c.m_CycleSeeds ?? []).map(Number)
  const list = ini[S + 'WorldLayoutSubsystem']?.m_WorldLayoutsPerWorld?.at(-1) ?? ''
  const layouts = [...list.matchAll(/Content="[^"]*\/DA_DeepDesert_1_([A-Za-z_]+?)(\d+)?\.[^"]*"/g)].map((m) => (m[1] === 'Layout_' && m[2] ? Number(m[2]) : null))
  if (num('m_CycleStartYear') == null || num('m_CycleDurationInDays') == null || !seeds.length) throw new Error('нема циклу Коріоліса чи сідів')
  if (!layouts.length) throw new Error('нема списку розкладок Глибокої пустелі')
  return {
    blob: {
      cycleStart: `${num('m_CycleStartYear')}-${pad(num('m_CycleStartMonth'))}-${pad(num('m_CycleStartDay'))}T${pad(num('m_CycleStartHour') ?? 0)}:${pad(num('m_CycleStartMinute') ?? 0)}:00Z`,
      cycleDays: num('m_CycleDurationInDays'),
      regional: /^true$/i.test(one('m_bUseRegionalOffset') ?? ''),
      seeds,
      layouts,
    },
  }
}

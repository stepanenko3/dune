/*
 * Налаштування гри з DefaultGame.ini (сервер): ліміти полів меланжу по мапах і темп їх появи; шторм Коріоліса —
 * попередження, тривалості стадій (мультиплеєр), початок і довжина циклу, послідовність сідів (розкладки ГП).
 */
import { parseIni, parseUeStruct } from './ini.mjs'

const S = '/Script/DuneSandbox.'
const num = (v) => (v == null ? null : Number(v))

export function normalizeConfig(iniText) {
  const ini = parseIni(iniText)
  const sec = (name) => ini[S + name] ?? {}
  const one = (name, key) => sec(name)[key]?.at(-1)

  const maps = {}
  const per = one('SpiceHarvestingSystem', 'm_PerMapSystemSettings')
  for (const [map, settings] of per ? parseUeStruct(per) : []) {
    const sizes = {}
    for (const [type, lim] of settings?.m_SpiceFieldTypeSettings ?? []) sizes[type.Name] = { primed: lim.MaxGloballyPrimed, active: lim.MaxGloballyActive }
    maps[map] = sizes
  }

  const mp = 'CoriolisStormConfigMultiplayer'
  const stage = (n) => num(one(mp, `m_CoriolisStage${n}DurationInSeconds`) ?? one(mp, `m_CoriolisStage${n}DurationSeconds`))
  const c = (k) => num(one('CoriolisSubsystem', k))
  const pad = (n) => String(n).padStart(2, '0')
  const start = c('m_CycleStartYear') != null
    ? `${c('m_CycleStartYear')}-${pad(c('m_CycleStartMonth'))}-${pad(c('m_CycleStartDay'))}T${pad(c('m_CycleStartHour') ?? 0)}:${pad(c('m_CycleStartMinute') ?? 0)}:00Z`
    : null

  return {
    blob: {
      spice: { maps, primeRateSec: num(one('SpiceHarvestingSystem', 'm_PrimeRateInSeconds')) },
      coriolis: {
        warningsHours: num(one(mp, 'm_CoriolisSpawnWarningsDurationInHours')),
        stagesSec: [1, 2, 3, 4, 5].map(stage),
        sandstormPreventionSec: num(one(mp, 'm_CoriolisSandstormSpawnPreventionSeconds')),
        cycleDays: c('m_CycleDurationInDays'),
        cycleStart: start,
        seeds: (sec('CoriolisSubsystem').m_CycleSeeds ?? []).map(Number),
      },
    },
  }
}

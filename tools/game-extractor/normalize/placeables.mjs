/*
 * Розміщувані пристрої (CDT_PlaceableData) у формі каталогу сайту: група й тір — категорія й підкатегорія, як на сайті;
 * енергія — вироблення мінус споживання; нуль води/енергії — null («не стосується», як у каталозі). Службові рядки
 * (XX_, LOC_, DEBUG, «назва = id») — released:false.
 */
import { iconPath, nonZero, textOf } from './common.mjs'

const JUNK = /^(XX_|LOC_|DEBUG)/i

export function normalizePlaceables(rows) {
  return Object.entries(rows).map(([id, r]) => {
    const name = textOf(r.m_DisplayName)
    const tier = r.m_BuildableTier?.Name ?? ''
    return {
      id, name, icon: iconPath(r.m_BuildableIcon),
      grade: Number(/(\d+)/.exec(tier)?.[1] ?? 0),
      cat: (r.m_BuildableGroupType?.Name ?? '').toLowerCase(),
      sub: tier ? tier.toLowerCase() : null,
      power: nonZero((r.m_PowerProduction ?? 0) - (r.m_PowerConsumption ?? 0)),
      water: nonZero(r.m_WaterCapacity),
      waterRate: nonZero(r.m_WaterGenerationRateInSecs),
      released: !!name && !JUNK.test(name) && name !== id,
    }
  })
}

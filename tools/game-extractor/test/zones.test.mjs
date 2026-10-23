// Зона безпеки місця — з об'ємів BP_SecurityZone рівнів гри: найвищий пріоритет серед тих, що містять точку; поза
// об'ємами — зона за замовчуванням (ini). Правила зони (PvP / PvE / місто) — з DT_SecurityZones.
import { describe, expect, it } from 'vitest'
import { zoneAt } from '../normalize/zones.mjs'

const RULES = { NullSec: 'PvP', Security: 'PvE', Town: 'City' }
// об'єм: світовий трансформ { M (рядки = осі × масштаб), T }; куб пензля — ±100 одиниць у своїх осях
const box = (type, prio, T, s, yaw = 0) => {
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a)
  return { type, prio, M: [[c * s[0], sn * s[0], 0], [-sn * s[1], c * s[1], 0], [0, 0, s[2]]], T }
}

describe('зона безпеки місця', () => {
  const zones = [box('Security', 100, [0, 0, 0], [8000, 8000, 4000]), box('NullSec', 200, [10000, 0, 0], [50, 20, 50], 90)]
  it('усередині великого PvE-об’єму — PvE; у меншому PvP з вищим пріоритетом — PvP (з поворотом об’єму)', () => {
    expect(zoneAt(zones, [500000, 500000, 0], RULES, 'NullSec')).toBe('PvE')
    // поворот на 90°: вздовж X гри об'єм вузький (±20 × 100), вздовж Y — широкий (±50 × 100)
    expect(zoneAt(zones, [10000, 4000, 0], RULES, 'NullSec')).toBe('PvP')
    expect(zoneAt(zones, [13000, 0, 0], RULES, 'NullSec')).toBe('PvE')
  })
  it('поза об’ємами — зона за замовчуванням; місто — свої правила', () => {
    expect(zoneAt(zones, [2e6, 0, 0], RULES, 'NullSec')).toBe('PvP')
    expect(zoneAt([box('Town', 999, [0, 0, 0], [10, 10, 10])], [0, 0, 0], RULES, 'NullSec')).toBe('City')
  })
})

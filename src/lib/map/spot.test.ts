import { describe, expect, it } from 'vitest'
import { bestSpot } from './spot.mjs'

describe('найкраща точка для полів меланжу', () => {
  it('точка, з якої в межах радіуса найбільше середніх і великих полів (а не сектор з найбільшою кількістю)', () => {
    // скупчення з 4 полів біля (1000, 1000) і 3 поля далеко одне від одного
    const fields = [[1000, 1000, 'medium'], [1300, 1000, 'medium'], [1000, 1300, 'large'], [1200, 1200, 'medium'], [9000, 0, 'large'], [0, 9000, 'medium'], [5000, 5000, 'medium']] as [number, number, 'medium' | 'large'][]
    const r = bestSpot(fields, 800)!
    expect(r.n).toBe(4)
    expect(r.large).toBe(1)
    expect(Math.hypot(r.x - 1125, r.y - 1125)).toBeLessThan(150)
  })
  it('рівно — більше великих полів', () => {
    const r = bestSpot([[0, 0, 'medium'], [100, 0, 'medium'], [9000, 0, 'large'], [9100, 0, 'large']], 500)!
    expect(r.large).toBe(2)
  })
  it('полів нема — null', () => {
    expect(bestSpot([], 500)).toBeNull()
  })
  it('поля однієї величини (зокрема малі) — точка лише за ними', () => {
    const r = bestSpot([[0, 0, 'small'], [100, 0, 'small'], [200, 0, 'small'], [9000, 0, 'small']], 500)!
    expect(r.n).toBe(3)
    expect(r.large).toBe(0)
  })
})

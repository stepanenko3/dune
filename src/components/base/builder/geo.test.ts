import { describe, expect, it, vi } from 'vitest'

// рушій (window) тут не потрібен — лише геометрія плиток
vi.mock('@/lib/engine', () => ({ GEOM: {}, BASEDATA: {} }))

const { cellAt, cellSquare, cellsIn, gridNear, gridOf, pt } = await import('./geo')

/* eslint-disable @typescript-eslint/no-explicit-any */
/** приміщення з квадратів x0…x1 × y0…y1 (кути можуть бути й на пів плитки) */
const room = (id: string, x0: number, x1: number, y0: number, y1: number): any => {
  const tiles = []
  for (let x = x0; x < x1 - 1e-9; x++) for (let y = y0; y < y1 - 1e-9; y++) tiles.push(cellSquare(x, y))
  return { id, tiles }
}
// як на Main: піраміда x −4.5…4.5 (пів плитки), поруч — приміщення в цілій сітці
const pyr = room('pyr', -4.5, 4.5, 12, 17)
const shed = room('shed', 10, 13, 12, 15)
const turned = { id: 'turned', tiles: [{ k: 's' as const, p: [pt(0, 0), pt(0.866025, 0.5), pt(0.366025, 1.366025), pt(-0.5, 0.866025)] }] }

describe('сітка клітинок', () => {
  it('сітка приміщення — дробові частини його країв уздовж осей', () => {
    expect(gridOf(pyr)).toEqual({ x: 0.5, y: 0 })
    expect(gridOf(shed)).toEqual({ x: 0, y: 0 })
    expect(gridOf(turned)).toBeNull() // усе повернуте — сітки немає
  })

  it('рамка біля піраміди — у її сітці; клітинки стають упритул до її краю', () => {
    const a = { x: 4.7, y: 12.2 }, b = { x: 6.4, y: 13.8 }
    const g = gridNear([shed, pyr], a, b)
    expect(g).toEqual({ x: 0.5, y: 0 })
    const cells = cellsIn(a, b, g)
    expect(cells).toHaveLength(4)
    expect(cells[0].p).toEqual([pt(4.5, 12), pt(5.5, 12), pt(5.5, 13), pt(4.5, 13)])
    expect(cellAt({ x: -4.7, y: 12.3 }, g).p[0]).toEqual(pt(-5.5, 12))
  })

  it('рамка торкається обох — сітка того, біля якого її почали; далеко від усього — ціла', () => {
    const nearPyr = { x: 6, y: 13 }, nearShed = { x: 8.5, y: 13 }
    expect(gridNear([shed, pyr], nearPyr, nearShed)).toEqual({ x: 0.5, y: 0 })
    expect(gridNear([pyr, shed], nearShed, nearPyr)).toEqual({ x: 0, y: 0 })
    expect(gridNear([pyr], { x: 9, y: 20 }, { x: 5.5, y: 16 })).toEqual({ x: 0.5, y: 0 }) // почали далеко, дотягли до піраміди
    expect(gridNear([pyr, shed], { x: 30, y: 30 })).toEqual({ x: 0, y: 0 })
    expect(cellAt({ x: 5.2, y: 3.7 }, gridNear([pyr], { x: 5.2, y: 3.7 })).p[0]).toEqual(pt(5, 3))
  })

  it('те, що будуємо, важить більше за ближче приміщення, якщо воно поруч', () => {
    expect(gridNear([shed, pyr], { x: 8.5, y: 13 }, { x: 6, y: 13 }, pyr)).toEqual({ x: 0.5, y: 0 })
    expect(gridNear([shed, pyr], { x: 14, y: 13 }, undefined, pyr)).toEqual({ x: 0, y: 0 }) // будуємо далеко звідси
  })
})

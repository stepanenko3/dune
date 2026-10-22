import { describe, expect, it, vi } from 'vitest'

// справжні деталі рушія (без вікна браузера)
vi.mock('@/lib/engine', async () => {
  // @ts-expect-error — рушій на чистому JS
  const p: any = await import('@/engine/pieces.js') // eslint-disable-line @typescript-eslint/no-explicit-any
  return { PIECES: p.default ?? (globalThis as any).PIECES } // eslint-disable-line @typescript-eslint/no-explicit-any
})
const { alignItem, EDGE_GAP } = await import('./align')

/* eslint-disable @typescript-eslint/no-explicit-any */
const trap = (x: number, y: number, z = 5): any => ({ kind: 'windtrap', name: 'w', c: { x, y }, w: 1.5, d: 1.5, h: 2.6, z, ang: 0 })

describe('вирівнювання станцій', () => {
  it('в лінію з сусідом: центр притягується, напрямна — від станції до сусіда', () => {
    const r = alignItem({ pieces: [], items: [trap(0, 0)] }, trap(0.18, 3))
    expect(r.c).toEqual({ x: 0, y: 3 })
    expect(r.kinds).toEqual(['line'])
    expect(r.guides[0]).toMatchObject({ a: { x: 0 }, b: { x: 0 }, kind: 'line' })
  })
  it('далеко від усього — без змін і без напрямних', () => {
    const r = alignItem({ pieces: [], items: [trap(0, 0)] }, trap(0.6, 3))
    expect(r.c).toEqual({ x: 0.6, y: 3 })
    expect(r.guides).toEqual([])
  })
  it('від краю: 0,1 від поручня на тому самому рівні', () => {
    const rail = { id: 'r', shape: 'Sardaukar_Railing', x: 3, y: 0.5, z: 5, rot: 90 } // край x = 3, y 0…1
    const r = alignItem({ pieces: [rail], items: [] }, trap(2.05, 0.5))
    expect(r.c.x).toBeCloseTo(3 - EDGE_GAP - 0.75, 6)
    expect(r.kinds).toEqual(['edge'])
  })
  it('рівний крок: проміжок як між двома сусідами в ряду', () => {
    const r = alignItem({ pieces: [], items: [trap(0, 0), trap(1.6, 0)] }, trap(3.3, 0.05))
    expect(r.c).toEqual({ x: 3.2, y: 0 })
    expect(r.kinds).toContain('gap')
  })
  it('інший рівень і косий поворот — не сусіди', () => {
    expect(alignItem({ pieces: [], items: [trap(0, 0, 9)] }, trap(0.1, 3)).c).toEqual({ x: 0.1, y: 3 })
    expect(alignItem({ pieces: [], items: [{ ...trap(0, 0), ang: 30 }] }, trap(0.1, 3)).c).toEqual({ x: 0.1, y: 3 })
  })
})

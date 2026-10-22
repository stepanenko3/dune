import { beforeEach, describe, expect, it, vi } from 'vitest'

// справжні деталі рушія (без вікна браузера); рівні й підписи будівельника тут не потрібні
vi.mock('@/lib/engine', async () => {
  // @ts-expect-error — рушій на чистому JS
  const g: any = await import('@/engine/geom.js') // eslint-disable-line @typescript-eslint/no-explicit-any
  // @ts-expect-error — рушій на чистому JS
  const p: any = await import('@/engine/pieces.js') // eslint-disable-line @typescript-eslint/no-explicit-any
  return { GEOM: g.default ?? (globalThis as any).GEOM, PIECES: p.default ?? (globalThis as any).PIECES, BASEDATA: { syncDoc: (d: unknown) => d }, CONVERT: {} } // eslint-disable-line @typescript-eslint/no-explicit-any
})
const { useBuilder } = await import('./store')
const { moveSelected, shiftSel } = await import('./move')

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = (id: string, shape: string, x: number, y: number, z = 0, rot = 0): any => ({ id, shape, x, y, z, rot })
const open = (pieces: any[], items: any[] = []) =>
  useBuilder.getState().init({ id: 't', version: 1, doc: { format: 2, pieces, items, zones: [], claims: [{ x: -5, y: 0, w: 10, d: 10 }], levels: [], heights: {}, ui: { name: 'т' } }, updated: 0, note: '', deleted: null })
const at = (id: string) => useBuilder.getState().doc.pieces.find((p: any) => p.id === id)

describe('зсув вибраного', () => {
  beforeEach(() => open([P('a', 'Sardaukar_Foundation', 0.5, 0.5), P('w', 'Sardaukar_Wall_01', 0.5, 0, 0, 0), P('b', 'Sardaukar_Foundation', 2.5, 0.5)], [{ name: 'Верстак', kind: 'craft', w: 1, d: 1, h: 1, c: { x: 0.5, y: 3 }, z: 0, ang: 0 }]))

  it('деталі — на клітинку; стрілки поспіль — один крок «скасувати»', () => {
    useBuilder.getState().set({ sel: { kind: 'pieces', ids: ['a', 'w'] } })
    expect(moveSelected(0, 1, 'arrows')).toBe(null)
    expect(moveSelected(0, 1, 'arrows')).toBe(null)
    expect(at('a')).toMatchObject({ x: 0.5, y: 2.5 })
    expect(at('w')).toMatchObject({ x: 0.5, y: 2 })
    expect(useBuilder.getState().past).toHaveLength(1)
    useBuilder.getState().undo()
    expect(at('a')).toMatchObject({ x: 0.5, y: 0.5 })
  })

  it('на місце невибраної деталі — не пускає й каже чому; документ той самий', () => {
    useBuilder.getState().set({ sel: { kind: 'pieces', ids: ['a'] } })
    const before = useBuilder.getState().doc
    expect(moveSelected(2, 0)).toMatch(/Там уже фундамент/)
    expect(useBuilder.getState().doc).toBe(before)
    // примара перетягування бачить те саме
    expect(shiftSel(before as any, useBuilder.getState().sel, 2, 0)?.why).toMatch(/фундамент/)
    expect(shiftSel(before as any, useBuilder.getState().sel, 1, 0)?.why).toBe(null)
  })

  it('станція — з кроком 0,1, але не за стіну', () => {
    useBuilder.getState().set({ sel: { kind: 'item', i: 0 } })
    expect(moveSelected(0.1, 0)).toBe(null)
    expect(useBuilder.getState().doc.items[0].c).toEqual({ x: 0.6, y: 3 })
    expect(moveSelected(0, -3)).toMatch(/за стіну/)
    expect(useBuilder.getState().doc.items[0].c).toEqual({ x: 0.6, y: 3 })
  })
})

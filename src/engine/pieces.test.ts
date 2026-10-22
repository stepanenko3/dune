import { describe, expect, it } from 'vitest'
// @ts-expect-error — рушій на чистому JS, без типів
import * as m from './pieces.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
const P: any = (m as any).default ?? (globalThis as any).PIECES

const pc = (shape: string, x: number, y: number, z = 0, rot = 0) => ({ id: 'p', shape, x, y, z, rot })

describe('будівельні деталі', () => {
  it('усі форми гри: 132 деталі наборів + 2 поверхні пентащита; у кожної — геометрія й ціна', () => {
    const ids = Object.keys(P.SHAPES)
    expect(ids.length).toBe(134)
    for (const id of ids) {
      const g = P.geom(pc(id, 0.5, 0.5))
      expect(g.faces.reduce((n: number, f: any) => n + f.tris.length, 0), id).toBeGreaterThan(0)
      expect(P.SHAPES[id].cost.length, id).toBeGreaterThan(0)
    }
    expect(P.SHAPES['Sardaukar_Foundation'].cost).toEqual([['Stone', 15]])
    // ціни — з даних гри (у вікі Prudence-двері коштували ще й 20 залізних злитків — у грі нема)
    expect(P.SHAPES['MTX_Neut_DesertMechanic_Prudence_Door_Frame'].cost).toEqual([['Stone', 10]])
  })

  it('слід: плитка, край, висоти', () => {
    const f = P.footprint(pc('Sardaukar_Foundation', 0.5, 0.5))
    expect(f.at).toBe('tile')
    expect(f.poly.map((q: any) => [q.x, q.y])).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]])
    expect([f.z0, f.z1]).toEqual([-0.3, 0])
    const w = P.footprint(pc('Sardaukar_Wall_01', 0.5, 0, 0))
    expect(w.seg).toEqual({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } })
    expect([w.z0, w.z1]).toEqual([0, 1])
    expect(P.footprint(pc('Sardaukar_Wall_Half', 0.5, 0)).z1).toBe(0.5)
    expect(P.footprint(pc('Atreides_Outpost_Gate_Big', 1.5, 0)).seg).toEqual({ a: { x: 0, y: 0 }, b: { x: 3, y: 0 } })
    // трикутник: основа (0,0)–(1,0), вершина вгорі
    const t = P.footprint(pc('Sardaukar_Foundation_Wedge', 0.5, P.RI))
    expect(t.poly.map((q: any) => [Math.round(q.x * 1000) / 1000, Math.round(q.y * 1000) / 1000])).toEqual([[0, 0], [1, 0], [0.5, 0.866]])
  })

  it('перетин: та сама прив\'язка й висоти перекриваються', () => {
    expect(P.clash(pc('Sardaukar_Wall_01', 0.5, 0, 0), pc('Choam_Level2_Door_Frame', 0.5, 0, 0.5))).toBe(true)
    expect(P.clash(pc('Sardaukar_Wall_01', 0.5, 0, 0), pc('Sardaukar_Wall_01', 0.5, 0, 1))).toBe(false) // стіна на стіні
    expect(P.clash(pc('Sardaukar_Wall_01', 0.5, 0, 0, 0), pc('Sardaukar_Wall_01', 0.5, 0, 0, 180))).toBe(true) // той самий край навпаки
    expect(P.clash(pc('Sardaukar_Door_Frame_Wide', 1, 0, 0), pc('Sardaukar_Wall_01', 1.5, 0, 0.5))).toBe(true) // широка зачіпає сусідній край
    expect(P.clash(pc('Sardaukar_Foundation', 0.5, 0.5, 0), pc('Sardaukar_Floor_02', 0.5, 0.5, 0))).toBe(true)
    expect(P.clash(pc('Sardaukar_Foundation', 0.5, 0.5, 0), pc('Sardaukar_Stairs', 0.5, 0.5, 0))).toBe(false) // сходи на фундаменті
    expect(P.clash(pc('Sardaukar_Wall_01', 0.5, 0, 0), pc('Sardaukar_Foundation', 0.5, 0.5, 0))).toBe(false) // різна прив'язка
  })

  it('скат піднімається вздовж локальної +y на блок; кут — лише одна вершина вгорі', () => {
    const zs = (shape: string) => { const t = P.geom(pc(shape, 0.5, 0.5, 2)).faces.flatMap((f: any) => f.tris.filter((_: number, i: number) => i % 3 === 2)); return [Math.min(...t), Math.max(...t)] }
    expect(zs('Sardaukar_Roof_01')).toEqual([1.88, 3]) // з товщиною під скатом
    // сходи й пандуси — похила плита (під нею порожньо): низ — лише товщина під нижнім краєм
    expect(zs('Sardaukar_Stairs')).toEqual([1.88, 3])
    expect(zs('Sardaukar_Ramp_Half')).toEqual([1.88, 2.5])
  })

  it('похила стіна: 3 блоки вгору на блок усередину, під нею порожньо, низ не нижче підлоги', () => {
    const g = P.geom(pc('Harkonnen_Outpost_Wall_Inclined_Tall', 0.5, 0.5, 5))
    const pts: number[][] = []
    for (const f of g.faces) for (let i = 0; i < f.tris.length; i += 3) pts.push([f.tris[i], f.tris[i + 1], f.tris[i + 2]])
    expect(Math.min(...pts.map((q) => q[2]))).toBe(5)
    expect(Math.max(...pts.map((q) => q[2]))).toBe(8)
    // верх — над внутрішнім краєм плитки (локальне +y), низ — на зовнішньому
    expect(Math.min(...pts.filter((q) => q[2] > 7.99).map((q) => q[1]))).toBeCloseTo(1, 6)
    expect(Math.max(...pts.filter((q) => q[2] < 5.01).map((q) => q[1]))).toBeCloseTo(0, 6)
    // не суцільна: точок на висоті 6,5 біля зовнішнього краю нема
    expect(pts.some((q) => q[2] > 6 && q[2] < 7 && q[1] < 0.2)).toBe(false)
    expect(P.SHAPES['Harkonnen_Outpost_Wall_Inclined_Tall'].kind).toBe('lean')
  })

  it('заміна: лише форми тієї самої прив\'язки й довжини; дзеркальна пара', () => {
    const r = P.replacements('Sardaukar_Wall_01')
    expect(r).toContain('Choam_Level2_Door_Frame')
    expect(r).toContain('Choam_PentashieldSurfaceVertical_Placeable')
    expect(r).not.toContain('Atreides_Outpost_Gate_Big') // на три краї
    expect(r).not.toContain('Sardaukar_Foundation')
    expect(P.MIRROR.Sardaukar_Door_Frame_L).toBe('Sardaukar_Door_Frame')
    expect(P.MIRROR.Sardaukar_Wall_Triangle_Bottom_Left).toBe('Sardaukar_Wall_Triangle_Bottom_Right')
  })
  it('скат під стелею (плита на висоті його верху) — не зіткнення; плита посередині ската — зіткнення', () => {
    expect(P.clash(pc('Sardaukar_Ramp', 0.5, 0.5, 3), pc('Sardaukar_Floor_02', 0.5, 0.5, 4))).toBe(false)
    expect(P.clash(pc('Sardaukar_Ramp', 0.5, 0.5, 3), pc('Sardaukar_Floor_02', 0.5, 0.5, 3))).toBe(false)
    expect(P.clash(pc('Harkonnen_Outpost_Wall_Inclined_Tall', 0.5, 0.5, 3), pc('Sardaukar_Floor_02', 0.5, 0.5, 4))).toBe(true)
  })
  it('форми — рядки гри: id вікі й давніх наших форм нема, перенесення тут теж нема (лише разова міграція)', () => {
    for (const id of ['foundation', 'wall', 'gate_3x2', 'wall_incline', 'shield_wall']) expect(P.SHAPES[id]).toBeUndefined()
    expect(P.migrate).toBeUndefined()
    expect(P.SHAPES.Sardaukar_Foundation).toMatchObject({ family: 'slab', cat: 'found', cost: [['Stone', 15]] })
    expect(P.MIRROR.Sardaukar_Wall_02).toBe('Sardaukar_Wall_02_L')
  })
})

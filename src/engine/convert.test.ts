import { describe, expect, it } from 'vitest'
// @ts-expect-error — рушій на чистому JS, без типів
import * as c from './convert.js'
// @ts-expect-error — рушій на чистому JS, без типів
import * as g from './geom.js'
// @ts-expect-error — рушій на чистому JS, без типів
import * as pc from './pieces.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
const C: any = (c as any).default ?? (globalThis as any).CONVERT
const G: any = (g as any).default ?? (globalThis as any).GEOM
const P: any = (pc as any).default ?? (globalThis as any).PIECES
const sq = (x: number, y: number) => ({ k: 's', p: [{ x, y }, { x: x + 1, y }, { x: x + 1, y: y + 1 }, { x, y: y + 1 }] })
const room = (id: string, x0: number, x1: number, z0: number, h: number, extra: any = {}) => {
  const tiles = []
  for (let x = x0; x < x1; x++) tiles.push(sq(x, 0))
  return { id, name: id, group: 'core', z0, h, tiles, open: [], items: [], roof: 'solid', ...extra }
}
const count = (d: any, shape: string) => d.pieces.filter((p: any) => p.shape === shape).length

describe('перетворення старої бази в деталі', () => {
  it('кімната 2×1 на землі заввишки 2: фундамент, стіни поштучно, дах; зона з явними плитками', () => {
    const { doc2 } = C.toPieces({ rooms: [room('a', 0, 2, 0, 2)], claims: [], ui: {}, levels: [], heights: {} })
    expect(doc2.format).toBe(2)
    expect(count(doc2, 'Sardaukar_Foundation')).toBe(2)
    expect(count(doc2, 'Sardaukar_Wall_01')).toBe(12) // 6 країв × 2 блоки
    expect(count(doc2, 'Sardaukar_Rooftop_01')).toBe(2)
    expect(doc2.pieces.find((p: any) => p.shape === 'Sardaukar_Rooftop_01').z).toBe(2)
    expect(doc2.zones).toEqual([expect.objectContaining({ id: 'a', z: 0, tiles: ['500,500', '1500,500'] })])
  })

  it('двері без висоти — високі двері й стіна над ними; висота на пів блоку — напівстіна вгорі', () => {
    const r = room('a', 0, 1, 0, 3.5, { open: [{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, type: 'door' }] })
    const { doc2, notes } = C.toPieces({ rooms: [r], claims: [], ui: {}, levels: [], heights: {} })
    const front = doc2.pieces.filter((p: any) => Math.abs(p.y) < 1e-6 && Math.abs(p.x - 0.5) < 1e-6).sort((a: any, b: any) => a.z - b.z)
    expect(front.map((p: any) => `${p.shape}@${p.z}`)).toEqual(['Atreides_Outpost_Door_Frame_Tall@0', 'Sardaukar_Wall_01@2', 'Sardaukar_Wall_Half@3'])
    expect(notes.join(' ')).toContain('високі двері')
  })

  it('прохід між двома кімнатами — порожній край; зони лишаються окремими; станції — з висотою', () => {
    const a = room('a', 0, 1, 0, 2, { items: [{ name: 'Склад', kind: 'storage', c: { x: 0.5, y: 0.5 }, w: 0.5, d: 0.5, h: 1, ang: 0 }] })
    const b = room('b', 1, 2, 0, 2, { open: [{ a: { x: 1, y: 0 }, b: { x: 1, y: 1 }, type: 'open' }] })
    const { doc2 } = C.toPieces({ rooms: [a, b], claims: [], ui: {}, levels: [], heights: {} })
    const mid = doc2.pieces.filter((p: any) => Math.abs(p.x - 1) < 1e-6 && Math.abs(p.y - 0.5) < 1e-6 && G.edgeKey)
    expect(mid).toEqual([])
    expect(doc2.zones.map((z: any) => z.id)).toEqual(['a', 'b'])
    expect(doc2.items).toEqual([expect.objectContaining({ name: 'Склад', z: 0 })])
  })

  it('палуба — перекриття й поручні по краях (не там, де підлога тягнеться далі)', () => {
    const deck = room('deck', 0, 2, 5, 0, { roof: 'none' })
    const { doc2 } = C.toPieces({ rooms: [deck], claims: [], ui: {}, levels: [], heights: {} })
    expect(count(doc2, 'Sardaukar_Floor_02')).toBe(2)
    expect(count(doc2, 'Sardaukar_Railing')).toBe(6)
    expect(doc2.pieces.find((p: any) => p.shape === 'Sardaukar_Railing').z).toBe(5)
  })
  it('скатний ярус: кільце скатів по краю (кути — кутовими), усередині — плаский дах на блок вище; шатро — до верху', () => {
    const tiles = []
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) tiles.push(sq(x, y))
    const r = { ...room('a', 0, 1, 0, 2), tiles, roof: 'tier' }
    const { doc2, notes } = C.toPieces({ rooms: [r], claims: [], ui: {}, levels: [], heights: {} })
    expect(count(doc2, 'Sardaukar_Roof_01')).toBe(8)
    expect(count(doc2, 'Sardaukar_Roof_Corner')).toBe(4)
    const flat = doc2.pieces.filter((p: any) => p.shape === 'Sardaukar_Rooftop_01')
    expect(flat.map((p: any) => p.z)).toEqual([3, 3, 3, 3])
    expect(notes.join(' ')).not.toContain('пласким дахом')
    // скат дивиться вгору всередину: лівий край (x = 0) — локальне +y уздовж +x
    const left = doc2.pieces.find((p: any) => p.shape === 'Sardaukar_Roof_01' && p.x === 0.5 && p.y === 1.5)
    const a = (left.rot * Math.PI) / 180
    expect(Math.round(-Math.sin(a))).toBe(1)
    const pyr = C.toPieces({ rooms: [{ ...r, roof: 'pyramid' }], claims: [], ui: {}, levels: [], heights: {} }).doc2
    expect(count(pyr, 'Sardaukar_Roof_01') + count(pyr, 'Sardaukar_Roof_Corner')).toBe(16) // 12 + 4 — друге кільце (2×2) — самі кути
    expect(Math.max(...pyr.pieces.map((p: any) => p.z))).toBe(3)
  })
  it('похилі стіни: по зовнішніх краях — похилі панелі (кути — кутові), вище — стіна на блок усередині, дах — над серединою', () => {
    const tiles = []
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) tiles.push(sq(x, y))
    const a = { ...room('a', 0, 1, 0, 4), tiles, lean: 3 }
    // сусід праворуч на тій самій висоті — там край не похилий
    const b = { ...room('b', 3, 4, 0, 4), tiles: [sq(3, 0), sq(3, 1), sq(3, 2)] }
    const { doc2 } = C.toPieces({ rooms: [a, b], claims: [], ui: {}, levels: [], heights: {} })
    expect(count(doc2, 'Harkonnen_Outpost_Wall_Inclined_Tall')).toBe(5) // ліва середина, низ і верх (по 2 — праві кінці впираються в «b»)
    expect(count(doc2, 'Harkonnen_Outpost_Wall_Corner_Tall')).toBe(2) // лише кути, де обидва краї зовнішні (зліва)
    const lean = doc2.pieces.filter((p: any) => P.SHAPES[p.shape].kind === 'lean')
    expect(lean.every((p: any) => p.z === 0)).toBe(true)
    // спільний край із «b» (x = 3) — звичайні стіни від підлоги
    expect(doc2.pieces.filter((p: any) => p.shape === 'Sardaukar_Wall_01' && Math.abs(p.x - 3) < 1e-6 && p.y > 0 && p.y < 3 && p.z === 0).length).toBe(3)
    // зовнішній край x = 0 — жодної вертикальної стіни
    expect(doc2.pieces.filter((p: any) => p.shape === 'Sardaukar_Wall_01' && Math.abs(p.x) < 1e-6).length).toBe(0)
    // стіна над похилою — на лінії x = 1, з висоти 3
    expect(doc2.pieces.filter((p: any) => p.shape === 'Sardaukar_Wall_01' && Math.abs(p.x - 1) < 1e-6 && p.y > 1 && p.y < 2).map((p: any) => p.z)).toEqual([3])
    // дах — лише над плитками без похилої стіни
    expect(doc2.pieces.filter((p: any) => p.shape === 'Sardaukar_Rooftop_01' && p.x < 3).map((p: any) => `${p.x},${p.y}`).sort()).toEqual(['1.5,1.5', '2.5,1.5'])
  })
  it('трикутників-скатів і трикутних похилих стін у грі нема: трикутник на краю — пласкі дах на висоті стін і звичайна стіна', () => {
    const tiles: any[] = []
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) tiles.push(sq(x, y))
    const h = Math.sqrt(3) / 2
    tiles.push({ k: 't', p: [{ x: 3, y: 0 }, { x: 3 + h, y: 0.5 }, { x: 3, y: 1 }] }) // трикутник праворуч від квадратів
    const r = { ...room('a', 0, 1, 0, 4), tiles, roof: 'tier', lean: 3 }
    const { doc2 } = C.toPieces({ rooms: [r], claims: [], ui: {}, levels: [], heights: {} })
    expect(doc2.pieces.some((p: any) => P.SHAPES[p.shape].cat === 'roof' && P.SHAPES[p.shape].family === 'slope' && P.SHAPES[p.shape].tile === 't')).toBe(false)
    expect(doc2.pieces.filter((p: any) => p.shape === 'Sardaukar_Rooftop_Wedge').map((p: any) => p.z)).toEqual([4])
    // на краях трикутника — звичайні стіни від підлоги
    expect(doc2.pieces.filter((p: any) => p.shape === 'Sardaukar_Wall_01' && p.x > 3 && p.z === 0).length).toBe(2)
  })
  it('кінець похилої ділянки біля прямої стіни — висока трикутна стіна прямим боком на краю', () => {
    const tiles = []
    for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) tiles.push(sq(x, y))
    // лівий край x = 0: похилий лише на y 0…1 (далі — прямий), решта країв — прямі
    const r = { ...room('a', 0, 1, 0, 4), tiles, lean: 3, leanSkip: [{ a: { x: 0, y: 1 }, b: { x: 0, y: 3 } }, { a: { x: 0, y: 0 }, b: { x: 3, y: 0 } }, { a: { x: 3, y: 0 }, b: { x: 3, y: 3 } }, { a: { x: 0, y: 3 }, b: { x: 3, y: 3 } }] }
    const { doc2 } = C.toPieces({ rooms: [r], claims: [], ui: {}, levels: [], heights: {} })
    expect(count(doc2, 'Harkonnen_Outpost_Wall_Inclined_Tall')).toBe(1)
    const tw = doc2.pieces.filter((p: any) => p.shape === 'Sardaukar_Wall_Triangle_Top_Tall_Left')
    expect(tw.length).toBe(1)
    expect(tw[0]).toMatchObject({ x: 0.5, y: 1, z: 0, rot: 0 }) // від краю (0, 1) усередину до (1, 1)
    expect(P.SHAPES['Sardaukar_Wall_Triangle_Top_Tall_Left'].h).toBe(3)
  })
})

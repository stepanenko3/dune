import { describe, expect, it } from 'vitest'
import { bestCells, finderLayers } from './best'

// сітка 0…900 по обох осях, 9×9: клітинка 100×100; ряд A — найбільший x, стовпець 1 — найменший y
const G = { x0: 0, x1: 900, y0: 0, y1: 900, n: 9 }
const pts = (list: [number, number][]) => list.flatMap(([x, y]) => [x, y, 0])

describe('найкращі місця шару', () => {
  it('ГП (сектори): усі чисті острівці (багато місць, де руда завжди одна); очікувана кількість — за жеребом місць', () => {
    const P: [number, number][] = [], share: number[] = [], pick: number[] = []
    const add = (x: number, y: number, n: number, sh: number, pk = 1) => { for (let i = 0; i < n; i++) { P.push([x, y + i * 0.1]); share.push(sh); pick.push(pk) } }
    add(50, 50, 25, 100) // I1 — острівець
    add(850, 850, 22, 100) // A9 — острівець
    add(450, 450, 80, 16, 0) // E5 — змішані, жереб випав на іншу руду
    add(450, 460, 10, 16, 1)
    const r = bestCells(pts(P), { share, pick, grid: G, sectors: true })
    expect(r.map((c) => [c.label, c.n, c.island])).toEqual([['I1', 25, true], ['A9', 22, true]])
  })
  it('без чистих острівців — до трьох найкращих за певністю; без частки (лут, рослини) — за кількістю', () => {
    const r = bestCells(pts([[50, 50], [50, 60], [450, 450], [850, 850], [850, 860], [850, 870]]), { grid: G, sectors: true })
    expect(r.map((c) => [c.label, c.n])).toEqual([['A9', 3], ['I1', 2], ['E5', 1]])
  })
  it('мапа без секторів — ділянки сітки з номером місця', () => {
    const r = bestCells(pts([[10, 10], [20, 20], [500, 500]]), { grid: { x0: 0, x1: 1000, y0: 0, y1: 1000, n: 10 }, sectors: false })
    expect(r[0]).toMatchObject({ label: '1', n: 2, x0: 0, x1: 100, y0: 0, y1: 100 })
  })
  it('шар без змішаних місць (рослини: частка 100 скрізь) — не острівці, а три найкращі ділянки', () => {
    const P: [number, number][] = [], share: number[] = []
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let i = 0; i < 25 + r * 9 + c; i++) { P.push([r * 100 + 50, c * 100 + 50 + i * 0.1]); share.push(100) }
    const res = bestCells(pts(P), { share, grid: G, sectors: true })
    expect(res.map((c) => [c.label, c.island])).toEqual([['A9', false], ['A8', false], ['A7', false]])
  })
  it('поза секторами ГП (інші мапи) — без острівців, три найкращі ділянки', () => {
    const P: [number, number][] = [], share: number[] = []
    const add = (x: number, y: number, n: number, sh: number) => { for (let i = 0; i < n; i++) { P.push([x, y + i * 0.1]); share.push(sh) } }
    add(50, 50, 30, 100)
    add(850, 850, 25, 100)
    add(450, 450, 22, 100)
    add(250, 250, 21, 100)
    add(650, 650, 40, 16)
    const res = bestCells(pts(P), { share, grid: G, sectors: false })
    expect(res).toHaveLength(3)
    expect(res.every((c) => !c.island)).toBe(true)
  })
})

describe('шари пошуку «де найкраще»', () => {
  it('вимкнений шар пошук вмикає й запам\'ятовує як свій', () => {
    expect(finderLayers(['a'], [], ['b'])).toEqual({ enabled: ['a', 'b'], auto: ['b'] })
  })
  it('шар, увімкнений вручну, лишається не своїм', () => {
    expect(finderLayers(['a', 'b'], [], ['b'])).toEqual({ enabled: ['a', 'b'], auto: [] })
  })
  it('новий пошук вимикає шар, який увімкнув попередній пошук; увімкнене вручну лишається', () => {
    expect(finderLayers(['a', 'b'], ['b'], ['c'])).toEqual({ enabled: ['a', 'c'], auto: ['c'] })
  })
  it('повторний пошук того самого шару — шар лишається своїм', () => {
    expect(finderLayers(['a', 'b'], ['b'], ['b'])).toEqual({ enabled: ['a', 'b'], auto: ['b'] })
  })
})

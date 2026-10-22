import { describe, expect, it } from 'vitest'
import { calc, ddQty, waterQty } from './calc'

/* eslint-disable @typescript-eslint/no-explicit-any */
// переробка спайсу дає два виходи (меланж і залишки), фільтр Mk4 потребує обох — як у грі
const place = new Map<string, any>([['spice', { name: 'Large Spice Refinery', cat: 'spicerefinery' }], ['fab', { name: 'Fabricator', cat: 'fabricator' }]])
const spice = { id: 'sp', at: ['spice'], in: [['SpiceSand', 10000]], out: [['MelangeSpice', 200], ['SpiceResidue', 1000]], time: 2700, water: 75000 }
const filter = { id: 'f4', at: ['fab'], in: [['SpiceResidue', 50], ['MelangeSpice', 1], ['Silicone', 12]], out: [['WindTrapFilter4', 1]], time: 15, water: 210 }
const makes = new Map<string, any[]>([['MelangeSpice', [spice]], ['SpiceResidue', [spice]], ['WindTrapFilter4', [filter]]])
const ix = { place, makes, craftsAt: new Map(), item: new Map([['WindTrapFilter4', { grade: 4 }], ['MelangeSpice', { grade: 0 }], ['SpiceResidue', { grade: 0 }]]), cat: { buildables: [] } } as any
const off = { production: false, refining: false }

describe('побічні продукти', () => {
  it('рецепт з двома виходами крафтиться раз, а не для кожного виходу', () => {
    const r = calc(ix, [{ kind: 'item', id: 'WindTrapFilter4', qty: 1 }], off)
    expect(r.raw).toEqual([['Silicone', 12], ['SpiceSand', 10000]].sort((a, b) => (b[1] as number) - (a[1] as number)))
    const spiceSteps = r.steps.filter((s) => s.recipe.id === 'sp')
    expect(spiceSteps).toHaveLength(1)
    expect(spiceSteps[0].time).toBe(2700)
    expect(spiceSteps[0].by.length).toBe(1)
    // зайве лишається запасом: 200 меланжу − 1, 1000 залишків − 50
    expect(Object.fromEntries(r.spare)).toEqual({ [spiceSteps[0].by[0][0]]: spiceSteps[0].by[0][0] === 'SpiceResidue' ? 950 : 199 })
  })
  it('коли одного виходу треба більше — крафтів стільки, скільки треба для нього', () => {
    // 30 фільтрів: залишків 1500 (2 крафти), меланжу 30 (1 крафт) — разом 2 крафти, не 3
    const r = calc(ix, [{ kind: 'item', id: 'WindTrapFilter4', qty: 30 }], off)
    expect(r.steps.filter((s) => s.recipe.id === 'sp').reduce((n, s) => n + s.crafts, 0)).toBe(2)
    expect(r.raw.find(([id]) => id === 'SpiceSand')?.[1]).toBe(20000)
  })
})

describe('округлення', () => {
  it('знижка Глибокої пустелі — за кожну будівлю окремо, вгору', () => {
    expect(ddQty(75, true)).toBe(38)
    expect(ddQty(75, false)).toBe(75)
    const b = { set: 'S', id: 'Sardaukar_Wall_01', cost: [['Stone', 75]] }
    const ix2 = { ...ix, cat: { buildables: [b] } }
    // 3 стіни: 3 × 38 = 114 (від суми було б 113)
    expect(calc(ix2, [{ kind: 'build', id: 'Sardaukar_Wall_01', qty: 3 }], off, {}, true).direct).toEqual([['Stone', 114]])
  })
  it('вода з виробничим указом — цілими вгору, як входи', () => {
    expect(waterQty(150, 4, { production: true, refining: false })).toBe(113)
    expect(waterQty(150, 3, { production: true, refining: false })).toBe(150)
    const r = calc(ix, [{ kind: 'item', id: 'WindTrapFilter4', qty: 1 }], { production: true, refining: false })
    expect(r.steps.find((s) => s.item === 'WindTrapFilter4')?.water).toBe(158) // 210 × 0,75 = 157,5 → 158
  })
})

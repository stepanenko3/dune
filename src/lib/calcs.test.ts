import { describe, expect, it } from 'vitest'
import { calc, pickStations } from './calc'
import { picksOf, samePicks, stationsOf } from './calcs'

/* eslint-disable @typescript-eslint/no-explicit-any */
// злиток — на трьох переробниках руди; паста — на малому й середньому хімічному, гель — на всіх трьох хімічних;
// деталь — на двох фабрикаторах (без розміру)
const place = new Map<string, any>([
  ['small', { name: 'Small Ore Refinery', cat: 'orerefinery' }],
  ['medium', { name: 'Medium Ore Refinery', cat: 'orerefinery' }],
  ['large', { name: 'Large Ore Refinery', cat: 'orerefinery' }],
  ['chemS', { name: 'Small Chemical Refinery', cat: 'chemicalrefinery' }],
  ['chemM', { name: 'Medium Chemical Refinery', cat: 'chemicalrefinery' }],
  ['chemL', { name: 'Large Chemical Refinery', cat: 'chemicalrefinery' }],
  ['fab', { name: 'Fabricator', cat: 'fabricator' }],
  ['fab2', { name: 'Advanced Fabricator', cat: 'fabricator' }],
])
const R = (id: string, at: string, inp: [string, number][], out: [string, number][], time: number) => ({ id, at: [at], in: inp, out, time, water: null })
const makes = new Map<string, any[]>([
  ['ingot', [R('s', 'small', [['ore', 5]], [['ingot', 1]], 10), R('m', 'medium', [['ore', 4]], [['ingot', 1]], 7), R('l', 'large', [['ore', 3]], [['ingot', 1]], 5)]],
  ['paste', [R('pS', 'chemS', [['crystal', 3]], [['paste', 1]], 12), R('pM', 'chemM', [['crystal', 2]], [['paste', 1]], 8)]],
  ['gel', [R('gS', 'chemS', [['paste', 3]], [['gel', 1]], 12), R('gM', 'chemM', [['paste', 2]], [['gel', 1]], 8), R('gL', 'chemL', [['paste', 1]], [['gel', 1]], 6)]],
  ['part', [R('f1', 'fab', [['ingot', 3], ['gel', 1]], [['part', 1]], 5), R('f2', 'fab2', [['ingot', 2], ['gel', 1]], [['part', 1]], 5)]],
])
const craftsAt = new Map<string, any[]>()
for (const rs of makes.values()) for (const r of rs) craftsAt.set(r.at[0], [...(craftsAt.get(r.at[0]) ?? []), r])
const ix = { place, makes, craftsAt, item: new Map() } as any
const fx = { production: false, refining: false }
const targets = [{ kind: 'item' as const, id: 'part', qty: 10 }]
const picksFor = (choice: Record<string, number>) => picksOf(ix, calc(ix, targets, fx, pickStations(ix, makes.keys(), choice)))

describe('збережений розрахунок: рецепти ↔ станції', () => {
  it('рецепти — лише предмети ланцюжка з кількома рецептами', () => {
    expect(picksFor({})).toEqual({ ingot: 'l', paste: 'pM', gel: 'gL', part: 'f2' }) // деталь — найощадливіший рецепт
  })
  it('з рецептів — той самий вибір станцій, навіть коли частина предметів на сусідньому розмірі', () => {
    for (const choice of [{}, { 'Ore Refinery': 1, 'Chemical Refinery': 1 }, { 'Ore Refinery': 2, 'Chemical Refinery': 2 }, { 'Chemical Refinery': 3 }] as Record<string, number>[]) {
      const picks = picksFor(choice)
      const back = stationsOf(ix, picks)
      // паста великого хімічного не має (стоїть на середньому), а вибір — усе одно великий
      expect(samePicks(picksFor(back), picks)).toBe(true)
    }
    expect(stationsOf(ix, { paste: 'pM', gel: 'gL' })).toEqual({ 'Chemical Refinery': 3 })
    expect(stationsOf(ix, { paste: 'pM', gel: 'gM', ingot: 's' })).toEqual({ 'Chemical Refinery': 2, 'Ore Refinery': 1 })
  })
  it('невідомі рецепти й фабрикатори вибору станцій не дають', () => {
    expect(stationsOf(ix, { part: 'f2', nope: 'x', ingot: 'gone' })).toEqual({})
  })
  it('порівняння рецептів', () => {
    expect(samePicks({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true)
    expect(samePicks({ a: '1' }, { a: '2' })).toBe(false)
    expect(samePicks({ a: '1' }, { a: '1', b: '2' })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { calc, familyOf, kinOf, pickStations, stationTier } from './calc'

/* eslint-disable @typescript-eslint/no-explicit-any */
// маленький довідник: залізний злиток на трьох переробниках руди, волокно — лише на середньому хімічному, паста —
// на малому й середньому хімічному, деталь — на двох фабрикаторах (без розміру)
const place = new Map<string, any>([
  ['small', { name: 'Small Ore Refinery', cat: 'orerefinery' }],
  ['medium', { name: 'Medium Ore Refinery', cat: 'orerefinery' }],
  ['large', { name: 'Large Ore Refinery', cat: 'orerefinery' }],
  ['chemS', { name: 'Small Chemical Refinery', cat: 'chemicalrefinery' }],
  ['chemM', { name: 'Medium Chemical Refinery', cat: 'chemicalrefinery' }],
  ['spice', { name: 'Spice Refinery', cat: 'spicerefinery' }],
  ['fab', { name: 'Fabricator', cat: 'fabricator' }],
  ['fab2', { name: 'Advanced Fabricator', cat: 'fabricator' }],
  ['fab3', { name: 'Old Fabricator', cat: 'fabricator' }], // нічого не крафтить,
])
const R = (id: string, at: string, inp: [string, number][], out: [string, number][], time: number) => ({ id, at: [at], in: inp, out, time, water: null })
const makes = new Map<string, any[]>([
  ['ingot', [R('s', 'small', [['ore', 5]], [['ingot', 1]], 10), R('m', 'medium', [['ore', 4]], [['ingot', 1]], 7), R('l', 'large', [['ore', 3]], [['ingot', 1]], 5)]],
  ['fiber', [R('c', 'chemM', [['mass', 3]], [['fiber', 1]], 10)]],
  ['paste', [R('pS', 'chemS', [['crystal', 3]], [['paste', 1]], 12), R('pM', 'chemM', [['crystal', 2]], [['paste', 1]], 8)]],
  ['part', [R('f1', 'fab', [['ingot', 3]], [['part', 1]], 5), R('f2', 'fab2', [['ingot', 2]], [['part', 1]], 5)]],
])
const craftsAt = new Map<string, any[]>()
for (const rs of makes.values()) for (const r of rs) craftsAt.set(r.at[0], [...(craftsAt.get(r.at[0]) ?? []), r])
const ix = { place, makes, craftsAt, item: new Map([['ingot', { grade: 2 }], ['fiber', { grade: 6 }]]) } as any
const fx = { production: false, refining: false }

describe('станції різного розміру', () => {
  it('розмір і родина — з назви станції', () => {
    expect(stationTier(ix, 'small')).toBe(1)
    expect(stationTier(ix, 'chemM')).toBe(2)
    expect(stationTier(ix, 'large')).toBe(3)
    expect(stationTier(ix, 'spice')).toBe(1) // без розміру в назві — найменший
    expect(stationTier(ix, 'fab')).toBe(0)
    expect(familyOf(ix, 'large')).toBe('Ore Refinery')
    expect(familyOf(ix, 'small')).toBe('Ore Refinery')
    expect(familyOf(ix, 'chemS')).toBe('Chemical Refinery')
  })
  it('усі станції того самого виду — для «Показати всі»: лише ті, де щось крафтиться', () => {
    expect(kinOf(ix, 'chemM')).toEqual(['chemS', 'chemM'])
    expect(kinOf(ix, 'large')).toEqual(['small', 'medium', 'large'])
    expect(kinOf(ix, 'fab2')).toEqual(['fab', 'fab2'])
    expect(kinOf(ix, 'nope')).toEqual(['nope'])
  })
  it('вибір за родинами: кожна родина — свій розмір; без вибору — найбільший; фабрикатори не чіпаємо', () => {
    const items = ['ingot', 'fiber', 'paste', 'part']
    expect(pickStations(ix, items, {})).toEqual({ ingot: 'l', paste: 'pM' })
    expect(pickStations(ix, items, { 'Ore Refinery': 1, 'Chemical Refinery': 1 })).toEqual({ ingot: 's', paste: 'pS' })
    expect(pickStations(ix, items, { 'Ore Refinery': 2 })).toEqual({ ingot: 'm', paste: 'pM' })
  })
  it('сировина й час залежать від вибраних станцій', () => {
    const t = [{ kind: 'item' as const, id: 'ingot', qty: 100 }]
    const small = calc(ix, t, fx, pickStations(ix, ['ingot'], { 'Ore Refinery': 1 }))
    const large = calc(ix, t, fx, pickStations(ix, ['ingot'], {}))
    expect(small.raw).toEqual([['ore', 500]])
    expect(large.raw).toEqual([['ore', 300]])
    expect(small.steps.map((x) => [x.recipe.at[0], x.time])).toEqual([['small', 1000]])
    expect(large.steps.map((x) => [x.recipe.at[0], x.time])).toEqual([['large', 500]])
  })
})

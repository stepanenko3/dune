import { describe, expect, it } from 'vitest'
import { countFromShare, defaultOn, findable, knownLayers, orderGroups, readUrl, shareAlpha } from './settings'
import type { GroupDef } from './data'

// шари з давнього вибору чи адреси: мапа могла перейти на інше джерело (TH.GL → файли гри) з іншими id типів
const groups = [{ id: 'g', types: [{ id: 'Cave' }, { id: 'TitaniumOre' }] }] as unknown as GroupDef[]

describe('шари мапи з адреси й збереженого вибору', () => {
  it('лише відомі типи; жодного відомого — null (тоді типові шари, а не порожня мапа)', () => {
    expect(knownLayers(['cave', 'Cave', 'spice_field_small'], groups)).toEqual(['Cave'])
    expect(knownLayers(['cave', 'shipwreck'], groups)).toBeNull()
    expect(knownLayers([], groups)).toEqual([])
  })
  it('адреса приймає й id гри (CamelCase)', () => {
    const was = globalThis.location
    // @ts-expect-error — підміна location для readUrl
    globalThis.location = { search: '?m=deepdesert_1&l=Cave,TitaniumOre,bad%20id' }
    expect(readUrl().l).toEqual(['Cave', 'TitaniumOre'])
    globalThis.location = was
  })
})

describe('типові шари', () => {
  it('малі мапи — усе, крім підбирання з землі (TH.GL resources_pickup і файли гри hand)', () => {
    const g = [{ id: 'loc', types: [{ id: 'Cave' }] }, { id: 'hand', types: [{ id: 'AzuritePickup' }] }, { id: 'resources_pickup', types: [{ id: 'azurite_pickup' }] }] as unknown as GroupDef[]
    expect(defaultOn(g, true)).toEqual(['Cave'])
  })
})

describe('порядок груп шарів', () => {
  it('локації, ресурси, рослини, лут, підбирання руками, ключі; решта (NPC…) — далі у своєму порядку', () => {
    const ids = ['ST:UI/Map_Legend_Category_NPCs', 'ST:UI/Map_Legend_Category_Location', 'loot', 'keys', 'hand', 'cutteray', 'plants', 'MapMarkers.Other']
    expect(orderGroups(ids.map((id) => ({ id }))).map((g) => g.id)).toEqual(['ST:UI/Map_Legend_Category_Location', 'cutteray', 'plants', 'loot', 'hand', 'keys', 'ST:UI/Map_Legend_Category_NPCs', 'MapMarkers.Other'])
  })
})

describe('лічильник шару за порогом шансу', () => {
  it('сума кроків 5 % від порогу; поріг 0 — усі місця', () => {
    const h = new Array(21).fill(0)
    h[2] = 4; h[3] = 1; h[10] = 2; h[20] = 1
    expect(countFromShare(h, 0)).toBe(8)
    expect(countFromShare(h, 15)).toBe(4)
    expect(countFromShare(h, 50)).toBe(3)
    expect(countFromShare(h, 100)).toBe(1)
  })
})

describe('непрозорість точки руди за шансом', () => {
  it('чистий острівець (100 %) — повна, пояс 50/50 — помітно блідіший, змішане місце (~16 %) — бліде', () => {
    expect(shareAlpha(100)).toBe(1)
    expect(shareAlpha(50)).toBeCloseTo(0.65)
    expect(shareAlpha(16)).toBeCloseTo(0.412)
    expect(shareAlpha(50)).toBeLessThan(shareAlpha(100) - 0.3)
  })
})

describe('де шукати найкраще місце', () => {
  it('руда, рослини, лут, підбирання — так; локації, ключі, NPC, торговці — ні', () => {
    for (const g of ['cutteray', 'resources', 'resources_pickup', 'plants', 'loot', 'hand']) expect(findable(g, 500)).toBe(true)
    for (const g of ['locations', 'Map_Legend_Category_Location', 'keys', 'pentashield_keys', 'npcs', 'vendors', 'trainers', 'house_representatives', 'vehicles']) expect(findable(g, 500)).toBe(false)
  })
  it('кількох точок шукати нема сенсу', () => {
    expect(findable('loot', 9)).toBe(false)
    expect(findable('loot', 10)).toBe(true)
  })
})

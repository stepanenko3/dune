import { describe, expect, it } from 'vitest'
import { calcAbout, calcAboutText, staleOf } from './calcs'
import { encodeTargets } from './calc'

/* eslint-disable @typescript-eslint/no-explicit-any */
const ix = {
  item: new Map([['ingot', {}], ['bar', {}]]),
  makes: new Map([['ingot', [{ id: 'l' }, { id: 'm' }]]]),
  cat: { buildables: [{ set: 'S', id: 'Sardaukar_Wall_01' }] },
} as any

describe('збережений розрахунок після оновлення гри', () => {
  it('цілі й рецепти, яких нема в довіднику, — окремо; решта — для порівняння зі збереженим', () => {
    const code = encodeTargets([{ kind: 'item', id: 'ingot', qty: 5 }, { kind: 'item', id: 'TankHull_6', qty: 1 }, { kind: 'build', id: 'Sardaukar_Wall_01', qty: 2 }, { kind: 'build', id: 'Sardaukar_Gone', qty: 1 }])
    const s = staleOf(ix, { code, picks: { ingot: 'l', bar: 'old' } })
    expect(s.gone.map((x) => x.id)).toEqual(['TankHull_6', 'Sardaukar_Gone'])
    expect(s.recipes).toBe(1)
    expect(s.fresh).toEqual({ code: encodeTargets([{ kind: 'item', id: 'ingot', qty: 5 }, { kind: 'build', id: 'Sardaukar_Wall_01', qty: 2 }]), picks: { ingot: 'l' } })
  })
  it('нічого не зникло — порожньо', () => {
    const code = encodeTargets([{ kind: 'item', id: 'ingot', qty: 5 }])
    expect(staleOf(ix, { code, picks: { ingot: 'm' } })).toMatchObject({ gone: [], recipes: 0 })
  })
})

describe('опис розрахунку', () => {
  it('українською з правильними формами й назад мовою сайту', () => {
    expect(calcAbout(1, 0)).toBe('1 ціль')
    expect(calcAbout(3, 22)).toBe('3 цілі · 22 крафти')
    expect(calcAbout(11, 125)).toBe('11 цілей · 125 крафтів')
    expect(calcAboutText('3 цілі · 22 крафти')).toBe('3 цілі · 22 крафти')
    expect(calcAboutText('3 goals · 22 crafts')).toBe('3 goals · 22 crafts')
  })
})

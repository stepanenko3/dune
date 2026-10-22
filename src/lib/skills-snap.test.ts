import { describe, expect, it } from 'vitest'
import { aboutOf, aboutText, dataVer, decodeShort, encodeShort, parseAbout, snap, unsnap, type Skill } from './skills'

// дерево однієї школи: вхід A → B → C; D — здібність від A
const S = (id: string, x: number, y: number, or: string[], max = 2, kind = 'attribute'): Skill => ({
  id, name: id.toUpperCase(), icon: null, school: 'trooper', kind, desc: '', x, y, max,
  levels: Array.from({ length: max }, () => ({ cost: 1, bonuses: [], perks: [], buffs: [] })), and: [], or,
})
const tree = [S('a', 0, 0, []), S('b', 0, 1, ['a', 'c']), S('c', 0, 2, ['b']), S('d', 1, 1, ['a'], 1, 'ability')]
const data = { syncedAt: '2026-10-01T00:00:00Z', skills: tree }
const none = { lv: [0, 0, 0, 0, 0], got: [[], [], [], [], []] as number[][] }

describe('знімок білду', () => {
  it('те саме дерево — той самий білд і без змін', () => {
    const s = snap(data, { a: 2, b: 1, d: 1 }, { a: ['d'], t: [] }, none)
    expect(s.pts).toBe(4)
    expect(unsnap(tree, s)).toEqual({ b: { a: 2, b: 1, d: 1 }, eq: { a: ['d'], t: [] }, spec: none, drift: null })
  })
  it('після патчу: новий вузол у дереві міняє код, але не знімок', () => {
    const b = { a: 2, b: 1, d: 1 }
    const code = encodeShort(tree, b, { a: [], t: [] })
    const s = snap(data, b, { a: [], t: [] }, none)
    // новий вузол «aa» в тій самій клітинці, що й a, — порядок вузлів у коді зсувається
    const patched = [S('aa', 0, 0, []), ...tree]
    expect(decodeShort(patched, code)?.same).toBe(false)
    expect(decodeShort(patched, code)?.b).not.toEqual(b)
    expect(unsnap(patched, s).b).toEqual(b)
    expect(dataVer(patched)).not.toBe(s.ver)
  })
  it('прибраний вузол, обрізаний ранг і знятий слот — у змінах, з очками до й після', () => {
    const s = snap(data, { a: 2, b: 1, c: 2, d: 1 }, { a: ['d'], t: [] }, none)
    const patched = [S('a', 0, 0, [], 1), S('b', 0, 1, ['a', 'c']), S('c', 0, 2, ['b'])] // a — лише 1 ранг; d прибрали
    const r = unsnap(patched, s)
    expect(r.b).toEqual({ a: 1, b: 1, c: 2 })
    expect(r.eq).toEqual({ a: [], t: [] })
    expect(r.drift).toMatchObject({ gone: [{ id: 'd', name: 'D', rank: 1 }], cut: [{ id: 'a', from: 2, to: 1 }], slots: 1, loose: false, was: 6, now: 4 })
  })
  it('злитий двійник знаходиться за id своєї частини', () => {
    const s = { ...snap(data, { a: 1 }, { a: [], t: [] }, none), nodes: { a: 1, a2: 1 } }
    const merged = [{ ...S('a', 0, 0, [], 3), parts: [{ id: 'a', max: 2 }, { id: 'a2', max: 1 }] }, ...tree.slice(1)]
    expect(unsnap(merged, s).b).toEqual({ a: 2 })
  })
})

describe('опис білду', () => {
  it('пишеться українською й розбирається назад', () => {
    const s = aboutOf([['swordmaster', 54], ['mentat', 20], ['trooper', 0]], 74)
    expect(s).toBe('Майстер меча 54, Ментат 20 · 74 очки')
    expect(parseAbout(s)).toEqual({ schools: [['swordmaster', 54], ['mentat', 20]], total: 74 })
    expect(parseAbout(aboutOf([], 0))).toEqual({ schools: [], total: 0 })
    expect(parseAbout('Swordmaster 54 · 74 points')).toBeNull()
    // чужий текст показуємо як є
    expect(aboutText('Swordmaster 54 · 74 points')).toBe('Swordmaster 54 · 74 points')
  })
})

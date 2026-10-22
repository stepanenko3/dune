import { afterEach, describe, expect, it } from 'vitest'
import { decodeShort, encodeShort, slotOf, typeOf, type Skill } from './skills'
import { useLoc } from './skillsUk'

// типи вузлів, як у грі: questlog зве «спайсові» навички й «науку» окремими видами, а в грі вони — атрибути (без слота)
const S = (id: string, kind: string, x: number): Skill => ({
  id, name: id, icon: null, school: 'planetologist', kind, desc: '', x, y: 0, max: 1,
  levels: [{ cost: 1, bonuses: [], perks: [], buffs: [] }], and: [], or: [],
})
const tree: Skill[] = [
  S('ab1', 'ability', 0),
  S('sp1', 'spice', 1),
  S('pk1', 'perk', 2),
  S('skills_perk_shieldweakpoint', 'perk', 3),
  S('at1', 'attribute', 4),
  S('sc1', 'science', 5),
]
const by = (id: string) => tree.find((s) => s.id === id)!

afterEach(() => useLoc.setState({ map: null }))

describe('типи навичок', () => {
  it('спайсові, наука й «Перевантаження щита» — атрибути, без слота', () => {
    expect(['ab1', 'sp1', 'pk1', 'skills_perk_shieldweakpoint', 'at1', 'sc1'].map((id) => typeOf(by(id)))).toEqual(['ability', 'attribute', 'perk', 'attribute', 'attribute', 'attribute'])
    expect(slotOf(by('sp1'))).toBe(null)
    expect(slotOf(by('ab1'))).toBe('a')
    expect(slotOf(by('pk1'))).toBe('t')
  })
  it('тип із даних гри важливіший за questlog', () => {
    useLoc.setState({ map: { pk1: { name: 'x', cost: [1], stats: [], type: 'Attribute' }, sp1: { name: 'y', cost: [1], stats: [], type: 'Ability' } } })
    expect(typeOf(by('pk1'))).toBe('attribute')
    expect(typeOf(by('sp1'))).toBe('ability')
  })
  it('старий код білду зі спайсовою в слоті здібностей: ранги, інші слоти й спеціалізації — ті самі', () => {
    const b = Object.fromEntries(tree.map((s) => [s.id, 1]))
    const spec = { lv: [10, 0, 35, 0, 2], got: [[0, 3], [], [1], [], []] }
    // код, як його писала стара версія: спайсова стояла серед здібностей (поділ слотів у коді не змінився)
    const code = encodeShort(tree, b, { a: ['sp1', 'ab1'], t: ['pk1'] }, spec)
    const d = decodeShort(tree, code)!
    expect(d.b).toEqual(b)
    expect(d.eq).toEqual({ a: ['ab1'], t: ['pk1'] })
    expect(d.spec).toEqual(spec)
  })
})

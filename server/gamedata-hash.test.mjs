// Хеш розділу ігрових даних: однаковий для тих самих даних у будь-якому порядку; невипущене не рахується; diff за id.
import { describe, expect, it } from 'vitest'
import { diffRecords, normalizeSection, sectionHash, stableStringify } from './lib/gamedata/hash.mjs'

describe('хеш розділу', () => {
  it('не залежить від порядку записів і ключів', () => {
    expect(sectionHash({ records: [{ id: 'b', x: 1 }, { id: 'a', y: { q: 1, p: 2 } }] }))
      .toBe(sectionHash({ records: [{ id: 'a', y: { p: 2, q: 1 } }, { id: 'b', x: 1 }] }))
    expect(stableStringify({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}')
  })

  it('невипущене не змінює хеш і лічильник', () => {
    const base = { records: [{ id: 'a' }, { id: 'b' }] }
    const more = { records: [{ id: 'a' }, { id: 'b' }, { id: 'c', released: false }] }
    expect(sectionHash(more)).toBe(sectionHash(base))
    expect(normalizeSection(more).count).toBe(2)
  })

  it('порядок масиву в blob значущий', () => {
    expect(sectionHash({ blob: { a: 1, b: [2, 1] } })).not.toBe(sectionHash({ blob: { a: 1, b: [1, 2] } }))
    expect(normalizeSection({ blob: { a: 1 } }).count).toBe(1)
  })

  it('diff за id: додано, прибрано, змінено, приклади по порядку', () => {
    const d = diffRecords(
      [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', v: 1 }],
      [{ id: 'b', name: 'B', v: 2 }, { id: 'c', name: 'C' }],
    )
    expect(d).toMatchObject({ added: 1, removed: 1, changed: 1 })
    expect(d.examples).toEqual([{ id: 'c', name: 'C', op: '+' }, { id: 'a', name: 'A', op: '-' }, { id: 'b', name: 'B', op: '~' }])
  })

  it('прикладів не більше двадцяти', () => {
    const next = Array.from({ length: 30 }, (_, i) => ({ id: 'n' + i }))
    const d = diffRecords([], next)
    expect(d.added).toBe(30)
    expect(d.examples).toHaveLength(20)
    expect(d.examples[0]).toEqual({ id: 'n0', name: null, op: '+' })
  })
})

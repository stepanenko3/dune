import { describe, expect, it } from 'vitest'
import { cleanRoadmap } from './lib/roadmap.mjs'

describe('документ роадмапу', () => {
  it('розділ із картками «зібрано» зберігає позначку collect, інші — без неї', () => {
    const d = cleanRoadmap({ title: 'x', sections: [{ id: 'a', title: 'A', collect: 1 }, { id: 'b', title: 'B', collect: false }, { id: 'c', title: 'C' }] })
    expect(d.sections.map((s) => s.collect)).toEqual([true, undefined, undefined])
    expect('collect' in d.sections[1]).toBe(false)
  })
})

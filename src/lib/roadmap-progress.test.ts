import { describe, expect, it } from 'vitest'
import { progressOf } from './roadmap'

describe('прогрес роадмапу з опису в списку', () => {
  it('усі форми множини й «Без етапів»', () => {
    expect(progressOf('1 етап, виконано 0')).toEqual({ n: 1, done: 0 })
    expect(progressOf('3 етапи, виконано 2')).toEqual({ n: 3, done: 2 })
    expect(progressOf('12 етапів, виконано 12')).toEqual({ n: 12, done: 12 })
    expect(progressOf('Без етапів')).toEqual({ n: 0, done: 0 })
  })
  it('чужий текст — null', () => {
    expect(progressOf('Що будувати далі')).toBeNull()
    expect(progressOf('3 етапи, виконано 5')).toBeNull()
  })
})

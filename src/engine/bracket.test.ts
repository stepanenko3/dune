// Сітка на вибування: посів (сильні не зустрічаються до кінця, пропуски — їм), пропуск проходить сам, наступні раунди —
// з переможців, зайвий вибір прибирається, місця — з фіналу й півфіналів.
import { describe, expect, it } from 'vitest'
import { bracketSize, cleanPicks, matchesOf, placesOf, seedOf } from './bracket.mjs'

describe('сітка турніру', () => {
  it('розмір — степінь двійки, посів 1–8, 4–5, 2–7, 3–6; пропуски — найсильнішим', () => {
    expect([1, 2, 3, 5, 8, 9].map(bracketSize)).toEqual([2, 2, 4, 8, 8, 16])
    expect(seedOf(['1', '2', '3', '4', '5', '6', '7', '8'])).toEqual(['1', '8', '4', '5', '2', '7', '3', '6'])
    // 5 команд у сітці на 8: пропуски дістаються 1, 2 і 3, і два пропуски не стоять поруч
    const s = seedOf(['1', '2', '3', '4', '5'])
    expect(s).toEqual(['1', null, '4', '5', '2', null, '3', null])
  })

  it('пропуск проходить сам; матч чекає, поки не відомий суперник; наступні раунди — з переможців', () => {
    const seed = seedOf(['a', 'b', 'c'])
    expect(seed).toEqual(['a', null, 'b', 'c'])
    let m = matchesOf(seed)
    expect(m.rounds[0][0]).toMatchObject({ a: 'a', b: null, bBye: true, w: 'a', auto: true })
    expect(m.rounds[0][1]).toMatchObject({ a: 'b', b: 'c', w: null })
    expect(m.rounds[1][0]).toMatchObject({ a: 'a', b: null, bBye: false, w: null })
    m = matchesOf(seed, [[null, 'b'], ['a']])
    expect(m.rounds[1][0]).toMatchObject({ a: 'a', b: 'c', w: 'a' })
    expect(m.champion).toBe('a')
    // переграли півфінал — фінал уже з іншим суперником, вибір у ньому лишається за позицією
    expect(matchesOf(seed, [[null, 'a'], ['b']]).champion).toBe('b')
  })

  it('зайвий вибір прибирається: у матчі з пропуском і в ще не визначеному матчі', () => {
    const seed = ['a', null, 'b', 'c']
    expect(cleanPicks(seed, [['b', null], ['a']])).toEqual([[null, null], [null]])
    expect(cleanPicks(seed, [['b', 'a'], ['b'], ['a']])).toEqual([[null, 'a'], ['b']])
  })

  it('місця: переможець, фіналіст, обидва півфіналісти', () => {
    const seed = seedOf(['1', '2', '3', '4'])
    expect(seed).toEqual(['1', '4', '2', '3'])
    expect(placesOf(seed, [])).toEqual([[], [], []])
    expect(placesOf(seed, [['a', 'b'], ['b']])).toEqual([['3'], ['1'], ['4', '2']])
  })
})

import { describe, expect, it } from 'vitest'
import { fmtStat, gtId, locRanks, qlId, skillName, unflatten, type LocSkill } from './skillsUk'
import type { Skill } from './skills'

describe('дані навичок мовою сайту', () => {
  it('розгортає стиснутий devalue-масив', () => {
    // так віддає gaming.tools: об'єкти й масиви — номери інших елементів
    const arr = [{ id: 1, name: 2, stats: 3 }, 'skills-attribute-aggression1', 'Польова медицина', [4], { level: 5, value: 6 }, 1, 0.1]
    expect(unflatten(arr)).toEqual({ id: 'skills-attribute-aggression1', name: 'Польова медицина', stats: [{ level: 1, value: 0.1 }] })
    expect(qlId('skills-ability-suspensormine_reduction')).toBe('skills_ability_suspensormine_reduction')
    expect(gtId('skills_ability_suspensormine_reduction')).toBe('skills-ability-suspensormine_reduction') // далі підкреслення лишаються
    expect(gtId('skills_attribute_aggression1')).toBe('skills-attribute-aggression1')
  })
  it('значення статів — як у грі', () => {
    const st = (value: number, op: string | null, fmt: string) => fmtStat({ level: 1, name: '', value, op, fmt })
    expect(st(0.1, 'Additive', '{v:0.#}%')).toBe('+10%')
    expect(st(1.05, 'Multiplicitive', '{v:0.#}%')).toBe('+5%')
    expect(st(-0.15, 'Additive', '{v:0.#}%')).toBe('−15%')
    expect(st(22, null, '{v:0.#}')).toBe('22')
    expect(st(2.5, null, '{v:0.#}/s')).toBe('2,5/с')
  })
  it('злиті двійники — стати по черзі шматків', () => {
    const map: Record<string, LocSkill> = {
      c1: { name: 'Картограф', cost: [1], stats: [{ level: 1, name: 'Радіус', value: 0.1, op: 'Additive', fmt: '{v:0.#}%' }] },
      c2: { name: 'Картограф', cost: [1], stats: [{ level: 1, name: 'Радіус', value: 0.2, op: 'Additive', fmt: '{v:0.#}%' }] },
    }
    const s = { id: 'c1', max: 2, parts: [{ id: 'c1', max: 1 }, { id: 'c2', max: 1 }] } as Skill
    const r = locRanks(s, map)!
    expect(r.name).toBe('Картограф')
    expect(r.stats.map((l) => l[0].value)).toEqual([0.1, 0.2])
    expect(locRanks(s, null)).toBeNull()
  })
  it('назва вузла: дані gaming.tools → довідник сайту → англійська', () => {
    const map: Record<string, LocSkill> = { c1: { name: 'Картограф', cost: [], stats: [] } }
    expect(skillName({ id: 'c1', name: 'Cartographer', locName: 'Cartógrafo', max: 1 } as Skill, map)).toBe('Картограф')
    expect(skillName({ id: 'c2', name: 'Cartographer', locName: 'Cartógrafo', max: 1 } as Skill, map)).toBe('Cartógrafo')
    expect(skillName({ id: 'c2', name: 'Cartographer', locName: null, max: 1 } as Skill, null)).toBe('Cartographer')
  })
})

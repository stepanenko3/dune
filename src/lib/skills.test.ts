import { describe, expect, it } from 'vitest'
import { branches, decodeBuild, encodeBuild, open, spent, valid, type Skill } from './skills'

// маленьке дерево однієї школи: вхід A (0,0) → B (0,1) → C (0,2); D (1,1) — від A чи B; E (0,4) — завершальний
const S = (id: string, x: number, y: number, or: string[], and: string[] = ['skills_key_trooper1'], costs = [1, 2]): Skill => ({
  id, name: id, icon: null, school: 'trooper', kind: 'attribute', desc: '', x, y, max: costs.length,
  levels: costs.map((cost) => ({ cost, bonuses: [], perks: [], buffs: [] })), and, or,
})
const tree: Skill[] = [
  S('a', 0, 0, [], []),
  S('b', 0, 1, ['a', 'c', 'd']),
  S('c', 0, 2, ['b', 'e']),
  S('d', 1, 1, ['a', 'b']),
  S('e', 0, 4, ['c'], ['skills_key_capstoneweaponry']),
]
const br = branches(tree)

describe('дерево вмінь', () => {
  it('вхід відкритий завжди, решта — від взятого сусіда', () => {
    expect(open(tree[0], {}, br, tree)).toBe(true)
    expect(open(tree[1], {}, br, tree)).toBe(false)
    expect(open(tree[1], { a: 1 }, br, tree)).toBe(true)
    expect(open(tree[2], { a: 1 }, br, tree)).toBe(false)
  })
  it('рахує очки за рангами', () => {
    expect(spent(tree, { a: 2, b: 1 })).toBe(1 + 2 + 1)
  })
  it('не дає «повиснути» вузлу без опори', () => {
    expect(valid(tree, { a: 1, b: 1, c: 1 }, br)).toBe(true)
    expect(valid(tree, { b: 1, c: 1 }, br)).toBe(false) // зняли вхід — b і c без опори
    expect(valid(tree, { a: 1, d: 1, b: 1 }, br)).toBe(true) // b тримається і від a, і від d
  })
  it('збірка в адресі — туди й назад', () => {
    const b = { a: 2, b: 1, d: 1 }
    const code = encodeBuild(tree, b)
    expect(code.startsWith('trooper.')).toBe(true)
    expect(decodeBuild(tree, code)).toEqual(b)
    expect(decodeBuild(tree, 'trooper.09')).toEqual({ a: 2 }) // ранг вище максимуму — до максимуму
  })
})

describe('короткий код білду', () => {
  const none = () => ({ lv: [0, 0, 0, 0, 0], got: [[], [], [], [], []] as number[][] })
  const ab = (id: string, x: number, y: number, or: string[]) => ({ ...S(id, x, y, or), kind: 'ability' })
  const t2: Skill[] = [...tree, ab('f', 2, 0, []), ab('g', 2, 1, ['f'])]
  it('ранги й слоти — туди й назад', async () => {
    const { encodeShort, decodeShort } = await import('./skills')
    const b = { a: 2, b: 1, d: 1, f: 1, g: 2 }
    const eq = { a: ['g', 'f'], t: [] }
    const code = encodeShort(t2, b, eq)
    expect(code.startsWith('3')).toBe(true)
    expect(decodeShort(t2, code)).toEqual({ b, eq, spec: none(), same: true })
  })
  it('спеціалізації — рівні й куплені риси; старі коди версій 1 і 2 теж читаються', async () => {
    const { encodeShort, decodeShort } = await import('./skills')
    const spec = { lv: [100, 0, 37, 1, 55], got: [[0, 5, 40], [], [], [0], [2, 3]] }
    const code = encodeShort(t2, { a: 1 }, { a: [], t: [] }, spec)
    expect(decodeShort(t2, code)).toEqual({ b: { a: 1 }, eq: { a: [], t: [] }, spec, same: true })
    expect(encodeShort(t2, {}, { a: [], t: [] }, { lv: [0, 0, 5, 0, 0], got: none().got })).not.toBe('') // лише спеціалізації — теж білд
    // риси треку з рівнем 0 не пишуться
    expect(decodeShort(t2, encodeShort(t2, {}, { a: [], t: [] }, { lv: [0, 0, 5, 0, 0], got: [[3], [], [], [], []] }))?.spec.got[0]).toEqual([])
    // версія 1 — без спеціалізацій: те саме число, інша перша літера
    const v1 = '1' + encodeShort(t2, { a: 2, f: 1 }, { a: ['f'], t: [] }).slice(1)
    expect(decodeShort(t2, v1)).toEqual({ b: { a: 2, f: 1 }, eq: { a: ['f'], t: [] }, spec: none(), same: true })
  })
  it('порожній білд — порожній код; слот невзятого вузла відкидається', async () => {
    const { encodeShort, decodeShort } = await import('./skills')
    expect(encodeShort(t2, {}, { a: [], t: [] })).toBe('')
    const code = encodeShort(t2, { f: 1 }, { a: ['f', 'g'], t: [] })
    expect(decodeShort(t2, code)?.eq).toEqual({ a: ['f'], t: [] })
  })
  it('довжина не росте з білдом: усі вузли на максимумі — кілька знаків', async () => {
    const { encodeShort } = await import('./skills')
    const full = Object.fromEntries(t2.map((s) => [s.id, s.max]))
    expect(encodeShort(t2, full, { a: ['f', 'g'], t: [] }).length).toBeLessThan(12)
  })
  it('стара адреса («trooper.…») не плутається з новим кодом', async () => {
    const { isShort } = await import('./skills')
    expect(isShort('trooper.0291')).toBe(false)
    expect(isShort('1Ab')).toBe(true)
  })
})

describe('злиття двійників', () => {
  it('два записи з одним ім\'ям у клітинці — один вузол з рангами обох, сусіди посилаються на нього', async () => {
    const { mergeTwins } = await import('./skills')
    const t1 = S('c1', 2, 2, ['n']); t1.name = 'Cartographer'; t1.levels = t1.levels.slice(0, 1); t1.max = 1
    const t2 = S('c2', 2, 2, ['n']); t2.name = 'Cartographer'; t2.levels = t2.levels.slice(0, 1); t2.max = 1
    const n = S('n', 2, 3, ['c1', 'c2'])
    const m = mergeTwins([t1, t2, n])
    expect(m.map((x) => x.id)).toEqual(['c1', 'n'])
    expect(m[0].max).toBe(2)
    expect(m[0].parts).toEqual([{ id: 'c1', max: 1 }, { id: 'c2', max: 1 }])
    expect(m[1].or).toEqual(['c1'])
  })
})

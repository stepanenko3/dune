// Порівняння розділу між двома джерелами: поточне (a) з вибраним (b) — що додасться, зникне, зміниться (поле: було → стане).
import { describe, expect, it } from 'vitest'
import { compareSection } from './lib/gamedata/compare.mjs'

const it_ = (id, o = {}) => ({ id, name: id, stack: 100, volume: 1, ...o })
const cmp = (section, a, b) => compareSection(section, { a: { id: 'community', records: a }, b: { id: 'gamefiles', records: b } })

describe('порівняння розділу', () => {
  it('додане, зникле, змінене з «було → стане»; невипущене не рахується', () => {
    const r = cmp('items', [it_('A'), it_('B', { stack: '500' }), it_('C')], [it_('A', { released: true }), it_('B', { stack: 750, released: true }), it_('D', { released: true }), it_('X', { released: false })])
    expect(r).toMatchObject({ section: 'items', a: 'community', b: 'gamefiles', added: 1, removed: 1, changed: 1, fields: { stack: 1 } })
    expect(r.items).toEqual([
      { id: 'D', name: 'D', op: '+' },
      { id: 'C', name: 'C', op: '-' },
      { id: 'B', name: 'B', op: '~', changes: [['stack', '500', '750']] },
    ])
  })

  it('невипущене з будь-якого боку не рахується', () => {
    const r = cmp('items', [it_('A', { released: false })], [it_('B', { released: false })])
    expect(r).toMatchObject({ added: 0, removed: 0, changed: 0, items: [] })
  })

  it('«1.0» проти 1 і null проти відсутнього — не зміна', () => {
    const r = cmp('items', [{ id: 'A', volume: '1.0', rarity: null }], [{ id: 'A', volume: 1, released: true }])
    expect(r.changed).toBe(0)
  })

  it('заповнене порожнє — окремо від змін, теж з «було → стане»', () => {
    const r = cmp('placeables', [{ id: 'A', name: 'A', water: null, power: -15 }, { id: 'B', name: 'B', water: null, power: -5 }], [{ id: 'A', name: 'A', water: 1500, power: -15 }, { id: 'B', name: 'B', water: 10, power: -45 }])
    expect(r).toMatchObject({ changed: 1, filled: 2, fields: { power: 1 }, filledFields: { water: 2 } })
    expect(r.items.find((x) => x.id === 'A')).toEqual({ id: 'A', name: 'A', op: '~', changes: [], filled: [['water', null, '1500']] })
  })

  it('складні значення — стисло текстом, довгі обрізані', () => {
    const r = cmp('recipes', [{ id: 'R', in: [['A', 2]], note: 'x'.repeat(400) }], [{ id: 'R', in: [['A', 3]], note: 'y'.repeat(400) }])
    const ch = Object.fromEntries(r.items[0].changes.map(([k, a, b]) => [k, [a, b]]))
    expect(ch.in).toEqual(['[["A",2]]', '[["A",3]]'])
    expect(ch.note[0].length).toBeLessThanOrEqual(161)
  })

  it('переклади: лише види, що є в обох джерелах', () => {
    const r = cmp('texts', [{ id: 'item:A:uk', name: 'А' }, { id: 'skill:S:uk', name: 'Уміння' }], [{ id: 'item:A:uk', name: 'А' }])
    expect(r).toMatchObject({ added: 0, removed: 0, changed: 0 })
  })

  it('великий розділ: список обрізано, лічильники повні', () => {
    const a = Array.from({ length: 3000 }, (_, i) => ({ id: 'a' + i }))
    const r = cmp('items', a, [])
    expect(r.removed).toBe(3000)
    expect(r.items.length).toBeLessThan(3000)
    expect(r.truncated).toBe(3000 - r.items.length)
  })

  it('уміння: ранги — за ціною й бонусами (тексти perks/buffs не всі джерела дають); опису нема з одного боку — не зміна', () => {
    const lv = (cost, o = {}) => ({ cost, bonuses: [['Cooldown', 22, false]], perks: [], buffs: [], ...o })
    const r = cmp('skills',
      [{ id: 'a', name: 'A', desc: 'Текст', levels: [lv(2, { perks: ['опис'], buffs: ['Blade Damage'] })] }, { id: 'b', name: 'B', desc: 'Текст', levels: [lv(1)] }],
      [{ id: 'a', name: 'A', desc: null, levels: [lv(2)] }, { id: 'b', name: 'B', desc: 'Текст', levels: [lv(2)] }])
    expect(r).toMatchObject({ changed: 1, fields: { levels: 1 } })
    expect(r.items.map((x) => x.id)).toEqual(['b'])
  })

  it('точки мапи: те саме місце в межах 3 м (та сама мапа й розкладка) — один запис; тип інший — зміна; без зіставлення типів', () => {
    const pt = (id, map, type, x, y, extra = {}) => ({ id, map, type, x, y, z: 0, ...extra })
    const r = compareSection('markers', {
      a: { id: 'thgl', records: [pt('s@100:200', 's', 'cave', 100, 200), pt('s@500:500', 's', 'enemycamp', 500, 500), pt('d@1:1', 'd', 'cave', 1, 1, { layout: 2 })] },
      b: { id: 'gamefiles', records: [pt('s@101:201', 's', 'Cave', 101, 201, { kind: 'marker', name: 'ST:K' }), pt('s@900:900', 's', 'Cave', 900, 900, { kind: 'marker' }), pt('d@1:1', 'd', 'Cave', 1, 1, { layout: 3 })] },
    })
    expect(r).toMatchObject({ added: 2, removed: 2, changed: 1 })
    expect(r.items.find((i) => i.op === '~')).toMatchObject({ id: 's@100:200', name: 'Cave', changes: [['type', 'cave', 'Cave']] })
    expect(r.items.filter((i) => i.op === '+').map((i) => `${i.name} ${i.id}`)).toEqual(['Cave s@900:900', 'Cave d@1:1#b'])
  })

  it('ресурси: група й вага точки (лише у файлах гри) — не зміна; тип — так', () => {
    const r = compareSection('resources', {
      a: { id: 'thgl', records: [{ id: 's@1:1', map: 's', type: 'azurite', x: 1, y: 1, z: 0 }] },
      b: { id: 'gamefiles', records: [{ id: 's@1:1~AzuriteOre', map: 's', kind: 'core', group: 'Minerals', type: 'AzuriteOre', weight: 77, x: 1, y: 1, z: 0 }] },
    })
    expect(r).toMatchObject({ changed: 1, filled: 0, fields: { type: 1 } })
  })
})

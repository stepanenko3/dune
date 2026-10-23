// Лут контейнерів з таблиць гри: шанс кожного предмета (хоч один) і середня кількість, коли випав; зони луту — з
// бітових карт світу (BitMapData: біти пікселя = теги місця, LootTier.N).
import { describe, expect, it } from 'vitest'
import { bitmapSampler, lootOf, lootWithBonus, pickDistribution } from '../normalize/loot.mjs'

describe('бітова карта тегів', () => {
  it('W×H по bits біт підряд (молодший першим) у хвості пакета; біт k — тег k', () => {
    const W = 4, H = 2, bits = 2
    const data = Buffer.alloc(Math.ceil((W * H * bits) / 8))
    const set = (n) => { data[n >> 3] |= 1 << (n & 7) }
    set((0 * W + 1) * bits + 0) // піксель (1, 0) — A
    set((1 * W + 3) * bits + 0); set((1 * W + 3) * bits + 1) // піксель (3, 1) — A і B
    const s = bitmapSampler({ m_SizeX: 4, m_SizeY: 2, m_BitsPerWord: 2, m_Tags: [{ TagName: 'A' }, { TagName: 'B' }] }, Buffer.concat([Buffer.from('header....'), data]))
    expect([s(1, 0), s(3, 1), s(0, 0), s(9, 9)]).toEqual([['A'], ['A', 'B'], [], []])
  })
  it('порожня карта гри (без розміру й тегів, є таке в ГП) — без тегів, а не збій', () => {
    expect(bitmapSampler({}, Buffer.alloc(389))(0, 0)).toEqual([])
    expect(bitmapSampler(undefined, Buffer.alloc(10))(0, 0)).toEqual([])
  })
})

describe('лут з таблиць', () => {
  const T = (rows) => rows
  const tables = {
    Main: T({
      a: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'Solari' } },
      b: { NumRolls: 2, PercentageChance: 0.5, ItemTemplateId: { Name: 'None' }, LootWeightedTable: { AssetPathName: '/Game/L/W.W' } },
      t4: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'Tier4Gun' }, RequiredTags: ['LootTier.4'] },
      no4: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'LowGun' }, ForbiddenTags: ['LootTier.4'] },
    }),
    W: T({
      x: { MinRolls: 1, MaxRolls: 3, Weight: 3, ItemTemplateId: { Name: 'Medkit' } },
      y: { MinRolls: 1, MaxRolls: 1, Weight: 1, ItemTemplateId: { Name: 'None' }, LootTable: { AssetPathName: '/Game/L/Sub.Sub' } },
    }),
    Sub: T({ s: { NumRolls: 1, PercentageChance: 0.2, ItemTemplateId: { Name: 'Rare' } } }),
  }
  it('шанс і середня кількість; зважена таблиця — один рядок за кидок; вкладена — рекурсією; умови тегів', () => {
    const r = Object.fromEntries(lootOf(tables, 'Main', new Set(['LootTier.4'])).map(([i, p, c]) => [i, [p, c]]))
    expect(r.Solari).toEqual([100, 1])
    expect(r.Tier4Gun).toEqual([100, 1])
    expect(r.LowGun).toBeUndefined()
    // Medkit: рядок b 50 %, 2 кидки, у кидку 3/4 → 0.5 × (1 − (1/4)²) = 46.9 %; кількість 2 за раз у середньому
    expect(r.Medkit[0]).toBe(46.9)
    // Rare: кидок дає Sub з 1/4, у Sub 20 % → 5 % за кидок; 0.5 × (1 − 0.95²) = 4.9 %
    expect(r.Rare[0]).toBe(4.9)
    expect(lootOf(tables, 'Main', new Set()).map((x) => x[0])).toContain('LowGun')
  })
  it('зважена таблиця: рядки взаємовиключні — шанс і кількість предмета в кількох рядках додаються (не «незалежні»)', () => {
    const t = { Heal: { a: { MinRolls: 1, MaxRolls: 1, Weight: 70, ItemTemplateId: { Name: 'Kit' } }, b: { MinRolls: 2, MaxRolls: 2, Weight: 30, ItemTemplateId: { Name: 'Kit' } } } }
    expect(lootOf(t, 'Heal', new Set())).toEqual([['Kit', 100, 1.3]])
  })
  it('рядок з умовою гравця (RequiredPlayerTags: бонус ключового вміння, активний контракт) — не для всіх, пропускаємо', () => {
    const t = { Main: {
      a: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'Solari' } },
      b: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'Bonus' }, RequiredPlayerTags: { TagDictionary: [{ TagName: 'Character.Keystone.Exploration.BonusLoot' }] } },
    } }
    expect(lootOf(t, 'Main', new Set()).map((x) => x[0])).toEqual(['Solari'])
  })
  it('лут за умовою гравця — окремо: предмети лише з бонусом спеціалізації (k) чи з активним контрактом (c) — з позначкою', () => {
    const P = (tag) => ({ TagDictionary: [{ TagName: tag }] })
    const t = { Main: {
      a: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'Solari' } },
      b: { NumRolls: 1, PercentageChance: 0.5, ItemTemplateId: { Name: 'Pattern' }, RequiredPlayerTags: P('Character.Keystone.Exploration.BonusLoot') },
      c: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'Manifest' }, RequiredPlayerTags: P('Contract.Tracking.Active') },
      d: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'Solari' }, RequiredPlayerTags: P('Character.Keystone.Exploration.BonusLoot') },
    } }
    expect(lootWithBonus(t, 'Main', new Set())).toEqual([['Solari', 100, 1], ['Pattern', 50, 1, 'k'], ['Manifest', 100, 1, 'c']])
  })
  it('таблиці нема — помилка (а не порожній лут)', () => {
    expect(() => lootOf(tables, 'Gone', new Set())).toThrow('Gone')
  })
  it('посилання на таблицю, якої нема в самій збірці гри (absent) — порожньо, як у грі; решта рядка — як є', () => {
    const t = { Cave: { r: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'None' }, LootTable: { AssetPathName: '/G/Tier.Tier' }, LootWeightedTable: { AssetPathName: '/G/Gone.Gone' } } }, Tier: { a: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'Solari' } } } }
    expect(lootOf(t, 'Cave', new Set(), { absent: (n) => n === 'Gone' }).map((x) => x[0])).toEqual(['Solari'])
    expect(() => lootOf(t, 'Cave', new Set(), { absent: () => false })).toThrow('Gone')
  })
  it('рядок і з таблицею, і зі зваженою таблицею — кидає обидві (тир печери + креслення)', () => {
    const t = {
      Cave: { r: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'None' }, LootTable: { AssetPathName: '/G/Tier.Tier' }, LootWeightedTable: { AssetPathName: '/G/Bp.Bp' } } },
      Tier: { a: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'Solari' } } },
      Bp: { b: { MinRolls: 1, MaxRolls: 1, Weight: 1, ItemTemplateId: { Name: 'Schematic' } } },
    }
    expect(lootOf(t, 'Cave', new Set()).map((x) => x[0])).toEqual(['Schematic', 'Solari'])
  })
  it('рядок для зони безпеки (PvP чи PvE) — лише в такій зоні; Any — завжди', () => {
    const t = {
      Main: {
        pvp: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'PvpGun' }, TargetSecurityZone: 'ESecurityZoneRulesType::PvP' },
        pve: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'PveGun' }, TargetSecurityZone: 'ESecurityZoneRulesType::PvE' },
        any: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'Solari' }, TargetSecurityZone: 'ESecurityZoneRulesType::Any' },
      },
    }
    expect(lootOf(t, 'Main', new Set(), { zone: 'PvP' }).map((x) => x[0])).toEqual(['PvpGun', 'Solari'])
    expect(lootOf(t, 'Main', new Set(), { zone: 'PvE' }).map((x) => x[0])).toEqual(['PveGun', 'Solari'])
  })
})

describe('лут контейнера без своєї таблиці: розподіл за типом контейнера й тегами місця', () => {
  const rows = [
    { bIsEnabled: true, Priority: 0, RequiredTags: [], ForbiddenTags: ['LootTier.6'], LootContainerType: { Name: 'None' }, LootTable: { AssetPathName: '/Game/L/Ammo.Ammo' } },
    { bIsEnabled: true, Priority: 5, RequiredTags: ['LootTier.6'], ForbiddenTags: [], LootContainerType: { Name: 'None' }, LootTable: { AssetPathName: '/Game/L/AmmoT6.AmmoT6' } },
  ]
  it('власна таблиця типу (override) — тип у рядках не фільтр (примітивна скриня бере таблицю звичайної); загальна — фільтр', () => {
    const basic = [{ bIsEnabled: true, Priority: 0, RequiredTags: [], ForbiddenTags: [], LootContainerType: { Name: 'BasicContainer' }, LootTable: { AssetPathName: '/Game/L/Basic.Basic' } }]
    expect(pickDistribution(basic, 'PrimitiveContainer', new Set(), { own: true })).toBe('Basic')
    expect(pickDistribution(basic, 'PrimitiveContainer', new Set())).toBeNull()
  })
  it('теги ієрархічні: заборона «LootTier» — будь-який тир (LootTier.3 під нею)', () => {
    const t = { Main: { tier: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'T3' }, RequiredTags: ['LootTier.3'] }, none: { NumRolls: 1, PercentageChance: 1, ItemTemplateId: { Name: 'NoTier' }, ForbiddenTags: ['LootTier'] } } }
    expect(lootOf(t, 'Main', new Set(['LootTier.3'])).map((x) => x[0])).toEqual(['T3'])
    expect(lootOf(t, 'Main', new Set()).map((x) => x[0])).toEqual(['NoTier'])
  })
  it('найвищий пріоритет серед рядків, чиї умови місце задовольняє', () => {
    expect(pickDistribution(rows, 'AmmoContainer', new Set())).toBe('Ammo')
    expect(pickDistribution(rows, 'AmmoContainer', new Set(['LootTier.6']))).toBe('AmmoT6')
  })
})

describe('зона безпеки місця для луту', () => {
  it('розподіл за типом — теж лише рядки своєї зони', () => {
    const rows = [
      { LootContainerType: { Name: 'Basic' }, Priority: 2, LootTable: { AssetPathName: '/G/Pvp.Pvp' }, TargetSecurityZone: 'ESecurityZoneRulesType::PvP' },
      { LootContainerType: { Name: 'Basic' }, Priority: 1, LootTable: { AssetPathName: '/G/Any.Any' } },
    ]
    expect(pickDistribution(rows, 'Basic', new Set(), { zone: 'PvE' })).toBe('Any')
    expect(pickDistribution(rows, 'Basic', new Set(), { zone: 'PvP' })).toBe('Pvp')
  })
})

// Уміння з DT_TrainingModules: id — тег модуля (= нинішні slug-и questlog), ціна рангу й бонуси — з кривих гри,
// ключі (bExternal) — не вміння, прихована «школа» й заглушки назв — невипущене.
import { describe, expect, it } from 'vitest'
import { evalCurve, normalizeSkills, skillId } from '../normalize/skills.mjs'

const COSTS = '/Game/Dune/Systems/Progression/SkillCosts.0'
const TUNING = '/Game/Dune/GadgetsAbilities/CT_AbilityTuning.0'
const ST = '/Game/Dune/Localization/ST_Localization_Abilities.ST_Localization_Abilities'
const lin = (...k) => ({ InterpMode: 'RCIM_Linear', Keys: k.map(([Time, Value]) => ({ Time, Value })) })
const ft = (Key, s) => ({ TableId: ST, Key, SourceString: s, LocalizedString: s })
const stat = (row, name, pct = false) => ({ Stat: { CurveTable: { ObjectPath: TUNING }, RowName: row }, DescriptionShort: ft('SKILLS/P', name), bPercentBased: pct })
const base = (tag, o = {}) => ({
  Tag: { TagName: tag }, Icon: { AssetPathName: '/Game/Dune/GUI/Textures/Icons/T_UI_X_D.T_UI_X_D' }, MaxLevel: 1, SkillArea: 'ESkillTree::Trooper',
  DisplayName: ft('SKILLS/X_NAME', 'X'), GridPosition: { X: 1, Y: 2 }, PrereqModuleTags_And: [], PrereqModuleTags_Or: [],
  SkillPointsPerLevel: { Value: 1, Curve: { CurveTable: null, RowName: 'None' } }, AbilityExtraStatsUIData: [], AbilityLongDescription: { CultureInvariantString: null }, bExternal: false, ...o,
})

const modules = {
  NewRow_1: base('Skills.Ability.AssaultSeeker', {
    MaxLevel: 3, GridPosition: { X: 5, Y: 3 }, DisplayName: ft('SKILLS/ABILITIES_ASSAULTSEEKER_NAME', 'Assault Seeker'),
    AbilityLongDescription: ft('SKILLS/ABILITIES_ASSAULTSEEKER_LONGDESC', 'A modified hunter seeker.'),
    SkillPointsPerLevel: { Value: 1, Curve: { CurveTable: { ObjectPath: COSTS }, RowName: 'Ability_Standard' } },
    PrereqModuleTags_And: [{ TagName: 'Skills.Key.Trooper1' }], PrereqModuleTags_Or: [{ TagName: 'Skills.Ability.FragGrenade' }],
    AbilityExtraStatsUIData: [stat('Seeker.Cooldown', 'Cooldown'), stat('Seeker.Bonus', 'Blade Damage', true), stat('Missing.Row', 'Range')],
  }),
  NewRow_2: base('Skills.Attribute.WeirdingWay1', { SkillArea: 'ESkillTree::BeneGesserit', MaxLevel: 2, DisplayName: ft('SKILLS/ATTRIBUTE_BLADEDAMAGE_NAME', 'Blade Damage') }),
  NewRow_3: base('Skills.Key.Trooper1', { bExternal: true }),
  NewRow_4: base('Skills.Ability.HealingCapsule', { SkillArea: 'ESkillTree::Hidden', DisplayName: ft('K', 'Healing Capsule') }),
  NewRow_5: base('Skills.Attribute.Blade3', { DisplayName: ft('K2', 'XX_') }),
  NewRow_6: base('Skills.Attribute.Weaponry2', { DisplayName: ft('SKILLS/STAT_SMGDAMAGE', 'SMG Damage') }),
  NewRow_7: base('Skills.Attribute.Driver3', { DisplayName: ft('SKILLS/ATTRIBUTE_VEHICLEMININGYIELD_NAME', 'Vehicle Yield') }),
}
const curves = {
  [COSTS]: { Ability_Standard: lin([1, 2], [3, 4]) },
  [TUNING]: { 'Seeker.Cooldown': lin([1, 22], [3, 18]), 'Seeker.Bonus': lin([1, 0.25], [3, 0.35]) },
}
const en = { ST_Localization_Abilities: { 'SKILLS/ATTRIBUTE_BLADEDAMAGE_LONGDESC': 'You know where to strike.', 'SKILLS/ATTRIBUTE_VEHICLEMININGYIELD_LONGDESC': '' } }
const by = Object.fromEntries(normalizeSkills({ modules, curves, en }).map((s) => [s.id, s]))

describe('уміння з файлів гри', () => {
  it('id — тег у нижньому регістрі з _ замість крапок', () => {
    expect(skillId('Skills.Ability.AssaultSeeker')).toBe('skills_ability_assaultseeker')
  })

  it('крива: лінійно між ключами, до першого й після останнього — крайні, константна — лівий ключ', () => {
    const c = lin([1, 2], [3, 4])
    expect(evalCurve(c, 2)).toBe(3)
    expect(evalCurve(c, 0)).toBe(2)
    expect(evalCurve(c, 9)).toBe(4)
    expect(evalCurve({ ...c, InterpMode: 'RCIM_Constant' }, 2)).toBe(2)
  })

  it('здібність: школа, вид, клітинка, ранги з ціною й бонусами гри, зв’язки', () => {
    const s = by.skills_ability_assaultseeker
    expect(s).toMatchObject({ name: 'Assault Seeker', school: 'trooper', kind: 'ability', x: 5, y: 3, max: 3, desc: 'A modified hunter seeker.', released: true })
    expect(s.icon).toBe('assets/Dune/GUI/Textures/Icons/T_UI_X_D')
    expect(s.and).toEqual(['skills_key_trooper1'])
    expect(s.or).toEqual(['skills_ability_fraggrenade'])
    expect(s.levels.map((l) => l.cost)).toEqual([2, 3, 4])
    // відсоткове ×100, рядка кривої нема — бонус пропущено
    expect(s.levels[0].bonuses).toEqual([['Cooldown', 22, false], ['Blade Damage', 25, true]])
    expect(s.levels[1].bonuses).toEqual([['Cooldown', 20, false], ['Blade Damage', 30, true]])
    expect(s.levels[2]).toEqual({ cost: 4, bonuses: [['Cooldown', 18, false], ['Blade Damage', 35, true]], perks: [], buffs: [] })
  })

  it('атрибут без кривої ціни — Value на кожному рангу; опис — за ключем назви _NAME → _LONGDESC', () => {
    const s = by.skills_attribute_weirdingway1
    expect(s).toMatchObject({ school: 'benegesserit', kind: 'attribute', desc: 'You know where to strike.' })
    expect(s.levels).toEqual([{ cost: 1, bonuses: [], perks: [], buffs: [] }, { cost: 1, bonuses: [], perks: [], buffs: [] }])
  })

  it('ключа опису нема в перекладах — опис null (сайт лишить відомий), а не порожній рядок', () => {
    expect(by.skills_attribute_weaponry2.desc).toBeNull()
    expect(by.skills_attribute_driver3.desc).toBeNull()
  })

  it('ключі — не вміння; прихована школа й заглушки назв — невипущене', () => {
    expect(by.skills_key_trooper1).toBeUndefined()
    expect(by.skills_ability_healingcapsule.released).toBe(false)
    expect(by.skills_attribute_blade3.released).toBe(false)
  })

  it('рядка кривої ціни нема (патч перейменував) — помилка розділу, а не тихо інша ціна', () => {
    const broken = { NewRow_1: { ...modules.NewRow_1, SkillPointsPerLevel: { Value: 1, Curve: { CurveTable: { ObjectPath: COSTS }, RowName: 'Renamed' } } } }
    expect(() => normalizeSkills({ modules: broken, curves, en })).toThrow('Renamed')
  })
})


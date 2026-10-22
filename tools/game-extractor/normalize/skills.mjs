/*
 * Уміння (DT_TrainingModules) у формі skills.json сайту. id — тег модуля в нижньому регістрі з «_» замість крапок: це
 * рівно slug-и questlog, тож коди білдів ?b= лишаються дійсними. Ціна рангу — Value × крива SkillCosts/CT_AbilityTuning,
 * бонуси здібностей — криві CT_AbilityTuning/CT_AbilityStatDisplay за рангом (відсоткові ×100). Ключі (bExternal:
 * відкриття школи чи завершального вузла) — не вміння; прихована школа й заглушки назв — невипущене.
 */
import { iconPath, namespaceOf, textOf } from './common.mjs'

export const skillId = (tag) => String(tag).toLowerCase().replaceAll('.', '_')

/** значення кривої UE в точці t: лінійно між ключами (константна — лівий ключ), за межами — крайні */
export function evalCurve(c, t) {
  const k = c?.Keys ?? []
  if (!k.length) return null
  if (t <= k[0].Time) return k[0].Value
  for (let i = 1; i < k.length; i++) {
    if (t > k[i].Time) continue
    const a = k[i - 1], b = k[i]
    return c.InterpMode === 'RCIM_Constant' ? a.Value : a.Value + ((b.Value - a.Value) * (t - a.Time)) / (b.Time - a.Time)
  }
  return k[k.length - 1].Value
}

/** FText опису: довгий опис здібності, а без нього — ключ назви _NAME → _LONGDESC у тій самій таблиці рядків */
export function descText(m) {
  if (m.AbilityLongDescription?.Key) return m.AbilityLongDescription
  const n = m.DisplayName
  return n?.Key && /_NAME$/.test(n.Key) ? { TableId: n.TableId, Key: n.Key.replace(/_NAME$/, '_LONGDESC') } : null
}

const round = (v) => +Number(v).toFixed(4)
const STUB = /^(LOC_|XX_)/

/** modules — рядки DT_TrainingModules; curves — { ObjectPath таблиці кривих: Rows }; en — англійський .locres (описи) */
export function normalizeSkills({ modules, curves = {}, en = {} }) {
  const curve = (ref) => curves[ref?.CurveTable?.ObjectPath]?.[ref?.RowName] ?? null
  const out = []
  for (const m of Object.values(modules)) {
    if (m.bExternal) continue
    const name = textOf(m.DisplayName)
    const d = descText(m)
    const max = m.MaxLevel || 1
    const sp = m.SkillPointsPerLevel ?? {}
    const named = sp.Curve?.RowName && sp.Curve.RowName !== 'None' && sp.Curve.CurveTable
    if (named && !curve(sp.Curve)) throw new Error(`${m.Tag?.TagName}: нема кривої ціни ${sp.Curve.RowName}`)
    const levels = Array.from({ length: max }, (_, i) => {
      const c = curve(sp.Curve)
      const bonuses = []
      for (const e of m.AbilityExtraStatsUIData ?? []) {
        const s = curve(e.Stat)
        if (!s) continue
        bonuses.push([textOf(e.DescriptionShort), round(evalCurve(s, i + 1) * (e.bPercentBased ? 100 : 1)), !!e.bPercentBased])
      }
      return { cost: Math.round((sp.Value ?? 1) * (c ? evalCurve(c, i + 1) : 1)), bonuses, perks: [], buffs: [] }
    })
    out.push({
      id: skillId(m.Tag.TagName),
      name,
      icon: iconPath(m.Icon),
      school: String(m.SkillArea ?? '').replace(/^ESkillTree::/, '').toLowerCase(),
      kind: m.Tag.TagName.split('.')[1]?.toLowerCase() ?? null,
      desc: textOf(m.AbilityLongDescription) || (d && en[namespaceOf(d)]?.[d.Key]) || null,
      x: m.GridPosition?.X ?? 0,
      y: m.GridPosition?.Y ?? 0,
      max,
      levels,
      and: (m.PrereqModuleTags_And ?? []).map((t) => skillId(t.TagName)),
      or: (m.PrereqModuleTags_Or ?? []).map((t) => skillId(t.TagName)),
      released: m.SkillArea !== 'ESkillTree::Hidden' && !!name && !STUB.test(name),
    })
  }
  return out
}

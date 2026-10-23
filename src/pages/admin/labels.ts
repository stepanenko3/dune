/**
 * Підписи варіантів полів даних гри мовою сайту (категорії, підкатегорії, класи, школи…) — тим самим словником, що й
 * довідник та уміння на сайті. Значення, якого словник не знає (гра додала нове), лишається як у грі.
 */
import { groupLabel, kindLabel, rarityLabel, SECTIONS, setLabel, subLabel } from '@/lib/catalog'
import { KIND as SKILL_KIND, SCHOOLS } from '@/lib/skills'
import { t } from '@/lib/i18n'

/** словник каже «Інше» на невідоме — тоді краще саме значення з гри */
const known = (label: string, v: string) => (label === t('Інше') && v !== 'misc' && v !== 'other' ? v : label)

/** класи предметів, яких нема в словнику довідника */
const ITEM_KIND: Record<string, string> = {
  Contract: t('Контракти'), Customization: t('Кастомізація'), Holsters: t('Кобури'), Abilities: t('Здібності'), Augment: t('Модифікації'),
  Clothes: t('Одяг'), Faction: t('Фракційне'), HalloweenCurrency: t('Святкова валюта'), HideFromExchange: t('Не для біржі'), Maps: t('Мапи'), Solaris: t('Солярис'),
}

const LABELS: Record<string, (v: string) => string> = {
  'item.cat': (v) => SECTIONS.find((s) => s.id === (v === 'misc' ? 'resources' : v))?.label ?? v,
  'item.sub': (v) => known(subLabel(v), v),
  'item.kind': (v) => ITEM_KIND[v] ?? known(kindLabel(v), v),
  rarity: (v) => rarityLabel(v),
  tier: (v) => { const m = /^tier(\d+)$/.exec(v); return m ? t('Тір {n}', { n: m[1] }) : v },
  'buildable.grp': (v) => known(groupLabel(v), v),
  'buildable.set': (v) => setLabel(v),
  'skill.school': (v) => SCHOOLS.find((s) => s[0] === v)?.[1] ?? (v === 'hidden' ? t('Поза школами') : v),
  'skill.kind': (v) => SKILL_KIND[v] ?? v,
}

export const optionLabel = (dict: string, value: string) => {
  try { return LABELS[dict]?.(value) || value } catch { return value }
}

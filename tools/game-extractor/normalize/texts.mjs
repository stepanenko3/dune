/*
 * Переклади (Game.locres, 14 мов) для випущених предметів, пристроїв, модулів, рецептів, вмінь, типів міток мапи, категорій легенди й місць: FText рядка таблиці
 * вказує таблицю рядків (namespace) і ключ, текст мовою — з .locres. Рецепт — назва першого виходу. Нема тексту — нема запису.
 */
import { namespaceOf } from './common.mjs'
import { descText, skillId } from './skills.mjs'

/** код мови сайту → тека .locres гри */
export const LANG_DIRS = { de: 'de', en: 'en', es: 'es', fr: 'fr', it: 'it', ja: 'ja', ko: 'ko', pl: 'pl', 'pt-BR': 'pt-BR', ru: 'ru', tr: 'tr', uk: 'uk', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW' }

export function normalizeTexts({ loc, rows, records }) {
  const out = []
  for (const [lang, dict] of Object.entries(loc)) {
    const text = (ft) => (ft?.Key && dict?.[namespaceOf(ft)]?.[ft.Key]) || null
    const push = (kind, id, name, description) => { if (name || description) out.push({ id: `${kind}:${id}:${lang}`, name: name ?? null, description: description ?? null }) }
    const itemName = new Map()
    for (const r of records.items) {
      if (!r.released) continue
      const sd = rows.items[r.id]?.StaticData
      const name = text(sd?.Name)
      itemName.set(r.id, name)
      push('item', r.id, name, text(sd?.LongDesc))
    }
    for (const r of records.placeables) if (r.released) push('placeable', r.id, text(rows.placeables[r.id]?.m_DisplayName), null)
    for (const r of records.buildables) {
      if (!r.released) continue
      push('buildable', r.id, text((rows.building[r.id] ?? rows.placeables[r.id])?.m_DisplayName), null)
    }
    for (const r of records.recipes) if (r.released && r.out?.length) push('recipe', r.id, itemName.get(r.out[0][0]) ?? null, null)
    const skillOk = new Set((records.skills ?? []).filter((r) => r.released).map((r) => r.id))
    for (const m of Object.values(rows.modules ?? {})) {
      const id = skillId(m.Tag?.TagName)
      if (skillOk.has(id)) push('skill', id, text(m.DisplayName), text(descText(m)))
    }
    // мапа: назви типів міток і назви місць («таблиця рядків:ключ», одна на ключ)
    for (const [id, r] of Object.entries(rows.markerTypes ?? {})) push('markerType', id, text(r.m_MarkerDisplayName), null)
    const cats = new Map(Object.values(rows.legend ?? {}).map((l) => l.m_MarkerCategoryDisplayName).filter((c) => c?.Key).map((c) => [`${namespaceOf(c)}:${c.Key}`, c]))
    for (const [id, c] of cats) push('legend', id, text(c), null)
    const places = new Set((records.markers ?? []).map((r) => r.name).filter(Boolean))
    for (const k of places) {
      const i = k.indexOf(':')
      push('place', k, dict?.[k.slice(0, i)]?.[k.slice(i + 1)] || null, null)
    }
  }
  return out
}

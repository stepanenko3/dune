/*
 * Типи міток мапи гри (CDT_FullscreenMapMarkers, шлях — DefaultGame.ini m_MapMarkerTypesDataTable): id — рядок
 * таблиці (Cave, EnemyOutpost, HouseRepresentativeAtreides…), тег фільтра MapMarkers.*, іконка — текстура гри (картинка —
 * файл awakening.wiki з тим самим іменем), статична (місце) чи ні, категорія легенди мапи гри (DT_MapLegend: «Місцевість»,
 * «NPC», «Ресурси»… — рядок легенди з тією самою текстурою іконки, інакше найчастіша серед типів з тим самим тегом
 * без останньої частини; «таблиця рядків:ключ», назва — у розділі texts).
 */
import { iconPath, namespaceOf } from './common.mjs'

export function normalizeMarkerTypes(rows, legend = {}) {
  const byIcon = new Map()
  for (const l of Object.values(legend)) {
    const icon = iconPath(l.m_IconTexture), c = l.m_MarkerCategoryDisplayName
    if (icon && c?.Key && !byIcon.has(icon)) byIcon.set(icon, `${namespaceOf(c)}:${c.Key}`)
  }
  const out = Object.entries(rows).map(([id, r]) => {
    const tag = r.m_MarkerFilterTag?.TagName
    const icon = iconPath(r.m_IconTexture)
    return { id, tag: tag && tag !== 'None' ? tag : null, icon, static: !!r.m_bIsStatic, legend: (icon && byIcon.get(icon)) ?? null }
  })
  // без власної категорії (у легенді нема іконки типу) — найчастіша категорія типів з тим самим тегом без останньої
  // частини: торговці й представники Домів (MapMarkers.Characters.*) — «NPC»; лут (MapMarkers.Events.Encounter.*) —
  // нічого, бо в його сусідів категорії нема
  const parent = (tag) => tag.split('.').slice(0, -1).join('.')
  const by = new Map()
  for (const t of out) if (t.legend && t.tag) {
    const k = parent(t.tag)
    if (!by.has(k)) by.set(k, new Map())
    by.get(k).set(t.legend, (by.get(k).get(t.legend) ?? 0) + 1)
  }
  for (const t of out) {
    // MapMarkers.X без продовження — сусіди за самим MapMarkers, тобто будь-що: не вгадуємо
    const m = !t.legend && t.tag && t.tag.split('.').length >= 3 && by.get(parent(t.tag))
    if (m) t.legend = [...m].sort((a, b) => b[1] - a[1])[0][0]
  }
  return out
}

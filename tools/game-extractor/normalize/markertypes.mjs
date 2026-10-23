/*
 * Типи міток мапи гри (CDT_FullscreenMapMarkers, шлях — DefaultGame.ini m_MapMarkerTypesDataTable): id — рядок
 * таблиці (Cave, EnemyOutpost, HouseRepresentativeAtreides…), тег фільтра MapMarkers.*, іконка — текстура гри (картинка —
 * файл awakening.wiki з тим самим іменем), статична (місце) чи ні, категорія легенди мапи гри (DT_MapLegend: «Місцевість»,
 * «NPC», «Ресурси»… — рядок легенди з тією самою текстурою іконки, інакше найчастіша серед типів з тим самим тегом
 * без останньої частини; «таблиця рядків:ключ», назва — у розділі texts), вигляд іконки — рецепт гри (DT_IconPreset).
 */
import { iconPath, namespaceOf } from './common.mjs'

/**
 * вигляд іконки за рецептом гри (DT_IconPreset, рядок — m_IconAppearance типу): гліф (розмір, тон, якщо тонується) і
 * фон (текстура, розмір, тон) — так гра малює мітку на мапі; пресета нема — null
 */
export function lookOf(p) {
  if (!p) return null
  const hex = (t) => (t?.SpecifiedColor?.Hex ? `#${t.SpecifiedColor.Hex}` : null)
  const bg = iconPath(p.m_Background)
  return { size: p.m_IconSize?.X ?? null, tint: p.m_IsIconTinted ? hex(p.m_IconTint) : null, bg, bgSize: bg ? p.m_BackgroundSize?.X ?? null : null, bgTint: bg ? hex(p.m_BackgroundTint) : null }
}

export function normalizeMarkerTypes(rows, legend = {}, presets = {}) {
  const byIcon = new Map()
  for (const l of Object.values(legend)) {
    const icon = iconPath(l.m_IconTexture), c = l.m_MarkerCategoryDisplayName
    if (icon && c?.Key && !byIcon.has(icon)) byIcon.set(icon, `${namespaceOf(c)}:${c.Key}`)
  }
  const out = Object.entries(rows).map(([id, r]) => {
    const tag = r.m_MarkerFilterTag?.TagName
    const icon = iconPath(r.m_IconTexture)
    return { id, tag: tag && tag !== 'None' ? tag : null, icon, static: !!r.m_bIsStatic, legend: (icon && byIcon.get(icon)) ?? null, look: lookOf(presets[r.m_IconAppearance?.Name]) }
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

const NPC_ICON = 'assets/Dune/GUI/Textures/Icons/Gameplay/Map/T_UI_IconMapMarkerNpc_D'
const KEY_ICON = 'assets/Dune/GUI/Textures/Icons/Gameplay/PickupNotifications/T_UI_IconPickupKeycode_D'
/**
 * Типи точок, яких гра на своїй мапі не позначає, — з ігрових зв'язків: NPC (тип — фракція рядка NPC) — іконка фракції
 * (DT_FactionData, лише точний ключ; нема — текстура мітки NPC гри), ключ — іконка ключа-коду гри в кольорі ключа
 * (DT_InteractionKeyCodes). used — { npc: [фракції], key: [ключі] } з точок; записи — як у типів міток, з kind і color.
 */
export function normalizeMapKinds({ factions = {}, keyCodes = {}, used }) {
  // вигляд: гліф без фону (розмір — як у міток політики гри), ключ — у кольорі ключа
  const rec = (id, kind, icon, color = null) => ({ id, kind, tag: null, icon, static: true, legend: null, color, look: { size: 32, tint: color, bg: null, bgSize: null, bgTint: null } })
  return [
    ...[...new Set(used.npc ?? [])].map((f) => rec(f, 'npc', iconPath(factions[f]?.m_FactionIcon) ?? NPC_ICON)),
    ...[...new Set(used.key ?? [])].map((k) => { const h = keyCodes[k]?.m_KeyColor?.Hex; return rec(k, 'key', KEY_ICON, h ? `#${h}` : null) }),
  ]
}

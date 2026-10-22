/** Спільне для нормалізаторів: рядки таблиці з експорту, шляхи іконок, теги, назви. */

/** експорт пакета (масив, як GetExports) → злиті Rows таблиці / композиту */
export function rowsOf(exports) {
  const out = {}
  for (const e of exports ?? []) if (e?.Rows) Object.assign(out, e.Rows)
  return out
}

/** «/Game/Dune/…/T_X_D.T_X_D» → «assets/Dune/…/T_X_D» (як у каталозі сайту); нема — null */
export function iconPath(soft) {
  const p = soft?.AssetPathName
  if (!p || p === 'None') return null
  return 'assets' + p.replace(/^\/Game/, '').replace(/\.[^/.]+$/, '')
}

/** тір із тегів LootTier.N (нема — 0) */
export const tierOf = (tags = []) => Number(/^LootTier\.(\d+)$/.exec(tags.find((t) => /^LootTier\.\d+$/.test(t)) ?? '')?.[1] ?? 0)

/** RocketLauncher → rocket_launcher, SMG → smg */
export const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

/** англійська назва з FText (нема — null) */
export const textOf = (t) => (t?.SourceString ? t.SourceString : null)

/** простір імен таблиці рядків з TableId: «/Game/…/ST_Localization_Items.ST_Localization_Items» → «ST_Localization_Items» */
export const namespaceOf = (t) => (t?.TableId ? t.TableId.split('.').pop() : null)

/** числове поле: 0 і не-число — null (у каталозі «не стосується») */
export const nonZero = (v) => (typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : null)

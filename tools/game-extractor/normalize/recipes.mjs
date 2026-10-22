/*
 * Рецепти (DT_ItemsCraftingRecipes) у формі каталогу сайту: входи — нижча якість (як у каталозі), вихід, час, вода;
 * станції — усі пристрої, чиї типи виробництва (stations.json з експортера) перетинаються з потрібними рецепту
 * («Personal» — з інвентаря, без станції). Назва — назва першого виходу. Невипущене — якщо хоч один вхід чи вихід
 * не випущений.
 */
import { nonZero } from './common.mjs'

const pairs = (list) => (list ?? []).map((x) => [x?.Key?.Name, x?.Value?.Amount]).filter(([id]) => id && id !== 'None')

export function normalizeRecipes(rows, { items, stations }) {
  const item = new Map(items.map((i) => [i.id, i]))
  // тип виробництва → пристрої, що його мають
  const byType = new Map()
  for (const [placeable, types] of Object.entries(stations)) for (const t of types) byType.set(t, [...(byType.get(t) ?? []), placeable])

  return Object.entries(rows).map(([id, r]) => {
    const q0 = r.Recipe?.IngredientsPerQuality?.[0] ?? {}
    const ins = pairs(q0.Ingredients)
    const out = pairs(r.Recipe?.Outcome)
    const types = (r.RequiredProductionTypes ?? []).map((t) => t.Name).filter((t) => t && t !== 'Personal')
    const at = [...new Set(types.flatMap((t) => byType.get(t) ?? []))].sort()
    return {
      id,
      name: out.length ? item.get(out[0][0])?.name ?? null : null,
      time: r.Recipe?.CraftingTimeInSec ?? null,
      // вода: витрата; рецепт, що дає воду, — WaterOutcome; без води — 0 (так у каталозі)
      water: nonZero(q0.m_WaterIngredientAmount) ?? nonZero(r.Recipe?.WaterOutcome) ?? (typeof q0.m_WaterIngredientAmount === 'number' ? 0 : null),
      at, in: ins, out,
      released: [...ins, ...out].every(([x]) => item.get(x)?.released === true),
    }
  })
}

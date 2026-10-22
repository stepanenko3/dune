/*
 * Будівельні модулі (CDT_BuildingData + пристрої з наборів CDT_PlaceableData): набір — патент із
 * DT_BuildableUnlockableSetsData, що містить рядок; група — підкатегорія меню (як групи на сайті); здоров'я й ціна —
 * CDT_BuildableGroupData[група].m_BuildableTierData[тір]. id — ім'я рядка гри (ключі вікі зіставляє план 3 за img).
 * Невипущене: не в списку, не в жодному наборі чи фракція Blockout.
 */
import { iconPath, textOf } from './common.mjs'

/** підкатегорія меню гри → група на сайті */
const GROUP = {
  Foundations: 'structural', Walls: 'wall', Triangle_Walls: 'wedge_wall', Roofs: 'roof', Floors: 'roof', Ramps: 'incline',
  Stairs: 'special', Decorative: 'special', Fabricators: 'fabricator', Refineries: 'refinery', Storage: 'storage', Utilities: 'utility',
}

export function normalizeBuildables({ building, placeables, group, sets, subcat }) {
  // рядок → набори (кілька — беремо перший за абеткою)
  const setOf = new Map()
  for (const s of Object.keys(sets).sort()) for (const b of sets[s].m_Buildables ?? []) if (!setOf.has(b.Name)) setOf.set(b.Name, s)
  // тип групи → підкатегорія меню
  const subOf = new Map()
  for (const [sc, v] of Object.entries(subcat)) for (const g of v.m_Buildables ?? []) if (!subOf.has(g.Name)) subOf.set(g.Name, sc)

  const one = (id, r, released) => {
    const gt = r.m_BuildableGroupType?.Name ?? null
    const tier = (group[gt]?.m_BuildableTierData ?? []).find((t) => t.Key?.Name === r.m_BuildableTier?.Name)?.Value
    const sc = subOf.get(gt)
    return {
      id, set: setOf.get(id) ?? null,
      group: sc ? GROUP[sc] ?? sc.toLowerCase() : null,
      name: textOf(r.m_DisplayName), img: iconPath(r.m_BuildableIcon),
      health: tier?.m_MaxHealth ?? null,
      cost: (tier?.m_PlacementCosts ?? []).map((c) => [c.Key?.Name, c.Value]).filter(([x]) => x && x !== 'None').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      released,
    }
  }
  const out = Object.entries(building).map(([id, r]) => one(id, r, r.m_bShowInList === true && setOf.has(id) && r.m_BuildableFaction?.Name !== 'Blockout'))
  // пристрої — лише ті, що відкриваються наборами (як «placeables/*» на сайті)
  for (const [id, r] of Object.entries(placeables)) if (setOf.has(id)) out.push(one(id, r, true))
  return out
}

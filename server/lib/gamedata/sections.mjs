/** розділи ігрових даних (spec §4.1); RECORD_SECTIONS — списки записів з id (для них журнал рахує додане/прибране), решта — blob */
export const SECTIONS = ['items', 'placeables', 'recipes', 'buildables', 'skills', 'texts', 'maps', 'markers', 'markerTypes', 'resources', 'spice', 'ddLayouts', 'config', 'images']
export const RECORD_SECTIONS = new Set(['items', 'placeables', 'recipes', 'buildables', 'skills', 'texts', 'markers', 'markerTypes', 'resources', 'spice'])
/**
 * групи розділів, що мусять мати одне джерело: довідник (рецепти посилаються на предмети й пристрої), мапа (точки, їхні
 * типи, розкладки ГП і ресурси — одним джерелом). Межі мап (maps) — до тайлів, тож лишаються окремо з картинками.
 */
export const GROUPS = { catalog: ['items', 'placeables', 'recipes'], map: ['markers', 'markerTypes', 'ddLayouts', 'resources'] }
/** група розділу (null — розділ сам по собі) */
export const groupOf = (section) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(section)) ?? null
/**
 * основне групи, поки адмін не вибрав: мапа — TH.GL (точки з файлів гри ще без руди за картами тепла й без міст — план 5b;
 * перемикає адмін, коли їх досить); решта — перше за пріоритетом (файли гри)
 */
export const DEFAULT_PRIMARY = { map: 'thgl' }


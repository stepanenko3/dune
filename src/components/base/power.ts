/**
 * Пристрої моделі бази → довідник гри: будівельні записи (ціна, іконка), пристрої (потужність) — і з них енергія бази
 * й паливні генератори. Окремо від картки калькулятора (BaseCalc.tsx), щоб рахунок можна було перевірити тестом.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Target } from '@/lib/calc'

/**
 * Пристрої давніх баз (без type і recipe) → пристрої гри (id рядка таблиці гри, як type станцій редактора).
 * null — у довіднику ціни немає (лише для лімітів). Ключ — повна назва пристрою в моделі (full || name).
 */
export const PLACE: Record<string, string | null> = {
  'Спрямований вітряк': 'WindTurbineDirectional_Placeable',
  'Велика вітропастка': 'LargeWindtrap_Placeable',
  'Ремонтна станція': 'RepairStation_Placeable',
  'Фабрикатор виживання': 'SurvivalFabricator_Placeable',
  'Фабрикатор зброї': 'WeaponsFabricator_Placeable',
  'Фабрикатор одягу': 'WearablesFabricator_Placeable',
  'Фабрикатор техніки': 'VehiclesFabricator_Placeable',
  Ресайклер: 'Recycler_Placeable',
  Контейнер: 'StorageContainer_Placeable',
  'Склад деталей': 'StorageContainer_Placeable', // звичайний контейнер (з алюмінію)
  'Великий переробник спайсу': 'LargeSpiceRefinery_Placeable',
  Цистерна: 'MediumWaterCistern_Placeable', // середня
  Deathstill: 'Fremen_Deathstill_Placeable', // припущення: звичайний, не розширений
  'Великий переробник руди': 'LargeOreRefinery_Placeable',
  'Середній переробник руди': 'MediumOreRefinery_Placeable',
  Генератор: 'Generator_Placeable',
  'Хімічний переробник': 'MediumChemicalRefinery_Placeable', // припущення: середній
  'Консоль суб-фіфу': 'Totem_Small_Placeable',
  'Світлові панелі': null,
  Лава: null,
  'Контейнери меланжу': null,
  Паливо: null,
}
/** будівельні деталі моделі (KINDS у build.js) → деталі гри (форми двигуна баз): іконка й ціна з довідника */
export const ROW_BUILD: Record<string, string> = {
  fsq: 'Sardaukar_Foundation', ftri: 'Sardaukar_Foundation_Wedge', ramp: 'Sardaukar_Ramp', csq: 'Sardaukar_Floor_02', ctri: 'Sardaukar_Floor_Wedge',
  wall: 'Sardaukar_Wall_01', door: 'Sardaukar_Door_Frame', rail: 'Sardaukar_Railing', stairs: 'Sardaukar_Stairs', pillar: 'Sardaukar_Pillar_Middle',
}
/** пристрої з рецептом моделі → пристрої гри (для іконки й ціни) */
export const RECIPE_BUILD: Record<string, string> = {
  shield: 'Choam_PentashieldSurfaceVertical_Placeable', generator: 'Generator_Placeable', fabricator: 'Fabricator_Placeable',
  repair: 'RepairStation_Placeable', storage: 'StorageContainer_Placeable', console: 'Totem_Placeable',
}
/** іконки пристроїв без будівельного запису: пристрій чи предмет довідника */
export const ICON_OF: Record<string, ['place' | 'item', string]> = {
  'Світлові панелі': ['place', 'Atre_LightCeiling_Placeable'],
  Лава: ['place', 'Atre_Couch_1_Placeable'],
  'Контейнери меланжу': ['place', 'SpiceSilo_Placeable'],
  Паливо: ['item', 'Oil'],
  'Солідо-реплікатор (з собою)': ['place', 'Fabricator_Placeable'],
}
/** паливний генератор: на нього — паливо на тиждень */
export const FUEL_GEN = 'Generator_Placeable'
/** будівельний запис пристрою моделі: тип станції редактора, назва давньої бази чи рецепт */
export const buildIdOf = (it: any): string | null => it.type || PLACE[it.full || it.name] || (it.recipe ? RECIPE_BUILD[it.recipe] : null) || null

/** пристрої моделі за рядком калькулятора: «dev:<рецепт>» — з рецептом, «pl:<назва>» — решта, що рахується в ліміти */
export function modelsOf(M: any, kinds: Record<string, string | null>) {
  const models = new Map<string, any[]>()
  const add = (id: string, it: any) => { if (!models.has(id)) models.set(id, []); models.get(id)!.push(it) }
  const all: any[] = M.items ?? [...(M.roofItems || []), ...M.rooms.flatMap((r: any) => r.items || [])]
  for (const it of all) {
    if (it.recipe) add('dev:' + it.recipe, it)
    else if (it.kind in kinds) add('pl:' + (it.full || it.name), it)
  }
  return models
}

/**
 * Енергія: потужність кожного пристрою — з довідника (power(id пристрою гри)), а як там нема — з рецепта моделі
 * (devices); рядок калькулятора — у своїй кількості (частка від моделі); додані з довідника будівлі — теж; пентащити —
 * shieldDraw (по 3 на секцію) пропорційно їх кількості в калькуляторі
 */
export function energyOf({ targets, models, devices, shieldDraw, power }: {
  targets: Target[]
  models: Map<string, any[]>
  devices: { id: string; n: number; power?: number }[]
  shieldDraw: number
  power: (placeId: string) => number | null | undefined
}) {
  const devPower = new Map<string, number>(devices.map((x) => [x.id, x.power || 0]))
  const powerOf = (bid: string | null, recipe?: string) => {
    // тип станції — id пристрою гри: потужність — з довідника за ним
    const p = bid ? power(bid) : null
    return p ?? (recipe ? devPower.get(recipe) ?? 0 : 0)
  }
  let gives = 0, takes = 0
  const add = (p: number, k: number) => { if (p > 0) gives += p * k; else takes -= p * k }
  for (const x of targets) {
    if (x.kind === 'build') { add(powerOf(x.id), x.qty); continue }
    const ms = models.get(x.id)
    if (ms?.length) {
      const k = x.qty / ms.length
      for (const it of ms) add(powerOf(buildIdOf(it), it.recipe), k)
      continue
    }
    // пристрій із рецептом без станції в моделі (ui.extras): потужність рецепта
    if (x.id.startsWith('dev:')) add(devPower.get(x.id.slice(4)) ?? 0, x.qty)
  }
  const shields = devices.find((x) => x.id === 'shield')?.n
  if (shields) takes += shieldDraw * ((targets.find((x) => x.id === 'dev:shield')?.qty ?? 0) / shields)
  return { gives, takes }
}

/** скільки паливних генераторів у списку: рядки моделі за їхніми пристроями й додані з довідника */
export function fuelGens(list: Target[], models: Map<string, any[]>) {
  return list.reduce((n, x) => {
    if (x.kind === 'build') return n + (x.id === FUEL_GEN ? x.qty : 0)
    const ms = models.get(x.id)
    if (!ms?.length) return n
    const k = ms.filter((it) => buildIdOf(it) === FUEL_GEN).length / ms.length
    return n + Math.round(x.qty * k)
  }, 0)
}

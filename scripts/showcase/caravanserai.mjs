/*
 * «Караван-сарай» — 6 ділянок у лінію (10 × 60). Головне — крита вулиця 4 × 4 наскрізь через усю базу: техніка
 * заїжджає з півдня крізь пентащит і виїжджає на півночі, ніде не розвертаючись. Обабіч вулиці — бокси (краулер,
 * багі, відкриті до вулиці), майстерня, склад, переробка, вода. Над вулицею — ритм: вежа брами, павільйон-казарма з
 * майданчиком орні на даху, тераса, зал гільдії зі скляною стелею, тераса, павільйон кімнат з майданчиком, вежа брами.
 */
import * as L from './lib.mjs'

export function caravanserai() {
  const B = L.createBase('k')
  const claims = Array.from({ length: 6 }, (_, i) => ({ x: -5, y: i * 10, w: 10, d: 10 }))
  const Y = 60

  // ---------- рівень 0: вулиця й кімнати обабіч ----------
  B.block({ tiles: L.rect(-2, 2, 0, Y), z: 0, h: 4, zone: { name: 'Крита вулиця', group: 'drive' } })
  const slits = (e, i) => (i === 2 && Math.abs(Math.abs(e.m.x) - 5) < 1e-6 && Math.round(e.m.y - 0.5) % 3 === 1 ? 'MTX_Neut_DesertMechanic_Window_01' : null)
  const side = (x0, x1, rooms) => {
    for (const [y0, y1, name, group, lean] of rooms) B.block({ tiles: L.rect(x0, x1, y0, y1), z: 0, h: 4, lean, wall: slits, zone: { name, group } })
  }
  side(-5, -2, [
    [0, 8, 'Брама, західна вежа', 'core', true], [8, 20, 'Бокс краулера', 'drive'], [20, 30, 'Майстерня техніки', 'craft'],
    [30, 40, 'Переробка руди', 'refine'], [40, 52, 'Водосховище', 'craft'], [52, 60, 'Північна брама, західна вежа', 'core', true],
  ])
  side(2, 5, [
    [0, 8, 'Брама, східна вежа', 'core', true], [8, 20, 'Бокс багі', 'drive'], [20, 30, 'Склад каравану', 'store'],
    [30, 40, 'Хімія й енергія', 'refine'], [40, 52, 'Склад спайсу', 'store'], [52, 60, 'Північна брама, східна вежа', 'core', true],
  ])

  // ---------- рівень +4: брами, павільйони й тераси над вулицею ----------
  const win = (rows, step = 2) => (e, i) => (rows.includes(i) && Math.round((Math.abs(e.out.x) > 0.5 ? e.m.y : e.m.x) - 0.5) % step === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null)
  B.block({ tiles: L.rect(-4, 4, 1, 8), z: 4, h: 4, wall: win([1]), zone: { name: 'Кордегардія (південь)', group: 'core' } })
  B.block({ tiles: L.rect(-4, 4, 52, 59), z: 4, h: 4, wall: win([1]), zone: { name: 'Кордегардія (північ)', group: 'core' } })
  B.block({ tiles: L.rect(-3, 3, 2, 7), z: 8, h: 6, roof: 'hip', wall: win([1, 4]), zone: { name: 'Вежа південної брами', group: 'tower' } })
  B.block({ tiles: L.rect(-3, 3, 53, 58), z: 8, h: 6, roof: 'hip', wall: win([1, 4]), zone: { name: 'Вежа північної брами', group: 'tower' } })
  B.block({ tiles: L.rect(-5, 5, 11, 21), z: 4, h: 3, wall: win([1]), zone: { name: 'Казарма', group: 'core' } })
  B.block({ tiles: L.rect(-5, 5, 39, 49), z: 4, h: 3, wall: win([1]), zone: { name: 'Кімнати', group: 'core' } })
  // наскрізні ангари орні на павільйонах: портали-пентащити 6 × 3 в обох довгих стінах — залітаєш з одного боку,
  // вилітаєш з другого; скатний дах
  B.block({ tiles: L.rect(-5, 5, 11, 21), z: 7, h: 4, roof: 'hip', zone: { name: 'Ангар розвідників', group: 'air' } })
  B.block({ tiles: L.rect(-5, 5, 39, 49), z: 7, h: 4, roof: 'hip', zone: { name: 'Ангар штурмовика', group: 'air' } })
  // зал гільдії: 10 × 10, 5 заввишки, скатний дах зі скляною (пентащит) стелею 4 × 4 посередині
  const sky = (t) => { const c = cen(t.p); return Math.abs(c.x) < 2 && Math.abs(c.y - 30) < 2 }
  B.block({ tiles: L.rect(-5, 5, 25, 35), z: 4, h: 5, roof: 'hip', sky, wall: win([1, 3]), zone: { name: 'Зал гільдії', group: 'core' } })

  // поручні тераси не перекривають зовнішніх сходів: край уздовж сходового маршу
  const onStairs = (e) => (Math.abs(e.m.x - 4.5) < 0.6 && e.m.y > 8 && e.m.y < 11) || (Math.abs(e.m.x + 4.5) < 0.6 && e.m.y > 49 && e.m.y < 52)
  B.after((B) => {
    // в'їзд і виїзд: пентащит 4 × 4 у торцях вулиці
    B.shield({ x: -2, y: 0 }, { x: 2, y: 0 }, 0, 4)
    B.shield({ x: 2, y: Y }, { x: -2, y: Y }, 0, 4)
    // бокси відкриті до вулиці на всю висоту
    B.open({ x: -2, y: 8 }, { x: -2, y: 20 }, 0, 4)
    B.open({ x: 2, y: 8 }, { x: 2, y: 20 }, 0, 4)
    // двері з вулиці в кімнати (високі)
    for (const [x, y] of [[-2, 6], [-2, 28], [-2, 37], [-2, 50], [-2, 53], [2, 1], [2, 28], [2, 34], [2, 50], [2, 53]]) B.door({ x, y }, { x, y: y + 1 }, 0)
    // сусідні кімнати — через двері
    for (const [x, y] of [[-4, 30], [-4, 40], [3, 30], [3, 40]]) B.door({ x, y }, { x: x + 1, y }, 0)

    // сходи на +4 — у вежах брам (південь — захід, північ — схід), проріз у підлозі кордегардії з поручнями
    B.railAround(B.stairs(-3.5, 1.5, 90, 0, 4), 4, (e) => Math.abs(e.m.y - 5) < 1e-6)
    B.railAround(B.stairs(3.5, 58.5, -90, 0, 4), 4, (e) => Math.abs(e.m.y - 55) < 1e-6)
    // і ще одні — з хімії в зал гільдії
    B.railAround(B.stairs(4.5, 33.5, -90, 0, 4), 4, (e) => Math.abs(e.m.y - 30) < 1e-6)
    // з кордегардій у вежі +8
    B.railAround(B.stairs(2.5, 2.5, 90, 4, 4), 8, (e) => Math.abs(e.m.y - 6) < 1e-6)
    B.railAround(B.stairs(-2.5, 57.5, -90, 4, 4), 8, (e) => Math.abs(e.m.y - 54) < 1e-6)
    // з терас в ангари на павільйонах — зовнішні сходи вздовж краю
    B.stairs(4.5, 8.5, 90, 4, 3)
    B.stairs(-4.5, 51.5, -90, 4, 3)

    // портали ангарів
    for (const [y0, y1] of [[13, 19], [41, 47]]) { B.shield({ x: -5, y: y1 }, { x: -5, y: y0 }, 7, 10); B.shield({ x: 5, y: y0 }, { x: 5, y: y1 }, 7, 10) }
    // з терас у ангари — зовнішні сходи до дверей
    B.door({ x: 5, y: 11 }, { x: 4, y: 11 }, 7)
    B.door({ x: -5, y: 49 }, { x: -4, y: 49 }, 7)
    // двері павільйонів на тераси
    B.door({ x: 1, y: 8 }, { x: 0, y: 8 }, 4)
    B.door({ x: 0, y: 52 }, { x: 1, y: 52 }, 4)
    for (const y of [11, 21, 25, 35]) B.door({ x: 0, y }, { x: 1, y }, 4)
    // кімнати: чотири окремі, кожна — зі своїми дверима на терасу
    B.fill({ x: 0, y: 39 }, { x: 0, y: 49 }, 4, 7)
    B.fill({ x: -5, y: 44 }, { x: 5, y: 44 }, 4, 7)
    for (const x of [-3, 2]) { B.door({ x, y: 39 }, { x: x + 1, y: 39 }, 4); B.door({ x, y: 49 }, { x: x + 1, y: 49 }, 4) }

    // поручні: тераси, дахи павільйонів (крім виходу сходів), дахи кордегардій навколо веж
    const terrace = [...L.rect(-5, 5, 8, 11), ...L.rect(-5, 5, 21, 25), ...L.rect(-5, 5, 35, 39), ...L.rect(-5, 5, 49, 52)]
    B.railAround(terrace, 4, onStairs)
    B.railAround(L.without(L.rect(-4, 4, 1, 8), L.rect(-3, 3, 2, 7)), 8)
    B.railAround(L.without(L.rect(-4, 4, 52, 59), L.rect(-3, 3, 53, 58)), 8)
  })

  // ---------- станції ----------
  // брами
  B.item('Totem_Placeable', -2.6, 6.4, 0)
  for (const y of [2.6, 3.6, 4.6]) B.item('StorageContainer_Placeable', 3.5, y, 0)
  B.item('Generator_Placeable', -3.4, 58.2, 0)
  for (const y of [53.0, 54.0]) B.item('StorageContainer_Placeable', -3.5, y, 0)
  // бокси
  B.item('Sandcrawler', -3.5, 14.2, 0, 90)
  B.item('RepairStation_Placeable', -3.5, 9.0, 0)
  B.item('RepairStation_Placeable', -3.5, 19.2, 0)
  B.item('Buggy', 3.5, 9.9, 0, 90)
  B.item('Buggy', 3.5, 13.3, 0, 90)
  B.item('RepairStation_Placeable', 3.5, 15.9, 0)
  B.item('Sandbike', 3.5, 17.6, 0)
  B.item('Sandbike', 3.5, 18.9, 0)
  // майстерня техніки
  B.item('VehiclesFabricator_Placeable', -3.5, 21.6, 0, 90)
  for (const y of [24.2, 26.0, 27.8]) B.item('Fabricator_Placeable', -4.1, y, 0)
  B.item('Recycler_Placeable', -2.9, 24.6, 0, 90)
  // склад каравану
  for (let k = 0; k < 5; k++) for (const x of [2.8, 4.2]) B.item('MediumStorageContainer_Placeable', x, 20.8 + k * 1.4, 0)
  for (const y of [28.3, 29.3]) B.item('StorageContainer_Placeable', 4.3, y, 0)
  // переробка руди
  B.item('LargeOreRefinery_Placeable', -3.5, 31.6, 0, 90)
  B.item('LargeOreRefinery_Placeable', -3.5, 34.8, 0, 90)
  B.item('MediumOreRefinery_Placeable', -4.1, 37.4, 0)
  B.item('MediumOreRefinery_Placeable', -4.1, 39.1, 0)
  // хімія й енергія (уздовж східної стіни — сходи в зал)
  B.item('MediumChemicalRefinery_Placeable', 2.9, 31.0, 0)
  B.item('MediumChemicalRefinery_Placeable', 2.9, 32.7, 0)
  B.item('SpiceGenerator_Placeable', 3.5, 36.2, 0)
  B.item('SpiceGenerator_Placeable', 3.5, 38.6, 0)
  // водосховище
  B.item('LargeWaterCistern_Placeable', -3.5, 41.6, 0)
  B.item('LargeWaterCistern_Placeable', -3.5, 44.4, 0)
  B.item('Deathstill_Placeable', -4.1, 46.8, 0)
  B.item('BloodWaterExtractionAdvanced_Placeable', -4.1, 48.6, 0)
  // склад спайсу
  B.item('MediumSpiceRefinery_Placeable', 3.5, 41.4, 0)
  for (let k = 0; k < 4; k++) for (const x of [2.8, 4.2]) B.item('MediumStorageContainer_Placeable', x, 43.4 + k * 1.4, 0)
  // кордегардії й вежі
  for (const x of [-3.2, -1.8]) B.item('GenericContainer_Placeable', x, 7.4, 4)
  B.item('MediumWaterCistern_Placeable', -2.8, 55.2, 4)
  // казарма: скрині вздовж стін
  for (let k = 0; k < 5; k++) { B.item('GenericContainer_Placeable', -4.5, 12.2 + k * 1.9, 4, 90); B.item('GenericContainer_Placeable', 4.5, 12.2 + k * 1.9, 4, 90) }
  B.item('BloodWaterExtractor_Placeable', -2.2, 20.3, 4)
  // зал гільдії
  B.item('Totem_Placeable', 0, 33.8, 4)
  B.item('AdvancedWearablesFabricator_Placeable', -4.0, 26.2, 4)
  B.item('Advanced_SurvivalFabricator_Placeable', -4.0, 28.4, 4)
  B.item('AdvancedWeaponsFabricator_Placeable', -4.0, 30.6, 4)
  B.item('ModdingStation_Placeable', -4.1, 33.4, 4, 90)
  B.item('MediumStorageContainer_Placeable', 3.0, 26.0, 4)
  B.item('MediumStorageContainer_Placeable', 4.3, 26.0, 4)
  // кімнати: скриня й контейнер у кожній
  for (const [x, y] of [[-4.3, 40.0], [4.3, 40.0], [-4.3, 48.0], [4.3, 48.0]]) { B.item('GenericContainer_Placeable', x, y, 4, 90); B.item('StorageContainer_Placeable', x, y + (y < 44 ? 1.2 : -1.2), 4) }
  // орні в наскрізних ангарах: носом до порталу, поруч
  B.item('OrnithopterLight', 0, 14.6, 7, 0)
  B.item('OrnithopterLight', 0, 17.4, 7, 0)
  B.item('OrnithopterMedium', 0, 44, 7, 0)
  B.item('RepairStation_Placeable', -3.8, 20.2, 7)
  B.item('RepairStation_Placeable', 3.8, 39.8, 7)
  // тераси: вітряки вздовж країв, вітропастки
  for (const y of [21.6, 22.6, 23.6, 24.5]) for (const x of [-4.4, 4.4]) B.item('WindTurbineDirectional_Placeable', x, y, 4)
  for (const x of [-4.1, -2.4, 2.4, 4.1]) B.item('LargeWindtrap_Placeable', x, 37, 4)
  for (const x of [-3.6, -1.9]) B.item('LargeWindtrap_Placeable', x, 9.5, 4)
  for (const x of [1.9, 3.6]) B.item('LargeWindtrap_Placeable', x, 50.5, 4)

  const pieces = B.finish()
  return {
    claims, pieces, items: B.items, zones: B.zones,
    ui: {
      name: 'Караван-сарай',
      lead: 'Шість ділянок у лінію вздовж хребта. Крита вулиця 4 × 4 проходить крізь усю базу: заїжджаєш з півдня крізь пентащит, розвантажуєшся в боксі чи на складі й виїжджаєш на півночі — без жодного розвороту. Над вулицею — вежі брам, павільйони з наскрізними ангарами орні (пентащит з обох боків: залітаєш з одного, вилітаєш з другого) і зал гільдії зі скляною стелею. Уся техніка — під дахом.',
      facts: ['<b>10 × 60</b> плит', 'вулиця <b>4 × 4</b> наскрізь', '<b>2</b> наскрізні ангари орні', 'вежі брам до <b>+15</b>'],
    },
    levelNames: {
      0: ['Рівень 0', 'крита вулиця, бокси, майстерня, склади, переробка, вода'],
      4: ['Рівень +4', 'кордегардії, казарма, зал гільдії, кімнати, тераси'],
      7: ['Рівень +7', 'наскрізні ангари орні на павільйонах'],
      8: ['Рівень +8', 'вежі брам'],
      roof: 'скатні дахи веж, ангарів і зали, скляна стеля',
    },
  }
}

const cen = (ps) => ({ x: ps.reduce((s, q) => s + q.x, 0) / ps.length, y: ps.reduce((s, q) => s + q.y, 0) / ps.length })

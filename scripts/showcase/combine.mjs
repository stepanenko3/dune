/*
 * «Спайсовий комбінат» — 6 ділянок сходинкою з південного заходу на північний схід, три корпуси каскадом: приймальня
 * (+5) → цех спайсу (+8, пилкоподібний дах із вікнами) → склад меланжу з ангаром орні на даху (+13). Шлях спайсу йде
 * тим самим каскадом: краулер заїжджає в приймальню крізь пентащит, пісок іде в цех на великі переробники, меланж —
 * на склад і в ангар. Дахами корпусів веде доріжка: з приймальні сходами на дах цеху, вздовж нього — до дверей
 * наскрізного ангара орні на вершині (портали на захід і схід).
 */
import * as L from './lib.mjs'

export function combine() {
  const B = L.createBase('c')
  const claims = [[-20, 0], [-10, 0], [-10, 10], [0, 10], [0, 20], [10, 20]].map(([x, y]) => ({ x, y, w: 10, d: 10 }))
  const at = (e, x0, x1, y0, y1) => e.m.x > x0 - 1e-6 && e.m.x < x1 + 1e-6 && e.m.y > y0 - 1e-6 && e.m.y < y1 + 1e-6
  const win = (rows, step = 2) => (e, i) => (rows.includes(i) && Math.round((Math.abs(e.out.x) > 0.5 ? e.m.y : e.m.x) - 0.5) % step === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null)

  // ---------- приймальня: краулер і багі, розвантаження ----------
  const crawlerPortal = (e) => at(e, -20, -20, 2, 8)
  B.block({ tiles: L.rect(-20, 0, 0, 10), z: 0, h: 5, lean: true, leanSkip: crawlerPortal, wall: win([3], 2), zone: { name: 'Приймальня', group: 'drive' } })
  // ---------- цех спайсу: 20 × 10, 8 заввишки, вікна-стрічки вгорі ----------
  const band = (e, i) => (i === 5 || i === 6 ? 'MTX_Neut_DesertMechanic_Window_01' : null)
  B.block({ tiles: L.rect(-10, 10, 10, 20), z: 0, h: 8, roof: 'none', wall: band, zone: { name: 'Цех спайсу', group: 'refine' } })
  // ---------- склад меланжу: два поверхи з похилими стінами, на даху — наскрізний ангар орні ----------
  B.block({ tiles: L.rect(0, 20, 20, 30), z: 0, h: 4, lean: true, zone: { name: 'Склад меланжу', group: 'store' } })
  const upper = L.without(L.rect(1, 19, 20, 29), L.rect(10, 19, 20, 21))
  B.block({ tiles: upper, z: 4, h: 4, wall: win([1], 2), zone: { name: 'Енергоблок і контора', group: 'craft' } })
  B.block({ tiles: L.rect(1, 19, 21, 29), z: 8, h: 5, roof: 'hip', wall: (e, i) => (i === 2 && Math.abs(e.out.y) > 0.5 && Math.round(e.m.x - 0.5) % 2 === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null), zone: { name: 'Ангар орні', group: 'air' } })

  B.after((B) => {
    // ---------- пилкоподібний дах цеху: ряди скатів (підйом на північ) і вікна у вертикальних уступах ----------
    const roofX0 = -7, roofX1 = 10
    for (let k = 0; k < 9; k++) {
      for (const t of L.rect(roofX0, roofX1, 10 + k, 11 + k)) B.tileShape(t, 8, 'Sardaukar_Roof_01', 0)
      B.fill({ x: roofX0, y: 11 + k }, { x: roofX1, y: 11 + k }, 8, 9, 'MTX_Neut_DesertMechanic_Window_01')
      // боки зубців — скісні стіни (висока сторона — на півночі)
      for (const x of [roofX0, roofX1]) B.edge({ m: { x, y: 10.5 + k }, rot: 90 }, 8, 'Sardaukar_Wall_Triangle_Bottom_Right', true)
    }
    // доріжка дахом цеху: західна смуга й північна смуга, пласко на +8
    const walk = [...L.rect(-10, roofX0, 10, 20), ...L.rect(roofX0, 10, 19, 20)]
    for (const t of walk) B.slab(t, 8, 'roof')
    B.railAround([...walk, ...L.rect(1, 10, 20, 21)], 8, (e) => at(e, -8.5, -8.5, 10, 10))
    // з даху приймальні на доріжку: 3 сходинки на північ
    B.stairs(-8.5, 7.5, 90, 5, 3)
    // у приймальні — сходи на її дах (проріз з поручнями)
    B.railAround(B.stairs(-4.5, 4.5, 90, 0, 5, { hole: 3 }), 5, (e) => Math.abs(e.m.y - 9) < 1e-6)
    B.railAround([...L.rect(-19, -1, 1, 9), ...L.rect(-10, -1, 9, 10)], 5)

    // ---------- проходи по ланцюгу спайсу ----------
    B.shield({ x: -20, y: 8 }, { x: -20, y: 2 }, 0, 4)
    // приймальня → цех і цех → склад: широкі прорізи 3 × 4 (техніка проїжджає)
    B.open({ x: -6, y: 10 }, { x: -3, y: 10 }, 0, 4)
    B.open({ x: 4, y: 20 }, { x: 7, y: 20 }, 0, 4)

    // ---------- склад: сходи на другий поверх, звідти — у ангар; двері з доріжки в ангар ----------
    B.railAround(B.stairs(17.5, 22.5, 90, 0, 4), 4, (e) => Math.abs(e.m.y - 26) < 1e-6)
    // у ангар — у північному ряду, поза смугами польоту
    B.railAround(B.stairs(14.5, 28.5, 0, 4, 4), 8, (e) => Math.abs(e.m.x - 18) < 1e-6)
    B.door({ x: 6, y: 21 }, { x: 7, y: 21 }, 8)
    // ангар: портали 6 × 4 на захід і схід — залітаєш з одного боку, вилітаєш з другого
    B.shield({ x: 1, y: 28 }, { x: 1, y: 22 }, 8, 12)
    B.shield({ x: 19, y: 22 }, { x: 19, y: 28 }, 8, 12)
  })

  // ---------- станції ----------
  // приймальня: краулер носом до порталу, багі, ремонт, розвантаження
  B.item('Sandcrawler', -15.4, 5.0, 0, 0)
  B.item('Buggy', -7.4, 2.4, 0, 0)
  B.item('Buggy', -7.4, 5.6, 0, 0)
  B.item('Sandbike', -2.0, 2.2, 0, 90)
  B.item('RepairStation_Placeable', -15.4, 8.2, 0)
  B.item('RepairStation_Placeable', -15.4, 1.9, 0)
  for (let k = 0; k < 4; k++) B.item('MediumStorageContainer_Placeable', -11.6, 1.9 + k * 1.4, 0)
  // цех спайсу: два великі переробники, середні, енергія
  B.item('LargeSpiceRefinery_Placeable', -7.6, 13.2, 0)
  B.item('LargeSpiceRefinery_Placeable', -7.6, 17.2, 0)
  B.item('MediumSpiceRefinery_Placeable', -3.6, 17.4, 0)
  B.item('MediumSpiceRefinery_Placeable', -0.8, 17.4, 0)
  B.item('MediumSpiceRefinery_Placeable', 2.0, 17.4, 0)
  B.item('SpiceRefinery_Placeable', 8.6, 11.4, 0)
  B.item('SpiceRefinery_Placeable', 8.6, 13.4, 0)
  B.item('SpiceGenerator_Placeable', 8.4, 17.6, 0)
  B.item('LargeWaterCistern_Placeable', 1.4, 12.0, 0)
  // склад меланжу
  for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) B.item('MediumStorageContainer_Placeable', 2.4 + k * 1.5, 23.2 + r * 1.8, 0)
  B.item('SpiceGenerator_Placeable', 13.2, 27.4, 0)
  B.item('SpiceGenerator_Placeable', 15.6, 27.4, 0)
  B.item('Generator_Placeable', 12.4, 22.4, 0)
  B.item('Totem_Placeable', 11.2, 25.6, 0)
  // контора +4
  B.item('Advanced_SurvivalFabricator_Placeable', 7.0, 27.6, 4)
  B.item('AdvancedWeaponsFabricator_Placeable', 9.2, 27.6, 4)
  B.item('Fabricator_Placeable', 11.4, 27.6, 4)
  B.item('MediumWaterCistern_Placeable', 14.4, 22.4, 4)
  for (const x of [5.0, 6.4, 7.8]) B.item('GenericContainer_Placeable', x, 21.5, 4)
  B.item('ModdingStation_Placeable', 12.6, 24.2, 4)
  // ангар орні: дві смуги вздовж осі «захід — схід»
  B.item('OrnithopterMedium', 6.0, 23.6, 8, 0)
  B.item('OrnithopterLight', 13.4, 23.6, 8, 0)
  B.item('OrnithopterLight', 6.0, 26.6, 8, 0)
  // дахи: вітропастки на приймальні, вітряки на гребені ангара
  for (const x of [-18, -16, -14, -12]) for (const y of [2.4, 7.4]) B.item('LargeWindtrap_Placeable', x, y, 5)
  for (let k = 0; k < 8; k++) for (const y of [23.4, 26.6]) B.item('WindTurbineDirectional_Placeable', 3.6 + k * 1.8, y, 14)

  const pieces = B.finish()
  return {
    claims, pieces, items: B.items, zones: B.zones,
    ui: {
      name: 'Спайсовий комбінат',
      lead: 'Шість ділянок сходинкою — і три корпуси каскадом, як іде спайс: краулер заїжджає в приймальню крізь пентащит, пісок проїжджає в цех спайсу з двома великими переробниками під пилкоподібним дахом із вікнами, меланж — на склад, а звідти в наскрізний ангар орні на вершині. Дахами веде доріжка від приймальні до дверей ангара.',
      facts: ['<b>3</b> корпуси каскадом', 'цех <b>20 × 10</b>, 8 заввишки', '<b>2</b> великі переробники спайсу', 'наскрізний ангар орні на <b>+8</b>'],
    },
    levelNames: {
      0: ['Рівень 0', 'приймальня, цех спайсу, склад меланжу'],
      4: ['Рівень +4', 'енергоблок і контора над складом'],
      5: ['Рівень +5', 'дах приймальні: вітропастки'],
      8: ['Рівень +8', 'доріжка дахом цеху, наскрізний ангар орні'],
      roof: 'пилкоподібний дах цеху, вітряки на гребені ангара',
    },
  }
}

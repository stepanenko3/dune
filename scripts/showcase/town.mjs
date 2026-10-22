/*
 * «Гільдійське містечко» — 6 ділянок довгою «Т» (вулиця 10 × 30 і площа 30 × 10 на її кінці). Головне — у кожного
 * гравця гільдії свій дім: 12 будиночків 4 × 5 обабіч вулиці, кожен зі своїми дверима, майстернею внизу й кімнатою
 * нагорі; висоти й дахи різні, як у справжньому містечку. На вході — брама-місток над вулицею, в кінці вулиці —
 * ратуша з годинниковою вежею, ліворуч ринок-склад, праворуч гараж і ангар орні з дахом-пентащитом.
 */
import * as L from './lib.mjs'

export function town() {
  const B = L.createBase('t')
  const claims = [[-5, 0], [-5, 10], [-5, 20], [-15, 30], [-5, 30], [5, 30]].map(([x, y]) => ({ x, y, w: 10, d: 10 }))
  const at = (e, x0, x1, y0, y1) => e.m.x > x0 - 1e-6 && e.m.x < x1 + 1e-6 && e.m.y > y0 - 1e-6 && e.m.y < y1 + 1e-6

  // ---------- вулиця ----------
  B.block({ tiles: L.rect(-1, 1, 0, 30), z: 0, h: 0, roof: 'none', zone: { name: 'Вулиця', group: 'deck' } })

  // ---------- будиночки: поверхи й дахи різні ----------
  const plan = {
    west: [[2, 'hip'], [1, 'flat'], [2, 'pyramid'], [3, 'pyramid'], [2, 'hip'], [1, 'flat']],
    east: [[2, 'pyramid'], [2, 'hip'], [1, 'flat'], [2, 'hip'], [3, 'pyramid'], [2, 'flat']],
  }
  const houses = []
  let n = 0
  for (const side of ['west', 'east']) plan[side].forEach(([floors, roof], k) => {
    const s = side === 'west' ? -1 : 1
    const y0 = k * 5
    const x0 = s < 0 ? -5 : 1, x1 = s < 0 ? -1 : 5
    const tiles = L.rect(x0, x1, y0, y0 + 5)
    const name = `Дім ${++n}`
    const street = (e) => Math.abs(e.m.x - s) < 1e-6
    // вікна: на вулицю — у кожному поверсі, ззаду — нагорі
    const wall = (e, i) => (i === 1 && Math.abs(e.out.x) > 0.5 && Math.round(e.m.y - 0.5) % 2 === (street(e) ? 0 : 1) ? 'MTX_Neut_DesertMechanic_Window_01' : null)
    for (let f = 0; f < floors; f++) B.block({ tiles, z: f * 3, h: 3, roof: f === floors - 1 ? roof : 'none', wall, zone: f === 0 ? { name, group: 'core' } : null })
    houses.push({ s, y0, x0, x1, floors, roof, tiles, name })
  })
  // брама-місток над вулицею: кімнатка на +3 між першими домами
  B.block({ tiles: L.rect(-1, 1, 0, 1), z: 3, h: 2, roof: 'flat', zone: { name: 'Брама', group: 'core' } })

  // ---------- площа: ринок, ратуша з годинниковою вежею, гараж і ангар ----------
  B.block({ tiles: L.rect(-15, -5, 30, 40), z: 0, h: 4, lean: true, leanSkip: (e) => at(e, -10, -9, 30, 30), zone: { name: 'Ринок', group: 'store' } })
  B.block({ tiles: L.rect(-5, 5, 30, 40), z: 0, h: 4, roof: 'hip', lean: true, leanSkip: (e) => !(Math.abs(e.m.y - 40) < 1e-6), wall: (e, i) => (i >= 1 && i <= 2 && Math.abs(e.m.y - 40) < 1e-6 ? 'MTX_Neut_DesertMechanic_Window_01' : null), zone: { name: 'Ратуша', group: 'core' } })
  const tower = L.rect(-2, 2, 35, 39)
  B.block({ tiles: tower, z: 4, h: 4, wall: (e, i) => (i === 1 && Math.round(e.m.x + e.m.y) % 2 === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null), zone: { name: 'Годинникова вежа', group: 'tower' } })
  B.block({ tiles: tower, z: 8, h: 4, wall: (e, i) => (i === 1 && Math.round(e.m.x + e.m.y) % 2 === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null) })
  B.block({ tiles: tower, z: 12, h: 3, roof: 'pyramid', wall: (e, i) => (i < 2 ? 'MTX_Neut_DesertMechanic_Window_01' : null), zone: { name: 'Дзвіниця', group: 'crown' } })
  const garageGate = (e) => at(e, 15, 15, 31, 34)
  B.block({ tiles: L.rect(5, 15, 30, 40), z: 0, h: 4, lean: true, leanSkip: garageGate, zone: { name: 'Гараж і ангар', group: 'drive' } })

  B.after((B) => {
    for (const h of houses) {
      const X = (v) => h.s * v // дзеркало для східного боку
      const sx = X(4.5)
      // двері на вулицю
      B.door({ x: h.s, y: h.y0 + 2 }, { x: h.s, y: h.y0 + 3 }, 0)
      // сходи вздовж задньої стіни: на кожен поверх; з другого — у зворотний бік
      for (let f = 0; f < h.floors - 1; f++) {
        const up = f % 2 === 0
        const holes = B.stairs(up ? sx : X(3.5), up ? h.y0 + 0.5 : h.y0 + 4.5, up ? 90 : -90, f * 3, 3)
        B.railAround(holes, (f + 1) * 3, (e) => Math.abs(e.m.y - (up ? h.y0 + 3 : h.y0 + 2)) < 1e-6)
      }
      // плаский дах — тераса з поручнями
      if (h.roof === 'flat') B.railAround(h.tiles, h.floors * 3)
    }
    // брама: двері з перших домів у місток
    B.door({ x: -1, y: 1 }, { x: -1, y: 0 }, 3)
    B.door({ x: 1, y: 0 }, { x: 1, y: 1 }, 3)
    // площа: двері
    B.door({ x: 0, y: 30 }, { x: 1, y: 30 }, 0)
    B.door({ x: -10, y: 30 }, { x: -9, y: 30 }, 0)
    B.door({ x: -5, y: 36 }, { x: -5, y: 35 }, 0)
    B.door({ x: 5, y: 32 }, { x: 5, y: 33 }, 0)
    // ратуша → вежа: сходи 4 сходинки, далі драбина з люками
    B.railAround(B.stairs(-2.5, 36.5, 0, 0, 4), 4, (e) => Math.abs(e.m.x - 1) < 1e-6)
    B.ladder({ x: 2, y: 37 }, { x: 2, y: 38 }, 4, 12)
    for (const z of [8, 12]) B.ladderHatch(L.sq(1.5, 37.5), z)
    // гараж і ангар: перегородка, ворота, дах-пентащит 8 × 3 над ангаром
    B.fill({ x: 5, y: 35 }, { x: 14, y: 35 }, 0, 4)
    B.door({ x: 8, y: 35 }, { x: 9, y: 35 }, 0)
    B.gate({ x: 15, y: 31 }, { x: 15, y: 34 }, 0)
    for (const t of L.rect(6, 14, 36, 39)) B.shieldFloor(t, 4)
    // дахи ринку й гаража — тераси
    B.railAround(L.rect(-14, -5, 31, 39), 4)
    B.railAround(L.rect(5, 14, 31, 39), 4)
  })

  // ---------- станції ----------
  for (const h of houses) {
    const X = (v) => h.s * v
    B.item('Fabricator_Placeable', X(2.6), h.y0 + 4.1, 0)
    B.item('StorageContainer_Placeable', X(1.9), h.y0 + 0.8, 0)
    if (h.floors >= 2) { B.item('GenericContainer_Placeable', X(2.5), h.y0 + 4.4, 3); B.item('MediumStorageContainer_Placeable', X(2.0), h.y0 + 0.9, 3) }
    if (h.floors >= 3) B.item('SurvivalFabricator_Placeable', X(2.5), h.y0 + 3.8, 6)
    if (h.roof === 'flat') B.item('LargeWindtrap_Placeable', X(3.0), h.y0 + 2.5, h.floors * 3)
  }
  // ратуша
  B.item('Totem_Placeable', 0, 33.5, 0)
  B.item('Advanced_SurvivalFabricator_Placeable', -3.4, 31.8, 0)
  B.item('AdvancedWeaponsFabricator_Placeable', 3.4, 31.8, 0)
  B.item('AdvancedWearablesFabricator_Placeable', 3.4, 34.4, 0)
  B.item('ModdingStation_Placeable', -3.6, 34.4, 0)
  B.item('LargeWaterCistern_Placeable', 3.2, 37.6, 0)
  // ринок
  for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) B.item('MediumStorageContainer_Placeable', -13.2 + k * 1.7, 32.6 + r * 2.4, 0)
  B.item('Recycler_Placeable', -13.0, 39.0, 0)
  // гараж і ангар
  B.item('Buggy', 11.5, 32.8, 0)
  B.item('Sandbike', 7.0, 31.8, 0)
  B.item('Sandbike', 7.0, 33.6, 0)
  B.item('OrnithopterLight', 8.0, 37.5, 0)
  B.item('OrnithopterLight', 12.0, 37.5, 0)
  // дахи: вітропастки й вітряки
  for (const x of [-13, -10.6, -8.2]) B.item('LargeWindtrap_Placeable', x, 34.5, 4)
  for (const x of [6.6, 8, 9.4, 10.8, 12.2, 13.6]) B.item('WindTurbineDirectional_Placeable', x, 32, 4)

  const pieces = B.finish()
  return {
    claims, pieces, items: B.items, zones: B.zones,
    ui: {
      name: 'Гільдійське містечко',
      lead: 'Шість ділянок довгою «Т». У кожного гравця гільдії — свій дім: 12 будиночків обабіч вулиці, кожен зі своїми дверима, майстернею внизу й кімнатою нагорі, з різними дахами й висотами. На вході — брама-місток, у кінці вулиці — ратуша з годинниковою вежею, ринок-склад, гараж і ангар орні з дахом-пентащитом.',
      facts: ['<b>12</b> окремих будиночків', 'ратуша з вежею до <b>+17</b>', 'ринок на <b>15</b> контейнерів', 'ангар орні з дахом-щитом'],
    },
    levelNames: {
      0: ['Рівень 0', 'вулиця, майстерні будиночків, ратуша, ринок, гараж і ангар'],
      3: ['Рівень +3', 'кімнати будиночків, брама-місток'],
      4: ['Рівень +4', 'годинникова вежа'],
      6: ['Рівень +6', 'треті поверхи'],
      roof: 'дахи будиночків, дзвіниця, тераси ринку й гаража',
    },
  }
}

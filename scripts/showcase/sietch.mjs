/*
 * «Січ» — 6 ділянок підковою (смуга 40 × 10 і два рамена 10 × 10 на північ; двір між ними — відкритий пісок).
 * Головне — амфітеатр вітропасток: середина підкови сходить до двору терасами (0 → +3 → +5 → +7), на кожній — ряд
 * вітропасток, по осі — сходи до самого верху. Під терасами — «серце води» з цистернами й дистиляторами, келії й
 * святилище. Обабіч — вежі до +9 з похилими стінами назовні; у раменах — наскрізний ангар орні (захід, портали на
 * захід і у двір) і наскрізний гараж (схід). Ззовні — глуха фортеця з похилих стін, усе життя — у двір.
 */
import * as L from './lib.mjs'

export function sietch() {
  const B = L.createBase('s')
  const claims = [[-20, 0], [-10, 0], [0, 0], [10, 0], [-20, 10], [10, 10]].map(([x, y]) => ({ x, y, w: 10, d: 10 }))
  const at = (e, x0, x1, y0, y1) => e.m.x > x0 - 1e-6 && e.m.x < x1 + 1e-6 && e.m.y > y0 - 1e-6 && e.m.y < y1 + 1e-6
  const win = (rows, step = 2) => (e, i) => (rows.includes(i) && Math.round((Math.abs(e.out.x) > 0.5 ? e.m.y : e.m.x) - 0.5) % step === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null)

  // ---------- амфітеатр: тераси сходять до двору ----------
  B.block({ tiles: L.rect(-10, 10, 0, 7), z: 0, h: 3, lean: true, leanSkip: (e) => !(Math.abs(e.m.y) < 1e-6), wall: (e, i) => (i === 1 && Math.abs(e.m.y - 7) < 1e-6 && Math.round(e.m.x - 0.5) % 2 === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null), zone: { name: 'Серце води', group: 'craft' } })
  B.block({ tiles: L.rect(-10, 10, 7, 10), z: 0, h: 0, roof: 'none', zone: { name: 'Нижня тераса', group: 'deck' } })
  B.block({ tiles: L.rect(-10, 10, 1, 5), z: 3, h: 2, wall: win([1], 2), zone: { name: 'Келії', group: 'core' } })
  B.block({ tiles: L.rect(-10, 10, 1, 3), z: 5, h: 2, wall: win([1], 2), zone: { name: 'Святилище', group: 'core' } })

  // ---------- вежі: глухі похилі стіни назовні, три поверхи ----------
  for (const [x0, x1, side] of [[-20, -10, 'західна'], [10, 20, 'східна']]) {
    const outer = (e) => Math.abs(e.m.y) < 1e-6 || Math.abs(Math.abs(e.m.x) - 20) < 1e-6
    B.block({ tiles: L.rect(x0, x1, 0, 10), z: 0, h: 3, lean: true, leanSkip: (e) => !outer(e), zone: { name: `${side === 'західна' ? 'Майстерня' : 'Переробка'} (${side} вежа)`, group: side === 'західна' ? 'craft' : 'refine' } })
    const inner = x0 < 0 ? L.rect(-19, -10, 1, 10) : L.rect(10, 19, 1, 10)
    B.block({ tiles: inner, z: 3, h: 3, wall: win([1], 2), zone: { name: `Покої (${side} вежа)`, group: 'core' } })
    B.block({ tiles: inner, z: 6, h: 3, wall: win([1], 2), zone: { name: `Зброярня (${side} вежа)`, group: 'tower' } })
  }
  // ---------- рамена: наскрізний ангар орні (захід) і наскрізний гараж (схід) ----------
  const portal = (e) => at(e, -20, -20, 12, 18) || at(e, 20, 20, 12, 18)
  B.block({ tiles: L.rect(-20, -10, 10, 20), z: 0, h: 5, lean: true, leanSkip: portal, zone: { name: 'Ангар орні', group: 'air' } })
  B.block({ tiles: L.rect(10, 20, 10, 20), z: 0, h: 5, lean: true, leanSkip: portal, zone: { name: 'Гараж', group: 'drive' } })

  B.after((B) => {
    // портали: зовнішній і у двір — залітаєш/заїжджаєш з одного боку, виїжджаєш з другого
    B.shield({ x: -20, y: 18 }, { x: -20, y: 12 }, 0, 4)
    B.shield({ x: -10, y: 12 }, { x: -10, y: 18 }, 0, 4)
    B.shield({ x: 20, y: 12 }, { x: 20, y: 18 }, 0, 3)
    B.shield({ x: 10, y: 18 }, { x: 10, y: 12 }, 0, 3)
    // сходи амфітеатру по осі, 2 плити завширшки: 0 → +3 → +5 → +7
    for (const x of [-0.5, 0.5]) {
      B.stairs(x, 9.5, -90, 0, 3, { hole: 0 })
      B.stairs(x, 6.5, -90, 3, 2, { hole: 0 })
      B.stairs(x, 4.5, -90, 5, 2, { hole: 0 })
    }
    // поручні терас (край над нижчою — поручень; там, де сходи, — ні)
    const axis = (e) => Math.abs(e.m.x) < 1 && Math.abs(e.out.y) > 0.5
    B.railAround(L.rect(-10, 10, 5, 7), 3, axis)
    B.railAround(L.rect(-10, 10, 3, 5), 5, axis)
    B.railAround(L.rect(-10, 10, 1, 3), 7, axis)
    // двері з терас у приміщення під ними
    for (const x of [-5, 4]) { B.door({ x, y: 7 }, { x: x + 1, y: 7 }, 0); B.door({ x, y: 5 }, { x: x + 1, y: 5 }, 3); B.door({ x, y: 3 }, { x: x + 1, y: 3 }, 5, 'Choam_Level2_Door_Frame') }
    // вежі: двері в серце води, на нижню терасу й тераси +3, в рамена; сходи 0 → +3 → +6 → +9 на дах
    for (const s of [-1, 1]) {
      const X = (v) => s * v
      B.door({ x: X(10), y: 3 }, { x: X(10), y: 4 }, 0)
      B.door({ x: X(10), y: 8 }, { x: X(10), y: 9 }, 0)
      B.door({ x: X(10), y: 6 }, { x: X(10), y: 5 }, 3)
      B.door({ x: X(10), y: 2 }, { x: X(10), y: 3 }, 3, 'Choam_Level2_Door_Frame')
      B.door({ x: X(15), y: 10 }, { x: X(14), y: 10 }, 0)
      B.railAround(B.stairs(X(18.5), 2.5, 90, 0, 3), 3, (e) => Math.abs(e.m.y - 5) < 1e-6)
      B.railAround(B.stairs(X(17.5), 4.5, -90, 3, 3), 6, (e) => Math.abs(e.m.y - 2) < 1e-6)
      B.railAround(B.stairs(X(16.5), 2.5, 90, 6, 3), 9, (e) => Math.abs(e.m.y - 5) < 1e-6)
      B.railAround(s < 0 ? L.rect(-19, -10, 1, 10) : L.rect(10, 19, 1, 10), 9, (e) => Math.abs(e.m.y - 5) < 1e-6 && Math.abs(Math.abs(e.m.x) - 16.5) < 1e-6)
      // дахи рамен — тераси
      B.railAround(s < 0 ? L.rect(-19, -10, 10, 19) : L.rect(10, 19, 10, 19), 5)
    }
  })

  // ---------- станції ----------
  // амфітеатр: ряди вітропасток на кожній терасі (по осі — сходи)
  const rowX = [-8.5, -5.5, -2.5, 2.5, 5.5, 8.5]
  for (const [y, z] of [[8.5, 0], [6.0, 3], [4.0, 5], [2.0, 7]]) for (const x of rowX) B.item('LargeWindtrap_Placeable', x, y, z)
  // серце води
  for (const x of [-8.6, -6.2, -3.8, 3.8, 6.2, 8.6]) B.item('MediumWaterCistern_Placeable', x, 3.2, 0)
  B.item('LargeWaterCistern_Placeable', 0, 3.4, 0)
  for (const x of [-7.6, 7.6]) B.item('Deathstill_Placeable', x, 5.8, 0)
  B.item('BloodWaterExtractionAdvanced_Placeable', -1.8, 5.9, 0)
  B.item('Totem_Placeable', 1.8, 5.9, 0)
  // келії і святилище
  for (const x of [-9.2, -7.4, -2.2, 2.2, 7.4, 9.2]) B.item('GenericContainer_Placeable', x, 1.6, 3)
  B.item('ModdingStation_Placeable', -3, 1.7, 5)
  B.item('MediumStorageContainer_Placeable', 3, 1.8, 5)
  // західна вежа: майстерня, покої, зброярня
  B.item('Advanced_SurvivalFabricator_Placeable', -14.2, 2.2, 0)
  B.item('AdvancedWearablesFabricator_Placeable', -12.0, 2.2, 0)
  B.item('Fabricator_Placeable', -11.4, 5.4, 0)
  B.item('Recycler_Placeable', -14.6, 8.9, 0)
  for (const x of [-13.6, -12.2]) B.item('MediumStorageContainer_Placeable', x, 8.6, 3)
  B.item('AdvancedWeaponsFabricator_Placeable', -12.0, 8.4, 6)
  // східна вежа: переробка й енергія
  B.item('LargeOreRefinery_Placeable', 13.4, 2.2, 0)
  B.item('MediumChemicalRefinery_Placeable', 11.4, 5.4, 0)
  B.item('SpiceGenerator_Placeable', 13.6, 8.6, 0)
  for (const x of [12.2, 13.6]) B.item('MediumStorageContainer_Placeable', x, 8.6, 3)
  B.item('Generator_Placeable', 12.0, 8.4, 6)
  // ангар орні: носом до порталів
  B.item('OrnithopterMedium', -14.5, 13.6, 0, 0)
  B.item('OrnithopterLight', -14.5, 16.4, 0, 0)
  B.item('RepairStation_Placeable', -14.5, 10.9, 0)
  // гараж
  B.item('Sandcrawler', 15.0, 13.5, 0, 0)
  B.item('Buggy', 15.0, 16.6, 0, 0)
  B.item('Sandbike', 18.0, 11.0, 0, 0)
  B.item('RepairStation_Placeable', 12.0, 10.9, 0)
  // дахи веж: вітряки
  for (const x of [-18, -16.6, -15.2, -13.8, -12.4, -11]) B.item('WindTurbineDirectional_Placeable', x, 8.6, 9)
  for (const x of [11, 12.4, 13.8, 15.2, 16.6, 18]) B.item('WindTurbineDirectional_Placeable', x, 8.6, 9)

  const pieces = B.finish()
  return {
    claims, pieces, items: B.items, zones: B.zones,
    ui: {
      name: 'Січ',
      lead: 'Шість ділянок підковою навколо відкритого двору. Середина підкови — амфітеатр вітропасток: тераси сходять до двору (0, +3, +5, +7), на кожній ряд вітропасток, по осі — сходи нагору. Під терасами — серце води з цистернами й дистиляторами. Ззовні — глуха фортеця з похилих стін; у раменах — наскрізний ангар орні й наскрізний гараж.',
      facts: ['підкова <b>40 × 20</b>', '<b>24</b> вітропастки амфітеатром', '<b>8</b> цистерн', 'наскрізні ангар і гараж'],
    },
    levelNames: {
      0: ['Рівень 0', 'серце води, нижня тераса, майстерня, переробка, ангар орні, гараж'],
      3: ['Рівень +3', 'келії, покої веж'],
      5: ['Рівень +5', 'святилище'],
      6: ['Рівень +6', 'зброярні веж'],
      roof: 'тераси амфітеатру, дахи веж і рамен',
    },
  }
}

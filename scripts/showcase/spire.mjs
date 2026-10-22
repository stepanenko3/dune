/*
 * «Шпиль» — 6 ділянок хрестом із ділянкою в куті. Головне — вертикаль: вежа 8 × 8 на сім поверхів до +28, а на ній
 * «небесний ангар» 10 × 10 з порталами на захід і схід — орні залітають на саму вершину й вилітають наскрізь. Угору —
 * прямі марші, що міняють напрям на кожному поверсі (гвинтових сходів у грі нема). Унизу чотири рамена з похилими
 * стінами: брама й гараж, водосховище, переробка, майстерня; у куті — ангар грузового з дахом-пентащитом і порталом
 * на схід (вертикальний зліт або по прямій).
 */
import * as L from './lib.mjs'

export function spire() {
  const B = L.createBase('p')
  const claims = [[-5, 10], [-5, 0], [-5, 20], [-15, 10], [5, 10], [5, 0]].map(([x, y]) => ({ x, y, w: 10, d: 10 }))
  const at = (e, x0, x1, y0, y1) => e.m.x > x0 - 1e-6 && e.m.x < x1 + 1e-6 && e.m.y > y0 - 1e-6 && e.m.y < y1 + 1e-6
  const win = (rows, step = 2) => (e, i) => (rows.includes(i) && Math.round((Math.abs(e.out.x) > 0.5 ? e.m.y : e.m.x) - 0.5) % step === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null)

  // ---------- основа й рамена ----------
  B.block({ tiles: L.rect(-5, 5, 10, 20), z: 0, h: 4, zone: { name: 'Хол вежі', group: 'core' } })
  const southGate = (e) => at(e, -2, 1, 0, 0)
  B.block({ tiles: L.rect(-5, 5, 0, 10), z: 0, h: 4, lean: true, leanSkip: southGate, zone: { name: 'Брама й гараж', group: 'drive' } })
  B.block({ tiles: L.rect(-5, 5, 20, 30), z: 0, h: 4, lean: true, zone: { name: 'Водосховище', group: 'craft' } })
  B.block({ tiles: L.rect(-15, -5, 10, 20), z: 0, h: 4, lean: true, zone: { name: 'Переробка', group: 'refine' } })
  B.block({ tiles: L.rect(5, 15, 10, 20), z: 0, h: 4, lean: true, zone: { name: 'Майстерня', group: 'craft' } })
  const carrierPortal = (e) => at(e, 15, 15, 3, 7)
  B.block({ tiles: L.rect(5, 15, 0, 10), z: 0, h: 6, lean: true, leanSkip: carrierPortal, zone: { name: 'Ангар грузового', group: 'air' } })

  // ---------- вежа: сім поверхів по 4 блоки ----------
  const shaft = L.rect(-4, 4, 11, 19)
  const floors = ['Казарма', 'Склад', 'Майстерня спорядження', 'Покої', 'Бібліотека', 'Штаб']
  floors.forEach((name, k) => B.block({ tiles: shaft, z: 4 + k * 4, h: 4, wall: win([2], 2), zone: { name, group: k % 2 ? 'core' : 'tower' } }))
  // небесний ангар: на блок ширший за вежу, портали 6 × 3 на захід і схід, скатний дах
  B.block({ tiles: L.rect(-5, 5, 10, 20), z: 28, h: 4, roof: 'hip', zone: { name: 'Небесний ангар', group: 'air' } })

  B.after((B) => {
    // ---------- марші: на кожному поверсі — прямий марш, напрям міняється ----------
    for (let k = 0; k < 7; k++) {
      const z = k * 4
      if (k === 6) {
        // останній — уздовж північної стіни, щоб проріз у підлозі ангара був поза смугами польоту
        B.railAround(B.stairs(-3.5, 18.5, 0, z, 4), z + 4, (e) => Math.abs(e.m.x - 1) < 1e-6)
      } else if (k % 2 === 0) {
        B.railAround(B.stairs(-3.5, 11.5, 90, z, 4), z + 4, (e) => Math.abs(e.m.y - 15) < 1e-6)
      } else {
        B.railAround(B.stairs(-2.5, 18.5, -90, z, 4), z + 4, (e) => Math.abs(e.m.y - 15) < 1e-6)
      }
    }
    // небесний ангар: портали наскрізь
    B.shield({ x: -5, y: 18 }, { x: -5, y: 12 }, 28, 31)
    B.shield({ x: 5, y: 12 }, { x: 5, y: 18 }, 28, 31)
    // поручні: тераса довкола вежі на +4, дахи рамен
    B.railAround(L.without(L.rect(-5, 5, 10, 20), shaft), 4)
    for (const r of [L.rect(-4, 4, 1, 10), L.rect(-4, 4, 20, 29), L.rect(-14, -5, 11, 19), L.rect(5, 14, 10, 19)]) B.railAround(r, 4)
    // ---------- входи ----------
    B.gate({ x: -2, y: 0 }, { x: 1, y: 0 }, 0)
    for (const [a, b] of [[{ x: 1, y: 10 }, { x: 2, y: 10 }], [{ x: 2, y: 20 }, { x: 1, y: 20 }], [{ x: -5, y: 16 }, { x: -5, y: 15 }], [{ x: 5, y: 15 }, { x: 5, y: 16 }], [{ x: 5, y: 8 }, { x: 5, y: 9 }]]) B.door(a, b, 0)
    // ангар грузового: портал на схід 4 × 6 і дах-пентащит 10 × 4 над грузовим
    B.shield({ x: 15, y: 3 }, { x: 15, y: 7 }, 0, 6)
    for (const t of L.rect(5, 15, 3, 7)) B.shieldFloor(t, 6)
    // з холу на терасу +4 довкола вежі
    B.door({ x: 4, y: 12 }, { x: 4, y: 13 }, 4)
  })

  // ---------- станції ----------
  // хол
  B.item('Totem_Placeable', 1.5, 13.2, 0)
  B.item('RepairStation_Placeable', 2.5, 18.4, 0)
  // брама й гараж
  B.item('Buggy', -2.6, 5.0, 0, 90)
  B.item('Buggy', 2.4, 5.0, 0, 90)
  B.item('Sandbike', -0.1, 7.6, 0, 90)
  B.item('RepairStation_Placeable', 0, 2.2, 0)
  // водосховище
  for (const x of [-2.6, 2.6]) B.item('LargeWaterCistern_Placeable', x, 23.0, 0)
  for (const x of [-2.6, 2.6]) B.item('LargeWaterCistern_Placeable', x, 26.4, 0)
  B.item('Deathstill_Placeable', 0, 27.8, 0)
  // переробка
  B.item('LargeOreRefinery_Placeable', -11.0, 12.5, 0)
  B.item('LargeOreRefinery_Placeable', -11.0, 17.4, 0)
  B.item('MediumSpiceRefinery_Placeable', -7.4, 12.6, 0)
  B.item('MediumChemicalRefinery_Placeable', -7.4, 17.4, 0)
  B.item('SpiceGenerator_Placeable', -13.0, 15.0, 0)
  // майстерня
  B.item('Advanced_VehiclesFabricator_Placeable', 10.6, 17.2, 0)
  B.item('AdvancedWeaponsFabricator_Placeable', 7.0, 12.6, 0)
  B.item('Advanced_SurvivalFabricator_Placeable', 9.2, 12.6, 0)
  B.item('AdvancedWearablesFabricator_Placeable', 11.4, 12.6, 0)
  B.item('Recycler_Placeable', 13.0, 15.0, 0, 90)
  // поверхи вежі (марші — уздовж західної стіни)
  for (const x of [0.4, 1.8, 3.2]) B.item('GenericContainer_Placeable', x, 11.6, 4)
  for (let k = 0; k < 6; k++) B.item('MediumStorageContainer_Placeable', 0.4 + (k % 3) * 1.4, 12.2 + Math.floor(k / 3) * 1.6, 8)
  B.item('ModdingStation_Placeable', 2.0, 12.2, 12)
  B.item('Fabricator_Placeable', 2.0, 16.4, 12)
  B.item('MediumWaterCistern_Placeable', 2.4, 12.6, 16)
  B.item('GenericContainer_Placeable', 2.4, 17.6, 16)
  B.item('MediumStorageContainer_Placeable', 2.6, 12.4, 20)
  B.item('Totem_Placeable', 1.6, 15.0, 24)
  // небесний ангар
  B.item('OrnithopterMedium', 0, 13.6, 28, 0)
  B.item('OrnithopterLight', 0, 16.4, 28, 0)
  // ангар грузового
  B.item('OrnithopterTransport', 10, 5, 0, 0)
  // дахи рамен
  for (const x of [-12.5, -10, -7.5]) B.item('LargeWindtrap_Placeable', x, 15, 4)
  for (const x of [-2.5, 0, 2.5]) B.item('LargeWindtrap_Placeable', x, 25, 4)
  for (const x of [6.2, 7.6, 9, 10.4, 11.8, 13.2]) for (const y of [12, 17.6]) B.item('WindTurbineDirectional_Placeable', x, y, 4)

  const pieces = B.finish()
  return {
    claims, pieces, items: B.items, zones: B.zones,
    // вежа до +33: камери вище й далі за типові, щоб шпиль був у кадрі цілим (і на мініатюрі)
    views: {
      quarter: { pos: [-44, 34, 34], target: [0, 11, -15] },
      front: { pos: [0, 16, 48], target: [0, 12, -12] },
      back: { pos: [16, 30, -70], target: [0, 12, -16] },
      top: { pos: [0, 80, -14.9], target: [0, 0, -15] },
    },
    ui: {
      name: 'Шпиль',
      lead: 'Шість ділянок хрестом із ділянкою в куті. Вежа 8 × 8 на сім поверхів, а на вершині, на +28, — небесний ангар з порталами на захід і схід: орні сідає на самій вершині й вилітає наскрізь. Угору ведуть прямі марші, що міняють напрям на кожному поверсі. Унизу — рамена з похилими стінами (брама й гараж, водосховище, переробка, майстерня) і ангар грузового з дахом-пентащитом.',
      facts: ['вежа до <b>+33</b>', 'небесний ангар на <b>+28</b>', '<b>7</b> маршів сходів', 'ангар грузового з дахом-щитом'],
    },
    levelNames: {
      0: ['Рівень 0', 'хол вежі, брама й гараж, водосховище, переробка, майстерня, ангар грузового'],
      4: ['Рівень +4', 'казарма, тераса довкола вежі'],
      8: ['Рівень +8', 'склад'],
      12: ['Рівень +12', 'майстерня спорядження'],
      16: ['Рівень +16', 'покої'],
      20: ['Рівень +20', 'бібліотека'],
      24: ['Рівень +24', 'штаб'],
      28: ['Рівень +28', 'небесний ангар'],
      roof: 'скатний дах небесного ангара, вітряки й вітропастки на раменах',
    },
  }
}

/*
 * «Зикурат» — 6 ділянок латинським хрестом (стовбур 10 × 40, рамена 10 × 10 обабіч на третій ділянці). Головне —
 * парадні сходи по осі: від площі три марші по 4 сходинки з майданчиками на +4, +8 і +12 ведуть до тронної зали на
 * вершині, а обабіч сходів масиви будівель ростуть уступами разом з ними. Сам зикурат — три яруси терас (30, 22 і
 * 14 плит завширшки) з похилими стінами; на вершині — зала зі скляними похилими стінами. У лівому рамені — ангар орні
 * (портал-пентащит на захід), у правому — гараж (портал на схід), у «голові» хреста — наскрізний ангар грузового:
 * портали 8 × 6 на захід і схід, залітає й вилітає по прямій.
 */
import * as L from './lib.mjs'

export function ziggurat() {
  const B = L.createBase('z')
  const claims = [[-5, 0], [-5, 10], [-5, 20], [-5, 30], [-15, 20], [5, 20]].map(([x, y]) => ({ x, y, w: 10, d: 10 }))
  const win = (rows, step = 2) => (e, i) => (rows.includes(i) && Math.round((Math.abs(e.out.x) > 0.5 ? e.m.y : e.m.x) - 0.5) % step === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null)
  const at = (e, x0, x1, y0, y1) => e.m.x > x0 - 1e-6 && e.m.x < x1 + 1e-6 && e.m.y > y0 - 1e-6 && e.m.y < y1 + 1e-6

  // ---------- площа й масиви обабіч парадних сходів ----------
  B.block({ tiles: L.rect(-5, 5, 0, 6), z: 0, h: 0, roof: 'none', zone: { name: 'Площа', group: 'deck' } })
  // масиви: похилі стіни з боків, фасад — прямий (сходи впираються в нього)
  B.block({ tiles: L.rect(-5, 5, 6, 12), z: 0, h: 4, lean: true, leanSkip: (e) => Math.abs(e.m.y - 6) < 1e-6, wall: win([1], 3), zone: { name: 'Вестибюль', group: 'core' } })
  B.block({ tiles: L.rect(-5, 5, 12, 18), z: 0, h: 4, lean: true, zone: { name: 'Цистерни', group: 'craft' } })
  B.block({ tiles: L.rect(-4, 4, 12, 18), z: 4, h: 4, wall: win([1]), zone: { name: 'Казарма', group: 'core' } })
  B.block({ tiles: L.rect(-5, 5, 18, 20), z: 0, h: 4, lean: true, zone: { name: 'Перехід до залу', group: 'core' } })
  // сходова клітка масиву заходить на уступи зикурата (на +4 — до y 21, на +8 — до y 22)
  B.block({ tiles: L.rect(-4, 4, 18, 21), z: 4, h: 4, zone: { name: 'Сходова (+4)', group: 'core' } })
  B.block({ tiles: L.rect(-4, 4, 18, 22), z: 8, h: 4, zone: { name: 'Сходова (+8)', group: 'core' } })

  // ---------- зикурат: три яруси і зала на вершині ----------
  const hangarPortal = (e) => at(e, -15, -15, 22, 28) || at(e, 15, 15, 22, 28)
  B.block({ tiles: L.rect(-15, 15, 20, 30), z: 0, h: 4, lean: true, leanSkip: hangarPortal, zone: { name: 'Нижній ярус', group: 'core' } })
  // кожен ярус стоїть на плитках усередині похилих стін нижнього
  B.block({ tiles: L.rect(-11, 11, 21, 29), z: 4, h: 4, lean: true, wall: win([3], 2), zone: { name: 'Середній ярус', group: 'craft' } })
  B.block({ tiles: L.rect(-7, 7, 22, 28), z: 8, h: 4, lean: true, wall: win([3], 2), zone: { name: 'Верхній ярус', group: 'core' } })
  // тронна зала: похилі стіни з вікнами на довгих боках, торці прямі — у них двері з тераси; скатний дах
  const throneDoor = (e) => Math.abs(Math.abs(e.m.x) - 4) < 1e-6
  B.block({ tiles: L.rect(-4, 4, 23, 27), z: 12, h: 4, lean: true, leanShape: 'Sardaukar_Window_Inclined_Tall_L', leanSkip: throneDoor, roof: 'hip', zone: { name: 'Тронна зала', group: 'crown' } })
  // наскрізний ангар грузового в «голові» хреста: 10 × 10, 6 заввишки
  B.block({ tiles: L.rect(-5, 5, 30, 40), z: 0, h: 6, zone: { name: 'Ангар грузового', group: 'air' } })

  B.after((B) => {
    // ---------- парадні сходи: три марші по 4 сходинки, 4 плити завширшки ----------
    for (const [y0, z0] of [[2.5, 0], [8.5, 4], [14.5, 8]]) for (const x of [-1.5, -0.5, 0.5, 1.5]) B.stairs(x, y0, 90, z0, 4, { hole: 0 })
    // поручні: краї масивів над похилими стінами й над сусідніми ярусами
    B.railAround(L.rect(-4, 4, 6, 12), 4, (e) => Math.abs(e.m.y - 12) < 1e-6 || (Math.abs(e.m.y - 6) < 1e-6 && Math.abs(e.m.x) < 2))
    B.railAround(L.rect(-4, 4, 12, 18), 8, (e) => Math.abs(e.m.y - 18) < 1e-6 || (Math.abs(e.m.y - 12) < 1e-6 && Math.abs(e.m.x) < 2))
    // тераси ярусів (вершина — разом з дахом сходової)
    B.railAround([...L.rect(-14, 14, 21, 29), ...L.rect(-5, 5, 20, 21), ...L.rect(-5, 5, 29, 30)], 4)
    B.railAround([...L.rect(-10, 10, 22, 28), ...L.rect(-4, 4, 21, 22)], 8)
    B.railAround(L.uniq([...L.rect(-6, 6, 23, 27), ...L.rect(-4, 4, 18, 23)]), 12, (e) => Math.abs(e.m.y - 18) < 1e-6 && Math.abs(e.m.x) < 2)

    // ---------- входи ----------
    // з площі у вестибюль: двері обабіч сходів
    for (const x of [-4, 3]) B.door({ x, y: 6 }, { x: x + 1, y: 6 }, 0)
    // анфілада по осі масиву: вестибюль → цистерни → перехід → нижній ярус
    for (const y of [12, 18, 20]) B.door({ x: 0, y }, { x: 1, y }, 0)
    // з майданчика +4 в казарму, з +8 — у сходову; казарма → сходова → ярус
    B.door({ x: -3, y: 12 }, { x: -2, y: 12 }, 4)
    B.door({ x: 2, y: 18 }, { x: 3, y: 18 }, 4)
    B.door({ x: 2, y: 21 }, { x: 3, y: 21 }, 4)
    B.door({ x: 2, y: 18 }, { x: 3, y: 18 }, 8)
    B.door({ x: 2, y: 22 }, { x: 3, y: 22 }, 8)
    // тронна зала: двері в торцях
    B.door({ x: -4, y: 25 }, { x: -4, y: 24 }, 12)
    B.door({ x: 4, y: 25 }, { x: 4, y: 26 }, 12)

    // ---------- нижній ярус: ангар орні (захід), великий зал, гараж (схід) ----------
    for (const x of [-5, 5]) B.fill({ x, y: 21 }, { x, y: 29 }, 0, 4)
    B.door({ x: -5, y: 26 }, { x: -5, y: 25 }, 0)
    B.door({ x: 5, y: 21 }, { x: 5, y: 22 }, 0)
    B.shield({ x: -15, y: 28 }, { x: -15, y: 22 }, 0, 3)
    B.shield({ x: 15, y: 22 }, { x: 15, y: 28 }, 0, 3)
    // ангар грузового: портали 8 × 6 у бічних стінах, двері з нижнього ярусу; драбина на дах-вітряну ферму
    B.shield({ x: -5, y: 39 }, { x: -5, y: 31 }, 0, 6)
    B.shield({ x: 5, y: 31 }, { x: 5, y: 39 }, 0, 6)
    B.door({ x: -3, y: 30 }, { x: -2, y: 30 }, 0)
    B.ladder({ x: 4, y: 40 }, { x: 3, y: 40 }, 0, 6, L.sq(3.5, 39.5))
    B.railAround(L.rect(-5, 5, 30, 40), 6)

    // ---------- сходи всередині зикурата ----------
    // великий зал → середній ярус
    B.railAround(B.stairs(3.5, 21.5, 90, 0, 4), 4, (e) => Math.abs(e.m.y - 25) < 1e-6)
    // середній → верхній
    B.railAround(B.stairs(-3.5, 27.5, -90, 4, 4), 8, (e) => Math.abs(e.m.y - 24) < 1e-6)
    // верхній → тронна зала
    B.railAround(B.stairs(-2.5, 25.5, 0, 8, 4), 12, (e) => Math.abs(e.m.x - 1) < 1e-6)
    // сходова в масиві: +4 → +8 (з казарми нагору)
    B.railAround(B.stairs(-2.5, 18.5, 0, 4, 4, { hole: 3 }), 8, (e) => Math.abs(e.m.x - 1) < 1e-6)
    // середній ярус: перегородки між цехами
    for (const x of [-5, 5]) B.fill({ x, y: 22 }, { x, y: 28 }, 4, 8)
    B.door({ x: -5, y: 23 }, { x: -5, y: 22 }, 4)
    B.door({ x: 5, y: 22 }, { x: 5, y: 23 }, 4)
  })

  // ---------- станції ----------
  // вестибюль: вода й консоль
  B.item('Totem_Placeable', 0, 9, 0)
  B.item('LargeWaterCistern_Placeable', -2.6, 10.3, 0)
  B.item('LargeWaterCistern_Placeable', 2.6, 10.3, 0)
  // цистерни
  for (const x of [-2.6, 0, 2.6]) B.item('LargeWaterCistern_Placeable', x, 14.4, 0)
  B.item('Deathstill_Placeable', -2.8, 16.8, 0)
  B.item('Deathstill_Placeable', 2.8, 16.8, 0)
  // казарма +4
  for (let k = 0; k < 4; k++) { B.item('GenericContainer_Placeable', -3.4, 13 + k * 1.3, 4, 90); B.item('GenericContainer_Placeable', 3.4, 13 + k * 1.3, 4, 90) }
  B.item('BloodWaterExtractionAdvanced_Placeable', 0, 17.2, 4)
  // ангар орні (захід, портал на x −15): носом до порталу
  B.item('OrnithopterMedium', -10.5, 23.7, 0, 0)
  B.item('OrnithopterLight', -10.5, 26.5, 0, 0)
  B.item('RepairStation_Placeable', -6.4, 22.0, 0, 90)
  // великий зал
  B.item('Advanced_SurvivalFabricator_Placeable', -3.6, 22.2, 0)
  B.item('AdvancedWeaponsFabricator_Placeable', -3.6, 24.4, 0)
  B.item('AdvancedWearablesFabricator_Placeable', -3.6, 26.6, 0)
  B.item('ModdingStation_Placeable', 0, 28.2, 0)
  B.item('Recycler_Placeable', 1.8, 28.4, 0)
  // гараж (схід, портал на x 15)
  B.item('Sandcrawler', 10.5, 23.3, 0, 0)
  B.item('Buggy', 9.5, 26.6, 0, 0)
  B.item('Sandbike', 12.8, 26.2, 0, 90)
  B.item('Sandbike', 13.9, 26.2, 0, 90)
  B.item('Advanced_VehiclesFabricator_Placeable', 7.4, 27.3, 0, 90)
  // середній ярус: переробка (захід), галерея, майстерня (схід)
  B.item('LargeOreRefinery_Placeable', -8.6, 23.6, 4, 90)
  B.item('LargeOreRefinery_Placeable', -8.6, 26.6, 4, 90)
  B.item('SpiceRefinery_Placeable', -6.0, 23.2, 4)
  B.item('MediumChemicalRefinery_Placeable', -6.0, 26.6, 4)
  B.item('Fabricator_Placeable', 6.6, 24.6, 4)
  B.item('RepairStation_Placeable', 7.8, 27.6, 4)
  for (let k = 0; k < 3; k++) B.item('MediumStorageContainer_Placeable', 9.6, 22.8 + k * 1.4, 4)
  B.item('SpiceGenerator_Placeable', 1.0, 26.8, 4)
  // верхній ярус: покої гільдії
  for (const x of [-5.4, 5.4]) { B.item('GenericContainer_Placeable', x, 24.0, 8, 90); B.item('MediumStorageContainer_Placeable', x, 25.8, 8) }
  B.item('MediumWaterCistern_Placeable', -1, 23.4, 8)
  // тронна зала
  B.item('Totem_Placeable', 2.6, 24.6, 12)
  // ангар грузового: по осі, носом до порталу
  B.item('OrnithopterTransport', 0, 35, 0, 0)
  // тераси й дах ангара: вітряки й вітропастки
  for (const x of [-12.5, 12.5]) for (const y of [22.4, 25, 27.6]) B.item('LargeWindtrap_Placeable', x, y, 4)
  for (const x of [-9.2, -8.0, 8.0, 9.2]) for (const y of [22.6, 25, 27.4]) B.item('WindTurbineDirectional_Placeable', x, y, 8)
  for (const x of [-4.2, -3.1, -2, -0.9, 0.9, 2, 3.1]) for (const y of [31.2, 33, 37, 38.8]) B.item('WindTurbineOmnidirectional_Placeable', x, y, 6)

  const pieces = B.finish()
  return {
    claims, pieces, items: B.items, zones: B.zones,
    ui: {
      name: 'Зикурат',
      lead: 'Шість ділянок латинським хрестом. Парадні сходи по осі — три марші з майданчиками на +4, +8 і +12 — ведуть від площі до тронної зали зі скляними похилими стінами на вершині. Зикурат — три яруси терас з похилими стінами; у лівому рамені ангар орні, у правому гараж, у «голові» хреста — наскрізний ангар грузового: портали 8 × 6, залітає і вилітає по прямій.',
      facts: ['<b>30 × 40</b> плит', 'хрест із <b>6</b> ділянок', 'сходи до <b>+12</b>', 'наскрізний ангар грузового', 'тронна зала до <b>+17</b>'],
    },
    levelNames: {
      0: ['Рівень 0', 'площа, вестибюль, цистерни, ангар орні, великий зал, гараж, ангар грузового'],
      4: ['Рівень +4', 'перший майданчик, казарма, середній ярус: переробка, галерея, майстерня'],
      8: ['Рівень +8', 'другий майданчик, верхній ярус: покої гільдії'],
      12: ['Рівень +12', 'тераса вершини, тронна зала'],
      roof: 'скатний дах тронної зали, вітряна ферма на ангарі грузового',
    },
  }
}

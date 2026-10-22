/*
 * «Соколине гніздо» — авіабаза на 6 ділянках літерою L (смуга 40 × 10 і крило 10 × 20 від західного кінця).
 * Головне — ангари вертикального зльоту: три бокси на +4 з дахом-пентащитом 4 × 6 (орні сідає згори й злітає вгору,
 * не маневруючи між стінами), поруч — наскрізний ангар грузового з порталами 8 × 6 на південь і північ. На розі —
 * дванадцятикутна диспетчерська вежа до +22 зі скляним ліхтарем; у крилі — казарми навколо двору з вітропастками,
 * гараж наземної техніки з воротами. Уся техніка — під дахом.
 */
import * as L from './lib.mjs'

export function airbase() {
  const B = L.createBase('a')
  const claims = [[-20, 0], [-10, 0], [0, 0], [10, 0], [-20, 10], [-20, 20]].map(([x, y]) => ({ x, y, w: 10, d: 10 }))
  const win = (rows, step = 2) => (e, i) => (rows.includes(i) && Math.round((Math.abs(e.out.x) > 0.5 ? e.m.y : e.m.x) - 0.5) % step === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null)
  const at = (e, x0, x1, y0, y1) => e.m.x > x0 - 1e-6 && e.m.x < x1 + 1e-6 && e.m.y > y0 - 1e-6 && e.m.y < y1 + 1e-6

  // ---------- смуга: майстерні на землі, бокси орні на +4, сходова, ангар грузового ----------
  B.block({ tiles: L.rect(-10, 8, 0, 10), z: 0, h: 4, lean: true, leanSkip: (e) => Math.abs(e.m.x + 10) < 1e-6, wall: win([3], 2), zone: { name: 'Майстерні авіабази', group: 'craft' } })
  const bays = [[-10, 'Бокс штурмовика'], [-4, 'Бокс розвідника (1)'], [2, 'Бокс розвідника (2)']]
  for (const [x0, name] of bays) B.block({ tiles: L.rect(x0, x0 + 6, 1, 9), z: 4, h: 4, zone: { name, group: 'air' } })
  B.block({ tiles: L.rect(8, 10, 0, 10), z: 0, h: 4, zone: { name: 'Сходова', group: 'core' } })
  B.block({ tiles: L.rect(8, 10, 0, 10), z: 4, h: 4, wall: win([1], 2), zone: { name: 'Сходова (+4)', group: 'core' } })
  const carrierPortal = (e) => !(Math.abs(e.m.x - 20) < 1e-6)
  B.block({ tiles: L.rect(10, 20, 0, 10), z: 0, h: 6, lean: true, leanSkip: carrierPortal, zone: { name: 'Ангар грузового', group: 'air' } })

  // ---------- диспетчерська вежа: дванадцятикутник, 4 поверхи, скляний ліхтар ----------
  const TC = { x: -15, y: 5 }
  const tower = L.dodecaTiles(TC, 3, 0)
  const lantern = L.hexTiles(TC, 2, 0)
  const towerWin = (rows) => (e, i) => (rows.includes(i) ? 'MTX_Neut_DesertMechanic_Window_01' : null)
  B.block({ tiles: tower, z: 0, h: 5, wall: towerWin([2]), zone: { name: 'Вежа: хол', group: 'tower' } })
  B.block({ tiles: tower, z: 5, h: 5, wall: towerWin([2]), zone: { name: 'Вежа: штурманська', group: 'tower' } })
  B.block({ tiles: tower, z: 10, h: 5, wall: towerWin([2]), zone: { name: 'Вежа: зв’язок', group: 'tower' } })
  B.block({ tiles: tower, z: 15, h: 4, wall: towerWin([1, 2]), zone: { name: 'Вежа: оглядова', group: 'tower' } })
  B.block({ tiles: lantern, z: 19, h: 3, wall: towerWin([0, 1, 2]), zone: { name: 'Диспетчерська', group: 'crown' } })

  // ---------- крило: казарми навколо двору з вітропастками ----------
  const yard = L.rect(-17, -13, 14, 26)
  const ring = L.without(L.rect(-20, -10, 10, 30), yard)
  const garageGate = (e) => at(e, -16, -13, 30, 30)
  B.block({ tiles: ring, z: 0, h: 4, lean: true, leanSkip: (e) => garageGate(e) || at(e, -17, -13, 14, 26) || at(e, -13, -12, 10, 10), wall: (e, i) => (i === 2 && at(e, -17, -13, 14, 26) && Math.round(e.m.x + e.m.y) % 2 === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null), zone: { name: 'Казарми', group: 'core' } })
  B.block({ tiles: yard, z: 0, h: 0, roof: 'none', zone: { name: 'Двір з вітропастками', group: 'deck' } })
  B.block({ tiles: L.rect(-19, -11, 11, 14), z: 4, h: 3, roof: 'hip', wall: win([1], 2), zone: { name: 'Кубрик (південь)', group: 'core' } })
  B.block({ tiles: L.rect(-19, -11, 26, 29), z: 4, h: 3, roof: 'hip', wall: win([1], 2), zone: { name: 'Кубрик (північ)', group: 'core' } })

  B.after((B) => {
    // бокси: дах — пентащит 4 × 6 посередині (строгий прямокутник на квадратах), уздовж — плаский дах
    for (const [x0] of bays) for (const t of L.rect(x0 + 1, x0 + 5, 2, 8)) B.shieldFloor(t, 8)
    // ангар грузового: портали 8 × 6 у південній і північній стінах — залітає з півдня, вилітає на північ
    B.shield({ x: 11, y: 0 }, { x: 19, y: 0 }, 0, 6)
    B.shield({ x: 19, y: 10 }, { x: 11, y: 10 }, 0, 6)
    B.railAround(L.rect(10, 19, 0, 10), 6)
    // сходова: земля → +4 → дах-оглядовий майданчик +8
    B.railAround(B.stairs(8.5, 1.5, 90, 0, 4), 4, (e) => Math.abs(e.m.y - 5) < 1e-6)
    B.railAround(B.stairs(9.5, 8.5, -90, 4, 4), 8, (e) => Math.abs(e.m.y - 5) < 1e-6)
    B.railAround(L.rect(8, 10, 0, 10), 8)
    // двері: сходова ↔ майстерні, ангар грузового, бокси; бокси між собою
    B.door({ x: 8, y: 6 }, { x: 8, y: 5 }, 0)
    B.door({ x: 10, y: 3 }, { x: 10, y: 4 }, 0)
    B.door({ x: 8, y: 6 }, { x: 8, y: 5 }, 4)
    for (const x of [-4, 2]) B.door({ x, y: 6 }, { x, y: 5 }, 4)
    // майстерні: перегородки під стінами боксів, двері по осі
    for (const x of [-4, 2]) { B.fill({ x, y: 1 }, { x, y: 9 }, 0, 4); B.door({ x, y: 5 }, { x, y: 4 }, 0) }
    // з майстерень назовні — на площу перед вежею
    B.door({ x: -10, y: 5 }, { x: -10, y: 4 }, 0)
  })
  // вхід у вежу (східна вершина дванадцятикутника — до майстерень) і драбина на всі поверхи з люками
  B.after((B) => {
    const edges = L.boundary(tower)
    const east = edges.reduce((m, e) => (e.out.x > m.out.x ? e : m))
    B.door(east.a, east.b, 0)
    // драбина: на зовнішній стіні середнього квадрата північно-західної сторони
    const nw = edges.filter((e) => e.t.k === 's').reduce((m, e) => (dot(e.out, 150) > dot(m.out, 150) ? e : m))
    B.ladder(nw.a, nw.b, 0, 19, null)
    for (const z of [5, 10, 15, 19]) B.ladderHatch(nw.t, z)
    // ліхтар: двері на дах вежі
    const le = L.boundary(lantern).reduce((m, e) => (e.out.x > m.out.x ? e : m))
    B.door(le.a, le.b, 19)
    B.railAround(tower, 19)
  })
  const dot = (o, deg) => o.x * Math.cos((deg * Math.PI) / 180) + o.y * Math.sin((deg * Math.PI) / 180)

  // крило: двері у двір, ворота гаража, сходи на кубрики
  B.after((B) => {
    B.gate({ x: -16, y: 30 }, { x: -13, y: 30 }, 0)
    for (const [a, b] of [[{ x: -15, y: 14 }, { x: -14, y: 14 }], [{ x: -14, y: 26 }, { x: -15, y: 26 }], [{ x: -17, y: 20 }, { x: -17, y: 19 }], [{ x: -13, y: 19 }, { x: -13, y: 20 }]]) B.door(a, b, 0)
    // двері з площі вежі в казарми
    B.door({ x: -12, y: 10 }, { x: -13, y: 10 }, 0)
    // гараж (північ) відділений від казарм
    B.fill({ x: -19, y: 26 }, { x: -17, y: 26 }, 0, 4)
    B.fill({ x: -13, y: 26 }, { x: -11, y: 26 }, 0, 4)
    // сходи з казарм на кубрики +4 (уздовж східної галереї)
    B.railAround(B.stairs(-11.5, 18.5, -90, 0, 4), 4, (e) => Math.abs(e.m.y - 15) < 1e-6)
    B.railAround(B.stairs(-18.5, 21.5, 90, 0, 4), 4, (e) => Math.abs(e.m.y - 25) < 1e-6)
    // з галерей у кубрики
    for (const x of [-19, -12]) { B.door({ x, y: 14 }, { x: x + 1, y: 14 }, 4); B.door({ x: x + 1, y: 26 }, { x, y: 26 }, 4) }
    // галереї +4 над бічними крилами (дах казарм) — поручні з боку двору й назовні
    B.railAround(L.rect(-19, -11, 14, 26).filter((t) => t.x < -17 || t.x > -13), 4)
  })

  // ---------- станції ----------
  // бокси орні: під щитом даху
  B.item('OrnithopterMedium', -7, 5, 4, 90)
  B.item('OrnithopterLight', -1, 5, 4, 90)
  B.item('OrnithopterLight', 5, 5, 4, 90)
  for (const [x0] of bays) B.item('RepairStation_Placeable', x0 + 0.7, 2.2, 4, 90)
  // ангар грузового: по осі між порталами
  B.item('OrnithopterTransport', 15, 5, 0, 90)
  // майстерні: техніка, запчастини, паливо
  B.item('Advanced_VehiclesFabricator_Placeable', -7.0, 4.4, 0)
  B.item('RepairStation_Placeable', -7.0, 7.4, 0)
  B.item('Fabricator_Placeable', -2.6, 2.4, 0)
  B.item('AdvancedWeaponsFabricator_Placeable', -2.6, 7.4, 0)
  B.item('Recycler_Placeable', 0.4, 2.2, 0)
  for (let k = 0; k < 4; k++) B.item('MediumStorageContainer_Placeable', 3.0 + k * 1.25, 2.0, 0)
  B.item('SpiceGenerator_Placeable', 4.4, 7.4, 0)
  B.item('SpiceGenerator_Placeable', 6.6, 7.4, 0)
  // вежа
  B.item('Totem_Placeable', -15, 5, 0)
  B.item('MediumStorageContainer_Placeable', -13.4, 6.4, 5)
  B.item('AdvancedWearablesFabricator_Placeable', -16.6, 6.2, 5)
  B.item('ModdingStation_Placeable', -15, 3.6, 10)
  // двір: вітропастки
  for (const x of [-16, -14]) for (const y of [15.5, 18.5, 21.5, 24.5]) B.item('LargeWindtrap_Placeable', x, y, 0)
  // казарми (бічні крила): вода, енергія, склад
  for (const y of [20.9, 22.6]) B.item('WaterCistern_Placeable', -11.95, y, 0)
  B.item('Deathstill_Placeable', -11.95, 24.4, 0)
  B.item('BloodWaterExtractionAdvanced_Placeable', -18.4, 19.6, 0)
  for (const y of [11.6, 13.0]) for (const x of [-18.6, -17.3, -12.7, -11.4]) B.item('StorageContainer_Placeable', x, y, 0)
  for (let k = 0; k < 3; k++) B.item('MediumStorageContainer_Placeable', -18.4, 15.4 + k * 1.4, 0)
  // гараж (північ)
  B.item('Buggy', -14.5, 27.7, 0)
  B.item('Sandbike', -18.0, 27.4, 0)
  B.item('Sandbike', -11.4, 27.4, 0)
  // кубрики: скрині
  for (const x of [-18, -16.6, -13.4, -12]) { B.item('GenericContainer_Placeable', x, 11.6, 4); B.item('GenericContainer_Placeable', x, 28.4, 4) }
  // вітряки: дах ангара грузового
  for (const x of [11.2, 12.6, 14, 15.4, 16.8, 18.2]) for (const y of [1.2, 8.8]) B.item('WindTurbineDirectional_Placeable', x, y, 6)

  const pieces = B.finish()
  return {
    claims, pieces, items: B.items, zones: B.zones,
    ui: {
      name: 'Соколине гніздо',
      lead: 'Авіабаза на шести ділянках літерою L. Три бокси орні на +4 з дахом-пентащитом: орнітоптер сідає згори і злітає вертикально, не маневруючи між стінами. Поруч — наскрізний ангар грузового з порталами 8 × 6 на південь і північ. На розі — дванадцятикутна диспетчерська вежа зі скляним ліхтарем на +19, у крилі — казарми навколо двору з вітропастками й гараж наземної техніки.',
      facts: ['<b>40 × 10</b> + <b>10 × 20</b> плит', '<b>3</b> бокси вертикального зльоту', 'наскрізний ангар грузового', 'вежа до <b>+22</b>'],
    },
    levelNames: {
      0: ['Рівень 0', 'майстерні, ангар грузового, хол вежі, казарми, двір, гараж'],
      4: ['Рівень +4', 'бокси орні з дахом-пентащитом, кубрики'],
      5: ['Рівень +5', 'вежа: штурманська'],
      10: ['Рівень +10', 'вежа: зв’язок'],
      15: ['Рівень +15', 'вежа: оглядова'],
      19: ['Рівень +19', 'дах вежі, диспетчерська'],
      roof: 'дахи-пентащити боксів, вітряки на ангарі грузового',
    },
  }
}

/*
 * «Гексагональна цитадель» — 6 ділянок фігурою «товста S» (квадрат 2 × 2 і дві ділянки навскіс по кутах). Головне —
 * шестикутна зала (сторона 8) на трикутній сітці з порожнистим ступінчастим куполом: шестикутники 8 → 7 → … → 3
 * уступами по блоку, усередині — один простір до самого ліхтаря на +14. Зала — ремісничий центр: фабрикатори колом.
 * Від двох граней навскіс (під 30°) — крила на повернутій квадратній сітці: ангар орні (портал і дах-пентащит) і
 * гараж (портал для краулера й ворота); біля двох інших граней — шестикутні вежі. Симетрія обертання на 180°.
 */
import * as L from './lib.mjs'

export function hexcitadel() {
  const B = L.createBase('h')
  const claims = [[-10, 0], [0, 0], [-10, 10], [0, 10], [10, 0], [-20, 10]].map(([x, y]) => ({ x, y, w: 10, d: 10 }))
  const C = { x: 0, y: 10 }
  const H = (s, c = C) => L.hexTiles(c, s, 0)
  const ringOf = (outer, inner) => L.without(outer, inner)
  const hex8 = H(8)
  // купол: шестикутники 8 → 7 → … → 3 по блоку заввишки, ліхтар — шестикутник 2 на 3 блоки
  const tiers = [[8, 0, 6], [7, 6, 1], [6, 7, 1], [5, 8, 1], [4, 9, 1], [3, 10, 1], [2, 11, 3]].map(([s, z, h]) => ({ s, z, h, tiles: H(s) }))

  // ---------- зала: ступінчастий порожнистий купол ----------
  const all = (rows) => (e, i) => (rows.includes(i) ? 'MTX_Neut_DesertMechanic_Window_01' : null)
  const every = (rows) => (e, i) => (rows.includes(i) && Math.round((e.m.x + e.m.y) * 2) % 2 === 0 ? 'MTX_Neut_DesertMechanic_Window_01' : null)
  tiers.forEach((t, k) => B.block({
    tiles: t.tiles, z: t.z, h: t.h, floor: k === 0, roof: k === tiers.length - 1 ? 'flat' : 'none',
    wall: k === 0 ? every([4]) : k === tiers.length - 1 ? all([0, 1, 2]) : every([0]),
    zone: k === 0 ? { name: 'Зала Шести Граней', group: 'core' } : null,
  }))

  // ---------- крила на гранях навскіс: повернута квадратна сітка 8 × 6 ----------
  const V = L.ngon(C, 8, 6, 0) // вершини: 0°, 60°, … — грані між ними
  // південно-східна грань (V5 → V0, нормаль 330°) і північно-західна (V2 → V3, нормаль 150°)
  const wingOf = (a, b) => {
    const th = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
    return { th, o: a, tiles: L.sqGrid(a, th, 0, 8, -6, 0) }
  }
  const SE = wingOf(V[5], V[0]), NW = wingOf(V[2], V[3])
  B.block({ tiles: SE.tiles, z: 0, h: 4, zone: { name: 'Ангар орні', group: 'air' } })
  B.block({ tiles: NW.tiles, z: 0, h: 4, zone: { name: 'Гараж', group: 'drive' } })

  // ---------- вежі біля вільних граней (північний схід і південний захід) ----------
  const towerAt = (k) => { const m = { x: (V[k].x + V[(k + 1) % 6].x) / 2, y: (V[k].y + V[(k + 1) % 6].y) / 2 }; const n = { x: m.x - C.x, y: m.y - C.y }; const L2 = Math.hypot(n.x, n.y); return { x: m.x + (n.x / L2) * L.RT3, y: m.y + (n.y / L2) * L.RT3 } }
  const TNE = towerAt(0), TSW = towerAt(3)
  for (const [t, name] of [[TNE, 'Вежа (північний схід)'], [TSW, 'Вежа (південний захід)']]) {
    const tiles = H(2, t)
    for (const z of [0, 4, 8]) B.block({ tiles, z, h: 4, wall: every([2]), zone: z === 0 ? { name, group: 'tower' } : null })
  }

  // ---------- окремі корпуси на прямій сітці: рудний двір і водосховище ----------
  B.block({ tiles: L.rect(14, 20, 1, 9), z: 0, h: 4, lean: true, leanSkip: (e) => Math.abs(e.m.x - 14) < 1e-6 && Math.abs(e.m.y - 5.5) < 1e-6, zone: { name: 'Рудний двір', group: 'refine' } })
  B.block({ tiles: L.rect(-20, -14, 11, 19), z: 0, h: 4, lean: true, leanSkip: (e) => Math.abs(e.m.x + 14) < 1e-6 && Math.abs(e.m.y - 14.5) < 1e-6, zone: { name: 'Водосховище', group: 'craft' } })

  // грані крила: зовнішній торець (далекий від зали) — упорядкований уздовж грані
  const farFace = (w) => {
    const t = (w.th * Math.PI) / 180, out = { x: Math.sin(t), y: -Math.cos(t) }
    return L.boundary(w.tiles).filter((e) => e.out.x * out.x + e.out.y * out.y > 0.99).sort((p, q) => (p.m.x - q.m.x) * Math.cos(t) + (p.m.y - q.m.y) * Math.sin(t))
  }
  const along = (w, i, j) => { const t = (w.th * Math.PI) / 180; return { x: w.o.x + i * Math.cos(t) - j * Math.sin(t), y: w.o.y + i * Math.sin(t) + j * Math.cos(t) } }
  const outAng = (w) => w.th - 90

  B.after((B) => {
    // кільця дахів куполу
    for (let k = 0; k < tiers.length - 1; k++) for (const t of ringOf(tiers[k].tiles, tiers[k + 1].tiles)) B.slab(t, tiers[k].z + tiers[k].h, 'roof')
    B.railAround(hex8, 6)
    // ангар: портал-пентащит 6 × 3 у далекому торці, дах-пентащит 4 × 4 (вертикальний зліт)
    const fe = farFace(SE)
    for (const e of fe.slice(1, 7)) for (let z = 0; z < 3; z++) B.edge(e, z, 'Choam_PentashieldSurfaceVertical_Placeable', true)
    for (const t of L.sqGrid(SE.o, SE.th, 2, 6, -5, -1)) B.shieldFloor(t, 4)
    // гараж: портал 4 × 3 для краулера і ворота 3 × 2 для багі
    const fg = farFace(NW)
    for (const e of fg.slice(0, 4)) for (let z = 0; z < 3; z++) B.edge(e, z, 'Choam_PentashieldSurfaceVertical_Placeable', true)
    { const t = (NW.th * Math.PI) / 180, pr = (q) => q.x * Math.cos(t) + q.y * Math.sin(t)
      const pts = [fg[5].a, fg[5].b, fg[7].a, fg[7].b].sort((p, q) => pr(p) - pr(q))
      B.gate(pts[0], pts[3], 0) }
    // двері: з крил і веж у залу (по спільній грані), назовні — південна і північна грані
    const hexEdges = L.boundary(hex8)
    const faceDoor = (pt) => { const e = hexEdges.reduce((m, q) => (Math.hypot(q.m.x - pt.x, q.m.y - pt.y) < Math.hypot(m.m.x - pt.x, m.m.y - pt.y) ? q : m)); B.door(e.a, e.b, 0); return e }
    for (const k of [5, 2, 0, 3]) { const a = V[k], b = V[(k + 1) % 6]; faceDoor({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) }
    faceDoor({ x: 0.5, y: C.y - 8 * Math.sqrt(3) / 2 })
    faceDoor({ x: -0.5, y: C.y + 8 * Math.sqrt(3) / 2 })
    // вежі: драбина на зовнішній стіні, люки на кожному поверсі й на даху; поручні на даху
    for (const t of [TNE, TSW]) {
      const tiles = H(2, t)
      const away = { x: t.x - C.x, y: t.y - C.y }
      const e = L.boundary(tiles).reduce((m, q) => (q.out.x * away.x + q.out.y * away.y > m.out.x * away.x + m.out.y * away.y ? q : m))
      B.ladder(e.a, e.b, 0, 12, null)
      // люків на трикутних плитах нема — над драбиною трикутник перекриття лишаємо відкритим
      for (const z of [4, 8, 12]) B.dropSlab(e.t, z)
      B.railAround(tiles, 12)
    }
    // окремі корпуси: двері до цитаделі
    B.door({ x: 14, y: 6 }, { x: 14, y: 5 }, 0)
    B.door({ x: -14, y: 14 }, { x: -14, y: 15 }, 0)
    B.railAround(L.rect(15, 19, 2, 8), 4)
    B.railAround(L.rect(-19, -15, 12, 18), 4)
  })

  // ---------- станції ----------
  // зала: консоль у центрі, фабрикатори колом лицем до центру
  B.item('Totem_Placeable', C.x, C.y, 0)
  const ring = ['Advanced_SurvivalFabricator_Placeable', 'AdvancedWeaponsFabricator_Placeable', 'AdvancedWearablesFabricator_Placeable', 'ModdingStation_Placeable', 'Recycler_Placeable', 'Fabricator_Placeable']
  ring.forEach((type, k) => { const a = ((30 + 60 * k) * Math.PI) / 180; B.item(type, C.x + 4.2 * Math.cos(a), C.y + 4.2 * Math.sin(a), 0, 30 + 60 * k + 90) })
  for (let k = 0; k < 6; k++) { const a = ((60 * k) * Math.PI) / 180; B.item('MediumStorageContainer_Placeable', C.x + 6.2 * Math.cos(a), C.y + 6.2 * Math.sin(a), 0, 60 * k) }
  // ангар: штурмовик і розвідник носом до порталу
  const pa = along(SE, 2.6, -3.2), pb = along(SE, 5.6, -3.2)
  B.item('OrnithopterMedium', pa.x, pa.y, 0, outAng(SE))
  B.item('OrnithopterLight', pb.x, pb.y, 0, outAng(SE))
  const rp = along(SE, 7.0, -0.7)
  B.item('RepairStation_Placeable', rp.x, rp.y, 0, SE.th)
  // гараж: краулер навпроти порталу, багі — навпроти воріт
  const ca = along(NW, 2.0, -3.0), cb = along(NW, 6.5, -4.0), cc = along(NW, 6.5, -1.2)
  B.item('Sandcrawler', ca.x, ca.y, 0, outAng(NW))
  B.item('Buggy', cb.x, cb.y, 0, outAng(NW))
  B.item('Sandbike', cc.x, cc.y, 0, NW.th)
  // вежі
  B.item('MediumWaterCistern_Placeable', TNE.x, TNE.y, 4)
  B.item('BloodWaterExtractionAdvanced_Placeable', TSW.x, TSW.y, 4)
  B.item('GenericContainer_Placeable', TNE.x, TNE.y, 8)
  B.item('GenericContainer_Placeable', TSW.x, TSW.y, 8)
  B.item('Deathstill_Placeable', TSW.x, TSW.y, 0)
  B.item('MediumStorageContainer_Placeable', TNE.x, TNE.y, 0)
  // рудний двір
  B.item('LargeOreRefinery_Placeable', 17, 2.8, 0)
  B.item('LargeOreRefinery_Placeable', 17, 5.4, 0)
  B.item('MediumChemicalRefinery_Placeable', 16.0, 7.5, 0)
  B.item('Generator_Placeable', 18.3, 7.6, 0)
  // водосховище
  B.item('LargeWaterCistern_Placeable', -17, 13.4, 0)
  B.item('LargeWaterCistern_Placeable', -17, 16.6, 0)
  // дахи: вітропастки на водосховищі, вітряки на рудному дворі
  for (const y of [13, 15, 17]) B.item('WindTurbineDirectional_Placeable', 17, y - 10, 4)
  for (const y of [13.2, 16.8]) B.item('LargeWindtrap_Placeable', -17, y, 4)
  for (const x of [15.6, 18.4]) B.item('WindTurbineDirectional_Placeable', x, 5, 4)

  const pieces = B.finish()
  return {
    claims, pieces, items: B.items, zones: B.zones,
    ui: {
      name: 'Гексагональна цитадель',
      lead: 'Шість ділянок фігурою «товста S». У центрі — шестикутна зала на трикутній сітці: купол — шестикутники 8 → 7 → … → 3 уступами по блоку, а всередині — один простір до скляного ліхтаря на +14. Фабрикатори стоять колом довкола консолі. Від двох граней навскіс відходять крила — ангар орні з порталом і дахом-пентащитом і гараж з порталом для краулера та воротами; біля двох інших граней — шестикутні вежі.',
      facts: ['зала — шестикутник зі стороною <b>8</b>', 'купол до <b>+14</b>', 'крила під <b>30°</b>', '<b>2</b> вежі до <b>+12</b>'],
    },
    levelNames: {
      0: ['Рівень 0', 'Зала Шести Граней, ангар орні, гараж, вежі, рудний двір, водосховище'],
      4: ['Рівень +4', 'вежі'],
      8: ['Рівень +8', 'вежі'],
      roof: 'кільця куполу, ліхтар, дахи веж',
    },
  }
}

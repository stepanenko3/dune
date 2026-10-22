// Генератор баз: на різних формах ділянок і параметрах — база проходить усі правила гри (техніка під дахом, щити
// прямокутні, грузовий наскрізь, стабільність, сходи, дахи, станції); правила ловлять порушення на зіпсованих
// документах; POST /api/bases/generate створює приватну базу людини з версією 1 (на запасній SQLite).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { ENGINE, generateBase } from './lib/basegen.mjs'
import { rules } from '../src/engine/basegen/rules.mjs'
import { STATION_SETS, STATION_TYPES, bayCells, normalizeParams, regroup } from '../src/engine/basegen/generate.mjs'
import { STYLE_PRESETS, normalizeStyle, presetOf, varyStyle } from '../src/engine/basegen/style.mjs'
import { randomize } from '../src/engine/basegen/index.mjs'
import { rng } from '../src/engine/basegen/geom.mjs'
// перевірки показових баз (scripts/showcase) — ще одна незалежна сітка: генератор має проходити й їх
import { verify } from '../scripts/showcase/verify.mjs'
import { openDb } from './lib/sql.mjs'

const SHAPES = {
  'одна': [[0, 0]],
  'лінія 3': [[0, 0], [1, 0], [2, 0]],
  'лінія 6': [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]],
  'Г': [[0, 0], [1, 0], [2, 0], [0, 1]],
  '2 × 2': [[0, 0], [1, 0], [0, 1], [1, 1]],
  '2 × 3': [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]],
  'Т': [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  'хрест': [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]],
}
const TOT = { OrnithopterLight: 2, OrnithopterMedium: 2, OrnithopterTransport: 1, Sandbike: 3, Buggy: 2, Sandcrawler: 1 }
const VARIANTS = {
  'за замовчуванням': {},
  'грузовий окремо': { bays: [{ kind: 'air', items: { OrnithopterTransport: 1 }, portals: 2 }] },
  'кожен тип окремо': { bays: regroup([{ items: TOT }], 'type', 'type') },
  'розвідники зі штурмовими': { bays: regroup([{ items: TOT }], 'small', 'all'), stations: STATION_SETS.advanced, rooms: 8 },
  'усі орні разом': { bays: regroup([{ items: TOT }], 'all', 'all'), roof: 'pyramid' },
  'щит у даху': { bays: [{ kind: 'air', items: { OrnithopterLight: 2 }, portals: 0, roof: true }, { kind: 'air', items: { OrnithopterMedium: 1 }, portals: 1, roof: true }], roof: 'flat' },
  'прямі стіни, пласкі дахи, мінімум': { walls: 'straight', roof: 'flat', stations: STATION_SETS.none, rooms: 0, bays: [] },
  'великий переробник спайсу': { stations: { ...STATION_SETS.basic, large_spice_refinery: 1 } },
}
/** форми: квадрати й по одній фігурній ділянці з краю */
const shapeSets = (cells) => {
  const k = (c) => c[0] + ',' + c[1]
  const last = cells[cells.length - 1]
  return { 'квадрати': {}, 'шестикутник': { [k(last)]: 'hex' }, 'дванадцятикутник': { [k(last)]: 'dodeca' }, 'з двором': { [k(last)]: 'yard' }, 'з атріумом': { [k(cells[0])]: 'atrium' } }
}
const want = (bays) => { const o = {}; for (const b of bays) for (const [t, n] of Object.entries(b.items)) o[t] = (o[t] || 0) + n; return o }

describe('генератор баз', () => {
  for (const [sn, cells] of Object.entries(SHAPES)) {
    for (const [vn, v] of Object.entries(VARIANTS)) {
      for (const [fn, shapes] of Object.entries(shapeSets(cells))) {
        // фігурні форми — на основному наборі й одному з ангарами; решта — квадрати
        if (fn !== 'квадрати' && !['за замовчуванням', 'розвідники зі штурмовими'].includes(vn)) continue
        it(`${sn} · ${vn} · ${fn}: усі правила гри`, () => {
          const g = generateBase({ cells, ...v, shapes, seed: 7 })
          if (!g.doc) {
            // неможливе — лише з причиною (ангару мало ділянок, форма роз'єднує базу, техніка не влазить)
            expect(g.errors.length).toBeGreaterThan(0)
            expect(g.errors.every((e) => ['carrier', 'orni', 'garage', 'vehicle', 'shape', 'bay'].includes(e.code))).toBe(true)
            return
          }
          expect(g.report.errors).toEqual([])
          // перевірки показових баз; «техніка без даху» там шукає дах не вище 9 над технікою, а гребінь піраміди над
          // ангаром грузового — 11; дах над кожною плиткою під технікою перевіряє наше правило shelter
          expect(verify(g.doc.pieces, g.doc.items).filter((m) => !/техніка без даху/.test(m))).toEqual([])
          expect(g.report.stats.minStability).toBeGreaterThanOrEqual(20)
          expect(g.report.stats.sheltered).toBe(g.report.stats.vehicles)
          expect(g.doc.format).toBe(2)
          expect(g.doc.claims).toHaveLength(cells.length)
          expect(g.doc.levels.length).toBeGreaterThan(0)
          // уся техніка, яку просили, на місці
          for (const [type, n] of Object.entries(want(g.params.bays))) expect(g.doc.items.filter((it) => it.type === type)).toHaveLength(n)
        })
      }
    }
  }

  // стилі: кожен пресет на різних планах — усі правила гри й перевірки показових баз; плюс увесь фінальний набір станцій
  for (const preset of Object.keys(STYLE_PRESETS)) for (const sn of ['одна', 'лінія 3', '2 × 2', '2 × 3', 'Т', 'лінія 6']) {
    it(`стиль «${preset}» · ${sn}: усі правила гри`, () => {
      const g = generateBase({ cells: SHAPES[sn], style: { preset }, stations: STATION_SETS.endgame, seed: 2 })
      expect(g.errors).toEqual([])
      expect(g.report.errors).toEqual([])
      expect(verify(g.doc.pieces, g.doc.items).filter((m) => !/техніка без даху/.test(m))).toEqual([])
      expect(g.report.stats.minStability).toBeGreaterThanOrEqual(20)
      expect(g.params.style.preset).toBe(preset)
    })
  }

  it('стиль: пресет — набір перемикачів; змінений перемикач — «свій»; давні walls / roof — поверх простого', () => {
    expect(normalizeStyle({ preset: 'harkonnen' })).toMatchObject({ preset: 'harkonnen', walls: 'lean', roof: 'pyramid', ziggurat: true })
    expect(normalizeStyle({ preset: 'harkonnen', ziggurat: false }).preset).toBe('custom')
    // невідоме — за пресетом; поверхів веж — 1…3
    expect(normalizeStyle({ preset: 'atreides', towerShape: 'cube', towerFloors: 9 })).toMatchObject({ preset: 'custom', towerShape: 'square', towerFloors: 3 })
    expect(normalizeStyle(null, { walls: 'lean', roof: 'hip' })).toMatchObject({ walls: 'lean', roof: 'hip', towers: 'none', ziggurat: false })
    expect(presetOf(normalizeStyle({ preset: 'atreides' }))).toBe('atreides')
    expect(normalizeParams({ walls: 'inverted', roof: 'pyramid' }).params.style).toMatchObject({ walls: 'inverted', roof: 'pyramid' })
  })

  it('стиль: вежа-келих — стовбур 2 × 2, майданчик 4 × 4 з павільйоном; закрита оглядова кімната', () => {
    const cells = SHAPES['2 × 3']
    for (const towerCap of ['hip', 'room', 'spires']) {
      const g = generateBase({ cells, style: { preset: 'sandwalkers', towers: 'one', towerShape: 'goblet', towerFloors: 2, towerCap }, seed: 2 })
      expect(g.report.errors).toEqual([])
      const tower = g.doc.zones.find((z) => z.name === 'Вежа')
      expect(tower.tiles).toHaveLength(4)
      // драбина на кожен поверх стовбура й люк на майданчик (на висоті 4 + 8)
      expect(g.doc.pieces.some((p) => p.shape === 'Choam_Level2_Hatch' && p.z === 12)).toBe(true)
      if (towerCap === 'room') expect(g.doc.zones.some((z) => z.name === 'Оглядова' && z.tiles.length === 16)).toBe(true)
      else expect(g.doc.pieces.filter((p) => /_Pillar_/.test(p.shape) && p.z >= 12 && p.z < 15)).toHaveLength(12)
    }
  })

  it('стиль: мала база (тераса — смуга польоту) — корона на даху житла замість веж і зикурата', () => {
    const at = (preset) => generateBase({ cells: SHAPES['2 × 2'], style: { preset }, seed: 1 })
    // павільйон: чотири колони по 3 над дахом житла (скатний — на його пласкому верху, 4 + 3 + 1)
    const sw = at('sandwalkers')
    expect(sw.report.errors).toEqual([])
    expect(sw.doc.pieces.filter((p) => /_Pillar_/.test(p.shape) && p.z >= 8)).toHaveLength(12)
    expect(at('sardaukar').doc.zones.some((z) => z.name === 'Корона')).toBe(true)
    expect(at('smuggler').doc.zones.some((z) => z.name === 'Оглядова')).toBe(true)
    // над пірамідою корони нема
    expect(at('harkonnen').doc.zones.some((z) => z.name === 'Корона' || z.name === 'Оглядова')).toBe(false)
  })

  it('стиль: нависання — перший поверх під верхом на дві плитки всередину; ганок — двері в ніші між колонами', () => {
    const g = generateBase({ cells: SHAPES['2 × 3'], style: { preset: 'plain', cantilever: true, porch: true }, seed: 2 })
    expect(g.report.errors).toEqual([])
    const z0 = g.doc.pieces.filter((p) => p.shape === 'Sardaukar_Wall_01' && p.z === 0)
    // стіни першого поверху на лінії за дві плитки від межі ділянки
    expect(z0.some((p) => [2, 8, 12, 18].some((v) => Math.abs(p.x - v) < 1e-6 || Math.abs(p.y - v) < 1e-6))).toBe(true)
    const door = g.doc.pieces.find((p) => p.shape === 'Atreides_Outpost_Door_Frame_Tall' && p.z === 0 && [1, 9, 11, 19, 21, 29].some((v) => Math.abs(p.x - v) < 1e-6 || Math.abs(p.y - v) < 1e-6))
    expect(door).toBeTruthy()
  })

  it('«Рандом» змінює все — розкладку ділянок, форми, ангари, стиль; техніка, станції й кімнати ті самі; правила виконано', () => {
    const rand = rng(42)
    const base = { rooms: 4, stations: STATION_SETS.advanced, bays: [{ kind: 'air', items: { OrnithopterLight: 2, OrnithopterTransport: 1 }, portals: 2 }, { kind: 'ground', items: { Sandbike: 2, Buggy: 1 }, portals: 1 }] }
    const layouts = new Set(), sigs = new Set()
    for (let k = 0; k < 12; k++) {
      const p = randomize(base, ENGINE, rand)
      expect(want(p.bays)).toEqual(want(normalizeParams(base).params.bays))
      expect(p.stations).toEqual(STATION_SETS.advanced)
      expect(p.rooms).toBe(4)
      const g = generateBase(p)
      expect(g.errors).toEqual([])
      expect(g.report.errors).toEqual([])
      layouts.add(JSON.stringify(p.cells))
      sigs.add(JSON.stringify(g.doc.pieces.map((q) => [q.shape, q.x, q.y, q.z])))
    }
    expect(layouts.size).toBeGreaterThanOrEqual(8)
    expect(sigs.size).toBe(12)
  })

  it('варіант змінює і розташування, і деталі пресета; у документі — параметри людини, не варіації', () => {
    const docs = [1, 2, 3, 4, 5, 6].map((seed) => generateBase({ cells: SHAPES['2 × 3'], style: { preset: 'atreides' }, seed }))
    expect(new Set(docs.map((g) => JSON.stringify(g.doc.pieces.map((q) => [q.shape, q.x, q.y, q.z])))).size).toBe(6)
    for (const g of docs) expect(g.doc.ui.generator.params.style.preset).toBe('atreides')
    // варіації — лише в межах пресета; свій стиль — як задано
    const styles = Array.from({ length: 40 }, (_, i) => varyStyle(normalizeStyle({ preset: 'harkonnen' }), rng(i + 1)))
    expect(new Set(styles.map((x) => x.roof))).toEqual(new Set(['pyramid', 'dome']))
    expect(styles.every((x) => x.walls === 'lean' && x.ziggurat)).toBe(true)
    const own = normalizeStyle({ preset: 'harkonnen', ziggurat: false })
    expect(varyStyle(own, rng(3))).toEqual(own)
  })

  it('склепіння й куполи — заокруглені скати; ступінчасті вежі; навіси на терасах', () => {
    const vault = generateBase({ cells: SHAPES['2 × 3'], style: { preset: 'plain', roof: 'vault' }, seed: 2 })
    expect(vault.report.errors).toEqual([])
    expect(vault.doc.pieces.some((p) => p.shape === 'Sardaukar_Roof_Round_Corner')).toBe(true)
    expect(vault.doc.pieces.some((p) => p.shape === 'Sardaukar_Roof_01')).toBe(false)
    const tower = generateBase({ cells: SHAPES['2 × 3'], style: { preset: 'plain', towers: 'one', towerShape: 'stepped', towerFloors: 2, towerCap: 'pyramid' }, seed: 2 })
    expect(tower.report.errors).toEqual([])
    expect(tower.doc.zones.some((z) => z.name === 'Верх вежі' && z.tiles.length === 4)).toBe(true)
    const shade = generateBase({ cells: SHAPES['2 × 3'], style: { preset: 'plain', canopies: true }, stations: STATION_SETS.basic, seed: 2 })
    expect(shade.report.errors).toEqual([])
    // колони навісу — від тераси (4) на 3 угору, дах — на 7
    expect(shade.doc.pieces.filter((p) => /_Pillar_/.test(p.shape) && p.z >= 4 && p.z < 7).length).toBeGreaterThanOrEqual(12)
    expect(shade.doc.pieces.some((p) => p.shape === 'Sardaukar_Rooftop_01' && p.z === 7)).toBe(true)
  })

  it('той самий вхід — та сама база; інший варіант — інше розташування', () => {
    const a = generateBase({ cells: SHAPES['2 × 3'], seed: 3 }), b = generateBase({ cells: SHAPES['2 × 3'], seed: 3 })
    expect(JSON.stringify(a.doc)).toBe(JSON.stringify(b.doc))
    const plans = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(generateBase({ cells: SHAPES['2 × 3'], seed }).plan)))
    expect(plans.size).toBeGreaterThan(1)
  })

  it('параметри: ділянки й форми зсуваються до нуля, роз’єднані й забагато — помилка, межі обрізаються', () => {
    expect(normalizeParams({ cells: [[3, 4], [4, 4]], shapes: { '4,4': 'hex', '3,4': 'oval' } }).params).toMatchObject({ cells: [[0, 0], [1, 0]], shapes: { '1,0': 'hex' } })
    expect(normalizeParams({ cells: [[0, 0], [2, 0]] }).errors[0].code).toBe('cells')
    expect(normalizeParams({ cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0]] }).errors[0].code).toBe('cells')
    const p = normalizeParams({ rooms: 99, stations: { GenericContainer_Placeable: 99, nonsense: 3, Sandbike: 2 }, name: '<b>Моя</b> база' }).params
    expect(p).toMatchObject({ rooms: 8, stations: { GenericContainer_Placeable: 12 }, name: 'Моя база' })
    // грузовий — будь-який вихід (один на ангар); наземна — з порталом; контейнер у гаражі — щит у даху; порожні геть
    const q = normalizeParams({ bays: [{ kind: 'air', items: { OrnithopterTransport: 3 }, portals: 0, roof: true }, { kind: 'ground', items: { Buggy: 2 }, portals: 0 }, { kind: 'ground', items: { ContainerVehicle: 5 }, portals: 1 }, { kind: 'air', items: {} }] }).params
    expect(q.bays).toEqual([
      { kind: 'air', items: { OrnithopterTransport: 1 }, portals: 0, roof: true },
      { kind: 'ground', items: { Buggy: 2 }, portals: 1, roof: false },
      { kind: 'ground', items: { ContainerVehicle: 2 }, portals: 1, roof: true },
    ])
    // давні параметри першої версії
    const old = normalizeParams({ scout: 2, assault: 1, carrier: true, sandbike: 1, production: 'advanced' }).params
    expect(want(old.bays)).toEqual({ OrnithopterLight: 2, OrnithopterMedium: 1, OrnithopterTransport: 1, Sandbike: 1 })
    expect(old.stations).toEqual(STATION_SETS.advanced)
    // забагато в одному ангарі
    expect(normalizeParams({ bays: [{ kind: 'air', items: { OrnithopterMedium: 6, OrnithopterTransport: 1 }, portals: 2 }] }).errors[0].code).toBe('bay')
  })

  it('групування: кожен тип окремо, розвідники зі штурмовими, усі разом, по двоє', () => {
    const tot = [{ items: TOT }]
    expect(regroup(tot, 'type', 'type').map((b) => b.items)).toEqual([{ OrnithopterTransport: 1 }, { OrnithopterLight: 2 }, { OrnithopterMedium: 2 }, { Sandbike: 3 }, { Buggy: 2 }, { Sandcrawler: 1 }])
    expect(regroup(tot, 'small').map((b) => b.items)).toEqual([{ OrnithopterTransport: 1 }, { OrnithopterLight: 2, OrnithopterMedium: 2 }, { Sandcrawler: 1, Buggy: 2, Sandbike: 3 }])
    expect(regroup(tot, 'all').map((b) => b.items)[0]).toEqual({ OrnithopterLight: 2, OrnithopterMedium: 2, OrnithopterTransport: 1 })
    expect(regroup(tot, 'pairs').filter((b) => b.kind === 'air')).toHaveLength(3)
    // скільки ділянок поспіль: орні по 2 на ділянку, грузовий — від двох
    expect(bayCells({ kind: 'air', items: { OrnithopterLight: 2 }, portals: 2 })).toBe(1)
    expect(bayCells({ kind: 'air', items: { OrnithopterLight: 4 }, portals: 2 })).toBe(2)
    expect(bayCells({ kind: 'air', items: { OrnithopterTransport: 1 }, portals: 2 })).toBe(2)
    expect(bayCells({ kind: 'air', items: { OrnithopterMedium: 6, OrnithopterTransport: 1 }, portals: 2 })).toBe(-1)
  })

  it('станції генератора — рівно палітра гри без техніки', () => {
    expect([...STATION_TYPES].sort()).toEqual(ENGINE.PRESETS.items.filter((p) => p.group !== 'vehicle').map((p) => p.type).sort())
  })

  it('станції поштучно: стільки, скільки замовили (якщо вмістились)', () => {
    const stations = { Fabricator_Placeable: 2, LargeOreRefinery_Placeable: 1, MediumStorageContainer_Placeable: 3, LargeWindtrap_Placeable: 2, WindTurbineOmnidirectional_Placeable: 3, Totem_Placeable: 1 }
    const g = generateBase({ cells: SHAPES['лінія 3'], stations, seed: 1 })
    expect(g.notes.filter((n) => n.code === 'fit')).toEqual([])
    for (const [t, n] of Object.entries(stations)) expect(g.doc.items.filter((it) => it.type === t)).toHaveLength(n)
  })

  it('щит у даху: горизонтальний пентащит — прямокутник над орні, ангар без порталів', () => {
    // стиль без скляних стель — лише щит над ангаром
    const g = generateBase({ cells: SHAPES['лінія 3'], bays: [{ kind: 'air', items: { OrnithopterLight: 2 }, portals: 0, roof: true }], style: { preset: 'plain' }, seed: 1 })
    expect(g.report.errors).toEqual([])
    expect(g.doc.pieces.filter((p) => p.shape === 'Choam_PentashieldSurfaceHorizontal_Placeable')).toHaveLength(36)
    expect(g.doc.pieces.filter((p) => p.shape === 'Choam_PentashieldSurfaceVertical_Placeable' && p.z >= 4)).toHaveLength(0)
  })

  it('грузовий: з одного боку, під щитом у даху (уздовж ангара), портал і щит — ангар 6 заввишки, правила виконано', () => {
    for (const [portals, roof] of [[1, false], [0, true], [1, true], [2, true]]) {
      const g = generateBase({ cells: SHAPES['лінія 3'], bays: [{ kind: 'air', items: { OrnithopterTransport: 1 }, portals, roof }], seed: 1 })
      expect(g.report.errors).toEqual([])
      const c = g.doc.items.find((it) => it.type === 'OrnithopterTransport')
      expect(c).toBeTruthy()
      if (roof) expect(g.doc.pieces.filter((p) => p.shape === 'Choam_PentashieldSurfaceHorizontal_Placeable').length).toBeGreaterThan(0)
      if (!portals) expect(g.doc.pieces.filter((p) => p.shape === 'Choam_PentashieldSurfaceVertical_Placeable' && p.z >= 4)).toHaveLength(0)
    }
  })

  it('гараж зі щитом у даху: грузовий забирає згори багі, краулер і контейнер; без щита контейнер — порушення', () => {
    const g = generateBase({ cells: SHAPES['лінія 3'], bays: [{ kind: 'ground', items: { Sandcrawler: 1, Buggy: 1, ContainerVehicle: 1 }, portals: 1, roof: true }], seed: 1 })
    expect(g.report.errors).toEqual([])
    expect(g.doc.items.filter((it) => it.type === 'ContainerVehicle')).toHaveLength(1)
    expect(g.doc.pieces.filter((p) => p.shape === 'Choam_PentashieldSurfaceHorizontal_Placeable').length).toBeGreaterThan(0)
    // той самий гараж без щита в даху (у документі) — контейнер нема як забрати
    const d = JSON.parse(JSON.stringify(g.doc))
    d.pieces = d.pieces.map((p) => (p.shape === 'Choam_PentashieldSurfaceHorizontal_Placeable' ? { ...p, shape: 'Sardaukar_Rooftop_01' } : p))
    expect(rules(d, ENGINE).errors.some((e) => e.rule === 'exit' && /забирає грузовий/.test(e.text))).toBe(true)
  })

  it('контейнер — до грузового (якщо є), інакше — у гараж зі щитом у даху', () => {
    expect(regroup([{ items: { OrnithopterTransport: 1, ContainerVehicle: 1, Buggy: 1 } }], 'type', 'all')).toEqual([
      { kind: 'air', items: { OrnithopterTransport: 1, ContainerVehicle: 1 }, portals: 2, roof: false },
      { kind: 'ground', items: { Buggy: 1 }, portals: 1, roof: false },
    ])
    expect(regroup([{ items: { ContainerVehicle: 1, Buggy: 1 } }], 'type', 'all')).toEqual([{ kind: 'ground', items: { Buggy: 1, ContainerVehicle: 1 }, portals: 1, roof: true }])
  })

  it('грузовий — прямо між порталами ≥ 9 × 6, ангар 6 заввишки, колона посеред межі ділянок', () => {
    const g = generateBase({ cells: SHAPES['лінія 3'], bays: [{ kind: 'air', items: { OrnithopterTransport: 1 }, portals: 2 }], seed: 1 })
    const c = g.doc.items.find((it) => it.type === 'OrnithopterTransport')
    const shields = g.doc.pieces.filter((p) => p.shape === 'Choam_PentashieldSurfaceVertical_Placeable' && p.z >= 4)
    // 2 боки × прорізи 9 і 8 × 6 рядів
    expect(shields).toHaveLength(2 * (9 + 8) * 6)
    // портали лежать поперек осі грузового
    for (const p of shields) expect(Math.abs(Math.cos(((p.rot - c.ang) * Math.PI) / 180))).toBeLessThan(1e-6)
    expect(g.doc.pieces.some((p) => /_Pillar_/.test(p.shape) && p.z >= 4)).toBe(true)
  })
})

describe('правила ловлять порушення', () => {
  // простий стиль і базові станції (без великого переробника): тераса — голий дах (без веж, корон і зубців)
  const ok = () => generateBase({ cells: SHAPES['лінія 3'], style: { preset: 'plain' }, stations: STATION_SETS.basic, seed: 1 }).doc
  const clone = (d) => JSON.parse(JSON.stringify(d))
  const fails = (doc, rule) => rules(doc, ENGINE).errors.filter((e) => e.rule === rule)

  it('орні на відкритій терасі — надворі', () => {
    const d = clone(ok())
    const orni = d.items.find((it) => it.kind === 'air')
    // на терасу (ділянка без верхнього модуля): шукаємо дах-плиту на висоті 4 без нічого над нею
    const roof = d.pieces.find((p) => p.shape === 'Sardaukar_Rooftop_01' && p.z === 4 && !d.pieces.some((q) => q !== p && Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6 && q.z > 4))
    Object.assign(orni, { c: { x: roof.x, y: roof.y }, z: 4 })
    expect(fails(d, 'shelter').length).toBeGreaterThan(0)
  })

  it('перед порталами орні колони — смуги вильоту нема; перед одним — попередження', () => {
    const d = clone(ok())
    const air = d.zones.find((z) => z.name === 'Ангар орні')
    const zp = air.z + 1
    // колони за 3 від середини кожного щита другого ряду, з обох боків площини (усередині ангара — не заважають)
    const block = (list) => { for (const p of list) for (const sg of [1, -1]) { const t = (p.rot * Math.PI) / 180; d.pieces.push({ id: 'x' + d.pieces.length, shape: 'Sardaukar_Pillar_Middle', x: p.x - Math.sin(t) * 3 * sg, y: p.y + Math.cos(t) * 3 * sg, z: zp }) } }
    const shields = d.pieces.filter((p) => p.shape === 'Choam_PentashieldSurfaceVertical_Placeable' && p.z === zp)
    const planes = [...new Set(shields.map((p) => p.rot + '|' + Math.round(p.rot === 90 || p.rot === -90 ? p.x : p.y)))]
    expect(planes.length).toBe(2)
    block(shields.filter((p) => (p.rot + '|' + Math.round(p.rot === 90 || p.rot === -90 ? p.x : p.y)) === planes[0]))
    expect(fails(d, 'exit')).toEqual([])
    expect(rules(d, ENGINE).warnings.filter((w) => w.rule === 'exit').length).toBeGreaterThan(0)
    block(shields)
    expect(fails(d, 'exit').length).toBeGreaterThan(0)
  })

  it('піскоцикл посеред гаража без порталу — нема виходу', () => {
    const d = clone(ok())
    d.pieces = d.pieces.map((p) => (p.shape === 'Choam_PentashieldSurfaceVertical_Placeable' && p.z < 3 ? { ...p, shape: 'Sardaukar_Wall_01' } : p))
    expect(fails(d, 'exit').length).toBeGreaterThan(0)
  })

  it('пентащит з вищербиною — не прямокутник', () => {
    const d = clone(ok())
    const i = d.pieces.findIndex((p) => p.shape === 'Choam_PentashieldSurfaceVertical_Placeable' && p.z === 1)
    d.pieces[i] = { ...d.pieces[i], shape: 'Sardaukar_Wall_01' }
    expect(fails(d, 'shield').length).toBeGreaterThan(0)
  })

  it('кутові сходи, трикутні скати, плита-перекриття під небом, драбина без стіни', () => {
    const d = clone(ok())
    d.pieces.push({ id: 'x1', shape: 'Sardaukar_Stairs_Corner', x: 0.5, y: 0.5, z: 0, rot: 0 })
    d.pieces.push({ id: 'x2', shape: 'Sardaukar_Roof_Wedge_Bottom', x: 50, y: 50, z: 9, rot: 0 })
    const roof = d.pieces.find((p) => p.shape === 'Sardaukar_Rooftop_01')
    roof.shape = 'Sardaukar_Floor_02'
    d.pieces.push({ id: 'x3', shape: 'Choam_Level2_Ladder', x: 99.5, y: 99, z: 0, rot: 0 })
    expect(fails(d, 'stairs').length).toBeGreaterThan(0)
    expect(fails(d, 'slopes').length).toBeGreaterThan(0)
    expect(fails(d, 'roofs').length).toBeGreaterThan(0)
  })

  it('деталь у повітрі — нестабільна; станції одна в одній', () => {
    const d = clone(ok())
    d.pieces.push({ id: 'fly', shape: 'Sardaukar_Floor_02', x: 15.5, y: 5.5, z: 20, rot: 0 })
    d.items.push({ ...d.items[0], c: { ...d.items[0].c } })
    expect(fails(d, 'stability').length).toBeGreaterThan(0)
    expect(fails(d, 'stations').length).toBeGreaterThan(0)
  })

  it('два грузових в одному ангарі', () => {
    const d = clone(generateBase({ cells: SHAPES['лінія 3'], carrier: true, scout: 0, assault: 0, seed: 1 }).doc)
    const c = d.items.find((it) => it.type === 'OrnithopterTransport')
    d.items.push({ ...c, c: { ...c.c } })
    expect(fails(d, 'carrier').length).toBeGreaterThan(0)
  })
})

describe('POST /api/bases/generate', () => {
  let server, base, dir, app, db
  const mail = []
  const codeFor = (email) => [...mail].reverse().find((m) => m.to === email.trim().toLowerCase())?.text.match(/\b\d{6}\b/)?.[0]
  function agent() {
    let cookie = ''
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
      const set = r.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
      return { status: r.status, body: await r.json().catch(() => null) }
    }
    const a = {
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      async signIn(email) { await a.post('/api/auth/code', { email }); return a.post('/api/auth/verify', { email, code: codeFor(email) }) },
    }
    return a
  }
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-basegen-'))
    db = await openDb({ dataDir: dir })
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(async () => {
    server?.close()
    await app?.locals.close()
    await db?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const admin = agent(), bob = agent(), anon = agent()

  it('без входу — 401', async () => {
    expect((await anon.post('/api/bases/generate', { params: {} })).status).toBe(401)
  })

  it('людина генерує базу: її власна, приватна, версія 1, з примітки видно, що згенеровано', async () => {
    await admin.signIn('admin@example.com')
    await bob.signIn('bob@example.com')
    const r = await bob.post('/api/bases/generate', { params: { cells: [[0, 0], [1, 0], [2, 0]], name: 'Моя застава', seed: 2 } })
    expect(r.status).toBe(201)
    expect(r.body.version).toBe(1)
    expect(r.body.note).toBe('Згенеровано генератором баз')
    expect(r.body.doc.format).toBe(2)
    expect(r.body.doc.ui.name).toBe('Моя застава')
    expect(r.body.item.visibility).toBe('private')
    expect(r.body.item.owner).toMatchObject({ kind: 'user' })
    // чужим не видно
    expect((await anon.get(`/api/bases/${r.body.id}`)).status).toBe(404)
    expect((await bob.get(`/api/bases/${r.body.id}`)).status).toBe(200)
  })

  it('неможливий план — 400 з причиною; хибні ділянки — 400', async () => {
    const r = await bob.post('/api/bases/generate', { params: { cells: [[0, 0]], bays: [{ kind: 'air', items: { OrnithopterTransport: 1 }, portals: 2 }] } })
    expect(r.status).toBe(400)
    expect(r.body.errors[0].code).toBe('orni')
    expect((await bob.post('/api/bases/generate', { params: { cells: [[0, 0], [5, 5]] } })).status).toBe(400)
  })
})

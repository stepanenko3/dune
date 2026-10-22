// Енергобаланс калькулятора бази: потужність пристроїв — з довідника гри (CPlace.power), а не лише з рецептів моделі.
// Раніше вітряки й генератор головної бази (без recipe) давали 0 — «0 є · 672 треба». Тут — справжні бази з data/bases
// і потужності з довідника (значення як у грі: спрямований вітряк +350, паливний генератор +75, переробники — мінус).
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { energyOf, fuelGens, modelsOf } from './power'

/* eslint-disable @typescript-eslint/no-explicit-any */
const require = createRequire(import.meta.url)
const root = path.resolve(__dirname, '../../..')
const BD = require(path.join(root, 'src/engine/hydrate.js'))
require(path.join(root, 'src/engine/build.js'))
const BUILD = (globalThis as any).BUILD

/** потужність пристроїв довідника (як у catalog.json) */
const POWER: Record<string, number> = {
  WindTurbineDirectional_Placeable: 350, WindTurbineOmnidirectional_Placeable: 150, Generator_Placeable: 75, SpiceGenerator_Placeable: 1000,
  LargeWindtrap_Placeable: -135, LargeOreRefinery_Placeable: -350, MediumOreRefinery_Placeable: -45, LargeSpiceRefinery_Placeable: -500,
  MediumChemicalRefinery_Placeable: -350, Fremen_Deathstill_Placeable: -200, RepairStation_Placeable: -20, Recycler_Placeable: -15,
  SurvivalFabricator_Placeable: -40, WeaponsFabricator_Placeable: -40, WearablesFabricator_Placeable: -40, VehiclesFabricator_Placeable: -40,
  Fabricator_Placeable: -10, Totem_Small_Placeable: -15, Totem_Placeable: -15,
}

/** цілі калькулятора за моделлю (як BaseCalc без правок): рядки пристроїв у кількості моделі */
function setup(file: string) {
  const M = BD.hydrate(require(path.join(root, 'data/bases', file)))
  const B = BUILD.make(M)
  const c = B.cost(B.compute())
  const models = modelsOf(M, B.CAT)
  const targets = [
    ...c.devices.map((x: any) => ({ kind: 'custom' as const, id: 'dev:' + x.id, qty: x.n })),
    ...[...models].filter(([id]) => id.startsWith('pl:')).map(([id, list]) => ({ kind: 'custom' as const, id, qty: list.length })),
  ]
  return { c, models, targets }
}
const run = (s: ReturnType<typeof setup>, catalog = true) =>
  energyOf({ targets: s.targets, models: s.models, devices: s.c.devices, shieldDraw: s.c.shieldDraw, power: (id) => (catalog ? POWER[id] : undefined) })

describe('енергобаланс бази', () => {
  it('головна: 20 спрямованих вітряків і генератор дають енергію; переробники й вітропастки — беруть', () => {
    const s = setup('main.json')
    const e = run(s)
    expect(e.gives).toBe(20 * 350 + 75)
    // 15 великих вітропасток, 3 великі й 1 середній переробник руди, 2 великі спайсу, хімічний, дистилятор, фабрикатори…
    expect(e.takes).toBeGreaterThan(15 * 135 + 3 * 350 + 2 * 500)
    expect(e.takes).toBeGreaterThan(s.c.shieldDraw)
    // паливо — на паливний генератор головної (він без рецепта)
    expect(fuelGens(s.targets, s.models)).toBe(1)
  })
  it('DD: генератори з рецептом, правка кількості в калькуляторі змінює енергію пропорційно', () => {
    const s = setup('dd.json')
    expect(run(s).gives).toBe(5 * 75)
    s.targets = s.targets.map((x) => (x.id === 'dev:generator' ? { ...x, qty: 2 } : x))
    expect(run(s).gives).toBe(2 * 75)
    expect(fuelGens(s.targets, s.models)).toBe(2)
    // будівля, додана з довідника, теж рахується
    s.targets.push({ kind: 'build' as any, id: 'WindTurbineDirectional_Placeable', qty: 1 })
    expect(run(s).gives).toBe(2 * 75 + 350)
  })
  it('без довідника — потужність із рецептів моделі (як було)', () => {
    const s = setup('dd.json')
    const e = run(s, false)
    expect(e.gives).toBe(5 * 75)
    expect(e.takes).toBe(10 + 20 + s.c.shieldDraw)
  })
})

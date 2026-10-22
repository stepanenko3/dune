// Нормалізація рецептів: входи нижчої якості, вихід, вода, станції через типи виробництва; невипущене — за предметами.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rowsOf } from '../normalize/common.mjs'
import { normalizeRecipes } from '../normalize/recipes.mjs'

const fx = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))
const items = [
  { id: 'AluminiumBar', name: 'Aluminum Ingot', released: true },
  { id: 'BauxiteOre', name: 'Bauxite Ore', released: true },
  { id: 'Buggy', name: 'Sand Bike', released: true },
  { id: 'OldTank', name: 'Old Tank', released: false },
]
const r = Object.fromEntries(normalizeRecipes(rowsOf(fx('recipes.json')), { items, stations: fx('stations.json') }).map((x) => [x.id, x]))

describe('рецепти', () => {
  it('злиток: якість 0, без ключа None; станція за типом виробництва', () => {
    expect(r.AluminiumBarRecipe).toEqual({ id: 'AluminiumBarRecipe', name: 'Aluminum Ingot', time: 30, water: 150, at: ['MediumOreRefinery_Placeable'], in: [['BauxiteOre', 7]], out: [['AluminiumBar', 1]], released: true })
  })
  it('станції — усі пристрої з цим типом, за абеткою; без води — 0, як у каталозі', () => {
    expect(r.BuggyRecipe).toMatchObject({ at: ['Advanced_VehiclesFabricator_Placeable', 'VehiclesFabricator_Placeable'], water: 0, name: 'Sand Bike' })
  })
  it('Personal — без станції; вода з WaterOutcome; без виходу — без назви', () => {
    expect(r.WaterRecipe).toMatchObject({ at: [], water: 250, out: [], name: null })
  })
  it('вихід — невипущений предмет → невипущений рецепт', () => {
    expect(r.OldTankRecipe.released).toBe(false)
  })
})

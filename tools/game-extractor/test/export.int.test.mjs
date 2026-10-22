// Експортер (Docker-образ sandwalkers/gd-export:2) на справжніх паках сервера. Лише з GD_INT=1 і наявними паками в
// GD_WORK (за замовчуванням …/DuneAwakening/gamefiles) — звичайний npm test його пропускає.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const WORK = process.env.GD_WORK || '/Users/stepanenko/Sites/DuneAwakening/gamefiles'
const PAKS = path.join(WORK, 'extract/rootfs/home/dune/server/DuneSandbox/Content/Paks')
const USMAP = path.join(WORK, 'mappings/DuneSandbox-2160922.usmap')
const on = process.env.GD_INT === '1' && fs.existsSync(PAKS) && fs.existsSync(USMAP)

describe.skipIf(!on)('експортер CUE4Parse', () => {
  let out
  const gdx = (...args) => execFileSync('docker', ['run', '--rm', '-v', `${PAKS}:/paks:ro`, '-v', `${USMAP}:/map.usmap:ro`, '-v', `${out}:/out`, 'sandwalkers/gd-export:2', ...args], { stdio: 'pipe', maxBuffer: 1 << 26 })
  const rows = (name) => {
    const d = JSON.parse(fs.readFileSync(path.join(out, 'tables', name + '.json'), 'utf8'))
    return Object.assign({}, ...d.filter((e) => e.Rows).map((e) => e.Rows))
  }
  beforeAll(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-export-'))
    gdx('tables', 'DuneSandbox/Content/Dune/Systems/Items/CDT_BaseItems', 'DuneSandbox/Content/Dune/Systems/Crafting/DT_ItemsCraftingRecipes')
    gdx('locres')
    gdx('stations', 'DuneSandbox/Content/Dune/Systems/Building/Data/CDT_PlaceableData')
  }, 600_000)
  afterAll(() => fs.rmSync(out, { recursive: true, force: true }))

  it('предмети: англійська назва з таблиці', () => {
    expect(rows('CDT_BaseItems').AluminiumBar.StaticData.Name.SourceString).toBe('Aluminum Ingot')
  })
  it('рецепти: мапа виходу з ключем-структурою не порожня', () => {
    const out = rows('DT_ItemsCraftingRecipes').AluminiumBarRecipe.Recipe.Outcome
    expect(Array.isArray(out) && out.length).toBeTruthy()
    expect(JSON.stringify(out)).toContain('AluminiumBar')
  })
  it('переклади: 14 мов, простори імен таблиць рядків', () => {
    expect(fs.readdirSync(path.join(out, 'loc')).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr', 'uk', 'zh-Hans', 'zh-Hant'].map((l) => l + '.json').sort())
    expect(JSON.parse(fs.readFileSync(path.join(out, 'loc', 'uk.json'), 'utf8'))).toHaveProperty('ST_Localization_Items')
  })
  it('станції: тип виробництва з компонента крафту BP (з батьківськими класами)', () => {
    const st = JSON.parse(fs.readFileSync(path.join(out, 'stations.json'), 'utf8'))
    expect(st.VehiclesFabricator_Placeable).toContain('VehicleFabricator')
  })
})

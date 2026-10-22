// Нормалізація предметів і пристроїв: поля в формі каталогу сайту, невипущене — released:false.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { iconPath, rowsOf } from '../normalize/common.mjs'
import { normalizeItems } from '../normalize/items.mjs'
import { normalizePlaceables } from '../normalize/placeables.mjs'

const fx = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'))
const byId = (rs) => Object.fromEntries(rs.map((r) => [r.id, r]))

describe('предмети', () => {
  const it_ = byId(normalizeItems(rowsOf(fx('items.json'))))

  it('злиток: назва, іконка, грейд, вид, стек, об’єм', () => {
    expect(it_.AluminiumBar).toEqual({
      id: 'AluminiumBar', name: 'Aluminum Ingot', icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Items/Resources/T_UI_IconResourceAluminiumBar_D',
      grade: 4, cat: 'misc', sub: null, kind: 'RefinedResources', rarity: null, stack: 500, volume: 0.7, released: true,
    })
  })
  it('одяг: категорія й підкатегорія з тегу, рідкість', () => {
    expect(it_.Combat_Light_Unique_Stamina_Bottom_04).toMatchObject({ cat: 'garment', sub: 'light_armor', rarity: 'Rare', grade: 4 })
  })
  it('ракетниця: weapon / rocket_launcher; об’єм з перевизначення; без іконки — null', () => {
    expect(it_.HarkRocketLauncher).toMatchObject({ cat: 'weapon', sub: 'rocket_launcher', volume: 2.5, icon: null })
  })
  it('зброя-нагорода з тегом контракту — зброя; лише контракт — контракт', async () => {
    const { categoryOf } = await import('../normalize/items.mjs')
    expect(categoryOf(['Items.Contract', 'Items.Holsters.MeleeWeapons.Sword'])).toEqual(['weapon', 'melee'])
    expect(categoryOf(['Items.ExcludeFromExchange', 'Items.Contract'])).toEqual(['contract', 'contract'])
  })
  it('невипущене: застаріле і «назва = id»', () => {
    expect(it_.OldThing.released).toBe(false)
    expect(it_.Kindjal.released).toBe(false)
  })
})

describe('пристрої', () => {
  const p = byId(normalizePlaceables(rowsOf(fx('placeables.json'))))
  it('переробник: група, тір, енергія; нуль води — null', () => {
    expect(p.MediumOreRefinery_Placeable).toEqual({
      id: 'MediumOreRefinery_Placeable', name: 'Medium Ore Refinery', icon: 'assets/Dune/GUI/Textures/Icons/Gameplay/Placeables/T_UI_IconPlacChoamOreRefinery01_D',
      grade: 1, cat: 'orerefinery', sub: 'tier1', power: -45, water: null, waterRate: null, released: true,
    })
  })
  it('вітропастка: вода й темп', () => {
    expect(p.Windtrap_Placeable).toMatchObject({ grade: 3, power: null, water: 1500, waterRate: 10 })
  })
  it('XX_ — невипущене', () => { expect(p.XX_Test_Placeable.released).toBe(false) })
})

describe('спільне', () => {
  it('шлях іконки', () => {
    expect(iconPath({ AssetPathName: '/Game/Dune/A/T_X_D.T_X_D' })).toBe('assets/Dune/A/T_X_D')
    expect(iconPath({ AssetPathName: 'None' })).toBeNull()
    expect(iconPath(null)).toBeNull()
  })
})

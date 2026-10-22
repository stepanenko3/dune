// Нормалізація будівельних модулів: набір, група як на сайті, здоров'я й ціна з групи/тіру; невипущене — за списком,
// набором і фракцією. Пристрої з наборів — теж модулі (ціна будівництва фабрикатора тощо).
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rowsOf } from '../normalize/common.mjs'
import { normalizeBuildables } from '../normalize/buildables.mjs'

const fx = (f) => rowsOf(JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')))
const placeables = { Fabricator_Placeable: { m_BuildableGroupType: { Name: 'Fabricator' }, m_BuildableTier: { Name: 'Tier2' }, m_DisplayName: { SourceString: 'Fabricator' }, m_BuildableIcon: { AssetPathName: '/Game/Dune/P/T_UI_Fab_D.T_UI_Fab_D' } } }
const b = Object.fromEntries(normalizeBuildables({ building: fx('building.json'), placeables, group: fx('group.json'), sets: fx('sets.json'), subcat: fx('subcat.json') }).map((x) => [x.id, x]))

describe('будівельні модулі', () => {
  it('центральна колона: набір, група structural, здоров’я, ціна за абеткою', () => {
    expect(b.Col_Center).toEqual({
      id: 'Col_Center', set: 'MTX_Neut_DesertMechanicSet1_Patent', group: 'structural', name: 'Center Column', img: 'assets/DLC/MTX/GUI/T_UI_Col_D',
      health: 7000, cost: [['Plastone', 2], ['Stone', 10]], released: true,
    })
  })
  it('кутова з тією самою іконкою — своє здоров’я', () => {
    expect(b.Col_Corner).toMatchObject({ img: b.Col_Center.img, health: 5600, cost: [['Stone', 8]] })
  })
  it('Blockout і прихований поза наборами — невипущені', () => {
    expect(b.Block_Wall).toMatchObject({ group: 'wall', released: false })
    expect(b.Hidden_Foundation).toMatchObject({ set: null, released: false })
  })
  it('пристрій із набору — модуль групи fabricator з ціною', () => {
    expect(b.Fabricator_Placeable).toMatchObject({ set: 'FabricatorsSet', group: 'fabricator', health: 3000, cost: [['CopperBar', 30]], released: true })
  })
})

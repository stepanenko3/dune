// Драйвер-виняток TH.GL (мапа, точки, розкладки ГП, картинки) — один сайт.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createThglDriver } from './lib/gamedata/drivers/thgl.mjs'

const SOURCE = {
  syncedAt: '2026-10-03T00:00:00.000Z',
  maps: [
    { id: 'survival_1', title: 'Hagga Basin', tiles: 'survival_1-0c70', bounds: [[0, 0], [1, 1]], transformation: [1, 0, 1, 0], nodes: 'survival_1.3b20.raw', layout: null, layouts: [] },
    { id: 'deepdesert_1', title: 'Deep Desert', tiles: 'deepdesert_1-aa', bounds: [[0, 0], [1, 1]], transformation: [1, 0, 1, 0], nodes: 'deepdesert_1.11.raw', layout: 11, layouts: ['layout_00', 'layout_11'] },
  ],
  groups: [{ id: 'locations', types: [{ id: 'cave' }] }, { id: 'resources', types: [{ id: 'azurite' }] }, { id: 'resources_pickup', types: [{ id: 'azurite_pickup' }] }],
}
/** розібрані точки мапи (thgl.mjs raw): тип → { pts: [x, y, z…], ids } */
const RAW = {
  survival_1: { cave: { pts: [10, 20, 3, 10, 20, 4], ids: [0, 'wrath@20:10'] }, azurite: { pts: [5, 6, 0], ids: [] }, azurite_pickup: { pts: [7, 8, 0], ids: [] } },
  deepdesert_1: { cave: { pts: [1, 2, 0], ids: [] } },
}

describe('драйвери-винятки', () => {
  let dir, thgl
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-gdx-'))
    fs.writeFileSync(path.join(dir, 'icons.webp'), 'sprite')
    thgl = createThglDriver({ mapData: { source: SOURCE, dir, raw: async (map) => RAW[map] } })
  })
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('TH.GL: мапа, точки, розкладки, картинки; одна назва сайту', async () => {
    expect(thgl.sections()).toEqual(['maps', 'markers', 'markerTypes', 'ddLayouts', 'resources', 'images'])
    expect(thgl.describe('markers')).toEqual({ id: 'thgl', names: ['TH.GL'] })
    expect(thgl.describe('items')).toBeNull()
    // точки — записами з ключем «мапа@x:y» (порівнюються з файлами гри за місцем); ресурси — окремим розділом
    expect((await thgl.load('markers')).data.records).toEqual([
      { id: 'survival_1@10:20', map: 'survival_1', type: 'cave', x: 10, y: 20, z: 3 },
      { id: 'survival_1@10:20#2', map: 'survival_1', type: 'cave', x: 10, y: 20, z: 4 },
      { id: 'deepdesert_1@1:2', map: 'deepdesert_1', layout: 11, type: 'cave', x: 1, y: 2, z: 0 },
    ])
    expect((await thgl.load('resources')).data.records.map((r) => r.id + ' ' + r.type)).toEqual(['survival_1@5:6 azurite', 'survival_1@7:8 azurite_pickup'])
    expect((await thgl.load('markerTypes')).data.records).toEqual([{ id: 'cave', group: 'locations' }, { id: 'azurite', group: 'resources' }, { id: 'azurite_pickup', group: 'resources_pickup' }])
    expect((await thgl.load('maps')).data.blob[0]).toEqual({ id: 'survival_1', title: 'Hagga Basin', bounds: [[0, 0], [1, 1]], transformation: [1, 0, 1, 0] })
    expect((await thgl.load('ddLayouts')).data.blob).toEqual({ layout: 11, layouts: ['layout_00', 'layout_11'] })
    const img = (await thgl.load('images')).data.blob
    expect(img.tiles).toEqual(['survival_1-0c70', 'deepdesert_1-aa'])
    expect(img.icons).toMatch(/^[0-9a-f]{64}$/)
    await expect(thgl.load('items')).rejects.toThrow('нема')
  })

  it('відбиток вмісту точок — імена файлів точок мап і поточна розкладка ГП (дешево, без розбору точок)', async () => {
    const v = await thgl.contentVersion('markers')
    expect(v).toMatch(/^[0-9a-f]{16}$/)
    expect(await thgl.contentVersion('resources')).toBe(v)
    const other = createThglDriver({ mapData: { source: { ...SOURCE, maps: SOURCE.maps.map((m) => (m.id === 'deepdesert_1' ? { ...m, layout: 2 } : m)) }, dir, raw: async () => ({}) } })
    expect(await other.contentVersion('markers')).not.toBe(v)
    expect(await thgl.contentVersion('maps')).toBeNull()
  })

  it('мапи ще нема — збій розділу', async () => {
    const empty = createThglDriver({ mapData: { source: null, dir } })
    await expect(empty.load('maps')).rejects.toThrow('мапу ще не отримано')
  })
})

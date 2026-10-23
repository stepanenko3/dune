// Драйвер «файли гри»: читає пакет видобувача (latest.json → маніфест → розділи); зламаний розділ не віддає; без пакета —
// порожньо (на живому без GAMEDATA_BUNDLE_DIR нічого не робить).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { beforeEach, describe, expect, it } from 'vitest'
import { createGamefilesDriver } from './lib/gamedata/drivers/gamefiles.mjs'

function bundle(dir, { build = '7', dirInLatest } = {}) {
  const b = path.join(dir, build)
  fs.mkdirSync(path.join(b, 'sections'), { recursive: true })
  const put = (id, data) => fs.writeFileSync(path.join(b, 'sections', id + '.json.gz'), zlib.gzipSync(JSON.stringify(data)))
  put('items', { records: [{ id: 'AluminiumBar', name: 'Aluminum Ingot', released: true }] })
  put('texts', { records: [{ id: 'item:AluminiumBar:uk', name: 'Алюмінієвий злиток', description: null }] })
  fs.writeFileSync(path.join(b, 'manifest.json'), JSON.stringify({
    schema: 1, game: { build, version: '1.5.15', manifestId: 'm1', depot: '4754532' }, extractedAt: '2026-10-21T13:53:28.867Z', extractor: { version: '1' },
    sections: { items: { file: 'sections/items.json.gz', schema: 1, hash: 'h1', count: 1 }, texts: { file: 'sections/texts.json.gz', schema: 1, hash: 'h2', count: 1 }, recipes: { error: '10 < 500' } },
  }))
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ build, dir: dirInLatest ?? b }))
}

describe('драйвер «файли гри»', () => {
  let dir
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-gf-')) })

  it('без пакета — порожньо, probe null', async () => {
    const d = createGamefilesDriver({ dir })
    expect(d).toMatchObject({ id: 'gamefiles', label: 'файли гри', applies: true })
    expect(d.sections()).toEqual([])
    expect(await d.probe()).toBeNull()
    expect(createGamefilesDriver({ dir: null }).sections()).toEqual([])
  })

  it('розділи маніфесту без помилок; дані; збірка', async () => {
    bundle(dir)
    const d = createGamefilesDriver({ dir })
    expect(d.sections().sort()).toEqual(['items', 'texts'])
    expect((await d.load('items')).data.records[0].id).toBe('AluminiumBar')
    expect((await d.load('items')).version).toBe('7')
    await expect(d.load('recipes')).rejects.toThrow('10 < 500')
    // відбиток вмісту — збірка й хеш розділу з маніфесту (без читання розділу)
    expect(await d.contentVersion('items')).toBe('7:h1')
    expect(await d.contentVersion('recipes')).toBeNull()
    expect(await d.probe()).toEqual({ version: '7', build: '7', gameVersion: '1.5.15', manifestId: 'm1', extractedAt: '2026-10-21T13:53:28.867Z' })
  })

  it('пакет перенесли (dir у latest.json не існує) — береться <dir>/<збірка>', async () => {
    bundle(dir, { dirInLatest: '/nowhere/7' })
    expect(createGamefilesDriver({ dir }).sections()).toContain('items')
  })

  it('опис джерела: файли гри зі збіркою й версією гри', () => {
    bundle(dir)
    const d = createGamefilesDriver({ dir })
    expect(d.describe('items')).toEqual({ id: 'gamefiles', names: [], build: '7', version: '1.5.15' })
    expect(createGamefilesDriver({ dir: null }).describe('items')).toBeNull()
  })
})

describe('драйвер «файли гри»: розділ з файлами (ресурси ГП)', () => {
  it('дані — перелік розкладок; файл розкладки — files(розкладка), поза хешем розділу', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-gf-dd-'))
    const b = path.join(dir, '7')
    fs.mkdirSync(path.join(b, 'sections'), { recursive: true })
    const gz = zlib.gzipSync(JSON.stringify({ types: { TitaniumOre: { kind: 'core', pts: [1, 2, 3, 40] } } }))
    fs.writeFileSync(path.join(b, 'sections', 'ddResources-11.json.gz'), gz)
    const idx = { blob: { layouts: { 11: { count: 1, hash: 'h11', file: 'sections/ddResources-11.json.gz' } } } }
    fs.writeFileSync(path.join(b, 'sections', 'ddResources.json.gz'), zlib.gzipSync(JSON.stringify(idx)))
    fs.writeFileSync(path.join(b, 'manifest.json'), JSON.stringify({ schema: 1, game: { build: '7' }, sections: { ddResources: { file: 'sections/ddResources.json.gz', schema: 1, hash: 'hd', count: 1 } } }))
    fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify({ build: '7', dir: b }))
    const { data } = await createGamefilesDriver({ dir }).load('ddResources')
    expect(data).toEqual(idx)
    expect(Object.keys(data)).toEqual(['blob'])
    expect(data.files('11')).toEqual(gz)
    // читач — лише в розділу з файлами (розклад ГП теж має layouts, але файлів у нього нема)
    fs.writeFileSync(path.join(b, 'sections', 'ddLayouts.json.gz'), zlib.gzipSync(JSON.stringify({ blob: { layouts: [0, 11] } })))
    const m = JSON.parse(fs.readFileSync(path.join(b, 'manifest.json'), 'utf8'))
    m.sections.ddLayouts = { file: 'sections/ddLayouts.json.gz', schema: 1, hash: 'hl', count: 1 }
    fs.writeFileSync(path.join(b, 'manifest.json'), JSON.stringify(m))
    expect((await createGamefilesDriver({ dir }).load('ddLayouts')).data.files).toBeUndefined()
  })
})

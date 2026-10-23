// Пакет розділів: маніфест із хешами (ті самі, що рахує реєстр сайту), зламаний розділ не блокує інші, запис атомарний,
// старі збірки прибираються.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prune, writeBundle } from '../lib/bundle.mjs'
import { sectionHash } from '../../../server/lib/gamedata/hash.mjs'

const recs = (n, extra = {}) => ({ records: Array.from({ length: n }, (_, i) => ({ id: 'r' + i, released: true, ...extra })) })
const LANGS = ['de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr', 'uk', 'zh-Hans', 'zh-Hant']
const texts = (per = 1100, over = {}) => ({ records: LANGS.flatMap((l) => Array.from({ length: over[l] ?? per }, (_, i) => ({ id: `item:i${i}:${l}`, name: 'x' }))) })
const config = () => ({ blob: { spice: { maps: { DeepDesert_1: { Small: { primed: 60, active: 60 } } } }, coriolis: { cycleDays: 7, seeds: [3, 4] } } })
const good = () => ({
  items: recs(1200), placeables: recs(600), recipes: recs(600), buildables: recs(400), texts: texts(), config: config(),
})
const meta = { build: '7', version: '1.5.15', manifestId: 'm1', extractor: { version: '1' } }

describe('пакет', () => {
  let work
  beforeEach(() => { work = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-bundle-')) })
  afterEach(() => vi.restoreAllMocks())
  const manifest = (b = '7') => JSON.parse(fs.readFileSync(path.join(work, 'bundles', b, 'manifest.json'), 'utf8'))

  it('маніфест: гра, розділи з хешем реєстру й лічильником; latest.json', async () => {
    const s = good()
    const dir = await writeBundle({ work, ...meta, sections: s })
    expect(dir).toBe(path.join(work, 'bundles', '7'))
    const m = manifest()
    expect(m).toMatchObject({ schema: 1, game: { build: '7', version: '1.5.15', manifestId: 'm1', depot: '4754532' }, extractor: { version: '1' } })
    expect(m.sections.items).toEqual({ file: 'sections/items.json.gz', schema: 1, hash: sectionHash(s.items), count: 1200 })
    expect(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'sections/items.json.gz')))).records).toHaveLength(1200)
    expect(JSON.parse(fs.readFileSync(path.join(work, 'bundles', 'latest.json'), 'utf8'))).toEqual({ build: '7', dir })
  })

  it('рецептів замало — розділ з помилкою, решта в пакеті', async () => {
    await writeBundle({ work, ...meta, sections: { ...good(), recipes: recs(10) } })
    const m = manifest()
    expect(m.sections.recipes).toEqual({ error: '10 < 500' })
    expect(fs.existsSync(path.join(work, 'bundles/7/sections/recipes.json.gz'))).toBe(false)
    expect(m.sections.items.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('умінь замало (зламаний експорт дерева) — розділ з помилкою', async () => {
    await writeBundle({ work, ...meta, sections: { ...good(), skills: recs(12) } })
    expect(manifest().sections.skills).toEqual({ error: '12 < 80' })
  })

  it('збій нормалізатора розділу — помилка в маніфесті', async () => {
    await writeBundle({ work, ...meta, sections: { ...good(), buildables: new Error('нема таблиці') } })
    expect(manifest().sections.buildables).toEqual({ error: 'нема таблиці' })
  })

  it('розділ з файлами (ресурси ГП): кожен файл розкладки — поруч, у переліку — шлях файлу; хеш розділу — з переліку', async () => {
    const gz = zlib.gzipSync(JSON.stringify({ types: { TitaniumOre: { kind: 'core', pts: [1, 2, 3, 40] } } }))
    await writeBundle({ work, ...meta, sections: { ...good(), ddResources: { blob: { layouts: { 11: { count: 1, hash: 'h11' } } }, files: { 11: gz } } } })
    const m = manifest()
    const idx = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(work, 'bundles', '7', m.sections.ddResources.file))))
    expect(idx).toEqual({ blob: { layouts: { 11: { count: 1, hash: 'h11', file: 'sections/ddResources-11.json.gz' } } } })
    expect(m.sections.ddResources.hash).toBe(sectionHash(idx))
    expect(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(work, 'bundles', '7', 'sections', 'ddResources-11.json.gz')))).types.TitaniumOre.pts).toEqual([1, 2, 3, 40])
  })

  it('ресурси ГП без жодної розкладки — розділ з помилкою', async () => {
    await writeBundle({ work, ...meta, sections: { ...good(), ddResources: { blob: { layouts: {} }, files: {} } } })
    expect(manifest().sections.ddResources.error).toContain('розклад')
  })

  it('усі розділи зламані — пакета нема', async () => {
    const bad = Object.fromEntries(Object.keys(good()).map((k) => [k, new Error('x')]))
    await expect(writeBundle({ work, ...meta, sections: bad })).rejects.toThrow('пакет не складено')
    expect(fs.existsSync(path.join(work, 'bundles', '7'))).toBe(false)
    expect(fs.existsSync(path.join(work, 'bundles', 'latest.json'))).toBe(false)
  })

  it('ті самі дані — ті самі хеші', async () => {
    await writeBundle({ work, ...meta, sections: good() })
    const a = manifest().sections
    await writeBundle({ work, ...meta, sections: good() })
    const b = manifest().sections
    for (const k of Object.keys(a)) expect(b[k].hash).toBe(a[k].hash)
  })

  it('збій посеред запису — latest.json старий', async () => {
    await writeBundle({ work, ...meta, sections: good() })
    const real = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (String(to).endsWith('latest.json')) throw new Error('диск'); return real(from, to) })
    await expect(writeBundle({ work, ...meta, build: '8', sections: good() })).rejects.toThrow('диск')
    expect(JSON.parse(fs.readFileSync(path.join(work, 'bundles', 'latest.json'), 'utf8')).build).toBe('7')
  })

  it('prune: дві найновіші збірки + поточна', () => {
    for (const b of ['5', '6', '7', '8']) for (const d of ['bundles', 'raw', 'extract']) fs.mkdirSync(path.join(work, d, b), { recursive: true })
    fs.writeFileSync(path.join(work, 'bundles', 'latest.json'), JSON.stringify({ build: '5', dir: path.join(work, 'bundles', '5') }))
    prune(work, 2)
    for (const d of ['bundles', 'raw', 'extract']) expect(fs.readdirSync(path.join(work, d)).filter((x) => x !== 'latest.json').sort()).toEqual(['5', '7', '8'])
  })

  it('переклади: мова, що майже порожня, — помилка розділу з назвою мови', async () => {
    await writeBundle({ work, ...meta, sections: { ...good(), texts: texts(1100, { ko: 10 }) } })
    expect(manifest().sections.texts.error).toContain('ko')
  })

  it('налаштування: без мап меланжу чи сідів — помилка розділу', async () => {
    await writeBundle({ work, ...meta, sections: { ...good(), config: { blob: { spice: { maps: {} }, coriolis: { seeds: [], cycleDays: null } } } } })
    expect(manifest().sections.config.error).toBeTruthy()
  })

  it('prune прибирає недорозпаковані sha-* і недописані .tmp', () => {
    for (const d of ['extract/sha-aaa', 'extract/7', 'bundles/7', 'bundles/8.tmp']) fs.mkdirSync(path.join(work, d), { recursive: true })
    prune(work, 2)
    expect(fs.readdirSync(path.join(work, 'extract'))).toEqual(['7'])
    expect(fs.readdirSync(path.join(work, 'bundles'))).toEqual(['7'])
  })
})

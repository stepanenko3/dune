// «Що змінилось у патчі»: різниця пакетів двох збірок — нове (і вперше випущене), прибране, змінене (поле: було → стало),
// назви всіма мовами, мапа лише тим самим видобувачем; патч зберігається в базі й рахується раз. На тимчасовій SQLite.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './lib/sql.mjs'
import { computePatch, createPatches, diffMapCounts, diffSection, hasChanges, listBundles } from './lib/patches.mjs'

/** пакет у теці: <dir>/<збірка>/manifest.json + sections/*.json.gz */
function bundle(dir, build, sections, { code = 'c1', version = '1.0', extractedAt = new Date().toISOString() } = {}) {
  const root = path.join(dir, String(build))
  fs.mkdirSync(path.join(root, 'sections'), { recursive: true })
  const out = {}
  for (const [id, data] of Object.entries(sections)) {
    fs.writeFileSync(path.join(root, 'sections', id + '.json.gz'), zlib.gzipSync(JSON.stringify(data)))
    out[id] = { file: `sections/${id}.json.gz`, schema: 1, hash: id + build, count: data.records?.length ?? 1 }
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ schema: 1, game: { build: String(build), version }, extractedAt, extractor: { version: '1', code }, sections: out }))
}
const rec = (records) => ({ records })

describe('різниця розділу', () => {
  it('нове, вперше випущене, прибране, змінене; невипущене не рахується', () => {
    const a = [{ id: 'A', name: 'A', stack: 10 }, { id: 'B', name: 'B' }, { id: 'R', name: 'R', released: false }, { id: 'U', name: 'U', released: false }]
    const b = [{ id: 'A', name: 'A', stack: 20, released: true }, { id: 'C', name: 'C' }, { id: 'R', name: 'R', released: true }, { id: 'U', name: 'U', released: false }]
    const d = diffSection('items', a, b)
    expect(d.added.map((x) => x.id).sort()).toEqual(['C', 'R'])
    expect(d.removed.map((x) => x.id)).toEqual(['B'])
    expect(d.changed).toEqual([{ id: 'A', name: 'A', names: {}, fields: [['stack', 10, 20]] }])
  })

  it('складні значення — як є (сайт малює інгредієнти), однакові — не зміна', () => {
    const d = diffSection('recipes', [{ id: 'R', in: [['Ore', 7]], at: ['X'] }], [{ id: 'R', in: [['Ore', 8]], at: ['X'] }])
    expect(d.changed[0].fields).toEqual([['in', [['Ore', 7]], [['Ore', 8]]]])
  })

  it('уміння: ранги за ціною й бонусами, службові тексти рангів — не зміна', () => {
    const lv = (cost, perks) => ({ cost, bonuses: [], perks, buffs: [] })
    const d1 = diffSection('skills', [{ id: 'S', levels: [lv(2, ['a'])] }], [{ id: 'S', levels: [lv(2, ['b'])] }])
    expect(d1.changed).toEqual([])
    const d2 = diffSection('skills', [{ id: 'S', levels: [lv(2, [])] }], [{ id: 'S', levels: [lv(3, [])] }])
    expect(d2.changed[0].fields).toEqual([['levels', [{ cost: 2, bonuses: [] }], [{ cost: 3, bonuses: [] }]]])
  })

  it('опис: змінене вирішує англійська, тексти — усіма мовами; виправлений лише переклад — не зміна', () => {
    const t = (en, uk) => new Map([['item:A', { en: { name: 'A', description: en }, uk: { name: 'А', description: uk } }]])
    const d = diffSection('items', [{ id: 'A', name: 'A' }], [{ id: 'A', name: 'A' }], { prevTexts: t('old', 'старий'), nextTexts: t('new', 'новий') })
    expect(d.changed[0]).toMatchObject({ id: 'A', names: { en: 'A', uk: 'А' }, fields: [['desc', 'old', 'new']], texts: { en: { desc: ['old', 'new'] }, uk: { desc: ['старий', 'новий'] } } })
    const d2 = diffSection('items', [{ id: 'A', name: 'A' }], [{ id: 'A', name: 'A' }], { prevTexts: t('same', 'старий'), nextTexts: t('same', 'новий') })
    expect(d2.changed).toEqual([])
  })

  it('лічильники мапи за мапою й типом', () => {
    const p = (map, type) => ({ map, type })
    expect(diffMapCounts([p('m', 'a'), p('m', 'a'), p('m', 'b')], [p('m', 'a'), p('m', 'c')])).toEqual([
      { map: 'm', type: 'a', was: 2, now: 1 }, { map: 'm', type: 'b', was: 1, now: 0 }, { map: 'm', type: 'c', was: 0, now: 1 },
    ])
  })
})

describe('патч між пакетами', () => {
  let dir, db
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-patch-'))
    db = await openDb({ dataDir: path.join(dir, 'data'), pg: null })
  })
  afterEach(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  const texts = (rows) => rec(rows.map(([id, name]) => ({ id, name, description: null })))

  it('мапа — лише тим самим видобувачем; посилання рецептів — з назвами', () => {
    const bdir = path.join(dir, 'bundles')
    const base = {
      items: rec([{ id: 'Ore', name: 'Ore' }, { id: 'Bar', name: 'Bar' }]),
      recipes: rec([{ id: 'BarR', name: 'Bar', in: [['Ore', 7]], out: [['Bar', 1]], at: [] }]),
      texts: texts([['item:Ore:uk', 'Руда'], ['item:Bar:uk', 'Злиток']]),
      markers: rec([{ id: 'p1', map: 'm', type: 'Cave' }]),
    }
    bundle(bdir, 100, base)
    bundle(bdir, 101, { ...base, recipes: rec([{ id: 'BarR', name: 'Bar', in: [['Ore', 5]], out: [['Bar', 1]], at: [] }]), markers: rec([]) })
    bundle(bdir, 102, { ...base, markers: rec([]) }, { code: 'c2' })
    const [b100, b101, b102] = listBundles(bdir)
    const p = computePatch(b100, b101)
    expect(p).toMatchObject({ build: '101', prevBuild: '100', summary: { recipes: { added: 0, removed: 0, changed: 1 } } })
    expect(p.notes.refs.Ore).toMatchObject({ kind: 'item', names: { uk: 'Руда' } })
    expect(p.notes.map.counts.markers).toEqual([{ map: 'm', type: 'Cave', was: 1, now: 0 }])
    expect(computePatch(b101, b102).notes.map).toEqual({ skipped: 'extractor' })
  })

  it('сховище: рахує раз, сповіщає лише про свіжий патч зі змінами', async () => {
    const bdir = path.join(dir, 'bundles')
    const old = new Date(Date.now() - 30 * 86400_000).toISOString()
    bundle(bdir, 100, { items: rec([{ id: 'A', name: 'A' }]) }, { extractedAt: old })
    bundle(bdir, 101, { items: rec([{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }]) }, { extractedAt: old })
    const seen = []
    const patches = await createPatches({ db, bundleDir: bdir, log: {}, onNew: (p) => seen.push(p.build) })
    expect(await patches.scan()).toEqual(['101'])
    expect(seen).toEqual([]) // давній патч, який сайт побачив уперше, — мовчки
    expect(await patches.scan()).toEqual([])
    bundle(bdir, 102, { items: rec([{ id: 'A', name: 'A' }]) })
    bundle(bdir, 103, { items: rec([{ id: 'A', name: 'A' }]) })
    expect(await patches.scan()).toEqual(['102', '103'])
    expect(seen).toEqual(['102']) // 103 — без змін, не сповіщаємо
    const list = await patches.list()
    expect(list.map((x) => x.build)).toEqual(['103', '102', '101'])
    expect(hasChanges(list[0].summary)).toBe(false)
    const one = await patches.get('102')
    expect(one.notes.sections.items.removed.map((x) => x.id)).toEqual(['B'])
    // пакет 100 прибрано (видобувач тримає дві збірки) — порахований патч лишається
    fs.rmSync(path.join(bdir, '100'), { recursive: true })
    await patches.scan()
    expect(await patches.get('101')).toMatchObject({ prevBuild: '100' })
  })
})

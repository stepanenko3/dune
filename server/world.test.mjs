// Карта світу: data/world.json → відповідь мовою запиту (нема мовою — англійською), місця без назви й переходи до них —
// геть; файл змінився — нові дані без перезапуску; нема файлу — 503; той самий etag — 304.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWorld } from './lib/world.mjs'
import { createWorldRoutes } from './routes/world.mjs'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-'))
const file = path.join(dir, 'world.json')
const doc = (extra = {}) => ({
  schema: 1, build: '1', version: '1.5', overland: 'Overland', bounds: [0, 0, 10, 10],
  about: ['UI:about'],
  categories: [{ tag: 'Poi.Dungeons', name: 'UI:cat', parent: null }],
  locations: [
    { id: 'Overland', ids: ['Overland'], tag: null, name: 'UI:over', map: 'Overmap', pos: null },
    { id: 'FireDungeon', ids: ['FireDungeon'], tag: 'Poi.Dungeons', name: 'UI:fire', title: 'UI:fireT', desc: 'UI:nope', group: 'party', map: 'CB_X', pos: [1, 2], r: 5 },
    { id: 'HaggaBasin', ids: ['HaggaBasin'], tag: 'Poi.Location.Regions', name: 'UI:hagga', map: 'Survival_1', pos: [3, 4], exits: [[1, 1]] },
    { id: 'Nameless', ids: ['Nameless'], tag: null, name: 'UI:none', pos: [5, 5] },
  ],
  links: [
    { from: 'Overland', to: 'FireDungeon', mode: 'travel', points: 1, options: [[{ type: 'MapIsActiveJourneyTarget', text: 'UI:mission' }]] },
    { from: 'HaggaBasin', to: 'Overland', mode: 'travel', points: 11, options: [[{ type: 'NavigationType' }]] },
    { from: 'Overland', to: 'Nameless', mode: 'travel', points: 1, options: [[]] },
  ],
  texts: {
    'UI:about': { uk: 'Паливо', en: 'Fuel' }, 'UI:cat': { uk: 'Підземелля', en: 'Dungeons' }, 'UI:over': { uk: 'Карта поверхні', en: 'Overland Map' },
    'UI:fire': { uk: 'Станція № 136', en: 'Station No. 136' }, 'UI:fireT': { en: 'Imperial Station' }, 'UI:hagga': { uk: 'Западина Хаґґа', en: 'Hagga Basin' },
    'UI:mission': { uk: 'Потрібне завдання', en: 'Mission needed' },
  },
  ...extra,
})

describe('карта світу', () => {
  let srv, base
  beforeAll(() => {
    fs.writeFileSync(file, JSON.stringify(doc()))
    const app = express()
    app.use((req, res, next) => { req.lang = req.query.lang || 'uk'; req.t = (s) => s; next() })
    app.use(createWorldRoutes({ world: createWorld({ file }) }))
    srv = app.listen(0)
    base = `http://127.0.0.1:${srv.address().port}`
  })
  afterAll(() => { srv?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('мовою запиту; нема мовою — англійською; мапа сайту — з мапи гри', async () => {
    const d = await (await fetch(`${base}/api/world?lang=uk`)).json()
    const fire = d.locations.find((l) => l.id === 'FireDungeon')
    expect(fire).toMatchObject({ name: 'Станція № 136', title: 'Imperial Station', desc: null, group: 'party', map: 'cb_x', pos: [1, 2], r: 5 })
    expect(d.locations.find((l) => l.id === 'HaggaBasin')).toMatchObject({ map: 'survival_1', exits: [[1, 1]] })
    expect(d.about).toEqual(['Паливо'])
    expect(d.categories[0].name).toBe('Підземелля')
    expect(d.links.find((k) => k.to === 'FireDungeon').options[0][0]).toEqual({ type: 'MapIsActiveJourneyTarget', text: 'Потрібне завдання' })
    expect(d.links.find((k) => k.from === 'HaggaBasin').options[0][0]).toEqual({ type: 'NavigationType', text: null })
    const en = await (await fetch(`${base}/api/world?lang=en`)).json()
    expect(en.locations.find((l) => l.id === 'FireDungeon').name).toBe('Station No. 136')
  })
  it('місце без назви й переходи до нього — геть', async () => {
    const d = await (await fetch(`${base}/api/world?lang=uk`)).json()
    expect(d.locations.some((l) => l.id === 'Nameless')).toBe(false)
    expect(d.links.some((k) => k.to === 'Nameless')).toBe(false)
  })
  it('той самий etag — 304; змінився файл — нові дані', async () => {
    const r = await fetch(`${base}/api/world?lang=uk`)
    const tag = r.headers.get('etag')
    expect((await fetch(`${base}/api/world?lang=uk`, { headers: { 'if-none-match': tag } })).status).toBe(304)
    fs.writeFileSync(file, JSON.stringify(doc({ version: '1.6', build: '22' })))
    const t = new Date(Date.now() + 5000)
    fs.utimesSync(file, t, t)
    const d = await (await fetch(`${base}/api/world?lang=uk`)).json()
    expect(d.version).toBe('1.6')
  })
  it('нема файлу чи він зіпсований — 503', async () => {
    fs.writeFileSync(file, '{oops')
    const t = new Date(Date.now() + 10000)
    fs.utimesSync(file, t, t)
    expect((await fetch(`${base}/api/world?lang=uk`)).status).toBe(503)
    fs.rmSync(file)
    expect((await fetch(`${base}/api/world?lang=uk`)).status).toBe(503)
  })
})

// картинка карти поверхні: один раз у сховище (вдруге не тягне), у відповіді — наша адреса й межі; не webp — помилка
describe('картинка карти світу', () => {
  const own = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'world-doc-')), 'world.json')
  beforeAll(() => fs.writeFileSync(own, JSON.stringify(doc())))
  it('кладе в сховище й віддає адресою /media', async () => {
    const { createStorage } = await import('./lib/storage.mjs')
    const storage = createStorage({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'world-img-')), env: {} })
    const webp = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 '), Buffer.alloc(2000)])
    let calls = 0
    const fetchImpl = async () => { calls++; return { ok: true, arrayBuffer: async () => webp } }
    const w = createWorld({ file: own, storage, fetchImpl, log: {} })
    expect(w.get('uk').image).toBe(null)
    const etag = w.get('uk').etag
    expect(await w.warm()).toBe(true)
    expect(await w.warm()).toBe(true)
    expect(calls).toBe(1)
    const d = w.get('uk')
    expect(d.image).toMatchObject({ url: '/media/world/overland-t-ui-globalmap-d.webp', w: 4096, h: 2048 })
    expect(d.image.bounds).toHaveLength(4)
    expect(d.etag).not.toBe(etag)
    // новий сервер бачить картинку в сховищі — не тягне знову
    const w2 = createWorld({ file: own, storage, fetchImpl, log: {} })
    expect(await w2.warm()).toBe(true)
    expect(calls).toBe(1)
  })
  it('не картинка — не зберігає', async () => {
    const { createStorage } = await import('./lib/storage.mjs')
    const storage = createStorage({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'world-img-')), env: {} })
    const w = createWorld({ file: own, storage, fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('<html>'.repeat(300)) }), log: {} })
    await expect(w.warm()).rejects.toThrow()
    expect(w.get('uk').image).toBe(null)
  })
})

// Реєстр джерел ігрових даних: журнал пишеться лише від реальних змін; збій джерела чи підозріло менший збір нічого
// не затирає; запасний драйвер підхоплює; паралельні перевірки не дублюють запис. На тимчасовій SQLite.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './lib/sql.mjs'
import { createRegistry } from './lib/gamedata/registry.mjs'

/** драйвер-заглушка: дані й збої — зі змінних тесту */
function fake(id, store) {
  return {
    id, label: id,
    sections: () => Object.keys(store),
    probe: async () => ({ version: 'v' }),
    load: async (s) => {
      const v = store[s]
      if (v instanceof Error) throw v
      return { data: typeof v === 'function' ? v() : v, version: 'v1' }
    },
  }
}
const items = (n, extra = {}) => ({ records: Array.from({ length: n }, (_, i) => ({ id: 'i' + i, name: 'Item ' + i, ...extra })) })

describe('реєстр даних гри', () => {
  let dir, db
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-gd-'))
    db = await openDb({ dataDir: dir, pg: null })
  })
  afterEach(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  const make = async (drivers, now) => createRegistry({ db, dataDir: dir, drivers, log: {}, now })

  it('перше спостереження — без запису в журналі', async () => {
    const reg = await make([fake('community', { items: items(3) })])
    expect(await reg.check(['items'])).toEqual([{ section: 'items', driver: 'community', status: 'first', count: 3 }])
    expect((await reg.changes({})).items).toEqual([])
    const st = await reg.status()
    expect(st.sections).toHaveLength(1)
    expect(st.sections[0]).toMatchObject({ id: 'items', driver: 'community', count: 3, status: 'ok', error: null, changedAt: null })
    expect(st.game).toEqual({ version: null, build: null })
  })

  it('ті самі дані в іншому порядку — без змін', async () => {
    const store = { items: items(3) }
    const reg = await make([fake('community', store)])
    await reg.check(['items'])
    store.items = { records: [...items(3).records].reverse() }
    expect((await reg.check(['items']))[0].status).toBe('same')
    expect((await reg.changes({})).items).toEqual([])
  })

  it('реальна зміна — рядок журналу з підсумком', async () => {
    const store = { items: items(3) }
    let t = 1000
    const reg = await make([fake('community', store)], () => t)
    await reg.check(['items'])
    const next = items(4).records
    next[0] = { ...next[0], name: 'Renamed' }
    store.items = { records: next }
    t = 2000
    expect((await reg.check(['items']))[0].status).toBe('changed')
    const { items: ch } = await reg.changes({})
    expect(ch).toHaveLength(1)
    expect(ch[0]).toMatchObject({ section: 'items', driver: 'community', at: 2000, build: null, names: [] })
    expect(ch[0].summary).toMatchObject({ added: 1, removed: 0, changed: 1 })
    expect((await reg.status()).updatedAt).toBe(2000)
    expect((await reg.status()).sections[0].changedAt).toBe(2000)
  })

  it('у стрічці — конкретні сайти джерела', async () => {
    const store = { items: items(3) }
    const reg = await make([{ ...fake('community', store), describe: (s) => ({ id: 'community', names: [s, 'questlog.gg'] }) }])
    await reg.check(['items'])
    store.items = items(4)
    await reg.check(['items'])
    expect((await reg.changes({})).items[0].names).toEqual(['items', 'questlog.gg'])
  })

  it('збій джерела нічого не затирає', async () => {
    const store = { items: items(3) }
    const reg = await make([fake('community', store)])
    await reg.check(['items'])
    store.items = new Error('TH.GL лежить')
    expect((await reg.check(['items']))[0].status).toBe('error')
    const s = (await reg.status()).sections[0]
    expect(s).toMatchObject({ count: 3, status: 'error' })
    expect(s.error).toContain('TH.GL лежить')
    expect((await reg.changes({})).items).toEqual([])
  })

  it('основний збоїть — бере запасний', async () => {
    const reg = await make([fake('gamefiles', { items: new Error('нема пакета') }), fake('community', { items: items(2) })])
    expect((await reg.check(['items']))[0]).toMatchObject({ status: 'fallback', driver: 'community', count: 2 })
    expect((await reg.status()).sections[0]).toMatchObject({ driver: 'community', status: 'fallback' })
  })

  it('розділ дає лише той драйвер, у кого він є; ні в кого — пропуск', async () => {
    const reg = await make([fake('gamefiles', { config: { blob: { a: 1 } } }), fake('community', { items: items(1) })])
    const res = await reg.check(['items', 'config', 'resources'])
    expect(res.map((r) => [r.section, r.driver, r.status])).toEqual([['items', 'community', 'first'], ['config', 'gamefiles', 'first']])
    expect((await reg.status()).sections.map((s) => s.id).sort()).toEqual(['config', 'items'])
  })

  it('менший збір після перемикання основного адміном — не на підтвердженні; той самий спад після запасного — так', async () => {
    const a = { items: items(100) }, b = { items: items(30) }
    let primary = 'big'
    const reg = await createRegistry({ db, dataDir: dir, drivers: [fake('big', a), fake('small', b)], log: {}, primaryOf: async () => primary })
    await reg.check(['items'])
    primary = 'small'
    // перевірка без перемикання (напр. основне після збою знову відповіло) — спад удвічі чекає підтвердження
    expect((await reg.check(['items']))[0].status).toBe('held')
    // перевірка, яку запустило перемикання адміном, — ні
    expect((await reg.check(['items'], { switched: true }))[0]).toMatchObject({ driver: 'small', status: 'changed', count: 30 })
  })

  it('версія вмісту від драйвера та сама — розділ не вантажиться й не хешується знову', async () => {
    let loads = 0, cv = 'a'
    const d = { ...fake('x', { items: items(3) }), contentVersion: async () => cv }
    const load = d.load
    d.load = async (s) => { loads++; return load(s) }
    const reg = await make([d])
    await reg.check(['items'])
    expect((await reg.check(['items']))[0]).toMatchObject({ status: 'same', driver: 'x' })
    expect(loads).toBe(1)
    cv = 'b'
    await reg.check(['items'])
    expect(loads).toBe(2)
  })

  it('розділ групи з вибраним основним — без запасного: збій основного — помилка, а не дані іншого джерела', async () => {
    const reg = await createRegistry({ db, dataDir: dir, drivers: [fake('game', { markers: items(3) }), fake('thgl', { markers: new Error('CDN') })], log: {}, primaryOf: async () => 'thgl' })
    expect((await reg.check(['markers']))[0]).toMatchObject({ status: 'error', driver: null })
  })

  it('збір удвічі менший — на підтвердженні, доки адмін не прийме', async () => {
    const store = { items: items(100) }
    const reg = await make([fake('community', store)])
    await reg.check(['items'])
    store.items = items(30)
    expect((await reg.check(['items']))[0].status).toBe('held')
    expect((await reg.status()).sections[0]).toMatchObject({ count: 100, status: 'held' })
    expect((await reg.changes({})).items).toEqual([])
    expect(await reg.accept('items')).toBe(true)
    expect((await reg.status()).sections[0]).toMatchObject({ count: 30, status: 'ok' })
    const ch = (await reg.changes({})).items
    expect(ch).toHaveLength(1)
    expect(ch[0].summary.removed).toBe(70)
    expect(await reg.accept('items')).toBe(false)
  })

  it('дві перевірки водночас — один запис', async () => {
    const store = { items: items(3) }
    const reg = await make([fake('community', store)])
    await reg.check(['items'])
    store.items = items(4)
    await Promise.all([reg.check(['items']), reg.check(['items'])])
    expect((await reg.changes({})).items).toHaveLength(1)
  })

  it('на диску — не більше п’яти знімків розділу', async () => {
    const store = { items: items(30) }
    const reg = await make([fake('community', store)])
    for (let i = 0; i < 8; i++) { store.items = items(30, { v: i }); await reg.check(['items']) }
    expect(fs.readdirSync(path.join(dir, 'gamedata', 'items')).length).toBeLessThanOrEqual(5)
    expect((await reg.changes({ limit: 100 })).items).toHaveLength(7)
  })

  it('збій запису журналу не зсуває хеш — наступна перевірка запише зміну', async () => {
    const store = { items: items(3) }
    let failInsert = false
    // та сама база, але вставка в журнал може «впасти» (перезапуск сервера, обрив з'єднання)
    const flaky = new Proxy(db, {
      get(target, k) {
        if (k === 'run') return (sql, ...a) => (failInsert && /INSERT INTO gamedata_changes/.test(sql) ? Promise.reject(new Error('обрив')) : target.run(sql, ...a))
        if (k === 'tx') return (fn) => target.tx(() => fn(flaky))
        return target[k]
      },
    })
    const reg = await createRegistry({ db: flaky, dataDir: dir, drivers: [fake('community', store)], log: {} })
    await reg.check(['items'])
    store.items = items(4)
    failInsert = true
    await expect(reg.check(['items'])).rejects.toThrow('обрив')
    failInsert = false
    expect((await reg.check(['items']))[0].status).toBe('changed')
    expect((await reg.changes({})).items).toHaveLength(1)
  })

  it('стан: since — коли розділ уперше побачили (для підпису «оновлено», поки змін ще не було)', async () => {
    let t = 1000
    const reg = await make([fake('community', { items: items(2) })], () => t)
    await reg.check(['items'])
    t = 5000
    await reg.check(['items'])
    expect((await reg.status()).sections[0]).toMatchObject({ since: 1000, checkedAt: 5000, changedAt: null })
  })

  it('журнал сторінками', async () => {
    const store = { items: items(30) }
    const reg = await make([fake('community', store)])
    for (let i = 0; i < 4; i++) { store.items = items(30, { v: i }); await reg.check(['items']) }
    const a = await reg.changes({ limit: 2 })
    expect(a.items).toHaveLength(2)
    expect(a.next).not.toBeNull()
    const b = await reg.changes({ limit: 2, before: a.next })
    expect(b.items).toHaveLength(1)
    expect(b.next).toBeNull()
    expect(a.items[0].id).toBeGreaterThan(a.items[1].id)
    expect(a.items[1].id).toBeGreaterThan(b.items[0].id)
  })

  describe('основне джерело й застосування', () => {
    const gf = (store, probe = null) => ({ ...fake('gamefiles', store), applies: true, probe: async () => probe })

    it('основне — файли гри: беремо їх, навіть якщо в списку вони другі', async () => {
      const reg = await createRegistry({ db, dataDir: dir, drivers: [fake('community', { items: items(2) }), gf({ items: items(3) })], log: {}, primaryOf: async () => 'gamefiles' })
      expect((await reg.check(['items']))[0]).toMatchObject({ driver: 'gamefiles', count: 3 })
      expect((await reg.status()).sections[0].primary).toBe('gamefiles')
    })

    it('нові дані драйвера, що застосовується, — застосувач викликано; запасного — ні', async () => {
      const calls = []
      const store = { items: items(3) }
      const apply = { items: async (data, ctx) => calls.push([data.records.length, ctx.driver]) }
      const reg = await createRegistry({ db, dataDir: dir, drivers: [gf(store), fake('community', { items: items(2) })], log: {}, apply })
      await reg.check(['items'])
      store.items = items(4)
      await reg.check(['items'])
      await reg.check(['items'])
      expect(calls).toEqual([[3, 'gamefiles'], [4, 'gamefiles']])
      const reg2 = await createRegistry({ db, dataDir: dir, drivers: [fake('community', { placeables: items(2) })], log: {}, apply: { placeables: async () => calls.push('x') } })
      await reg2.check(['placeables'])
      expect(calls).not.toContain('x')
    })

    it('застосувач упав — помилка, хеш не зсунувся, наступна перевірка пробує знову', async () => {
      let fail = false
      const n = []
      const store = { items: items(3) }
      const apply = { items: async (data) => { if (fail) throw new Error('база зайнята'); n.push(data.records.length) } }
      const reg = await createRegistry({ db, dataDir: dir, drivers: [gf(store)], log: {}, apply })
      await reg.check(['items'])
      store.items = items(4)
      fail = true
      expect((await reg.check(['items']))[0].status).toBe('error')
      expect((await reg.status()).sections[0]).toMatchObject({ count: 3, status: 'error' })
      expect((await reg.status()).sections[0].error).toContain('база зайнята')
      fail = false
      expect((await reg.check(['items']))[0].status).toBe('changed')
      expect(n).toEqual([3, 4])
    })

    it('пакет із номером збірки — версія гри в стані', async () => {
      const reg = await createRegistry({ db, dataDir: dir, drivers: [gf({ items: items(1) }, { version: '7', build: '7', gameVersion: '1.5.15', manifestId: 'm1', extractedAt: '2026-10-21T13:53:28.867Z' })], log: {} })
      await reg.check(['items'])
      expect((await reg.status()).game).toEqual({ version: '1.5.15', build: '7' })
    })

    it('прийняття затриманого застосовує повні дані з джерела (і невипущене), а не знімок', async () => {
      const got = []
      const store = { items: items(100) }
      const reg = await createRegistry({ db, dataDir: dir, drivers: [gf(store)], log: {}, apply: { items: async (d) => got.push(d.records.length) } })
      await reg.check(['items'])
      store.items = { records: [...items(30).records, { id: 'hidden1', released: false }] }
      expect((await reg.check(['items']))[0].status).toBe('held')
      expect(await reg.accept('items')).toBe(true)
      expect(got).toEqual([100, 31])
    })

    it('прийняти не можна, якщо джерело вже віддає інше, ніж затримане', async () => {
      const store = { items: items(100) }
      const reg = await createRegistry({ db, dataDir: dir, drivers: [gf(store)], log: {}, apply: { items: async () => {} } })
      await reg.check(['items'])
      store.items = items(30)
      await reg.check(['items'])
      store.items = items(31)
      expect(await reg.accept('items')).toBe(false)
    })

    it('reapply — застосувати знову, хоч хеш той самий', async () => {
      const calls = []
      const reg = await createRegistry({ db, dataDir: dir, drivers: [gf({ items: items(2) })], log: {}, apply: { items: async () => calls.push(1) } })
      await reg.check(['items'])
      expect(await reg.reapply('items')).toBe(true)
      expect(calls).toHaveLength(2)
    })
  })
})

// API стану ігрових даних: без реєстру (вимкнено) — порожній стан; журнал обрізає limit; адмінські дії — лише з правом.
import express from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGameDataRoutes } from './routes/gamedata.mjs'

describe('API ігрових даних', () => {
  let server, base, seen, reapplied
  const registry = {
    status: async () => ({ game: { version: null, build: null }, updatedAt: 1, sections: [{ id: 'items', error: "community: ENOENT open '/srv/x.json'" }] }),
    changes: async (q) => { seen = q; return { items: [], next: null } },
    check: async () => [{ section: 'items', driver: 'community', status: 'same', count: 1 }],
    accept: async () => true,
    reapply: async (s) => { reapplied = s; return true },
  }
  const roles = { can: async (u, p) => u.perms.includes(p) || u.perms.includes('*') }
  const start = async (reg) => {
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.t = (s) => s
      const h = req.headers['x-test-user']
      req.user = h ? JSON.parse(h) : null
      next()
    })
    app.use(createGameDataRoutes({ sources: reg ? { registry: reg, drivers: { gamefiles: {}, thgl: {} } } : null, roles }))
    app.use((err, req, res, _next) => res.status(err.status || 500).json({ error: err.message }))
    return new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
  }
  const call = (url, { user, method = 'GET', b = base } = {}) =>
    fetch(b + url, { method, headers: user ? { 'x-test-user': JSON.stringify(user) } : {} })

  beforeAll(async () => { server = await start(registry); base = `http://127.0.0.1:${server.address().port}` })
  afterAll(() => server?.close())

  it('вимкнено — порожній стан', async () => {
    const off = await start(null)
    const r = await call('/api/gamedata/status', { b: `http://127.0.0.1:${off.address().port}` })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ game: { version: null, build: null }, updatedAt: null, sections: [] })
    const c = await call('/api/gamedata/changes', { b: `http://127.0.0.1:${off.address().port}` })
    expect(await c.json()).toEqual({ items: [], next: null })
    off.close()
  })

  it('стан — з реєстру, без кешу; текст помилки джерела — лише адмінові', async () => {
    const r = await call('/api/gamedata/status')
    expect(r.headers.get('cache-control')).toBe('no-cache')
    expect((await r.json()).sections).toEqual([{ id: 'items', error: null }])
    const u = await call('/api/gamedata/status', { user: { id: 'u', perms: [] } })
    expect((await u.json()).sections[0].error).toBeNull()
    const a = await call('/api/gamedata/status', { user: { id: 'a', perms: ['gamedata.manage'] } })
    expect((await a.json()).sections[0].error).toContain('ENOENT')
  })

  it('журнал: limit обрізається до 100, before — числом', async () => {
    await call('/api/gamedata/changes?limit=500&before=42')
    expect(seen).toEqual({ limit: 100, before: 42 })
    await call('/api/gamedata/changes')
    expect(seen).toEqual({ limit: 30, before: null })
  })

  it('перевірка — потрібен вхід і право', async () => {
    expect((await call('/api/admin/gamedata/check', { method: 'POST' })).status).toBe(401)
    expect((await call('/api/admin/gamedata/check', { method: 'POST', user: { id: 'u', perms: [] } })).status).toBe(403)
    const ok = await call('/api/admin/gamedata/check', { method: 'POST', user: { id: 'a', perms: ['gamedata.manage'] } })
    expect(ok.status).toBe(200)
    expect((await ok.json()).results[0].section).toBe('items')
  })

  it('прийняти невідомий розділ — 400', async () => {
    const r = await call('/api/admin/gamedata/accept/nope', { method: 'POST', user: { id: 'a', perms: ['*'] } })
    expect(r.status).toBe(400)
    const ok = await call('/api/admin/gamedata/accept/items', { method: 'POST', user: { id: 'a', perms: ['*'] } })
    expect(await ok.json()).toEqual({ ok: true })
  })

  it('перемикання: група чи окремий розділ (не розділ групи), відоме джерело; право потрібне', async () => {
    const admin = { id: 'a', perms: ['gamedata.manage'] }
    const post = (url, body, user = admin) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user) }, body: JSON.stringify(body) })
    expect((await post('/api/admin/gamedata/primary/items', { driver: 'gamefiles' })).status).toBe(400)
    expect((await post('/api/admin/gamedata/primary/catalog', { driver: 'questlog' })).status).toBe(400)
    expect((await post('/api/admin/gamedata/primary/nope', { driver: 'gamefiles' })).status).toBe(400)
    expect((await post('/api/admin/gamedata/primary/catalog', { driver: 'gamefiles' }, { id: 'u', perms: [] })).status).toBe(403)
    expect((await call('/api/admin/gamedata/sections', { user: { id: 'u', perms: [] } })).status).toBe(403)
  })

  it('перезаписати з файлів гри: лише розділи, що застосовуються', async () => {
    const admin = { id: 'a', perms: ['*'] }
    expect((await call('/api/admin/gamedata/reapply/config', { method: 'POST', user: admin })).status).toBe(400)
    const r = await call('/api/admin/gamedata/reapply/buildables', { method: 'POST', user: admin })
    expect(r.status).toBe(200)
    expect(reapplied).toBe('buildables')
  })
})

describe('журнал змін ігрових даних мовою людини', () => {
  it('приклади записів — назвою гри мовою запиту (предмети, пристрої, рецепти, модулі, вміння, типи міток); нема перекладу — як було', async () => {
    const registry = { changes: async () => ({ items: [{ id: 1, section: 'items', summary: { examples: [{ id: 'AzuriteOre', name: 'Copper Ore', op: '+' }, { id: 'X', name: 'Thing', op: '-' }] } }, { id: 2, section: 'resources', summary: { examples: [{ id: 'p1', name: null, op: '+' }] } }], next: null }) }
    const asked = []
    const game = { names: async (lang, kind, ids) => { asked.push([lang, kind, ids]); return new Map([['AzuriteOre', 'Мідна руда']]) } }
    const app = express()
    app.use((req, _res, next) => { req.t = (s) => s; req.lang = 'uk'; next() })
    app.use(createGameDataRoutes({ sources: { registry, drivers: {} }, roles: { can: async () => false }, game }))
    const s = await new Promise((r) => { const x = app.listen(0, '127.0.0.1', () => r(x)) })
    const j = await (await fetch(`http://127.0.0.1:${s.address().port}/api/gamedata/changes`)).json()
    s.close()
    expect(j.items[0].summary.examples.map((x) => x.name)).toEqual(['Мідна руда', 'Thing'])
    expect(j.items[1].summary.examples[0].name).toBeNull()
    expect(asked).toEqual([['uk', 'item', ['AzuriteOre', 'X']]])
  })
})

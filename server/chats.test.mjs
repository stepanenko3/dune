// Розмови через справжній HTTP і WebSocket: особиста розмова (одна на пару), повідомлення, непрочитані й «переглянуто»,
// сповіщення (не тим, хто дивиться розмову чи вимкнув звук), зміна / видалення своїх, відповідь, реакції, блокування,
// гільдійська розмова (лише учасники, без сповіщень), миттєві події (нове, «друкує…»), чужий сайт — без з'єднання,
// панель керування читає будь-яку розмову, текст листування не потрапляє в журнал дій. На SQLite і Postgres.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'

let pg = null
try {
  const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  if (env.DB_HOST && env.DB_CONNECTION !== 'sqlite') {
    pg = { host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: `${env.DB_DATABASE || 'dune'}_testing`, user: env.DB_USERNAME || 'postgres', password: env.DB_PASSWORD || undefined }
    const probe = await openDb({ pg }).catch(() => null)
    if (probe) await probe.close()
    else pg = null
  }
} catch { pg = null }
const ENGINES = [['SQLite', null], ...(pg ? [['Postgres', pg]] : [])]

async function freshDb(pgCfg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-chats-'))
  if (!pgCfg) return { db: await openDb({ dataDir: dir }), dir }
  const schema = `ch_${crypto.randomBytes(4).toString('hex')}`
  const root = await openDb({ pg: pgCfg })
  await root.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`)
  await root.close()
  const db = await openDb({ pg: { ...pgCfg, options: `-c search_path=${schema}` } })
  const close = db.close
  db.close = async () => { await close(); const r = await openDb({ pg: pgCfg }); await r.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await r.close() }
  return { db, dir }
}

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

describe.each(ENGINES)('%s', (_name, pgCfg) => {
  let server, base, dir, app, db
  const mail = []
  const codeFor = (email) => [...mail].reverse().find((m) => m.to === email)?.text.match(/\b\d{6}\b/)?.[0]
  function agent() {
    let cookie = ''
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
      const set = r.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
      const text = await r.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* не JSON */ }
      return { status: r.status, body: json }
    }
    const a = {
      id: null, name: '',
      cookie: () => cookie,
      get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u),
      async signIn(email, name) {
        await a.post('/api/auth/code', { email })
        await a.post('/api/auth/verify', { email, code: codeFor(email) })
        await a.patch('/api/me', { name })
        const me = (await a.get('/api/me')).body
        a.id = me.user?.id ?? me.id
        a.name = name
      },
      /** WebSocket цієї людини: події збираються в events */
      async ws(origin = base) {
        const s = new WebSocket(base.replace('http', 'ws') + '/api/chats/ws', { headers: { cookie, origin } })
        const events = []
        s.onmessage = (m) => events.push(JSON.parse(m.data))
        await new Promise((ok, bad) => { s.onopen = ok; s.onerror = bad })
        return { s, events, send: (x) => s.send(JSON.stringify(x)), until: async (fn) => { for (let i = 0; i < 100; i++) { const e = events.find(fn); if (e) return e; await wait(20) } return null } }
      },
    }
    return a
  }

  beforeAll(async () => {
    ;({ db, dir } = await freshDb(pgCfg))
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    app.locals.attachWs(server)
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(async () => {
    server?.closeAllConnections?.()
    server?.close()
    await app?.locals.close()
    await db?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const admin = agent(), ann = agent(), ben = agent(), cid = agent(), anon = agent()
  let dm = null, msg = null

  it('вхід: адміністратор (лідер першої гільдії) і троє гравців; Енн — у гільдії', async () => {
    await admin.signIn('admin@example.com', 'Адмін')
    await ann.signIn('ann@example.com', 'Енн')
    await ben.signIn('ben@example.com', 'Бен')
    await cid.signIn('cid@example.com', 'Сід')
    const code = (await admin.post('/api/guilds/sandwalkers/invites', { days: 7, uses: 5 })).body.code
    expect((await ann.post(`/api/invites/${code}/accept`)).status).toBeLessThan(300)
  })

  it('особиста розмова: одна на пару; собі й невідомому — ні; без входу — 401', async () => {
    expect((await anon.post('/api/chats/direct', { user: ben.id })).status).toBe(401)
    const a = await ann.post('/api/chats/direct', { user: ben.id })
    expect(a.status).toBe(200)
    dm = a.body.id
    expect((await ben.post('/api/chats/direct', { user: ann.id })).body.id).toBe(dm)
    expect((await ann.post('/api/chats/direct', { user: ann.id })).status).toBe(400)
    expect((await ann.post('/api/chats/direct', { user: 'nobody' })).status).toBe(404)
  })

  it('повідомлення: непрочитане й сповіщення співрозмовнику; прочитав — «переглянуто»; сторонній не бачить', async () => {
    const r = await ann.post(`/api/chats/${dm}/messages`, { text: '  Привіт! Маєш меланж? 🙂  ' })
    expect(r.status).toBe(201)
    msg = r.body
    expect(msg).toMatchObject({ text: 'Привіт! Маєш меланж? 🙂', user: { id: ann.id, name: 'Енн' } })
    const list = (await ben.get('/api/chats')).body
    const row = list.rows.find((x) => x.id === dm)
    expect(row).toMatchObject({ kind: 'direct', unread: 1, other: { id: ann.id }, canWrite: true })
    expect((await ben.get('/api/chats/unread')).body.n).toBe(1)
    expect((await ben.get('/api/notifications')).body.rows[0]).toMatchObject({ kind: 'chat.message', data: { chat: dm, kind: 'direct', from: 'Енн' } })
    await ben.post(`/api/chats/${dm}/read`)
    expect((await ben.get('/api/chats/unread')).body.n).toBe(0)
    expect((await ann.get(`/api/chats/${dm}`)).body.chat.otherRead).toBeGreaterThanOrEqual(msg.at)
    expect((await cid.get(`/api/chats/${dm}`)).status).toBe(404)
    expect((await cid.post(`/api/chats/${dm}/messages`, { text: 'я тут' })).status).toBe(404)
    expect((await ann.post(`/api/chats/${dm}/messages`, { text: '   ' })).status).toBe(400)
  })

  it('відповідь, реакції, зміна й видалення свого (змінити — 15 хв)', async () => {
    const reply = (await ben.post(`/api/chats/${dm}/messages`, { text: 'Є, 500 шт.', reply: msg.id })).body
    expect(reply.quote).toMatchObject({ id: msg.id, user: { id: ann.id } })
    expect((await ann.post(`/api/chats/${dm}/messages/${reply.id}/react`, { emoji: '🔥' })).body.reactions).toEqual([{ emoji: '🔥', n: 1, mine: true }])
    expect((await ann.post(`/api/chats/${dm}/messages/${reply.id}/react`, { emoji: '💩' })).status).toBe(400)
    expect((await ann.patch(`/api/chats/${dm}/messages/${reply.id}`, { text: 'чуже' })).status).toBe(404)
    expect((await ann.patch(`/api/chats/${dm}/messages/${msg.id}`, { text: 'Привіт! Маєш меланж?' })).body).toMatchObject({ text: 'Привіт! Маєш меланж?' })
    await db.run('UPDATE chat_messages SET at = ? WHERE id = ?', Date.now() - 20 * 60_000, msg.id)
    expect((await ann.patch(`/api/chats/${dm}/messages/${msg.id}`, { text: 'пізно' })).status).toBe(409)
    expect((await ann.del(`/api/chats/${dm}/messages/${msg.id}`)).status).toBe(200)
    const page = (await ben.get(`/api/chats/${dm}`)).body.messages
    expect(page.find((m) => m.id === msg.id)).toMatchObject({ text: '' })
    expect(page.find((m) => m.id === msg.id).deleted).toBeTruthy()
  })

  it('блокування: ні тому, хто заблокував, ні заблокованому писати не можна; розблокував — знову можна', async () => {
    await ben.post('/api/chats/block', { user: ann.id })
    expect((await ann.post(`/api/chats/${dm}/messages`, { text: 'ей' })).status).toBe(403)
    expect((await ben.post(`/api/chats/${dm}/messages`, { text: 'ей' })).status).toBe(403)
    expect((await ann.get(`/api/chats/${dm}`)).body.chat).toMatchObject({ canWrite: false, blocked: { byThem: true } })
    await ben.post('/api/chats/block', { user: ann.id, on: false })
    expect((await ann.post(`/api/chats/${dm}/messages`, { text: 'знову тут' })).status).toBe(201)
  })

  it('без звуку — без сповіщень, але непрочитане рахується', async () => {
    await ben.post(`/api/chats/${dm}/mute`, { on: true })
    const before = (await ben.get('/api/notifications')).body.rows.length
    await ann.post(`/api/chats/${dm}/messages`, { text: 'тихо' })
    expect((await ben.get('/api/notifications')).body.rows.length).toBe(before)
    expect((await ben.get('/api/chats')).body.rows.find((x) => x.id === dm)).toMatchObject({ muted: true })
    await ben.post(`/api/chats/${dm}/mute`, { on: false })
  })

  it('гільдійська розмова: лише учасники; давнє для нового — прочитане; сповіщень нема', async () => {
    const g = (await admin.post('/api/chats/guild')).body.id
    expect((await admin.post(`/api/chats/${g}/messages`, { text: 'Збір о 20:00' })).status).toBe(201)
    const row = (await ann.get('/api/chats')).body.rows.find((x) => x.id === g)
    expect(row).toMatchObject({ kind: 'guild', guild: { slug: 'sandwalkers' } })
    expect((await ann.get(`/api/chats/${g}`)).body.messages.map((m) => m.text)).toEqual(['Збір о 20:00'])
    expect((await ann.post(`/api/chats/${g}/messages`, { text: 'Буду' })).status).toBe(201)
    expect((await admin.get('/api/notifications')).body.rows.some((x) => x.kind === 'chat.message' && x.data.chat === g)).toBe(false)
    expect((await cid.get(`/api/chats/${g}`)).status).toBe(404)
    expect((await cid.post('/api/chats/guild', { guild: 'sandwalkers' })).status).toBe(403)
  })

  it('WebSocket: нове повідомлення й «друкує…» — миттєво; хто дивиться розмову — без сповіщення; чужий сайт — відмова', async () => {
    const b = await ben.ws()
    const a = await ann.ws()
    expect(await b.until((e) => e.t === 'hello')).toBeTruthy()
    await ann.post(`/api/chats/${dm}/messages`, { text: 'наживо' })
    expect(await b.until((e) => e.t === 'msg' && e.message.text === 'наживо')).toMatchObject({ chat: dm, message: { user: { id: ann.id } } })
    a.send({ t: 'typing', chat: dm })
    expect(await b.until((e) => e.t === 'typing')).toMatchObject({ chat: dm, user: { id: ann.id, name: 'Енн' } })
    b.send({ t: 'focus', chat: dm })
    await wait(100)
    await ben.post('/api/notifications/read', { all: true })
    await ann.post(`/api/chats/${dm}/messages`, { text: 'ти ж тут' })
    await b.until((e) => e.t === 'msg' && e.message.text === 'ти ж тут')
    expect((await ben.get('/api/notifications')).body.unread).toBe(0)
    // чужий Origin — з'єднання не відкривається
    await expect(ben.ws('https://evil.example')).rejects.toBeTruthy()
    a.s.close(); b.s.close()
  })

  it('панель: адміністратор читає будь-яку розмову; без дозволу — 403; текст листування — не в журналі дій', async () => {
    expect((await ann.get('/api/admin/chats')).status).toBe(403)
    const list = (await admin.get('/api/admin/chats?kind=direct')).body
    expect(list.rows.map((x) => x.id)).toContain(dm)
    const one = (await admin.get(`/api/admin/chats/${dm}`)).body
    expect(one.chat).toMatchObject({ kind: 'direct', readOnly: true })
    expect(one.messages.map((m) => m.text)).toContain('наживо')
    const audit = await db.all("SELECT detail FROM audit WHERE action LIKE 'POST /api/chats/%'")
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.some((r) => r.detail.includes('наживо'))).toBe(false)
    expect((await db.all("SELECT 1 AS x FROM audit WHERE action LIKE '%typing%' OR action LIKE '%/read'")).length).toBe(0)
  })
})

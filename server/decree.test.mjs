// Указ Ландсрааду з домом-переможцем: адміністрація вибирає указ лише разом із домом, що виграв; дім людини — свій
// (профіль) чи, якщо свій не вказано, дім її гільдії (налаштування гільдії — лідер); /api/decree каже людині її дім.
// Обв'язка — як у spice.test.mjs: запасна SQLite (тимчасова тека) і Postgres <DB_DATABASE>_testing зі Snotax console
// (якщо є), у своїй схемі на кожен запуск.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'
import { applies, cleanHouse } from './lib/decree.mjs'

const SCHEMA = `decree_${process.pid}_${Date.now().toString(36)}`
let pg = null
try {
  const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  if (env.DB_HOST && env.DB_CONNECTION !== 'sqlite') {
    pg = { host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: `${env.DB_DATABASE || 'dune'}_testing`, user: env.DB_USERNAME || 'postgres', password: env.DB_PASSWORD || undefined }
    const probe = await openDb({ pg }).catch(() => null)
    if (probe) {
      await probe.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`)
      await probe.close()
      pg = { ...pg, options: `-c search_path=${SCHEMA}` }
    } else pg = null
  }
} catch { pg = null }

const ENGINES = [['SQLite', null], ...(pg ? [['Postgres', pg]] : [])]

describe('указ: чи діє на людину', () => {
  it('дім-переможець проти дому людини', () => {
    expect(applies({ id: 'xp', house: 'atreides' }, 'atreides')).toBe(true)
    expect(applies({ id: 'xp', house: 'atreides' }, 'harkonnen')).toBe(false)
    expect(applies({ id: 'xp', house: 'atreides' }, null)).toBe(null)
    // давній указ без дому — на всіх, як і діяв; указу нема — нема й відповіді
    expect(applies({ id: 'xp', house: null }, 'harkonnen')).toBe(true)
    expect(applies({ id: null, house: null }, 'harkonnen')).toBe(null)
    expect(cleanHouse('')).toBe(null)
    expect(() => cleanHouse('fremen')).toThrow()
  })
})

describe.each(ENGINES)('%s', (_name, pgCfg) => {
  let server, base, dir, app, db
  const mail = []
  const codeFor = (email) => [...mail].reverse().find((m) => m.to === email.trim().toLowerCase())?.text.match(/\b\d{6}\b/)?.[0]

  /** «браузер»: свій cookie сеансу, запити з того самого сайту */
  function agent() {
    let cookie = ''
    const call = async (method, url, body) => {
      const r = await fetch(base + url, {
        method,
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const set = r.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
      return { status: r.status, body: await r.json().catch(() => null) }
    }
    const a = {
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      put: (u, b) => call('PUT', u, b),
      patch: (u, b) => call('PATCH', u, b),
      async signIn(email) {
        const r = await a.post('/api/auth/code', { email })
        if (r.status !== 200) return r
        return a.post('/api/auth/verify', { email, code: codeFor(email) })
      },
    }
    return a
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-decree-'))
    db = await openDb({ dataDir: dir, pg: pgCfg })
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(async () => {
    server?.close()
    await app?.locals.close()
    if (db?.kind === 'pg') await db.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {})
    await db?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const admin = agent(), bob = agent(), anon = agent()
  const until = () => Date.now() + 3 * 86400_000

  it('указ — лише з домом-переможцем; бачать усі', async () => {
    expect((await admin.signIn('admin@example.com')).body.user.role).toBe('admin')
    expect((await bob.signIn('bob@example.com')).status).toBe(201)
    expect((await admin.put('/api/decree', { id: 'production', until: until() })).status).toBe(400)
    expect((await admin.put('/api/decree', { id: 'production', until: until(), house: 'fremen' })).status).toBe(400)
    expect((await bob.put('/api/decree', { id: 'production', until: until(), house: 'atreides' })).status).toBe(403)
    const r = await admin.put('/api/decree', { id: 'production', until: until(), house: 'atreides' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ id: 'production', house: 'atreides', canSet: true })
    expect((await anon.get('/api/decree')).body).toMatchObject({ id: 'production', house: 'atreides', canSet: false, me: null })
    // «не вказано» — без дому
    expect((await admin.put('/api/decree', { id: null })).body).toMatchObject({ id: null, house: null })
    await admin.put('/api/decree', { id: 'refining', until: until(), house: 'harkonnen' })
  })

  it('дім людини: свій, інакше — гільдії', async () => {
    expect((await bob.get('/api/decree')).body.me).toEqual({ own: null, guild: null, house: null })
    expect((await anon.put('/api/me/house', { house: 'atreides' })).status).toBe(401)
    expect((await bob.put('/api/me/house', { house: 'ix' })).status).toBe(400)
    expect((await bob.put('/api/me/house', { house: 'atreides' })).body.me).toEqual({ own: 'atreides', guild: null, house: 'atreides' })
    // перший — лідер Sandwalkers: дім гільдії вказує лідер у її налаштуваннях
    const slug = (await admin.get('/api/me')).body.guild.slug
    expect((await admin.patch(`/api/guilds/${slug}`, { house: 'arrakis' })).status).toBe(400)
    const g = await admin.patch(`/api/guilds/${slug}`, { house: 'harkonnen' })
    expect(g.status).toBe(200)
    expect(g.body.guild.house).toBe('harkonnen')
    expect((await admin.get('/api/decree')).body.me).toEqual({ own: null, guild: 'harkonnen', house: 'harkonnen' })
    // свій дім переважає дім гільдії; порожньо — знову як у гільдії
    expect((await admin.put('/api/me/house', { house: 'atreides' })).body.me.house).toBe('atreides')
    expect((await admin.put('/api/me/house', { house: null })).body.me).toEqual({ own: null, guild: 'harkonnen', house: 'harkonnen' })
    expect((await anon.get(`/api/guilds/${slug}`)).body.guild.house).toBe('harkonnen')
  })
})

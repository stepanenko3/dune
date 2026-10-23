// Каталог гільдій і набір: картка гільдії (що бачить чужий, учасник, офіцер), анкета й заявки (подати, коментувати,
// відхилити з причиною, подати знову, прийняти), сповіщення обом сторонам і шина подій набору, герб, прев'ю посилання.
// Двічі: на запасній SQLite і на Postgres <DB_DATABASE>_testing (у власній схемі), як guilds.test.mjs.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.mjs'
import { createGuilds } from './lib/guilds.mjs'
import { cleanAnswers, cleanProfile, profileFor } from './lib/guild-profile.mjs'
import { createOg } from './lib/og.mjs'
import { openDb } from './lib/sql.mjs'
import { fill } from './lib/util.mjs'

// Postgres для тестів — база <DB_DATABASE>_testing з .env
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

/** чиста база: SQLite — у тимчасовій теці; Postgres — у власній схемі gt_<назва>_<випадкове> (стирається разом із базою; випадкове — щоб паралельні запуски не стирали одне одному) */
async function freshDb(pgCfg, name) {
  if (!pgCfg) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-guilds-'))
    const db = await openDb({ dataDir: dir })
    const close = db.close
    db.close = async () => { await close(); fs.rmSync(dir, { recursive: true, force: true }) }
    return { db, dir }
  }
  const schema = `gt_${name}_${crypto.randomBytes(4).toString('hex')}`
  const root = await openDb({ pg: pgCfg })
  await root.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema}`)
  await root.close()
  const db = await openDb({ pg: { ...pgCfg, options: `-c search_path=${schema}` } })
  const close = db.close
  db.close = async () => {
    await close()
    const r = await openDb({ pg: pgCfg })
    await r.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await r.close()
  }
  return { db, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'sw-guilds-')) }
}


vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

describe('картка гільдії (бібліотека)', () => {
  it('невідоме відкидає, хибне — помилка, видимість за замовчуванням як було', () => {
    const p = cleanProfile({ server: '  Hagga-01  ', region: 'mars', tz: 'Europe/Kyiv', langs: ['uk', 'xx', 'uk'], styles: ['pvp', 'golf'], extra: 1, schedule: [{ days: [1, 2, 9], from: '20:00', to: '23:30' }, { days: [], from: '1', to: '2' }] })
    expect(p).toMatchObject({ server: 'Hagga-01', region: null, tz: 'Europe/Kyiv', langs: ['uk'], styles: ['pvp'], schedule: [{ days: [1, 2], from: '20:00', to: '23:30' }] })
    expect(p).not.toHaveProperty('extra')
    expect(p.show).toMatchObject({ about: 'public', officers: 'public', members: 'guild', rules: 'public' })
    expect(cleanProfile({ tz: 'Mars/Olympus' }).tz).toBeNull()
    // поле часу браузера — з секундами
    expect(cleanProfile({ schedule: [{ days: [6, 0], from: '18:00:00', to: '02:00:00' }] }).schedule).toEqual([{ days: [0, 6], from: '18:00', to: '02:00' }])
    expect(() => cleanProfile({ links: { discord: 'https://evil.example/discord.gg/x' } })).toThrow(/Discord/)
    expect(cleanProfile({ links: { discord: 'https://discord.gg/sandwalk', telegram: 'https://t.me/+AbCdEf' } }).links).toEqual({ discord: 'https://discord.gg/sandwalk', telegram: 'https://t.me/+AbCdEf' })
    // герб — лише адреса зі свого сховища
    expect(cleanProfile({ emblem: 'https://evil.example/x.png' }).emblem).toBeNull()
  })
  it('чужий бачить лише блоки «для всіх»; учасник — усе; офіцер — ще й видимість та анкету як є', () => {
    const p = cleanProfile({ rules: 'правила', requirements: 'вимоги', schedule: [{ days: [6], from: '22:00', to: '02:00' }], links: { discord: 'https://discord.gg/abc' }, show: { rules: 'guild', links: 'guild' } })
    const anon = profileFor(p, {})
    expect(anon.rules).toBe('')
    expect(anon.links).toEqual({ discord: '', telegram: '' })
    expect(anon.requirements).toBe('вимоги')
    expect(anon.show.rules).toBe('hidden')
    expect(profileFor(p, { member: true }).rules).toBe('правила')
    expect(profileFor(p, { officer: true }).show.rules).toBe('guild')
  })
  it('відповіді за анкетою: обов\'язкові, варіанти лише з переліку, рівень 1–200, години — розклад', () => {
    const form = cleanProfile({ form: { questions: [
      { id: 'about', type: 'text', label: 'Про себе', required: true },
      { id: 'role', type: 'choice', label: 'Роль', options: ['PvP', 'Крафт', 'Крафт'], multi: true },
      { id: 'lvl', type: 'level', label: 'Рівень', required: true },
      { id: 'when', type: 'hours', label: 'Коли граєш' },
    ] } }).form
    expect(form.questions[1].options).toEqual(['PvP', 'Крафт'])
    expect(() => cleanAnswers(form, { lvl: 50 })).toThrow(/Про себе/)
    expect(() => cleanAnswers(form, { about: 'я', lvl: 201 })).toThrow(/від 1 до 200/)
    expect(cleanAnswers(form, { about: ' я ', role: ['Крафт', 'Хакер'], lvl: '60', when: [{ days: [0], from: '21:00', to: '01:00' }], junk: 1 }))
      .toEqual({ about: 'я', role: ['Крафт'], lvl: 60, when: [{ days: [0], from: '21:00', to: '01:00' }] })
    expect(() => cleanProfile({ form: { questions: [{ type: 'choice', label: 'Одне', options: ['так'] }] } })).toThrow(/два варіанти/)
  })
})

describe.each(ENGINES)('%s', (_name, pgCfg) => {
  let server, base, dir, app, db
  const mail = []
  const codeFor = (email) => [...mail].reverse().find((m) => m.to === email.trim().toLowerCase())?.text.match(/\b\d{6}\b/)?.[0]
  function agent() {
    let cookie = ''
    const call = async (method, url, body, headers = {}) => {
      const raw = Buffer.isBuffer(body)
      const r = await fetch(base + url, {
        method,
        headers: { 'content-type': raw ? 'image/png' : 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}), ...headers },
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      })
      const set = r.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
      return { status: r.status, body: await r.json().catch(() => null) }
    }
    const a = {
      id: '',
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      patch: (u, b) => call('PATCH', u, b),
      del: (u, b) => call('DELETE', u, b),
      async signIn(email) {
        await a.post('/api/auth/code', { email })
        const r = await a.post('/api/auth/verify', { email, code: codeFor(email) })
        a.id = r.body?.user?.id
        return r
      },
      notes: async () => (await a.get('/api/notifications')).body,
    }
    return a
  }
  const events = []

  beforeAll(async () => {
    ;({ db, dir } = await freshDb(pgCfg, 'recruit'))
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    app.locals.guildBus.on((e) => { events.push(e) })
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    base = `http://127.0.0.1:${server.address().port}`
  })
  afterAll(async () => {
    server?.close()
    await app?.locals.close()
    await db?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const admin = agent(), lead = agent(), off = agent(), cand = agent(), anon = agent()
  let g = null

  it('гільдія з офіцером; картку й набір міняє офіцер, назву — лише лідер', async () => {
    await admin.signIn('admin@example.com') // перший — адміністратор (і лідер Sandwalkers)
    for (const [a, e] of [[lead, 'lead@example.com'], [off, 'off@example.com'], [cand, 'cand@example.com']]) await a.signIn(e)
    g = (await lead.post('/api/guilds', { name: 'Пустельні лиси', tag: 'FOX', open: false })).body.guild
    const inv = (await lead.post(`/api/guilds/${g.slug}/invites`, { role: 'member' })).body.code
    expect((await off.post(`/api/invites/${inv}/accept`)).status).toBe(200)
    expect((await lead.patch(`/api/guilds/${g.slug}/members/${off.id}`, { role: 'officer' })).status).toBe(200)

    const r = await off.patch(`/api/guilds/${g.slug}`, { open: true, about: 'Лиси Арракіса', profile: {
      server: 'Hagga 07', region: 'eu', tz: 'Europe/Kyiv', langs: ['uk', 'en'], styles: ['pvp', 'dd'],
      rules: 'Без токсичності', requirements: 'Рівень 60+', schedule: [{ days: [1, 2, 3, 4, 5], from: '20:00', to: '23:00' }],
      links: { discord: 'https://discord.gg/foxes' }, show: { rules: 'guild' },
      form: { intro: 'Розкажи про себе', questions: [
        { id: 'lvl', type: 'level', label: 'Твій рівень', required: true },
        { id: 'style', type: 'choice', label: 'Що любиш', options: ['PvP', 'Крафт'], required: true },
        { id: 'hours', type: 'hours', label: 'Коли граєш' },
      ] },
    } })
    expect(r.status).toBe(200)
    expect(r.body.profile).toMatchObject({ region: 'eu', langs: ['uk', 'en'], show: { rules: 'guild', about: 'public' } })
    expect((await off.patch(`/api/guilds/${g.slug}`, { tag: 'OFF' })).status).toBe(403)
    expect((await cand.patch(`/api/guilds/${g.slug}`, { profile: { server: 'x' } })).status).toBe(403)
    // частина картки — решта лишається
    expect((await off.patch(`/api/guilds/${g.slug}`, { profile: { show: { links: 'guild' } } })).body.profile.show).toMatchObject({ rules: 'guild', links: 'guild' })
    expect((await off.patch(`/api/guilds/${g.slug}`, { profile: { links: { discord: 'http://discord.gg/x' } } })).status).toBe(400)
  })

  it('чужий бачить лише відкрите: у сторінці, у каталозі; склад — лише керівництво', async () => {
    const d = (await anon.get(`/api/guilds/${g.slug}`)).body
    expect(d.profile.rules).toBe('')
    expect(d.profile.links.discord).toBe('')
    expect(d.profile.requirements).toBe('Рівень 60+')
    expect(d.profile.form.questions).toHaveLength(3)
    expect(d.requests).toEqual([])
    expect(d.members.map((m) => m.role).sort()).toEqual(['leader', 'officer'])
    expect(JSON.stringify(d)).not.toContain('Без токсичності')
    const card = (await anon.get('/api/guilds')).body.list.find((x) => x.id === g.id)
    expect(card.profile).toMatchObject({ server: 'Hagga 07', region: 'eu', styles: ['pvp', 'dd'], questions: 3 })
    expect(card.profile).not.toHaveProperty('form')
    expect(JSON.stringify(card)).not.toContain('Без токсичності')
    // учасник бачить правила
    expect((await off.get(`/api/guilds/${g.slug}`)).body.profile.rules).toBe('Без токсичності')
  })

  it('заявка: анкета перевіряється; офіцерам — сповіщення (одне на гільдію), кандидатові — «подано»', async () => {
    expect((await cand.post(`/api/guilds/${g.slug}/requests`, { note: 'привіт' })).status).toBe(400)
    expect((await cand.post(`/api/guilds/${g.slug}/requests`, { answers: { lvl: 300, style: ['PvP'] } })).status).toBe(400)
    const ok = await cand.post(`/api/guilds/${g.slug}/requests`, { note: 'Візьміть', tz: 'America/Chicago', answers: { lvl: 72, style: ['PvP'], hours: [{ days: [6, 0], from: '18:00', to: '22:00' }] } })
    expect(ok.status).toBe(201)
    expect(events.at(-1)).toMatchObject({ type: 'submitted', guild: { id: g.id, slug: g.slug }, user: cand.id })
    const mine = (await cand.get(`/api/guilds/${g.slug}`)).body.request
    expect(mine).toMatchObject({ status: 'pending', answers: { lvl: 72 } })
    const leadNotes = await lead.notes()
    expect(leadNotes.rows.find((n) => n.kind === 'guild.app.new')).toMatchObject({ data: { guild: g.id, slug: g.slug }, read: false })
    expect((await off.notes()).rows.some((n) => n.kind === 'guild.app.new')).toBe(true)
    expect((await cand.notes()).rows[0]).toMatchObject({ kind: 'guild.app.sent' })
    // черга офіцерів: відповіді й пояс кандидата
    const q = (await off.get(`/api/guilds/${g.slug}/requests`)).body
    expect(q.rows).toHaveLength(1)
    expect(q.rows[0]).toMatchObject({ id: cand.id, status: 'pending', tz: 'America/Chicago', note: 'Візьміть', answers: { style: ['PvP'] } })
    expect(q.form.questions).toHaveLength(3)
    expect((await cand.get(`/api/guilds/${g.slug}/requests`)).status).toBe(403)
  })

  it('коментарі офіцерів — лише офіцерам; відхилити — з причиною, кандидат її бачить', async () => {
    expect((await off.post(`/api/guilds/${g.slug}/requests/${cand.id}/comments`, { text: 'Перевірити в грі' })).status).toBe(201)
    expect((await cand.post(`/api/guilds/${g.slug}/requests/${cand.id}/comments`, { text: 'я теж' })).status).toBe(403)
    expect((await lead.get(`/api/guilds/${g.slug}`)).body.requests[0].comments).toMatchObject([{ text: 'Перевірити в грі' }])
    expect(JSON.stringify((await cand.get(`/api/guilds/${g.slug}`)).body)).not.toContain('Перевірити в грі')

    expect((await off.post(`/api/guilds/${g.slug}/requests/${cand.id}`, { accept: false, reason: '  ' })).status).toBe(400)
    expect((await off.post(`/api/guilds/${g.slug}/requests/${cand.id}`, { accept: false, reason: 'Спершу 60-й рівень' })).status).toBe(200)
    expect((await off.post(`/api/guilds/${g.slug}/requests/${cand.id}`, { accept: true })).status).toBe(409)
    expect((await cand.get(`/api/guilds/${g.slug}`)).body.request).toMatchObject({ status: 'rejected', reason: 'Спершу 60-й рівень' })
    expect((await cand.notes()).rows.find((n) => n.kind === 'guild.app.rejected')).toMatchObject({ data: { reason: 'Спершу 60-й рівень' } })
    expect(events.at(-1)).toMatchObject({ type: 'rejected', reason: 'Спершу 60-й рівень', by: off.id })
    const mine = (await cand.get('/api/guilds')).body
    expect(mine.requests).toEqual([])
    expect(mine.myRequests[0]).toMatchObject({ guild: { id: g.id }, status: 'rejected', reason: 'Спершу 60-й рівень' })
    expect((await off.get(`/api/guilds/${g.slug}/requests?show=done`)).body.rows[0]).toMatchObject({ status: 'rejected', decidedBy: expect.any(String) })
  })

  it('подати знову → чекає; прийняти → новобранець, заявка прийнята, сповіщення кандидатові', async () => {
    expect((await cand.post(`/api/guilds/${g.slug}/requests`, { answers: { lvl: 61, style: ['Крафт'] } })).status).toBe(201)
    expect((await cand.get(`/api/guilds/${g.slug}`)).body.request).toMatchObject({ status: 'pending', reason: '' })
    expect((await off.post(`/api/guilds/${g.slug}/requests/${cand.id}`, { accept: true })).status).toBe(200)
    const d = (await cand.get(`/api/guilds/${g.slug}`)).body
    expect(d.role).toBe('recruit')
    expect(d.request.status).toBe('accepted')
    expect((await cand.notes()).rows.find((n) => n.kind === 'guild.app.accepted')).toBeTruthy()
    expect(events.at(-1)).toMatchObject({ type: 'accepted', user: cand.id })
  })

  it('запрошення закриває заявку: у ту гільдію — прийнята, в інші — закриті', async () => {
    const solo = agent()
    await solo.signIn('solo@example.com')
    expect((await solo.post(`/api/guilds/sandwalkers/requests`, {})).status).toBe(403) // Sandwalkers не приймає заявок
    await admin.patch('/api/guilds/sandwalkers', { open: true })
    expect((await solo.post('/api/guilds/sandwalkers/requests', {})).status).toBe(201)
    expect((await solo.post(`/api/guilds/${g.slug}/requests`, { answers: { lvl: 10, style: ['PvP'] } })).status).toBe(201)
    const inv = (await lead.post(`/api/guilds/${g.slug}/invites`, {})).body.code
    expect((await solo.post(`/api/invites/${inv}/accept`)).status).toBe(200)
    const st = Object.fromEntries((await solo.get('/api/guilds')).body.myRequests.map((x) => [x.guild.slug, x.status]))
    expect(st).toEqual({ sandwalkers: 'closed', [g.slug]: 'accepted' })
    expect((await admin.get('/api/guilds/sandwalkers')).body.requests).toEqual([])
  })

  it('герб: офіцер завантажує зображення — квадрат WebP у сховищі; чуже — 415', async () => {
    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#c86414' } }).png().toBuffer()
    expect((await cand.post(`/api/guilds/${g.slug}/emblem`, png)).status).toBe(403)
    expect((await off.post(`/api/guilds/${g.slug}/emblem`, Buffer.from('not an image'))).status).toBe(415)
    const r = await off.post(`/api/guilds/${g.slug}/emblem`, png)
    expect(r.status).toBe(200)
    expect(r.body.emblem).toMatch(/^\/media\/uploads\/[a-f0-9]{24}\.webp$/)
    const meta = await sharp((await app.locals.storage.get(r.body.emblem.slice(7))).buf).metadata()
    expect([meta.width, meta.height, meta.format]).toEqual([512, 512, 'webp'])
    expect((await anon.get(`/api/guilds/${g.slug}`)).body.profile.emblem).toBe(r.body.emblem)
    expect((await anon.get('/api/guilds')).body.list.find((x) => x.id === g.id).profile.emblem).toBe(r.body.emblem)
  })

  it('прев\'ю посилання: факти, герб і лише відкрите', async () => {
    const file = path.join(dir, 'index.html')
    fs.writeFileSync(file, '<html><head><title>x</title></head><body></body></html>')
    const guilds = await createGuilds(db)
    const og = createOg({ file, db, guilds, items: {}, auth: {}, access: {}, thumbs: null, events: null })
    const req = { path: `/g/${g.slug}`, originalUrl: `/g/${g.slug}`, query: {}, lang: 'uk', t: fill, protocol: 'http', get: () => 'x.test' }
    const html = await og.render(req)
    expect(html).toContain('[FOX] Пустельні лиси')
    expect(html).toMatch(/og:description" content="Набір відкрито · EU · Hagga 07 · українська, англійська · PvP, Глибока пустеля · Учасників: \d+\. Лиси Арракіса/)
    expect(html).toMatch(/og:image" content="http:\/\/x\.test\/media\/uploads\/[a-f0-9]{24}\.webp"/)
    expect(html).not.toContain('Без токсичності')
    await (await createGuilds(db)).setProfile(g.id, { show: { about: 'guild' } })
    expect(await og.render(req)).not.toContain('Лиси Арракіса')
  })
})

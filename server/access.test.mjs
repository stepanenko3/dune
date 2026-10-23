// Доступи на сервері (перевірка 22.10.2026): кожен змінювальний маршрут сам перевіряє, хто питає, — без входу 401,
// без прав 403, чужого приватного «нема» (404); інтерфейс лише ховає недоступне. Ролі: анонім, людина без гільдії,
// новобранець / учасник / офіцер / лідер гільдії, власник речі й інший. Читання: приватне й гільдійське не потрапляє
// стороннім ні в списки, ні в живі оновлення (SSE), ні у вивантаження чи історію версій.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'

const tiny = (name) => ({
  format: 2,
  claims: [{ x: -5, y: 0, w: 10, d: 10 }],
  pieces: [{ id: 'p1', shape: 'Sardaukar_Foundation', x: 0.5, y: 0.5, z: 0, rot: 0 }, { id: 'p2', shape: 'Sardaukar_Wall_01', x: 0.5, y: 0, z: 0, rot: 0 }],
  items: [],
  zones: [],
  ui: { name },
})
const HOUR = 3600_000
const duel = (extra = {}) => ({
  title: 'Бій 2 на 2', type: 'pvp', starts: Date.now() + 48 * HOUR, duration: 90, region: 'eu', server: 'Hagga 12',
  place: 'Скелі', arena: { map: 'survival_1', x: 1000, y: -2000 }, reg: { open: true, teamSize: 2, slots: 4, approval: true },
  prizes: [], about: '', visibility: 'public', ...extra,
})

describe('доступи', () => {
  let server, base, dir, app
  const mail = []
  const codeFor = (email) => [...mail].reverse().find((m) => m.to === email.trim().toLowerCase())?.text.match(/\b\d{6}\b/)?.[0]

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
      get cookie() { return cookie },
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      put: (u, b) => call('PUT', u, b),
      patch: (u, b) => call('PATCH', u, b),
      del: (u, b) => call('DELETE', u, b),
      async signIn(email) {
        await a.post('/api/auth/code', { email })
        const r = await a.post('/api/auth/verify', { email, code: codeFor(email) })
        a.id = r.body?.user?.id
        return r
      },
      /** що прийде в живий потік за ms мілісекунд, поки виконується act() */
      async listen(url, act, ms = 400) {
        const ctl = new AbortController()
        const r = await fetch(base + url, { headers: cookie ? { cookie } : {}, signal: ctl.signal })
        const reader = r.body.getReader()
        let text = ''
        const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value) } } catch { /* закрили */ } })()
        await act()
        await new Promise((ok) => setTimeout(ok, ms))
        ctl.abort()
        await pump
        return text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)))
      },
    }
    return a
  }

  const admin = agent(), leader = agent(), officer = agent(), member = agent(), recruit = agent(), stranger = agent(), other = agent(), anon = agent()
  let slug, gid, gbase, rmap

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-access-'))
    const db = await openDb({ dataDir: dir, pg: null })
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    base = `http://127.0.0.1:${server.address().port}`
    await admin.signIn('admin@example.com')
    for (const [a, e] of [[leader, 'leader'], [officer, 'officer'], [member, 'member'], [recruit, 'recruit'], [stranger, 'stranger'], [other, 'other']]) await a.signIn(`${e}@example.com`)
    // гільдія лідера: офіцер, учасник і новобранець — запрошеннями
    const g = await leader.post('/api/guilds', { name: 'Тестова гільдія', tag: 'TST' })
    slug = g.body.guild.slug
    gid = g.body.guild.id
    for (const [a, role] of [[officer, 'member'], [member, 'member'], [recruit, 'recruit']]) {
      const i = await leader.post(`/api/guilds/${slug}/invites`, { role })
      expect((await a.post(`/api/invites/${i.body.code}/accept`)).status).toBe(200)
    }
    expect((await leader.patch(`/api/guilds/${slug}/members/${officer.id}`, { role: 'officer' })).status).toBe(200)
    gbase = (await member.post('/api/bases', { doc: tiny('Гільдійська'), owner: { kind: 'guild', id: gid }, visibility: 'guild' })).body
    rmap = (await member.post('/api/roadmaps', { title: 'Гільдійський роадмап', owner: { kind: 'guild', id: gid }, visibility: 'guild' })).body
  })
  afterAll(async () => {
    server?.close()
    await app?.locals.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('без входу кожна зміна — 401', async () => {
    const id = gbase.id
    const calls = [
      ['post', '/api/bases', { doc: tiny('x') }], ['post', '/api/bases/import', { doc: tiny('x') }], ['post', '/api/bases/generate', {}],
      ['put', `/api/bases/${id}`, { doc: tiny('x'), version: 1 }], ['put', `/api/bases/${id}/calc`, { calc: null }], ['delete', `/api/bases/${id}`],
      ['post', `/api/bases/${id}/undelete`], ['post', `/api/bases/${id}/purge`], ['post', `/api/bases/${id}/history/1/restore`],
      ['post', '/api/roadmaps', { title: 'x' }], ['put', `/api/roadmaps/${rmap.id}`, { doc: {}, version: 1 }], ['post', `/api/roadmaps/${rmap.id}/progress`, { kind: 's', id: 'x', value: 'done' }],
      ['patch', `/api/roadmaps/${rmap.id}/access-settings`, {}], ['post', '/api/builds', { name: 'x' }], ['post', '/api/calcs', { name: 'x', code: 'a' }],
      ['post', '/api/markers', { title: 'x' }], ['post', '/api/places', { res: 'x', place: 'y' }], ['patch', '/api/places/x', { res: 'y' }], ['delete', '/api/places/x'],
      ['post', '/api/map/spice', { map: 'survival_1', x: 0, y: 0, size: 'small', visibility: 'public' }],
      ['post', '/api/events', duel()], ['post', '/api/guilds', { name: 'Аноніми', tag: 'ANO' }], ['post', `/api/guilds/${slug}/requests`, {}],
      ['patch', `/api/items/base/${id}/access`, { visibility: 'public' }], ['patch', `/api/items/base/${id}/rights`, { edit: 'owner' }],
      ['post', `/api/items/base/${id}/copy`], ['post', `/api/items/base/${id}/star`], ['patch', '/api/me', { name: 'x' }], ['post', '/api/push/subscribe', {}],
    ]
    for (const [m, u, b] of calls) {
      const r = await anon[m === 'delete' ? 'del' : m](u, b)
      expect(r.status, `${m} ${u}`).toBe(401)
    }
    expect((await anon.get(`/api/bases/${id}/export`)).status).toBe(401)
  })

  it('гільдійська база: сторонньому — нема, новобранець дивиться, учасник змінює, офіцер видаляє, лідер стирає', async () => {
    const id = gbase.id
    expect((await stranger.get(`/api/bases/${id}`)).status).toBe(404)
    expect((await stranger.put(`/api/bases/${id}`, { doc: tiny('чуже'), version: gbase.version })).status).toBe(404)
    const seen = await recruit.get(`/api/bases/${id}`)
    expect(seen.status).toBe(200)
    expect(seen.body.item.can).toMatchObject({ view: true, edit: false, manage: false, own: false })
    expect((await recruit.put(`/api/bases/${id}`, { doc: tiny('новобранець'), version: gbase.version })).status).toBe(403)
    expect((await recruit.put(`/api/bases/${id}/calc`, { calc: null })).status).toBe(403)
    expect((await recruit.del(`/api/bases/${id}`)).status).toBe(403)
    const put = await member.put(`/api/bases/${id}`, { doc: tiny('Гільдійська 2'), version: gbase.version })
    expect(put.status).toBe(200)
    expect((await member.del(`/api/bases/${id}`)).status).toBe(403)
    expect((await member.patch(`/api/items/base/${id}/access`, { visibility: 'public' })).status).toBe(403)
    // офіцер міняє видимість, але не віддає гільдійське собі
    expect((await officer.patch(`/api/items/base/${id}/access`, { owner: { kind: 'user', id: officer.id }, visibility: 'private' })).status).toBe(403)
    expect((await officer.patch(`/api/items/base/${id}/access`, { visibility: 'link' })).status).toBe(200)
    expect((await officer.patch(`/api/items/base/${id}/access`, { visibility: 'guild' })).status).toBe(200)
    expect((await officer.del(`/api/bases/${id}`)).status).toBe(200)
    expect((await officer.post(`/api/bases/${id}/purge`)).status).toBe(403)
    expect((await officer.post(`/api/bases/${id}/undelete`)).status).toBe(200)
  })

  it('права бази: історію закрито — не відкривається й відновленням версії', async () => {
    const id = gbase.id
    // лише лідер (рівень «власник» у гільдії) бачить історію; змінюють, як і раніше, учасники
    expect((await member.patch(`/api/items/base/${id}/rights`, { history: 'owner' })).status).toBe(403)
    expect((await leader.patch(`/api/items/base/${id}/rights`, { history: 'owner' })).status).toBe(200)
    const b = await member.get(`/api/bases/${id}`)
    expect(b.body.item.can).toMatchObject({ edit: true, history: false })
    expect((await member.get(`/api/bases/${id}/history`)).status).toBe(403)
    const h = await leader.get(`/api/bases/${id}/history`)
    expect(h.status).toBe(200)
    const old = h.body.rows.find((r) => !r.current)
    expect(old).toBeTruthy()
    expect((await member.get(`/api/bases/${id}/history/${old.hid}`)).status).toBe(403)
    expect((await member.post(`/api/bases/${id}/history/${old.hid}/restore`)).status).toBe(403)
    expect((await leader.post(`/api/bases/${id}/history/${old.hid}/restore`)).status).toBe(200)
    expect((await leader.patch(`/api/items/base/${id}/rights`, { history: 'member' })).status).toBe(200)
  })

  it('роадмап: відновити версію — лише тому, хто бачить історію', async () => {
    const id = rmap.id
    const cur = await member.get(`/api/roadmaps/${id}`)
    const doc = { ...cur.body.doc, title: 'Гільдійський роадмап 2' }
    expect((await member.put(`/api/roadmaps/${id}`, { doc, version: cur.body.version })).status).toBe(200)
    expect((await recruit.put(`/api/roadmaps/${id}`, { doc, version: cur.body.version + 1 })).status).toBe(403)
    expect((await officer.patch(`/api/roadmaps/${id}/access-settings`, { history: 'officer' })).status).toBe(200)
    expect((await member.get(`/api/roadmaps/${id}/history`)).status).toBe(403)
    const h = await officer.get(`/api/roadmaps/${id}/history`)
    const old = h.body.rows.find((r) => r.hid)
    expect(old).toBeTruthy()
    expect((await member.post(`/api/roadmaps/${id}/history/${old.hid}/restore`)).status).toBe(403)
    expect((await officer.post(`/api/roadmaps/${id}/history/${old.hid}/restore`)).status).toBe(200)
    expect((await recruit.del(`/api/roadmaps/${id}`)).status).toBe(403)
    expect((await stranger.get(`/api/roadmaps/${id}`)).status).toBe(404)
  })

  it('особисте й «за посиланням»: власник vs інший; копія й вивантаження — за правом «копіювати»', async () => {
    const priv = (await other.post('/api/bases', { doc: tiny('Моя'), visibility: 'private' })).body
    const link = (await other.post('/api/bases', { doc: tiny('Посилання'), visibility: 'link' })).body
    expect((await stranger.get(`/api/bases/${priv.id}`)).status).toBe(404)
    expect((await stranger.get(`/api/bases/${priv.id}/export`)).status).toBe(404)
    expect((await stranger.get(`/api/bases/${priv.id}/history`)).status).toBe(404)
    expect((await stranger.post(`/api/items/base/${priv.id}/copy`)).status).toBe(404)
    expect((await stranger.post('/api/bases', { from: priv.id })).status).toBe(404)
    expect((await stranger.get(`/api/bases/${link.id}`)).status).toBe(200)
    expect((await stranger.put(`/api/bases/${link.id}`, { doc: tiny('чуже'), version: link.version })).status).toBe(403)
    expect((await stranger.patch(`/api/items/base/${link.id}/access`, { visibility: 'public' })).status).toBe(403)
    expect((await stranger.get(`/api/bases/${link.id}/export`)).status).toBe(200)
    // власник заборонив копії — ні копії, ні файлу (файл і є копія)
    expect((await other.patch(`/api/items/base/${link.id}/rights`, { copy: 'nobody' })).status).toBe(200)
    expect((await stranger.get(`/api/bases/${link.id}`)).body.item.can.copy).toBe(false)
    expect((await stranger.post(`/api/items/base/${link.id}/copy`)).status).toBe(403)
    expect((await stranger.post('/api/bases', { from: link.id })).status).toBe(403)
    expect((await stranger.get(`/api/bases/${link.id}/export`)).status).toBe(403)
    expect((await other.get(`/api/bases/${link.id}/export`)).status).toBe(200)
    // «за посиланням» — не в списках інших
    const lib = await stranger.get('/api/library?kind=base')
    expect(lib.body.rows.some((r) => r.id === link.id || r.id === priv.id)).toBe(false)
    const pub = await stranger.get('/api/bases?scope=public')
    expect(pub.body.bases.some((r) => r.id === link.id || r.id === priv.id)).toBe(false)
  })

  it('списки: гільдійське бачать лише свої', async () => {
    for (const a of [stranger, anon]) {
      expect((await a.get(`/api/items?scope=guild:${gid}`)).body.rows).toEqual([])
      expect((await a.get(`/api/bases?scope=guild:${gid}`)).body.bases).toEqual([])
      expect((await a.get('/api/roadmaps?scope=shared')).body.rows.some((r) => r.id === rmap.id)).toBe(false)
    }
    expect((await recruit.get(`/api/items?scope=guild:${gid}`)).body.rows.length).toBeGreaterThan(0)
    const page = await stranger.get(`/api/guilds/${slug}`)
    expect(page.body.members.every((m) => m.role === 'leader' || m.role === 'officer')).toBe(true)
    expect(page.body.invites).toEqual([])
    expect(page.body.requests).toEqual([])
    const mine = await recruit.get(`/api/guilds/${slug}`)
    expect(mine.body.members.length).toBe(4)
    expect(mine.body.invites).toEqual([])
  })

  it('живі оновлення: зміна гільдійської бази доходить лише до своїх', async () => {
    const id = gbase.id
    const cur = await member.get(`/api/bases/${id}`)
    const save = () => member.put(`/api/bases/${id}`, { doc: tiny('Гільдійська 3'), version: cur.body.version })
    const [outside, inside] = await Promise.all([stranger.listen('/api/bases/stream', async () => {}, 900), recruit.listen('/api/bases/stream', async () => { await new Promise((r) => setTimeout(r, 200)); await save() }, 600)])
    expect(inside.some((e) => e.id === id)).toBe(true)
    expect(outside.some((e) => e.id === id)).toBe(false)
  })

  it('гільдія: запрошують і приймають офіцери, ролі й налаштування — за рангом', async () => {
    expect((await recruit.post(`/api/guilds/${slug}/invites`, {})).status).toBe(403)
    expect((await member.post(`/api/guilds/${slug}/invites`, {})).status).toBe(403)
    expect((await stranger.post(`/api/guilds/${slug}/invites`, {})).status).toBe(403)
    const inv = await officer.post(`/api/guilds/${slug}/invites`, {})
    expect(inv.status).toBe(201)
    expect((await member.del(`/api/guilds/${slug}/invites/${inv.body.code}`)).status).toBe(403)
    expect((await officer.del(`/api/guilds/${slug}/invites/${inv.body.code}`)).status).toBe(200)
    // офіцер не призначає офіцерів і не чіпає рівних; учасник — нікого
    expect((await officer.patch(`/api/guilds/${slug}/members/${member.id}`, { role: 'officer' })).status).toBe(403)
    expect((await member.patch(`/api/guilds/${slug}/members/${recruit.id}`, { role: 'member' })).status).toBe(403)
    expect((await member.del(`/api/guilds/${slug}/members/${recruit.id}`)).status).toBe(403)
    expect((await officer.del(`/api/guilds/${slug}/members/${leader.id}`)).status).not.toBe(200)
    // опис і картку гільдії міняє й офіцер (набір — його справа); назву й тег — лише лідер
    expect((await officer.patch(`/api/guilds/${slug}`, { about: 'офіцер' })).status).toBe(200)
    expect((await officer.patch(`/api/guilds/${slug}`, { name: 'Офіцерська' })).status).toBe(403)
    expect((await officer.del(`/api/guilds/${slug}`)).status).toBe(403)
    expect((await stranger.patch(`/api/guilds/${slug}`, { about: 'чужий' })).status).toBe(403)
    expect((await leader.patch(`/api/guilds/${slug}`, { about: 'лідер' })).status).toBe(200)
    // заявки: розглядають офіцери
    await leader.patch(`/api/guilds/${slug}`, { open: true })
    expect((await stranger.post(`/api/guilds/${slug}/requests`, { note: 'візьміть' })).status).toBe(201)
    expect((await member.post(`/api/guilds/${slug}/requests/${stranger.id}`, { accept: true })).status).toBe(403)
    // відхилити — лише з причиною (її побачить кандидат)
    expect((await officer.post(`/api/guilds/${slug}/requests/${stranger.id}`, { accept: false })).status).toBe(400)
    expect((await officer.post(`/api/guilds/${slug}/requests/${stranger.id}`, { accept: false, reason: 'набрали людей' })).status).toBe(200)
    // новобранець не створює від імені гільдії
    expect((await recruit.post('/api/bases', { doc: tiny('x'), owner: { kind: 'guild', id: gid } })).status).toBe(403)
    const notIn = await stranger.post('/api/roadmaps', { title: 'x', owner: { kind: 'guild', id: gid } })
    expect(notIn.status).toBe(403)
    expect(notIn.body.error).toMatch(/не в цій гільдії/)
    expect((await recruit.post('/api/roadmaps', { title: 'x', owner: { kind: 'guild', id: gid } })).body.error).toMatch(/новобранець/)
  })

  it('подія: змінює організатор, рішення про команди — теж він', async () => {
    const ev = (await other.post('/api/events', duel())).body
    expect((await stranger.put(`/api/events/${ev.id}`, { title: 'Чужа' })).status).toBe(403)
    expect((await stranger.del(`/api/events/${ev.id}`)).status).toBe(403)
    const reg = await stranger.post(`/api/events/${ev.id}/teams`, { name: 'Чужинці', members: ['Stranger', 'Friend'] })
    expect(reg.status).toBe(201)
    const tm = reg.body.teams.find((x) => x.mine)
    expect((await stranger.patch(`/api/events/${ev.id}/teams/${tm.id}`, { status: 'confirmed' })).status).toBe(403)
    expect((await member.patch(`/api/events/${ev.id}/teams/${tm.id}`, { name: 'Не моя' })).status).toBe(403)
    expect((await member.del(`/api/events/${ev.id}/teams/${tm.id}`)).status).toBe(403)
    expect((await other.patch(`/api/events/${ev.id}/teams/${tm.id}`, { status: 'confirmed' })).status).toBe(200)
    // приватна подія — сторонньому її нема (і в списку теж)
    const priv = (await other.post('/api/events', duel({ title: 'Приватне тренування', visibility: 'private' }))).body
    expect((await stranger.get(`/api/events/${priv.id}`)).status).toBe(404)
    expect((await stranger.get(`/api/events/${priv.id}/calendar.ics`)).status).toBe(404)
    expect((await stranger.get('/api/events')).body.rows.some((r) => r.id === priv.id)).toBe(false)
  })

  it('записи ресурсів і позначки: чуже не змінити й не видалити', async () => {
    const p = (await other.post('/api/places', { res: 'Спайс', place: 'Скелі', visibility: 'public' })).body
    expect((await stranger.patch(`/api/places/${p.id}`, { res: 'Чужий' })).status).toBe(403)
    expect((await stranger.del(`/api/places/${p.id}`)).status).toBe(403)
    expect((await stranger.patch(`/api/places/${p.id}`, { addPins: [{ map: 'survival_1', x: 0, y: 0 }] })).status).toBe(403)
    const g = (await member.post('/api/places', { res: 'Гільдійський', place: 'Тут', owner: { kind: 'guild', id: gid }, visibility: 'guild' })).body
    expect((await stranger.get(`/api/places/${g.id}`)).status).toBe(404)
    expect((await recruit.patch(`/api/places/${g.id}`, { res: 'Новобранець' })).status).toBe(403)
    expect((await member.del(`/api/places/${g.id}`)).status).toBe(403)
    expect((await officer.del(`/api/places/${g.id}`)).status).toBe(200)
    const pub = await stranger.get('/api/map/public?kind=place')
    expect(pub.body.rows.some((r) => r.id === g.id)).toBe(false)
  })
})

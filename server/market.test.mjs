// Біржа через справжній HTTP: оголошення (перевірка документа, предмети, що не продаються, правило RMT, ліміт
// відкритих), видимість у стрічці й книзі (гільдійське — лише своїм), фільтри (світ — без різниці в регістрі й дефісах),
// автоматичний збіг зі сповіщеннями (раз на пару), угода від пропозиції до оцінок (залишок не йде в мінус), медіана й
// історія, скарги (три RMT — сховано), заборона біржі, строки. Двічі: на SQLite і на Postgres <база>_testing.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.mjs'
import { openDb } from './lib/sql.mjs'
import { rmtHit, worldKey } from './lib/market.mjs'
import { createOg } from './lib/og.mjs'
import { createI18n } from './lib/i18n.mjs'

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-market-'))
  if (!pgCfg) return { db: await openDb({ dataDir: dir }), dir }
  const schema = `mk_${crypto.randomBytes(4).toString('hex')}`
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
  return { db, dir }
}

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
const DAY = 86400_000
const ids = (rows) => rows.map((x) => x.id)

describe('ключ світу й ознаки RMT', () => {
  it('світ: регістр, дефіси, підкреслення й пробіли — одне', () => {
    expect(worldKey('Hagga-EU_7')).toBe('hagga eu 7')
    expect(worldKey('  hagga eu  7 ')).toBe('hagga eu 7')
  })
  it('RMT: валюти, платіжки, «реальні гроші»; соларі й спайс — ні', () => {
    for (const s of ['5$', '$10', '10 €', 'paypal', 'PayPal', 'за 100 грн', 'usdt', 'реальні гроші', 'real money', '20 euro']) expect(rmtHit(s)).not.toBeNull()
    for (const s of ['100 Solari', '500 соларів', 'спайс за смолу', 'EU сервер', 'Europe']) expect(rmtHit(s)).toBeNull()
  })
})

describe.each(ENGINES)('%s', (_name, pgCfg) => {
  let server, base, dir, app, db
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
      const text = await r.text()
      let json = null
      try { json = JSON.parse(text) } catch { /* не JSON */ }
      return { status: r.status, body: json }
    }
    const a = {
      id: null,
      get: (u) => call('GET', u),
      post: (u, b = {}) => call('POST', u, b),
      put: (u, b) => call('PUT', u, b),
      patch: (u, b) => call('PATCH', u, b),
      del: (u, b) => call('DELETE', u, b),
      async signIn(email) {
        await a.post('/api/auth/code', { email })
        const r = await a.post('/api/auth/verify', { email, code: codeFor(email) })
        a.id = (await a.get('/api/me')).body?.user?.id ?? (await a.get('/api/me')).body?.id
        return r
      },
    }
    return a
  }

  beforeAll(async () => {
    ;({ db, dir } = await freshDb(pgCfg))
    app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
    await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
    base = `http://127.0.0.1:${server.address().port}`
    const t = Date.now()
    // предмети гри: смола спайсу (сировина), гвинтівка т5 (рідкісна), ще один ресурс для бартеру; не продаються —
    // прихований від біржі гри, контракт, сама валюта
    await db.run(`INSERT INTO game_items (id, name, icon, grade, cat, sub, kind, rarity, updated) VALUES
      ('SpiceResin', 'Spice Resin', NULL, 0, 'misc', NULL, 'RawResources', NULL, ?),
      ('Rifle_T5', 'Karpov 38', NULL, 5, 'weapon', 'rifle', 'Holsters', 'Rare', ?),
      ('Water', 'Water', NULL, 0, 'misc', NULL, 'RawResources', NULL, ?),
      ('HideMe', 'Quest Token', NULL, 0, 'misc', NULL, 'HideFromExchange', NULL, ?),
      ('Contract_X', 'Some Contract', NULL, 0, 'contract', 'contract', 'Contract', NULL, ?),
      ('Solari', 'Solari', NULL, 0, 'misc', NULL, 'Solaris', NULL, ?)`, t, t, t, t, t, t)
    await db.run("INSERT INTO game_texts (kind, id, lang, name, source, updated) VALUES ('item', 'SpiceResin', 'uk', 'Смола спайсу', 'game', ?)", t)
  })
  afterAll(async () => {
    server?.close()
    await app?.locals.close()
    await db?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const admin = agent(), bob = agent(), eve = agent(), carol = agent(), dave = agent(), frank = agent(), mod = agent(), anon = agent()
  const sell = (extra = {}) => ({ side: 'sell', gid: 'SpiceResin', qty: 1000, pay: 'solari', price: 100, region: 'eu', world: 'Hagga-EU_7', ttl: 7, contact: { site: true, nick: 'BobTheSeller' }, note: 'Біля Арракіна', rules: true, ...extra })
  const buy = (extra = {}) => sell({ side: 'buy', price: 120, qty: 300, contact: { site: true, nick: 'Eve' }, note: '', ...extra })
  const L = {}

  it('вхід: адміністратор (перший), продавці, покупці, модератор', async () => {
    expect((await admin.signIn('admin@example.com')).status).toBe(201)
    for (const [a, email] of [[bob, 'bob@example.com'], [eve, 'eve@example.com'], [carol, 'carol@example.com'], [dave, 'dave@example.com'], [frank, 'frank@example.com'], [mod, 'mod@example.com']]) {
      expect((await a.signIn(email)).status).toBe(201)
    }
    await db.run("UPDATE users SET role = 'moderator' WHERE email = 'mod@example.com'")
  })

  describe('оголошення', () => {
    it('створення: правило RMT, предмет, що продається, поля; без входу — 401', async () => {
      expect((await anon.post('/api/market', sell())).status).toBe(401)
      expect((await bob.post('/api/market', sell({ rules: false }))).status).toBe(400)
      for (const gid of ['HideMe', 'Contract_X', 'Solari', 'Nope']) expect((await bob.post('/api/market', sell({ gid }))).status).toBe(400)
      expect((await bob.post('/api/market', sell({ note: 'або 5$ на paypal' }))).status).toBe(400)
      expect((await bob.post('/api/market', sell({ qty: 0 }))).status).toBe(400)
      expect((await bob.post('/api/market', sell({ minQty: 2000 }))).status).toBe(400)
      expect((await bob.post('/api/market', sell({ price: null }))).status).toBe(400)
      expect((await bob.post('/api/market', sell({ pay: 'barter', barter: [] }))).status).toBe(400)
      expect((await bob.post('/api/market', sell({ region: 'mars' }))).status).toBe(400)
      expect((await bob.post('/api/market', sell({ world: ' ' }))).status).toBe(400)
      expect((await bob.post('/api/market', sell({ contact: { site: false, nick: '' } }))).status).toBe(400)
      const r = await bob.post('/api/market', sell())
      expect(r.status).toBe(201)
      L.bob = r.body
      expect(r.body).toMatchObject({ side: 'sell', gid: 'SpiceResin', qty: 1000, left: 1000, price: 100, status: 'open', rights: { edit: true, manage: true, offer: false } })
      expect(r.body.expires - r.body.fresh).toBe(7 * DAY)
      expect(r.body.item).toMatchObject({ kind: 'listing', visibility: 'public', owner: { kind: 'user' }, trade: { side: 'sell', gid: 'SpiceResin', qty: 1000 } })
    })

    it('бачать усі, нік — лише ті, хто увійшов; оголошення не копіюються', async () => {
      const a = await anon.get(`/api/market/${L.bob.id}`)
      expect(a.status).toBe(200)
      expect(a.body.contact).toMatchObject({ site: true, hidden: true })
      expect(a.body.contact.nick).toBeUndefined()
      expect((await dave.get(`/api/market/${L.bob.id}`)).body.contact.nick).toBe('BobTheSeller')
      expect((await dave.post(`/api/items/listing/${L.bob.id}/copy`, {})).status).toBeGreaterThanOrEqual(400)
    })

    it('гільдійське — лише своїм: у стрічці, на сторінці й у книзі', async () => {
      const me = (await admin.get('/api/me')).body
      const gid = me.guild?.id ?? me.guilds?.[0]?.id
      expect(gid).toBeTruthy()
      expect((await dave.post('/api/market', sell({ owner: { kind: 'guild', id: gid } }))).status).toBe(403)
      const g = await admin.post('/api/market', sell({ owner: { kind: 'guild', id: gid }, visibility: 'guild', price: 90, world: 'hagga eu 7' }))
      expect(g.status).toBe(201)
      L.guild = g.body
      expect(ids((await admin.get('/api/market')).body.rows)).toContain(L.guild.id)
      expect(ids((await dave.get('/api/market')).body.rows)).not.toContain(L.guild.id)
      expect(ids((await anon.get('/api/market')).body.rows)).not.toContain(L.guild.id)
      expect((await dave.get(`/api/market/${L.guild.id}`)).status).toBe(404)
      expect(ids((await dave.get('/api/market/item/SpiceResin')).body.book.sell)).not.toContain(L.guild.id)
      expect(ids((await admin.get('/api/market/item/SpiceResin')).body.book.sell)).toContain(L.guild.id)
    })

    it('фільтри: вид, розділ, регіон, світ без різниці в написанні, ціна, пошук назвою мовою людини', async () => {
      const rifle = await carol.post('/api/market', sell({ gid: 'Rifle_T5', qty: 1, price: 50000, world: 'Arrakis 3', region: 'na', contact: { site: true, nick: '' } }))
      expect(rifle.status).toBe(201)
      L.rifle = rifle.body
      const q = async (s) => ids((await dave.get(`/api/market?${s}`)).body.rows)
      expect(await q('side=sell')).toEqual(expect.arrayContaining([L.bob.id, L.rifle.id]))
      expect(await q('side=buy')).toEqual([])
      expect(await q('cat=weapon')).toEqual([L.rifle.id])
      expect(await q('region=na')).toEqual([L.rifle.id])
      expect(await q(`world=${encodeURIComponent('HAGGA eu-7')}`)).toEqual([L.bob.id])
      expect(await q('min=1000')).toEqual([L.rifle.id])
      expect(await q('max=1000')).toEqual([L.bob.id])
      expect(await q(`q=${encodeURIComponent('смола')}`)).toEqual([L.bob.id])
      expect(await q('q=karpov')).toEqual([L.rifle.id])
      expect(await q('sort=dear')).toEqual([L.rifle.id, L.bob.id])
    })

    it('ліміт відкритих: третє — 409, закрив одне — можна; закрите не в стрічці', async () => {
      await db.run("INSERT INTO settings (k, v) VALUES ('limits', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify({ user: { listing: 2 }, guild: {} }))
      const one = await dave.post('/api/market', sell({ price: 300 }))
      expect(one.status).toBe(201)
      expect((await dave.post('/api/market', sell({ price: 301 }))).status).toBe(201)
      expect((await dave.post('/api/market', sell({ price: 302 }))).status).toBe(409)
      expect((await dave.post(`/api/market/${one.body.id}/close`)).body.status).toBe('closed')
      expect(ids((await anon.get('/api/market')).body.rows)).not.toContain(one.body.id)
      const third = await dave.post('/api/market', sell({ price: 303 }))
      expect(third.status).toBe(201)
      // продовжити закрите — знову ліміт
      expect((await dave.post(`/api/market/${one.body.id}/renew`, { ttl: 3 })).status).toBe(409)
      await db.run("DELETE FROM settings WHERE k = 'limits'")
      // своє «Мої» — разом із закритими
      expect(ids((await dave.get('/api/market?scope=mine&state=all')).body.rows)).toContain(one.body.id)
      for (const id of ids((await dave.get('/api/market?scope=mine&state=all')).body.rows)) expect((await dave.del(`/api/market/${id}`)).status).toBe(200)
    })

    it('строк минув — немає в стрічці одразу, ще до фонової задачі; задача закриває й сповіщає', async () => {
      const r = await frank.post('/api/market', sell({ gid: 'Water', price: 2 }))
      await db.run('UPDATE market_listings SET expires = ? WHERE id = ?', Date.now() - 1000, r.body.id)
      expect(ids((await anon.get('/api/market')).body.rows)).not.toContain(r.body.id)
      expect((await eve.post(`/api/market/${r.body.id}/deals`, { qty: 1 })).status).toBe(409)
      const gone = await app.locals.marketExpire()
      expect(ids(gone)).toEqual([r.body.id])
      const notes = (await frank.get('/api/notifications')).body
      expect(notes.rows[0]).toMatchObject({ kind: 'market.expired', data: { listing: r.body.id } })
      const back = await frank.post(`/api/market/${r.body.id}/renew`, { ttl: 1 })
      expect(back.body).toMatchObject({ status: 'open' })
      expect(back.body.expires - back.body.fresh).toBe(DAY)
      await frank.post(`/api/market/${r.body.id}/close`)
    })
  })

  describe('збіг і сповіщення', () => {
    it('«Куплю» дорожче за «Продам» того ж світу — автор «Продам» отримує сповіщення; раз на пару', async () => {
      const before = (await bob.get('/api/notifications')).body.unread
      const r = await eve.post('/api/market', buy({ world: 'HAGGA EU 7' }))
      expect(r.status).toBe(201)
      L.eve = r.body
      const notes = (await bob.get('/api/notifications')).body
      expect(notes.unread).toBe(before + 1)
      expect(notes.rows[0]).toMatchObject({ kind: 'market.match', data: { listing: L.bob.id, other: L.eve.id, gid: 'SpiceResin' } })
      // автор нового бачить збіги на сторінці й теж отримує сповіщення
      expect(ids(r.body.matches)).toContain(L.bob.id)
      expect((await eve.get('/api/notifications')).body.rows[0]).toMatchObject({ kind: 'market.match', data: { listing: L.eve.id } })
      // гільдійське «Продам» Єва не бачить — ні в збігах, ні сповіщенням про нього
      expect(ids(r.body.matches)).not.toContain(L.guild.id)
      // продовження не шле вдруге
      await eve.post(`/api/market/${L.eve.id}/renew`, { ttl: 7 })
      expect((await bob.get('/api/notifications')).body.unread).toBe(before + 1)
    })

    it('дешевше «Куплю» чи інший світ — не збіг; сповіщення можна прочитати', async () => {
      const r = await frank.post('/api/market', buy({ price: 50 }))
      expect(r.body.matches).toEqual([])
      const other = await frank.post('/api/market', buy({ world: 'Other World' }))
      expect(other.body.matches).toEqual([])
      for (const x of [r, other]) await frank.del(`/api/market/${x.body.id}`)
      expect((await bob.post('/api/notifications/read', { all: true })).body.unread).toBe(0)
      expect((await anon.get('/api/notifications')).status).toBe(401)
    })
  })

  describe('угода', () => {
    const D = {}
    it('пропозиція: не на своє, не більше залишку, одна активна від людини', async () => {
      expect((await bob.post(`/api/market/${L.bob.id}/deals`, { qty: 1 })).status).toBe(400)
      expect((await eve.post(`/api/market/${L.bob.id}/deals`, { qty: 5000 })).status).toBe(400)
      const r = await eve.post(`/api/market/${L.bob.id}/deals`, { qty: 600, text: 'Заберу біля Арракіна' })
      expect(r.status).toBe(201)
      D.eve = r.body
      expect(r.body).toMatchObject({ status: 'offered', qty: 600, price: 100, role: 'maker' })
      expect(r.body.messages).toHaveLength(1)
      expect((await eve.post(`/api/market/${L.bob.id}/deals`, { qty: 1 })).status).toBe(409)
      expect((await bob.get('/api/notifications')).body.rows[0]).toMatchObject({ kind: 'market.offer', data: { deal: D.eve.id } })
      // сторонній угоди не бачить
      expect((await dave.get(`/api/market/deals/${D.eve.id}`)).status).toBe(404)
      expect((await bob.get(`/api/market/deals/${D.eve.id}`)).body.role).toBe('owner')
    })

    it('дві пропозиції разом більші за залишок: друга «Прийняти» — 409, залишок не в мінус', async () => {
      const r = await frank.post(`/api/market/${L.bob.id}/deals`, { qty: 600 })
      D.frank = r.body
      const [a, b] = await Promise.all([bob.post(`/api/market/deals/${D.eve.id}/accept`), bob.post(`/api/market/deals/${D.frank.id}/accept`)])
      expect([a.status, b.status].sort()).toEqual([200, 409])
      // хто з двох устиг першим — той і в угоді; другу пропозицію відхиляємо
      const [won, lost] = a.status === 200 ? [D.eve, D.frank] : [D.frank, D.eve]
      D.main = won
      D.who = won === D.eve ? eve : frank
      expect((a.status === 200 ? a : b).body).toMatchObject({ status: 'accepted', role: 'taker' })
      expect((await D.who.get('/api/notifications')).body.rows[0]).toMatchObject({ kind: 'market.accepted' })
      expect((await bob.post(`/api/market/deals/${lost.id}/decline`, { reason: 'вже домовився' })).body.status).toBe('declined')
    })

    it('листування — сторонам; оцінка до завершення — 409; обидва «Завершено» — угода done, залишок менше', async () => {
      expect((await bob.post(`/api/market/deals/${D.main.id}/messages`, { text: 'Завтра о 20:00' })).status).toBe(201)
      expect((await bob.post(`/api/market/deals/${D.main.id}/messages`, { text: 'або 10$ paypal' })).status).toBe(400)
      expect((await dave.post(`/api/market/deals/${D.main.id}/messages`, { text: 'привіт' })).status).toBe(404)
      const n = (await D.who.get('/api/notifications')).body.rows.find((x) => x.kind === 'market.message')
      expect(n).toMatchObject({ data: { deal: D.main.id } })
      expect((await D.who.post(`/api/market/deals/${D.main.id}/rate`, { score: 5 })).status).toBe(409)
      const half = await D.who.post(`/api/market/deals/${D.main.id}/done`)
      expect(half.body).toMatchObject({ status: 'accepted' })
      expect(half.body.makerDone).toBeTruthy()
      expect((await bob.get('/api/notifications')).body.rows[0]).toMatchObject({ kind: 'market.done' })
      const done = await bob.post(`/api/market/deals/${D.main.id}/done`)
      expect(done.body).toMatchObject({ status: 'done', canRate: true })
      expect((await bob.get(`/api/market/${L.bob.id}`)).body.left).toBe(400)
    })

    it('оцінки: 1–5, змінити можна; репутація продавця', async () => {
      expect((await D.who.post(`/api/market/deals/${D.main.id}/rate`, { score: 6 })).status).toBe(400)
      expect((await D.who.post(`/api/market/deals/${D.main.id}/rate`, { score: 4, text: 'Усе чесно' })).status).toBe(200)
      const again = await D.who.post(`/api/market/deals/${D.main.id}/rate`, { score: 5, text: 'Усе чесно, швидко' })
      expect(again.body.myRating).toMatchObject({ score: 5 })
      await bob.post(`/api/market/deals/${D.main.id}/rate`, { score: 5 })
      const login = (await bob.get('/api/me')).body.user?.login ?? (await bob.get('/api/me')).body.login
      const u = (await anon.get(`/api/market/users/${login}`)).body
      expect(u.rep).toEqual({ avg: 5, n: 1, done: 1 })
      expect(u.ratings[0]).toMatchObject({ score: 5, role: 'seller', text: 'Усе чесно, швидко' })
      expect(ids(u.listings)).toContain(L.bob.id)
      // у стрічці — теж репутація
      expect((await anon.get('/api/market?side=sell')).body.rows.find((x) => x.id === L.bob.id).rep).toEqual({ avg: 5, n: 1, done: 1 })
    })

    it('медіана й історія — з завершених угод публічних оголошень, без імен', async () => {
      // ще дві угоди: 110 і 130 (через свої оголошення інших людей)
      for (const [seller, price] of [[carol, 110], [dave, 130]]) {
        const l = (await seller.post('/api/market', sell({ price, qty: 10 }))).body
        const d = (await frank.post(`/api/market/${l.id}/deals`, { qty: 10 })).body
        await seller.post(`/api/market/deals/${d.id}/accept`)
        await frank.post(`/api/market/deals/${d.id}/done`)
        const fin = await seller.post(`/api/market/deals/${d.id}/done`)
        expect(fin.body.status).toBe('done')
        // продано все — оголошення закрилось само
        expect((await seller.get(`/api/market/${l.id}`)).body.status).toBe('closed')
      }
      const it = (await anon.get('/api/market/item/SpiceResin')).body
      expect(it.stats).toMatchObject({ median: 110, n: 3, source: 'deals' })
      expect(it.history).toHaveLength(3)
      expect(it.history[0]).not.toHaveProperty('maker')
      expect(it.book.buy[0].id).toBe(L.eve.id)
    })

    it('скасувати може сторона; «Мої угоди» — активні й завершені', async () => {
      const d = (await dave.post(`/api/market/${L.bob.id}/deals`, { qty: 10 })).body
      expect((await bob.post(`/api/market/deals/${d.id}/cancel`)).status).toBe(403)
      expect((await dave.post(`/api/market/deals/${d.id}/cancel`, { reason: 'передумав' })).body.status).toBe('cancelled')
      expect(ids((await D.who.get('/api/market/deals?state=done')).body.rows)).toContain(D.main.id)
      expect(ids((await D.who.get('/api/market/deals')).body.rows)).not.toContain(D.main.id)
      // оголошення з угодами не стирається, лише закривається
      expect((await bob.del(`/api/market/${L.bob.id}`)).status).toBe(409)
    })
  })

  describe('модерація', () => {
    it('скарги: одна від людини; три RMT від різних — сховано; модератор повертає', async () => {
      const l = (await carol.post('/api/market', sell({ price: 99 }))).body
      expect((await carol.post('/api/market/reports', { target: { kind: 'listing', id: l.id }, reason: 'rmt' })).status).toBe(400)
      expect((await dave.post('/api/market/reports', { target: { kind: 'listing', id: l.id }, reason: 'nope' })).status).toBe(400)
      for (const a of [dave, eve]) expect((await a.post('/api/market/reports', { target: { kind: 'listing', id: l.id }, reason: 'rmt', note: 'просить гроші в ДМ' })).status).toBe(201)
      expect((await dave.post('/api/market/reports', { target: { kind: 'listing', id: l.id }, reason: 'rmt' })).status).toBe(409)
      expect(ids((await anon.get('/api/market')).body.rows)).toContain(l.id)
      expect((await frank.post('/api/market/reports', { target: { kind: 'listing', id: l.id }, reason: 'rmt' })).status).toBe(201)
      expect(ids((await anon.get('/api/market')).body.rows)).not.toContain(l.id)
      expect((await carol.get('/api/notifications')).body.rows[0]).toMatchObject({ kind: 'market.moderated', data: { listing: l.id, action: 'autohide' } })
      expect((await dave.get('/api/market/reports')).status).toBe(403)
      const q = (await mod.get('/api/market/reports')).body.rows
      const g = q.find((x) => x.target === l.id)
      expect(g).toMatchObject({ kind: 'listing', reasons: { rmt: 3 } })
      expect(g.subject).toMatchObject({ id: l.id })
      expect((await mod.post(`/api/market/reports/${g.id}/resolve`, { action: 'unhide' })).status).toBe(200)
      expect(ids((await anon.get('/api/market')).body.rows)).toContain(l.id)
      expect((await mod.post(`/api/market/reports/${g.id}/resolve`, { action: 'dismiss' })).body.resolved).toBe(3)
      expect((await mod.get('/api/market/reports')).body.rows.find((x) => x.target === l.id)).toBeUndefined()
      L.carol = l
    })

    it('заборона: нові оголошення, пропозиції, повідомлення — 403; відкриті — закрито; читати можна', async () => {
      await dave.post('/api/market/reports', { target: { kind: 'user', id: carol.id }, reason: 'scam' })
      const g = (await mod.get('/api/market/reports')).body.rows.find((x) => x.kind === 'user' && x.target === carol.id)
      expect(g).toBeTruthy()
      expect((await mod.post(`/api/market/reports/${g.id}/resolve`, { action: 'ban', days: 7, note: 'шахрайство' })).status).toBe(200)
      expect((await carol.post('/api/market', sell())).status).toBe(403)
      expect((await carol.post(`/api/market/${L.eve.id}/deals`, { qty: 1 })).status).toBe(403)
      expect((await carol.get(`/api/market/${L.carol.id}`)).body.status).toBe('closed')
      expect((await carol.get('/api/market')).status).toBe(200)
      expect((await carol.get('/api/market/me')).body.ban).toMatchObject({ reason: 'шахрайство' })
      await mod.post(`/api/market/reports/${g.id}/resolve`, { action: 'unban' })
      expect((await carol.get('/api/market/me')).body.ban).toBeNull()
    })
  })

  describe('прев’ю посилань', () => {
    it('оголошення й предмет — назвою мовою запиту, з ціною; гільдійське — загальний опис', async () => {
      const file = path.join(dir, 'index.html')
      fs.writeFileSync(file, '<html><head><title>x</title></head><body></body></html>')
      const { createAccess } = await import('./lib/items.mjs')
      const i18n = await createI18n(db, { dir: path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'locales') })
      const m = app.locals.market
      const game = { catalog: async () => ({ items: [{ id: 'SpiceResin', name: 'Spice Resin', loc: 'Смола спайсу', cat: 'misc', kind: 'RawResources', grade: 0, icon: '/media/x.webp' }] }) }
      const access = { ctxOf: async () => ({ user: null, ranks: new Map() }) }
      const items = { get: async (k, id) => db.get('SELECT * FROM items WHERE kind = ? AND id = ?', k, id) }
      const og = createOg({ file, db, items, auth: {}, guilds: {}, thumbs: null, access: { ...access, ...createAccess }, market: m, game })
      const req = (p) => ({ path: p, originalUrl: p, query: {}, lang: 'uk', t: (k, v) => i18n.t('uk', k, v), protocol: 'http', get: () => 'x.test' })
      const html = await og.render(req(`/market/${L.eve.id}`))
      expect(html).toContain('Куплю: Смола спайсу')
      expect(html).toContain('120 Solari')
      expect(html).toContain('/media/x.webp')
      expect(await og.render(req(`/market/${L.guild.id}`))).not.toContain('Смола спайсу')
      expect(await og.render(req('/market/item/SpiceResin'))).toContain('110')
    })
  })
})

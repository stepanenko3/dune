// Гільдії як у грі: людина — лише в одній (вступ, заявка, запрошення й створення нової відхиляються), у гільдії —
// не більше guildCap людей, давні кілька членств зводяться до одного. Через справжній HTTP і напряму через бібліотеки.
// Двічі: на запасній SQLite (тимчасова тека) і на Postgres dune_testing зі Snotax console (якщо є .env і база
// відповідає) — у власних схемах, щоб не заважати app.test.mjs, який стирає схему public.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.mjs'
import { createAuth } from './lib/auth.mjs'
import { createGuilds } from './lib/guilds.mjs'
import { openDb } from './lib/sql.mjs'

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

const ONE = 'Спершу вийди з поточної гільдії'

// Postgres відповідає повільніше, а тут багато входів поштою й запитів поспіль
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

describe.each(ENGINES)('%s', (_name, pgCfg) => {
  describe('через HTTP', () => {
    let server, base, dir, app, db
    const mail = []
    const codeFor = (email) => [...mail].reverse().find((m) => m.to === email.trim().toLowerCase())?.text.match(/\b\d{6}\b/)?.[0]

    /** «браузер»: свій cookie сеансу, запити з того самого сайту */
    function agent() {
      let cookie = ''
      const call = async (method, url, body, headers = {}) => {
        const r = await fetch(base + url, {
          method,
          headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}), ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        const set = r.headers.get('set-cookie')
        if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
        return { status: r.status, body: await r.json().catch(() => null) }
      }
      const a = {
        get: (u) => call('GET', u),
        post: (u, b = {}, h) => call('POST', u, b, h),
        put: (u, b) => call('PUT', u, b),
        patch: (u, b) => call('PATCH', u, b),
        del: (u, b) => call('DELETE', u, b),
        /** вхід поштою: код — з перехопленого листа */
        async signIn(email) {
          const r = await a.post('/api/auth/code', { email })
          if (r.status !== 200) return r
          return a.post('/api/auth/verify', { email, code: codeFor(email) })
        },
        me: async () => (await a.get('/api/me')).body,
      }
      return a
    }

    beforeAll(async () => {
      ;({ db, dir } = await freshDb(pgCfg, 'http'))
      app = await createApp({ dataDir: dir, db, background: false, codeGap: 0, mailer: { send: async (m) => { mail.push(m) } }, log: { info() {}, warn() {}, error() {} } })
      await new Promise((r) => { server = app.listen(0, '127.0.0.1', r) })
      base = `http://127.0.0.1:${server.address().port}`
    })
    afterAll(async () => {
      server?.close()
      await app?.locals.close()
      await db?.close()
      fs.rmSync(dir, { recursive: true, force: true })
    })

    const admin = agent(), bob = agent(), eve = agent(), carol = agent(), dave = agent(), anon = agent()
    let at = null // гільдія Боба
    let inviteSW = '', inviteAT = ''

    describe('одна гільдія на людину', () => {
      it('гільдія людини — одна: у /api/me (guild і guilds[0–1]) та в users.main_guild', async () => {
        expect(await anon.me()).toMatchObject({ guild: null, guilds: [] })
        const r = await admin.signIn('admin@example.com')
        expect(r.body.guild).toMatchObject({ slug: 'sandwalkers', role: 'leader' })
        expect(r.body.guilds).toHaveLength(1)
        expect(r.body.user.mainGuild).toBe(r.body.guild.id)
        for (const [a, email] of [[bob, 'bob@example.com'], [eve, 'eve@example.com'], [carol, 'carol@example.com'], [dave, 'dave@example.com']]) await a.signIn(email)
        expect(await bob.me()).toMatchObject({ guild: null, guilds: [], user: { mainGuild: null } })
      })

      it('створення: людина без гільдії — лідер нової; друга гільдія, поки ти в першій, — 409 (і не з’являється)', async () => {
        const made = await bob.post('/api/guilds', { name: 'Атрейдеси', tag: 'AT', open: true })
        expect(made.status).toBe(201)
        at = made.body.guild
        const me = await bob.me()
        expect(me.guild).toMatchObject({ id: at.id, role: 'leader', members: 1 })
        expect(me.user.mainGuild).toBe(at.id)

        const again = await bob.post('/api/guilds', { name: 'Харконнени', tag: 'HK' })
        expect(again.status).toBe(409)
        expect(again.body.error).toBe(ONE)
        // навіть адміністратор сайту — лідер Sandwalkers, тож нову гільдію створить лише вийшовши (або з панелі)
        expect((await admin.post('/api/guilds', { name: 'Фремени', tag: 'FR' })).status).toBe(409)
        const names = (await anon.get('/api/guilds')).body.list.map((g) => g.name)
        expect(names).toEqual(expect.arrayContaining(['Sandwalkers', 'Атрейдеси']))
        expect(names).not.toContain('Харконнени')
        expect(names).not.toContain('Фремени')
      })

      it('запрошення: у гільдію — так; в іншу, поки ти в першій, — 409, і запрошення не витрачається', async () => {
        inviteSW = (await admin.post('/api/guilds/sandwalkers/invites', { days: 7, uses: 0 })).body.code
        inviteAT = (await bob.post(`/api/guilds/${at.slug}/invites`, { days: 7, uses: 0 })).body.code
        expect((await eve.post(`/api/invites/${inviteSW}/accept`)).status).toBe(200)
        const me = await eve.me()
        expect(me.guild).toMatchObject({ slug: 'sandwalkers', role: 'member' })
        expect(me.user.mainGuild).toBe(me.guild.id)

        const other = await eve.post(`/api/invites/${inviteAT}/accept`)
        expect(other.status).toBe(409)
        expect(other.body.error).toBe(ONE)
        expect((await eve.me()).guild.slug).toBe('sandwalkers')
        expect((await bob.get(`/api/guilds/${at.slug}`)).body.invites.find((i) => i.code === inviteAT).uses).toBe(0)
        // повторне запрошення в свою ж гільдію — не помилка
        expect((await eve.post(`/api/invites/${inviteSW}/accept`)).status).toBe(200)
      })

      it('заявка: в іншу гільдію, поки ти в першій, — 409; без гільдії — подається, а вступ деінде її прибирає', async () => {
        const mine = await eve.post(`/api/guilds/${at.slug}/requests`, { note: 'хочу до вас' })
        expect(mine.status).toBe(409)
        expect(mine.body.error).toBe(ONE)
        expect((await eve.get('/api/guilds')).body.requests).toEqual([])
        // закрита гільдія (Sandwalkers) заявок не приймає
        expect((await carol.post('/api/guilds/sandwalkers/requests', {})).status).toBe(403)

        expect((await carol.post(`/api/guilds/${at.slug}/requests`, { note: 'привіт' })).status).toBe(201)
        expect((await carol.get('/api/guilds')).body.requests).toEqual([at.id])
        expect((await bob.get(`/api/guilds/${at.slug}`)).body.requests.map((r) => r.id)).toEqual([(await carol.me()).user.id])
        // за цей час Керол вступила в Sandwalkers за запрошенням — заявка до Атрейдесів зникла
        expect((await carol.post(`/api/invites/${inviteSW}/accept`)).status).toBe(200)
        expect((await carol.get('/api/guilds')).body.requests).toEqual([])
        const carolId = (await carol.me()).user.id
        expect((await bob.get(`/api/guilds/${at.slug}`)).body.requests).toEqual([])
        expect((await bob.post(`/api/guilds/${at.slug}/requests/${carolId}`, { accept: true })).status).toBe(404)
        expect((await carol.me()).guild.slug).toBe('sandwalkers')
      })

      it('вихід і виключення звільняють людину: гільдії нема, users.main_guild порожній, вступ знову можливий', async () => {
        expect((await admin.post('/api/guilds/sandwalkers/leave')).status).toBe(400) // лідер просто не виходить
        expect((await eve.post('/api/guilds/sandwalkers/leave')).status).toBe(200)
        expect(await eve.me()).toMatchObject({ guild: null, guilds: [], user: { mainGuild: null } })

        const carolId = (await carol.me()).user.id
        expect((await admin.del(`/api/guilds/sandwalkers/members/${carolId}`)).status).toBe(200)
        expect(await carol.me()).toMatchObject({ guild: null, user: { mainGuild: null } })

        // і тепер можна: заявка від Єви — прийняти новобранцем, гільдія людини оновилась
        expect((await eve.post(`/api/guilds/${at.slug}/requests`, { note: '' })).status).toBe(201)
        const eveId = (await eve.me()).user.id
        expect((await bob.post(`/api/guilds/${at.slug}/requests/${eveId}`, { accept: true })).status).toBe(200)
        expect(await eve.me()).toMatchObject({ guild: { slug: at.slug, role: 'recruit' }, user: { mainGuild: at.id } })
      })

      it('панель керування теж не поселить людину у двох гільдіях', async () => {
        const daveId = (await dave.me()).user.id
        const sw = (await anon.get('/api/guilds')).body.list.find((g) => g.slug === 'sandwalkers')
        const first = await admin.post('/api/admin/r/members', { guild_id: sw.id, user_id: daveId, role: 'member' })
        expect(first.status).toBe(200)
        expect((await dave.me()).guild.slug).toBe('sandwalkers')
        const second = await admin.post('/api/admin/r/members', { guild_id: at.id, user_id: daveId, role: 'member' })
        expect(second.status).toBe(409)
        expect((await dave.me()).guild.slug).toBe('sandwalkers')
        // а вигнана людина вільна
        expect((await admin.del(`/api/guilds/sandwalkers/members/${daveId}`)).status).toBe(200)
        expect((await dave.me()).guild).toBe(null)
      })

      it('видалення гільдії звільняє учасників: у них нема гільдії', async () => {
        const e = agent()
        await e.signIn('frank@example.com')
        const g = await e.post('/api/guilds', { name: 'Тимчасова', tag: 'TMP' })
        expect((await e.me()).user.mainGuild).toBe(g.body.guild.id)
        expect((await e.del(`/api/guilds/${g.body.guild.slug}`)).status).toBe(200)
        expect(await e.me()).toMatchObject({ guild: null, user: { mainGuild: null } })
        expect((await e.post('/api/guilds', { name: 'Нова', tag: 'NW' })).status).toBe(201)
      })
    })

    describe('ліміт учасників (guildCap)', () => {
      const setCap = (n) => admin.patch('/api/admin/site-settings', { guildCap: n })
      // стан: Атрейдеси — Боб (лідер) і Єва (новобранець): 2 з 32; Керол і Дейв — без гільдії

      it('за замовчуванням 32; віддається в списку, на сторінці гільдії, в /api/me і в запрошенні', async () => {
        expect((await anon.get('/api/guilds')).body.cap).toBe(32)
        expect((await bob.get(`/api/guilds/${at.slug}`)).body.cap).toBe(32)
        expect((await bob.me()).site.guildCap).toBe(32)
        expect((await anon.get(`/api/invites/${inviteAT}`)).body).toMatchObject({ cap: 32, guild: { members: 2 } })
      })

      it('заповнену гільдію не поповнити ні заявкою, ні запрошенням; заявка, що чекала, лишається', async () => {
        await setCap(3)
        expect((await carol.post(`/api/guilds/${at.slug}/requests`, { note: 'я' })).status).toBe(201)
        expect((await dave.post(`/api/guilds/${at.slug}/requests`, { note: 'і я' })).status).toBe(201) // ще 2 з 3 — місце є
        const carolId = (await carol.me()).user.id, daveId = (await dave.me()).user.id
        expect((await bob.post(`/api/guilds/${at.slug}/requests/${carolId}`, { accept: true })).status).toBe(200) // 3 з 3

        const gina = agent()
        await gina.signIn('gina@example.com')
        const full = await gina.post(`/api/guilds/${at.slug}/requests`, { note: '' })
        expect(full.status).toBe(409)
        expect(full.body.error).toBe('Гільдія заповнена (3 з 3)')
        const viaInvite = await gina.post(`/api/invites/${inviteAT}/accept`)
        expect(viaInvite.status).toBe(409)
        expect(viaInvite.body.error).toBe('Гільдія заповнена (3 з 3)')
        expect((await gina.me()).guild).toBe(null)
        expect((await bob.get(`/api/guilds/${at.slug}`)).body.invites.find((i) => i.code === inviteAT).uses).toBe(0)

        // заявку Дейва, що подана до заповнення, офіцер прийняти вже не може — але вона лишається
        const late = await bob.post(`/api/guilds/${at.slug}/requests/${daveId}`, { accept: true })
        expect(late.status).toBe(409)
        expect(late.body.error).toBe('Гільдія заповнена (3 з 3)')
        expect((await bob.get(`/api/guilds/${at.slug}`)).body.requests.map((r) => r.id)).toEqual([(await dave.me()).user.id])
        expect((await dave.me()).guild).toBe(null)
      })

      it('місце звільнилось (вийшла людина чи піднято ліміт) — вступ знову можливий; зменшений ліміт учасників не виганяє', async () => {
        const daveId = (await dave.me()).user.id
        await setCap(4)
        expect((await bob.post(`/api/guilds/${at.slug}/requests/${daveId}`, { accept: true })).status).toBe(200) // 4 з 4
        await setCap(2)
        expect((await bob.get(`/api/guilds/${at.slug}`)).body).toMatchObject({ cap: 2, guild: { members: 4 } })
        const hh = agent()
        await hh.signIn('hanna@example.com')
        expect((await hh.post(`/api/invites/${inviteAT}/accept`)).body.error).toBe('Гільдія заповнена (4 з 2)')
        // хибний ліміт (< 1) панель не приймає — лишається попередній
        expect((await setCap(0)).status).toBe(400)
        expect((await anon.get('/api/guilds')).body.cap).toBe(2)
        await setCap(32)
        expect((await anon.get('/api/guilds')).body.cap).toBe(32)
        expect((await hh.post(`/api/invites/${inviteAT}/accept`)).status).toBe(200)
        expect((await hh.me()).guild).toMatchObject({ slug: at.slug, role: 'member', members: 5 })
        await setCap(32)
      })
    })
  })

  describe('давні дані', () => {
    let db, dir
    beforeAll(async () => { ;({ db, dir } = await freshDb(pgCfg, 'legacy')) })
    afterAll(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

    it('кілька членств в одної людини зводяться до одного (лідер → основна → найдавніша), решта — у журнал', async () => {
      const auth = await createAuth(db)
      const first = await createGuilds(db)
      const uid = {}
      for (const n of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) uid[n] = (await auth.create(`${n}@example.com`)).user.id
      const G = {}
      for (const n of ['g1', 'g2', 'g3', 'g4', 'g5']) G[n] = (await first.create({ name: `Гільдія ${n}`, tag: n.toUpperCase() }, null, { slug: n })).id

      // як було до обмеження: індексу «одна гільдія» ще нема
      await db.exec('DROP INDEX members_one_guild')
      const put = (g, u, role, joined) => db.run('INSERT INTO members (guild_id, user_id, role, joined) VALUES (?, ?, ?, ?)', G[g], uid[u], role, joined)
      // a: учасник g1, лідер g2, учасник g3 → лишається g2 (де лідер)
      await put('g1', 'a', 'member', 100); await put('g2', 'a', 'leader', 300); await put('g3', 'a', 'member', 200)
      // b: g1, g2, g3, основна — g3 (не лідер ніде) → g3
      await put('g1', 'b', 'member', 100); await put('g2', 'b', 'officer', 200); await put('g3', 'b', 'member', 300)
      await db.run('UPDATE users SET main_guild = ? WHERE id = ?', G.g3, uid.b)
      // c: без основної — найдавніша, g2; є заявка до g3 — тепер зайва
      await put('g1', 'c', 'member', 500); await put('g2', 'c', 'recruit', 400)
      await db.run('INSERT INTO requests (guild_id, user_id, note, created) VALUES (?, ?, ?, ?)', G.g3, uid.c, '', 1)
      // d: лише g1, але в основній — застарілий запис
      await put('g1', 'd', 'member', 100)
      await db.run('UPDATE users SET main_guild = ? WHERE id = ?', G.g5, uid.d)
      // e: не в гільдіях, а основна вказує на g1
      await db.run('UPDATE users SET main_guild = ? WHERE id = ?', G.g1, uid.e)
      // f: лідер двох гільдій (основна g5) → лишається g5, а в g4 лідером стає його офіцер g
      await put('g4', 'f', 'leader', 100); await put('g5', 'f', 'leader', 200); await put('g4', 'g', 'officer', 150)
      await db.run('UPDATE users SET main_guild = ? WHERE id = ?', G.g5, uid.f)

      const guilds = await createGuilds(db) // старт сайту: зведення, індекс, основна гільдія
      const of = async (n) => (await db.all('SELECT guild_id, role FROM members WHERE user_id = ?', uid[n])).map((r) => `${Object.keys(G).find((k) => G[k] === r.guild_id)}:${r.role}`)
      expect(await of('a')).toEqual(['g2:leader'])
      expect(await of('b')).toEqual(['g3:member'])
      expect(await of('c')).toEqual(['g2:recruit'])
      expect(await of('d')).toEqual(['g1:member'])
      expect(await of('e')).toEqual([])
      expect(await of('f')).toEqual(['g5:leader'])
      expect(await of('g')).toEqual(['g4:leader']) // лідерство g4 перейшло офіцеру
      // з g1 пішли ті, у кого були й інші гільдії
      expect((await guilds.members(G.g1)).map((m) => m.id)).toEqual([uid.d])

      // основна гільдія = гільдія людини
      const main = async (n) => (await auth.get(uid[n])).main_guild
      expect(await main('a')).toBe(G.g2)
      expect(await main('b')).toBe(G.g3)
      expect(await main('c')).toBe(G.g2)
      expect(await main('d')).toBe(G.g1)
      expect(await main('e')).toBe(null)
      expect(await main('f')).toBe(G.g5)
      // заявка людини, що вже в гільдії, прибрана
      expect(await guilds.requestsOfUser(uid.c)).toEqual([])

      // журнал: що саме прибрали й чому
      const log = (await auth.audit({ limit: 100 })).filter((r) => r.action === 'guild.leave')
      expect(log.map((r) => r.target).sort()).toEqual([`g1/${uid.a}`, `g1/${uid.b}`, `g1/${uid.c}`, `g2/${uid.b}`, `g3/${uid.a}`, `g4/${uid.f}`].sort())
      expect(log[0].detail).toContain('лишилась')
      expect((await auth.audit({ limit: 100 })).some((r) => r.action === 'guild.role' && r.target === `g4/${uid.g}` && r.detail === 'leader')).toBe(true)

      // тепер другу гільдію вставити не вийде навіть напряму в базу, а повторний запуск нічого не міняє
      await expect(db.run('INSERT INTO members (guild_id, user_id, role, joined) VALUES (?, ?, ?, ?)', G.g1, uid.a, 'member', 1)).rejects.toThrow()
      await createGuilds(db)
      expect(await of('a')).toEqual(['g2:leader'])
      expect((await auth.audit({ limit: 100 })).filter((r) => r.action === 'guild.leave')).toHaveLength(6)
      // а через бібліотеку — зрозумілою помилкою
      await expect(guilds.addMember(G.g1, uid.a, 'member')).rejects.toMatchObject({ status: 409, key: ONE })
      await expect(guilds.create({ name: 'Ще одна', tag: 'ONE' }, uid.a)).rejects.toMatchObject({ status: 409, key: ONE })
      await expect(guilds.addMember(G.g1, uid.e, 'member', { cap: 1 })).rejects.toMatchObject({ status: 409, key: 'Гільдія заповнена ({n} з {cap})', vars: { n: 1, cap: 1 } })
    })
  })
})

// Сповіщення в Discord і Telegram: хто отримує тему (публічне, гільдія, власник), черга з повторами, вимкнення
// мертвого вебхука, «скоро почнеться» один раз, підключення Telegram за кодом. Служби — заглушка fetch, база — SQLite.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './lib/sql.mjs'
import { createNotify } from './lib/notify/index.mjs'
import { isWebhook } from './lib/notify/discord.mjs'
import { renderMessage } from './lib/notify/messages.mjs'
import { notifyEventsSoon, scopeOf } from './lib/notify/topics.mjs'
import { telegramHtml } from './lib/notify/telegram.mjs'

const HOOK = (n) => `https://discord.com/api/webhooks/1234567${n}/${'x'.repeat(30)}${n}`

/** заглушка служб: відповіді за адресою; усе надіслане — у sent */
function services() {
  const sent = []
  const plan = new Map() // адреса → [статус, тіло] (за замовчуванням 200)
  const fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null
    if ((opts.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ name: 'general' }), { status: 200 })
    sent.push({ url: String(url), body })
    const [status, json] = plan.get(String(url).replace(/\?.*$/, '')) ?? [200, { ok: true, result: { username: 'sw_bot' } }]
    return new Response(JSON.stringify(json), { status })
  }
  return { fetch, sent, plan }
}

describe('сповіщення', () => {
  let dir, db, clock, svc, members
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-notify-'))
    db = await openDb({ dataDir: dir, pg: null })
    clock = 1_000_000
    svc = services()
    members = { g1: [{ id: 'u1' }, { id: 'u2' }] }
  })
  afterEach(async () => { await db?.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  const make = (o = {}) => createNotify({ db, i18n: null, guilds: { members: async (g) => members[g] ?? [] }, log: {}, now: () => clock, site: 'https://sw.test', fetch: svc.fetch, telegramToken: null, ...o })
  const settle = () => new Promise((d) => setTimeout(d, 20))

  it('приймає лише справжні вебхуки Discord', () => {
    expect(isWebhook(HOOK(1))).toBe(true)
    expect(isWebhook('https://discordapp.com/api/v10/webhooks/123456789/' + 'a'.repeat(40))).toBe(true)
    expect(isWebhook('https://evil.test/api/webhooks/1/2')).toBe(false)
    expect(isWebhook('http://discord.com/api/webhooks/123456789/' + 'a'.repeat(40))).toBe(false)
  })

  it('публічне — усім з темою; гільдійне — гільдії й особистим каналам учасників; власнику — завжди', async () => {
    const n = await make()
    const g = await n.addDiscord({ kind: 'guild', id: 'g1' }, { url: HOOK(1), lang: 'uk' })
    const u1 = await n.addDiscord({ kind: 'user', id: 'u1' }, { url: HOOK(2), lang: 'uk' })
    const u9 = await n.addDiscord({ kind: 'user', id: 'u9' }, { url: HOOK(3), lang: 'uk', topics: ['patch.new'] })
    expect(g.label).toBe('general')
    expect(await n.emit('patch.new', { build: '1', summary: {} }, { visibility: 'public' })).toBe(3)
    expect(await n.emit('event.new', { id: 'e', title: 'Бій', type: 'pvp', starts: clock }, { visibility: 'public' })).toBe(2) // u9 без цієї теми
    expect(await n.emit('event.soon', { id: 'e', title: 'Бій', type: 'pvp', starts: clock }, { visibility: 'public', guild: null, owner: { kind: 'user', id: 'u1' } })).toBe(1) // тема не публічна — лише власнику
    expect(await n.emit('event.new', { id: 'e', title: 'Бій', type: 'pvp', starts: clock }, { visibility: 'restricted', guild: 'g1', owner: { kind: 'guild', id: 'g1' } })).toBe(2)
    void u1; void u9
    await settle()
    await n.deliver()
    expect(svc.sent.filter((x) => x.url.includes('discord')).length).toBe(8)
    expect(svc.sent[0].body.embeds[0]).toMatchObject({ title: 'Оновлення гри (збірка 1)', url: 'https://sw.test/patches/1' })
  })

  it('збій — повтор пізніше; мертвий вебхук — канал вимкнено з причиною', async () => {
    const n = await make()
    const a = await n.addDiscord({ kind: 'user', id: 'u1' }, { url: HOOK(1), lang: 'uk' })
    const b = await n.addDiscord({ kind: 'user', id: 'u2' }, { url: HOOK(2), lang: 'uk' })
    svc.plan.set(HOOK(1), [500, { message: 'boom' }])
    svc.plan.set(HOOK(2), [404, { message: 'Unknown Webhook' }])
    await n.emit('patch.new', { build: '7', summary: {} })
    await settle()
    expect((await n.get(b.id))).toMatchObject({ enabled: false, error: 'Discord: вебхук видалено чи недійсний' })
    expect(Number((await db.get('SELECT COUNT(*) AS n FROM notify_outbox')).n)).toBe(1)
    // наступна хвилина — ще рано (пауза росте), через 2 хв — служба вже відповідає
    svc.plan.delete(HOOK(1))
    clock += 30_000
    expect(await n.deliver()).toBe(0)
    clock += 120_000
    expect(await n.deliver()).toBe(1)
    expect((await n.get(a.id)).lastSent).toBe(clock)
  })

  it('ліміт каналів і той самий вебхук двічі', async () => {
    const n = await make()
    await n.addDiscord({ kind: 'user', id: 'u1' }, { url: HOOK(1), lang: 'uk' })
    await expect(n.addDiscord({ kind: 'user', id: 'u1' }, { url: HOOK(1) + '/', lang: 'uk' })).rejects.toThrow('цей канал уже підключено')
    for (let i = 2; i <= 5; i++) await n.addDiscord({ kind: 'user', id: 'u1' }, { url: HOOK(i), lang: 'uk' })
    await expect(n.addDiscord({ kind: 'user', id: 'u1' }, { url: HOOK(6), lang: 'uk' })).rejects.toThrow('не більше 5')
  })

  it('«скоро почнеться» — один раз на подію й час; гільдійна — гільдії', async () => {
    const n = await make()
    await n.addDiscord({ kind: 'guild', id: 'g1' }, { url: HOOK(1), lang: 'uk' })
    await db.exec('CREATE TABLE events (id TEXT PRIMARY KEY, doc TEXT, starts BIGINT, ends BIGINT)')
    await db.run('INSERT INTO events (id, doc, starts, ends) VALUES (?, ?, ?, ?)', 'e1', JSON.stringify({ title: 'Рейд', type: 'pve' }), clock + 20 * 60_000, clock + 80 * 60_000)
    await db.run('INSERT INTO events (id, doc, starts, ends) VALUES (?, ?, ?, ?)', 'e2', JSON.stringify({ title: 'Пізніше', type: 'pve' }), clock + 90 * 60_000, clock + 99 * 60_000)
    const items = { get: async (k, id) => ({ kind: k, id, owner_kind: 'guild', owner_id: 'g1', visibility: 'guild' }) }
    expect(await notifyEventsSoon({ db, items, notify: n, now: () => clock })).toBe(1)
    expect(await notifyEventsSoon({ db, items, notify: n, now: () => clock })).toBe(0)
    await settle()
    expect(svc.sent.map((x) => x.body.embeds[0].title)).toEqual(['За 30 хв: Рейд'])
  })

  it('scope речі: публічна, гільдійна, особиста, схована', () => {
    expect(scopeOf({ owner_kind: 'guild', owner_id: 'g', visibility: 'public' })).toEqual({ visibility: 'public', guild: 'g', owner: { kind: 'guild', id: 'g' } })
    expect(scopeOf({ owner_kind: 'guild', owner_id: 'g', visibility: 'private' })).toMatchObject({ visibility: 'restricted', guild: 'g' })
    expect(scopeOf({ owner_kind: 'user', owner_id: 'u', visibility: 'link' })).toMatchObject({ visibility: 'restricted', guild: null, owner: { kind: 'user', id: 'u' } })
    expect(scopeOf({ owner_kind: 'user', owner_id: 'u', visibility: 'public', hidden: 1 })).toBe(null)
  })

  it('Telegram: посилання з кодом → /start у чаті → канал і пробне; бота прибрали — канал вимкнено', async () => {
    const n = await make({ telegramToken: 'T' })
    const owner = { kind: 'guild', id: 'g1' }
    const link = await n.telegramLink(owner, { lang: 'uk' })
    expect(link.group).toBe(`https://t.me/sw_bot?startgroup=${link.code}`)
    expect(await n.linkStatus(link.code, owner)).toEqual({ state: 'waiting' })
    await n.onTelegramUpdate({ message: { text: `/start@sw_bot ${link.code}`, chat: { id: -100, title: 'Гільдійний чат' } } })
    const s = await n.linkStatus(link.code, owner)
    expect(s).toMatchObject({ state: 'done', channel: { kind: 'telegram', target: '-100', label: 'Гільдійний чат', enabled: true } })
    const tg = svc.sent.filter((x) => x.url.includes('sendMessage'))
    expect(tg.at(-1).body).toMatchObject({ chat_id: '-100', parse_mode: 'HTML' })
    // той самий код удруге — уже використано
    await n.onTelegramUpdate({ message: { text: `/start ${link.code}`, chat: { id: -200, title: 'Інший' } } })
    expect((await n.list(owner)).length).toBe(1)
    await n.onTelegramUpdate({ my_chat_member: { chat: { id: -100 }, new_chat_member: { status: 'kicked' } } })
    expect((await n.list(owner))[0]).toMatchObject({ enabled: false })
    n.stop()
  })

  it('тексти: Discord бачить час у своєму поясі, Telegram — UTC і HTML без ін’єкцій', () => {
    const t = (k, v) => k.replace(/\{(\w+)\}/g, (m, x) => v?.[x] ?? m)
    const d = renderMessage('event.new', { id: 'e', title: '<b>x</b>', type: 'pvp', starts: Date.UTC(2026, 9, 24, 18) }, { t, lang: 'uk', site: 'https://s', kind: 'discord' })
    expect(d.text).toContain('<t:')
    const m = renderMessage('event.new', { id: 'e', title: '<b>x</b>', type: 'pvp', starts: Date.UTC(2026, 9, 24, 18) }, { t, lang: 'uk', site: 'https://s', kind: 'telegram' })
    expect(m.text).toContain('UTC')
    expect(telegramHtml(m)).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})

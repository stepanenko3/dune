/*
 * Сповіщення в Discord і Telegram (/api/notify): канали людини й її гільдії. Свої канали веде сама людина, гільдійні —
 * офіцер і лідер (учасники бачать лише, що підключено). Адреса вебхука й id чату назовні не віддаються: адреса
 * вебхука — це пароль до каналу.
 */
import express from 'express'
import { createLimiter } from '../lib/auth.mjs'
import { RANK } from '../lib/guilds.mjs'
import { CHANNEL_KINDS, TOPIC_IDS } from '../lib/notify/index.mjs'
import { fail } from '../lib/util.mjs'
import { need, wrap } from './auth.mjs'

/** канал для сторінки: помилка служби лежить українським ключем — мовою людини */
const view = (req, c) => ({ id: c.id, kind: c.kind, label: c.label, topics: c.topics, lang: c.lang, enabled: c.enabled, error: c.error ? req.t(c.error) : null, created: c.created, lastSent: c.lastSent })

export function createNotifyRoutes({ notify, guilds }) {
  const r = express.Router()
  // пробне — не частіше раз на 30 с на канал; посилання Telegram — 20 на годину на людину
  const tests = createLimiter({ max: 1, ms: 30_000 })
  const links = createLimiter({ max: 20, ms: 60 * 60_000 })

  /** власник з тіла чи адреси: { kind, id }; дозвіл — керувати (manage) чи лише бачити */
  async function rights(req, owner) {
    if (!owner || !['user', 'guild'].includes(owner.kind) || typeof owner.id !== 'string') throw fail('хибний власник')
    if (req.user.role === 'admin') return { view: true, manage: true }
    if (owner.kind === 'user') { const mine = owner.id === req.user.id; return { view: mine, manage: mine } }
    const rank = await guilds.rankOf(owner.id, req.user.id)
    return { view: rank >= RANK.recruit, manage: rank >= RANK.officer }
  }
  const managed = async (req, owner) => {
    const rt = await rights(req, owner)
    if (!rt.manage) throw fail(owner.kind === 'guild' ? 'це може лише офіцер чи лідер гільдії' : 'бракує прав', 403)
  }
  /** канал, яким людина може керувати (інакше 404 — не видаємо, що він є) */
  async function channel(req) {
    const c = await notify.get(req.params.id)
    if (!c || !(await rights(req, c.owner)).manage) throw fail('немає такого каналу', 404)
    return c
  }
  const ownerOf = (s) => { const m = /^(user|guild):([\w-]{1,64})$/.exec(String(s ?? '')); return m ? { kind: m[1], id: m[2] } : null }

  r.get('/api/notify', need(), wrap(async (req, res) => {
    const owners = [{ owner: { kind: 'user', id: req.user.id }, guild: null, manage: true }]
    const g = await guilds.ofOne(req.user.id)
    if (g) owners.push({ owner: { kind: 'guild', id: g.id }, guild: { id: g.id, slug: g.slug, name: g.name, tag: g.tag ?? null }, manage: RANK[g.role] >= RANK.officer })
    for (const o of owners) {
      const list = await notify.list(o.owner)
      // учасник гільдії бачить лише, які канали підключено (без помилок і налаштувань)
      o.channels = list.map((c) => (o.manage ? view(req, c) : { id: c.id, kind: c.kind, label: c.label, enabled: c.enabled }))
    }
    res.set('cache-control', 'no-store').json({ topics: TOPIC_IDS, kinds: CHANNEL_KINDS, telegram: notify.telegramEnabled(), owners })
  }))

  r.post('/api/notify/channels', need(), wrap(async (req, res) => {
    const { owner, kind, url, topics } = req.body || {}
    await managed(req, owner)
    if (kind !== 'discord') throw fail('Telegram підключається посиланням на бота')
    const c = await notify.addDiscord(owner, { url, topics, lang: req.lang, by: req.user.id })
    res.status(201).json(view(req, c))
  }))

  r.patch('/api/notify/channels/:id', need(), wrap(async (req, res) => {
    const c = await channel(req)
    const b = req.body || {}
    const out = await notify.update(c.id, {
      ...(Array.isArray(b.topics) ? { topics: b.topics } : {}),
      ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}),
      // мова повідомлень — мова сайту людини зараз
      ...(b.lang === 'current' ? { lang: req.lang } : {}),
    })
    res.json(view(req, out))
  }))

  r.delete('/api/notify/channels/:id', need(), wrap(async (req, res) => {
    const c = await channel(req)
    await notify.remove(c.id)
    res.json({ ok: true })
  }))

  r.post('/api/notify/channels/:id/test', need(), wrap(async (req, res) => {
    const c = await channel(req)
    if (!tests.hit(c.id)) throw fail('пробне вже пішло — зачекай пів хвилини', 429)
    const out = await notify.test(c.id)
    res.json({ ...out, error: out.error ? req.t(out.error) : null, channel: view(req, await notify.get(c.id)) })
  }))

  r.post('/api/notify/telegram/link', need(), wrap(async (req, res) => {
    const { owner, topics } = req.body || {}
    await managed(req, owner)
    if (!links.hit(req.user.id)) throw fail('забагато запитів — спробуй трохи згодом', 429)
    res.json(await notify.telegramLink(owner, { topics, lang: req.lang, by: req.user.id }))
  }))

  r.get('/api/notify/telegram/link/:code', need(), wrap(async (req, res) => {
    const owner = ownerOf(req.query.owner)
    await managed(req, owner)
    const s = await notify.linkStatus(String(req.params.code).slice(0, 40), owner)
    res.set('cache-control', 'no-store').json(s.channel ? { ...s, channel: view(req, s.channel) } : s)
  }))
  return r
}

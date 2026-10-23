/*
 * Сповіщення сайту в Discord і Telegram (основа): шина тем (emit), канали власників (людина чи гільдія), черга доставки
 * з повторами й два відправники. Нова тема — рядок у TOPICS, повідомлення в messages.mjs і один виклик emit() там, де
 * подія стається.
 *
 * Хто що отримує (scope події): публічне — усі канали з цією темою, якщо тема публічна (TOPICS[..].public); гільдійне —
 * канали гільдії та особисті канали її учасників; річ власника (owner) — і канали самого власника (людини чи гільдії).
 * Посилання й приватне не сповіщаються взагалі (їх і не передають сюди).
 *
 * Доставка: рядок черги на кожен канал, спроба одразу й далі щохвилини (deliver), до MAX_ATTEMPTS з паузою, що росте;
 * 429 — пауза, яку просить служба. Вебхук видалено / бота вигнали з чату — канал вимикається з причиною (власник бачить
 * її на сторінці й підключає знову).
 */
import crypto from 'node:crypto'
import { fail } from '../util.mjs'
import { createDiscord } from './discord.mjs'
import { createTelegram } from './telegram.mjs'
import { renderMessage } from './messages.mjs'

/** теми: public — публічне сповіщається всім каналам із цією темою (інакше — лише гільдії й власнику) */
export const TOPICS = {
  'event.new': { public: true },
  'event.soon': { public: false },
  'patch.new': { public: true },
}
export const TOPIC_IDS = Object.keys(TOPICS)
export const CHANNEL_KINDS = ['discord', 'telegram']
/** каналів на одного власника */
export const MAX_CHANNELS = 5
const MAX_ATTEMPTS = 6
/** пауза перед спробою n (1…): 1 хв, 2, 4, 8, 16 */
const backoff = (n) => 60_000 * 2 ** Math.max(0, n - 1)
/** посилання Telegram для підключення живе пів години */
const LINK_TTL = 30 * 60_000

/** ключ перекладу (помилка каналу лежить у базі українським текстом; сайт показує її мовою людини) */
const t = (k) => k

const cleanTopics = (v) => {
  const list = Array.isArray(v) ? v.filter((x) => TOPIC_IDS.includes(x)) : TOPIC_IDS
  return [...new Set(list)]
}

/**
 * deps: db, i18n (переклад повідомлень мовою каналу), guilds (учасники гільдії), site — адреса сайту для посилань,
 * fetch — для тестів, telegramToken — токен бота (нема — Telegram вимкнено), background — опитувати бота Telegram
 */
export async function createNotify({ db, i18n, guilds, log = console, now = Date.now, site = process.env.APP_URL || 'https://dune.test', fetch: doFetch = globalThis.fetch, telegramToken = process.env.TELEGRAM_BOT_TOKEN || null }) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notify_channels (
      id TEXT PRIMARY KEY, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
      label TEXT, topics TEXT NOT NULL, lang TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, error TEXT,
      created_by TEXT, created BIGINT NOT NULL, last_sent BIGINT
    );
    CREATE INDEX IF NOT EXISTS notify_channels_owner ON notify_channels (owner_kind, owner_id);
    CREATE TABLE IF NOT EXISTS notify_outbox (
      id {{SERIAL}}, channel_id TEXT NOT NULL, topic TEXT NOT NULL, data TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      next_at BIGINT NOT NULL, created BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notify_outbox_due ON notify_outbox (next_at);
    CREATE TABLE IF NOT EXISTS notify_links (
      code TEXT PRIMARY KEY, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, topics TEXT NOT NULL, lang TEXT NOT NULL,
      created_by TEXT, created BIGINT NOT NULL, expires BIGINT NOT NULL, channel_id TEXT
    );
    CREATE TABLE IF NOT EXISTS notify_sent (key TEXT PRIMARY KEY, at BIGINT NOT NULL);
  `)
  const base = String(site).replace(/\/+$/, '')
  const discord = createDiscord({ fetch: doFetch })
  const telegram = createTelegram({ fetch: doFetch, token: telegramToken, log })
  const tr = (lang, key, vars) => (i18n ? i18n.t(lang, key, vars) : key.replace(/\{(\w+)\}/g, (m, k) => (vars?.[k] ?? m)))

  const row2channel = (r) => r && ({
    id: r.id, owner: { kind: r.owner_kind, id: r.owner_id }, kind: r.kind, target: r.target, label: r.label ?? null,
    topics: JSON.parse(r.topics), lang: r.lang, enabled: !!Number(r.enabled), error: r.error ?? null,
    createdBy: r.created_by ?? null, created: Number(r.created), lastSent: r.last_sent == null ? null : Number(r.last_sent),
  })
  const get = async (id) => row2channel(await db.get('SELECT * FROM notify_channels WHERE id = ?', id))
  const list = async (owner) => (await db.all('SELECT * FROM notify_channels WHERE owner_kind = ? AND owner_id = ? ORDER BY created', owner.kind, owner.id)).map(row2channel)

  async function insertChannel(owner, { kind, target, label, topics, lang, by }) {
    const n = (await db.get('SELECT COUNT(*) AS n FROM notify_channels WHERE owner_kind = ? AND owner_id = ?', owner.kind, owner.id)).n
    if (Number(n) >= MAX_CHANNELS) throw fail('не більше {n} каналів сповіщень', 409, { n: MAX_CHANNELS })
    const dup = await db.get('SELECT id FROM notify_channels WHERE owner_kind = ? AND owner_id = ? AND kind = ? AND target = ?', owner.kind, owner.id, kind, target)
    if (dup) throw fail('цей канал уже підключено', 409)
    const id = 'n' + crypto.randomBytes(6).toString('hex')
    await db.run('INSERT INTO notify_channels (id, owner_kind, owner_id, kind, target, label, topics, lang, enabled, created_by, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      id, owner.kind, owner.id, kind, target, label ?? null, JSON.stringify(cleanTopics(topics)), lang, by ?? null, now())
    return get(id)
  }

  /** Discord: перевірити вебхук у служби (адреса справжня, вебхук живий) і запам'ятати його назву */
  async function addDiscord(owner, { url, topics, lang, by }) {
    const info = await discord.check(url)
    return insertChannel(owner, { kind: 'discord', target: discord.normalize(url), label: info.name, topics, lang, by })
  }

  async function update(id, patch) {
    const c = await get(id)
    if (!c) return null
    const topics = patch.topics !== undefined ? JSON.stringify(cleanTopics(patch.topics)) : JSON.stringify(c.topics)
    // увімкнули знову — і помилку геть (людина підключила вебхук наново чи повернула бота)
    const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : c.enabled ? 1 : 0
    const error = patch.enabled ? null : c.error
    await db.run('UPDATE notify_channels SET topics = ?, enabled = ?, lang = ?, error = ? WHERE id = ?', topics, enabled, patch.lang ?? c.lang, error, id)
    return get(id)
  }

  async function remove(id) {
    await db.run('DELETE FROM notify_outbox WHERE channel_id = ?', id)
    await db.run('DELETE FROM notify_channels WHERE id = ?', id)
  }
  /** власник зник (людину чи гільдію видалено) — його канали теж */
  async function forgetOwner(owner) {
    for (const c of await list(owner)) await remove(c.id)
  }

  /** канали, що мають отримати тему з цим scope */
  async function audience(topic, scope) {
    const rows = (await db.all('SELECT * FROM notify_channels WHERE enabled = 1')).map(row2channel).filter((c) => c.topics.includes(topic))
    if (!rows.length) return []
    const pub = scope.visibility === 'public' && TOPICS[topic]?.public
    const guild = scope.guild ?? null
    // учасники гільдії події (їхні особисті канали теж) — одним запитом
    const members = guild && rows.some((c) => c.owner.kind === 'user') ? new Set((await guilds.members(guild)).map((m) => m.id)) : new Set()
    const own = scope.owner ?? null
    return rows.filter((c) => {
      if (pub) return true
      if (own && c.owner.kind === own.kind && c.owner.id === own.id) return true
      if (!guild) return false
      return c.owner.kind === 'guild' ? c.owner.id === guild : members.has(c.owner.id)
    })
  }

  let delivering = null
  /** рядки черги, яким пора: надіслати; результат — скільки надіслано */
  async function deliver() {
    if (delivering) return delivering
    delivering = (async () => {
      let sent = 0
      const due = await db.all('SELECT * FROM notify_outbox WHERE next_at <= ? ORDER BY id LIMIT 50', now())
      for (const row of due) {
        const c = await get(row.channel_id)
        if (!c || !c.enabled) { await db.run('DELETE FROM notify_outbox WHERE id = ?', row.id); continue }
        const msg = renderMessage(row.topic, JSON.parse(row.data), { t: (k, v) => tr(c.lang, k, v), lang: c.lang, site: base, kind: c.kind })
        const r = await send(c, msg)
        if (r.ok) {
          sent++
          await db.run('DELETE FROM notify_outbox WHERE id = ?', row.id)
          await db.run('UPDATE notify_channels SET last_sent = ?, error = NULL WHERE id = ?', now(), c.id)
        } else if (r.permanent) {
          await disable(c.id, r.error)
        } else {
          const attempts = Number(row.attempts) + 1
          if (attempts >= MAX_ATTEMPTS) {
            await db.run('DELETE FROM notify_outbox WHERE id = ?', row.id)
            await db.run('UPDATE notify_channels SET error = ? WHERE id = ?', r.error, c.id)
          } else {
            await db.run('UPDATE notify_outbox SET attempts = ?, next_at = ? WHERE id = ?', attempts, now() + Math.max(backoff(attempts), r.retryAfter ?? 0), row.id)
          }
        }
      }
      return sent
    })()
    try { return await delivering } finally { delivering = null }
  }

  const send = (c, msg) => (c.kind === 'discord' ? discord.send(c.target, msg) : telegram.send(c.target, msg))
  async function disable(id, error) {
    await db.run('UPDATE notify_channels SET enabled = 0, error = ? WHERE id = ?', String(error ?? '').slice(0, 500), id)
    await db.run('DELETE FROM notify_outbox WHERE channel_id = ?', id)
  }

  /**
   * Подія сайту: тема, дані для повідомлення (messages.mjs), scope { visibility, guild?, owner? }. Рядки черги — одразу,
   * надсилання — у фоні (виклик не чекає служб). Результат — скільки каналів отримає.
   */
  async function emit(topic, data, scope = { visibility: 'public' }) {
    if (!TOPICS[topic]) throw new Error(`невідома тема сповіщень ${topic}`)
    const to = await audience(topic, scope)
    const at = now()
    for (const c of to) await db.run('INSERT INTO notify_outbox (channel_id, topic, data, attempts, next_at, created) VALUES (?, ?, ?, 0, ?, ?)', c.id, topic, JSON.stringify(data), at, at)
    if (to.length) deliver().catch((e) => log.warn?.(`[notify] ${e?.message || e}`))
    return to.length
  }

  /** раз на ключ (сповіщення «скоро почнеться» — одне на подію й час): true — уперше */
  async function once(key) {
    const r = await db.run('INSERT INTO notify_sent (key, at) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', key, now())
    return !!r.changes
  }

  /** пробне повідомлення в канал — одразу, без черги; результат служби */
  async function test(id) {
    const c = await get(id)
    if (!c) return null
    const r = await send(c, renderMessage('test', {}, { t: (k, v) => tr(c.lang, k, v), lang: c.lang, site: base, kind: c.kind }))
    if (r.ok) await db.run('UPDATE notify_channels SET last_sent = ?, error = NULL, enabled = 1 WHERE id = ?', now(), id)
    else if (r.permanent) await disable(id, r.error)
    return { ok: r.ok, error: r.ok ? null : r.error }
  }

  // ---------- Telegram: підключення чату за одноразовим кодом ----------
  /** посилання для підключення: особистий чат (start) чи група (startgroup) */
  async function telegramLink(owner, { topics, lang, by }) {
    if (!telegram.enabled) throw fail('Telegram-бот сайту ще не налаштовано', 409)
    const me = await telegram.me()
    if (!me?.username) throw fail('Telegram зараз не відповідає — спробуй трохи згодом', 503)
    const code = crypto.randomBytes(9).toString('base64url')
    await db.run('DELETE FROM notify_links WHERE expires < ?', now())
    await db.run('INSERT INTO notify_links (code, owner_kind, owner_id, topics, lang, created_by, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      code, owner.kind, owner.id, JSON.stringify(cleanTopics(topics)), lang, by ?? null, now(), now() + LINK_TTL)
    return { code, bot: me.username, private: `https://t.me/${me.username}?start=${code}`, group: `https://t.me/${me.username}?startgroup=${code}`, expires: now() + LINK_TTL }
  }
  /** стан коду: чекає / підключено (канал) / прострочено */
  async function linkStatus(code, owner) {
    const l = await db.get('SELECT * FROM notify_links WHERE code = ? AND owner_kind = ? AND owner_id = ?', code, owner.kind, owner.id)
    if (!l) return { state: 'gone' }
    if (l.channel_id) return { state: 'done', channel: await get(l.channel_id) }
    return Number(l.expires) < now() ? { state: 'gone' } : { state: 'waiting' }
  }

  /** оновлення бота: /start <код> у чаті — прив'язати; бота вигнали — вимкнути канали цього чату */
  async function onTelegramUpdate(u) {
    const m = u.message
    const text = m?.text ?? ''
    const start = /^\/start(?:@\w+)?\s+([\w-]{6,40})\s*$/.exec(text)
    if (m && start) {
      const l = await db.get('SELECT * FROM notify_links WHERE code = ?', start[1])
      const chatId = String(m.chat.id)
      const label = m.chat.title || (m.chat.username ? '@' + m.chat.username : [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ')) || null
      if (!l || l.channel_id || Number(l.expires) < now()) {
        await telegram.send(chatId, renderMessage('linkGone', {}, { t: (k, v) => tr(l?.lang ?? 'uk', k, v), lang: l?.lang ?? 'uk', site: base, kind: 'telegram' })).catch(() => {})
        return
      }
      let c
      try {
        const owner = { kind: l.owner_kind, id: l.owner_id }
        const dup = await db.get("SELECT id FROM notify_channels WHERE owner_kind = ? AND owner_id = ? AND kind = 'telegram' AND target = ?", owner.kind, owner.id, chatId)
        c = dup ? await update(dup.id, { enabled: true, topics: JSON.parse(l.topics) }) : await insertChannel(owner, { kind: 'telegram', target: chatId, label, topics: JSON.parse(l.topics), lang: l.lang, by: l.created_by })
      } catch (e) {
        await telegram.send(chatId, { text: tr(l.lang, e.key || e.message, e.vars) }).catch(() => {})
        return
      }
      await db.run('UPDATE notify_links SET channel_id = ? WHERE code = ?', c.id, l.code)
      await test(c.id)
      return
    }
    const cm = u.my_chat_member
    if (cm && ['left', 'kicked'].includes(cm.new_chat_member?.status)) {
      for (const r of await db.all("SELECT id FROM notify_channels WHERE kind = 'telegram' AND target = ?", String(cm.chat.id))) await disable(r.id, t('Telegram: бота заблоковано чи прибрано з чату'))
    }
  }

  /** довге опитування бота (лише з токеном і у фоні): публічна адреса сайту для цього не потрібна */
  const poller = telegram.enabled ? telegram.poll((u) => onTelegramUpdate(u).catch((e) => log.warn?.(`[notify] telegram: ${e?.message || e}`))) : null

  return {
    TOPICS, emit, deliver, once, list, get, addDiscord, update, remove, forgetOwner, test,
    telegramLink, linkStatus, onTelegramUpdate,
    telegramEnabled: () => telegram.enabled,
    start: () => poller?.start(), stop: () => poller?.stop(),
  }
}

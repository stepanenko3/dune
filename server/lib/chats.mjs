/*
 * Розмови на сайті — одні на всі місця: особисті (двоє людей), угоди біржі (сторони угоди) і гільдії (усі учасники).
 * Тут — лише зберігання: розмови (вид і ref — пара людей «a:b» за абеткою, id угоди чи гільдії; останнє повідомлення для
 * списку), учасники (прочитано до, без звуку), повідомлення (відповідь на, змінено, видалено), реакції, блокування.
 * Хто що може — вирішує маршрут (routes/chats.mjs): доступ залежить від виду розмови.
 */
import { newId, plain } from './util.mjs'

export const CHAT_KINDS = ['direct', 'deal', 'guild']
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥']
export const MAX_TEXT = 2000
/** змінити своє повідомлення можна стільки хвилин */
export const EDIT_MIN = 15

/** ref особистої розмови: id двох людей за абеткою */
export const pairRef = (a, b) => [a, b].sort().join(':')

export async function createChats(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, ref TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
      last_at BIGINT, last_text TEXT NOT NULL DEFAULT '', last_user TEXT, created BIGINT NOT NULL, updated BIGINT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS chats_by_ref ON chats (kind, ref);
    CREATE INDEX IF NOT EXISTS chats_by_last ON chats (last_at);
    CREATE TABLE IF NOT EXISTS chat_members (
      chat_id TEXT NOT NULL, user_id TEXT NOT NULL, joined BIGINT NOT NULL, last_read BIGINT NOT NULL DEFAULT 0,
      muted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (chat_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS chat_members_by_user ON chat_members (user_id);
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, user_id TEXT, text TEXT NOT NULL, reply_to TEXT,
      at BIGINT NOT NULL, edited BIGINT, deleted BIGINT
    );
    CREATE INDEX IF NOT EXISTS chat_messages_by_chat ON chat_messages (chat_id, at);
    CREATE TABLE IF NOT EXISTS chat_reactions (message_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (message_id, user_id, emoji));
    CREATE TABLE IF NOT EXISTS chat_blocks (user_id TEXT NOT NULL, blocked TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (user_id, blocked));
  `)
  const qs = (a) => a.map(() => '?').join(',')
  const chatRow = (r) => (r ? { id: r.id, kind: r.kind, ref: r.ref, title: r.title, lastAt: r.last_at == null ? null : Number(r.last_at), lastText: r.last_text, lastUser: r.last_user, created: Number(r.created), updated: Number(r.updated) } : null)
  const msgRow = (r) => (r ? { id: r.id, chat: r.chat_id, user: r.user_id, text: r.deleted ? '' : r.text, reply: r.reply_to, at: Number(r.at), edited: r.edited == null ? null : Number(r.edited), deleted: r.deleted == null ? null : Number(r.deleted) } : null)
  const get = async (id) => chatRow(await db.get('SELECT * FROM chats WHERE id = ?', String(id)))
  const byRef = async (kind, ref) => chatRow(await db.get('SELECT * FROM chats WHERE kind = ? AND ref = ?', kind, String(ref)))
  /** реакції повідомлень: Map(id → [{ emoji, n, users }]) */
  async function reactionsOf(ids) {
    const out = new Map()
    for (let i = 0; i < ids.length; i += 400) {
      const part = ids.slice(i, i + 400)
      if (!part.length) continue
      for (const r of await db.all(`SELECT message_id, emoji, user_id FROM chat_reactions WHERE message_id IN (${qs(part)}) ORDER BY at`, ...part)) {
        const list = out.get(r.message_id) || []
        let e = list.find((x) => x.emoji === r.emoji)
        if (!e) { e = { emoji: r.emoji, n: 0, users: [] }; list.push(e) }
        e.n++
        e.users.push(r.user_id)
        out.set(r.message_id, list)
      }
    }
    return out
  }

  const api = {
    get,
    byRef,
    /** розмова виду й ref (нема — створити) */
    async ensure(kind, ref, { title = '' } = {}) {
      const have = await byRef(kind, ref)
      if (have) return have
      const now = Date.now()
      await db.run('INSERT INTO chats (id, kind, ref, title, last_at, last_text, last_user, created, updated) VALUES (?, ?, ?, ?, NULL, \'\', NULL, ?, ?) ON CONFLICT DO NOTHING', newId('ch'), kind, String(ref), plain(title, 120), now, now)
      return byRef(kind, ref)
    },
    /** учасник (рядок для «прочитано» й «без звуку»): є — як є, нема — додати */
    async join(chatId, uid) {
      await db.run('INSERT INTO chat_members (chat_id, user_id, joined, last_read, muted) VALUES (?, ?, ?, 0, 0) ON CONFLICT DO NOTHING', String(chatId), uid, Date.now())
      return api.member(chatId, uid)
    },
    member: async (chatId, uid) => { const r = await db.get('SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?', String(chatId), uid); return r ? { lastRead: Number(r.last_read), muted: !!Number(r.muted), joined: Number(r.joined) } : null },
    memberIds: async (chatId) => (await db.all('SELECT user_id FROM chat_members WHERE chat_id = ?', String(chatId))).map((r) => r.user_id),
    /** прочитано до мить at (не назад) */
    markRead: (chatId, uid, at) => db.run('UPDATE chat_members SET last_read = CASE WHEN last_read > ? THEN last_read ELSE ? END WHERE chat_id = ? AND user_id = ?', at, at, String(chatId), uid),
    mute: (chatId, uid, on) => db.run('UPDATE chat_members SET muted = ? WHERE chat_id = ? AND user_id = ?', on ? 1 : 0, String(chatId), uid),

    // ---------- повідомлення ----------
    async add(chatId, uid, text, replyTo = null) {
      const id = newId('cm')
      const at = Date.now()
      await db.run('INSERT INTO chat_messages (id, chat_id, user_id, text, reply_to, at, edited, deleted) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)', id, String(chatId), uid, text, replyTo, at)
      await db.run('UPDATE chats SET last_at = ?, last_text = ?, last_user = ?, updated = ? WHERE id = ?', at, text.slice(0, 140), uid, at, String(chatId))
      return msgRow(await db.get('SELECT * FROM chat_messages WHERE id = ?', id))
    },
    message: async (id) => msgRow(await db.get('SELECT * FROM chat_messages WHERE id = ?', String(id))),
    /** сторінка повідомлень: найсвіжіші limit до before (за часом), у хронологічному порядку; з реакціями й цитатами */
    async messages(chatId, { before = null, limit = 50 } = {}) {
      const lim = Math.min(100, Math.max(1, Number(limit) || 50))
      const rows = before
        ? await db.all('SELECT * FROM chat_messages WHERE chat_id = ? AND at < ? ORDER BY at DESC, id DESC LIMIT ?', String(chatId), Number(before), lim + 1)
        : await db.all('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY at DESC, id DESC LIMIT ?', String(chatId), lim + 1)
      const more = rows.length > lim
      const list = rows.slice(0, lim).reverse().map(msgRow)
      return { rows: await api.decorate(list), more }
    },
    /** реакції й цитата (на що відповідь: хто й початок тексту) */
    async decorate(list) {
      const reacts = await reactionsOf(list.map((m) => m.id))
      const replyIds = [...new Set(list.map((m) => m.reply).filter(Boolean))]
      const quotes = new Map()
      for (const id of replyIds) { const q = await api.message(id); if (q) quotes.set(id, { id: q.id, user: q.user, text: q.deleted ? '' : q.text.slice(0, 140), deleted: !!q.deleted }) }
      return list.map((m) => ({ ...m, reactions: reacts.get(m.id) || [], quote: m.reply ? quotes.get(m.reply) || null : null }))
    },
    async edit(id, text) {
      await db.run('UPDATE chat_messages SET text = ?, edited = ? WHERE id = ? AND deleted IS NULL', text, Date.now(), String(id))
      return api.message(id)
    },
    async remove(id) {
      await db.run("UPDATE chat_messages SET text = '', deleted = ? WHERE id = ?", Date.now(), String(id))
      await db.run('DELETE FROM chat_reactions WHERE message_id = ?', String(id))
      return api.message(id)
    },
    /** реакція (одна людина — кожне емодзі раз); повертає реакції повідомлення */
    async react(mid, uid, emoji, on) {
      if (on) await db.run('INSERT INTO chat_reactions (message_id, user_id, emoji, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', String(mid), uid, emoji, Date.now())
      else await db.run('DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', String(mid), uid, emoji)
      return (await reactionsOf([String(mid)])).get(String(mid)) || []
    },

    // ---------- списки ----------
    /** непрочитані в розмовах: Map(id → n) (свої й видалені не рахуються) */
    async unread(uid, chatIds) {
      const out = new Map()
      for (let i = 0; i < chatIds.length; i += 400) {
        const part = chatIds.slice(i, i + 400)
        if (!part.length) continue
        for (const r of await db.all(`SELECT m.chat_id, COUNT(*) AS n FROM chat_messages m LEFT JOIN chat_members cm ON cm.chat_id = m.chat_id AND cm.user_id = ?
          WHERE m.chat_id IN (${qs(part)}) AND m.deleted IS NULL AND (m.user_id IS NULL OR m.user_id <> ?) AND m.at > COALESCE(cm.last_read, 0) GROUP BY m.chat_id`, uid, ...part, uid)) out.set(r.chat_id, Number(r.n))
      }
      return out
    },
    /** розмови людини: де вона учасник (особисті й угоди) плюс extra (гільдійська) — свіжі згори */
    async listFor(uid, extra = []) {
      const mine = (await db.all('SELECT chat_id FROM chat_members WHERE user_id = ?', uid)).map((r) => r.chat_id)
      const ids = [...new Set([...mine, ...extra])]
      if (!ids.length) return []
      const rows = []
      for (let i = 0; i < ids.length; i += 400) {
        const part = ids.slice(i, i + 400)
        rows.push(...(await db.all(`SELECT * FROM chats WHERE id IN (${qs(part)})`, ...part)))
      }
      return rows.map(chatRow).sort((a, b) => (b.lastAt ?? b.created) - (a.lastAt ?? a.created))
    },
    /** усі розмови — для панелі керування (q — у назві, ref чи останньому тексті) */
    async listAll({ kind = '', q = '', limit = 50, offset = 0 } = {}) {
      const where = [], args = []
      if (CHAT_KINDS.includes(kind)) { where.push('kind = ?'); args.push(kind) }
      const text = String(q).trim().toLowerCase()
      if (text) { where.push('(lower(title) LIKE ? OR lower(ref) LIKE ? OR lower(last_text) LIKE ? OR id IN (SELECT chat_id FROM chat_members m JOIN users u ON u.id = m.user_id WHERE lower(u.name) LIKE ? OR lower(u.login) LIKE ?))'); args.push(...Array(5).fill(`%${text.replace(/[%_]/g, '')}%`)) }
      const W = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const rows = await db.all(`SELECT * FROM chats ${W} ORDER BY COALESCE(last_at, created) DESC LIMIT ? OFFSET ?`, ...args, Math.min(100, Number(limit) || 50), Math.max(0, Number(offset) || 0))
      const total = Number((await db.get(`SELECT COUNT(*) AS n FROM chats ${W}`, ...args)).n)
      return { rows: rows.map(chatRow), total }
    },
    count: async (chatId) => Number((await db.get('SELECT COUNT(*) AS n FROM chat_messages WHERE chat_id = ? AND deleted IS NULL', String(chatId))).n),

    // ---------- блокування ----------
    block: (uid, other, on) => (on
      ? db.run('INSERT INTO chat_blocks (user_id, blocked, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', uid, other, Date.now())
      : db.run('DELETE FROM chat_blocks WHERE user_id = ? AND blocked = ?', uid, other)),
    /** хтось із двох заблокував іншого: { byMe, byThem } */
    async blocks(uid, other) {
      const rows = await db.all('SELECT user_id FROM chat_blocks WHERE (user_id = ? AND blocked = ?) OR (user_id = ? AND blocked = ?)', uid, other, other, uid)
      return { byMe: rows.some((r) => r.user_id === uid), byThem: rows.some((r) => r.user_id === other) }
    },

    /** людину видалено: її членства, реакції й блокування — геть; її повідомлення лишаються без імені */
    async forgetUser(uid) {
      await db.run('DELETE FROM chat_members WHERE user_id = ?', uid)
      await db.run('DELETE FROM chat_reactions WHERE user_id = ?', uid)
      await db.run('DELETE FROM chat_blocks WHERE user_id = ? OR blocked = ?', uid, uid)
      await db.run('UPDATE chat_messages SET user_id = NULL WHERE user_id = ?', uid)
    },
  }
  return api
}

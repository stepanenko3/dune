/*
 * Сповіщення на сайті — загальні (не лише біржа): людині, у дзвоник шапки. У рядку — вид (market.offer, …) і дані з
 * id (оголошення, угоди, предмета гри): текст складає клієнт мовою людини, а сторінка, куди веде сповіщення, сама
 * перевіряє доступ. ref — ключ згортання: поки сповіщення з тим самим видом і ref не прочитане, нове лише оновлює його
 * (count + 1) — десять повідомлень в угоді дають одне сповіщення, а не десять.
 * push(uid, подія) — живий потік лише цій людині (app.mjs: SSE через createHub().emitWhere).
 */
import { newId } from './util.mjs'

const KEEP_DAYS = 90
const MAX_DATA = 2000

export async function createNotifications(db, { push = null } = {}) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, data TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1, read_at BIGINT, created BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_by_user ON notifications (user_id, created);
  `)
  const unread = async (uid) => Number((await db.get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', uid)).n)
  const tell = async (uid) => { if (push) await Promise.resolve(push(uid, { op: 'note', unread: await unread(uid) })).catch(() => {}) }
  const row = (r) => ({ id: r.id, kind: r.kind, data: JSON.parse(r.data), count: Number(r.count), read: r.read_at != null, created: Number(r.created) })

  return {
    unread,
    /** сповістити людину; { ref } — згорнути з непрочитаним того самого виду й ref */
    async notify(uid, kind, data = {}, { ref = null } = {}) {
      if (!uid) return
      const json = JSON.stringify(data)
      if (json.length > MAX_DATA) throw new Error('завеликі дані сповіщення')
      const now = Date.now()
      const done = ref
        ? (await db.run('UPDATE notifications SET data = ?, count = count + 1, created = ? WHERE user_id = ? AND kind = ? AND ref = ? AND read_at IS NULL', json, now, uid, kind, String(ref))).changes
        : 0
      if (!done) await db.run('INSERT INTO notifications (id, user_id, kind, ref, data, count, read_at, created) VALUES (?, ?, ?, ?, ?, 1, NULL, ?)', newId('n'), uid, kind, ref == null ? null : String(ref), json, now)
      await tell(uid)
    },
    /** найсвіжіші згори; before — для «показати давніші» */
    async list(uid, { limit = 30, before = null } = {}) {
      const lim = Math.min(100, Math.max(1, Number(limit) || 30))
      const rows = before
        ? await db.all('SELECT * FROM notifications WHERE user_id = ? AND created < ? ORDER BY created DESC, id DESC LIMIT ?', uid, Number(before), lim)
        : await db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created DESC, id DESC LIMIT ?', uid, lim)
      return { rows: rows.map(row), unread: await unread(uid) }
    },
    /** позначити прочитаним: список id чи 'all'; повертає, скільки позначено */
    async read(uid, ids) {
      const now = Date.now()
      let n = 0
      if (ids === 'all') n = (await db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now, uid)).changes
      else {
        const list = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === 'string'))].slice(0, 200)
        if (list.length) n = (await db.run(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${list.map(() => '?').join(',')})`, now, uid, ...list)).changes
      }
      if (n) await tell(uid)
      return n
    },
    /** прочитані, старші за 90 днів, — геть (щоденне «Прибирання») */
    purgeOld: async (now = Date.now()) => (await db.run('DELETE FROM notifications WHERE read_at IS NOT NULL AND created < ?', now - KEEP_DAYS * 86400_000)).changes,
    forgetUser: (uid) => db.run('DELETE FROM notifications WHERE user_id = ?', uid),
  }
}

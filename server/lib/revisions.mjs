/*
 * Версії записів: кожна зміна будь-чого (з панелі керування чи з сайту) — рядок revisions: що (розділ і id), дія
 * (create/update/delete/…), хто, коли, стан до й після (JSON). З них панель показує історію запису й різницю між
 * версіями. Великі документи (бази) обрізаються до LIMIT — повна історія баз і роадмапів ще й у їхніх власних таблицях.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const LIMIT = 1_500_000

/** назва запису зі стану (база, людина, гільдія, роль…) */
export const nameOf = (o) => (o && typeof o === 'object' ? o.title || o.name || o.login || o.doc?.name || o.doc?.title || null : null)

/** хто робить запит — для версій зі сховищ, які самі про людину не знають (ставить middleware у app.mjs); engine: true —
 * зміну робить панель керування, і версію пише її рушій (сховища тоді своєї не пишуть, щоб не було двох-трьох копій) */
export const actorStore = new AsyncLocalStorage()

export async function createRevisions(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS revisions (
      id {{SERIAL}}, entity TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT, at BIGINT NOT NULL,
      before TEXT, after TEXT, note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS revisions_by_entity ON revisions (entity, entity_id, id);
    CREATE INDEX IF NOT EXISTS revisions_by_actor ON revisions (actor, id);
    CREATE INDEX IF NOT EXISTS revisions_by_at ON revisions (at);
  `)
  // назва запису на мить зміни — щоб журнал показував назву й видаленого, не розбираючи «було / стало»
  await db.addColumn('revisions', 'title', 'TEXT')
  const pack = (v) => {
    if (v == null) return null
    const s = JSON.stringify(v)
    return s.length > LIMIT ? JSON.stringify({ _truncated: true, size: s.length }) : s
  }
  return {
    /** записати версію (помилки запису не ламають саму зміну) */
    async record(entity, id, action, before, after, actor, note = '') {
      try {
        const title = nameOf(after) ?? nameOf(before)
        await db.run('INSERT INTO revisions (entity, entity_id, action, actor, at, before, after, note, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          String(entity), String(id), String(action), actor || actorStore.getStore()?.userId || null, Date.now(), pack(before), pack(after), String(note).slice(0, 300), title == null ? null : String(title).slice(0, 200))
      } catch { /* журнал версій — допоміжний */ }
    },
    /** версії запису, новіші першими */
    list: (entity, id, limit = 50, offset = 0) =>
      db.all('SELECT r.id, r.action, r.actor, r.at, r.note, r.title, u.name AS actor_name, u.login AS actor_login FROM revisions r LEFT JOIN users u ON u.id = r.actor WHERE r.entity = ? AND r.entity_id = ? ORDER BY r.id DESC LIMIT ? OFFSET ?', String(entity), String(id), limit, offset),
    /** забути історію записів (річ стерто назавжди): [[розділ, id], …] */
    async forget(pairs) {
      for (const [entity, id] of pairs) await db.run('DELETE FROM revisions WHERE entity = ? AND entity_id = ?', String(entity), String(id))
    },
    async get(id) {
      const r = await db.get('SELECT r.*, u.name AS actor_name FROM revisions r LEFT JOIN users u ON u.id = r.actor WHERE r.id = ?', Number(id))
      if (!r) return null
      const parse = (v) => { try { return v ? JSON.parse(v) : null } catch { return null } }
      return { ...r, before: parse(r.before), after: parse(r.after) }
    },
  }
}

/**
 * Версії для змін зі сховищ (сайт, не панель): обгортає методи сховища. spec: { метод: { action, id(args, result),
 * read(id) — стан до/після } }. Методу, якого в сховищі нема, — просто пропускаємо.
 */
export function track(store, entity, revisions, spec) {
  for (const [name, o] of Object.entries(spec)) {
    const fn = store[name]
    if (typeof fn !== 'function') continue
    store[name] = async (...args) => {
      if (actorStore.getStore()?.engine) return fn.apply(store, args)
      const pre = o.pre ? o.id(args) : null
      const before = pre != null && o.read ? await o.read(pre).catch(() => null) : null
      const result = await fn.apply(store, args)
      const id = o.id(args, result)
      if (id != null) {
        const after = o.action === 'delete' || !o.read ? null : await o.read(id).catch(() => null)
        await revisions.record(entity, typeof id === 'string' ? id : JSON.stringify(id), o.action, before, after)
      }
      return result
    }
  }
  return store
}

/**
 * Різниця двох JSON-значень — список змін за шляхами: [{ path, type: 'add'|'remove'|'change', from, to }].
 * Масиви об'єктів з id зіставляються за id (деталь бази переставили — це не «змінилось усе»), інші — за індексом.
 */
export function jsonDiff(a, b, path = '', out = [], max = 400) {
  if (out.length >= max) return out
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
  if (Array.isArray(a) && Array.isArray(b)) {
    const byId = a.every((x) => isObj(x) && x.id != null) && b.every((x) => isObj(x) && x.id != null)
    if (byId) {
      const am = new Map(a.map((x) => [String(x.id), x])), bm = new Map(b.map((x) => [String(x.id), x]))
      for (const [id, x] of am) if (!bm.has(id)) out.push({ path: `${path}[id=${id}]`, type: 'remove', from: x })
      for (const [id, x] of bm) {
        if (!am.has(id)) out.push({ path: `${path}[id=${id}]`, type: 'add', to: x })
        else jsonDiff(am.get(id), x, `${path}[id=${id}]`, out, max)
        if (out.length >= max) break
      }
      return out
    }
    // списки рядків (дозволи ролі, теги) — як множини: що додано, що прибрано, без зсуву за позиціями
    const plainList = (l) => l.every((x) => typeof x === 'string')
    if (plainList(a) && plainList(b)) {
      const as = new Set(a), bs = new Set(b)
      for (const x of a) if (!bs.has(x) && out.length < max) out.push({ path: `${path}[]`, type: 'remove', from: x })
      for (const x of b) if (!as.has(x) && out.length < max) out.push({ path: `${path}[]`, type: 'add', to: x })
      return out
    }
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n && out.length < max; i++) {
      if (i >= a.length) out.push({ path: `${path}[${i}]`, type: 'add', to: b[i] })
      else if (i >= b.length) out.push({ path: `${path}[${i}]`, type: 'remove', from: a[i] })
      else jsonDiff(a[i], b[i], `${path}[${i}]`, out, max)
    }
    return out
  }
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = path ? `${path}.${k}` : k
      if (!(k in b)) out.push({ path: p, type: 'remove', from: a[k] })
      else if (!(k in a)) out.push({ path: p, type: 'add', to: b[k] })
      else jsonDiff(a[k], b[k], p, out, max)
      if (out.length >= max) break
    }
    return out
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: path || '·', type: a === undefined ? 'add' : b === undefined ? 'remove' : 'change', from: a, to: b })
  return out
}

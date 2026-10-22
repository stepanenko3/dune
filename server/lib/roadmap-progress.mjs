/*
 * Прогрес роадмапів — окремо від документа: позначки (статус етапу, галочка задачі, «зібрано» на картці) рядками
 * roadmap_marks, по одному на позначку, у «записі» (scope) — чий це прогрес: 'u:<людина>', 'g:<гільдія>', 'site'
 * чи 'all' (спільний на всіх). Рядок на позначку, а не документ на запис: двоє учасників гільдії, що відмічають
 * одночасно, не затирають одне одного. Немає рядка — «не відмічено» (етап — «Заплановано»).
 * Позначка прив'язана до id етапу / задачі / картки: переставляння їх не ламає, а видалене зі змісту просто не
 * рахується (повернули версію — позначка знову на місці).
 * Журнал позначок (roadmap_marks_log) — для спільних записів і для гільдійського «у кожного свій» (прогрес учасників):
 * хто, що, коли; останні KEEP на запис.
 */
import { fail } from './util.mjs'

export const KINDS = ['s', 't', 'c']
const STAGE = new Set(['todo', 'doing', 'done'])
const KEEP = 500
const ID = /^[\w-]{1,32}$/

/** порожній стан запису */
export const emptyState = () => ({ s: {}, t: {}, c: {} })

/** значення з запиту → рядок у базі (null — зняти позначку) */
export function markValue(kind, value) {
  if (!KINDS.includes(kind)) throw fail('невідомий вид позначки')
  if (kind === 's') {
    if (!STAGE.has(value)) throw fail('статус етапу — todo, doing чи done')
    return value === 'todo' ? null : value
  }
  if (typeof value !== 'boolean') throw fail('позначка — так чи ні')
  return value ? '1' : null
}

/** стан запису → скільки етапів виконано з поточних (ids — етапи документа) */
export const doneOf = (state, ids) => ids.filter((id) => state.s[id] === 'done').length

export async function createProgress(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS roadmap_marks (
      roadmap_id TEXT NOT NULL, scope TEXT NOT NULL, kind TEXT NOT NULL, item TEXT NOT NULL, value TEXT NOT NULL,
      at BIGINT NOT NULL, by_user TEXT, PRIMARY KEY (roadmap_id, scope, kind, item)
    );
    CREATE INDEX IF NOT EXISTS roadmap_marks_by_scope ON roadmap_marks (scope);
    CREATE TABLE IF NOT EXISTS roadmap_marks_log (
      id {{SERIAL}}, roadmap_id TEXT NOT NULL, scope TEXT NOT NULL, actor TEXT, at BIGINT NOT NULL,
      kind TEXT NOT NULL, item TEXT NOT NULL, value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS roadmap_marks_log_by ON roadmap_marks_log (roadmap_id, scope, id);
  `)
  const toState = (rows) => {
    const st = emptyState()
    for (const r of rows) st[r.kind][r.item] = r.kind === 's' ? r.value : true
    return st
  }
  /** записати позначку (null — зняти); у спільному — більший статус не перебиває менший при злитті (merge) */
  const put = async (t, rid, scope, kind, item, value, actor, merge = false) => {
    if (value == null) {
      if (!merge) await t.run('DELETE FROM roadmap_marks WHERE roadmap_id = ? AND scope = ? AND kind = ? AND item = ?', rid, scope, kind, item)
      return
    }
    await t.run(
      `INSERT INTO roadmap_marks (roadmap_id, scope, kind, item, value, at, by_user) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (roadmap_id, scope, kind, item) DO UPDATE SET value = ${merge ? "CASE WHEN roadmap_marks.value = 'done' THEN 'done' ELSE excluded.value END" : 'excluded.value'}, at = excluded.at, by_user = excluded.by_user`,
      rid, scope, kind, item, value, Date.now(), actor || null,
    )
  }
  const journal = async (t, rid, scope, actor, kind, item, value) => {
    await t.run('INSERT INTO roadmap_marks_log (roadmap_id, scope, actor, at, kind, item, value) VALUES (?, ?, ?, ?, ?, ?, ?)', rid, scope, actor || null, Date.now(), kind, item, value ?? '')
  }
  const prune = (rid, scope) => db.run('DELETE FROM roadmap_marks_log WHERE roadmap_id = ? AND scope = ? AND id NOT IN (SELECT id FROM roadmap_marks_log WHERE roadmap_id = ? AND scope = ? ORDER BY id DESC LIMIT ?)', rid, scope, rid, scope, KEEP)
  /** позначки з об'єкта { s: {id: статус}, t: {id: true}, c: {id: true} } чи списків id — перевірені */
  const fromState = (st) => {
    const out = []
    for (const kind of KINDS) {
      const v = st?.[kind]
      const pairs = Array.isArray(v) ? v.map((id) => [id, kind === 's' ? 'done' : true]) : v && typeof v === 'object' ? Object.entries(v) : []
      for (const [id, val] of pairs.slice(0, 2000)) {
        if (!ID.test(String(id))) continue
        const x = kind === 's' ? (STAGE.has(val) ? val : null) : val ? true : null
        if (x == null) continue
        const stored = markValue(kind, x)
        if (stored) out.push([kind, String(id), stored])
      }
    }
    return out
  }

  return {
    state: async (rid, scope) => (scope ? toState(await db.all('SELECT kind, item, value FROM roadmap_marks WHERE roadmap_id = ? AND scope = ?', rid, scope)) : emptyState()),
    /** стани кількох записів одного роадмапу: Map(scope → state) */
    async states(rid, scopes) {
      const out = new Map(scopes.map((s) => [s, emptyState()]))
      if (!scopes.length) return out
      for (let i = 0; i < scopes.length; i += 400) {
        const part = scopes.slice(i, i + 400)
        for (const r of await db.all(`SELECT scope, kind, item, value FROM roadmap_marks WHERE roadmap_id = ? AND scope IN (${part.map(() => '?').join(',')})`, rid, ...part))
          out.get(r.scope)[r.kind][r.item] = r.kind === 's' ? r.value : true
      }
      return out
    },
    /** одна позначка; log — писати в журнал (спільні записи, гільдійське «у кожного свій») */
    async mark(rid, scope, kind, item, value, actor, log) {
      if (!ID.test(String(item))) throw fail('хибний id')
      const v = markValue(kind, value)
      await db.tx(async (t) => {
        await put(t, rid, scope, kind, String(item), v, actor)
        if (log) await journal(t, rid, scope, actor, kind, String(item), v)
      })
      if (log && Math.random() < 0.05) await prune(rid, scope)
    },
    /** позначки зі стану — злиттям (уже відмічене не знімається, «Готово» не стає «У роботі») */
    async merge(rid, scope, st, actor) {
      const marks = fromState(st)
      await db.tx(async (t) => { for (const [kind, item, v] of marks) await put(t, rid, scope, kind, item, v, actor, true) })
      return marks.length
    },
    /** стерти запис; повертає, що було (для «Повернути») */
    async reset(rid, scope) {
      const before = toState(await db.all('SELECT kind, item, value FROM roadmap_marks WHERE roadmap_id = ? AND scope = ?', rid, scope))
      await db.run('DELETE FROM roadmap_marks WHERE roadmap_id = ? AND scope = ?', rid, scope)
      return before
    },
    /** запис переходить до іншого власника (зливається з тим, що там уже є) */
    async rescope(rid, from, to) {
      if (from === to) return
      const rows = await db.all('SELECT kind, item, value, by_user FROM roadmap_marks WHERE roadmap_id = ? AND scope = ?', rid, from)
      await db.tx(async (t) => {
        for (const r of rows) await put(t, rid, to, r.kind, r.item, r.value, r.by_user, true)
        await t.run('DELETE FROM roadmap_marks WHERE roadmap_id = ? AND scope = ?', rid, from)
        await t.run('UPDATE roadmap_marks_log SET scope = ? WHERE roadmap_id = ? AND scope = ?', to, rid, from)
      })
    },
    /** записи людей (u:…) з позначками: [{ scope, n }] */
    people: async (rid) => db.all("SELECT scope, COUNT(*) AS n FROM roadmap_marks WHERE roadmap_id = ? AND scope LIKE 'u:%' GROUP BY scope", rid),
    /** скільки різних людей відмічали спільний запис */
    markers: async (rid, scope) => Number((await db.get('SELECT COUNT(DISTINCT actor) AS n FROM roadmap_marks_log WHERE roadmap_id = ? AND scope = ?', rid, scope))?.n || 0),
    log: (rid, scope, limit = 100) =>
      db.all('SELECT l.id, l.actor, l.at, l.kind, l.item, l.value, u.name, u.login, u.color FROM roadmap_marks_log l LEFT JOIN users u ON u.id = l.actor WHERE l.roadmap_id = ? AND l.scope = ? ORDER BY l.id DESC LIMIT ?', rid, scope, limit),
    /** виконані етапи для списків: Map(`${rid} ${scope}` → Set(id етапів)) */
    async doneSets(rids) {
      const out = new Map()
      for (let i = 0; i < rids.length; i += 400) {
        const part = rids.slice(i, i + 400)
        if (!part.length) continue
        for (const r of await db.all(`SELECT roadmap_id, scope, item FROM roadmap_marks WHERE kind = 's' AND value = 'done' AND roadmap_id IN (${part.map(() => '?').join(',')})`, ...part)) {
          const k = `${r.roadmap_id} ${r.scope}`
          if (!out.has(k)) out.set(k, new Set())
          out.get(k).add(r.item)
        }
      }
      return out
    },
    /** роадмап стерто — і весь його прогрес */
    async purge(rid) {
      await db.run('DELETE FROM roadmap_marks WHERE roadmap_id = ?', rid)
      await db.run('DELETE FROM roadmap_marks_log WHERE roadmap_id = ?', rid)
    },
    /** людину видалено: її особисті записи — геть, у спільних і журналі вона безіменна */
    async forgetUser(uid) {
      await db.run('DELETE FROM roadmap_marks WHERE scope = ?', `u:${uid}`)
      await db.run('DELETE FROM roadmap_marks_log WHERE scope = ?', `u:${uid}`)
      await db.run('UPDATE roadmap_marks SET by_user = NULL WHERE by_user = ?', uid)
      await db.run('UPDATE roadmap_marks_log SET actor = NULL WHERE actor = ?', uid)
    },
  }
}

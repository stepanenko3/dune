/*
 * Рушій панелі керування (як Filament): ресурс — опис таблиці (поля, типи, фільтри, дії, права), з якого сервер
 * будує список (пошук, сортування, фільтри, сторінки), картку, створення, зміну, видалення й масові дії, а клієнт —
 * таблиці й форми (опис іде йому через /api/admin/meta, без функцій).
 *
 * Поле: { key, label, type, sql?, list?, search?, sort?, filter?, form?, readonly?, required?, options?, resource?,
 *   help?, mono?, tones?, max?, create?, image?, refs?, labels?, dependsOn? }
 *   type: text | textarea | code (довгий текст, моноширинний) | email | url | color | slug | int | num | bool (0/1) |
 *         flag (NULL / мітка часу) | datetime (мс) | select | relation (id іншого ресурсу) | owner (людина чи гільдія:
 *         kindField — поле з видом) | json | pairs ([[id, к-сть]…]) | list (масив рядків) | permissions (дозволи ролі)
 *   sql — вираз для SELECT/WHERE/ORDER (для полів з приєднаних таблиць); form: false — не в формі; readonly — лише показ.
 *   image — значення поля є адресою зображення (клієнт показує картинку, дає завантажити нову в сховище); refs — для
 *   pairs/list: id яких записів там лежать (розділ) — список віддає <key>__refs { id: [назва, іконка] }; labels — як
 *   клієнт підписує варіанти (словник сайту); dependsOn — варіанти select залежать від іншого поля (option.parent).
 * Ресурс: { name, label, one, group, icon, table, from?, key (рядок чи масив), fields, sort, view, write, create?,
 *   remove?, hooks: { list?, get?, create?, update?, remove?, rows? }, actions: [{ key, label, tone?, bulk?, row?,
 *   fields?, confirm?, show?, run }] }
 *   create/remove: false — без цих дій; relations — пов'язані записи інших розділів для картки запису:
 *   [{ resource, field } | { resource, match: { поле: '$id' | значення } } | { resource, has: поле-список }] (has — у
 *   списку чи парах того розділу є id цього запису).
 * Права — дозволи ролі (server/lib/roles.mjs): '<розділ>.view|create|edit|delete' і '<розділ>.<дія>'.
 * Кожна зміна — у журнал (audit) і в історію версій запису (revisions).
 */
import { fail } from '../lib/util.mjs'
import { actorStore } from '../lib/revisions.mjs'


const SCALAR = new Set(['text', 'textarea', 'email', 'url', 'color', 'slug', 'select', 'relation', 'owner'])

/** значення з форми → значення для бази (з перевіркою) */
export function coerce(f, v) {
  if (v === undefined) return undefined
  if (v === '' && f.type !== 'text' && f.type !== 'textarea') v = null
  if (v === null) {
    if (f.required) throw fail('поле «{field}» обов’язкове', 400, { field: f.label, fieldKey: f.key })
    // списки й пари порожніми — «[]» (стовпці даних гри NOT NULL), JSON — якщо поле не може бути порожнім
    if (f.type === 'list' || f.type === 'pairs' || f.type === 'permissions' || (f.type === 'json' && f.notNull)) return '[]'
    return f.type === 'bool' ? 0 : SCALAR.has(f.type) && f.notNull ? '' : null
  }
  switch (f.type) {
    case 'int': case 'num': {
      const n = Number(v)
      if (!Number.isFinite(n)) throw fail('поле «{field}» — число', 400, { field: f.label, fieldKey: f.key })
      return f.type === 'int' ? Math.round(n) : n
    }
    case 'bool': return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0
    case 'flag': return v ? (typeof v === 'number' ? v : Date.now()) : null
    case 'datetime': {
      const n = typeof v === 'number' ? v : Date.parse(v)
      if (!Number.isFinite(n)) throw fail('поле «{field}» — дата', 400, { field: f.label, fieldKey: f.key })
      return n
    }
    case 'json': case 'pairs': case 'list': case 'permissions': {
      let x = v
      if (typeof v === 'string') { try { x = JSON.parse(v) } catch { throw fail('поле «{field}» — хибний JSON', 400, { field: f.label, fieldKey: f.key }) } }
      if (f.type === 'pairs' && !(Array.isArray(x) && x.every((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(Number(p[1]))))) throw fail('поле «{field}» — список пар [id, кількість]', 400, { field: f.label, fieldKey: f.key })
      if ((f.type === 'list' || f.type === 'permissions') && !(Array.isArray(x) && x.every((s) => typeof s === 'string'))) throw fail('поле «{field}» — список рядків', 400, { field: f.label, fieldKey: f.key })
      // порожні рядки (додали, але нічого не вибрали) — геть
      return JSON.stringify(f.type === 'pairs' ? x.filter(([a]) => String(a ?? '').trim()).map(([a, b]) => [String(a), Number(b)]) : f.type === 'list' ? x.filter((s) => s.trim()) : x)
    }
    case 'select': {
      const s = String(v)
      if (f.options && !f.options.some((o) => String(o.value) === s)) throw fail('поле «{field}»: невідоме значення', 400, { field: f.label, fieldKey: f.key })
      return s
    }
    case 'email': {
      const s = String(v).trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw fail('поле «{field}» — пошта', 400, { field: f.label, fieldKey: f.key })
      return s
    }
    case 'color': {
      const s = String(v).trim()
      if (!/^#[0-9a-f]{6}$/i.test(s)) throw fail('поле «{field}» — колір #rrggbb', 400, { field: f.label, fieldKey: f.key })
      return s.toLowerCase()
    }
    default: {
      const s = String(v)
      if (f.max && s.length > f.max) throw fail('поле «{field}» — щонайбільше {max} знаків', 400, { field: f.label, max: f.max })
      return s
    }
  }
}

/** значення з бази → для клієнта */
function out(f, v) {
  if (v == null) return v ?? null
  if (f.type === 'json' || f.type === 'pairs' || f.type === 'list' || f.type === 'permissions') { try { return JSON.parse(v) } catch { return v } }
  if (f.type === 'bool') return !!Number(v)
  return v
}

export function createEngine({ db, auth, roles, revisions, resources }) {
  const like = db.kind === 'pg' ? 'ILIKE' : 'LIKE'
  /** скільки записів за раз можна видалити чи змінити дією */
  const MAX_IDS = 500
  /** «%» і «_» у пошуку — звичайні знаки, а не шаблон */
  const LIKE = `${like} ? ESCAPE '\\'`
  const pat = (s) => `%${String(s).replace(/[\\%_]/g, '\\$&')}%`
  /** зміни зі сховищ, які викликає панель, не пишуть своїх версій — версію пише рушій (одна зміна — один запис) */
  const quiet = (fn) => actorStore.run({ ...(actorStore.getStore() || {}), engine: true }, fn)
  const map = new Map()
  for (const r of resources) {
    const keys = Array.isArray(r.key) ? r.key : [r.key || 'id']
    const fields = r.fields.map((f) => ({ list: true, form: true, ...f, colOf: () => (typeof f.sql === 'function' ? f.sql() : f.sql) || `${r.alias ? r.alias + '.' : ''}${f.key}` }))
    map.set(r.name, { create: true, remove: true, actions: [], hooks: {}, relations: [], ...r, keys, fields, from: r.from || r.table })
  }

  // ---------- права ----------
  const permsOf = async (user) => (user ? roles.permsOf(user.role) : new Set())
  const allowed = (perms, r, ability) => roles.has(perms, `${r.name}.${ability}`)
  async function res(name, user, ability = 'view') {
    const r = map.get(name)
    if (!r) throw fail('немає такого розділу', 404)
    if (!allowed(await permsOf(user), r, ability)) throw fail('бракує прав', 403)
    return r
  }

  // ---------- ключ запису ----------
  const idOf = (r, row) => (r.keys.length === 1 ? String(row[r.keys[0]]) : JSON.stringify(r.keys.map((k) => row[k])))
  function keyOf(r, id) {
    if (r.keys.length === 1) return [id]
    let v
    try { v = JSON.parse(id) } catch { v = null }
    if (!Array.isArray(v) || v.length !== r.keys.length) throw fail('хибний ключ запису')
    return v
  }
  const keyCol = (r, k) => r.fields.find((f) => f.key === k)?.colOf() || `${r.alias ? r.alias + '.' : ''}${k}`
  const whereKey = (r, id, cols = true) => ({ sql: r.keys.map((k) => `${cols ? keyCol(r, k) : k} = ?`).join(' AND '), args: keyOf(r, id) })

  const shape = (r, row) => {
    const o = { _id: idOf(r, row) }
    for (const f of r.fields) if (f.key in row) o[f.key] = out(f, row[f.key])
    for (const [k, v] of Object.entries(row)) if (!(k in o) && /__(label|ref|tr|icon|refs)$/.test(k)) o[k] = v
    return o
  }

  /** стовпець розділу з назвою таблиці (для запитів з приєднаними таблицями, де «id» чи «name» є в обох) */
  const qual = (o, k) => {
    const f = o.fields.find((x) => x.key === k)
    if (f?.sql) return f.colOf()
    return `${o.alias || o.table || o.from}.${k}`
  }
  /**
   * назва запису для підписів і пошуку: у даних гри — мовою людини (game_texts), якщо є переклад; порожня — id.
   * { join, args (для join), col (назва), kc (ключ), tc (поле-назва), ic (зображення, якщо є) }
   */
  function nameSql(o, lang) {
    const kc = qual(o, o.keys[0])
    const tc = o.title ? qual(o, o.title) : kc
    const imgF = o.fields.find((x) => x.image)
    const ic = imgF ? qual(o, imgF.key) : null
    const base = `COALESCE(NULLIF(CAST(${tc} AS TEXT), ''), CAST(${kc} AS TEXT))`
    if (o.texts && lang && /^[\w-]{2,8}$/.test(lang)) {
      return { join: ` LEFT JOIN game_texts gtx ON gtx.kind = '${o.texts}' AND gtx.id = ${kc} AND gtx.lang = ?`, args: [lang], col: `COALESCE(NULLIF(gtx.name, ''), ${base})`, kc, tc, ic, tx: 'gtx.name' }
    }
    return { join: '', args: [], col: base, kc, tc, ic, tx: null }
  }
  /** назви й іконки записів розділу за id: Map id → [назва, іконка|null] */
  async function namesOf(o, ids, lang) {
    const m = new Map()
    if (!o || o.hooks.list || !o.from || !ids.length) return m
    const N = nameSql(o, lang)
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500).map(String)
      const got = await db.all(`SELECT ${N.kc} AS k, ${N.col} AS t${N.ic ? `, ${N.ic} AS i` : ''} FROM ${o.from}${N.join} WHERE CAST(${N.kc} AS TEXT) IN (${part.map(() => '?').join(', ')})`, ...N.args, ...part)
      for (const g of got) m.set(String(g.k), [g.t == null ? String(g.k) : String(g.t), g.i || null])
    }
    return m
  }

  /**
   * підписи зв'язків: поле relation → «назва» з іншого ресурсу (key__label, і key__icon, якщо в нього є зображення);
   * pairs / list з refs — назви й іконки кожного id (key__refs { id: [назва, іконка] }; нема такого запису — нема ключа)
   */
  async function labels(r, rows, lang) {
    for (const f of r.fields.filter((x) => x.type === 'relation' && x.resource)) {
      const o = map.get(f.resource)
      if (!o?.title) continue
      const ids = [...new Set(rows.map((x) => x[f.key]).filter((v) => v != null && v !== ''))]
      if (!ids.length) continue
      const m = await namesOf(o, ids, lang)
      for (const x of rows) if (x[f.key] != null) { const n = m.get(String(x[f.key])); x[f.key + '__label'] = n?.[0] ?? null; if (n?.[1]) x[f.key + '__icon'] = n[1] }
    }
    for (const f of r.fields.filter((x) => x.refs && (x.type === 'pairs' || x.type === 'list'))) {
      const o = map.get(f.refs)
      if (!o) continue
      const idsOf = (v) => {
        let a = v
        if (typeof a === 'string') { try { a = JSON.parse(a) } catch { a = [] } }
        return Array.isArray(a) ? a.map((p) => (f.type === 'pairs' ? (Array.isArray(p) ? p[0] : null) : p)).filter((x) => x != null && x !== '').map(String) : []
      }
      const ids = [...new Set(rows.flatMap((x) => idsOf(x[f.key])))]
      if (!ids.length) continue
      const m = await namesOf(o, ids, lang)
      for (const x of rows) { const own = idsOf(x[f.key]); if (own.length) x[f.key + '__refs'] = Object.fromEntries(own.filter((id) => m.has(id)).map((id) => [id, m.get(id)])) }
    }
    return rows
  }

  /** WHERE зі пошуку, фільтрів і закріплених умов (fixed — для пов'язаних записів: точна рівність будь-якого поля) */
  function where(r, { search, filters, fixed }, scope = null) {
    const w = [], a = []
    if (scope) { w.push(`(${scope.sql})`); a.push(...scope.args) }
    for (const [k, v] of Object.entries(fixed || {})) {
      const f = r.fields.find((x) => x.key === k)
      if (!f) continue
      if (v === null) w.push(`${f.colOf()} IS NULL`)
      // { has: id } — список чи пари (JSON) містять цей id: рецепти, де предмет потрібен, що виготовляє пристрій
      else if (typeof v === 'object' && v && 'has' in v) { w.push(`CAST(${f.colOf()} AS TEXT) ${LIKE}`); a.push(pat(JSON.stringify(String(v.has)))) }
      else { w.push(`${f.colOf()} = ?`); a.push(String(v)) }
    }
    const s = String(search || '').trim()
    if (s) {
      const cols = r.fields.filter((f) => f.search)
      if (cols.length) { w.push('(' + cols.map((f) => `CAST(${f.colOf()} AS TEXT) ${LIKE}`).join(' OR ') + ')'); cols.forEach(() => a.push(pat(s))) }
    }
    for (const [k, v] of Object.entries(filters || {})) {
      const f = r.fields.find((x) => x.key === k && x.filter)
      if (!f || v == null || v === '' || (Array.isArray(v) && !v.length)) continue
      // зв'язок чи власник за текстом ({ q }: ім'я, пошта, назва гільдії…) — пошук у полях пошуку пов'язаного розділу
      if (v && typeof v === 'object' && !Array.isArray(v) && 'q' in v) {
        const q = String(v.q || '').trim()
        if (!q) continue
        const sub = (name) => {
          const o = map.get(name)
          if (!o) return null
          const cols = [keyCol(o, o.keys[0]), ...o.fields.filter((x) => x.search || x.key === o.title).map((x) => x.colOf())]
          a.push(...[...new Set(cols)].map(() => pat(q)))
          return `SELECT ${keyCol(o, o.keys[0])} FROM ${o.from} WHERE ${[...new Set(cols)].map((c) => `CAST(${c} AS TEXT) ${LIKE}`).join(' OR ')}`
        }
        if (f.type === 'owner') {
          const kc = r.fields.find((x) => x.key === f.kindField)?.colOf() || f.kindField
          const users = sub('users'), guilds = sub('guilds')
          w.push(`((${kc} = 'user' AND ${f.colOf()} IN (${users})) OR (${kc} = 'guild' AND ${f.colOf()} IN (${guilds})))`)
        } else if (f.type === 'relation' && f.resource) {
          const sq = sub(f.resource)
          if (sq) w.push(`${f.colOf()} IN (${sq})`)
        }
        continue
      }
      if (f.type === 'flag') w.push(v === 'yes' || v === true ? `${f.colOf()} IS NOT NULL` : `${f.colOf()} IS NULL`)
      else if (f.type === 'bool') { w.push(`${f.colOf()} = ?`); a.push(v === 'yes' || v === true ? 1 : 0) }
      else if (f.type === 'datetime' || f.type === 'int' || f.type === 'num') {
        const from = v.from ?? v[0], to = v.to ?? v[1]
        if (from != null && from !== '') { w.push(`${f.colOf()} >= ?`); a.push(Number(f.type === 'datetime' && typeof from === 'string' ? Date.parse(from) : from)) }
        if (to != null && to !== '') { w.push(`${f.colOf()} <= ?`); a.push(Number(f.type === 'datetime' && typeof to === 'string' ? Date.parse(to) + (/T/.test(to) ? 0 : 86_399_999) : to)) }
      } else if (Array.isArray(v)) {
        // у варіанта бувають давні назви того ж значення (also) — шукаємо й за ними
        const vals = v.flatMap((x) => [String(x), ...(f.options?.find((o) => o.value === String(x))?.also || [])])
        w.push(`${f.colOf()} IN (${vals.map(() => '?').join(', ')})`); a.push(...vals)
      }
      else if (f.type === 'text' || f.type === 'textarea') { w.push(`CAST(${f.colOf()} AS TEXT) ${LIKE}`); a.push(pat(v)) }
      else if (v === '__none') w.push(`(${f.colOf()} IS NULL OR ${f.colOf()} = '')`)
      else { w.push(`${f.colOf()} = ?`); a.push(String(v)) }
    }
    return { sql: w.length ? 'WHERE ' + w.join(' AND ') : '', args: a }
  }

  const select = (r) => r.fields.filter((f) => !f.virtual).map((f) => `${f.colOf()} AS ${f.key}`).join(', ')
  /** у списку важкі поля, яких таблиця не показує (документи баз, JSON), не тягнемо — їх читає картка запису (keep — потрібне хукам) */
  const HEAVY = new Set(['json', 'code', 'permissions', 'pairs', 'list'])
  const selectList = (r) => r.fields.filter((f) => !f.virtual && !(f.list === false && HEAVY.has(f.type) && !f.keep && !r.keys.includes(f.key))).map((f) => `${f.colOf()} AS ${f.key}`).join(', ')

  /** назви записів розділу за id (для журналу, історії, посилань): Map id → назва (null — назви нема); нема запису — нема ключа */
  async function titles(name, ids) {
    const r = map.get(name), m = new Map()
    if (!r || r.hooks.list || !ids.length) return m
    // без поля-назви — лише чи запис є (назвою стане сам id)
    const tc = r.title ? r.fields.find((x) => x.key === r.title)?.colOf() || r.title : 'NULL'
    // текстові ключі — напряму (працює індекс), числові — як текст (id з журналу буває будь-який)
    const kcol = (k) => (r.fields.find((f) => f.key === k)?.type === 'int' ? `CAST(${keyCol(r, k)} AS TEXT)` : keyCol(r, k))
    if (r.keys.length === 1) {
      const kc = keyCol(r, r.keys[0])
      for (const x of await db.all(`SELECT ${kc} AS k, ${tc} AS t FROM ${r.from} WHERE ${kcol(r.keys[0])} IN (${ids.map(() => '?').join(', ')})`, ...ids.map(String))) m.set(String(x.k), x.t)
      return m
    }
    const keys = ids.map((id) => { try { return keyOf(r, id) } catch { return null } }).filter(Boolean)
    if (!keys.length) return m
    const cond = keys.map(() => `(${r.keys.map((k) => `${kcol(k)} = ?`).join(' AND ')})`).join(' OR ')
    const cols = r.keys.map((k, i) => `${keyCol(r, k)} AS k${i}`).join(', ')
    for (const x of await db.all(`SELECT ${cols}, ${tc} AS t FROM ${r.from} WHERE ${cond}`, ...keys.flat().map(String))) m.set(JSON.stringify(r.keys.map((k, i) => x[`k${i}`])), x.t)
    return m
  }
  /** третій аргумент hooks.rows — що рушій уміє для підписів */
  const rowsApi = { titles, has: (n) => map.has(n), trTitle: (n) => { const o = map.get(n); return !!o?.fields.find((f) => f.key === o.title)?.tr } }
  /** обмеження розділу для людини (scopeFor: напр., історія змін — лише розділів, які вона бачить) */
  const scopeOf = async (r, user) => {
    if (!r.scopeFor) return null
    const perms = await permsOf(user)
    return r.scopeFor(user, { canView: (n) => { const o = map.get(n); return !!o && allowed(perms, o, 'view') } })
  }

  async function list(name, user, q = {}) {
    const r = await res(name, user)
    if (r.hooks.list) return r.hooks.list(q, user)
    const size = Math.min(200, Math.max(1, Number(q.size) || 25))
    const page = Math.max(0, Number(q.page) || 0)
    const W = where(r, q, await scopeOf(r, user))
    const sf = r.fields.find((f) => f.key === q.sort && f.sort)
    const order = sf ? `${sf.colOf()} ${q.desc ? 'DESC' : 'ASC'}${db.kind === 'pg' ? (q.desc ? ' NULLS LAST' : ' NULLS FIRST') : ''}` : r.sort || r.keys.map((k) => keyCol(r, k)).join(', ')
    const rows = await db.all(`SELECT ${selectList(r)} FROM ${r.from} ${W.sql} ORDER BY ${order} LIMIT ? OFFSET ?`, ...W.args, size, page * size)
    const total = Number((await db.get(`SELECT COUNT(*) AS n FROM ${r.from} ${W.sql}`, ...W.args)).n)
    let list = await labels(r, rows, q.lang)
    if (r.hooks.rows) list = await r.hooks.rows(list, user, rowsApi)
    // з пошуком чи фільтрами — ще й скільки всього (без них): «12 з 340» над таблицею
    const narrowed = String(q.search || '').trim() || Object.values(q.filters || {}).some((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length))
    const all = narrowed ? await count(name, user, q.fixed) : total
    return { rows: list.map((x) => shape(r, x)), total, all, page, size }
  }

  /** скільки записів у розділі (з закріпленими умовами fixed — для вкладок картки); null — розділу людині не видно */
  async function count(name, user, fixed = {}) {
    const r = map.get(name)
    if (!r || !allowed(await permsOf(user), r, 'view')) return null
    if (r.hooks.list) return Number((await r.hooks.list({ size: 1, page: 0, fixed }, user)).total) || 0
    const W = where(r, { fixed }, await scopeOf(r, user))
    return Number((await db.get(`SELECT COUNT(*) AS n FROM ${r.from} ${W.sql}`, ...W.args)).n)
  }

  async function getRow(r, id) {
    const W = whereKey(r, id)
    return db.get(`SELECT ${select(r)} FROM ${r.from} WHERE ${W.sql}`, ...W.args)
  }
  const raw = (r, id, user) => (r.hooks.get ? r.hooks.get(id, user) : getRow(r, id))
  async function get(name, user, id, lang) {
    const r = await res(name, user)
    let row = await raw(r, id, user)
    if (!row) throw fail('немає такого запису', 404)
    const S = await scopeOf(r, user)
    if (S) {
      const W = whereKey(r, id)
      if (!(await db.get(`SELECT 1 AS x FROM ${r.from} WHERE ${W.sql} AND (${S.sql})`, ...W.args, ...S.args))) throw fail('немає такого запису', 404)
    }
    row = (await labels(r, [row], lang))[0]
    if (r.hooks.rows) row = (await r.hooks.rows([row], user, rowsApi))[0]
    return shape(r, row)
  }
  /** стан запису для історії (без полів snap: false — документи баз і роадмапів мають власну історію версій) */
  const snap = (r, row) => (row ? Object.fromEntries(r.fields.filter((f) => f.key in row && f.snap !== false).map((f) => [f.key, out(f, row[f.key])])) : null)

  /** дані форми → лише дозволені поля, приведені до типів */
  function clean(r, data, creating) {
    const o = {}
    for (const f of r.fields) {
      if (!(f.key in (data || {}))) continue
      if (f.readonly && !(creating && f.create)) continue
      // вид власника (owner_kind) у формі не окреме поле, а перемикач поля власника — його теж приймаємо
      if (f.form === false && !(creating && f.create) && !r.fields.some((x) => x.type === 'owner' && x.kindField === f.key)) continue
      if (f.sql && !r.hooks.update && !r.hooks.create) continue
      o[f.key] = coerce(f, data[f.key])
    }
    if (creating) for (const f of r.fields) if (f.required && (o[f.key] == null || o[f.key] === '') && !f.auto) throw fail('поле «{field}» обов’язкове', 400, { field: f.label, fieldKey: f.key })
    return o
  }

  async function create(name, user, data) {
    const r = await res(name, user, 'create')
    if (!r.create) throw fail('тут не створюють', 405)
    const d = clean(r, data, true)
    let id
    if (r.hooks.create) id = await quiet(() => r.hooks.create(d, user, data))
    else {
      if (r.stamp) for (const k of r.stamp) if (d[k] == null) d[k] = Date.now()
      const cols = Object.keys(d)
      // id нового запису — з самої вставки (MAX(id) після неї при одночасних вставках дав би чужий)
      const got = await db.get(`INSERT INTO ${r.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) RETURNING ${r.keys.join(', ')}`, ...cols.map((c) => d[c]))
      id = r.keys.length === 1 ? got?.[r.keys[0]] ?? d[r.keys[0]] : JSON.stringify(r.keys.map((k) => got?.[k] ?? d[k]))
    }
    await r.hooks.after?.()
    await auth.log(user.id, `admin.create`, `${name}/${id}`, JSON.stringify(data).slice(0, 400))
    await revisions?.record(name, String(id), 'create', null, snap(r, await raw(r, String(id), user)), user.id)
    return get(name, user, String(id), data?._lang)
  }

  async function update(name, user, id, data) {
    const r = await res(name, user, 'edit')
    const old = await raw(r, id, user)
    if (!old) throw fail('немає такого запису', 404)
    // хтось змінив запис, поки цю картку правили (картка надсилає «updated», з яким її відкрили)
    if (data?._updated != null && old.updated != null && Number(old.updated) !== Number(data._updated)) throw fail('Цей запис щойно змінили. Онови сторінку, щоб побачити нову версію, і внеси правки знову.', 409)
    const d = clean(r, data, false)
    if (r.hooks.update) await quiet(() => r.hooks.update(id, d, old, user, data))
    else if (Object.keys(d).length) {
      if (r.touch) d[r.touch] = Date.now()
      // змінене вручну закріплюється (збір із джерел його не перепише), якщо закріплення не зняли тут же
      if (r.lockOnEdit && !('locked' in d)) d.locked = 1
      const W = whereKey(r, id, false)
      const cols = Object.keys(d)
      await db.run(`UPDATE ${r.table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE ${W.sql}`, ...cols.map((c) => d[c]), ...W.args)
    }
    await r.hooks.after?.()
    await auth.log(user.id, 'admin.update', `${name}/${id}`, JSON.stringify(data).slice(0, 400))
    const nid = r.keys.length === 1 && d[r.keys[0]] != null ? String(d[r.keys[0]]) : id
    await revisions?.record(name, nid, 'update', snap(r, old), snap(r, await raw(r, nid, user)), user.id)
    return get(name, user, nid, data?._lang)
  }

  async function remove(name, user, ids) {
    const r = await res(name, user, 'delete')
    if (!r.remove) throw fail('тут не видаляють', 405)
    if (ids.length > MAX_IDS) throw fail('за раз — не більше {n} записів', 400, { n: MAX_IDS })
    let n = 0
    for (const id of ids) {
      const old = await raw(r, id, user)
      if (!old) continue
      if (r.hooks.remove) await quiet(() => r.hooks.remove(id, old, user))
      else { const W = whereKey(r, id, false); await db.run(`DELETE FROM ${r.table} WHERE ${W.sql}`, ...W.args) }
      n++
      await auth.log(user.id, 'admin.delete', `${name}/${id}`)
      // forgetOnDelete — запис про людину: після видалення в історії лишається лише факт, без її даних (пошти тощо)
      await revisions?.record(name, id, 'delete', r.forgetOnDelete ? null : snap(r, old), null, user.id)
    }
    if (n) await r.hooks.after?.()
    return { removed: n }
  }

  async function action(name, user, key, ids, input) {
    const r = map.get(name)
    if (!r) throw fail('немає такого розділу', 404)
    const a = r.actions.find((x) => x.key === key)
    if (!a) throw fail('немає такої дії', 404)
    const perms = await permsOf(user)
    if (!allowed(perms, r, 'view') || !allowed(perms, r, a.perm || key)) throw fail('бракує прав', 403)
    if ((ids || []).length > MAX_IDS) throw fail('за раз — не більше {n} записів', 400, { n: MAX_IDS })
    const rows = []
    for (const id of ids || []) {
      const row = await raw(r, id, user)
      if (row) rows.push({ ...row, _id: id })
    }
    if (!rows.length && !a.global) throw fail('нічого не вибрано')
    const values = {}
    for (const f of a.fields || []) {
      values[f.key] = coerce(f, input?.[f.key])
      // поле дії, якого не надіслали, — теж порожнє (інакше «Змінити видимість» без вибору зробила б усе приватним)
      if (f.required && (values[f.key] == null || values[f.key] === '')) throw fail('поле «{field}» обов’язкове', 400, { field: f.label, fieldKey: f.key })
    }
    // дія може впасти посередині — тоді в журнал і історію однаково йде те, що встигло змінитися
    try {
      return (await quiet(() => a.run(rows, values, user))) ?? { ok: true, n: rows.length }
    } finally {
      await r.hooks.after?.()
      await auth.log(user.id, `admin.action`, `${name}:${key}`, `${rows.map((x) => x._id).join(',').slice(0, 300)} ${JSON.stringify(input || {}).slice(0, 150)}`)
      for (const row of rows) {
        const before = snap(r, row), now = await raw(r, row._id, user).catch(() => null)
        const after = now ? snap(r, now) : null
        if (JSON.stringify(before) !== JSON.stringify(after)) await revisions?.record(name, row._id, `action:${key}`, before, after, user.id, JSON.stringify(input || {}).slice(0, 200))
      }
    }
  }

  /** усі рядки списку з тими ж пошуком і фільтрами (для вивантаження) — сторінками по 200, не більше max */
  async function listAll(name, user, q = {}, max = 10_000) {
    const out = []
    for (let page = 0; out.length < max; page++) {
      const res = await list(name, user, { ...q, page, size: 200 })
      out.push(...res.rows)
      if (res.rows.length < 200) break
    }
    return out.slice(0, max)
  }

  /**
   * Пошук по всій панелі: у кожному розділі, який людина бачить і в якого є назва й поля пошуку, — до per записів,
   * чия назва чи поле пошуку містить q. Розділи — у порядку меню. [{ res, id, title }]
   */
  async function search(user, q, per = 5) {
    const s = String(q || '').trim()
    if (s.length < 2) return []
    const perms = await permsOf(user)
    const got = await Promise.all([...map.values()].map(async (r) => {
      if (r.hooks.list || !r.title || !allowed(perms, r, 'view')) return []
      const cols = [...new Set([...r.fields.filter((f) => f.search && !f.virtual).map((f) => f.colOf()), r.fields.find((f) => f.key === r.title)?.colOf()].filter(Boolean))]
      if (!cols.length) return []
      const S = await scopeOf(r, user)
      const tc = r.fields.find((f) => f.key === r.title)?.colOf() || r.title
      const where = [`(${cols.map((c) => `CAST(${c} AS TEXT) ${LIKE}`).join(' OR ')})`, ...(S ? [`(${S.sql})`] : [])].join(' AND ')
      const keys = r.keys.map((k, i) => `${keyCol(r, k)} AS k${i}`).join(', ')
      const rows = await db.all(`SELECT ${keys}, ${tc} AS t FROM ${r.from} WHERE ${where} ORDER BY ${r.sort || keyCol(r, r.keys[0])} LIMIT ?`, ...cols.map(() => pat(s)), ...(S ? S.args : []), per)
      return rows.map((x) => ({ res: r.name, id: r.keys.length === 1 ? String(x.k0) : JSON.stringify(r.keys.map((k, i) => x[`k${i}`])), title: x.t == null ? String(x.k0) : String(x.t) }))
    }))
    return got.flat()
  }

  /**
   * для пошуку в полях relation і списках записів: [{ value, label, icon? }] — щонайбільше 30, з пошуком на сервері
   * (в id, назві й — у даних гри — назві мовою людини); ids — підписи вже вибраних
   */
  async function options(name, user, q = '', ids = [], lang) {
    const r = await res(name, user)
    if (r.hooks.list || !r.from) return [] // розділ без таблиці (переклади) — варіантів нема
    const N = nameSql(r, lang)
    const cols = `${N.kc} AS v, ${N.col} AS l${N.ic ? `, ${N.ic} AS i` : ''}`
    const S = await scopeOf(r, user)
    const and = S ? ` AND (${S.sql})` : ''
    const s = String(q || '').trim()
    let rows
    if (ids.length) rows = await db.all(`SELECT ${cols} FROM ${r.from}${N.join} WHERE CAST(${N.kc} AS TEXT) IN (${ids.map(() => '?').join(', ')})${and}`, ...N.args, ...ids.map(String), ...(S?.args || []))
    else if (s) {
      const look = [N.kc, N.tc, ...(N.tx ? [N.tx] : [])]
      // точний id — першим, далі за назвою
      rows = await db.all(`SELECT ${cols} FROM ${r.from}${N.join} WHERE (${look.map((c) => `CAST(${c} AS TEXT) ${LIKE}`).join(' OR ')})${and} ORDER BY CASE WHEN CAST(${N.kc} AS TEXT) = ? THEN 0 ELSE 1 END, l LIMIT 30`,
        ...N.args, ...look.map(() => pat(s)), ...(S?.args || []), s)
    } else rows = await db.all(`SELECT ${cols} FROM ${r.from}${N.join}${S ? ` WHERE (${S.sql})` : ''} ORDER BY l LIMIT 30`, ...N.args, ...(S?.args || []))
    return rows.map((x) => ({ value: String(x.v), label: x.l == null ? String(x.v) : String(x.l), ...(x.i ? { icon: String(x.i) } : {}) }))
  }

  /** опис ресурсів для клієнта (без функцій, лише доступні людині; варіанти полів з бази — розгорнуті) */
  async function meta(user) {
    const perms = await permsOf(user)
    const out = []
    for (const r of map.values()) {
      if (!allowed(perms, r, 'view')) continue
      const fields = []
      for (const { colOf, sql, optionsFn, ...f } of r.fields) fields.push(optionsFn ? { ...f, options: await optionsFn() } : f)
      out.push({
        name: r.name, label: r.label, one: r.one, group: r.group, icon: r.icon, about: r.about || '', title: r.title || null,
        canWrite: allowed(perms, r, 'edit'), canCreate: r.create !== false && allowed(perms, r, 'create'), canDelete: r.remove !== false && allowed(perms, r, 'delete'),
        defaultSort: r.defaultSort || null, link: r.link || null, page: r.page || null, texts: r.texts || null, preview: r.preview || null, removeNote: r.removeNote || null, quick: r.quick || [], titleFields: r.titleFields || null, history: r.history !== false,
        fields,
        actions: r.actions.filter((a) => allowed(perms, r, a.perm || a.key)).map(({ run, ...a }) => a),
        relations: r.relations.filter((x) => map.has(x.resource) && allowed(perms, map.get(x.resource), 'view')),
        abilities: ['view', 'create', 'edit', 'delete', ...r.actions.map((a) => a.perm || a.key)].filter((v, i, l) => l.indexOf(v) === i),
      })
    }
    return out
  }

  /** усі розділи й їхні можливості — для матриці дозволів ролей */
  const catalog = () => [...map.values()].map((r) => ({
    name: r.name, label: r.label, group: r.group,
    abilities: [...['view', 'create', 'edit', 'delete'].filter((a) => (a === 'create' ? r.create !== false : a === 'delete' ? r.remove !== false : true)), ...r.actions.map((a) => a.perm || a.key)].filter((v, i, l) => l.indexOf(v) === i),
    actions: Object.fromEntries(r.actions.map((a) => [a.perm || a.key, a.label])),
  }))

  return { list, listAll, count, search, get, create, update, remove, action, options, meta, catalog, permsOf, titles, allowed: async (user, name, ability) => { const r = map.get(name); return !!r && allowed(await permsOf(user), r, ability) }, has: (n) => map.has(n), resource: (n) => map.get(n) }
}

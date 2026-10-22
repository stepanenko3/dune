/*
 * Реєстр речей: бази, роадмапи, білди, позначки на мапі, записи «Ресурсів», події спільноти. У кожної — власник (людина чи гільдія)
 * і видимість; документи лежать у своїх таблицях, а тут — те, що спільне: хто власник, хто бачить, назва й короткий
 * опис для списків, хто створив і на основі чого, модерація (приховано, виділено), зірки й копії.
 *
 * Видимість: private — лише власник (буває тільки в людини), guild — учасники гільдії-власника (тільки в гільдії),
 * link — кожен, хто має адресу (у списках не видно), public — усі, у бібліотеці.
 * Права (can): річ людини — вона сама; річ гільдії — новобранець дивиться, учасник ще й змінює, офіцер ще й видаляє
 * й міняє доступ; адміністратор сайту — усе; модератор — бачить і модерує публічне й «за посиланням»; річ сайту —
 * адміністратор і ті, чия роль має дозвіл site.content (вести, але не віддавати).
 */
import { localSummary, summaryText } from './roadmap.mjs'
import { rightsOf } from './roadmap-access.mjs'
import { fail, fill } from './util.mjs'

export const KINDS = ['base', 'roadmap', 'build', 'calc', 'marker', 'place', 'event']
export const LIBRARY_KINDS = ['base', 'build', 'roadmap', 'calc']
export const VIS = ['private', 'guild', 'link', 'public']

/** видимість, допустима для такого власника */
export function normVis(ownerKind, v) {
  // вміст сайту (офіційний, від адміністрації) — без гільдії; за замовчуванням публічний
  if (ownerKind === 'site') return VIS.includes(v) && v !== 'guild' ? v : 'public'
  if (!VIS.includes(v)) return ownerKind === 'guild' ? 'guild' : 'private'
  if (ownerKind === 'user' && v === 'guild') return 'private'
  if (ownerKind === 'guild' && v === 'private') return 'guild'
  return v
}

/** контекст запиту: хто (id, роль на сайті) і його ранги в гільдіях */
export const anon = { user: null, ranks: new Map() }

/**
 * що контекст може з річчю (рядок реєстру): { view, edit, manage, own }. manage — видимість, кошик (у гільдії —
 * офіцер); own — те, що незворотне: віддати річ іншому власнику (зокрема собі) чи стерти назавжди (у гільдії —
 * лише лідер, інакше офіцер міг би забрати гільдійську базу собі й піти).
 */
export function can(ctx, it) {
  const u = ctx?.user
  if (!it) return { view: false, edit: false, manage: false, own: false }
  if (u?.role === 'admin' || ctx?.superuser) return { view: true, edit: true, manage: true, own: true }
  // офіційне від сайту веде той, чия роль має дозвіл site.content; віддати його комусь (own) — лише адміністратор
  if (it.owner_kind === 'site' && ctx?.siteContent) return { view: true, edit: true, manage: true, own: false }
  const mine = it.owner_kind === 'user' && !!u && it.owner_id === u.id
  const rank = it.owner_kind === 'guild' ? ctx.ranks.get(it.owner_id) || 0 : 0
  const open = it.visibility === 'public' || it.visibility === 'link'
  // сховане модерацією бачать ті, чия роль має дозвіл site.moderate (модератори — за дозволом, а не назвою ролі)
  const view = mine || rank >= 1 || (open && (!it.hidden || !!ctx?.moderate))
  return { view, edit: mine || rank >= 2, manage: mine || rank >= 3, own: mine || rank >= 4 }
}

/** бази в кошику — не в бібліотеці й не серед публічного */
const NOT_TRASHED = "NOT (kind = 'base' AND id IN (SELECT id FROM bases WHERE deleted IS NOT NULL))"

export async function createItems(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      kind TEXT NOT NULL, id TEXT NOT NULL, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, visibility TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', created_by TEXT, based_on TEXT,
      hidden BIGINT, featured BIGINT, stars INTEGER NOT NULL DEFAULT 0, copies INTEGER NOT NULL DEFAULT 0,
      created BIGINT NOT NULL, updated BIGINT NOT NULL, published BIGINT,
      PRIMARY KEY (kind, id)
    );
    CREATE INDEX IF NOT EXISTS items_by_owner ON items (owner_kind, owner_id, kind);
    CREATE INDEX IF NOT EXISTS items_by_vis ON items (visibility, kind);
    CREATE TABLE IF NOT EXISTS stars (kind TEXT NOT NULL, id TEXT NOT NULL, user_id TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (kind, id, user_id));
    CREATE INDEX IF NOT EXISTS stars_by_user ON stars (user_id);
  `)
  // права речі (хто редагує, копіює, бачить історію…; lib/roadmap-access.mjs) — JSON; NULL — типові для власника
  await db.addColumn('items', 'access', 'TEXT')
  const get = async (kind, id) => (await db.get('SELECT * FROM items WHERE kind = ? AND id = ?', kind, String(id))) || null

  /** власник для клієнта (імена, тег, колір); t — перекладач мовою людини (без нього — українською) */
  // pre — уже прочитані разом люди, гільдії й назва сайту (для списку — кілька запитів на всіх, а не по 2-3 на картку)
  const siteName = async () => {
    const n = await db.get("SELECT v FROM settings WHERE k = 'siteName'").catch(() => null)
    return n ? JSON.parse(n.v) : 'Sandwalkers'
  }
  async function owner(kind, id, t = fill, pre) {
    // сам сайт (офіційний вміст): назва — з налаштувань сайту
    if (kind === 'site') return { kind, id: 'site', name: pre ? pre.site : await siteName(), color: '#c2622d' }
    if (kind === 'guild') {
      const g = pre ? pre.guilds.get(id) : await db.get('SELECT id, slug, name, tag, color FROM guilds WHERE id = ?', id)
      return g ? { kind, id, slug: g.slug, name: g.name, tag: g.tag, color: g.color } : { kind, id, name: t('Гільдію видалено'), tag: '?', color: '#888888' }
    }
    const u = pre ? pre.users.get(id) : await db.get('SELECT id, login, name, color FROM users WHERE id = ?', id)
    return u ? { kind, id, login: u.login, name: u.name, color: u.color } : { kind, id, name: t('Людину видалено'), color: '#888888' }
  }
  /** рядок реєстру → для клієнта; ctx — щоб додати права (і мову людини: ctx.t, ctx.lang), starred — «моя зірка» */
  async function view(it, ctx, starred, pre) {
    if (!it) return null
    const t = ctx?.t || fill
    // прогрес роадмапу в описі — той, який людина бачила б, відкривши його (у кожного свій, спільний, власника)
    const rp = it.kind === 'roadmap' && roadmapProgress ? (pre ? pre.progress : await roadmapProgress([it], ctx))?.get(it.id) : null
    const by = !it.created_by ? null : pre ? pre.users.get(it.created_by) : await db.get('SELECT id, login, name FROM users WHERE id = ?', it.created_by)
    const out = {
      kind: it.kind, id: it.id, title: it.title, summary: it.kind === 'roadmap' ? (rp ? summaryText(rp.n, rp.done, t, ctx?.lang) : localSummary(it.summary, t, ctx?.lang)) : it.summary, visibility: it.visibility,
      owner: await owner(it.owner_kind, it.owner_id, t, pre), by: by ? { id: by.id, login: by.login, name: by.name } : null,
      basedOn: it.based_on ? JSON.parse(it.based_on) : null, hidden: !!it.hidden, featured: !!it.featured,
      stars: it.stars, copies: it.copies, created: it.created, updated: it.updated, published: it.published || null,
    }
    // база в кошику: картки показують її сірою (повернути чи стерти назавжди)
    if (it.kind === 'base') out.deleted = pre ? pre.deleted.get(it.id) ?? null : (await db.get('SELECT deleted FROM bases WHERE id = ?', it.id).catch(() => null))?.deleted ?? null
    // подія: коли (картки показують дату)
    if (it.kind === 'event') {
      const e = pre ? pre.events.get(it.id) : await db.get('SELECT starts, ends FROM events WHERE id = ?', it.id).catch(() => null)
      out.when = e ? { starts: e.starts, ends: e.ends } : null
    }
    // «змінювати» й «копіювати (куди)» — за правами самої речі (вікно «Доступ»), решта — за власником
    if (ctx) { const rt = rightsOf(ctx, it); out.can = { ...can(ctx, it), edit: rt.edit, copy: rt.copy, copyTo: rt.copyTo } }
    if (starred) out.starred = starred.has(`${it.kind}:${it.id}`)
    return out
  }
  /** рядки за списком id — пачками (у баз даних є межа на кількість параметрів запиту) */
  const byIds = async (sql, ids) => {
    const out = []
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500)
      out.push(...(await db.all(sql.replace('(?)', `(${part.map(() => '?').join(',')})`), ...part)))
    }
    return out
  }
  /** кілька рядків для клієнта: людей, гільдії й кошик баз читаємо разом на весь список */
  async function views(rows, ctx, starred) {
    if (rows.length < 2) return Promise.all(rows.map((it) => view(it, ctx, starred)))
    const uids = [...new Set(rows.flatMap((r) => [r.created_by, r.owner_kind === 'user' ? r.owner_id : null]).filter(Boolean))]
    const gids = [...new Set(rows.filter((r) => r.owner_kind === 'guild').map((r) => r.owner_id))]
    const bids = rows.filter((r) => r.kind === 'base').map((r) => r.id)
    const eids = rows.filter((r) => r.kind === 'event').map((r) => r.id)
    const [us, gs, bs, es, site, progress] = await Promise.all([
      byIds('SELECT id, login, name, color FROM users WHERE id IN (?)', uids),
      byIds('SELECT id, slug, name, tag, color FROM guilds WHERE id IN (?)', gids),
      byIds('SELECT id, deleted FROM bases WHERE id IN (?)', bids).catch(() => []),
      byIds('SELECT id, starts, ends FROM events WHERE id IN (?)', eids).catch(() => []),
      rows.some((r) => r.owner_kind === 'site') ? siteName() : 'Sandwalkers',
      roadmapProgress && rows.some((r) => r.kind === 'roadmap') ? roadmapProgress(rows.filter((r) => r.kind === 'roadmap'), ctx) : null,
    ])
    const pre = { users: new Map(us.map((u) => [u.id, u])), guilds: new Map(gs.map((g) => [g.id, g])), deleted: new Map(bs.map((b) => [b.id, b.deleted])), events: new Map(es.map((e) => [e.id, e])), site, progress }
    return Promise.all(rows.map((it) => view(it, ctx, starred, pre)))
  }
  /** прогрес роадмапів для списків: (рядки, ctx) → Map(id → { n, done }); ставить app.mjs (lib/roadmap-progress) */
  let roadmapProgress = null
  const starredBy = async (uid) => new Set(uid ? (await db.all('SELECT kind, id FROM stars WHERE user_id = ?', uid)).map((s) => `${s.kind}:${s.id}`) : [])

  return {
    get,
    view,
    views,
    useRoadmapProgress: (fn) => { roadmapProgress = fn },
    /** права речі (повні, JSON) */
    setRights: (kind, id, a) => db.run('UPDATE items SET access = ? WHERE kind = ? AND id = ?', a == null ? null : JSON.stringify(a), kind, String(id)),
    owner,
    starredBy,
    /** зареєструвати нову річ */
    async add(kind, id, { owner: o, visibility, title = '', summary = '', by = null, basedOn = null }) {
      if (!KINDS.includes(kind)) throw fail('невідомий вид')
      if (!o || !['user', 'guild', 'site'].includes(o.kind) || !o.id) throw fail('потрібен власник')
      const v = normVis(o.kind, visibility)
      const now = Date.now()
      await db.run(`INSERT INTO items (kind, id, owner_kind, owner_id, visibility, title, summary, created_by, based_on, created, updated, published)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, kind, String(id), o.kind, o.id, v, String(title).slice(0, 160), String(summary).slice(0, 400), by, basedOn ? JSON.stringify(basedOn) : null, now, now, v === 'public' ? now : null)
      return get(kind, id)
    },
    /** документ змінився: назва, опис, дата */
    async touch(kind, id, { title, summary } = {}) {
      const it = await get(kind, id)
      if (!it) return null
      await db.run('UPDATE items SET title = ?, summary = ?, updated = ? WHERE kind = ? AND id = ?', title !== undefined ? String(title).slice(0, 160) : it.title, summary !== undefined ? String(summary).slice(0, 400) : it.summary, Date.now(), kind, String(id))
      return get(kind, id)
    },
    /** новий власник і видимість */
    async setAccess(kind, id, o, visibility) {
      const v = normVis(o.kind, visibility)
      await db.run('UPDATE items SET owner_kind = ?, owner_id = ?, visibility = ?, published = COALESCE(published, ?) WHERE kind = ? AND id = ?', o.kind, o.id, v, v === 'public' ? Date.now() : null, kind, String(id))
      return get(kind, id)
    },
    async moderate(kind, id, { hidden, featured }) {
      const it = await get(kind, id)
      if (!it) return null
      await db.run('UPDATE items SET hidden = ?, featured = ? WHERE kind = ? AND id = ?', hidden === undefined ? it.hidden : hidden ? Date.now() : null, featured === undefined ? it.featured : featured ? Date.now() : null, kind, String(id))
      return get(kind, id)
    },
    async remove(kind, id) {
      await db.run('DELETE FROM stars WHERE kind = ? AND id = ?', kind, String(id))
      await db.run('DELETE FROM items WHERE kind = ? AND id = ?', kind, String(id))
    },
    async star(kind, id, uid, on) {
      if (on) await db.run('INSERT INTO stars (kind, id, user_id, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', kind, String(id), uid, Date.now())
      else await db.run('DELETE FROM stars WHERE kind = ? AND id = ? AND user_id = ?', kind, String(id), uid)
      await db.run('UPDATE items SET stars = (SELECT COUNT(*) FROM stars WHERE kind = ? AND id = ?) WHERE kind = ? AND id = ?', kind, String(id), kind, String(id))
      return { stars: (await get(kind, id))?.stars ?? 0, starred: !!(await db.get('SELECT 1 AS x FROM stars WHERE kind = ? AND id = ? AND user_id = ?', kind, String(id), uid)) }
    },
    copied: (kind, id) => db.run('UPDATE items SET copies = copies + 1 WHERE kind = ? AND id = ?', kind, String(id)),
    dropStarsOf: (uid) => db.run('DELETE FROM stars WHERE user_id = ?', uid),
    /** усе, чим володіє людина чи гільдія */
    ownedBy: (o) => db.all('SELECT * FROM items WHERE owner_kind = ? AND owner_id = ?', o.kind, o.id),

    /**
     * Що контекст бачить у списках: scope — 'mine' (моє), 'guild:<id>' (гільдії), 'shared' (моє + усіх моїх гільдій),
     * 'public' (бібліотека й публічне). «За посиланням» у списки інших не потрапляє.
     */
    async list(ctx, { kind, scope = 'shared' } = {}) {
      const u = ctx?.user
      const where = [], args = []
      if (kind) { where.push('kind = ?'); args.push(kind) }
      if (scope === 'public') where.push("visibility = 'public' AND hidden IS NULL", NOT_TRASHED)
      else if (scope === 'mine') {
        if (!u) return []
        where.push("owner_kind = 'user' AND owner_id = ?"); args.push(u.id)
      } else if (scope.startsWith('guild:')) {
        const gid = scope.slice(6)
        if (!(ctx.ranks.get(gid) || u?.role === 'admin')) return []
        where.push("owner_kind = 'guild' AND owner_id = ?"); args.push(gid)
      } else {
        if (!u) return []
        const gids = [...ctx.ranks.keys()]
        where.push(`((owner_kind = 'user' AND owner_id = ?)${gids.length ? ` OR (owner_kind = 'guild' AND owner_id IN (${gids.map(() => '?').join(',')}))` : ''})`)
        args.push(u.id, ...gids)
      }
      // усе публічне одним списком — не більше 500 найсвіжіших (бібліотека має свої сторінки — library())
      return db.all(`SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated DESC${scope === 'public' ? ' LIMIT 500' : ''}`, ...args)
    },

    /** бібліотека: публічне, не приховане; виділене — згори */
    async library({ kind, q: text = '', sort = 'new', limit = 48, offset = 0, owner: o } = {}) {
      const where = ["visibility = 'public'", 'hidden IS NULL', NOT_TRASHED], args = []
      if (kind) { where.push('kind = ?'); args.push(kind) }
      else { where.push(`kind IN (${LIBRARY_KINDS.map(() => '?').join(',')})`); args.push(...LIBRARY_KINDS) }
      if (o) { where.push('owner_kind = ? AND owner_id = ?'); args.push(o.kind, o.id) }
      const t = String(text).trim().toLowerCase()
      if (t) { where.push('(lower(title) LIKE ? OR lower(summary) LIKE ?)'); args.push(`%${t}%`, `%${t}%`) }
      const order = sort === 'stars' ? 'stars DESC, copies DESC, updated DESC' : sort === 'copies' ? 'copies DESC, stars DESC, updated DESC' : 'COALESCE(published, created) DESC'
      const W = 'WHERE ' + where.join(' AND ')
      const rows = await db.all(`SELECT * FROM items ${W} ORDER BY (featured IS NOT NULL) DESC, ${order} LIMIT ? OFFSET ?`, ...args, Math.min(100, limit), offset)
      const total = (await db.get(`SELECT COUNT(*) AS n FROM items ${W}`, ...args)).n
      return { rows, total }
    },

    /** усе для панелі керування */
    async all({ kind, q: text = '', vis, limit = 50, offset = 0 } = {}) {
      const where = [], args = []
      if (kind) { where.push('kind = ?'); args.push(kind) }
      if (vis) { where.push('visibility = ?'); args.push(vis) }
      const t = String(text).trim().toLowerCase()
      if (t) { where.push('lower(title) LIKE ?'); args.push(`%${t}%`) }
      const W = where.length ? 'WHERE ' + where.join(' AND ') : ''
      return {
        rows: await db.all(`SELECT * FROM items ${W} ORDER BY updated DESC LIMIT ? OFFSET ?`, ...args, Math.min(200, limit), offset),
        total: (await db.get(`SELECT COUNT(*) AS n FROM items ${W}`, ...args)).n,
      }
    },
    counts: () => db.all('SELECT kind, visibility, COUNT(*) AS n FROM items GROUP BY kind, visibility'),
  }
}

/**
 * Контекст доступу для запиту чи вкладки: ctxOf(людина з бази) → { user: { id, role }, ranks: Map(гільдія → ранг) }.
 * byId — свіжий, для живих оновлень (людину могли прийняти чи вигнати з гільдії, поки вкладка відкрита).
 */
export function createAccess({ auth, guilds, roles }) {
  const alive = (sid) => auth.sessionAlive(sid)
  const ctxOf = async (u) => {
    if (!u) return anon
    const perms = roles ? await roles.permsOf(u.role) : new Set()
    const has = (p) => perms.has('*') || perms.has(p) || perms.has('site.*')
    // siteContent — робити речі «від сайту» й вести їх (дозвіл site.content)
    return { user: { id: u.id, role: u.role }, ranks: await guilds.ranks(u.id), superuser: perms.has('*'), moderate: has('site.moderate'), siteContent: has('site.content') }
  }
  return { ctxOf, byId: async (id) => ctxOf(id ? await auth.get(id) : null), alive }
}

/**
 * Живі оновлення (SSE) з перевіркою доступу: кожна вкладка — зі своєю людиною; подія про річ іде лише тим, хто її
 * бачить (якщо видимість змінилась — тим, хто бачив до або бачить тепер, щоб у них річ з'явилась чи зникла).
 */
export function createHub(access) {
  const clients = new Set()
  return {
    open(req, res) {
      res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
      res.flushHeaders()
      res.write(': ok\n\n')
      // сеанс — щоб «вийти на всіх пристроях», видалення облікового запису й блокування зупиняли й відкриті вкладки
      const c = { res, userId: req.user?.id || null, sid: req.session?.id || null, ctx: null, at: 0, key: req.user?.id || `ip:${req.ip || ''}` }
      // не більше 20 потоків на людину (без входу — на адресу): новий закриває найдавніший, а не відмовляє
      const same = [...clients].filter((x) => x.key === c.key)
      for (const old of same.slice(0, Math.max(0, same.length - 19))) { old.close(); old.res.end() }
      clients.add(c)
      const ping = setInterval(() => res.write(': ping\n\n'), 25000)
      c.close = () => { clearInterval(ping); clients.delete(c) }
      req.on('close', c.close)
    },
    /** ev — подія; items — стан речі до й після (рядки реєстру), щоб вирішити, кому слати; без items — усім */
    async emit(ev, ...items) {
      const s = `data: ${JSON.stringify(ev)}\n\n`
      // права й живість сеансу кожної вкладки — разом (паралельно) і з коротким кешем, а не кілька запитів на кожну
      await Promise.all([...clients].map(async (c) => {
        if (c.sid && Date.now() - c.at > 5000) {
          if (!(await access.alive(c.sid).catch(() => true))) { c.close(); c.res.end(); return }
          c.ctx = null
        }
        if (items.length) {
          if (!c.ctx) { c.ctx = c.userId ? await access.byId(c.userId).catch(() => anon) : anon; c.at = Date.now() }
          if (!items.some((it) => it && can(c.ctx, it).view)) return
        }
        c.res.write(s)
      }))
    },
    /** подія лише тим вкладкам, чий контекст пройде перевірку ok(ctx) (прогрес — лише тим, кому він показаний) */
    async emitWhere(ev, ok) {
      const s = `data: ${JSON.stringify(ev)}\n\n`
      await Promise.all([...clients].map(async (c) => {
        if (!c.ctx || Date.now() - c.at > 5000) { c.ctx = c.userId ? await access.byId(c.userId).catch(() => anon) : anon; c.at = Date.now() }
        if (await ok(c.ctx)) c.res.write(s)
      }))
    },
  }
}

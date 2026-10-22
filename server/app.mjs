/*
 * API-сервер Sandwalkers: облікові записи, гільдії, бібліотека й панель керування; бази, роадмапи, білди, позначки й
 * записи «Ресурсів» з власником і видимістю (SQLite); дані мапи (кеш TH.GL), довідник.
 * У розробці його проксує Vite (/api, /map-tiles, /versions); з --serve-dist віддає і зібраний фронт.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import compression from 'compression'
import { createPlacesStore } from './lib/db.mjs'
import { openDb } from './lib/sql.mjs'
import { importSqlite } from './lib/import-sqlite.mjs'
import { createMailer } from './lib/mail.mjs'
import { createMapData } from './lib/thgl.mjs'
import { createPlacesRoutes } from './routes/places.mjs'
import { createMapRoutes } from './routes/map.mjs'
import { createHomeRoutes } from './routes/home.mjs'
import { createCatalogRoutes } from './routes/catalog.mjs'
import { createCatalog } from './lib/catalog.mjs'
import { createRoadmaps } from './lib/roadmap.mjs'
import { createProgress } from './lib/roadmap-progress.mjs'
import { createRoadmapService } from './lib/roadmap-service.mjs'
import { createDecreeRoutes, createPushRoutes, createRoadmapRoutes } from './routes/roadmap.mjs'
import { createPush } from './lib/push.mjs'
import { createSpice } from './lib/spice.mjs'
import { createGameMap } from './lib/gamemap.mjs'
import { createSpiceRoutes } from './routes/spice.mjs'
import { createDecrees } from './lib/decree.mjs'
import { createBasesStore } from './lib/bases.mjs'
import { createBasesRoutes } from './routes/bases.mjs'
import { createThumbs } from './lib/thumbs.mjs'
import { createSkills } from './lib/skills.mjs'
import { createSkillsRoutes } from './routes/skills.mjs'
import { createAuth, createLimiter } from './lib/auth.mjs'
import { createSecurity } from './lib/security.mjs'
import { createOg } from './lib/og.mjs'
import { createGuilds } from './lib/guilds.mjs'
import { createAccess, createHub, createItems } from './lib/items.mjs'
import { cleanBuild, cleanCalc, cleanMarker, createDocs } from './lib/docs.mjs'
import { createContent } from './lib/content.mjs'
import { COOKIE, cookieOf, createAuthRoutes, sameSite, sessionMiddleware } from './routes/auth.mjs'
import { createGuildRoutes } from './routes/guilds.mjs'
import { createItemRoutes } from './routes/items.mjs'
import { createAdminRoutes } from './routes/admin.mjs'
import { createDocRoutes } from './routes/docs.mjs'
import { createGameData } from './lib/gamedata.mjs'
import { createI18n, langMiddleware, pickLang } from './lib/i18n.mjs'
import { createAnnouncements } from './lib/announcements.mjs'
import { createSiteRoutes } from './routes/site.mjs'
import { createRoles } from './lib/roles.mjs'
import { actorStore, createRevisions, track } from './lib/revisions.mjs'
import { createCron } from './lib/cron.mjs'
import { createGameDataSources } from './lib/gamedata/index.mjs'
import { createGameDataRoutes } from './routes/gamedata.mjs'
import { fail, withLock } from './lib/util.mjs'
import { auditMiddleware, dropLegacyDuplicates } from './lib/audit.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** гільдія, якій належить усе, що було на сайті до облікових записів */
const HOME_GUILD = 'sandwalkers'

/**
 * db — готова база (тести); інакше — з .env: Postgres (Snotax console) чи запасна SQLite у dataDir. mailer — свій
 * відправник листів (тести); інакше — SMTP з .env (Mailpit у розробці).
 */
export async function createApp({ dataDir, serveDist = false, background = true, log = console, db: given, mailer: givenMailer, site, codeGap } = {}) {
  const db = given || (await openDb({ dataDir }))
  log.info?.(`[db] ${db.label || db.kind}`)
  const mailer = givenMailer || createMailer(process.env, log)
  const places = await createPlacesStore(db)
  const roadmaps = await createRoadmaps(db)
  const progress = await createProgress(db)
  const bases = await createBasesStore(db)
  const builds = await createDocs(db, 'builds', 'b')
  const calcs = await createDocs(db, 'calcs', 'c')
  const markers = await createDocs(db, 'markers', 'm')
  const auth = await createAuth(db, codeGap !== undefined ? { codeGap } : {})
  // паскеї, двофакторна перевірка й одноразові виклики входу
  const security = await createSecurity(db)
  const guilds = await createGuilds(db)
  const items = await createItems(db)
  const roles = await createRoles(db)
  const revisions = await createRevisions(db)
  const cron = await createCron(db, { log })
  const access = createAccess({ auth, guilds, roles })
  // ---------- версії змін із сайту (панель пише свої сама): хто — з контексту запиту ----------
  {
    const doc = (store) => async (id) => { const d = await store.get(id); if (!d) return null; const { created, updated, ...rest } = d; return rest }
    const docSpec = (store, add) => ({
      [add]: { action: 'create', id: (a, r) => r?.id, read: doc(store) },
      put: { action: 'update', pre: true, id: (a) => a[0], read: doc(store) },
      patch: { action: 'update', pre: true, id: (a) => a[0], read: doc(store) },
      remove: { action: 'delete', pre: true, id: (a) => a[0], read: doc(store) },
    })
    track(builds, 'builds', revisions, docSpec(builds, 'create'))
    track(calcs, 'calcs', revisions, docSpec(calcs, 'create'))
    track(markers, 'markers', revisions, docSpec(markers, 'create'))
    track(places, 'places', revisions, docSpec(places, 'add'))
    // бази й роадмапи: повні документи — у їхній власній історії, тут — лише назва й версія
    const head = (store) => async (id) => { const d = await store.get(id); return d && { name: d.doc?.ui?.name ?? d.doc?.title, version: d.version, deleted: d.deleted ?? null } }
    track(bases, 'bases', revisions, { create: { action: 'create', id: (a, r) => r?.id, read: head(bases) }, put: { action: 'update', pre: true, id: (a) => a[0], read: head(bases) }, remove: { action: 'trash', pre: true, id: (a) => a[0], read: head(bases) }, undelete: { action: 'restore', pre: true, id: (a) => a[0], read: head(bases) }, purge: { action: 'delete', pre: true, id: (a) => a[0], read: head(bases) }, restore: { action: 'restore-version', pre: true, id: (a) => a[0], read: head(bases) } })
    track(roadmaps, 'roadmaps', revisions, { create: { action: 'create', id: (a, r) => r?.id, read: head(roadmaps) }, put: { action: 'update', pre: true, id: (a) => a[0], read: head(roadmaps) }, remove: { action: 'delete', pre: true, id: (a) => a[0], read: head(roadmaps) }, restore: { action: 'restore-version', pre: true, id: (a) => a[0], read: head(roadmaps) } })
    const user = async (id) => { const u = await auth.get(id); if (!u) return null; const { email, ...rest } = u; return rest }
    track(auth, 'users', revisions, { updateProfile: { action: 'update', pre: true, id: (a) => a[0], read: user }, setRole: { action: 'role', pre: true, id: (a) => a[0], read: user }, ban: { action: 'ban', pre: true, id: (a) => a[0], read: user }, unban: { action: 'unban', pre: true, id: (a) => a[0], read: user }, remove: { action: 'delete', pre: true, id: (a) => a[0], read: user } })
    const guild = async (id) => guilds.get(id)
    track(guilds, 'guilds', revisions, { create: { action: 'create', id: (a, r) => r?.id, read: guild }, update: { action: 'update', pre: true, id: (a) => a[0], read: guild }, remove: { action: 'delete', pre: true, id: (a) => a[0], read: guild } })
    const member = async ([g, u]) => (await guilds.members(g)).find((m) => m.id === u) ?? null
    track(guilds, 'members', revisions, { addMember: { action: 'create', id: (a) => [a[0], a[1]], read: member }, setRole: { action: 'update', pre: true, id: (a) => [a[0], a[1]], read: member }, removeMember: { action: 'delete', pre: true, id: (a) => [a[0], a[1]], read: member } })
    const item = async ([k, i]) => items.get(k, i)
    track(items, 'items', revisions, { setAccess: { action: 'access', pre: true, id: (a) => [a[0], String(a[1])], read: item }, moderate: { action: 'moderate', pre: true, id: (a) => [a[0], String(a[1])], read: item }, remove: { action: 'delete', pre: true, id: (a) => [a[0], String(a[1])], read: item } })
  }
  const decrees = createDecrees({ db, auth, guilds })
  const content = createContent({ items, guilds, auth, bases, roadmaps, builds, calcs, markers, places })
  // роадмапи: права й прогрес (у списках — прогрес глядача); річ перейшла до іншого власника будь-яким шляхом
  // («Доступ», видалення гільдії, панель) — права підлаштовуються під нового власника, запис прогресу роадмапу — за ним
  const roadmapService = createRoadmapService({ roadmaps, items, progress })
  items.useRoadmapProgress(roadmapService.listProgress)
  {
    const setAccess = items.setAccess
    items.setAccess = async (kind, id, o, v) => {
      const before = await items.get(kind, id)
      const after = await setAccess(kind, id, o, v)
      if (before && after) await roadmapService.moved(before, after)
      return after
    }
  }
  const thumbs = createThumbs({ dataDir, bases, log })
  // річ стерто назавжди — разом із нею її знімки й історія змін (там лежали повні документи)
  const KIND_ENTITY = { base: 'bases', roadmap: 'roadmaps', build: 'builds', calc: 'calcs', marker: 'markers', place: 'places' }
  content.afterPurge(async (kind, id) => {
    if (kind === 'base') { try { thumbs.drop(id) } catch { /* знімків могло й не бути */ } }
    if (kind === 'roadmap') await progress.purge(id)
    await revisions.forget([[KIND_ENTITY[kind] || kind, id], ['items', JSON.stringify([kind, String(id)])]])
  })
  const i18n = await createI18n(db, { dir: path.join(root, 'locales') })
  const push = await createPush({ db, dataDir, log, i18n })
  const mapData = createMapData({ dataDir, log })
  const game = await createGameData(db, { dataDir, log })
  const catalog = createCatalog({ dataDir, game })
  const skills = createSkills({ game })
  const announcements = await createAnnouncements(db)
  const hubs = { base: createHub(access), roadmap: createHub(access), place: createHub(access), marker: createHub(access), spice: createHub(access) }
  // активні поля меланжу — позначки гравців
  const spice = await createSpice({ db, guilds })
  // джерела ігрових даних і журнал змін (індикатор оновлень); без GAMEDATA=1 — null, у базу нічого не пише
  // мапа з файлів гри (план 5b): точки, типи міток і розклад ГП застосовує реєстр, мапа сайту бере їх після перемикання
  const gamemap = await createGameMap({ db, mapData, dataDir })
  const gamedata = await createGameDataSources({ db, dataDir, game, mapData, spice, gamemap, log })

  // ---------- давні дані: з SQLite у щойно підключений Postgres (раз), потім — початковий вміст порожньої бази ----------
  if (!given) await importSqlite(db, path.join(dataDir, 'app.db'), log)
  await places.seed()
  await bases.seed()
  // давнє «оголошення» з налаштувань — у справжні оголошення (раз)
  {
    const notice = await auth.settings.get('notice', '')
    if (notice) { await announcements.create({ title: notice, tone: 'info' }, null); await auth.settings.set('notice', '') }
  }

  // ---------- усе, що було до облікових записів, — гільдії Sandwalkers ----------
  {
    // перша гільдія сайту — створюється раз; якщо її потім видалили, після перезапуску вона не «воскресає»
    const home = async () => {
      const g = await guilds.get(HOME_GUILD)
      const made = await auth.settings.get('homeGuildMade', false)
      if (g && !made) await auth.settings.set('homeGuildMade', true)
      if (g || made) return g || null
      const fresh = await guilds.create({ name: 'Sandwalkers', tag: 'SW', about: 'Гільдія, з якої почався сайт: бази Main і DD, роадмап, записи ресурсів.' }, null, { slug: HOME_GUILD })
      await auth.settings.set('homeGuildMade', true)
      return fresh
    }
    // давнє без власника — першій гільдії (якщо її вже нема — лишається як є)
    const adopt = async (kind, id, meta) => { if (!(await items.get(kind, id))) { const g = await home(); if (g) await items.add(kind, id, { owner: { kind: 'guild', id: g.id }, visibility: 'guild', ...meta }) } }
    // назва й підсумок — зі списку (без розбору повних документів на кожному старті)
    for (const b of await bases.list()) await adopt('base', b.id, { title: b.name, summary: b.lead })
    for (const p of await places.list()) await adopt('place', p.id, content.H.place.meta(p))
    // давній єдиний роадмап (чи початковий з data/roadmap.json) — раз; далі роадмапи лише створюють люди
    if (!(await auth.settings.get('roadmapsMigrated', false))) {
      await roadmaps.migrateLegacy(HOME_GUILD)
      if (await roadmaps.has(HOME_GUILD)) await adopt('roadmap', HOME_GUILD, content.H.roadmap.meta((await roadmaps.get(HOME_GUILD)).doc))
      await auth.settings.set('roadmapsMigrated', true)
    }
    // прогрес роадмапів — з документів у власні записи, права наявних — щоб усе виглядало, як учора (раз)
    if (!(await auth.settings.get('roadmapProgressMigrated', false))) {
      await roadmapService.migrate()
      await auth.settings.set('roadmapProgressMigrated', true)
    }
    await roadmaps.fillStages()
    // права роадмапів — з давнього roadmaps.access у реєстр (items.access), де тепер права всіх речей
    await roadmaps.moveAccess()
    await decrees.migrateLegacy((await home())?.id ?? null)
  }
  /** перший зареєстрований — лідер гільдії Sandwalkers (якщо в неї ще нікого) */
  const onFirst = async (u) => {
    const g = await guilds.get(HOME_GUILD)
    if (g && !(await guilds.memberCount(g.id))) { await guilds.addMember(g.id, u.id, 'leader'); await auth.setMainGuild(u.id, g.id) }
  }
  /** видалити гільдію: її річ — лідеру особисто (якщо лідера нема — стерти) */
  const deleteGuild = async (gid) => {
    const members = await guilds.members(gid)
    const leader = members.find((m) => m.role === 'leader')
    if (leader) await content.transferOwned({ kind: 'guild', id: gid }, { kind: 'user', id: leader.id })
    else await content.purgeOwned({ kind: 'guild', id: gid })
    for (const m of members) { const u = await auth.get(m.id); if (u?.main_guild === gid) await auth.setMainGuild(u.id, null) }
    await guilds.remove(gid)
  }
  /**
   * Видалити людину: особисте — стерти; у гільдіях, де вона лідер, лідерство — офіцеру чи найдавнішому учаснику
   * (нікого — гільдію теж видалити, з її річчю); зірки — геть.
   */
  const removeUser = async (uid) => {
    for (const g of await guilds.of(uid)) {
      if (g.role !== 'leader') continue
      const next = (await guilds.members(g.id)).filter((m) => m.id !== uid)
      const heir = next.find((m) => m.role === 'officer') || next.find((m) => m.role === 'member') || next[0]
      if (heir) await guilds.setRole(g.id, heir.id, 'leader')
      else { await content.purgeOwned({ kind: 'guild', id: g.id }); await guilds.remove(g.id) }
    }
    const u = await auth.get(uid)
    await content.purgeOwned({ kind: 'user', id: uid })
    await items.dropStarsOf(uid)
    await progress.forgetUser(uid)
    await push.forgetUser(uid)
    await spice.forgetUser(uid)
    await guilds.leaveAll(uid)
    await security.removeUser(uid)
    await auth.remove(uid)
    // від людини не лишається особистого: історія її профілю й членства — геть, у решті історії й журналі вона
    // стає безіменною (зміни гільдійських речей лишаються гільдії), подробиці її запитів (IP) — стерто
    await db.run("DELETE FROM revisions WHERE (entity = 'users' AND entity_id = ?) OR (entity = 'members' AND entity_id LIKE ?)", uid, `%"${uid}"]`)
    await db.run('UPDATE revisions SET actor = NULL WHERE actor = ?', uid)
    await db.run("UPDATE audit SET actor = NULL, detail = '' WHERE actor = ?", uid)
    if (u?.email) await db.run('DELETE FROM login_codes WHERE email = ?', u.email)
  }

  const app = express()
  app.disable('x-powered-by')
  // захисні заголовки: сайт не вбудовують у чужі рамки (кнопки «Видалити» під чужою сторінкою), браузер не вгадує типи
  // файлів, адреси сторінок не йдуть на чужі сайти повністю; через https — лише https
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('X-Frame-Options', 'DENY')
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.set('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000')
    next()
  })
  // SSE не стискаємо: інакше події застрягають у буфері компресора
  app.use(compression({ filter: (req, res) => !req.path.endsWith('/stream') && compression.filter(req, res) }))
  // бази — великі документи (Main ≈ 230 КБ); їхній розбір — першим, інакше загальна межа відкине тіло. Лише з
  // сеансом: без входу писати бази чи вміст не можна, тож 8 МБ від будь-кого не розбираємо
  const bigJson = express.json({ limit: '8mb' })
  const bigIfSession = (req, res, next) => (cookieOf(req, COOKIE) ? bigJson(req, res, next) : next())
  app.use('/api/bases', bigIfSession)
  // документи вмісту в панелі — теж великі
  app.use('/api/admin/r', bigIfSession)
  app.use(express.json({ limit: '256kb' }))
  // за проксі (Vite, Snotax) — справжня адреса людини з X-Forwarded-For (для обмеження спроб входу)
  app.set('trust proxy', 'loopback')
  app.use(langMiddleware(i18n))
  app.use('/api', sameSite())
  app.use('/api', sessionMiddleware({ auth, access }))
  await dropLegacyDuplicates(db).catch((e) => log.warn?.('журнал: давні дублікати не прибрано', e))
  // загальна межа на записи: не більше 600 за 5 хв на людину (без входу — 120 на адресу); вхід і нагадування мають свої
  const writesUser = createLimiter({ max: 600, ms: 5 * 60_000 })
  const writesIp = createLimiter({ max: 120, ms: 5 * 60_000 })
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
    const ok = req.user ? writesUser.hit(req.user.id) : writesIp.hit(req.ip || '')
    next(ok ? undefined : fail('забагато запитів — спробуй трохи згодом', 429))
  })
  app.use('/api', auditMiddleware(auth))
  app.use('/api', (req, res, next) => actorStore.run({ userId: req.user?.id || null }, next))
  // ліміти кількості речей (людина / гільдія) — до маршрутів створення, копіювання й передачі: так усі шляхи, якими
  // з'являється нова річ у власника, перевіряються в одному місці
  // нові позначки й записи ресурсів — не частіше 60 на годину на людину (публічне видно всім — без спаму)
  const spam = createLimiter({ max: 60, ms: 60 * 60_000 })
  app.use(['/api/markers', '/api/places'], (req, res, next) => {
    if (req.method !== 'POST' || req.path !== '/' || !req.user) return next()
    next(spam.hit(req.user.id) ? undefined : fail('забагато нових позначок за годину — спробуй трохи згодом', 429))
  })
  const CREATES = [[/^\/api\/bases(\/import|\/generate)?$/, 'base'], [/^\/api\/roadmaps$/, 'roadmap'], [/^\/api\/builds$/, 'build'], [/^\/api\/calcs$/, 'calc'], [/^\/api\/markers$/, 'marker'], [/^\/api\/places$/, 'place']]
  app.use('/api', (req, res, next) => Promise.resolve().then(async () => {
    if (!req.user) return next()
    const path = '/api' + req.path
    let kind = null, owner = req.body?.owner
    if (req.method === 'POST') {
      // «лише перевірити» буває тільки в імпорті бази; на інших маршрутах це поле нічого не означає й ліміт не знімає
      if (req.body?.dryRun && path === '/api/bases/import') return next()
      kind = CREATES.find(([re]) => re.test(path))?.[1] ?? /^\/api\/items\/(\w+)\/[^/]+\/copy$/.exec(path)?.[1] ?? null
    } else if (req.method === 'PATCH' && owner) {
      const a = /^\/api\/items\/(\w+)\/([^/]+)\/access$/.exec(path)
      let rid = null
      try { rid = a && decodeURIComponent(a[2]) } catch { throw fail('хибна адреса', 400) }
      const cur = a && (await items.get(a[1], rid))
      if (cur && !(cur.owner_kind === owner.kind && cur.owner_id === (owner.kind === 'site' ? 'site' : owner.id))) kind = cur.kind
    }
    if (!kind) return next()
    // перевірка ліміту й сам запис — по черзі для одного власника: інакше одночасні запити проскочили б ліміт разом
    const o = await content.ownerFor(req, owner)
    await withLock(`limit:${o.kind}:${o.id}`, async () => {
      await content.checkLimit(req, kind, o)
      await new Promise((done) => { res.once('finish', done); res.once('close', done); next() })
    })
  }).catch(next))
  app.use(createAuthRoutes({ auth, security, guilds, items, roles, content, mailer, onFirst, removeUser, site: site || (process.env.APP_URL || 'https://dune.test').replace(/^https?:\/\//, '') }))
  app.use(createGuildRoutes({ auth, guilds, items, deleteGuild, decrees }))
  app.use(createItemRoutes({ items, content, hubs, auth, roadmapService, progress, revisions }))
  app.use(createSiteRoutes({ i18n, announcements, auth }))
  app.use(createAdminRoutes({ db, auth, guilds, items, content, bases, roadmaps, builds, calcs, markers, places, game, i18n, announcements, catalog, skills, removeUser, deleteGuild, mapData, roles, revisions, cron }))
  app.use(createPlacesRoutes({ places, mapData, items, content, hub: hubs.place }))
  app.use(createSpiceRoutes({ spice, mapData, hub: hubs.spice }))
  app.use(createMapRoutes({ mapData, game, gamemap }))
  app.use(createHomeRoutes({ mapData, places, items }))
  app.use(createCatalogRoutes({ catalog, game }))
  app.use(createSkillsRoutes({ skills }))
  app.use(createGameDataRoutes({ sources: gamedata, roles, game }))
  app.use(createRoadmapRoutes({ roadmaps, items, content, hub: hubs.roadmap, progress, service: roadmapService, guilds, revisions }))
  app.use(createBasesRoutes({ bases, thumbs, items, content, hub: hubs.base }))
  app.use(createDocRoutes({ kind: 'build', path: 'builds', store: builds, clean: cleanBuild, items, content, label: 'білду' }))
  app.use(createDocRoutes({ kind: 'calc', path: 'calcs', store: calcs, clean: cleanCalc, items, content, label: 'розрахунку' }))
  app.use(createDocRoutes({ kind: 'marker', path: 'markers', store: markers, clean: (d) => cleanMarker(d, mapData), items, content, hub: hubs.marker, label: 'позначки' }))
  app.use(createDecreeRoutes({ decrees, roles }))
  app.use(createPushRoutes({ push }))
  app.use('/versions', express.static(path.join(root, 'versions'), { maxAge: '1d' }))
  // жива не лише програма, а й база (інакше перевірка бачить «усе гаразд», коли жодна сторінка не відкривається)
  app.get('/api/health', async (req, res) => {
    try {
      await db.get('SELECT 1 AS ok')
      res.set('cache-control', 'no-store').json({ ok: true })
    } catch {
      res.status(503).set('cache-control', 'no-store').json({ ok: false, error: req.t('база даних недоступна') })
    }
  })
  app.use('/api', (req, res) => res.status(404).json({ error: req.t('немає такого шляху') }))

  if (serveDist) {
    const dist = path.join(root, 'dist')
    // файли збірки з відбитком в імені не змінюються — кеш на рік; нема такого (стара вкладка після оновлення сайту
    // просить шматок, якого вже нема) — 404, а не сторінка замість скрипта (тоді вкладка сама перезавантажиться)
    app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '1y', immutable: true, index: false }), (req, res) => res.status(404).end())
    app.use(express.static(dist, { maxAge: '1d', index: false }))
    // сторінка сайту: відомі розділи — 200; невідома адреса — та сама сторінка (вона скаже «не знайдено»), але з кодом 404
    const KNOWN = new Set(['', 'bases', 'roadmap', 'map', 'catalog', 'calculator', 'skills', 'builds', 'calcs', 'library', 'login', 'register', 'reset', 'me', 'account', 'u', 'g', 'guilds', 'invite', 'admin', 'plan', 'dd', 'data'])
    // у сторінку — заголовок, опис і картинка того, на що веде адреса (прев'ю посилань у Discord, Telegram)
    const og = createOg({ file: path.join(dist, 'index.html'), db, items, auth, guilds, thumbs, access })
    app.get('*', (req, res, next) => Promise.resolve().then(async () => {
      const seg = req.path.split('/')[1] || ''
      res.status(KNOWN.has(seg) ? 200 : 404).set({ 'cache-control': 'no-cache', 'content-type': 'text/html; charset=utf-8' }).send(await og.render(req))
    }).catch(next))
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // такий запис уже є (повтор ключа: предмет гри, текст, позначка) — це не збій сервера
    const dup = err.code === '23505' || /UNIQUE constraint failed/.test(String(err.message))
    const status = dup ? 409 : err.status || 500
    if (status >= 500) log.error?.(err)
    // текст помилки — мовою людини (ключ — український текст із fail(), заповнювачі — vars; назва поля теж перекладається);
    // тіло запиту розбирається ще до визначення мови — тоді мову беремо тут
    const t = req.t || ((k, v) => i18n.t(pickLang(req), k, v))
    const vars = err.vars?.field ? { ...err.vars, field: t(String(err.vars.field)) } : err.vars
    // помилки розбору тіла (express.json) — англійською від бібліотеки: свої тексти
    const body = err.type === 'entity.too.large' ? t('завеликий запит') : err.type === 'entity.parse.failed' ? t('хибні дані в запиті') : null
    res.status(status).json({
      error: dup ? t('такий запис уже є') : status >= 500 ? t('помилка сервера') : body || (err.key ? t(err.key, vars) : t(err.message)),
      // яке поле форми підсвітити
      ...(err.vars?.fieldKey ? { field: err.vars.fieldKey } : {}),
      // код входу вже надіслано — сторінка входу переходить до введення коду
      ...(err.vars?.already ? { already: true } : {}),
      // вхід застарів (квиток другого кроку згорів) — сторінка входу повертається до пошти
      ...(err.vars?.restart ? { restart: 1 } : {}),
    })
  })

  // ---------- фонові задачі (планувальник; розклад, запуски й журнали — у панелі керування) ----------
  // розкладка Глибокої пустелі: сервер сам питає TH.GL (у вікні бурі — кожні пів години, інакше раз на 6 год — це
  // вирішує refresh), а не чекає, доки хтось відкриє мапу: тоді й перший відвідувач після бурі бачить новий тиждень
  await cron.register('map-refresh', { name: 'Мапа: свіжі дані TH.GL', description: 'Нова розкладка Глибокої пустелі після бурі, точки й словники', schedule: '*/5 * * * *',
    run: async (say) => { const r = await mapData.refresh(); say(r?.syncedAt ? `дані TH.GL від ${r.syncedAt}` : 'без змін') } })
  await cron.register('thumbs-warm', { name: 'Знімки баз', description: 'Малює прев’ю 3D для баз, у яких його ще нема', schedule: '7 * * * *',
    run: async (say) => { await thumbs.warm(); say('перевірено') } })
  if (gamedata) await cron.register('gamedata-check', { name: 'Дані гри: перевірка змін', description: 'Порівнює кожен розділ даних із попереднім і пише журнал, лише коли щось справді змінилось', schedule: '*/10 * * * *',
    run: async (say) => { const r = await gamedata.registry.check(); const ch = r.filter((x) => x.status === 'changed').map((x) => x.section); say(ch.length ? `змінено: ${ch.join(', ')}` : 'без змін') } })
  await cron.register('cleanup', { name: 'Прибирання', description: 'Прострочені сеанси, коди входу й запрошення, давні заявки до гільдій, старий журнал дій та історія змін (скільки днів зберігати — у налаштуваннях сайту)', schedule: '15 * * * *',
    run: async (say) => {
      const now = Date.now()
      const s1 = await db.run('DELETE FROM sessions WHERE expires < ?', now)
      const s2 = await db.run('DELETE FROM login_codes WHERE expires < ?', now - 3600_000)
      // запрошення, що вже не відкриють (минув строк чи вичерпано), і заявки, на які пів року ніхто не відповів
      const s5 = await db.run('DELETE FROM invites WHERE (expires IS NOT NULL AND expires < ?) OR (max_uses IS NOT NULL AND uses >= max_uses)', now)
      const s6 = await db.run('DELETE FROM requests WHERE created < ?', now - 180 * 86400_000)
      // 0 днів — зберігати завжди
      const auditDays = Number(await auth.settings.get('auditDays', 180)) || 0, revDays = Number(await auth.settings.get('revisionDays', 365)) || 0
      const s3 = auditDays ? await db.run('DELETE FROM audit WHERE at < ?', now - auditDays * 86400_000) : { changes: 0 }
      const s4 = revDays ? await db.run('DELETE FROM revisions WHERE at < ?', now - revDays * 86400_000) : { changes: 0 }
      say(`сеансів: ${s1.changes}, кодів: ${s2.changes}, запрошень: ${s5.changes}, заявок: ${s6.changes}, подій журналу: ${s3.changes}, змін в історії: ${s4.changes}`)
    } })
  // (background: false — без мережі й фонових задач, для тестів)
  if (background) {
    cron.start()
    mapData.refresh().catch(() => {})
    // знімки баз, яких ще нема (після оновлення сервера чи правок поза ним) — трохи згодом, щоб не гальмувати старт
    setTimeout(() => thumbs.warm().catch(() => {}), 3000).unref?.()
  }

  app.locals.spice = spice
  app.locals.close = async () => { cron.stop(); push.close(); if (!given) await db.close() }
  return app
}

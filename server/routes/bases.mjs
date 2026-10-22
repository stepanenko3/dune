/*
 * Бази: GET /api/bases?scope= — список того, що людина бачить (моє, гільдій; scope=public — публічне); GET
 * /api/bases/:id — документ із версією, правами й спільними правками калькулятора; POST { doc, note, owner, visibility }
 * — нова (з from і name — копія наявної: документ бере сервер, у реєстрі — «на основі …», як копія з бібліотеки);
 * PUT { doc, version, note } — зберегти (409, якщо версія застаріла); PUT …/calc { calc } — спільні правки калькулятора
 * бази; DELETE — у видалені (POST …/undelete повертає, …/purge — стерти назавжди лише власнику); історія, перегляд і
 * відновлення версій — за правом «хто бачить історію» (типово — ті, хто може змінювати базу: публікація не відкриває
 * давніх версій). Дивитися, керувати й володіти — реєстр речей (lib/items.mjs); змінювати, копіювати й бачити історію —
 * права самої бази (вікно «Доступ», lib/roadmap-access.mjs).
 * Зміни розлітаються через SSE (/api/bases/stream) — лише тим, хто базу бачить. GET /api/bases/:id/thumb.jpg — знімок
 * 3D поточної версії (малює сервер, lib/thumbs.mjs); адреса з ?v= (поле thumb у списку) кешується назавжди.
 * GET /api/bases/:id/export — файл бази (JSON; лише після входу й тим, кому базу дозволено копіювати — файл і є копія); POST /api/bases/import
 * { doc, owner, visibility, name, dryRun } — перевірити (dryRun) і створити базу з файлу: помилки — 400 зі списком
 * { path, message }, нічого не створюється.
 * POST /api/bases/generate { params, owner, visibility } — генератор баз (lib/basegen.mjs): сервер будує базу з
 * параметрів сам і перевіряє правила гри; план неможливий — 400 з errors, база порушує правила — 422 зі звітом, інакше —
 * нова база (власник — людина, за замовчуванням приватна).
 */
import express from 'express'
import { exportBase, exportFileName, importNote, noteText, validateBase } from '../lib/bases.mjs'
import { generateBase } from '../lib/basegen.mjs'
import { can } from '../lib/items.mjs'
import { rightsOf } from '../lib/roadmap-access.mjs'
import { fail } from '../lib/util.mjs'
import { need, wrap } from './auth.mjs'

export function createBasesRoutes({ bases, thumbs, items, content, hub }) {
  const r = express.Router()
  const ID = /^[\w-]{1,48}$/
  const id = (req) => (ID.test(req.params.id) ? req.params.id : '')
  const brief = (b) => ({ id: b.id, version: b.version, updated: b.updated, deleted: b.deleted })
  const DENY = {
    edit: () => fail('змінювати цю базу тобі не можна', 403),
    history: () => fail('історію цієї бази тобі не відкрито', 403),
    manage: () => fail('це може лише власник (у гільдії — офіцер чи лідер)', 403),
    own: () => fail('стерти базу назавжди може лише власник (у гільдії — лідер)', 403),
  }
  /**
   * база й її рядок реєстру, якщо людина її бачить; need — яке право потрібне ще (view, edit, manage, own); doc: false —
   * без документа (лише версія й кошик); trash — і з кошика (історію бази в кошику її редактор бачить)
   */
  const loadId = async (req, bid, need = 'view', { doc = true, trash = false } = {}) => {
    const b = bid ? (doc ? await bases.get(bid) : await bases.head(bid)) : null
    const it = b && (await items.get('base', b.id))
    // змінювати й бачити історію — за правами бази; решта — за власником
    const c = it ? { ...can(req.ctx, it), edit: rightsOf(req.ctx, it).edit, history: rightsOf(req.ctx, it).history } : can(req.ctx, it)
    // база в кошику — лише для тих, хто нею керує (інші, зокрема за посиланням, бачать її як видалену)
    if (!b || !c.view || (b.deleted && !c.manage)) throw fail('немає такої бази', 404)
    if (b.deleted && need === 'edit' && !trash) throw fail('база в кошику — спершу поверни її', 409)
    if (!c[need]) throw DENY[need]()
    return { b, it, c }
  }
  const load = (req, need, opts) => loadId(req, id(req), need, opts)
  // новий знімок — у фоні, відповідь не чекає
  const redraw = (b) => { if (b && !b.deleted) thumbs?.ensure(b.id).catch(() => {}) }
  const touch = (b, req) => items.touch('base', b.id, content.H.base.meta(b.doc, req.t))
  const view = (it, req, starred) => items.view(it, req.ctx, starred)
  /** примітка до версії мовою людини (службові лежать українською) */
  const noted = (x, req) => (x && typeof x.note === 'string' ? { ...x, note: noteText(x.note, req.t) } : x)
  /** автори версій: id → { id, login, name } (видалену людину — «Людину видалено») */
  const authors = async (ids, req) => {
    const out = new Map()
    for (const a of new Set(ids.filter(Boolean))) {
      const o = await items.owner('user', a, req.t)
      out.set(a, { id: a, login: o.login || null, name: o.name })
    }
    return (a) => (a ? out.get(a) || null : null)
  }

  r.get('/api/bases', wrap(async (req, res) => {
    const scope = String(req.query.scope || 'shared')
    const reg = new Map((await items.list(req.ctx, { kind: 'base', scope })).map((it) => [it.id, it]))
    const starred = await items.starredBy(req.user?.id)
    // лише те, що людина бачить, і без повних документів (підсумок лежить окремо)
    const list = (await bases.list(req.t, [...reg.keys()])).filter((b) => reg.has(b.id) && (!b.deleted || can(req.ctx, reg.get(b.id)).manage))
    const rows = await Promise.all(list.map(async (b) => ({ ...b, thumb: thumbs ? thumbs.url(b.id, b.version) : null, item: await view(reg.get(b.id), req, starred) })))
    res.json({ bases: rows })
  }))

  r.get('/api/bases/stream', (req, res) => hub.open(req, res))

  r.get('/api/bases/:id', wrap(async (req, res) => {
    const { b, it } = await load(req)
    res.json({ ...noted(b, req), item: await view(it, req, await items.starredBy(req.user?.id)) })
  }))

  r.get('/api/bases/:id/thumb.jpg', async (req, res, next) => {
    try {
      const { it } = await load(req, 'view', { doc: false })
      const t = thumbs && (await thumbs.ensure(id(req)))
      if (!t) return next(fail('немає такої бази', 404))
      const open = it.visibility === 'public' || it.visibility === 'link'
      res.set('cache-control', req.query.v === t.tag ? `${open ? 'public' : 'private'}, max-age=31536000, immutable` : 'no-cache')
      res.sendFile(t.file)
    } catch (e) {
      if (e.status) next(e)
      else res.status(503).set('cache-control', 'no-store').json({ error: req.t('знімок зараз недоступний') })
    }
  })

  r.get('/api/bases/:id/export', need(), wrap(async (req, res) => {
    const { b, it, c } = await load(req)
    // файл — та сама копія бази (його можна імпортувати як свою): лише тим, кому копіювати дозволено (і власникові —
    // своє вивантажити можна завжди)
    if (!it || !(rightsOf(req.ctx, it).copy || c.manage)) throw fail('вивантажувати цю базу тобі не можна: копіювати її не дозволено', 403)
    const url = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')
    res.set('cache-control', 'no-store')
    res.set('content-disposition', `attachment; filename="${exportFileName(b)}"`)
    res.type('application/json').send(JSON.stringify(exportBase(b, { url })))
  }))

  /** база з файлу: спершу перевірка (та сама, що в панелі керування); з помилками — нічого не створюємо */
  r.post('/api/bases/import', need(), wrap(async (req, res) => {
    const { doc, owner, visibility, name, dryRun } = req.body || {}
    const v = validateBase(doc, req.t)
    const out = { errors: v.errors, warnings: v.warnings, summary: v.summary }
    if (v.errors.length) return res.status(400).json({ ok: false, error: req.t('у файлі бази є помилки — нічого не створено'), ...out })
    // власник — як для нової бази: людина сама (адміністратор — будь-хто) чи гільдія, де ти щонайменше учасник
    const o = await content.ownerFor(req, owner)
    if (dryRun) return res.json({ ok: true, ...out })
    const clean = v.doc
    const nm = typeof name === 'string' ? name.replace(/<[^>]*>/g, '').trim().slice(0, 120) : ''
    if (nm) clean.ui = { ...(clean.ui || {}), name: nm }
    const b = await bases.create(clean, importNote(v.summary), req.t, req.user.id)
    const it = await items.add('base', b.id, { owner: o, visibility, by: req.user.id, ...content.H.base.meta(b.doc, req.t) })
    hub.emit(brief(b), it)
    redraw(b)
    res.status(201).json({ ok: true, id: b.id, ...out, base: { ...noted(b, req), item: await view(it, req) } })
  }))

  /** генератор баз: тексти помилок і приміток — ключі перекладу з {змінними}, мовою людини */
  r.post('/api/bases/generate', need(), wrap(async (req, res) => {
    const { params, owner, visibility } = req.body || {}
    const o = await content.ownerFor(req, owner)
    const g = generateBase(params)
    const tr = (e) => ({ ...e, text: req.t(e.text, e.vars) })
    if (!g.doc) return res.status(400).json({ ok: false, error: req.t('базу з такими параметрами не побудувати'), errors: g.errors.map(tr) })
    if (g.report.errors.length) return res.status(422).json({ ok: false, error: req.t('згенерована база порушує правила гри — її не створено'), errors: g.report.errors.map(tr) })
    const b = await bases.create(g.doc, 'Згенеровано генератором баз', req.t, req.user.id)
    const it = await items.add('base', b.id, { owner: o, visibility, by: req.user.id, ...content.H.base.meta(b.doc, req.t) })
    hub.emit(brief(b), it)
    redraw(b)
    res.status(201).json({ ...noted(b, req), item: await view(it, req), notes: g.notes.map(tr), warnings: g.report.warnings.length })
  }))

  r.post('/api/bases', need(), wrap(async (req, res) => {
    const { doc, note, owner, visibility, from, name } = req.body || {}
    const o = await content.ownerFor(req, owner)
    if (from != null) {
      // копія наявної бази: документ — з сервера, примітка — службова (українською, мовою людини її показує noteText),
      // у реєстрі — «на основі …» і лічильник копій, як у копії з бібліотеки
      const { b: src, it: sit } = await loadId(req, ID.test(String(from)) ? String(from) : '')
      if (src.deleted) throw fail('немає такої бази', 404)
      // хто й куди може копіювати — за правами бази
      const rt = rightsOf(req.ctx, sit)
      if (!rt.copy) throw fail('копіювати це власник не дозволив', 403)
      if (o.kind === 'guild' && !rt.copyTo.includes('guild')) throw fail('це можна скопіювати лише в особисте', 403)
      if (o.kind === 'user' && !rt.copyTo.includes('user')) throw fail('це можна скопіювати лише в гільдію', 403)
      const nm = typeof name === 'string' ? name.replace(/<[^>]*>/g, '').trim().slice(0, 120) : ''
      const srcName = src.doc.ui?.name || ''
      // своєї назви не дали — «Назва (копія)», «(копія 2)»… (як і копія з бібліотеки)
      const b = await bases.create({ ...src.doc, ui: { ...(src.doc.ui || {}), name: nm || (await content.copyName('base', srcName || req.t('База'), o, req.t)) } }, `Копія бази «${srcName}»`, req.t, req.user.id)
      const so = await items.owner(sit.owner_kind, sit.owner_id, req.t)
      const it = await items.add('base', b.id, { owner: o, visibility, by: req.user.id, ...content.H.base.meta(b.doc, req.t), basedOn: { kind: 'base', id: src.id, title: sit.title, owner: so.tag ? `[${so.tag}] ${so.name}` : so.name } })
      if (!(sit.owner_kind === o.kind && sit.owner_id === o.id)) await items.copied('base', src.id)
      hub.emit(brief(b), it)
      redraw(b)
      return res.status(201).json({ ...noted(b, req), item: await view(it, req) })
    }
    const b = await bases.create(doc, note, req.t, req.user.id)
    const it = await items.add('base', b.id, { owner: o, visibility, by: req.user.id, ...content.H.base.meta(b.doc, req.t) })
    hub.emit(brief(b), it)
    redraw(b)
    res.status(201).json({ ...noted(b, req), item: await view(it, req) })
  }))

  r.put('/api/bases/:id', need(), wrap(async (req, res) => {
    const { it } = await load(req, 'edit', { doc: false })
    const { doc, version, note } = req.body || {}
    if (!Number.isInteger(version)) throw fail('не вистачає версії, від якої ти редагував — онови сторінку й спробуй ще раз')
    const out = await bases.put(id(req), doc, version, note, req.t, req.user.id)
    if (!out) throw fail('немає такої бази', 404)
    if (out.conflict) return res.status(409).json({ error: req.t('хтось уже змінив цю базу'), ...noted(out, req) })
    const now = (await touch(out, req)) || it
    hub.emit(brief(out), now)
    redraw(out)
    res.json({ ...noted(out, req), item: await view(now, req) })
  }))

  /** спільні правки калькулятора бази — для всіх, хто її бачить (не нова версія документа) */
  r.put('/api/bases/:id/calc', need(), wrap(async (req, res) => {
    const { it } = await load(req, 'edit', { doc: false })
    const calc = await bases.setCalc(id(req), req.body?.calc ?? null)
    if (calc === undefined) throw fail('немає такої бази', 404)
    hub.emit({ id: id(req), op: 'calc', calc }, it)
    res.json({ ok: true, calc })
  }))

  r.delete('/api/bases/:id', need(), wrap(async (req, res) => {
    const { it } = await load(req, 'manage', { doc: false })
    const out = await bases.remove(id(req))
    hub.emit(brief(out), it)
    res.json(brief(out))
  }))

  r.post('/api/bases/:id/undelete', need(), wrap(async (req, res) => {
    const { it } = await load(req, 'manage', { doc: false })
    const out = await bases.undelete(id(req))
    hub.emit(brief(out), it)
    redraw(out)
    res.json(brief(out))
  }))

  /** стерти назавжди — лише те, що вже в кошику (база, її версії, рядок реєстру, зірки), і лише власнику (у гільдії — лідеру) */
  r.post('/api/bases/:id/purge', need(), wrap(async (req, res) => {
    const { b, it } = await load(req, 'own', { doc: false })
    if (!b.deleted) throw fail('спершу видали базу — назавжди стирається лише те, що в кошику', 409)
    await content.purge('base', b.id)
    hub.emit({ id: b.id, op: 'purge' }, it)
    res.json({ ok: true, id: b.id })
  }))

  r.get('/api/bases/:id/history', wrap(async (req, res) => {
    await load(req, 'history', { doc: false, trash: true })
    const rows = await bases.history(id(req))
    if (!rows) throw fail('немає такої бази', 404)
    const who = await authors(rows.map((h) => h.author), req)
    res.json({ rows: rows.map((h) => ({ ...noted(h, req), author: who(h.author) })) })
  }))

  r.get('/api/bases/:id/history/:hid', wrap(async (req, res) => {
    await load(req, 'history', { doc: false, trash: true })
    const h = await bases.historyDoc(id(req), Number(req.params.hid))
    if (!h) throw fail('немає такої версії', 404)
    const who = await authors([h.author], req)
    res.json({ ...noted(h, req), author: who(h.author) })
  }))

  r.post('/api/bases/:id/history/:hid/restore', need(), wrap(async (req, res) => {
    const { it } = await load(req, 'edit', { doc: false })
    const out = await bases.restore(id(req), Number(req.params.hid), req.user.id)
    if (!out) throw fail('немає такої версії', 404)
    if (out.conflict) return res.status(409).json({ error: req.t('хтось уже змінив цю базу'), ...noted(out, req) })
    const now = (await touch(out, req)) || it
    hub.emit(brief(out), now)
    redraw(out)
    res.json({ ...noted(out, req), item: await view(now, req) })
  }))

  return r
}

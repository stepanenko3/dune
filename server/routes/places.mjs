/*
 * Записи «Ресурсів»: де брати унікальні ресурси. У кожного запису — власник і видимість (реєстр речей): /api/places —
 * свої й своїх гільдій (чуже публічне — лише сторінками, нижче). Зміни розлітаються через SSE (/api/places/stream) —
 * лише тим, хто запис бачить, з самим записом у події. Тут же — чуже публічне для мапи (позначки й записи разом):
 * /api/map/public (пачками, з пошуком) і /api/map/public/shown (лише ввімкнене людиною).
 *
 * Запис: res, place, area, zone ('hagga' | 'dd' | 'city'), how, ok (перевірено в грі),
 *   pins  — точки на мапі [{ map, x, y, layout? }]; layout лише для Deep Desert: її розкладка
 *           змінюється щотижня, тож точка показується тільки на своїй розкладці;
 *   types — типи точок мапи, що підходять завжди [{ map, type }] (усі печери, усі уламки…);
 *   loot  — назва предмета з гри: мапа підсвітить контейнери, у луті яких він є.
 */
import express from 'express'
import { can } from '../lib/items.mjs'
import { rightsOf } from '../lib/roadmap-access.mjs'
import { fail, plain } from '../lib/util.mjs'
import { need, wrap } from './auth.mjs'

const LIM = { res: 160, place: 160, area: 200, zone: 16, how: 2000, loot: 120 }
/** текст поля: лише рядок чи число (об'єкт не стає «[object Object]») */
const str = (v) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const ZONES = new Set(['hagga', 'dd', 'city'])
/** регіон запису → мапи, де він є, навіть без точок (те саме, що ZONE_MAPS у src/lib/map/data.ts) */
const ZONE_MAPS = { hagga: ['survival_1'], dd: ['deepdesert_1'], city: ['sh_arrakeen', 'sh_harkovillage'] }

/**
 * Запис від людини — так само, як позначки: текст без розмітки й керівних символів, обрізаний; точки — на відомій мапі,
 * у її межах і з розкладкою лише в Глибокій пустелі (mapData.cleanPoint).
 */
function clean(body, partial, mapData) {
  const out = {}
  for (const [k, max] of Object.entries(LIM)) {
    if (!(k in body)) { if (!partial && (k === 'res' || k === 'place')) throw fail('потрібні ресурс і місце'); continue }
    out[k] = plain(str(body[k]), max, k === 'how')
  }
  if (out.zone !== undefined && !ZONES.has(out.zone)) out.zone = 'hagga'
  // і в правці: стерти назву ресурсу чи місця не можна
  if ((!partial || 'res' in out) && !out.res) throw fail('потрібні ресурс і місце')
  if ((!partial || 'place' in out) && !out.place) throw fail('потрібні ресурс і місце')
  if ('ok' in body) out.ok = !!body.ok
  if ('pins' in body) {
    if (!Array.isArray(body.pins) || body.pins.length > 60) throw fail('на мапі можна позначити не більше {max} точок', 400, { max: 60 })
    out.pins = body.pins.map((p) => {
      const pin = mapData.cleanPoint(p)
      const label = plain(str(p.label), 120)
      if (label) pin.label = label
      return pin
    })
  }
  if ('types' in body) {
    if (!Array.isArray(body.types) || body.types.length > 20) throw fail('забагато типів точок — не більше {max}', 400, { max: 20 })
    const maps = new Set(mapData.source.maps.map((m) => m.id))
    out.types = body.types.map((t) => {
      if (!maps.has(t?.map) || typeof t.type !== 'string' || !/^[a-z0-9_]{1,64}$/.test(t.type)) throw fail('хибний тип точок на мапі')
      return { map: t.map, type: t.type }
    })
  }
  return out
}

export function createPlacesRoutes({ places, mapData, items, content, hub }) {
  const r = express.Router()
  const load = async (req, right = 'view') => {
    const row = await places.get(req.params.id)
    const it = row && (await items.get('place', row.id))
    // змінювати — за правами самого запису (вікно «Доступ»); решта — за власником
    const c = it ? { ...can(req.ctx, it), edit: rightsOf(req.ctx, it).edit } : can(req.ctx, it)
    if (!row || !c.view) throw fail('немає такого запису', 404)
    if (!c[right]) throw right === 'edit' ? fail('змінювати цей запис тобі не можна', 403) : fail('видаляти може лише власник (у гільдії — офіцер чи лідер)', 403)
    return { row, it }
  }
  const out = async (row, it, ctx) => ({ ...row, item: await items.view(it, ctx) })

  // моє й моїх гільдій (scope: shared, mine, guild:<id>); усе публічне разом не віддаємо — воно сторінками в /api/map/public
  r.get('/api/places', wrap(async (req, res) => {
    const seen = new Map()
    for (const s of String(req.query.scope || 'shared').split(',').slice(0, 3)) {
      if (s === 'public') continue
      for (const it of await items.list(req.ctx, { kind: 'place', scope: s })) seen.set(it.id, it)
    }
    // лише ці записи, а не всі записи всіх людей
    const rows = await places.many([...seen.keys()])
    res.json({ rows: await Promise.all(rows.map((p) => out(p, seen.get(p.id), req.ctx))) })
  }))

  r.get('/api/places/stream', (req, res) => hub.open(req, res))

  // один запис (посилання /map?r=… на чужий публічний чи «за посиланням»)
  r.get('/api/places/:id', wrap(async (req, res) => {
    const { row, it } = await load(req)
    res.json(await out(row, it, req.ctx))
  }))

  // ---------- публічні позначки й записи ресурсів інших: список пачками і те, що людина ввімкнула на мапі ----------
  // Усіх публічних разом клієнт не тягне й не малює (сотні людей × десятки позначок): список — сторінками з пошуком,
  // на мапі — лише вибрані речі чи все від вибраних авторів.
  const MAX_PAGE = 50
  const ALL = '*'
  /** на яких мапах річ: позначка — на своїй, запис — де його точки, типи точок і мапи його регіону */
  const mapsOf = (kind, d) => (kind === 'marker' ? [d.map] : [...new Set([...(d.pins || []).map((p) => p.map), ...(d.types || []).map((t) => t.map), ...(ZONE_MAPS[d.zone] || [])])])
  /**
   * Покажчик усього публічного (позначки й записи): документи — з кешем за датою зміни в реєстрі (кожна зміна документа
   * її оновлює), розкладені за мапами. Щоразу — лише список з реєстру (два запити); документи читаються й розбираються
   * лише нові чи змінені, а покажчик перебудовується, лише коли щось змінилось (річ додали, змінили, сховали, передали).
   * Порядок — коли річ стала публічною: правки не «підіймають» її нагору.
   */
  let entries = new Map()
  let index = null
  async function publicIndex() {
    const rows = []
    for (const k of ['marker', 'place']) rows.push(...(await items.list(null, { kind: k, scope: 'public' })))
    rows.sort((a, b) => (b.published || b.created) - (a.published || a.created) || b.created - a.created || (a.id < b.id ? 1 : -1))
    const sig = rows.map((it) => `${it.kind}:${it.id}:${it.updated}:${it.owner_kind}:${it.owner_id}:${it.published}`).join('|')
    if (index?.sig === sig) return index
    const next = new Map()
    await Promise.all(rows.map(async (it) => {
      const k = `${it.kind}:${it.id}`
      let e = entries.get(k)
      if (!e || e.it.updated !== it.updated) {
        const doc = await content.H[it.kind].read(it.id)
        e = doc && { doc, maps: mapsOf(it.kind, doc) }
      }
      if (e) next.set(k, { doc: e.doc, maps: e.maps, it })
    }))
    entries = next
    const list = [], byMap = new Map([[ALL, list]])
    for (const it of rows) {
      const x = next.get(`${it.kind}:${it.id}`)
      if (!x) continue
      list.push(x)
      for (const m of x.maps) {
        if (!byMap.has(m)) byMap.set(m, [])
        byMap.get(m).push(x)
      }
    }
    index = { sig, list, byMap, byKey: next }
    return index
  }
  // імена авторів для пошуку — на хвилину
  const owners = new Map()
  const ownerOf = async (kind, id) => {
    const k = `${kind}:${id}`, c = owners.get(k)
    if (c && Date.now() - c.t < 60_000) return c.o
    const o = await items.owner(kind, id)
    owners.set(k, { t: Date.now(), o })
    if (owners.size > 5000) owners.delete(owners.keys().next().value)
    return o
  }
  const ownKey = (s) => {
    const m = /^(user|guild):([\w-]{1,64})$/.exec(String(s))
    return m ? { kind: m[1], id: m[2] } : null
  }
  const rowOut = async ({ it, doc }, ctx) => ({ ...doc, id: it.id, created: it.created, updated: it.updated, item: await items.view(it, ctx) })

  // GET /api/map/public?map=&q=&kind=marker|place&owner=user:<id>&offset=&limit= — чуже публічне, найновіше згори;
  // q — за назвою, описом і автором (ім'я, логін, тег гільдії); своє й своїх гільдій сюди не потрапляє (воно й так на мапі)
  r.get('/api/map/public', wrap(async (req, res) => {
    const kind = ['marker', 'place'].includes(req.query.kind) ? req.query.kind : null
    const map = req.query.map ? String(req.query.map) : null
    const by = req.query.owner ? ownKey(req.query.owner) : null
    const words = String(req.query.q || '').toLowerCase().slice(0, 80).split(/\s+/).filter(Boolean)
    const offset = Math.max(0, Math.floor(Number(req.query.offset)) || 0)
    const limit = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(req.query.limit)) || 20))
    const u = req.ctx.user
    const own = (it) => (it.owner_kind === 'user' && it.owner_id === u?.id) || (it.owner_kind === 'guild' && req.ctx.ranks.has(it.owner_id))
    // лише те, що на цій мапі (покажчик за мапами), а не все публічне
    const pool = ((await publicIndex()).byMap.get(map ?? ALL) || []).filter(({ it }) => (!kind || it.kind === kind) && !own(it) && (!by || (it.owner_kind === by.kind && it.owner_id === by.id)))
    let hits = pool
    if (words.length) {
      // автори кандидатів — разом (і з кешем), а не по одному в циклі
      const names = new Map()
      await Promise.all([...new Set(pool.map(({ it }) => `${it.owner_kind}:${it.owner_id}`))].map(async (k) => {
        const [ok, ...rest] = k.split(':')
        names.set(k, await ownerOf(ok, rest.join(':')))
      }))
      hits = pool.filter(({ it }) => {
        const o = names.get(`${it.owner_kind}:${it.owner_id}`) || {}
        const hay = [it.title, it.summary, o.name, o.login, o.tag].filter(Boolean).join(' ').toLowerCase()
        return words.every((w) => hay.includes(w))
      })
    }
    const rows = await Promise.all(hits.slice(offset, offset + limit).map((x) => rowOut(x, req.ctx)))
    res.json({ rows, total: hits.length, offset, limit })
  }))

  // GET /api/map/public/shown?ids=marker:<id>,place:<id>&owners=user:<id>,guild:<id>&map= — що людина ввімкнула на мапі:
  // окремі речі (будь-які, які їй видно) і все публічне від вибраних авторів
  r.get('/api/map/public/shown', wrap(async (req, res) => {
    const map = req.query.map ? String(req.query.map) : null
    const ids = [...new Set(String(req.query.ids || '').split(',').filter((s) => /^(marker|place):[\w-]{1,64}$/.test(s)))].slice(0, 200)
    const follow = String(req.query.owners || '').split(',').map(ownKey).filter(Boolean).slice(0, 50)
    const idx = await publicIndex()
    const here = (x) => !map || x.maps.includes(map)
    const seen = new Map()
    // публічне — з покажчика; решта («за посиланням», своє, гільдійське) — з реєстру, разом
    const rest = []
    for (const s of ids) {
      const x = idx.byKey.get(s)
      if (x) { if (here(x)) seen.set(s, x) } else rest.push(s)
    }
    const found = await Promise.all(rest.map(async (s) => {
      const [kind, id] = s.split(':')
      const it = await items.get(kind, id)
      if (!it || !can(req.ctx, it).view) return null
      const doc = await content.H[kind].read(id)
      return doc && [s, { it, doc, maps: mapsOf(kind, doc) }]
    }))
    for (const f of found) if (f && here(f[1])) seen.set(f[0], f[1])
    if (follow.length) {
      const keys = new Set(follow.map((o) => `${o.kind}:${o.id}`))
      for (const x of idx.byMap.get(map ?? ALL) || []) {
        if (seen.size >= 1000) break
        if (keys.has(`${x.it.owner_kind}:${x.it.owner_id}`)) seen.set(`${x.it.kind}:${x.it.id}`, x)
      }
    }
    res.json({ rows: await Promise.all([...seen.values()].map((x) => rowOut(x, req.ctx))) })
  }))

  r.post('/api/places', need(), wrap(async (req, res) => {
    const { owner, visibility, ...body } = req.body || {}
    const o = await content.ownerFor(req, owner)
    const doc = clean(body, false, mapData)
    const row = await places.add({ ok: false, zone: 'hagga', area: '', how: '', pins: [], types: [], loot: '', ...doc })
    const it = await items.add('place', row.id, { owner: o, visibility, by: req.user.id, ...content.H.place.meta(row, req.t) })
    hub.emit({ op: 'put', row: await out(row, it, null) }, it)
    res.status(201).json(await out(row, it, req.ctx))
  }))

  r.patch('/api/places/:id', need(), wrap(async (req, res) => {
    const { it } = await load(req, 'edit')
    const { owner, visibility, item, base, addPins, ...body } = req.body || {}
    const extra = Array.isArray(addPins) ? clean({ pins: addPins }, true, mapData).pins : null
    const row = await places.patch(req.params.id, clean(body, true, mapData), { base: Number.isFinite(base) ? base : null, addPins: extra })
    if (!row) throw fail('немає такого запису', 404)
    if (row.conflict) { const { conflict, ...fresh } = row; return res.status(409).json({ error: req.t('цей запис щойно змінили — ось його нова версія'), row: await out(fresh, it, req.ctx) }) }
    const now = (await items.touch('place', row.id, content.H.place.meta(row, req.t))) || it
    hub.emit({ op: 'put', row: await out(row, now, null) }, now)
    res.json(await out(row, now, req.ctx))
  }))

  r.delete('/api/places/:id', need(), wrap(async (req, res) => {
    const { row, it } = await load(req, 'manage')
    await content.purge('place', row.id)
    hub.emit({ op: 'del', id: row.id }, it)
    res.json({ ok: true })
  }))

  return r
}

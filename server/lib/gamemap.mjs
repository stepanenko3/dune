/*
 * Мапа з файлів гри (план 5b): точки (розділ markers), типи міток (markerTypes) і розклад розкладок Глибокої пустелі
 * (ddLayouts) реєстр застосовує сюди, а мапа сайту бере їх у тій самій формі, що й дані TH.GL (lib/thgl.mjs): групи й
 * типи з іконками у спрайті, точки за типами, назви мовою. Тайли й межі мап — з TH.GL (у серверних файлах пікселів нема).
 * Групи — категорії легенди мапи гри (Місцевість, NPC…; тип без категорії — за тегом мітки MapMarkers.*), лут, ключі
 * пентащита й ресурси — своїми групами; на свіжій мапі
 * увімкнені місця (статичні мітки). Іконки — текстури гри: файли awakening.wiki з тими самими іменами (як і картинки
 * будівель), спрайт складає сервер (sharp) і тримає на диску; лут — іконкою мітки луту гри (LootContainer).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { wikiFile } from './gamedata/apply.mjs'

const CELL = 64
const PER_ROW = 16
/** іконка не завантажилась — наступна спроба не раніше, ніж за стільки */
const RETRY_MS = 10 * 60_000
const DAY = 86_400_000

/** поточна розкладка ГП за розкладом гри: тиждень від старту циклу → сід (по колу) → номер розкладки */
export function currentLayout(blob, now = Date.now()) {
  if (!blob?.seeds?.length || !blob.cycleDays) return null
  const week = Math.floor((now - Date.parse(blob.cycleStart)) / (blob.cycleDays * DAY))
  if (!(week >= 0)) return null
  return blob.layouts?.[blob.seeds[week % blob.seeds.length]] ?? null
}

async function fetchWiki(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Sandwalkers/2' }, signal: AbortSignal.timeout(15_000) })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return Buffer.from(await r.arrayBuffer())
}

const groupOfTag = (tag) => (tag ? tag.split('.').slice(0, 3).join('.') : 'MapMarkers.Other')

/** іконки тягнемо по стільки водночас і не довше за стільки разом (вікі лягла — мапа не чекає хвилинами) */
const FETCH_AT_ONCE = 6
const FETCH_DEADLINE = 60_000

export async function createGameMap({ db, mapData, dataDir, fetchIcon = fetchWiki, now = Date.now }) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS game_map_points (id TEXT PRIMARY KEY, part TEXT NOT NULL, map TEXT NOT NULL, layout INTEGER, kind TEXT NOT NULL,
      type TEXT NOT NULL, name TEXT, x BIGINT NOT NULL, y BIGINT NOT NULL, z BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS game_map_points_map ON game_map_points (map, layout, type);
    CREATE TABLE IF NOT EXISTS game_marker_types (id TEXT PRIMARY KEY, tag TEXT, icon TEXT, static INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS game_map_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`)
  await db.addColumn('game_marker_types', 'legend', 'TEXT')
  const dir = path.join(dataDir, 'map')
  // групи й спрайт (обіцянка: одночасні запити чекають ту саму збірку), точки мап (без мови) і назви мовою
  let cache = null
  const ptsCache = new Map()
  const reset = () => { cache = null; ptsCache.clear() }
  // є точки з файлів гри — прапорець у пам'яті (не рахуємо таблицю на кожен запит мапи)
  let hasPoints = Number((await db.get('SELECT COUNT(*) AS n FROM (SELECT 1 FROM game_map_points LIMIT 1) t')).n) > 0
  // записи таблиці точок — по черзі (перевірка за розкладом і адмінська разом не стикаються ключами)
  let writing = Promise.resolve()
  const serial = (fn) => { const p = writing.then(fn); writing = p.catch(() => {}); return p }

  /** part — 'markers' (місця, лут, ключі) чи 'resources' (точки ресурсів): замінює лише свою частину */
  const setPoints = (records, part) => serial(async () => {
    await db.tx(async (t) => {
      await t.run('DELETE FROM game_map_points WHERE part = ?', part)
      // пачками: сотні тисяч точок ресурсів — не сотні тисяч запитів
      for (let i = 0; i < records.length; i += 500) {
        const chunk = records.slice(i, i + 500)
        await t.run(`INSERT INTO game_map_points (id, part, map, layout, kind, type, name, x, y, z) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
          ...chunk.flatMap((r) => [`${part}:${r.id}`, part, r.map, r.layout ?? null, r.kind ?? 'marker', r.type, r.name ?? null, r.x, r.y, r.z ?? 0]))
      }
    })
    hasPoints = Number((await db.get('SELECT COUNT(*) AS n FROM (SELECT 1 FROM game_map_points LIMIT 1) t')).n) > 0
    reset()
  })
  async function setTypes(records) {
    await db.tx(async (t) => {
      await t.run('DELETE FROM game_marker_types')
      for (const r of records) await t.run('INSERT INTO game_marker_types (id, tag, icon, static, legend) VALUES (?, ?, ?, ?, ?)', r.id, r.tag ?? null, r.icon ?? null, r.static ? 1 : 0, r.legend ?? null)
    })
    reset()
  }
  async function setSchedule(blob) {
    await db.run('INSERT INTO game_map_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', 'ddLayouts', JSON.stringify(blob))
    reset()
  }
  const schedule = async () => { const r = await db.get("SELECT v FROM game_map_meta WHERE k = 'ddLayouts'"); return r ? JSON.parse(r.v) : null }
  /** є точки з файлів гри (без них мапа з гри порожня — тоді лишається TH.GL) */
  const ready = async () => hasPoints

  /**
   * групи й типи (з іконками у спрайті) — з того, що реально є серед точок. Одночасні запити чекають ту саму збірку;
   * спрайт без частини іконок (вікі не відповіла) — лише до повторної спроби
   */
  function build() {
    if (cache && !(cache.expires && now() > cache.expires)) return cache.promise
    const promise = make().catch((e) => { cache = null; throw e })
    cache = { promise, expires: null }
    promise.then((v) => { if (cache?.promise === promise && v.partial) cache.expires = now() + RETRY_MS }).catch(() => {})
    return promise
  }
  async function make() {
    const types = new Map((await db.all('SELECT * FROM game_marker_types')).map((r) => [r.id, r]))
    const used = await db.all('SELECT kind, type, COUNT(*) AS n FROM game_map_points GROUP BY kind, type ORDER BY kind, type')
    const groups = new Map()
    const OFF = new Set(['loot', 'keys', 'resources'])
    const add = (gid, t) => {
      if (!groups.has(gid)) groups.set(gid, { id: gid, defaultOn: !OFF.has(gid), types: [] })
      const g = groups.get(gid)
      if (!g.types.some((x) => x.id === t.id)) g.types.push(t)
    }
    // ресурси — основні (core) й додаткові (aux) точки групи гри: один тип
    const order = { marker: 0, loot: 1, key: 2, core: 3, aux: 3 }
    for (const u of used.sort((a, b) => (order[a.kind] ?? 4) - (order[b.kind] ?? 4))) {
      const mt = types.get(u.type)
      if (u.kind === 'marker') add(mt?.legend ?? groupOfTag(mt?.tag), { id: u.type, icon: mt?.icon ?? null, size: 2, on: !!mt?.static })
      else if (u.kind === 'loot') add('loot', { id: u.type, icon: types.get('LootContainer')?.icon ?? null, size: 1.3, on: false })
      else if (u.kind === 'key') add('keys', { id: u.type, icon: null, size: 1.5, on: false })
      else add('resources', { id: u.type, icon: null, size: 1, on: false })
    }
    const list = [...groups.values()]
    // спрайт: кожна текстура — раз, у порядку появи
    const textures = [...new Set(list.flatMap((g) => g.types.map((t) => t.icon)).filter(Boolean))]
    const sprite = await spriteOf(textures)
    for (const g of list) for (const t of g.types) t.icon = sprite.rects[t.icon] ?? null
    return { groups: list, sprite: sprite.buf, spriteHash: sprite.hash, partial: sprite.partial }
  }

  /**
   * спрайт: кожна текстура — у сталій клітинці (за порядком у списку), тож іконка, що не завантажилась, лишає порожню
   * клітинку, а не зсуває решту; версія — хеш самого зображення
   */
  async function spriteOf(textures) {
    const key = createHash('sha256').update(textures.join('\n')).digest('hex').slice(0, 16)
    const file = path.join(dir, `game-icons-${key}.webp`)
    const meta = file.replace(/\.webp$/, '.json')
    const hashOf = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16)
    try { const buf = fs.readFileSync(file); return { buf, rects: JSON.parse(fs.readFileSync(meta, 'utf8')), hash: hashOf(buf), partial: false } } catch { /* ще нема — складаємо */ }
    const deadline = now() + FETCH_DEADLINE
    const imgs = new Array(textures.length).fill(null)
    let next = 0
    const worker = async () => {
      while (next < textures.length) {
        const i = next++
        if (now() > deadline) continue
        try { imgs[i] = await sharp(await fetchIcon(wikiFile(textures[i]))).resize(CELL, CELL, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() } catch { /* без цієї іконки — до повторної спроби */ }
      }
    }
    await Promise.all(Array.from({ length: FETCH_AT_ONCE }, worker))
    const rects = {}
    const comp = []
    textures.forEach((tex, i) => {
      if (!imgs[i]) return
      const left = (i % PER_ROW) * CELL, top = Math.floor(i / PER_ROW) * CELL
      rects[tex] = [left, top, CELL, CELL]
      comp.push({ input: imgs[i], left, top })
    })
    const W = Math.max(1, Math.min(textures.length, PER_ROW)) * CELL, H = Math.max(1, Math.ceil(textures.length / PER_ROW)) * CELL
    const buf = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comp).webp({ lossless: true }).toBuffer()
    const partial = imgs.some((x) => !x)
    // повний набір — на диск (наступні запуски не тягнуть іконки знову); неповний — лише в пам'ять до повторної спроби
    if (!partial) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, buf); fs.writeFileSync(meta, JSON.stringify(rects)) }
    return { buf, rects, hash: hashOf(buf), partial }
  }

  /** опис мап (тайли й межі — TH.GL; поточна розкладка ГП — з розкладу гри, якщо для неї є тайли) і групи гри */
  async function source() {
    const s = mapData.source
    const { groups, spriteHash } = await build()
    const cur = currentLayout(await schedule())
    const maps = (s?.maps ?? []).map((m) => (m.layouts?.length && cur != null && m.layouts.some((l) => l.id === cur) ? { ...m, layout: cur } : m))
    return { syncedAt: s?.syncedAt ?? null, maps, groups, sprite: `/api/map/icons.webp?v=${spriteHash}` }
  }

  async function texts(lang, kind) {
    return new Map((await db.all('SELECT id, name FROM game_texts WHERE kind = ? AND lang = ?', kind, lang)).map((r) => [r.id, r.name]))
  }
  /** назви: мапи — з TH.GL (лише вони: типи й групи — свої), типи — переклад гри (нема — англійською), групи — категорія легенди гри чи частина тегу */
  async function labels(lang = 'uk') {
    const th = await mapData.labels(lang)
    const out = Object.fromEntries((mapData.source?.maps ?? []).filter((m) => th[m.id]).map((m) => [m.id, th[m.id]]))
    const [loc, en, gl, ge] = await Promise.all([texts(lang, 'markerType'), texts('en', 'markerType'), texts(lang, 'legend'), texts('en', 'legend')])
    const { groups } = await build()
    for (const g of groups) {
      if (gl.has(g.id) || ge.has(g.id)) out[g.id] = { loc: gl.get(g.id) ?? ge.get(g.id) ?? null, en: ge.get(g.id) ?? null, uk: lang === 'uk' ? gl.get(g.id) ?? null : null }
      else if (g.id.startsWith('MapMarkers.')) out[g.id] = { loc: null, en: g.id.split('.').slice(1).join(' · '), uk: null }
      for (const t of g.types) out[t.id] = { loc: loc.get(t.id) ?? en.get(t.id) ?? null, en: en.get(t.id) ?? null, uk: lang === 'uk' ? loc.get(t.id) ?? null : null }
    }
    // різні типи з однаковою назвою (гра всіх представників Домів чи тренерів зве однаково, розрізняє іконкою) — з
    // уточненням: частина id після спільного початку («Тренер (Mentat)»)
    for (const k of ['loc', 'en', 'uk']) {
      const same = new Map()
      for (const g of groups) for (const t of g.types) { const v = out[t.id]?.[k]; if (v) { if (!same.has(v)) same.set(v, []); same.get(v).push(t.id) } }
      for (const [v, ids] of same) {
        if (ids.length < 2) continue
        let p = 0
        while (ids.every((id) => id[p] === ids[0][p]) && p < ids[0].length) p++
        // межа — початок слова id (CamelCase): «Alexin», а не «lexin»
        while (p > 0 && !/[A-Z0-9_]/.test(ids[0][p] ?? '')) p--
        for (const id of ids) if (id.slice(p)) out[id][k] = `${v} (${id.slice(p)})`
      }
    }
    return out
  }

  /**
   * точки мапи мовою: types[тип] = { pts: [x, y, z…], info: { i: [назва, null, назва англ., null] } }. Самі точки
   * (сотні тисяч ресурсів) — одна копія на мапу й розкладку (обіцянка: одночасні запити чекають той самий запит до
   * бази), мовою — лише назви місць поверх
   */
  async function points(mapId, layoutId, lang = 'uk') {
    const map = mapData.source?.maps.find((m) => m.id === mapId)
    if (!map) return null
    const layout = map.layouts?.length ? layoutId ?? currentLayout(await schedule()) ?? map.layout : null
    const memo = (key, fn) => {
      if (!ptsCache.has(key)) {
        if (ptsCache.size > 64) ptsCache.clear()
        ptsCache.set(key, fn().catch((e) => { ptsCache.delete(key); throw e }))
      }
      return ptsCache.get(key)
    }
    const base = await memo(`${mapId}|${layout}`, async () => {
      const rows = await db.all(`SELECT type, name, x, y, z FROM game_map_points WHERE map = ? AND ${layout == null ? 'layout IS NULL' : 'layout = ?'}`, mapId, ...(layout == null ? [] : [layout]))
      const types = {}
      for (const r of rows) {
        const T = (types[r.type] ||= { pts: [], names: {} })
        if (r.name) T.names[T.pts.length / 3] = r.name
        T.pts.push(Number(r.x), Number(r.y), Number(r.z))
      }
      return types
    })
    return memo(`${mapId}|${layout}|${lang}`, async () => {
      const [loc, en] = await Promise.all([texts(lang, 'place'), texts('en', 'place')])
      const types = {}
      for (const [type, T] of Object.entries(base)) {
        const info = {}
        for (const [i, k] of Object.entries(T.names)) if (loc.has(k) || en.has(k)) info[i] = [loc.get(k) ?? en.get(k) ?? null, null, en.get(k) ?? null, null]
        types[type] = { pts: T.pts, info }
      }
      return { map: mapId, layout, types }
    })
  }

  const sprite = async () => { const b = await build(); return { buf: b.sprite, hash: b.spriteHash } }
  const icons = async () => (await sprite()).buf

  return { setPoints, setTypes, setSchedule, schedule, ready, source, labels, points, icons, sprite, invalidate: reset }
}

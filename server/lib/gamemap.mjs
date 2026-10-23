/*
 * Мапа з файлів гри (план 5b): точки (розділ markers), типи міток (markerTypes) і розклад розкладок Глибокої пустелі
 * (ddLayouts) реєстр застосовує сюди, а мапа сайту бере їх у тій самій формі, що й дані TH.GL (lib/thgl.mjs): групи й
 * типи з іконками у спрайті, точки за типами, назви мовою. Тайли й межі мап — з TH.GL (у серверних файлах пікселів нема).
 * Групи — категорії легенди мапи гри (Місцевість, NPC, Ресурси…; тип без категорії — за тегом мітки MapMarkers.*), лут,
 * ключі пентащита й іменовані NPC (за фракцією) — своїми групами; на свіжій мапі увімкнені місця (статичні мітки) і NPC.
 * Іконки — текстури гри (файли awakening.wiki з тими самими іменами, як і картинки будівель), складені за рецептом гри
 * (DT_IconPreset: фон і гліф, їхні тони й розміри — так гра малює мітку); спрайт складає сервер (sharp) і тримає на
 * диску; лут — мітка луту гри (LootContainer), NPC — іконка фракції, ключ — гліф ключа-коду в кольорі ключа.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { wikiFile } from './gamedata/apply.mjs'

const gunzip = promisify(zlib.gunzip)
/** рядок → стале число [0, 1) (FNV-1a): жереб руди місця */
function unit(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  // перемішати біти (сусідні ключі місць різняться лише кількома цифрами)
  h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b) >>> 0; h ^= h >>> 16
  return (h >>> 0) / 0x100000000
}
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

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

/** t(мова, ключ) — переклад сайту (позначки луту з умовою гравця) */
export async function createGameMap({ db, mapData, dataDir, fetchIcon = fetchWiki, now = Date.now, readFile = (f) => fs.promises.readFile(f), t = (lang, k) => k }) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS game_map_points (id TEXT PRIMARY KEY, part TEXT NOT NULL, map TEXT NOT NULL, layout INTEGER, kind TEXT NOT NULL,
      type TEXT NOT NULL, name TEXT, x BIGINT NOT NULL, y BIGINT NOT NULL, z BIGINT NOT NULL);
    CREATE INDEX IF NOT EXISTS game_map_points_map ON game_map_points (map, layout, type);
    CREATE TABLE IF NOT EXISTS game_marker_types (id TEXT PRIMARY KEY, tag TEXT, icon TEXT, static INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS game_map_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`)
  await db.addColumn('game_marker_types', 'legend', 'TEXT')
  // вид типу (npc, key; мітка — null), колір ключа, рецепт іконки гри (JSON)
  await db.addColumn('game_marker_types', 'kind', 'TEXT')
  await db.addColumn('game_marker_types', 'color', 'TEXT')
  await db.addColumn('game_marker_types', 'look', 'TEXT')
  // вага руди в точці ресурсу (значення карти тепла гри): яка руда може з'явитися на місці
  await db.addColumn('game_map_points', 'weight', 'INTEGER')
  // лут контейнера (JSON [[предмет, шанс %, середня кількість]]) — з таблиць луту гри
  await db.addColumn('game_map_points', 'loot', 'TEXT')
  const dir = path.join(dataDir, 'map')
  // групи й спрайт (обіцянка: одночасні запити чекають ту саму збірку), точки мап (без мови) і назви мовою
  let cache = null
  const ptsCache = new Map()
  // контейнери з лутом усіх мап (для «де випадає»): кілька тисяч рядків — у пам'яті до нових даних
  let lootRows = null
  const reset = () => { cache = null; ptsCache.clear(); lootRows = null }
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
        await t.run(`INSERT INTO game_map_points (id, part, map, layout, kind, type, name, x, y, z, weight, loot) VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
          ...chunk.flatMap((r) => [`${part}:${r.id}`, part, r.map, r.layout ?? null, r.kind ?? 'marker', r.type, r.name ?? null, r.x, r.y, r.z ?? 0, r.weight ?? null, r.loot?.length ? JSON.stringify(r.loot) : null]))
      }
    })
    hasPoints = Number((await db.get('SELECT COUNT(*) AS n FROM (SELECT 1 FROM game_map_points LIMIT 1) t')).n) > 0
    reset()
  })
  async function setTypes(records) {
    await db.tx(async (t) => {
      await t.run('DELETE FROM game_marker_types')
      for (const r of records) {
        await t.run('INSERT INTO game_marker_types (id, tag, icon, static, legend, kind, color, look) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          r.id, r.tag ?? null, r.icon ?? null, r.static ? 1 : 0, r.legend ?? null, r.kind ?? null, r.color ?? null, r.look ? JSON.stringify(r.look) : null)
      }
    })
    reset()
  }
  async function setSchedule(blob) {
    await db.run('INSERT INTO game_map_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', 'ddLayouts', JSON.stringify(blob))
    reset()
  }
  const schedule = async () => { const r = await db.get("SELECT v FROM game_map_meta WHERE k = 'ddLayouts'"); return r ? JSON.parse(r.v) : null }

  /**
   * ресурси Глибокої пустелі: файл на розкладку (сотні тисяч точок — не рядки таблиці). Файли — у теці сайту (пакет
   * видобувача може зникнути), у meta — які файли й які типи в них (для груп мапи)
   */
  const ddDir = path.join(dir, 'dd')
  // типи кожної розкладки — з переліку (файли не розпаковуємо); запис — без блокування сервера
  const setDdResources = (blob, files) => serial(async () => {
    await fs.promises.mkdir(ddDir, { recursive: true })
    const layouts = {}, types = {}
    for (const [k, l] of Object.entries(blob?.layouts ?? {})) {
      const file = `${k}-${String(l.hash ?? 'x').slice(0, 16)}.json.gz`
      const full = path.join(ddDir, file)
      if (!fs.existsSync(full)) { await fs.promises.writeFile(full + '.tmp', files(k)); await fs.promises.rename(full + '.tmp', full) }
      for (const [t, kind] of Object.entries(l.types ?? {})) types[t] = kind
      layouts[k] = { file }
    }
    await db.run('INSERT INTO game_map_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', 'ddResources', JSON.stringify({ layouts, types }))
    reset()
    const keep = new Set(Object.values(layouts).map((l) => l.file))
    for (const f of await fs.promises.readdir(ddDir)) if (!keep.has(f)) await fs.promises.rm(path.join(ddDir, f), { force: true })
  })
  const ddMeta = async () => { const r = await db.get("SELECT v FROM game_map_meta WHERE k = 'ddResources'"); return r ? JSON.parse(r.v) : { layouts: {}, types: {} } }
  /**
   * файлу розкладки нема (нова тека даних, копія бази) — перелік геть, а розділ реєстру — на повтор (інакше реєстр
   * вважав би його незмінним і не застосував би знову)
   */
  async function ddLost() {
    await db.run("DELETE FROM game_map_meta WHERE k = 'ddResources'")
    await db.run("UPDATE gamedata_sections SET content = NULL WHERE section = 'ddResources'").catch(() => {})
    reset()
  }
  { const m = await ddMeta(); if (Object.values(m.layouts).some((l) => !fs.existsSync(path.join(ddDir, l.file)))) await ddLost() }
  // розкладки ГП важкі (сотні тисяч точок): у пам'яті лише 2 останні (разом із їхніми назвами мовами)
  let ddOrder = []
  const ddTouch = (layout) => {
    ddOrder = [...ddOrder.filter((x) => x !== layout), layout]
    while (ddOrder.length > 2) {
      const old = ddOrder.shift()
      for (const k of [...ptsCache.keys()]) if (k === `deepdesert_1|${old}` || k.startsWith(`deepdesert_1|${old}|`)) ptsCache.delete(k)
    }
  }
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
    // типи ресурсів Глибокої пустелі — з файлів розкладок
    for (const [type, kind] of Object.entries((await ddMeta()).types)) if (!used.some((u) => u.type === type)) used.push({ kind, type, n: 0 })
    const groups = new Map()
    const OFF = new Set(['loot', 'keys', 'resourcePoints', 'cutteray', 'hand', 'plants'])
    // іконка типу — рецепт: текстура гліфа й вигляд гри (нема вигляду — сама текстура)
    const look = (r) => (r?.icon ? { icon: r.icon, look: r.look ? JSON.parse(r.look) : null } : null)
    const add = (gid, t) => {
      if (!groups.has(gid)) groups.set(gid, { id: gid, defaultOn: !OFF.has(gid), types: [] })
      const g = groups.get(gid)
      if (!g.types.some((x) => x.id === t.id)) g.types.push(t)
    }
    // ресурси — основні (core) й додаткові (aux) точки групи гри: один тип
    const order = { marker: 0, npc: 1, loot: 2, key: 3, core: 4, aux: 4 }
    // категорія легенди гри для персонажів (торговці, тренери): іменовані NPC — туди ж, а не другою групою «NPC»
    const tally = new Map()
    for (const t of types.values()) if (t.legend && t.tag?.startsWith('MapMarkers.Characters')) tally.set(t.legend, (tally.get(t.legend) ?? 0) + 1)
    const npcGroup = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'npcs'
    /**
     * ресурси: поля меланжу — у своїй категорії легенди гри (клієнт виносить їх окремим блоком); борошнистий пісок та
     * інші ущільнені поля — з рудою; рослини (тег Foliage) — збір руками; інша руда й брухт — основні точки (core)
     * видобувають різопроменем, додаткові (aux) підбирають руками
     */
    const resGroup = (mt, kind) => {
      if (mt.tag?.startsWith('MapMarkers.Resource.Compacted.Spice')) return mt.legend ?? groupOfTag(mt.tag)
      // борошнистий пісок й інші ущільнені поля — ресурс, як і руда різопроменем
      if (mt.tag?.startsWith('MapMarkers.Resource.Compacted')) return 'cutteray'
      if (mt.tag === 'MapMarkers.Resource.Node.Foliage') return 'plants'
      return kind === 'aux' ? 'hand' : 'cutteray'
    }
    // вид точок ресурсу (основні чи додаткові) — за більшістю точок типу на всіх мапах: тип — в одній групі (брухт-підбирання
    // буває й основною точкою, рідко)
    const most = new Map()
    for (const u of used) {
      if (u.kind !== 'core' && u.kind !== 'aux') continue
      const c = most.get(u.type) ?? { core: 0, aux: 0, first: u.kind }
      c[u.kind] += Number(u.n)
      most.set(u.type, c)
    }
    const kindOf = (type) => { const c = most.get(type); return !c ? null : c.core === c.aux ? c.first : c.core > c.aux ? 'core' : 'aux' }
    for (const u of used.sort((a, b) => (order[a.kind] ?? 5) - (order[b.kind] ?? 5))) {
      const mt = types.get(u.type)
      if (u.kind === 'marker' && mt?.tag?.startsWith('MapMarkers.Resource')) add(resGroup(mt, 'core'), { id: u.type, icon: look(mt), size: 1.6, on: false })
      else if (u.kind === 'marker') add(mt?.legend ?? groupOfTag(mt?.tag), { id: u.type, icon: look(mt), size: 2, on: !!mt?.static })
      else if (u.kind === 'npc') add(npcGroup, { id: u.type, icon: look(mt), size: 1.6, on: true })
      else if (u.kind === 'loot') add('loot', { id: u.type, icon: look(types.get('LootContainer')), size: 1.3, on: false })
      else if (u.kind === 'key') add('keys', { id: u.type, icon: look(mt), size: 1.5, on: false })
      // ресурс: тип мітки гри (AzuriteOre, RhyolitePickup) — до своєї категорії легенди («Ресурси») з іконкою гри;
      // точка без можливої руди — тип групи точок гри, у своїй групі (не «ресурси» TH.GL з тією самою назвою)
      else if (mt) add(resGroup(mt, kindOf(u.type) ?? u.kind), { id: u.type, icon: look(mt), size: 1.2, on: false })
      else add('resourcePoints', { id: u.type, icon: null, size: 1, on: false })
    }
    // поля меланжу — завжди (блок полів на клієнті: і велике, якого серед точок нема — місця з розділу spice)
    for (const t of types.values()) if (t.tag === 'MapMarkers.Resource.Compacted.Spice') add(t.legend ?? groupOfTag(t.tag), { id: t.id, icon: look(t), size: 1.6, on: false })
    const list = [...groups.values()]
    // група на свіжій мапі — коли в ній є що показати одразу (ресурси в «Ресурсах» гри — ні)
    for (const g of list) g.defaultOn = !OFF.has(g.id) && g.types.some((t) => t.on)
    // спрайт: кожен рецепт — раз, у порядку появи
    const keyOf = (r) => JSON.stringify([r.icon, r.look])
    const recipes = [...new Map(list.flatMap((g) => g.types.map((t) => t.icon)).filter(Boolean).map((r) => [keyOf(r), r])).values()]
    const sprite = await spriteOf(recipes)
    for (const g of list) for (const t of g.types) t.icon = t.icon ? sprite.rects[keyOf(t.icon)] ?? null : null
    // назва точок кожного типу (найчастіша) — для уточнення однакових назв типів у labels
    const ptNames = new Map()
    for (const r of await db.all('SELECT type, name, COUNT(*) AS n FROM game_map_points WHERE name IS NOT NULL GROUP BY type, name ORDER BY n DESC')) if (!ptNames.has(r.type)) ptNames.set(r.type, r.name)
    return { groups: list, ptNames, sprite: sprite.buf, spriteHash: sprite.hash, partial: sprite.partial }
  }

  /**
   * спрайт: кожен рецепт — у сталій клітинці (за порядком у списку), тож іконка, що не завантажилась, лишає порожню
   * клітинку, а не зсуває решту; версія — хеш самого зображення. Рецепт гри: фон (розмір, тон) і гліф (розмір, тон) по
   * центру, тон — множення кольору (як у грі: білі текстури стають кольору тону); без рецепта — сама текстура
   */
  async function spriteOf(recipes) {
    const keys = recipes.map((r) => JSON.stringify([r.icon, r.look]))
    const key = createHash('sha256').update('look\n' + keys.join('\n')).digest('hex').slice(0, 16)
    const file = path.join(dir, `game-icons-${key}.webp`)
    const meta = file.replace(/\.webp$/, '.json')
    const hashOf = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16)
    try { const buf = fs.readFileSync(file); return { buf, rects: JSON.parse(fs.readFileSync(meta, 'utf8')), hash: hashOf(buf), partial: false } } catch { /* ще нема — складаємо */ }
    const deadline = now() + FETCH_DEADLINE
    // текстури (гліфи й фони) — кожна раз
    const textures = [...new Set(recipes.flatMap((r) => [r.icon, r.look?.bg]).filter(Boolean))]
    const got = new Map()
    let next = 0
    const worker = async () => {
      while (next < textures.length) {
        const tex = textures[next++]
        if (now() > deadline) continue
        try { got.set(tex, await fetchIcon(wikiFile(tex))) } catch { /* без цієї текстури — до повторної спроби */ }
      }
    }
    await Promise.all(Array.from({ length: FETCH_AT_ONCE }, worker))
    const tinted = async (buf, size, tint) => {
      const { data, info } = await sharp(buf).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      if (tint) {
        const c = [1, 3, 5].map((i) => parseInt(tint.slice(i, i + 2), 16))
        for (let i = 0; i < data.length; i += 4) for (let k = 0; k < 3; k++) data[i + k] = Math.round((data[i + k] * c[k]) / 255)
      }
      return sharp(data, { raw: info }).png().toBuffer()
    }
    const cell = async (r) => {
      const glyph = got.get(r.icon), L = r.look
      if (!glyph || (L?.bg && !got.get(L.bg))) return null
      if (!L) return tinted(glyph, CELL, null)
      // масштаб: більший із фону й гліфа займає клітинку
      const k = CELL / Math.max(L.bg ? L.bgSize ?? 0 : 0, L.size ?? 0, 1)
      const layers = []
      if (L.bg) { const s = Math.round(L.bgSize * k); layers.push({ input: await tinted(got.get(L.bg), s, L.bgTint), left: Math.round((CELL - s) / 2), top: Math.round((CELL - s) / 2) }) }
      const s = Math.round((L.size ?? CELL) * k)
      layers.push({ input: await tinted(glyph, s, L.tint), left: Math.round((CELL - s) / 2), top: Math.round((CELL - s) / 2) })
      return sharp({ create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer()
    }
    const imgs = await Promise.all(recipes.map((r) => cell(r).catch(() => null)))
    const rects = {}
    const comp = []
    keys.forEach((k, i) => {
      if (!imgs[i]) return
      const left = (i % PER_ROW) * CELL, top = Math.floor(i / PER_ROW) * CELL
      rects[k] = [left, top, CELL, CELL]
      comp.push({ input: imgs[i], left, top })
    })
    const W = Math.max(1, Math.min(recipes.length, PER_ROW)) * CELL, H = Math.max(1, Math.ceil(recipes.length / PER_ROW)) * CELL
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
    const { groups, ptNames } = await build()
    for (const g of groups) {
      if (gl.has(g.id) || ge.has(g.id)) out[g.id] = { loc: gl.get(g.id) ?? ge.get(g.id) ?? null, en: ge.get(g.id) ?? null, uk: lang === 'uk' ? gl.get(g.id) ?? null : null }
      else if (g.id.startsWith('MapMarkers.')) out[g.id] = { loc: null, en: g.id.split('.').slice(1).join(' · '), uk: null }
      for (const t of g.types) out[t.id] = { loc: loc.get(t.id) ?? en.get(t.id) ?? null, en: en.get(t.id) ?? null, uk: lang === 'uk' ? loc.get(t.id) ?? null : null }
    }
    // різні типи однієї групи з однаковою назвою (гра всіх представників Домів чи тренерів зве однаково, розрізняє
    // іконкою) — з назвою їхніх точок у грі («Представник Дому Алексін», «Тренер (Самін Моро)»); тип без власної назви
    // точок — частина id після спільного початку. Однакові назви в різних групах (руда різопроменем і руками) — як є
    // власна назва — сама собою, коли вона з тих самих слів («Представниця Дому Аргосаз» до «Представник Дому»); інакше —
    // уточненням у дужках («Тренер (Самін Моро)»)
    const words = (x) => x.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2)
    const sameWord = (a, b) => { const w = new Set(words(b)); return words(a).some((x) => w.has(x)) }
    const [pl, pe] = await Promise.all([texts(lang, 'place'), texts('en', 'place')])
    const placeIn = { loc: (k) => pl.get(k) ?? pe.get(k), en: (k) => pe.get(k), uk: (k) => (lang === 'uk' ? pl.get(k) : null) }
    for (const k of ['loc', 'en', 'uk']) {
      for (const g of groups) {
        const same = new Map()
        for (const t of g.types) { const v = out[t.id]?.[k]; if (v) { if (!same.has(v)) same.set(v, []); same.get(v).push(t.id) } }
        for (const [v, ids] of same) {
          if (ids.length < 2) continue
          const own = ids.map((id) => { const n = ptNames.has(id) ? placeIn[k](ptNames.get(id)) : null; return n && n !== v ? n : null })
          const ok = (n) => n && own.filter((x) => x === n).length === 1
          let p = 0
          while (ids.every((id) => id[p] === ids[0][p]) && p < ids[0].length) p++
          // межа — початок слова id (CamelCase): «Alexin», а не «lexin»
          while (p > 0 && !/[A-Z0-9_]/.test(ids[0][p] ?? '')) p--
          ids.forEach((id, i) => {
            if (ok(own[i])) out[id][k] = sameWord(own[i], v) ? own[i] : `${v} (${own[i]})`
            else if (id.slice(p)) out[id][k] = `${v} (${id.slice(p)})`
          })
        }
      }
    }
    return out
  }

  /**
   * точки мапи мовою: types[тип] = { pts: [x, y, z…], info: { i: [назва, опис, назва англ., опис англ.] }, share? }; опис
   * вузла ресурсу, де може з'явитися кілька руд, — усі можливі руди місця з часткою (вага карти тепла гри / сума ваг), за
   * спаданням; share — частка руди цього типу в кожній точці, %; опис контейнера — лут із шансом. Самі точки
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
    if (mapId === 'deepdesert_1' && layout != null) ddTouch(layout)
    const base = await memo(`${mapId}|${layout}`, async () => {
      const rows = await db.all(`SELECT part, kind, type, name, weight, loot, x, y, z FROM game_map_points WHERE map = ? AND ${layout == null ? 'layout IS NULL' : 'layout = ?'}`, mapId, ...(layout == null ? [] : [layout]))
      const types = {}
      // місце точки ресурсу (своє в основних і в підбирання) → можливі руди [[тип, вага]]
      const spots = new Map()
      const spot = (T, i, kind, type, x, y, z, w) => {
        const k = `${kind}|${x}|${y}|${z}`
        if (!spots.has(k)) spots.set(k, [])
        spots.get(k).push([type, w])
        T.spots[i] = k
      }
      for (const r of rows) {
        const T = (types[r.type] ||= { pts: [], names: {}, spots: {}, loot: {} })
        const i = T.pts.length / 3
        if (r.name) T.names[i] = r.name
        if (r.loot) T.loot[i] = JSON.parse(r.loot)
        if (r.part === 'resources' && r.weight > 0) spot(T, i, r.kind, r.type, r.x, r.y, r.z, Number(r.weight))
        T.pts.push(Number(r.x), Number(r.y), Number(r.z))
      }
      // ресурси розкладки ГП — з її файлу
      const f = layout != null && (await ddMeta()).layouts[layout]?.file
      let dd = null
      if (f) {
        try { dd = JSON.parse((await gunzip(await readFile(path.join(ddDir, f)))).toString('utf8')).types ?? {} } catch (e) { if (e.code !== 'ENOENT') throw e; await ddLost() }
      }
      if (dd) {
        for (const [type, v] of Object.entries(dd)) {
          const T = (types[type] ||= { pts: [], names: {}, spots: {}, loot: {} })
          // вид у кожної точки (core / aux); давній файл — усі точки типу одного виду (pts)
          for (const [kind, list] of v.pts ? [[v.kind, v.pts]] : [['core', v.core ?? []], ['aux', v.aux ?? []]]) {
            for (let j = 0; j < list.length; j += 4) {
              const [x, y, z, w] = [list[j], list[j + 1], list[j + 2], list[j + 3]]
              if (w > 0) spot(T, T.pts.length / 3, kind, type, x, y, z, w)
              T.pts.push(x, y, z)
            }
          }
        }
      }
      for (const v of spots.values()) v.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      // очікувана кількість: у кожному місці — одна руда за жеребом з вагами (як гра обирає руду при появі вузла);
      // жереб — від самого місця (хеш ключа), тож картина стала між запитами й запусками
      const chosen = new Map()
      for (const [k, v] of spots) {
        let u = unit(k) * v.reduce((a, b) => a + b[1], 0)
        let pick = v[v.length - 1][0]
        for (const [t, w] of v) { u -= w; if (u < 0) { pick = t; break } }
        chosen.set(k, pick)
      }
      // частка руди в місці: вага / сума ваг можливих руд, % (місце з однією рудою — 100); pick — 1, якщо жереб місця
      // випав на цю руду (точка без місця — завжди)
      for (const [type, T] of Object.entries(types)) {
        if (!Object.keys(T.spots).length) continue
        T.share = new Array(T.pts.length / 3).fill(100)
        T.pick = new Array(T.pts.length / 3).fill(1)
        for (const [i, k] of Object.entries(T.spots)) {
          const v = spots.get(k)
          const sum = v.reduce((a, b) => a + b[1], 0)
          T.share[i] = Math.round((100 * (v.find((x) => x[0] === type)?.[1] ?? 0)) / sum)
          T.pick[i] = chosen.get(k) === type ? 1 : 0
        }
      }
      // місця підбирання (сотні тисяч) потрібні лише для частки: опису руд у них нема — з пам'яті геть
      for (const T of Object.values(types)) for (const [i, k] of Object.entries(T.spots)) if (k.startsWith('aux|')) delete T.spots[i]
      for (const k of [...spots.keys()]) if (k.startsWith('aux|')) spots.delete(k)
      return { types, spots }
    })
    return memo(`${mapId}|${layout}|${lang}`, async () => {
      const [loc, en, tl, te, il, ie] = await Promise.all([texts(lang, 'place'), texts('en', 'place'), texts(lang, 'markerType'), texts('en', 'markerType'), texts(lang, 'item'), texts('en', 'item')])
      // лут контейнера: «предмет (шанс %)», кількість — коли в середньому більше одного; назва — предмета гри; предмет,
      // який дає лише умова гравця, — з позначкою (бонус спеціалізації, активний контракт)
      const COND = { k: 'бонус спеціалізації', c: 'з активним контрактом' }
      const lootText = (list, names, fb, l) => list.map(([id, pc, n, c]) => `${esc(names.get(id) ?? fb.get(id) ?? id)} (${pc}%)${n > 1 ? ` ×${n}` : ''}${COND[c] ? ` — ${esc(t(l, COND[c]))}` : ''}`).join('<br>')
      // опис місця — один на всі його руди
      const ores = new Map()
      // підбирання (дрібні камінці, сотні тисяч) — без переліку: шар не роздувається (частка — є)
      const oresOf = (k) => {
        if (!ores.has(k)) {
          const v = base.spots.get(k)
          const sum = v.reduce((a, b) => a + b[1], 0)
          ores.set(k, v.length > 1 && k.startsWith('core|') ? [null, v.map(([t, w]) => `${esc(tl.get(t) ?? te.get(t) ?? t)} — ${Math.round((100 * w) / sum)} %`).join('<br>'), null, null] : null)
        }
        return ores.get(k)
      }
      const types = {}
      for (const [type, T] of Object.entries(base.types)) {
        const info = {}
        for (const [i, k] of Object.entries(T.names)) if (loc.has(k) || en.has(k)) info[i] = [loc.get(k) ?? en.get(k) ?? null, null, en.get(k) ?? null, null]
        for (const [i, k] of Object.entries(T.spots)) { const o = oresOf(k); if (o) info[i] = o }
        for (const [i, list] of Object.entries(T.loot)) {
          info[i] = [info[i]?.[0] ?? null, lootText(list, il, ie, lang), info[i]?.[2] ?? null, lootText(list, ie, il, 'en')]
        }
        types[type] = T.share ? { pts: T.pts, info, share: T.share, pick: T.pick } : { pts: T.pts, info }
      }
      return { map: mapId, layout, types }
    })
  }

  /**
   * де випадає предмет: мапи з контейнерами, у луті яких є предмет, чия назва (мовою чи англійською) містить q; ГП —
   * вибрана розкладка (нема — поточна за розкладом). → [{ map, layout, n — контейнерів, best — найбільший шанс }],
   * більший шанс — вище. Точки мап не вантажимо: лише рядки луту з бази
   */
  async function lootMaps(q, lang = 'uk', ddLayout) {
    const [il, ie] = await Promise.all([texts(lang, 'item'), texts('en', 'item')])
    const ids = new Set()
    for (const m of [il, ie]) for (const [id, n] of m) if (String(n).toLowerCase().includes(q)) ids.add(id)
    if (!ids.size) return []
    lootRows ??= db.all('SELECT map, layout, loot FROM game_map_points WHERE loot IS NOT NULL').then((rows) => rows.map((r) => ({ map: r.map, layout: r.layout == null ? null : Number(r.layout), loot: JSON.parse(r.loot) })))
    const rows = await lootRows.catch((e) => { lootRows = null; throw e })
    const cur = Number.isInteger(ddLayout) ? ddLayout : currentLayout(await schedule())
    const out = new Map()
    for (const r of rows) {
      if (r.layout != null && r.layout !== cur) continue
      const hit = r.loot.filter(([id]) => ids.has(id))
      if (!hit.length) continue
      const m = out.get(r.map) ?? { map: r.map, layout: r.layout, n: 0, best: 0 }
      m.n++
      m.best = Math.max(m.best, ...hit.map((h) => h[1]))
      out.set(r.map, m)
    }
    return [...out.values()].sort((a, b) => b.best - a.best || b.n - a.n)
  }

  const sprite = async () => { const b = await build(); return { buf: b.sprite, hash: b.spriteHash } }
  const icons = async () => (await sprite()).buf

  return { setPoints, setTypes, setSchedule, setDdResources, schedule, ready, source, labels, points, lootMaps, icons, sprite, invalidate: reset }
}

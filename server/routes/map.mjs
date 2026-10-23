/*
 * Мапа: опис мап і шарів, точки за типами, пошук по луту, тайли й іконки з кешем на диску.
 * Назви й опис луту — мовою запиту (req.lang): словник мови TH.GL тягнеться раз і лежить на диску (thgl.mjs).
 * Точки, шари й іконки — з файлів гри (lib/gamemap.mjs), коли адмін перемкнув групу «Мапа» на файли гри і їхні точки
 * вже застосовано; інакше — TH.GL. Тайли й межі мап — завжди TH.GL (у серверних файлах пікселів нема).
 */
import express from 'express'
import { summaries } from '../lib/summary.mjs'
import { need } from './auth.mjs'

const TILE_DIR = /^[a-z0-9_]+-[0-9a-f]{32}$/
/** скільки контейнерів луту віддаємо найбільше */
const LOOT_MAX = 3000

export function createMapRoutes({ mapData, game = null, gamemap = null }) {
  const r = express.Router()
  /** звідки точки й шари: файли гри чи TH.GL */
  const fromGame = async () => !!gamemap && (await game?.getPrimary('markers')) === 'gamefiles' && (await gamemap.ready())
  const pointsOf = async (map, layout, lang) => ((await fromGame()) ? gamemap.points(map, layout, lang) : mapData.points(map, layout, lang))
  const groupsNow = async () => ((await fromGame()) ? (await gamemap.source()).groups : mapData.source.groups)
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next)
  const layoutOf = (req) => (req.query.layout === undefined || req.query.layout === '' ? undefined : Number(req.query.layout))
  // відповідь залежить від мови (?lang=, cookie, Accept-Language) — кеш браузера не має віддавати чужу
  const byLang = (res) => res.vary('Cookie').vary('Accept-Language')

  r.get('/api/map/source', wrap(async (req, res) => {
    mapData.refresh().catch(() => {})
    if (await fromGame()) return byLang(res).json({ source: await gamemap.source(), labels: await gamemap.labels(req.lang), ddHistory: mapData.ddHistory() })
    byLang(res).json({ source: mapData.source, labels: await mapData.labels(req.lang), ddHistory: mapData.ddHistory() })
  }))

  // примусова перевірка TH.GL — лише для тих, хто увійшов, і не частіше разу на 5 хв на весь сайт (інакше будь-хто
  // ганяв би сервер по TH.GL і скидав кеші точок); частіше — звичайна перевірка, що сама вирішує, чи пора
  let forcedAt = 0
  r.post('/api/map/refresh', need(), wrap(async (req, res) => {
    const force = Date.now() - forcedAt > 5 * 60_000
    if (force) forcedAt = Date.now()
    const s = await mapData.refresh(force)
    res.json({ syncedAt: s.syncedAt, dd: s.maps.find((m) => m.id === 'deepdesert_1')?.layout ?? null })
  }))

  // зведення мапи: скільки точок кожного типу + усі іменовані місця (для пошуку)
  r.get('/api/map/index/:map', wrap(async (req, res) => {
    const P = await pointsOf(req.params.map, layoutOf(req), req.lang)
    if (!P) return res.status(404).json({ error: req.t('немає такої мапи або розкладки') })
    // shares — у типів руди з часткою: скільки місць з часткою в кожному кроці 5 % (0–4, 5–9 … 100) — лічильник шару
    // для порогу повзунка «шанс появи»
    // picks — так само, але лише місця, де жереб місця випав на цю руду (вид «очікувана кількість»)
    const counts = {}, shares = {}, picks = {}, named = []
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [type, T] of Object.entries(P.types)) {
      counts[type] = T.pts.length / 3
      if (T.share) {
        const h = (shares[type] = new Array(21).fill(0)), hp = (picks[type] = new Array(21).fill(0))
        T.share.forEach((p, i) => { const b = Math.min(20, Math.floor(p / 5)); h[b]++; if (!T.pick || T.pick[i]) hp[b]++ })
      }
      for (const [i, [name, , en]] of Object.entries(T.info)) if (name) named.push([type, +i, name, en, T.pts[i * 3], T.pts[i * 3 + 1]])
      for (let i = 0; i < T.pts.length; i += 3) {
        x0 = Math.min(x0, T.pts[i]); x1 = Math.max(x1, T.pts[i])
        y0 = Math.min(y0, T.pts[i + 1]); y1 = Math.max(y1, T.pts[i + 1])
      }
    }
    const bbox = x0 <= x1 ? [[x0, y0], [x1, y1]] : null
    byLang(res).set('cache-control', 'max-age=300').json({ map: P.map, layout: P.layout, counts, ...(Object.keys(shares).length ? { shares, picks } : {}), named, bbox })
  }))

  // «що тут є» для кожної локації: лут контейнерів поблизу і руда / рослини довкола
  r.get('/api/map/summary/:map', wrap(async (req, res) => {
    const P = await pointsOf(req.params.map, layoutOf(req), req.lang)
    if (!P) return res.status(404).json({ error: req.t('немає такої мапи або розкладки') })
    byLang(res).set('cache-control', 'max-age=300').json(summaries(P, await groupsNow()).byLoc)
  }))

  r.get('/api/map/points/:map/:type', wrap(async (req, res) => {
    const P = await pointsOf(req.params.map, layoutOf(req), req.lang)
    const T = P?.types[req.params.type]
    if (!T) return res.json({ pts: [], info: {} })
    const info = {}
    for (const [i, [name, desc, en]] of Object.entries(T.info)) info[i] = [name, desc, en]
    // share — частка руди в кожній точці, % (вузли ресурсів з файлів гри: блідші й фільтр «лише ймовірні»)
    byLang(res).set('cache-control', 'max-age=300').json({ pts: T.pts, info, ...(T.share ? { share: T.share } : {}), ...(T.pick ? { pick: T.pick } : {}) })
  }))

  // точка гри за стабільним ключем (id TH.GL без координат): посилання «показати на мапі» з указу Ландсрааду
  r.get('/api/map/spot/:map/:type/:key', wrap(async (req, res) => {
    const ok = (v) => /^[a-z0-9_]{1,64}$/.test(v)
    if (!ok(req.params.type) || !ok(req.params.key)) return res.status(400).json({ error: req.t('хибна точка на мапі') })
    const s = await mapData.spot(req.params.map, req.params.type, req.params.key, layoutOf(req))
    if (!s) return res.status(404).json({ error: req.t('немає такої точки на мапі') })
    res.set('cache-control', 'max-age=300').json(s)
  }))

  // контейнери, у луті яких є предмет: «Промислова помпа» → точки з відсотком випадіння.
  // Шукаємо і в описі мовою людини, і в англійському; назву предмета показуємо мовою людини.
  // Пошук перебирає всі описи мапи — відповіді тримаємо в пам'яті (на мапу й мову — останні 50 запитів).
  const lootMemo = new WeakMap()
  r.get('/api/map/loot/:map', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 120)
    const P = await pointsOf(req.params.map, layoutOf(req), req.lang)
    if (!P || q.length < 3) return res.json({ hits: [], places: [] })
    byLang(res).json(lootIn(P, q, await groupsNow()))
  }))
  function lootIn(P, q, groups) {
    let memo = lootMemo.get(P)
    if (!memo) lootMemo.set(P, (memo = new Map()))
    let out = memo.get(q)
    if (!out) {
      out = findLoot(P, q, groups)
      memo.set(q, out)
      if (memo.size > 50) memo.delete(memo.keys().next().value)
    }
    return out
  }
  // предмет із довідника: на яких мапах випадає (Глибока пустеля — вибрана розкладка, нема — поточна) — скринь і
  // найбільший шанс; більший шанс — вище. Файли гри — з рядків луту (точки всіх мап не вантажимо)
  r.get('/api/map/loot-maps', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 120)
    if (q.length < 3) return res.json({ maps: [] })
    if (await fromGame()) return byLang(res).set('cache-control', 'max-age=300').json({ maps: await gamemap.lootMaps(q, req.lang, layoutOf(req)) })
    const groups = await groupsNow()
    const maps = []
    for (const m of mapData.source?.maps ?? []) {
      const P = await pointsOf(m.id, m.id === 'deepdesert_1' ? layoutOf(req) : undefined, req.lang)
      const hits = P ? lootIn(P, q, groups).hits : []
      if (hits.length) maps.push({ map: m.id, layout: P.layout ?? null, n: hits.length, best: hits.reduce((b, h) => Math.max(b, h.chance ?? 0), 0) })
    }
    maps.sort((a, b) => b.best - a.best || b.n - a.n)
    byLang(res).set('cache-control', 'max-age=300').json({ maps })
  }))
  function findLoot(P, q, groups) {
    const lines = (d) => (d ? d.split(/<br\s*\/?>/i) : [])
    // рядок луту — «предмет (шанс %)»; перелік руд вузла («Титанова руда — 40 %») — не лут
    const find = (ls) => ls.findIndex((l) => l.toLowerCase().includes(q) && /\(\d+(?:[.,]\d+)?%\)/.test(l))
    const hits = []
    scan: for (const [type, T] of Object.entries(P.types)) {
      for (const [i, [name, desc, , descEn]] of Object.entries(T.info)) {
        const loc = lines(desc), en = lines(descEn)
        let at = find(loc), line = loc[at]
        if (at < 0) {
          // знайшли в англійському описі: рядок мовою людини — той самий за порядком, якщо описи збігаються за довжиною
          at = find(en)
          if (at < 0) continue
          line = loc.length === en.length ? loc[at] : en[at]
        }
        const pc = /\((\d+(?:[.,]\d+)?)%\)/.exec(line) || /\((\d+(?:[.,]\d+)?)%\)/.exec(en[at] || '')
        hits.push({ type, i: +i, x: T.pts[i * 3], y: T.pts[i * 3 + 1], name, item: line.replace(/<[^>]+>/g, '').replace(/\s*\(\d.*$/, '').trim(), chance: pc ? Number(pc[1].replace(',', '.')) : null })
        if (hits.length >= LOOT_MAX) break scan
      }
    }
    // локації, де лежать ці контейнери: їх показує фільтр «Наших ресурсів»
    const S = summaries(P, groups)
    const places = new Map()
    for (const h of hits) {
      const l = S.owner(h.x, h.y)
      if (!l) continue
      const k = l.type + ':' + l.i
      const cur = places.get(k)
      if (cur) { cur.best = Math.max(cur.best, h.chance ?? 0); cur.n++ } else places.set(k, { type: l.type, i: l.i, x: l.x, y: l.y, name: l.name, best: h.chance ?? 0, n: 1 })
    }
    return { hits, places: [...places.values()] }
  }

  r.get('/api/map/icons.webp', wrap(async (req, res) => {
    // спрайт файлів гри — з ?v= (хеш самого зображення): та сама версія — назавжди, інша чи без неї — без кешу
    if (await fromGame()) {
      const sp = await gamemap.sprite()
      return res.type('image/webp').set('cache-control', req.query.v === sp.hash ? 'public, max-age=604800, immutable' : 'no-store').send(sp.buf)
    }
    // TH.GL: спрайт без версії; запит з ?v= (сторінка ще з даними гри) — не кешуємо під чужою адресою
    res.type('image/webp').set('cache-control', req.query.v ? 'no-store' : 'max-age=86400').send(await mapData.icons())
  }))

  r.get('/map-tiles/:dir/:z/:y/:x.webp', wrap(async (req, res) => {
    const { dir } = req.params
    const [z, y, x] = [req.params.z, req.params.y, req.params.x].map(Number)
    if (!TILE_DIR.test(dir) || ![z, y, x].every(Number.isInteger)) return res.status(400).end()
    // лише теки відомих мап і розкладок, рівні їхнього масштабу й клітинки в межах сітки — інакше кожна вигадана
    // адреса була б запитом до CDN і записом у кеш
    const m = mapData.source?.maps.find((x) => x.tiles === dir || x.layouts?.some((l) => l.tiles === dir))
    if (!m || z < (m.minNativeZoom ?? 0) || z > (m.maxNativeZoom ?? 4) || y < 0 || x < 0 || y >= 2 ** z || x >= 2 ** z) return res.status(404).end()
    const buf = await mapData.tile(dir, z, y, x)
    if (!buf) return res.status(404).end()
    res.type('image/webp').set('cache-control', 'public, max-age=604800, immutable').send(buf)
  }))

  return r
}

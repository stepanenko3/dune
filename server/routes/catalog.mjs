/*
 * Довідник: увесь каталог одним JSON (адреси картинок — наші, lib/catalog.mjs), деталі предмета на вимогу (опис,
 * характеристики), картинки за давніми адресами проксі — з медіатеки у сховищі (lib/media.mjs).
 * Каталог (~1,4 МБ) серіалізуємо й стискаємо раз на версію даних і мову, а не на кожен запит.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import express from 'express'
import { LANGS } from '../lib/gamedata.mjs'
import { iconSource, srcOf } from '../lib/media.mjs'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Sandwalkers/2'
const SAFE_ID = /^[\w-]{1,120}$/
/** деталі, яких questlog не дав, не перепитуємо годину */
const MISS_MS = 60 * 60_000

async function cachedFetch(file, url) {
  if (fs.existsSync(file)) return fs.readFileSync(file)
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e }
  const buf = Buffer.from(await r.arrayBuffer())
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buf)
  return buf
}

export function createCatalogRoutes({ catalog, game, media = null }) {
  const r = express.Router()
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next)
  /** деталі, яких questlog не дав: `${kind}:${id}` → коли */
  const noDetail = new Map()
  /** готове тіло відповіді для каталогу (поки він той самий об'єкт — та сама версія даних і мова) */
  const bodies = new WeakMap()
  const bodyOf = (c) => {
    let b = bodies.get(c)
    if (!b) { const json = Buffer.from(JSON.stringify(c)); b = { json, gz: zlib.gzipSync(json, { level: 9 }) }; bodies.set(c, b) }
    return b
  }
  /** id з довідника (англійською — він той самий для всіх мов): деталі питаємо лише про те, що в ньому є */
  const known = new WeakMap()
  const has = async (kind, id) => {
    const c = await catalog.get('en')
    if (!c) return false
    if (!known.has(c)) known.set(c, { item: new Set(c.items.map((x) => x.id)), placeable: new Set(c.placeables.map((x) => x.id)) })
    return known.get(c)[kind].has(id)
  }

  // мовою запиту (?lang= — так питає сайт; без нього — cookie чи мова браузера, тоді й Vary); no-cache + ETag: браузер
  // щоразу звіряється (304, якщо не мінявся) — правки з панелі видно одразу
  r.get('/api/catalog', wrap(async (req, res) => {
    const c = await catalog.get(req.lang)
    if (!c) return res.status(503).json({ error: req.t('дані гри ще не завантажено') })
    res.set('cache-control', 'no-cache').set('etag', c.etag).set('vary', req.query.lang ? 'accept-encoding' : 'cookie, accept-language, accept-encoding')
    if (req.headers['if-none-match'] === c.etag) return res.status(304).end()
    const b = bodyOf(c)
    res.type('application/json')
    // стиснене — готовим (compression бачить content-encoding і вдруге не стискає)
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return res.set('content-encoding', 'gzip').send(b.gz)
    res.send(b.json)
  }))

  // деталі предмета / пристрою: опис і характеристики — з questlog, із кешем на диску
  r.get('/api/catalog/:kind(item|placeable)/:id', wrap(async (req, res) => {
    const { kind, id } = req.params
    if (!SAFE_ID.test(id)) return res.status(400).end()
    // лише записи довідника, і невдачу не перепитуємо щоразу: інакше будь-який id — новий запит до questlog
    const miss = noDetail.get(`${kind}:${id}`)
    if (!(await has(kind, id)) || (miss && Date.now() - miss < MISS_MS)) return res.status(404).json({ error: req.t('деталі зараз недоступні') })
    const proc = kind === 'item' ? 'getItem' : 'getPlaceable'
    // характеристики — з англійської версії questlog (кеш на диску); опис — мовою людини: з наших текстів гри,
    // інакше questlog тією мовою, якщо вона в нього є, інакше англійською
    const url = (lang) => `https://questlog.gg/dune-awakening/api/trpc/database.${proc}?input=${encodeURIComponent(JSON.stringify({ language: lang, id }))}`
    const ql = LANGS.find((l) => l.code === req.lang)?.ql
    try {
      const buf = await cachedFetch(path.join(catalog.dir, kind, id + '.json'), url('en'))
      const d = JSON.parse(buf.toString('utf8')).result?.data ?? {}
      let description = req.lang === 'en' ? d.description ?? null : await game.description(kind, id, req.lang)
      if (!description && ql && ql !== 'en') {
        const loc = await cachedFetch(path.join(catalog.dir, kind, `${id}.${ql}.json`), url(ql)).catch(() => null)
        description = loc ? JSON.parse(loc.toString('utf8')).result?.data?.description ?? null : null
      }
      const w = d.stats?.weaponStats?.frameMod ?? null
      res.set('cache-control', 'max-age=3600').set('vary', 'cookie').json({
        description: description ?? d.description ?? null,
        lang: description ? req.lang : 'en',
        volume: d.volumeSize ?? null,
        price: d.vendorBasePrice ?? null,
        weapon: w,
        armor: d.stats?.armorStats ?? null,
        power: kind === 'placeable' ? { produce: d.powerProduction ?? 0, consume: d.powerConsumption ?? 0, water: d.waterCapacity ?? 0, waterRate: d.waterGenerationRateInSecs ?? 0 } : null,
      })
    } catch (e) {
      if (noDetail.size > 5000) noDetail.clear()
      noDetail.set(`${kind}:${id}`, Date.now())
      res.status(e.status === 404 ? 404 : 502).json({ error: req.t('деталі зараз недоступні') })
    }
  }))

  // картинки за давніми адресами проксі (їх складає сайт і вони лежать у збережених документах): з медіатеки
  // (lib/media.mjs) — у сховищі; ще нема — сервер дотягне з джерела один раз. Джерело недоступне — 404, а не збій
  // express уже розкодував шлях — кодуємо сегменти назад, як у даних (encodeURIComponent імені файлу)
  const serve = (pick) => wrap(async (req, res) => {
    const want = pick(req.params[0].split('/').map(encodeURIComponent).join('/'))
    if (!want?.src) return res.status(404).end()
    let f = null
    try { f = media ? await media.open(want.src, { alt: want.alt ?? [] }) : null } catch { f = null }
    if (!f) return res.status(404).end()
    res.type(f.type).set('cache-control', 'public, max-age=604800, immutable').send(f.buf)
  })
  // сайт спершу просить кольоровий рендер (…R_D); його нема (у кожної четвертої) — віддаємо базову …_D, а не 404:
  // браузер не робить другого запиту й не пише помилку в консоль
  r.get(/^\/catalog-icons\/(.+)\.webp$/, serve((p) => (srcOf('ql', `${p}.webp`) ? iconSource(p, { color: false }) : null)))
  r.get(/^\/catalog-wiki\/(.+)$/, serve((p) => ({ src: srcOf('wiki', p) })))
  // іконки спеціалізацій і картинки в текстах роадмапів
  r.get(/^\/catalog-gt\/(.+)$/, serve((p) => ({ src: srcOf('gt', p) })))

  return r
}

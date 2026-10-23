/*
 * Карта світу: місця карти поверхні гри (Overland Map) і переходи між мапами — з data/world.json, який пише видобувач
 * з файлів гри (node tools/game-extractor/bin/world.mjs; як саме — tools/game-extractor/normalize/world.mjs).
 * Відповідь — мовою запиту: тексти гри (14 мов, з .locres) підставлені замість ключів; нема мовою — англійською.
 * Файл перечитуємо, лише коли він змінився (новий патч гри — новий файл без перезапуску сервера).
 *
 * Картинка карти — текстура гри T_UI_GlobalMap_D (4096×2048; у серверній збірці пікселів нема — лише розмір), узята
 * з вікі спільноти (дозволений виняток для картинок), один раз у наше сховище в повному розмірі. Де вона лежить у
 * координатах гри (WORLD_IMAGE.bounds) — підібрано за 17 місцями, позначеними на ній у вікі: масштаб однаковий по обох
 * осях (≈ 1/120 одиниці гри на піксель), похибка — ~5 px із 4096. Самі місця й переходи — лише з файлів гри.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const WORLD_FILE = path.join(import.meta.dirname, '..', '..', 'data', 'world.json')

/** id мапи сайту з мапи гри: «SH_Arrakeen» → «sh_arrakeen» (детальні мапи сайту — /map?m=<id>) */
const siteMap = (m) => (m ? String(m).toLowerCase() : null)

/** картинка карти поверхні: звідки взяти й який прямокутник координат гри [x0, y0, x1, y1] вона покриває */
export const WORLD_IMAGE = {
  src: 'https://media.awakening.wiki/wiki/2/2c/Overland.webp',
  key: 'world/overland-t-ui-globalmap-d.webp',
  bounds: [-245081, -151740, 245691, 93646],
}

/**
 * storage — сховище (lib/storage.mjs): картинку карти кладемо туди один раз (warm) і віддаємо адресою /media/…;
 * без сховища чи поки не завантажилась — відповідь без картинки (сайт малює свій фон)
 */
export function createWorld({ file = WORLD_FILE, storage = null, log = console, fetchImpl = (...a) => fetch(...a) } = {}) {
  let cache = null
  let imageOk = false
  /** завантажити картинку карти у сховище, якщо її там ще нема (повторно — не тягне) */
  async function warm() {
    if (!storage || imageOk) return imageOk
    if (await storage.has(WORLD_IMAGE.key)) return (imageOk = true)
    const r = await fetchImpl(WORLD_IMAGE.src, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Sandwalkers/2' }, signal: AbortSignal.timeout(60_000) })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 1000 || buf.subarray(8, 12).toString() !== 'WEBP') throw new Error('не webp')
    await storage.put(WORLD_IMAGE.key, buf, 'image/webp')
    log.info?.(`[world] картинку карти поверхні збережено (${Math.round(buf.length / 1024)} КБ)`)
    imageOk = true
    cache = null // відповіді (й етег) тепер — з картинкою
    return true
  }
  /** документ з диска (той самий, поки файл не змінився); нема чи зіпсований — null */
  function doc() {
    let st
    try { st = fs.statSync(file) } catch { cache = null; return null }
    const stamp = `${st.mtimeMs}:${st.size}`
    if (cache?.stamp === stamp) return cache
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (d?.schema !== 1 || !Array.isArray(d.locations) || !Array.isArray(d.links)) throw new Error('схема')
      cache = { stamp, d, byLang: new Map(), hash: crypto.createHash('sha1').update(stamp + (imageOk ? ':img' : '')).digest('hex').slice(0, 12) }
    } catch { cache = null }
    return cache
  }

  /** дані мовою lang: тексти — рядками (нема — null) */
  function get(lang) {
    const c = doc()
    if (!c) return null
    if (c.byLang.has(lang)) return c.byLang.get(lang)
    const { d } = c
    const tx = (ref) => { const t = ref ? d.texts?.[ref] : null; return t ? t[lang] ?? t.en ?? Object.values(t)[0] ?? null : null }
    const req = (r) => ({ type: r.type, text: tx(r.text), ...(r.tags ? { tags: r.tags } : {}) })
    const out = {
      etag: `"w${c.hash}-${lang}"`,
      build: d.build ?? null, version: d.version ?? null,
      overland: d.overland, bounds: d.bounds,
      image: imageOk && storage ? { url: storage.url(WORLD_IMAGE.key), bounds: WORLD_IMAGE.bounds, w: 4096, h: 2048 } : null,
      about: (d.about ?? []).map(tx).filter(Boolean),
      categories: (d.categories ?? []).map((k) => ({ tag: k.tag, name: tx(k.name), parent: k.parent ?? null })),
      locations: d.locations.map((l) => ({
        id: l.id, ids: l.ids ?? [l.id], tag: l.tag ?? null,
        name: tx(l.name) ?? tx(l.title), title: tx(l.title), desc: tx(l.desc), note: tx(l.note),
        group: l.group, hidden: !!l.hidden, map: siteMap(l.map), pos: l.pos ?? null, r: l.r ?? null, exits: l.exits ?? [],
      })).filter((l) => l.name),
      links: d.links.map((k) => ({ from: k.from, to: k.to, mode: k.mode, dimension: !!k.dimension, points: k.points ?? 0, options: (k.options ?? []).map((o) => o.map(req)) })),
    }
    // переходи лише між місцями, що лишилися (без назви — не показуємо)
    const ids = new Set(out.locations.map((l) => l.id))
    out.links = out.links.filter((k) => ids.has(k.from) && ids.has(k.to))
    c.byLang.set(lang, out)
    return out
  }
  return { get, warm }
}

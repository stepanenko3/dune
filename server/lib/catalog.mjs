/*
 * Довідник гри для сайту: предмети, пристрої, рецепти й будівельні модулі — у базі (gamedata.mjs), їх пише реєстр
 * джерел з файлів гри (server/lib/gamedata). Сторонніх зборів нема. Картинки (пікселів у серверних файлах гри нема) —
 * з нашої медіатеки (lib/media.mjs): у відповіді сайту адреси /media/… (ще не завантажене — наш проксі
 * /catalog-icons/…, /catalog-wiki/…); характеристики на картці предмета — routes/catalog.mjs.
 */
import path from 'node:path'
import { iconSource } from './media.mjs'

export { iconSource }

/** довідник з нашими адресами картинок (етег — з номером стану медіатеки) */
export function withMedia(c, media) {
  // іконки — /media/… лише вже завантажені (без заглушки: іконки дрібні, а їх тисячі); якої нема ніде — null (сайт
  // одразу малює заглушку, а не питає проксі); ще не перевірена — шлях гри, з якого сайт складе адресу проксі
  const icon = (x) => {
    const s = x.icon && iconSource(x.icon)
    if (!s) return x
    const u = media.found(s.src, { hash: false })
    return u ? { ...x, icon: u } : media.row(s.src)?.status === 'missing' ? { ...x, icon: null } : x
  }
  const placeables = c.placeables.map(icon)
  const placeIcon = new Map(placeables.map((p) => [p.id, p.icon]))
  // картинки модуля нема на джерелі — іконка пристрою з тим самим id гри (якщо є), інакше без картинки
  const img = (b) => {
    if (!b.img) return b
    if (media.row(b.img)?.status === 'missing') return { ...b, img: placeIcon.get(b.id) ?? null }
    return { ...b, img: media.local(b.img) }
  }
  return {
    ...c,
    etag: `"${String(c.etag || 'c').replace(/^"|"$/g, '')}-m${media.epoch}"`,
    items: c.items.map(icon),
    placeables,
    buildables: c.buildables.map(img),
  }
}

export function createCatalog({ dataDir, game, media = null }) {
  /** сирий довідник (той самий об'єкт, поки не змінились дані й мова) → { epoch, out } */
  const memo = new WeakMap()
  const catalog = {
    /** довідник мовою; null — даних гри ще нема */
    async get(lang) {
      const c = await game.catalog(lang)
      if (!c || !media) return c
      const m = memo.get(c)
      if (m && m.epoch === media.epoch) return m.out
      const out = withMedia(c, media)
      memo.set(c, { epoch: media.epoch, out })
      return out
    },
    /** картинки довідника для медіатеки: [{ src, alt }] */
    async images() {
      const c = await game.catalog('en')
      if (!c) return []
      const out = []
      for (const x of [...c.items, ...c.placeables]) if (x.icon) out.push(iconSource(x.icon))
      for (const b of c.buildables) if (b.img) out.push({ src: b.img })
      return out
    },
    syncing: false,
    failed: false,
    dir: path.join(dataDir, 'catalog'),
  }
  media?.collect(catalog.images)
  return catalog
}

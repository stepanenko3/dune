/**
 * Адреси картинок на клієнті. Картинки гри лежать у нашій медіатеці (server/lib/media.mjs): /media/<ключ>, а розміри й
 * розмита заглушка (ThumbHash) їдуть у фрагменті тієї ж адреси — /media/img/ab/….webp#s=256x256&t=… (фрагмент браузер
 * не надсилає й на кеш він не впливає). Чужі адреси дозволених джерел (у давніх документах, у даних, що тягне браузер)
 * стають нашим проксі, який бере картинку з медіатеки, — браузер на чужі сайти за картинками не ходить.
 */

/** дозволені джерела → наш проксі (те саме, що SOURCES у server/lib/media.mjs) */
const PROXY: [string, RegExp, string][] = [
  ['https://cdn.questlog.gg/dune-awakening/', /^assets\/(Dune|DLC)\/[\w/.-]+\.webp$/, '/catalog-icons/'],
  ['https://media.awakening.wiki/', /^wiki\/[0-9a-f]\/[0-9a-f]{2}\/[\w.%()'-]+\.(png|jpe?g|webp)$/i, '/catalog-wiki/'],
  ['https://cdn-hosted.gaming.tools/dune/', /^images\/[\w/.%-]+\.(webp|png|jpe?g)$/i, '/catalog-gt/'],
]
const plainPath = (p: string) => !p.split('/').some((s) => s === '..' || s === '.' || s === '')

/** адреса цього сайту (не «//чужий» і не «/\чужий») */
export const isSitePath = (u: string) => /^\/(?![/\\])/.test(u) && !/[\u0000-\u001f\\]/.test(u)

/**
 * наша адреса картинки: шлях сайту — як є; дозволене джерело — наш проксі; інше — null (чужу картинку не показуємо:
 * вона стежила б за глядачами)
 */
export function ourImg(url: string | null | undefined): string | null {
  if (!url) return null
  if (isSitePath(url)) return url
  for (const [base, re, route] of PROXY) {
    if (!url.startsWith(base)) continue
    const rel = url.slice(base.length)
    return re.test(rel) && plainPath(rel) ? route + rel : null
  }
  return null
}

export interface MediaInfo {
  /** адреса без фрагмента */
  src: string
  /** справжні розміри картинки (якщо відомі) */
  w: number | null
  h: number | null
  /** ThumbHash (base64url) розмитої заглушки */
  thumb: string | null
}

/** адреса → сама адреса й те, що приїхало у фрагменті (#s=ШxВ&t=відбиток) */
export function mediaInfo(url: string): MediaInfo {
  const at = url.indexOf('#')
  if (at < 0) return { src: url, w: null, h: null, thumb: null }
  const q = new URLSearchParams(url.slice(at + 1))
  const s = /^(\d+)x(\d+)$/.exec(q.get('s') ?? '')
  const t = q.get('t')
  return { src: url.slice(0, at), w: s ? Number(s[1]) : null, h: s ? Number(s[2]) : null, thumb: t && /^[\w-]{6,80}$/.test(t) ? t : null }
}

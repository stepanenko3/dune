/**
 * Карта світу: місця карти поверхні гри (Overland Map) і переходи між мапами — з /api/world (сервер бере їх із файлів
 * гри, назви й описи — мовою сайту з перекладів гри). Тут — запит, підписи умов переходу й розбір переходів місця.
 * Координати — карти поверхні: X — схід, Y — південь (північ угорі — менший Y).
 */
import { useEffect, useState } from 'react'
import { get } from './api'
import { currentLang, t } from './i18n'

export interface WorldReq { type: string; text: string | null; tags?: string[] }
export interface WorldLink { from: string; to: string; mode: 'travel' | 'taxi'; dimension: boolean; points: number; options: WorldReq[][] }
export interface WorldLoc {
  id: string
  ids: string[]
  /** тег категорії гри (Poi.Dungeons, Poi.Location.Regions…); null — місце без точки на карті поверхні */
  tag: string | null
  name: string
  /** повна назва в діалозі переходу гри («Імперська випробувальна станція № 136») */
  title: string | null
  desc: string | null
  /** підказка гри в діалозі переходу («Орнітоптер лишатиметься на аеродромі…») */
  note: string | null
  group: 'solo' | 'party'
  /** на карті поверхні гри видно лише за сюжетом */
  hidden: boolean
  /** мапа гри (id мапи сайту, якщо вона в нас є) */
  map: string | null
  pos: [number, number] | null
  /** радіус кола посадки на карті поверхні */
  r: number | null
  /** точки на карті поверхні, куди потрапляєш, вилетівши звідси */
  exits: [number, number][]
}
export interface WorldCat { tag: string; name: string | null; parent: string | null }
export interface World {
  build: string | null
  version: string | null
  overland: string
  bounds: [number, number, number, number]
  /** картинка карти поверхні з гри (наше сховище) і прямокутник координат гри, який вона покриває; null — нема */
  image: { url: string; bounds: [number, number, number, number]; w: number; h: number } | null
  about: string[]
  categories: WorldCat[]
  locations: WorldLoc[]
  links: WorldLink[]
}

let cache: { lang: string; p: Promise<World> } | null = null
/** дані карти світу (один запит на мову; помилка — наступна спроба питає знову) */
export function loadWorld(): Promise<World> {
  const lang = currentLang()
  if (cache?.lang === lang) return cache.p
  const p = get<World>(`/api/world?lang=${encodeURIComponent(lang)}`)
  cache = { lang, p }
  p.catch(() => { if (cache?.p === p) cache = null })
  return p
}
/** undefined — вантажиться, null — не вдалося (retry — ще раз) */
export function useWorld(): { world: World | null | undefined; error: string | null; retry: () => void } {
  const [world, setWorld] = useState<World | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setWorld(undefined)
    loadWorld().then((w) => { if (live) { setWorld(w); setError(null) } }).catch((e) => { if (live) { setWorld(null); setError(e?.message || t('не вдалося завантажити')) } })
    return () => { live = false }
  }, [n])
  return { world, error, retry: () => setN((x) => x + 1) }
}

/**
 * Категорії гри — колір і порядок на сайті (за тегом гри; невідомий тег — сірий у кінці). Кольори — токени теми,
 * тож і в темній темі контрастні.
 */
const CAT_STYLE: Record<string, { color: string; order: number }> = {
  'Poi.Location.Regions': { color: 'var(--c-spice)', order: 0 },
  'Poi.Location.Cities': { color: 'var(--c-water)', order: 1 },
  'Poi.Dungeons': { color: 'var(--c-bad)', order: 2 },
  'Poi.PointsOfInterest': { color: 'var(--c-warn)', order: 3 },
  'Poi.StoryRelatedMaps': { color: 'var(--c-ok)', order: 4 },
}
export const catColor = (tag: string | null) => `rgb(${CAT_STYLE[tag ?? '']?.color ?? 'var(--c-muted)'})`
export const catOrder = (tag: string | null) => CAT_STYLE[tag ?? '']?.order ?? 9
/** великі місця (регіони й поселення): підпис завжди й більшим шрифтом */
export const isMajor = (l: WorldLoc) => l.tag === 'Poi.Location.Regions' || l.tag === 'Poi.Location.Cities'

/** назва категорії гри (нема — наша) */
export const catName = (w: World, tag: string | null) => (tag ? w.categories.find((c) => c.tag === tag)?.name : null) ?? t('Інші місця')

/** умови одного варіанта переходу — короткими підписами (сюжетні — одним) */
export function reqLabels(reqs: WorldReq[]): string[] {
  const out: string[] = []
  const push = (s: string) => { if (!out.includes(s)) out.push(s) }
  for (const r of reqs) {
    switch (r.type) {
      case 'NavigationType': push(r.text ?? t('Потрібен літальний апарат')); break
      case 'SavedVehicle': push(r.text ?? t('Потрібен літальний апарат')); break
      case 'HarnessedVehicle': push(t('Зчеплений транспорт — без пасажирів')); break
      case 'MapIsActiveJourneyTarget': push(r.text ?? t('Потрібне активне завдання Ландсрааду')); break
      case 'JourneyCompleted': case 'JourneyNotCompleted': push(t('Відкривається сюжетом')); break
      case 'PlayerFlags': push(t('Лише під час події')); break
      default: push(r.text ?? t('Особлива умова гри'))
    }
  }
  return out
}
/** умови переходу: варіанти (будь-який з них) — без повторів; без умов — [] */
export function linkReqs(l: WorldLink): string[][] {
  const seen = new Set<string>()
  const out: string[][] = []
  for (const o of l.options) {
    const labels = reqLabels(o)
    const k = labels.join('|')
    if (!labels.length || seen.has(k)) continue
    seen.add(k)
    out.push(labels)
  }
  // є варіант без умов — переходу нічого не треба
  return l.options.some((o) => !o.length) ? [] : out
}
/** вихід за край мапи на літальному апараті (Западина, Глибока пустеля) */
export const isEdge = (l: WorldLink) => l.options.some((o) => o.some((r) => r.type === 'NavigationType'))
/** злітаєш на своєму орнітоптері зі стоянки (поселення) */
export const isPad = (l: WorldLink) => l.options.some((o) => o.some((r) => r.type === 'SavedVehicle'))

/** переходи місця: звідки сюди і куди звідси */
export function linksOf(w: World, id: string) {
  return { into: w.links.filter((l) => l.to === id), out: w.links.filter((l) => l.from === id) }
}
/** куди можна долетіти з карти поверхні (без самої карти) */
export const fromOverland = (w: World) => w.links.filter((l) => l.from === w.overland)

/** пошук: назва, повна назва, опис — без регістру й апострофів різного виду */
const norm = (s: string) => s.toLocaleLowerCase().replace(/[’ʼ`]/g, "'").replace(/ё/g, 'е')
export function matches(l: WorldLoc, q: string) {
  const s = norm(q.trim())
  if (!s) return true
  return [l.name, l.title, l.desc].some((x) => x && norm(x).includes(s))
}

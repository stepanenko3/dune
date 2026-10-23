/*
 * Стан ігрових даних для індикатора оновлень (server/routes/gamedata.mjs): які розділи, звідки, коли востаннє реально
 * змінились; журнал змін. Стан тягнемо раз за сесію сторінки — кілька підписів «оновлено …» ділять один запит.
 */
import { useEffect, useState } from 'react'
import { get } from '@/lib/api'
import { t } from '@/lib/i18n'

/** конкретне джерело розділу: файли гри (збірка, версія) чи сайти запасного джерела */
export interface GdSource { id: string; names: string[]; build?: string | null; version?: string | null }
export interface GdSection { id: string; primary?: string | null; driver: string | null; source?: GdSource | null; count: number | null; changedAt: number | null; since: number | null; checkedAt: number | null; status: string; error: string | null }
export interface GdStatus { game: { version: string | null; build: string | null }; updatedAt: number | null; sections: GdSection[] }
export interface GdSummary { added: number; removed: number; changed: number; examples: { id: string; name: string | null; op: '+' | '-' | '~' }[] }
export interface GdChange { id: number; at: number; section: string; driver: string; build: string | null; names?: string[]; summary: GdSummary }

/** порядок показу розділів (як server/lib/gamedata/sections.mjs) */
export const SECTION_ORDER = ['items', 'placeables', 'recipes', 'buildables', 'skills', 'texts', 'maps', 'markers', 'markerTypes', 'resources', 'spice', 'ddLayouts', 'ddResources', 'config', 'images']
export const bySectionOrder = (a: { id: string }, b: { id: string }) => SECTION_ORDER.indexOf(a.id) - SECTION_ORDER.indexOf(b.id)

/** назва розділу мовою сайту (функція, а не таблиця: t() — у мить показу) */
export function sectionLabel(id: string): string {
  switch (id) {
    case 'items': return t('Предмети')
    case 'placeables': return t('Пристрої')
    case 'recipes': return t('Рецепти')
    case 'buildables': return t('Будівельні модулі')
    case 'skills': return t('Уміння')
    case 'texts': return t('Переклади')
    case 'maps': return t('Мапи')
    case 'markers': return t('Точки на мапі')
    case 'markerTypes': return t('Типи точок')
    case 'resources': return t('Ресурси')
    case 'spice': return t('Поля меланжу')
    case 'ddLayouts': return t('Розкладки Глибокої пустелі')
    case 'ddResources': return t('Ресурси Глибокої пустелі')
    case 'config': return t('Налаштування гри')
    case 'images': return t('Картинки')
    default: return id
  }
}

export function driverLabel(id: string | null): string {
  if (id === 'gamefiles') return t('файли гри')
  if (id === 'thgl') return 'TH.GL'
  return id ?? '—'
}

/** група розділів з одним джерелом на всіх (server/lib/gamedata/sections.mjs GROUPS) */
export function groupLabel(id: string): string {
  if (id === 'catalog') return t('Довідник')
  if (id === 'map') return t('Мапа')
  return id
}

/** перший рядок картки джерела: «Файли гри 1.5.15» чи «questlog.gg + awakening.wiki» */
export function sourceTitle(src: GdSource): string {
  if (src.id === 'gamefiles') return t('Файли гри') + (src.version ? ` ${src.version}` : '')
  return src.names.length ? src.names.join(' + ') : driverLabel(src.id)
}

/** другий (сірий) рядок картки: збірка файлів гри; у сайтів спільноти — нема */
export const sourceSub = (src: GdSource): string | null => (src.id === 'gamefiles' && src.build ? t('збірка {build}', { build: src.build }) : null)

/** «Файли гри 1.5.15 · збірка 2160922» чи «questlog.gg + awakening.wiki»; опису нема — загальна назва драйвера */
export function sourceText(src: GdSource | null | undefined, driver: string | null = null): string {
  if (!src) return driverLabel(driver)
  return [sourceTitle(src), sourceSub(src)].filter(Boolean).join(' · ')
}

/** що це за джерело — для спливного опису над карткою (gamefiles — файли гри, решта — назви сайтів) */
export function sourceAbout(name: string): string | null {
  switch (name) {
    case 'gamefiles': return t('Сервер гри зі Steam, розібраний нашим видобувачем: дані точно як у грі, без посередників.')
    case 'questlog.gg': return t('Сайт-база гри: предмети, пристрої, рецепти, дерево умінь.')
    case 'awakening.wiki': return t('Вікі спільноти: будівельні модулі з вартістю, частина предметів.')
    case 'gaming.tools': return t('База гри з перекладами назв і значеннями умінь.')
    case 'TH.GL': return t('Інтерактивна мапа: тайли, точки, розкладки Глибокої пустелі, іконки.')
    default: return null
  }
}

/** «+12 · −3 · змінено 40»; зміна без записів (мапа, картинки) — «змінено» */
export function summaryText(s: GdSummary): string {
  const parts = [s.added ? `+${s.added}` : '', s.removed ? `−${s.removed}` : '', s.changed ? t('змінено {n}', { n: s.changed }) : ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : t('змінено')
}

/**
 * Дата для підпису «оновлено …»: найпізніша реальна зміна серед розділів, а де змін ще не було — відколи за розділом
 * стежимо. Час останньої перевірки не годиться: він рухається щодесять хвилин без жодних змін у даних
 */
export function stampTime(sections: GdSection[], ids: string[]): number | null {
  const t = sections.filter((x) => ids.includes(x.id)).map((x) => x.changedAt ?? x.since ?? 0)
  const max = Math.max(0, ...t)
  return max || null
}

let pending: Promise<GdStatus | null> | null = null
/** стан ігрових даних (один запит на сесію сторінки): undefined — ще вантажиться, null — збій (підписи просто не показуються) */
export function useGdStatus(): GdStatus | null | undefined {
  const [s, setS] = useState<GdStatus | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    pending ??= get<GdStatus>('/api/gamedata/status').catch(() => { pending = null; return null })
    pending.then((v) => { if (live) setS(v) })
    return () => { live = false }
  }, [])
  return s
}

export const getChanges = (before?: number | null) => get<{ items: GdChange[]; next: number | null }>(`/api/gamedata/changes?limit=30${before ? `&before=${before}` : ''}`)

/**
 * «Що змінилось у патчі»: стрічка патчів гри й один патч (server/routes/patches.mjs). Назви — уже мовою людини (loc;
 * нема перекладу — null: такий запис службовий, сайт його не показує). Підписи полів і розділів — тут.
 */
import { get } from './api'
import { t } from './i18n'

export type PatchSection = 'items' | 'placeables' | 'recipes' | 'buildables' | 'skills'
export const PATCH_SECTIONS: PatchSection[] = ['items', 'placeables', 'recipes', 'buildables', 'skills']
export type Counts = { added: number; removed: number; changed: number }

export interface PatchHead {
  build: string
  prevBuild: string
  version: string | null
  prevVersion: string | null
  extractedAt: number | null
  summary: Partial<Record<PatchSection, Counts>>
}

export interface PatchCard {
  id: string
  name?: string
  loc: string | null
  icon?: string
  img?: string
  grade?: number
  rarity?: string
  cat?: string
  school?: string
  out?: [string, number][]
  kind?: string
}
export type FieldChange = [string, unknown, unknown]
export interface PatchChanged extends PatchCard {
  fields: FieldChange[]
  /** назва чи опис змінились (англійською — так вирішує сервер) */
  textChanged?: ('name' | 'desc')[]
  /** назва й опис мовою людини: [було, стало] */
  text?: { name?: [string | null, string | null]; desc?: [string | null, string | null] }
}
export interface Patch extends PatchHead {
  sections: Partial<Record<PatchSection, { added: PatchCard[]; removed: PatchCard[]; changed: PatchChanged[] }>>
  map: { skipped: 'extractor' } | { counts: Record<string, { map: string; type: string; was: number; now: number }[]> } | null
  refs: Record<string, PatchCard & { kind: 'item' | 'placeable' }>
}

export const listPatches = () => get<{ items: PatchHead[] }>('/api/patches')
export const getPatch = (build: string) => get<Patch>(`/api/patches/${encodeURIComponent(build)}`)

export const sectionTitle = (s: PatchSection) => ({ items: t('Предмети'), placeables: t('Пристрої'), recipes: t('Рецепти'), buildables: t('Будівельні модулі'), skills: t('Уміння') })[s]

/** лічильники патча разом */
export function totals(summary: PatchHead['summary']): Counts {
  return Object.values(summary).reduce<Counts>((a, x) => ({ added: a.added + (x?.added ?? 0), removed: a.removed + (x?.removed ?? 0), changed: a.changed + (x?.changed ?? 0) }), { added: 0, removed: 0, changed: 0 })
}
export const hasChanges = (summary: PatchHead['summary']) => { const s = totals(summary); return s.added + s.removed + s.changed > 0 }

/** підпис поля запису гри (невідоме поле — «інше», а не сирий англійський ключ) */
export function fieldLabel(k: string): string {
  const L: Record<string, string> = {
    name: t('Назва'), desc: t('Опис'), icon: t('Іконка'), img: t('Зображення'), grade: t('Тір'), cat: t('Розділ'), sub: t('Підрозділ'),
    kind: t('Вид'), rarity: t('Рідкість'), stack: t('Розмір стосу'), volume: t('Об’єм'), power: t('Енергія'), water: t('Вода'),
    waterRate: t('Витрата води'), time: t('Час виготовлення'), at: t('Де виготовляють'), in: t('Інгредієнти'), out: t('Результат'),
    set: t('Будівельний набір'), group: t('Група'), health: t('Міцність'), cost: t('Вартість'), school: t('Школа'),
    x: t('Місце в дереві'), y: t('Місце в дереві'), max: t('Рангів'), levels: t('Ранги'), and: t('Потрібні вміння'), or: t('Потрібне одне з умінь'),
  }
  return L[k] ?? t('Інші властивості')
}

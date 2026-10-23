/**
 * Картка гільдії й набір — як їх віддає сервер (server/lib/guild-profile.mjs, routes/guilds.mjs): типи, підписи
 * регіонів, стилів гри, мов і поясів (мовою сайту — з Intl), розміри для фільтра каталогу.
 */
import { LANGS, locale, t } from './i18n'
import { REGIONS, type Region } from './ddReset'
import type { Slot } from './weekly'
import { utcLabel, tzName } from './weekly'

export type Style = 'pve' | 'pvp' | 'dd' | 'craft' | 'trade'
export const STYLES: Style[] = ['pve', 'pvp', 'dd', 'craft', 'trade']
export const STYLE_LABEL: Record<Style, string> = { pve: t('PvE'), pvp: t('PvP'), dd: t('Глибока пустеля'), craft: t('Крафт'), trade: t('Торгівля') }
export const REGION_IDS = Object.keys(REGIONS) as Region[]
export const regionLabel = (r: string | null | undefined) => (r && r in REGIONS ? REGIONS[r as Region].label : '')

/** блоки сторінки гільдії, видимість яких налаштовує офіцер */
export type Block = 'about' | 'rules' | 'requirements' | 'schedule' | 'links' | 'officers' | 'members' | 'bases' | 'events' | 'map'
export const BLOCKS: Block[] = ['about', 'rules', 'requirements', 'schedule', 'links', 'officers', 'members', 'bases', 'events', 'map']
export const BLOCK_LABEL: Record<Block, string> = {
  about: t('Про гільдію'), rules: t('Правила'), requirements: t('Вимоги до новачків'), schedule: t('Розклад активності'), links: t('Discord і Telegram'),
  officers: t('Керівництво'), members: t('Склад гільдії'), bases: t('Публічні бази'), events: t('Найближчі події'), map: t('Мітка бази на мапі'),
}

export type QuestionType = 'text' | 'choice' | 'level' | 'hours'
export const QUESTION_TYPES: QuestionType[] = ['text', 'choice', 'level', 'hours']
export const QUESTION_LABEL: Record<QuestionType, string> = { text: t('Текст'), choice: t('Вибір'), level: t('Рівень гравця'), hours: t('Години онлайну') }
export const QUESTION_HINT: Record<QuestionType, string> = {
  text: t('Відповідь своїми словами'), choice: t('Один чи кілька варіантів зі списку'), level: t('Число від 1 до 200'), hours: t('Дні й години, коли кандидат у грі'),
}
export const LEVEL_MAX = 200
export const MAX_QUESTIONS = 12
export interface Question { id: string; type: QuestionType; label: string; required: boolean; options?: string[]; multi?: boolean }
export interface GuildForm { intro: string; questions: Question[] }

export interface GuildProfile {
  server: string
  region: Region | null
  tz: string | null
  langs: string[]
  styles: Style[]
  rules: string
  requirements: string
  schedule: Slot[]
  links: { discord: string; telegram: string }
  emblem: string | null
  /** офіцерам — 'public' | 'guild'; іншим — 'public' (видно) чи 'hidden' */
  show: Record<Block, 'public' | 'guild' | 'hidden'>
  form: GuildForm
}
/** що з картки є в каталозі */
export interface CardProfile { server: string; region: Region | null; tz: string | null; langs: string[]; styles: Style[]; emblem: string | null; schedule: Slot[]; questions: number }

export type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'closed'
export const STATUS_LABEL: Record<RequestStatus, string> = { pending: t('чекає розгляду'), accepted: t('прийнято'), rejected: t('відхилено'), withdrawn: t('відкликано'), closed: t('закрито') }
export type Answer = string | number | string[] | Slot[]
export interface MyRequest { guild: { id: string; slug: string; name: string; tag: string; color: string }; status: RequestStatus; reason: string; created: number; decided: number | null }
export interface OwnRequest { status: RequestStatus; reason: string; created: number; decided: number | null; note: string; answers: Record<string, Answer> }
export interface Application {
  id: string; login: string; name: string; nick: string; color: string; note: string; created: number; status: RequestStatus
  answers: Record<string, Answer>; tz: string | null; reason: string; decided: number | null; decidedBy: string | null
  comments: { id: string; by: string | null; color: string | null; text: string; created: number }[]
}

/** назва мови мовою сайту (Intl), запасна — самоназва з LANGS */
export function langLabel(code: string): string {
  try {
    const n = new Intl.DisplayNames([locale()], { type: 'language' }).of(code)
    if (n && n !== code) return n
  } catch { /* старий браузер */ }
  return LANGS.find((l) => l.code === code)?.name ?? code
}
export const LANG_CODES = LANGS.map((l) => l.code)

/** поширені пояси гравців (від заходу на схід) — картками в налаштуваннях; свій пояс браузера додається окремо */
export const COMMON_TZ = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Berlin', 'Europe/Warsaw', 'Europe/Kyiv', 'Europe/Istanbul', 'Europe/Moscow',
  'Asia/Shanghai', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Sydney',
]
/** «UTC+2 · за східноєвропейським часом» (назва — мовою сайту; не знає — лише UTC) */
export const tzLabel = (tz: string | null | undefined) => (tz ? [utcLabel(tz), tzName(tz)].filter(Boolean).join(' · ') : '')

/** розмір гільдії — для фільтра каталогу */
export type Size = 'small' | 'mid' | 'large'
export const SIZES: Size[] = ['small', 'mid', 'large']
export const SIZE_LABEL: Record<Size, string> = { small: t('до 10'), mid: t('10–20'), large: t('понад 20') }
export const sizeOf = (n: number): Size => (n < 10 ? 'small' : n <= 20 ? 'mid' : 'large')

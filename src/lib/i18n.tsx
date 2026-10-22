/**
 * Мови сайту (як gettext): у коді — український текст, t('Бази') повертає його переклад вибраною мовою (немає
 * перекладу — сам український текст). Заповнювачі — {назва}: t('через {n} с', { n: 5 }). Розмітка всередині
 * речення — <T text="Надіслали на {email}." email={<b>…</b>} />.
 *
 * Словник мови приходить з /api/i18n/<мова> (файли locales/*.json + правки з панелі) і лежить у localStorage, тож
 * наступне відкриття — одразу потрібною мовою. Його завантажують ДО першого імпорту застосунку (main.tsx) — тому t()
 * працює й у константах модулів. Зміна мови — перезавантаження сторінки: усе перекладається заново.
 * Мова: вибрана людиною (localStorage, профіль) → cookie sw_lang → мова браузера → українська. Сервер бачить ту саму
 * (cookie): довідник, уміння, листи й помилки — тією ж мовою.
 */
import { Fragment, type ReactNode } from 'react'

export interface Lang { code: string; name: string }
export const LANGS: Lang[] = [
  { code: 'uk', name: 'Українська' }, { code: 'en', name: 'English' }, { code: 'de', name: 'Deutsch' }, { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' }, { code: 'it', name: 'Italiano' }, { code: 'pl', name: 'Polski' }, { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'ru', name: 'Русский' }, { code: 'tr', name: 'Türkçe' }, { code: 'ja', name: '日本語' }, { code: 'ko', name: '한국어' },
  { code: 'zh-Hans', name: '简体中文' }, { code: 'zh-Hant', name: '繁體中文' },
]
export const DEFAULT_LANG = 'uk'
const CODES = LANGS.map((l) => l.code)
const norm = (v: string | null | undefined) => (v ? CODES.find((c) => c.toLowerCase() === v.toLowerCase()) ?? null : null)

/** мова з тегу браузера: «pt-PT» → pt-BR, «zh-TW» → zh-Hant */
export function fromTag(tag: string): string | null {
  const t = tag.trim()
  if (/^zh/i.test(t)) return /TW|HK|MO|Hant/i.test(t) ? 'zh-Hant' : 'zh-Hans'
  if (/^pt/i.test(t)) return 'pt-BR'
  return norm(t) ?? norm(t.split('-')[0])
}

const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* без сховища */ } }

async function initialLang(): Promise<string> {
  const saved = norm(read('lang'))
  if (saved) return saved
  const cookie = norm(/(?:^|;\s*)sw_lang=([\w-]+)/.exec(document.cookie)?.[1])
  if (cookie) return cookie
  for (const tag of navigator.languages ?? [navigator.language]) { const l = fromTag(tag); if (l) return l }
  // браузер не каже жодної нашої мови — та, що в налаштуваннях сайту
  try { return norm(((await (await fetch('/api/i18n-default')).json()) as { lang: string }).lang) ?? DEFAULT_LANG } catch { return DEFAULT_LANG }
}

let lang = DEFAULT_LANG
let dict: Record<string, string> = {}

export const currentLang = () => lang
/** код мови в dune.gaming.tools (дані гри всіма мовами): «pt-br», «zh-hans» */
export const gtLang = (l = lang) => ({ 'pt-BR': 'pt-br', 'zh-Hans': 'zh-hans', 'zh-Hant': 'zh-hant' } as Record<string, string>)[l] ?? l

/** BCP 47 для дат і чисел: «uk-UA», «en-GB», «zh-Hans» */
export const locale = () => ({ uk: 'uk-UA', en: 'en-GB', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pl: 'pl-PL', ru: 'ru-RU', tr: 'tr-TR', ja: 'ja-JP', ko: 'ko-KR' } as Record<string, string>)[lang] ?? lang

const fill = (s: string, vars?: Record<string, unknown>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s)

/** переклад тексту; немає — сам текст (українська) */
export function t(key: string, vars?: Record<string, unknown>): string {
  return fill((lang !== DEFAULT_LANG && dict[key]) || key, vars)
}

/** речення з розміткою: text — ключ із {заповнювачами}, решта пропсів — що підставити (рядки чи React-вузли) */
export function T({ text, ...vars }: { text: string } & Record<string, ReactNode>) {
  const parts = t(text).split(/(\{\w+\})/)
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{(\w+)\}$/.exec(p)
        return <Fragment key={i}>{m && m[1] in vars ? vars[m[1]] : p}</Fragment>
      })}
    </>
  )
}

/**
 * До першого рендеру: мова й словник. Словник лежить у localStorage разом з ETag — сервер на перевірку відповідає 304
 * (крихітна відповідь), тож щоразу звіряємось, але чекаємо щонайбільше ~1,5 с: без мережі — з кешу.
 */
export async function initI18n(): Promise<void> {
  lang = await initialLang()
  document.documentElement.lang = lang
  document.cookie = `sw_lang=${lang}; path=/; max-age=31536000; samesite=lax`
  if (lang === DEFAULT_LANG) return
  let cached: { etag?: string; dict: Record<string, string> } | null = null
  try { cached = JSON.parse(read('i18n:' + lang) || 'null') } catch { cached = null }
  if (cached && !cached.dict) cached = null // давній формат кешу — просто словник
  const fresh = fetchDict(lang, cached?.etag)
  const got = cached ? await Promise.race([fresh, new Promise<null>((ok) => setTimeout(() => ok(null), 1500))]) : await fresh
  dict = got?.dict ?? cached?.dict ?? {}
}
/** словник із сервера; 304 — кеш актуальний (повертає його ж) */
async function fetchDict(l: string, etag?: string): Promise<{ etag?: string; dict: Record<string, string> } | null> {
  try {
    const r = await fetch(`/api/i18n/${l}`, { headers: etag ? { 'if-none-match': etag } : {} })
    if (r.status === 304) { try { return JSON.parse(read('i18n:' + l) || 'null') } catch { return null } }
    if (!r.ok) return null
    const d = { etag: r.headers.get('etag') ?? undefined, dict: ((await r.json()) as { dict: Record<string, string> }).dict }
    write('i18n:' + l, JSON.stringify(d))
    return d
  } catch {
    return null
  }
}

/** змінити мову: запам'ятати (і в профілі, якщо увійшли) й перезавантажити сторінку */
export async function setLang(next: string, { save }: { save?: (l: string) => Promise<unknown> } = {}) {
  const l = norm(next) ?? DEFAULT_LANG
  write('lang', l)
  document.cookie = `sw_lang=${l}; path=/; max-age=31536000; samesite=lax`
  await save?.(l).catch(() => {})
  if (l !== DEFAULT_LANG) await fetchDict(l) // одразу в кеш — після перезавантаження без очікування
  location.reload()
}

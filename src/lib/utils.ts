import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { locale } from './i18n'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 12345 → «12 345» (групи розрядів — як заведено мовою сайту: «12,345» англійською) */
export const fmtN = (n: number) => Math.round(n).toLocaleString(locale(), { maximumFractionDigits: 0 })
/** форми слова до числа — уже перекладені: [t('ресурс'), t('ресурси'), t('ресурсів')] (1 / 3 / 12) */
export type Forms = [string, string, string]
/** слово до числа за правилами мови сайту (Intl.PluralRules): «one» — перша форма, «few» — друга, решта — третя */
export function word(n: number, [one, few, many]: Forms) {
  const c = new Intl.PluralRules(locale()).select(n)
  return c === 'one' ? one : c === 'few' ? few : many
}
/** «12 ресурсів» */
export const plural = (n: number, f: Forms) => `${fmtN(n)} ${word(n, f)}`
/** дробове, один знак: 1.5 → «1,5» (роздільник — як заведено мовою сайту) */
export const fmtP = (n: number) => (Math.round(n * 10) / 10).toLocaleString(locale(), { maximumFractionDigits: 1 })
/** «Промислові помпи (Industrial Pump)» → ['Промислові помпи', 'Industrial Pump'] */
export function splitEn(s: string): [string, string | null] {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(s || '')
  return m && m[1] ? [m[1], m[2]] : [s, null]
}

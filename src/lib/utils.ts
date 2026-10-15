import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 12345 → «12 345»: тонкі групи розрядів, як у грі й у старій сторінці */
export const fmtN = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
/** дробове з комою: 1.5 → «1,5» */
export const fmtP = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')
/** «Промислові помпи (Industrial Pump)» → ['Промислові помпи', 'Industrial Pump'] */
export function splitEn(s: string): [string, string | null] {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(s || '')
  return m && m[1] ? [m[1], m[2]] : [s, null]
}

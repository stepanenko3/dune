/**
 * Речі з власником і видимістю (бази, роадмапи, білди, позначки, записи ресурсів) — як їх віддає сервер (реєстр
 * речей, server/lib/items.mjs), і дії над ними: доступ, зірка, копія собі, бібліотека.
 */
import { get, patch, post } from './api'
import { t } from './i18n'

export type Kind = 'base' | 'roadmap' | 'build' | 'calc' | 'marker' | 'place'
export type Visibility = 'private' | 'guild' | 'link' | 'public'
export interface Owner {
  /** site — сам сайт (офіційний вміст від адміністрації) */
  kind: 'user' | 'guild' | 'site'
  id: string
  name: string
  color: string
  login?: string
  slug?: string
  tag?: string
}
export interface Can {
  view: boolean
  edit: boolean
  manage: boolean
  /** віддати іншому власнику, стерти назавжди (у гільдії — лідер) */
  own?: boolean
  /** копіювати можна (за правами речі) і куди */
  copy?: boolean
  copyTo?: ('user' | 'guild')[]
}
export interface Item {
  kind: Kind
  id: string
  title: string
  summary: string
  visibility: Visibility
  owner: Owner
  by: { id: string; login: string; name: string } | null
  basedOn: { kind: Kind; id: string; title: string; owner: string } | null
  hidden: boolean
  featured: boolean
  stars: number
  copies: number
  created: number
  updated: number
  published: number | null
  can?: Can
  starred?: boolean
  /** база в кошику (коли видалили); інші речі — без кошика */
  deleted?: number | null
}

export const KIND_LABEL: Record<Kind, [string, string]> = {
  base: [t('База'), t('Бази')],
  roadmap: [t('Роадмап'), t('Роадмапи')],
  build: [t('Білд'), t('Білди')],
  calc: [t('Розрахунок'), t('Розрахунки')],
  marker: [t('Позначка'), t('Позначки')],
  place: [t('Запис ресурсу'), t('Ресурси')],
}

/** адреса речі на сайті */
export function hrefOf(it: Pick<Item, 'kind' | 'id'>): string {
  if (it.kind === 'base') return `/bases/${it.id}`
  if (it.kind === 'roadmap') return `/roadmap/${it.id}`
  if (it.kind === 'build') return `/skills?build=${it.id}`
  if (it.kind === 'calc') return `/calculator?calc=${it.id}`
  if (it.kind === 'marker') return `/map?marker=${it.id}`
  return `/map?r=${it.id}`
}

export const setAccess = (it: Pick<Item, 'kind' | 'id'>, owner: { kind: 'user' | 'guild' | 'site'; id: string } | null, visibility: Visibility) =>
  patch<{ item: Item }>(`/api/items/${it.kind}/${it.id}/access`, { ...(owner ? { owner } : {}), visibility }).then((r) => r.item)
export const star = (it: Pick<Item, 'kind' | 'id'>, on: boolean) => post<{ stars: number; starred: boolean }>(`/api/items/${it.kind}/${it.id}/star`, { on })
/** копія собі (чи гільдії); progress — роадмап: перенести позначки, які людина бачить, у копію */
export const copyItem = (it: Pick<Item, 'kind' | 'id'>, owner?: { kind: 'user' | 'guild' | 'site'; id: string }, opts?: { progress?: boolean }) =>
  post<{ item: Item }>(`/api/items/${it.kind}/${it.id}/copy`, { ...(owner ? { owner } : {}), ...(opts?.progress ? { progress: true } : {}) }).then((r) => r.item)
export const library = (q: { kind?: string; q?: string; sort?: string; offset?: number }) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') s.set(k, String(v))
  return get<{ rows: Item[]; total: number }>(`/api/library?${s}`)
}

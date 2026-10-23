/**
 * Сповіщення в Discord і Telegram (server/routes/notify.mjs): канали людини й її гільдії, теми, підключення.
 */
import { del, get, patch, post } from './api'
import { t } from './i18n'

export type Topic = 'event.new' | 'event.soon' | 'patch.new'
export type ChannelKind = 'discord' | 'telegram'
export type Owner = { kind: 'user' | 'guild'; id: string }

export interface Channel {
  id: string
  kind: ChannelKind
  label: string | null
  topics?: Topic[]
  lang?: string
  enabled: boolean
  error?: string | null
  created?: number
  lastSent?: number | null
}
export interface OwnerBlock {
  owner: Owner
  guild: { id: string; slug: string; name: string; tag: string | null } | null
  manage: boolean
  channels: Channel[]
}
export interface NotifyState { topics: Topic[]; kinds: ChannelKind[]; telegram: boolean; owners: OwnerBlock[] }
export interface TelegramLink { code: string; bot: string; private: string; group: string; expires: number }

export const loadNotify = () => get<NotifyState>('/api/notify')
export const addDiscord = (owner: Owner, url: string, topics: Topic[]) => post<Channel>('/api/notify/channels', { owner, kind: 'discord', url, topics })
export const updateChannel = (id: string, p: { topics?: Topic[]; enabled?: boolean; lang?: 'current' }) => patch<Channel>(`/api/notify/channels/${id}`, p)
export const removeChannel = (id: string) => del<{ ok: true }>(`/api/notify/channels/${id}`)
export const testChannel = (id: string) => post<{ ok: boolean; error: string | null; channel: Channel }>(`/api/notify/channels/${id}/test`)
export const telegramLink = (owner: Owner, topics: Topic[]) => post<TelegramLink>('/api/notify/telegram/link', { owner, topics })
export const linkStatus = (code: string, owner: Owner) =>
  get<{ state: 'waiting' | 'done' | 'gone'; channel?: Channel }>(`/api/notify/telegram/link/${encodeURIComponent(code)}?owner=${owner.kind}:${encodeURIComponent(owner.id)}`)

export const topicLabel = (x: Topic) => ({ 'event.new': t('Нові події'), 'event.soon': t('Подія почнеться за 30 хв'), 'patch.new': t('Новий патч гри') })[x]
export const topicHint = (x: Topic, guild: boolean) =>
  ({
    'event.new': guild ? t('події гільдії й публічні події спільноти') : t('події твоєї гільдії й публічні події спільноти'),
    'event.soon': guild ? t('події гільдії') : t('твої події й події твоєї гільдії'),
    'patch.new': t('коли нова збірка гри щось змінила в довіднику'),
  })[x]
export const kindLabel = (k: ChannelKind) => (k === 'discord' ? 'Discord' : 'Telegram')

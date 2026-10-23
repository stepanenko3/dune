/**
 * Сповіщення сайту (server/routes/notifications.mjs): список, «прочитано», лічильник непрочитаних; текст і куди веде —
 * за видом (тут, мовою сайту); у даних — лише id.
 */
import { get, post } from './api'
import { t } from './i18n'
import { dealHref, listingHref } from './market'

export interface Note { id: string; kind: string; data: Record<string, unknown>; count: number; read: boolean; created: number }
export const listNotes = (before?: number) => get<{ rows: Note[]; unread: number }>(`/api/notifications${before ? `?before=${before}` : ''}`)
export const readNotes = (ids: string[] | 'all') => post<{ unread: number }>('/api/notifications/read', ids === 'all' ? { all: true } : { ids })

/**
 * Свої види сповіщень (гільдії, бот…): noteKind('guild.application.new', (n) => ({ text: t('…'), href: '/g/…' })).
 * Зареєстроване перекриває вбудоване; невідомий вид — «Нове сповіщення».
 */
type NoteText = (n: Note) => { text: string; href: string }
const KINDS = new Map<string, NoteText>()
export const noteKind = (kind: string, fn: NoteText) => { KINDS.set(kind, fn) }

/** текст сповіщення (без назви предмета — її малює сторінка поруч) і адреса, куди веде */
export function noteOf(n: Note): { text: string; href: string } {
  const own = KINDS.get(n.kind)
  if (own) return own(n)
  const d = n.data as { listing?: string; deal?: string; action?: string; n?: number }
  const deal = d.deal ? dealHref(d.deal) : '/market/deals'
  const listing = d.listing ? listingHref(d.listing) : '/market/mine'
  switch (n.kind) {
    case 'market.match': return { text: d.n ? t('Є зустрічні заявки на твоє оголошення') : t('Зустрічна заявка на твоє оголошення'), href: listing }
    case 'market.offer': return { text: t('Нова пропозиція угоди'), href: deal }
    case 'market.accepted': return { text: t('Твою пропозицію прийняли — домовтеся в листуванні'), href: deal }
    case 'market.declined': return { text: t('Твою пропозицію відхилили'), href: deal }
    case 'market.cancelled': return { text: t('Угоду скасовано'), href: deal }
    case 'market.done': return { text: t('Друга сторона завершила угоду — підтверди й ти'), href: deal }
    case 'market.rate': return { text: t('Угоду завершено — оціни другу сторону'), href: deal }
    case 'market.expired': return { text: t('Оголошення закінчилось — продовж його одним кліком'), href: listing }
    case 'market.moderated': return {
      text: d.action === 'autohide' ? t('Твоє оголошення сховано через скарги на реальні гроші — модератор перевірить') : d.action === 'close' ? t('Модератор закрив твоє оголошення') : d.action === 'unhide' ? t('Модератор повернув твоє оголошення в стрічку') : t('Модератор сховав твоє оголошення'),
      href: listing,
    }
    case 'market.banned': return { text: t('Тобі заборонено торгувати на біржі'), href: '/market' }
    case 'chat.message': {
      const c = n.data as { chat?: string; from?: string; kind?: string }
      const from = c.from || t('Людину видалено')
      return { text: n.count > 1 ? t('Нові повідомлення від {name}: {n}', { name: from, n: n.count }) : t('Нове повідомлення від {name}', { name: from }), href: c.chat ? `/chats/${c.chat}` : '/chats' }
    }
    default: return { text: t('Нове сповіщення'), href: '/' }
  }
}

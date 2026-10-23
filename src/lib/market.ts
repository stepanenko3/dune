/**
 * Біржа — як її віддає сервер (server/routes/market.mjs): типи, виклики API, підписи (вид, оплата, строк, стан угоди,
 * причини скарг), що продається (той самий фільтр, що на сервері: прапорець гри HideFromExchange тощо), числа й час.
 */
import { del, get, patch, post, put } from './api'
import { isDevEntry, type CatalogIndex, type CItem } from './catalog'
import { locale, t } from './i18n'
import type { Region } from './ddReset'
import type { Item, Owner } from './items'
import { fmtN } from './utils'

export type Side = 'buy' | 'sell'
export type Pay = 'solari' | 'barter' | 'both'
export type ListingStatus = 'open' | 'closed' | 'expired'
export type DealStatus = 'offered' | 'accepted' | 'done' | 'declined' | 'cancelled'
export type Reason = 'rmt' | 'scam' | 'spam' | 'wrong' | 'abuse' | 'other'
export type Section = 'resources' | 'weapon' | 'garment' | 'tool' | 'vehicle' | 'schematic'
export interface Point { map: string; x: number; y: number; layout?: number }
export type Place = { kind: 'point'; point: Point } | { kind: 'base'; base: string | null; title?: string } | { kind: 'text'; text: string } | null
export interface Barter { gid: string; qty: number }
export interface Rep { avg: number | null; n: number; done: number }
export interface Person { id: string; login: string; name: string; color: string }

/** документ оголошення (те, що пише редактор) */
export interface ListingDoc {
  side: Side
  gid: string
  qty: number
  minQty: number
  pay: Pay
  price: number | null
  barter: Barter[]
  negotiable: boolean
  region: Region | ''
  world: string
  server: string
  ttl: number
  place: Place
  contact: { site: boolean; nick: string }
  note: string
}
export interface ListingRow {
  id: string
  side: Side
  gid: string
  qty: number
  left: number
  minQty: number
  pay: Pay
  price: number | null
  barter: Barter[]
  negotiable: boolean
  region: Region
  world: string
  server: string
  status: ListingStatus
  expires: number
  fresh: number
  created: number
  updated: number
  item: Item
  rep: Rep | null
}
export interface Deal {
  id: string
  listingId: string
  gid: string
  side: Side
  qty: number
  price: number | null
  barter: Barter[]
  status: DealStatus
  makerDone: number | null
  takerDone: number | null
  region: Region
  world: string
  server: string
  reason: string
  created: number
  updated: number
  closed: number | null
  maker: Person | null
  taker: Person | null
  owner: Owner
  reps: { maker: Rep | null; taker: Rep | null }
}
export interface ListingFull extends ListingRow {
  place: Place
  ttl: number
  note: string
  /** закрив модератор — автор сам не відкриє */
  modClosed: boolean
  contact: { site: boolean; nick?: string; hidden: boolean }
  rights: { edit: boolean; manage: boolean; offer: boolean }
  matches: ListingRow[]
  deals: Deal[]
  myOffer: string | null
}
export interface Rating { score: number; text: string; at: number; updated: number }
export interface DealFull extends Deal {
  role: 'maker' | 'taker' | 'owner' | 'mod'
  listing: { id: string; status: ListingStatus; left: number; expires: number; pay: Pay; price: number | null; barter: Barter[]; minQty: number } | null
  /** розмова угоди (спільні розмови сайту, lib/chat) */
  chat: string | null
  canRate: boolean
  myRating: Rating | null
  theirRating: Rating | null
}
export interface ItemMarket {
  gid: string
  book: { buy: ListingRow[]; sell: ListingRow[]; barter: ListingRow[] }
  stats: { median: number | null; p25: number | null; p75: number | null; n: number; source: 'deals' | 'listings' | null }
  history: { at: number; qty: number; price: number | null; barter: Barter[]; side: Side; region: Region; world: string }[]
}
export interface MarketMe { defaults: { region: Region | ''; world: string; server: string; nick: string } | null; ban: { until: number | null; reason: string } | null; worlds: Partial<Record<Region, string[]>>; moderator: boolean }
export interface UserMarket { rep: Rep; ratings: { score: number; text: string; at: number; from: Person | null; gid: string; role: 'seller' | 'buyer' }[]; listings: ListingRow[]; total: number }
export interface ReportGroup {
  id: string
  kind: 'listing' | 'deal' | 'user'
  target: string
  reasons: Partial<Record<Reason, number>>
  notes: { by: Person | null; reason: Reason; note: string; at: number }[]
  first: number
  last: number
  status: string
  action: string | null
  subject: (ListingRow & { note: string; author: Person | null }) | Deal | (Person & { ban: MarketMe['ban'] }) | null
}

// ---------- API ----------
export type MarketQuery = { scope?: 'all' | 'mine' | 'guild'; guild?: string; side?: string; gid?: string; q?: string; cat?: string; region?: string; world?: string; min?: string; max?: string; fresh?: string; sort?: string; state?: string; limit?: number; offset?: number }
const qs = (q: Record<string, unknown>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== null) s.set(k, String(v))
  return s.toString()
}
export const listMarket = (q: MarketQuery) => get<{ rows: ListingRow[]; total: number }>(`/api/market?${qs(q)}`)
export const getListing = (id: string) => get<ListingFull>(`/api/market/${encodeURIComponent(id)}`)
export const createListing = (body: ListingDoc & { owner?: { kind: string; id: string }; visibility?: string; rules: boolean }) => post<ListingFull>('/api/market', body)
export const saveListing = (id: string, body: ListingDoc & { base?: number }) => put<ListingFull>(`/api/market/${id}`, body)
export const closeListing = (id: string) => post<ListingFull>(`/api/market/${id}/close`)
export const renewListing = (id: string, ttl: number) => post<ListingFull>(`/api/market/${id}/renew`, { ttl })
export const deleteListing = (id: string) => del<{ ok: boolean }>(`/api/market/${id}`)
export const marketMe = () => get<MarketMe>('/api/market/me')
export const itemMarket = (gid: string, q: { region?: string; world?: string }) => get<ItemMarket>(`/api/market/item/${encodeURIComponent(gid)}?${qs(q)}`)
export const userMarket = (login: string) => get<UserMarket>(`/api/market/users/${encodeURIComponent(login)}`)
export const myDeals = (state: 'active' | 'done' | 'all') => get<{ rows: Deal[] }>(`/api/market/deals?state=${state}`)
export const getDeal = (id: string) => get<DealFull>(`/api/market/deals/${encodeURIComponent(id)}`)
export type Terms = { qty: number; pay?: 'solari' | 'barter'; price?: number | null; barter?: Barter[] }
export const offerDeal = (listing: string, body: Terms & { text?: string }) => post<DealFull>(`/api/market/${listing}/deals`, body)
export const amendDeal = (id: string, body: Terms) => patch<DealFull>(`/api/market/deals/${id}`, body)
/** updated — версія пропозиції, яку людина бачила (прийняти): змінили тим часом — сервер відповість 409 */
export const dealAction = (id: string, action: 'accept' | 'decline' | 'cancel' | 'done', extra: { reason?: string; updated?: number } = {}) => post<DealFull>(`/api/market/deals/${id}/${action}`, extra)
export const rateDeal = (id: string, score: number, text: string) => post<DealFull>(`/api/market/deals/${id}/rate`, { score, text })
export const report = (target: { kind: 'listing' | 'deal' | 'user'; id: string }, reason: Reason, note: string) => post<{ ok: boolean }>('/api/market/reports', { target, reason, note })
export const listReports = (status: 'open' | 'closed') => get<{ rows: ReportGroup[] }>(`/api/market/reports?status=${status}`)
export const resolveReport = (id: string, body: { action: string; days?: number; user?: string; note?: string }) => post<{ ok: boolean; resolved: number }>(`/api/market/reports/${id}/resolve`, body)

// ---------- що продається (як на сервері: lib/market.mjs) ----------
const NOT_CATS = new Set(['contract', 'swatch'])
const NOT_KINDS = new Set(['HideFromExchange', 'Solaris', 'Abilities', 'HalloweenCurrency'])
export const tradeable = (i: CItem) => !NOT_CATS.has(i.cat) && !NOT_KINDS.has(i.kind ?? '') && !isDevEntry(i)
export const sectionOf = (i: Pick<CItem, 'cat'>): Section => (i.cat === 'misc' ? 'resources' : (i.cat as Section))
/** предмети, що продаються, — з довідника (за назвою мовою сайту) */
export const goodsOf = (ix: CatalogIndex) => ix.cat.items.filter(tradeable)

// ---------- підписи ----------
export const SIDES: Side[] = ['buy', 'sell']
export const SIDE_LABEL: Record<Side, string> = { buy: t('Куплю'), sell: t('Продам') }
export const SIDE_HINT: Record<Side, string> = { buy: t('Шукаєш предмет — продавці побачать твою ціну'), sell: t('Маєш зайве — покупці побачать, скільки й почім') }
export const PAYS: Pay[] = ['solari', 'barter', 'both']
export const PAY_LABEL: Record<Pay, string> = { solari: t('Солари'), barter: t('Бартер'), both: t('Солари чи бартер') }
export const PAY_HINT: Record<Pay, string> = { solari: t('Ціна за штуку в соларах'), barter: t('Предмет за предмет'), both: t('Як зручніше покупцю') }
export const TTLS = [1, 3, 7, 14, 30]
export const SECTIONS: Section[] = ['resources', 'weapon', 'garment', 'tool', 'vehicle', 'schematic']
export const SECTION_LABEL: Record<Section, string> = { resources: t('Ресурси'), weapon: t('Зброя'), garment: t('Одяг'), tool: t('Знаряддя'), vehicle: t('Техніка'), schematic: t('Креслення') }
export const STATUS_LABEL: Record<ListingStatus, string> = { open: t('Відкрите'), closed: t('Закрите'), expired: t('Закінчилось') }
export const DEAL_LABEL: Record<DealStatus, string> = { offered: t('Запропоновано'), accepted: t('Прийнято'), done: t('Завершено'), declined: t('Відхилено'), cancelled: t('Скасовано') }
export const REASONS: Reason[] = ['rmt', 'scam', 'spam', 'wrong', 'abuse', 'other']
export const REASON_LABEL: Record<Reason, string> = { rmt: t('Реальні гроші (RMT)'), scam: t('Шахрайство'), spam: t('Спам'), wrong: t('Не той предмет чи ціна'), abuse: t('Образи'), other: t('Інше') }
export const REASON_HINT: Record<Reason, string> = {
  rmt: t('Просить чи пропонує гроші поза грою'), scam: t('Не віддав обіцяне, обман'), spam: t('Повтори, реклама, не про торгівлю'),
  wrong: t('Неправдивий предмет, кількість чи ціна'), abuse: t('Грубощі, погрози'), other: t('Щось інше — опиши'),
}
export const FRESH = ['', '1', '3', '7'] as const
export const FRESH_LABEL: Record<(typeof FRESH)[number], string> = { '': t('Будь-коли'), '1': t('Останні 24 год'), '3': t('Останні 3 дні'), '7': t('Останній тиждень') }
export const SORTS = ['new', 'cheap', 'dear'] as const
export const SORT_LABEL: Record<(typeof SORTS)[number], string> = { new: t('Нові'), cheap: t('Дешевші'), dear: t('Дорожчі') }

// ---------- числа й час ----------
/** «1 200 Solari» — назва валюти гри не перекладається */
export const fmtSolari = (n: number) => `${fmtN(n)} Solari`
/** «3 д», «5 год», «12 хв тому» — мовою сайту (Intl) */
export function fmtAgo(ms: number, now = Date.now()) {
  const d = (ms - now) / 1000
  const rt = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  const a = Math.abs(d)
  if (a < 60) return rt.format(Math.round(d), 'second')
  if (a < 3600) return rt.format(Math.round(d / 60), 'minute')
  if (a < 86400) return rt.format(Math.round(d / 3600), 'hour')
  return rt.format(Math.round(d / 86400), 'day')
}
export const fmtDate = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
/** оголошення ще діє */
export const isLive = (l: Pick<ListingRow, 'status' | 'expires'>, now = Date.now()) => l.status === 'open' && l.expires > now
/** адреси */
export const listingHref = (id: string) => `/market/${id}`
export const itemHref = (gid: string) => `/market/item/${encodeURIComponent(gid)}`
export const dealHref = (id: string) => `/market/deal/${id}`
/** порожній документ нового оголошення */
export function blankListing(side: Side = 'sell', gid = ''): ListingDoc {
  return { side, gid, qty: 1, minQty: 0, pay: 'solari', price: null, barter: [], negotiable: false, region: '', world: '', server: '', ttl: 7, place: null, contact: { site: true, nick: '' }, note: '' }
}

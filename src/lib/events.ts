/**
 * Події спільноти — як їх віддає сервер (server/routes/events.mjs): типи, виклики API, підписи виду й формату, час
 * у людини і в поясі серверів регіону гри, стан (скоро / триває / завершено / скасовано), посилання в Google Календар,
 * файл .ics і текст оголошення для Discord (там <t:…:F> показує час кожному в його поясі).
 */
import { del, get, patch, post, put } from './api'
import { locale, t } from './i18n'
import { REGIONS, type Region } from './ddReset'
import type { Item } from './items'

export type EventType = 'pvp' | 'tournament' | 'race' | 'pve' | 'spice' | 'build' | 'trade' | 'meet' | 'other'
export type TeamStatus = 'pending' | 'confirmed' | 'reserve' | 'rejected'
export type RegState = 'open' | 'closed' | 'ended' | 'cancelled'
/** точка на мапі гри (як у позначок): мапа, координати, у Глибокій пустелі — розкладка тижня */
export interface Point { map: string; x: number; y: number; layout?: number }
export interface Reg { open: boolean; teamSize: number; slots: number; approval: boolean; closes: number | null }
export interface Prize { label: string; prize: string }
export interface Result { team: string | null; name: string }
/** хто переміг у матчі: верхня, нижня чи ще не зіграно */
export type Win = 'a' | 'b' | null
export interface Bracket { seed: (string | null)[]; picks: Win[][] }

export interface EventDoc {
  title: string
  type: EventType
  about: string
  rules: string
  starts: number
  /** хвилин */
  duration: number
  region: Region | ''
  server: string
  place: string
  arena: Point | null
  watch: Point | null
  watchNote: string
  reg: Reg
  prizes: Prize[]
  fee: string
  contact: string
  stream: string
  cancelled: boolean
  cancelNote: string
  results: Result[]
  resultsNote: string
  bracket: Bracket | null
}
export interface Person { id: string; login: string; name: string; color: string }
export interface Team {
  id: string
  name: string
  status: TeamStatus
  created: number
  captain: Person | null
  members: { nick: string; user: Person | null }[]
  /** людина в цій команді (капітан чи гравець) */
  mine: boolean
  /** лише організаторам і самій команді */
  note?: string
  /** код приєднання — капітану й організаторам */
  code?: string
}
export interface Counts { confirmed: number; pending: number; reserve: number; rejected: number; watchers: number }
export interface EventFull extends EventDoc {
  id: string
  created: number
  updated: number
  ends: number
  regState: RegState
  item: Item
  rights: { edit: boolean; manage: boolean }
  teams: Team[]
  counts: Counts
  me: { team: string | null; watching: boolean }
}
/** подія в списку — без довгих текстів; bracket — лише «чи є сітка» */
export interface EventRow extends Omit<EventDoc, 'about' | 'rules' | 'bracket' | 'resultsNote'> {
  id: string
  ends: number
  regState: RegState
  item: Item
  counts: Counts
  me: { team?: string; watching?: boolean } | null
  bracket: boolean
}

// ---------- API ----------
export type EventsQuery = { when?: 'upcoming' | 'past'; scope?: 'all' | 'mine' | 'guild'; guild?: string; type?: string; region?: string; q?: string; limit?: number; offset?: number }
export function listEvents(q: EventsQuery) {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== null) s.set(k, String(v))
  return get<{ rows: EventRow[]; total: number }>(`/api/events?${s}`)
}
export const getEvent = (id: string) => get<EventFull>(`/api/events/${encodeURIComponent(id)}`)
export const createEvent = (body: Partial<EventDoc> & { owner?: { kind: string; id: string }; visibility?: string }) => post<EventFull>('/api/events', body)
export const saveEvent = (id: string, body: Partial<EventDoc> & { base?: number }) => put<EventFull>(`/api/events/${id}`, body)
export const deleteEvent = (id: string) => del<{ ok: boolean }>(`/api/events/${id}`)
export const watchEvent = (id: string, on: boolean) => post<{ watching: boolean; watchers: number }>(`/api/events/${id}/watch`, { on })
export const registerTeam = (id: string, body: { name?: string; members: string[]; note?: string }) => post<EventFull>(`/api/events/${id}/teams`, body)
export const patchTeam = (id: string, tid: string, body: { name?: string; members?: { nick: string; user?: string | null }[]; note?: string; status?: TeamStatus }) => patch<EventFull>(`/api/events/${id}/teams/${tid}`, body)
export const dropTeam = (id: string, tid: string) => del<EventFull>(`/api/events/${id}/teams/${tid}`)
/** slot — місце з ніком, вписаним капітаном («це я»); склад повний і нік не збігся — сервер відповідає 409 з pick */
export const joinTeam = (id: string, tid: string, code: string, slot?: number) => post<EventFull>(`/api/events/${id}/teams/${tid}/join`, { code, slot })
export const leaveTeam = (id: string, tid: string) => post<EventFull>(`/api/events/${id}/teams/${tid}/leave`)

// ---------- підписи ----------
export const EVENT_TYPES: EventType[] = ['pvp', 'tournament', 'race', 'pve', 'spice', 'build', 'trade', 'meet', 'other']
/** ті самі українські назви, що й на сервері (lib/events.mjs: EVENT_TYPE_L) — ключі перекладу спільні */
export const TYPE_LABEL: Record<EventType, string> = {
  pvp: t('Бій'), tournament: t('Турнір'), race: t('Перегони'), pve: t('PvE-вилазка'), spice: t('Спайс-ран'),
  build: t('Конкурс баз'), trade: t('Ярмарок'), meet: t('Збір'), other: t('Подія'),
}
export const TYPE_HINT: Record<EventType, string> = {
  pvp: t('Дуель чи команда на команду в домовлений час'),
  tournament: t('Кілька команд і сітка на вибування'),
  race: t('Орнітоптери, багі чи піскоцикли — хто перший'),
  pve: t('Підземелля, уламки чи Глибока пустеля загоном'),
  spice: t('Збір меланжу разом, з охороною й транспортом'),
  build: t('Хто збудує найкращу базу'),
  trade: t('Торгівля й обмін на місці зустрічі'),
  meet: t('Збір гільдії чи спільноти'),
  other: t('Усе інше'),
}
export const STATUS_LABEL: Record<TeamStatus, string> = { pending: t('Чекає рішення'), confirmed: t('Бере участь'), reserve: t('У резерві'), rejected: t('Відхилено') }
/** «2 на 2» чи «кожен сам за себе» (той самий текст, що й на сервері) */
export const formatOf = (teamSize: number) => (teamSize > 1 ? t('{n} на {n}', { n: teamSize }) : t('кожен сам за себе'))
/** команди чи учасники — за форматом */
export const teamWord = (teamSize: number) => (teamSize > 1 ? t('Команди') : t('Учасники'))

/** де подія зараз: скасовано, завершено, триває, скоро (до доби), заплановано */
export type Phase = 'cancelled' | 'ended' | 'live' | 'soon' | 'upcoming'
export function phaseOf(ev: Pick<EventDoc, 'cancelled' | 'starts'> & { ends: number }, now = Date.now()): Phase {
  if (ev.cancelled) return 'cancelled'
  if (now >= ev.ends) return 'ended'
  if (now >= ev.starts) return 'live'
  return ev.starts - now < 86400_000 ? 'soon' : 'upcoming'
}
export const PHASE_LABEL: Record<Phase, string> = { cancelled: t('Скасовано'), ended: t('Завершено'), live: t('Триває'), soon: t('Скоро'), upcoming: t('Заплановано') }

// ---------- час ----------
/** за часом людини: «сб, 25 жовтня, 20:00» */
export const fmtStart = (ms: number) => new Date(ms).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
/** коротко для карток: «25 жовт., 20:00» */
export const fmtShort = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
/** за часом серверів регіону, з поясом: «19:00 CEST» (регіону нема — null) */
export function fmtServer(ms: number, region: Region | '') {
  const r = region ? REGIONS[region] : null
  if (!r) return null
  try { return new Date(ms).toLocaleString(locale(), { timeZone: r.tz, weekday: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) } catch { return null }
}
/** тривалість: «1 год 30 хв», «2 год», «45 хв», «2 д» */
export function fmtDuration(min: number) {
  const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60), m = min % 60
  if (d) return h ? t('{d} д {h} год', { d, h }) : t('{d} д', { d })
  if (h) return m ? t('{h} год {m} хв', { h, m }) : t('{h} год', { h })
  return t('{m} хв', { m })
}
/** пояс браузера людини: «Europe/Kyiv» */
export const myZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return '' } }

// ---------- поділитись ----------
export const eventUrl = (id: string) => `${location.origin}/events/${id}`
const gTime = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
/** посилання «додати в Google Календар» */
export function googleCalendarUrl(ev: EventFull | EventRow) {
  const s = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${gTime(ev.starts)}/${gTime(ev.ends)}`,
    details: `${TYPE_LABEL[ev.type]} · ${formatOf(ev.reg.teamSize)}\n${eventUrl(ev.id)}`,
    location: [ev.server, ev.place].filter(Boolean).join(' · '),
  })
  return `https://calendar.google.com/calendar/render?${s}`
}
/** текст оголошення для Discord: час — міткою <t:…>, Discord сам покаже кожному його час */
export function discordText(ev: EventFull) {
  const unix = Math.floor(ev.starts / 1000)
  const lines = [
    `**${ev.title}**`,
    `🗓 <t:${unix}:F> (<t:${unix}:R>) · ${fmtDuration(ev.duration)}`,
    `⚔ ${TYPE_LABEL[ev.type]} · ${formatOf(ev.reg.teamSize)}${ev.reg.slots ? ` · ${t('місць: {n}', { n: ev.reg.slots })}` : ''}${ev.server ? ` · ${ev.server}` : ''}`,
    ...(ev.place ? [`📍 ${ev.place}`] : []),
    ...(ev.prizes.length ? [`🏆 ${ev.prizes.map((p) => (p.label ? `${p.label}: ${p.prize}` : p.prize)).join('; ')}`] : []),
    ...(ev.watchNote ? [`👁 ${t('Глядачам')}: ${ev.watchNote}`] : []),
    ...(ev.fee ? [`💰 ${t('Внесок')}: ${ev.fee}`] : []),
    ...(ev.cancelled ? [`❌ ${t('Скасовано')}${ev.cancelNote ? `: ${ev.cancelNote}` : ''}`] : []),
    `${ev.regState === 'open' ? t('Реєстрація') : t('Подробиці')}: ${eventUrl(ev.id)}`,
  ]
  return lines.join('\n')
}

/** посилання в команду (його дає капітан согравцям): сторінка події з ?join=<команда>.<код> */
export const joinUrl = (eventId: string, team: Pick<Team, 'id' | 'code'>) => `${eventUrl(eventId)}?join=${team.id}.${team.code}`

/** порожня нова подія: через два дні о 20:00 за часом людини, 2 години, 2 на 2 на 8 команд */
export function blankEvent(): EventDoc {
  const d = new Date(Date.now() + 2 * 86400_000)
  d.setHours(20, 0, 0, 0)
  return {
    title: '', type: 'pvp', about: '', rules: '', starts: d.getTime(), duration: 120, region: '', server: '', place: '',
    arena: null, watch: null, watchNote: '', reg: { open: true, teamSize: 2, slots: 8, approval: false, closes: null },
    prizes: [], fee: '', contact: '', stream: '', cancelled: false, cancelNote: '', results: [], resultsNote: '', bracket: null,
  }
}

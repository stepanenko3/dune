/**
 * Активні поля меланжу — позначки гравців (сервер: server/lib/spice.mjs). Поле активне від першої позначки, яку
 * людина бачить; наступні лише підтверджують його; строк — перша позначка + час життя поля за величиною. Тут — що
 * видно на поточній мапі (поля й місця великих полів), позначити / зняти й живі оновлення (/api/map/spice/stream:
 * сервер каже лише «на цій мапі щось змінилось» — перечитуємо).
 */
import { create } from 'zustand'
import { del, get, post } from '@/lib/api'
import { locale, t } from '@/lib/i18n'
import { subscribe } from '@/lib/stream'

export type SpiceSize = 'small' | 'medium' | 'large'
export type SpiceVis = 'private' | 'guild' | 'public'
export interface SpiceField {
  size: SpiceSize
  x: number
  y: number
  /** перша позначка (мс) — від неї відлік */
  first: number
  /** коли поле, найімовірніше, зникне */
  expires: number
  /** остання позначка-підтвердження */
  last: number
  /** скільки людей позначили; names — перші з них */
  n: number
  names: string[]
  /** найширша видимість серед позначок */
  vis: SpiceVis
  mine: { id: number; visibility: SpiceVis } | null
}
export interface SpiceSpot { x: number; y: number; src: 'known' | 'marked' }
interface View { ttl: Record<SpiceSize, number>; now: number; spots: SpiceSpot[]; fields: SpiceField[] }

/** тип точок мапи ↔ величина поля */
export const SIZE_OF: Record<string, SpiceSize> = { spice_field_small: 'small', spice_field_medium: 'medium', spice_field_large: 'large' }
export const TYPE_OF: Record<SpiceSize, string> = { small: 'spice_field_small', medium: 'spice_field_medium', large: 'spice_field_large' }
/** ключ поля: величина й округлені координати (так їх зберігає сервер) */
export const fieldKey = (size: string, x: number, y: number) => `${size}@${Math.round(x)}:${Math.round(y)}`

interface S {
  map: string | null
  layout: number | null
  fields: SpiceField[]
  spots: SpiceSpot[]
  /** поле за ключем fieldKey */
  byKey: Map<string, SpiceField>
  /** різниця годинника сервера й браузера (щоб «через N хв» не брехало) */
  skew: number
  /** вибір місця великого поля на мапі */
  picking: boolean
  busy: boolean
  load: (map?: string | null, layout?: number | null) => Promise<void>
  mark: (p: { map: string; layout: number | null; size: SpiceSize; x: number; y: number; visibility: SpiceVis }) => Promise<SpiceField | null>
  unmark: (id: number) => Promise<void>
  setPicking: (on: boolean) => void
}

/** «14:32» */
export const clockOf = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
/** «25 хв» / «1 год 05 хв» */
export function spanText(ms: number) {
  const m = Math.max(1, Math.round(ms / 60_000))
  return m < 60 ? t('{n} хв', { n: m }) : t('{h} год {m} хв', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') })
}
/** «Bob, Eve +3» */
export const namesText = (f: SpiceField) => f.names.join(', ') + (f.n > f.names.length ? ` +${f.n - f.names.length}` : '')
/** хто бачить позначку */
export const VIS_LABEL: Record<SpiceVis, string> = { private: t('для себе'), guild: t('для гільдії'), public: t('для всіх') }

let seq = 0
const index = (fields: SpiceField[]) => new Map(fields.map((f) => [fieldKey(f.size, f.x, f.y), f]))

export const useSpice = create<S>((set, get_) => {
  const apply = (n: number, v: View) => {
    if (n !== seq) return
    set({ fields: v.fields, spots: v.spots, byKey: index(v.fields), skew: v.now - Date.now() })
  }
  return {
    map: null,
    layout: null,
    fields: [],
    spots: [],
    byKey: new Map(),
    skew: 0,
    picking: false,
    busy: false,
    load: async (map, layout) => {
      const m = map === undefined ? get_().map : map
      const l = layout === undefined ? get_().layout : layout
      if (m !== get_().map || l !== get_().layout) set({ map: m, layout: l, fields: [], spots: [], byKey: new Map() })
      if (!m) return
      const n = ++seq
      try {
        apply(n, await get<View>(`/api/map/spice/${m}${l != null ? `?layout=${l}` : ''}`))
      } catch { /* не вдалось — лишаємо, що було; наступна подія чи перехід перечитають */ }
    },
    mark: async (p) => {
      set({ busy: true })
      try {
        const n = ++seq
        const v = await post<View>('/api/map/spice', p)
        apply(n, v)
        // поле могло «прилипнути» до відомого місця — шукаємо найближче своє
        const mine = v.fields.filter((f) => f.size === p.size && f.mine)
        return mine.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0] ?? null
      } finally { set({ busy: false }) }
    },
    unmark: async (id) => {
      set({ busy: true })
      try {
        const n = ++seq
        apply(n, await del<View>(`/api/map/spice/${id}`))
      } finally { set({ busy: false }) }
    },
    setPicking: (picking) => set({ picking }),
  }
})

let soon: ReturnType<typeof setTimeout> | null = null
/** живі оновлення, поки відкрита мапа; після обриву — перечитати. Повертає «відписатися». */
export const liveSpice = () => subscribe('/api/map/spice/stream', (data) => {
  const ev = data as { type?: string; map?: string; layout?: number | null }
  const { map, layout } = useSpice.getState()
  if (ev.type !== 'spice' || ev.map !== map || (ev.layout ?? null) !== layout) return
  // кілька позначок підряд — один перечит
  if (soon) clearTimeout(soon)
  soon = setTimeout(() => { soon = null; void useSpice.getState().load() }, 400)
}, () => void useSpice.getState().load())

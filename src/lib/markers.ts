/**
 * Позначки на мапі: база гільдії, аванпост, ресурс, небезпека, місце збору, нотатка — з власником і видимістю
 * (сервер: /api/markers). Видно мої й гільдійські; публічні чужі — перемикачем. Зміни з інших вкладок — живими
 * оновленнями (liveMarkers, поки відкрита мапа): сервер шле лише тим, хто позначку бачить, і змінюється лише ця
 * позначка, а не перечитується весь список. Тут же — вибрана позначка й «вкажи точку на мапі» для нової.
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { ApiError, del, get, post, put } from './api'
import { t } from './i18n'
import type { Item, Visibility } from './items'
import { subscribe } from './stream'
import { useAuth } from './auth'
import { sharedOwner, upsertRow, usePubMarks } from './map/marks'
import { useMapUi } from './map/ui'

export type MarkerKind = 'base' | 'outpost' | 'resource' | 'danger' | 'meet' | 'note'
/** знак на краплі — перша літера назви виду (мовою сайту); небезпека й нотатка — свої знаки */
const glyphOf = (label: string) => (Array.from(label.trim())[0] ?? '').toUpperCase()
export const MARKER_KINDS: { id: MarkerKind; label: string; glyph: string; color: string }[] = [
  { id: 'base', label: t('База'), glyph: glyphOf(t('База')), color: '#d9481f' },
  { id: 'outpost', label: t('Аванпост'), glyph: glyphOf(t('Аванпост')), color: '#c9a227' },
  { id: 'resource', label: t('Ресурс'), glyph: glyphOf(t('Ресурс')), color: '#2f9e8f' },
  { id: 'danger', label: t('Небезпека'), glyph: '!', color: '#b91c1c' },
  { id: 'meet', label: t('Збір'), glyph: glyphOf(t('Збір')), color: '#6a5acd' },
  { id: 'note', label: t('Нотатка'), glyph: '•', color: '#6b7280' },
]
export const markerKind = (k: string) => MARKER_KINDS.find((x) => x.id === k) ?? MARKER_KINDS[5]

export interface Marker {
  id: string
  map: string
  x: number
  y: number
  layout?: number
  kind: MarkerKind
  title: string
  note: string
  created: number
  updated: number
  item: Item
}
export interface MarkerDraft {
  id?: string
  map: string
  x: number
  y: number
  layout?: number
  kind: MarkerKind
  title: string
  note: string
  owner?: { kind: 'user' | 'guild' | 'site'; id: string }
  visibility?: Visibility
  /** «updated» позначки, яку почали правити: якщо її тим часом змінили, сервер не дасть затерти чужі правки */
  base?: number
}

interface S {
  rows: Marker[]
  ready: boolean
  /** список не завантажився (текст для людини) */
  error: string | null
  selected: string | null
  /** вибір точки для нової позначки — клік по мапі */
  picking: boolean
  draft: MarkerDraft | null
  load: () => Promise<void>
  select: (id: string | null) => void
  setPicking: (v: boolean) => void
  setDraft: (d: MarkerDraft | null) => void
  save: (d: MarkerDraft) => Promise<Marker | null>
  remove: (id: string) => Promise<void>
}

export const useMarkers = create<S>((set, get_) => ({
  rows: [],
  ready: false,
  error: null,
  selected: null,
  picking: false,
  draft: null,
  load: async () => {
    try {
      // свої й гільдійські; чуже публічне вмикається поштучно на сторінці «Позначки» (lib/map/marks)
      const r = await get<{ rows: Marker[] }>('/api/markers?scope=shared')
      set({ rows: r.rows, ready: true, error: null })
    } catch {
      set({ ready: true, error: t('Позначки зараз не завантажились. Онови сторінку трохи згодом.') })
    }
  },
  select: (selected) => set({ selected, draft: null }),
  setPicking: (picking) => set({ picking }),
  // правка наявної позначки — запам'ятовуємо, з якої її версії почали
  setDraft: (draft) => set({ draft: draft?.id && draft.base == null ? { ...draft, base: get_().rows.find((r) => r.id === draft.id)?.updated } : draft, picking: false }),
  save: async (d) => {
    try {
      const { id, ...body } = d
      const m = id ? await put<Marker>(`/api/markers/${id}`, body) : await post<Marker>('/api/markers', body)
      set({ rows: upsertRow(get_().rows, m), draft: null, selected: m.id })
      // щойно поставлену — одразу з галочкою: своє на мапі лише позначене
      if (!id) useMapUi.getState().checkMany([m.id], true)
      toast.success(id ? t('Позначку змінено') : t('Позначку додано'))
      return m
    } catch (e) {
      // хтось змінив позначку, поки її правили: показуємо нову версію, чужих правок не затираємо
      const fresh = e instanceof ApiError && e.status === 409 ? (e.body as { row?: Marker } | null)?.row : null
      if (fresh) {
        set({ rows: upsertRow(get_().rows, fresh) })
        toast.error(t('Цю позначку щойно змінили'), { description: t('Ось її нова версія — внеси свої правки ще раз.') })
        return null
      }
      toast.error(t('Не вдалося зберегти позначку'), { description: (e as Error).message })
      return null
    }
  },
  remove: async (id) => {
    try {
      await del(`/api/markers/${id}`)
      set({ rows: get_().rows.filter((x) => x.id !== id), selected: null })
    } catch (e) {
      toast.error(t('Не вдалося видалити'), { description: (e as Error).message })
    }
  },
}))

// ---------- живі оновлення ----------
type Ev = { op: 'put' | 'del' | 'access'; id?: string; row?: Marker }

/** позначки, про які подія прийшла без самої позначки: дочитуємо лише їх, разом за 300 мс */
const pending = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
function refetch(id: string) {
  pending.add(id)
  flushTimer ||= setTimeout(() => {
    flushTimer = null
    const ids = [...pending]
    pending.clear()
    for (const id of ids) {
      get<Marker>(`/api/markers/${encodeURIComponent(id)}`).then(apply).catch((e) => {
        // видалили чи більше не видно
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) gone(id)
      })
    }
  }, 300)
}
function gone(id: string) {
  useMarkers.setState((s) => ({ rows: s.rows.filter((x) => x.id !== id), selected: s.selected === id ? null : s.selected }))
  usePubMarks.getState().drop(`marker:${id}`)
}
/** свіжий стан позначки: моя чи гільдійська — у список (права, яких подія не несе, — ті, що були), інакше — геть */
function apply(m: Marker) {
  const { rows } = useMarkers.getState()
  const have = rows.find((x) => x.id === m.id)
  const row = m.item.can || !have ? m : { ...m, item: { ...m.item, can: have.item.can } }
  if (sharedOwner(row.item.owner)) useMarkers.setState({ rows: upsertRow(rows, row) })
  else if (have) useMarkers.setState({ rows: rows.filter((x) => x.id !== m.id) })
  usePubMarks.getState().update(row)
}
function onEvent(data: unknown) {
  const ev = data as Ev
  const id = ev.row?.id ?? ev.id
  if (!id) return
  if (ev.op === 'del') { gone(id); return }
  const known = useMarkers.getState().rows.some((x) => x.id === id) || usePubMarks.getState().has(`marker:${id}`)
  // подія з позначкою: нова своя без прав (сервер шле її всім однаково) — дочитати з правами, решта — одразу
  if (ev.row && ev.op === 'put') {
    if (!known && !ev.row.item.can && sharedOwner(ev.row.item.owner)) refetch(id)
    else apply(ev.row)
    return
  }
  // без позначки (чи змінився доступ): дочитати, якщо вона в нас є або може стати нашою — чуже публічне незнайомих
  // людей, яке нікому тут не потрібне, не тягнемо
  if (known || useAuth.getState().user || usePubMarks.getState().owners.length) refetch(id)
}

/** живі оновлення позначок, поки відкрита мапа; після обриву — перечитати список. Повертає «відписатися». */
export const liveMarkers = () => subscribe('/api/markers/stream', onEvent, () => {
  void useMarkers.getState().load()
  void usePubMarks.getState().load()
})

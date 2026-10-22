/**
 * Записи «Ресурсів» — наш шар поверх даних гри: де брати унікальні ресурси. У кожного — власник і видимість:
 * видно мої й гільдійські; зміни з інших вкладок — живими оновленнями (livePlaces, поки відкрита мапа): подія несе сам
 * запис, і змінюється лише він, а не перечитується весь список.
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { ApiError, del, get, patch, post } from './api'
import { useAuth } from './auth'
import type { Item, Visibility } from './items'
import { t } from './i18n'
import { subscribe } from './stream'
import { sharedOwner, upsertRow, usePubMarks } from './map/marks'
import { useMapUi } from './map/ui'

export interface Pin {
  map: string
  x: number
  y: number
  /** лише Глибока пустеля: розкладка, на якій ця точка справжня */
  layout?: number
  label?: string
}
export interface Place {
  id: string
  res: string
  place: string
  area: string
  zone: 'hagga' | 'dd' | 'city'
  how: string
  ok: boolean
  loot: string
  pins: Pin[]
  types: { map: string; type: string }[]
  created: number
  updated: number
  /** власник, видимість, права */
  item?: Item
}
export type PlaceInput = Partial<Omit<Place, 'id' | 'created' | 'updated' | 'item'>> & { owner?: { kind: 'user' | 'guild' | 'site'; id: string }; visibility?: Visibility }

interface S {
  rows: Place[]
  ready: boolean
  error: string | null
  load: () => Promise<void>
  add: (p: PlaceInput) => Promise<Place | null>
  /** base — «updated», від якого правили (змінили тим часом — показуємо нову версію); addPins — додати точки до наявних */
  patch: (id: string, p: PlaceInput & { base?: number; addPins?: Place['pins'] }) => Promise<Place | null>
  remove: (id: string) => Promise<boolean>
}

export const usePlaces = create<S>((set, get_) => ({
  rows: [],
  ready: false,
  error: null,
  load: async () => {
    try {
      const { rows } = await get<{ rows: Place[] }>('/api/places')
      set({ rows, ready: true, error: null })
    } catch {
      set({ ready: true, error: t('Записи зараз не завантажились. Онови сторінку трохи згодом.') })
    }
  },
  add: async (p) => {
    try {
      const row = await post<Place>('/api/places', p)
      set({ rows: upsertRow(get_().rows, row) })
      useMapUi.getState().checkMany([row.id], true)
      return row
    } catch (e) {
      toast.error(t('Не вдалося додати запис'), { description: (e as Error).message })
      return null
    }
  },
  patch: async (id, p) => {
    try {
      const row = await patch<Place>(`/api/places/${id}`, p)
      set({ rows: upsertRow(get_().rows, row) })
      return row
    } catch (e) {
      // хтось змінив запис, поки його правили: показуємо нову версію, правки людини не пишемо поверх
      const fresh = e instanceof ApiError && e.status === 409 ? (e.body as { row?: Place } | null)?.row : null
      if (fresh) {
        set({ rows: upsertRow(get_().rows, fresh) })
        toast.error(t('Цей запис щойно змінили'), { description: t('Ось його нова версія — внеси свої правки ще раз.') })
        return null
      }
      toast.error(t('Не вдалося зберегти'), { description: (e as Error).message })
      return null
    }
  },
  remove: async (id) => {
    try {
      await del(`/api/places/${id}`)
      set({ rows: get_().rows.filter((r) => r.id !== id) })
      return true
    } catch (e) {
      toast.error(t('Не вдалося видалити'), { description: (e as Error).message })
      return false
    }
  },
}))

// ---------- живі оновлення ----------
type Ev = { op: 'put'; row: Place } | { op: 'del'; id: string } | { op: 'access'; id: string }

/** записи, які треба дочитати самі (новий свій — з правами, зміна доступу): лише їх, разом за 300 мс */
const pending = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
function refetch(id: string) {
  pending.add(id)
  flushTimer ||= setTimeout(() => {
    flushTimer = null
    const ids = [...pending]
    pending.clear()
    for (const id of ids) {
      get<Place>(`/api/places/${encodeURIComponent(id)}`).then(apply).catch((e) => {
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) gone(id)
      })
    }
  }, 300)
}
function gone(id: string) {
  usePlaces.setState((s) => ({ rows: s.rows.filter((r) => r.id !== id) }))
  usePubMarks.getState().drop(`place:${id}`)
}
/** свіжий стан запису: мій чи гільдійський — у список (права, яких подія не несе, — ті, що були), інакше — геть */
function apply(p: Place) {
  const { rows } = usePlaces.getState()
  const have = rows.find((r) => r.id === p.id)
  const row = p.item && !p.item.can && have?.item?.can ? { ...p, item: { ...p.item, can: have.item.can } } : p
  if (sharedOwner(row.item?.owner)) usePlaces.setState({ rows: upsertRow(rows, row) })
  else if (have) usePlaces.setState({ rows: rows.filter((r) => r.id !== p.id) })
  usePubMarks.getState().update(row)
}
function onEvent(data: unknown) {
  const ev = data as Ev
  if (ev.op === 'del') { gone(ev.id); return }
  if (ev.op === 'put' && ev.row?.id) {
    const known = usePlaces.getState().rows.some((r) => r.id === ev.row.id)
    // новий свій чи гільдійський: права (can) сервер у події не шле — дочитати з правами
    if (!known && !ev.row.item?.can && sharedOwner(ev.row.item?.owner)) refetch(ev.row.id)
    else apply(ev.row)
    return
  }
  // змінився доступ: дочитати, якщо запис у нас є чи може стати нашим
  const id = (ev as { id?: string }).id
  if (id && (usePlaces.getState().rows.some((r) => r.id === id) || usePubMarks.getState().has(`place:${id}`) || useAuth.getState().user)) refetch(id)
}

/**
 * Живі оновлення записів, поки відкрита мапа — і тоді, коли перше завантаження не вдалось (з'єднання відновиться —
 * список перечитається). Повертає «відписатися».
 */
export const livePlaces = () => subscribe('/api/places/stream', onEvent, () => void usePlaces.getState().load())

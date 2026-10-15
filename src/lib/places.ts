/**
 * Записи «Ресурсів» — наш шар поверх даних гри: де брати унікальні ресурси.
 * Спільні для всіх (SQLite на сервері); зміни з інших вкладок приходять через SSE.
 */
import { create } from 'zustand'
import { toast } from 'sonner'

export interface Pin {
  map: string
  x: number
  y: number
  /** лише Deep Desert: розкладка тижня, на якій ця точка справжня */
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
}
export type PlaceInput = Partial<Omit<Place, 'id' | 'created' | 'updated'>>

interface S {
  rows: Place[]
  ready: boolean
  error: string | null
  load: () => Promise<void>
  add: (p: PlaceInput) => Promise<Place | null>
  patch: (id: string, p: PlaceInput) => Promise<Place | null>
  remove: (id: string) => Promise<boolean>
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
  return body as T
}

const upsert = (rows: Place[], row: Place) => {
  const i = rows.findIndex((r) => r.id === row.id)
  if (i < 0) return [...rows, row]
  const next = rows.slice()
  next[i] = row
  return next
}

let stream: EventSource | null = null

export const usePlaces = create<S>((set, get) => ({
  rows: [],
  ready: false,
  error: null,
  load: async () => {
    try {
      const { rows } = await call<{ rows: Place[] }>('/api/places')
      set({ rows, ready: true, error: null })
    } catch (e) {
      set({ ready: true, error: 'Записи зараз недоступні — сервер не відповідає.' })
      return
    }
    if (!stream && typeof EventSource !== 'undefined') {
      stream = new EventSource('/api/places/stream')
      stream.onmessage = (m) => {
        const ev = JSON.parse(m.data) as { op: 'put'; row: Place } | { op: 'del'; id: string }
        if (ev.op === 'put') set({ rows: upsert(get().rows, ev.row) })
        else set({ rows: get().rows.filter((r) => r.id !== ev.id) })
      }
    }
  },
  add: async (p) => {
    try {
      const row = await call<Place>('/api/places', { method: 'POST', body: JSON.stringify(p) })
      set({ rows: upsert(get().rows, row) })
      return row
    } catch (e) {
      toast.error('Не вдалося додати запис', { description: (e as Error).message })
      return null
    }
  },
  patch: async (id, p) => {
    try {
      const row = await call<Place>(`/api/places/${id}`, { method: 'PATCH', body: JSON.stringify(p) })
      set({ rows: upsert(get().rows, row) })
      return row
    } catch (e) {
      toast.error('Не вдалося зберегти', { description: (e as Error).message })
      return null
    }
  },
  remove: async (id) => {
    try {
      await call(`/api/places/${id}`, { method: 'DELETE' })
      set({ rows: get().rows.filter((r) => r.id !== id) })
      return true
    } catch (e) {
      toast.error('Не вдалося видалити', { description: (e as Error).message })
      return false
    }
  },
}))

/**
 * Спільний стан панелі й мапи: чернетка запису «Ресурсів» і режим «вказати точку».
 * Клік по мапі в режимі picking додає точку в чернетку — тому стан окремо від компонентів.
 */
import { create } from 'zustand'
import type { Pin, PlaceInput } from '@/lib/places'

export interface Draft extends PlaceInput {
  /** id запису, що редагується; немає — новий */
  id?: string
}

interface S {
  draft: Draft | null
  picking: boolean
  /** вибраний запис — підсвічує свої точки, типи й лут */
  selected: string | null
  edit: (d: Draft | null) => void
  patchDraft: (p: Partial<Draft>) => void
  setPicking: (v: boolean) => void
  addPin: (p: Pin) => void
  select: (id: string | null) => void
}

export const useMapUi = create<S>((set, get) => ({
  draft: null,
  picking: false,
  selected: null,
  edit: (draft) => set({ draft, picking: false }),
  patchDraft: (p) => set({ draft: get().draft ? { ...get().draft!, ...p } : null }),
  setPicking: (picking) => set({ picking }),
  addPin: (p) => {
    const d = get().draft
    if (d) set({ draft: { ...d, pins: [...(d.pins || []), p] } })
  },
  select: (selected) => set({ selected }),
}))

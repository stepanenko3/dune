/**
 * Спільний стан панелі й мапи: чернетка запису «Ресурсів», режим «вказати точку»,
 * вибраний запис і позначені галочками (фільтр мапи). Клік по мапі в режимі picking
 * додає точку в чернетку — тому стан окремо від компонентів.
 */
import { create } from 'zustand'
import type { Pin, PlaceInput } from '@/lib/places'
import { prefGet, prefSet } from '@/lib/prefs'

export interface Draft extends PlaceInput {
  /** id запису, що редагується; немає — новий */
  id?: string
}

interface S {
  draft: Draft | null
  picking: boolean
  /** вибраний запис — розгорнутий у списку, підсвічує свої точки, типи й лут */
  selected: string | null
  /** свої й гільдійські позначки й записи з галочкою (id): лише вони на мапі, решта не малюється */
  checked: string[]
  /** вкладка «Позначки»: показувати ще й ігрові маркери (шари з «Гри»); вимкнено — лише позначене галочкою */
  marksGame: boolean
  edit: (d: Draft | null) => void
  patchDraft: (p: Partial<Draft>) => void
  setPicking: (v: boolean) => void
  addPin: (p: Pin) => void
  select: (id: string | null) => void
  toggleCheck: (id: string) => void
  setChecked: (ids: string[]) => void
  /** поставити (on) чи зняти галочки цим речам разом */
  checkMany: (ids: string[], on: boolean) => void
  setMarksGame: (on: boolean) => void
}

export const useMapUi = create<S>((set, get) => ({
  draft: null,
  picking: false,
  selected: null,
  checked: prefGet<string[]>('map:checked', []),
  marksGame: prefGet<boolean>('map:marks-game', true),
  edit: (draft) => set({ draft, picking: false }),
  patchDraft: (p) => set({ draft: get().draft ? { ...get().draft!, ...p } : null }),
  setPicking: (picking) => set({ picking }),
  addPin: (p) => {
    const d = get().draft
    if (d) set({ draft: { ...d, pins: [...(d.pins || []), p] } })
  },
  select: (selected) => set({ selected }),
  toggleCheck: (id) => get().setChecked(get().checked.includes(id) ? get().checked.filter((x) => x !== id) : [...get().checked, id]),
  setChecked: (checked) => {
    prefSet('map:checked', checked)
    set({ checked })
  },
  checkMany: (ids, on) => get().setChecked(on ? [...new Set([...get().checked, ...ids])] : get().checked.filter((k) => !ids.includes(k))),
  setMarksGame: (marksGame) => {
    prefSet('map:marks-game', marksGame)
    set({ marksGame })
  },
}))

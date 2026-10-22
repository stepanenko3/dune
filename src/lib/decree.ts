/**
 * Указ Ландсрааду на тиждень: список відомих указів (awakening.wiki/Landsraad) і поточний — один на весь сайт (у грі
 * указ діє на весь сервер). Виставляє його адміністрація в панелі керування (canSet — чи можна мені), решта лише бачить.
 * Автоматично взяти нема звідки: гра й вікі поточний указ назовні не віддають. Діє до найближчої бурі Коріоліса.
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { nextReset, useDDRegion } from '@/lib/ddReset'
import { t } from './i18n'

export type DecreeId = 'tools' | 'armor' | 'weapons' | 'vehicles' | 'production' | 'refining' | 'ranged' | 'melee' | 'xp' | 'salvage'

/**
 * Торговець указу на мапі: точка гри в TH.GL за стабільним ключем (тип точок + id без координат). Чотири торговці
 * Ландсрааду стоять біля своїх яток і в Арракіні, і в Селищі Харко; ключ той самий в обох містах. «Utility Vendor» —
 * торговець інструментами (допоміжне оснащення). Ключ `vehicle_vendor` має й звичайний торговець технікою (тип
 * vehiclevendor) — тому шукаємо лише серед NPC (npc_unaffiliated).
 */
export type DecreeSpot = { type: string; key: string }
export const DECREE_CITIES = ['sh_arrakeen', 'sh_harkovillage'] as const

export const DECREES: { id: DecreeId; name: string; en: string; effect: string; spot?: DecreeSpot }[] = [
  { id: 'production', name: t('Виробничий контракт CHOAM'), en: 'CHOAM Production Contract', effect: t('−25% ресурсів і води на переробку й крафт (від тіру 4)') },
  { id: 'refining', name: t('Контракт на переробку CHOAM'), en: 'CHOAM Refining Contract', effect: t('−75% часу переробки і ціни ремонту') },
  { id: 'xp', name: t('Наукова співпраця'), en: 'Scholarly Collaboration', effect: t('+50% досвіду (крім спеціалізацій)') },
  { id: 'ranged', name: t('На честь полеглих: дальній бій'), en: 'In Honor of the Fallen (Ranged)', effect: t('+33% шкоди дальньої зброї') },
  { id: 'melee', name: t('На честь полеглих: ближній бій'), en: 'In Honor of the Fallen (Melee)', effect: t('+33% шкоди холодної зброї') },
  { id: 'salvage', name: t('Право на здобич'), en: 'The Right of Salvage', effect: t('У Глибокій пустелі після смерті випадає все спорядження й інвентар') },
  { id: 'tools', name: t('Виключне право на імпорт інструментів'), en: 'Exclusive Tool Import Rights', effect: t('Торговець інструментами Ландсрааду, одне креслення Mk6 на тиждень'), spot: { type: 'npc_unaffiliated', key: 'utility_vendor' } },
  { id: 'armor', name: t('Виключне право на імпорт броні'), en: 'Exclusive Armor Import Rights', effect: t('Торговець бронею Ландсрааду, одне креслення Mk6 на тиждень'), spot: { type: 'npc_unaffiliated', key: 'armor_vendor' } },
  { id: 'weapons', name: t('Виключне право на імпорт зброї'), en: 'Exclusive Weapon Import Rights', effect: t('Торговець зброєю Ландсрааду, одне креслення Mk6 на тиждень'), spot: { type: 'npc_unaffiliated', key: 'weapon_vendor' } },
  { id: 'vehicles', name: t('Виключне право на імпорт техніки'), en: 'Exclusive Vehicle Import Rights', effect: t('Торговець технікою Ландсрааду, одне креслення Mk6 на тиждень'), spot: { type: 'npc_unaffiliated', key: 'vehicle_vendor' } },
]
export const decreeOf = (id: DecreeId | null) => DECREES.find((d) => d.id === id) ?? null
/** адреса мапи міста з торговцем указу у фокусі */
export const spotUrl = (map: string, s: DecreeSpot) => `/map?m=${map}&pt=${s.type}.${s.key}`

interface S {
  id: DecreeId | null
  until: number | null
  /** чи можна мені змінювати указ (адміністрація сайту) */
  canSet: boolean
  loaded: boolean
  load: () => Promise<void>
  set: (id: DecreeId | null) => Promise<void>
}

export const useDecree = create<S>((set, get) => ({
  id: null,
  until: null,
  canSet: false,
  loaded: false,
  load: async () => {
    try {
      const r = await fetch('/api/decree').then((r) => r.json())
      set({ id: r.id, until: r.until, canSet: !!r.canSet, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  set: async (id) => {
    const prev = { id: get().id, until: get().until }
    // діє до найближчої бурі вибраного регіону
    const until = id ? nextReset(useDDRegion.getState().region) : null
    set({ id, until })
    try {
      const r = await fetch('/api/decree', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, until }) })
      const body = await r.json()
      if (!r.ok) throw new Error(body.error)
      set({ id: body.id, until: body.until })
      toast.success(t('Указ тижня збережено'))
    } catch (e) {
      set(prev)
      toast.error(t('Не вдалося зберегти указ'), { description: (e as Error).message })
    }
  },
}))

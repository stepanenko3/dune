/**
 * Указ Ландсрааду на тиждень: список указів гри і поточний — один на весь сайт. У грі Ландсраад виграє Великий дім
 * (Атріди чи Харконнени), його гільдії обирають указ, і діє указ лише на людей цього дому. Виставляє указ із домом-
 * переможцем адміністрація в панелі керування (canSet — чи можна мені), решта лише бачить. Мій дім (me) — свій із
 * профілю, інакше — дім моєї гільдії; від нього залежить, чи указ діє на мене (forMe — указ для калькулятора).
 * Автоматично взяти нема звідки: гра поточний указ назовні не віддає. Діє до найближчої бурі Коріоліса.
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { nextReset, useDDRegion } from '@/lib/ddReset'
import { t } from './i18n'

/** Великі доми Ландсрааду; назви — з текстів гри (Factions_Name_*) */
export type House = 'atreides' | 'harkonnen'
export const HOUSES: { id: House; name: string; of: string; color: string }[] = [
  { id: 'atreides', name: t('Дім Атрідів'), of: t('дому Атрідів'), color: '#3f8f5a' },
  { id: 'harkonnen', name: t('Дім Харконненів'), of: t('дому Харконненів'), color: '#b8432f' },
]
export const houseOf = (h: House | null | undefined) => HOUSES.find((x) => x.id === h) ?? null

export type DecreeId = 'tools' | 'armor' | 'weapons' | 'vehicles' | 'production' | 'refining' | 'ranged' | 'melee' | 'xp' | 'salvage'

/**
 * Торговець указу на мапі: точка гри в TH.GL за стабільним ключем (тип точок + id без координат). Чотири торговці
 * Ландсрааду стоять біля своїх яток і в Арракіні, і в Селищі Харко; ключ той самий в обох містах. «Utility Vendor» —
 * торговець інструментами (допоміжне оснащення). Ключ `vehicle_vendor` має й звичайний торговець технікою (тип
 * vehiclevendor) — тому шукаємо лише серед NPC (npc_unaffiliated).
 */
export type DecreeSpot = { type: string; key: string }
export const DECREE_CITIES = ['sh_arrakeen', 'sh_harkovillage'] as const

/**
 * Укази гри — увімкнені рядки DT_LandsraadDecrees (bIsEnabled); назви й ефекти — тексти гри (ST_Localization_UI:
 * Landsraad_Name_* / Landsraad_Effect_*), en — англійська назва гри. Числа ефектів — з класів указів гри
 * (m_CraftingCostMultiplier 0,75, m_RefiningRateMultiplier 0,25, m_ExperienceRateMultiplier 1,5, шкода +0,33).
 * Указ техніки гра зве просто «Ексклюзивні права на імпорт» (переклади без слова «техніки») — уточнюємо.
 */
export const DECREES: { id: DecreeId; name: string; en: string; effect: string; spot?: DecreeSpot }[] = [
  { id: 'production', name: t('Контракт на виробництво ДАПТ'), en: 'CHOAM Production Contract', effect: t('Витрати на виготовлення зменшено на 25%') },
  { id: 'refining', name: t('Контракт на переробку ДАПТ'), en: 'CHOAM Refining Contract', effect: t('Витрати на ремонт і час переробки знижено на 75%') },
  { id: 'xp', name: t('Освітня співпраця'), en: 'Scholarly Collaboration', effect: t('Збільшення отриманого досвіду на 50%') },
  { id: 'ranged', name: t('На честь полеглих'), en: 'In Honor of the Fallen', effect: t('Шкода від далекобійної зброї збільшена на 33%') },
  { id: 'melee', name: t('На честь полеглих'), en: 'In Honor of the Fallen', effect: t('Шкода від холодної зброї збільшена на 33%') },
  { id: 'salvage', name: t('Право на трофеї'), en: 'The Right of Salvage', effect: t('Усі предмети випадають і можуть стати доступними для отримання будь-ким у PVP-зонах Глибокої пустелі') },
  { id: 'tools', name: t('Ексклюзивні права на імпорт інструментів'), en: 'Exclusive Tool Import Rights', effect: t('Доступ до торговця інструментами Ландсрааду'), spot: { type: 'npc_unaffiliated', key: 'utility_vendor' } },
  { id: 'armor', name: t('Ексклюзивні права на імпорт броні'), en: 'Exclusive Armor Import Rights', effect: t('Доступ до торговця бронею Ландсрааду'), spot: { type: 'npc_unaffiliated', key: 'armor_vendor' } },
  { id: 'weapons', name: t('Ексклюзивні права на імпорт зброї'), en: 'Exclusive Weapon Import Rights', effect: t('Доступ до торговця зброєю Ландсрааду'), spot: { type: 'npc_unaffiliated', key: 'weapon_vendor' } },
  { id: 'vehicles', name: t('Ексклюзивні права на імпорт техніки'), en: 'Exclusive Vehicle Import Rights', effect: t('Доступ до торговця технікою Ландсрааду'), spot: { type: 'npc_unaffiliated', key: 'vehicle_vendor' } },
]
export const decreeOf = (id: DecreeId | null) => DECREES.find((d) => d.id === id) ?? null
/** адреса мапи міста з торговцем указу у фокусі */
export const spotUrl = (map: string, s: DecreeSpot) => `/map?m=${map}&pt=${s.type}.${s.key}`

/** мій дім: own — свій (профіль), guild — дім моєї гільдії, house — який діє (свій, інакше гільдії) */
export interface MyHouse { own: House | null; guild: House | null; house: House | null }

/**
 * чи діє указ на людину: 'on' — так (її дім переміг; давній указ без дому — на всіх); 'off' — ні (інший дім);
 * 'unknown' — дім не вказано (чи анонім); 'none' — указу нема
 */
export type Reach = 'on' | 'off' | 'unknown' | 'none'
export function reachOf(id: DecreeId | null, winner: House | null, mine: House | null | undefined): Reach {
  if (!id) return 'none'
  if (!winner) return 'on'
  if (!mine) return 'unknown'
  return mine === winner ? 'on' : 'off'
}

interface S {
  id: DecreeId | null
  until: number | null
  /** дім, що виграв Ландсраад і обрав указ (давній указ — null: діє на всіх) */
  house: House | null
  /** мій дім (анонім — null) */
  me: MyHouse | null
  /** чи діє указ на мене */
  reach: Reach
  /** указ, що діє на мене (його рахує калькулятор), — лише коли мій дім переміг */
  forMe: DecreeId | null
  /** чи можна мені змінювати указ (адміністрація сайту) */
  canSet: boolean
  loaded: boolean
  load: () => Promise<void>
  set: (id: DecreeId | null, house?: House | null) => Promise<void>
  /** свій дім у профілі (null — як у гільдії) */
  setMine: (house: House | null) => Promise<void>
}

type Resp = { id: DecreeId | null; until: number | null; house: House | null; canSet?: boolean; me: MyHouse | null; error?: string }
/** стан зі відповіді сервера: чи діє указ на мене — тут же */
const fromResp = (r: Resp) => {
  const reach = reachOf(r.id, r.house ?? null, r.me?.house)
  return { id: r.id, until: r.until, house: r.house ?? null, me: r.me ?? null, reach, forMe: reach === 'on' ? r.id : null, canSet: !!r.canSet }
}
async function send(url: string, body: unknown): Promise<Resp> {
  const r = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const out = (await r.json()) as Resp
  if (!r.ok) throw new Error(out.error)
  return out
}

export const useDecree = create<S>((set, get) => ({
  id: null,
  until: null,
  house: null,
  me: null,
  reach: 'none',
  forMe: null,
  canSet: false,
  loaded: false,
  load: async () => {
    try {
      const r = await fetch('/api/decree').then((r) => r.json() as Promise<Resp>)
      set({ ...fromResp(r), loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  set: async (id, house = get().house) => {
    const prev = fromResp({ id: get().id, until: get().until, house: get().house, me: get().me, canSet: get().canSet })
    // діє до найближчої бурі вибраного регіону
    const until = id ? nextReset(useDDRegion.getState().region) : null
    set(fromResp({ id, until, house: id ? house : null, me: get().me, canSet: get().canSet }))
    try {
      set(fromResp(await send('/api/decree', { id, until, house: id ? house : null })))
      toast.success(t('Указ тижня збережено'))
    } catch (e) {
      set(prev)
      toast.error(t('Не вдалося зберегти указ'), { description: (e as Error).message })
    }
  },
  setMine: async (house) => {
    try {
      set(fromResp(await send('/api/me/house', { house })))
      toast.success(house ? t('Твій дім — {house}', { house: houseOf(house)!.name }) : t('Твій дім — як у гільдії'))
    } catch (e) {
      toast.error(t('Не вдалося зберегти дім'), { description: (e as Error).message })
    }
  },
}))

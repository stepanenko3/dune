/** Підписи редактора: призначення приміщень, дахи, прорізи, типи пристроїв (ключі — як у моделі). */
import presets from './presets.json'
import { t } from '@/lib/i18n'
import type { OpenType, PieceType } from './geo'

export const GROUPS: Record<string, string> = {
  core: t('Ядро, зали'),
  drive: t('Заїзд, гаражі'),
  store: t('Склад'),
  refine: t('Переробка'),
  craft: t('Крафт, майстерні'),
  deck: t('Палуба, тераса'),
  tower: t('Вежа'),
  air: t('Ангар орні'),
  crown: t('Ярус даху'),
  shield: t('Стеля-пентащит'),
}
export const ROOFS: Record<string, string> = {
  solid: t('Суцільний'),
  none: t('Без даху'),
  shield: t('Пентащит'),
  tier: t('З уступом по краю'),
  pyramid: t('Піраміда'),
}
export const OPENINGS: [OpenType, string][] = [
  ['wall', t('Стіна')],
  ['door', t('Двері')],
  ['shield', t('Пентащит')],
  ['open', t('Прохід')],
  ['balcony', t('Парапет')],
]
/** типи одного блоку стіни: назва й що це в грі */
export const PIECES: [PieceType, string, string][] = [
  ['wall', t('Стіна'), t('суцільний блок')],
  ['door', t('Двері'), t('дверний проріз')],
  ['shield', t('Пентащит'), t('енергощит — видно крізь')],
  ['open', t('Прохід'), t('порожньо')],
]
/** що це в грі — коротко, для картки блоку стіни */
export const OPEN_HINT: Record<OpenType, string> = {
  wall: t('суцільна стіна'),
  door: t('проріз із дверима'),
  shield: t('енергощит у прорізі — видно крізь'),
  open: t('без стіни, вільний прохід'),
  balcony: t('низька огорожа до пояса'),
}
export const KINDS: Record<string, string> = {
  refine: t('Переробка'),
  craft: t('Крафт'),
  storage: t('Сховище'),
  power: t('Енергія'),
  water: t('Вода'),
  windtrap: t('Вітропастка'),
  turbine: t('Вітряк'),
  vehicle: t('Техніка'),
  air: t('Орні'),
  console: t('Консоль'),
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Станції палітри — пристрої гри (awakening.wiki, Module:Buildables/data/placeables; пентащити — деталі) і техніка для
 * місця стоянки. type — id у грі, group — розділ палітри; розміри в довіднику не дано — на око.
 */
export interface Preset { type: string; name: string; kind: string; group: string; w: number; d: number; h: number; full?: string; recipe?: string }
export const PRESETS = (presets as { items: Preset[] }).items
export const PRESET_GROUPS = (presets as unknown as { groups: [string, string][] }).groups.map(([id, name]) => [id, t(name)] as [string, string])
export const groupLabel = (g: string) => GROUPS[g] ?? g

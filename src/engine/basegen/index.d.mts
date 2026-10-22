/* Типи генератора баз (сам модуль — ESM без TypeScript: його ж бере сервер). */
export type Shape = 'square' | 'hex' | 'dodeca' | 'yard' | 'atrium'
export type AirType = 'OrnithopterLight' | 'OrnithopterMedium' | 'OrnithopterTransport'
export type GroundType = 'Sandbike' | 'Buggy' | 'Sandcrawler'
export type BayItem = AirType | GroundType | 'ContainerVehicle'
/** ангар (air) чи гараж (ground): що в ньому, порталів (0–2), пентащит у даху */
export interface Bay { kind: 'air' | 'ground'; items: Partial<Record<BayItem, number>>; portals: number; roof: boolean }
export interface Style {
  preset: string
  walls: 'straight' | 'lean' | 'inverted'
  roof: 'flat' | 'hip' | 'pyramid' | 'vault' | 'dome'
  columns: boolean
  cantilever: boolean
  porch: boolean
  setbacks: boolean
  towers: 'none' | 'one' | 'corners'
  towerShape: 'square' | 'goblet' | 'stepped'
  towerFloors: number
  towerCap: 'roof' | 'pyramid' | 'hip' | 'flat' | 'spires' | 'room'
  ziggurat: boolean
  balconies: boolean
  battlements: boolean
  parapets: boolean
  skylights: boolean
  dome: boolean
  pavilion: boolean
  canopies: boolean
}
export const STYLE_PRESETS: Record<string, Omit<Style, 'preset'> & { name: string; sub: string }>
export const STYLE_ENUMS: { walls: Style['walls'][]; roof: Style['roof'][]; towers: Style['towers'][]; towerShape: Style['towerShape'][]; towerCap: Style['towerCap'][] }
export const STYLE_FLAGS: ('columns' | 'cantilever' | 'porch' | 'setbacks' | 'balconies' | 'battlements' | 'parapets' | 'skylights' | 'dome' | 'ziggurat' | 'pavilion' | 'canopies')[]
export const STYLE_DEFAULT: string
export function normalizeStyle(src: Partial<Style> | null | undefined, legacy?: { walls?: string; roof?: string }): Style
export function presetOf(style: Partial<Style>): string
export function randomStyle(rand: () => number): Style
export interface GenParams {
  cells: [number, number][]
  /** форма ділянки за ключем «i,j» (квадрат — за замовчуванням, без ключа) */
  shapes: Record<string, Shape>
  bays: Bay[]
  /** станції: тип → кількість */
  stations: Record<string, number>
  rooms: number
  style: Style
  seed: number
  name: string
}
/** повідомлення: text — ключ перекладу з {змінними} */
export interface GenMsg { code?: string; rule?: string; text: string; vars?: Record<string, unknown>; at?: { x: number; y: number } }
export interface GenCheck { id: string; title: string; ok: boolean; n: number; warn: number }
export interface GenReport {
  errors: GenMsg[]
  warnings: GenMsg[]
  checks: GenCheck[]
  stats: { pieces: number; items: number; vehicles: number; sheltered: number; minStability: number; clashes: number; outside: number }
}
export interface GenPlanCell { i: number; j: number; shape: Shape; ground: string; upper: string | null; bay: number | null; stairs: boolean }
export interface GenResult {
  doc: Record<string, any> | null
  report: GenReport | null
  notes: GenMsg[]
  errors: GenMsg[]
  params: GenParams
  plan?: { cells: GenPlanCell[]; bays: { idx: number; k: number; level: number; cells: [number, number][]; portalSides: string[] }[] }
}
export const DEFAULTS: GenParams
export const LIMITS: { cells: number; bays: number; perBayAir: number; perBayGround: number; orni: number; carrier: number; ground: number; rooms: number; station: number; stations: number; name: number; bayCells: number }
export const SHAPES: Shape[]
export const AIR: AirType[]
export const GROUND: GroundType[]
export const CONTAINER: 'ContainerVehicle'
export const BAY_TYPES: { air: BayItem[]; ground: BayItem[] }
export const STATION_TYPES: string[]
export const STATION_SETS: Record<'none' | 'basic' | 'advanced' | 'endgame', Record<string, number>>
export const OUTDOOR: Set<string>
export const RULES: [string, string][]
export function bayCells(bay: Bay): number
export function bayList(bay: Bay): string[]
export function regroup(bays: Bay[], airMode: 'type' | 'small' | 'all' | 'pairs', groundMode?: 'type' | 'all'): Bay[]
export function normalizeParams(raw: Partial<GenParams> & Record<string, unknown>): { params: GenParams; errors: GenMsg[] }
export function generateBase(raw: Partial<GenParams>, engine: Record<string, unknown>): GenResult
export function randomize(raw: Partial<GenParams>, engine: Record<string, unknown>, rand?: () => number, tries?: number): GenParams

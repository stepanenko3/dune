/**
 * Рушій баз — ті самі файли, що й у класичній однофайловій сторінці (src/engine/*.js):
 * геометрія, 2D-план (SVG-рядок), підрахунки і 3D на three.js r128, а також hydrate — модель з
 * документа бази (бази тепер дані з сервера; моделі Main і DD у коді лишились джерелом для
 * npm run bases:export і перевірок у tools/). Файли UMD-подібні: у браузері кладуть себе у window
 * (GEOM, PLAN2D, BUILD, VIEW3D, BASEDATA, VERSIONS), у Node — у module.exports.
 * Тут ми просто виконуємо їх по черзі і віддаємо типізовані посилання.
 */
import * as THREE_NS from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import '../engine/geom.js'
import '../engine/pieces.js'
import '../engine/convert.js'
import '../engine/stability.js'
import '../engine/hydrate.js'
import '../engine/plan2d.js'
import '../engine/build.js'
import '../engine/stations3d.js'
import '../engine/view3d.js'
import '../engine/versions.js'
import { t } from './i18n'
import { claimsLabel } from './bases'
import { fmt2, lab } from '@/components/base/tr'

// view3d.js чекає глобальний THREE з THREE.OrbitControls, як від <script> з CDN
const w = window as unknown as Record<string, any>
w.THREE = { ...THREE_NS, OrbitControls }
// тексти рушія (план, підказки 3D) — мовою сайту: перекладач, підписи станцій, числа й «N ділянок» (ключі — у tr.ts)
w.BASE_T = (key: string, vars?: Record<string, unknown>) => t(key, vars)
w.BASE_LAB = lab
w.BASE_NUM = fmt2
w.BASE_CLAIMS = claimsLabel

/* eslint-disable @typescript-eslint/no-explicit-any */
export type BaseId = string
export type Model = any
export const GEOM = w.GEOM as Record<string, any>
export const BASEDATA = w.BASEDATA as {
  hydrate: (doc: Record<string, any>) => Model
  /** документ із деталей: рівні, підписи й зрізи — у дані (перед збереженням) */
  syncDoc: (doc: Record<string, any>) => Record<string, any>
  boundsOf: (claims: { x: number; y: number; w: number; d: number }[]) => { x0: number; x1: number; y0: number; y1: number }
  viewsOf: (b: { x0: number; x1: number; y0: number; y1: number }) => Record<string, { pos: number[]; target: number[] }>
}
export const PLAN2D = w.PLAN2D as { make: (M: Model, pad?: number) => { render: (o: { level: string; items: boolean; labels: boolean; coords: boolean; highlight: string | null; focus?: boolean }) => string } }
export const BUILD = w.BUILD as { make: (M: Model) => any }
/** позначка вибраного в редакторі (view3d.setMark): стіни, плитки, станції — у координатах плану */
export interface Mark {
  walls?: { a: { x: number; y: number }; b: { x: number; y: number }; z0: number; z1: number }[]
  tiles?: { p: { x: number; y: number }[]; z: number; strong?: boolean }[]
  boxes?: { p: { x: number; y: number }[]; z0: number; z1: number }[]
  /** напрямні вирівнювання станцій — штрихами на підлозі */
  guides?: { a: { x: number; y: number }; b: { x: number; y: number }; z: number; kind: string }[]
}
/** режим камери 3D: навколо центру чи від першої особи */
export type CamMode = 'orbit' | 'fly'
/** будівельна деталь у документі бази (format 2) */
export interface Piece { id: string; shape: string; x: number; y: number; z: number; rot: number; flip?: boolean }
export interface Shape {
  id: string; name: string; cat: string; family: string; at: 'tile' | 'edge' | 'vertex'; tile?: 's' | 't' | 'r' | 'ri'
  len: number; h: number; kind: string; cost: [string, number][]; variantOf?: string; shield?: boolean
  /** по дузі заокругленого перекриття (радіус) */
  arc?: number
}
export const PIECES = w.PIECES as {
  SHAPES: Record<string, Shape>
  CATS: [string, string][]
  MIRROR: Record<string, string>
  RI: number
  RC: number
  tilePoly: (tile: string, x: number, y: number, rot: number) => { x: number; y: number }[]
  /** дуга заокругленої плити: хорда (вигин — ліворуч від a→b) чи null */
  arcChord: (p: Piece) => { a: { x: number; y: number }; b: { x: number; y: number } } | null
  edgeSeg: (x: number, y: number, rot: number, len?: number) => { a: { x: number; y: number }; b: { x: number; y: number } }
  footprint: (p: Piece) => { at: string; poly?: { x: number; y: number }[]; seg?: { a: { x: number; y: number }; b: { x: number; y: number } }; pt?: { x: number; y: number }; z0: number; z1: number }
  zRange: (p: Piece) => [number, number]
  clash: (a: Piece, b: Piece) => boolean
  replacements: (shape: string) => string[]
  keyOf: (q: { x: number; y: number }) => string
  zonesOf: (pieces: Piece[], zones: any[]) => any[]
  floorHeights: (pieces: Piece[]) => number[]
}
/** стабільність деталей, як у грі: фундамент 100, убік −10 за деталь, звисання −10 */
export const STABILITY = w.STABILITY as {
  compute: (pieces: Piece[]) => Map<string, number>
  of: (p: Piece, pieces: Piece[], values: { get: (id: string) => number | undefined }) => number
  FULL: number
  STEP: number
}
export const CONVERT = w.CONVERT as { toPieces: (doc: Record<string, any>) => { doc2: Record<string, any>; notes: string[] } }
/** що під курсором у 3D: деталь, станція чи земля; точка й нормаль — у координатах плану (x, y, z — блоки) */
export interface Hit { piece: string | null; item: number | null; ground: boolean; point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } }
export const VIEW3D = w.VIEW3D as {
  /** колір станції за типом (як у 3D) */
  ITEM_COLORS: Record<string, number>
  create: (el: HTMLElement, opts: object, M: Model) => {
    /** будівельник: перебудувати будову з нової моделі (та сама сцена, камера, зріз) */
    update: (M: Model) => void
    pick: (clientX: number, clientY: number) => Hit | null
    /** точка плану під курсором на горизонтальній площині висоти z (перетягування) */
    planeAt: (clientX: number, clientY: number, z: number) => { x: number; y: number; z: number } | null
    /** напрямки екрана на землі (план, одиничні): праворуч і «від себе» — для стрілок */
    screenAxes: () => { right: { x: number; y: number }; forward: { x: number; y: number } }
    /** примара деталей (зелена — можна, червона — ні); null — прибрати */
    setGhost: (ps: Piece[] | null, ok?: boolean) => void
    /** підсвітити деталі (наведені — hover, вибрані — sel) і зони (плитки) */
    setHighlight: (h: { hover?: string[]; sel?: string[]; tiles?: { p: { x: number; y: number }[]; z: number }[] }) => void
    setTint: (groups: { ids: string[]; color: number; alpha: number }[] | null) => void
    setMouse: (mode: 'build' | 'view') => void
    /** режим камери: orbit — навколо центру, fly — від першої особи (WASD, Q/E, коліщатко — крок до курсора) */
    setNav: (mode: CamMode) => void
    getNav: () => CamMode
    /** затиснуто пробіл — ліва кнопка зсуває камеру, будівельник клік не бере */
    navBusy: () => boolean
    canvas: HTMLCanvasElement
    start: () => void
    stop: () => void
    setCut: (v: number, floor: number) => void
    setMark: (m: Mark | null) => void
    setInterior: (v: boolean) => void
    setFoundation: (v: boolean) => void
    setTileColors: (v: boolean) => void
    setLabels: (v: boolean) => void
    setView: (v: 'quarter' | 'front' | 'back' | 'top') => void
    setCamera: (pos: number[], target: number[]) => void
    getCamera: () => { pos: number[]; target: number[] }
    dispose: () => void
  }
}
export interface Version { id: string; base: BaseId; n: string; date: string; commit: string | null; page: string; title: string; changes: string[]; img: string }
export const VERSIONS = (w.VERSIONS || []) as Version[]

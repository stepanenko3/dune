/**
 * Контекст бази: модель, план, підрахунки і 3D — один раз на версію бази за сесію, як ctx у classic/app.js.
 * Живе в модулі, а не в компоненті: сторінка бази перемонтовується при кожному перемиканні вкладки,
 * а WebGL-контекстів у браузера обмаль — тож 3D-сцену не створюємо заново, лише ставимо назад у DOM. Живих сцен —
 * не більше LIVE (недавно показані); давніші знищуються (контекст звільняється) і створюються знову, коли їх відкриють.
 * Прийшла нова версія (збереження, відновлення, SSE) — контекст будується наново, стара сцена знищується.
 * Модель — з документа бази (BASEDATA.hydrate); той самий шлях — для чернетки в редакторі (modelCtx).
 */
import { BASEDATA, BUILD, PLAN2D, VIEW3D, type Model } from '@/lib/engine'
import type { BaseDoc } from '@/lib/bases'
import { prefGet } from '@/lib/prefs'

/** ключ рівня з даних бази (рівні — висоти підлог; «r» — дах) */
export type Level = string
export type Cam = 'quarter' | 'front' | 'back' | 'top'
export type View3D = ReturnType<typeof VIEW3D.create>

export interface BaseCtx {
  id: string
  version: number
  M: Model
  UI: any
  B: any
  P: ReturnType<typeof PLAN2D.make>
  res: any
  levelOf: (r: any) => Level
  /** кнопки поверхів 3D: id → [висота зрізу, нижня межа] */
  cuts: Record<string, [number, number]>
  level: Level
  cut: number
  cam: Cam
  view: View3D | null
  box: HTMLDivElement | null
  /** скільки разів браузер забирав контекст WebGL цієї сцени (після кількох поспіль — не відновлюємо) */
  lost?: number
}

const ctx: Record<string, BaseCtx> = {}

/** контекст із документа: модель, план, підрахунки (3D — ліниво, у ThreeView) */
export function modelCtx(id: string, version: number, doc: BaseDoc, keep?: { level?: Level; cut?: number; cam?: Cam }): BaseCtx {
  const M = BASEDATA.hydrate(doc), UI = M.ui
  const B = BUILD.make(M)
  let level = keep?.level ?? prefGet<Level>(`base:${id}:level`, 'g')
  if (!M.levels.some((l: any) => l.key === level)) level = M.levels[0]?.key ?? 'g'
  // рівень приміщення — за висотою підлоги, у межах рівнів бази; вище за всі — дах
  const floors = M.levels.filter((l: any) => l.key !== 'r')
  return {
    id, version, M, UI, B, P: PLAN2D.make(M), res: B.compute(),
    levelOf: (r) => floors.find((l: any) => r.z0 >= l.z0 && r.z0 < l.z1)?.key ?? 'r',
    cuts: { ...UI.cuts, 'cut-all': [UI.all, 0] },
    level, cut: keep?.cut ?? UI.all, cam: keep?.cam ?? 'quarter', view: null, box: null,
  }
}

export function context(id: string, version: number, doc: BaseDoc): BaseCtx {
  const have = ctx[id]
  if (have && have.version === version) return have
  if (have) dropView(have)
  return (ctx[id] = modelCtx(id, version, doc, have ? { level: have.level, cam: have.cam } : undefined))
}

/** скільки сцен 3D тримати живими (кожна — контекст WebGL; браузер дає ~16, iOS — менше, а редактор бере свій) */
const LIVE = 2
const shown: string[] = []
/** сцену прибрати: геометрія, контекст WebGL, вузли (наступний показ створить нову) */
export function dropView(C: BaseCtx) {
  C.view?.dispose()
  C.box?.remove()
  C.view = null
  C.box = null
}
/** сцену бази щойно показали: давніші (не на екрані) — знищити, щоб не вичерпати контексти WebGL */
export function touchView(C: BaseCtx) {
  const i = shown.indexOf(C.id)
  if (i >= 0) shown.splice(i, 1)
  shown.unshift(C.id)
  for (const id of shown.slice(LIVE)) {
    const x = ctx[id]
    if (x?.view && !x.box?.isConnected) dropView(x)
  }
  shown.splice(LIVE + 4) // давно не показані без сцени — не пам'ятаємо
}

/** прапорці 3D спільні для всіх баз — як одні на двох чекбокси класичної сторінки */
export const opts3d = { iso: false, found: false, interior: true, tiles: true, labels: true }

/** у списку приміщень немає «корон» — це декор дахів, а не кімнати */
export const listed = (r: any) => r.group !== 'crown'

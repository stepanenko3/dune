/**
 * Контекст бази: модель, план, підрахунки і 3D — один раз на базу за сесію, як ctx у classic/app.js.
 * Живе в модулі, а не в компоненті: сторінка бази перемонтовується при кожному перемиканні вкладки,
 * а WebGL-контекстів у браузера обмаль — тож 3D-сцену не створюємо заново, лише ставимо назад у DOM.
 */
import { BASES, BUILD, PLAN2D, VIEW3D, type BaseId, type Model } from '@/lib/engine'
import { prefGet } from '@/lib/prefs'

export type Level = 'g' | 'u' | 't' | 'r'
export type Cam = 'quarter' | 'front' | 'back' | 'top'
export type View3D = ReturnType<typeof VIEW3D.create>

export interface BaseCtx {
  id: BaseId
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
}

const ctx: Partial<Record<BaseId, BaseCtx>> = {}

export function context(id: BaseId): BaseCtx {
  const have = ctx[id]
  if (have) return have
  const M = BASES[id], UI = M.ui
  const { G, CAR, TOP } = M.heights
  const B = BUILD.make(M)
  let level = prefGet<Level>(`base:${id}:level`, 'g')
  if (!M.levels.some((l: any) => l.key === level)) level = 'g'
  return (ctx[id] = {
    id, M, UI, B, P: PLAN2D.make(M), res: B.compute(),
    levelOf: (r) => (r.z0 < G ? 'g' : r.z0 < CAR ? 'u' : r.z0 < TOP ? 't' : 'r'),
    cuts: { ...UI.cuts, 'cut-all': [UI.all, 0] },
    level, cut: UI.all, cam: 'quarter', view: null, box: null,
  })
}

/** прапорці 3D спільні для обох баз — як одні на двох чекбокси класичної сторінки */
export const opts3d = { iso: false, found: false, interior: true, tiles: true, labels: true }

/** у списку приміщень немає «корон» — це декор дахів, а не кімнати */
export const listed = (r: any) => r.group !== 'crown'

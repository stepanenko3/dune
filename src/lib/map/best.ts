/**
 * «Де найкраще» для шару мапи: точки шару по клітинках сітки (у Глибокій пустелі — сектори A1…I9, на інших мапах —
 * рівні ділянки). Руда з часткою (файли гри) у секторах ГП: чисті острівці — сектори, де в багатьох місцях руда завжди
 * одна, — усі; острівці є лише в шару зі змішаними місцями (рослини мають частку 100 скрізь — там кожна ділянка була б
 * «острівцем»). Інакше — три найкращі за певністю (сума квадратів частки: змішане місце на 16 % важить мало). Без
 * частки (лут, вода) — за кількістю точок. Кількість у клітинці — очікувана (жереб місця), якщо він є.
 */
export type BestGrid = { x0: number; x1: number; y0: number; y1: number; n: number }
export type BestCell = { label: string; n: number; island: boolean; x0: number; x1: number; y0: number; y1: number }

/** чистий острівець: стільки місць у клітинці, де руда завжди одна */
export const ISLAND = 20
/** без острівців — стільки найкращих клітинок */
const TOP = 3

export function bestCells(pts: number[], { share, pick, grid, sectors }: { share?: number[]; pick?: number[]; grid: BestGrid; sectors: boolean }): BestCell[] {
  const ch = (grid.x1 - grid.x0) / grid.n, cw = (grid.y1 - grid.y0) / grid.n
  const cells = new Map<number, { r: number; c: number; n: number; score: number; pure: number }>()
  for (let i = 0; i < pts.length / 3; i++) {
    const r = Math.floor((grid.x1 - pts[i * 3]) / ch), c = Math.floor((pts[i * 3 + 1] - grid.y0) / cw)
    if (r < 0 || c < 0 || r >= grid.n || c >= grid.n) continue
    const k = r * grid.n + c
    const cell = cells.get(k) ?? { r, c, n: 0, score: 0, pure: 0 }
    const p = share?.[i]
    cell.n += pick ? pick[i] ?? 1 : 1
    cell.score += p == null ? 1 : (p / 100) ** 2
    if (p != null && p >= 100) cell.pure++
    cells.set(k, cell)
  }
  const all = [...cells.values()]
  const mixed = sectors && !!share?.some((p) => p < 100)
  const islands = !mixed ? [] : all.filter((c) => c.pure >= ISLAND).sort((a, b) => b.pure - a.pure || b.n - a.n)
  const chosen = islands.length ? islands : all.filter((c) => c.score > 0).sort((a, b) => b.score - a.score || b.n - a.n).slice(0, TOP)
  return chosen.map((c, i) => ({
    label: sectors ? String.fromCharCode(65 + c.r) + (c.c + 1) : String(i + 1),
    n: Math.round(c.n),
    island: mixed && c.pure >= ISLAND,
    x0: grid.x1 - (c.r + 1) * ch, x1: grid.x1 - c.r * ch,
    y0: grid.y0 + c.c * cw, y1: grid.y0 + (c.c + 1) * cw,
  }))
}

/**
 * шари для пошуку «де найкраще»: шар, що його ввімкнув попередній пошук (auto), вимикається; шукане вмикається, і
 * якщо це зробив пошук — стає його шаром. Увімкнене вручну лишається як є
 */
export function finderLayers(enabled: string[], auto: string[], types: string[]): { enabled: string[]; auto: string[] } {
  const keep = enabled.filter((t) => !auto.includes(t) || types.includes(t))
  const mine = types.filter((t) => !keep.includes(t) || auto.includes(t))
  return { enabled: [...keep, ...types.filter((t) => !keep.includes(t))], auto: mine }
}

/**
 * Зсув вибраного в будівельнику (стрілки й перетягування): деталі — на цілі клітинки сітки й не туди, де вже стоїть
 * невибрана деталь; станція — куди завгодно (крок 0,1), але не за стіну. Стрілки поспіль — один крок «скасувати».
 */
import { PIECES, type Model, type Piece } from '@/lib/engine'
import { t } from '@/lib/i18n'
import { plural } from '@/lib/utils'
import { lab, low } from '../tr'
import { useBuilder, type Sel } from './store'
import { itemFit } from './bits'

/* eslint-disable @typescript-eslint/no-explicit-any */
const r6 = (v: number) => Math.round(v * 1e6) / 1e6
const r2 = (v: number) => Math.round(v * 100) / 100
/** деталі за клітинками 3×3 — при зсуві шукаємо сусідів лише поруч (у базі десятки тисяч деталей) */
const cellsCache = new WeakMap<Piece[], Map<string, Piece[]>>()
const cellKey = (x: number, y: number) => `${Math.floor(x / 3)},${Math.floor(y / 3)}`
function cellsOf(all: Piece[]) {
  let m = cellsCache.get(all)
  if (!m) {
    m = new Map()
    for (const p of all) { const k = cellKey(p.x, p.y); const l = m.get(k); if (l) l.push(p); else m.set(k, [p]) }
    cellsCache.set(all, m)
  }
  return m
}

/**
 * вибране, зсунуте на dx, dy: деталі чи станція на новому місці; why — чому туди не можна (деталь налізе на
 * невибрану, станція — за стіну), warn — можна, але є що сказати (станція на іншій)
 */
export function shiftSel(M: Model, sel: Sel, dx: number, dy: number): { pieces?: Piece[]; item?: any; why: string | null; warn?: string } | null {
  if (sel?.kind === 'pieces') {
    const ids = new Set(sel.ids)
    const all = M.pieces as Piece[]
    const pieces = all.filter((p) => ids.has(p.id)).map((p) => ({ ...p, x: r6(p.x + dx), y: r6(p.y + dy) }))
    const cells = cellsOf(all)
    for (const p of pieces) {
      const cx = Math.floor(p.x / 3), cy = Math.floor(p.y / 3)
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of cells.get(`${cx + i},${cy + j}`) || []) {
        if (!ids.has(o.id) && PIECES.clash(p, o)) return { pieces, why: t('Там уже {shape} — зсунь далі чи спершу прибери її', { shape: low(lab(PIECES.SHAPES[o.shape]?.name ?? '')) }) }
      }
    }
    return { pieces, why: null }
  }
  if (sel?.kind === 'item') {
    const it = M.items[sel.i]
    if (!it) return null
    const item = { ...it, c: { x: r2(it.c.x + dx), y: r2(it.c.y + dy) } }
    const fit = itemFit(M, item, sel.i)
    const name = lab(it.name)
    return { item, why: fit === 'wall' ? t('{name}: за стіну не стане', { name }) : null, warn: fit === 'overlap' ? t('{name}: налазить на іншу станцію', { name }) : undefined }
  }
  return null
}

/** зсунути вибране на dx, dy (блоки); merge — ключ злиття правок (стрілки поспіль — один крок «скасувати»); повертає, чому не вийшло */
export function moveSelected(dx: number, dy: number, merge?: string): string | null {
  const st = useBuilder.getState()
  const sel = st.sel
  if (!dx && !dy) return null
  const r = shiftSel({ pieces: st.doc.pieces || [], items: st.doc.items || [] }, sel, dx, dy)
  if (!r) return null
  if (r.why) return r.why
  if (r.pieces?.length) {
    const at = new Map(r.pieces.map((p) => [p.id, p]))
    const label = r.pieces.length === 1 ? t('переміщено: {name}', { name: low(lab(PIECES.SHAPES[r.pieces[0].shape]?.name ?? '')) }) : t('переміщено {what}', { what: plural(r.pieces.length, [t('деталь'), t('деталі'), t('деталей')]) })
    st.apply((d) => { for (const p of d.pieces as Piece[]) { const q = at.get(p.id); if (q) { p.x = q.x; p.y = q.y } } }, label, merge && `${merge}:${[...at.keys()].join(',')}`)
  } else if (r.item && sel?.kind === 'item') {
    const i = sel.i, c = r.item.c
    st.apply((d) => { if (d.items?.[i]) d.items[i].c = c }, t('переміщено: {name}', { name: lab(r.item.name) }), merge && `${merge}:item${i}`)
  }
  return null
}

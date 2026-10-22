/**
 * Дрібниці будівельника: кути станції, чи стане станція (за стіну — ні, на іншу — жовтим), приміщення під курсором,
 * чи клавіша — для поля вводу.
 */
import { PIECES, type Hit, type Model, type Piece } from '@/lib/engine'
import { centroid, inPoly, overlaps, type P } from './geo'

/* eslint-disable @typescript-eslint/no-explicit-any */
export function itemCorners(it: any): P[] {
  const a = ((it.ang || 0) * Math.PI) / 180
  const u = { x: Math.cos(a), y: Math.sin(a) }, v = { x: -Math.sin(a), y: Math.cos(a) }
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => ({ x: it.c.x + (u.x * s * it.w) / 2 + (v.x * t * it.d) / 2, y: it.c.y + (u.y * s * it.w) / 2 + (v.y * t * it.d) / 2 }))
}

export type Fit = 'ok' | 'overlap' | 'wall'
/** станція на місці: «wall» — перетинає стіну (деталь на краю на її висоті), «overlap» — налазить на іншу станцію */
export function itemFit(M: Model, it: any, skip?: number): Fit {
  const z0 = it.z ?? 0, z1 = z0 + Math.max(it.h || 0, 0.1)
  const box = itemCorners(it)
  const c = it.c
  const shrunk = box.map((q) => ({ x: c.x + (q.x - c.x) * 0.94, y: c.y + (q.y - c.y) * 0.94 }))
  for (const p of M.pieces as Piece[]) {
    if (Math.abs(p.x - c.x) > it.w + it.d + 2 || Math.abs(p.y - c.y) > it.w + it.d + 2) continue
    const s = PIECES.SHAPES[p.shape]
    if (!s || s.at !== 'edge' || s.family === 'rail') continue
    const f = PIECES.footprint(p)
    if (!(f.z0 < z1 - 1e-6 && z0 < f.z1 - 1e-6) || !f.seg) continue
    const { a, b } = f.seg
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const nx = (-(b.y - a.y) / L) * 0.01, ny = ((b.x - a.x) / L) * 0.01
    if (overlaps(shrunk, [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }])) return 'wall'
  }
  for (let i = 0; i < M.items.length; i++) {
    if (i === skip) continue
    const o = M.items[i]
    if (o.kind === 'light') continue
    const oz = o.z ?? 0
    if (Math.abs(oz - z0) > 0.5) continue
    if (overlaps(itemCorners(o), box)) return 'overlap'
  }
  return 'ok'
}

/** підлога під курсором (верх плити) і приміщення на ній */
export function zoneAt(M: Model, hit: Hit): { zone: any | null; tile: P[] | null; z: number; center: P } | null {
  if (!hit.piece || hit.normal.z < 0.5) return null
  const p = M.pieces.find((q: Piece) => q.id === hit.piece)
  const s = p && PIECES.SHAPES[p.shape]
  if (!p || !s || s.family !== 'slab') return null
  const f = PIECES.footprint(p)
  if (!f.poly) return null
  const z = Math.round(p.z * 100) / 100
  const at = { x: hit.point.x, y: hit.point.y }
  const zone = M.rooms.find((r: any) => Math.abs(r.z0 - z) < 1e-3 && r.tiles.some((t: any) => inPoly(at, t.p))) ?? null
  return { zone, tile: f.poly, z, center: centroid(f.poly) }
}

/** клавіша — для поля вводу (звичайного чи sn-*, у якого справжній <input> у тіньовому DOM): будівельник її не чіпає */
export function typing(e: KeyboardEvent): boolean {
  const el = ((e.composedPath?.()[0] as HTMLElement | undefined) ?? (e.target as HTMLElement | null)) ?? null
  const host = e.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return true
  return !!host && /^SN-(INPUT|TEXTAREA|SELECT|NUMBER-FIELD|COMBOBOX)/.test(host.tagName)
}

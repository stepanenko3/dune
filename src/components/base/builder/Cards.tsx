/**
 * Картки вибраного в будівельнику (справа вгорі над 3D):
 *   - деталь (чи кілька): що це й на якій висоті; «Замінити на…» — форми, що стають у те саме місце (стіна → двері,
 *     вікно, пентащит, напівстіна; її варіанти — першими); поворот (R), дзеркально (F), прибрати (Del);
 *   - приміщення: назва, коротка назва, призначення (колір на плані), нотатка; площа й висота — з деталей;
 *   - станція: назва, тип, розмір, поворот, прибрати.
 * Кожна зміна — правка з підписом. Перемістити вибране — тягни чи стрілки (move.ts).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { FlipHorizontal2, RotateCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { PIECES, type Model, type Piece } from '@/lib/engine'
import { t } from '@/lib/i18n'
import { cn, plural } from '@/lib/utils'
import { SnInput, SnSelect, SnTextarea, valueOf } from '@/components/sn'
import { fmt2, lab, low } from '../tr'
import { useBuilder } from './store'
import { PieceIcon } from './Palette'
import { GROUPS, KINDS } from './labels'

/* eslint-disable @typescript-eslint/no-explicit-any */
const btn = 'inline-flex items-center gap-1 rounded border border-line px-1.5 py-1 text-[11.5px] hover:border-spice'
const fmt = fmt2

function Shell({ title, children }: { title: ReactNode; children: ReactNode }) {
  const ed = useBuilder.getState
  return (
    <div className="grid w-[260px] grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-spice/60 bg-panel/95 p-2.5 text-ink shadow-xl backdrop-blur-sm">
      <div className="flex items-center gap-1.5">
        <b className="min-w-0 flex-1 truncate text-[12.5px] text-spice">{title}</b>
        <button type="button" onClick={() => ed().set({ sel: null })} className="grid h-6 w-6 place-items-center rounded text-muted hover:text-ink" aria-label={t('Закрити')}><X size={13} /></button>
      </div>
      {children}
    </div>
  )
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-0.5 text-[11px] text-muted">{label}{children}</label>
}
/** текстове поле: правка йде в документ, коли поле віддали (Enter чи клік повз) */
function Text({ value, onCommit, label, area }: { value: string; onCommit: (v: string) => void; label: string; area?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = (x: string) => { if (x !== value) onCommit(x) }
  return area
    ? <SnTextarea rows={2} modelValue={v} accessibilityLabel={label} onInput={(e: Event) => setV(valueOf(e) ?? '')} onChange={(e: Event) => commit(valueOf(e) ?? '')} />
    : <SnInput size="sm" modelValue={v} accessibilityLabel={label} onInput={(e: Event) => setV(valueOf(e) ?? '')} onChange={(e: Event) => commit(valueOf(e) ?? '')} />
}
function Num({ value, onCommit, label, step = 0.5 }: { value: number; onCommit: (v: number) => void; label: string; step?: number }) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = (raw: string) => { const n = Number(raw.replace(',', '.')); if (raw.trim() !== '' && Number.isFinite(n) && n !== value) onCommit(n); else setV(String(value)) }
  return <SnInput type="number" size="sm" step={step} modelValue={v} accessibilityLabel={label} onInput={(e: Event) => setV(String(valueOf(e) ?? ''))} onChange={(e: Event) => commit(String(valueOf(e) ?? ''))} />
}

/** повернути вибрані деталі: плитка — на 90° (трикутник — 120°), край — інший бік */
export function turnPieces(ids: string[]) {
  const st = useBuilder.getState()
  st.apply((d) => {
    for (const p of d.pieces as Piece[]) {
      if (!ids.includes(p.id)) continue
      const s = PIECES.SHAPES[p.shape]
      p.rot = ((p.rot + (s?.at === 'tile' ? (s.tile === 't' ? 120 : 90) : s?.at === 'edge' ? 180 : 0) + 540) % 360) - 180
    }
  }, t('поворот'))
}
/** дзеркально: ліва ↔ права форма */
export function mirrorPieces(ids: string[]) {
  const st = useBuilder.getState()
  const any = (st.doc.pieces as Piece[]).some((p) => ids.includes(p.id) && PIECES.MIRROR[p.shape])
  if (!any) return void toast.info(t('У цієї деталі нема дзеркальної пари'))
  st.apply((d) => { for (const p of d.pieces as Piece[]) if (ids.includes(p.id) && PIECES.MIRROR[p.shape]) p.shape = PIECES.MIRROR[p.shape] }, t('дзеркально'))
}
export function removePieces(ids: string[]) {
  const st = useBuilder.getState()
  st.apply((d) => { d.pieces = (d.pieces as Piece[]).filter((p) => !ids.includes(p.id)) }, ids.length > 1 ? t('прибрано {what}', { what: plural(ids.length, [t('деталь'), t('деталі'), t('деталей')]) }) : t('деталь прибрано'))
  st.set({ sel: null })
}
/** замінити форму вибраних: якщо нова (вища) налізе на сусіда — не міняємо й кажемо, на що */
function replacePieces(ids: string[], shape: string) {
  const st = useBuilder.getState()
  const all = st.doc.pieces as Piece[]
  const others = all.filter((p) => !ids.includes(p.id))
  for (const p of all) {
    if (!ids.includes(p.id)) continue
    const q = { ...p, shape }
    const by = others.find((o) => Math.abs(o.x - q.x) < 3 && Math.abs(o.y - q.y) < 3 && PIECES.clash(q, o))
    if (by) return void toast.info(t('{shape} налізе на {other} — спершу прибери її', { shape: lab(PIECES.SHAPES[shape].name), other: low(lab(PIECES.SHAPES[by.shape]?.name ?? '')) }))
  }
  st.apply((d) => { for (const p of d.pieces as Piece[]) if (ids.includes(p.id)) p.shape = shape }, t('замінено на: {shape}', { shape: low(lab(PIECES.SHAPES[shape].name)) }))
}

export function PieceCard({ M, ids, stab }: { M: Model; ids: string[]; stab?: Map<string, number> }) {
  const ps = (M.pieces as Piece[]).filter((p) => ids.includes(p.id))
  const [all, setAll] = useState(false)
  if (!ps.length) return null
  const first = ps[0]
  const s = PIECES.SHAPES[first.shape]
  const same = ps.every((p) => p.shape === first.shape)
  const base = s.variantOf ?? s.id
  const reps = PIECES.replacements(first.shape)
  const kin = reps.filter((id) => id === base || PIECES.SHAPES[id].variantOf === base)
  const rest = reps.filter((id) => !kin.includes(id) && (all || !PIECES.SHAPES[id].variantOf))
  const counts = new Map<string, number>()
  for (const p of ps) counts.set(p.shape, (counts.get(p.shape) || 0) + 1)
  // стабільність: одна деталь — її, кілька — найменша
  const sv = stab && ps.every((p) => stab.has(p.id)) ? Math.min(...ps.map((p) => stab.get(p.id) ?? 0)) : null
  return (
    <Shell title={ps.length === 1 ? lab(s.name) : plural(ps.length, [t('деталь'), t('деталі'), t('деталей')])}>
      <div className="flex items-center gap-2">
        <PieceIcon id={first.shape} size={44} />
        <p className="min-w-0 text-[11.5px] leading-snug text-muted">
          {ps.length === 1
            ? <>{t('На висоті +{z}', { z: fmt(first.z) })}{s.h ? ' · ' + t('заввишки {h}', { h: fmt(s.h) }) : ''}. {s.cost.map(([i, q]) => (i === 'Stone' ? t('{n} каменю', { n: q }) : `${q} ${i}`)).join(', ')}</>
            : [...counts].map(([id, n]) => `${lab(PIECES.SHAPES[id]?.name ?? '')} ×${n}`).join(', ')}
          {sv !== null && <span className={sv <= 0 ? 'block font-semibold text-bad' : sv < 50 ? 'block text-spice' : 'block'}>{sv <= 0 ? t('Нестабільна: нема опори ближче ніж за 9 деталей') : ps.length > 1 ? t('Стабільність (найменша): {n} %', { n: sv }) : t('Стабільність: {n} %', { n: sv })}</span>}
        </p>
      </div>
      {same && (
        <div className="grid gap-1">
          <span className="text-[11px] text-muted">{t('Замінити на…')}</span>
          <div className="grid max-h-[220px] grid-cols-4 gap-1 overflow-y-auto overscroll-contain">
            {[...kin, ...rest].map((id) => (
              <button key={id} type="button" onClick={() => replacePieces(ids, id)} title={lab(PIECES.SHAPES[id].name)} className="grid justify-items-center gap-0.5 rounded border border-transparent p-0.5 text-center text-[9.5px] leading-tight text-muted hover:border-spice hover:text-ink">
                <PieceIcon id={id} size={36} />
                <span className="line-clamp-2">{lab(PIECES.SHAPES[id].name)}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setAll((v) => !v)} className="justify-self-start text-[11px] text-muted underline underline-offset-2 hover:text-ink">{all ? t('Лише основні форми') : t('Усі варіанти')}</button>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => turnPieces(ids)} className={btn} title="R"><RotateCw size={12} /> {t('Поворот')}</button>
        {ps.some((p) => PIECES.MIRROR[p.shape]) && <button type="button" onClick={() => mirrorPieces(ids)} className={btn} title="F"><FlipHorizontal2 size={12} /> {t('Дзеркально')}</button>}
        <button type="button" onClick={() => removePieces(ids)} className={cn(btn, 'border-bad/40 text-bad hover:bg-bad/10')} title="Del"><Trash2 size={12} /> {t('Прибрати')}</button>
      </div>
      <p className="text-[10.5px] leading-snug text-muted">{t('Перемістити: тягни вибране мишею чи стрілки — на клітинку (↑ ↓ — від себе й до себе, як дивиться камера).')}</p>
    </Shell>
  )
}

export function ZoneCard({ M, id }: { M: Model; id: string }) {
  const r = M.rooms.find((x: any) => x.id === id)
  const ed = useBuilder.getState
  if (!r) return null
  const upd = (fn: (z: any) => void, label: string) => ed().apply((d) => { const z = (d.zones || []).find((x: any) => x.id === id); if (z) fn(z) }, label)
  const groups = { ...GROUPS, ...(r.group in GROUPS ? {} : { [r.group]: r.group }) } as Record<string, string>
  const count = plural(Math.round(M.roomArea(r)), [t('плита'), t('плити'), t('плит')])
  const vars = { count, z: fmt(r.z0), top: fmt(r.z0 + r.h) }
  return (
    <Shell title={r.name}>
      <Row label={t('Назва')}><Text label={t('Назва')} value={r.name} onCommit={(v) => upd((z) => { z.name = v.trim() || z.name }, t('назва приміщення'))} /></Row>
      <Row label={t('Коротка назва на плані')}><Text label={t('Коротка назва на плані')} value={r.short ?? ''} onCommit={(v) => upd((z) => { if (v.trim()) z.short = v.trim(); else delete z.short }, t('коротка назва'))} /></Row>
      <Row label={t('Призначення (колір на плані)')}>
        <SnSelect modelValue={r.group} options={Object.entries(groups).map(([k, l]) => ({ value: k, label: l }))} accessibilityLabel={t('Призначення (колір на плані)')} onChange={(e: Event) => upd((z) => { z.group = valueOf(e) }, t('призначення'))} />
      </Row>
      <Row label={t('Нотатка')}><Text area label={t('Нотатка')} value={r.note ?? ''} onCommit={(v) => upd((z) => { if (v.trim()) z.note = v.trim(); else delete z.note }, t('нотатка'))} /></Row>
      <p className="text-[11px] text-muted">
        {r.h > 0
          ? t('{count} · підлога +{z} · до +{top} · межі — стіни (і проходи) довкола; нова підлога в тому самому просторі додається сама.', vars)
          : t('{count} · підлога +{z} · без стелі · межі — стіни (і проходи) довкола; нова підлога в тому самому просторі додається сама.', vars)}
      </p>
      <button type="button" onClick={() => { ed().apply((d) => { d.zones = (d.zones || []).filter((x: any) => x.id !== id) }, t('приміщення прибрано')); ed().set({ sel: null }) }} className={cn(btn, 'justify-self-start border-bad/40 text-bad hover:bg-bad/10')}>
        <Trash2 size={12} /> {t('Прибрати назву (деталі лишаться)')}
      </button>
    </Shell>
  )
}

export function ItemCard({ M, i }: { M: Model; i: number }) {
  const it = M.items[i]
  const ed = useBuilder.getState
  if (!it) return null
  const upd = (fn: (x: any) => void, label: string) => ed().apply((d) => { if (d.items?.[i]) fn(d.items[i]) }, label)
  const kinds = { ...KINDS, ...(it.kind in KINDS ? {} : { [it.kind]: it.kind }) } as Record<string, string>
  return (
    <Shell title={lab(it.name)}>
      <Row label={t('Назва')}><Text label={t('Назва')} value={it.name} onCommit={(v) => upd((x) => { x.name = v.trim() || x.name }, t('назва станції'))} /></Row>
      <Row label={t('Тип')}>
        <SnSelect modelValue={it.kind} options={Object.entries(kinds).map(([k, l]) => ({ value: k, label: l }))} accessibilityLabel={t('Тип')} onChange={(e: Event) => upd((x) => { x.kind = valueOf(e) }, t('тип станції'))} />
      </Row>
      <div className="grid grid-cols-3 gap-1.5">
        <Row label={t('Ширина')}><Num label={t('Ширина')} value={it.w} step={0.1} onCommit={(v) => upd((x) => { x.w = Math.max(0.1, v) }, t('розмір станції'))} /></Row>
        <Row label={t('Глибина')}><Num label={t('Глибина')} value={it.d} step={0.1} onCommit={(v) => upd((x) => { x.d = Math.max(0.1, v) }, t('розмір станції'))} /></Row>
        <Row label={t('Висота')}><Num label={t('Висота')} value={it.h} step={0.1} onCommit={(v) => upd((x) => { x.h = Math.max(0, v) }, t('розмір станції'))} /></Row>
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => upd((x) => { x.ang = (((x.ang || 0) + 15) % 360 + 360) % 360 }, t('поворот'))} className={btn} title="R"><RotateCw size={12} /> +15°</button>
        <button type="button" onClick={() => { ed().apply((d) => { d.items = d.items.filter((_: any, k: number) => k !== i) }, t('станцію прибрано')); ed().set({ sel: null }) }} className={cn(btn, 'border-bad/40 text-bad hover:bg-bad/10')}><Trash2 size={12} /> {t('Прибрати')}</button>
      </div>
      <p className="text-[10.5px] leading-snug text-muted">{t('Перемістити: тягни мишею чи стрілки — на блок, з Shift — на 0,1.')}</p>
    </Shell>
  )
}

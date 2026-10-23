/**
 * Спеціалізації в планувальнику — як у грі (вкладка «Навички» → «Спеціалізації»):
 *   • п'ять треків рядками, порядок гри; ліворуч — ромб треку з рівнем («рів. 2»);
 *   • рядок — стрічка рівнів 1–100, що гортається вбік (колесом, перетягуванням, стрілками — Strip): на рівнях з рисою — картка (над нею рівень, на значку —
 *     ціна в меланжі, галочка — куплено; ще не досяжна — притемнена); смуга під стрічкою — до поточного рівня
 *     (рівні без риси — лише порожні відрізки смуги, окремих вузлів немає; пасивний бонус рівня — у підказці риси);
 *   • клік по картці — купити чи продати рису (не дорісь — рівень треку підніметься до неї); рівень треку
 *     міняють «−/+» у картці праворуч; наведення на картку — підказка риси, як у грі, під карткою й прозора для
 *     курсора (на телефоні — дотик, шторка знизу з «Купити»);
 *   • праворуч — картка вибраного треку, як у грі: рівень, досвід, «Рис придбано N (41)», пасивні бонуси, сума
 *     куплених рис, меланж; «Купити всі доступні» / «Продати всі».
 * Рівень знизили — куплені риси вище нього злітають. Дані — lib/specs.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bomb, Check, ChevronLeft, ChevronRight, Compass, Hammer, Lock, Minus, Pickaxe, Plus, Swords, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { locale, t } from '@/lib/i18n'
import { GT_IMG, SPEC_MAX, TRACKS, atLevel, fmtKey, fmtPassive, keepGot, useSpecs, type Keystone, type Specs, type Track } from '@/lib/specs'
import { ErrorAlert, Loading } from '@/components/states'
import { useAnchor } from './anchor'
import { Img as UiImg } from '@/components/ui/img'

const ICON = { craftingtrack: Hammer, gatheringtrack: Pickaxe, explorationtrack: Compass, combattrack: Swords, sabotagetrack: Bomb } as const
type Id = keyof typeof ICON
const n = (v: number) => v.toLocaleString(locale())
const GRACE = 90
const FADE = 130
const W = 320
type Tip = { ti: number; ki: number; el: HTMLElement; pin: boolean }

/** іконка риси (через наш сайт); нема чи не вантажиться — значок треку */
function Img({ src, Fallback, className }: { src: string | null; Fallback: typeof Hammer; className: string }) {
  const fb = <Fallback className={className} strokeWidth={1.6} />
  return src ? <UiImg src={GT_IMG + src} className={cn(className, 'object-contain')} fallback={fb} /> : fb
}

/**
 * підказка риси — як у грі: «РИСА», назва, опис, стати; рівень і ціна. Під карткою (не влазить — над нею) і
 * «прозора» для курсора: можна вести мишею вздовж ряду від риси до риси, купує клік по самій картці. На дотик —
 * закріплена шторка з кнопкою «Купити» / «Продати»
 */
function TraitTip({ k, track, level, got, el, out, pinned, onToggle, onClose, onEnter, onLeave }: {
  k: Keystone; track: Track; level: number; got: boolean; el: HTMLElement; out: boolean; pinned: boolean
  onToggle: () => void; onClose: () => void; onEnter: () => void; onLeave: () => void
}) {
  const { box, pos, sheet, frame } = useAnchor(el, W, 12, 'y')
  const reach = k.level <= level
  const live = pinned || sheet // з кнопками й закриттям; інакше — лише підказка
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={k.name}
      data-trait-tip
      data-out={out || undefined}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      className={cn('sk-night sk-tip fixed z-50 grid gap-2 overflow-y-auto border border-line p-3.5 shadow-[0_18px_50px_rgb(0_0_0/0.45)]', frame.className, !pos && 'invisible', !live && 'pointer-events-none')}
      style={frame.style}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-line bg-panel">
          <Img src={k.icon} Fallback={ICON[track.id as Id] ?? Hammer} className="h-9 w-9 text-ink/80" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{t('Риса · {track}', { track: track.name })}</p>
          <h3 className="font-display text-[14.5px] font-bold leading-snug">{k.name}</h3>
        </div>
        {live && (
          <button type="button" onClick={onClose} className="-mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-ink/10 hover:text-ink" aria-label={t('Закрити')}><X size={15} /></button>
        )}
      </div>
      {k.desc && <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-ink/80">{k.desc}</p>}
      {(k.stats.length > 0 || k.sp > 0) && (
        <ul className="grid gap-0.5 rounded-md bg-panel/70 px-2.5 py-1.5 text-[12.5px]">
          {k.sp > 0 && <li className="flex justify-between gap-3"><span>{t('Очки навичок')}</span><b className="font-mono">+{k.sp}</b></li>}
          {k.stats.map((s) => (
            <li key={s.name} className="flex justify-between gap-3"><span>{s.name}</span><b className="font-mono">{fmtKey(s)}</b></li>
          ))}
        </ul>
      )}
      {track.passive.length > 0 && (
        <p className="text-[11.5px] leading-snug text-muted">
          {t('Пасивно на {level}-му рівні: {bonus}', { level: k.level, bonus: track.passive.map((p) => `${p.name} ${fmtPassive(p.values, k.level)}`).join(', ') })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-muted">{t('Рівень {level} · {spice} меланжу', { level: k.level, spice: k.spice })}</span>
        {live ? (
          <button
            type="button"
            onClick={onToggle}
            className={cn('ml-auto h-8 rounded-md px-3 font-semibold', got ? 'border border-line hover:border-spice' : 'bg-spice text-on-spice hover:bg-spice/90')}
          >
            {got ? t('Продати') : reach ? t('Купити') : t('Купити (рівень → {level})', { level: k.level })}
          </button>
        ) : (
          <span className={cn('ml-auto rounded px-1.5 py-0.5 font-semibold', got ? 'bg-spice text-on-spice' : 'text-ink/85')}>
            {got ? t('✓ куплено · клік — продати') : t('клік — купити')}
          </span>
        )}
      </div>
      {!reach && !got && <p className="text-[11.5px] text-muted">{t('Трек ще на {level}-му рівні — купівля підніме його до {to}-го.', { level, to: k.level })}</p>}
    </div>
  )
}

/**
 * Стрічка рівнів, що гортається вбік без смуги прокрутки (під стрічкою вже є смуга прогресу):
 *   • колесо миші — і вертикальне: поки є куди гортати; на краю колесо знову гортає сторінку;
 *   • перетягування мишею (від 5 px — це вже не клік по картці);
 *   • стрілки з боків — на ¾ ширини; краї, за якими ще є картки, плавно згасають.
 * Спершу — до поточного рівня треку; рівень змінили збоку (панель, «−/+») і він поза видимим — пливе до нього.
 */
function Strip({ level, ready, onDrag, children }: { level: number; ready: boolean; onDrag: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState('')
  const dragRef = useRef(onDrag)
  dragRef.current = onDrag
  const edges = () => {
    const el = ref.current
    if (!el) return
    const l = el.scrollLeft > 2
    const r = el.scrollLeft < el.scrollWidth - el.clientWidth - 2
    setFade((l ? 'l' : '') + (r ? 'r' : ''))
  }
  const nodeOf = (lv: number) => ref.current?.querySelector<HTMLElement>(`[data-lv="${Math.max(1, lv)}"]`)
  useLayoutEffect(() => {
    const el = ref.current
    const node = nodeOf(level)
    if (el && node) el.scrollLeft = Math.max(0, node.offsetLeft - el.clientWidth / 3)
    edges()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
  useEffect(() => {
    const el = ref.current
    const node = nodeOf(level)
    if (!el || !node) return
    const a = node.offsetLeft, b = a + node.offsetWidth
    if (a < el.scrollLeft || b > el.scrollLeft + el.clientWidth) el.scrollTo({ left: Math.max(0, a - el.clientWidth / 3), behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!d || e.ctrlKey) return
      const max = el.scrollWidth - el.clientWidth
      if ((d < 0 && el.scrollLeft <= 0) || (d > 0 && el.scrollLeft >= max - 1)) return // край — гортається сторінка
      e.preventDefault()
      el.scrollLeft += d * (e.deltaMode === 1 ? 40 : 1)
    }
    let start: { x: number; left: number; id: number } | null = null
    let moved = false
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      start = { x: e.clientX, left: el.scrollLeft, id: e.pointerId }
      moved = false
    }
    const move = (e: PointerEvent) => {
      if (!start) return
      const dx = e.clientX - start.x
      if (!moved && Math.abs(dx) > 5) {
        moved = true
        el.setPointerCapture(start.id)
        el.classList.add('sk-drag')
        dragRef.current()
      }
      if (moved) el.scrollLeft = start.left - dx
    }
    const up = () => {
      if (moved) {
        el.classList.remove('sk-drag')
        // тягнули — це не клік по картці
        const stop = (ev: Event) => { ev.stopPropagation(); ev.preventDefault() }
        el.addEventListener('click', stop, { capture: true, once: true })
        window.setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 0)
      }
      start = null
      moved = false
    }
    const ro = new ResizeObserver(edges)
    ro.observe(el)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('scroll', edges, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('scroll', edges)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const go = (dir: number) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.75, behavior: 'smooth' })
  const arrow = 'absolute top-[43px] z-[3] grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-line bg-panel/95 text-ink/85 shadow-[0_4px_14px_rgb(0_0_0/0.4)] transition-colors hover:border-spice hover:text-spice'
  return (
    <div className="relative min-w-0 flex-1">
      <div ref={ref} data-fade={fade || undefined} className="sk-strip overflow-x-auto">{children}</div>
      {fade.includes('l') && <button type="button" onClick={() => go(-1)} aria-label={t('Гортати ліворуч')} className={cn(arrow, 'left-1')}><ChevronLeft size={17} /></button>}
      {fade.includes('r') && <button type="button" onClick={() => go(1)} aria-label={t('Гортати праворуч')} className={cn(arrow, 'right-2')}><ChevronRight size={17} /></button>}
    </div>
  )
}

export function SpecView({ spec, tracks, set }: { spec: Specs; tracks: Record<string, Track> | null; set: (s: Specs) => void }) {
  const [sel, setSel] = useState(() => Math.max(0, spec.lv.findIndex(Boolean)))
  const failed = useSpecs((s) => s.failed)
  const tr = (i: number) => tracks?.[TRACKS[i][0]] ?? null

  const setLevel = (i: number, v: number) => {
    const L = Math.max(0, Math.min(SPEC_MAX, Math.round(v) || 0))
    const got = keepGot(tr(i), L, spec.got[i])
    const gone = spec.got[i].length - got.length
    if (gone) toast.info(t('{track}: знято рис вище {level}-го рівня — {n}', { track: TRACKS[i][1], level: L, n: gone }), { id: 'spec' })
    set({ lv: spec.lv.map((x, j) => (j === i ? L : x)), got: spec.got.map((g, j) => (j === i ? got : g)) })
    setSel(i)
  }
  const toggle = (i: number, ki: number) => {
    const k = tr(i)?.keys[ki]
    if (!k) return
    const has = spec.got[i].includes(ki)
    const got = has ? spec.got[i].filter((x) => x !== ki) : [...spec.got[i], ki].sort((a, b) => a - b)
    const lv = Math.max(spec.lv[i], has ? 0 : k.level)
    set({ lv: spec.lv.map((x, j) => (j === i ? lv : x)), got: spec.got.map((g, j) => (j === i ? got : g)) })
    setSel(i)
  }
  const buyAll = (i: number) => {
    const track = tr(i)
    if (!track) return
    set({ ...spec, got: spec.got.map((g, j) => (j === i ? track.keys.map((k, ki) => (k.level <= spec.lv[i] ? ki : -1)).filter((x) => x >= 0) : g)) })
  }
  const sellAll = (i: number) => set({ ...spec, got: spec.got.map((g, j) => (j === i ? [] : g)) })

  // підказка риси: наведення — одразу, піти — коротка пауза й згасання; дотик — закріплена шторка
  const [tip, setTipState] = useState<Tip | null>(null)
  const [out, setOut] = useState(false)
  const tipRef = useRef<Tip | null>(null)
  const timer = useRef(0)
  const ptr = useRef('mouse')
  const setTip = (v: Tip | null) => { tipRef.current = v; setTipState(v) }
  const show = (ti: number, ki: number, el: HTMLElement, pin = false) => { window.clearTimeout(timer.current); setOut(false); setTip({ ti, ki, el, pin }) }
  const close = () => {
    window.clearTimeout(timer.current)
    if (!tipRef.current) return
    setOut(true)
    timer.current = window.setTimeout(() => { setTip(null); setOut(false) }, FADE)
  }
  const hide = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (!tipRef.current?.pin) close() }, GRACE) }
  const keep = () => { window.clearTimeout(timer.current); setOut(false) }
  useEffect(() => {
    if (!tip) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const down = (e: PointerEvent) => { if (!(e.target as Element).closest?.('[data-trait-tip],[data-trait]')) close() }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', down)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', down) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip])

  const si = sel
  const st = tr(si)
  const sa = st ? atLevel(st, spec.lv[si], spec.got[si]) : null
  const SI = ICON[TRACKS[si][0] as Id]
  const tipT = tip ? tr(tip.ti) : null
  const tipK = tip && tipT ? tipT.keys[tip.ki] : null

  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
      {/* треки */}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2">
        {TRACKS.map(([id, name], i) => {
          const trk = tr(i)
          const lv = spec.lv[i]
          const I = ICON[id as Id]
          // рис на рівні буває й дві — тоді обидві в одній колонці
          const keyAt = new Map<number, number[]>()
          trk?.keys.forEach((k, ki) => keyAt.set(k.level, [...(keyAt.get(k.level) ?? []), ki]))
          return (
            <div key={id} className={cn('flex min-w-0 items-center gap-2 rounded-xl border p-1.5 pr-0 transition-colors sm:gap-3', si === i ? 'border-spice/50 bg-panel/50' : 'border-transparent')}>
              {/* ромб треку з рівнем */}
              <button type="button" onClick={() => setSel(i)} className="group grid w-[64px] shrink-0 justify-items-center gap-1" aria-label={t('{name}, рівень {lv}', { name: trk?.name ?? name, lv })}>
                <span className={cn('grid h-11 w-11 rotate-45 place-items-center rounded-md border-2 transition-colors', lv ? 'border-spice bg-panel2' : 'border-line bg-panel', si === i && 'ring-2 ring-spice/40')}>
                  <Img src={trk?.icon ?? null} Fallback={I} className="h-7 w-7 -rotate-45 text-ink/85" />
                </span>
                <span className="whitespace-nowrap rounded bg-panel px-1.5 font-mono text-[11px] font-semibold tabular-nums ring-1 ring-line">{t('рів. {lv}', { lv })}</span>
              </button>
              {/* стрічка рівнів */}
              {!trk ? (
                failed
                  ? (
                    <div className="grid min-w-0 flex-1 gap-1.5">
                      <ErrorAlert title={t('Спеціалізації не завантажились')} message={t('Сайт із даними гри зараз не відповідає.')} />
                      {i === 0 && <button type="button" onClick={() => useSpecs.getState().load()} className="h-8 w-fit rounded-md border border-line px-3 text-[12.5px] hover:border-spice">{t('Спробувати ще')}</button>}
                    </div>
                  )
                  : <Loading lines={2} className="min-w-0 flex-1 py-3" />
              ) : (
              <Strip level={lv} ready={!!trk} onDrag={close}>
                <div className="flex w-max items-stretch px-1 pb-1.5 pt-3">
                  {Array.from({ length: SPEC_MAX }, (_, j) => j + 1).map((L) => {
                    const kis = keyAt.get(L) ?? []
                    const on = L <= lv
                    return (
                      // рівень — колонка: вузол і відрізок смуги під ним (смуга суцільна — до поточного рівня)
                      <div key={L} data-lv={L} className="flex shrink-0 flex-col items-center">
                        <div className={cn('flex h-[62px] items-center gap-[6px]', kis.length ? 'px-[6px]' : 'w-[14px]')}>
                          {kis.map((ki) => {
                            const k = trk.keys[ki]
                            const got = spec.got[i].includes(ki)
                            return (
                            <button
                              key={ki}
                              type="button"
                              data-trait
                              onPointerDown={(e) => { ptr.current = e.pointerType }}
                              onPointerEnter={(e) => { if (e.pointerType === 'mouse') show(i, ki, e.currentTarget) }}
                              onPointerLeave={(e) => { if (e.pointerType === 'mouse') hide() }}
                              onFocus={(e) => { if (ptr.current !== 'touch') show(i, ki, e.currentTarget) }}
                              onClick={(e) => {
                                if (ptr.current === 'touch') return show(i, ki, e.currentTarget, true)
                                toggle(i, ki)
                              }}
                              aria-label={got ? t('{name}, рівень {level}, {spice} меланжу, куплено', { name: k.name, level: k.level, spice: k.spice }) : t('{name}, рівень {level}, {spice} меланжу', { name: k.name, level: k.level, spice: k.spice })}
                              className={cn(
                                'relative grid h-[58px] w-[58px] place-items-center rounded-md border-2 transition-colors',
                                got ? 'border-spice bg-spice/20' : on ? 'border-ink/35 bg-panel hover:border-spice' : 'border-line bg-panel/60 hover:border-spice/60',
                              )}
                            >
                              <Img src={k.icon} Fallback={I} className={cn('h-10 w-10 text-ink/80', !on && !got && 'opacity-35')} />
                              {/* рівень — ромбом над карткою, ціна — значком у куті, галочка — куплено */}
                              <span className={cn('absolute -top-[11px] left-1/2 grid h-[20px] w-[20px] -translate-x-1/2 rotate-45 place-items-center border', on ? 'border-spice bg-panel2' : 'border-line bg-panel')}>
                                <span className="-rotate-45 font-mono text-[10px] font-bold tabular-nums">{L}</span>
                              </span>
                              <span className={cn('absolute -right-[7px] -top-[7px] min-w-[17px] rounded-[4px] px-[3px] font-mono text-[10px] font-bold leading-[16px] tabular-nums', got ? 'bg-ink text-panel' : 'bg-spice text-on-spice')} title={t('Меланжу')}>{k.spice}</span>
                              {got && <Check size={15} strokeWidth={3} className="absolute -bottom-[6px] -right-[6px] rounded-full bg-spice p-[2px] text-on-spice" />}
                              {!on && !got && <Lock size={11} className="absolute bottom-[3px] left-[3px] text-ink/50" />}
                            </button>
                            )
                          })}
                        </div>
                        <span className={cn('mt-1.5 h-[3px] w-full', on ? 'bg-spice' : 'bg-line/70')} />
                      </div>
                    )
                  })}
                </div>
              </Strip>
              )}
            </div>
          )
        })}
      </div>

      {/* картка вибраного треку — як у грі */}
      <aside className="grid content-start gap-3 rounded-xl border border-line bg-panel/60 p-4" aria-label={t('Вибраний трек')}>
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 rotate-45 place-items-center rounded-md border-2 border-spice bg-panel2">
            <Img src={st?.icon ?? null} Fallback={SI} className="h-8 w-8 -rotate-45 text-ink/85" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-bold uppercase tracking-[0.1em]">{st?.name ?? TRACKS[si][1]}</h2>
            <p className="text-[11.5px] leading-snug text-muted">{TRACKS[si][2]}</p>
          </div>
        </div>
        <div className="grid divide-y divide-line rounded-lg border border-line text-[12.5px]">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="flex-1">{t('Рівень')}</span>
            <button type="button" onClick={() => setLevel(si, spec.lv[si] - 1)} disabled={!spec.lv[si]} className="grid h-7 w-7 place-items-center rounded-md border border-line hover:border-spice disabled:opacity-35" aria-label={t('Рівень нижче')}><Minus size={13} /></button>
            <LevelInput key={si} value={spec.lv[si]} min={0} max={SPEC_MAX} onCommit={(v) => setLevel(si, v)} label={t('{name}: рівень', { name: TRACKS[si][1] })}
              className="h-8 w-14 rounded-md border border-line bg-panel px-1.5 text-center font-mono text-[16px] tabular-nums sm:h-7 sm:text-[13px]" />
            <button type="button" onClick={() => setLevel(si, spec.lv[si] + 1)} disabled={spec.lv[si] >= SPEC_MAX} className="grid h-7 w-7 place-items-center rounded-md border border-line hover:border-spice disabled:opacity-35" aria-label={t('Рівень вище')}><Plus size={13} /></button>
          </div>
          {sa && (
            <>
              <div className="flex justify-between gap-3 px-3 py-1.5"><span>{t('Досвіду до рівня')}</span><b className="font-mono tabular-nums">{n(sa.xp)}</b></div>
              <div className="flex justify-between gap-3 px-3 py-1.5" title={t('Куплено рис (усього в треку); доступно — до поточного рівня')}>
                <span>{t('Рис придбано')}</span>
                <b className="font-mono tabular-nums">{t('{bought} ({total}) · доступно {open}', { bought: sa.bought.length, total: st!.keys.length, open: sa.open })}</b>
              </div>
              <div className="flex justify-between gap-3 px-3 py-1.5"><span>{t('Меланжу на риси')}</span><b className="font-mono tabular-nums">{n(sa.spice)}</b></div>
              {st!.passive.map((p) => (
                <div key={p.name} className="flex justify-between gap-3 px-3 py-1.5" title={t('Пасивний бонус — росте з рівнем сам')}>
                  <span>{p.name}</span><b className="font-mono tabular-nums text-spice">{fmtPassive(p.values, spec.lv[si])}</b>
                </div>
              ))}
              {sa.sp > 0 && <div className="flex justify-between gap-3 px-3 py-1.5"><span>{t('Очки навичок')}</span><b className="font-mono tabular-nums text-spice">+{sa.sp}</b></div>}
              {sa.stats.map((s) => (
                <div key={s.name} className="flex justify-between gap-3 px-3 py-1.5"><span>{s.name}</span><b className="font-mono tabular-nums">{fmtKey(s)}</b></div>
              ))}
              {sa.perks.map((k) => (
                <div key={k.name} className="px-3 py-1.5" title={k.desc}><span className="text-muted">{t('Відкрито:')} </span>{k.name}</div>
              ))}
            </>
          )}
        </div>
        {st && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => buyAll(si)} disabled={!sa || sa.bought.length >= sa.open} className="h-8 flex-1 rounded-md bg-spice px-3 text-[12.5px] font-semibold text-on-spice hover:bg-spice/90 disabled:opacity-40">
              {t('Купити всі доступні')}
            </button>
            <button type="button" onClick={() => sellAll(si)} disabled={!sa?.bought.length} className="h-8 rounded-md border border-line px-3 text-[12.5px] hover:border-spice disabled:opacity-40">
              {t('Продати всі')}
            </button>
          </div>
        )}
      </aside>

      {tip && tipT && tipK &&
        createPortal(
          <TraitTip
            k={tipK}
            track={tipT}
            level={spec.lv[tip.ti]}
            got={spec.got[tip.ti].includes(tip.ki)}
            el={tip.el}
            out={out}
            pinned={tip.pin}
            onToggle={() => toggle(tip.ti, tip.ki)}
            onClose={close}
            onEnter={keep}
            onLeave={hide}
          />,
          document.body,
        )}
    </div>
  )
}

/**
 * Поле рівня: набране застосовується, лише коли людина закінчила (вийшла з поля чи Enter). Інакше набір «55»
 * після першої «5» уже ставив рівень 5 — і знімав куплені риси вище нього; порожнє поле не стає одразу «1».
 */
export function LevelInput({ value, min, max, onCommit, label, className }: { value: number; min: number; max: number; onCommit: (v: number) => void; label: string; className?: string }) {
  const [text, setText] = useState(String(value || ''))
  useEffect(() => setText(String(value || '')), [value])
  const commit = () => {
    const n = Math.round(Number(text))
    if (!text.trim() || !Number.isFinite(n)) { setText(String(value || '')); return }
    const v = Math.max(min, Math.min(max, n))
    setText(String(v))
    if (v !== value) onCommit(v)
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, '').slice(0, 3))}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } else if (e.key === 'Escape') setText(String(value || '')) }}
      onFocus={(e) => e.currentTarget.select()}
      aria-label={label}
      className={className}
    />
  )
}

/**
 * Карта світу як одна з мап розділу «Мапа» (/map?m=overmap): карта поверхні Арракіса з гри поруч із Западиною,
 * Глибокою пустелею й містами. Та сама будова, що й в інших мап: бічна панель (вибір мапи — picker від MapPage, пошук і
 * категорії, картка вибраного місця, список) і полотно зі схемою, яку можна масштабувати й тягати (колесо, щипок,
 * перетягування, кнопки). На телефоні панель — висувний лист, як «Шари». Вибране місце, пошук і категорія — в адресі
 * (?loc=, ?q=, ?k=). Дані — /api/world (з файлів гри).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BookOpen, Maximize2, Minus, Plus, Users, X } from 'lucide-react'
import { Loading, PageError } from '@/components/states'
import { useCrumb } from '@/components/Crumbs'
import { Seg } from '@/components/ui/seg'
import { SHEET_BASE, SheetBackdrop, SheetHead } from '@/components/ui/sheet'
import { SnInput, valueOf } from '@/components/sn'
import { WorldSvg } from '@/components/world/WorldSvg'
import { LocationCard } from '@/components/world/LocationCard'
import { locale, t } from '@/lib/i18n'
import { plainClick, useUrlParam } from '@/lib/urlState'
import { catColor, catName, catOrder, linkReqs, matches, useWorld, type World, type WorldLoc } from '@/lib/world'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'

export const WORLD_MAP = 'overmap'
const BLOCK = 'rounded-xl border border-line bg-panel lg:shadow-lg'
const BTN = 'grid h-10 w-10 place-items-center rounded-md border border-line bg-panel/95 text-ink shadow backdrop-blur hover:text-spice'
const narrow = () => matchMedia('(max-width: 1023.98px)').matches
const okLoc = (v: string) => /^[\w.-]{1,120}$/.test(v)

/** категорія місця для фільтра: сама або батьківська (Містини = Регіони + Поселення) */
const inCat = (w: World, l: WorldLoc, k: string) => !k || l.tag === k || w.categories.find((c) => c.tag === l.tag)?.parent === k

type View = [number, number, number, number]

/**
 * Масштаб і зсув схеми: видима частина карти тих самих пропорцій, що й полотно. Колесо — до курсора, щипок — двома
 * пальцями, тягнути — зсув; рух понад 4 px — не клік (точка під пальцем не вибирається). Спершу видно всі місця
 * (bounds); далі за край картинки карти (limit) не тягнеться й не віддаляється.
 */
function usePanZoom(box: React.RefObject<HTMLDivElement>, bounds: [number, number, number, number], limit: [number, number, number, number]) {
  const [bx0, by0, bx1, by1] = bounds
  const [lx0, ly0, lx1, ly1] = limit
  const BW = bx1 - bx0, BH = by1 - by0
  const [view, setView] = useState<View | null>(null)
  const viewRef = useRef<View | null>(null)
  viewRef.current = view
  const size = () => { const r = box.current!.getBoundingClientRect(); return { cw: Math.max(1, r.width), ch: Math.max(1, r.height), r } }
  /** уся карта з полями, у пропорціях полотна */
  const fitView = useCallback((): View => {
    const { cw, ch } = size()
    const a = cw / ch
    let w = BW * 1.04, h = w / a
    if (h < BH * 1.04) { h = BH * 1.04; w = h * a }
    return [bx0 + BW / 2 - w / 2, by0 + BH / 2 - h / 2, w, h]
  }, [bx0, by0, BW, BH]) // eslint-disable-line react-hooks/exhaustive-deps
  /** не далі за край: ширина — від 1/10 місць до всієї картинки (у пропорціях полотна), полотно — в межах картинки */
  const clamp = useCallback((v: View): View => {
    const f = fitView()
    let [x, y, w, h] = v
    const a = w / h
    // є картинка карти — полотно завжди нею заповнене (не більше за неї); нема — вся схема з полями
    const strict = lx0 !== bx0 || ly0 !== by0 || lx1 !== bx1 || ly1 !== by1
    const fill = Math.min(lx1 - lx0, (ly1 - ly0) * a)
    const maxW = strict ? fill : Math.max(f[2], fill)
    const k = Math.min(Math.max(w, f[2] / 10), maxW) / w
    const cx = x + w / 2, cy = y + h / 2
    w *= k; h *= k
    // менше за картинку — у її межах; більше (вузьке полотно) — центр усередині картинки
    const ccx = w <= lx1 - lx0 ? Math.min(Math.max(cx, lx0 + w / 2), lx1 - w / 2) : Math.min(Math.max(cx, lx0), lx1)
    const ccy = h <= ly1 - ly0 ? Math.min(Math.max(cy, ly0 + h / 2), ly1 - h / 2) : Math.min(Math.max(cy, ly0), ly1)
    x = ccx - w / 2; y = ccy - h / 2
    return [x, y, w, h]
  }, [fitView, bx0, by0, bx1, by1, lx0, ly0, lx1, ly1])
  const zoomAt = useCallback((px: number, py: number, f: number) => {
    const v = viewRef.current
    if (!v) return
    const { cw, ch } = size()
    const wx = v[0] + (px / cw) * v[2], wy = v[1] + (py / ch) * v[3]
    const w = v[2] * f, h = v[3] * f
    setView(clamp([wx - (px / cw) * w, wy - (py / ch) * h, w, h]))
  }, [clamp]) // eslint-disable-line react-hooks/exhaustive-deps

  // перший вигляд і зміна розміру полотна: пропорції — полотна, масштаб і центр — як були
  // нові межі (дані карти щойно прийшли) — уся карта заново, а не масштаб, підігнаний під порожнє місце
  const boundsKey = [...bounds, ...limit].join(',')
  const seenBounds = useRef('')
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const on = () => {
      const v = viewRef.current
      if (!v || seenBounds.current !== boundsKey) { seenBounds.current = boundsKey; return setView(clamp(fitView())) }
      const { cw, ch } = size()
      const h = v[2] / (cw / ch)
      setView(clamp([v[0], v[1] + v[3] / 2 - h / 2, v[2], h]))
    }
    on()
    const ro = new ResizeObserver(on)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitView, clamp, boundsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // колесо, тягнути, щипок — рідними подіями (колесо мусить бути не пасивним, щоб сторінка не гортались)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const pts = new Map<number, { x: number; y: number }>()
    let moved = 0, last: { x: number; y: number; d: number } | null = null
    const mid = () => {
      const a = [...pts.values()]
      const x = a.reduce((s, p) => s + p.x, 0) / a.length, y = a.reduce((s, p) => s + p.y, 0) / a.length
      return { x, y, d: a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0 }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const { r } = size()
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(Math.max(-3, Math.min(3, dy * (e.ctrlKey ? 0.01 : 0.0015)))))
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pts.size === 1) moved = 0
      last = mid()
    }
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const m = mid()
      if (!last) { last = m; return }
      moved += Math.hypot(m.x - last.x, m.y - last.y)
      if (moved > 4 && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId)
      const v = viewRef.current
      if (v && moved > 4) {
        const { cw, r } = size()
        const s = v[2] / cw
        let next: View = [v[0] - (m.x - last.x) * s, v[1] - (m.y - last.y) * s, v[2], v[3]]
        // щипок: масштаб навколо середини пальців
        if (m.d && last.d) {
          const f = last.d / m.d
          const px = m.x - r.left, py = m.y - r.top
          const wx = next[0] + (px / cw) * next[2], wy = next[1] + (py / cw) * next[2]
          next = [wx - (px / cw) * next[2] * f, wy - (py / cw) * next[2] * f, next[2] * f, next[3] * f]
        }
        setView(clamp(next))
      }
      last = m
    }
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId)
      last = pts.size ? mid() : null
    }
    // тягнули — це не клік по місцю під пальцем
    const click = (e: MouseEvent) => { if (moved > 4) { e.preventDefault(); e.stopPropagation(); moved = 0 } }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('click', click, true)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('click', click, true)
    }
  }, [zoomAt, clamp]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoomBy = (f: number) => { const { cw, ch } = size(); zoomAt(cw / 2, ch / 2, f) }
  /** місце поза видимим — центр на нього (масштаб той самий) */
  const reveal = (p: [number, number]) => {
    const v = viewRef.current
    if (!v) return
    const m = 0.08
    if (p[0] > v[0] + v[2] * m && p[0] < v[0] + v[2] * (1 - m) && p[1] > v[1] + v[3] * m && p[1] < v[1] + v[3] * (1 - m)) return
    setView(clamp([p[0] - v[2] / 2, p[1] - v[3] / 2, v[2], v[3]]))
  }
  return { view, zoomBy, fit: () => setView(clamp(fitView())), reveal }
}

export function WorldMapView({ picker }: { picker: ReactNode }) {
  const { world, error, retry } = useWorld()
  const [loc, setLoc, locHref] = useUrlParam<string>('loc', '', okLoc)
  const [q, setQ] = useUrlParam<string>('q', '')
  const [k, setK, kHref] = useUrlParam<string>('k', '')
  const sheet = useStore((s) => s.sheet)
  const setSheet = useStore((s) => s.setSheet)
  const sel = world && loc ? world.locations.find((l) => l.id === loc || l.ids.includes(loc)) ?? null : null
  // інший id того самого місця (гарнізон другої фракції) — на основну адресу
  useEffect(() => { if (sel && loc && sel.id !== loc) setLoc(sel.id, { replace: true }) }, [sel, loc, setLoc])
  useCrumb(world === undefined ? null : [{ label: t('Карта світу'), ...(sel ? { path: `/map?m=${WORLD_MAP}` } : {}) }, ...(sel ? [{ label: sel.name }] : [])])

  const hrefOf = (id: string) => locHref(id)
  const panelRef = useRef<HTMLDivElement>(null)
  const pick = (id: string, from: 'map' | 'list' = 'list') => {
    setLoc(id)
    const l = world?.locations.find((x) => x.id === id)
    if (l?.pos && from === 'list') pz.reveal(l.pos)
    // телефон: картку видно в листі панелі — відкрити його (з мапи) чи прогорнути до початку (зі списку)
    if (narrow()) { if (from === 'map') setSheet('map-panel'); requestAnimationFrame(() => panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' })) }
    else panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cats = useMemo(() => {
    if (!world) return []
    const used = new Set(world.locations.map((l) => l.tag).filter(Boolean) as string[])
    return [...used].sort((a, b) => catOrder(a) - catOrder(b))
  }, [world])
  const kOk = !k || cats.includes(k) || !!world?.categories.some((c) => c.tag === k && cats.some((x) => world.categories.find((y) => y.tag === x)?.parent === k))
  const list = useMemo(() => (world ? world.locations.filter((l) => l.id !== world.overland && inCat(world, l, kOk ? k : '') && matches(l, q)) : []), [world, k, kOk, q])
  const shown = useMemo(() => new Set(list.map((l) => l.id)), [list])
  const groups = useMemo(() => {
    const m = new Map<string, WorldLoc[]>()
    for (const l of list) { const g = l.tag ?? ''; if (!m.has(g)) m.set(g, []); m.get(g)!.push(l) }
    for (const items of m.values()) items.sort((a, b) => a.name.localeCompare(b.name, locale(), { numeric: true }))
    return [...m.entries()].sort(([a], [b]) => catOrder(a || null) - catOrder(b || null))
  }, [list])

  const boxRef = useRef<HTMLDivElement>(null)
  const pz = usePanZoom(boxRef, world?.bounds ?? [0, 0, 1, 1], world?.image?.bounds ?? world?.bounds ?? [0, 0, 1, 1])
  const overland = world?.locations.find((l) => l.id === world.overland) ?? null
  const card = sel ?? overland
  const panelOpen = sheet === 'map-panel'

  if (world === null) return <PageError page title={t('Карта світу не завантажилась')} message={error ?? undefined} onRetry={retry} />

  return (
    <div className="relative flex min-h-0 flex-1 gap-1.5 sm:gap-2.5">
      <SheetBackdrop open={panelOpen} className="lg:hidden" />
      <aside
        data-open={panelOpen ? 'yes' : 'no'}
        className={cn(SHEET_BASE, 'sheet-lg flex flex-col lg:flex lg:w-[320px] lg:shrink-0 lg:rounded-none lg:border-0 lg:!bg-transparent lg:shadow-none')}
        aria-label={t('Місця карти світу')}
      >
        <SheetHead title={t('Мапа')} className="lg:hidden" />
        <div ref={narrow() ? panelRef : undefined} className="flex min-h-0 flex-1 flex-col gap-2 p-2 max-lg:overflow-y-auto max-lg:overscroll-contain lg:gap-2.5 lg:p-0">
          {picker}
          <div className={cn(BLOCK, 'relative min-h-0 max-lg:shrink-0 lg:flex-1')} style={{ overflow: 'clip' }}>
            <div ref={narrow() ? undefined : panelRef} data-scroller className="relative overflow-x-hidden lg:h-full lg:overflow-y-auto">
              {world === undefined ? <Loading lines={7} className="p-3" /> : (
                <>
                  <div className="grid gap-2 border-b border-line p-2.5">
                    <SnInput type="search" size="md" modelValue={q} placeholder={t('Пошук місця')} accessibilityLabel={t('Пошук місця на карті світу')} onInput={(e: Event) => setQ(valueOf(e), { replace: true })} />
                    <Seg size="sm" label={t('Категорія')} value={kOk ? k : ''} onChange={setK} href={kHref}
                      items={[{ id: '', label: t('Усі') }, ...cats.map((c) => ({ id: c, label: catName(world, c) }))]} />
                  </div>
                  {card && (
                    <div className="relative border-b border-line">
                      {sel && (
                        <a href={locHref('')} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setLoc('') }} aria-label={t('Закрити картку')}
                          className="absolute right-2 top-2 z-[1] grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-panel2 hover:text-ink">
                          <X size={16} />
                        </a>
                      )}
                      <LocationCard key={card.id} w={world} loc={card} hrefOf={hrefOf} onPick={(id) => pick(id)} bare />
                    </div>
                  )}
                  <section aria-label={t('Місця')} className="grid gap-2 p-2.5">
                    <h2 className="px-1 font-display text-[14px] font-bold">{t('Місця')} <span className="font-mono text-[12px] font-normal text-muted">{list.length}</span></h2>
                    {!list.length ? (
                      <p className="px-1 text-[13px] text-muted">{t('Нічого не знайшлося — спробуй іншу назву чи категорію.')}</p>
                    ) : groups.map(([tag, items]) => (
                      <div key={tag} className="grid gap-0.5">
                        <h3 className="flex items-center gap-1.5 px-1 pt-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: catColor(tag || null) }} aria-hidden />
                          {catName(world, tag || null)}
                        </h3>
                        <ul className="grid">
                          {items.map((l) => {
                            const gated = world.links.filter((x) => x.to === l.id && x.from === world.overland).every((x) => linkReqs(x).length > 0)
                            return (
                              <li key={l.id}>
                                <a href={hrefOf(l.id)} aria-current={l.id === sel?.id ? 'true' : undefined} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); pick(l.id) }}
                                  className={cn('flex min-h-[36px] items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-ink/5', l.id === sel?.id && 'bg-spice/10 text-spice')}>
                                  <span className="min-w-0 flex-1 break-words">{l.name}</span>
                                  {l.group === 'party' && <Users size={13} className="shrink-0 text-muted" aria-label={t('Для групи')} />}
                                  {l.hidden && <BookOpen size={13} className="shrink-0 text-muted" aria-label={t('Видно лише за сюжетом')} />}
                                  {l.pos && gated && <span className="shrink-0 text-[12px] text-warn" title={t('Є умова переходу')}>*</span>}
                                </a>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ))}
                    <Legend w={world} cats={cats} />
                    <p className="break-words px-1 text-[11.5px] text-muted">
                      {world.image
                        ? world.version ? t('Карта, місця, кола посадки, переходи й умови — з гри (версія {v}).', { v: world.version }) : t('Карта, місця, кола посадки, переходи й умови — з гри.')
                        : world.version ? t('Місця, кола посадки, переходи й умови — з файлів гри (версія {v}); фон схеми намальовано.', { v: world.version }) : t('Місця, кола посадки, переходи й умови — з файлів гри; фон схеми намальовано.')}
                    </p>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      </aside>

      <section className="relative isolate min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel2 shadow-lg">
        <div ref={boxRef} className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing">
          {world && pz.view && <WorldSvg w={world} view={pz.view} sel={sel?.id ?? null} shown={shown} hrefOf={hrefOf} onPick={(id) => pick(id, 'map')} />}
        </div>
        {world === undefined && <Loading page label={t('Завантаження карти світу…')} />}
        <div className="pointer-events-none absolute inset-x-2.5 top-2.5 z-[2] flex items-start gap-2 lg:hidden">
          <button type="button" onClick={() => setSheet('map-panel')}
            className="pointer-events-auto flex h-10 items-center gap-1.5 rounded-md border border-line bg-panel/95 px-3 text-[13px] font-medium shadow backdrop-blur">
            <BookOpen size={15} /> {t('Місця')}
          </button>
        </div>
        <div className="absolute bottom-2.5 right-2.5 z-[2] flex flex-col gap-1">
          <button type="button" className={BTN} onClick={() => pz.zoomBy(0.6)} aria-label={t('Наблизити')} data-tip={t('Наблизити')}><Plus size={16} /></button>
          <button type="button" className={BTN} onClick={() => pz.zoomBy(1 / 0.6)} aria-label={t('Віддалити')} data-tip={t('Віддалити')}><Minus size={16} /></button>
          <button type="button" className={BTN} onClick={pz.fit} aria-label={t('Уся карта')} data-tip={t('Уся карта')}><Maximize2 size={15} /></button>
        </div>
      </section>
    </div>
  )
}

/** легенда: категорії гри кольорами й знаки схеми */
function Legend({ w, cats }: { w: World; cats: string[] }) {
  const item = 'inline-flex items-center gap-1.5'
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1.5 px-1 pt-2 text-[11.5px] text-muted" aria-label={t('Позначення')}>
      {cats.map((c) => (
        <li key={c} className={item}><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: catColor(c) }} aria-hidden />{catName(w, c)}</li>
      ))}
      <li className={item}><span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-dashed border-muted bg-panel" aria-hidden />{t('Видно лише за сюжетом')}</li>
      <li className={item}><svg width="22" height="8" aria-hidden><line x1="1" y1="4" x2="21" y2="4" stroke="rgb(var(--c-water))" strokeWidth="2" strokeDasharray="1 4" strokeLinecap="round" /></svg>{t('Таксі-орнітоптер')}</li>
      <li className={item}><svg width="22" height="8" aria-hidden><line x1="1" y1="4" x2="21" y2="4" stroke="rgb(var(--c-spice))" strokeWidth="1.5" strokeDasharray="5 3" /></svg>{t('Переліт картою поверхні')}</li>
      <li className={item}><svg width="10" height="10" aria-hidden><rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" fill="rgb(var(--c-panel))" stroke="rgb(var(--c-spice))" strokeWidth="1.5" /></svg>{t('Вихід на карту поверхні')}</li>
    </ul>
  )
}

/**
 * 3D будівельника: та сама сцена, що на сторінці бази (VIEW3D), перебудовується після кожної правки (update), без
 * нової сцени — камера й зріз лишаються.
 *   «Будувати» з формою в палітрі: біля курсора — примара (зелена — стане, червона — ні, з причиною); клік ставить;
 *     тягни — ставить рядом (одна правка на весь мазок); ПКМ — прибрати вибрану деталь під курсором; камера — права кнопка
 *     (обертати), середня (зсув), коліщатко;
 *   «Будувати» зі станцією в палітрі — примара станції на підлозі під курсором (червона — за стіною), клік — поставити,
 *     R — поворот, ПКМ — прибрати станцію під курсором; з «Вирівнюванням» примара (і станція, яку тягнуть) притягується
 *     в лінію з сусідніми станціями, на 0,1 від стіни чи поручня, на рівний крок — штрихові напрямні на підлозі (align.ts);
 *     Alt — вільно;
 *   «Будувати» без форми — вибір: клік — деталь (Shift — додати), станція; ПКМ — прибрати, але лише вибране (щоб не
 *     зачепити сусідню деталь випадково); вибране тягни — перемістити (деталі — на цілі клітинки, примара показує куди;
 *     камера тоді не крутиться), стрілки — на клітинку: ← → — ліворуч/праворуч, ↑ ↓ — від себе/до себе, як дивиться
 *     камера (по найближчій осі сітки); станцію з Shift — на 0,1;
 *   «Приміщення» — клік по підлозі: вибрати приміщення чи назвати нове (заповнення до стін);
 *   «Ділянки» — клік по землі: додати чи прибрати ділянку 10×10.
 * Біля курсора — напис: що під ним і що зробить клік.
 * Стабільність (як у грі): нестабільні деталі — завжди червоні; з перемикачем — уся база за шкалою (зелена — тримається
 * добре, жовта, помаранчева, червона — на межі); деталь, що мала б 0 %, не стане (примара червона з причиною).
 */
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { PIECES, STABILITY, VIEW3D, type Hit, type Model, type Piece } from '@/lib/engine'
import { t } from '@/lib/i18n'
import { fmt2, lab, low } from '../tr'
import { claimsChanged, newId, useBuilder } from './store'
import { snap } from './snap'
import { PRESETS } from './labels'
import { itemFit, itemCorners, typing, zoneAt } from './bits'
import { moveSelected, shiftSel } from './move'
import { alignItem, EDGE_GAP, type Guide, type GuideKind } from './align'
import { camModeNow, useCamMode } from '../camMode'

/* eslint-disable @typescript-eslint/no-explicit-any */
type V = ReturnType<typeof VIEW3D.create>
// форма, якої рушій не знає (давній файл), — словами, а не службовим id
const nameOf = (p: Piece | undefined) => (p ? (PIECES.SHAPES[p.shape] ? lab(PIECES.SHAPES[p.shape].name) : t('Невідома деталь')) : '')
const shapeName = (id: string) => (PIECES.SHAPES[id] ? lab(PIECES.SHAPES[id].name) : t('Невідома деталь'))
/** станція з палітри там, куди вказує курсор: центр — з кроком 0,1, на висоті поверхні під курсором (земля — 0) */
const stationAt = (i: number, hit: Hit, ang: number) => ({
  ...PRESETS[i],
  c: { x: Math.round(hit.point.x * 10) / 10, y: Math.round(hit.point.y * 10) / 10 },
  z: hit.ground ? 0 : Math.round(hit.point.z * 20) / 20,
  ang,
})
/** вирівняна станція (якщо ввімкнено і не тиснуть Alt): новий центр і напрямні */
function aligned(M: Model, it: any, skip?: number, free = false): { it: any; guides: Guide[]; kinds: GuideKind[] } {
  if (free || !useBuilder.getState().align) return { it, guides: [], kinds: [] }
  const a = alignItem(M, it, skip)
  return { it: { ...it, c: a.c }, guides: a.guides, kinds: a.kinds }
}
const KIND_SAY: Record<GuideKind, () => string> = {
  line: () => t('у лінію'),
  edge: () => t('{gap} від краю', { gap: fmt2(EDGE_GAP) }),
  gap: () => t('рівний крок'),
}
const alignSay = (kinds: GuideKind[]) => (kinds.length ? ' · ' + t('вирівняно: {how}', { how: kinds.map((k) => KIND_SAY[k]()).join(', ') }) : '')
/** стрілка → напрямок на екрані */
const ARROWS: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

/** шкала стабільності: від якого відсотка — який колір */
const STAB_BANDS: { min: number; color: number; alpha: number }[] = [
  { min: 80, color: 0x22c55e, alpha: 0.26 },
  { min: 50, color: 0xeab308, alpha: 0.32 },
  { min: 20, color: 0xf97316, alpha: 0.38 },
  { min: 1, color: 0xdc2626, alpha: 0.45 },
]

export function View({ M, stab, showStab }: { M: Model; stab: Map<string, number>; showStab: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const view = useRef<V | null>(null)
  const tool = useBuilder((s) => s.tool)
  const piece = useBuilder((s) => s.piece)
  const turn = useBuilder((s) => s.turn)
  const cut = useBuilder((s) => s.cut)
  const sel = useBuilder((s) => s.sel)
  const preset = useBuilder((s) => s.preset)
  const itemAng = useBuilder((s) => s.itemAng)
  const ed = useBuilder.getState
  const [chip, setChip] = useState<{ x: number; y: number; text: string; bad?: boolean } | null>(null)
  const Mref = useRef(M)
  Mref.current = M
  const down = useRef<{ x: number; y: number; b: number } | null>(null)
  const stroke = useRef<Piece[] | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const hoverId = useRef<string | null>(null)
  const raf = useRef(0)
  /** Alt — ставити й тягнути станції без вирівнювання */
  const alt = useRef(false)
  const stabRef = useRef(stab)
  stabRef.current = stab
  const strokeStab = useRef(new Map<string, number>())
  /** перетягування вибраного: площина на висоті, де схопили, точка початку, зсув (на клітинки) і чи туди можна */
  const moving = useRef<{ z: number; from: { x: number; y: number }; dx: number; dy: number; why: string | null } | null>(null)
  // стабільність опор: щойно поставлене, ще не пораховане, — з запасом (перерахунок — трохи згодом)
  const stabOf = { get: (id: string) => strokeStab.current.get(id) ?? stabRef.current.get(id) ?? STABILITY.FULL }
  /** прив'язка з перевіркою стабільності: деталь, що мала б 0 %, не стане */
  function snapS(shape: string, hit: Parameters<typeof snap>[1], all: Piece[]) {
    const g = snap(shape, hit, all, ed().turn)
    if (!g || !g.ok) return g ? { ...g, stab: 0 } : null
    const v = STABILITY.of(g.piece, all, stabOf)
    if (v <= 0) return { ...g, ok: false, why: t('Недостатньо стабільності: задалеко від опори — постав стіну чи колону ближче'), stab: 0 }
    return { ...g, stab: v }
  }

  // сцена — раз; модель змінилась — перебудова на місці
  useEffect(() => {
    const v = VIEW3D.create(box.current!, { freeLook: true }, Mref.current) // можна глянути знизу — днище, звисання
    view.current = v
    v.setNav(camModeNow())
    v.start()
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as any).__view = v // у розробці — з консолі
    return () => { v.dispose(); view.current = null }
  }, [])
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    view.current?.update(M)
    if (last.current) probe(last.current.x, last.current.y)
  }, [M]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { view.current?.setCut(cut, -1) }, [cut, M])
  /** ліва кнопка: зайнята будуванням (камера — права), чи камера (вибір — кліком) */
  const mouseMode = () => { const st = ed(); return (st.tool === 'build' && (st.piece || st.preset != null)) || st.tool === 'claims' ? 'build' : 'view' }
  useEffect(() => { view.current?.setMouse(mouseMode()) }, [tool, piece, preset]) // eslint-disable-line react-hooks/exhaustive-deps
  // примара й підсвітка з попереднього інструмента не лишаються
  useEffect(() => { view.current?.setGhost(null); view.current?.setMark(null); hoverId.current = null; paint(); setChip(null); if (last.current) probe(last.current.x, last.current.y) }, [tool, piece, turn, preset, itemAng]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => paint(), [sel, M]) // eslint-disable-line react-hooks/exhaustive-deps
  // стабільність: нестабільні — завжди; уся шкала — з перемикачем; вище зрізу — ні
  useEffect(() => {
    const v = view.current
    if (!v) return
    const shown = (M.pieces as Piece[]).filter((p) => p.z <= cut + 1e-6 && stab.has(p.id))
    const groups = [{ ids: shown.filter((p) => (stab.get(p.id) ?? 0) <= 0).map((p) => p.id), color: 0xef4444, alpha: 0.6 }]
    if (showStab) for (const [i, b] of STAB_BANDS.entries()) {
      const hi = i ? STAB_BANDS[i - 1].min : Infinity
      groups.push({ ids: shown.filter((p) => { const x = stab.get(p.id) ?? 0; return x >= b.min && x < hi }).map((p) => p.id), color: b.color, alpha: b.alpha })
    }
    v.setTint(groups)
  }, [stab, showStab, M, cut])

  // стрілки — зсунути вибране (деталі чи станцію) на клітинку: ← → і ↑ ↓ — як дивиться камера, по найближчій осі сітки;
  // станцію з Shift — на 0,1 (деталі стоять лише на сітці); у полі вводу стрілки — його
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = ARROWS[e.key]
      if (!dir || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return
      const st = ed(), v = view.current
      if (!v || st.tool !== 'build' || (st.sel?.kind !== 'pieces' && st.sel?.kind !== 'item') || moving.current) return
      e.preventDefault()
      const { right, forward } = v.screenAxes()
      const d = dir === 'up' ? forward : dir === 'down' ? { x: -forward.x, y: -forward.y } : dir === 'right' ? right : { x: -right.x, y: -right.y }
      const step = st.sel.kind === 'item' && e.shiftKey ? 0.1 : 1
      const [dx, dy] = Math.abs(d.x) >= Math.abs(d.y) ? [Math.sign(d.x) * step, 0] : [0, Math.sign(d.y) * step]
      const why = moveSelected(dx, dy, 'arrows')
      if (why) toast(why, { id: 'move', duration: 2200 })
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Alt натиснули чи відпустили — примара станції одразу без вирівнювання чи знову з ним
  useEffect(() => {
    const onAlt = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || alt.current === (e.type === 'keydown')) return
      alt.current = e.type === 'keydown'
      if (last.current) schedule(last.current.x, last.current.y)
    }
    const off = () => { alt.current = false }
    addEventListener('keydown', onAlt)
    addEventListener('keyup', onAlt)
    addEventListener('blur', off)
    return () => { removeEventListener('keydown', onAlt); removeEventListener('keyup', onAlt); removeEventListener('blur', off) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // режим камери (навколо центру / від першої особи) — у сцену
  const camMode = useCamMode()
  useEffect(() => { view.current?.setNav(camMode) }, [camMode])
  // перемикач вирівнювання — примара одразу по-новому
  const align = useBuilder((s) => s.align)
  useEffect(() => { if (last.current) schedule(last.current.x, last.current.y) }, [align]) // eslint-disable-line react-hooks/exhaustive-deps

  /** підсвітка: вибрані деталі, наведена деталь, плитки вибраного приміщення */
  function paint() {
    const v = view.current
    if (!v) return
    const s = ed().sel
    const zone = s?.kind === 'zone' ? Mref.current.rooms.find((r: any) => r.id === s.id) : null
    v.setHighlight({
      sel: s?.kind === 'pieces' ? s.ids : [],
      hover: hoverId.current && !(s?.kind === 'pieces' && s.ids.includes(hoverId.current)) ? [hoverId.current] : [],
      tiles: zone ? zone.tiles.map((t: any) => ({ p: t.p, z: zone.z0 })) : [],
    })
    if (s?.kind === 'item') {
      const it = Mref.current.items[s.i]
      v.setMark(it ? { boxes: [{ p: itemCorners(it), z0: it.z ?? 0, z1: (it.z ?? 0) + Math.max(it.h || 0, 0.3) }] } : null)
    } else if (ed().preset == null) v.setMark(null)
  }

  /** що під курсором і що буде після кліку — примара, підсвітка, напис */
  function probe(cx: number, cy: number) {
    const v = view.current
    if (!v) return
    const st = ed()
    const M = Mref.current
    const r = box.current!.getBoundingClientRect()
    const at = { x: cx - r.left, y: cy - r.top }
    const say = (text: string, bad = false) => setChip({ ...at, text, bad })
    const mv = moving.current
    if (mv) {
      // перетягування вибраного: деталі — на цілі клітинки, станція — з кроком 0,1
      const q = v.planeAt(cx, cy, mv.z)
      if (!q) return
      const sel = st.sel
      const k = sel?.kind === 'item' ? 10 : 1
      mv.dx = Math.round((q.x - mv.from.x) * k) / k
      mv.dy = Math.round((q.y - mv.from.y) * k) / k
      // станція — з вирівнюванням: зсув такий, щоб стала по напрямних
      let al: ReturnType<typeof aligned> | null = null
      if (sel?.kind === 'item' && M.items[sel.i]) {
        const it0 = M.items[sel.i]
        al = aligned(M, { ...it0, c: { x: it0.c.x + mv.dx, y: it0.c.y + mv.dy } }, sel.i, alt.current)
        mv.dx = Math.round((al.it.c.x - it0.c.x) * 100) / 100
        mv.dy = Math.round((al.it.c.y - it0.c.y) * 100) / 100
      }
      const r = mv.dx || mv.dy ? shiftSel(M, sel, mv.dx, mv.dy) : null
      mv.why = r?.why ?? null
      if (r?.pieces) v.setGhost(r.pieces, !r.why)
      else v.setGhost(null)
      if (r?.item) v.setMark({ boxes: [{ p: itemCorners(r.item), z0: r.item.z ?? 0, z1: (r.item.z ?? 0) + Math.max(r.item.h || 0, 0.3) }], guides: al?.guides ?? [] })
      else if (sel?.kind === 'item') paint()
      if (!r) say(t('Тягни — перемістити вибране'))
      else say(r.why ?? (r.warn ? r.warn + alignSay(al?.kinds ?? []) : t('Зсув на {dx}, {dy} — відпусти, щоб перемістити', { dx: fmt(mv.dx), dy: fmt(mv.dy) }) + alignSay(al?.kinds ?? [])), !!r.why)
      return
    }
    const hit = v.pick(cx, cy)
    if (st.tool === 'build' && st.preset != null) {
      const pr = PRESETS[st.preset]
      if (!pr || !hit) { v.setMark(null); setChip(null); return }
      const { it, guides, kinds } = aligned(M, stationAt(st.preset, hit, st.itemAng), undefined, alt.current)
      const fit = itemFit(M, it)
      v.setMark({ boxes: [{ p: itemCorners(it), z0: it.z, z1: it.z + Math.max(it.h || 0, 0.3) }], guides })
      const name = lab(pr.name)
      if (hit.item != null) say(t('{name} — ПКМ: прибрати', { name: lab(M.items[hit.item]?.name ?? '') }))
      else say(fit === 'wall' ? t('{name}: за стіну не стане', { name }) : (fit === 'overlap' ? t('{name}: налазить на іншу станцію', { name }) : t('{name} — клік: поставити · R — поворот', { name })) + alignSay(kinds), fit === 'wall')
      return
    }
    if (st.tool === 'build' && st.piece) {
      const all = stroke.current ? [...M.pieces, ...stroke.current] : M.pieces
      const g = hit ? snapS(st.piece, hit, all) : null
      if (g && stroke.current && g.ok && !stroke.current.some((q) => PIECES.clash(q, g.piece))) {
        const np = { ...g.piece, id: newId() }
        strokeStab.current.set(np.id, g.stab)
        stroke.current.push(np)
      }
      const ps = [...(stroke.current || []), ...(g && !(stroke.current && g.ok) ? [g.piece] : [])]
      v.setGhost(ps.length ? ps : null, stroke.current ? true : !!g?.ok)
      if (stroke.current) say(t('{shape}: {n} — відпусти, щоб поставити', { shape: shapeName(st.piece), n: stroke.current.length }))
      else if (!g) say(t('Наведи на землю, плиту чи стіну'), true)
      else if (!g.ok) say(g.why ?? t('Сюди не стане'), true)
      else say(t('{shape} на +{z} · стабільність {n} % — клік: поставити, тягни — рядом · R — поворот', { shape: shapeName(st.piece), z: fmt(g.piece.z), n: g.stab }), false)
      return
    }
    if (st.tool === 'build') {
      hoverId.current = hit?.piece ?? null
      paint()
      const picked = hit?.piece && st.sel?.kind === 'pieces' && st.sel.ids.includes(hit.piece)
      const pickedItem = hit?.item != null && st.sel?.kind === 'item' && st.sel.i === hit.item
      const sv = hit?.piece ? stabRef.current.get(hit.piece) : undefined
      if (hit?.piece) {
        const name = nameOf(M.pieces.find((p: Piece) => p.id === hit.piece))
        const action = picked ? t('вибрано · тягни чи стрілки — перемістити, ПКМ чи Del — прибрати') : t('клік: вибрати (Shift — ще), прибрати — лише вибране')
        say(sv === undefined ? t('{name} — {action}', { name, action }) : sv <= 0 ? t('{name} · нестабільна (0 %) — {action}', { name, action }) : t('{name} · стабільність {n} % — {action}', { name, n: sv, action }), sv !== undefined && sv <= 0)
      }
      else if (hit?.item != null) say(t('{name} — {action}', { name: lab(M.items[hit.item]?.name ?? ''), action: pickedItem ? t('вибрано · тягни чи стрілки — перемістити, ПКМ чи Del — прибрати') : t('клік: вибрати, прибрати — лише вибране') }))
      else setChip(null)
      return
    }
    if (st.tool === 'zones') {
      const z = hit ? zoneAt(M, hit) : null
      const zone = z?.zone
      view.current?.setHighlight({ tiles: zone ? zone.tiles.map((t: any) => ({ p: t.p, z: zone.z0 })) : z?.tile ? [{ p: z.tile, z: z.z }] : [] })
      if (zone) say(t('«{name}» — клік: властивості', { name: zone.name }))
      else if (z?.tile) say(t('Підлога без назви — клік: назвати приміщення (заповниться до стін)'))
      else setChip(null)
      return
    }
    if (st.tool === 'claims') {
      if (!hit) { setChip(null); return }
      const c0 = M.claims[0] ?? { x: 0, y: 0 }
      const ox = ((c0.x % 10) + 10) % 10, oy = ((c0.y % 10) + 10) % 10
      const x = Math.floor((hit.point.x - ox) / 10) * 10 + ox, y = Math.floor((hit.point.y - oy) / 10) * 10 + oy
      const has = M.claims.some((c: any) => c.x === x && c.y === y)
      v.setHighlight({ tiles: [{ p: [{ x, y }, { x: x + 10, y }, { x: x + 10, y: y + 10 }, { x, y: y + 10 }], z: 0 }] })
      say(has ? t('Клік: прибрати цю ділянку') : t('Клік: додати ділянку 10×10'))
    }
  }

  const schedule = (cx: number, cy: number) => {
    last.current = { x: cx, y: cy }
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => probe(cx, cy))
  }

  function click(cx: number, cy: number, shift: boolean) {
    const v = view.current
    const st = ed()
    const M = Mref.current
    const hit = v?.pick(cx, cy) ?? null
    if (st.tool === 'build' && st.preset != null) {
      const pr = PRESETS[st.preset]
      if (!pr || !hit) return
      const { it } = aligned(M, stationAt(st.preset, hit, st.itemAng), undefined, alt.current)
      if (itemFit(M, it) === 'wall') return void toast.info(t('Станція виходить за стіну — посунь курсор чи поверни (R)'))
      st.apply((d) => { d.items = [...(d.items || []), it] }, lab(pr.name))
      return
    }
    if (st.tool === 'build') {
      if (hit?.piece) {
        const cur = st.sel?.kind === 'pieces' ? st.sel.ids : []
        const ids = shift ? (cur.includes(hit.piece) ? cur.filter((x) => x !== hit.piece) : [...cur, hit.piece]) : [hit.piece]
        st.set({ sel: ids.length ? { kind: 'pieces', ids } : null })
      } else if (hit?.item != null) st.set({ sel: { kind: 'item', i: hit.item } })
      else st.set({ sel: null })
      return
    }
    if (st.tool === 'zones') {
      const z = hit ? zoneAt(M, hit) : null
      if (z?.zone) return st.set({ sel: { kind: 'zone', id: z.zone.id } })
      if (z?.tile) {
        const n = (M.zones?.length ?? 0) + 1
        const id = newId('z')
        st.apply((d) => { d.zones = [...(d.zones || []), { id, name: t('Приміщення {n}', { n }), group: 'core', z: z.z, tiles: [PIECES.keyOf(z.center)] }] }, t('нове приміщення'))
        st.set({ sel: { kind: 'zone', id } })
      }
      return
    }
    if (st.tool === 'claims' && hit) {
      const c0 = M.claims[0] ?? { x: 0, y: 0 }
      const ox = ((c0.x % 10) + 10) % 10, oy = ((c0.y % 10) + 10) % 10
      const x = Math.floor((hit.point.x - ox) / 10) * 10 + ox, y = Math.floor((hit.point.y - oy) / 10) * 10 + oy
      const has = M.claims.some((c: any) => c.x === x && c.y === y)
      if (has && M.claims.length === 1) return void toast.info(t('У бази має лишитися хоча б одна ділянка'))
      st.apply((d) => {
        d.claims = has ? d.claims.filter((c: any) => !(c.x === x && c.y === y)) : [...d.claims, { x, y, w: 10, d: 10 }]
        claimsChanged(d)
      }, has ? t('ділянку прибрано') : t('нова ділянка'))
    }
  }

  function remove(cx: number, cy: number) {
    const st = ed()
    const M = Mref.current
    const hit = view.current?.pick(cx, cy) ?? null
    if (!hit) return
    if (hit.item != null && st.tool === 'build' && st.preset != null) {
      // зі станцією в палітрі ПКМ прибирає станцію під курсором (як було в окремому інструменті «Станції»)
      const name = M.items[hit.item] ? lab(M.items[hit.item].name) : t('станцію')
      st.apply((d) => { d.items = d.items.filter((_: any, i: number) => i !== hit.item) }, t('прибрано: {name}', { name }))
      st.set({ sel: null })
      return
    }
    if (hit.piece && (st.tool === 'build')) {
      // прибрати можна лише вибрану деталь: ПКМ по невибраній нічого не робить (лише підказка)
      if (!(st.sel?.kind === 'pieces' && st.sel.ids.includes(hit.piece))) { toast(t('Спершу вибери деталь кліком — прибрати можна лише вибране')); return }
      const p = M.pieces.find((q: Piece) => q.id === hit.piece)
      st.apply((d) => { d.pieces = d.pieces.filter((q: Piece) => q.id !== hit.piece) }, t('прибрано: {name}', { name: low(nameOf(p)) }))
      if (st.sel?.kind === 'pieces') st.set({ sel: { kind: 'pieces', ids: st.sel.ids.filter((x) => x !== hit.piece) } })
      return
    }
    if (hit.item != null && st.tool === 'build' && !(st.sel?.kind === 'item' && st.sel.i === hit.item)) { toast(t('Спершу вибери станцію кліком — прибрати можна лише вибране')); return }
    if (hit.item != null && st.tool === 'build') {
      const name = M.items[hit.item] ? lab(M.items[hit.item].name) : t('станцію')
      st.apply((d) => { d.items = d.items.filter((_: any, i: number) => i !== hit.item) }, t('прибрано: {name}', { name }))
      st.set({ sel: null })
    }
  }

  function commitStroke() {
    const list = stroke.current
    stroke.current = null
    if (!list?.length) return
    const name = PIECES.SHAPES[list[0].shape] ? low(shapeName(list[0].shape)) : t('деталь')
    ed().apply((d) => { d.pieces = [...(d.pieces || []), ...list.map((p) => ({ ...p, id: p.id || newId() }))] }, list.length > 1 ? `${name} ×${list.length}` : name)
    view.current?.setGhost(null)
  }

  return (
    <div
      ref={box}
      className="relative h-full min-h-0 w-full touch-none select-none"
      onPointerMove={(e) => { alt.current = e.altKey; schedule(e.clientX, e.clientY) }}
      onPointerLeave={() => { if (!stroke.current && !moving.current) { view.current?.setGhost(null); hoverId.current = null; paint(); setChip(null); last.current = null } }}
      onPointerDownCapture={(e) => {
        // ліва кнопка на вибраному (без форми в палітрі) — перетягування; камера тоді не крутиться: кнопки миші
        // перемикаємо до того, як подію побачить керування камерою (воно слухає саме полотно, глибше)
        const st = ed(), v = view.current
        if (v?.navBusy()) return // пробіл — ліва кнопка зсуває камеру
        if (e.button !== 0 || e.shiftKey || !v || st.tool !== 'build' || st.piece || st.preset != null || !st.sel) return
        const hit = v.pick(e.clientX, e.clientY)
        const on = (st.sel.kind === 'pieces' && !!hit?.piece && st.sel.ids.includes(hit.piece)) || (st.sel.kind === 'item' && hit?.item === st.sel.i)
        const from = on && hit ? v.planeAt(e.clientX, e.clientY, hit.point.z) : null
        if (!from || !hit) return
        moving.current = { z: hit.point.z, from, dx: 0, dy: 0, why: null }
        v.setMouse('build')
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerDown={(e) => {
        if (view.current?.navBusy()) { down.current = null; return }
        down.current = { x: e.clientX, y: e.clientY, b: e.button }
        // клік у 3D забирає фокус з поля (пошук у палітрі, назва в картці): R, Del, стрілки знову для будівельника —
        // самі собою не заберуть, бо керування камерою скасовує натискання миші
        const a = document.activeElement as HTMLElement | null
        if (a && a !== document.body && !box.current?.contains(a)) a.blur()
        const st = ed()
        // ліва кнопка з формою: починаємо мазок (перша деталь — та, що під примарою)
        if (e.button === 0 && st.tool === 'build' && st.piece) {
          const hit = view.current?.pick(e.clientX, e.clientY)
          const g = hit ? snapS(st.piece, hit, Mref.current.pieces) : null
          strokeStab.current = new Map()
          const np = g?.ok ? { ...g.piece, id: newId() } : null
          if (np && g) strokeStab.current.set(np.id, g.stab)
          stroke.current = np ? [np] : []
        }
      }}
      onPointerUp={(e) => {
        const d = down.current
        down.current = null
        const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 : true
        if (e.button === 0 && stroke.current) { commitStroke(); return }
        const mv = moving.current
        if (e.button === 0 && mv) {
          moving.current = null
          view.current?.setMouse(mouseMode())
          view.current?.setGhost(null)
          paint()
          if (moved) {
            // відпустили там, куди не можна, — лишається на місці, з поясненням
            if (mv.dx || mv.dy) { const why = mv.why ?? moveSelected(mv.dx, mv.dy); if (why) toast(why, { id: 'move', duration: 2200 }) }
            probe(e.clientX, e.clientY)
            return
          }
        }
        if (e.button === 0 && !moved) click(e.clientX, e.clientY, e.shiftKey)
        if (e.button === 2 && !moved) remove(e.clientX, e.clientY)
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {chip && (
        <div
          className={`pointer-events-none absolute z-10 max-w-[300px] rounded-md border px-2 py-1 text-[11.5px] leading-snug shadow-lg ${chip.bad ? 'border-bad/60 bg-panel/95 text-bad' : 'border-line bg-panel/95 text-ink'}`}
          style={{ left: Math.min(chip.x + 16, (box.current?.clientWidth ?? 9999) - 310), top: chip.y + 18 }}
        >
          {chip.text}
        </div>
      )}
    </div>
  )
}

const fmt = fmt2

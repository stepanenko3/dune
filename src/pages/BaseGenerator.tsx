/**
 * Генератор баз (/bases/generate): людина позначає ділянки 10 × 10 (до 6, кожна прилягає стороною до сусідньої) і форму
 * кожної (квадрат, шестикутник, дванадцятикутник, з двором, з атріумом); ангари й гаражі — списком (що в кожному стоїть,
 * вхід: наскрізні портали, портал з одного боку, пентащит у даху, портал і щит у даху), з кнопками групування; станції —
 * поштучно (тип → кількість, з готовими наборами); житло, стиль. Праворуч — живий перегляд (план і 3D) і перевірка правил
 * гри (техніка лише під дахом, пентащити прямокутні, грузовий наскрізь, стабільність…).
 * Генерує браузер (миттєво, для перегляду) тим самим модулем, що й сервер; «Створити» просить сервер — він генерує сам,
 * перевіряє правила й створює базу людини (за замовчуванням приватну), а тоді відкривається 3D-будівельник.
 * Параметри пам'ятаються (prefs), тож повернувшись, людина бачить те, що задала.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Car, Check, Dices, LogIn, Minus, Plane, Plus, Shuffle, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  BAY_TYPES, CONTAINER, DEFAULTS, GenError, STYLE_PRESETS, normalizeStyle, LIMITS, OUTDOOR, STATION_SETS, STATION_TYPES, bayCells, createGenerated, msg, normalizeParams, previewBase, randomParams, regroup,
  type Bay, type GenMsg, type GenParams, type GenResult, type Shape, type Style,
} from '@/lib/basegen'
import type { BaseEnvelope } from '@/lib/bases'
import { loginHref, useAuth } from '@/lib/auth'
import type { Visibility } from '@/lib/items'
import { prefGet, prefSet } from '@/lib/prefs'
import { t } from '@/lib/i18n'
import { cn, word } from '@/lib/utils'
import { useStore } from '@/store'
import { useCrumb } from '@/components/Crumbs'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card, SectionTitle } from '@/components/ui/card'
import { BaseViewer } from '@/components/base/BaseViewer'
import { StationIcon } from '@/components/base/builder/Palette'
import { PRESETS, PRESET_GROUPS } from '@/components/base/builder/labels'
import { lab } from '@/components/base/tr'
import { NewAccess, type OwnerRef } from '@/components/access/Access'
import { useNewRights } from '@/components/access/Rights'
import { SnInput, valueOf } from '@/components/sn'
import { Field } from './Auth'

/** редактор — з комп'ютера: на телефоні після створення відкриваємо сторінку бази */
const narrow = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches

type Cell = [number, number]
/** готові форми ділянок */
const LAYOUTS: { id: string; label: () => string; cells: Cell[] }[] = [
  { id: 'one', label: () => t('Одна'), cells: [[0, 0]] },
  { id: 'two', label: () => t('Дві'), cells: [[0, 0], [1, 0]] },
  { id: 'line3', label: () => t('Лінія з 3'), cells: [[0, 0], [1, 0], [2, 0]] },
  { id: 'line6', label: () => t('Лінія з 6'), cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]] },
  { id: 'L', label: () => t('Кут'), cells: [[0, 0], [1, 0], [2, 0], [0, 1]] },
  { id: 'sq', label: () => '2 × 2', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { id: 'r6', label: () => '2 × 3', cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { id: 'T', label: () => t('Літера Т'), cells: [[0, 1], [1, 1], [2, 1], [1, 0]] },
  { id: 'plus', label: () => t('Хрест'), cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
]
/** форми приміщень ділянки */
const SHAPE_INFO: Record<Shape, { label: () => string; sub: () => string }> = {
  square: { label: () => t('Квадрат'), sub: () => t('10 × 10; лише тут стають ангари й гаражі') },
  hex: { label: () => t('Шестикутник'), sub: () => t('зі стороною 4, коридор до сусідньої ділянки') },
  dodeca: { label: () => t('Дванадцятикутник'), sub: () => t('гекс, обкладений смугами квадратів') },
  yard: { label: () => t('З двором'), sub: () => t('будівля 10 × 6, решта — відкритий двір') },
  atrium: { label: () => t('З атріумом'), sub: () => t('кільце приміщень навколо двору 4 × 4') },
}
/** підписи призначень ділянок на сітці (коротко) і повністю */
const GROUND_LABEL: Record<string, () => [string, string]> = {
  garage: () => [t('Гараж'), t('Гараж техніки')], hangar: () => [t('Орні'), t('Ангар орні')], hall: () => [t('Зал'), t('Зал гільдії')],
  workshop: () => [t('Майст.'), t('Майстерня')], refinery: () => [t('Перер.'), t('Переробка')], water: () => [t('Вода'), t('Вода й енергія')],
  storage: () => [t('Склад'), t('Склад')], living: () => [t('Житло'), t('Житло')], spare: () => [t('Вільне'), t('Вільне приміщення')],
}
const UPPER_LABEL: Record<string, () => [string, string]> = {
  orni: () => [t('↑ орні'), t('нагорі — ангар орні')], living: () => [t('↑ житло'), t('нагорі — житло')], carrier: () => [t('↑ грузовий'), t('нагорі — ангар грузового')],
}
/** техніка: назви з палітри (перекладені) */
const VEH_NAME = (type: string) => lab(PRESETS.find((p) => p.type === type)?.name || type)
/** вхід ангара: наскрізь, з одного боку, щит у даху, портал і щит */
type Entry = 'through' | 'side' | 'roof' | 'sideroof' | 'throughroof'
const entryOf = (b: Bay): Entry => (b.portals === 2 ? (b.roof ? 'throughroof' : 'through') : b.portals === 1 ? (b.roof ? 'sideroof' : 'side') : 'roof')
const ENTRY: Record<Entry, { portals: number; roof: boolean }> = { through: { portals: 2, roof: false }, side: { portals: 1, roof: false }, roof: { portals: 0, roof: true }, sideroof: { portals: 1, roof: true }, throughroof: { portals: 2, roof: true } }

const loadParams = (): GenParams => normalizeParams({ ...DEFAULTS, ...prefGet<Partial<GenParams>>('basegen:params', {}) }).params

/** зсунути ділянки (і їхні форми) так, щоб найменші i, j були 0 */
function shiftCells(cells: Cell[], shapes: Record<string, Shape>, sel: string | null) {
  const mi = Math.min(...cells.map((c) => c[0])), mj = Math.min(...cells.map((c) => c[1]))
  const key = (i: number, j: number) => `${i - mi},${j - mj}`
  const next: Record<string, Shape> = {}
  for (const [k, v] of Object.entries(shapes)) { const [i, j] = k.split(',').map(Number); if (cells.some((c) => c[0] === i && c[1] === j)) next[key(i, j)] = v }
  const s = sel ? sel.split(',').map(Number) : null
  return { cells: cells.map(([i, j]) => [i - mi, j - mj] as Cell), shapes: next, sel: s && cells.some((c) => c[0] === s[0] && c[1] === s[1]) ? key(s[0], s[1]) : null }
}

export default function BaseGenerator() {
  useCrumb([{ label: t('Генератор') }])
  const { user, ready } = useAuth()
  const [p, setP] = useState<GenParams>(loadParams)
  const set = (patch: Partial<GenParams>) => setP((prev) => ({ ...prev, ...patch }))
  // перегляд — трохи згодом після зміни (кілька кліків поспіль — одна генерація)
  const [res, setRes] = useState<{ r: GenResult; v: number } | null>(null)
  useEffect(() => {
    prefSet('basegen:params', { ...p, name: '' })
    const h = setTimeout(() => setRes((old) => ({ r: previewBase(p), v: (old?.v ?? 0) + 1 })), 120)
    return () => clearTimeout(h)
  }, [p])
  const r = res?.r

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={t('Генератор баз')}
          lead={t('Познач ділянки й що потрібно в базі — генератор складе її з деталей гри за правилами: техніка лише під дахом, пентащити прямокутні, сходи прямі, стабільність не нижче 20 %. Потім доробиш її у 3D-будівельнику.')}
        />
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-2.5 xl:grid-cols-[440px_minmax(0,1fr)]">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
            <CellsCard p={p} plan={r?.plan?.cells} set={set} />
            <StyleCard style={p.style} onChange={(style) => set({ style })} />
            <BaysCard bays={p.bays} onChange={(bays) => set({ bays })} />
            <StationsCard stations={p.stations} rooms={p.rooms} onChange={(stations) => set({ stations })} onRooms={(rooms) => set({ rooms })} />
            {ready && (user ? <CreatePanel p={p} r={r} onName={(name) => set({ name })} userId={user.id} /> : (
              <Card className="flex flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 text-[14px] text-muted">{t('Щоб зберегти базу собі й доробити її в 3D-будівельнику, увійди.')}</p>
                <Button onClick={() => location.assign(loginHref())}><LogIn size={15} /> {t('Увійти')}</Button>
              </Card>
            ))}
          </div>

          {/* перегляд — праворуч і липкий: гортаєш параметри — результат весь час перед очима; на вузькому — угорі */}
          <div className="-order-1 grid min-w-0 gap-2.5 xl:sticky xl:top-2 xl:order-none xl:self-start xl:[&_.three-wrap]:h-[calc(100dvh-390px)] xl:[&_.three-wrap]:min-h-[340px]">
            <Card className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Status r={r} />
                <div className="ml-auto flex items-center gap-2">
                  <span className="font-mono text-[12px] text-muted">{t('Варіант {n}', { n: p.seed })}</span>
                  <Button variant="secondary" size="sm" onClick={() => set({ seed: (p.seed % 999) + 1 })} title={t('Той самий стиль, але інше розташування й деталі')}><Dices size={14} /> {t('Інший варіант')}</Button>
                  <Button size="sm" onClick={() => setP(randomParams(p))} title={t('Усе навмання: ділянки, їхні форми, ангари, стиль; техніка, станції й кімнати — ті самі')}><Shuffle size={14} /> {t('Рандом')}</Button>
                </div>
              </div>
              <Report r={r} />
            </Card>
            {r?.doc && res ? (
              <BaseViewer key="basegen" side={false} env={{ id: '__basegen', version: res.v, doc: r.doc, updated: 0, note: '', deleted: null } as BaseEnvelope} initialTab="3d" />
            ) : (
              <Card className="grid min-h-[240px] place-items-center text-center text-[14px] text-muted">
                {r ? t('Перегляду нема — зміни параметри') : t('Генерую…')}
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- ділянки ----------
const sameCells = (a: Cell[], b: Cell[]) => {
  const k = (l: Cell[]) => normalizeParams({ cells: l }).params.cells.map((c) => c.join(',')).sort().join(';')
  return k(a) === k(b)
}
function connected(cells: Cell[]) {
  if (!cells.length) return false
  const all = new Set(cells.map((c) => c.join(',')))
  const seen = new Set([cells[0].join(',')]), q = [cells[0]]
  while (q.length) {
    const [i, j] = q.shift()!
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${i + di},${j + dj}`; if (all.has(k) && !seen.has(k)) { seen.add(k); q.push([i + di, j + dj]) } }
  }
  return seen.size === all.size
}

/** значок форми ділянки */
function ShapeGlyph({ shape, size = 16, className }: { shape: Shape; size?: number; className?: string }) {
  const s = size, c = s / 2, r = s / 2 - 1.5
  const ngon = (n: number, a0: number) => Array.from({ length: n }, (_, i) => { const a = a0 + (2 * Math.PI * i) / n; return `${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}` }).join(' ')
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className={cn('shrink-0', className)} aria-hidden>
      {shape === 'square' && <rect x={1.5} y={1.5} width={s - 3} height={s - 3} rx={1} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={1.3} />}
      {shape === 'hex' && <polygon points={ngon(6, 0)} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={1.3} />}
      {shape === 'dodeca' && <polygon points={ngon(12, Math.PI / 12)} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={1.3} />}
      {shape === 'yard' && <><rect x={1.5} y={1.5} width={s - 3} height={(s - 3) * 0.6} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={1.3} /><rect x={1.5} y={1.5} width={s - 3} height={s - 3} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="2 2" /></>}
      {shape === 'atrium' && <path d={`M1.5 1.5H${s - 1.5}V${s - 1.5}H1.5Z M${s * 0.32} ${s * 0.32}V${s * 0.68}H${s * 0.68}V${s * 0.32}Z`} fill="currentColor" fillOpacity={0.25} fillRule="evenodd" stroke="currentColor" strokeWidth={1.3} />}
    </svg>
  )
}

function CellsCard({ p, plan, set }: { p: GenParams; plan?: { i: number; j: number; ground: string; upper: string | null }[]; set: (x: Partial<GenParams>) => void }) {
  const [sel, setSel] = useState<string | null>(null)
  const cells = p.cells
  const apply = (next: Cell[], shapes = p.shapes, s: string | null = sel) => {
    const out = shiftCells(next, shapes, s)
    setSel(out.sel)
    set({ cells: out.cells, shapes: out.shapes })
  }
  const N = 7
  const w = Math.max(...cells.map((c) => c[0])) + 1, h = Math.max(...cells.map((c) => c[1])) + 1
  const ox = Math.floor((N - w) / 2), oy = Math.floor((N - h) / 2)
  const has = (i: number, j: number) => cells.some((c) => c[0] === i && c[1] === j)
  const near = (i: number, j: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => has(i + a, j + b))
  // вибрана ділянка могла зникнути («Рандом» змінив розкладку) — тоді нічого не вибрано
  const selCell = sel && cells.some((c) => `${c[0]},${c[1]}` === sel) ? (sel.split(',').map(Number) as Cell) : null
  const remove = (i: number, j: number) => {
    const next = cells.filter((c) => !(c[0] === i && c[1] === j))
    if (!next.length) return
    if (!connected(next)) { toast.error(t('Так ділянки роз’єднаються — спершу прибери крайню')); return }
    apply(next, p.shapes, null)
  }
  const rows = []
  for (let rr = N - 1; rr >= 0; rr--) {
    for (let cc = 0; cc < N; cc++) {
      const i = cc - ox, j = rr - oy
      const on = has(i, j)
      const can = on || (cells.length < LIMITS.cells && near(i, j))
      const pc = on ? plan?.find((x) => x.i === i && x.j === j) : undefined
      const g = pc ? GROUND_LABEL[pc.ground]?.() : null
      const u = pc?.upper ? UPPER_LABEL[pc.upper]?.() : null
      const shape = (p.shapes[`${i},${j}`] || 'square') as Shape
      const picked = sel === `${i},${j}`
      const what = [SHAPE_INFO[shape].label(), g?.[1], u?.[1]].filter(Boolean).join(', ')
      rows.push(
        <button key={`${cc},${rr}`} type="button" disabled={!can}
          onClick={() => (on ? setSel(picked ? null : `${i},${j}`) : apply([...cells, [i, j]], p.shapes, `${i},${j}`))}
          title={on ? what : can ? t('Додати ділянку') : undefined}
          aria-label={on ? t('Ділянка {i}, {j}: {what}', { i: i + 1, j: j + 1, what }) : t('Додати ділянку')}
          aria-pressed={on ? picked : undefined}
          className={cn('relative grid aspect-square min-w-0 place-content-center gap-0.5 overflow-hidden rounded-md border text-center leading-none transition-colors',
            on ? (picked ? 'border-spice bg-spice/30 ring-2 ring-spice/50' : 'border-spice/70 bg-spice/15 hover:bg-spice/25') + ' text-ink' : can ? 'border-dashed border-line bg-panel2/40 text-muted hover:border-spice/50 hover:text-spice' : 'border-transparent bg-panel2/20')}>
          {on && shape !== 'square' && <ShapeGlyph shape={shape} size={12} className="absolute right-1 top-1 text-spice" />}
          {on && g && <span className="hyphens-auto break-words px-0.5 text-[10px] font-semibold leading-tight">{g[0]}</span>}
          {on && u && <span className="hyphens-auto break-words px-0.5 text-[9px] leading-tight text-spice">{u[0]}</span>}
          {!on && can && <Plus size={13} className="mx-auto opacity-60" />}
        </button>,
      )
    }
  }
  const selShape = selCell ? ((p.shapes[sel!] || 'square') as Shape) : null
  return (
    <Card>
      <SectionTitle aside={<span className="font-mono text-[12px] text-muted">{t('{n} з {max}', { n: cells.length, max: LIMITS.cells })}</span>}>{t('Ділянки 10 × 10')}</SectionTitle>
      <div className="grid w-full max-w-[340px] grid-cols-7 gap-1">{rows}</div>
      {selCell && selShape && (
        <div className="mt-3 grid gap-2 rounded-lg border border-spice/40 bg-spice/5 p-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">{t('Ділянка {i}, {j}', { i: selCell[0] + 1, j: selCell[1] + 1 })}</span>
            <div className="ml-auto flex gap-1">
              <Button variant="ghost" size="sm" disabled={cells.length < 2} onClick={() => remove(selCell[0], selCell[1])}><Trash2 size={13} /> {t('Прибрати')}</Button>
              <Button variant="ghost" size="icon" aria-label={t('Закрити')} onClick={() => setSel(null)}><X size={14} /></Button>
            </div>
          </div>
          <div className="grid gap-1.5" role="radiogroup" aria-label={t('Форма приміщень')}>
            <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('Форма приміщень')}</span>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(SHAPE_INFO) as Shape[]).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={selShape === s}
                  onClick={() => { const next = { ...p.shapes }; if (s === 'square') delete next[sel!]; else next[sel!] = s; set({ shapes: next }) }}
                  className={cn('grid content-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors', selShape === s ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel hover:border-spice/40')}>
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold"><ShapeGlyph shape={s} className="text-spice" /> {SHAPE_INFO[s].label()}</span>
                  <span className="text-[11.5px] leading-snug text-muted">{SHAPE_INFO[s].sub()}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {LAYOUTS.map((s) => (
          <button key={s.id} type="button" onClick={() => { setSel(null); set({ cells: s.cells, shapes: {} }) }}
            className={cn('rounded-md border px-2.5 py-1 text-[12.5px] transition-colors', sameCells(p.cells, s.cells) ? 'border-spice/70 bg-spice/10 text-spice' : 'border-line bg-panel2/40 text-muted hover:border-spice/40 hover:text-ink')}>
            {s.label()}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-muted">{t('Клік по порожній клітинці — додати ділянку, по ділянці — вибрати її форму чи прибрати. Кожна ділянка має прилягати до сусідньої цілою стороною.')}</p>
    </Card>
  )
}

// ---------- стиль ----------
/** перемикачі стилю: назва й що робить (ключі перекладу) */
const FLAG_INFO: Record<string, () => [string, string]> = {
  columns: () => [t('Колонади'), t('перший поверх відступає, верх тримають колони')],
  cantilever: () => [t('Нависання'), t('перший поверх під верхом відступає на дві плитки — верх висить над підсінням')],
  porch: () => [t('Ганок'), t('вхід у ніші під навісом на двох колонах')],
  setbacks: () => [t('Уступи й балкони'), t('житло нагорі вужче, довкола — балкон, з кімнат двері на нього')],
  balconies: () => [t('Балкончики на вежах'), t('плита 2 × 1 з поручнями на верхньому поверсі вежі')],
  battlements: () => [t('Зубці'), t('замість поручнів на терасах і пласких дахах')],
  parapets: () => [t('Парапети'), t('суцільна напівстіна замість поручнів')],
  skylights: () => [t('Скляні стелі'), t('пентащит у даху над житлом і залами')],
  ziggurat: () => [t('Зикурат'), t('три яруси похилих стін зі скляною короною на терасі')],
  dome: () => [t('Купол'), t('ступінчастий купол з ліхтарем над шестикутником')],
  pavilion: () => [t('Павільйон на даху'), t('колони й дах над житлом, драбина з коридору')],
  canopies: () => [t('Навіси на терасах'), t('пласкі дахи на колонах — тінь від сонця')],
}
function StyleCard({ style, onChange }: { style: Style; onChange: (s: Style) => void }) {
  // змінено перемикач — стиль «свій» (пресет перераховує normalizeStyle)
  const set = (patch: Partial<Style>) => onChange(normalizeStyle({ ...style, ...patch, preset: 'custom' }))
  const custom = style.preset === 'custom'
  return (
    <Card>
      <SectionTitle aside={custom ? <span className="text-[12px] text-muted">{t('свій стиль')}</span> : undefined}>{t('Стиль')}</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t('Стиль бази')}>
        {Object.entries(STYLE_PRESETS).map(([id, pr]) => (
          <button key={id} type="button" role="radio" aria-checked={style.preset === id} onClick={() => onChange(normalizeStyle({ preset: id }))}
            className={cn('grid content-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors', style.preset === id ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40')}>
            <span className="text-[13px] font-semibold">{t(pr.name)}</span>
            <span className="text-[11.5px] leading-snug text-muted">{t(pr.sub)}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-muted">{t('Вікон генератор не ставить: у кожному наборі гри вони свої — додаси їх у будівельнику. Тут — форма й стиль будівлі.')}</p>
      <details className="mt-2.5 min-w-0 rounded-lg border border-line bg-panel2/30" open={custom}>
        <summary className="cursor-pointer px-2.5 py-2 text-[13px] font-semibold">{t('Налаштувати стиль')}</summary>
        <div className="grid gap-3 px-2.5 pb-2.5">
          <Options label={t('Стіни')} value={style.walls} onChange={(walls) => set({ walls })}
            items={[{ id: 'straight', label: t('Прямі') }, { id: 'lean', label: t('Похилі'), sub: t('верхні й одноповерхові, лише на квадратах') }, { id: 'inverted', label: t('Обернені похилі'), sub: t('перший поверх під верхом — похило назовні, верх нависає') }]} />
          <Options label={t('Дахи')} value={style.roof} onChange={(roof) => set({ roof })}
            items={[{ id: 'flat', label: t('Пласкі') }, { id: 'hip', label: t('Скатні') }, { id: 'pyramid', label: t('Піраміди') }, { id: 'vault', label: t('Склепіння'), sub: t('скатні з заокругленими скатами') }, { id: 'dome', label: t('Куполи'), sub: t('піраміди з заокругленими скатами') }]} />
          <Options label={t('Вежі')} value={style.towers} onChange={(towers) => set({ towers })}
            items={[{ id: 'none', label: t('Без веж') }, { id: 'one', label: t('Одна'), sub: t('на терасі, на найкращому куті') }, { id: 'corners', label: t('На кутах'), sub: t('на зовнішніх кутах терас, до чотирьох') }]} />
          {style.towers !== 'none' && (
            <Options label={t('Форма веж')} value={style.towerShape} onChange={(towerShape) => set({ towerShape })}
              items={[{ id: 'square', label: t('Квадратні'), sub: t('4 × 4 на всю висоту') }, { id: 'goblet', label: t('Келих'), sub: t('стовбур 2 × 2, нагорі оглядовий майданчик') }, { id: 'stepped', label: t('Уступом'), sub: t('нагорі вужча кімната, довкола майданчик') }]} />
          )}
          {style.towers !== 'none' && <Stepper label={t('Поверхів у вежі')} hint={t('понад терасою, по 4 блоки')} value={style.towerFloors} max={3} onChange={(towerFloors) => set({ towerFloors: Math.max(1, towerFloors) })} />}
          {style.towers !== 'none' && (
            <Options label={t('Верх веж')} value={style.towerCap} onChange={(towerCap) => set({ towerCap })}
              items={[{ id: 'roof', label: t('Як дахи') }, { id: 'pyramid', label: t('Піраміда') }, { id: 'hip', label: t('Скатний') }, { id: 'flat', label: t('Пласкі') }, { id: 'spires', label: t('Голки'), sub: t('колони-шпилі на кутах') }, { id: 'room', label: t('Кімната'), sub: t('на келиху й уступі — закрита оглядова') }]} />
          )}
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(FLAG_INFO).map(([k, info]) => {
              const on = !!style[k as keyof Style]
              const [label, sub] = info()
              return (
                <button key={k} type="button" role="switch" aria-checked={on} onClick={() => set({ [k]: !on } as Partial<Style>)}
                  className={cn('grid content-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors', on ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel hover:border-spice/40')}>
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold">{on ? <Check size={13} className="text-spice" /> : <span className="inline-block h-[13px] w-[13px] rounded-sm border border-line" />} {label}</span>
                  <span className="text-[11.5px] leading-snug text-muted">{sub}</span>
                </button>
              )
            })}
          </div>
        </div>
      </details>
    </Card>
  )
}

// ---------- ангари й гаражі ----------
function BaysCard({ bays, onChange }: { bays: Bay[]; onChange: (b: Bay[]) => void }) {
  const upd = (i: number, b: Bay) => onChange(bays.map((x, k) => (k === i ? b : x)))
  const add = (kind: 'air' | 'ground') => onChange([...bays, kind === 'air' ? { kind, items: { OrnithopterLight: 1 }, portals: 2, roof: false } : { kind, items: { Buggy: 1 }, portals: 1, roof: false }])
  const group = (air: 'type' | 'small' | 'all' | 'pairs', ground: 'type' | 'all') => onChange(regroup(bays, air, ground))
  let na = 0, ng = 0
  return (
    <Card>
      <SectionTitle>{t('Ангари й гаражі')}</SectionTitle>
      <p className="mb-2 text-[12.5px] leading-snug text-muted">{t('Уся техніка стоїть лише в закритих ангарах і гаражах — буря ламає те, що надворі. Згрупуй, як зручно: що з чим стоїть, скільки ділянок займає ангар і як із нього вилітати.')}</p>
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {([['type', 'type', t('Кожен тип окремо')], ['small', 'all', t('Розвідники й штурмові разом')], ['all', 'all', t('Усі орні разом')], ['pairs', 'all', t('Орні по двоє')]] as const).map(([a, g, label]) => (
          <button key={a} type="button" onClick={() => group(a, g)} className="rounded-md border border-line bg-panel2/40 px-2.5 py-1 text-[12.5px] text-muted transition-colors hover:border-spice/40 hover:text-ink">{label}</button>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {bays.map((b, i) => {
          const n = b.kind === 'air' ? ++na : ++ng
          const k = bayCells(b)
          const types = BAY_TYPES[b.kind]
          const box = !!b.items[CONTAINER]
          return (
            <div key={i} className="grid gap-2 rounded-lg border border-line bg-panel2/30 p-2.5">
              <div className="flex items-center gap-2">
                {b.kind === 'air' ? <Plane size={15} className="text-spice" /> : <Car size={15} className="text-spice" />}
                <span className="text-[13.5px] font-semibold">{b.kind === 'air' ? t('Ангар {n}', { n }) : t('Гараж {n}', { n })}</span>
                <span className={cn('rounded-full px-2 py-0.5 font-mono text-[11px]', k < 0 ? 'bg-bad/15 text-bad' : 'bg-panel2 text-muted')}>
                  {k < 0 ? t('не вміщається — розбий на два') : k === 0 ? t('порожній') : t('{k} {w} поспіль', { k, w: word(k, [t('ділянка'), t('ділянки'), t('ділянок')]) })}
                </span>
                <Button variant="ghost" size="icon" className="ml-auto" aria-label={t('Прибрати')} onClick={() => onChange(bays.filter((_, x) => x !== i))}><Trash2 size={14} /></Button>
              </div>
              <div className="grid gap-0.5">
                {types.map((tp) => (
                  <Stepper key={tp} label={VEH_NAME(tp)} value={b.items[tp] || 0}
                    hint={tp === 'OrnithopterTransport' ? t('ангар 6 заввишки; вихід — портал ≥ 9 × 6 (від двох ділянок) чи щит у даху над ним') : tp === CONTAINER ? t('місце стоянки; забирає грузовий згори — над ним щит у даху') : undefined}
                    max={tp === 'OrnithopterTransport' ? 1 : tp === CONTAINER ? 2 : b.kind === 'air' ? LIMITS.perBayAir : LIMITS.perBayGround}
                    onChange={(v) => {
                      const items = { ...b.items, [tp]: v }
                      if (!v) delete items[tp]
                      // контейнер у гаражі забирає грузовий згори — щит у даху вмикається сам
                      upd(i, { ...b, items, ...(tp === CONTAINER && v && b.kind === 'ground' ? { roof: true } : {}) })
                    }} />
                ))}
              </div>
              {b.kind === 'air' ? (
                <Options<Entry> label={t('Вхід')} value={entryOf(b)} onChange={(e) => upd(i, { ...b, ...ENTRY[e] })}
                  items={[
                    { id: 'through', label: t('Наскрізь'), sub: t('портали з обох боків') },
                    { id: 'side', label: t('З одного боку'), sub: t('портал в одній стіні') },
                    { id: 'roof', label: t('Щит у даху'), sub: t('горизонтальний пентащит, зліт угору') },
                    { id: 'sideroof', label: t('Портал і щит у даху'), sub: t('портал в одній стіні й щит згори') },
                    { id: 'throughroof', label: t('Наскрізь і щит у даху'), sub: t('портали з обох боків і щит згори') },
                  ]} />
              ) : (
                <Options<Entry> label={t('Вхід')} value={entryOf(b)} onChange={(e) => upd(i, { ...b, ...ENTRY[e] })}
                  items={[
                    { id: 'side', label: t('З одного боку'), sub: t('техніка в ряд біля задньої стіни'), off: box ? t('контейнер забирає грузовий — потрібен щит у даху') : undefined },
                    { id: 'through', label: t('Наскрізь'), sub: t('заїзд з одного боку, виїзд з іншого'), off: box ? t('контейнер забирає грузовий — потрібен щит у даху') : undefined },
                    { id: 'sideroof', label: t('Портал і щит у даху'), sub: t('грузовий забирає техніку згори') },
                    { id: 'throughroof', label: t('Наскрізь і щит у даху'), sub: t('заїзд, виїзд і грузовий згори') },
                  ]} />
              )}
            </div>
          )
        })}
        {!bays.length && <p className="text-[13px] text-muted">{t('Техніки нема — додай ангар чи гараж.')}</p>}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={bays.length >= LIMITS.bays} onClick={() => add('air')}><Plane size={14} /> {t('Ангар орні')}</Button>
        <Button variant="secondary" size="sm" disabled={bays.length >= LIMITS.bays} onClick={() => add('ground')}><Car size={14} /> {t('Гараж')}</Button>
      </div>
    </Card>
  )
}

// ---------- станції ----------
function StationsCard({ stations, rooms, onChange, onRooms }: { stations: Record<string, number>; rooms: number; onChange: (s: Record<string, number>) => void; onRooms: (n: number) => void }) {
  const total = Object.values(stations).reduce((s, n) => s + n, 0)
  const groups = PRESET_GROUPS.filter(([g]) => g !== 'vehicle').map(([g, name]) => [g, name, PRESETS.filter((x) => x.group === g && STATION_TYPES.includes(x.type))] as const)
  const same = (a: Record<string, number>) => STATION_TYPES.every((tp) => (a[tp] || 0) === (stations[tp] || 0))
  const SETS = [['endgame', t('Фінальний')], ['advanced', t('Удосконалене')], ['basic', t('Базове')], ['none', t('Нічого')]] as const
  const current = SETS.find(([k]) => same(STATION_SETS[k]))
  return (
    <Card>
      <SectionTitle aside={<span className="font-mono text-[12px] text-muted">{t('{n} з {max}', { n: total, max: LIMITS.stations })}</span>}>{t('Станції')}</SectionTitle>
      {/* згорнуто: за замовчуванням — фінальний набір (усе, що стоїть на базі наприкінці гри); розгорнути — змінити */}
      <details className="min-w-0 rounded-lg border border-line bg-panel2/30">
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2 text-[13px]">
          <span className="font-semibold">{current ? t('Набір: {name}', { name: current[1] }) : t('Свій набір')}</span>
          <span className="text-muted">{t('{n} {w}', { n: total, w: word(total, [t('станція'), t('станції'), t('станцій')]) })}</span>
          <span className="ml-auto text-[12px] text-spice">{t('розгорнути й змінити')}</span>
        </summary>
        <div className="grid gap-2 px-2 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {SETS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => onChange({ ...STATION_SETS[k] })}
                className={cn('rounded-md border px-2.5 py-1 text-[12.5px] transition-colors', same(STATION_SETS[k]) ? 'border-spice/70 bg-spice/10 text-spice' : 'border-line bg-panel text-muted hover:border-spice/40 hover:text-ink')}>{label}</button>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
            {groups.map(([g, name, list]) => {
              const n = list.reduce((s, x) => s + (stations[x.type] || 0), 0)
              return (
                <details key={g} className="min-w-0 rounded-lg border border-line bg-panel">
                  <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[13px] font-semibold">
                    {name}
                    <span className="ml-auto font-mono text-[12px] font-normal text-muted">{n}</span>
                  </summary>
                  <div className="grid gap-1 px-2 pb-2">
                    {list.map((x) => (
                      <StationRow key={x.type} p={x} value={stations[x.type] || 0}
                        onChange={(v) => { const next = { ...stations, [x.type]: v }; if (!v) delete next[x.type]; onChange(next) }} />
                    ))}
                  </div>
                </details>
              )
            })}
          </div>
        </div>
      </details>
      <div className="mt-2.5 border-t border-line pt-2">
        <Stepper label={t('Кімнати житла')} hint={t('по скрині й контейнеру в кожній; 4 кімнати — одна ділянка нагорі')} value={rooms} max={LIMITS.rooms} onChange={onRooms} />
      </div>
    </Card>
  )
}
function StationRow({ p, value, onChange }: { p: (typeof PRESETS)[number]; value: number; onChange: (v: number) => void }) {
  const name = lab(p.name)
  return (
    <div className={cn('flex items-center gap-2 rounded-md px-1.5 py-1', value > 0 && 'bg-spice/5')}>
      <StationIcon p={p} size={32} />
      <div className="min-w-0 flex-1">
        <div className="break-words text-[13px] leading-snug">{name}</div>
        <div className="font-mono text-[11px] text-muted">{p.w} × {p.d} × {p.h}{OUTDOOR.has(p.type) ? ` · ${t('надворі')}` : ''}</div>
      </div>
      <StepButtons label={name} value={value} max={LIMITS.station} onChange={onChange} />
    </div>
  )
}

// ---------- поля ----------
function StepButtons({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="secondary" size="icon" aria-label={t('Менше: {what}', { what: label })} disabled={value <= 0} onClick={() => onChange(value - 1)}><Minus size={14} /></Button>
      <span className="w-7 text-center font-mono text-[14px] font-semibold tabular-nums">{value}</span>
      <Button variant="secondary" size="icon" aria-label={t('Більше: {what}', { what: label })} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus size={14} /></Button>
    </div>
  )
}
function Stepper({ label, hint, value, max, onChange }: { label: string; hint?: ReactNode; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3 py-0.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px]">{label}</div>
        {hint && <div className="text-[12px] leading-snug text-muted">{hint}</div>}
      </div>
      <StepButtons label={label} value={value} max={max} onChange={onChange} />
    </div>
  )
}

/** варіанти — однаковими картками поруч (вибрана підсвічена; недоступна — сіра з причиною) */
function Options<T extends string>({ label, value, items, onChange }: { label: string; value: T; items: { id: T; label: string; sub?: string; off?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-1.5" role="radiogroup" aria-label={label}>
      <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {/* до трьох — в один ряд; чотири — два на два; більше — по два на телефоні, по три ширше */}
      <div className={cn('grid gap-1.5', items.length === 1 ? 'grid-cols-1' : items.length === 2 || items.length === 4 ? 'grid-cols-2' : items.length === 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3')}>
        {items.map((it) => (
          <button key={it.id} type="button" role="radio" aria-checked={value === it.id} disabled={!!it.off} onClick={() => onChange(it.id)} title={it.off}
            className={cn('grid content-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              value === it.id ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40')}>
            {/* довгі слова (укр., нім.) у вузьких картках — переносом, а не за край */}
            <span className="hyphens-auto break-words text-[13px] font-semibold">{it.label}</span>
            {(it.off || it.sub) && <span className="hyphens-auto break-words text-[11.5px] leading-snug text-muted">{it.off || it.sub}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- перевірка ----------
/** коротко: усе гаразд чи скільки порушень, і головні цифри */
function Status({ r }: { r?: GenResult }) {
  if (!r) return <span className="text-[13px] text-muted">{t('Генерую…')}</span>
  if (!r.doc) return <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-bad"><X size={15} /> {t('Таку базу не побудувати')}</span>
  const rep = r.report!
  const bad = rep.checks.filter((c) => !c.ok).length
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className={cn('flex items-center gap-1.5 text-[13.5px] font-semibold', bad ? 'text-bad' : 'text-ok')}>
        {bad ? <X size={15} /> : <Check size={15} />} {bad ? t('Порушено правил: {n}', { n: bad }) : t('Усі правила гри виконано')}
      </span>
      <span className="font-mono text-[12px] tabular-nums text-muted">{t('{n} {w}', { n: rep.stats.pieces, w: word(rep.stats.pieces, [t('деталь'), t('деталі'), t('деталей')]) })} · {t('техніка під дахом')} {rep.stats.sheltered}/{rep.stats.vehicles} · {t('стабільність')} ≥ {rep.stats.minStability} %</span>
    </div>
  )
}
function Report({ r }: { r?: GenResult }) {
  if (!r) return null
  if (!r.doc) return <div className="mt-2"><Msgs list={r.errors} tone="bad" /></div>
  const rep = r.report!
  const fits = r.notes.filter((n) => n.code === 'fit')
  const other = r.notes.filter((n) => n.code !== 'fit')
  return (
    <div className="mt-1.5 grid gap-2">
      <details className="text-[13px]">
        <summary className="cursor-pointer text-[12.5px] text-muted">{t('Перевірка правил гри')}</summary>
        <ul className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {rep.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-2 leading-snug">
              {c.ok ? <Check size={15} className="mt-0.5 shrink-0 text-ok" /> : <X size={15} className="mt-0.5 shrink-0 text-bad" />}
              <span className={cn(!c.ok && 'text-bad')}>{t(c.title)}{c.warn ? <span className="text-warn"> · {t('попереджень: {n}', { n: c.warn })}</span> : null}</span>
            </li>
          ))}
        </ul>
      </details>
      {rep.errors.length > 0 && <Msgs list={rep.errors} tone="bad" title={t('Порушення — таку базу не створимо')} />}
      {other.length > 0 && <Msgs list={other} tone="warn" />}
      {fits.length > 0 && <Msgs list={[{ text: t('Не вмістилось ({n}): {what}', { n: fits.length, what: fits.map((f) => lab(String(f.vars?.what ?? ''))).join(', ') }) }]} tone="warn" />}
    </div>
  )
}
function Msgs({ list, tone, title }: { list: GenMsg[]; tone: 'bad' | 'warn'; title?: string }) {
  return (
    <div className={cn('grid gap-1 rounded-lg border px-3 py-2 text-[13px] leading-snug', tone === 'bad' ? 'border-bad/40 bg-bad/10' : 'border-warn/40 bg-warn/10')}>
      {title && <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} className={tone === 'bad' ? 'text-bad' : 'text-warn'} /> {title}</div>}
      {list.slice(0, 8).map((m, i) => <div key={i}>{msg(m)}</div>)}
      {list.length > 8 && <div className="text-muted">{t('і ще {n}', { n: list.length - 8 })}</div>}
    </div>
  )
}

// ---------- створити ----------
function CreatePanel({ p, r, onName, userId }: { p: GenParams; r?: GenResult; onName: (n: string) => void; userId: string }) {
  // власник за замовчуванням — сама людина, база приватна (гільдію можна вибрати тут же)
  const [owner, setOwner] = useState<OwnerRef>({ kind: 'user', id: userId })
  const [vis, setVis] = useState<Visibility>('private')
  const rights = useNewRights('base')
  const [busy, setBusy] = useState(false)
  const [errs, setErrs] = useState<GenMsg[]>([])
  const ok = !!r?.doc && !r.report?.errors.length
  const name = p.name.trim()
  const placeholder = useMemo(() => t('Згенерована база'), [])
  const create = async () => {
    setBusy(true)
    setErrs([])
    try {
      const b = await createGenerated({ ...p, name: name || placeholder }, owner, vis)
      await rights.apply(b, owner, vis)
      toast.success(t('Базу «{name}» створено', { name: b.doc?.ui?.name || name || placeholder }))
      useStore.getState().setView('bases', narrow() ? { base: b.id } : { base: b.id, edit: true })
    } catch (e) {
      if (e instanceof GenError) setErrs(e.errors)
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="grid gap-3">
      <SectionTitle>{t('Створити базу')}</SectionTitle>
      <Field label={t('Назва')}>
        <SnInput size="md" modelValue={p.name} maxLength={LIMITS.name} placeholder={placeholder} accessibilityLabel={t('Назва')}
          onInput={(e: Event) => onName(valueOf(e) ?? '')} />
      </Field>
      <NewAccess owner={owner} visibility={vis} rights={rights} onChange={(o, v) => { setOwner(o); setVis(v) }} />
      {errs.length > 0 && <Msgs list={errs} tone="bad" title={t('Сервер не створив базу')} />}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!ok && <span className="text-[13px] text-muted">{t('Спершу виправ параметри — зараз база не проходить перевірку.')}</span>}
        <Button disabled={!ok || busy} loading={busy} onClick={() => void create()}>
          <Sparkles size={15} /> {busy ? t('Створюю…') : narrow() ? t('Створити') : t('Створити й редагувати')}
        </Button>
      </div>
    </Card>
  )
}

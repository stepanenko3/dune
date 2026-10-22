/**
 * Калькулятор виробництва (розрахунок — src/lib/calc.ts), спільний для двох місць:
 *   • сторінка «Калькулятор» — свій список цілей (предмети й будівлі), onTargets зберігає його;
 *   • сторінка бази — модель бази як цілі, з правками (теж onTargets).
 * Довідник відкриває сторінку калькулятора з потрібною ціллю: у вузькій картці він не влазить.
 * Розрахунок — маршрут етапів: ціль → що потрібно → що видобути → що й де переробити. Етапи — вкладки
 * з головним числом на кожній: підсумок видно одразу, відкритий — один і в адресі (?step=gather); без нього — перший.
 * Указ тижня — той, що вибрано на головній; у калькуляторі його можна лише вимкнути (calc:decree), щоб порахувати
 * без нього. У збереженого розрахунку указ свій (decree) — з ним його й рахували, тож і всі бачать ті самі числа.
 * Етапи: ціль → станції → (потрібно — коли є будівлі) → видобути → рейси → переробка.
 * «Станції»: той самий предмет на малому, середньому й великому переробнику — різні рецепти (на більшому менше
 * сировини й швидше). Для кожної родини (переробник руди, хімічний, спайсу; фабрикатори) — картки станцій ланцюжка:
 * за скільки й як зміниться сировина; вибір пам'ятається для всіх розрахунків (calc:stations; сторінка калькулятора
 * задає його сама — у збереженого розрахунку свій), і «Видобути» та «Переробка» рахуються вже з ним.
 * «Показати всі» (calc:allStations) додає решту станцій того самого виду з гри —
 * заблокованими, з причиною (малий хімічний не робить волокно стравідію).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Calculator, Droplet, Hammer, Landmark, Lock, PackageSearch, Pickaxe, Plus, Timer, Trash2 } from 'lucide-react'
import { buildName, buildWords, fmtTime, groupLabel, iconUrl, isDevice, nameOf, setLabel, wikiImg, type CatalogIndex, type CItem } from '@/lib/catalog'
import { buildKey, calc, decreeFx, familyOf, findBuild, kinOf, pickStations, stationTier, type CalcResult, type Step, type Target } from '@/lib/calc'
import { decreeOf, useDecree, type DecreeId } from '@/lib/decree'
import { prefGet, prefSet } from '@/lib/prefs'
import { useUrlParam } from '@/lib/urlState'
import { useStore } from '@/store'
import { cn, fmtN, fmtP, plural, word, type Forms } from '@/lib/utils'
import { currentLang, locale, t, T } from '@/lib/i18n'
import { SnInput, SnNumberField, valueOf } from '@/components/sn'
import { Empty } from '@/components/states'
import { cols, Icon, Line, openBuild, type Open } from './bits'
import { TRIP, Trips, useTrips } from './Trips'

const fmtWater = (ml: number) => (ml >= 1000 ? t('{n} л', { n: fmtP(Math.round(ml / 100) / 10) }) : t('{n} мл', { n: fmtN(Math.round(ml)) }))
/** слово в реченні — з малої літери (німецькою іменники лишаються з великої) */
const lower = (x: string) => (currentLang() === 'de' ? x : x.toLocaleLowerCase(locale()))

/** повзунок перемикача (вмикач — сама кнопка з role="switch" навколо) */
function Knob({ on }: { on: boolean }) {
  return (
    <span className={cn('relative h-4 w-7 shrink-0 rounded-full transition-colors', on ? 'bg-spice' : 'bg-line')} aria-hidden>
      <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-panel transition-[left]', on ? 'left-3.5' : 'left-0.5')} />
    </span>
  )
}

/**
 * указ тижня з головної: що враховано; вмикач — рахувати з ним чи без; «змінити» — на головну, де його вибирають.
 * fixed — указ збереженого розрахунку: з ним і рахуємо, без вмикача
 */
function DecreeLine({ on, onChange, fixed }: { on: boolean; onChange: (v: boolean) => void; fixed?: DecreeId | null }) {
  const { id: week, loaded, load } = useDecree()
  useEffect(() => { if (!loaded) load() }, [loaded, load])
  const id = fixed !== undefined ? fixed : week
  const d = decreeOf(id)
  const fx = decreeFx(id)
  const acts = fx.production || fx.refining
  const goHome = (e: React.MouseEvent) => { e.preventDefault(); useStore.getState().setView('home') }
  const what = fx.production ? t('−25% ресурсів і води') : t('−75% часу переробки')
  if (fixed !== undefined)
    return (
      <div className={cn('flex flex-[1_1_18rem] items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px]', acts ? 'bg-spice/10 text-ink' : 'bg-panel2/50 text-muted')}>
        <Landmark size={13} className="shrink-0 text-spice" />
        <span className="min-w-0">{d && acts ? t('Указ розрахунку «{name}»: {what}', { name: d.name, what }) : t('Розрахунок збережено без указу')}</span>
      </div>
    )
  return (
    <div className={cn('flex flex-[1_1_18rem] items-center gap-2 rounded-md px-2 py-1.5 text-[12px]', acts && on ? 'bg-spice/10 text-ink' : 'bg-panel2/50 text-muted')}>
      {d && acts ? (
        <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} title={on ? t('Рахувати без указу') : t('Рахувати з указом')} className="flex min-w-0 items-center gap-2 text-left hover:text-ink">
          <Knob on={on} />
          <Landmark size={13} className="shrink-0 text-spice" />
          <span className="min-w-0">{on ? t('Указ «{name}»: {what}', { name: d.name, what }) : t('Указ «{name}» не враховано', { name: d.name })}</span>
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">
          <Landmark size={13} className="shrink-0 text-spice" />
          {d ? t('Указ «{name}» — без впливу', { name: d.name }) : t('Без указу')}
        </span>
      )}
      <a href="/" onClick={goHome} className="ml-auto whitespace-nowrap underline underline-offset-2 hover:text-spice">{t('змінити')}</a>
    </div>
  )
}

// ---------- пошук цілей ----------
/** частини англійських id будівель → українські слова, щоб шукалось «фундамент», «стіна», «переробник руди» (лише українською: іншими мовами шукають за назвою мовою сайту й англійською) */
const UK_WORDS: Record<string, string> = {
  foundation: 'фундамент', triangle: 'трикутник трикутна', wedge: 'трикутник трикутна', rounded: 'заокруглений', wall: 'стіна стіни', half: 'напів половина',
  window: 'вікно', door: 'двері', doors: 'двері', garage: 'гараж ворота', passageway: 'прохід', roof: 'дах', rooftop: 'дах',
  floor: 'перекриття підлога стеля', stairs: 'сходи', ramp: 'пандус похила', railing: 'парапет поручні', gate: 'хвіртка',
  pillar: 'колона', column: 'колона', corner: 'кут кутовий', angled: 'похилий скат', tall: 'високий', incline: 'похилий',
  refinery: 'переробник', ore: 'руда руди', spice: 'спайс меланж', chemical: 'хімічний', fabricator: 'фабрикатор верстак',
  storage: 'сховище склад', container: 'контейнер', chest: 'скриня', windtrap: 'вітропастка', wind: 'вітряк', turbine: 'вітряк турбіна',
  generator: 'генератор', fuelpowered: 'паливний', spicepowered: 'спайсовий', cistern: 'цистерна', water: 'вода', repair: 'ремонт ремонтна',
  station: 'станція', recycler: 'ресайклер переробка', console: 'консоль', subfief: 'суб-фіф', pentashield: 'пентащит щит',
  deathstill: 'дистилятор', blood: 'кров', purifier: 'очисник', large: 'великий', medium: 'середній', small: 'малий',
  advanced: 'розширений покращений', garment: 'одяг', weapons: 'зброя', survival: 'виживання', vehicle: 'техніка', augmentation: 'аугментація',
}
interface Hit { key: string; target: Target; name: string; sub: string; icon: string | null; grade?: number; text: string }
const hitsCache = new WeakMap<CatalogIndex, Hit[]>()
/** усе, що можна додати, з текстом для пошуку обома мовами (раз на довідник) */
function searchable(ix: CatalogIndex): Hit[] {
  const cached = hitsCache.get(ix)
  if (cached) return cached
  const norm = (n: string) => n.toLowerCase().replace(/-/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
  const locOfPlace = new Map<string, string>()
  const uk = currentLang() === 'uk'
  for (const p of ix.cat.placeables) if (p.loc) { const k = norm(p.name); locOfPlace.set(k, p.loc); locOfPlace.set(k.replace(/s_/g, '_').replace(/s$/, ''), p.loc) }
  const out: Hit[] = []
  for (const i of ix.cat.items)
    if (ix.makes.has(i.id))
      out.push({ key: 'item:' + i.id, target: { kind: 'item', id: i.id, qty: 1 }, name: nameOf(i), sub: i.loc ? i.name : '', icon: iconUrl(i.icon), grade: i.grade, text: `${i.name} ${i.loc ?? ''}`.toLowerCase() })
  for (const b of ix.cat.buildables) {
    const loc = locOfPlace.get(b.id)
    const words = uk ? buildWords(b.id).split(' ').map((w) => UK_WORDS[w] ?? '').join(' ') : ''
    out.push({
      key: 'build:' + buildKey(b),
      target: { kind: 'build', id: buildKey(b), qty: 1 },
      name: loc ?? buildName(b),
      sub: `${groupLabel(b.group)} · ${setLabel(b.set)}`,
      icon: wikiImg(b.img),
      text: `${buildName(b)} ${buildWords(b.id)} ${loc ?? ''} ${words} ${setLabel(b.set)} ${groupLabel(b.group)}`.toLowerCase(),
    })
  }
  hitsCache.set(ix, out)
  return out
}
/** що показати у фокусі з порожнім полем: основні деталі сардаукарського набору, ключові пристрої й матеріали */
const SUGGEST = [
  'build:Sardaukar_Foundation', 'build:Sardaukar_Foundation_Wedge', 'build:Sardaukar_Wall_01', 'build:Sardaukar_Floor_02',
  'build:Sardaukar_Floor_Wedge', 'build:Sardaukar_Stairs', 'build:Sardaukar_Ramp', 'build:Sardaukar_Railing',
  'build:Sardaukar_Door_Frame', 'build:Sardaukar_Pillar_Middle', 'build:LargeOreRefinery_Placeable', 'build:LargeSpiceRefinery_Placeable',
  'build:MediumChemicalRefinery_Placeable', 'build:WindTurbineDirectional_Placeable', 'build:LargeWindtrap_Placeable', 'build:StorageContainer_Placeable',
  'build:MediumWaterCistern_Placeable',
  'item:T6RefinedResourceA', 'item:SteelBar', 'item:DuraluminumRod', 'item:CobaltBar', 'item:Silicone',
]

/**
 * Пошук, щоб додати ціль: предмети з рецептом і будівлі; без уже обраних; у фокусі з порожнім полем — основне.
 * З клавіатури — як список вибору: ↑ ↓ — підказка, Enter — додати, Esc — закрити. Додали — список закривається
 * (не закриває собою додане); далі набір чи ↓ відкриває знову
 */
function AddTarget({ ix, onAdd, exclude }: { ix: CatalogIndex; onAdd: (target: Target) => void; exclude: Set<string> }) {
  const uid = useId()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cur, setCur] = useState(-1)
  const ql = q.trim().toLowerCase()
  const hits = useMemo(() => {
    const all = searchable(ix).filter((h) => !exclude.has(h.key))
    if (ql.length < 2) {
      const by = new Map(all.map((h) => [h.key, h]))
      return SUGGEST.map((k) => by.get(k)).filter(Boolean) as Hit[]
    }
    const words = ql.split(/\s+/)
    return all.filter((h) => words.every((w) => h.text.includes(w))).slice(0, 14)
  }, [ix, ql, exclude])
  useEffect(() => setCur(-1), [ql])
  const add = (h: Hit) => { onAdd(h.target); setQ(''); setOpen(false); setCur(-1) }
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { if (open) { e.preventDefault(); setOpen(false) } else (e.currentTarget as HTMLElement).blur(); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); return }
      const d = e.key === 'ArrowDown' ? 1 : -1
      setCur((c) => (hits.length ? (c + d + hits.length) % hits.length : -1))
      return
    }
    if (e.key === 'Enter' && open && hits.length) { e.preventDefault(); add(hits[Math.max(0, cur)]) }
  }
  const shown = open && hits.length > 0
  return (
    <div className="relative">
      {/* type="text": у рідного «search» свій хрестик — поруч із хрестиком поля їх було два */}
      <SnInput
        type="text"
        enterkeyhint="search"
        size="md"
        clearable
        modelValue={q}
        placeholder={t('Додати предмет чи будівлю')}
        accessibilityLabel={t('Додати предмет чи будівлю')}
        role="combobox"
        aria-expanded={shown}
        aria-controls={`${uid}-list`}
        aria-activedescendant={shown && cur >= 0 ? `${uid}-${cur}` : undefined}
        aria-autocomplete="list"
        onInput={(e: Event) => { setQ(valueOf(e) ?? ''); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={key}
      />
      {shown && (
        <ul id={`${uid}-list`} role="listbox" aria-label={t('Що додати')} className="absolute inset-x-0 top-full z-20 mt-1 grid grid-cols-[minmax(0,1fr)] max-h-[50vh] overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-lg sm:grid-cols-2">
          {hits.map((h, i) => (
            <li key={h.key} id={`${uid}-${i}`} role="option" aria-selected={i === cur}>
              {/* mousedown без фокуса: поле не втрачає фокус, і список не закривається раніше за клік */}
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => add(h)} ref={(el) => { if (el && i === cur) el.scrollIntoView({ block: 'nearest' }) }} className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-panel2', i === cur && 'bg-panel2 ring-1 ring-spice/50')}>
                <Icon src={h.icon} size={28} grade={h.grade} />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[13px]">{h.name}</span>
                  {h.sub && <span className="block break-words text-[11px] text-muted">{h.sub}</span>}
                </span>
                <Plus size={14} className="shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const toQty = (v: unknown) => Math.max(1, Math.min(100000, Math.floor(Number(v) || 1)))
/**
 * чи це сировина, яку видобувають (руда, пісок, волокно), а не лут (сервоки, складні механізми — з ворогів і скринь):
 * клас RawResources з вікі; рослинне волокно й піщаний меланж вікі класу не дає
 */
const RAW = new Set(['PlantFiber', 'SpiceSand'])
const isRaw = (it: CItem | undefined) => !!it && (it.kind === 'RawResources' || RAW.has(it.id))
/** звідки взяти те, що не крафтиться: сировину — видобути, решту — лут (вороги, скрині) чи торговець */
function Source({ it }: { it: CItem | undefined }) {
  return isRaw(it)
    ? <><Pickaxe size={11} className="shrink-0" /><span className="truncate">{t('видобути')}</span></>
    : <><PackageSearch size={11} className="shrink-0" /><span className="truncate">{t('лут чи торговець')}</span></>
}

const POS: Forms = [t('позиція'), t('позиції'), t('позицій')]
const MAT: Forms = [t('матеріал'), t('матеріали'), t('матеріалів')]
const RES: Forms = [t('ресурс'), t('ресурси'), t('ресурсів')]
const CRAFT: Forms = [t('крафт'), t('крафти'), t('крафтів')]
const SIZE: Record<number, string> = { 1: t('малий'), 2: t('середній'), 3: t('великий') }
const STATION: Forms = [t('станція'), t('станції'), t('станцій')]
const STEP: Forms = [t('крок'), t('кроки'), t('кроків')]

/** назва родини з розміром: «переробник руди — великий» */
const sizeOf = (name: string, tier: number) => t('{name} — {size}', { name: lower(name), size: SIZE[tier] })

/**
 * Назва родини станцій без розміру («Переробник руди»): з назв усіх її станцій мовою сайту лишається спільне
 * (слова, а в мовах без пробілів — спільний початок чи кінець); станція одна — знімаємо слово розміру
 */
const SIZE_WORDS = ['Small', 'Medium', 'Large', 'Advanced', t('Малий'), t('Середній'), t('Великий'), t('Розширений')]
function familyName(names: string[], single: string): string {
  const words = names.map((x) => x.trim().split(/\s+/))
  if (names.length > 1 && words.every((w) => w.length > 1)) {
    const rest = words.slice(1).map((w) => new Set(w.map((x) => x.toLowerCase())))
    const common = words[0].filter((w) => rest.every((r) => r.has(w.toLowerCase())))
    if (common.length && common.length < words[0].length) return common.join(' ')
  } else if (names.length > 1) {
    // назви без пробілів (китайська, японська, корейська): спільний початок чи кінець
    const [a, ...others] = names
    let pre = 0
    while (pre < a.length && others.every((x) => x[pre] === a[pre])) pre++
    let suf = 0
    while (suf < a.length && others.every((x) => x[x.length - 1 - suf] === a[a.length - 1 - suf])) suf++
    const n = Math.max(pre, suf)
    if (n >= 2 && n < a.length) return (pre >= suf ? a.slice(0, pre) : a.slice(a.length - suf)).trim()
  }
  const w = SIZE_WORDS.find((x) => x && single.toLowerCase().startsWith(x.toLowerCase()) && (/\s/.test(single.charAt(x.length)) || /[\u3000-\u9fff\uac00-\ud7af]/.test(x)))
  return w ? single.slice(w.length).trim() : single
}

type StageKey = 'goal' | 'stations' | 'need' | 'gather' | 'trips' | 'process'
/** sum — головне число етапу, unit — слово до нього (у тісних вкладках ховається, повністю — у підказці) */
interface Stage { key: StageKey; title: string; sum: string; unit?: string; hint: string; off: boolean }

/**
 * Маршрут етапів: номер, назва й головне число кожного; клік (чи ← →) відкриває етап. Вигляд — за шириною самої
 * вкладки, а не екрана: шість етапів бази тісні й на широкому екрані — тоді номер над назвою; на телефоні — ще й
 * без слова до числа
 */
function Route({ stages, active, onPick, uid }: { stages: Stage[]; active: StageKey; onPick: (k: StageKey) => void; uid: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    setWidth(el.clientWidth) // одразу, до першого малювання
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // в один ряд — коли кожному етапу вистачає місця на назву; інакше (телефон) — у два ряди, порівну
  const n = stages.length
  const rows = width && width / n < 92 ? Math.ceil(n / Math.max(2, Math.floor(width / 96))) : 1
  const cols = Math.ceil(n / rows)
  const per = width / cols
  const roomy = per >= 150
  // слово до числа — коли влазить хоч частково (на телефоні — ні)
  const unit = per >= 100
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    for (let j = i + d; j >= 0 && j < stages.length; j += d)
      if (!stages[j].off) { onPick(stages[j].key); refs.current[j]?.focus(); return }
  }
  return (
    <div ref={box} role="tablist" aria-label={t('Етапи розрахунку')} className={cn('grid', roomy ? 'gap-2' : 'gap-1')} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {stages.map((s, i) => {
        const on = s.key === active
        return (
          <button
            key={s.key}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="tab"
            id={`${uid}-tab-${s.key}`}
            aria-selected={on}
            aria-controls={`${uid}-panel`}
            tabIndex={on ? 0 : -1}
            disabled={s.off}
            title={s.hint || undefined}
            onClick={() => onPick(s.key)}
            onKeyDown={(e) => move(e, i)}
            className={cn(
              'group min-w-0 rounded-lg border text-left transition-colors disabled:cursor-default',
              roomy ? 'flex items-center gap-2.5 px-3 py-2.5' : 'grid justify-items-start gap-1 px-1.5 py-2',
              on ? 'border-spice/60 bg-spice/10' : s.off ? 'border-line/60 opacity-50' : 'border-line bg-panel2/40 hover:border-spice/40 hover:bg-panel2/80',
            )}
          >
            <span
              className={cn(
                'grid shrink-0 place-items-center rounded-full font-display font-bold',
                roomy ? 'h-7 w-7 text-[12px]' : 'h-5 w-5 text-[10.5px]',
                on ? 'bg-spice text-panel' : 'bg-panel text-muted ring-1 ring-line group-hover:text-ink',
              )}
            >
              {i + 1}
            </span>
            <span className="grid w-full min-w-0">
              <span className={cn('break-words font-semibold', roomy ? 'font-display text-[13px]' : 'text-[12px]', on ? 'text-ink' : 'text-muted group-hover:text-ink')}>{s.title}</span>
              <span className={cn('break-words text-[11.5px] tabular-nums', on ? 'text-spice' : 'text-muted')}>
                {s.sum}
                {s.unit && unit && ` ${s.unit}`}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Картка станції: назва, крафти, час черги (чи дія — «Вибрати»), смужка відносно найдовшої; нижче — що на ній
 * робиться: предмет, скільки, з якої сировини, за скільки. alt — варіант на вибір (пунктир, притишено)
 */
function StationCard({ ix, id, steps, time, crafts, water, longest, directIds, open, alt, action, foot }: {
  ix: CatalogIndex
  id: string
  steps: Step[]
  time: number
  crafts: number
  water: number
  longest: number
  directIds: Set<string>
  open: Open
  alt?: boolean
  action?: React.ReactNode
  foot?: React.ReactNode
}) {
  const pl = ix.place.get(id)
  const title = pl ? nameOf(pl) : id || t('Вручну')
  return (
    <section aria-label={alt ? t('{name} — на вибір', { name: title }) : title} className={cn('space-y-2 rounded-lg border p-2', alt ? 'border-dashed border-line bg-panel2/20' : 'border-line/80')}>
      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Icon src={pl ? iconUrl(pl.icon) : null} size={32} grade={pl?.grade} />
          <span className={cn('min-w-0 flex-1', alt && 'opacity-80')}>
            {pl ? (
              <button type="button" onClick={() => open('place', id)} className="block max-w-full break-words text-left text-[13px] font-semibold hover:text-spice">{nameOf(pl)}</button>
            ) : (
              <span className="block break-words text-[13px] font-semibold">{title}</span>
            )}
            <span className="block break-words text-[11.5px] text-muted">
              {plural(crafts, CRAFT)}{water > 0 && ` · ${t('{water} води', { water: fmtWater(water) })}`}
            </span>
          </span>
          {action ?? <b className="shrink-0 font-mono text-[15px] font-semibold tabular-nums">{fmtTime(time)}</b>}
        </div>
        {/* довжина черги відносно найдовшої */}
        <div className="h-1 overflow-hidden rounded-full bg-panel2" aria-hidden>
          <div className={cn('h-full rounded-full', alt ? 'bg-line' : 'bg-spice/70')} style={{ width: `${Math.min(100, Math.max(2, (time / (longest || 1)) * 100))}%` }} />
        </div>
      </header>
      <ol className="space-y-1">
        {steps.map((s) => {
          const goal = directIds.has(s.item)
          // побічний вихід рецепта (залишки спайсу) — тут же: його окремо не крафтять
          const out = ix.item.get(s.item)
          return (
            <li key={s.item} className={cn('space-y-0.5 rounded-md px-1.5 py-1', alt ? 'bg-panel2/30' : goal ? 'bg-spice/10' : 'bg-panel2/50')}>
              <div className="flex items-center gap-2">
                <Icon src={out ? iconUrl(out.icon) : null} size={26} grade={out?.grade} />
                <button type="button" onClick={() => out && open('item', s.item)} className={cn('min-w-0 flex-1 break-words text-left text-[13px] hover:text-spice', alt && 'text-ink/80')}>{nameOf(out, s.item)}</button>
                {goal && !alt && <span className="shrink-0 rounded bg-spice/15 px-1.5 text-[10.5px] font-semibold text-spice">{t('потрібно')}</span>}
                <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums">{fmtN(s.qty)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-[34px] text-[11.5px] text-muted">
                {t('з')}
                {s.inputs.map(([iid, q], k) => (
                  <span key={iid} className="inline-flex min-w-0 items-center gap-1.5">
                    {k > 0 && '+'}
                    <button type="button" onClick={() => ix.item.has(iid) && open('item', iid)} className="inline-flex min-w-0 items-center gap-1 hover:text-spice">
                      <Icon src={iconUrl(ix.item.get(iid)?.icon ?? null)} size={16} />
                      <b className="font-mono font-semibold tabular-nums text-ink">{fmtN(q)}</b>
                      <span className="min-w-0 break-words">{nameOf(ix.item.get(iid), iid)}</span>
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[34px] text-[11.5px] text-muted">
                <span className="inline-flex items-center gap-1"><Timer size={12} /> {fmtTime(s.time)}</span>
                <span>{plural(s.crafts, CRAFT)}</span>
                {s.water > 0 && <span className="inline-flex items-center gap-1"><Droplet size={12} /> {fmtWater(s.water)}</span>}
                {s.by.length > 0 && <span>{t('а ще: {list}', { list: s.by.map(([id, q]) => `${fmtN(q)} ${lower(nameOf(ix.item.get(id), id))}`).join(', ') })}</span>}
              </div>
            </li>
          )
        })}
      </ol>
      {foot}
    </section>
  )
}

/** до якої групи цілей належить: будівельні деталі, пристрої чи предмети */
function groupOf(ix: CatalogIndex, tg: Target): 0 | 1 | 2 {
  if (tg.kind === 'item' || tg.id === 'fuel') return 2
  const b = tg.kind === 'build' ? findBuild(ix, tg.id) : tg.ref ? findBuild(ix, tg.ref) : null
  return tg.id.startsWith('row:') || (b && !isDevice(b)) ? 0 : 1
}
const GROUPS = [t('Будівельні деталі'), t('Пристрої'), t('Предмети')]

export function ProdCalc({
  ix,
  targets,
  onTargets,
  dd,
  onDd,
  stations: given,
  onStations,
  onResult,
  decree: fixed,
  onDecree,
  open,
}: {
  ix: CatalogIndex
  /** цілі з кількістю */
  targets: Target[]
  /** новий список цілей: додали, прибрали, змінили кількість */
  onTargets: (next: Target[]) => void
  /** знижка Глибокої пустелі: задати ззовні (база пам'ятає свій вибір); без цього — власний перемикач */
  dd?: boolean
  onDd?: (v: boolean) => void
  /** станції за родинами — задати ззовні (у збереженого розрахунку свої); без цього — спільний вибір (calc:stations) */
  stations?: Record<string, number>
  onStations?: (v: Record<string, number>) => void
  /** розрахунок після кожної зміни — щоб його зберегти (рецепти, підсумок) */
  onResult?: (r: CalcResult) => void
  /** указ збереженого розрахунку (null — без указу); не задано — указ тижня з головної з вмикачем */
  decree?: DecreeId | null
  /** з яким указом зараз рахуємо — щоб зберегти його з розрахунком */
  onDecree?: (d: DecreeId | null) => void
  open: Open
}) {
  const uid = useId()
  const week = useDecree((s) => s.id)
  // станції за родинами (переробник руди — великий, хімічний — середній…): пам'ятається для всіх розрахунків —
  // які станції в тебе є; рецепти виходять з них (pickStations)
  const [choiceOwn, setChoiceOwn] = useState<Record<string, number>>(() => prefGet('calc:stations', {}))
  const choice = given ?? choiceOwn
  const setChoice = (fam: string, T: number) => {
    const next = { ...choice, [fam]: T }
    if (onStations) return onStations(next)
    setChoiceOwn(next)
    prefSet('calc:stations', next)
  }
  const pick = useMemo(() => pickStations(ix, ix.makes.keys(), choice), [ix, choice])
  const [ddOwn, setDdOwn] = useState(false)
  const ddOn = dd ?? ddOwn
  const setDd = onDd ?? setDdOwn
  // указ тижня — з головної; тут його можна вимкнути, щоб порахувати без нього (пам'ятається для всіх розрахунків)
  const [decreeOn, setDecreeOnState] = useState(() => prefGet('calc:decree', true))
  const setDecreeOn = (v: boolean) => { setDecreeOnState(v); prefSet('calc:decree', v) }
  // указ, з яким рахуємо: збереженого розрахунку — його власний; інакше — тижня (якщо не вимкнено)
  const decree = fixed !== undefined ? fixed : decreeOn ? week : null
  const fx = useMemo(() => decreeFx(decree), [decree])
  const res = useMemo(() => calc(ix, targets, fx, pick, ddOn), [ix, targets, fx, pick, ddOn])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onResult?.(res) }, [res])
  // зберігати — лише указ, що міняє числа
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onDecree?.(fx.production || fx.refining ? decree : null) }, [decree])
  // «потрібно» — окремий етап, коли є будівлі: тоді це не те саме, що цілі
  const hasBuilds = targets.some((x) => x.kind !== 'item')
  /** що потрібно безпосередньо (цілі й вартість будівель) — у переробці позначаємо як «потрібно» */
  const directIds = useMemo(() => new Set(res.direct.map(([id]) => id)), [res])
  const made = useMemo(() => new Map(res.steps.map((s) => [s.item, s])), [res])
  const placeName = (p: string | undefined) => (p ? nameOf(ix.place.get(p), p) : t('Вручну'))
  const trips = useTrips(ix, res.raw, res.direct)
  // «Показати всі» на кроці «Станції»: і ті станції того самого виду, що тут нічого не зроблять (заблоковані)
  const [allSt, setAllStState] = useState(() => prefGet('calc:allStations', false))
  const setAllSt = (v: boolean) => { setAllStState(v); prefSet('calc:allStations', v) }

  /**
   * Родини станцій із вибором розміру (переробник руди: малий, середній, великий…) — для кроку «Станції». Для кожного
   * розміру — що зробить ця станція, з якої сировини, за скільки, і як зміниться сировина разом (порівняно з вибраним);
   * предмети, яких цей розмір не робить, лишаються на найближчому (волокно стравідію — лише середній хімічний).
   * locked — решта станцій того самого виду з гри (kinOf), що не роблять жодного предмета родини: для «Показати всі»
   */
  const famBase = useMemo(() => {
    const fams = new Map<string, Map<number, string>>() // родина → розмір → станція
    const add = (f: string, T: number, at: string) => { if (!fams.has(f)) fams.set(f, new Map()); fams.get(f)!.set(T, at) }
    for (const s of res.steps) {
      // кожна станція ланцюжка — і та, де варіант один (волокно — лише середній хімічний; фабрикатори)
      if (s.recipe.at[0]) add(familyOf(ix, s.recipe.at[0]), stationTier(ix, s.recipe.at[0]), s.recipe.at[0])
      for (const r of ix.makes.get(s.item) ?? []) {
        const T = stationTier(ix, r.at[0])
        if (T) add(familyOf(ix, r.at[0]), T, r.at[0])
      }
    }
    return [...fams]
      .map(([fam, m]) => {
        const tiers = [...m.keys()].sort((a, b) => b - a)
        const want = choice[fam] ?? tiers[0]
        const chosen = [...tiers].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || b - a)[0]
        const famItems = new Set(
          res.steps
            .filter((x) => (tiers[0] ? (ix.makes.get(x.item) ?? []).some((r) => familyOf(ix, r.at[0]) === fam && stationTier(ix, r.at[0])) : x.recipe.at[0] === m.get(0)))
            .map((x) => x.item),
        )
        const first = ix.place.get(m.get(tiers[tiers.length - 1])!)
        // назва родини — без розміру: «Переробник руди», «Хімічний переробник», «Фабрикатор виживання»
        const name = familyName(tiers.length > 1 ? [...tiers].reverse().map((T) => nameOf(ix.place.get(m.get(T)!), fam)) : [], nameOf(first, fam) || fam)
        const depth = Math.min(...res.steps.filter((x) => famItems.has(x.item)).map((x) => x.depth))
        return { fam, m, name: name.charAt(0).toLocaleUpperCase(locale()) + name.slice(1), tiers, chosen, famItems, items: [...famItems], depth, multi: tiers.length > 1 }
      })
      .filter((f) => f.items.length)
      .sort((a, b) => a.depth - b.depth || Number(b.multi) - Number(a.multi))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ix, res, choice])
  const lockedOf = (f: (typeof famBase)[number]) => {
    const have = new Set(f.m.values())
    return kinOf(ix, f.m.get(f.tiers[0])!)
      .filter((p) => !have.has(p))
      .map((p) => ({ station: p, T: stationTier(ix, p), missing: f.items.filter((id) => !(ix.makes.get(id) ?? []).some((r) => r.at.includes(p))) }))
      // робить усе те саме (спільний рецепт двох фабрикаторів) — це не «недоступна», просто не показуємо
      .filter((x) => x.missing.length)
      .sort((a, b) => b.T - a.T)
  }

  /** переробка за станціями: від тих, що беруть сировину, до фінальних; час — якщо станція кожного типу одна */
  const stations = useMemo(() => {
    const by = new Map<string, Step[]>()
    for (const s of res.steps) {
      const k = s.recipe.at[0] ?? ''
      by.set(k, [...(by.get(k) ?? []), s])
    }
    return [...by]
      .map(([id, steps]) => ({
        id,
        steps,
        time: steps.reduce((x, s) => x + s.time, 0),
        crafts: steps.reduce((x, s) => x + s.crafts, 0),
        water: steps.reduce((x, s) => x + s.water, 0),
        depth: Math.min(...steps.map((s) => s.depth)),
      }))
      .sort((a, b) => a.depth - b.depth || b.time - a.time)
  }, [res])
  const slowest = stations.reduce<(typeof stations)[number] | null>((m, s) => (!m || s.time > m.time ? s : m), null)


  // ---------- етапи ----------
  // (картки розмірів станцій — повний розрахунок на кожен розмір — лише коли відкрито крок «Станції», нижче)
  const empty = !res.direct.length
  const multiFams = famBase.filter((f) => f.multi)
  const sizes = multiFams.map((f) => sizeOf(f.name, f.chosen)).join(', ')
  const stages: Stage[] = [
    { key: 'goal', title: t('Ціль'), sum: fmtN(targets.length), unit: word(targets.length, POS), hint: t('Що будуємо і скільки'), off: false },
    ...(famBase.length
      ? [{
          key: 'stations' as const,
          title: t('Станції'),
          sum: fmtN(famBase.length),
          unit: word(famBase.length, STATION),
          hint: multiFams.length ? t('Станції ланцюжка; розмір: {sizes}', { sizes }) : t('Станції ланцюжка'),
          off: false,
        }]
      : []),
    ...(hasBuilds ? [{ key: 'need' as const, title: t('Потрібно'), sum: empty ? '—' : fmtN(res.direct.length), unit: empty ? '' : word(res.direct.length, MAT), hint: t('Матеріали на будівництво — разом за всіма цілями'), off: empty }] : []),
    {
      key: 'gather',
      title: t('Видобути'),
      sum: res.raw.length ? fmtN(res.raw.length) : '—',
      unit: res.raw.length ? (res.water > 0 ? t('{res} + {water} води', { res: word(res.raw.length, RES), water: fmtWater(res.water) }) : word(res.raw.length, RES)) : '',
      hint: res.raw.length ? (res.water > 0 ? t('Сировина, яку треба видобути; ще {water} води на крафти', { water: fmtWater(res.water) }) : t('Сировина, яку треба видобути')) : '',
      off: !res.raw.length,
    },
    {
      key: 'trips',
      title: t('Рейси'),
      sum: trips.trip.n ? fmtN(trips.trip.n) : '—',
      unit: trips.trip.n ? word(trips.trip.n, TRIP) : '',
      hint: trips.trip.n
        ? trips.what === 'raw'
          ? t('{vehicle}: {trips} (сировина)', { vehicle: trips.h.name, trips: plural(trips.trip.n, TRIP) })
          : t('{vehicle}: {trips} (готове)', { vehicle: trips.h.name, trips: plural(trips.trip.n, TRIP) })
        : t('Скільки рейсів довезти вибраною технікою'),
      off: !trips.any,
    },
    {
      key: 'process',
      title: t('Переробка'),
      sum: slowest ? fmtTime(slowest.time) : '—',
      hint: slowest ? t('Найдовша черга — {station}; усього {stations}', { station: placeName(slowest.id), stations: plural(stations.length, STATION) }) : '',
      off: !res.steps.length,
    },
  ]
  // відкритий етап — в адресі (?step=), без неї — перший (посилання без етапу завжди відкриває початок)
  const STAGES: StageKey[] = ['goal', 'stations', 'need', 'gather', 'trips', 'process']
  const [want, setWant] = useUrlParam<StageKey>('step', 'goal', (v) => STAGES.includes(v as StageKey))
  const ready = stages.filter((s) => !s.off)
  const active = ready.find((s) => s.key === want)?.key ?? ready[0]?.key ?? stages[0].key
  const pickStage = (k: StageKey) => setWant(k)

  const families = useMemo(() => {
    if (active !== 'stations') return []
    const cur = new Map(res.raw)
    return famBase.map((f) => {
        const { fam, m, tiers, chosen, famItems } = f
        const options = tiers.map((T) => {
          const r = T === chosen ? res : calc(ix, targets, fx, pickStations(ix, ix.makes.keys(), { ...choice, [fam]: T }), ddOn)
          const station = m.get(T)!
          const steps = r.steps.filter((x) => x.recipe.at[0] === station)
          const here = new Set(steps.map((x) => x.item))
          const raw = new Map(r.raw)
          const delta = [...new Set([...raw.keys(), ...cur.keys()])].map((id) => [id, (raw.get(id) ?? 0) - (cur.get(id) ?? 0)] as [string, number]).filter(([, d]) => d !== 0)
          return {
            /** різниця води з вибраним, мл */
            dWater: Math.round(r.water - res.water),
            T,
            station,
            steps,
            time: steps.reduce((n, x) => n + x.time, 0),
            crafts: steps.reduce((n, x) => n + x.crafts, 0),
            water: steps.reduce((n, x) => n + x.water, 0),
            delta,
            /** предмети родини, яких ця станція не робить (лишаються на іншій) */
            elsewhere: [...famItems].filter((id) => !here.has(id)),
          }
        })
        return { ...f, options, locked: lockedOf(f) }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, famBase, targets, fx, ddOn, res, choice])

  const lockedN = families.reduce((n, f) => n + f.locked.length, 0)

  /** як показати ціль: назва, підпис, іконка */
  const view = (tg: Target) => {
    const it = tg.kind === 'item' ? ix.item.get(tg.id) : null
    const b = tg.kind === 'build' ? findBuild(ix, tg.id) : null
    return {
      name: it ? nameOf(it) : b ? buildName(b) : tg.name ?? tg.id,
      // для будівлі з власною ціною — ціна за штуку: «37,5 Гранітний камінь»
      sub: b
        ? setLabel(b.set)
        : tg.kind === 'custom'
          ? tg.cost?.length
            ? t('{cost} за шт.', { cost: tg.cost.map(([id, q]) => `${q.toLocaleString(locale(), { maximumFractionDigits: 2 })} ${nameOf(ix.item.get(id), id)}`).join(' + ') })
            : t('без ціни — лише ліміти')
          : it?.loc ? it.name : '',
      icon: it ? iconUrl(it.icon) : b ? wikiImg(b.img) : tg.icon ?? null,
      grade: it?.grade,
    }
  }

  /** куди веде ціль у довіднику: предмет, будівля (пристрій — його карткою) чи запис, заданий базою */
  const linkOf = (tg: Target): (() => void) | null => {
    if (tg.kind === 'item') return () => open('item', tg.id)
    const key = tg.kind === 'build' ? tg.id : tg.ref
    if (key) return () => openBuild(ix, key)
    const see = tg.see ?? (tg.id === 'fuel' && tg.cost?.[0] ? (['item', tg.cost[0][0]] as const) : null)
    return see ? () => open(see[0], see[1]) : null
  }

  // що вже обрано — і самі цілі, і будівлі довідника, яким відповідають цілі бази (ref)
  const exclude = useMemo(() => new Set(targets.flatMap((x) => [`${x.kind}:${x.id}`, ...(x.ref ? ['build:' + x.ref] : [])])), [targets])

  const groups = useMemo(() => {
    const g: { tg: Target; i: number }[][] = [[], [], []]
    targets.forEach((tg, i) => g[groupOf(ix, tg)].push({ tg, i }))
    return g.map((ts, k) => ({ label: GROUPS[k], ts })).filter((x) => x.ts.length)
  }, [ix, targets])
  const topRaw = res.raw[0]?.[1] || 1
  const topNeed = Math.max(1, ...res.direct.map(([, q]) => q))
  const longest = slowest?.time || 1

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <DecreeLine on={decreeOn} onChange={setDecreeOn} fixed={fixed} />
        <button
          type="button"
          role="switch"
          aria-checked={ddOn}
          onClick={() => setDd(!ddOn)}
          title={t('Будівництво в Глибокій пустелі коштує вдвічі менше; на предмети й паливо не діє')}
          className={cn('inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors', ddOn ? 'bg-spice/15 text-spice' : 'bg-panel2/50 text-muted hover:text-ink')}
        >
          <Knob on={ddOn} />
          {t('Знижка Глибокої пустелі −50%')}
        </button>
      </div>

      <Route stages={stages} active={active} onPick={pickStage} uid={uid} />

      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${active}`} className="min-w-0">
        {active === 'goal' && (
          <div className="grid gap-3">
            <AddTarget
              ix={ix}
              exclude={exclude}
              onAdd={(target) => {
                const k = targets.findIndex((x) => x.kind === target.kind && x.id === target.id)
                onTargets(k < 0 ? [...targets, target] : targets.map((x, j) => (j === k ? { ...x, qty: x.qty + 1 } : x)))
              }}
            />
            {!targets.length && (
              <Empty icon={Calculator} title={t('Додай, що хочеш зробити')} description={t('Знайди предмет чи будівлю — калькулятор порахує, що видобути, що й де переробити і скільки часу це займе.')} framed={false} />
            )}
            {groups.map((g) => (
              <div key={g.label} className="grid gap-1">
                {groups.length > 1 && (
                  <h4 className="text-[12px] font-semibold text-muted">
                    {g.label} <span className="font-mono font-normal">{g.ts.length}</span>
                  </h4>
                )}
                <ul className="grid gap-x-4 gap-y-0.5" style={cols(340)}>
                  {g.ts.map(({ tg, i }) => {
                    const v = view(tg)
                    const go = linkOf(tg)
                    return (
                      <li key={tg.kind + tg.id} className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 hover:bg-panel2/50">
                        {/* назва — повністю (до двох рядків) і веде в довідник */}
                        {go ? (
                          <button type="button" onClick={go} title={t('{name} — відкрити в довіднику', { name: v.name })} className="group flex min-w-0 flex-1 items-center gap-2 text-left">
                            <Icon src={v.icon} size={28} grade={v.grade} />
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 text-[13px] leading-tight underline-offset-2 group-hover:text-spice group-hover:underline">{v.name}</span>
                              {v.sub && <span className="block break-words text-[11px] leading-tight text-muted" title={v.sub}>{v.sub}</span>}
                            </span>
                          </button>
                        ) : (
                          <span className="flex min-w-0 flex-1 items-center gap-2" title={v.name}>
                            <Icon src={v.icon} size={28} grade={v.grade} />
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 text-[13px] leading-tight">{v.name}</span>
                              {v.sub && <span className="block break-words text-[11px] leading-tight text-muted" title={v.sub}>{v.sub}</span>}
                            </span>
                          </span>
                        )}
                        <div className="w-[4.5rem] shrink-0">
                          <SnNumberField
                            className="[&::part(input)]:border-x-0"
                            controls="none"
                            min={1}
                            max={100000}
                            modelValue={tg.qty}
                            accessibilityLabel={t('Кількість: {name}', { name: v.name })}
                            onChange={(e: Event) => { const q = toQty(valueOf(e)); if (q !== tg.qty) onTargets(targets.map((x, j) => (j === i ? { ...x, qty: q } : x))) }}
                          />
                        </div>
                        <button type="button" aria-label={t('Прибрати: {name}', { name: v.name })} onClick={() => onTargets(targets.filter((_, j) => j !== i))} className="grid h-7 w-6 shrink-0 place-items-center rounded-md text-muted hover:text-ink">
                          <Trash2 size={13} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        {active === 'need' && (
          <ul className="grid gap-x-4 gap-y-0.5" style={cols(260)}>
            {[...res.direct].sort((a, b) => b[1] - a[1]).map(([id, q]) => {
              const s = made.get(id)
              return (
                <Line
                  key={id}
                  ix={ix}
                  id={id}
                  qty={fmtN(q)}
                  share={q / topNeed}
                  open={open}
                  sub={s ? <><Hammer size={11} className="shrink-0" /><span className="truncate">{placeName(s.recipe.at[0])}</span></> : <Source it={ix.item.get(id)} />}
                />
              )
            })}
          </ul>
        )}

        {active === 'gather' && (
          <div className="grid gap-2">
            <ul className="grid gap-x-4 gap-y-0.5" style={cols(260)}>
              {res.water > 0 && (
                // вода — теж сировина (її треба назбирати: вітропастки, роса, кров), тож у тому самому списку
                <li>
                  <span className="flex w-full items-center gap-2 rounded-md px-1 py-1" title={fx.production ? t('Вода на всі крафти — з указом тижня') : t('Вода на всі крафти')}>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-sky-500/15"><Droplet size={16} className="text-sky-600 dark:text-sky-400" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[13px] leading-tight">{t('Вода')}</span>
                      <span className="mt-0.5 block text-[11px] leading-tight text-muted">{t('на крафти, {steps}', { steps: plural(res.steps.filter((x) => x.water > 0).length, STEP) })}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums">{fmtWater(res.water)}</span>
                  </span>
                </li>
              )}
              {res.raw.map(([id, q]) => <Line key={id} ix={ix} id={id} qty={fmtN(q)} share={q / topRaw} open={open} sub={isRaw(ix.item.get(id)) ? undefined : <Source it={ix.item.get(id)} />} />)}
            </ul>
            {multiFams.length > 0 && (
              <p className="px-1 text-[12px] text-muted">
                <T
                  text="Сировина — для станцій з кроку {link}: {sizes}. На більших — менше сировини й швидше."
                  link={<button type="button" onClick={() => pickStage('stations')} className="underline underline-offset-2 hover:text-spice">{t('«Станції»')}</button>}
                  sizes={sizes}
                />
              </p>
            )}
          </div>
        )}

        {active === 'trips' && (
          <Trips ix={ix} trips={trips} open={open} goods={targets.every((x) => x.kind === 'item') ? 'items' : hasBuilds && targets.some((x) => x.kind === 'item') ? 'mixed' : 'builds'} />
        )}

        {active === 'process' && (
          <div className="grid gap-2">
            <div className="gap-2" style={{ columnWidth: 380 }}>
              {stations.map((st) => (
                <div key={st.id} className="mb-2 break-inside-avoid">
                  <StationCard ix={ix} id={st.id} steps={st.steps} time={st.time} crafts={st.crafts} water={st.water} longest={longest} directIds={directIds} open={open} />
                </div>
              ))}
            </div>
            {res.spare.length > 0 && (
              <p className="-mt-1 text-[12px] text-muted">
                {t('Побічно лишиться: {list}.', { list: res.spare.map(([id, q]) => `${fmtN(q)} ${lower(nameOf(ix.item.get(id), id))}`).join(', ') })}
              </p>
            )}
            <p className="-mt-1 text-[12px] text-muted">
              {t('Час — на одну станцію кожного типу: дві однакові впораються вдвічі швидше.')}
              {multiFams.length > 0 && (
                <>
                  {' '}
                  <T
                    text="Інший розмір переробника — на кроці {link}."
                    link={<button type="button" onClick={() => pickStage('stations')} className="underline underline-offset-2 hover:text-spice">{t('«Станції»')}</button>}
                  />
                </>
              )}
            </p>
          </div>
        )}

        {active === 'stations' && (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <p className="min-w-0 flex-[1_1_20rem] text-[12.5px] text-muted">{t("Станції, на яких це робиться. Де є кілька розмірів — вибери свій: на більших менше сировини й швидше. Вибір запам'ятовується для всіх розрахунків.")}</p>
              {lockedN > 0 && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={allSt}
                  onClick={() => setAllSt(!allSt)}
                  title={t('Додати решту станцій того самого виду з гри — ті, що тут нічого не зроблять, заблоковані з причиною')}
                  className={cn('inline-flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors', allSt ? 'bg-spice/15 text-spice' : 'bg-panel2/50 text-muted hover:text-ink')}
                >
                  <Knob on={allSt} />
                  {t('Показати всі')}
                  <span className="font-mono text-[11px] opacity-80">+{lockedN}</span>
                </button>
              )}
            </div>
            {families.map((f) => (
              <section key={f.fam} className="grid gap-1.5">
                <h4 className="text-[13px] font-semibold">
                  {f.name}
                  <span className="ml-1.5 font-normal text-muted">· {f.items.map((id) => nameOf(ix.item.get(id), id)).join(', ')}</span>
                </h4>
                {/* вибір — кліком по картці, як радіокнопка; стрілки — сусідній розмір */}
                <div role="radiogroup" aria-label={f.name} className="grid gap-2" style={cols(230)}>
                  {f.options.map((o, k) => {
                    const on = o.T === f.chosen
                    const pl = ix.place.get(o.station)
                    const go = (d: number) => { const n = f.options[(k + d + f.options.length) % f.options.length]; setChoice(f.fam, n.T) }
                    return (
                      <button
                        key={o.T}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        tabIndex={on ? 0 : -1}
                        onClick={() => { if (f.multi) setChoice(f.fam, o.T) }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(1) }
                          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(-1) }
                        }}
                        title={o.elsewhere.length ? t('Не робить: {items} — лишиться на іншому розмірі', { items: o.elsewhere.map((id) => nameOf(ix.item.get(id), id)).join(', ') }) : undefined}
                        className={cn(
                          'relative flex items-center gap-3 rounded-lg border p-2.5 pr-8 text-left transition-colors',
                          on ? 'border-spice bg-spice/10 ring-1 ring-spice/40' : 'border-line bg-panel2/30 hover:border-spice/50 hover:bg-panel2/60',
                          !f.multi && 'cursor-default',
                        )}
                      >
                        <Icon src={pl ? iconUrl(pl.icon) : null} size={52} grade={pl?.grade} />
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="text-[13px] font-semibold leading-tight">{nameOf(pl, o.station)}</span>
                          <span className="inline-flex items-center gap-1 text-[12px] text-muted"><Timer size={12} /> {fmtTime(o.time)}</span>
                          <span className="text-[11.5px] leading-snug">
                            {on ? (
                              <span className="text-spice">{t('вибрано')}</span>
                            ) : o.delta.length ? (
                              // коротко: найбільша різниця сировини з вибраним
                              (() => {
                                const [id, d] = [...o.delta].sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0]
                                return (
                                  <span className={d > 0 ? 'text-bad' : 'text-ok'}>
                                    {d > 0 ? '+' : '−'}{fmtN(Math.abs(d))} {lower(nameOf(ix.item.get(id), id))}
                                    {o.delta.length > 1 && <span className="text-muted"> {t('і ще {n}', { n: o.delta.length - 1 })}</span>}
                                  </span>
                                )
                              })()
                            ) : (
                              <span className="text-muted">{t('сировини стільки ж')}</span>
                            )}
                          </span>
                          {!on && o.dWater !== 0 && (
                            <span className={cn('inline-flex items-center gap-1 text-[11.5px]', o.dWater > 0 ? 'text-bad' : 'text-ok')}>
                              <Droplet size={11} /> {t('{water} води', { water: (o.dWater > 0 ? '+' : '−') + fmtWater(Math.abs(o.dWater)) })}
                            </span>
                          )}
                          {o.elsewhere.length > 0 && <span className="text-[11px] text-muted">{t('не робить {n} з {total}', { n: o.elsewhere.length, total: f.items.length })}</span>}
                        </span>
                        {/* радіо-кружок */}
                        <span className={cn('absolute right-2.5 top-2.5 grid h-4 w-4 place-items-center rounded-full border-2', on ? 'border-spice' : 'border-line')} aria-hidden>
                          {on && <span className="h-2 w-2 rounded-full bg-spice" />}
                        </span>
                      </button>
                    )
                  })}
                  {allSt &&
                    f.locked.map((o) => {
                      const pl = ix.place.get(o.station)
                      const why = t('Не робить: {items}', { items: o.missing.map((id) => nameOf(ix.item.get(id), id)).join(', ') })
                      return (
                        <div
                          key={o.station}
                          role="radio"
                          aria-checked={false}
                          aria-disabled
                          title={why}
                          className="relative flex cursor-not-allowed items-center gap-3 rounded-lg border border-dashed border-line/80 p-2.5 pr-8 text-left"
                        >
                          <span className="opacity-45 grayscale">
                            <Icon src={pl ? iconUrl(pl.icon) : null} size={52} grade={pl?.grade} />
                          </span>
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className="text-[13px] font-semibold leading-tight text-muted">{nameOf(pl, o.station)}</span>
                            <span className="text-[11.5px] leading-snug text-muted">{why}</span>
                          </span>
                          <Lock size={14} className="absolute right-2.5 top-2.5 text-muted" aria-hidden />
                        </div>
                      )
                    })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

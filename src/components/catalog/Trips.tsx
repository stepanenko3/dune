/**
 * Рейси: скільки разів довезти вибраною технікою сировину з поля (на переробку) чи готове — те, що виходить із
 * переробки й крафту: цілі-предмети (злитки, деталі) чи матеріали на будову для цілей-будівель; назва кнопки — за
 * цілями, а під нею видно, що саме у вантажі. Вантаж міряють
 * двома межами, як у грі: об'єм (об'єм предмета з довідника × кількість) і слоти (стос — до 500 штук на слот):
 * важка руда впирається в об'єм, легке — у слоти. Місткість техніки — таблиця HAULERS (гра її в даних предметів не
 * віддає; числа — gaming.tools для 1.5.3.7, awakening.wiki, TCNO; сховище асаулта — 2000/20 після Chapter 2, вікі
 * досі пише 1000). Краулер везе лише піщаний меланж. Предмети без відомого об'єму — окремим рядком.
 * Рейси — окремий крок калькулятора (число — і на його вкладці, тому стан у useTrips). Техніка — завжди повним
 * списком, вибір — як радіокнопкою; вибрана пам'ятається, її рейси — нагорі. Вантаж — такими самими рядками, як
 * на кроці «Видобути», з об'ємом і слотами кожного предмета. Картинки техніки — ігрові іконки з awakening.wiki (через
 * той самий проксі /catalog-wiki/, що й будівлі), підкладка — за рівнем модуля сховища (Mk), як тір предмета.
 */
import { useMemo, useRef, useState } from 'react'
import { Backpack } from 'lucide-react'
import { nameOf, type CatalogIndex } from '@/lib/catalog'
import { prefGet, prefSet } from '@/lib/prefs'
import { useUrlParam } from '@/lib/urlState'
import { cn, fmtN, plural, word, type Forms } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { cols, Icon, Line, type Open } from './bits'

export interface Hauler {
  id: string
  /** назва для списку: техніка й модуль сховища */
  name: string
  /** місткість одного рейсу, у тих самих одиницях, що об'єм предметів */
  cap: number
  /** слотів у сховищі */
  slots: number
  /** везе лише ці предмети (краулер — піщаний меланж) */
  only?: string[]
  note?: string
  /** картинка техніки (ігрова іконка з вікі) і рівень модуля сховища — для підкладки */
  img?: string
  mk?: number
}

/** ігрові іконки техніки з awakening.wiki — через проксі сервера */
const PIC = {
  sandbike: '/catalog-wiki/wiki/9/92/T_UI_IconVehCHSandBikeR_D.png',
  treadwheel: '/catalog-wiki/wiki/c/c5/T_UI_IconVehOETreadwheelR_D.png',
  scout: '/catalog-wiki/wiki/c/c1/T_UI_IconVehCHOrniLightR_D.png',
  assault: '/catalog-wiki/wiki/3/32/T_UI_IconVehCHOrniMediumR_D.png',
  carrier: '/catalog-wiki/wiki/d/d3/T_UI_IconVehCHOrniTransportR_D.png',
  buggy: '/catalog-wiki/wiki/f/f4/T_UI_IconVehCHBuggyR_D.png',
  crawler: '/catalog-wiki/wiki/0/0b/T_UI_IconVehCHSandCrawlerR_D.png',
}

/** техніка з модулями сховища — місткість одного рейсу (об'єм і слоти), від найменшої */
export const HAULERS: Hauler[] = [
  // власний інвентар — для порівняння (орієнтир TCNO; лише об'єм, слоти не рахуємо)
  { id: 'backpack', name: t('Рюкзак (пішки)'), cap: 175, slots: 999 },
  { id: 'sandbike', name: t('Піскоцикл · сховище Mk2'), cap: 250, slots: 15, img: PIC.sandbike, mk: 2 },
  { id: 'treadwheel', name: t('Тредвіл · сховище Mk2'), cap: 250, slots: 15, img: PIC.treadwheel, mk: 2 },
  { id: 'scout', name: t('Скаут-орні · сховище Mk4'), cap: 500, slots: 10, img: PIC.scout, mk: 4 },
  { id: 'buggy3', name: t('Багі · сховище Mk3'), cap: 1500, slots: 20, img: PIC.buggy, mk: 3 },
  { id: 'buggy4', name: t('Багі · сховище Mk4'), cap: 2000, slots: 20, img: PIC.buggy, mk: 4 },
  { id: 'assault', name: t('Асаулт-орні · сховище Mk5'), cap: 2000, slots: 20, img: PIC.assault, mk: 5 },
  { id: 'buggy5', name: t('Багі · сховище Mk5'), cap: 2500, slots: 20, img: PIC.buggy, mk: 5 },
  { id: 'buggy6', name: t('Багі · сховище Mk6'), cap: 3000, slots: 20, img: PIC.buggy, mk: 6 },
  { id: 'buggyboot6', name: t('Багі · Bigger Buggy Boot Mk6'), cap: 3500, slots: 35, note: t('Унікальний модуль'), img: PIC.buggy, mk: 6 },
  { id: 'crawler', name: t('Краулер · центрифуга Mk6'), cap: 7500, slots: 20, only: ['SpiceSand'], note: t('Краулер збирає й везе лише піщаний меланж'), img: PIC.crawler, mk: 6 },
  { id: 'regis', name: t('Краулер · Regis-контейнер'), cap: 11250, slots: 30, only: ['SpiceSand'], note: t('Лише піщаний меланж'), img: PIC.crawler, mk: 6 },
  { id: 'carrier', name: t('Вантажний орні · контейнер'), cap: 15000, slots: 150, note: t('Контейнер — окремий, його чіпляють до вантажного орні'), img: PIC.carrier, mk: 6 },
]
/** об'єм, якого немає в довіднику (вікі, gaming.tools) */
const VOLUME_FALLBACK: Record<string, number> = { SpiceSand: 0.15 }

export const TRIP: Forms = [t('рейс'), t('рейси'), t('рейсів')]
const SLOT: Forms = [t('слот'), t('слоти'), t('слотів')]

/** що за «готове»: цілі — предмети (злитки, деталі), будівлі (їхні матеріали) чи і те, й те */
export type Goods = 'items' | 'builds' | 'mixed'
const GOODS: Record<Goods, string> = { items: t('Готові вироби'), builds: t('Матеріали на будову'), mixed: t('Готове й матеріали') }

/** що везти й якою технікою (обидва пам'ятаються; що везти — ще й в адресі, ?haul=direct) і скільки рейсів */
export function useTrips(ix: CatalogIndex, raw: [string, number][], direct: [string, number][]) {
  const [what, setWhatState] = useUrlParam<'raw' | 'direct'>('haul', prefGet<'raw' | 'direct'>('calc:haul', 'raw'), (v) => v === 'raw' || v === 'direct')
  const [hid, setHidState] = useState<string>(() => prefGet('calc:hauler', 'assault'))
  const list = what === 'raw' ? raw : direct

  /** для кожного предмета вантажу — об'єм одиниці й розмір стосу */
  const cargo = useMemo(
    () =>
      list.map(([id, q]) => {
        const it = ix.item.get(id)
        const v = Number(it?.volume) || VOLUME_FALLBACK[id] || 0
        const stack = Number(it?.stack) || 500
        return { id, q, v, stack }
      }),
    [list, ix],
  )
  /** вантаж для техніки: об'єм, слоти, рейси (більша з двох меж) */
  const load = (x: Hauler) => {
    const mine = cargo.filter((c) => c.v && (!x.only || x.only.includes(c.id)))
    const vol = mine.reduce((n, c) => n + c.v * c.q, 0)
    const slots = mine.reduce((n, c) => n + Math.ceil(c.q / c.stack), 0)
    const n = vol > 0 ? Math.max(1, Math.ceil(vol / x.cap), Math.ceil(slots / x.slots)) : 0
    return { vol, slots, n, bySlots: vol > 0 && Math.ceil(slots / x.slots) > Math.ceil(vol / x.cap) }
  }
  const h = HAULERS.find((x) => x.id === hid) ?? HAULERS.find((x) => x.id === 'assault')!
  return {
    what,
    setWhat: (v: 'raw' | 'direct') => { setWhatState(v); prefSet('calc:haul', v) },
    h,
    setHid: (v: string) => { setHidState(v); prefSet('calc:hauler', v) },
    cargo,
    load,
    /** рейси вибраною технікою */
    trip: load(h),
    /** чи є що везти взагалі (сировина чи готове) */
    any: raw.length > 0 || direct.length > 0,
  }
}
export type TripsState = ReturnType<typeof useTrips>

/** техніка в списку — від найбільшої */
const BY_CAP = [...HAULERS].sort((a, b) => b.cap - a.cap)
const ROW = 'grid grid-cols-[1rem_2.25rem_minmax(0,1fr)_4rem_3rem] items-center gap-2 px-2'

/** картинка техніки; рюкзак — значком */
function Pic({ x, size }: { x: Hauler; size: number }) {
  if (x.img) return <Icon src={x.img} size={size} grade={x.mk} />
  return (
    <span className="grid shrink-0 place-items-center rounded-md bg-panel2" style={{ width: size, height: size }}>
      <Backpack size={size * 0.5} className="text-muted" />
    </span>
  )
}

/** підсумок для однієї техніки: рейси, назва, вантаж (чи чому не везе), примітка — завжди ті самі рядки */
function Summary({ x, l, on }: { x: Hauler; l: { vol: number; slots: number; n: number; bySlots: boolean }; on: boolean }) {
  return (
    <div className={cn('col-start-1 row-start-1 flex items-center gap-3', !on && 'invisible')} aria-hidden={!on || undefined}>
      <Pic x={x} size={56} />
      <div className="grid min-w-0 gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
          <b className="font-mono text-[22px] font-semibold leading-none tabular-nums">{l.n ? fmtN(l.n) : '—'}</b>
          <span>{word(l.n, TRIP)}</span>
        </p>
        <p className="text-[13px] font-semibold">{x.name}</p>
        <p className="text-[12px] text-muted">
          {l.n
            ? (x.slots < 999
                ? t("Вантаж — {vol} об'єму, {slots}; за рейс — {cap} об'єму, {capSlots}.", { vol: fmtN(Math.round(l.vol)), slots: plural(l.slots, SLOT), cap: fmtN(x.cap), capSlots: plural(x.slots, SLOT) })
                : t("Вантаж — {vol} об'єму, {slots}; за рейс — {cap} об'єму.", { vol: fmtN(Math.round(l.vol)), slots: plural(l.slots, SLOT), cap: fmtN(x.cap) })) +
              (l.bySlots ? ' ' + t("Тут межа — слоти, а не об'єм.") : '')
            : x.only
              ? t('Везе лише піщаний меланж, а у вантажі його немає.')
              : t('Нема чого везти.')}
        </p>
        {/* примітка краулера («лише піщаний меланж») — та сама причина, що вже написана вище, тож без повтору */}
        {x.note && !(x.only && !l.n) && <p className="text-[11.5px] text-muted">{x.note}</p>}
      </div>
    </div>
  )
}

export function Trips({ ix, trips, goods = 'builds', open }: { ix: CatalogIndex; trips: TripsState; goods?: Goods; open: Open }) {
  const { h, cargo } = trips
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const unknown = cargo.filter((c) => !c.v).map((c) => c.id)
  const topVol = Math.max(1, ...cargo.map((c) => c.v * c.q))
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const j = (i + d + BY_CAP.length) % BY_CAP.length
    trips.setHid(BY_CAP[j].id)
    refs.current[j]?.focus()
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="text-muted">{t('Що везти:')}</span>
        <span className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label={t('Що везти')}>
          {([['raw', t('Сировину')], ['direct', GOODS[goods]]] as const).map(([v, l]) => (
            <button key={v} type="button" aria-pressed={trips.what === v} onClick={() => trips.setWhat(v)} className={cn('rounded px-2 py-0.5', trips.what === v ? 'bg-spice/20 text-ink' : 'text-muted hover:text-ink')}>
              {l}
            </button>
          ))}
        </span>
      </div>

      {/* вибрана техніка — скільки рейсів. Підсумки всієї техніки лежать одне на одному в одній клітинці сітки, видно
          лише вибраний: висота — за найвищим, тож блок не стрибає, коли перемикаєш техніку */}
      <section aria-label={t('Рейси вибраною технікою')} className="grid rounded-lg border border-spice/40 bg-spice/5 p-2.5">
        {BY_CAP.map((x) => (
          <Summary key={x.id} x={x} l={trips.load(x)} on={x.id === h.id} />
        ))}
      </section>

      {/* що саме веземо — тими самими рядками, що й на кроці «Видобути». Те, чого ця техніка не везе (краулер — усе,
          крім піщаного меланжу), лишається притишеним, а не зникає: список не змінює висоту, сторінка не стрибає */}
      {cargo.length > 0 && (
        <ul className="grid gap-x-4 gap-y-0.5" style={cols(260)} aria-label={t('Вантаж')}>
          {cargo.map((c) => {
            const off = !!h.only && !h.only.includes(c.id)
            return (
              <Line
                key={c.id}
                ix={ix}
                id={c.id}
                qty={fmtN(c.q)}
                share={(c.v * c.q) / topVol}
                dim={off}
                sub={off ? t('ця техніка не везе') : c.v ? t("{vol} об'єму · {slots}", { vol: fmtN(Math.round(c.v * c.q)), slots: plural(Math.ceil(c.q / c.stack), SLOT) }) : t("об'єм невідомий")}
                open={open}
              />
            )
          })}
        </ul>
      )}
      {unknown.length > 0 && (
        <p className="text-[11.5px] text-muted">
          {unknown.length > 6
            ? t("Без відомого об'єму (не враховано): {names} і ще {n}.", { names: unknown.slice(0, 6).map((id) => nameOf(ix.item.get(id), id)).join(', '), n: unknown.length - 6 })
            : t("Без відомого об'єму (не враховано): {names}.", { names: unknown.map((id) => nameOf(ix.item.get(id), id)).join(', ') })}
        </p>
      )}

      {/* уся техніка — вибір кліком по рядку, як радіокнопка; стрілки — сусідня */}
      <div className="grid gap-0.5 rounded-lg border border-line/70 p-1 text-[12.5px]">
        <div className={cn(ROW, 'pb-0.5 pt-1 text-[11px] text-muted')} aria-hidden>
          <span />
          <span />
          <span>{t('Техніка')}</span>
          <span className="text-right">{t('за рейс')}</span>
          <span className="text-right">{t('рейсів')}</span>
        </div>
        <div role="radiogroup" aria-label={t('Техніка')} className="grid gap-0.5">
          {BY_CAP.map((x, i) => {
            const l = trips.load(x)
            const on = x.id === h.id
            return (
              <button
                key={x.id}
                ref={(el) => { refs.current[i] = el }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => trips.setHid(x.id)}
                onKeyDown={(e) => move(e, i)}
                title={x.note}
                className={cn(ROW, 'rounded-md py-1 text-left transition-colors', on ? 'bg-spice/10 font-semibold ring-1 ring-spice/50' : 'hover:bg-panel2/70')}
              >
                <span className={cn('grid h-4 w-4 place-items-center rounded-full border-2', on ? 'border-spice' : 'border-line')} aria-hidden>
                  {on && <span className="h-2 w-2 rounded-full bg-spice" />}
                </span>
                <Pic x={x} size={36} />
                {/* «техніка · модуль»: на вузькому модуль переноситься, а не обрізається */}
                <span className="min-w-0 leading-tight">
                  {x.name.split(' · ')[0]}
                  {x.name.includes(' · ') && <span className={cn('font-normal', !on && 'text-muted')}> · {x.name.split(' · ').slice(1).join(' · ')}</span>}
                </span>
                <span className="text-right font-mono font-normal text-muted tabular-nums">{fmtN(x.cap)}</span>
                <span className={cn('text-right font-mono tabular-nums', !l.n && 'text-muted')}>{l.n ? fmtN(l.n) : '—'}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

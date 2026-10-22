/**
 * Сторінка «Позначки» бічної панелі мапи — усе від гравців, а не з гри: позначки на мапі й записи ресурсів одним
 * списком (вид — значком і фільтром «Усе · Позначки · Ресурси»). «Мої» й «Гільдія» на мапі завжди; «Публічні» — чуже:
 * список пачками з пошуком за назвою й автором, а на мапі лише те, що людина ввімкнула (окрему річ чи все від автора).
 * Вкладки — в адресі (?scope=, ?type=); без ?scope= панель відкривається на першій непорожній («Мої», далі «Гільдія»,
 * далі «Публічні»).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Gem, MapPinned, Plus, RefreshCw, SearchX, Users, X } from 'lucide-react'
import { get } from '@/lib/api'
import { loginHref, useAuth } from '@/lib/auth'
import { markerKind, useMarkers, type Marker } from '@/lib/markers'
import { usePlaces, type Place } from '@/lib/places'
import { useMapUi } from '@/lib/map/ui'
import { isMarker, keyOf, ownerKey, usePubMarks, type Follow, type PubRow } from '@/lib/map/marks'
import { mapName, ZONE_MAPS, type Loot, type MapDef, type SourceResp } from '@/lib/map/data'
import { gridOf, sectorOf } from '@/lib/map/layer'
import { useUrlParam } from '@/lib/urlState'
import { useStore } from '@/store'
import { cn, fmtN, splitEn } from '@/lib/utils'
import { locale, t } from '@/lib/i18n'
import type { Item } from '@/lib/items'
import { checkedOf, SnCheckbox, SnInput, SnSwitch, valueOf } from '@/components/sn'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { Seg } from '@/components/ui/seg'
import { Empty, ErrorAlert, Loading } from '@/components/states'
import { Avatar, GuildTag, VIS_META } from '@/components/access/Access'
import { MarkerDetail, MarkerEditor, MarkerGlyph } from './MarkerParts'
import { newDraft, onMap, PlaceDetail, PlaceEditor } from './PlaceParts'
import { TOUCH } from './bits'

export type Scope = 'mine' | 'guild' | 'public'
const SCOPES: string[] = ['mine', 'guild', 'public']
type TypeF = 'all' | 'marker' | 'place'
const TYPES: string[] = ['all', 'marker', 'place']
/** вкладка «Мої / Гільдія / Публічні» — та сама і в MapPage (туди її перемикає клік по позначці на мапі) */
export const useMarksScope = () => useUrlParam<Scope>('scope', 'mine', (v) => SCOPES.includes(v))
const PAGE = 20

/** одна річ списку: позначка чи запис ресурсу */
type Entry = { kind: 'marker'; m: Marker } | { kind: 'place'; p: Place }
const toEntry = (r: Marker | Place | PubRow): Entry => (isMarker(r) ? { kind: 'marker', m: r } : { kind: 'place', p: r as Place })
const itemOf = (e: Entry): Item | undefined => (e.kind === 'marker' ? e.m.item : e.p.item)
const idOf = (e: Entry) => (e.kind === 'marker' ? e.m.id : e.p.id)
const titleOf = (e: Entry) => (e.kind === 'marker' ? e.m.title : splitEn(e.p.res)[0])
const subOf = (e: Entry) => (e.kind === 'marker' ? markerKind(e.m.kind).label : splitEn(e.p.place)[0])
const hereOf = (e: Entry, map: string) => (e.kind === 'marker' ? e.m.map === map : onMap(e.p, map))
const mapOf = (e: Entry) => (e.kind === 'marker' ? e.m.map : e.p.pins?.[0]?.map || e.p.types?.[0]?.map || ZONE_MAPS[e.p.zone]?.[0])
const textOf = (e: Entry) => (e.kind === 'marker' ? [e.m.title, e.m.note, markerKind(e.m.kind).label] : [e.p.res, e.p.place, e.p.area, e.p.how, e.p.loot]).join(' ').toLowerCase()
/** своє (людини) чи гільдійське; давні записи без власника — гільдійські */
export const scopeOf = (it?: Pick<Item, 'owner'>): Scope => (it?.owner.kind === 'user' ? 'mine' : 'guild')
const byTitle = (a: Entry, b: Entry) => titleOf(a).localeCompare(titleOf(b), locale())
const authorOf = (o: Follow) => (o.kind === 'guild' ? `[${o.tag || '?'}] ${o.name}` : o.name)

/**
 * Показати рядок у прокрутці сторінки панелі. Не scrollIntoView: той прокрутив би й «гортання» сторінок панелі убік.
 */
function revealRow(id: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id)
    // сторінка панелі; на телефоні вона не прокручується сама — тоді вся панель (найближчий предок із прокруткою)
    let box = el?.closest<HTMLElement>('[data-scroller]') ?? null
    while (box && box.scrollHeight <= box.clientHeight + 1) box = box.parentElement
    if (!el || !box) return
    const a = el.getBoundingClientRect(), b = box.getBoundingClientRect()
    if (a.top < b.top) box.scrollBy({ top: a.top - b.top - 8, behavior: 'smooth' })
    else if (a.bottom > b.bottom) box.scrollBy({ top: Math.min(a.bottom - b.bottom + 8, a.top - b.top - 8), behavior: 'smooth' })
  })
}

/** позначка Глибокої пустелі з іншої розкладки, ніж показана: її номер, інакше null */
const otherWeek = (e: Entry, c: Pick<Common, 'def' | 'layout'>) =>
  e.kind === 'marker' && e.m.map === c.def.id && c.layout != null && e.m.layout != null && e.m.layout !== c.layout ? e.m.layout : null

/**
 * вибрати / зняти вибір у списку; позначку — ще й показати на мапі (з іншої розкладки — спершу перейти на її розкладку,
 * інакше клік вів би в порожнє місце)
 */
function pick(e: Entry, on: boolean, c: Pick<Common, 'def' | 'layout' | 'onFly' | 'onWeek'>) {
  if (e.kind === 'marker') {
    const w = otherWeek(e, c)
    if (!on && w != null && c.onWeek) { c.onWeek(e.m.id, w); return }
    useMarkers.getState().select(on ? null : e.m.id)
    if (!on) c.onFly(e.m.x, e.m.y)
  } else useMapUi.getState().select(on ? null : e.p.id)
}

interface Common {
  def: MapDef
  layout: number | null
  resp: SourceResp
  /** лут вибраного запису на цій мапі */
  loot: (Loot & { loading: boolean }) | null
  /** скільки точок кожного типу на мапі (для вибору типів у формі запису) */
  counts: Record<string, number>
  /** пошук луту вибраного запису не вдався — шукати ще раз */
  onLootRetry?: () => void
  onFly: (x: number, y: number) => void
  /** позначка з іншої розкладки Глибокої пустелі: перейти на неї, вибрати й підлетіти */
  onWeek?: (id: string, w: number) => void
}

export function MarksPanel({
  onOpen,
  ...c
}: Common & {
  /** річ з іншої мапи: перейти туди, вибрати й підлетіти */
  onOpen: (kind: 'marker' | 'place', id: string, map: string) => void
}) {
  const { def } = c
  const user = useAuth((s) => s.user)
  const [scope, setScope, scopeHref] = useMarksScope()
  const [type, setType, typeHref] = useUrlParam<TypeF>('type', 'all', (v) => TYPES.includes(v))
  const [q, setQ] = useState('')
  const markers = useMarkers((s) => s.rows)
  const places = usePlaces((s) => s.rows)
  const mPicking = useMarkers((s) => s.picking)
  const mDraft = useMarkers((s) => s.draft)
  const mSel = useMarkers((s) => s.selected)
  const pDraft = useMapUi((s) => s.draft)
  const pSel = useMapUi((s) => s.selected)
  const shownN = usePubMarks((s) => s.rows.length)
  const marksGame = useMapUi((s) => s.marksGame)
  const mReady = useMarkers((s) => s.ready)
  const pReady = usePlaces((s) => s.ready)

  const own = useMemo<Entry[]>(() => [...markers.map((m) => ({ kind: 'marker' as const, m })), ...places.map((p) => ({ kind: 'place' as const, p }))], [markers, places])
  const n = useMemo(() => {
    const here = own.filter((e) => hereOf(e, def.id))
    return { mine: here.filter((e) => scopeOf(itemOf(e)) === 'mine').length, guild: here.filter((e) => scopeOf(itemOf(e)) === 'guild').length }
  }, [own, def.id])

  // вкладку не вибрано (у адресі нема ?scope=) — відкриваємо першу непорожню на цій мапі: у новачка гільдії «Мої» (0)
  // порожні, а в гільдії — 28 позначок. Вибрала людина сама — не чіпаємо
  const chose = useRef(new URLSearchParams(location.search).has('scope'))
  const decided = useRef<string | null>(null)
  useEffect(() => {
    if (chose.current || !mReady || !pReady || decided.current === def.id || new URLSearchParams(location.search).has('scope')) return
    decided.current = def.id
    const first: Scope = n.mine ? 'mine' : n.guild ? 'guild' : shownN ? 'public' : 'mine'
    if (first !== scope) setScope(first, { replace: true })
  }, [mReady, pReady, def.id, n, shownN]) // eslint-disable-line react-hooks/exhaustive-deps
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const list = own.filter((e) => scopeOf(itemOf(e)) === scope && (type === 'all' || e.kind === type) && words.every((w) => textOf(e).includes(w)))

  // вибрали на мапі чи щойно додали — показати рядок (нове гільдійське — на вкладці «Гільдія», і навпаки)
  useEffect(() => {
    if (!mSel) return
    const m = markers.find((x) => x.id === mSel)
    if (m && scope !== 'public' && scopeOf(m.item) !== scope) setScope(scopeOf(m.item), { replace: true })
    revealRow(`mark-marker-${mSel}`)
  }, [mSel]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pSel) return
    const p = places.find((x) => x.id === pSel)
    if (p && scope !== 'public' && scopeOf(p.item) !== scope) setScope(scopeOf(p.item), { replace: true })
    revealRow(`mark-place-${pSel}`)
  }, [pSel]) // eslint-disable-line react-hooks/exhaustive-deps

  const addMarker = () => {
    if (!user) { location.assign(loginHref()); return }
    useMarkers.getState().setPicking(!mPicking)
  }
  const addPlace = () => {
    if (!user) { location.assign(loginHref()); return }
    useMarkers.getState().setPicking(false)
    useMapUi.getState().edit(newDraft(def.id))
  }
  const cnt = (v: number) => <span className="ml-1 font-mono text-[10px] opacity-70">{v}</span>

  return (
    <div className="flex min-h-full flex-col">
      <div className="grid gap-2 border-b border-line p-2.5">
        <Seg<Scope>
          label={t('Чиї позначки')}
          value={scope}
          onChange={(v) => { chose.current = true; setScope(v) }}
          href={scopeHref}
          items={[
            { id: 'mine', label: <>{t('Мої')}{cnt(n.mine)}</>, tip: t('Твої позначки й записи ресурсів') },
            { id: 'guild', label: <>{t('Гільдія')}{cnt(n.guild)}</>, tip: t('Позначки й записи твоєї гільдії') },
            { id: 'public', label: <>{t('Публічні')}{shownN > 0 && cnt(shownN)}</>, tip: t('Чуже публічне: на мапі лише те, що ввімкнеш') },
          ]}
          className="grid w-full grid-cols-3 [&>*]:text-center [@media(pointer:coarse)]:[&>*]:min-h-10 [&>*]:inline-flex [&>*]:items-center [&>*]:justify-center"
        />
        <div className="flex items-center gap-1.5">
          <SnInput
            type="search"
            className="min-w-0 flex-1"
            modelValue={q}
            onInput={(e: Event) => setQ(valueOf(e))}
            onChange={(e: Event) => setQ(valueOf(e))}
            placeholder={scope === 'public' ? t('Назва чи автор…') : t('Фільтр списку')}
            accessibilityLabel={t('Пошук позначок')}
          />
          <Button size="xs" variant={mPicking ? 'default' : 'secondary'} aria-pressed={mPicking} onClick={addMarker} data-tip={mPicking ? t('Клацни на мапі, де її поставити (Esc — скасувати)') : t('Нова позначка: база, збір, небезпека…')}>
            <Plus size={12} /> {t('Позначка')}
          </Button>
          <Button size="xs" variant="secondary" onClick={addPlace} data-tip={t('Новий запис: ресурс і де його брати')}>
            <Plus size={12} /> {t('Ресурс')}
          </Button>
        </div>
        <Seg<TypeF>
          label={t('Що в списку')}
          size="sm"
          value={type}
          onChange={(v) => setType(v)}
          href={typeHref}
          items={[
            { id: 'all', label: t('Усе') },
            { id: 'marker', label: t('Позначки') },
            { id: 'place', label: t('Ресурси') },
          ]}
          className="grid w-full grid-cols-3 [&>*]:text-center [@media(pointer:coarse)]:[&>*]:min-h-10 [&>*]:inline-flex [&>*]:items-center [&>*]:justify-center"
        />
        {/* лише на цій вкладці: на «Грі» мапа показує шари «Гри» як завжди */}
        <label className="flex min-h-7 cursor-pointer items-center gap-2 px-1 text-[12px] [@media(pointer:coarse)]:min-h-10">
          <SnSwitch modelValue={marksGame} accessibilityLabel={t('Показувати ігрові маркери')} onChange={(e: Event) => useMapUi.getState().setMarksGame(checkedOf(e))} />
          <span className="min-w-0 flex-1">{t('Показувати ігрові маркери')}</span>
          <span className="text-[11px] text-muted">{marksGame ? t('шари з «Гри»') : t('лише позначене')}</span>
        </label>
      </div>
      <div className="px-2 py-2">
        {mDraft && !mDraft.id && mDraft.map === def.id && <MarkerEditor draft={mDraft} sector={sectorIn(def, mDraft.x, mDraft.y)} />}
        {pDraft && !pDraft.id && <PlaceEditor def={def} layout={c.layout} resp={c.resp} counts={c.counts} />}
        {scope === 'public'
          ? <PublicList {...c} q={q} words={words} type={type} />
          : <OwnList {...c} scope={scope} list={list} filtered={words.length > 0 || type !== 'all'} onOpen={onOpen} />}
      </div>
    </div>
  )
}

/** сектор точки в Глибокій пустелі («E5»), на інших мапах — null */
const sectorIn = (def: MapDef, x: number, y: number) => {
  const g = gridOf(def)
  return g ? sectorOf(g, x, y) : null
}

/** значок виду: позначка — кружечок виду, запис ресурсу — самоцвіт */
function KindIcon({ e }: { e: Entry }) {
  if (e.kind === 'marker') return <MarkerGlyph m={e.m} />
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[6px] bg-spice/15 text-spice" aria-hidden>
      <Gem size={11} />
    </span>
  )
}

/** рядок списку: галочка «на мапі» (лише в того, що є на цій мапі), значок, назва й підпис, праворуч — своє */
function EntryRow({ e, on, onClick, sub, hint, checked, onCheck, checkLocked, right }: {
  e: Entry
  on: boolean
  onClick: () => void
  sub?: string
  hint?: string
  checked?: boolean
  onCheck?: () => void
  /** галочку не зняти тут (увімкнено все від автора) */
  checkLocked?: boolean
  right?: ReactNode
}) {
  const title = titleOf(e)
  return (
    <div className={cn('flex min-h-7 items-center gap-1.5 rounded-md py-0.5 pl-1 pr-1 transition-colors [@media(pointer:coarse)]:min-h-10', on ? 'bg-spice/12' : 'hover:bg-panel2')}>
      {onCheck ? (
        <span className="grid shrink-0 place-items-center [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-8" data-tip={checkLocked ? t('Увімкнено: усе від автора') : checked ? t('Прибрати з мапи') : t('Показувати на мапі')}>
          <SnCheckbox modelValue={!!checked} disabled={checkLocked} onChange={(ev: Event) => { if (checkedOf(ev) !== !!checked) onCheck() }} accessibilityLabel={t('Показувати на мапі «{name}»', { name: title })} />
        </span>
      ) : (
        <span className="h-3.5 w-3.5 shrink-0 [@media(pointer:coarse)]:w-8" />
      )}
      <KindIcon e={e} />
      <button type="button" onClick={onClick} aria-expanded={on} className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5 self-stretch text-left [@media(pointer:coarse)]:content-center [@media(pointer:coarse)]:items-center">
        {/* назва й місце не обрізаються: не влазять — місце переходить у наступний рядок */}
        <span className={cn('min-w-0 break-words text-[12.5px]', on ? 'font-semibold text-spice' : 'font-medium')}>{title}</span>
        <span className="min-w-0 break-words text-[11px] text-muted">{sub ?? subOf(e)}</span>
      </button>
      {hint && <span className="shrink-0 rounded bg-panel2 px-1 font-mono text-[9.5px] text-muted">{hint}</span>}
      {right}
    </div>
  )
}

/** розгорнута річ: форма, якщо її саме змінюють, інакше — подробиці */
function EntryDetail({ e, onChanged, extra, ...c }: Common & { e: Entry; onChanged: () => void; extra?: ReactNode }) {
  const mDraft = useMarkers((s) => s.draft)
  const pDraft = useMapUi((s) => s.draft)
  if (e.kind === 'marker') {
    const here = e.m.map === c.def.id
    return mDraft?.id === e.m.id
      ? <MarkerEditor draft={mDraft} sector={mDraft.map === c.def.id ? sectorIn(c.def, mDraft.x, mDraft.y) : null} />
      : <MarkerDetail m={e.m} sector={here ? sectorIn(c.def, e.m.x, e.m.y) : null} onChanged={onChanged} extra={extra} />
  }
  if (pDraft?.id === e.p.id) return <PlaceEditor def={c.def} layout={c.layout} resp={c.resp} counts={c.counts} />
  return <PlaceDetail r={e.p} def={c.def} layout={c.layout} resp={c.resp} loot={c.loot} onLootRetry={c.onLootRetry} onFly={c.onFly} onChanged={onChanged} extra={extra} />
}

/** хто бачить своє: значок видимості (особисте, гільдія, за посиланням, публічне) */
function VisIcon({ item }: { item?: Item }) {
  if (!item) return null
  const m = VIS_META[item.visibility]
  return (
    <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border', m.cls)} data-tip={`${m.label} — ${m.hint}`} aria-label={m.label}>
      <m.icon size={10} aria-hidden />
    </span>
  )
}

const reloadOwn = () => { void useMarkers.getState().load(); void usePlaces.getState().load() }

/** «Мої» чи «Гільдія»: що на цій мапі, далі згорнуте «На інших мапах» */
function OwnList({ scope, list, filtered, onOpen, ...c }: Common & {
  scope: Exclude<Scope, 'public'>
  list: Entry[]
  /** список звужено пошуком чи видом */
  filtered: boolean
  onOpen: (kind: 'marker' | 'place', id: string, map: string) => void
}) {
  const { def, resp } = c
  const user = useAuth((s) => s.user)
  const guild = useAuth((s) => s.guild)
  const mReady = useMarkers((s) => s.ready)
  const mError = useMarkers((s) => s.error)
  const pReady = usePlaces((s) => s.ready)
  const pError = usePlaces((s) => s.error)
  const mSel = useMarkers((s) => s.selected)
  const mDraft = useMarkers((s) => s.draft)
  const pSel = useMapUi((s) => s.selected)
  const pDraft = useMapUi((s) => s.draft)
  const checked = useMapUi((s) => s.checked)
  const { toggleCheck, checkMany } = useMapUi()
  const here = list.filter((e) => hereOf(e, def.id)).sort(byTitle)
  const shownHere = here.filter((e) => checked.includes(idOf(e))).length
  const off = list.filter((e) => !hereOf(e, def.id)).sort(byTitle)

  if (!user) {
    return (
      <Empty icon={MapPinned} title={t('Увійди, щоб ставити свої позначки')} description={t('Свої й гільдійські позначки та записи ресурсів видно після входу. Чуже публічне — на вкладці «Публічні».')} framed={false} className="-mx-1 -my-3">
        <Button size="xs" href={loginHref()}>{t('Увійти')}</Button>
      </Empty>
    )
  }
  if (scope === 'guild' && !guild) {
    return (
      <Empty icon={Users} title={t('Ти ще не в гільдії')} description={t('Гільдійські позначки й записи бачать усі її учасники.')} framed={false} className="-mx-1 -my-3">
        <Button size="xs" variant="secondary" onClick={() => useStore.getState().setView('guilds')}>{t('Гільдії')}</Button>
      </Empty>
    )
  }
  const error = mError || pError
  return (
    <>
      {(!mReady || !pReady) && <Loading lines={3} />}
      {error && (
        <ErrorAlert message={error}>
          <Button size="xs" variant="outline" className="mt-2" onClick={reloadOwn}><RefreshCw size={12} /> {t('Спробувати ще')}</Button>
        </ErrorAlert>
      )}
      {mReady && pReady && !error && !here.length && !(mDraft && !mDraft.id) && !(pDraft && !pDraft.id) && (filtered && (here.length + off.length === 0) ? (
        <Empty icon={SearchX} title={t('Нічого не знайшлося')} description={t('Зміни слово в пошуку чи вид.')} framed={false} className="-mx-1 -my-3" />
      ) : (
        <Empty
          icon={MapPinned}
          title={t('На цій мапі поки порожньо')}
          description={scope === 'mine' ? t('Познач базу, місце збору чи небезпеку або запиши, де брати ресурс, — кнопки вгорі.') : t('Тут будуть позначки й записи ресурсів твоєї гільдії.')}
          framed={false}
          className="-mx-1 -my-3"
        />
      ))}
      {here.length > 0 && (
        <Head aside={(
          <Button size="xs" variant="ghost" onClick={() => checkMany(here.map(idOf), shownHere < here.length)}>
            {shownHere < here.length ? t('Показати всі') : t('Сховати всі')}
          </Button>
        )}>
          {t('На мапі {n} з {total}', { n: shownHere, total: here.length })}
        </Head>
      )}
      <ul className="grid grid-cols-[minmax(0,1fr)]">
        {here.map((e) => {
          const id = idOf(e)
          const on = e.kind === 'marker' ? mSel === id : pSel === id
          return (
            <li key={e.kind + id} id={`mark-${e.kind}-${id}`} className="scroll-mt-2">
              <EntryRow
                e={e}
                on={on}
                onClick={() => pick(e, on, c)}
                hint={otherWeek(e, c) != null ? t('розкладка {n}', { n: otherWeek(e, c)! }) : undefined}
                checked={checked.includes(id)}
                onCheck={() => toggleCheck(id)}
                right={<VisIcon item={itemOf(e)} />}
              />
              {on && <EntryDetail {...c} e={e} onChanged={reloadOwn} />}
            </li>
          )
        })}
      </ul>
      {off.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer px-1.5 py-1 text-[11.5px] text-muted hover:text-ink [@media(pointer:coarse)]:py-3">{t('На інших мапах — {n}', { n: off.length })}</summary>
          <ul className="grid grid-cols-[minmax(0,1fr)]">
            {off.map((e) => {
              const m = mapOf(e)
              return (
                <li key={e.kind + idOf(e)}>
                  <EntryRow e={e} on={false} hint={m ? mapName(resp.labels, m) : undefined} onClick={() => m && onOpen(e.kind, idOf(e), m)} right={<VisIcon item={itemOf(e)} />} />
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </>
  )
}

/** заголовок частини списку — як у розділах шарів */
function Head({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-1.5 px-1">
      <span className="min-w-0 flex-1 break-words font-display text-[10.5px] font-semibold uppercase leading-snug tracking-[0.12em] text-muted">{children}</span>
      {aside}
    </div>
  )
}

/**
 * «Публічні»: угорі — що ввімкнено на мапі (окремі речі й автори), нижче — усе чуже публічне на цій мапі сторінками
 * по 20 з пошуком (на сервері). Розгорнута річ видно на мапі, поки її не згорнули.
 */
function PublicList({ q, words, type, ...c }: Common & { q: string; words: string[]; type: TypeF }) {
  const { def } = c
  const { ids, owners, rows: shown, peek, error, toggle, follow, clear, setPeek, load } = usePubMarks()
  const mSel = useMarkers((s) => s.selected)
  const pSel = useMapUi((s) => s.selected)

  // пошук — на сервері, коли людина перестала друкувати
  const [dq, setDq] = useState(q.trim())
  useEffect(() => {
    const id = setTimeout(() => setDq(q.trim()), 300)
    return () => clearTimeout(id)
  }, [q])
  const key = `${def.id}|${type}|${dq}`
  const [pg, setPg] = useState({ key, offset: 0 })
  const offset = pg.key === key ? pg.offset : 0
  const [res, setRes] = useState<{ at: string; rows: PubRow[]; total: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [tryN, setTryN] = useState(0)
  useEffect(() => {
    let live = true
    setFailed(false)
    const s = new URLSearchParams({ map: def.id, offset: String(offset), limit: String(PAGE) })
    if (dq) s.set('q', dq)
    if (type !== 'all') s.set('kind', type)
    get<{ rows: PubRow[]; total: number }>(`/api/map/public?${s}`)
      .then((r) => { if (live) setRes({ at: `${key}|${offset}`, rows: r.rows, total: r.total }) })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [key, offset, tryN]) // eslint-disable-line react-hooks/exhaustive-deps
  const loading = !failed && res?.at !== `${key}|${offset}`

  const followed = (r: PubRow) => owners.some((o) => ownerKey(o) === ownerKey(r.item.owner))
  const isShown = (r: PubRow) => ids.includes(keyOf(r)) || followed(r)
  const match = (r: PubRow) => (type === 'all' || r.item.kind === type) && words.every((w) => `${textOf(toEntry(r))} ${authorOf(r.item.owner).toLowerCase()}`.includes(w))
  const onHere = [...shown, ...(peek && !shown.some((x) => keyOf(x) === keyOf(peek)) && hereOf(toEntry(peek), def.id) ? [peek] : [])]
    .filter(match)
    .sort((a, b) => byTitle(toEntry(a), toEntry(b)))

  const item = (r: PubRow, part: 'on' | 'list') => {
    const e = toEntry(r)
    const on = e.kind === 'marker' ? mSel === r.id : pSel === r.id
    // уже є вгорі, в «Увімкнено»: тут — лише рядок, розгортається там
    const dup = part === 'list' && onHere.some((x) => keyOf(x) === keyOf(r))
    const vis = isShown(r)
    const via = followed(r)
    const name = authorOf(r.item.owner)
    return (
      <li key={keyOf(r)} id={dup ? undefined : `mark-${e.kind}-${r.id}`} className="scroll-mt-2">
        <EntryRow
          e={e}
          on={on}
          sub={`${subOf(e)} · ${name}`}
          onClick={() => { pick(e, on, c); setPeek(on ? null : r) }}
          checked={vis}
          onCheck={() => toggle(r)}
          checkLocked={via}
        />
        {on && !dup && (
          <EntryDetail
            {...c}
            e={e}
            onChanged={() => void load()}
            extra={(
              <>
                <Toggle pressed={via} onPressedChange={() => follow(r.item.owner)} data-tip={t('Показувати на мапі все публічне від автора')}>
                  <Users size={12} /> {t('Усе від {name}', { name })}
                </Toggle>
              </>
            )}
          />
        )}
      </li>
    )
  }

  const total = res?.total ?? 0
  return (
    <div className="grid gap-3">
      <section className="grid gap-1">
        <Head aside={(ids.length > 0 || owners.length > 0) && (
          <Button size="xs" variant="ghost" onClick={clear} data-tip={t('Прибрати з мапи все чуже публічне')}>{t('Сховати все')}</Button>
        )}>
          {t('Увімкнено на мапі')}
        </Head>
        {error && (
          <ErrorAlert message={error}>
            <Button size="xs" variant="outline" className="mt-2" onClick={() => void load()}><RefreshCw size={12} /> {t('Спробувати ще')}</Button>
          </ErrorAlert>
        )}
        {owners.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {owners.map((o) => (
              <span key={ownerKey(o)} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-panel2/50 py-0.5 pl-1 pr-1.5 text-[11.5px]" data-tip={t('Усе публічне від автора — на мапі')}>
                {o.kind === 'guild' ? <GuildTag tag={o.tag || '?'} color={o.color} /> : <Avatar name={o.name} color={o.color} size={16} />}
                <span className="min-w-0 truncate">{o.name}</span>
                <button type="button" className={cn('grid h-5 w-5 place-items-center rounded-full text-muted hover:text-bad', TOUCH)} onClick={() => follow(o)} aria-label={t('Прибрати з мапи все від {name}', { name: o.name })}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {onHere.length > 0 ? (
          <ul className="grid grid-cols-[minmax(0,1fr)]">{onHere.map((r) => item(r, 'on'))}</ul>
        ) : (
          <p className="px-1 text-[11.5px] leading-snug text-muted">
            {ids.length || owners.length
              ? t('На цій мапі з увімкненого нічого немає.')
              : t('Чуже публічне не малюється на мапі само: постав галочку окремій речі чи увімкни все від автора.')}
          </p>
        )}
      </section>

      <section className="grid gap-1">
        <Head aside={res && <span className="font-mono text-[10px] text-muted">{fmtN(total)}</span>}>{t('Публічне на цій мапі')}</Head>
        {failed && (
          <ErrorAlert message={t('Список зараз не завантажився. Спробуй ще раз трохи згодом.')}>
            <Button size="xs" variant="outline" className="mt-2" onClick={() => setTryN((x) => x + 1)}><RefreshCw size={12} /> {t('Спробувати ще')}</Button>
          </ErrorAlert>
        )}
        {!res && !failed && <Loading lines={4} />}
        {res && !loading && !failed && !res.rows.length && (dq || type !== 'all' ? (
          <Empty icon={SearchX} title={t('Нічого не знайшлося')} description={t('Зміни слово в пошуку чи вид.')} framed={false} className="-mx-1 -my-3" />
        ) : (
          <Empty icon={MapPinned} title={t('Чужих публічних позначок тут ще немає')} description={t('Коли хтось поділиться позначкою чи записом ресурсу на цій мапі, вони з’являться тут.')} framed={false} className="-mx-1 -my-3" />
        ))}
        {res && res.rows.length > 0 && (
          <ul className={cn('grid grid-cols-[minmax(0,1fr)] transition-opacity', loading && 'opacity-50')} aria-busy={loading}>
            {res.rows.map((r) => item(r, 'list'))}
          </ul>
        )}
        {res && total > PAGE && (
          <div className="flex items-center gap-1 px-1 pt-1">
            <Button size="xs" variant="ghost" disabled={offset === 0} onClick={() => setPg({ key, offset: Math.max(0, offset - PAGE) })} aria-label={t('Попередні')}>
              <ChevronLeft size={14} />
            </Button>
            <span className="flex-1 text-center font-mono text-[11px] text-muted">{t('{from}–{to} з {total}', { from: offset + 1, to: Math.min(total, offset + PAGE), total: fmtN(total) })}</span>
            <Button size="xs" variant="ghost" disabled={offset + PAGE >= total} onClick={() => setPg({ key, offset: offset + PAGE })} aria-label={t('Наступні')}>
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

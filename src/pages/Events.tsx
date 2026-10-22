/**
 * Події спільноти (/events): найближчі (публічні, свої, гільдійські й ті, де людина грає чи дивиться), мої, гільдії,
 * минулі — вкладками сегментом шляху; фільтр за видом і регіоном і пошук — в адресі. Подія — /events/<id>
 * (pages/EventPage), нова й редагування — /events/new, /events/<id>/edit (pages/EventEditor). Список оновлюється сам
 * (живий потік /api/events/stream).
 */
import { useEffect, useRef, useState } from 'react'
import { CalendarDays, CalendarPlus, History, LogIn, SearchX } from 'lucide-react'
import { EVENT_TYPES, listEvents, TYPE_LABEL, type EventRow, type EventsQuery } from '@/lib/events'
import { REGIONS, type Region } from '@/lib/ddReset'
import { loginHref, useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { subscribe } from '@/lib/stream'
import { useUrlParam } from '@/lib/urlState'
import { EVENT_TABS, openPath, pathOf, useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Seg } from '@/components/ui/seg'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorAlert, PageError } from '@/components/states'
import { GuildTag } from '@/components/access/Access'
import { useCrumb } from '@/components/Crumbs'
import { SnInput, SnSelect, SnSkeleton, valueOf } from '@/components/sn'
import { EVENT_GRID, EventCard, useNow } from '@/components/events/bits'
import { EventPage } from './EventPage'
import { EventEditor } from './EventEditor'

/** id — подія (чи «new»), edit — її редагування; без id — список */
export default function Events({ id, edit }: { id: string | null; edit: boolean }) {
  if (id === 'new') return <EventEditor id={null} />
  if (id && edit) return <EventEditor key={id} id={id} />
  if (id) return <EventPage key={id} id={id} />
  return <EventsList />
}

type Tab = 'upcoming' | (typeof EVENT_TABS)[number]

/** нова подія: без входу — спершу вхід (і назад сюди) */
export function newEvent(search = '') {
  if (!useAuth.getState().user) { openPath(`/login?next=${encodeURIComponent('/events/new' + search)}`); return }
  useStore.getState().setView('events', { param: 'new', search })
}

function EventsList() {
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const guild = useAuth((s) => s.guild)
  const sub = useStore((s) => s.sub)
  const setView = useStore((s) => s.setView)
  const raw: Tab = (EVENT_TABS as readonly string[]).includes(sub ?? '') ? (sub as Tab) : 'upcoming'
  // без входу «моїх» нема, без гільдії — «гільдії»
  const tab: Tab = (raw === 'mine' && !user) || (raw === 'guild' && !guild) ? 'upcoming' : raw
  const setTab = (v: Tab) => setView('events', { sub: v === 'upcoming' ? null : v, search: location.search })
  const tabHref = (v: Tab) => pathOf('events', null, false, null, v === 'upcoming' ? null : v) + location.search
  const [type, setType] = useUrlParam<string>('type', '', (v) => (EVENT_TYPES as string[]).includes(v))
  const [region, setRegion, regionHref] = useUrlParam<string>('region', '', (v) => v in REGIONS)
  const [q, setQ] = useUrlParam<string>('q', '')
  const TAB_L: Record<Tab, string> = { upcoming: t('Найближчі'), mine: t('Мої'), guild: t('Гільдія'), past: t('Минулі') }
  useCrumb([], { sub: tab === 'upcoming' ? null : tab, value: TAB_L[tab] })

  const [rows, setRows] = useState<EventRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(true)
  const [more, setMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const gen = useRef(0)
  const query = (): EventsQuery => ({
    when: tab === 'past' ? 'past' : 'upcoming',
    scope: tab === 'mine' ? 'mine' : tab === 'guild' ? 'guild' : 'all',
    guild: tab === 'guild' ? guild?.id : undefined,
    type, region, q: q.trim(),
  })
  useEffect(() => {
    if (!ready) return
    let live = true
    const my = ++gen.current
    setBusy(true)
    const timer = setTimeout(() => {
      listEvents(query())
        .then((r) => { if (live && my === gen.current) { setRows(r.rows); setTotal(r.total); setFailed(false) } })
        .catch(() => live && setFailed(true))
        .finally(() => live && setBusy(false))
    }, q ? 250 : 0)
    return () => { live = false; clearTimeout(timer) }
  }, [tab, type, region, q, ready, attempt, guild?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // хтось створив подію чи зареєструвався — перечитати (не частіше разу на 1,5 с)
  useEffect(() => {
    let h: ReturnType<typeof setTimeout> | null = null
    const again = () => { if (h) return; h = setTimeout(() => { h = null; setAttempt((n) => n + 1) }, 1500) }
    const off = subscribe('/api/events/stream', again, again)
    return () => { off(); if (h) clearTimeout(h) }
  }, [])
  const showMore = async () => {
    const my = gen.current
    setMore(true)
    try {
      const r = await listEvents({ ...query(), offset: rows?.length ?? 0 })
      if (my === gen.current) setRows((cur) => [...(cur ?? []), ...r.rows])
    } catch { if (my === gen.current) setFailed(true) } finally { if (my === gen.current) setMore(false) }
  }
  const now = useNow()
  const filtered = !!(type || region || q.trim())

  const tabs = [
    { id: 'upcoming' as const, label: TAB_L.upcoming },
    ...(user ? [{ id: 'mine' as const, label: TAB_L.mine }] : []),
    ...(guild ? [{ id: 'guild' as const, label: <span className="inline-flex items-center gap-1.5"><GuildTag tag={guild.tag} color={guild.color} />{TAB_L.guild}</span> }] : []),
    { id: 'past' as const, label: TAB_L.past },
  ]
  const empty = filtered ? (
    <Empty icon={SearchX} title={t('Нічого не знайшлося')} description={t('Спробуй інший вид, регіон чи слово.')}>
      <Button variant="secondary" onClick={() => { setType(''); setRegion(''); setQ('') }}>{t('Скинути фільтри')}</Button>
    </Empty>
  ) : tab === 'past' ? (
    <Empty icon={History} title={t('Минулих подій поки нема')} description={t('Тут лишаються події з результатами й переможцями.')} />
  ) : tab === 'mine' ? (
    <Empty icon={CalendarDays} title={t('У тебе поки нема подій')} description={t('Тут — події, які ти влаштовуєш, де береш участь чи які йдеш дивитись.')}>
      <Button onClick={() => newEvent()}><CalendarPlus size={15} />{t('Влаштувати подію')}</Button>
      <Button variant="secondary" onClick={() => setTab('upcoming')}>{t('Найближчі події')}</Button>
    </Empty>
  ) : (
    <Empty icon={CalendarDays} title={tab === 'guild' ? t('У гільдії поки нема подій') : t('Найближчих подій поки нема')} description={t('Влаштуй першу: бій 2 на 2, турнір, перегони чи збір — з часом, призами й місцем для глядачів.')}>
      {ready && (user
        ? <Button onClick={() => newEvent(tab === 'guild' && guild ? `?guild=${guild.id}` : '')}><CalendarPlus size={15} />{t('Влаштувати подію')}</Button>
        : <Button onClick={() => openPath(loginHref())}><LogIn size={15} />{t('Увійти')}</Button>)}
    </Empty>
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={t('Події спільноти')}
          lead={t('Бої 2 на 2, турніри, перегони, вилазки й збори — у визначений час, з призами, місцем на мапі й зоною для глядачів. Реєструйся командою, приходь дивитись або влаштуй свою.')}
          actions={ready ? <Button onClick={() => newEvent(tab === 'guild' && guild ? `?guild=${guild.id}` : '')}><CalendarPlus size={15} />{t('Влаштувати подію')}</Button> : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Seg label={t('Які події')} value={tab} onChange={setTab} href={tabHref} items={tabs} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SnInput type="search" size="lg" className="min-w-[min(240px,100%)] flex-1" modelValue={q} placeholder={t('Пошук за назвою')} accessibilityLabel={t('Пошук подій')} onInput={(e: Event) => setQ(valueOf(e), { replace: true })} />
            <SnSelect size="lg" className="w-[200px] max-w-full" modelValue={type} options={[{ value: '', label: t('Усі види') }, ...EVENT_TYPES.map((x) => ({ value: x, label: TYPE_LABEL[x] }))]} accessibilityLabel={t('Вид події')} onChange={(e: Event) => setType(valueOf(e) || '')} />
            <Seg size="sm" label={t('Регіон')} value={region} onChange={setRegion} href={regionHref} items={[{ id: '', label: t('Усі регіони') }, ...(Object.keys(REGIONS) as Region[]).map((r) => ({ id: r, label: REGIONS[r].label }))]} />
          </div>
        </PageHeader>
        {failed && !rows && <PageError title={t('Події не завантажились')} onRetry={() => { setFailed(false); setAttempt((n) => n + 1) }} />}
        {failed && rows && <ErrorAlert message={t('Список не оновився. Онови сторінку трохи згодом.')} />}
        {!rows && !failed && (
          <ul className={EVENT_GRID} aria-busy="true">{Array.from({ length: 6 }, (_, i) => <li key={i} className="h-[190px] rounded-xl border border-line bg-panel p-3.5"><SnSkeleton lines={4} /></li>)}</ul>
        )}
        {rows && (
          <div className={busy ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={busy}>
            {rows.length ? <ul className={EVENT_GRID}>{rows.map((ev) => <EventCard key={ev.id} ev={ev} now={now} />)}</ul> : empty}
          </div>
        )}
        {rows && rows.length < total && (
          <div className="flex justify-center py-2"><Button variant="secondary" loading={more} onClick={showMore}>{t('Показати ще ({n})', { n: total - rows.length })}</Button></div>
        )}
      </div>
    </div>
  )
}

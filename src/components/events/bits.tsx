/**
 * Шматки сторінок подій: значок виду, стан (скоро / триває / завершено / скасовано), формат, картка події для списків
 * і головної, «зараз» із тиком (відлік до початку), блок найближчих подій на головній.
 */
import { useEffect, useState } from 'react'
import { CalendarDays, CalendarPlus, Castle, ChevronRight, Coins, Eye, Flag, Map as MapIcon, PartyPopper, ShieldHalf, Sparkles, Swords, Trophy, Users, type LucideIcon } from 'lucide-react'
import { fmtServer, fmtShort, formatOf, listEvents, PHASE_LABEL, phaseOf, TYPE_LABEL, type EventRow, type EventType, type Phase } from '@/lib/events'
import { fmtLeft } from '@/lib/ddReset'
import { locale, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { plainClick } from '@/lib/urlState'
import { useStore } from '@/store'
import { AccessBadge, OwnerLink } from '@/components/access/Access'
import { Seg } from '@/components/ui/seg'

export const TYPE_ICON: Record<EventType, LucideIcon> = {
  pvp: Swords, tournament: Trophy, race: Flag, pve: ShieldHalf, spice: Sparkles, build: Castle, trade: Coins, meet: Users, other: PartyPopper,
}

/** «зараз», що тикає: раз на секунду, поки до початку менше години, інакше — раз на хвилину */
export function useNow(fast = false) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), fast ? 1000 : 30_000)
    return () => clearInterval(h)
  }, [fast])
  return now
}

const PHASE_CLS: Record<Phase, string> = {
  cancelled: 'bg-bad/10 text-bad',
  ended: 'bg-panel2 text-muted',
  live: 'bg-ok/15 text-ok',
  soon: 'bg-spice/15 text-spice',
  upcoming: 'bg-panel2 text-ink',
}
export function PhaseChip({ phase, className }: { phase: Phase; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold', PHASE_CLS[phase], className)}>
      {phase === 'live' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" aria-hidden />}
      {PHASE_LABEL[phase]}
    </span>
  )
}

export function TypeChip({ type, className }: { type: EventType; className?: string }) {
  const I = TYPE_ICON[type]
  return <span className={cn('inline-flex items-center gap-1 rounded-full bg-spice/10 px-2 py-0.5 text-[11.5px] font-semibold text-spice', className)}><I size={12} />{TYPE_LABEL[type]}</span>
}

/** день і місяць «листком календаря» */
function DayTile({ ms, dim }: { ms: number; dim?: boolean }) {
  const d = new Date(ms)
  return (
    <span className={cn('grid w-12 shrink-0 overflow-hidden rounded-lg border text-center leading-none', dim ? 'border-line opacity-70' : 'border-spice/40')} aria-hidden>
      <span className={cn('py-1 text-[10px] font-semibold uppercase tracking-wide', dim ? 'bg-panel2 text-muted' : 'bg-spice text-on-spice')}>{d.toLocaleString(locale(), { month: 'short' }).replace('.', '')}</span>
      <span className="py-1.5 font-display text-[19px] font-bold">{d.getDate()}</span>
    </span>
  )
}

/** до початку — відлік, під час — «триває», після — коли було */
function When({ ev, now }: { ev: EventRow; now: number }) {
  const phase = phaseOf(ev, now)
  const server = fmtServer(ev.starts, ev.region)
  return (
    <span className="text-[12.5px] text-muted">
      {fmtShort(ev.starts)}
      {phase === 'upcoming' || phase === 'soon' ? <> · <b className="font-semibold text-ink">{t('через {left}', { left: fmtLeft(ev.starts - now) })}</b></> : null}
      {server && <span className="block text-[11.5px]">{t('сервер: {time}', { time: server })}</span>}
    </span>
  )
}

/** картка події: коли, вид і формат, назва, де, призи, скільки команд і глядачів, чия */
export function EventCard({ ev, now }: { ev: EventRow; now: number }) {
  const setView = useStore((s) => s.setView)
  const phase = phaseOf(ev, now)
  const done = phase === 'ended' || phase === 'cancelled'
  const prize = ev.prizes[0]
  return (
    <li className={cn('group flex h-full flex-col overflow-hidden rounded-xl border bg-panel shadow-sm transition-colors hover:border-spice/60', phase === 'live' ? 'border-ok/50' : 'border-line')}>
      <a href={`/events/${ev.id}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('events', { param: ev.id }) }} className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex items-start gap-3">
          <DayTile ms={ev.starts} dim={done} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <TypeChip type={ev.type} />
              <span className="rounded-full bg-panel2 px-2 py-0.5 text-[11.5px] font-semibold">{formatOf(ev.reg.teamSize)}</span>
              {phase !== 'upcoming' && <PhaseChip phase={phase} />}
            </div>
            <h3 className={cn('mt-1.5 break-words font-display text-[15.5px] font-bold leading-snug group-hover:text-spice', ev.cancelled && 'line-through decoration-1')}>{ev.title}</h3>
            <When ev={ev} now={now} />
          </div>
        </div>
        {(ev.server || ev.place) && (
          <p className="flex items-start gap-1.5 text-[13px] leading-snug text-muted"><MapIcon size={13} className="mt-0.5 shrink-0" /><span className="line-clamp-2">{[ev.server, ev.place].filter(Boolean).join(' · ')}</span></p>
        )}
        {prize && (
          <p className="flex items-start gap-1.5 text-[13px] leading-snug"><Trophy size={13} className="mt-0.5 shrink-0 text-spice" /><span className="line-clamp-1">{prize.label ? `${prize.label}: ${prize.prize}` : prize.prize}{ev.prizes.length > 1 && <span className="text-muted"> {t('і ще {n}', { n: ev.prizes.length - 1 })}</span>}</span></p>
        )}
      </a>
      {/* власник — своїм посиланням, тож поза посиланням картки */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-3.5 py-2.5">
        <AccessBadge visibility={ev.item.visibility} owner={ev.item.owner} />
        <OwnerLink owner={ev.item.owner} />
        <span className="ml-auto flex items-center gap-2.5 text-[12px] tabular-nums text-muted">
          {ev.me?.team && <span className="rounded-full bg-ok/10 px-2 py-0.5 font-semibold text-ok">{t('ти береш участь')}</span>}
          {!ev.me?.team && ev.me?.watching && <span className="rounded-full bg-panel2 px-2 py-0.5 font-semibold">{t('ти дивишся')}</span>}
          <span className="inline-flex items-center gap-1" title={ev.reg.teamSize > 1 ? t('Команд бере участь') : t('Учасників')}>
            <Users size={12} />{ev.counts.confirmed}{ev.reg.slots ? ` / ${ev.reg.slots}` : ''}
          </span>
          <span className="inline-flex items-center gap-1" title={t('Ідуть дивитись')}><Eye size={12} />{ev.counts.watchers}</span>
        </span>
      </div>
    </li>
  )
}

export const EVENT_GRID = 'grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))]'

/** головна: найближчі події (до трьох) і «влаштувати свою»; подій нема — запрошення влаштувати першу */
export function UpcomingEvents({ onNew }: { onNew: () => void }) {
  const [rows, setRows] = useState<EventRow[] | null>(null)
  const setView = useStore((s) => s.setView)
  useEffect(() => { let live = true; listEvents({ when: 'upcoming', limit: 3 }).then((r) => live && setRows(r.rows), () => live && setRows([])); return () => { live = false } }, [])
  const now = useNow()
  if (!rows) return null
  const all = (
    <a href="/events" onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('events') }} className="inline-flex items-center gap-0.5 text-[12.5px] font-medium text-muted hover:text-spice">{t('Усі події')}<ChevronRight size={14} /></a>
  )
  if (!rows.length) {
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sm" aria-labelledby="h-events">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-spice/10 text-spice"><CalendarDays size={19} /></span>
        <div className="min-w-[min(100%,16rem)] flex-1">
          <h2 id="h-events" className="font-display text-[16px] font-bold">{t('Події спільноти')}</h2>
          <p className="text-[13px] leading-snug text-muted">{t('Найближчих подій поки нема. Влаштуй першу: бій 2 на 2, турнір чи перегони — з часом, призами й місцем для глядачів.')}</p>
        </div>
        <button type="button" onClick={onNew} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-spice px-3.5 text-[13px] font-semibold text-on-spice hover:bg-spice/90"><CalendarPlus size={15} />{t('Влаштувати подію')}</button>
        {all}
      </section>
    )
  }
  return (
    <section className="grid gap-2.5" aria-labelledby="h-events">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 id="h-events" className="flex items-center gap-2 font-display text-[16px] font-bold"><CalendarDays size={18} className="text-spice" />{t('Найближчі події')}</h2>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onNew} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-spice hover:underline"><CalendarPlus size={14} />{t('Влаштувати подію')}</button>
          {all}
        </div>
      </div>
      <ul className={EVENT_GRID}>{rows.map((ev) => <EventCard key={ev.id} ev={ev} now={now} />)}</ul>
    </section>
  )
}

/** вкладка «Події» гільдії: найближчі й минулі події, які влаштовує гільдія (чужим — лише публічні) */
export function GuildEvents({ guild, canCreate }: { guild: { id: string; name: string }; canCreate: boolean }) {
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming')
  const [rows, setRows] = useState<EventRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const setView = useStore((s) => s.setView)
  useEffect(() => {
    let live = true
    setRows(null)
    listEvents({ scope: 'guild', guild: guild.id, when, limit: 60 }).then((r) => live && setRows(r.rows), () => live && setFailed(true))
    return () => { live = false }
  }, [guild.id, when])
  const now = useNow()
  return (
    <section className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Seg label={t('Які події')} value={when} onChange={setWhen} items={[{ id: 'upcoming', label: t('Найближчі') }, { id: 'past', label: t('Минулі') }]} />
        {canCreate && <button type="button" onClick={() => setView('events', { param: 'new', search: `?guild=${guild.id}` })} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg bg-spice px-3.5 text-[13px] font-semibold text-on-spice hover:bg-spice/90"><CalendarPlus size={15} />{t('Влаштувати подію гільдії')}</button>}
      </div>
      {failed ? <p className="text-[13.5px] text-muted">{t('Події не завантажились')}</p>
        : !rows ? <ul className={EVENT_GRID} aria-busy="true">{[0, 1, 2].map((i) => <li key={i} className="h-[190px] animate-pulse rounded-xl border border-line bg-panel" />)}</ul>
          : rows.length ? <ul className={EVENT_GRID}>{rows.map((ev) => <EventCard key={ev.id} ev={ev} now={now} />)}</ul>
            : <p className="rounded-xl border border-dashed border-line bg-panel px-4 py-6 text-center text-[13.5px] text-muted">{when === 'past' ? t('Минулих подій гільдії поки нема.') : t('Гільдія поки не влаштовує подій.')}</p>}
    </section>
  )
}

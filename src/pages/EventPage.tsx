/**
 * Сторінка події: коли (відлік, твій час і час серверів регіону), що й за якими правилами, призовий фонд, де (мапа:
 * місце події й зона для глядачів), команди з їхнім статусом, сітка турніру й результати. Реєстрація командою (капітан
 * вписує ніки в грі; согравці з сайту приєднуються посиланням), «Піду дивитись», календар і текст для Discord.
 * Організатор (хто може змінювати подію) підтверджує команди, складає сітку, записує результати, скасовує подію.
 * Сторінка оновлюється сама, коли хтось реєструється (живий потік /api/events/stream).
 */
import { forwardRef, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CalendarCheck, CalendarDays, CalendarPlus, Check, ChevronDown, Clock, Copy, Crown, Download, Eye, ExternalLink, Link2, LogIn, LogOut, Map as MapIcon, Medal,
  MessageSquare, Pencil, Radio, RotateCcw, Share2, Shield, Trash2, Trophy, UserPlus, Users, X, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { placesOf } from '@/engine/bracket.mjs'
import {
  deleteEvent, discordText, dropTeam, fmtDuration, fmtServer, fmtStart, formatOf, getEvent, googleCalendarUrl, joinTeam, joinUrl, leaveTeam, myZone,
  patchTeam, phaseOf, registerTeam, saveEvent, STATUS_LABEL, teamWord, watchEvent, type Bracket, type EventDoc, type EventFull, type Point, type Team, type TeamStatus,
} from '@/lib/events'
import { fmtLeft, REGIONS } from '@/lib/ddReset'
import { loginHref, useAuth } from '@/lib/auth'
import { ApiError } from '@/lib/api'
import { locale, t, T } from '@/lib/i18n'
import { Md } from '@/lib/md'
import { subscribe } from '@/lib/stream'
import { cn } from '@/lib/utils'
import { plainClick } from '@/lib/urlState'
import { openPath, useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ActionsTrigger, Menu, type MenuEntry } from '@/components/ui/menu'
import { confirmAsk } from '@/components/ui/confirm'
import { PageHeader } from '@/components/PageHeader'
import { ErrorAlert, Loading, PageError } from '@/components/states'
import { Avatar, ItemActions, ItemBar, OwnerLink } from '@/components/access/Access'
import { useCrumb } from '@/components/Crumbs'
import { SnInput, SnSelect, SnTextarea, valueOf } from '@/components/sn'
import { Section } from './Account'
import { Field } from './Auth'
import { PhaseChip, TypeChip, useNow } from '@/components/events/bits'
import { BracketView, MakeBracket } from '@/components/events/Bracket'
import { mapHref, PIN_LABEL } from '@/components/events/EventMap'

// мапа (Leaflet і тайли гри) — лише коли в події є точки
const EventMap = lazy(() => import('@/components/events/EventMap'))

const run = async (fn: () => Promise<unknown>, ok?: string) => {
  try { await fn(); if (ok) toast.success(ok); return true } catch (e) { toast.error((e as Error).message); return false }
}
const copyText = (text: string, ok: string) => navigator.clipboard?.writeText(text).then(() => toast.success(ok), () => toast.info(text)) ?? toast.info(text)
const STATUS_CLS: Record<TeamStatus, string> = { confirmed: 'bg-ok/10 text-ok', pending: 'bg-spice/15 text-spice', reserve: 'bg-warn/15 text-warn', rejected: 'bg-panel2 text-muted' }
const MEDAL = ['text-[#c9a227]', 'text-[#9aa4ae]', 'text-[#b06a3b]']

export function EventPage({ id }: { id: string }) {
  const me = useAuth((s) => s.user)
  const setView = useStore((s) => s.setView)
  const [ev, setEv] = useState<EventFull | null>(null)
  const [error, setError] = useState('')
  const [gone, setGone] = useState(false)
  const load = useCallback(() => getEvent(id).then((x) => { setEv(x); setError(''); setGone(false) }).catch((e: ApiError) => { setGone(e.status === 404); setError(e.message) }), [id])
  useEffect(() => { void load() }, [load])
  // хтось зареєструвався чи організатор змінив подію — перечитати (не частіше разу на секунду)
  useEffect(() => {
    let h: ReturnType<typeof setTimeout> | null = null
    const again = () => { if (h) return; h = setTimeout(() => { h = null; void load() }, 1000) }
    return subscribe('/api/events/stream', (d) => { if ((d as { id?: string })?.id === id) again() }, again)
  }, [id, load])
  useCrumb(ev ? [{ label: ev.title }] : error ? [] : null)
  const [dialog, setDialog] = useState<null | 'register' | 'results' | 'cancel' | { team: Team }>(null)
  const [busy, setBusy] = useState(false)
  const now = useNow(!!ev && ev.starts - Date.now() < 3600_000 && ev.starts > Date.now())
  const teamsRef = useRef<HTMLElement>(null)

  if (error) return gone
    ? <PageError page title={t('Такої події нема')} message={t('Її видалили, або вона не для тебе (особиста чи гільдійська). Попроси в організатора посилання.')}><Button variant="secondary" onClick={() => setView('events')}>{t('До подій')}</Button></PageError>
    : <PageError page message={error} onRetry={() => void load()} />
  if (!ev) return <Loading page />

  const phase = phaseOf(ev, now)
  const edit = ev.rights.edit
  const myTeam = ev.teams.find((x) => x.id === ev.me.team) ?? null
  const byId = new Map(ev.teams.map((x) => [x.id, x]))
  const confirmed = ev.teams.filter((x) => x.status === 'confirmed')
  /** зберегти частину документа (з версією, від якої правили): хтось устиг раніше — свіжа версія й повідомлення */
  const save = async (patch: Partial<EventDoc>, ok?: string) => {
    setBusy(true)
    try {
      setEv(await saveEvent(ev.id, { ...patch, base: ev.updated }))
      if (ok) toast.success(ok)
      return true
    } catch (e) {
      const row = (e as ApiError).body as { row?: EventFull } | null
      if ((e as ApiError).status === 409 && row?.row) { setEv(row.row); toast.error(t('Подію щойно змінили — ось нова версія; повтори, будь ласка')) } else toast.error((e as Error).message)
      return false
    } finally { setBusy(false) }
  }
  const watch = () => {
    if (!me) { openPath(loginHref()); return }
    void run(async () => { const r = await watchEvent(ev.id, !ev.me.watching); setEv({ ...ev, me: { ...ev.me, watching: r.watching }, counts: { ...ev.counts, watchers: r.watchers } }) }, ev.me.watching ? t('Більше не дивишся') : t('Чекаємо на тебе серед глядачів'))
  }
  const register = () => { if (!me) openPath(loginHref()); else setDialog('register') }
  const remove = async () => {
    if (!(await confirmAsk({ title: t('Видалити подію «{title}»?', { title: ev.title }), description: t('Разом із командами й глядачами. Повернути не вийде. Якщо подію просто перенесли чи не буде — краще «Скасувати».'), confirm: t('Видалити'), destructive: true }))) return
    if (await run(() => deleteEvent(ev.id), t('Подію видалено'))) setView('events')
  }

  const share: MenuEntry[] = [
    { label: t('Скопіювати посилання'), icon: <Link2 size={14} />, onSelect: () => copyText(`${location.origin}/events/${ev.id}`, t('Посилання скопійовано')) },
    { label: t('Текст для Discord'), icon: <MessageSquare size={14} />, onSelect: () => copyText(discordText(ev), t('Скопійовано: встав у Discord — час кожен побачить свій')) },
    { kind: 'separator' },
    { label: t('У Google Календар'), icon: <CalendarPlus size={14} />, onSelect: () => window.open(googleCalendarUrl(ev), '_blank', 'noopener') },
    { label: t('Файл календаря (.ics)'), icon: <Download size={14} />, onSelect: () => location.assign(`/api/events/${ev.id}/calendar.ics`) },
  ]
  const manage: MenuEntry[] = edit ? [
    { label: t('Редагувати'), icon: <Pencil size={14} />, onSelect: () => setView('events', { param: ev.id, sub: 'edit' }) },
    { label: t('Результати'), icon: <Medal size={14} />, onSelect: () => setDialog('results') },
    ev.cancelled
      ? { label: t('Повернути подію'), icon: <RotateCcw size={14} />, onSelect: () => void save({ cancelled: false }, t('Подію повернуто')) }
      : { label: t('Скасувати подію'), icon: <XCircle size={14} />, onSelect: () => setDialog('cancel') },
    { label: t('Створити схожу'), icon: <Copy size={14} />, onSelect: () => setView('events', { param: 'new', search: `?from=${ev.id}` }) },
    ...(ev.rights.manage ? [{ kind: 'separator' as const }, { label: t('Видалити'), icon: <Trash2 size={14} />, danger: true, onSelect: () => void remove() }] : []),
  ] : me ? [{ label: t('Створити схожу'), icon: <Copy size={14} />, onSelect: () => setView('events', { param: 'new', search: `?from=${ev.id}` }) }] : []

  const regBtn = myTeam ? (
    <Button variant="secondary" onClick={() => teamsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Check size={15} className="text-ok" />{ev.reg.teamSize > 1 ? t('Моя команда') : t('Ти береш участь')}</Button>
  ) : ev.regState === 'open' ? (
    me ? <Button onClick={register}><UserPlus size={15} />{ev.reg.teamSize > 1 ? t('Зареєструвати команду') : t('Зареєструватися')}</Button>
      : <Button onClick={register}><LogIn size={15} />{t('Увійди, щоб зареєструватися')}</Button>
  ) : null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          meta={<><TypeChip type={ev.type} /><span className="rounded-full bg-panel2 px-2 py-0.5 text-[11.5px] font-semibold">{formatOf(ev.reg.teamSize)}</span><PhaseChip phase={phase} /><ItemBar item={ev.item} actions={false} /></>}
          title={<span className={cn(ev.cancelled && 'line-through decoration-2')}>{ev.title}</span>}
          lead={<span>{fmtStart(ev.starts)} · {fmtDuration(ev.duration)}{ev.server && ` · ${ev.server}`}</span>}
          actions={
            <>
              {regBtn}
              {phase !== 'ended' && !ev.cancelled && (
                <Button variant="secondary" onClick={watch} aria-pressed={ev.me.watching} title={me ? undefined : t('Увійди, щоб тебе порахували серед глядачів')}>{me ? <Eye size={15} className={ev.me.watching ? 'text-spice' : ''} /> : <LogIn size={15} />}{ev.me.watching ? t('Ти серед глядачів') : t('Піду дивитись')}</Button>
              )}
              <Menu trigger={<Button variant="secondary" size="sm"><Share2 size={14} />{t('Поділитись')}<ChevronDown size={14} className="opacity-70" /></Button>} items={share} />
              {ev.item.can?.manage && <ItemActions item={ev.item} onChange={(it) => setEv({ ...ev, item: it })} onCopy={null} />}
              {manage.length > 0 && <Menu trigger={<ActionsTrigger />} items={manage} />}
            </>
          }
        />
        <JoinBanner ev={ev} onJoined={setEv} />
        {ev.cancelled && (
          <ErrorAlert title={t('Подію скасовано')} message={ev.cancelNote || t('Організатор скасував подію.')} />
        )}
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-2.5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-w-0 gap-2.5">
            <WhenCard ev={ev} now={now} />
            <Podium ev={ev} byId={byId} edit={edit} onEdit={() => setDialog('results')} />
            {(ev.bracket || (edit && ev.type === 'tournament')) && (
              <Section title={t('Сітка')} hint={edit ? t('Клацни команду, що перемогла в матчі (ще раз — скасувати): наступний раунд заповниться сам.') : undefined}>
                {ev.bracket ? (
                  <div className="grid gap-3">
                    <BracketView bracket={ev.bracket} teams={byId} edit={edit} busy={busy} onChange={(b) => void save({ bracket: b })} />
                    {edit && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={async () => { if (await confirmAsk({ title: t('Прибрати сітку?'), description: t('Усі результати матчів зникнуть. Скласти нову можна будь-коли.'), confirm: t('Прибрати'), destructive: true })) void save({ bracket: null }, t('Сітку прибрано')) }}><X size={14} />{t('Прибрати сітку')}</Button>
                      </div>
                    )}
                  </div>
                ) : <MakeBracket teams={confirmed} busy={busy} onMake={(b: Bracket) => void save({ bracket: b }, t('Сітку складено'))} />}
              </Section>
            )}
            {ev.about && <Section title={t('Про подію')}><Md text={ev.about} /></Section>}
            {ev.rules && <Section title={t('Правила')}><Md text={ev.rules} /></Section>}
            <TeamsSection ref={teamsRef} ev={ev} onChange={setEv} onRegister={register} onEdit={(team) => setDialog({ team })} />
          </div>
          <aside className="grid gap-2.5">
            <Prizes ev={ev} />
            <Where ev={ev} />
            <Spectators ev={ev} onWatch={watch} />
            <Organizer ev={ev} />
          </aside>
        </div>
      </div>
      {dialog === 'register' && <RegisterDialog ev={ev} onClose={() => setDialog(null)} onDone={setEv} />}
      {dialog && typeof dialog === 'object' && <TeamDialog ev={ev} team={dialog.team} onClose={() => setDialog(null)} onDone={setEv} />}
      {dialog === 'results' && <ResultsDialog ev={ev} onClose={() => setDialog(null)} onSave={(results, resultsNote) => save({ results, resultsNote }, t('Результати збережено'))} />}
      {dialog === 'cancel' && <CancelDialog onClose={() => setDialog(null)} onSave={(note) => save({ cancelled: true, cancelNote: note }, t('Подію скасовано'))} />}
    </div>
  )
}

/** коли: відлік до початку (чи «триває», «завершилась»), твій час і час серверів регіону, тривалість, кінець реєстрації */
function WhenCard({ ev, now }: { ev: EventFull; now: number }) {
  const phase = phaseOf(ev, now)
  const server = fmtServer(ev.starts, ev.region)
  const closes = ev.reg.closes ?? ev.starts
  const zone = myZone()
  return (
    <section className={cn('grid gap-3 rounded-xl border p-4 shadow-sm sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)] sm:gap-6', phase === 'live' ? 'border-ok/50 bg-ok/5' : phase === 'soon' ? 'border-spice/50 bg-spice/5' : 'border-line bg-panel')} aria-labelledby="h-when">
      <div className="grid content-start gap-1.5">
        <h2 id="h-when" className="flex items-center gap-2 text-[13px] text-muted"><Clock size={15} className="text-spice" />
          {phase === 'live' ? t('Триває — до кінця') : phase === 'ended' ? t('Подія завершилась') : phase === 'cancelled' ? t('Подію скасовано') : t('До початку')}
        </h2>
        <b className="font-mono text-[30px] font-semibold leading-none tabular-nums">
          {phase === 'live' ? fmtLeft(ev.ends - now) : phase === 'upcoming' || phase === 'soon' ? fmtLeft(ev.starts - now) : new Date(ev.ends).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}
        </b>
      </div>
      <dl className="grid gap-x-5 gap-y-2 text-[13.5px] sm:grid-cols-2">
        <div><dt className="text-[12px] text-muted">{zone ? t('Початок — твій час ({zone})', { zone }) : t('Початок — твій час')}</dt><dd className="font-semibold">{fmtStart(ev.starts)}</dd></div>
        {server && <div><dt className="text-[12px] text-muted">{t('За часом серверів: {region}', { region: REGIONS[ev.region as keyof typeof REGIONS].label })}</dt><dd className="font-semibold">{server}</dd></div>}
        <div><dt className="text-[12px] text-muted">{t('Тривалість')}</dt><dd className="font-semibold">{fmtDuration(ev.duration)}</dd></div>
        <div>
          <dt className="text-[12px] text-muted">{t('Реєстрація')}</dt>
          <dd className="font-semibold">
            {ev.regState === 'open' ? t('відкрита до {when}', { when: fmtStart(closes) }) : ev.regState === 'closed' ? t('закрита') : '—'}
          </dd>
        </div>
      </dl>
    </section>
  )
}

/** результати: місця з призами — записані організатором, а нема — з завершеної сітки */
function Podium({ ev, byId, edit, onEdit }: { ev: EventFull; byId: Map<string, Team>; edit: boolean; onEdit: () => void }) {
  const places = useMemo(() => {
    const name = (id: string | null, fallback = '') => (id ? byId.get(id)?.name || fallback || t('Команду знято') : fallback)
    if (ev.results.length) return ev.results.map((r) => [name(r.team, r.name)])
    if (ev.bracket) return placesOf(ev.bracket.seed, ev.bracket.picks).map((ids) => ids.map((x) => name(x))).filter((l) => l.length)
    return []
  }, [ev.results, ev.bracket, byId])
  if (!places.length) {
    if (!edit || phaseOf(ev) !== 'ended') return null
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line bg-panel px-4 py-3">
        <Medal size={18} className="text-spice" />
        <p className="min-w-[min(100%,16rem)] flex-1 text-[13.5px]">{t('Подія завершилась — запиши переможців, і вони з’являться тут разом із призами.')}</p>
        <Button size="sm" onClick={onEdit}>{t('Записати результати')}</Button>
      </div>
    )
  }
  return (
    <Section title={t('Результати')}>
      <ol className="grid gap-2">
        {places.map((names, i) => (
          <li key={i} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2.5', i === 0 ? 'border-spice/50 bg-spice/10' : 'border-line')}>
            <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full bg-panel2 font-display text-[15px] font-bold', MEDAL[i])}>{i < 3 ? <Trophy size={17} /> : i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="break-words font-display text-[15px] font-bold">{names.join(' · ')}</div>
              {/* приз за це місце; назва — лише своя («MVP»), «N місце» вже праворуч */}
              {ev.prizes[i] && <div className="text-[12.5px] text-muted">{ev.prizes[i].label && ev.prizes[i].label !== t('{n} місце', { n: i + 1 }) ? `${ev.prizes[i].label}: ` : ''}{ev.prizes[i].prize}</div>}
            </div>
            <span className="shrink-0 text-[12px] font-semibold text-muted">{t('{n} місце', { n: i + 1 })}</span>
          </li>
        ))}
      </ol>
      {ev.resultsNote && <p className="mt-3 whitespace-pre-line text-[13px] text-muted">{ev.resultsNote}</p>}
      {edit && <div className="mt-3"><Button size="sm" variant="ghost" onClick={onEdit}><Pencil size={13} />{t('Змінити результати')}</Button></div>}
    </Section>
  )
}

/** запрошення в команду за посиланням капітана (?join=<команда>.<код>): приєднатися одним кліком */
function JoinBanner({ ev, onJoined }: { ev: EventFull; onJoined: (e: EventFull) => void }) {
  const me = useAuth((s) => s.user)
  const [param, setParam] = useState(() => new URLSearchParams(location.search).get('join'))
  /** склад повний, а ніки вписав капітан: «хто з них ти?» */
  const [pick, setPick] = useState<{ i: number; nick: string }[] | null>(null)
  const [tid, code] = (param ?? '').split('.')
  if (!param || !tid || !code || ev.me.team === tid) return null
  const team = ev.teams.find((x) => x.id === tid)
  const close = () => {
    const q = new URLSearchParams(location.search)
    q.delete('join')
    history.replaceState(history.state, '', location.pathname + (q.toString() ? `?${q}` : ''))
    setParam(null)
  }
  const join = async (slot?: number) => {
    try {
      onJoined(await joinTeam(ev.id, tid, code, slot))
      close()
      toast.success(t('Ти в команді'))
    } catch (e) {
      const body = (e as ApiError).body as { pick?: { i: number; nick: string }[] } | null
      if (body?.pick?.length) setPick(body.pick)
      else toast.error((e as Error).message)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-spice/50 bg-spice/10 px-4 py-3">
      <Users size={18} className="shrink-0 text-spice" />
      <p className="min-w-[min(100%,16rem)] flex-1 text-[13.5px] leading-snug">
        {team ? <T text="Тебе кличуть у команду {name}." name={<b>«{team.name}»</b>} /> : t('Тебе кличуть у команду цієї події.')}{' '}
        {ev.me.team ? t('Ти вже в іншій команді цієї події — спершу вийди з неї.') : pick ? t('Капітан уже вписав ніки всіх гравців. Хто з них ти?') : t('Якщо капітан вписав твій нік у грі, займеш своє місце; інакше — вільне.')}
      </p>
      {!ev.me.team && (pick
        ? <span className="flex flex-wrap gap-1.5">{pick.map((x) => <Button key={x.i} size="sm" variant="secondary" onClick={() => void join(x.i)}>{x.nick}</Button>)}</span>
        : me ? <Button size="sm" onClick={() => void join()}>{t('Приєднатися')}</Button> : <Button size="sm" onClick={() => openPath(loginHref())}>{t('Увійти, щоб приєднатися')}</Button>)}
      <Button size="sm" variant="ghost" onClick={close} aria-label={t('Сховати')}><X size={14} /></Button>
    </div>
  )
}

/** команди: бере участь → чекає рішення → резерв → відхилено; дії капітана, гравця й організатора */
const TeamsSection = forwardRef<HTMLElement, { ev: EventFull; onChange: (e: EventFull) => void; onRegister: () => void; onEdit: (t: Team) => void }>(function TeamsSection({ ev, onChange, onRegister, onEdit }, ref) {
  const me = useAuth((s) => s.user)
  const order: TeamStatus[] = ['confirmed', 'pending', 'reserve', 'rejected']
  const list = [...ev.teams].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.created - b.created)
  const solo = ev.reg.teamSize === 1
  const status = (team: Team, s: TeamStatus) => run(async () => onChange(await patchTeam(ev.id, team.id, { status: s })), t('{name}: {status}', { name: team.name, status: STATUS_LABEL[s] }))
  const drop = async (team: Team, mine: boolean) => {
    const ok = await confirmAsk({
      title: mine ? (solo ? t('Знятися з події?') : t('Зняти команду «{name}» з події?', { name: team.name })) : t('Прибрати «{name}» з події?', { name: team.name }),
      description: t('Місце звільниться — його займе наступний із резерву.'),
      confirm: mine ? t('Знятися') : t('Прибрати'), destructive: true,
    })
    if (ok) void run(async () => onChange(await dropTeam(ev.id, team.id)), mine ? t('Ти знявся з події') : t('Прибрано'))
  }
  const leave = (team: Team) => run(async () => onChange(await leaveTeam(ev.id, team.id)), t('Ти вийшов з команди'))
  const counts = ev.reg.slots ? t('{n} з {max}', { n: ev.counts.confirmed, max: ev.reg.slots }) : String(ev.counts.confirmed)
  return (
    <section ref={ref} className="scroll-mt-3 rounded-xl border border-line bg-panel p-4 shadow-sm sm:p-5" aria-labelledby="h-teams">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="h-teams" className="font-display text-[16px] font-bold">{teamWord(ev.reg.teamSize)} <span className="font-sans text-[14px] font-normal tabular-nums text-muted">{counts}</span></h2>
        {ev.counts.reserve > 0 && <span className="text-[12.5px] text-muted">{t('у резерві: {n}', { n: ev.counts.reserve })}</span>}
        {ev.rights.edit && ev.counts.pending > 0 && <span className="rounded-full bg-spice/15 px-2 py-0.5 text-[12px] font-semibold text-spice">{t('чекають рішення: {n}', { n: ev.counts.pending })}</span>}
        {ev.regState === 'open' && !ev.me.team && (me
          ? <Button size="sm" className="ml-auto" onClick={onRegister}><UserPlus size={14} />{solo ? t('Зареєструватися') : t('Зареєструвати команду')}</Button>
          : <Button size="sm" className="ml-auto" onClick={onRegister}><LogIn size={14} />{t('Увійди, щоб зареєструватися')}</Button>)}
      </div>
      <p className="mt-1 text-[13px] leading-snug text-muted">
        {[
          solo ? t('Кожен сам за себе.') : t('Формат — {format}.', { format: formatOf(ev.reg.teamSize) }),
          ev.reg.slots ? t('Місць: {n}; далі — резерв, звільниться місце — перший із резерву проходить.', { n: ev.reg.slots }) : t('Місць без обмежень.'),
          ev.reg.approval ? t('Склад підтверджує організатор.') : '',
        ].filter(Boolean).join(' ')}
      </p>
      {!list.length ? (
        <p className="mt-3 text-[13.5px] text-muted">{ev.regState === 'open' ? t('Поки ніхто не зареєструвався — будь першим.') : t('Ніхто не реєструвався.')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {list.map((team) => {
            const captain = !!me && team.captain?.id === me.id
            const missing = ev.reg.teamSize - team.members.length
            const more: MenuEntry[] = ev.rights.edit ? [
              ...(team.status !== 'confirmed' ? [{ label: t('Підтвердити'), icon: <Check size={14} />, onSelect: () => void status(team, 'confirmed') }] : []),
              ...(team.status !== 'reserve' ? [{ label: t('У резерв'), icon: <Clock size={14} />, onSelect: () => void status(team, 'reserve') }] : []),
              ...(team.status !== 'pending' ? [{ label: t('На розгляд'), icon: <RotateCcw size={14} />, onSelect: () => void status(team, 'pending') }] : []),
              ...(team.status !== 'rejected' ? [{ label: t('Відхилити'), icon: <XCircle size={14} />, onSelect: () => void status(team, 'rejected') }] : []),
              { kind: 'separator' as const },
              { label: t('Змінити склад'), icon: <Pencil size={14} />, onSelect: () => onEdit(team) },
              { label: t('Прибрати з події'), icon: <Trash2 size={14} />, danger: true, onSelect: () => void drop(team, false) },
            ] : []
            return (
              <li key={team.id} className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 py-3', team.status === 'rejected' && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words text-[14.5px] font-semibold">{team.name}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', STATUS_CLS[team.status])}>{STATUS_LABEL[team.status]}</span>
                    {team.mine && <span className="text-[12px] font-semibold text-spice">{captain ? t('ти капітан') : t('твоя команда')}</span>}
                  </div>
                  {!solo && (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={t('Гравці')}>
                      {team.members.map((m, i) => (
                        <li key={i} className="inline-flex items-center gap-1.5 rounded-full bg-panel2 py-0.5 pl-1 pr-2.5 text-[12.5px]">
                          {m.user ? <Avatar name={m.user.name} color={m.user.color} size={18} /> : <span className="h-[18px] w-[18px] rounded-full border border-dashed border-line" aria-hidden />}
                          {m.nick}
                          {team.captain && m.user?.id === team.captain.id && <Crown size={11} className="text-spice" aria-label={t('Капітан')} />}
                        </li>
                      ))}
                      {missing > 0 && <li className="inline-flex items-center rounded-full border border-dashed border-line px-2.5 py-0.5 text-[12px] text-muted">{t('ще {n} вільно', { n: missing })}</li>}
                    </ul>
                  )}
                  {team.note && <p className="mt-1.5 text-[12.5px] text-muted">«{team.note}»</p>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {captain && !solo && team.code && (missing > 0 || team.members.some((m) => !m.user)) && (
                    <Button size="sm" variant="secondary" onClick={() => copyText(joinUrl(ev.id, team), t('Посилання в команду скопійовано — дай його согравцям'))} title={t('Согравці з сайту приєднаються за ним і побачать подію в «Моїх»')}><Link2 size={14} />{t('Посилання в команду')}</Button>
                  )}
                  {captain && !ev.rights.edit && <Button size="sm" variant="ghost" onClick={() => onEdit(team)}><Pencil size={14} />{t('Змінити')}</Button>}
                  {captain && <Button size="sm" variant="ghost" onClick={() => void drop(team, true)}><LogOut size={14} />{t('Знятися')}</Button>}
                  {team.mine && !captain && <Button size="sm" variant="ghost" onClick={() => void leave(team)}><LogOut size={14} />{t('Вийти з команди')}</Button>}
                  {more.length > 0 && <Menu trigger={<Button size="sm" variant="ghost" aria-label={t('Дії з командою')}><Shield size={14} /><ChevronDown size={13} /></Button>} items={more} />}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
})

function Prizes({ ev }: { ev: EventFull }) {
  if (!ev.prizes.length && !ev.fee) return null
  return (
    <Section title={t('Призовий фонд')}>
      {ev.prizes.length > 0 && (
        <ol className="grid gap-2">
          {ev.prizes.map((p, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <Trophy size={16} className={cn('mt-0.5 shrink-0', MEDAL[i] ?? 'text-muted')} />
              <div className="min-w-0 text-[13.5px] leading-snug">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">{p.label || t('{n} місце', { n: i + 1 })}</div>
                <div className="break-words font-semibold">{p.prize}</div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {ev.fee && <p className={cn('text-[13px]', ev.prizes.length && 'mt-3 border-t border-line pt-3')}><span className="text-muted">{t('Внесок')}:</span> <b className="font-semibold">{ev.fee}</b></p>}
    </Section>
  )
}

/** точка на мапі сайту — посиланням (мапа підлетить і поставить мітку) */
function PointLink({ p, label }: { p: Point; label: string }) {
  const href = mapHref(p)
  return <a href={href} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); openPath(href) }} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-spice hover:underline"><MapIcon size={13} />{label}</a>
}

function Where({ ev }: { ev: EventFull }) {
  if (!ev.server && !ev.place && !ev.arena && !ev.watch && !ev.region) return null
  return (
    <Section title={t('Де')}>
      <dl className="grid gap-2 text-[13.5px]">
        {(ev.server || ev.region) && <div><dt className="text-[12px] text-muted">{t('Сервер')}</dt><dd className="font-semibold">{[ev.server, ev.region && REGIONS[ev.region].label].filter(Boolean).join(' · ')}</dd></div>}
        {ev.place && <div><dt className="text-[12px] text-muted">{t('Місце')}</dt><dd className="whitespace-pre-line">{ev.place}</dd></div>}
      </dl>
      {(ev.arena || ev.watch) && (
        <div className="mt-3 grid gap-2">
          <Suspense fallback={<div className="h-[240px] animate-pulse rounded-lg bg-panel2" />}>
            <EventMap arena={ev.arena} watch={ev.watch} className="h-[240px]" />
          </Suspense>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {ev.arena && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-spice" aria-hidden /><PointLink p={ev.arena} label={PIN_LABEL.arena} /></span>}
            {ev.watch && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#2f9e8f]" aria-hidden /><PointLink p={ev.watch} label={PIN_LABEL.watch} /></span>}
          </div>
        </div>
      )}
    </Section>
  )
}

function Spectators({ ev, onWatch }: { ev: EventFull; onWatch: () => void }) {
  const me = useAuth((s) => s.user)
  const open = !ev.cancelled && phaseOf(ev) !== 'ended'
  return (
    <Section title={t('Глядачам')}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-spice/10 text-spice"><Eye size={18} /></span>
        <div className="min-w-0 flex-1 text-[13.5px]">
          <div className="font-mono text-[20px] font-semibold leading-none tabular-nums">{ev.counts.watchers}</div>
          <div className="text-[12.5px] text-muted">{t('ідуть дивитись')}</div>
        </div>
        {open && (me
          ? <Button size="sm" variant={ev.me.watching ? 'secondary' : 'default'} onClick={onWatch} aria-pressed={ev.me.watching}>{ev.me.watching ? <><Check size={14} />{t('Іду')}</> : t('Піду дивитись')}</Button>
          : <Button size="sm" variant="secondary" onClick={onWatch}><LogIn size={14} />{t('Увійди, щоб піти дивитись')}</Button>)}
      </div>
      {ev.watchNote && <p className="mt-3 whitespace-pre-line border-t border-line pt-3 text-[13px] leading-snug">{ev.watchNote}</p>}
      {ev.watch && <div className="mt-2"><PointLink p={ev.watch} label={t('Зона для глядачів на мапі')} /></div>}
      {ev.stream && (
        <a href={ev.stream} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] font-semibold hover:border-spice/50 hover:text-spice">
          <Radio size={15} className="text-bad" />{t('Трансляція')}<ExternalLink size={13} className="ml-auto text-muted" />
        </a>
      )}
    </Section>
  )
}

function Organizer({ ev }: { ev: EventFull }) {
  return (
    <Section title={t('Організатор')}>
      <div className="grid gap-2 text-[13.5px]">
        <OwnerLink owner={ev.item.owner} />
        {ev.contact && <p className="whitespace-pre-line"><span className="text-muted">{t('Зв’язок')}:</span> {ev.contact}</p>}
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button size="sm" variant="secondary" href={googleCalendarUrl(ev)}><CalendarCheck size={14} />{t('Google Календар')}</Button>
          <Button size="sm" variant="secondary" href={`/api/events/${ev.id}/calendar.ics`}><CalendarDays size={14} />.ics</Button>
        </div>
      </div>
    </Section>
  )
}

/** реєстрація: назва команди й ніки в грі (перший — твій); соло — лише твій нік */
function RegisterDialog({ ev, onClose, onDone }: { ev: EventFull; onClose: () => void; onDone: (e: EventFull) => void }) {
  const me = useAuth((s) => s.user)
  const size = ev.reg.teamSize
  const [name, setName] = useState('')
  const [nicks, setNicks] = useState<string[]>(() => [me?.nick || '', ...Array.from({ length: size - 1 }, () => '')])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true); setError('')
    try {
      const r = await registerTeam(ev.id, { name: name.trim(), members: nicks.map((x) => x.trim()).filter(Boolean), note: note.trim() })
      const mine = r.teams.find((x) => x.id === r.me.team)
      toast.success(mine?.status === 'reserve' ? t('Місць нема — ти в резерві') : mine?.status === 'pending' ? t('Заявку подано — чекай рішення організатора') : t('Зареєстровано — до зустрічі на події'),
        size > 1 ? { description: t('Дай согравцям посилання в команду (кнопка біля команди) — вони приєднаються самі.') } : undefined)
      onDone(r)
      onClose()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal open onOpenChange={onClose} title={size > 1 ? t('Реєстрація команди') : t('Реєстрація')} description={ev.title}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button><Button loading={busy} onClick={go}>{t('Зареєструвати')}</Button></>}>
      <div className="grid gap-3.5">
        {size > 1 && (
          <Field label={t('Назва команди')}>
            <SnInput size="lg" modelValue={name} maxLength={40} accessibilityLabel={t('Назва команди')} onInput={(e: Event) => setName(valueOf(e))} />
          </Field>
        )}
        <div className="grid gap-1.5">
          <span className="text-[13px] font-semibold">{size > 1 ? t('Гравці — ніки в грі') : t('Твій нік у грі')}</span>
          {nicks.map((n, i) => (
            <SnInput key={i} size="lg" modelValue={n} maxLength={40} placeholder={i === 0 ? t('Твій нік у грі') : t('Нік согравця (можна пізніше)')} accessibilityLabel={t('Гравець {n}', { n: i + 1 })}
              onInput={(e: Event) => setNicks((l) => l.map((x, j) => (j === i ? valueOf(e) : x)))} />
          ))}
          {size > 1 && <p className="text-[12.5px] leading-snug text-muted">{t('Не всі гравці мають бути на сайті: впиши їхні ніки в грі. Тим, хто є на сайті, потім даси посилання в команду — вони займуть своє місце й побачать подію в «Моїх».')}</p>}
        </div>
        <Field label={t('Примітка для організатора')} hint={t('Необов’язково')}>
          <SnTextarea size="lg" rows={2} modelValue={note} maxLength={300} accessibilityLabel={t('Примітка для організатора')} onInput={(e: Event) => setNote(valueOf(e))} />
        </Field>
        {ev.rules && <p className="text-[12.5px] text-muted">{t('Реєструючись, погоджуєшся з правилами події.')}</p>}
        {error && <ErrorAlert message={error} />}
      </div>
    </Modal>
  )
}

/** змінити команду: назва, ніки (гравці з сайту лишаються на своїх місцях), примітка — капітан чи організатор */
function TeamDialog({ ev, team, onClose, onDone }: { ev: EventFull; team: Team; onClose: () => void; onDone: (e: EventFull) => void }) {
  const size = ev.reg.teamSize
  const [name, setName] = useState(team.name)
  const [rows, setRows] = useState(() => [...team.members.map((m) => ({ nick: m.nick, user: m.user })), ...Array.from({ length: Math.max(0, size - team.members.length) }, () => ({ nick: '', user: null }))])
  const [note, setNote] = useState(team.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true); setError('')
    try {
      onDone(await patchTeam(ev.id, team.id, { ...(size > 1 ? { name: name.trim() } : {}), members: rows.filter((r) => r.nick.trim()).map((r) => ({ nick: r.nick.trim(), user: r.user?.id ?? null })), note: note.trim() }))
      toast.success(t('Збережено'))
      onClose()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal open onOpenChange={onClose} title={t('Команда «{name}»', { name: team.name })}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button><Button loading={busy} onClick={go}>{t('Зберегти')}</Button></>}>
      <div className="grid gap-3.5">
        {size > 1 && <Field label={t('Назва команди')}><SnInput size="lg" modelValue={name} maxLength={40} accessibilityLabel={t('Назва команди')} onInput={(e: Event) => setName(valueOf(e))} /></Field>}
        <div className="grid gap-1.5">
          <span className="text-[13px] font-semibold">{t('Гравці — ніки в грі')}</span>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              {r.user ? <Avatar name={r.user.name} color={r.user.color} size={24} /> : <span className="h-6 w-6 shrink-0 rounded-full border border-dashed border-line" aria-hidden />}
              <SnInput size="lg" className="min-w-0 flex-1" modelValue={r.nick} maxLength={40} placeholder={t('Нік у грі')} accessibilityLabel={t('Гравець {n}', { n: i + 1 })}
                onInput={(e: Event) => setRows((l) => l.map((x, j) => (j === i ? { ...x, nick: valueOf(e) } : x)))} />
              {r.user && r.user.id !== team.captain?.id && (
                <Button size="sm" variant="ghost" aria-label={t('Звільнити місце')} title={t('Звільнити місце')} onClick={() => setRows((l) => l.map((x, j) => (j === i ? { nick: '', user: null } : x)))}><X size={14} /></Button>
              )}
            </div>
          ))}
          <p className="text-[12.5px] text-muted">{t('Гравці з сайту (з аватаркою) лишаються на своїх місцях, доки ти їх не звільниш. Капітан — завжди в команді.')}</p>
        </div>
        <Field label={t('Примітка для організатора')}><SnTextarea size="lg" rows={2} modelValue={note} maxLength={300} accessibilityLabel={t('Примітка для організатора')} onInput={(e: Event) => setNote(valueOf(e))} /></Field>
        {error && <ErrorAlert message={error} />}
      </div>
    </Modal>
  )
}

/** результати: хто на якому місці (команда події чи вписане вручну), підсумок; «Взяти з сітки» — місця з сітки */
function ResultsDialog({ ev, onClose, onSave }: { ev: EventFull; onClose: () => void; onSave: (r: EventDoc['results'], note: string) => Promise<boolean> }) {
  const n = Math.max(3, ev.prizes.length, ev.results.length)
  const [rows, setRows] = useState(() => Array.from({ length: n }, (_, i) => ({ team: ev.results[i]?.team ?? '', name: ev.results[i]?.name ?? '' })))
  const [note, setNote] = useState(ev.resultsNote)
  const [busy, setBusy] = useState(false)
  const teams = ev.teams.filter((x) => x.status !== 'rejected')
  const fromBracket = () => {
    if (!ev.bracket) return
    const p = placesOf(ev.bracket.seed, ev.bracket.picks)
    // треті місця з півфіналу — обидва
    const flat = [p[0][0], p[1][0], ...p[2]].map((x) => x ?? '')
    setRows((l) => l.map((r, i) => ({ team: flat[i] ?? r.team, name: flat[i] ? '' : r.name })))
  }
  const go = async () => {
    setBusy(true)
    const results = rows.filter((r) => r.team || r.name.trim()).map((r) => ({ team: r.team || null, name: r.team ? '' : r.name.trim() }))
    if (await onSave(results, note.trim())) onClose()
    setBusy(false)
  }
  return (
    <Modal open size="lg" onOpenChange={onClose} title={t('Результати')} description={t('Хто на якому місці — поруч з’являться призи за ці місця.')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button><Button loading={busy} onClick={go}>{t('Зберегти')}</Button></>}>
      <div className="grid gap-3">
        {ev.bracket && <div><Button size="sm" variant="secondary" onClick={fromBracket}><Trophy size={14} />{t('Взяти з сітки')}</Button></div>}
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)]">
            <span className={cn('font-display text-[15px] font-bold', MEDAL[i])}>{i + 1}</span>
            <SnSelect size="lg" modelValue={r.team} options={[{ value: '', label: t('— вписати вручну —') }, ...teams.map((x) => ({ value: x.id, label: x.name }))]} accessibilityLabel={t('{n} місце', { n: i + 1 })}
              onChange={(e: Event) => setRows((l) => l.map((x, j) => (j === i ? { ...x, team: valueOf(e) || '' } : x)))} />
            {!r.team && <SnInput size="lg" className="col-span-2 sm:col-span-1" modelValue={r.name} maxLength={80} placeholder={ev.prizes[i]?.label || t('Хто (нік чи команда)')} accessibilityLabel={t('Хто на {n} місці', { n: i + 1 })}
              onInput={(e: Event) => setRows((l) => l.map((x, j) => (j === i ? { ...x, name: valueOf(e) } : x)))} />}
          </div>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setRows((l) => [...l, { team: '', name: '' }])} disabled={rows.length >= 16}>{t('Ще місце')}</Button>
        <Field label={t('Підсумок')} hint={t('Як пройшло, найкращі моменти, подяки')}>
          <SnTextarea size="lg" rows={3} modelValue={note} maxLength={1000} accessibilityLabel={t('Підсумок')} onInput={(e: Event) => setNote(valueOf(e))} />
        </Field>
      </div>
    </Modal>
  )
}

function CancelDialog({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => Promise<boolean> }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal open size="sm" onOpenChange={onClose} title={t('Скасувати подію?')} description={t('Подія лишиться на сайті з позначкою «Скасовано» і причиною; реєстрацію буде закрито. Повернути можна будь-коли.')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Не скасовувати')}</Button><Button variant="destructive" loading={busy} onClick={async () => { setBusy(true); if (await onSave(note.trim())) onClose(); setBusy(false) }}>{t('Скасувати подію')}</Button></>}>
      <Field label={t('Причина')}><SnTextarea size="lg" rows={2} modelValue={note} maxLength={300} placeholder={t('Напр.: перенесли на наступну суботу')} accessibilityLabel={t('Причина')} onInput={(e: Event) => setNote(valueOf(e))} /></Field>
    </Modal>
  )
}

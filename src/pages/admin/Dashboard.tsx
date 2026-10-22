/**
 * Огляд панелі: люди (усього, нові, активні, заблоковані), гільдії й заявки, вміст за видами, оголошення, дані гри
 * (коли зібрано), переклади (скільки готово кожною мовою), реєстрації за 30 днів, останні дії й новенькі.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { SnBadge, SnSkeleton } from '@/components/sn'
import { get } from '@/lib/api'
import { LANGS, locale, t } from '@/lib/i18n'
import { Avatar } from '@/components/access/Access'
import { adminHref, adminLink, goAdmin, resourceOf, type Row } from './api'
import { plainClick } from '@/lib/urlState'
import { ValueView, fmtDate, textOf } from './fields'
import { PageHeader, Panel } from './ui'

interface Overview {
  users: { total: number; week: number; active: number; banned: number; perDay: { day: number; n: number }[] }
  sessions: number
  guilds: { total: number; requests: number }
  items: Record<string, number>
  public: number
  announcements: { live: number; scheduled: number }
  game: { counts: Record<string, number>; catalogSynced: string | null; skillsSynced: string | null; syncing: { catalog: boolean; skills: boolean } }
  i18n: { lang: string; total: number; done: number }[]
  texts: { lang: string; kind: string; n: number }[]
  /** рядки «Журналу дій» — як у його таблиці (з підписами й посиланнями) */
  audit: Row[]
  recent: { id: string; login: string; name: string; color: string; created: number }[]
  cron: { key: string; name: string; enabled: number; last_run: number | null; last_status: string | null; last_ms: number | null; next_run: number | null; runs: number; fails: number }[]
  running: string[]
}

function Stat({ label, value, hint, to }: { label: string; value: ReactNode; hint?: ReactNode; to?: string[] }) {
  const body = (
    <>
      <div className="text-[12.5px] text-muted">{label}</div>
      <div className="mt-1 font-display text-[26px] font-bold leading-none tabular-nums">{typeof value === 'number' ? value.toLocaleString(locale()) : value}</div>
      {hint && <div className="mt-1.5 text-[12px] text-muted">{hint}</div>}
    </>
  )
  const cls = 'block rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sm transition-colors'
  // картка веде в розділ, лише якщо людина його бачить
  return to && resourceOf(to[0]) ? <a href={adminHref(to)} onClick={adminLink(to)} className={cls + ' hover:border-spice/50'}>{body}</a> : <div className={cls}>{body}</div>
}

/** стовпчики реєстрацій по днях */
function Bars({ data }: { data: { day: number; n: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.n))
  return (
    <div className="flex h-28 items-end gap-[3px]" role="img" aria-label={t('Реєстрації за 30 днів')}>
      {data.map((d) => (
        <div key={d.day} className="group relative flex-1" style={{ height: '100%' }}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-sm bg-spice/70 transition-colors group-hover:bg-spice" style={{ height: `${Math.max(d.n ? 6 : 2, (d.n / max) * 100)}%`, opacity: d.n ? 1 : 0.35 }} data-tip={`${new Date(d.day).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}: ${d.n}`} />
        </div>
      ))}
    </div>
  )
}

const KIND_RES: Record<string, [string, string]> = { base: ['bases', 'Бази'], roadmap: ['roadmaps', 'Роадмапи'], build: ['builds', 'Білди'], calc: ['calcs', 'Розрахунки'], marker: ['markers', 'Позначки на мапі'], place: ['places', 'Записи ресурсів'] }
const GAME_RES: Record<string, [string, string]> = { item: ['game-items', 'Предмети'], placeable: ['game-placeables', 'Пристрої'], recipe: ['game-recipes', 'Рецепти'], buildable: ['game-buildables', 'Будівельні елементи'], skill: ['game-skills', 'Уміння'] }

export function Dashboard() {
  const [d, setD] = useState<Overview | null>(null)
  const [err, setErr] = useState('')
  // tz — щоб графік ділився на дні так, як їх бачить людина
  useEffect(() => { get<Overview>(`/api/admin/overview?tz=${new Date().getTimezoneOffset()}`).then(setD).catch((e) => setErr((e as Error).message)) }, [])
  if (err) return <Panel><p className="text-bad">{err}</p></Panel>
  if (!d) return <div className="grid gap-3"><SnSkeleton height={40} width="30%" /><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <SnSkeleton key={i} height={90} />)}</div><SnSkeleton lines={6} /></div>
  const langName = (c: string) => LANGS.find((l) => l.code === c)?.name ?? c
  const textsBy = (lang: string) => d.texts.filter((x) => x.lang === lang).reduce((s, x) => s + Number(x.n), 0)
  const gameTotal = Object.values(d.game.counts).reduce((s, n) => s + n, 0)

  return (
    <div className="grid gap-4">
      <PageHeader title={t('Огляд')} about={t('Що відбувається на сайті: люди, гільдії, вміст, дані гри й переклади.')} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('Людей')} value={d.users.total} hint={t('нових за тиждень: {n} · за добу були: {a}', { n: d.users.week, a: d.users.active })} to={['users']} />
        <Stat label={t('Гільдій')} value={d.guilds.total} hint={d.guilds.requests ? t('заявок чекає: {n}', { n: d.guilds.requests }) : t('заявок немає')} to={['guilds']} />
        <Stat label={t('Речей у реєстрі')} value={Object.values(d.items).reduce((s, n) => s + n, 0)} hint={t('публічних: {n}', { n: d.public })} to={['items']} />
        <Stat label={t('Оголошення')} value={d.announcements.live} hint={t('показуються зараз · заплановано: {n}', { n: d.announcements.scheduled })} to={['announcements']} />
      </div>

      <Attention d={d} />

      <div className={resourceOf('users') ? 'grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]' : 'grid gap-3'}>
        <Panel title={t('Реєстрації за 30 днів')} description={t('Сеансів зараз: {n} · заблоковано: {b}', { n: d.sessions.toLocaleString(locale()), b: d.users.banned.toLocaleString(locale()) })}>
          <Bars data={d.users.perDay} />
        </Panel>
        {resourceOf('users') && <Panel title={t('Новенькі')}>
          <ul className="grid gap-1.5">
            {d.recent.map((u) => (
              <li key={u.id}>
                <a href={adminHref(['users', u.id])} onClick={adminLink(['users', u.id])} className="flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-panel2">
                  <Avatar name={u.name} color={u.color} size={28} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{u.name} <span className="text-muted">@{u.login}</span></span>
                  <span className="text-[12px] text-muted">{fmtDate(u.created, false)}</span>
                </a>
              </li>
            ))}
            {!d.recent.length && <li className="text-[13px] text-muted">{t('Ще ніхто не зареєструвався.')}</li>}
          </ul>
        </Panel>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
        <Panel title={t('Вміст')}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(KIND_RES).map(([k, [res, label]]) => (
              <li key={k}><a href={adminHref([res])} onClick={adminLink([res])} className="block rounded-lg border border-line px-3 py-2 hover:border-spice/50"><div className="text-[12px] text-muted">{t(label)}</div><div className="font-display text-[20px] font-bold tabular-nums">{d.items[k] ?? 0}</div></a></li>
            ))}
          </ul>
        </Panel>
        <Panel title={t('Дані гри')} description={t('Довідник зібрано: {c} · уміння: {s}', { c: d.game.catalogSynced ? fmtDate(Date.parse(d.game.catalogSynced), false) : '—', s: d.game.skillsSynced ? fmtDate(Date.parse(d.game.skillsSynced), false) : '—' })}
          action={(d.game.syncing.catalog || d.game.syncing.skills) && <SnBadge tone="info" variant="soft">{t('збирається…')}</SnBadge>}>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(GAME_RES).map(([k, [res, label]]) => (
              <li key={k}><a href={adminHref([res])} onClick={adminLink([res])} className="block rounded-lg border border-line px-3 py-2 hover:border-spice/50"><div className="text-[12px] text-muted">{t(label)}</div><div className="font-display text-[20px] font-bold tabular-nums">{d.game.counts[k] ?? 0}</div></a></li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title={t('Мови')} description={t('Інтерфейс — переклади сайту; гра — назви й описи з гри.')} action={<a href={adminHref(['translations'])} onClick={adminLink(['translations'])} className="text-[13px] text-spice hover:underline">{t('Переклади сайту')}</a>}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-2 md:grid-cols-2">
          {d.i18n.map((x) => {
            const ui = x.total ? Math.round((x.done / x.total) * 100) : 0
            const gm = gameTotal ? Math.min(100, Math.round((textsBy(x.lang) / gameTotal) * 100)) : 0
            return (
              <div key={x.lang} className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-2 text-[12.5px]">
                <span className="truncate font-medium">{langName(x.lang)}</span>
                <div className="grid gap-1">
                  <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2"><div className="h-full bg-spice" style={{ width: `${ui}%` }} /></div><span className="w-24 text-right tabular-nums text-muted">{t('сайт {p}%', { p: ui })}</span></div>
                  {x.lang !== 'en' && <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel2"><div className="h-full bg-water" style={{ width: `${gm}%` }} /></div><span className="w-24 text-right tabular-nums text-muted">{t('гра {p}%', { p: gm })}</span></div>}
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      {d.cron.length > 0 && (
        <Panel title={t('Фонові задачі')} action={<a href={adminHref(['cron-jobs'])} onClick={adminLink(['cron-jobs'])} className="text-[13px] text-spice hover:underline">{t('Усі задачі')}</a>}>
          <ul className="divide-y divide-line">
            {d.cron.map((j) => (
              <li key={j.key}>
                <a href={adminHref(['cron-jobs', j.key])} onClick={adminLink(['cron-jobs', j.key])} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px] hover:text-spice">
                  <SnBadge size="sm" variant="soft" tone={d.running.includes(j.key) ? 'info' : !j.enabled ? 'neutral' : j.last_status === 'error' ? 'critical' : j.last_status === 'ok' ? 'success' : 'neutral'}>
                    {d.running.includes(j.key) ? t('виконується') : !j.enabled ? t('вимкнено') : j.last_status === 'error' ? t('помилка') : j.last_status === 'ok' ? t('успішно') : t('ще не запускалась')}
                  </SnBadge>
                  <span className="min-w-0 flex-1 break-words font-medium">{t(j.name)}</span>
                  <span className="text-[12px] text-muted">{j.last_run ? t('було {when}', { when: fmtDate(j.last_run) }) : ''}</span>
                  <span className="text-[12px] text-muted">{j.enabled && j.next_run ? t('далі {when}', { when: fmtDate(j.next_run) }) : ''}</span>
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {d.audit.length > 0 && <RecentActions rows={d.audit} />}
    </div>
  )
}

/** що чекає на людину: заявки, задачі з помилкою, заблоковані — посилання одразу у відфільтрований список */
function Attention({ d }: { d: Overview }) {
  const failed = d.cron.filter((j) => j.enabled && j.last_status === 'error').length
  const items = [
    { n: d.guilds.requests, res: 'requests', search: '', text: t('Заявок до гільдій чекає: {n}', { n: d.guilds.requests }) },
    { n: failed, res: 'cron-jobs', search: '?t_qf=failed', text: t('Фонових задач з помилкою: {n}', { n: failed }) },
    { n: d.users.banned, res: 'users', search: '?t_qf=banned', text: t('Заблокованих людей: {n}', { n: d.users.banned }) },
  ].filter((x) => x.n > 0 && resourceOf(x.res))
  if (!items.length) return null
  return (
    <Panel title={t('Потребує уваги')}>
      <ul className="flex flex-wrap gap-2">
        {items.map((x) => (
          <li key={x.res}>
            <a href={adminHref([x.res]) + x.search} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); goAdmin([x.res], { search: x.search }) }}
              className="inline-flex items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-3 py-1.5 text-[13px] hover:border-warn">
              <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />{x.text}
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/** останні дії: коли (посилання на подію), хто, що зробив, з чим; відмову чи помилку видно бейджем */
function RecentActions({ rows }: { rows: Row[] }) {
  const r = resourceOf('audit')
  const f = (k: string) => r?.fields.find((x) => x.key === k)
  const [actor, action, target, status] = [f('actor'), f('action'), f('target'), f('status')]
  if (!r || !actor || !action || !target) return null
  return (
    <Panel title={t('Останні дії')} action={<a href={adminHref(['audit'])} onClick={adminLink(['audit'])} className="text-[13px] text-spice hover:underline">{t('Весь журнал')}</a>}>
      <ul className="divide-y divide-line">
        {rows.map((a) => (
          <li key={a._id} className="grid grid-cols-[minmax(0,1fr)] gap-x-3 gap-y-0.5 py-2 text-[13px] sm:grid-cols-[9.5rem_minmax(0,11rem)_minmax(0,1fr)] sm:items-baseline">
            <a href={adminHref(['audit', a._id])} onClick={adminLink(['audit', a._id])} className="text-[12px] text-muted hover:text-spice">{fmtDate(a.at)}</a>
            <span className="truncate font-medium">{a.actor ? <ValueView f={actor} row={a} /> : String(a.action).startsWith('POST /api/') ? t('Гість') : t('Сайт')}</span>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span>{textOf(action, a)}</span>
              {textOf(target, a) && <span className="min-w-0 truncate"><ValueView f={target} row={a} /></span>}
              {status && a.status !== 'ok' && <SnBadge size="sm" variant="soft" tone={status.tones?.[String(a.status)] ?? 'neutral'}>{textOf(status, a)}</SnBadge>}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

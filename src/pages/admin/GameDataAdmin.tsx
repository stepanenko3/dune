/**
 * «Дані гри» (панель): звідки сайт бере кожен розділ даних гри. Згори — пакет файлів гри; далі розділи з вибором джерела
 * (компактні картки поруч: «Файли гри 1.5.15» / сірим «збірка …», чи сайти спільноти; вибране підсвічене, опис джерела —
 * спливним блоком над картками), потім розділи з одним джерелом і відповідність будівель. Стан кожного розділу —
 * людськими словами: чи відповідає джерело, коли перевірено, коли дані востаннє змінились. Перемикання — з
 * підтвердженням; «Порівняти джерела» показує, що додасться, зникне, зміниться; підозріло менші дані — «Прийняти».
 * «Версія гри» — оновлення до нової версії: перевірити Steam, запустити видобувач і бачити його кроки, завантаження у
 * відсотках і журнал; сайт бере новий пакет сам, щойно прогін скінчився.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { SnButton } from '@/components/sn'
import { Loading } from '@/components/states'
import { get, post } from '@/lib/api'
import { locale, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { groupLabel, sectionLabel, sourceAbout, sourceSub, sourceText, sourceTitle, type GdSource } from '@/lib/gamedata'
import { confirmAsk } from './actions'
import { PageHeader, Panel } from './ui'

interface Sec {
  id: string; group: string | null; applies?: boolean; switchable: boolean; available: string[]; primary: string | null; driver: string | null; source: GdSource | null; options: GdSource[]
  status: string | null; count: number | null; changedAt: number | null; checkedAt: number | null; since: number | null; error: string | null
}
interface Group { id: string; sections: string[]; available: string[]; switchable: boolean }
interface Report { sections: Sec[]; groups: Group[]; bundle: { build: string | null; version: string | null; extractedAt: string | null } | null; }
type Op = '+' | '-' | '~'
interface CmpItem { id: string; name: string | null; op: Op; changes?: [string, string | null, string | null][]; filled?: [string, null, string | null][] }
interface Cmp { a: string; b: string; added: number; removed: number; changed: number; filled: number; fields: Record<string, number>; filledFields: Record<string, number>; items: CmpItem[]; truncated: number }

const when = (v: number | string | null) => (v ? new Date(v).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

/** стан розділу одним реченням: чи відповідає джерело й коли перевірено */
function stateText(s: Sec): string {
  switch (s.status) {
    case 'ok': return s.checkedAt ? t('Джерело відповідає · перевірено {date}', { date: when(s.checkedAt) }) : t('Джерело відповідає')
    case 'fallback': return t('Вибране джерело не відповідає — дані тимчасово з: {source}', { source: sourceText(s.source, s.driver) })
    case 'error': return t('Джерело не відповідає — на сайті лишаються останні отримані дані')
    case 'held': return t('Нові дані підозріло менші за попередні — чекають, поки їх приймуть')
    default: return t('Ще не перевірялось')
  }
}
const changeText = (s: Sec) => (s.changedAt ? t('Дані востаннє змінились {date}', { date: when(s.changedAt) }) : s.since ? t('Змін не було від {date}', { date: when(s.since) }) : null)

function State({ s }: { s: Sec }) {
  const tone = s.status === 'ok' ? 'bg-ok' : s.status === 'error' ? 'bg-bad' : s.status ? 'bg-warn' : 'bg-muted'
  const change = changeText(s)
  return (
    <div className="grid gap-0.5 text-[13px]">
      <p className="flex items-start gap-2"><span aria-hidden className={cn('mt-[5px] size-2 shrink-0 rounded-full', tone)} />{stateText(s)}</p>
      {change && <p className="pl-4 text-muted">{change}</p>}
      {s.error && <p className="break-words pl-4 text-[12.5px] text-bad">{s.error}</p>}
    </div>
  )
}

/** картки джерел розділу: усе, що є, плюс вибране, навіть коли його зараз нема (пакет прибрали) */
function cardsOf(s: Sec): { src: GdSource; missing: boolean }[] {
  const chosen = s.primary ?? s.driver
  const list = s.options.map((src) => ({ src, missing: false }))
  if (chosen && !s.options.some((o) => o.id === chosen)) list.push({ src: { id: chosen, names: [] }, missing: true })
  if (!list.length && s.source) list.push({ src: s.source, missing: false })
  return list
}

/**
 * Компактні картки джерел («Файли гри 1.5.15» / сірим «збірка …»). Наведи чи торкнись — над картками спливає опис
 * джерела: що це за сайт чи файли й що з ним буде, якщо натиснути. Блок — у порталі з fixed: картка панелі (sn-card)
 * обрізає все, що виходить за її межі; згори мало місця — під картками; прокрутка ховає.
 */
function SourcePicker({ s, busy, onPick }: { s: Sec; busy: boolean; onPick: (src: GdSource) => void }) {
  const [peek, setPeek] = useState<string | null>(null)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const cards = cardsOf(s)
  const chosen = s.primary ?? s.driver
  const shown = cards.find((c) => c.src.id === peek)
  useEffect(() => {
    if (!peek || !box.current) return setPos(null)
    const r = box.current.getBoundingClientRect()
    setPos(r.top > 150 ? { left: r.left, width: r.width, bottom: innerHeight - r.top + 6 } : { left: r.left, width: r.width, top: r.bottom + 6 })
    const hide = () => setPeek(null)
    addEventListener('scroll', hide, true)
    return () => removeEventListener('scroll', hide, true)
  }, [peek])
  return (
    <div ref={box} onMouseLeave={() => setPeek(null)}>
      {shown && pos && createPortal(
        <div role="tooltip" style={{ ...pos, zIndex: 'var(--z-popover)' }} className="pointer-events-none fixed grid gap-1.5 rounded-lg border border-line bg-panel2 p-2.5 text-[12.5px] leading-snug text-ink shadow-lg">
          {shown.src.id === 'gamefiles'
            ? <p><strong>{t('Файли гри')}</strong> — {sourceAbout('gamefiles')}</p>
            : shown.src.names.map((n) => <p key={n}><strong>{n}</strong>{sourceAbout(n) ? ` — ${sourceAbout(n)}` : ''}</p>)}
          <p className="text-muted">
            {shown.missing ? t('Пакета файлів гри зараз нема — вибрати не можна')
              : shown.src.id === chosen ? t('Розділ береться звідси')
                : s.switchable ? t('Натисни, щоб брати розділ звідси') : t('Цей розділ поки не перемикається')}
          </p>
        </div>,
        document.body,
      )}
      <div className="flex flex-wrap gap-1.5">
        {cards.map(({ src, missing }) => {
          const on = src.id === chosen
          const serving = src.id === s.driver && !on
          const sub = missing ? t('зараз недоступне') : [sourceSub(src), serving ? t('дані зараз звідси') : null].filter(Boolean).join(' · ')
          return (
            <button
              key={src.id}
              type="button"
              aria-pressed={on}
              disabled={!on && (!s.switchable || missing || busy)}
              onMouseEnter={() => setPeek(src.id)}
              onFocus={() => setPeek(src.id)}
              onBlur={() => setPeek(null)}
              onClick={() => { if (!on) onPick(src) }}
              className={cn(
                'flex min-h-10 min-w-0 max-w-full flex-col items-start justify-center rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                on ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40',
              )}
            >
              <span className="break-words text-[13px] font-semibold leading-tight">{missing ? t('Файли гри') : sourceTitle(src)}</span>
              {sub && <span className="text-[11.5px] leading-snug text-muted">{sub}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const OP_STYLE: Record<Op, string> = {
  '+': 'border-l-ok bg-ok/[0.06]',
  '-': 'border-l-bad bg-bad/[0.06]',
  '~': 'border-l-warn bg-warn/[0.06]',
}
const OP_SIGN: Record<Op, string> = { '+': '+', '-': '−', '~': '±' }

/**
 * Результат порівняння: «зараз → вибране». Лічильники — фільтри (натисни, щоб лишити лише цей вид), список — високий з
 * прокруткою: додане зелене, зникле червоне, змінене жовте з «поле: було → стане»; заповнене порожнє — сірим.
 */
function CompareView({ c, s, onClose }: { c: Cmp; s: Sec; onClose: () => void }) {
  const [only, setOnly] = useState<Op | null>(null)
  const name = (id: string) => sourceTitle(s.options.find((o) => o.id === id) ?? { id, names: [] })
  const list = only ? c.items.filter((x) => x.op === only) : c.items
  const chips: [Op, number, string][] = [['+', c.added, t('Додасться')], ['-', c.removed, t('Зникне')], ['~', c.changed + c.filled, t('Зміниться')]]
  return (
    <div className="grid gap-2 rounded-lg border border-line p-2.5 text-[12.5px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-semibold">{t('Зараз: {a} → порівняно з: {b}', { a: name(c.a), b: name(c.b) })}</p>
        <button type="button" className="text-[12.5px] text-muted underline hover:text-spice" onClick={onClose}>{t('Сховати')}</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map(([op, n, label]) => (
          <button
            key={op}
            type="button"
            aria-pressed={only === op}
            disabled={!n}
            onClick={() => setOnly(only === op ? null : op)}
            className={cn('rounded-md border border-l-4 px-2 py-1 text-[12.5px] disabled:opacity-45', OP_STYLE[op], only === op ? 'border-spice/70' : 'border-line')}
          >
            <span className="font-mono">{OP_SIGN[op]}</span> {label}: <span className="font-mono">{n}</span>
          </button>
        ))}
      </div>
      {c.items.length === 0 ? (
        <p className="text-muted">{t('Джерела збігаються.')}</p>
      ) : (
        <ul className="grid max-h-[70vh] gap-1 overflow-y-auto overscroll-contain pr-1">
          {list.map((x) => (
            <li key={x.op + x.id} className={cn('grid gap-0.5 rounded-md border-l-4 px-2 py-1', OP_STYLE[x.op])}>
              <p className="break-words">
                <span className="font-mono">{OP_SIGN[x.op]}</span> <span className="font-medium">{x.name || x.id}</span>
                {x.name && x.name !== x.id && <span className="text-muted"> · {x.id}</span>}
              </p>
              {x.changes?.map(([k, from, to]) => (
                <p key={k} className="break-words pl-3">
                  <span className="text-muted">{k}:</span> <del className="text-bad">{from ?? '—'}</del> → <ins className="text-ok no-underline">{to ?? '—'}</ins>
                </p>
              ))}
              {x.filled?.map(([k, , to]) => (
                <p key={k} className="break-words pl-3 text-muted">{k}: — → <span className="text-ok">{to}</span></p>
              ))}
            </li>
          ))}
        </ul>
      )}
      {c.truncated > 0 && <p className="text-muted">{t('Показано перші {n}; ще {m} не вмістилось.', { n: c.items.length, m: c.truncated })}</p>}
    </div>
  )
}

function GroupHead({ title, about }: { title: string; about: string }) {
  return (
    <div className="grid gap-0.5">
      <h2 className="font-display text-[16px] font-bold">{title}</h2>
      <p className="text-[13px] text-muted">{about}</p>
    </div>
  )
}

interface UpdJob {
  kind: 'all' | 'check'; startedAt: number; finishedAt: number | null; running: boolean; step: string | null; pct: number | null
  result: 'updated' | 'same' | null; ok: boolean; stopped: boolean; error: string | null; applied: number | null; build: string | null; version: string | null; lines: string[]
}
interface Upd { enabled: boolean; steps?: string[]; steam?: { manifestId: string; date: string; at: string | null; fresh: boolean } | null; job?: UpdJob | null }

const STEP_LABEL: Record<string, string> = {
  check: t('Перевірка Steam'), fetch: t('Завантаження сервера гри'), unpack: t('Розпакування'), usmap: t('Схема типів гри'),
  export: t('Видобування таблиць'), normalize: t('Обробка даних'), bundle: t('Пакет для сайту'), apply: t('Сайт бере нові дані'),
}
const minutes = (ms: number) => (ms < 60_000 ? t('{n} с', { n: Math.max(1, Math.round(ms / 1000)) }) : t('{n} хв', { n: Math.round(ms / 60_000) }))

/**
 * Версія гри: що в пакеті, що зараз у Steam, кнопки «Оновити дані гри» й «Перевірити Steam». Поки прогін іде — кроки з
 * галочками, поточний з колом, відсоток завантаження й час; наприкінці — що вийшло людськими словами. Стан живе на
 * сервері (у файлах видобувача), тож сторінку можна закрити й повернутись.
 */
function GameUpdate({ bundle, onDone }: { bundle: Report['bundle']; onDone: () => void }) {
  const [u, setU] = useState<Upd | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const was = useRef(false)
  const load = () => get<Upd>('/api/admin/gamedata/update').then((x) => {
    setU(x)
    // прогін щойно скінчився — розділи нижче могли змінитись
    if (was.current && !x.job?.running) onDone()
    was.current = !!x.job?.running
  }).catch(() => {})
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const running = !!u?.job?.running
  useEffect(() => {
    if (!running) return
    const h = setInterval(() => void load(), 2000)
    return () => clearInterval(h)
  }, [running]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (key: string, url: string, body?: unknown) => {
    setBusy(key)
    try { setU(await post<Upd>(url, body)); was.current = true } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const start = async () => {
    const ok = await confirmAsk(t('Оновити дані гри?'), {
      description: t('Сайт завантажить сервер гри зі Steam (близько 4,5 ГБ), розбере його файли й візьме нові дані. Перший раз це до години, далі — лише коли в Steam нова збірка. Сайт тим часом працює як завжди.'),
      confirm: t('Оновити'),
    })
    if (ok) await go('all', '/api/admin/gamedata/update', {})
  }
  const stop = async () => {
    if (await confirmAsk(t('Зупинити оновлення?'), { description: t('Уже завантажене лишиться — наступний запуск продовжить звідти.'), destructive: true, confirm: t('Зупинити') })) await go('stop', '/api/admin/gamedata/update/stop')
  }
  const job = u?.job ?? null
  const steps = u?.steps ?? []
  const at = job?.step ? steps.indexOf(job.step) : -1
  /** стан кроку в поточному (чи останньому) прогоні */
  const stateOf = (i: number): 'done' | 'now' | 'wait' | 'fail' | 'skip' => {
    if (!job || job.kind !== 'all') return 'wait'
    if (job.running) return i < at ? 'done' : i === at ? 'now' : 'wait'
    if (job.ok && job.result === 'updated') return job.applied || i < steps.length - 1 ? 'done' : 'now'
    if (job.ok && job.result === 'same') return i === 0 ? 'done' : 'skip'
    return i < at ? 'done' : i === at ? (job.stopped ? 'wait' : 'fail') : 'wait'
  }
  const steam = u?.steam
  const summary = !job ? null
    : job.running ? (job.kind === 'check' ? t('Перевіряю Steam…') : t('Іде вже {time} · {step}', { time: minutes(Date.now() - job.startedAt), step: STEP_LABEL[job.step ?? ''] ?? t('запуск') }))
      : job.stopped ? t('Оновлення зупинено {date}', { date: when(job.finishedAt) })
        : !job.ok ? t('Не вдалося: {error}', { error: job.error ?? t('невідома помилка') })
          : job.kind === 'check' ? (steam?.fresh ? t('Є нова збірка — натисни «Оновити дані гри»') : t('Нової збірки нема'))
            : job.result === 'same' ? t('Нової збірки нема — на сайті вже остання')
              : job.applied ? t('Готово: збірка {build}, версія {version} · {time}. Сайт уже бере нові дані.', { build: job.build ?? '—', version: job.version ?? '—', time: minutes((job.finishedAt ?? Date.now()) - job.startedAt) })
                : t('Пакет готовий — сайт зараз бере нові дані…')
  return (
    <Panel title={t('Версія гри')} description={t('Дані сайту — з файлів сервера гри. Коли гра оновилась, натисни «Оновити дані гри»: сайт сам завантажить нову збірку й візьме з неї дані.')}>
      <div className="grid gap-3 text-[13.5px]">
        <div className="grid gap-1">
          <p>
            {bundle
              ? t('На сайті: версія гри {version} · збірка {build} · видобуто {date}', { build: bundle.build ?? '—', version: bundle.version ?? '—', date: when(bundle.extractedAt) })
              : t('Пакета файлів гри ще нема — розділи без винятків порожні.')}
          </p>
          {steam && (
            <p className={cn('flex flex-wrap items-baseline gap-x-2', steam.fresh ? 'font-semibold text-spice' : 'text-muted')}>
              {steam.fresh ? t('У Steam нова збірка від {date} — її ще нема на сайті', { date: Number.isNaN(Date.parse(steam.date)) ? steam.date : when(Date.parse(steam.date)) }) : t('У Steam та сама збірка, що й на сайті')}
              {steam.at && <span className="text-[12.5px] font-normal text-muted">{t('перевірено {date}', { date: when(steam.at) })}</span>}
            </p>
          )}
        </div>

        {u && !u.enabled ? (
          <p className="text-muted">{t('Оновлення з панелі вимкнено: на сервері не задано робочої теки видобувача (GD_WORK).')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {running ? (
              <SnButton variant="destructive" size="sm" loading={busy === 'stop'} onClick={() => void stop()}>{t('Зупинити')}</SnButton>
            ) : (
              <>
                <SnButton variant="primary" size="sm" loading={busy === 'all'} disabled={!u} onClick={() => void start()}>{t('Оновити дані гри')}</SnButton>
                <SnButton variant="outline" size="sm" loading={busy === 'check'} disabled={!u} title={t('Лише дізнатись, чи вийшла нова збірка (без завантаження)')} onClick={() => void go('check', '/api/admin/gamedata/update/check')}>{t('Перевірити Steam')}</SnButton>
              </>
            )}
          </div>
        )}

        {job && job.kind === 'all' && (
          <ol className="grid grid-cols-[minmax(0,1fr)] gap-1.5 sm:grid-cols-2 lg:grid-cols-4" aria-label={t('Кроки оновлення')}>
            {steps.map((id, i) => {
              const st = stateOf(i)
              return (
                <li key={id} className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5 text-[12.5px]', st === 'now' ? 'border-spice/60 bg-spice/10' : st === 'fail' ? 'border-bad/50 bg-bad/10' : 'border-line', (st === 'wait' || st === 'skip') && 'text-muted')}>
                  <span aria-hidden className="grid size-4 shrink-0 place-items-center">
                    {st === 'done' ? <Check size={14} className="text-ok" /> : st === 'now' ? <LoaderCircle size={14} className="animate-spin text-spice" /> : st === 'fail' ? <CircleAlert size={14} className="text-bad" /> : <span className="size-1.5 rounded-full bg-line" />}
                  </span>
                  <span className="min-w-0 flex-1 break-words">{STEP_LABEL[id] ?? id}</span>
                  {st === 'now' && id === 'fetch' && job.pct != null && <span className="font-mono text-[12px] tabular-nums">{Math.floor(job.pct)}%</span>}
                </li>
              )
            })}
          </ol>
        )}
        {job?.running && job.step === 'fetch' && job.pct != null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-panel2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(job.pct)} aria-label={t('Завантаження сервера гри')}>
            <div className="h-full rounded-full bg-spice transition-[width] duration-700" style={{ width: `${job.pct}%` }} />
          </div>
        )}

        {summary && <p className={cn('text-[13px]', job!.running || job!.stopped ? 'text-muted' : job!.ok ? 'text-ok' : 'text-bad')}>{summary}</p>}
        {job && job.lines.length > 0 && (
          <details>
            <summary className="cursor-pointer text-[12.5px] text-muted hover:text-ink">{t('Журнал видобувача')}</summary>
            <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-panel2/50 p-2 font-mono text-[11.5px] leading-relaxed">{job.lines.join('\n')}</pre>
          </details>
        )}
      </div>
    </Panel>
  )
}

const recordsOf = (s: Sec) => (s.count != null ? <span className="font-mono text-[12.5px] text-muted">{t('записів: {n}', { n: s.count })}</span> : null)

export function GameDataAdmin() {
  const [rep, setRep] = useState<Report | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [cmp, setCmp] = useState<Record<string, Cmp>>({})
  const load = () => get<Report>('/api/admin/gamedata/sections').then(setRep).catch((e) => toast.error((e as Error).message))
  useEffect(() => { void load() }, [])

  const act = async (key: string, f: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    try { await f(); if (done) toast.success(done); await load() } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const compare = (s: Sec, b: string) => act('cmp:' + s.id + ':' + b, async () => { const r = await post<Cmp>(`/api/admin/gamedata/compare/${s.id}`, { a: s.driver, b }); setCmp((c) => ({ ...c, [s.id]: r })) })
  /** перемкнути групу (довідник, мапа) чи окремий розділ — з підтвердженням; що саме перемкнеться — словами */
  const choose = async (target: string, title: string, to: GdSource) => {
    const ok = await confirmAsk(t('Брати «{name}» з: {source}?', { name: title, source: sourceText(to) }), {
      description: t('«{name}» на сайті братиметься з {source}. Повернути можна будь-коли.', { name: title, source: sourceText(to) }),
      confirm: t('Перемкнути'),
    })
    if (ok) await act('sw:' + target, () => post(`/api/admin/gamedata/primary/${target}`, { driver: to.id }), t('Готово'))
  }

  /** рядок розділу: стан, порівняння з іншими джерелами, перезапис із файлів гри, прийняття затриманого */
  const Row = ({ s }: { s: Sec }) => {
    const c = cmp[s.id]
    // порівнювати можна поточне з кожним іншим джерелом, що має розділ
    const others = s.options.filter((o) => o.id !== s.driver)
    return (
      <div className="grid gap-2">
        <State s={s} />
        {(others.length > 0 || (s.applies && s.driver === 'gamefiles') || s.status === 'held') && (
          <div className="flex flex-wrap items-center gap-2">
            {s.driver && others.length > 0 && (
              <>
                <span className="text-[13px] text-muted">{t('Порівняти з:')}</span>
                {others.map((o) => (
                  <SnButton key={o.id} variant={c?.b === o.id ? 'primary' : 'outline'} size="sm" loading={busy === 'cmp:' + s.id + ':' + o.id} onClick={() => compare(s, o.id)}>
                    {sourceTitle(o)}
                  </SnButton>
                ))}
              </>
            )}
            {s.applies && s.driver === 'gamefiles' && (
              <SnButton variant="ghost" size="sm" title={t('Ще раз записати дані файлів гри в таблиці сайту')} loading={busy === 're:' + s.id} onClick={() => act('re:' + s.id, () => post(`/api/admin/gamedata/reapply/${s.id}`), t('Готово'))}>
                {t('Перезаписати з файлів гри')}
              </SnButton>
            )}
            {s.status === 'held' && (
              <SnButton variant="outline" size="sm" loading={busy === 'acc:' + s.id} onClick={() => act('acc:' + s.id, () => post(`/api/admin/gamedata/accept/${s.id}`), t('Прийнято'))}>{t('Прийняти нові дані')}</SnButton>
            )}
          </div>
        )}
        {c && <CompareView c={c} s={s} onClose={() => setCmp((x) => { const { [s.id]: _, ...rest } = x; void _; return rest })} />}
      </div>
    )
  }
  /** розділи списком: назва й кількість ліворуч, стан і дії праворуч */
  const List = ({ list }: { list: Sec[] }) => (
    <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-line">
      {list.map((s) => (
        <li key={s.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)] sm:gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2 sm:flex-col sm:justify-start">
            <h3 className="text-[14px] font-semibold">{sectionLabel(s.id)}</h3>
            {recordsOf(s)}
          </div>
          <Row s={s} />
        </li>
      ))}
    </ul>
  )

  if (!rep) return <Loading lines={6} />
  const by = new Map(rep.sections.map((s) => [s.id, s]))
  const groups = rep.groups.map((g) => ({ ...g, list: g.sections.map((id) => by.get(id)).filter((x): x is Sec => !!x && x.available.length > 0) })).filter((g) => g.list.length)
  const alone = rep.sections.filter((s) => !s.group)
  return (
    <div className="grid gap-6">
      <PageHeader
        title={t('Дані гри')}
        about={t('Звідки сайт бере дані гри: файли самої гри, а де в них чогось нема — названі винятки. Розділи, що мусять мати одне джерело, зібрано в групи.')}
        actions={(
          <SnButton variant="outline" title={t('Опитати всі джерела зараз, не чекаючи планової перевірки')} loading={busy === 'check'} onClick={() => act('check', () => post('/api/admin/gamedata/check'), t('Перевірено'))}>
            {t('Перевірити зараз')}
          </SnButton>
        )}
      />

      <GameUpdate bundle={rep.bundle} onDone={() => void load()} />

      {groups.length > 0 && (
        <section className="grid gap-3">
          <GroupHead title={t('Групи розділів')} about={t('Розділи групи посилаються одне на одного, тож джерело в них одне на всіх і перемикається разом. Наведи чи торкнись джерела, щоб побачити, що це.')} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {groups.map((g) => {
              const head = g.list[0]
              // картки групи — джерела, що мають усі її розділи
              const pick: Sec = { ...head, options: head.options.filter((o) => g.available.includes(o.id)), switchable: g.switchable }
              return (
                <Panel key={g.id} title={groupLabel(g.id)} description={g.list.map((s) => sectionLabel(s.id)).join(' · ')}>
                  <div className="grid gap-3">
                    <SourcePicker s={pick} busy={busy === 'sw:' + g.id} onPick={(src) => void choose(g.id, groupLabel(g.id), src)} />
                    <List list={g.list} />
                  </div>
                </Panel>
              )
            })}
          </div>
        </section>
      )}

      {alone.length > 0 && (
        <section className="grid gap-3">
          <GroupHead title={t('Окремі розділи')} about={t('Кожен розділ — сам по собі: джерело в нього своє.')} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
            {alone.map((s) => (
              <Panel key={s.id} title={sectionLabel(s.id)} action={recordsOf(s)}>
                <div className="grid gap-3">
                  <SourcePicker s={s} busy={busy === 'sw:' + s.id} onPick={(src) => void choose(s.id, sectionLabel(s.id), src)} />
                  <Row s={s} />
                </div>
              </Panel>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

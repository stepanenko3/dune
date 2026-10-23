/**
 * Журнал запуску фонової задачі: рядки з підсвіткою (час, попередження, мітки модулів, числа, шляхи й адреси), номери
 * рядків, пошук і «лише попередження», перенос рядків, копіювання й файл. Поки запуск іде — наживо (SSE
 * /api/admin/cron-runs/<id>/stream) і «Стежити»: нові рядки прокручують журнал донизу. На картці задачі — вибір запуску
 * (останній за замовчуванням, в адресі ?run=), на картці запуску — його журнал.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Copy, Download, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { SnBadge, SnButton, SnInput, SnSelect, SnSwitch, checkedOf, valueOf } from '@/components/sn'
import { Empty, Loading } from '@/components/states'
import { t } from '@/lib/i18n'
import { useUrlParam } from '@/lib/urlState'
import { cn } from '@/lib/utils'
import { adminApi, adminHref, adminLink, type Row } from './api'
import { fmtDate, fmtDuration } from './fields'
import { Panel } from './ui'

type Status = 'running' | 'ok' | 'error' | 'gone' | null
const MAX_LINES = 5000

/** журнал запуску: рядки й стан; поки запуск іде — нові рядки наживо */
function useRunLog(id: string | number | null) {
  const [lines, setLines] = useState<string[] | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const [ms, setMs] = useState<number | null>(null)
  useEffect(() => {
    setLines(null); setStatus(null); setMs(null)
    if (id == null) return
    const es = new EventSource(`/api/admin/cron-runs/${encodeURIComponent(String(id))}/stream`)
    let done = false
    es.addEventListener('lines', (e) => { setLines(JSON.parse((e as MessageEvent).data)); setStatus((s) => s ?? 'running') })
    es.addEventListener('line', (e) => { const l = JSON.parse((e as MessageEvent).data) as string; setLines((cur) => { const n = [...(cur ?? []), l]; return n.length > MAX_LINES ? n.slice(-MAX_LINES) : n }) })
    es.addEventListener('done', (e) => { const d = JSON.parse((e as MessageEvent).data) as { status: Status; ms: number | null }; done = true; setStatus(d.status); setMs(d.ms ?? null); es.close() })
    es.addEventListener('gone', () => { done = true; setStatus('gone'); setLines([]); es.close() })
    // обрив (сервер перезапустився): браузер сам перепідключиться, а якщо запуск уже скінчився — закриваємо
    es.onerror = () => { if (done) es.close() }
    return () => es.close()
  }, [id])
  return { lines, status, ms }
}

/** рядок журналу на шматки з підсвіткою */
const TOKENS = /(?<key>^[\p{L}\w.-]+:(?=\s))|(?<warn>⚠|✖|\b(?:error|failed)\b|(?<![\p{L}])(?:помилка|не вдалося|перервано))|(?<tag>\[[\w.:-]+\])|(?<url>https?:\/\/[^\s«»"]+)|(?<path>(?:\/[\w.@%-]+){2,}\/?|\b[\w-]+(?:\/[\w.@-]+)+\.\w{2,5}\b|\bassets\/[\w./-]+)|(?<quote>«[^»]*»|"[^"]*")|(?<num>(?<![\p{L}\w.-])[-+]?\d+(?:[.,]\d+)?(?:\s?(?:мс|ms|с|s|хв|год|МБ|MB|КБ|KB|%)(?![\p{L}\d]))?)/giu
const TONE: Record<string, string> = {
  key: 'font-semibold',
  warn: 'font-semibold text-bad', tag: 'text-spice', url: 'text-water underline decoration-dotted', path: 'text-water', quote: 'text-ok', num: 'text-[rgb(var(--c-warn))]',
}
function Highlight({ text }: { text: string }) {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(TOKENS)) {
    const kind = Object.entries(m.groups ?? {}).find(([, v]) => v != null)?.[0]
    if (!kind || m.index == null) continue
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<span key={m.index} className={TONE[kind]}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}
const isWarn = (l: string) => /⚠|✖|\b(error|failed)\b|помилка|не вдалося|перервано/i.test(l)

function StatusBadge({ status }: { status: Status }) {
  if (status === 'running') return <SnBadge size="sm" variant="soft" tone="info"><span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-current align-middle" />{t('Виконується')}</SnBadge>
  if (status === 'ok') return <SnBadge size="sm" variant="soft" tone="success">{t('Успішно')}</SnBadge>
  if (status === 'error') return <SnBadge size="sm" variant="soft" tone="critical">{t('Помилка')}</SnBadge>
  return null
}

/** сам журнал: панель інструментів і рядки */
export function LogView({ id, name, onDone }: { id: string | number; name?: string; onDone?: (status: Status) => void }) {
  const { lines, status, ms } = useRunLog(id)
  const [follow, setFollow] = useState(true)
  const [wrap, setWrap] = useState(true)
  const [q, setQ] = useState('')
  const [warnOnly, setWarnOnly] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const was = useRef<Status>(null)
  // запуск скінчився, поки дивились, — картка задачі оновлює свої поля (останній запуск, стан)
  useEffect(() => { if (was.current === 'running' && status && status !== 'running') doneRef.current?.(status); was.current = status }, [status])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (lines ?? []).map((l, i) => [i + 1, l] as const).filter(([, l]) => (!warnOnly || isWarn(l)) && (!s || l.toLowerCase().includes(s)))
  }, [lines, q, warnOnly])
  const warns = useMemo(() => (lines ?? []).filter(isWarn).length, [lines])

  // «Стежити»: нові рядки — донизу (на широкому екрані журнал гортається сам; на телефоні — сторінка, якщо кінець видно)
  useEffect(() => {
    if (!follow || status !== 'running') return
    const el = box.current
    if (el && el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight
    else if (end.current) { const r = end.current.getBoundingClientRect(); if (r.top < innerHeight + 200) end.current.scrollIntoView({ block: 'end' }) }
  }, [lines, follow, status])

  const text = (lines ?? []).join('\n')
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast.success(t('Журнал скопійовано')) } catch { toast.error(t('Не вдалося скопіювати')) } }
  const save = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    a.download = `${name || 'run'}-${id}.log`
    document.body.append(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  if (!lines) return <Loading lines={4} />
  if (status === 'gone') return <p className="text-[13px] text-muted">{t('Цього запуску вже нема — зберігаються 200 останніх запусків кожної задачі.')}</p>
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px]">
        <StatusBadge status={status} />
        {ms != null && <span className="text-muted">{t('Тривав: {d}', { d: fmtDuration(ms) })}</span>}
        <span className="text-muted">{t('Рядків: {n}', { n: lines.length })}{warns ? ` · ${t('попереджень: {n}', { n: warns })}` : ''}</span>
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          {status === 'running' && <label className="inline-flex items-center gap-1.5"><SnSwitch size="sm" modelValue={follow} accessibilityLabel={t('Стежити')} onChange={(e: Event) => setFollow(checkedOf(e))} />{t('Стежити')}</label>}
          <label className="inline-flex items-center gap-1.5"><SnSwitch size="sm" modelValue={wrap} accessibilityLabel={t('Переносити рядки')} onChange={(e: Event) => setWrap(checkedOf(e))} />{t('Переносити рядки')}</label>
          {warns > 0 && <label className="inline-flex items-center gap-1.5"><SnSwitch size="sm" modelValue={warnOnly} accessibilityLabel={t('Лише попередження')} onChange={(e: Event) => setWarnOnly(checkedOf(e))} />{t('Лише попередження')}</label>}
          <SnButton size="icon-sm" variant="ghost" accessibilityLabel={t('Копіювати журнал')} data-tip={t('Копіювати журнал')} disabled={!lines.length || undefined} onClick={copy}><Copy size={14} /></SnButton>
          <SnButton size="icon-sm" variant="ghost" accessibilityLabel={t('Завантажити файлом')} data-tip={t('Завантажити файлом')} disabled={!lines.length || undefined} onClick={save}><Download size={14} /></SnButton>
        </div>
      </div>
      {lines.length > 8 && <SnInput type="search" size="sm" modelValue={q} placeholder={t('Знайти в журналі')} accessibilityLabel={t('Знайти в журналі')} onInput={(e: Event) => setQ(valueOf(e))} />}
      {!lines.length ? (
        <p className="rounded-lg border border-line bg-panel2/40 px-3 py-4 text-center text-[13px] text-muted">{status === 'running' ? t('Задача ще нічого не написала…') : t('Задача нічого не написала.')}</p>
      ) : (
        // на широкому екрані — своя прокрутка (журнал буває на сотні рядків); на телефоні — гортається сторінка
        <div ref={box} className="relative min-w-0 rounded-lg border border-line bg-[rgb(var(--c-panel2)/0.45)] font-mono text-[12px] leading-[1.6] md:max-h-[60vh] md:overflow-auto">
          <ol className="min-w-0 py-1.5">
            {shown.map(([n, l]) => {
              const m = /^(\d{2}:\d{2}:\d{2}) ?(.*)$/s.exec(l)
              return (
                <li key={n} className={cn('grid grid-cols-[2.6rem_minmax(0,1fr)] gap-2 px-2', isWarn(l) && 'bg-bad/[0.07]')}>
                  <span className="select-none text-right tabular-nums text-muted/70">{n}</span>
                  <span className={cn('min-w-0', wrap ? 'whitespace-pre-wrap break-words [overflow-wrap:anywhere]' : 'overflow-x-auto whitespace-pre')}>
                    {m ? <><span className="text-muted">{m[1]}</span> <Highlight text={m[2]} /></> : <Highlight text={l} />}
                  </span>
                </li>
              )
            })}
            {!shown.length && <li className="px-3 py-2 text-muted">{t('Нічого не знайшлося.')}</li>}
          </ol>
          {status === 'running' && <div className="flex items-center gap-2 px-3 pb-2 text-[11.5px] text-muted"><span className="inline-block size-1.5 animate-pulse rounded-full bg-spice" />{t('Наживо — нові рядки з’являються самі')}</div>}
          <div ref={end} />
        </div>
      )}
    </div>
  )
}

/** картка задачі: журнал її запуску — останнього чи вибраного (?run=); поки нічого не вибрано — оновлюється сам */
export function CronJobLog({ job, row, onDone }: { job: string; row: Row; onDone: () => void }) {
  const [runs, setRuns] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [picked, setPicked] = useUrlParam<string>('run', '', () => true)
  const load = () => adminApi.list('cron-runs', { page: 0, size: 30, search: '', sort: 'id', desc: true, filters: {}, fixed: { job } })
    .then((r) => { setRuns(r.rows); setErr('') }).catch((e) => setErr((e as Error).message))
  // картку перечитали (запустили вручну, змінили розклад) — і список запусків теж
  useEffect(() => { void load() }, [job, row])
  // без вибраного запуску — раз на 15 с: задача могла початись за розкладом
  useEffect(() => {
    if (picked) return
    const h = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 15_000)
    return () => clearInterval(h)
  }, [job, picked])
  const cur = runs?.find((r) => String(r.id) === picked) ?? runs?.[0] ?? null
  const label = (r: Row) => [`№${r.id}`, fmtDate(r.started), r.status === 'running' ? t('виконується') : r.status === 'error' ? t('помилка') : t('успішно'), r.ms != null ? fmtDuration(r.ms) : ''].filter(Boolean).join(' · ')
  return (
    <Panel
      title={t('Журнал запуску')}
      description={cur ? (cur.trigger === 'manual' ? t('Запущено вручну') : t('Запущено за розкладом')) : undefined}
      action={cur && <a href={adminHref(['cron-runs', String(cur.id)])} onClick={adminLink(['cron-runs', String(cur.id)])} className="inline-flex items-center gap-1 text-[13px] text-spice hover:underline"><ExternalLink size={13} />{t('Картка запуску')}</a>}
    >
      {err ? <p className="text-[13px] text-bad">{err}</p> : !runs ? <Loading lines={3} /> : !cur ? (
        <Empty title={t('Задача ще не запускалась')} description={t('Тут буде її журнал — і наживо, поки вона йде. Запусти її кнопкою «Запустити зараз» чи дочекайся розкладу.')} framed={false} />
      ) : (
        <div className="grid min-w-0 gap-3">
          {runs.length > 1 && (
            <SnSelect className="w-full max-w-[460px]" modelValue={String(cur.id)} options={runs.map((r) => ({ value: String(r.id), label: label(r) }))} accessibilityLabel={t('Запуск')}
              onChange={(e: Event) => { const v = valueOf(e); setPicked(v === String(runs[0].id) ? '' : v, { replace: true }) }} />
          )}
          <LogView key={String(cur.id)} id={String(cur.id)} name={job} onDone={() => { void load(); onDone() }} />
        </div>
      )}
    </Panel>
  )
}

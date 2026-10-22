/**
 * «Дані гри» (панель): звідки сайт бере кожен розділ даних гри. Згори — пакет файлів гри; далі розділи з вибором джерела
 * (компактні картки поруч: «Файли гри 1.5.15» / сірим «збірка …», чи сайти спільноти; вибране підсвічене, опис джерела —
 * спливним блоком над картками), потім розділи з одним джерелом і відповідність будівель. Стан кожного розділу —
 * людськими словами: чи відповідає джерело, коли перевірено, коли дані востаннє змінились. Перемикання — з
 * підтвердженням; «Порівняти джерела» показує, що додасться, зникне, зміниться; підозріло менші дані — «Прийняти».
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
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

      <Panel title={t('Файли гри')} description={t('Пакет, який видобувач розібрав із файлів сервера гри.')}>
        <p className="text-[13.5px]">
          {rep.bundle
            ? t('Версія гри {version} · збірка {build} · видобуто {date}', { build: rep.bundle.build ?? '—', version: rep.bundle.version ?? '—', date: when(rep.bundle.extractedAt) })
            : t('Пакета файлів гри ще нема — розділи без винятків порожні.')}
        </p>
      </Panel>

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

/**
 * «Оновлення даних»: звідки сайт бере дані гри (по розділах), коли кожен розділ востаннє реально змінився, і стрічка
 * змін. Запис у стрічці — лише коли дані справді інші (server/lib/gamedata/registry.mjs), тож сторінка не «оновлюється»
 * сама собою.
 */
import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Empty, ErrorAlert, Loading } from '@/components/states'
import { bySectionOrder, getChanges, sourceText, sectionLabel, summaryText, useGdStatus, type GdChange, type GdSource } from '@/lib/gamedata'
import { locale, t } from '@/lib/i18n'
import { useAuth } from '@/lib/auth'
import { plainClick } from '@/lib/urlState'
import { useStore } from '@/store'

/** джерело для відвідувачів: файли гри — з версією й збіркою; сторонні сайти не називаємо */
const publicSource = (src: GdSource | null | undefined, driver: string | null) => ((src?.id ?? driver) === 'gamefiles' ? sourceText(src, driver) : t('дані спільноти'))

const fmt = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function DataUpdates() {
  const status = useGdStatus()
  const user = useAuth((s) => s.user)
  const manage = !!user?.perms?.some((p) => p === '*' || p === 'gamedata.manage')
  const [changes, setChanges] = useState<GdChange[] | null>(null)
  const [next, setNext] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = (before?: number | null) => {
    setBusy(true)
    getChanges(before)
      .then((r) => { setChanges((c) => [...(before ? c ?? [] : []), ...r.items]); setNext(r.next); setError(null) })
      .catch((e) => setError(e?.message || t('не вдалося завантажити')))
      .finally(() => setBusy(false))
  }
  useEffect(() => { load() }, [])

  const version = status?.game.version
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1100px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={t('Оновлення даних')}
          lead={t('Звідки сайт бере дані гри і що в них змінилось. Запис з’являється лише тоді, коли дані справді змінились.')}
        >
          <p className="text-[13px] text-muted">
            {version ? t('Версія гри: {version}', { version }) : t('версія гри ще невідома')}
            {status?.updatedAt ? <> · {t('остання зміна {date}', { date: fmt(status.updatedAt) })}</> : null}
            {' · '}
            <a className="underline hover:text-spice" href="/patches" onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); useStore.getState().setView('patches') }}>{t('Що змінилось у грі')}</a>
            {manage && (
              <> · <a className="underline hover:text-spice" href="/admin/gamedata" onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); useStore.getState().setView('admin', { param: 'gamedata' }) }}>{t('Керувати джерелами')}</a></>
            )}
          </p>
        </PageHeader>

        {status === undefined ? <Loading lines={4} /> : status === null ? (
          <ErrorAlert message={t('не вдалося завантажити')} />
        ) : !status.sections.length ? (
          <Empty title={t('Ще немає жодної перевірки даних')} description={t('Щойно сервер перевірить джерела, тут з’являться розділи й зміни.')} />
        ) : (
          <section aria-label={t('Розділи даних')} className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...status.sections].sort(bySectionOrder).map((s) => (
              <div key={s.id} className="grid gap-1 rounded-xl border border-line bg-panel px-4 py-3 shadow-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h2 className="break-words font-display text-[15px] font-bold">{sectionLabel(s.id)}</h2>
                  {s.count != null && <span className="font-mono text-[12px] text-muted">{s.count}</span>}
                </div>
                <p className="text-[13px] text-muted">{t('Джерело: {source}', { source: publicSource(s.source, s.driver) })}</p>
                <p className="text-[13px] text-muted">
                  {s.changedAt ? t('змінено {date}', { date: fmt(s.changedAt) }) : t('без змін, відколи почали стежити')}
                </p>
                {s.status === 'held' && <p className="text-[13px] text-spice">{t('нові дані підозріло менші — чекають перевірки')}</p>}
                {s.status === 'error' && <p className="text-[13px] text-spice">{t('джерело зараз не відповідає — показуємо останні відомі дані')}</p>}
                {s.status === 'fallback' && <p className="text-[13px] text-spice">{t('вибране джерело не відповідає — тимчасово показуємо інше')}</p>}
              </div>
            ))}
          </section>
        )}

        {error && <ErrorAlert message={error} />}

        <section aria-label={t('Журнал змін')} className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sm">
          <h2 className="font-display text-[16px] font-bold">{t('Журнал змін')}</h2>
          {changes === null ? <Loading lines={3} /> : !changes.length ? (
            <p className="text-[13px] text-muted">{t('Змін ще не було.')}</p>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-line">
              {changes.map((c) => (
                <li key={c.id} className="grid gap-0.5 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="font-display text-[14px] font-bold">{sectionLabel(c.section)}</span>
                    <span className="font-mono text-[13px]">{summaryText(c.summary)}</span>
                    <span className="text-[12px] text-muted">{fmt(c.at)} · {publicSource({ id: c.driver, names: c.names ?? [], build: c.build }, c.driver)}</span>
                  </div>
                  {c.summary.examples.length > 0 && (
                    <p className="break-words text-[13px] text-muted">
                      {c.summary.examples.map((x) => `${x.op === '~' ? '±' : x.op === '-' ? '−' : '+'}${x.name || x.id}`).join(', ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {next && <div><Button variant="outline" size="sm" loading={busy} onClick={() => load(next)}>{t('Показати ще')}</Button></div>}
        </section>
      </div>
    </div>
  )
}

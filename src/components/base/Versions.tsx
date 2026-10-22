/**
 * Версії бази одним списком від найновішої: збереження з редактора (поточна і попередні з приміткою й автором — будь-яку
 * можна переглянути: план по рівнях і що зміниться відносно поточної, — і відновити, вона стане новою поточною), далі —
 * давні версії з коду (знімок 3D і перелік змін). Розгорнута лише остання; видно 10 найновіших, решта — під
 * «Показати ще». Історію збережень сервер дає лише тим, хто може змінювати базу.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Eye, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Card, SectionTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Seg } from '@/components/ui/seg'
import { locale, t } from '@/lib/i18n'
import { fmtN } from '@/lib/utils'
import { BASEDATA, PLAN2D, VERSIONS } from '@/lib/engine'
import { baseHistory, historyDoc, restoreBase, type Author, type BaseDoc, type BaseEnvelope, type BaseRevision } from '@/lib/bases'
import { ErrorAlert, Loading } from '@/components/states'
import { Confirm } from './Ask'
import { levelName } from './tr'

/** скільки версій видно одразу */
const SHOWN = 10
const date = (d: string) => new Date(d).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
const when = (ms: number) => new Date(ms).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
/** «5 хвилин тому», «вчора» — мовою сайту, з правильною множиною (Intl) */
function ago(ms: number) {
  const s = Math.round((ms - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']]
  let v = s
  for (const [k, unit] of steps) {
    if (Math.abs(v) < k) return rtf.format(Math.round(v), unit)
    v /= k
  }
  return ''
}
const who = (a?: Author | null) => (a ? a.name || a.login || '' : '')
/** давні версії з коду — українською в рушії; переклад — за ключем (ключі позначено t() у src/engine/versions.js) */
const tr = (s: string) => t(s)

/** що зміниться, якщо відновити версію old замість cur: деталі (за id), станції, приміщення, ділянки, назва */
function diff(old: BaseDoc, cur: BaseDoc) {
  const ids = (d: BaseDoc) => new Map<string, any>((d.format === 2 ? d.pieces || [] : []).map((p: any) => [p.id, p]))
  const a = ids(old), b = ids(cur)
  let back = 0, gone = 0, moved = 0
  for (const [id, p] of a) {
    const q = b.get(id)
    if (!q) back++
    else if (q.shape !== p.shape || q.x !== p.x || q.y !== p.y || q.z !== p.z || q.rot !== p.rot) moved++
  }
  for (const id of b.keys()) if (!a.has(id)) gone++
  const n = (d: BaseDoc, k: string) => (Array.isArray(d[k]) ? d[k].length : 0)
  return {
    back, gone, moved,
    rows: [
      [t('Деталі'), n(old, 'pieces'), n(cur, 'pieces')],
      [t('Станції'), n(old, 'items') + n(old, 'roofItems'), n(cur, 'items') + n(cur, 'roofItems')],
      [t('Приміщення'), n(old, 'zones') + n(old, 'rooms'), n(cur, 'zones') + n(cur, 'rooms')],
      [t('Ділянки'), n(old, 'claims'), n(cur, 'claims')],
    ] as [string, number, number][],
    name: old.ui?.name !== cur.ui?.name ? (old.ui?.name as string) : null,
  }
}

/** перегляд давньої версії: план по рівнях, хто й коли зберіг, що зміниться; «Відновити» — звідси ж */
function Preview({ env, rev, onClose, onRestore }: { env: BaseEnvelope; rev: BaseRevision; onClose: () => void; onRestore: (r: BaseRevision) => void }) {
  const [doc, setDoc] = useState<(BaseEnvelope & { author?: Author | null }) | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [level, setLevel] = useState('')
  useEffect(() => {
    let live = true
    historyDoc(env.id, rev.hid).then((d) => live && setDoc(d), (e) => live && setErr((e as Error).message))
    return () => { live = false }
  }, [env.id, rev.hid])
  const view = useMemo(() => {
    if (!doc) return null
    try {
      const M = BASEDATA.hydrate(doc.doc)
      return { M, P: PLAN2D.make(M) }
    } catch {
      return null
    }
  }, [doc])
  const lv = view ? (view.M.levels.some((l: any) => l.key === level) ? level : view.M.levels[0]?.key ?? 'g') : ''
  const svg = useMemo(() => (view ? view.P.render({ level: lv, items: true, labels: true, coords: false, highlight: null }) : ''), [view, lv])
  const d = doc ? diff(doc.doc, env.doc) : null
  return (
    <Modal open size="lg" onOpenChange={onClose} title={t('Версія {n}', { n: rev.version })}
      description={[when(rev.updated), who(doc?.author ?? rev.author)].filter(Boolean).join(' · ')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('Закрити')}</Button>
          {env.item?.can?.edit && <Button onClick={() => { onClose(); onRestore(rev) }} disabled={!doc}><RotateCcw size={14} /> {t('Відновити цю версію')}</Button>}
        </>
      }
    >
      {err && <ErrorAlert message={err} />}
      {!doc && !err && <Loading lines={4} />}
      {doc && (
        <div className="grid gap-3 text-[13.5px]">
          {rev.note && <p className="text-muted">{rev.note}</p>}
          {d && (
            <div className="grid gap-1.5 rounded-lg border border-line bg-panel2/40 px-3 py-2.5">
              <b className="text-[13px]">{t('Якщо відновити — відносно поточної версії {n}:', { n: env.version })}</b>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12.5px] tabular-nums text-muted">
                {d.rows.map(([label, a, b]) => (
                  <li key={label}>{label}: <b className="text-ink">{fmtN(a)}</b>{a !== b && <span> ({a > b ? '+' : '−'}{fmtN(Math.abs(a - b))})</span>}</li>
                ))}
              </ul>
              {(d.back > 0 || d.gone > 0 || d.moved > 0) && (
                <span className="text-[12.5px] text-muted">{t('деталей повернеться: {back}, прибереться: {gone}, стане на інше місце: {moved}', { back: fmtN(d.back), gone: fmtN(d.gone), moved: fmtN(d.moved) })}</span>
              )}
              {d.name && <span className="text-[12.5px] text-muted">{t('Назва буде «{name}»', { name: d.name })}</span>}
            </div>
          )}
          {view ? (
            <div className="overflow-hidden rounded-lg border border-line">
              <div className="border-b border-line bg-panel2/40 px-3 py-2">
                <Seg<string> label={t('Рівень')} value={lv} onChange={setLevel} items={view.M.levels.map((l: any) => ({ id: l.key, label: levelName(view.M.ui.levelButtons[l.key]) }))} />
              </div>
              <div className="plan-wrap [&_svg]:!min-w-0" dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
          ) : <p className="text-muted">{t('План цієї версії не вдалося показати.')}</p>}
        </div>
      )}
    </Modal>
  )
}

export function Versions({ env }: { env: BaseEnvelope }) {
  const legacy = VERSIONS.filter((v) => v.base === env.id)
  const name = env.doc.ui?.name ?? t('База')
  const canEdit = !!env.item?.can?.edit
  const [rows, setRows] = useState<BaseRevision[] | null>(canEdit ? null : [])
  const [busy, setBusy] = useState<number | null>(null)
  const [more, setMore] = useState(false)
  const [ask, setAsk] = useState<BaseRevision | null>(null)
  const [look, setLook] = useState<BaseRevision | null>(null)
  // відносний час «зараз» оновлюється сам
  const [, tick] = useState(0)
  useEffect(() => { const h = setInterval(() => tick((x) => x + 1), 60_000); return () => clearInterval(h) }, [])
  useEffect(() => {
    if (!canEdit) { setRows([]); return }
    let live = true
    baseHistory(env.id).then((r) => live && setRows(r ?? []))
    return () => { live = false }
  }, [env.id, env.version, canEdit])
  const restore = async (r: BaseRevision) => {
    setBusy(r.hid)
    try {
      await restoreBase(env.id, r.hid)
      toast.success(t('Відновлено версію {n}', { n: r.version }))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  // один список: збереження з редактора (вже від найновішої), за ними — давні версії з коду, теж від найновішої
  const all: { key: string; n: string; current?: boolean; title: string; when: string; body: ReactNode }[] = [
    ...(rows ?? []).map((r) => ({
      key: `h${r.hid}`,
      n: `v${r.version}`,
      current: r.current,
      title: r.note || (r.current ? t('Поточна версія') : t('Без примітки')),
      when: r.current ? ago(r.updated) : when(r.updated),
      body: (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <span className="font-mono">{when(r.updated)}</span>
          {who(r.author) && <span>· {who(r.author)}</span>}
          {r.current && <span className="rounded-full bg-spice/15 px-2 py-px text-[11.5px] font-semibold text-spice">{t('поточна')}</span>}
          {!r.current && (
            <span className="ml-auto flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setLook(r)} title={t('План цієї версії і що зміниться')}>
                <Eye size={13} /> {t('Переглянути')}
              </Button>
              {canEdit && (
                <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => setAsk(r)} title={t('Зробити цю версію поточною')}>
                  <RotateCcw size={13} /> {t('Відновити')}
                </Button>
              )}
            </span>
          )}
        </div>
      ),
    })),
    ...[...legacy].sort((a, b) => b.date.localeCompare(a.date)).map((v) => ({
      key: `l${v.id}`,
      n: String(v.n),
      title: tr(v.title),
      when: date(v.date),
      body: (
        <div className="text-[13.5px]">
          <ul className="mb-2.5 grid list-disc gap-1 pl-4 text-muted">
            {v.changes.map((x, i) => <li key={i}>{tr(x)}</li>)}
          </ul>
          <img src={'/' + v.img} alt={t('{name}, версія {n}, вигляд 3D', { name, n: v.n })} width={960} height={655} loading="lazy" className="block h-auto w-full max-w-[640px] rounded-md border border-line bg-panel2" />
        </div>
      ),
    })),
  ]
  const shown = more ? all : all.slice(0, SHOWN)
  if (rows && !all.length) return null
  return (
    <Card>
      <SectionTitle>{t('Версії')}</SectionTitle>
      {!rows && <Loading lines={3} />}
      {rows && (
        <div>
          {shown.map((v, i) => (
            <details key={v.key} open={i === 0} className="group border-t border-line first:border-t-0">
              <summary className="grid cursor-pointer list-none grid-cols-[4.5ch_1fr_auto] items-baseline gap-2.5 px-0.5 py-2 text-[13.5px] [&::-webkit-details-marker]:hidden">
                <b className={'text-right font-mono text-[12.5px] font-semibold ' + (v.current ? 'text-spice' : 'text-muted group-open:text-spice group-hover:text-spice')}>{v.n}</b>
                <span className="min-w-0 truncate group-open:whitespace-normal">{v.title}</span>
                <span className="font-mono text-[11.5px] tabular-nums text-muted">{v.when}</span>
              </summary>
              <div className="pb-3 pl-[calc(4.5ch+10px)] pr-0.5 max-sm:pl-0.5">{v.body}</div>
            </details>
          ))}
          {all.length > SHOWN && (
            <div className="border-t border-line pt-2.5">
              <Button variant="ghost" size="sm" onClick={() => setMore(!more)}>
                {more ? t('Згорнути') : t('Показати ще ({n})', { n: all.length - SHOWN })}
              </Button>
            </div>
          )}
        </div>
      )}
      {look && <Preview env={env} rev={look} onClose={() => setLook(null)} onRestore={(r) => setAsk(r)} />}
      {ask && (
        <Confirm title={t('Відновити версію {n}?', { n: ask.version })} text={t('Поточна піде в історію — її теж можна буде повернути.')} confirm={t('Відновити')}
          onClose={() => setAsk(null)} onConfirm={() => void restore(ask)} />
      )}
    </Card>
  )
}

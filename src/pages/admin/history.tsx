/**
 * Історія змін у панелі: список версій запису (хто, коли, що зробив) з розгортанням різниці; різниця — за шляхами
 * («pieces[id=p12].x: 4 → 5», додано / прибрано), як її рахує сервер (server/lib/revisions.mjs, jsonDiff).
 */
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, History as HistoryIcon } from 'lucide-react'
import { SnBadge, SnButton } from '@/components/sn'
import { Empty, ErrorAlert, Loading } from '@/components/states'
import { t } from '@/lib/i18n'
import { adminApi, resourceOf, type Change, type Field, type Revision } from './api'
import { fmtDate, textOf } from './fields'

const short = (v: unknown) => {
  if (v === undefined) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 160 ? s.slice(0, 160) + '…' : s
}

/** шлях різниці: перше слово — підпис поля розділу («ban_reason» → «Причина блокування»), решта — як є */
/** стовпці, яких нема серед полів розділу (історія пише рядок таблиці як є), — звичними підписами */
const COMMON: Record<string, () => string> = {
  name: () => t('Назва'), title: () => t('Назва'), doc: () => t('Документ'), version: () => t('Версія'), updated: () => t('Змінено'),
  created: () => t('Створено'), visibility: () => t('Видимість'), owner_kind: () => t('Власник'), owner_id: () => t('Власник'), summary: () => t('Опис'),
}
function PathLabel({ path, fields }: { path: string; fields?: Field[] }) {
  const m = /^(\w+)(.*)$/s.exec(path)
  const f = m && fields?.find((x) => x.key === m[1])
  const label = f ? t(f.label) : m && COMMON[m[1]] ? COMMON[m[1]]() : null
  if (!label) return <span className="font-mono">{path}</span>
  return <span><span className="font-sans font-medium">{label}</span>{m![2] && <span className="font-mono text-muted">{m![2]}</span>}</span>
}

/** різниця: шлях, було, стало */
export function DiffView({ changes, fields }: { changes: Change[]; fields?: Field[] }) {
  if (!changes.length) return <p className="py-2 text-[13px] text-muted">{t('Без змін у даних.')}</p>
  return (
    <div className="max-h-[420px] overflow-auto rounded-lg border border-line">
      <table className="w-full table-fixed text-[12.5px]">
        <thead className="sticky top-0 bg-panel2 text-left text-[11.5px] text-muted">
          <tr><th className="w-[32%] px-2.5 py-1.5 font-medium">{t('Поле')}</th><th className="px-2.5 py-1.5 font-medium">{t('Було')}</th><th className="px-2.5 py-1.5 font-medium">{t('Стало')}</th></tr>
        </thead>
        <tbody>
          {changes.map((c, i) => (
            <tr key={i} className="border-t border-line/60 align-top">
              <td className="break-all px-2.5 py-1.5 text-[11.5px]"><PathLabel path={c.path} fields={fields} /></td>
              <td className="break-all px-2.5 py-1.5 font-mono text-[11.5px] text-bad">{c.type !== 'add' && <span className="rounded bg-bad/10 px-1">{short(c.from)}</span>}</td>
              <td className="break-all px-2.5 py-1.5 font-mono text-[11.5px] text-ok">{c.type !== 'remove' && <span className="rounded bg-ok/10 px-1">{short(c.to)}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {changes.length >= 400 && <p className="px-2.5 py-1.5 text-[12px] text-muted">{t('Показано перші 400 змін.')}</p>}
    </div>
  )
}

export function RevisionDiff({ id }: { id: number }) {
  const [d, setD] = useState<{ changes: Change[]; revision: Revision } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { adminApi.revisionDiff(id).then(setD).catch((e) => setErr((e as Error).message)) }, [id])
  if (err) return <ErrorAlert message={err} />
  return d ? <DiffView changes={d.changes} fields={d.revision.entity ? resourceOf(d.revision.entity)?.fields : undefined} /> : <Loading lines={4} />
}

export function VersionDiff({ kind, hid }: { kind: 'base' | 'roadmap'; hid: number }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof adminApi.versionDiff>> | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { adminApi.versionDiff(kind, hid).then(setD).catch((e) => setErr((e as Error).message)) }, [kind, hid])
  if (err) return <ErrorAlert message={err} />
  if (!d) return <Loading lines={4} />
  return (
    <div className="grid gap-2">
      <p className="text-[13px] text-muted">{d.to ? t('Версія {a} → {b} ({when})', { a: d.from.version, b: d.to.version, when: fmtDate(d.to.updated) }) : t('Це остання версія.')}</p>
      <DiffView changes={d.changes} />
    </div>
  )
}

/** історія запису: версії новіші першими, клік — різниця */
export function History({ res, id }: { res: string; id: string }) {
  const [rows, setRows] = useState<Revision[] | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => { adminApi.history(res, id).then((r) => { setRows(r.rows); setMore(r.more) }).catch((e) => setErr((e as Error).message)) }, [res, id])
  const loadMore = async () => {
    setBusy(true)
    try { const r = await adminApi.history(res, id, rows?.length ?? 0); setRows([...(rows ?? []), ...r.rows]); setMore(r.more) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (err) return <ErrorAlert message={err} />
  if (!rows) return <Loading lines={5} />
  if (!rows.length) return <Empty icon={HistoryIcon} title={t('Змін ще не було')} description={t('Тут з’являтиметься кожна зміна цього запису — з сайту й з панелі.')} framed={false} />
  return (
    <ul className="grid gap-1.5">
      {rows.map((v) => {
        // підпис і колір дії — як у «Історії змін» («Змінено», «У кошик», кнопки розділів)
        const af = resourceOf('revisions')?.fields.find((f) => f.key === 'action')
        const action = af ? textOf(af, { action: v.action }) : v.action
        const tone = af?.tones?.[v.action] ?? (v.action === 'update' ? 'info' : 'neutral')
        return (
          <li key={v.id} className="rounded-lg border border-line">
            <button type="button" onClick={() => setOpen(open === v.id ? null : v.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-[13px] hover:bg-panel2/50">
              {open === v.id ? <ChevronDown size={15} className="text-muted" /> : <ChevronRight size={15} className="text-muted" />}
              <span className="w-40 shrink-0 text-[12.5px] text-muted">{fmtDate(v.at)}</span>
              <SnBadge size="sm" variant="soft" tone={tone}>{action}</SnBadge>
              <span className="min-w-0 flex-1 truncate">{v.actor_name || t('Сайт')}</span>
              {v.note && <span className="truncate text-[12px] text-muted">{noteOf(v.note)}</span>}
            </button>
            {open === v.id && <div className="border-t border-line p-2.5"><RevisionDiff id={v.id} /></div>}
          </li>
        )
      })}
      {more && <li className="flex justify-center pt-1"><SnButton size="sm" variant="outline" loading={busy} onClick={loadMore}>{t('Показати ще')}</SnButton></li>}
    </ul>
  )
}

/** примітка до зміни: значення полів дії (JSON) — просто переліком («спам, 7»), службова — як є */
function noteOf(note: string) {
  try {
    const o = JSON.parse(note)
    if (o && typeof o === 'object' && !Array.isArray(o)) return Object.values(o).filter((x) => x !== '' && x != null).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')
  } catch { /* не JSON */ }
  return note
}

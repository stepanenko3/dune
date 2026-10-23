/**
 * Черга скарг біржі (/market/reports) — модераторам: скарги, згруповані за ціллю (оголошення, угода, людина), скільки
 * за якими причинами (RMT — окремо й першою), хто й що написав. Дії: сховати / повернути, закрити оголошення,
 * заборонити біржу автору чи стороні угоди (1 / 7 / 30 днів чи назавжди), прибрати оцінки угоди, відхилити скаргу.
 */
import { useEffect, useState } from 'react'
import { Ban, Check, EyeOff, Eye, ShieldCheck, StarOff, X } from 'lucide-react'
import { toast } from 'sonner'
import { fmtAgo, listReports, REASON_LABEL, resolveReport, type Deal, type ListingRow, type Person, type Reason, type ReportGroup } from '@/lib/market'
import { t } from '@/lib/i18n'
import { useUrlParam } from '@/lib/urlState'
import { cn, fmtN } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Seg } from '@/components/ui/seg'
import { Empty, ErrorAlert, Loading, PageError } from '@/components/states'
import { SnTextarea, valueOf } from '@/components/sn'
import { CHOICES, Choice, DealCard, go, ListingCard } from '@/components/market/bits'

const DAYS = [1, 7, 30, 0]

export default function Reports() {
  const [status, setStatus, statusHref] = useUrlParam<'open' | 'closed'>('status', 'open', (v) => v === 'closed')
  const [rows, setRows] = useState<ReportGroup[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setRows(null)
    listReports(status).then((r) => live && setRows(r.rows), () => live && setFailed(true))
    return () => { live = false }
  }, [status, attempt])
  return (
    <section className="grid gap-2.5">
      <Seg label={t('Які скарги')} value={status} onChange={setStatus} href={statusHref} items={[{ id: 'open', label: t('Відкриті') }, { id: 'closed', label: t('Розглянуті') }]} />
      {failed && <PageError title={t('Скарги не завантажились')} onRetry={() => { setFailed(false); setAttempt((n) => n + 1) }} />}
      {!rows && !failed && <Loading />}
      {rows && !rows.length && <Empty icon={ShieldCheck} title={status === 'open' ? t('Відкритих скарг нема') : t('Розглянутих скарг ще нема')} />}
      {rows && rows.length > 0 && <ul className="grid gap-2.5">{rows.map((g) => <Group key={`${g.kind}:${g.target}`} g={g} open={status === 'open'} onDone={() => setAttempt((n) => n + 1)} />)}</ul>}
    </section>
  )
}

/** що вирішив модератор */
const ACTION_L: Record<string, () => string> = { dismiss: () => t('Відхилено'), hide: () => t('Сховано'), close: () => t('Закрито'), ban: () => t('Заборонено'), unrate: () => t('Оцінки прибрано') }
const KIND_L = { listing: () => t('Оголошення біржі'), deal: () => t('Угода'), user: () => t('Людина') }

function Group({ g, open, onDone }: { g: ReportGroup; open: boolean; onDone: () => void }) {
  const [ban, setBan] = useState<{ user: string; name: string } | null>(null)
  const reasons = (Object.entries(g.reasons) as [Reason, number][]).sort((a, b) => (a[0] === 'rmt' ? -1 : b[0] === 'rmt' ? 1 : b[1] - a[1]))
  const run = async (action: string, extra: { days?: number; user?: string; note?: string } = {}) => {
    try { await resolveReport(g.id, { action, ...extra }); toast.success(t('Готово')); onDone() } catch (e) { toast.error((e as Error).message) }
  }
  const listing = g.kind === 'listing' ? (g.subject as (ListingRow & { note: string; author: Person | null }) | null) : null
  const deal = g.kind === 'deal' ? (g.subject as Deal | null) : null
  const user = g.kind === 'user' ? (g.subject as (Person & { ban: { until: number | null; reason: string } | null }) | null) : null
  // кого можна заборонити: людину-ціль, автора оголошення, сторони угоди
  const who: { id: string; name: string }[] = user ? [user] : listing?.author ? [listing.author] : deal ? [deal.maker, deal.taker].filter((x): x is Person => !!x) : []
  return (
    <li className="grid gap-3 rounded-xl border border-line bg-panel p-3.5 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-panel2 px-2 py-0.5 text-[11.5px] font-semibold">{KIND_L[g.kind]()}</span>
        {reasons.map(([r, n]) => <span key={r} className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-bold', r === 'rmt' ? 'bg-bad/15 text-bad' : 'bg-spice/10 text-spice')}>{REASON_LABEL[r]} · {fmtN(n)}</span>)}
        {!open && g.action && <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[11.5px] font-semibold text-ok">{ACTION_L[g.action]?.() ?? g.action}</span>}
        <span className="ml-auto text-[12px] text-muted">{fmtAgo(g.first)}</span>
      </div>
      {listing && <ul className="grid"><ListingCard l={listing} /></ul>}
      {listing?.note && <p className="whitespace-pre-line break-words rounded-lg bg-panel2/60 p-2.5 text-[13px]">{listing.note}</p>}
      {deal && <ul className="grid"><DealCard d={deal} /></ul>}
      {user && <a href={`/u/${user.login}`} onClick={go(`/u/${user.login}`)} className="font-semibold text-spice hover:underline">{user.name} (@{user.login}){user.ban ? ` · ${t('заборонено')}` : ''}</a>}
      {!g.subject && <p className="text-[13px] text-muted">{t('Ціль уже стерто')}</p>}
      <ul className="grid gap-1.5 text-[13px]">
        {g.notes.map((n, i) => (
          <li key={i} className="break-words"><b className="font-semibold">{n.by?.name ?? t('Людину видалено')}</b> · <span className="text-muted">{REASON_LABEL[n.reason]}</span>{n.note && <>: {n.note}</>}</li>
        ))}
      </ul>
      {open && (
        <div className="flex flex-wrap gap-1.5">
          {listing && (listing.item.hidden
            ? <Button size="sm" variant="secondary" onClick={() => run('unhide')}><Eye size={13} />{t('Повернути в стрічку')}</Button>
            : <Button size="sm" variant="secondary" onClick={() => run('hide')}><EyeOff size={13} />{t('Сховати')}</Button>)}
          {listing && listing.status === 'open' && <Button size="sm" variant="secondary" onClick={() => run('close')}><X size={13} />{t('Закрити оголошення')}</Button>}
          {deal && <Button size="sm" variant="secondary" onClick={() => run('unrate')}><StarOff size={13} />{t('Прибрати оцінки угоди')}</Button>}
          {who.map((p) => <Button key={p.id} size="sm" variant="destructive" onClick={() => setBan({ user: p.id, name: p.name })}><Ban size={13} />{t('Заборонити: {name}', { name: p.name })}</Button>)}
          {user?.ban && <Button size="sm" variant="secondary" onClick={() => run('unban')}><Check size={13} />{t('Зняти заборону')}</Button>}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => run('dismiss')}><Check size={13} />{t('Відхилити скаргу')}</Button>
        </div>
      )}
      <BanDialog target={ban} onClose={() => setBan(null)} onBan={(days, note) => run('ban', { user: ban!.user, days, note }).then(() => setBan(null))} />
    </li>
  )
}

function BanDialog({ target, onClose, onBan }: { target: { user: string; name: string } | null; onClose: () => void; onBan: (days: number, note: string) => Promise<void> }) {
  const [days, setDays] = useState(7)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <Modal open={!!target} onOpenChange={(v) => !v && onClose()} title={t('Заборонити біржу: {name}', { name: target?.name ?? '' })} description={t('Нові оголошення, пропозиції й листування стануть недоступні; відкриті оголошення закриються.')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button><Button variant="destructive" loading={busy} onClick={async () => { setBusy(true); setErr(''); try { await onBan(days, note) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }}><Ban size={14} />{t('Заборонити')}</Button></>}>
      <div className="grid gap-3">
        <div className={CHOICES}>
          {DAYS.map((d) => <Choice key={d} on={days === d} onClick={() => setDays(d)}><span className="text-[13.5px] font-semibold">{d ? t('{n} дн.', { n: d }) : t('Назавжди')}</span></Choice>)}
        </div>
        <SnTextarea size="lg" rows={2} maxLength={300} modelValue={note} placeholder={t('Причину побачить заблокована людина')} accessibilityLabel={t('Причина')} onInput={(e: Event) => setNote(valueOf(e))} />
        {err && <ErrorAlert message={err} />}
      </div>
    </Modal>
  )
}

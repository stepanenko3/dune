/**
 * Заявки до гільдії — офіцерам (/g/<адреса>/requests): «Чекають» і «Розглянуті» (?show=done). Картка заявки — людина,
 * відповіді на анкету (години — у поясі офіцера), кілька слів від неї, коментарі офіцерів (кандидат їх не бачить),
 * «Прийняти» (стане новобранцем) чи «Відхилити» з причиною (її побачить кандидат).
 */
import { useEffect, useState } from 'react'
import { Check, MessageSquare, X } from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '@/lib/api'
import { locale, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { plainClick, useUrlParam } from '@/lib/urlState'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Seg } from '@/components/ui/seg'
import { Empty, Loading, PageError } from '@/components/states'
import { Avatar } from '@/components/access/Access'
import { SnInput, SnTextarea, valueOf } from '@/components/sn'
import { Section } from '../Account'
import { STATUS_LABEL, type Answer, type Application, type GuildForm, type Question } from '@/lib/guildProfile'
import type { Slot } from '@/lib/weekly'
import { useGuildNotes } from '@/lib/notify-guild'
import { ScheduleView } from './Schedule'
import type { GuildData } from './types'

const when = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** відповідь за видом питання; не того виду (питання змінили після подачі) — як текст, щоб черга не падала */
function AnswerView({ q, v, tz }: { q: Question; v: Answer; tz: string | null }) {
  const slots = Array.isArray(v) && v.every((s) => typeof s === 'object' && s && Array.isArray((s as Slot).days)) ? (v as Slot[]) : null
  if (q.type === 'hours' && slots) return <ScheduleView compact slots={slots} tz={tz} />
  if (Array.isArray(v)) return <span className="break-words">{slots ? '' : (v as string[]).join(', ')}</span>
  return <span className="whitespace-pre-line break-words">{String(v)}</span>
}

function AppCard({ a, form, slug, full, reload }: { a: Application; form: GuildForm; slug: string; full: boolean; reload: () => void }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast.success(ok); reload() } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const answered = form.questions.filter((q) => a.answers[q.id] != null)
  const pending = a.status === 'pending'
  return (
    <li className="grid gap-3 rounded-xl border border-line bg-panel p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={a.name} color={a.color} size={34} />
        <div className="min-w-0 flex-1">
          <a href={`/u/${a.login}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); useStore.getState().setView('user', { param: a.login }) }} className="break-words text-[15px] font-semibold hover:text-spice">{a.name}</a>
          <div className="break-words text-[12.5px] text-muted">{[`@${a.login}`, a.nick && t('у грі {nick}', { nick: a.nick }), t('подано {date}', { date: when(a.created) })].filter(Boolean).join(' · ')}</div>
        </div>
        {!pending && (
          <span className={cn('rounded-full px-2.5 py-0.5 text-[12px] font-semibold', a.status === 'accepted' ? 'bg-ok/10 text-ok' : a.status === 'rejected' ? 'bg-bad/10 text-bad' : 'bg-panel2 text-muted')}>
            {STATUS_LABEL[a.status]}
          </span>
        )}
      </div>
      {answered.length > 0 && (
        <dl className="grid gap-2.5">
          {answered.map((q) => (
            <div key={q.id} className="grid gap-1">
              <dt className="text-[12.5px] font-semibold text-muted">{q.label}</dt>
              <dd className="text-[14px]"><AnswerView q={q} v={a.answers[q.id]} tz={a.tz} /></dd>
            </div>
          ))}
        </dl>
      )}
      {a.note && <p className="whitespace-pre-line break-words rounded-lg bg-panel2/50 px-3 py-2 text-[13.5px]">«{a.note}»</p>}
      {!pending && (a.decidedBy || a.reason) && (
        <p className="text-[13px] text-muted">
          {[a.decided && when(a.decided), a.decidedBy && t('вирішив {name}', { name: a.decidedBy })].filter(Boolean).join(' · ')}
          {a.reason && <><br />{t('Причина: {reason}', { reason: a.reason })}</>}
        </p>
      )}
      <div className="grid gap-2 border-t border-line pt-3">
        <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-muted"><MessageSquare size={13} />{t('Коментарі офіцерів — кандидат їх не бачить')}</div>
        {a.comments.map((c) => (
          <div key={c.id} className="flex gap-2 text-[13.5px]">
            <Avatar name={c.by || '?'} color={c.color || '#888'} size={22} />
            <div className="min-w-0 flex-1"><b className="font-semibold">{c.by || t('хтось')}</b> <span className="text-[12px] text-muted">{when(c.created)}</span><div className="whitespace-pre-line break-words">{c.text}</div></div>
          </div>
        ))}
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!comment.trim()) return; void act(async () => { await post(`/api/guilds/${slug}/requests/${a.id}/comments`, { text: comment.trim() }); setComment('') }, t('Коментар додано')) }}>
          <SnInput size="lg" className="min-w-[min(100%,14rem)] flex-1" maxLength={1000} modelValue={comment} placeholder={t('Коментар для інших офіцерів')} accessibilityLabel={t('Коментар для інших офіцерів')} onInput={(e: Event) => setComment(valueOf(e))} />
          <Button type="submit" variant="secondary" disabled={busy || !comment.trim()}>{t('Додати')}</Button>
        </form>
      </div>
      {pending && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy || full} onClick={() => act(() => post(`/api/guilds/${slug}/requests/${a.id}`, { accept: true }), t('{name} — у гільдії', { name: a.name }))}><Check size={15} />{t('Прийняти')}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => { setReason(''); setRejecting(true) }}><X size={15} />{t('Відхилити')}</Button>
          {full && <span className="text-[12.5px] font-medium text-bad">{t('гільдія заповнена')}</span>}
        </div>
      )}
      <Modal open={rejecting} onOpenChange={setRejecting} size="sm" title={t('Відхилити заявку {name}?', { name: a.name })} description={t('Причину побачить кандидат — напиши коротко й по-людськи.')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(false)}>{t('Скасувати')}</Button>
            <Button variant="destructive" disabled={!reason.trim() || busy} onClick={() => { setRejecting(false); void act(() => post(`/api/guilds/${slug}/requests/${a.id}`, { accept: false, reason: reason.trim() }), t('Відхилено')) }}>{t('Відхилити')}</Button>
          </>
        }>
        <SnTextarea size="lg" rows={3} maxLength={500} modelValue={reason} placeholder={t('Наприклад: поки набираємо з 60-го рівня')} accessibilityLabel={t('Причина')} onInput={(e: Event) => setReason(valueOf(e))} />
      </Modal>
    </li>
  )
}

export function Queue({ d, onChange }: { d: GuildData; onChange: () => void }) {
  const [show, setShow, showHref] = useUrlParam<'pending' | 'done'>('show', 'pending', (v) => v === 'done')
  const [data, setData] = useState<{ rows: Application[]; form: GuildForm } | null>(null)
  const [error, setError] = useState('')
  const slug = d.guild.slug
  const load = () => get<{ rows: Application[]; form: GuildForm }>(`/api/guilds/${slug}/requests${show === 'done' ? '?show=done' : ''}`).then((r) => { setData(r); setError('') }).catch((e) => setError((e as Error).message))
  useEffect(() => { setData(null); void load() }, [slug, show])
  // зайшов у чергу — сповіщення «нова заявка» цієї гільдії прочитані
  const { notes, read } = useGuildNotes(true, d.guild.id)
  useEffect(() => { read(notes.filter((n) => n.kind === 'guild.app.new')) }, [notes])
  const full = d.guild.members >= d.cap
  return (
    <div className="grid gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Seg label={t('Які заявки')} value={show} onChange={setShow} href={showHref} items={[{ id: 'pending', label: d.requests.length ? t('Чекають · {n}', { n: d.requests.length }) : t('Чекають') }, { id: 'done', label: t('Розглянуті') }]} />
        {!d.guild.open && <span className="text-[12.5px] text-muted">{t('Набір закрито — нові заявки не приходять (змінити — у налаштуваннях)')}</span>}
      </div>
      {full && show === 'pending' && !!data?.rows.length && <p className="text-[13px] font-medium text-bad">{t('Гільдія заповнена ({n} з {cap}): прийняти можна, коли звільниться місце.', { n: d.guild.members, cap: d.cap })}</p>}
      {error ? <PageError message={error} onRetry={load} />
        : !data ? <Loading />
          : !data.rows.length ? (
            <Section title={show === 'done' ? t('Розглянутих заявок нема') : t('Заявок нема')} hint={show === 'done' ? undefined : t('Прийнятий за заявкою — новобранець: бачить гільдійське, але не змінює. Підвищити можна в «Учасниках».')}>
              <Empty framed={false} title={show === 'done' ? t('Тут будуть прийняті й відхилені заявки') : t('Нових заявок поки нема')} />
            </Section>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] items-start gap-2.5 xl:grid-cols-2">
              {data.rows.map((a) => <AppCard key={a.id} a={a} form={data.form} slug={slug} full={full} reload={() => { void load(); onChange() }} />)}
            </ul>
          )}
    </div>
  )
}

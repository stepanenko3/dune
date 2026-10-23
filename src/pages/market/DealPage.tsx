/**
 * Угода (/market/deal/<id>): кроки «Запропоновано → Прийнято → Завершено», хто продає й хто купує (з репутацією),
 * умови, дії за роллю (прийняти / відхилити — тому, хто веде оголошення; «Завершено» — кожній стороні; скасувати),
 * листування сторін і оцінка після завершення. Оновлюється, коли приходить сповіщення (друга сторона щось зробила).
 */
import { useEffect, useRef, useState } from 'react'
import { Check, CheckCircle2, CircleDot, Send, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { dealAction, fmtDate, fmtSolari, getDeal, listingHref, rateDeal, sendMessage, type DealFull } from '@/lib/market'
import { useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { subscribe } from '@/lib/stream'
import { cn, fmtN } from '@/lib/utils'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { Loading, PageError } from '@/components/states'
import { useCrumb } from '@/components/Crumbs'
import { confirmAsk } from '@/components/ui/confirm'
import { Avatar } from '@/components/access/Access'
import { SnTextarea, valueOf } from '@/components/sn'
import { Section } from '../Account'
import { BarterList, DealChip, go, Good, RepBadge, sellerOf, Stars, whereText } from '@/components/market/bits'
import { ReportButton } from '@/components/market/ReportDialog'
import { GoodName } from '@/components/market/names'

const STEPS = ['offered', 'accepted', 'done'] as const

export default function DealPage({ id }: { id: string }) {
  const me = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const setView = useStore((s) => s.setView)
  const [d, setD] = useState<DealFull | null>(null)
  const [err, setErr] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!ready) return
    let live = true
    getDeal(id).then((x) => live && setD(x), (e) => live && setErr((e as Error).message))
    return () => { live = false }
  }, [id, ready, me?.id, attempt])
  // друга сторона щось зробила — прийде сповіщення: перечитати угоду
  useEffect(() => subscribe('/api/notifications/stream', () => setAttempt((n) => n + 1)), [])
  useCrumb(err ? [] : d ? [{ label: t('Угода') }] : null, { sub: 'deals', value: t('Угоди') })

  if (err) return <PageError page message={err}><Button variant="secondary" onClick={() => setView('market', { sub: 'deals' })}>{t('До угод')}</Button></PageError>
  if (!d) return <Loading page />
  const act = async (a: 'accept' | 'decline' | 'cancel' | 'done') => {
    if (a === 'cancel' && !(await confirmAsk({ title: t('Скасувати угоду?'), description: t('Друга сторона отримає сповіщення.'), confirm: t('Скасувати угоду'), destructive: true }))) return
    // прийняти — ту версію умов, яку людина бачить (змінили — сервер скаже, і ми покажемо нові)
    try { setD(await dealAction(d.id, a, a === 'accept' ? { updated: d.updated } : {})) } catch (e) { toast.error((e as Error).message); setAttempt((n) => n + 1) }
  }
  const party = d.role === 'maker' || d.role === 'taker'
  const mineDone = d.role === 'maker' ? d.makerDone : d.role === 'taker' ? d.takerDone : null
  const otherDone = d.role === 'maker' ? d.takerDone : d.role === 'taker' ? d.makerDone : null
  const seller = sellerOf(d) === 'maker' ? d.maker : d.taker
  const buyer = sellerOf(d) === 'maker' ? d.taker : d.maker
  const sRep = sellerOf(d) === 'maker' ? d.reps.maker : d.reps.taker
  const bRep = sellerOf(d) === 'maker' ? d.reps.taker : d.reps.maker
  const step = d.status === 'done' ? 2 : d.status === 'accepted' ? 1 : 0
  const closed = d.status === 'declined' || d.status === 'cancelled'

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1100px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-10">
        <PageHeader
          title={<span className="inline-flex flex-wrap items-center gap-2">{t('Угода')}: <GoodName gid={d.gid} /> <span className="tabular-nums text-muted">×{fmtN(d.qty)}</span></span>}
          badges={<DealChip status={d.status} />}
          actions={
            <>
              {d.role === 'owner' && d.status === 'offered' && <><Button onClick={() => act('accept')}><Check size={14} />{t('Прийняти')}</Button><Button variant="ghost" onClick={() => act('decline')}><X size={14} />{t('Відхилити')}</Button></>}
              {party && d.status === 'accepted' && !mineDone && <Button onClick={() => act('done')}><CheckCircle2 size={14} />{t('Завершено — я отримав')}</Button>}
              {(d.role === 'maker' && (d.status === 'offered' || d.status === 'accepted')) || (d.role === 'taker' && d.status === 'accepted') ? <Button variant="ghost" onClick={() => act('cancel')}><X size={14} />{t('Скасувати')}</Button> : null}
              {party && <ReportButton target={{ kind: 'deal', id: d.id }} />}
            </>
          }
        >
          {!closed ? (
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" aria-label={t('Кроки угоди')}>
              {STEPS.map((s, i) => (
                <li key={s} className={cn('inline-flex items-center gap-1.5', i <= step ? 'font-semibold text-ink' : 'text-muted')}>
                  {i < step || d.status === 'done' ? <CheckCircle2 size={15} className="text-ok" /> : <CircleDot size={15} className={i === step ? 'text-spice' : ''} />}
                  {s === 'offered' ? t('Запропоновано') : s === 'accepted' ? t('Прийнято') : t('Завершено')}
                  {i < 2 && <span className="mx-1 text-muted" aria-hidden>→</span>}
                </li>
              ))}
            </ol>
          ) : d.reason ? <p className="text-[13px] text-muted">{t('Причина: {reason}', { reason: d.reason })}</p> : null}
        </PageHeader>
        {d.status === 'accepted' && party && (
          <div className="rounded-xl border border-spice/40 bg-spice/5 px-4 py-3 text-[13.5px]">
            <b className="block font-semibold">{mineDone ? t('Чекаємо на іншу сторону') : t('Що далі')}</b>
            {mineDone ? t('Ти підтвердив передачу. Угода завершиться, щойно підтвердить і друга сторона.') : otherDone ? t('Друга сторона вже підтвердила. Отримав своє в грі — натисни «Завершено».') : t('Домовтесь у листуванні, де й коли, передайте в грі — і кожен натисне «Завершено».')}
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="grid content-start gap-2.5">
            <Section title={t('Умови')}>
              <div className="grid gap-3 text-[13.5px]">
                <Good gid={d.gid} size={48} />
                {d.price != null ? (
                  <p><b className="font-display text-[18px] tabular-nums">{fmtSolari(d.price)}</b> <span className="text-muted">{t('за штуку')} · {t('разом {sum}', { sum: fmtSolari(d.price * d.qty) })}</span></p>
                ) : <p className="flex flex-wrap items-center gap-1.5"><span className="text-muted">{t('Бартер:')}</span><BarterList barter={d.barter} /></p>}
                <p className="break-words text-muted">{whereText(d)}</p>
                <p className="text-muted">{t('Запропоновано {date}', { date: fmtDate(d.created) })}</p>
                {d.listing && <a href={listingHref(d.listingId)} onClick={go(listingHref(d.listingId))} className="justify-self-start font-semibold text-spice hover:underline">{t('Оголошення →')}</a>}
              </div>
            </Section>
            <Section title={t('Сторони')}>
              <div className="grid gap-3">
                <Side label={t('Продавець')} p={seller} rep={sRep} pending={!seller && d.status === 'offered' ? d.owner.name : null} />
                <Side label={t('Покупець')} p={buyer} rep={bRep} pending={!buyer && d.status === 'offered' ? d.owner.name : null} />
                {d.owner.kind === 'guild' && <p className="text-[12.5px] text-muted">{t('Оголошення гільдії [{tag}] {name}', { tag: d.owner.tag ?? '', name: d.owner.name })}</p>}
              </div>
            </Section>
            {d.canRate && <RateBox d={d} onDone={setD} />}
          </div>
          <Chat d={d} onSent={setD} />
        </div>
      </div>
    </div>
  )
}

/** pending — пропозицію ще не прийняли: хто веде оголошення (людина чи гільдія) */
function Side({ label, p, rep, pending }: { label: string; p: DealFull['maker']; rep: DealFull['reps']['maker']; pending: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="w-16 text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {p ? (
        <a href={`/u/${p.login}`} onClick={go(`/u/${p.login}`)} className="flex items-center gap-2 font-semibold hover:text-spice"><Avatar name={p.name} color={p.color} size={24} />{p.name}</a>
      ) : <span className="text-muted">{pending ? t('{name} — ще не відповів', { name: pending }) : t('Людину видалено')}</span>}
      <RepBadge rep={rep} />
    </div>
  )
}

/** листування сторін: найсвіжіше внизу, поле — під ним */
function Chat({ d, onSent }: { d: DealFull; onSent: (d: DealFull) => void }) {
  const me = useAuth((s) => s.user)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLLIElement>(null)
  const canWrite = d.role !== 'mod'
  // нове повідомлення — показати його (але не гортати сторінку, щойно її відкрили)
  const seen = useRef(d.messages.length)
  useEffect(() => {
    if (d.messages.length > seen.current) end.current?.scrollIntoView({ block: 'nearest' })
    seen.current = d.messages.length
  }, [d.messages.length])
  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    try { onSent(await sendMessage(d.id, text)); setText('') } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Section title={t('Листування')} hint={t('Видно лише сторонам угоди (і модераторам за скаргою). Реальні гроші — заборонено.')}>
      <div className="grid gap-3">
        <ul className="grid gap-2">
          {d.messages.map((m) => {
            const mine = m.user?.id === me?.id
            return (
              <li key={m.id} className={cn('grid max-w-[85%] gap-0.5 rounded-xl px-3 py-2 text-[13.5px]', mine ? 'justify-self-end bg-spice/10' : 'justify-self-start bg-panel2')}>
                <span className="text-[11.5px] text-muted">{m.user?.name ?? t('Людину видалено')} · {fmtDate(m.at)}</span>
                <span className="whitespace-pre-line break-words">{m.text}</span>
              </li>
            )
          })}
          {!d.messages.length && <li className="text-[13px] text-muted">{t('Поки тихо. Напиши, де й коли зручно передати.')}</li>}
          <li ref={end} aria-hidden />
        </ul>
        {canWrite && (
          <div className="grid gap-2">
            <SnTextarea size="lg" rows={2} maxLength={1000} modelValue={text} placeholder={t('Повідомлення')} accessibilityLabel={t('Повідомлення')} onInput={(e: Event) => setText(valueOf(e))}
              onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } }} />
            <Button className="justify-self-end" loading={busy} disabled={!text.trim()} onClick={send}><Send size={14} />{t('Надіслати')}</Button>
          </div>
        )}
      </div>
    </Section>
  )
}

/** оцінка другої сторони: зірки й коротко (змінити можна 14 днів) */
function RateBox({ d, onDone }: { d: DealFull; onDone: (d: DealFull) => void }) {
  const [score, setScore] = useState(d.myRating?.score ?? 0)
  const [text, setText] = useState(d.myRating?.text ?? '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { onDone(await rateDeal(d.id, score, text)); toast.success(t('Дякуємо за оцінку')) } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Section title={d.myRating ? t('Твоя оцінка') : t('Оціни другу сторону')} hint={t('З оцінок складається репутація на біржі.')}>
      <div className="grid gap-2.5">
        <Stars value={score} onChange={setScore} size={22} />
        <SnTextarea size="lg" rows={2} maxLength={300} modelValue={text} placeholder={t('Коротко: як усе пройшло')} accessibilityLabel={t('Відгук')} onInput={(e: Event) => setText(valueOf(e))} />
        <Button className="justify-self-start" loading={busy} disabled={!score} onClick={save}><Star size={14} />{d.myRating ? t('Змінити оцінку') : t('Оцінити')}</Button>
        {d.theirRating && <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">{t('Тебе оцінили:')} <Stars value={d.theirRating.score} size={14} /> {d.theirRating.text}</p>}
      </div>
    </Section>
  )
}

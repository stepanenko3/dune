/**
 * Оголошення (/market/<id>): що, скільки й почім, де торгують і де передати, контакт (нік — тим, хто увійшов), коли
 * розміщено й до коли діє. Іншим — «Запропонувати угоду» (кількість, солари чи бартер, повідомлення); тому, хто веде
 * оголошення, — пропозиції (прийняти / відхилити), зустрічні заявки («Збіги»), змінити, закрити, продовжити, стерти.
 * Скарга — будь-кому, хто увійшов. Оновлюється наживо (потік біржі).
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import { CalendarClock, Check, Clock, Map as MapIcon, MessageSquare, Pencil, RefreshCw, Send, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { closeListing, dealAction, dealHref, deleteListing, fmtDate, fmtSolari, getListing, isLive, itemHref, offerDeal, renewListing, SIDE_LABEL, STATUS_LABEL, TTLS, type ListingFull } from '@/lib/market'
import { loginHref, useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { subscribe } from '@/lib/stream'
import { fmtN, word } from '@/lib/utils'
import { openPath, useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Seg } from '@/components/ui/seg'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorAlert, Loading, PageError } from '@/components/states'
import { ItemBar } from '@/components/access/Access'
import { useCrumb } from '@/components/Crumbs'
import { confirmAsk } from '@/components/ui/confirm'
import { SnInput, SnTextarea, valueOf } from '@/components/sn'
import { Section } from '../Account'
import { Field } from '../Auth'
import { BarterList, CHOICES, Choice, DealCard, go, Good, LISTING_GRID, ListingCard, Price, RepBadge, SideChip, whereText } from '@/components/market/bits'
import { ReportButton } from '@/components/market/ReportDialog'
import { GoodName } from '@/components/market/names'
import { mapHref } from '@/components/events/EventMap'

const EventMap = lazy(() => import('@/components/events/EventMap'))
const dayWord = (n: number) => word(n, [t('день'), t('дні'), t('днів')])

export default function ListingPage({ id }: { id: string }) {
  const me = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const setView = useStore((s) => s.setView)
  const [l, setL] = useState<ListingFull | null>(null)
  const [err, setErr] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [renew, setRenew] = useState(false)
  useEffect(() => {
    if (!ready) return
    let live = true
    getListing(id).then((x) => live && setL(x), (e) => live && setErr((e as Error).message))
    return () => { live = false }
  }, [id, ready, me?.id, attempt])
  useEffect(() => subscribe('/api/market/stream', (ev) => { if ((ev as { id?: string }).id === id) setAttempt((n) => n + 1) }), [id])
  useCrumb(err ? [] : l ? [{ label: `${SIDE_LABEL[l.side]}` }] : null, l ? { sub: l.rights.edit ? 'mine' : null, value: l.rights.edit ? t('Мої') : t('Оголошення') } : undefined)

  if (err) return <PageError page message={err}><Button variant="secondary" onClick={() => setView('market')}>{t('До біржі')}</Button></PageError>
  if (!l) return <Loading page />
  const live = isLive(l)
  const act = async (fn: () => Promise<ListingFull>, done: string) => {
    try { setL(await fn()); toast.success(done) } catch (e) { toast.error((e as Error).message) }
  }
  const remove = async () => {
    if (!(await confirmAsk({ title: t('Стерти оголошення?'), description: t('Його не буде ні в стрічці, ні в тебе. Повернути не вийде.'), confirm: t('Стерти'), destructive: true }))) return
    try { await deleteListing(l.id); toast.success(t('Оголошення стерто')); setView('market', { sub: 'mine' }) } catch (e) { toast.error((e as Error).message) }
  }
  const status = !live ? (l.status === 'open' ? STATUS_LABEL.expired : STATUS_LABEL[l.status]) : null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-10">
        <PageHeader
          meta={<ItemBar item={l.item} className="w-full" onChange={(it) => setL({ ...l, item: it })} />}
          title={<span className="inline-flex flex-wrap items-center gap-2"><SideChip side={l.side} className="text-[13px]" /><GoodName gid={l.gid} /> <span className="tabular-nums text-muted">×{fmtN(l.left)}</span></span>}
          badges={status ? <span className="rounded-full bg-panel2 px-2.5 py-1 text-[12px] font-semibold text-muted">{status}</span> : undefined}
          actions={l.rights.edit ? (
            <>
              <Button variant="secondary" onClick={() => setView('market', { param: l.id, sub: 'edit' })}><Pencil size={14} />{t('Змінити')}</Button>
              {live ? <Button variant="secondary" onClick={() => act(() => closeListing(l.id), t('Оголошення закрито'))}><X size={14} />{t('Закрити')}</Button> : null}
              {l.left > 0 && <Button onClick={() => setRenew(true)}><RefreshCw size={14} />{live ? t('Продовжити') : t('Відкрити знову')}</Button>}
              {l.rights.manage && !l.deals.length && <Button variant="ghost" className="text-bad hover:text-bad" onClick={remove}><Trash2 size={14} />{t('Стерти')}</Button>}
            </>
          ) : me ? <ReportButton target={{ kind: 'listing', id: l.id }} /> : undefined}
        />
        {l.item.hidden && <ErrorAlert title={t('Оголошення сховане модератором')} message={t('Його не видно в стрічці й книзі заявок. Якщо це помилка — напиши адміністрації.')} />}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="grid content-start gap-2.5">
            <Section title={t('Умови')}>
              <div className="grid gap-4">
                <Good gid={l.gid} size={56} />
                <Price l={l} />
                <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-2.5 text-[13.5px] sm:grid-cols-2">
                  <Fact label={t('Кількість')} value={<>{fmtN(l.left)}{l.left !== l.qty && <span className="text-muted"> {t('з {n}', { n: fmtN(l.qty) })}</span>}</>} />
                  {l.minQty > 0 && <Fact label={t('Мінімальна партія')} value={fmtN(l.minQty)} />}
                  <Fact label={t('Де торгуємо')} value={whereText(l)} />
                  <Fact label={t('Розміщено')} value={<span className="inline-flex items-center gap-1"><Clock size={13} className="text-muted" />{fmtDate(l.fresh)}</span>} />
                  <Fact label={live ? t('Діє до') : t('Діяло до')} value={<span className="inline-flex items-center gap-1"><CalendarClock size={13} className="text-muted" />{fmtDate(l.expires)}</span>} />
                  <Fact label={t('Хто')} value={<RepBadge rep={l.rep} />} />
                </dl>
                {l.note && <p className="whitespace-pre-line break-words rounded-lg bg-panel2/60 p-3 text-[13.5px] leading-relaxed">{l.note}</p>}
                <a href={itemHref(l.gid)} onClick={go(itemHref(l.gid))} className="justify-self-start text-[13px] font-semibold text-spice hover:underline">{t('Книга заявок і ціни цього предмета →')}</a>
              </div>
            </Section>
            {l.place && (
              <Section title={t('Де передати')}>
                {l.place.kind === 'point' && (
                  <div className="grid gap-2">
                    <Suspense fallback={<Loading />}><EventMap arena={l.place.point} watch={null} labels={{ arena: t('Місце передачі') }} className="h-[300px]" /></Suspense>
                    <a href={mapHref(l.place.point)} onClick={go(mapHref(l.place.point))} className="inline-flex items-center gap-1.5 justify-self-start text-[13px] font-semibold text-spice hover:underline"><MapIcon size={14} />{t('Відкрити на мапі')}</a>
                  </div>
                )}
                {l.place.kind === 'base' && (l.place.base
                  ? <a href={`/bases/${l.place.base}`} onClick={go(`/bases/${l.place.base}`)} className="font-semibold text-spice hover:underline">{l.place.title || t('База')}</a>
                  : <span className="font-semibold">{l.place.title || t('База')}</span>)}
                {l.place.kind === 'text' && <p className="break-words text-[14px]">{l.place.text}</p>}
              </Section>
            )}
            <Section title={t('Як зв’язатися')}>
              <div className="grid gap-2 text-[13.5px]">
                {l.contact.site && <p className="flex items-center gap-2"><MessageSquare size={15} className="text-spice" />{t('Пропозиції й листування — тут, на сайті')}</p>}
                {l.contact.nick && <p><span className="text-muted">{t('Нік у грі:')}</span> <b className="select-all font-mono">{l.contact.nick}</b></p>}
                {l.contact.hidden && <p className="text-muted"><a href={loginHref()} onClick={go(loginHref())} className="font-semibold text-spice hover:underline">{t('Увійди')}</a>, {t('щоб побачити нік у грі')}</p>}
              </div>
            </Section>
          </div>
          <div className="grid content-start gap-2.5">
            {!l.rights.edit && <OfferBox l={l} onDone={(dealId) => openPath(dealHref(dealId))} />}
            {l.rights.edit && <Offers l={l} onChange={() => setAttempt((n) => n + 1)} />}
            {!l.rights.edit && l.deals.length > 0 && (
              <Section title={t('Твої угоди за цим оголошенням')}>
                <ul className="grid gap-2">{l.deals.map((d) => <DealCard key={d.id} d={d} me={me?.id} />)}</ul>
              </Section>
            )}
          </div>
        </div>
        {l.rights.edit && (
          <Section title={t('Збіги')} hint={t('Зустрічні заявки на той самий предмет у твоєму світі з сумісною ціною. Про нові ти отримаєш сповіщення.')}>
            {l.matches.length ? <ul className={LISTING_GRID}>{l.matches.map((m) => <ListingCard key={m.id} l={m} />)}</ul> : <p className="text-[13px] text-muted">{t('Поки нема — щойно з’явиться, сповістимо.')}</p>}
          </Section>
        )}
      </div>
      <RenewDialog open={renew} l={l} onClose={() => setRenew(false)} onDone={(x) => { setL(x); setRenew(false); toast.success(t('Оголошення продовжено')) }} />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="min-w-0"><dt className="text-[12px] text-muted">{label}</dt><dd className="break-words font-semibold">{value}</dd></div>
}

/** продовжити: строк картками */
function RenewDialog({ open, l, onClose, onDone }: { open: boolean; l: ListingFull; onClose: () => void; onDone: (l: ListingFull) => void }) {
  const [ttl, setTtl] = useState(l.ttl || 7)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go2 = async () => {
    setBusy(true); setErr('')
    try { onDone(await renewListing(l.id, ttl)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onOpenChange={(v) => !v && onClose()} title={t('Продовжити оголошення')} description={t('Від сьогодні — на скільки днів?')}
      footer={<><Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button><Button loading={busy} onClick={go2}><RefreshCw size={14} />{t('Продовжити')}</Button></>}>
      <div className="grid gap-3">
        <div className={CHOICES}>{TTLS.map((d) => <Choice key={d} on={ttl === d} onClick={() => setTtl(d)}><span className="text-[13.5px] font-semibold">{fmtN(d)} {dayWord(d)}</span></Choice>)}</div>
        {err && <ErrorAlert message={err} />}
      </div>
    </Modal>
  )
}

/** запропонувати угоду: кількість, солари чи бартер (якщо оголошення дозволяє обидва), ціна, повідомлення */
function OfferBox({ l, onDone }: { l: ListingFull; onDone: (dealId: string) => void }) {
  const me = useAuth((s) => s.user)
  const minQ = l.minQty ? Math.min(l.minQty, l.left) : 1
  const [qty, setQty] = useState(String(minQ))
  const [pay, setPay] = useState<'solari' | 'barter'>(l.pay === 'barter' ? 'barter' : 'solari')
  const [price, setPrice] = useState(l.price ? String(l.price) : '')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (l.myOffer) {
    return (
      <Section title={t('Твоя пропозиція')}>
        <Button onClick={() => onDone(l.myOffer!)}><Send size={14} />{t('Відкрити угоду')}</Button>
      </Section>
    )
  }
  if (!me) {
    return (
      <Section title={l.side === 'sell' ? t('Купити') : t('Продати')}>
        <Empty framed={false} icon={MessageSquare} title={t('Увійди, щоб запропонувати угоду')}><Button onClick={() => openPath(loginHref())}>{t('Увійти')}</Button></Empty>
      </Section>
    )
  }
  if (!l.rights.offer) {
    return (
      <Section title={l.side === 'sell' ? t('Купити') : t('Продати')}>
        <p className="text-[13.5px] text-muted">{!isLive(l) ? t('Оголошення вже не діє.') : !l.contact.site ? t('Автор просить писати йому в грі — нік ліворуч.') : t('Зараз запропонувати угоду не можна.')}</p>
      </Section>
    )
  }
  const n = Number(qty) || 0
  const p = Number(price) || 0
  const send = async () => {
    setBusy(true); setErr('')
    try {
      const d = await offerDeal(l.id, { qty: n, pay, price: pay === 'solari' ? p : null, text })
      toast.success(t('Пропозицію надіслано'))
      onDone(d.id)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Section title={l.side === 'sell' ? t('Купити') : t('Продати')} hint={t('Автор отримає сповіщення. Прийме — домовитесь у листуванні угоди й передасте в грі.')}>
      <div className="grid gap-3">
        <Field label={t('Кількість')} hint={t('Доступно: {n}', { n: fmtN(l.left) }) + (l.minQty ? ` · ${t('мінімум {n}', { n: fmtN(minQ) })}` : '')}>
          <SnInput size="lg" type="number" inputmode="numeric" min={minQ} max={l.left} modelValue={qty} accessibilityLabel={t('Кількість')} onInput={(e: Event) => setQty(valueOf(e).replace(/\D/g, ''))} />
        </Field>
        {l.pay === 'both' && <Seg label={t('Оплата')} value={pay} onChange={setPay} items={[{ id: 'solari', label: t('Солари') }, { id: 'barter', label: t('Бартер') }]} />}
        {pay === 'solari' ? (
          <Field label={t('Ціна за штуку, Solari')} hint={n && p ? t('Разом: {sum}', { sum: fmtSolari(n * p) }) : undefined}>
            <SnInput size="lg" type="number" inputmode="numeric" min={1} modelValue={price} accessibilityLabel={t('Ціна за штуку, Solari')} onInput={(e: Event) => setPrice(valueOf(e).replace(/\D/g, ''))} />
          </Field>
        ) : (
          <div className="grid gap-1 text-[13px]"><span className="text-muted">{t('Бартер, як в оголошенні:')}</span><BarterList barter={l.barter} /></div>
        )}
        <Field label={t('Повідомлення')}>
          <SnTextarea size="lg" rows={3} maxLength={1000} modelValue={text} placeholder={t('Напр.: коли зручно передати?')} accessibilityLabel={t('Повідомлення')} onInput={(e: Event) => setText(valueOf(e))} />
        </Field>
        {err && <ErrorAlert message={err} />}
        <Button loading={busy} onClick={send} disabled={!n}><Send size={14} />{t('Запропонувати угоду')}</Button>
      </div>
    </Section>
  )
}

/** пропозиції на моє оголошення: прийняти / відхилити; решта — до угоди */
function Offers({ l, onChange }: { l: ListingFull; onChange: () => void }) {
  const me = useAuth((s) => s.user)
  const act = async (id: string, a: 'accept' | 'decline') => {
    try {
      await dealAction(id, a)
      toast.success(a === 'accept' ? t('Угоду прийнято — домовтеся в листуванні') : t('Пропозицію відхилено'))
      if (a === 'accept') openPath(dealHref(id))
      else onChange()
    } catch (e) { toast.error((e as Error).message) }
  }
  const open = l.deals.filter((d) => d.status === 'offered' || d.status === 'accepted')
  const past = l.deals.filter((d) => !(d.status === 'offered' || d.status === 'accepted'))
  return (
    <Section title={t('Пропозиції')} hint={open.length ? undefined : t('Тут з’являться пропозиції угод — ти отримаєш сповіщення.')}>
      <ul className="grid gap-2">
        {open.map((d) => (
          <DealCard key={d.id} d={d} me={me?.id} actions={d.status === 'offered' ? (
            <>
              <Button size="sm" onClick={() => act(d.id, 'accept')}><Check size={13} />{t('Прийняти')}</Button>
              <Button size="sm" variant="ghost" onClick={() => act(d.id, 'decline')}><X size={13} />{t('Відхилити')}</Button>
            </>
          ) : undefined} />
        ))}
        {past.slice(0, 10).map((d) => <DealCard key={d.id} d={d} me={me?.id} />)}
      </ul>
    </Section>
  )
}

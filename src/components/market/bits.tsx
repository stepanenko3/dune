/**
 * Шматки сторінок біржі: вид («Куплю» / «Продам»), репутація зірками, ціна (за штуку й разом) чи бартер, предмет з
 * іконкою й тиром, картка оголошення для стрічки, картка угоди, вибір картками (Choice) — як у редакторі подій.
 */
import type { ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Clock, Handshake, MapPin, Repeat, Star } from 'lucide-react'
import { rarityLabel, tierLabel } from '@/lib/catalog'
import { DEAL_LABEL, fmtAgo, fmtSolari, isLive, itemHref, listingHref, dealHref, SIDE_LABEL, STATUS_LABEL, type Barter, type Deal, type DealStatus, type ListingRow, type Rep, type Side } from '@/lib/market'
import { REGIONS } from '@/lib/ddReset'
import { t } from '@/lib/i18n'
import { cn, fmtN, fmtP } from '@/lib/utils'
import { plainClick } from '@/lib/urlState'
import { openPath } from '@/store'
import { AccessBadge, OwnerLink } from '@/components/access/Access'
import { Icon } from '@/components/catalog/bits'
import { GoodName, iconOf, itemOf, useGoods } from './names'

export const LISTING_GRID = 'grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(min(330px,100%),1fr))]'

/** перехід по посиланню сайту без перезавантаження (Ctrl/⌘ — нова вкладка) */
export const go = (href: string) => (e: React.MouseEvent) => { if (!plainClick(e)) return; e.preventDefault(); openPath(href) }

const SIDE_CLS: Record<Side, string> = { buy: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', sell: 'bg-spice/10 text-spice' }
export function SideChip({ side, className }: { side: Side; className?: string }) {
  const I = side === 'buy' ? ArrowDownToLine : ArrowUpFromLine
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold', SIDE_CLS[side], className)}><I size={12} />{SIDE_LABEL[side]}</span>
}

/** репутація: ★ 4,8 · 12 угод (оцінок ще нема — «нові угоди: N» чи «ще без угод») */
export function RepBadge({ rep, className }: { rep: Rep | null; className?: string }) {
  if (!rep) return null
  return (
    <span className={cn('inline-flex items-center gap-1 text-[12px] tabular-nums text-muted', className)} title={t('Середня оцінка й завершені угоди')}>
      {rep.avg != null ? <><Star size={12} className="fill-current text-spice" /><b className="font-semibold text-ink">{fmtP(rep.avg)}</b><span>({fmtN(rep.n)})</span></> : null}
      <span>{rep.done ? t('угод: {n}', { n: fmtN(rep.done) }) : t('ще без угод')}</span>
    </span>
  )
}

/** зірки для оцінки (1–5); onChange — можна вибрати */
export function Stars({ value, onChange, size = 18 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role={onChange ? 'radiogroup' : undefined} aria-label={t('Оцінка')}>
      {[1, 2, 3, 4, 5].map((n) => onChange ? (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={t('{n} з 5', { n })} onClick={() => onChange(n)} className="grid h-10 w-10 place-items-center rounded-md hover:bg-spice/10">
          <Star size={size} className={n <= value ? 'fill-current text-spice' : 'text-muted'} />
        </button>
      ) : <Star key={n} size={size} className={n <= value ? 'fill-current text-spice' : 'text-line'} aria-hidden />)}
    </span>
  )
}

/** предмет: іконка з тиром, назва, рідкість і тир; link — на сторінку предмета біржі */
export function Good({ gid, size = 40, link = true, sub, className }: { gid: string; size?: number; link?: boolean; sub?: ReactNode; className?: string }) {
  const ix = useGoods()
  const it = itemOf(ix, gid)
  const body = (
    <>
      <Icon src={iconOf(ix, gid)} size={size} grade={it?.grade ?? 0} />
      <span className="min-w-0">
        <span className="block break-words font-semibold leading-snug"><GoodName gid={gid} /></span>
        <span className="flex flex-wrap gap-x-2 text-[12px] text-muted">
          {it && it.grade > 0 && <span>{tierLabel(it.grade)}</span>}
          {it?.rarity && <span className="text-spice">{rarityLabel(it.rarity)}</span>}
          {sub}
        </span>
      </span>
    </>
  )
  return link
    ? <a href={itemHref(gid)} onClick={go(itemHref(gid))} className={cn('flex min-w-0 items-center gap-2.5 hover:text-spice', className)}>{body}</a>
    : <span className={cn('flex min-w-0 items-center gap-2.5', className)}>{body}</span>
}

/** бартер рядками: «Вода ×500» */
export function BarterList({ barter, className }: { barter: Barter[]; className?: string }) {
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-2 gap-y-1', className)}>
      {barter.map((b) => <span key={b.gid} className="inline-flex items-center gap-1 rounded-full bg-panel2 px-2 py-0.5 text-[12px]"><GoodName gid={b.gid} /> ×{fmtN(b.qty)}</span>)}
    </span>
  )
}

/** ціна: за штуку великим, разом за залишок дрібно; бартер — рядками */
export function Price({ l, compact }: { l: Pick<ListingRow, 'price' | 'barter' | 'pay' | 'left' | 'negotiable'>; compact?: boolean }) {
  return (
    <span className="grid gap-1">
      {l.price != null && (
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <b className={cn('font-display font-bold tabular-nums', compact ? 'text-[15px]' : 'text-[19px]')}>{fmtSolari(l.price)}</b>
          <span className="text-[12px] text-muted">{t('за штуку')}</span>
          {l.left > 1 && <span className="text-[12px] tabular-nums text-muted">· {t('разом {sum}', { sum: fmtSolari(l.price * l.left) })}</span>}
        </span>
      )}
      {l.barter.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
          <Repeat size={13} className="shrink-0 text-muted" />
          <span className="text-muted">{l.price != null ? t('або бартер:') : t('Бартер:')}</span>
          <BarterList barter={l.barter} />
        </span>
      )}
      {l.negotiable && <span className="text-[12px] font-semibold text-ok">{t('торг доречний')}</span>}
    </span>
  )
}

/** регіон · світ · сервер */
export const whereText = (l: Pick<ListingRow, 'region' | 'world'> & { server?: string }) => [REGIONS[l.region]?.label ?? l.region, l.world, l.server].filter(Boolean).join(' · ')

/** картка оголошення: вид, предмет, кількість, ціна, де, коли, чиє й репутація */
export function ListingCard({ l, now = Date.now() }: { l: ListingRow; now?: number }) {
  const live = isLive(l, now)
  return (
    <li className={cn('group flex h-full flex-col overflow-hidden rounded-xl border bg-panel shadow-sm transition-colors hover:border-spice/60', live ? 'border-line' : 'border-dashed border-line opacity-80')}>
      <a href={listingHref(l.id)} onClick={go(listingHref(l.id))} className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <SideChip side={l.side} />
          {!live && <span className="rounded-full bg-panel2 px-2 py-0.5 text-[11.5px] font-semibold text-muted">{l.status === 'open' ? STATUS_LABEL.expired : STATUS_LABEL[l.status]}</span>}
          {l.item.hidden && <span className="rounded-full bg-bad/10 px-2 py-0.5 text-[11.5px] font-semibold text-bad">{t('Сховано модератором')}</span>}
          <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted"><Clock size={12} />{fmtAgo(l.fresh, now)}</span>
        </div>
        <Good gid={l.gid} link={false} sub={<span className="font-semibold text-ink">×{fmtN(l.left)}{l.left !== l.qty && <span className="font-normal text-muted"> / {fmtN(l.qty)}</span>}</span>} className="group-hover:text-spice" />
        <Price l={l} compact />
        <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-muted"><MapPin size={13} className="mt-0.5 shrink-0" /><span className="break-words">{whereText(l)}</span></p>
      </a>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-3.5 py-2.5">
        <AccessBadge visibility={l.item.visibility} owner={l.item.owner} />
        <OwnerLink owner={l.item.owner} />
        <RepBadge rep={l.rep} className="ml-auto" />
      </div>
    </li>
  )
}

const DEAL_CLS: Record<DealStatus, string> = {
  offered: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', accepted: 'bg-spice/15 text-spice', done: 'bg-ok/15 text-ok', declined: 'bg-panel2 text-muted', cancelled: 'bg-panel2 text-muted',
}
export function DealChip({ status }: { status: DealStatus }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-bold', DEAL_CLS[status])}>{DEAL_LABEL[status]}</span>
}

/** хто продає / купує в угоді: у «Продам» продає сторона оголошення, у «Куплю» — той, хто запропонував */
export const sellerOf = (d: Deal) => (d.side === 'sell' ? 'taker' : 'maker')

/** картка угоди: предмет, кількість, ціна, стан, з ким */
export function DealCard({ d, me, actions }: { d: Deal; me?: string | null; actions?: ReactNode }) {
  const other = d.maker?.id === me ? d.taker : d.maker
  const iSell = (sellerOf(d) === 'maker') === (d.maker?.id === me)
  return (
    <li className="flex flex-col gap-2.5 rounded-xl border border-line bg-panel p-3.5 shadow-sm">
      <a href={dealHref(d.id)} onClick={go(dealHref(d.id))} className="grid gap-2.5 hover:text-spice">
        <div className="flex flex-wrap items-center gap-1.5">
          <DealChip status={d.status} />
          {me && <span className="rounded-full bg-panel2 px-2 py-0.5 text-[11.5px] font-semibold">{iSell ? t('ти продаєш') : t('ти купуєш')}</span>}
          <span className="ml-auto text-[12px] text-muted">{fmtAgo(d.updated)}</span>
        </div>
        <Good gid={d.gid} link={false} sub={<span className="font-semibold text-ink">×{fmtN(d.qty)}</span>} />
        <span className="text-[13px]">{d.price != null ? <><b className="tabular-nums">{fmtSolari(d.price)}</b> <span className="text-muted">{t('за штуку')} · {t('разом {sum}', { sum: fmtSolari(d.price * d.qty) })}</span></> : <BarterList barter={d.barter} />}</span>
      </a>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted">
        <Handshake size={13} className="shrink-0" />
        {other ? <a href={`/u/${other.login}`} onClick={go(`/u/${other.login}`)} className="font-semibold text-ink hover:text-spice">{other.name}</a> : <span>{d.status === 'offered' ? t('чекає відповіді') : t('Людину видалено')}</span>}
        {actions && <span className="ml-auto flex flex-wrap gap-1.5">{actions}</span>}
      </div>
    </li>
  )
}

/** вибір картками (вид, оплата, строк, місце): значок, назва, підказка */
export function Choice({ on, onClick, children, disabled, className }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick}
      className={cn('flex min-w-0 flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45', on ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40', className)}>
      {children}
    </button>
  )
}
export const CHOICES = 'grid grid-cols-[repeat(auto-fill,minmax(min(150px,100%),1fr))] gap-2'

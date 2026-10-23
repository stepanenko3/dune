/**
 * Предмет на біржі (/market/item/<id гри>): книга заявок — хто купує (дорожчі згори) і хто продає (дешевші згори),
 * бартер окремо; медіанна ціна від спільноти (завершені угоди за 30 днів, без них — за оголошеннями), графік і таблиця
 * угод (без імен). Регіон і світ — в адресі. «Продати» / «Купити» — нове оголошення з цим предметом.
 */
import { useEffect, useState } from 'react'
import { BookOpen, Plus, TrendingUp } from 'lucide-react'
import { fmtDate, fmtSolari, itemMarket, listingHref, type ItemMarket, type ListingRow } from '@/lib/market'
import { sectionOfItem } from '@/lib/catalog'
import { REGIONS, type Region } from '@/lib/ddReset'
import { t } from '@/lib/i18n'
import { subscribe } from '@/lib/stream'
import { useUrlParam } from '@/lib/urlState'
import { fmtN } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Seg } from '@/components/ui/seg'
import { PageHeader } from '@/components/PageHeader'
import { Loading, PageError } from '@/components/states'
import { useCrumb } from '@/components/Crumbs'
import { SnInput, valueOf } from '@/components/sn'
import { Section } from '../Account'
import { BarterList, go, Good, ListingCard, LISTING_GRID, RepBadge, whereText } from '@/components/market/bits'
import { PriceChart } from '@/components/market/PriceChart'
import { GoodName, itemOf, useGoods } from '@/components/market/names'
import { newListing } from '../Market'

export default function ItemPage({ gid }: { gid: string }) {
  const [region, setRegion, regionHref] = useUrlParam<string>('region', '', (v) => v in REGIONS)
  const [world, setWorld] = useUrlParam<string>('world', '')
  const ix = useGoods()
  const [data, setData] = useState<ItemMarket | null>(null)
  const [err, setErr] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    const h = setTimeout(() => itemMarket(gid, { region, world: world.trim() }).then((d) => live && setData(d), (e) => live && setErr((e as Error).message)), world ? 250 : 0)
    return () => { live = false; clearTimeout(h) }
  }, [gid, region, world, attempt])
  useEffect(() => subscribe('/api/market/stream', () => setAttempt((n) => n + 1)), [])
  useCrumb(err ? [] : [{ label: t('Предмет') }])
  if (err) return <PageError page message={err} />
  const st = data?.stats
  const deals = (data?.history ?? []).filter((h) => h.price != null).map((h) => ({ at: h.at, price: h.price!, qty: h.qty }))
  const q = `?gid=${encodeURIComponent(gid)}`
  const it = itemOf(ix, gid)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-10">
        <PageHeader
          title={<GoodName gid={gid} />}
          meta={<Good gid={gid} size={48} link={false} />}
          actions={
            <>
              <Button variant="secondary" onClick={() => newListing(`${q}&side=buy`)}><Plus size={15} />{t('Купити')}</Button>
              <Button onClick={() => newListing(`${q}&side=sell`)}><Plus size={15} />{t('Продати')}</Button>
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <Seg size="sm" label={t('Регіон')} value={region} onChange={setRegion} href={regionHref} items={[{ id: '', label: t('Усі регіони') }, ...(Object.keys(REGIONS) as Region[]).map((r) => ({ id: r, label: REGIONS[r].label }))]} />
            <SnInput size="lg" className="min-w-[min(220px,100%)] flex-1" modelValue={world} placeholder={t('Світ, напр. Hagga EU 7')} accessibilityLabel={t('Світ')} onInput={(e: Event) => setWorld(valueOf(e), { replace: true })} />
            {it && <a href={`/catalog/${sectionOfItem(it)}/${encodeURIComponent(gid)}`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-spice hover:underline"><BookOpen size={14} />{t('У довіднику')}</a>}
          </div>
        </PageHeader>
        {!data ? <Loading /> : (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-2.5">
              <Tile label={st?.source === 'listings' ? t('Медіана за оголошеннями') : t('Медіанна ціна (30 днів)')} value={st?.median != null ? fmtSolari(st.median) : '—'} note={st?.source === 'deals' ? t('угод: {n}', { n: fmtN(st.n) }) : st?.source === 'listings' ? t('угод ще не було') : t('ще нема ні угод, ні цін')} />
              <Tile label={t('Звичайний розкид')} value={st?.p25 != null && st.p75 != null ? `${fmtN(st.p25)} – ${fmtN(st.p75)}` : '—'} note={t('середні 50 % цін')} />
              <Tile label={t('Найдешевше продають')} value={data.book.sell[0]?.price != null ? fmtSolari(data.book.sell[0].price) : '—'} note={t('оголошень: {n}', { n: fmtN(data.book.sell.length) })} />
              <Tile label={t('Найдорожче купують')} value={data.book.buy[0]?.price != null ? fmtSolari(data.book.buy[0].price) : '—'} note={t('оголошень: {n}', { n: fmtN(data.book.buy.length) })} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 lg:grid-cols-2">
              <Book side="buy" rows={data.book.buy} />
              <Book side="sell" rows={data.book.sell} />
            </div>
            {data.book.barter.length > 0 && (
              <Section title={t('Бартер')} hint={t('Предмет за предмет, без ціни в соларах')}>
                <ul className={LISTING_GRID}>{data.book.barter.map((l) => <ListingCard key={l.id} l={l} />)}</ul>
              </Section>
            )}
            <Section title={t('Історія угод')} hint={t('Завершені угоди з публічних оголошень — без імен')}>
              {data.history.length ? (
                <div className="grid gap-3">
                  {deals.length > 0 && <><p className="flex items-center gap-1.5 text-[12.5px] text-muted"><TrendingUp size={14} className="text-spice" />{t('Ціна за штуку; пунктир — медіана, смуга — звичайний розкид')}</p><PriceChart points={deals} median={st?.source === 'deals' ? st.median : null} p25={st?.source === 'deals' ? st.p25 : null} p75={st?.source === 'deals' ? st.p75 : null} /></>}
                  {/* таблицею — рядками, що переносяться (на телефоні нічого не ширше за екран) */}
                  <ul className="grid text-[13px]" aria-label={t('Угоди')}>
                    {data.history.map((h, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line/60 py-1.5 last:border-0">
                        <span className="w-[120px] shrink-0 text-muted">{fmtDate(h.at)}</span>
                        <b className="tabular-nums">{h.price != null ? fmtSolari(h.price) : <BarterList barter={h.barter} />}</b>
                        <span className="tabular-nums">×{fmtN(h.qty)}</span>
                        <span className="break-words text-muted">{whereText(h)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : <p className="text-[13px] text-muted">{t('Угод цим предметом ще не було — стань першим.')}</p>}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-3.5 shadow-sm">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-[22px] font-bold tabular-nums">{value}</div>
      <div className="text-[12px] text-muted">{note}</div>
    </div>
  )
}

/** книга заявок: рядки «ціна · кількість · де · хто» */
function Book({ side, rows }: { side: 'buy' | 'sell'; rows: ListingRow[] }) {
  const title = side === 'buy' ? t('Купують') : t('Продають')
  const hint = side === 'buy' ? t('Дорожчі згори — їм можна продати') : t('Дешевші згори — у них можна купити')
  return (
    <Section title={`${title} · ${fmtN(rows.length)}`} hint={hint}>
      {rows.length ? (
        <ul className="grid gap-1.5">
          {rows.map((l) => (
            <li key={l.id}>
              <a href={listingHref(l.id)} onClick={go(listingHref(l.id))} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-lg border border-line px-3 py-2 hover:border-spice/50">
                <b className="font-display text-[15px] tabular-nums">{l.price != null ? fmtSolari(l.price) : '—'}</b>
                <span className="text-right text-[13px] font-semibold tabular-nums">×{fmtN(l.left)}</span>
                <span className="break-words text-[12px] text-muted">{whereText(l)} · {l.item.owner.tag ? `[${l.item.owner.tag}] ` : ''}{l.item.owner.name}</span>
                <RepBadge rep={l.rep} className="justify-self-end" />
              </a>
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted">{side === 'buy' ? t('Ніхто поки не купує — розмісти «Куплю»') : t('Ніхто поки не продає — розмісти «Продам»')}</p>}
    </Section>
  )
}

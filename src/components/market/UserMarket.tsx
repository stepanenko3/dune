/**
 * Біржа на сторінці людини: репутація (середня оцінка, оцінок і завершених угод), останні оцінки з відгуками й
 * відкриті публічні оголошення. Людина ще не торгувала — блоку нема.
 */
import { useEffect, useState } from 'react'
import { userMarket, type UserMarket as UM } from '@/lib/market'
import { t } from '@/lib/i18n'
import { fmtN, fmtP } from '@/lib/utils'
import { go, LISTING_GRID, ListingCard, Stars } from './bits'
import { GoodName } from './names'

export function UserMarket({ login }: { login: string }) {
  const [d, setD] = useState<UM | null>(null)
  useEffect(() => {
    let live = true
    userMarket(login).then((x) => live && setD(x), () => {})
    return () => { live = false }
  }, [login])
  if (!d || (!d.rep.done && !d.rep.n && !d.listings.length)) return null
  return (
    <section className="grid gap-2.5">
      <h2 className="flex flex-wrap items-baseline gap-x-3 px-1 pt-1 font-display text-[15px] font-bold">
        {t('Біржа')}
        <span className="inline-flex items-center gap-1.5 font-sans text-[13px] font-normal text-muted">
          {d.rep.avg != null && <><Stars value={Math.round(d.rep.avg)} size={14} /><b className="font-semibold text-ink">{fmtP(d.rep.avg)}</b> · {t('оцінок: {n}', { n: fmtN(d.rep.n) })} · </>}
          {t('угод: {n}', { n: fmtN(d.rep.done) })}
        </span>
      </h2>
      {d.ratings.length > 0 && (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))]">
          {d.ratings.slice(0, 6).map((r, i) => (
            <li key={i} className="grid gap-1 rounded-xl border border-line bg-panel p-3 text-[13px] shadow-sm">
              <span className="flex flex-wrap items-center gap-2"><Stars value={r.score} size={14} /><span className="text-muted">{r.role === 'seller' ? t('як продавець') : t('як покупець')} · <GoodName gid={r.gid} /></span></span>
              {r.text && <span className="break-words">{r.text}</span>}
              <span className="text-[12px] text-muted">{r.from ? <a href={`/u/${r.from.login}`} onClick={go(`/u/${r.from.login}`)} className="hover:text-spice">{r.from.name}</a> : t('Людину видалено')} · {new Date(r.at).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
      {d.listings.length > 0 && <ul className={LISTING_GRID}>{d.listings.map((l) => <ListingCard key={l.id} l={l} />)}</ul>}
    </section>
  )
}

/**
 * Назви предметів гри для біржі: довідник вантажиться раз (loadCatalog кешує) — назва мовою сайту, іконка, тир. Поки
 * довідник вантажиться, на місці назви — сіра смужка, а не id гри.
 */
import { useEffect, useState } from 'react'
import { iconUrl, loadCatalog, nameOf, type CatalogIndex, type CItem } from '@/lib/catalog'
import { SIDE_LABEL, type Side } from '@/lib/market'
import { fmtN } from '@/lib/utils'

let ready: CatalogIndex | null = null
/** довідник (null — ще вантажиться чи не вдалося) */
export function useGoods(): CatalogIndex | null {
  const [ix, setIx] = useState<CatalogIndex | null>(ready)
  useEffect(() => {
    if (ready) return
    let live = true
    loadCatalog().then((r) => { if (r !== 'syncing') { ready = r; if (live) setIx(r) } }, () => {})
    return () => { live = false }
  }, [])
  return ix
}
export const itemOf = (ix: CatalogIndex | null, gid: string): CItem | null => ix?.item.get(gid) ?? null
export const iconOf = (ix: CatalogIndex | null, gid: string) => iconUrl(itemOf(ix, gid)?.icon ?? null)

/** назва предмета мовою сайту */
export function GoodName({ gid, className }: { gid: string; className?: string }) {
  const ix = useGoods()
  const it = itemOf(ix, gid)
  if (!ix) return <span className={`inline-block h-[0.9em] w-24 animate-pulse rounded bg-panel2 align-middle ${className ?? ''}`} aria-hidden />
  return <span className={className}>{nameOf(it ?? undefined, gid)}</span>
}

/** «Продам: Смола спайсу ×1 000» — назва оголошення в картках реєстру (гільдія, людина) */
export function TradeTitle({ trade }: { trade: { side: Side; gid: string; left: number } }) {
  return <>{SIDE_LABEL[trade.side]}: <GoodName gid={trade.gid} /> ×{fmtN(trade.left)}</>
}

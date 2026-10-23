/**
 * Ціни угод предмета в часі: точка — завершена угода (ціна за штуку), смуга — середні 50 % (25–75 %), лінія — медіана.
 * Одна вісь (солари), один ряд — без легенди: підпис над графіком. Наведення — підказка з датою, ціною й кількістю;
 * та сама історія — таблицею під графіком.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtDate, fmtSolari } from '@/lib/market'
import { locale, t } from '@/lib/i18n'
import { fmtN } from '@/lib/utils'

type P = { at: number; price: number; qty: number }
/** висота стала, ширина — як у контейнера (текст не розтягується) */
const H = 220, L = 64, R = 14, T = 12, B = 28

export function PriceChart({ points, median, p25, p75 }: { points: P[]; median: number | null; p25: number | null; p75: number | null }) {
  const box = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ p: P; x: number; y: number } | null>(null)
  const [W, setW] = useState(640)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(260, el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const g = useMemo(() => {
    if (!points.length) return null
    const xs = points.map((p) => p.at), ys = points.map((p) => p.price)
    let x0 = Math.min(...xs), x1 = Math.max(...xs)
    if (x1 - x0 < 86400_000) { x0 -= 43200_000; x1 += 43200_000 }
    const lo = Math.min(...ys, p25 ?? Infinity), hi = Math.max(...ys, p75 ?? -Infinity)
    const pad = (hi - lo) * 0.12 || hi * 0.1 || 1
    const y0 = Math.max(0, lo - pad), y1 = hi + pad
    const sx = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R)
    const sy = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B)
    const ticks = [0, 0.5, 1].map((k) => y0 + (y1 - y0) * k)
    const dates = [x0, (x0 + x1) / 2, x1]
    return { sx, sy, ticks, dates }
  }, [points, p25, p75, W])
  if (!g) return null
  return (
    <div ref={box} className="relative" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={t('Ціни угод у часі')}>
        {g.ticks.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={g.sy(v)} y2={g.sy(v)} stroke="rgb(var(--c-line))" strokeWidth={1} />
            <text x={L - 6} y={g.sy(v) + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">{fmtN(v)}</text>
          </g>
        ))}
        {g.dates.map((v, i) => <text key={i} x={g.sx(v)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} className="fill-muted text-[11px]">{new Date(v).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}</text>)}
        {p25 != null && p75 != null && <rect x={L} width={W - L - R} y={g.sy(p75)} height={Math.max(1, g.sy(p25) - g.sy(p75))} fill="rgb(var(--c-spice) / 0.10)" />}
        {median != null && <line x1={L} x2={W - R} y1={g.sy(median)} y2={g.sy(median)} stroke="rgb(var(--c-spice))" strokeWidth={2} strokeDasharray="6 4" />}
        {points.map((p, i) => (
          <circle key={i} cx={g.sx(p.at)} cy={g.sy(p.price)} r={hover?.p === p ? 6 : 4.5} fill="rgb(var(--c-spice))" stroke="rgb(var(--c-panel))" strokeWidth={2}
            onMouseEnter={() => setHover({ p, x: g.sx(p.at) / W, y: g.sy(p.price) / H })} onFocus={() => setHover({ p, x: g.sx(p.at) / W, y: g.sy(p.price) / H })} tabIndex={0}>
            <title>{`${fmtDate(p.at)} · ${fmtSolari(p.price)} × ${fmtN(p.qty)}`}</title>
          </circle>
        ))}
        {/* ширші цілі для наведення (точка дрібна) */}
        {points.map((p, i) => <circle key={`h${i}`} cx={g.sx(p.at)} cy={g.sy(p.price)} r={12} fill="transparent" onMouseEnter={() => setHover({ p, x: g.sx(p.at) / W, y: g.sy(p.price) / H })} />)}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-[12px] shadow-md" style={{ left: `${Math.min(85, Math.max(15, hover.x * 100))}%`, top: `${hover.y * 100}%` }}>
          <b className="tabular-nums">{fmtSolari(hover.p.price)}</b> <span className="text-muted">× {fmtN(hover.p.qty)} · {fmtDate(hover.p.at)}</span>
        </div>
      )}
    </div>
  )
}

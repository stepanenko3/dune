/**
 * Схема карти поверхні Арракіса: місця гри на своїх місцях (координати з файлів гри), кола посадки регіонів і поселень,
 * таксі-маршрути, а для вибраного місця — точки виходу на карту поверхні й перельоти до інших місць. Під ними — карта
 * гри (w.image, текстура глобальної карти); поки її нема — наш фон: пісок, лінії сітки, «дюни». Північ угорі.
 * Підписи — сталого розміру в пікселях (масштаб міряємо), без накладання: не влазить — лише точка (назва — підказкою).
 * view — видима частина карти [x, y, ширина, висота] (масштаб і зсув на мапі сайту), без нього — уся карта.
 */
import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { t } from '@/lib/i18n'
import { plainClick } from '@/lib/urlState'
import { catColor, catOrder, fromOverland, isMajor, type World, type WorldLoc } from '@/lib/world'

type Box = [number, number, number, number]
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]

export function WorldSvg({ w, view, sel, shown, hrefOf, onPick }: {
  w: World
  view?: [number, number, number, number]
  sel: string | null
  /** місця, що пройшли пошук і фільтр (інші — бліді) */
  shown: Set<string>
  hrefOf: (id: string) => string
  onPick: (id: string) => void
}) {
  const [bx0, by0, bx1, by1] = w.bounds
  const [x0, y0, vw, vh] = view ?? [bx0, by0, bx1 - bx0, by1 - by0]
  const ref = useRef<SVGSVGElement>(null)
  // пікселів на одиницю карти (за шириною намальованого)
  const [k, setK] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const m = () => { const r = el.getBoundingClientRect(); if (r.width) setK(Math.min(r.width / vw, r.height / vh)) }
    m()
    const ro = new ResizeObserver(m)
    ro.observe(el)
    return () => ro.disconnect()
  }, [vw, vh])
  const u = (px: number) => (k ? px / k : 0)
  const locs = useMemo(() => w.locations.filter((l) => l.pos), [w])
  const byId = useMemo(() => new Map(w.locations.map((l) => [l.id, l])), [w])
  const cur = sel ? byId.get(sel) ?? null : null
  // зона дотику точки: до 16 px, але не далі половини відстані до сусідньої (близькі місця не перекривають одне одне)
  const reach = useMemo(() => new Map(locs.map((l) => {
    const d = Math.min(...locs.filter((o) => o !== l).map((o) => Math.hypot(o.pos![0] - l.pos![0], o.pos![1] - l.pos![1])))
    return [l.id, d] as const
  })), [locs])

  // підписи: вибране, тоді великі місця, тоді решта; позиції — під, над, праворуч, ліворуч від точки
  const labels = useMemo(() => {
    if (!k) return []
    const placed: Box[] = []
    const dots: Box[] = locs.map((l) => { const x = (l.pos![0] - x0) * k, y = (l.pos![1] - y0) * k; return [x - 7, y - 7, x + 7, y + 7] })
    const order = [...locs].sort((a, b) => Number(b.id === sel) - Number(a.id === sel) || Number(isMajor(b)) - Number(isMajor(a)) || catOrder(a.tag) - catOrder(b.tag))
    const out: { l: WorldLoc; x: number; y: number; anchor: 'middle' | 'start' | 'end'; fs: number }[] = []
    for (const l of order) {
      const major = isMajor(l)
      const fs = major ? 12.5 : 11.5
      const text = major ? l.name.toLocaleUpperCase() : l.name
      const tw = text.length * fs * (major ? 0.68 : 0.56), th = fs * 1.25
      const x = (l.pos![0] - x0) * k, y = (l.pos![1] - y0) * k
      const r = (major ? 9 : 7) + 3
      const cand: { box: Box; ax: number; ay: number; anchor: 'middle' | 'start' | 'end' }[] = [
        { box: [x - tw / 2, y + r, x + tw / 2, y + r + th], ax: x, ay: y + r + fs, anchor: 'middle' },
        { box: [x - tw / 2, y - r - th, x + tw / 2, y - r], ax: x, ay: y - r - fs * 0.3, anchor: 'middle' },
        { box: [x + r, y - th / 2, x + r + tw, y + th / 2], ax: x + r, ay: y + fs * 0.35, anchor: 'start' },
        { box: [x - r - tw, y - th / 2, x - r, y + th / 2], ax: x - r, ay: y + fs * 0.35, anchor: 'end' },
      ]
      const W = vw * k, H = vh * k
      const inside = (b: Box) => b[0] >= 2 && b[1] >= 2 && b[2] <= W - 2 && b[3] <= H - 2
      const others = dots.filter((_, i) => locs[i].id !== l.id)
      const ok = cand.find((c) => inside(c.box) && !placed.some((p) => hit(p, c.box)) && !others.some((d) => hit(d, c.box)))
      // вибране й великі місця (регіони, поселення) підписуємо й поверх сусідніх точок — лише б не на інший підпис
      const pick = ok ?? (l.id === sel || major ? cand.find((c) => inside(c.box) && !placed.some((p) => hit(p, c.box))) ?? (l.id === sel ? cand[0] : null) : null)
      if (!pick) continue
      placed.push(pick.box)
      out.push({ l, x: pick.ax / k + x0, y: pick.ay / k + y0, anchor: pick.anchor, fs })
    }
    return out
  }, [locs, k, sel, x0, y0, vw, vh])

  // таксі — пара місць один раз; перельоти вибраного — до всіх, куди веде карта поверхні
  const taxi = useMemo(() => {
    const seen = new Set<string>()
    return w.links.filter((l) => l.mode === 'taxi').filter((l) => { const key = [l.from, l.to].sort().join('|'); if (seen.has(key)) return false; seen.add(key); return true })
      .map((l) => [byId.get(l.from), byId.get(l.to)] as const).filter(([a, b]) => a?.pos && b?.pos)
  }, [w, byId])
  const flights = useMemo(() => {
    if (!cur?.pos || !w.links.some((l) => l.from === cur.id && l.to === w.overland)) return []
    return fromOverland(w).filter((l) => l.to !== cur.id).map((l) => ({ to: byId.get(l.to), gated: l.options.every((o) => o.length > 0) })).filter((x) => x.to?.pos)
  }, [w, cur, byId])

  const go = (id: string) => (e: MouseEvent) => { if (!plainClick(e)) return; e.preventDefault(); onPick(id) }
  const curve = (a: [number, number], b: [number, number]) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1]
    return `M${a[0]},${a[1]} Q${mx - dy * 0.18},${my + dx * 0.18} ${b[0]},${b[1]}`
  }
  const ns = { vectorEffect: 'non-scaling-stroke' as const }

  return (
    <svg
      ref={ref}
      viewBox={`${x0} ${y0} ${vw} ${vh}`}
      className="block h-full w-full touch-manipulation select-none"
      role="img"
      aria-label={t('Схема карти поверхні Арракіса: місця й переходи між ними')}
    >
      <defs>
        <pattern id="wm-dunes" patternUnits="userSpaceOnUse" width="9000" height="4200">
          <path d="M0,1400 q2250,-900 4500,0 t4500,0 M0,3500 q2250,-700 4500,0 t4500,0" fill="none" stroke="rgb(var(--c-line))" strokeWidth="1.2" opacity="0.9" {...ns} />
        </pattern>
        <pattern id="wm-grid" patternUnits="userSpaceOnUse" width="10000" height="10000" x={bx0} y={by0}>
          <path d="M10000,0 L0,0 0,10000" fill="none" stroke="rgb(var(--c-line))" strokeWidth="1" opacity="0.7" {...ns} />
        </pattern>
        <radialGradient id="wm-sand" cx="50%" cy="45%" r="75%">
          <stop offset="0%" stopColor="rgb(var(--c-panel))" />
          <stop offset="100%" stopColor="rgb(var(--c-panel2))" />
        </radialGradient>
      </defs>
      {w.image ? (
        <image href={w.image.url} x={w.image.bounds[0]} y={w.image.bounds[1]} width={w.image.bounds[2] - w.image.bounds[0]} height={w.image.bounds[3] - w.image.bounds[1]} preserveAspectRatio="none" />
      ) : (
        <>
          <rect x={bx0} y={by0} width={bx1 - bx0} height={by1 - by0} fill="url(#wm-sand)" />
          <rect x={bx0} y={by0} width={bx1 - bx0} height={by1 - by0} fill="url(#wm-dunes)" opacity="0.55" />
          <rect x={bx0} y={by0} width={bx1 - bx0} height={by1 - by0} fill="url(#wm-grid)" />
        </>
      )}

      {/* кола посадки: регіони й поселення — завжди, інші — коли вибрані */}
      {locs.filter((l) => l.r && (isMajor(l) || l.id === sel)).map((l) => (
        <circle key={'r' + l.id} cx={l.pos![0]} cy={l.pos![1]} r={l.r!} fill={catColor(l.tag)} fillOpacity={l.id === sel ? 0.16 : 0.08}
          stroke={catColor(l.tag)} strokeOpacity={0.6} strokeWidth={l.id === sel ? 2 : 1.2} strokeDasharray="5 4" opacity={shown.has(l.id) ? 1 : 0.35} {...ns} />
      ))}

      {/* перельоти вибраного картою поверхні */}
      {k > 0 && flights.map(({ to, gated }) => (
        <line key={'f' + to!.id} x1={cur!.pos![0]} y1={cur!.pos![1]} x2={to!.pos![0]} y2={to!.pos![1]}
          stroke="rgb(var(--c-spice))" strokeWidth={1.1} strokeOpacity={gated ? 0.3 : 0.6} strokeDasharray={gated ? '2 4' : '6 4'} {...ns} />
      ))}
      {/* таксі-орнітоптер */}
      {taxi.map(([a, b]) => (
        <g key={'t' + a!.id + b!.id}>
          <path d={curve(a!.pos!, b!.pos!)} fill="none" stroke="rgb(var(--c-water))" strokeWidth={2} strokeOpacity={0.75} strokeDasharray="1 5" strokeLinecap="round" {...ns} />
        </g>
      ))}
      {/* точки виходу вибраного на карту поверхні */}
      {cur?.pos && cur.exits.map((e, i) => (
        <g key={'x' + i}>
          <line x1={cur.pos![0]} y1={cur.pos![1]} x2={e[0]} y2={e[1]} stroke={catColor(cur.tag)} strokeWidth={1} strokeOpacity={0.6} {...ns} />
          <rect x={e[0] - u(3.5)} y={e[1] - u(3.5)} width={u(7)} height={u(7)} transform={`rotate(45 ${e[0]} ${e[1]})`} fill="rgb(var(--c-panel))" stroke={catColor(cur.tag)} strokeWidth={1.5} {...ns} />
        </g>
      ))}

      {/* місця */}
      {k > 0 && locs.map((l) => {
        const major = isMajor(l), on = l.id === sel, dim = !shown.has(l.id)
        const r = u(major ? 8 : 6)
        return (
          <a key={l.id} href={hrefOf(l.id)} onClick={go(l.id)} aria-label={l.name} aria-current={on ? 'true' : undefined} className="cursor-pointer outline-none [&:focus-visible>circle.ring]:opacity-100" style={{ opacity: dim ? 0.35 : 1 }}>
            <title>{l.name}</title>
            <circle cx={l.pos![0]} cy={l.pos![1]} r={Math.min(u(16), Math.max(u(7), (reach.get(l.id) ?? Infinity) / 2))} fill="transparent" />
            <circle className="ring" cx={l.pos![0]} cy={l.pos![1]} r={u(13)} fill="none" stroke="rgb(var(--c-spice))" strokeWidth={2} opacity={on ? 1 : 0} {...ns} />
            {l.hidden ? (
              <circle cx={l.pos![0]} cy={l.pos![1]} r={r} fill="rgb(var(--c-panel))" stroke={catColor(l.tag)} strokeWidth={2} strokeDasharray="3 2" {...ns} />
            ) : (
              <circle cx={l.pos![0]} cy={l.pos![1]} r={r} fill={catColor(l.tag)} stroke="rgb(var(--c-panel))" strokeWidth={1.5} {...ns} />
            )}
          </a>
        )
      })}
      {k > 0 && labels.map(({ l, x, y, anchor, fs }) => (
        <text key={'l' + l.id} x={x} y={y} textAnchor={anchor} fontSize={u(fs)} fontWeight={isMajor(l) || l.id === sel ? 700 : 500}
          letterSpacing={isMajor(l) ? u(0.6) : 0} fill="rgb(var(--c-ink))" stroke="rgb(var(--c-panel))" strokeWidth={u(3)} paintOrder="stroke" strokeLinejoin="round"
          opacity={shown.has(l.id) ? 1 : 0.4} className="pointer-events-none">
          {isMajor(l) ? l.name.toLocaleUpperCase() : l.name}
        </text>
      ))}

      {/* північ — у нижньому лівому куті (угорі зліва на мапі сайту — кнопка «Місця») */}
      {k > 0 && (
        <g transform={`translate(${x0 + u(26)} ${y0 + vh - u(46)})`} className="pointer-events-none">
          <circle r={u(15)} fill="rgb(var(--c-panel))" stroke="rgb(var(--c-line))" strokeWidth={1} {...ns} />
          <path d={`M0,${-u(10)} L${u(5)},${u(5)} L0,${u(2)} L${-u(5)},${u(5)} Z`} fill="rgb(var(--c-spice))" />
          <text y={u(30)} textAnchor="middle" fontSize={u(10.5)} fontWeight={700} fill="rgb(var(--c-muted))">{t('Пн')}</text>
        </g>
      )}
    </svg>
  )
}

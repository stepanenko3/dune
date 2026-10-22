/**
 * Індикатор завантаження в стилі Дюни — наше лого (гребінь дюни й сонце), що оживає: дюни безперервно повзуть
 * ліворуч, як пісок під вітром (цикл без швів), сонце дихає сяйвом, позаду повільніше повзе дальня дюна. Рух розгойдується плавно з
 * нерухомого лого і так само плавно затихає назад у лого — без обривів ні на старті, ні на фініші (active).
 * Один компонент для всіх завантажень: сторінки, блоки, моделі, лого в шапці; розмір — size.
 * Кадри рахує requestAnimationFrame; без руху
 * (prefers-reduced-motion) — просто лого.
 */
import { useEffect, useId, useRef } from 'react'
import { cn } from '@/lib/utils'


/**
 * Дюна в русі: гребінь — «вікно» в нескінченне поле дюн, яке рівномірно їде ліворуч (цикл безшовний: поле
 * повторюється через L). Поле — пологий навітряний схил і крутіший підвітряний (друга гармоніка). Між нерухомим лого й
 * полем — плавний перехід (сила k): у кожній точці гребеня висота змішується, тож крива гладка на кожному кадрі.
 */
type P = [number, number]
const f2 = (v: number) => v.toFixed(2)
const bez = (a: P, b: P, c: P, d: P, t: number): P => {
  const u = 1 - t
  return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]]
}
/** крива лого як висота від x (щільна таблиця по двох дугах) */
const LOGO: P[] = []
;([[[3, 21], [7, 15], [11, 15], [14, 19]], [[14, 19], [17, 23], [22, 23], [29, 16]]] as [P, P, P, P][]).forEach((sg, i) => {
  for (let k = i ? 1 : 0; k <= 120; k++) LOGO.push(bez(sg[0], sg[1], sg[2], sg[3], k / 120))
})
function logoY(x: number) {
  for (let i = 1; i < LOGO.length; i++) if (LOGO[i][0] >= x) { const a = LOGO[i - 1], b = LOGO[i]; return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1) }
  return LOGO[LOGO.length - 1][1]
}
/** поле дюн: період l, вершина в x = x0 при зсуві 0, середина c, розмах a; зсув s — на скільки поле від'їхало ліворуч */
const field = (x: number, s: number, l: number, x0: number, c: number, a: number) => {
  const th = (2 * Math.PI * (x - x0 + s)) / l
  return c - a * (Math.cos(th) + 0.16 * Math.sin(2 * th))
}
/** плавна крива крізь точки (Катмулл — Ром → кубічні Безьє) */
function smooth(p: P[]) {
  let d = `M${f2(p[0][0])} ${f2(p[0][1])}`
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] ?? p[i], b = p[i], c = p[i + 1], e = p[i + 2] ?? c
    d += `C${f2(b[0] + (c[0] - a[0]) / 6)} ${f2(b[1] + (c[1] - a[1]) / 6)} ${f2(c[0] - (e[0] - b[0]) / 6)} ${f2(c[1] - (e[1] - b[1]) / 6)} ${f2(c[0])} ${f2(c[1])}`
  }
  return d
}
const L = 19.5
const crestAt = (k: number, s: number) =>
  smooth(Array.from({ length: 33 }, (_, i) => { const x = 3 + (26 * i) / 32; return [x, (1 - k) * logoY(x) + k * field(x, s, L, 8.85, 19.2, 2.75)] as P }))
// дальня дюна — теж ліворуч, повільніше й дрібніше (глибина)
const farAt = (s: number) => smooth(Array.from({ length: 25 }, (_, i) => { const x = 6 + (21.5 * i) / 24; return [x, field(x, s * 0.55, 14, 11, 25.4, 1.1)] as P }))
const CREST0 = crestAt(0, 0)
const easeInOut = (x: number) => x * x * (3 - 2 * x)
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function DuneLoader({ size = 40, label, active = true, hold = 900, kick, className }: {
  size?: number
  /** щоразу, як змінюється, — ожити на hold мс (завантаження, що скінчилось ще до перемалювання) */
  kick?: number
  /** почалось — живе щонайменше стільки мс, навіть якщо завантаження коротше (щоб його встигли побачити) */
  hold?: number
  /** підпис для читачів екрана */
  label?: string
  /** живе (вантажиться) чи нерухоме лого; перемикається плавно */
  active?: boolean
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  const crest = useRef<SVGPathElement>(null)
  const far = useRef<SVGPathElement>(null)
  const sun = useRef<SVGGElement>(null)
  const glow = useRef<SVGCircleElement>(null)
  // сила руху 0…1 (до неї плавно йде) і час — живуть між кадрами й перемальовуваннями
  const st = useRef({ level: 0, want: 0, t: 0, raf: 0, last: 0, since: 0 })
  if (active && !st.current.want) st.current.since = performance.now()
  st.current.want = active ? 1 : 0

  useEffect(() => {
    if (kick) st.current.since = performance.now()
  }, [kick])
  useEffect(() => {
    const s = st.current
    if (reduced()) return
    const frame = (now: number) => {
      const dt = s.last ? Math.min(0.05, (now - s.last) / 1000) : 0
      s.last = now
      s.t += dt
      // коротке завантаження — усе одно живе hold мс; розгойдується за ~0,6 с, затихає за ~0,9 с
      const want = s.want || now - s.since < hold ? 1 : 0
      s.level += (want - s.level) * Math.min(1, dt * (want > s.level ? 3.2 : 2.2))
      if (Math.abs(want - s.level) < 0.003) s.level = want
      const k = easeInOut(Math.max(0, Math.min(1, s.level)))
      // поле їде ліворуч: період — за ~2,6 с
      const shift = (s.t * L) / 2.6
      crest.current?.setAttribute('d', k > 0 ? crestAt(k, shift) : CREST0)
      far.current?.setAttribute('d', farAt(shift))
      far.current?.setAttribute('stroke-opacity', (0.32 * k).toFixed(3))
      sun.current?.setAttribute('transform', `translate(0 ${(-1.3 * k * Math.sin(s.t * 2 * Math.PI * 0.45)).toFixed(3)})`)
      const breath = 0.5 + 0.5 * Math.sin(s.t * 2 * Math.PI * 0.6)
      glow.current?.setAttribute('opacity', (k * (0.6 + 0.4 * breath)).toFixed(3))
      glow.current?.setAttribute('r', (5.2 + 1.8 * k * breath).toFixed(2))
      // затихло — стоїмо (лого як є), доки знову не почнеться
      if (s.level === 0 && want === 0) { s.raf = 0; s.last = 0; return }
      s.raf = requestAnimationFrame(frame)
    }
    // коротке завантаження могло вже закінчитись до першого кадру — але hold мс ще живемо
    if (!s.raf && (s.want > 0 || s.level > 0 || performance.now() - s.since < hold)) s.raf = requestAnimationFrame(frame)
    return () => { if (s.raf) cancelAnimationFrame(s.raf); s.raf = 0; s.last = 0 }
  }, [active, hold, size, kick])

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={cn('shrink-0 overflow-visible', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <radialGradient id={`dl-glow-${id}`}>
          <stop offset="0" stopColor="rgb(255 210 130)" stopOpacity="0.85" />
          <stop offset="1" stopColor="rgb(var(--c-spice))" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path ref={far} d={farAt(0)} fill="none" stroke="rgb(var(--c-spice))" strokeOpacity="0" strokeWidth="1.5" strokeLinecap="round" />
      <g ref={sun}>
        <circle ref={glow} cx="22" cy="9" r="5.2" opacity="0" fill={`url(#dl-glow-${id})`} />
        <circle cx="22" cy="9" r="3.2" fill="rgb(var(--c-spice))" />
      </g>
      <path ref={crest} d={CREST0} fill="none" stroke="rgb(var(--c-spice))" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** завантаження з підписом: знак і текст під ним (сторінка) чи поруч (блок) */
export function DuneLoading({ label, page, size, className }: { label: string; page?: boolean; size?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center text-muted', page ? 'flex-col gap-3 text-[13.5px]' : 'gap-2.5 text-[13px]', className)}>
      <DuneLoader size={size ?? (page ? 56 : 28)} />
      <span>{label}</span>
    </div>
  )
}

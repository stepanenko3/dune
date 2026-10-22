/**
 * Точки Глибокої пустелі у «вікні» на головній і скан, що їх проявляє, — на одному полотні. Раніше це були ~1600
 * SVG-кіл, кожне з власною CSS-анімацією, і телефон перші секунди перемальовував увесь SVG щокадру. Тепер смуга
 * скану йде згори вниз, а кожна точка спалахує саме тоді, коли через неї проходить край смуги: час і крива руху
 * одні на двох. Скан починається, щойно мапу видно. Після нього полотно більше не малюється (лише при зміні розміру).
 */
import { useEffect, useRef } from 'react'

/** точка в координатах мапи 0…1000 */
export interface ScanDot {
  x: number
  y: number
  r: number
  fill: string
}

const DELAY = 350 // мс від появи мапи на екрані
const DUR = 2600 // смуга згори донизу
const POP = 500 // поява точки
const BAND = 180 // висота смуги — 18% мапи

/** крива руху смуги — як CSS cubic-bezier(x1, y1, x2, y2): x(s) = t шукаємо поділом навпіл, повертаємо y(s) */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  return (t: number) => {
    let lo = 0, hi = 1, s = t
    for (let i = 0; i < 24; i++) {
      const x = ((ax * s + bx) * s + cx) * s
      if (Math.abs(x - t) < 1e-4) break
      if (x < t) lo = s
      else hi = s
      s = (lo + hi) / 2
    }
    return ((ay * s + by) * s + cy) * s
  }
}
const ease = bezier(0.45, 0.05, 0.3, 1)

export function DesertScan({ dots, onDone }: { dots: ScanDot[]; onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return void done.current()
    // точки згори вниз (у кожного кольору — свій шар, порядок шарів — як у списку: великий меланж зверху)
    const fills = [...new Set(dots.map((d) => d.fill))]
    const order = dots.map((d) => ({ d, g: fills.indexOf(d.fill) })).sort((a, b) => a.d.y - b.d.y)
    const at = new Float64Array(order.length).fill(-1) // коли край смуги пройшов точку
    let next = 0 // перша ще не проявлена (за y)
    const spice = (getComputedStyle(cv).getPropertyValue('--c-spice').trim() || '238 147 64').split(/\s+/).join(',')
    /** чекає, поки мапу видно (порожньо) → сканує → готово (усі точки, без анімації) */
    let mode: 'wait' | 'run' | 'end' = 'wait'
    // час скану — свій, з кроком не більше двох кадрів: якщо сторінка на мить зайнята (перше відкриття, телефон),
    // скан стоїть і йде далі з того самого місця, а не перескакує одразу в кінець
    let vt = 0, last = -1
    let raf = 0
    let scanned = false

    /** малює стан на мить now; true — анімація ще йде */
    const draw = (now: number) => {
      const k = cv.width / 1000
      ctx.setTransform(k, 0, 0, k, 0, 0)
      ctx.clearRect(0, 0, 1000, 1000)
      if (mode === 'wait') return false
      const run = mode === 'run'
      const p = run ? Math.max(0, Math.min(1, (now - DELAY) / DUR)) : 1
      const top = -BAND + ease(p) * (1000 + 8 + BAND) // верх смуги: з-над мапи — до-під неї
      if (!run) next = order.length
      while (next < order.length && order[next].d.y <= top + BAND) at[next++] = now
      // проявлені — шарами одного кольору, одним шляхом на шар
      for (let g = 0; g < fills.length; g++) {
        ctx.beginPath()
        for (let j = 0; j < next; j++) {
          const o = order[j]
          if (o.g !== g || (run && now - at[j] < POP)) continue
          ctx.moveTo(o.d.x + o.d.r, o.d.y)
          ctx.arc(o.d.x, o.d.y, o.d.r, 0, Math.PI * 2)
        }
        ctx.fillStyle = fills[g]
        ctx.fill()
      }
      // ті, що саме спалахують: більші й прозорі → на місце, зі світлим ореолом
      let popping = false
      if (run)
        for (let j = 0; j < next; j++) {
          const q = (now - at[j]) / POP
          if (q >= 1) continue
          popping = true
          const e = 1 - (1 - q) ** 3
          const o = order[j].d
          const r = o.r * (2.2 - 1.2 * e)
          ctx.globalAlpha = 0.35 * (1 - q) ** 2
          ctx.fillStyle = 'rgb(255,240,214)'
          ctx.beginPath()
          ctx.arc(o.x, o.y, r * 1.8, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = e
          ctx.fillStyle = o.fill
          ctx.beginPath()
          ctx.arc(o.x, o.y, r, 0, Math.PI * 2)
          ctx.fill()
        }
      ctx.globalAlpha = 1
      // смуга скану: прозора згори, яскравий край знизу; гасне наприкінці шляху
      if (run && p < 1) {
        const a = 1 - Math.max(0, Math.min(1, (p - 0.8) / 0.2))
        const grad = ctx.createLinearGradient(0, top, 0, top + BAND)
        grad.addColorStop(0, `rgba(${spice},0)`)
        grad.addColorStop(0.85, `rgba(${spice},${0.28 * a})`)
        grad.addColorStop(0.99, `rgba(${spice},${0.9 * a})`)
        grad.addColorStop(1, `rgba(${spice},0)`)
        ctx.fillStyle = grad
        ctx.fillRect(0, top, 1000, BAND)
      }
      if (!scanned && p >= 1) {
        scanned = true
        done.current()
      }
      if (run && p >= 1 && !popping) mode = 'end'
      return mode === 'run'
    }
    const frame = (now: number) => {
      vt += last < 0 ? 0 : Math.min(now - last, 34)
      last = now
      raf = draw(vt) ? requestAnimationFrame(frame) : 0
    }
    const fit = () => {
      const w = cv.clientWidth
      if (!w) return
      const px = Math.round(w * Math.min(devicePixelRatio || 1, 2))
      if (cv.width === px) return
      cv.width = cv.height = px
      if (!raf) draw(vt) // стоїть (ще не почали чи вже закінчили) — перемалювати раз
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(cv)
    // без анімацій у системі — одразу все; інакше скан — щойно мапу видно хоча б на третину
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        io.disconnect()
        mode = still ? 'end' : 'run'
        if (still) draw(vt)
        else raf = requestAnimationFrame(frame)
      },
      { threshold: 0.3 },
    )
    io.observe(cv)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
    }
  }, [dots])

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}

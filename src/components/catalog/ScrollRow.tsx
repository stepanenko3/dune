/**
 * Рядок перемикачів, що гортається вбік (не переноситься на кілька поверхів): краї, за якими ще щось є, тьмяніють,
 * коліщатко миші гортає вбік, а вибрана «пігулка» завжди в полі зору (адреса з групою наприкінці списку).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const FADE = 20

/** active — що зараз вибрано: коли змінюється, рядок догортає до вибраної «пігулки» */
export function ScrollRow({ children, className, active }: { children: ReactNode; className?: string; active?: unknown }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ l: false, r: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const upd = () => {
      const l = el.scrollLeft > 1
      const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdge((e) => (e.l === l && e.r === r ? e : { l, r }))
    }
    // вертикальне коліщатко — вбік, поки є куди; на краю — гортається сторінка як звичайно
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      const to = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + e.deltaY))
      if (Math.abs(to - el.scrollLeft) < 1) return
      e.preventDefault()
      el.scrollLeft = to
    }
    upd()
    el.addEventListener('scroll', upd, { passive: true })
    el.addEventListener('wheel', wheel, { passive: false })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null
    ro?.observe(el)
    if (el.firstElementChild) ro?.observe(el.firstElementChild)
    return () => {
      ro?.disconnect()
      el.removeEventListener('scroll', upd)
      el.removeEventListener('wheel', wheel)
    }
  }, [])

  // вибране — у полі зору; без scrollIntoView, щоб не смикати прокрутку сторінки
  useEffect(() => {
    const el = ref.current
    const on = el?.querySelector<HTMLElement>('[aria-selected="true"], [aria-pressed="true"]')
    if (!el || !on) return
    const a = el.getBoundingClientRect()
    const b = on.getBoundingClientRect()
    if (b.left < a.left + FADE) el.scrollLeft -= a.left + FADE - b.left
    else if (b.right > a.right - FADE) el.scrollLeft += b.right - a.right + FADE
  }, [active])

  const mask = edge.l || edge.r
    ? `linear-gradient(to right, ${edge.l ? 'transparent' : '#000'}, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${edge.r ? 'transparent' : '#000'})`
    : undefined
  return (
    <div
      ref={ref}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
      className={cn('flex min-w-0 max-w-full items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}
    >
      {children}
    </div>
  )
}

/** класи для Seg усередині ScrollRow: гортає рядок, а не сама «пігулка» */
export const IN_ROW = 'w-max max-w-none shrink-0 overflow-x-visible'

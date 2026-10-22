/**
 * Де поставити картку-поповер біля елемента (вузла навички, картки риси). Вузький екран — шторка знизу; інакше:
 *   • side 'x' — праворуч від елемента (не влазить — ліворуч), по вертикалі — в межах екрана (вузли дерева);
 *   • side 'y' — під елементом (не влазить — над ним), по центру; так картка не закриває сусідів у ряду і
 *     курсор вільно йде вздовж ряду (риси спеціалізацій).
 * Перераховується, коли картка росте, сторінку гортають чи тягнуть вікно. Анімація — skills.css (.sk-tip).
 */
import { useLayoutEffect, useRef, useState } from 'react'

export const SHEET = 640 // вужче — шторка знизу

export function useAnchor(el: HTMLElement, width: number, gap = 10, side: 'x' | 'y' = 'x') {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | 'sheet' | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const vw = window.innerWidth, vh = window.innerHeight
      if (vw < SHEET) return setPos('sheet')
      const r = el.getBoundingClientRect()
      const h = box.current?.offsetHeight ?? 300
      if (side === 'y') {
        const below = r.bottom + gap + h <= vh - 8 || r.top - gap - h < 8
        const top = below ? r.bottom + gap : r.top - gap - h
        const left = Math.max(8, Math.min(vw - width - 8, r.left + r.width / 2 - width / 2))
        return setPos({ left, top, origin: `${r.left + r.width / 2 - left}px ${below ? 'top' : 'bottom'}` })
      }
      let left = r.right + gap
      const right = left + width <= vw - 8
      if (!right) left = r.left - gap - width
      left = Math.max(8, Math.min(vw - width - 8, left))
      const top = Math.max(8, Math.min(vh - h - 8, r.top + r.height / 2 - 60))
      setPos({ left, top, origin: right ? 'left center' : 'right center' })
    }
    place()
    const ro = new ResizeObserver(place)
    if (box.current) ro.observe(box.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { ro.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [el, width, gap, side])
  const sheet = pos === 'sheet'
  /** класи й стиль контейнера картки: шторка чи плаваюча, анімація з боку елемента */
  const frame = {
    className: sheet ? 'sk-sheet inset-x-0 bottom-0 max-h-[72vh] rounded-t-2xl pb-[max(14px,env(safe-area-inset-bottom))]' : 'max-h-[calc(100vh-16px)] rounded-xl',
    style: sheet || !pos ? undefined : { left: pos.left, top: pos.top, width, transformOrigin: pos.origin },
  }
  return { box, pos, sheet, frame }
}

/**
 * «На весь екран» для будівельника, 3D і плану бази. Блок стає на все вікно (fixed поверх сайту), а браузер — у
 * повноекранний режим для всієї сторінки (не лише блоку): так тости, діалоги й підказки лишаються видимими. Де
 * Fullscreen API нема (iPhone) — лише на все вікно. Esc — вийти (браузер виходить сам, а без API — ловимо Esc).
 * keepEsc (будівельник): Esc лишається сторінці — зняти вибір чи форму, як завжди; вийти — кнопкою або, де браузер
 * уміє (Chrome), затиснувши Esc.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/* eslint-disable @typescript-eslint/no-explicit-any */
const doc = () => (typeof document === 'undefined' ? null : (document as any))
const fsElement = () => doc()?.fullscreenElement ?? doc()?.webkitFullscreenElement ?? null
function enter(keepEsc: boolean) {
  const el = doc()?.documentElement
  const req = el?.requestFullscreen ?? el?.webkitRequestFullscreen
  try {
    const r = req?.call(el, { navigationUI: 'hide' })
    const lock = () => { if (keepEsc) (navigator as any).keyboard?.lock?.(['Escape'])?.catch?.(() => {}) }
    if (r?.then) r.then(lock, () => {})
    else lock()
  } catch { /* без API — лише на все вікно */ }
}
function leave() {
  const d = doc()
  if (!fsElement()) return
  const ex = d?.exitFullscreen ?? d?.webkitExitFullscreen
  try { (navigator as any).keyboard?.unlock?.(); const r = ex?.call(d); if (r?.catch) r.catch(() => {}) } catch { /* вже вийшли */ }
}

/** клас блоку на весь екран: поверх шапки (900) й бічних панелей, нижче за тости (980) і діалоги */
export const FULL_CLASS = 'fixed inset-0 z-[970] !m-0 !max-w-none !rounded-none flex flex-col bg-panel'

/**
 * предки, що самі — окремий шар (sticky, fixed, z-index, transform…), замикають блок у собі: його z-index тоді не
 * виводить його над шапкою й сусідніми панелями. На час повного екрана піднімаємо їх, потім — як було
 */
function liftAncestors(el: HTMLElement | null): () => void {
  const undo: (() => void)[] = []
  for (let a = el?.parentElement; a && a !== document.body; a = a.parentElement) {
    const c = getComputedStyle(a)
    const layer = c.position === 'sticky' || c.position === 'fixed' || (c.position !== 'static' && c.zIndex !== 'auto') ||
      c.transform !== 'none' || c.filter !== 'none' || c.isolation === 'isolate' || (c.contain && c.contain !== 'none') || (c.containerType && c.containerType !== 'normal')
    if (!layer) continue
    const prev = a.style.zIndex, prevPos = a.style.position
    a.style.zIndex = '970'
    if (c.position === 'static') a.style.position = 'relative'
    undo.push(() => { a!.style.zIndex = prev; a!.style.position = prevPos })
  }
  return () => { for (const f of undo) f() }
}

export function useFullscreen(ref: RefObject<HTMLElement | null>, { keepEsc = false }: { keepEsc?: boolean } = {}) {
  const [on, setOn] = useState(false)
  const toggle = useCallback(() => setOn((v) => !v), [])
  useEffect(() => {
    if (!on) return
    enter(keepEsc)
    // браузер вийшов з повного екрана (Esc, жест) — і ми
    let was = false
    const onChange = () => { if (fsElement()) was = true; else if (was) setOn(false) }
    // без Fullscreen API Esc не ловить ніхто — ловимо самі (поле вводу й діалоги — їхнє)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !keepEsc && !fsElement() && !(e.target as HTMLElement)?.closest?.('input,textarea,select,dialog,[role=dialog]')) setOn(false) }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    addEventListener('keydown', onKey)
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    const drop = liftAncestors(ref.current)
    return () => {
      drop()
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
      removeEventListener('keydown', onKey)
      html.style.overflow = prev
      leave()
    }
  }, [on, keepEsc, ref])
  return { on, toggle }
}

export function FullscreenButton({ on, toggle, className }: { on: boolean; toggle: () => void; className?: string }) {
  const label = on ? t('Вийти з повного екрана (Esc)') : t('На весь екран')
  return (
    <button type="button" onClick={toggle} aria-pressed={on} aria-label={label} title={label}
      className={cn('inline-grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line text-muted hover:border-spice/60 hover:text-ink', on && 'border-spice/60 text-ink', className)}>
      {on ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
    </button>
  )
}

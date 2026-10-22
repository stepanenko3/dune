/**
 * Клавіатура для саморобних випадних списків (мова, обліковий запис): фокус на перший пункт при відкритті, стрілки
 * між пунктами (cols — скільки пунктів у рядку сітки), Home/End, Escape — закрити й повернути фокус на кнопку,
 * Tab чи клік поза списком — закрити.
 */
import { useEffect, type RefObject } from 'react'

export function useMenuKeys(open: boolean, box: RefObject<HTMLElement>, close: () => void, cols = 1) {
  useEffect(() => {
    if (!open) return
    const items = () => [...(box.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
    const trigger = () => box.current?.querySelector<HTMLElement>('[aria-haspopup]')
    // поточний вибір (мова) — під фокусом одразу, інакше перший пункт
    // (ефект іде вже після того, як список з'явився в сторінці — фокусуємо одразу, без чекання кадру)
    { const all = items(); (all.find((x) => x.getAttribute('aria-checked') === 'true') ?? all[0])?.focus() }
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) close() }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); trigger()?.focus(); return }
      if (e.key === 'Tab') { close(); return }
      const all = items()
      const i = all.indexOf(document.activeElement as HTMLElement)
      const step = { ArrowDown: cols, ArrowUp: -cols, ArrowRight: cols > 1 ? 1 : 0, ArrowLeft: cols > 1 ? -1 : 0 }[e.key]
      let next = -1
      if (step) next = i < 0 ? 0 : (i + step + all.length) % all.length
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = all.length - 1
      if (next < 0) return
      e.preventDefault()
      all[next]?.focus()
    }
    addEventListener('pointerdown', out)
    addEventListener('keydown', key)
    return () => { removeEventListener('pointerdown', out); removeEventListener('keydown', key) }
  }, [open, box, close, cols])
}

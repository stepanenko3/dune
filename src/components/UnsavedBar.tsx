/**
 * Незбережені зміни — однаково на всьому сайті: сторінка чи форма каже useUnsaved(dirty, { save, discard }), а внизу
 * екрана з'являється смуга sn-save-bar з @snotax/ui («Є незбережені зміни · Скасувати · Зберегти»). Поки вона є, піти
 * на іншу сторінку сайту не можна (посилання, меню, «Назад» у браузері — store.setLeaveGuard): смуга «трусить», доки
 * не збережеш чи не скасуєш; закрити вкладку — питає браузер (beforeunload).
 * Кілька форм відразу — смуга для останньої, що змінилась; «Зберегти» й «Скасувати» — саме її.
 */
import { useEffect, useId, useRef } from 'react'
import { create } from 'zustand'
import { t } from '@/lib/i18n'
import { setLeaveGuard } from '@/store'
import { sn } from '@/components/sn'
import '@snotax/ui/elements/save-bar'

const SnSaveBar = sn('sn-save-bar')

export interface Unsaved {
  /** зберегти; помилка — показує сама форма (смуга лишається) */
  save: () => void | Promise<unknown>
  /** відкинути зміни (повернути збережене) */
  discard: () => void
  /** що саме не збережено (замість «Є незбережені зміни») */
  label?: string
}
/** shake — скільки разів не пустили зі сторінки (смуга «трусить» на кожен) */
const useUnsavedStore = create<{ list: (Unsaved & { id: string; at: number })[]; shake: number }>(() => ({ list: [], shake: 0 }))

/** dirty — є незбережене; поки так — смуга внизу й питання перед виходом */
export function useUnsaved(dirty: boolean, u: Unsaved) {
  const id = useId()
  // дії — завжди найсвіжіші (форма перемальовується, а запис у сховищі той самий)
  const ref = useRef(u)
  ref.current = u
  useEffect(() => {
    if (!dirty) return
    const entry = { id, at: Date.now(), save: () => ref.current.save(), discard: () => ref.current.discard(), get label() { return ref.current.label } }
    useUnsavedStore.setState((s) => ({ list: [...s.list.filter((x) => x.id !== id), entry] }))
    return () => useUnsavedStore.setState((s) => ({ list: s.list.filter((x) => x.id !== id) }))
  }, [dirty, id])
}

// піти зі сторінки з незбереженим — не пускаємо: смуга «трусить» (і читач екрана чує, що робити)
setLeaveGuard(() => {
  if (!useUnsavedStore.getState().list.length) return true
  useUnsavedStore.setState((s) => ({ shake: s.shake + 1 }))
  return false
})
addEventListener('beforeunload', (e) => {
  if (!useUnsavedStore.getState().list.length) return
  e.preventDefault()
  e.returnValue = ''
})

/** сама смуга (раз у App): внизу посередині, поверх сторінки */
export function UnsavedBar() {
  const list = useUnsavedStore((s) => s.list)
  const shake = useUnsavedStore((s) => s.shake)
  const cur = list[list.length - 1]
  const el = useRef<HTMLElement>(null)
  // не пустили зі сторінки — смуга трусить (без руху — лише спалах рамки)
  useEffect(() => {
    const bar = el.current?.shadowRoot?.querySelector<HTMLElement>('[part="bar"]')
    if (!shake || !bar) return
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    bar.animate(
      calm
        ? [{ boxShadow: '0 0 0 0 rgb(var(--c-spice) / 0)' }, { boxShadow: '0 0 0 4px rgb(var(--c-spice) / .6)' }, { boxShadow: '0 0 0 0 rgb(var(--c-spice) / 0)' }]
        : [0, -12, 10, -8, 6, -3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: calm ? 600 : 480, easing: 'ease-in-out' },
    )
  }, [shake])
  // підписи кнопок у смузі — англійські в самій бібліотеці (властивостей для них нема): ставимо мовою сайту
  useEffect(() => {
    const host = el.current
    const root = host?.shadowRoot
    if (!host || !root) return
    const apply = () => {
      const d = root.querySelector('[part="discard"]'), s = root.querySelector('[part="save"]'), bar = root.querySelector('[part="bar"]')
      if (d && d.textContent !== t('Скасувати')) d.textContent = t('Скасувати')
      if (s && s.textContent !== t('Зберегти')) s.textContent = t('Зберегти')
      bar?.setAttribute('aria-label', t('Незбережені зміни'))
    }
    apply()
    const mo = new MutationObserver(apply)
    mo.observe(root, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [!!cur])
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[970] flex justify-center px-3">
      <SnSaveBar
        ref={el}
        visible={!!cur}
        className="pointer-events-auto w-full max-w-md"
        onSave={() => void cur?.save()}
        onDiscard={() => cur?.discard()}
      >
        {cur?.label || t('Є незбережені зміни')}
      </SnSaveBar>
      <span className="sr-only" aria-live="assertive">{shake && cur ? t('Спершу збережи чи скасуй зміни') + '\u200b'.repeat(shake % 2) : ''}</span>
    </div>
  )
}

/**
 * Компоненти @snotax/ui (Lit, теги sn-*) у React 18. React 18 віддає кастомним елементам лише рядкові атрибути й не
 * вміє їхніх подій, тож обгортка:
 *   • усе, крім children/className/style/slot/id/key, ставить ВЛАСТИВОСТЯМИ елемента (масиви, об'єкти, функції
 *     колонок таблиці доходять як є) — перед першим малюванням, у useLayoutEffect;
 *   • onЩось → слухач події «щось» у kebab-case: onChange → change, onRowAction → row-action, onRequest → request.
 * Самі елементи реєструємо поштучно (import '@snotax/ui/elements/<назва>') — у збірку йде лише потрібне.
 */
import { createElement, forwardRef, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'

export type SnEvent<T = Record<string, unknown>> = CustomEvent<T>

interface Common {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  slot?: string
  id?: string
  hidden?: boolean
  title?: string
  role?: string
  tabIndex?: number
  'aria-label'?: string
  'data-tip'?: string
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SnProps = Common & Record<string, any>

const PASS = new Set(['children', 'className', 'style', 'slot', 'id', 'hidden', 'title', 'role', 'tabIndex'])
// звичайні події вказівника й клавіатури спливають крізь тіньовий DOM — їх лишаємо React (onClick тощо)
const REACT_EVENTS = /^on(Click|DoubleClick|Mouse\w+|Pointer\w+|Key(Down|Up)|ContextMenu|Wheel|Touch\w+|Drag\w*|Drop)$/
const kebab = (s: string) => s.replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

export function sn<P extends SnProps = SnProps>(tag: string) {
  const C = forwardRef<HTMLElement, P>((props, fref) => {
    const el = useRef<HTMLElement>(null)
    const prev = useRef<Record<string, unknown>>({})
    const handlers = useRef<Record<string, (e: Event) => void>>({})
    useImperativeHandle(fref, () => el.current as HTMLElement)

    const attrs: Record<string, unknown> = { ref: el }
    const propsSet: Record<string, unknown> = {}
    const events: Record<string, (e: Event) => void> = {}
    for (const [k, v] of Object.entries(props)) {
      if (k === 'className') attrs.class = v
      else if (PASS.has(k) || k.startsWith('aria-') || k.startsWith('data-') || REACT_EVENTS.test(k)) attrs[k] = v
      else if (/^on[A-Z]/.test(k) && typeof v === 'function') events[kebab(k.slice(2))] = v as (e: Event) => void
      else propsSet[k] = v
    }
    handlers.current = events

    // властивості — до першого малювання Lit (воно в мікрозадачі після вставки)
    useLayoutEffect(() => {
      const node = el.current as unknown as Record<string, unknown> | null
      if (!node) return
      for (const [k, v] of Object.entries(propsSet)) {
        if (prev.current[k] !== v || !(k in prev.current)) node[k] = v
      }
      for (const k of Object.keys(prev.current)) if (!(k in propsSet)) node[k] = undefined
      prev.current = propsSet
    })

    const names = Object.keys(events).sort().join('|')
    useLayoutEffect(() => {
      const node = el.current
      if (!node || !names) return
      const list = names.split('|').map((name) => {
        // рідні input/change з поля всередині тіньового DOM (InputEvent без detail) теж спливають до елемента —
        // слухачу потрібна лише подія самого компонента зі значенням
        // і лише ВЛАСНА подія елемента: однойменна з вкладеного sn-* (галочка таблиці всередині вкладок, діалог у
        // бічному листі) спливає сюди ж — вкладки перемикались від вибору рядка, лист закривався від діалогу в ньому
        const fn = (e: Event) => {
          if ((name === 'input' || name === 'change') && !(e instanceof CustomEvent)) return
          if (e.target !== node) return
          handlers.current[name]?.(e)
        }
        node.addEventListener(name, fn)
        return [name, fn] as const
      })
      return () => list.forEach(([name, fn]) => node.removeEventListener(name, fn))
    }, [names])

    return createElement(tag, attrs, props.children)
  })
  C.displayName = tag
  return C
}

/** значення з події поля: detail.value (sn-input, sn-select, sn-input-otp…) */
export const valueOf = <T = string,>(e: Event) => ((e as CustomEvent<{ value: T }>).detail?.value as T)
/** стан з події перемикача: detail.checked (sn-switch, sn-checkbox) */
export const checkedOf = (e: Event) => !!(e as CustomEvent<{ checked: boolean }>).detail?.checked

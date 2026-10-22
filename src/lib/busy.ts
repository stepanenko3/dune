/**
 * Скільки всього зараз вантажиться: запити сайту (fetch — перехоплюємо раз, installBusyFetch) і шматки сторінок, що
 * підвантажуються (useBusy у заглушці Suspense). Показує це смуга вгорі (components/TopLoader) і лого в шапці.
 * Живі потоки (SSE) — не fetch, тож смугу не тримають.
 */
import { useEffect } from 'react'
import { create } from 'zustand'

/** n — скільки вантажиться зараз; starts — скільки разів почалось (з нуля): коротке завантаження могло скінчитись ще до
 * перемалювання, а лічильник лишається — по ньому лого в шапці «оживає» навіть на мить */
export const useBusyStore = create<{ n: number; starts: number }>(() => ({ n: 0, starts: 0 }))
const add = (d: number) => useBusyStore.setState((s) => ({ n: Math.max(0, s.n + d), starts: s.n === 0 && d > 0 ? s.starts + 1 : s.starts }))
/** почати завантаження; повертає «закінчити» (повторний виклик — нічого) */
export function beginBusy() {
  add(1)
  let done = false
  return () => { if (!done) { done = true; add(-1) } }
}
/** поки компонент на екрані — щось вантажиться (заглушка lazy-сторінки) */
export function useBusy(on = true) {
  useEffect(() => (on ? beginBusy() : undefined), [on])
}

/** усі fetch сайту — у лічильник (раз на сторінку) */
export function installBusyFetch() {
  const w = window as Window & { __busyFetch?: boolean }
  if (w.__busyFetch) return
  w.__busyFetch = true
  const orig = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const end = beginBusy()
    return orig(input, init).finally(end)
  }
}

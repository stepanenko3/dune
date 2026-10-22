/**
 * Вкладки й фільтри в адресі: кожна вкладка — своя адреса (?tab=items, ?s=mentat…), тож її можна відкрити в новій
 * вкладці браузера, переслати, перезавантажити, а «назад» повертає попередню. Значення за замовчуванням в адресу не
 * пишемо. Інші параметри адреси (код білду, пошук) лишаються як є.
 */
import { useEffect, useState } from 'react'

const EV = 'sw:url'

/** поточна адреса з іншим значенням параметра (def чи null — без нього) */
export function urlWith(key: string, v: string | null, def?: string | null): string {
  const q = new URLSearchParams(location.search)
  if (v == null || v === def) q.delete(key)
  else q.set(key, v)
  // «~» і «|» у кодах білду й розрахунку лишаємо як є (URLSearchParams кодує їх у %7E, %7C — адреса стає нечитабельною)
  const s = q.toString().replace(/%7E/gi, '~').replace(/%7C/gi, '|')
  return location.pathname + (s ? `?${s}` : '')
}

/** записати адресу (push — новий крок історії, replace — замість поточного) і сказати про це вкладкам на сторінці */
export function goUrl(url: string, replace = false) {
  if (url !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState'](null, '', url)
  dispatchEvent(new Event(EV))
}

/**
 * Параметр адреси як стан: [значення, змінити, адреса для значення]. ok — чи значення допустиме (інакше — def).
 * Стежить за «назад / вперед» і за змінами з інших вкладок на сторінці.
 */
export function useUrlParam<T extends string>(key: string, def: T, ok?: (v: string) => boolean, opts?: { always?: boolean }) {
  const read = () => {
    const v = new URLSearchParams(location.search).get(key)
    return (v != null && (!ok || ok(v)) ? v : def) as T
  }
  const [v, setV] = useState<T>(read)
  useEffect(() => {
    const sync = () => setV(read())
    sync()
    addEventListener('popstate', sync)
    addEventListener(EV, sync)
    return () => { removeEventListener('popstate', sync); removeEventListener(EV, sync) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, def])
  // always — писати й значення за замовчуванням (коли воно не стале: «що було востаннє»), щоб посилання було однозначне
  const omit = opts?.always ? null : def
  const set = (nv: T, o?: { replace?: boolean }) => { setV(nv); goUrl(urlWith(key, nv, omit), o?.replace) }
  const href = (nv: T) => urlWith(key, nv, omit)
  return [v, set, href] as const
}

/** клік по посиланню-вкладці: звичайний — без перезавантаження; з Ctrl/⌘/Shift чи середньою — як звичайне посилання */
export const plainClick = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)

/**
 * Стан застосунку: який розділ відкрито. Роутера немає — як у Satisfactory, розділ живе
 * в zustand, а адреса лише віддзеркалює його (/, /dd, /plan, /map) через History API.
 */
import { create } from 'zustand'

export type View = 'main' | 'dd' | 'plan' | 'map'
export const VIEWS: View[] = ['main', 'dd', 'plan', 'map']

export const pathOf = (v: View) => (v === 'main' ? '/' : '/' + v)

export function viewFromLocation(): View {
  const seg = location.pathname.split('/')[1]
  if (seg === 'dd' || seg === 'plan' || seg === 'map') return seg
  // старі адреси однофайлової сторінки: index.html#dd, #plan, #res
  const hash = location.hash.replace('#', '')
  if (hash === 'dd' || hash === 'plan') return hash
  if (hash === 'res') return 'map'
  return 'main'
}

interface S {
  view: View
  /** відкритий лист на вузькому екрані (панель мапи, бокова колонка бази) */
  sheet: string | null
  setView: (v: View, opts?: { replace?: boolean; search?: string }) => void
  setSheet: (s: string | null) => void
}

export const useStore = create<S>((set) => ({
  view: viewFromLocation(),
  sheet: null,
  setView: (view, opts) => {
    const url = pathOf(view) + (opts?.search ?? '')
    if (location.pathname + location.search !== url) history[opts?.replace ? 'replaceState' : 'pushState'](null, '', url)
    set({ view, sheet: null })
  },
  setSheet: (sheet) => set({ sheet }),
}))

window.addEventListener('popstate', () => useStore.setState({ view: viewFromLocation(), sheet: null }))

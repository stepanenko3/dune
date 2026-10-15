import { create } from 'zustand'
import { prefGet, prefSet } from '@/lib/prefs'

export type ThemePref = 'system' | 'light' | 'dark'

const media = window.matchMedia('(prefers-color-scheme: dark)')
const resolve = (p: ThemePref): 'light' | 'dark' => (p === 'system' ? (media.matches ? 'dark' : 'light') : p)
const apply = (r: 'light' | 'dark') => document.documentElement.classList.toggle('dark', r === 'dark')

const initial = prefGet<ThemePref>('theme', 'system')

export const useTheme = create<{ pref: ThemePref; resolved: 'light' | 'dark'; setPref: (p: ThemePref) => void }>((set) => ({
  pref: initial,
  resolved: resolve(initial),
  setPref: (pref) => {
    prefSet('theme', pref)
    const resolved = resolve(pref)
    apply(resolved)
    set({ pref, resolved })
  },
}))

apply(resolve(initial))
media.addEventListener('change', () => {
  const { pref } = useTheme.getState()
  if (pref !== 'system') return
  const resolved = resolve(pref)
  apply(resolved)
  useTheme.setState({ resolved })
})

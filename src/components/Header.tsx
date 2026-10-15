/**
 * Шапка: окремі «пігулки» на фоні, як у Satisfactory — логотип, розділи, тема.
 * z-[900]: вище за панелі Leaflet (до 800).
 */
import { Castle, Map as MapIcon, Monitor, Moon, Sun, TentTree, TrendingUp } from 'lucide-react'
import { useStore, type View } from '@/store'
import { useTheme, type ThemePref } from '@/lib/theme'
import { cn } from '@/lib/utils'

const NAV: { id: View; label: string; short: string; icon: typeof Castle; tip: string }[] = [
  { id: 'main', label: 'Sandwalkers Main', short: 'Main', icon: Castle, tip: 'Головна база: 6 ділянок 10×10' },
  { id: 'dd', label: 'Sandwalkers DD', short: 'DD', icon: TentTree, tip: 'Форпост у Глибокій пустелі' },
  { id: 'plan', label: 'План розвитку', short: 'План', icon: TrendingUp, tip: 'Що будувати далі і скільки коштує' },
  { id: 'map', label: 'Мапа ресурсів', short: 'Мапа', icon: MapIcon, tip: 'Усе з гри на мапі + наші унікальні ресурси' },
]

const THEMES: { id: ThemePref; icon: typeof Sun; tip: string }[] = [
  { id: 'system', icon: Monitor, tip: 'Тема як у системі' },
  { id: 'light', icon: Sun, tip: 'Світла тема' },
  { id: 'dark', icon: Moon, tip: 'Темна тема' },
]

export function Header() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const { pref, setPref } = useTheme()
  const pill = 'flex h-12 items-center rounded-xl border border-line bg-panel shadow-lg'
  return (
    <header className="relative z-[900] flex shrink-0 gap-1.5 p-1.5 sm:gap-2.5 sm:p-2.5">
      <a
        href="/"
        onClick={(e) => { e.preventDefault(); setView('main') }}
        className={cn(pill, 'gap-2 px-3 text-ink')}
        aria-label="Sandwalkers — на головну"
      >
        <svg viewBox="0 0 32 32" className="h-6 w-6 shrink-0" aria-hidden>
          <path d="M3 21c4-6 8-6 11-2s8 4 15-3" fill="none" stroke="rgb(var(--c-spice))" strokeWidth="3" strokeLinecap="round" />
          <circle cx="22" cy="9" r="3.2" fill="rgb(var(--c-spice))" />
        </svg>
        <span className="hidden font-display text-[13px] font-bold uppercase tracking-[0.12em] sm:inline">Sandwalkers</span>
      </a>
      <nav className={cn(pill, 'min-w-0 flex-1 px-1.5')} aria-label="Розділи">
        <div className="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg border border-line/70 bg-panel2/60 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV.map((n) => {
            const on = n.id === view
            return (
              <a
                key={n.id}
                href={n.id === 'main' ? '/' : '/' + n.id}
                onClick={(e) => { e.preventDefault(); setView(n.id) }}
                aria-current={on ? 'page' : undefined}
                aria-label={n.label}
                data-tip={n.tip}
                className={cn(
                  'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-display text-[11px] font-semibold uppercase tracking-wide transition-colors',
                  on ? 'bg-panel text-spice shadow-sm dark:bg-bg' : 'text-muted hover:text-ink',
                )}
              >
                <n.icon size={15} className="shrink-0" />
                <span className="hidden xl:inline">{n.label}</span>
                <span className="xl:hidden">{n.short}</span>
              </a>
            )
          })}
        </div>
      </nav>
      <div className={cn(pill, 'gap-0.5 px-1.5')} role="group" aria-label="Тема">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={pref === t.id}
            aria-label={t.tip}
            data-tip={t.tip}
            onClick={() => setPref(t.id)}
            className={cn('flex h-8 w-8 items-center justify-center rounded-md transition-colors', pref === t.id ? 'bg-spice/15 text-spice' : 'text-muted hover:text-ink')}
          >
            <t.icon size={15} />
          </button>
        ))}
      </div>
    </header>
  )
}

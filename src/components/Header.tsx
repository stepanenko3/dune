/**
 * Шапка: окремі «пігулки» на фоні, як у Satisfactory — логотип, розділи, тема, мова, обліковий запис.
 * z-[900]: вище за панелі Leaflet (до 800).
 */
import { useSyncExternalStore } from 'react'
import { BookOpen, Calculator, CalendarDays, Castle, Map as MapIcon, Monitor, Moon, MoreHorizontal, Sparkles, Sun, TrendingUp } from 'lucide-react'
import { pathOf, useStore, type View } from '@/store'
import { useBusyStore } from '@/lib/busy'
import { DuneLoader } from '@/components/ui/dune-loader'
import { useTheme, type ThemePref } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { Menu } from '@/components/ui/menu'
import { AccountMenu } from '@/components/AccountMenu'
import { LangMenu } from '@/components/LangMenu'
import { t } from '@/lib/i18n'
import { plainClick } from '@/lib/urlState'

const NAV: { id: View; label: string; icon: typeof Castle; tip: string }[] = [
  { id: 'bases', label: t('Бази'), icon: Castle, tip: t('Твої бази й бази гільдії: план, 3D, кошторис') },
  { id: 'roadmap', label: t('Роадмапи'), icon: TrendingUp, tip: t('Що будувати далі, скільки коштує і що вже зроблено') },
  { id: 'map', label: t('Мапа'), icon: MapIcon, tip: t('Усе з гри на мапі + твої й гільдійські позначки') },
  { id: 'catalog', label: t('Довідник'), icon: BookOpen, tip: t('Усі предмети, пристрої, рецепти й будівельні набори гри') },
  // калькулятор і вміння — сторінки збереженого (розрахунки, білди), звідти — до самого інструмента
  { id: 'calcs', label: t('Калькулятор'), icon: Calculator, tip: t('Скільки сировини, крафтів, води й часу на будь-який набір предметів і будівель') },
  { id: 'builds', label: t('Уміння'), icon: Sparkles, tip: t('Планувальник умінь: п’ять шкіл, очки, збірка — посиланням') },
  { id: 'events', label: t('Події'), icon: CalendarDays, tip: t('Події спільноти: бої, турніри, перегони й збори — з часом, призами й реєстрацією') },
]

/**
 * до великого екрана в рядку — перші розділи (на телефоні три, далі чотири), решта — у меню «Ще» (усі шість не влазять,
 * а прокрутка рядка непомітна): до md — іконками, далі — з підписами; від lg — усі шість іконками (і назва біля знака),
 * від 1360 px — з підписами (на 1280 сім підписів з іменем людини вже не влазять)
 */
const phoneQuery = typeof matchMedia === 'function' ? matchMedia('(min-width: 640px)') : null
const useInRow = () => useSyncExternalStore(
  (cb) => { phoneQuery?.addEventListener('change', cb); return () => phoneQuery?.removeEventListener('change', cb) },
  () => (phoneQuery?.matches ?? true ? 4 : 3),
)

/** сторінки, що належать розділу меню: планувальник — розділу «Уміння», калькулятор — «Калькулятор» (бібліотеки в меню нема —
 * вона в кожному розділі вкладкою «Публічні») */
const PARENT: Partial<Record<View, View>> = { skills: 'builds', calculator: 'calcs' }

const THEMES: { id: ThemePref; icon: typeof Sun; tip: string }[] = [
  { id: 'system', icon: Monitor, tip: t('Тема як у системі') },
  { id: 'light', icon: Sun, tip: t('Світла тема') },
  { id: 'dark', icon: Moon, tip: t('Темна тема') },
]

export function Header() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const { pref, setPref } = useTheme()
  const pill = 'flex h-12 items-center rounded-xl border border-line bg-panel shadow-lg'
  const inRow = useInRow()
  // лого живе, поки щось вантажиться: розгойдується й затихає саме, плавно (components/ui/dune-loader)
  const busy = useBusyStore((s) => s.n > 0)
  const starts = useBusyStore((s) => s.starts)
  return (
    <header className="relative z-[900] flex shrink-0 gap-1.5 p-1.5 sm:gap-2.5 sm:p-2.5">
      <a
        href="/"
        onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('home') }}
        className={cn(pill, 'gap-2 px-3 text-ink')}
        aria-label={t('Sandwalkers — на головну')}
      >
        {/* лого — і є індикатор завантаження: поки щось вантажиться, воно живе (components/ui/dune-loader) */}
        <DuneLoader size={24} active={busy} kick={starts} />
        <span className="hidden font-display text-[13px] font-bold uppercase tracking-[0.12em] lg:inline">Sandwalkers</span>
      </a>
      <nav className={cn(pill, 'min-w-0 flex-1 px-1.5')} aria-label={t('Розділи')}>
        {/* розділи прямо на панелі шапки (без другої рамки всередині — «блок у блоці»); активний — плашкою спайсу */}
        <div className="flex min-w-0 gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV.map((n, i) => {
            // сторінки розділу підсвічують сам розділ: «Білди» — «Уміння», «Розрахунки» — «Калькулятор»
            const on = n.id === (PARENT[view] ?? view)
            return (
              <a
                key={n.id}
                href={pathOf(n.id)}
                onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView(n.id) }}
                aria-current={on ? 'page' : undefined}
                aria-label={n.label}
                data-tip={n.tip}
                className={cn(
                  'flex h-8 shrink-0 items-center gap-1.5 rounded-md font-display text-[11px] font-semibold uppercase tracking-wide transition-colors',
                  on ? 'bg-spice/10 px-2.5 text-spice' : 'px-2 text-muted hover:bg-ink/5 hover:text-ink sm:px-2.5',
                  i >= inRow && 'max-lg:hidden',
                )}
              >
                <n.icon size={15} className="shrink-0" />
                <span className="hidden md:inline lg:hidden min-[1360px]:inline">{n.label}</span>
              </a>
            )
          })}
        </div>
        {/* «Ще» — поза рядком із прокруткою: інакше той обрізав би випадне меню */}
        {(() => {
          const rest = NAV.slice(inRow)
          // планувальник і розрахунок — сторінки розділів «Уміння» й «Калькулятор»: «Ще» теж підсвічується
          const cur = rest.find((n) => n.id === (PARENT[view] ?? view))
          const Icon = cur?.icon ?? MoreHorizontal
          return (
            <Menu
              className="ml-0.5 lg:hidden"
              align="end"
              trigger={
                <button type="button" aria-label={cur ? t('Ще розділи (зараз: {name})', { name: cur.label }) : t('Ще розділи')}
                  className={cn('flex h-8 shrink-0 items-center rounded-md px-2 transition-colors', cur ? 'bg-spice/10 text-spice' : 'text-muted hover:bg-ink/5 hover:text-ink')}>
                  <Icon size={15} />
                </button>
              }
              items={rest.map((n) => ({ label: n.label, icon: <n.icon size={15} />, checked: n.id === (PARENT[view] ?? view), onSelect: () => setView(n.id) }))}
            />
          )
        })()}
      </nav>
      {/* тема й мова — одним блоком: тема — меню з трьох варіантів, мова — свій список */}
      <div className={cn(pill, 'shrink-0 gap-0.5 px-1.5')} role="group" aria-label={t('Тема й мова')}>
        <Menu
          align="end"
          trigger={(() => {
            const cur = THEMES.find((x) => x.id === pref) ?? THEMES[0]
            return (
              <button type="button" aria-label={t('Тема: {theme}', { theme: cur.tip })} data-tip={t('Тема')} className="flex h-8 w-8 items-center justify-center rounded-md text-spice hover:bg-spice/10">
                <cur.icon size={16} />
              </button>
            )
          })()}
          items={THEMES.map((th) => ({ label: th.tip, icon: <th.icon size={15} />, checked: pref === th.id, onSelect: () => setPref(th.id) }))}
        />
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <LangMenu />
      </div>
      <AccountMenu pill={pill} />
    </header>
  )
}

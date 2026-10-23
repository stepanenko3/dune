/**
 * Шапка: окремі «пігулки» на фоні, як у Satisfactory — логотип, розділи, тема, мова, обліковий запис.
 * z-[900]: вище за панелі Leaflet (до 800).
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { BookOpen, Calculator, CalendarDays, Castle, Handshake, Map as MapIcon, Monitor, Moon, MoreHorizontal, Sparkles, Sun, TrendingUp } from 'lucide-react'
import { pathOf, useStore, type View } from '@/store'
import { useBusyStore } from '@/lib/busy'
import { DuneLoader } from '@/components/ui/dune-loader'
import { useTheme, type ThemePref } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { Menu } from '@/components/ui/menu'
import { AccountMenu } from '@/components/AccountMenu'
import { Notifications } from '@/components/Notifications'
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
  { id: 'market', label: t('Біржа'), icon: Handshake, tip: t('Куплю й продам: предмети з гри, ціни від спільноти, угоди з репутацією') },
]

/** сторінки, що належать розділу меню: планувальник — розділу «Уміння», калькулятор — «Калькулятор» (бібліотеки в меню нема —
 * вона в кожному розділі вкладкою «Публічні») */
const PARENT: Partial<Record<View, View>> = { skills: 'builds', calculator: 'calcs' }

/** з підписами — поки в рядку лишається більше за стільки розділів; менше — краще всі іконками */
const MIN_LABELLED = 4
const GAP = 2

/**
 * Скільки розділів влазить у рядок і чи з підписами. Ширини кожного розділу (з підписом і без) і кнопки «Ще» міряє
 * невидимий рядок-лінійка; що не влазить — по одному, з кінця, іде в «Ще». З підписами — поки в рядку лишаються хоча б
 * MIN_LABELLED розділи, інакше — усі іконками (їх влазить більше). Перераховує ResizeObserver до малювання: нічого не
 * блимає й не прокручується
 */
function useNavFit(nav: RefObject<HTMLElement>, ruler: RefObject<HTMLElement>, n: number) {
  const [fit, setFit] = useState<{ shown: number; labels: boolean }>({ shown: n, labels: true })
  useLayoutEffect(() => {
    const box = nav.current, r = ruler.current
    if (!box || !r) return
    const check = () => {
      const st = getComputedStyle(box)
      const room = box.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight)
      const w = (sel: string) => [...r.querySelectorAll<HTMLElement>(sel)].map((e) => e.offsetWidth)
      const wide = w('[data-m="label"]'), narrow = w('[data-m="icon"]'), more = (r.querySelector<HTMLElement>('[data-m="more"]')?.offsetWidth ?? 32) + GAP
      // скільки перших розділів влазить (решта — у «Ще», тоді й вона має влізти)
      const count = (ws: number[]) => {
        let sum = 0
        for (let k = 0; k < ws.length; k++) {
          sum += ws[k] + (k ? GAP : 0)
          const need = sum + (k + 1 < ws.length ? more : 0)
          if (need > room + 0.5) return k
        }
        return ws.length
      }
      const withLabels = count(wide)
      const next = withLabels === n || withLabels >= MIN_LABELLED ? { shown: withLabels, labels: true } : { shown: count(narrow), labels: false }
      setFit((cur) => (cur.shown === next.shown && cur.labels === next.labels ? cur : next))
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(box)
    ro.observe(r)
    // шрифт підвантажився — підписи змінили ширину
    void document.fonts?.ready.then(check)
    return () => ro.disconnect()
  }, [nav, ruler, n])
  return fit
}

/** розділ у рядку шапки (і в лінійці — той самий вигляд, щоб ширини збігались) */
const ITEM = 'flex h-8 shrink-0 items-center gap-1.5 rounded-md font-display text-[11px] font-semibold uppercase tracking-wide transition-colors'

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
  const navRef = useRef<HTMLElement>(null)
  const rulerRef = useRef<HTMLDivElement>(null)
  const { shown, labels } = useNavFit(navRef, rulerRef, NAV.length)
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
      <nav ref={navRef} className={cn(pill, 'relative min-w-0 flex-1 px-1.5')} aria-label={t('Розділи')}>
        {/* лінійка для useNavFit: кожен розділ з підписом і без, кнопка «Ще» — невидимо, поза потоком */}
        <div ref={rulerRef} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex h-0 overflow-hidden whitespace-nowrap">
          {NAV.map((n) => (
            <span key={n.id} className="contents">
              <span data-m="label" className={cn(ITEM, 'px-2.5')}><n.icon size={15} className="shrink-0" /><span>{n.label}</span></span>
              <span data-m="icon" className={cn(ITEM, 'px-2.5')}><n.icon size={15} className="shrink-0" /></span>
            </span>
          ))}
          <span data-m="more" className="flex h-8 w-8 shrink-0 items-center justify-center px-2"><MoreHorizontal size={15} /></span>
        </div>
        {/* розділи прямо на панелі шапки (без другої рамки всередині — «блок у блоці»); активний — плашкою спайсу;
            що не влазить — по одному в «Ще» */}
        <div className="flex min-w-0 gap-0.5">
          {NAV.slice(0, shown).map((n) => {
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
                className={cn(ITEM, 'px-2.5', on ? 'bg-spice/10 text-spice' : 'text-muted hover:bg-ink/5 hover:text-ink')}
              >
                <n.icon size={15} className="shrink-0" />
                {labels && <span>{n.label}</span>}
              </a>
            )
          })}
        </div>
        {shown < NAV.length && (() => {
          const rest = NAV.slice(shown)
          // планувальник і розрахунок — сторінки розділів «Уміння» й «Калькулятор»: «Ще» теж підсвічується
          const cur = rest.find((n) => n.id === (PARENT[view] ?? view))
          const Icon = cur?.icon ?? MoreHorizontal
          return (
            <Menu
              className="ml-0.5"
              align="end"
              trigger={
                <button type="button" aria-label={cur ? t('Ще розділи (зараз: {name})', { name: cur.label }) : t('Ще розділи')}
                  className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md px-2 transition-colors', cur ? 'bg-spice/10 text-spice' : 'text-muted hover:bg-ink/5 hover:text-ink')}>
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
      <Notifications pill={pill} />
      <AccountMenu pill={pill} />
    </header>
  )
}

import { lazy, Suspense, useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { Header } from '@/components/Header'
import { TopLoader } from '@/components/TopLoader'
import { ConfirmHost } from '@/components/ui/confirm'
import { UnsavedBar } from '@/components/UnsavedBar'
import { Crumbs, pageReady } from '@/components/Crumbs'
import { useBusy, useBusyStore } from '@/lib/busy'
import { StormAlert } from '@/components/DDTimer'
import { FrozenRoute, useStore, type Route } from '@/store'
import { BasesList } from '@/pages/BasesList'
import { Roadmap } from '@/pages/Roadmap'
import { Home } from '@/pages/Home'
import { useAuth } from '@/lib/auth'
import { Announcements } from '@/components/Announcements'
import { AuthPage } from '@/pages/Auth'
import { Library } from '@/pages/Library'
import { KindPage } from '@/pages/KindPage'
import { Account } from '@/pages/Account'
import { UserPage } from '@/pages/UserPage'
import { GuildPage, Guilds, InvitePage } from '@/pages/Guilds'
import { RoadmapList } from '@/pages/RoadmapList'
import { PageHeader } from '@/components/PageHeader'
import { Loading } from '@/components/states'
import { t } from '@/lib/i18n'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NotFound } from '@/pages/NotFound'

/** заголовок вкладки браузера — за розділом (раніше на всіх сторінках однаковий) */
const TITLE: Partial<Record<string, () => string>> = {
  bases: () => t('Бази'), roadmap: () => t('Роадмапи'), map: () => t('Мапа'), catalog: () => t('Довідник'), calculator: () => t('Розрахунок'),
  skills: () => t('Планувальник'), builds: () => t('Уміння'), calcs: () => t('Калькулятор'), library: () => t('Бібліотека'), login: () => t('Вхід'), account: () => t('Налаштування профілю'), guilds: () => t('Гільдії'),
  guild: () => t('Гільдія'), invite: () => t('Запрошення'), admin: () => t('Панель керування'), data: () => t('Оновлення даних'), notfound: () => t('Такої сторінки нема'),
}

// панель керування — рідко й не всім: окремим шматком
const Admin = lazy(() => import('@/pages/admin/AdminApp').then((m) => ({ default: m.AdminApp })))

// мапа тягне Leaflet і власний шар точок — вантажимо, лише коли її відкрили
const MapPage = lazy(() => import('@/pages/MapPage'))
const Catalog = lazy(() => import('@/pages/Catalog'))
const CalcPage = lazy(() => import('@/pages/CalcPage'))
const SkillsPage = lazy(() => import('@/pages/SkillsPage'))
const DataUpdates = lazy(() => import('@/pages/DataUpdates'))
// сторінка бази — рушій баз, three.js і редактор: найважче на сайті, тож теж окремо
const loadBasePage = () => import('@/pages/BasePage')
const BasePage = lazy(() => loadBasePage().then((m) => ({ default: m.BasePage })))
// генератор баз — теж із рушієм баз і three.js
const BaseGenerator = lazy(() => import('@/pages/BaseGenerator'))

/** шматок сторінки бази — заздалегідь, коли браузер вільний: перша відкрита база не чекає на нього.
 *  З «Економією трафіку» чи на 2G — ні, тоді він приходить, лише коли базу відкрили */
function prefetchBasePage() {
  const net = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (net?.saveData || /2g/.test(net?.effectiveType || '')) return () => {}
  const go = () => void loadBasePage().catch(() => {})
  // спершу хай довантажиться сама сторінка (на головній — скан і сцена), тоді — у вільну мить
  // (у Safari requestIdleCallback нема — там просто після паузи)
  const h = setTimeout(() => ('requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 5000 }) : go()), 6000)
  return () => clearTimeout(h)
}

/** поки вантажиться шматок сторінки: спінер по центру; у сторінок із шапкою — і шапка на своєму місці, щоб заголовок не стрибав */
function Fallback({ label, title }: { label: string; title?: string }) {
  // шматок сторінки ще вантажиться — смуга вгорі теж (lib/busy)
  useBusy()
  if (!title) return <Loading page label={label} />
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 flex-col gap-2.5">
      <PageHeader title={title} />
      <Loading page label={label} />
    </div>
  )
}


/** сторінка за адресою (App кладе її в одне з двох місць: на екрані чи наступна, що вантажиться) */
function Page({ r }: { r: Route }) {
  const { view, base, param } = r
  return (
    <>
        {view === 'notfound' ? (
          <NotFound />
        ) : view === 'map' ? (
          <Suspense fallback={<Fallback label={t('Завантаження мапи…')} />}>
            <MapPage />
          </Suspense>
        ) : view === 'catalog' ? (
          <Suspense fallback={<Fallback label={t('Завантаження довідника…')} title={t('Довідник')} />}>
            <Catalog />
          </Suspense>
        ) : view === 'calculator' ? (
          <Suspense fallback={<Fallback label={t('Завантаження калькулятора…')} title={t('Калькулятор')} />}>
            <CalcPage />
          </Suspense>
        ) : view === 'skills' ? (
          <Suspense fallback={<Fallback label={t('Завантаження вмінь…')} />}>
            <SkillsPage />
          </Suspense>
        ) : view === 'data' ? (
          <Suspense fallback={<Fallback label={t('Завантаження…')} title={t('Оновлення даних')} />}>
            <DataUpdates />
          </Suspense>
        ) : view === 'roadmap' ? (
          param ? <Roadmap key={param} id={param} /> : <RoadmapList />
        ) : view === 'library' ? (
          <Library />
        ) : view === 'builds' ? (
          <KindPage kind="build" />
        ) : view === 'calcs' ? (
          <KindPage kind="calc" />
        ) : view === 'login' ? (
          <AuthPage />
        ) : view === 'account' ? (
          <Account />
        ) : view === 'user' ? (
          <UserPage key={param} />
        ) : view === 'guilds' ? (
          <Guilds />
        ) : view === 'guild' ? (
          <GuildPage key={param} />
        ) : view === 'invite' ? (
          <InvitePage />
        ) : view === 'admin' ? (
          <Suspense fallback={<Fallback label={t('Завантаження панелі…')} />}>
            <Admin />
          </Suspense>
        ) : view === 'home' ? (
          <Home />
        ) : base ? (
          <Suspense fallback={<Fallback label={t('Завантаження бази…')} />}>
            <BasePage key={base} base={base} />
          </Suspense>
        ) : param === 'generate' ? (
          <Suspense fallback={<Fallback label={t('Завантаження генератора…')} title={t('Генератор баз')} />}>
            <BaseGenerator />
          </Suspense>
        ) : (
          <BasesList />
        )}
    </>
  )
}

export default function App() {
  const view = useStore((s) => s.view)
  const base = useStore((s) => s.base)
  const param = useStore((s) => s.param)
  const edit = useStore((s) => s.edit)
  const sub = useStore((s) => s.sub)
  // перехід на іншу сторінку: попередня лишається на екрані, поки нова (поруч, невидима) не завантажиться — без порожнього
  // екрана й індикатора на всю сторінку; вкладки (sub) — та сама сторінка, тож міняються одразу
  // панель керування — одна сторінка (розділи й записи міняє сама, з бічним меню на місці), тож переходи в ній — не нова сторінка
  const key = view === 'admin' ? 'admin' : `${view}|${base ?? ''}|${param ?? ''}|${edit ? 1 : 0}`
  const route: Route & { key: string } = { view, base, param, edit, sub, key }
  const [{ slots, front }, setSlots] = useState<{ slots: [(Route & { key: string }) | null, (Route & { key: string }) | null]; front: 0 | 1 }>(() => ({ slots: [route, null], front: 0 }))
  const at = slots.findIndex((x) => x?.key === key)
  if (at === -1) {
    // нова адреса — у місце позаду (те, що там вантажилось, — геть)
    const next = [...slots] as typeof slots
    next[front === 0 ? 1 : 0] = route
    setSlots({ slots: next, front })
  } else if (at === front && slots[front === 0 ? 1 : 0]) {
    // повернулись туди, що й так на екрані, — наступна вже не потрібна
    const next = [...slots] as typeof slots
    next[front === 0 ? 1 : 0] = null
    setSlots({ slots: next, front })
  } else if (slots[at] && (slots[at]!.sub !== sub || slots[at]!.param !== param)) {
    // вкладка на тій самій сторінці — щоб попередня (якщо ще на екрані) бачила свою, а поточна — нову
    const next = [...slots] as typeof slots
    next[at] = { ...slots[at]!, sub, param }
    setSlots({ slots: next, front })
  }
  const holding = at !== -1 && at !== front
  useEffect(() => {
    if (!holding) return
    // готова — коли нічого не вантажиться (запити, шматки сторінок) і сторінка вже назвала свій шлях; довше 6 с — показуємо як є
    let calm = 0
    const show = () => setSlots((s) => {
      const i = s.slots.findIndex((x) => x?.key === key)
      if (i === -1 || i === s.front) return s
      const next = [...s.slots] as typeof s.slots
      next[i === 0 ? 1 : 0] = null
      return { slots: next, front: i as 0 | 1 }
    })
    const iv = setInterval(() => {
      if (useBusyStore.getState().n === 0 && pageReady()) { if (++calm >= 2) show() } else calm = 0
    }, 40)
    const cap = setTimeout(show, 6000)
    return () => { clearInterval(iv); clearTimeout(cap) }
  }, [holding, key])
  useEffect(() => { useAuth.getState().load() }, [])
  useEffect(() => { const s = TITLE[view]?.(); document.title = s ? `${s} · Sandwalkers` : 'Sandwalkers · Dune: Awakening' }, [view])
  // база найчастіше відкривається з головної чи списку баз — заздалегідь лише там (на мапі чи в довіднику — ні)
  const nearBases = view === 'home' || view === 'bases'
  useEffect(() => (nearBases ? prefetchBasePage() : undefined), [nearBases])
  // перейшли розділом із шапки клавіатурою — фокус на вміст, а не лишається в меню
  useEffect(() => {
    if (document.activeElement?.closest('header')) document.getElementById('main')?.focus({ preventScroll: true })
  }, [view])
  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-bg text-ink">
      <a href="#main" className="sr-only z-50 rounded-md bg-spice px-3 py-2 text-[14px] font-semibold text-on-spice focus:not-sr-only focus:absolute focus:left-2 focus:top-2">{t('Перейти до вмісту')}</a>
      <TopLoader />
      <Header />
      {/* повний шлях до сторінки (крім головної й панелі) */}
      <Crumbs hold={holding} />
      {/* на головній буря й так видна (картка й відлік у першому блоці) — смужка там зайва */}
      {view !== 'home' && <StormAlert />}
      <Announcements />
      <main id="main" tabIndex={-1} className="relative flex min-h-0 flex-1 flex-col px-1.5 pb-1.5 outline-none sm:px-2.5 sm:pb-2.5">
        {slots.map((r, i) => r && (
          // місце сторінки не міняється, коли вона виходить наперед (інакше React створив би її наново й вона б знову вантажилась)
          <div
            key={i}
            data-current={r.key === key || undefined}
            aria-hidden={i !== front || undefined}
            {...(i !== front ? { inert: '' } : {})}
            className={i === front ? 'flex min-h-0 flex-1 flex-col' : 'pointer-events-none invisible absolute inset-0 flex flex-col px-1.5 pb-1.5 sm:px-2.5 sm:pb-2.5'}
          >
            <FrozenRoute.Provider value={r.key === key ? null : r}>
              <ErrorBoundary resetKey={r.key}>
                <Page r={r} />
              </ErrorBoundary>
            </FrozenRoute.Provider>
          </div>
        ))}
      </main>
      <ConfirmHost />
      <UnsavedBar />
      <Toaster
        position="bottom-center"
        style={{ zIndex: 980 }}
        toastOptions={{ classNames: { toast: '!bg-panel !text-ink !border-line !shadow-lg', description: '!text-muted' } }}
      />
    </div>
  )
}

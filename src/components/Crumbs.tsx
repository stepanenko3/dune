/**
 * Хлібні крихти — повний шлях до сторінки під шапкою на всіх сторінках, крім головної й панелі (у неї свої): «Головна ›
 * Бази › Sandwalkers Main › Редагування». Початок шляху — за розділом (CRUMBS), кінець — назви, які додає сама сторінка
 * (useCrumb: база, роадмап, гільдія, людина, відкритий білд чи розрахунок, вкладка). Ланки — посилання (Ctrl/⌘-клік —
 * у новій вкладці), остання — поточна сторінка.
 * Ланка показує й підсторінку, на яку веде, значком поруч: «Уміння [Мої]», «Бібліотека [Білди]», «Планувальник [Ментат]»,
 * «Sandwalkers [Учасники]» — одразу видно, куди потрапиш. Розділ із вкладками «Мої · Гільдія · Публічні» (бази, роадмапи,
 * білди, розрахунки) веде на «Мої», а без входу — на «Публічні»; на списку — на відкриту вкладку; зі сторінки речі — на
 * ту, де ця річ лежить (useCrumb(…, { sub: scopeOf(item) })). Головна — лише будиночок.
 * Значок показує, куди веде клік (вкладка списку, вид бібліотеки, школа планувальника), а окремі сторінки (учасники
 * гільдії, спеціалізації, редагування) — окремими ланками. Шлях з'являється, лише коли сторінка вже знає його повністю
 * (вхід перевірено, річ завантажено): інакше на мить видно «Мої», а тоді — «Гільдія».
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { ChevronRight, Home } from 'lucide-react'
import { t } from '@/lib/i18n'
import { plainClick } from '@/lib/urlState'
import { FrozenRoute, openPath, pathOf, useStore, type View } from '@/store'
import { useAuth } from '@/lib/auth'
import type { Owner } from '@/lib/items'
import { cn } from '@/lib/utils'

/** ланка: куди веде (розділ і, для бази, її id; або готова адреса) і підпис */
/** path — готова адреса цього сайту (сторінка, що сама читає свою адресу, як довідник: після переходу їй — popstate) */
/** go — свій перехід на звичайний клік (та сама сторінка, інший стан: відкритий білд); href — для нової вкладки */
/** value — підсторінка значком поруч із назвою (вкладка, вид, школа) */
export interface Crumb { label: string; value?: string; view?: View; base?: string; param?: string; sub?: string | null; search?: string; path?: string; go?: () => void }

/** розділи з вкладками «Мої · Гільдія · Публічні» */
const SCOPED: View[] = ['bases', 'roadmap', 'builds', 'calcs']

/** вкладки розділу значком */
const SCOPE_LABEL = () => ({ mine: t('Мої'), guild: t('Гільдія'), public: t('Публічні') }) as Record<string, string>

/** sub/value — куди веде розділ (остання ланка початку шляху): вкладка й її назва (undefined — за замовчуванням) */
/** at — для якої адреси сторінка назвала шлях (null — ще вантажиться) */
/** by — хто з useCrumb назвав (прибирає за собою лише своє: попередня сторінка йде вже після того, як нова назвала шлях) */
const useTail = create<{ tail: Crumb[]; sub?: string | null; value?: string; at: string | null; by: number; go: Record<number, () => void> }>(() => ({ tail: [], at: '', by: 0, go: {} }))
let seq = 0
const routeKey = () => { const s = useStore.getState(); return `${s.view}|${s.base ?? ''}|${s.param ?? ''}` }
/** сторінки, чий шлях залежить від завантаженого (назва, вкладка, де лежить річ): без їхнього слова шляху не показуємо */
const needsPage = (v: View, base: string | null, param: string | null) =>
  (v === 'bases' && !!base) || (v === 'roadmap' && !!param) || (v === 'events' && !!param) || (v === 'market' && !!param) || v === 'skills' || v === 'calculator' || v === 'user' || v === 'guild'
/** поточна сторінка вже знає свій шлях (тобто завантажилась) — для App: коли показати її замість попередньої */
export function pageReady() {
  const s = useStore.getState()
  return !needsPage(s.view, s.base, s.param) || useTail.getState().at === routeKey()
}

/**
 * сторінка додає кінець шляху (поки вона відкрита); null — ще вантажиться (шлях сховано), [] — нічого. opts — підсторінка
 * розділу: вкладка списку, де лежить відкрита річ (sub), чи вид бібліотеки з назвою (sub + value)
 */
export function useCrumb(tail: Crumb[] | null, opts?: { sub?: string | null; value?: string }) {
  // переходи (go) — функції: у ключ не йдуть, але беремо завжди свіжі
  const key = JSON.stringify([tail, opts?.sub, opts?.value])
  const go: Record<number, () => void> = {}
  tail?.forEach((c, i) => { if (c.go) go[i] = c.go })
  // попередня сторінка, що ще на екрані (App), шлях уже не називає — він нової
  const frozen = !!useContext(FrozenRoute)
  const me = useRef(0)
  if (!me.current) me.current = ++seq
  useEffect(() => { if (!frozen && useTail.getState().by === me.current) useTail.setState({ go }) })
  // до малювання — щоб не мигнув шлях за замовчуванням
  useLayoutEffect(() => {
    if (frozen) return
    useTail.setState({ tail: tail ?? [], sub: opts?.sub, value: opts?.value, at: tail ? routeKey() : null, by: me.current, go })
    return () => { if (useTail.getState().by === me.current) useTail.setState({ tail: [], sub: undefined, value: undefined, at: '', by: 0, go: {} }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** вкладка, де лежить річ: своя — «Мої» (null), твоєї гільдії — «Гільдія», решта — «Публічні»; без входу — «Публічні» */
export function useScopeOf(owner: Pick<Owner, 'kind' | 'id'> | null | undefined): string | null | undefined {
  const user = useAuth((s) => s.user)
  const guild = useAuth((s) => s.guilds)[0]
  if (!owner) return undefined
  if (!user) return 'public'
  if (owner.kind === 'user' && owner.id === user.id) return null
  if (owner.kind === 'guild' && owner.id === guild?.id) return 'guild'
  return 'public'
}

const LIB = (): Crumb => ({ label: t('Бібліотека'), view: 'library' })

/** початок шляху за розділом */
const CRUMBS: Partial<Record<View, () => Crumb[]>> = {
  // бази, роадмапи, уміння й калькулятор — розділи бібліотеки (вона розводить на них)
  bases: () => [LIB(), { label: t('Бази'), view: 'bases' }],
  roadmap: () => [LIB(), { label: t('Роадмапи'), view: 'roadmap' }],
  map: () => [{ label: t('Мапа'), view: 'map' }],
  // довідник сам читає адресу — на його головну переходимо адресою (openPath + popstate)
  catalog: () => [{ label: t('Довідник'), view: 'catalog', path: '/catalog' }],
  // розділ — збережене (розрахунки, білди) з вкладками; інструмент — його підсторінка: Калькулятор › Розрахунок,
  // Уміння › Планувальник (відкритий збережений — його назвою; сторінка додає сама)
  calculator: () => [LIB(), { label: t('Калькулятор'), view: 'calcs' }],
  calcs: () => [LIB(), { label: t('Калькулятор'), view: 'calcs' }],
  skills: () => [LIB(), { label: t('Уміння'), view: 'builds' }],
  builds: () => [LIB(), { label: t('Уміння'), view: 'builds' }],
  library: () => [{ label: t('Бібліотека'), view: 'library' }],
  login: () => [{ label: t('Вхід'), view: 'login' }],
  // налаштування — підсторінка свого профілю: Головна › ім'я › Налаштування профілю (ім'я — нижче, з входу)
  account: () => [{ label: t('Налаштування профілю'), view: 'account' }],
  guilds: () => [{ label: t('Гільдії'), view: 'guilds' }],
  // з гільдії — до списку всіх гільдій
  guild: () => [{ label: t('Гільдії'), view: 'guilds', value: t('Усі') }],
  invite: () => [{ label: t('Гільдії'), view: 'guilds', value: t('Усі') }, { label: t('Запрошення') }],
  events: () => [{ label: t('Події'), view: 'events' }],
  market: () => [{ label: t('Біржа'), view: 'market' }],
  chats: () => [{ label: t('Розмови'), view: 'chats' }],
  notfound: () => [{ label: t('Сторінку не знайдено') }],
  // людина: окремого списку людей нема — шлях через її гільдію (сторінка додає сама), без гільдії — одразу з головної
  user: () => [],
}

const hrefOf = (c: Crumb) => (c.path ? c.path : c.view ? pathOf(c.view, c.base ?? null, false, c.param ?? null, c.sub ?? null) + (c.search ?? '') : null)

/** hold — нова сторінка ще вантажиться, на екрані попередня: і шлях лишається її */
export function Crumbs({ hold }: { hold?: boolean }) {
  const last = useRef<ReactNode>(null)
  const out = useCrumbsNow()
  if (!hold) last.current = out
  const node = hold ? last.current : out
  // нема шляху (головна, панель зі своїми крихтами) — і місця в сторінці не треба
  const slot = usePageSlot(node != null)
  // на телефоні шлях — частина сторінки: прокручується разом із нею, а не висить під шапкою весь час
  return slot ? createPortal(<InPage.Provider value>{node}</InPage.Provider>, slot) : <>{node}</>
}

/** шлях стоїть усередині сторінки (на телефоні) — інші відступи */
const InPage = createContext(false)
const phone = typeof matchMedia === 'function' ? matchMedia('(max-width: 767px)') : null

/**
 * місце для шляху на початку прокрутки відкритої сторінки (лише на телефоні й лише в сторінок, що прокручуються цілком:
 * у мапи, редактора чи планувальника своєї прокрутки нема — там шлях лишається під шапкою). Сторінку на екрані міняє App
 * (і вона домальовується пізніше) — тож стежимо за <main>
 */
/** прокрутка всієї сторінки: перший блок сторінки або (як в умінь) вкладений блок, що починається вгорі й займає більшу
 *  частину висоти; висувні панелі (fixed) й дрібні списки — ні */
function pageScroller(front: HTMLElement, main: HTMLElement): HTMLElement | null {
  const top = main.getBoundingClientRect().top
  const big = main.clientHeight * 0.5
  let level: Element[] = [...front.children]
  for (let depth = 0; depth < 4 && level.length; depth++) {
    for (const el of level as HTMLElement[]) {
      const st = getComputedStyle(el)
      if (st.position === 'fixed') continue
      if (/(auto|scroll)/.test(st.overflowY) && el.clientHeight >= big && Math.abs(el.getBoundingClientRect().top - top) < 8) return el
    }
    level = level.flatMap((el) => (getComputedStyle(el).position === 'fixed' ? [] : [...el.children]))
  }
  return null
}

function usePageSlot(on: boolean) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const main = document.getElementById('main')
    if (!main) return
    if (!on) { main.querySelectorAll('[data-crumbs]').forEach((x) => x.remove()); setSlot(null); return }
    let raf = 0
    const find = () => {
      raf = 0
      let host: HTMLElement | null = null
      const front = [...main.children].find((c) => !c.hasAttribute('aria-hidden')) as HTMLElement | undefined
      const box = front && phone?.matches ? pageScroller(front, main) : null
      if (box) {
        host = box.firstElementChild?.hasAttribute('data-crumbs') ? (box.firstElementChild as HTMLElement) : null
        if (!host) { host = document.createElement('div'); host.setAttribute('data-crumbs', ''); box.prepend(host) }
      }
      // давнє місце (інша сторінка, ширший екран) — геть
      for (const old of main.querySelectorAll('[data-crumbs]')) if (old !== host) old.remove()
      setSlot((cur) => (cur === host ? cur : host))
    }
    const later = () => { if (!raf) raf = requestAnimationFrame(find) }
    const mo = new MutationObserver(later)
    mo.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-hidden', 'class'] })
    phone?.addEventListener('change', later)
    find()
    return () => { mo.disconnect(); phone?.removeEventListener('change', later); cancelAnimationFrame(raf) }
  }, [on])
  return slot
}

function useCrumbsNow() {
  const view = useStore((s) => s.view)
  const base = useStore((s) => s.base)
  const param = useStore((s) => s.param)
  const cur = useStore((s) => s.sub)
  const setView = useStore((s) => s.setView)
  const tail = useTail((s) => s.tail)
  const at = useTail((s) => s.at)
  const sub = useTail((s) => s.sub)
  const value = useTail((s) => s.value)
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const make = CRUMBS[view]
  if (!make) return null
  // шлях ще не відомий: вхід не перевірено, сторінка вантажиться — місце тримаємо, але порожнє
  if (!ready || at === null || (needsPage(view, base, param) && at !== `${view}|${base ?? ''}|${param ?? ''}`)) return <Shell hidden><li className="flex items-center"><span className="grid h-6 w-6" /></li></Shell>
  const head = make()
  // свій профіль перед налаштуваннями
  if (view === 'account' && user) head.unshift({ label: user.name, view: 'user', param: user.login })
  // розділ (остання ланка початку шляху) — на підсторінку, яку назвала сторінка
  if (head.length && (sub !== undefined || value)) head[head.length - 1] = { ...head[head.length - 1], ...(sub !== undefined ? { sub } : {}), ...(value ? { value } : {}) }
  // розділ із вкладками без своєї вкладки — «Мої», без входу — «Публічні»; вкладка — значком
  const scoped = (c: Crumb): Crumb => {
    if (!c.view || !SCOPED.includes(c.view) || c.base) return c
    // свій же список — відкрита вкладка (з адреси); інакше «Мої», без входу — «Публічні»
    const s = c.sub !== undefined ? c.sub : !user ? 'public' : c.view === view && cur ? cur : null
    return { ...c, sub: s, value: c.value ?? SCOPE_LABEL()[s ?? 'mine'] }
  }
  // ланки сторінки йдуть після головної й початку шляху; їхні переходи — найсвіжіші (useTail.go)
  const n = 1 + head.length
  const all: Crumb[] = ([{ label: t('Головна'), view: 'home' }, ...head, ...tail] as Crumb[]).map(scoped)
  const chip = (c: Crumb) => c.value && <span className="shrink-0 rounded-md border border-line bg-panel2/70 px-1.5 py-px text-[11.5px] font-medium text-muted">{c.value}</span>
  return (
    <Shell>
        {all.map((c, i) => {
          const last = i === all.length - 1
          const href = hrefOf(c)
          return (
            // не влазять в рядок — переносяться на наступний (не налазять одна на одну й не ховаються за прокруткою); задовга
            // ланка обрізається трьома крапками лише тоді, коли не влазить і в цілий рядок
            <li key={i} className={cn('flex min-w-0 max-w-full items-center gap-1', !last && 'shrink-0')}>
              {i > 0 && <ChevronRight size={13} className="shrink-0 opacity-60" aria-hidden />}
              {last || !href ? (
                <span aria-current={last ? 'page' : undefined} className={cn('inline-flex min-w-0 items-center gap-1.5', last ? 'text-muted' : 'text-ink/80')}><span className="truncate">{c.label}</span>{chip(c)}</span>
              ) : i === 0 ? (
                // головна — лише будиночок (назва — для читачів екрана й підказкою)
                <a href={href} aria-label={c.label} title={c.label} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('home') }} className="grid h-6 w-6 place-items-center rounded-md text-ink hover:bg-ink/10 hover:text-spice">
                  <Home size={14} aria-hidden />
                </a>
              ) : (
                // ланка — помітне посилання (не схоже на текст): колір тексту, підкреслення при наведенні
                <a
                  href={href}
                  onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); if (c.go) useTail.getState().go[i - n]?.(); else if (c.path) { openPath(c.path); dispatchEvent(new PopStateEvent('popstate')) } else setView(c.view!, { base: c.base ?? null, param: c.param ?? null, sub: c.sub ?? null, search: c.search }) }}
                  className="group inline-flex min-w-0 items-center gap-1.5 rounded font-medium text-ink underline-offset-[3px] hover:text-spice"
                >
                  <span className="truncate group-hover:underline">{c.label}</span>
                  {chip(c)}
                </a>
              )}
            </li>
          )
        })}
    </Shell>
  )
}

/** рамка шляху; hidden — те саме місце порожнім (шлях ще не відомий), щоб сторінка не стрибала */
function Shell({ hidden, children }: { hidden?: boolean; children: React.ReactNode }) {
  // у сторінці (телефон) — уже всередині відступів <main>
  const inPage = useContext(InPage)
  return (
    <nav aria-label={hidden ? undefined : t('Де ти на сайті')} aria-hidden={hidden || undefined} className={cn('shrink-0 pb-1.5', inPage ? 'px-1' : 'px-2.5 sm:px-4', hidden && 'invisible')}>
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 whitespace-nowrap text-[12.5px] text-muted">
        {children}
      </ol>
    </nav>
  )
}

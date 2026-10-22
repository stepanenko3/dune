/**
 * Стан застосунку: який розділ відкрито. Роутера немає — як у Satisfactory, розділ живе
 * в zustand, а адреса лише віддзеркалює його через History API:
 *   / — головна, /bases — список баз, /bases/<id> — база, /bases/<id>/edit — редактор бази, /bases/generate — генератор
 *   баз, /roadmap — роадмапи,
 *   /roadmap/<id> — роадмап, /map — мапа, /catalog/<розділ>/<id> — довідник (розділ і запис він читає з адреси сам),
 *   /skills?b=… — планувальник умінь, /builds — збережені білди, /calcs — збережені розрахунки, /library — бібліотека,
 *   підсторінки — сегментом шляху, а не параметром (sub): вкладка списку /bases/public, /roadmap/guild, /builds/public,
 *   /calcs/public (mine — без сегмента), вкладка гільдії /g/<адреса>/items (головна гільдії — без сегмента); давні ?show=,
 *   ?kind=, ?tab= — переписуються на них; /guilds/open — гільдії, що приймають заявки. У параметрах лишаються фільтри й дані (пошук, порядок, код білду, цілі), /login — вхід поштою (давні /register і /reset — туди ж), /me — налаштування профілю,
 *   /u/<логін> — людина, /u/<логін>/settings — налаштування свого профілю (давнє /me — туди ж), /guilds — гільдії, /g/<адреса> — гільдія, /invite/<код> — запрошення, /admin/<розділ> — панель,
 *   /events — події спільноти (вкладки /events/mine, /events/guild, /events/past), /events/new — нова, /events/<id> — подія, /events/<id>/edit — редагування.
 */
import { createContext, useContext } from 'react'
import { create } from 'zustand'

export type View =
  | 'home' | 'bases' | 'roadmap' | 'map' | 'catalog' | 'calculator' | 'skills' | 'builds' | 'calcs'
  | 'library' | 'login' | 'account' | 'user' | 'guilds' | 'guild' | 'invite' | 'admin' | 'data' | 'events' | 'notfound'

/** вкладки списків (сегмент після розділу); «мої» — без сегмента */
export const SCOPES = ['mine', 'guild', 'public'] as const
export const GUILD_TABS = ['home', 'members', 'items', 'events', 'requests', 'invites', 'settings'] as const
/** вкладки подій (сегмент після /events); «найближчі» — без сегмента */
export const EVENT_TABS = ['mine', 'guild', 'past'] as const

export function pathOf(v: View, base?: string | null, edit?: boolean, param?: string | null, sub?: string | null): string {
  const p = param ? encodeURIComponent(param) : ''
  // підсторінка за замовчуванням (мої, бази в бібліотеці, головна гільдії) — без сегмента
  const tail = sub && sub !== 'mine' && !(v === 'library' && sub === 'base') && !(v === 'guild' && sub === 'home') ? `/${sub}` : ''
  switch (v) {
    case 'home': return '/'
    case 'bases': return base ? `/bases/${base}${edit ? '/edit' : ''}` : param === 'generate' ? '/bases/generate' : `/bases${tail}`
    case 'roadmap': return p ? `/roadmap/${p}` : `/roadmap${tail}`
    case 'builds': return `/builds${tail}`
    case 'calcs': return `/calcs${tail}`
    case 'library': return `/library${tail}`
    case 'guilds': return `/guilds${tail}`
    case 'skills': return `/skills${sub ? `/${sub}` : ''}`
    case 'login': return param === 'register' ? '/register' : param === 'reset' ? '/reset' : '/login'
    // налаштування — підсторінка свого профілю: /u/<логін>/settings (логін ще не відомий — /me, сторінка сама виправить)
    case 'account': return p ? `/u/${p}/settings` : '/me'
    case 'user': return `/u/${p}`
    case 'guild': return `/g/${p}${tail}`
    case 'invite': return `/invite/${p}`
    // подія — param (id чи «new»), редагування — sub «edit»; список — вкладка сегментом
    case 'events': return p ? `/events/${p}${sub === 'edit' && param !== 'new' ? '/edit' : ''}` : `/events${sub && (EVENT_TABS as readonly string[]).includes(sub) ? `/${sub}` : ''}`
    // у панелі param — увесь шлях після /admin/ («users», «users/u12…», «game-items/new»), уже закодований
    case 'admin': return param ? `/admin/${param}` : '/admin'
    // невідома адреса лишається такою, як її ввели (сторінка каже «не знайдено»)
    case 'notfound': return param || '/'
    default: return '/' + v
  }
}

type Loc = { view: View; base: string | null; edit: boolean; param: string | null; sub: string | null }
const isScope = (x: string | null | undefined): x is string => !!x && (SCOPES as readonly string[]).includes(x)
export function fromLocation(): Loc {
  const [, seg, sub, act] = location.pathname.split('/')
  const q = new URLSearchParams(location.search)
  const at = (view: View, param: string | null = null, s: string | null = null): Loc => ({ view, base: null, edit: false, param, sub: s })
  let dec = ''
  try { dec = sub ? decodeURIComponent(sub) : '' } catch { /* зіпсована адреса */ }
  const word = /^[\w.-]{1,64}$/.test(dec) ? dec : null
  // давні ?show= (вкладка списку) — як сегмент
  const scope = isScope(word) ? word : isScope(q.get('show')) ? q.get('show') : null
  if (seg === 'roadmap') return isScope(word) || !word ? at('roadmap', null, scope) : at('roadmap', word)
  if (seg === 'builds' || seg === 'calcs') return at(seg, null, scope)
  if (seg === 'library') {
    // бібліотека — сторінка-розгалуження; давні /library/<вид> і ?kind= — на «Публічні» самого розділу
    const k = word ?? q.get('kind')
    const to: Record<string, View> = { base: 'bases', build: 'builds', roadmap: 'roadmap', calc: 'calcs' }
    return k && to[k] ? at(to[k], null, 'public') : at('library')
  }
  if (seg === 'guilds') return at('guilds', null, word === 'open' || q.get('show') === 'open' ? 'open' : null)
  // уміння: вкладка-школа сегментом (/skills/mentat); перевіряє сама сторінка
  if (seg === 'skills') return at('skills', null, word)
  if (seg === 'map' || seg === 'catalog' || seg === 'calculator') return at(seg)
  // «Оновлення даних»: звідки дані гри і що в них змінилось
  if (seg === 'data') return at('data')
  if (seg === 'login' || seg === 'register' || seg === 'reset') return at('login', seg === 'login' ? null : seg)
  if (seg === 'me' || seg === 'account') return at('account')
  if (seg === 'u' && word) return act === 'settings' ? at('account', word) : at('user', word)
  if (seg === 'g' && word) {
    const tab = act ?? q.get('tab')
    return at('guild', word, tab && (GUILD_TABS as readonly string[]).includes(tab) ? tab : null)
  }
  if (seg === 'invite' && word) return at('invite', word)
  if (seg === 'events') {
    if (!word) return at('events')
    if ((EVENT_TABS as readonly string[]).includes(word)) return at('events', null, word)
    return at('events', word, act === 'edit' && word !== 'new' ? 'edit' : null)
  }
  if (seg === 'admin') return at('admin', location.pathname.split('/').slice(2).filter(Boolean).join('/') || null)
  if (seg === 'plan') return at('roadmap') // стара адреса «Плану розвитку»
  if (seg === 'bases') {
    if (isScope(sub) || !sub) return { view: 'bases', base: null, edit: false, param: null, sub: scope }
    // генератор баз — своя сторінка розділу (id баз завжди з випадковим хвостом, тож з ним не збігаються)
    if (sub === 'generate') return { view: 'bases', base: null, edit: false, param: 'generate', sub: null }
    const base = /^[\w-]+$/.test(sub) ? sub : null
    return { view: 'bases', base, edit: !!base && act === 'edit', param: null, sub: null }
  }
  // старі адреси: /dd і однофайлова сторінка index.html#dd, #plan, #res
  if (seg === 'dd') return { view: 'bases', base: 'dd', edit: false, param: null, sub: null }
  const hash = location.hash.replace('#', '')
  if (hash === 'dd') return { view: 'bases', base: 'dd', edit: false, param: null, sub: null }
  if (hash === 'plan') return at('roadmap')
  if (hash === 'res') return at('map')
  // головна — лише «/»; інша невідома адреса — «не знайдено» (а не мовчки головна)
  if (seg || location.pathname.length > 1) return at('notfound', location.pathname)
  return at('home')
}

interface S {
  view: View
  /** відкрита база в розділі «Бази»; null — список */
  base: string | null
  /** база відкрита в редакторі */
  edit: boolean
  /** що саме в розділі: роадмап, логін людини, адреса гільдії, код запрошення, розділ панелі, режим входу */
  param: string | null
  /** підсторінка розділу (сегмент шляху): вкладка списку, вид бібліотеки, вкладка гільдії */
  sub: string | null
  /** відкритий лист на вузькому екрані (панель мапи, бокова колонка бази) */
  sheet: string | null
  setView: (v: View, opts?: { replace?: boolean; search?: string; base?: string | null; edit?: boolean; param?: string | null; sub?: string | null }) => void
  setSheet: (s: string | null) => void
}

/**
 * Перехід на іншу сторінку (не вкладку тієї самої), поки є незбережені зміни (components/UnsavedBar), — не пускає:
 * guard повертає false (і смуга незбережених змін «трусить»). Так само й «Назад» / «Вперед» у браузері.
 */
let leaveGuard: (() => boolean) | null = null
let free = false
export const setLeaveGuard = (fn: typeof leaveGuard) => { leaveGuard = fn }
/** перейти без перевірки: щойно збережено, а смуга ще не встигла сховатись (напр. новий запис у панелі) */
export function leaveFreely(go: () => void) { free = true; try { go() } finally { free = false } }
const blocked = () => !free && !!leaveGuard && !leaveGuard()
/** редагування події — окрема сторінка (вкладка sub «edit»): піти з неї — як піти зі сторінки */
const editsEvent = (v: View, sub: string | null) => v === 'events' && sub === 'edit'

const store = create<S>((set, get) => ({
  ...fromLocation(),
  sheet: null,
  setView: (view, opts) => {
    const base = view === 'bases' ? opts?.base ?? null : null
    const edit = !!base && !!opts?.edit
    const param = opts?.param ?? null
    const sub = opts?.sub ?? null
    const cur = get()
    const away = cur.view !== view || cur.base !== base || cur.edit !== edit || cur.param !== param || editsEvent(cur.view, cur.sub) !== editsEvent(view, sub)
    if (away && blocked()) return
    const url = pathOf(view, base, edit, param, sub) + (opts?.search ?? '')
    if (location.pathname + location.search !== url) {
      saveScroll()
      history[opts?.replace ? 'replaceState' : 'pushState'](opts?.replace ? history.state : { k: newKey() }, '', url)
    }
    set({ view, base, edit, param, sub, sheet: null })
  },
  setSheet: (sheet) => set({ sheet }),
}))

/** адреса сторінки: розділ, база, редактор, параметр, підсторінка */
export type Route = Pick<S, 'view' | 'base' | 'edit' | 'param' | 'sub'>
/**
 * Попередня сторінка, що ще лишається на екрані, поки наступна вантажиться (App): вона бачить свою адресу, а не нову —
 * інакше перемалювалась би під чужу адресу (чи й перейшла б назад). Нова сторінка й решта сайту — справжній стан.
 */
export const FrozenRoute = createContext<Route | null>(null)
function useStoreHook<T>(sel: (s: S) => T): T {
  const frozen = useContext(FrozenRoute)
  const live = store(sel)
  return frozen ? sel({ ...store.getState(), ...frozen }) : live
}
export const useStore = Object.assign(useStoreHook, { getState: store.getState, setState: store.setState, subscribe: store.subscribe })

// остання адреса сторінки (з усіма replaceState сторінок — код білду, цілі калькулятора): куди повернутись, якщо
// «Назад» не пустили
let lastUrl = location.pathname + location.search + location.hash
let lastState: unknown = history.state
const remember = () => { lastUrl = location.pathname + location.search + location.hash; lastState = history.state }
for (const m of ['pushState', 'replaceState'] as const) {
  const orig = history[m].bind(history)
  history[m] = (data: unknown, unused: string, url?: string | URL | null) => { orig(data, unused, url); remember() }
}

// стара адреса — одразу на нову, щоб посилання й «назад» працювали однаково
{
  const s = useStore.getState()
  // давні параметри підсторінок (?show=, ?kind=, ?tab=) — уже в сегменті, з адреси геть
  const rest = new URLSearchParams(location.search)
  const moved: Partial<Record<View, string>> = { bases: 'show', roadmap: 'show', builds: 'show', calcs: 'show', library: 'kind', guild: 'tab', guilds: 'show' }
  if (moved[s.view]) rest.delete(moved[s.view]!)
  if (location.pathname.startsWith('/library')) rest.delete('kind')
  const qs = rest.toString() ? `?${rest}` : ''
  const url = s.view === 'catalog' ? location.pathname + location.search : pathOf(s.view, s.base, s.edit, s.param, s.sub) + (s.view === 'home' ? '' : qs)
  if (location.pathname + location.search !== url || location.hash) history.replaceState(null, '', url)
}

// ---------- прокрутка на «Назад» ----------
// у кожної сторінки свій прокручуваний контейнер; його положення пам'ятаємо за записом історії й повертаємо на «Назад»
// (список ще може довантажуватися — пробуємо кілька кадрів, поки висоти не вистачить)
const scrolls = new Map<string, number>()
let seq = 0
function newKey() { return `${Date.now().toString(36)}-${++seq}` }
const keyOf = () => (history.state as { k?: string } | null)?.k ?? ''
// поточна сторінка (поки попередня ще на екрані — та, що вантажиться: їй і повертаємо прокрутку)
const scroller = () => document.querySelector<HTMLElement>('main [data-current] .overflow-y-auto, main [data-current] [data-scroll]') ?? document.querySelector<HTMLElement>('main .overflow-y-auto, main [data-scroll]')
function saveScroll() { const el = scroller(); if (el && keyOf()) scrolls.set(keyOf(), el.scrollTop) }
function restoreScroll() {
  const want = scrolls.get(keyOf()) ?? 0
  let tries = 0
  const step = () => {
    const el = scroller()
    if (el && (el.scrollHeight - el.clientHeight >= want || tries > 30)) { el.scrollTop = want; return }
    if (++tries <= 30) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}
if (!keyOf()) history.replaceState({ ...(history.state || {}), k: newKey() }, '')
window.addEventListener('popstate', (e) => {
  // «Назад» / «Вперед» на іншу сторінку, поки є незбережене, — повертаємо адресу, з якої пішли (новим кроком; самі
  // сторінки цієї події вже не бачать)
  const next = fromLocation(), cur = useStore.getState()
  if ((next.view !== cur.view || next.base !== cur.base || next.edit !== cur.edit || next.param !== cur.param || editsEvent(next.view, next.sub) !== editsEvent(cur.view, cur.sub)) && blocked()) {
    e.stopImmediatePropagation()
    history.pushState(lastState, '', lastUrl)
    return
  }
  remember()
  useStore.setState({ ...next, sheet: null })
  restoreScroll()
})
/** перейти на адресу цього сайту без перезавантаження (посилання з тексту, пункти меню, «Увійти»); чужу — звичайно */
export function openPath(url: string, replace = false) {
  if (!/^\/(?![/\\])/.test(url)) { location.assign(url); return }
  if (location.pathname + location.search === url) return
  if (location.pathname !== url.split('?')[0] && blocked()) return
  saveScroll()
  history[replace ? 'replaceState' : 'pushState']({ k: newKey() }, '', url)
  useStore.setState({ ...fromLocation(), sheet: null })
}
// перед переходом за звичайним посиланням (pushState з інших місць) — теж запам'ятати
window.addEventListener('pagehide', saveScroll)

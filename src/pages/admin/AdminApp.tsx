/**
 * Панель керування сайтом (як Filament): огляд, список кожної таблиці, картка запису з пов'язаними записами й історією
 * змін, налаштування. Сторінка прокручується вся (смуга прокрутки — край сторінки, як на решті сайту), меню розділів
 * — плаваючий блок, що стоїть на місці (sticky) і гортається сам, без своєї смуги. Над заголовком — крихти; на телефоні
 * поруч із ними — кнопка меню. Адреси: /admin — огляд, /admin/<розділ> — список, /admin/<розділ>/new — новий запис,
 * /admin/<розділ>/<id> — запис, /admin/site-settings — налаштування, /admin/group/<група> — розділи групи (куди веде група
 * в крихтах і в меню). Крихти починаються з головної сайту, кожна ланка, крім останньої, — посилання. Доступ — ролі з дозволом «admin».
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell, BrickWall, Calculator, Castle, Database, Factory, FlaskConical, Gem, GitCompare, History, Inbox, KeyRound, Languages, LayoutDashboard, Library, ListChecks,
  MapPin, Megaphone, Menu, MonitorSmartphone, Package, Route, ScrollText, Settings, Shield, ShieldCheck, SlidersHorizontal, Sparkles, Star, Swords,
  Ticket, Timer, UserRoundCheck, Users, ArrowLeft, Home, type LucideIcon, Fingerprint } from 'lucide-react'
import { SnBreadcrumb, SnBreadcrumbItem, SnBreadcrumbLink, SnBreadcrumbList, SnBreadcrumbPage, SnBreadcrumbSeparator, SnSheet } from '@/components/sn'
import '@/components/sn/admin'
import { Loading, PageError } from '@/components/states'
import { useAuth, loginHref } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { plainClick } from '@/lib/urlState'
import { adminHref, adminLink, hasPerm, useAdmin, type Resource } from './api'
import { ActionHost } from './actions'
import { Dashboard } from './Dashboard'
import { ResourceList } from './ResourceList'
import { ResourceForm } from './ResourceForm'
import { SiteSettings } from './SiteSettings'
import { GameDataAdmin } from './GameDataAdmin'
import { AdminSearch } from './Search'
import { Translations } from './Translations'
import { PageHeader } from './ui'

const ICONS: Record<string, LucideIcon> = {
  users: Users, fingerprint: Fingerprint, 'monitor-smartphone': MonitorSmartphone, 'key-round': KeyRound, shield: Shield, 'shield-check': ShieldCheck, 'user-round-check': UserRoundCheck,
  ticket: Ticket, inbox: Inbox, library: Library, castle: Castle, route: Route, swords: Swords, 'map-pin': MapPin, gem: Gem, history: History, star: Star,
  package: Package, factory: Factory, 'flask-conical': FlaskConical, 'brick-wall': BrickWall, sparkles: Sparkles, languages: Languages, megaphone: Megaphone,
  calculator: Calculator, settings: Settings, 'scroll-text': ScrollText, bell: Bell, database: Database, 'git-compare': GitCompare, timer: Timer, 'list-checks': ListChecks,
}
const GROUPS = ['Люди', 'Гільдії', 'Вміст', 'Гра', 'Сайт']
/** група в адресі (/admin/group/people) — словом, однаковим усіма мовами */
const GROUP_SLUG: Record<string, string> = { 'Люди': 'people', 'Гільдії': 'guilds', 'Вміст': 'content', 'Гра': 'game', 'Сайт': 'site' }
const groupBySlug = (slug: string | undefined) => GROUPS.find((g) => GROUP_SLUG[g] === slug) ?? null
const block = 'rounded-xl border border-line bg-panel shadow-lg'

/** пункт меню: поточний — кольором спайсу на легкому тлі (як розділ у шапці сайту), без тіні */
function NavLink({ to, label, icon: Icon, active, onGo }: { to: string[]; label: string; icon: LucideIcon; active: boolean; onGo?: () => void }) {
  return (
    <a
      href={adminHref(to)}
      onClick={(e) => { adminLink(to)(e); onGo?.() }}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13.5px] transition-colors',
        active ? 'bg-spice/10 font-semibold text-spice' : 'text-ink/85 hover:bg-panel2 hover:text-ink',
      )}
    >
      <Icon size={16} className={cn('shrink-0', active ? 'text-spice' : 'text-muted')} />
      <span className="truncate">{label}</span>
    </a>
  )
}

/** меню розділів (у бічному блоці на широкому екрані, у висувній панелі — на телефоні) */
function Nav({ section, onGo }: { section: string | undefined; onGo?: () => void }) {
  const meta = useAdmin((s) => s.meta)
  const perms = useMemo(() => new Set(meta?.permissions ?? []), [meta])
  const groups = useMemo(() => GROUPS.map((g) => ({ g, list: (meta?.resources ?? []).filter((x) => x.group === g) })).filter((x) => x.list.length), [meta])
  // відкритий розділ — завжди видно в меню (довгий список гортається сам)
  const box = useRef<HTMLElement>(null)
  useEffect(() => { box.current?.querySelector('a[aria-current="page"]')?.scrollIntoView({ block: 'nearest' }) }, [section])
  return (
    <nav ref={box} className="grid gap-4 p-2" aria-label={t('Розділи панелі')}>
      <div className="grid gap-0.5">
        <NavLink to={[]} label={t('Огляд')} icon={LayoutDashboard} active={!section} onGo={onGo} />
        {(hasPerm(perms, 'site.settings') || hasPerm(perms, 'site.decree')) && <NavLink to={['site-settings']} label={t('Налаштування сайту')} icon={Settings} active={section === 'site-settings'} onGo={onGo} />}
        {hasPerm(perms, 'gamedata.manage') && <NavLink to={['gamedata']} label={t('Дані гри')} icon={Database} active={section === 'gamedata'} onGo={onGo} />}
      </div>
      {groups.map(({ g, list }) => (
        <div key={g} className="grid gap-0.5">
          {/* назва групи — посилання на її сторінку (усі розділи групи картками) */}
          <a href={adminHref(['group', GROUP_SLUG[g]])} onClick={(e) => { adminLink(['group', GROUP_SLUG[g]])(e); onGo?.() }} className="px-2.5 pb-1 text-[11.5px] font-medium text-muted hover:text-ink">{t(g)}</a>
          {list.map((x) => <NavLink key={x.name} to={[x.name]} label={t(x.label)} icon={ICONS[x.icon] ?? Database} active={section === x.name} onGo={onGo} />)}
        </div>
      ))}
    </nav>
  )
}

/** крихти над заголовком сторінки: панель › група › розділ › запис (посилання — без перезавантаження) */
function Crumbs({ items, onMenu }: { items: { label: string; to?: string[] }[]; onMenu: () => void }) {
  return (
    <div className="flex min-h-8 items-center gap-2">
      <button type="button" onClick={onMenu} className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel2 hover:text-ink lg:hidden" aria-label={t('Розділи панелі')}><Menu size={17} /></button>
      <SnBreadcrumb className="min-w-0" accessibilityLabel={t('Де ти в панелі')}>
        <SnBreadcrumbList>
          {/* як на решті сайту: шлях — від головної (будиночком) */}
          <SnBreadcrumbItem>
            <SnBreadcrumbLink href="/" onClick={(e: React.MouseEvent) => { if (!plainClick(e)) return; e.preventDefault(); useStore.getState().setView('home') }} aria-label={t('Головна')} title={t('Головна')}>
              <Home size={14} className="translate-y-px" aria-hidden />
            </SnBreadcrumbLink>
          </SnBreadcrumbItem>
          {items.map((c, i) => (
            <SnBreadcrumbItem key={i}>
              <SnBreadcrumbSeparator />
              {i === items.length - 1
                ? <SnBreadcrumbPage>{c.label}</SnBreadcrumbPage>
                : c.to ? <SnBreadcrumbLink href={adminHref(c.to)} onClick={adminLink(c.to)}>{c.label}</SnBreadcrumbLink> : <span>{c.label}</span>}
            </SnBreadcrumbItem>
          ))}
        </SnBreadcrumbList>
      </SnBreadcrumb>
    </div>
  )
}

/** група панелі: її розділи картками (значок, назва, що в ньому) */
function GroupPage({ group, list }: { group: string | null; list: Resource[] }) {
  if (!group || !list.length) return <PageError title={t('Немає такого розділу')} message={t('Можливо, у твоєї ролі нема до нього доступу.')} />
  return (
    <div className="grid gap-4">
      <PageHeader title={t(group)} />
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((x) => {
          const I = ICONS[x.icon] ?? Database
          return (
            <li key={x.name}>
              <a href={adminHref([x.name])} onClick={adminLink([x.name])} className="group flex h-full items-start gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sm transition-colors hover:border-spice/50">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-spice/10 text-spice"><I size={17} /></span>
                <span className="min-w-0">
                  <span className="block font-semibold group-hover:text-spice">{t(x.label)}</span>
                  {x.about && <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{t(x.about)}</span>}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function AdminApp() {
  const { user, ready } = useAuth()
  const param = useStore((s) => s.param)
  // окремими виборками: назва запису (title) змінюється частіше, ніж усе інше
  const meta = useAdmin((s) => s.meta), error = useAdmin((s) => s.error), load = useAdmin((s) => s.load), title = useAdmin((s) => s.title)
  const [menu, setMenu] = useState(false)
  useEffect(() => { if (user && !meta && !error) void load() }, [user, meta, error, load])
  useEffect(() => { if (ready && !user) location.replace(loginHref()) }, [ready, user])
  useEffect(() => { setMenu(false) }, [param])

  const parts = (param || '').split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p) } catch { return p } })
  const [section, sub] = parts
  const r: Resource | null = meta?.resources.find((x) => x.name === section) ?? null

  if (!ready || (user && !meta && !error)) return <Loading page label={t('Завантаження панелі…')} />
  if (error) return <PageError page title={t('Панель керування недоступна')} message={error} onRetry={() => { useAdmin.setState({ error: '' }); void load() }} />
  if (!user || !meta) return null

  let page
  if (!section) page = <Dashboard />
  else if (section === 'site-settings') page = <SiteSettings />
  else if (section === 'gamedata') page = <GameDataAdmin />
  else if (section === 'group') page = <GroupPage group={groupBySlug(sub)} list={(meta.resources ?? []).filter((x) => x.group === groupBySlug(sub))} />
  else if (!r) page = <PageError title={t('Немає такого розділу')} message={t('Можливо, у твоєї ролі нема до нього доступу.')} />
  else if (!sub) page = r.page === 'translations' ? <Translations r={r} /> : <ResourceList key={r.name} r={r} />
  else page = <ResourceForm key={`${r.name}/${sub}`} r={r} id={sub === 'new' ? null : sub} />

  const crumbs: { label: string; to?: string[] }[] = [{ label: t('Панель керування'), to: [] }]
  if (section === 'site-settings') crumbs.push({ label: t('Налаштування сайту') })
  else if (section === 'gamedata') crumbs.push({ label: t('Дані гри') })
  else if (section === 'group') crumbs.push({ label: groupBySlug(sub) ? t(groupBySlug(sub)!) : t('Немає такого розділу') })
  else if (r) {
    // група — на свою сторінку; та, що зветься так само, як розділ («Люди › Люди»), — зайва
    if (t(r.group) !== t(r.label)) crumbs.push({ label: t(r.group), to: ['group', GROUP_SLUG[r.group] ?? ''] })
    crumbs.push({ label: t(r.label), to: [r.name] })
    if (sub) crumbs.push({ label: sub === 'new' ? t('Новий запис') : title || '…' })
  }

  return (
    // одна прокрутка на всю сторінку; container-type — щоб меню знало висоту видимої області (100cqh)
    <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden [container-type:size]">
      <div className="flex items-start gap-1.5 sm:gap-2.5">
        <aside className={`${block} sticky top-0 hidden h-[100cqh] w-[248px] shrink-0 flex-col overflow-hidden lg:flex`} aria-label={t('Розділи панелі')}>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3.5">
            <SlidersHorizontal size={17} className="shrink-0 text-spice" />
            <span className="truncate font-display text-[13.5px] font-bold">{t('Панель керування')}</span>
          </div>
          <div className="shrink-0 px-2 pt-2"><AdminSearch hotkey /></div>
          <div className="relative min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"><Nav section={section} /></div>
          <a href="/" className="flex h-11 shrink-0 items-center gap-2 border-t border-line px-4 text-[13px] text-muted hover:text-ink"><ArrowLeft size={15} />{t('На сайт')}</a>
        </aside>
        <main className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5 pb-6">
          <Crumbs items={crumbs} onMenu={() => setMenu(true)} />
          <div className="min-w-0">{page}</div>
        </main>
      </div>
      <SnSheet side="left" open={menu} title={t('Панель керування')} onOpenChange={(e: CustomEvent<{ open: boolean }>) => setMenu(e.detail.open)}>
        {menu && <><div className="px-2 pt-2"><AdminSearch /></div><Nav section={section} onGo={() => setMenu(false)} /></>}
      </SnSheet>
      <ActionHost />
    </div>
  )
}

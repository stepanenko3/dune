/**
 * Довідник гри — як «Справочник» у Satisfactory: розділи вкладками, підкатегорії й тіри фільтрами,
 * сітка плиток з іконками, праворуч картка: як отримати (станція, час, інгредієнти), де
 * використовується, у яких будівельних наборах, і пошук предмета в луті на мапі.
 *
 * Адреса: /catalog/<розділ>/<id>?q=…&g=…&tier=…&by=tier — розділ, запис, пошук, група, тір і групування живуть в
 * адресі, тож посиланням можна поділитися, а «назад» у браузері повертає попередній предмет. /catalog без розділу —
 * головна довідника: розділи картками (скільки записів і кілька іконок), пошук по всьому довіднику. Група (?g=) — ключем,
 * однаковим усіма мовами (RawResources, sandbike, production…), підпис — мовою сайту.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Calculator, Droplet, Hammer, MapPin, SearchX, Timer } from 'lucide-react'
import {
  buildName, fmtTime, groupLabel, iconUrl, kindLabel, kindOf, loadCatalog, nameOf, rarityLabel, SECTIONS, sectionOfItem, setLabel, subLabel,
  tierLabel, VEHICLE_KEYS, vehicleKey, vehicleLabel, wikiImg,
  type CatalogIndex, type CBuild, type CItem, type CPlace, type CRecipe, type SectionId,
} from '@/lib/catalog'
import { useStore } from '@/store'
import { cn, fmtN, fmtP, plural } from '@/lib/utils'
import { plainClick } from '@/lib/urlState'
import { locale, t } from '@/lib/i18n'
import { SnInput, valueOf } from '@/components/sn'
import { prefGet, prefSet } from '@/lib/prefs'
import { useDecree } from '@/lib/decree'
import { buildOfPlace, Icon, Ref } from '@/components/catalog/bits'
import { buildKey, decreeFx, encodeTargets, inputQty, waterQty, type Target } from '@/lib/calc'
import { SHEET_BASE, SheetBackdrop, SheetHead } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Seg } from '@/components/ui/seg'
import { IN_ROW, ScrollRow } from '@/components/catalog/ScrollRow'
import { PageHeader } from '@/components/PageHeader'
import { DataStamp } from '@/components/DataStamp'
import { Empty, Loading, PageError } from '@/components/states'
import { useCrumb } from '@/components/Crumbs'

type Entry =
  | { t: 'item'; x: CItem }
  | { t: 'place'; x: CPlace }
  | { t: 'build'; x: CBuild }

const keyOf = (e: Entry) => e.x.id
const entryName = (e: Entry) => (e.t === 'build' ? buildName(e.x) : nameOf(e.x))
const entryIcon = (e: Entry) => (e.t === 'build' ? wikiImg(e.x.img) : iconUrl(e.x.icon))
/** група пристрою — ключ (для адреси) і підпис */
const PLACE_KEY = (cat: string) =>
  /fabricator|refiner|deathstill|centrifuge|press|repair|research/.test(cat) ? 'production'
  : /generator|turbine|windtrap|cistern|water|power|solar/.test(cat) ? 'power'
  : /storage|container|chest/.test(cat) ? 'storage'
  : /deco|glowglobe|chair|furniture|table|carpet|banner|projector|door/.test(cat) ? 'decor'
  : /^(buggy|sandbike|treadwheel|ornithopter|tank|sandcrawler)/.test(cat) ? 'vehicle'
  : 'other'
const PLACE_LABEL: Record<string, string> = { production: t('Виробництво'), power: t('Енергія й вода'), storage: t('Зберігання'), decor: t('Декор і меблі'), vehicle: t('Частини техніки'), other: t('Інше') }
const PLACE_GROUP = (cat: string) => PLACE_LABEL[PLACE_KEY(cat)]

/** порядок груп (ключі): у ресурсах спершу те, з чого все крафтиться */
const GROUP_ORDER = [...VEHICLE_KEYS, 'RawResources', 'Resources', 'RefinedResources', 'CraftedResources', 'Ammo', 'Consumables', 'Deployables', 'Modules', 'Augments', 'Emotes', 'Schematics', 'production', 'power', 'storage', 'vehicle', 'decor']
const groupRank = (g: string) => { if (g === 'other') return 99; const i = GROUP_ORDER.indexOf(g); return i < 0 ? 50 : i }
/** службові записи гри без справжньої назви: «BUILDINGS/TBD» тощо */
const junk = (name: string) => name.includes('/') || /\bTBD\b/.test(name) || /^[A-Z0-9]+_[A-Z0-9_]*$/.test(name) || /^(XX|NA)_/.test(name)

/** усі записи розділу */
function entriesOf(ix: CatalogIndex, section: SectionId): Entry[] {
  if (section === 'placeable') return ix.cat.placeables.filter((x) => !junk(x.name)).map((x) => ({ t: 'place', x }))
  if (section === 'building') return ix.cat.buildables.map((x) => ({ t: 'build', x }))
  return ix.cat.items.filter((i) => sectionOfItem(i) === section && !junk(i.name)).map((x) => ({ t: 'item', x }))
}

type By = 'type' | 'tier'
function readPath() {
  const [, , sec, ...rest] = location.pathname.split('/')
  const section = (SECTIONS.some((s) => s.id === sec) ? sec : 'resources') as SectionId
  const id = rest.length ? decodeURIComponent(rest.join('/')) : null
  const p = new URLSearchParams(location.search)
  const tier = p.get('tier')
  const by = p.get('by')
  return { home: !SECTIONS.some((s) => s.id === sec), section, id, q: p.get('q') ?? '', g: p.get('g'), tier: tier && /^\d{1,2}$/.test(tier) ? Number(tier) : null, by: by === 'tier' || by === 'type' ? (by as By) : null }
}
/** адреса довідника: розділ, запис, пошук, група, тір і групування — кожна вкладка й фільтр — своє посилання */
function catalogUrl(section: SectionId, id: string | null, f: { q?: string; g?: string | null; tier?: number | null; by?: By | null } = {}) {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.g) p.set('g', f.g)
  if (f.tier != null) p.set('tier', String(f.tier))
  if (f.by === 'tier') p.set('by', 'tier')
  return `/catalog/${section}${id ? '/' + encodeURIComponent(id) : ''}${p.size ? `?${p}` : ''}`
}

export default function Catalog() {
  const [ix, setIx] = useState<CatalogIndex | null>(null)
  const [state, setState] = useState<'loading' | 'syncing' | 'error' | 'ok'>('loading')
  const [route, setRoute] = useState(readPath)
  const routeRef = useRef(route)
  routeRef.current = route
  const [q, setQ] = useState(route.q)
  const [sub, setSubState] = useState<string | null>(route.g)
  const [tier, setTierState] = useState<number | null>(route.tier)
  /** заголовки сітки: за типом (підкатегорія, вид техніки) чи за тіром; без ?by= — як востаннє */
  const [by, setByState] = useState<By>(() => route.by ?? prefGet<By>('catalog:by', 'type'))
  const sheet = useStore((s) => s.sheet)
  const setSheet = useStore((s) => s.setSheet)

  // каталог; поки сервер уперше збирає його — перепитуємо кожні 4 с
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const go = () =>
      loadCatalog()
        .then((r) => {
          if (!live) return
          if (r === 'syncing') { setState('syncing'); timer = setTimeout(go, 4000) }
          else { setIx(r); setState('ok') }
        })
        .catch(() => live && setState('error'))
    go()
    return () => { live = false; clearTimeout(timer) }
  }, [attempt])
  const retry = () => { setState('loading'); setAttempt((n) => n + 1) }

  // відкрили посилання на конкретний запис — на вузькому екрані одразу показати картку
  useEffect(() => { if (route.id) setSheet('catalog-detail') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onPop = () => { const r = readPath(); setRoute(r); setQ(r.q); setSubState(r.g); setTierState(r.tier); if (r.by) setByState(r.by) }
    addEventListener('popstate', onPop)
    // перехід звичайним посиланням сайту (пункт «Довідник» у шапці, крихти) — адреса змінилась без popstate: шлях уже не
    // той, що показує сторінка
    const off = useStore.subscribe(() => {
      const r = routeRef.current
      if (location.pathname !== (r.home ? '/catalog' : catalogUrl(r.section, r.id).split('?')[0])) onPop()
    })
    return () => { removeEventListener('popstate', onPop); off() }
  }, [])

  // група й тір лишаються в адресі, поки той самий розділ; групування — завжди
  const keep = (section: SectionId) => (section === route.section ? { g: sub, tier, by } : { by })
  const nav = (section: SectionId, id: string | null, replace = false) => {
    const url = catalogUrl(section, id, { q, ...keep(section) })
    history[replace ? 'replaceState' : 'pushState'](null, '', url)
    setRoute({ home: false, section, id, q, g: section === route.section ? sub : null, tier: section === route.section ? tier : null, by })
    if (id) setSheet('catalog-detail')
  }
  const filterUrl = (g: string | null, tr: number | null, b: By = by) => catalogUrl(route.section, route.id, { q, g, tier: tr, by: b })
  const setSub = (g: string | null) => { setSubState(g); history.pushState(null, '', filterUrl(g, tier)) }
  const setTier = (n: number | null) => { setTierState(n); history.pushState(null, '', filterUrl(sub, n)) }
  const pickBy = (v: By) => { setByState(v); prefSet('catalog:by', v); history.pushState(null, '', filterUrl(sub, tier, v)) }
  // пошук — теж в адресі (без нового кроку історії на кожну літеру)
  useEffect(() => {
    const h = setTimeout(() => {
      // на головній без пошуку адреса лишається /catalog
      const url = route.home && !q.trim() ? '/catalog' : catalogUrl(route.section, route.id, { q: q.trim(), g: sub, tier, by })
      if (url !== location.pathname + location.search) history.replaceState(null, '', url)
    }, 300)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])
  const openEntity = (kind: 'item' | 'place', id: string) => {
    if (!ix) return
    if (kind === 'place') return nav('placeable', id)
    const it = ix.item.get(id)
    if (it) nav(sectionOfItem(it), id)
  }
  // вкладка розділу під час пошуку — вихід із пошуку в цей розділ
  const setSection = (s: SectionId) => {
    const nq = q.trim().length >= 2 ? '' : q
    setQ(nq); setSubState(null); setTierState(null)
    history.pushState(null, '', catalogUrl(s, null, { q: nq, by }))
    setRoute({ home: false, section: s, id: null, q: nq, g: null, tier: null, by })
  }

  // усі записи розділу
  const entries: Entry[] = useMemo(() => (ix ? entriesOf(ix, route.section) : []), [ix, route.section])
  // головна довідника: розділи — скільки записів і кілька іконок (рівно розкиданих по розділу, а не перші підряд)
  const secStats = useMemo(() => (ix ? SECTIONS.map((x) => {
    const list = entriesOf(ix, x.id)
    const withIcon = list.filter((e) => entryIcon(e))
    const step = Math.max(1, Math.floor(withIcon.length / 5))
    return { ...x, n: list.length, icons: withIcon.filter((_, i) => i % step === 0).slice(0, 5) }
  }) : []), [ix])

  /** група запису — ключем (для адреси й порядку); підпис — groupName */
  const groupOf = (e: Entry): string =>
    e.t === 'build' ? e.x.set
    : e.t === 'place' ? PLACE_KEY(e.x.cat)
    : e.x.cat === 'misc' ? kindOf(e.x) ?? 'other'
    : e.x.cat === 'vehicle' ? vehicleKey(e.x)
    : e.x.sub ?? 'other'
  const groupName = (g: string) =>
    route.section === 'building' ? setLabel(g)
    : route.section === 'placeable' ? PLACE_LABEL[g] ?? t('Інше')
    : route.section === 'resources' ? kindLabel(g === 'other' ? null : g)
    : route.section === 'vehicle' ? vehicleLabel(g)
    : subLabel(g === 'other' ? null : g)
  const gradeOf = (e: Entry) => (e.t === 'build' ? 0 : e.x.grade)
  const byTier = by === 'tier' && route.section !== 'building'
  /** заголовок, під яким запис стоїть у сітці */
  const headOf = (e: Entry) => (byTier ? tierLabel(gradeOf(e), route.section === 'vehicle') : groupName(groupOf(e)))

  // пошук іде по всьому довіднику; без пошуку — розділ із фільтрами
  const ql = q.trim().toLowerCase()
  const searched: Entry[] | null = useMemo(() => {
    if (!ix || ql.length < 2) return null
    // кожне слово пошуку — десь у назві (мовою сайту чи англійською), у будівель — ще й у назві набору: «сардаукар фундамент»
    const words = ql.split(/\s+/)
    const hit = (...parts: (string | null | undefined)[]) => { const s = parts.filter(Boolean).join(' ').toLowerCase(); return words.every((w) => s.includes(w)) }
    const out: Entry[] = []
    for (const x of ix.cat.items) if (!junk(x.name) && hit(x.name, x.loc)) out.push({ t: 'item', x })
    for (const x of ix.cat.placeables) if (!junk(x.name) && hit(x.name, x.loc)) out.push({ t: 'place', x })
    for (const x of ix.cat.buildables) if (hit(buildName(x), x.name, x.id.replace(/_/g, ' '), setLabel(x.set), x.set)) out.push({ t: 'build', x })
    return out.slice(0, 400)
  }, [ix, ql])

  const groups = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of entries) m.set(groupOf(e), (m.get(groupOf(e)) || 0) + 1)
    return [...m.entries()].sort((a, b) => groupRank(a[0]) - groupRank(b[0]) || b[1] - a[1])
  }, [entries]) // eslint-disable-line react-hooks/exhaustive-deps
  const tiers = useMemo(() => [...new Set(entries.filter((e) => e.t !== 'build').map((e) => (e.x as CItem).grade))].sort((a, b) => a - b), [entries])
  // група з адреси: ключ; давнє посилання з перекладеною назвою групи — знайти її ключ за підписом
  const g = !sub || groups.some(([k]) => k === sub) ? sub : groups.find(([k]) => groupName(k) === sub)?.[0] ?? null

  const list = useMemo(() => {
    if (searched) return searched
    return entries
      .filter((e) => !g || groupOf(e) === g)
      .filter((e) => tier == null || (e.t !== 'build' && (e.x as CItem).grade === tier))
      .sort(
        (a, b) =>
          (byTier ? gradeOf(a) - gradeOf(b) : 0) ||
          groupRank(groupOf(a)) - groupRank(groupOf(b)) ||
          groupName(groupOf(a)).localeCompare(groupName(groupOf(b)), locale()) ||
          gradeOf(a) - gradeOf(b) ||
          entryName(a).localeCompare(entryName(b), locale()),
      )
  }, [entries, searched, g, tier, byTier]) // eslint-disable-line react-hooks/exhaustive-deps
  // скільки записів під кожним заголовком — у тому, що зараз показано (з урахуванням фільтрів)
  const heads = useMemo(() => {
    const m = new Map<string, number>()
    if (!searched) for (const e of list) m.set(headOf(e), (m.get(headOf(e)) || 0) + 1)
    return m
  }, [list, searched, byTier]) // eslint-disable-line react-hooks/exhaustive-deps

  const selected: Entry | null = useMemo(() => {
    if (!ix || !route.id) return null
    if (route.section === 'building') {
      const b = ix.cat.buildables.find((x) => x.id === route.id)
      return b ? { t: 'build', x: b } : null
    }
    if (route.section === 'placeable') { const p = ix.place.get(route.id); return p ? { t: 'place', x: p } : null }
    const it = ix.item.get(route.id)
    return it ? { t: 'item', x: it } : null
  }, [ix, route])

  // шлях: Довідник › розділ › запис
  const secLabel = SECTIONS.find((x) => x.id === route.section)?.label
  const recName = selected ? (selected.t === 'build' ? buildName(selected.x as Parameters<typeof buildName>[0]) : nameOf(selected.x as { name: string; loc?: string | null })) : null
  const home = route.home && !searched
  useCrumb(searched ? [{ label: t('Пошук') }] : home ? [] : [{ label: secLabel ?? '', path: catalogUrl(route.section, null) }, ...(recName ? [{ label: recName }] : [])])

  // прокрутка: плитки додаємо порціями, щоб розділ на тисячу не гальмував
  const [shown, setShown] = useState(180)
  useEffect(() => setShown(180), [list])
  const more = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = more.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setShown((n) => n + 240), { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [list])

  // розділи — головна навігація, у шапці сторінки; під час пошуку (він по всьому довіднику) жоден не вибраний
  const sectionTabs = (
    <ScrollRow active={route.section}>
      <Seg<SectionId>
        label={t('Розділи')}
        value={(searched || home ? '' : route.section) as SectionId}
        onChange={setSection}
        href={(s) => catalogUrl(s, null)}
        items={SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
        className={IN_ROW}
      />
    </ScrollRow>
  )

  if (state !== 'ok' || !ix)
    return (
      <div className="mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 flex-col gap-2.5">
        <PageHeader title={t('Довідник')}>{sectionTabs}</PageHeader>
        {state === 'error'
          ? <PageError title={t('Довідник не завантажився')} onRetry={retry} />
          : <Loading page label={state === 'syncing' ? t('Довідник оновлюється — це хвилина-дві, сторінка оновиться сама.') : t('Завантаження довідника…')} />}
      </div>
    )

  const detailOpen = sheet === 'catalog-detail'
  const vehicle = route.section === 'vehicle'
  const showGroups = !searched && groups.length > 1
  const showView = !searched && tiers.length > 1
  const header = (
      <PageHeader
        title={t('Довідник')}
        lead={
          <span className="hidden font-mono text-[12px] sm:inline">
            {plural(ix.cat.items.length, [t('предмет'), t('предмети'), t('предметів')])} · {plural(ix.cat.placeables.length, [t('пристрій'), t('пристрої'), t('пристроїв')])} · {plural(ix.cat.recipes.length, [t('рецепт'), t('рецепти'), t('рецептів')])}
            <DataStamp sep sections={['items', 'recipes', 'buildables']} />
          </span>
        }
        actions={
          <div className="w-[min(22rem,calc(100vw-3.5rem))]">
            {/* type="text": у рідного «search» свій хрестик — поруч із хрестиком поля їх було два */}
            <SnInput
              type="text"
              enterkeyhint="search"
              clearable
              modelValue={q}
              placeholder={t('Пошук по всьому довіднику')}
              accessibilityLabel={t('Пошук у довіднику')}
              onInput={(e: Event) => setQ(valueOf(e) ?? '')}
            />
          </div>
        }
      >
        {/* на головній розділи — картками нижче */}
        {!home && sectionTabs}
      </PageHeader>
  )
  // головна довідника: розділи картками — назва, скільки записів, кілька іконок
  if (home) return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        {header}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" aria-label={t('Розділи')}>
          {secStats.map((x) => (
            <li key={x.id}>
              <a
                href={catalogUrl(x.id, null)}
                onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setSection(x.id) }}
                className="group flex h-full flex-col gap-3 rounded-xl border border-line bg-panel p-3.5 shadow-sm transition-colors hover:border-spice/50"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-[15px] font-bold group-hover:text-spice">{x.label}</span>
                  <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">{fmtN(x.n)}</span>
                </span>
                <span className="mt-auto flex gap-1.5 overflow-hidden" aria-hidden>
                  {x.icons.map((e) => <Icon key={keyOf(e)} src={entryIcon(e)} size={36} wide={e.t === 'build'} />)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
  // до lg картка — висувна панель, а список — частина сторінки: прокручується вся сторінка (шапка з пошуком і фільтрами
  // їде вгору разом зі списком), а не лише список під нерухомою шапкою на пів екрана
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 flex-col gap-2.5 max-lg:overflow-y-auto max-lg:overflow-x-hidden max-lg:pb-6">
      {header}
      <div className="relative flex min-h-0 gap-1.5 sm:gap-2.5 max-lg:flex-none lg:flex-1">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-lg" aria-label={t('Довідник')}>
        {/* уточнення розділу: групи ліворуч, вигляд (тір, групування) праворуч; не влазять в один рядок — вигляд
            переходить нижче, а кожен рядок гортається вбік */}
        {(searched || showGroups || showView) && (
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-3 py-2.5">
            {searched && <p className="text-[12.5px] text-muted">{t('Знайдено {n} у всіх розділах.', { n: `${searched.length}${searched.length >= 400 ? '+' : ''}` })}</p>}
            {showGroups && (
              <ScrollRow active={g} className="flex-[1_1_auto]">
                <Seg<string>
                  size="sm"
                  label={t('Група')}
                  value={g ?? ''}
                  onChange={(v) => setSub(v || null)}
                  href={(v) => filterUrl(v || null, tier)}
                  items={[['', entries.length] as [string, number], ...groups].map(([k, n]) => ({
                    id: k,
                    label: <>{k ? groupName(k) : t('Усі')}<span className="ml-1.5 font-mono text-[10.5px] opacity-60">{n}</span></>,
                  }))}
                  className={IN_ROW}
                />
              </ScrollRow>
            )}
            {/* тір і групування — окремими шматками: на телефоні «Групувати» переходить нижче, а не ховається за краєм */}
            {showView && (
              <ScrollRow active={tier} className={cn('min-w-0', showGroups && 'ml-auto')}>
                <div className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted">
                  <span>{t('Тір')}</span>
                  <Seg<string>
                    size="sm"
                    label={t('Тір')}
                    value={tier == null ? '' : String(tier)}
                    onChange={(v) => setTier(v === '' ? null : Number(v))}
                    href={(v) => filterUrl(g, v === '' ? null : Number(v))}
                    items={[
                      { id: '', label: t('Усі') },
                      ...tiers.map((n) => ({ id: String(n), label: <span className="font-mono">{n}</span>, tip: tierLabel(n, vehicle) })),
                    ]}
                    className={IN_ROW}
                  />
                </div>
              </ScrollRow>
            )}
            {showView && (
              <div className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted">
                <span>{t('Групувати')}</span>
                <Seg<By>
                  size="sm"
                  label={t('Групувати')}
                  value={by}
                  onChange={pickBy}
                  href={(v) => filterUrl(g, tier, v)}
                  items={[{ id: 'type', label: vehicle ? t('За технікою') : t('За типом') }, { id: 'tier', label: t('За тіром') }]}
                />
              </div>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 p-2.5 lg:overflow-y-auto">
          {list.length === 0 && (
            <Empty icon={SearchX} title={t('Нічого не знайдено')} description={t('Зміни пошук або зніми фільтр.')} framed={false}>
              {(q || sub || tier != null) && <Button variant="secondary" onClick={() => { setQ(''); setSubState(null); setTierState(null); history.replaceState(null, '', catalogUrl(route.section, route.id, { by })) }}>{t('Скинути пошук і фільтри')}</Button>}
            </Empty>
          )}
          {/* на телефоні — одна колонка: назви деталей довгі, у двох колонках обрізаються на найважливішому */}
          <ul className="grid grid-cols-1 gap-1.5 min-[480px]:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {list.slice(0, shown).map((e, n, arr) => {
              // заголовок групи (за типом чи тіром) — коли без пошуку і заголовків більше одного
              const g = heads.size > 1 ? headOf(e) : null
              const head = g && (n === 0 || headOf(arr[n - 1]) !== g)
              const k = keyOf(e)
              const on = selected && keyOf(selected) === k && selected.t === e.t
              const sec: SectionId = e.t === 'build' ? 'building' : e.t === 'place' ? 'placeable' : sectionOfItem(e.x)
              return (
                <li key={e.t + k} className="contents">
                  {head && (
                    <h2 className="col-span-full mt-2 flex items-baseline gap-2 px-0.5 first:mt-0">
                      <span className="font-display text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">{g}</span>
                      <span className="font-mono text-[10.5px] text-muted">{heads.get(g)}</span>
                    </h2>
                  )}
                  <a
                    href={catalogUrl(sec, k, { q, ...keep(sec) })}
                    onClick={(ev) => { if (!plainClick(ev)) return; ev.preventDefault(); nav(sec, k) }}
                    aria-current={on ? 'page' : undefined}
                    className={cn('flex h-full w-full items-center gap-2.5 rounded-lg border p-2 text-left transition-colors', on ? 'border-spice/70 bg-spice/10' : 'border-line/70 bg-panel2/30 hover:border-line hover:bg-panel2')}
                  >
                    <Icon src={entryIcon(e)} size={40} grade={e.t !== 'build' ? e.x.grade : undefined} />
                    {/* довгі схожі назви («Схема креслення, ранг…») різняться в кінці — повна назва в підказці */}
                    <span className="min-w-0 flex-1" title={entryName(e)}>
                      <span className="line-clamp-2 text-[12.5px] font-medium leading-tight">{entryName(e)}</span>
                      {e.t !== 'build' && e.x.loc && <span className="mt-0.5 block truncate text-[10.5px] text-muted">{e.x.name}</span>}
                      {e.t === 'build' && <span className="mt-0.5 block truncate text-[10.5px] text-muted">{setLabel(e.x.set)}</span>}
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
          {shown < list.length && <div ref={more} className="h-10" />}
        </div>
      </section>

      <SheetBackdrop open={detailOpen && !!selected} className="lg:hidden" />
      <aside
        data-open={detailOpen && selected ? 'yes' : 'no'}
        className={cn(SHEET_BASE, 'sheet-lg flex flex-col lg:flex lg:w-[400px] lg:shrink-0 lg:overflow-hidden lg:rounded-xl lg:border lg:border-line lg:!bg-panel lg:shadow-lg')}
        aria-label={t('Картка')}
      >
        <SheetHead title={selected ? entryName(selected) : t('Картка')} className="lg:hidden" />
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {selected ? (
            <Detail key={selected.t + keyOf(selected)} e={selected} ix={ix} open={openEntity} navBuild={(b) => nav('building', b.id)} />
          ) : route.id ? (
            <div className="grid h-full place-items-center">
              <Empty icon={SearchX} title={t('Такого запису нема')} description={t('Його могли прибрати з довідника після оновлення гри.')} framed={false} />
            </div>
          ) : (
            <div className="grid h-full place-items-center">
              <Empty icon={BookOpen} title={t('Обери запис')} description={t('Обери предмет, щоб побачити, як його отримати і де він використовується.')} framed={false} />
            </div>
          )}
        </div>
      </aside>
      </div>
    </div>
  )
}

function RecipeRow({ r, ix, open, show }: { r: CRecipe; ix: CatalogIndex; open: (k: 'item' | 'place', id: string) => void; show: 'in' | 'out' }) {
  // указ тижня з головної: входи й вода рецепта — з ним, а час — з контрактом на переробку; вимкнено в калькуляторі
  // («рахувати без указу», calc:decree) — і тут без нього, щоб числа збігались
  const decree = useDecree((s) => s.id)
  const fx = decreeFx(prefGet('calc:decree', true) ? decree : null)
  const grade = ix.item.get(r.out[0]?.[0])?.grade ?? 0
  const cheap = fx.production && grade >= 4
  const fast = fx.refining && /refiner/i.test(ix.place.get(r.at[0])?.cat ?? '')
  return (
    <li className="grid gap-1.5 rounded-lg border border-line/70 p-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
        {r.at.slice(0, 2).map((p) => (
          <button key={p} type="button" onClick={() => open('place', p)} className="inline-flex items-center gap-1 hover:text-spice">
            <Hammer size={12} /> {nameOf(ix.place.get(p), p)}
          </button>
        ))}
        {r.time != null && <span className={cn('inline-flex items-center gap-1', fast && 'text-spice')} title={fast ? t('Без указу — {time}', { time: fmtTime(r.time) }) : undefined}><Timer size={12} /> {fmtTime(fast ? r.time / 4 : r.time)}</span>}
        {r.water ? <span className={cn('inline-flex items-center gap-1', cheap && 'text-spice')} title={cheap ? t('Без указу — {water}', { water: t('{n} мл', { n: fmtN(r.water) }) }) : undefined}><Droplet size={12} /> {t('{n} мл', { n: fmtN(waterQty(r.water, grade, fx)) })}</span> : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {show === 'in'
          ? r.in.map(([id, q]) => <Ref key={id} ix={ix} id={id} qty={inputQty(q, grade, fx)} was={q} open={open} />)
          : r.out.map(([id, q]) => <Ref key={id} ix={ix} id={id} qty={q} open={open} />)}
      </div>
    </li>
  )
}

/** калькулятор — окремою сторінкою: у вузькій картці він не влазить; ціль — цей запис, одна штука */
function CalcButton({ target, className }: { target: Target; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => useStore.getState().setView('calculator', { search: '?t=' + encodeTargets([target]) })}
      className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border border-spice/50 px-3 text-[12.5px] font-medium text-spice hover:bg-spice/10', className)}
      data-tip={t('Скільки сировини, крафтів, води й часу — з указом тижня')}
    >
      <Calculator size={14} /> {t('Порахувати в калькуляторі')}
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h3>
      {children}
    </section>
  )
}

/** довгий список у картці — спершу limit, далі «Показати всі (N)», а не мовчки обрізаний */
function useCap() {
  const [all, setAll] = useState<Set<string>>(new Set())
  return <T,>(key: string, list: T[], limit: number) => ({
    shown: all.has(key) ? list : list.slice(0, limit),
    more: list.length > limit && !all.has(key) ? (
      <button type="button" onClick={() => setAll(new Set([...all, key]))} className="mt-1 text-[12px] text-muted underline underline-offset-2 hover:text-spice">
        {t('Показати всі ({n})', { n: list.length })}
      </button>
    ) : null,
  })
}

/**
 * Опис предмета з гри: у ньому трапляється розмітка кольору (<span style="color: #66528F">Unique</span>) — її
 * показуємо кольором, решту тегів відкидаємо (без вставки HTML як є)
 */
function GameText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  const re = /<span style="color:\s*(#[0-9a-fA-F]{3,8})">([\s\S]*?)<\/span>/g
  const plain = (x: string) => x.replace(/<[^>]*>/g, '')
  let at = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    parts.push(plain(text.slice(at, m.index)))
    parts.push(<span key={m.index} className="font-semibold" style={{ color: m[1] }}>{plain(m[2])}</span>)
    at = m.index + m[0].length
  }
  parts.push(plain(text.slice(at)))
  return <>{parts}</>
}

interface Extra {
  description: string | null
  volume: number | null
  price: number | null
  weapon: Record<string, number> | null
  power: { produce: number; consume: number; water: number; waterRate: number } | null
}

const WEAPON: Record<string, string> = { damage: t('Шкода'), fireRate: t('Темп'), clipSize: t('Магазин'), reloadTime: t('Перезарядка, с'), accuracy: t('Точність'), effectiveRange: t('Дальність'), maxRange: t('Макс. дальність'), shieldDamage: t('Шкода щиту') }

function Detail({ e, ix, open, navBuild }: { e: Entry; ix: CatalogIndex; open: (k: 'item' | 'place', id: string) => void; navBuild: (b: CBuild) => void }) {
  const [extra, setExtra] = useState<Extra | null>(null)
  const cap = useCap()
  useEffect(() => {
    setExtra(null)
    if (e.t === 'build') return
    let live = true
    fetch(`/api/catalog/${e.t === 'item' ? 'item' : 'placeable'}/${encodeURIComponent(e.x.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setExtra(d))
      .catch(() => {})
    return () => { live = false }
  }, [e])

  const go = useStore.getState().setView
  if (e.t === 'build') {
    const b = e.x
    return (
      <div>
        <Head icon={wikiImg(b.img)} title={buildName(b)} sub={`${setLabel(b.set)} · ${groupLabel(b.group)}`} />
        {b.health != null && <Facts list={[[t('Міцність'), fmtN(b.health)]]} />}
        <Section title={t('Ціна')}>
          <div className="flex flex-wrap gap-1">
            {b.cost.map(([id, q]) => <Ref key={id} ix={ix} id={id} qty={q} open={open} />)}
          </div>
        </Section>
        <CalcButton target={{ kind: 'build', id: buildKey(b), qty: 1 }} className="mt-3" />
        {(() => {
          const c = cap('set', ix.cat.buildables.filter((x) => x.set === b.set && x.group === b.group && x.id !== b.id), 24)
          return (
            <Section title={t('Інше в наборі «{set}»', { set: setLabel(b.set) })}>
              <div className="flex flex-wrap gap-1">
                {c.shown.map((x) => (
                  <button key={x.id} type="button" onClick={() => navBuild(x)} className="rounded-md border border-line/80 px-2 py-0.5 text-[12px] hover:border-spice/50">{buildName(x)}</button>
                ))}
              </div>
              {c.more}
            </Section>
          )
        })()}
      </div>
    )
  }

  if (e.t === 'place') {
    const p = e.x
    const crafts = ix.craftsAt.get(p.id) ?? []
    const pw = extra?.power
    const build = buildOfPlace(ix, p)
    return (
      <div>
        <Head icon={iconUrl(p.icon)} title={nameOf(p)} sub={p.loc ? p.name : PLACE_GROUP(p.cat)} grade={p.grade} />
        <Facts
          list={[
            ...(pw?.produce ? [[t('Дає енергії'), fmtN(pw.produce)] as [string, string]] : []),
            ...(pw?.consume ? [[t('Бере енергії'), fmtN(pw.consume)] as [string, string]] : []),
            ...(pw?.water ? [[t('Вода, ємність'), fmtN(pw.water)] as [string, string]] : []),
          ]}
        />
        {build && (
          <>
            <Section title={t('Ціна будівництва')}>
              <div className="flex flex-wrap gap-1">
                {build.cost.map(([id, q]) => <Ref key={id} ix={ix} id={id} qty={q} open={open} />)}
              </div>
            </Section>
            <CalcButton target={{ kind: 'build', id: buildKey(build), qty: 1 }} className="mt-3" />
          </>
        )}
        {crafts.length > 0 && (() => {
          const c = cap('crafts', crafts, 80)
          return (
            <Section title={t('Що тут крафтиться — {n}', { n: crafts.length })}>
              <div className="flex flex-wrap gap-1">
                {c.shown.map((r) => r.out.map(([id, q]) => <Ref key={r.id + id} ix={ix} id={id} qty={q > 1 ? q : undefined} open={open} />))}
              </div>
              {c.more}
            </Section>
          )
        })()}
      </div>
    )
  }

  const it = e.x
  const makes = ix.makes.get(it.id) ?? []
  const uses = ix.uses.get(it.id) ?? []
  const builds = ix.builds.get(it.id) ?? []
  const facts: [string, string][] = [
    [t('Тір'), String(it.grade)],
    ...(it.rarity ? [[t('Рідкість'), rarityLabel(it.rarity)] as [string, string]] : []),
    ...(it.stack ? [[t('Стос'), fmtN(it.stack)] as [string, string]] : []),
    ...(it.volume ?? extra?.volume ? [[t('Об’єм'), fmtP((it.volume ?? extra?.volume)!)] as [string, string]] : []),
    ...(extra?.price ? [[t('Ціна в торговця'), fmtN(extra.price)] as [string, string]] : []),
  ]
  const usedFor = new Map<string, CRecipe>()
  for (const r of uses) for (const [id] of r.out) if (!usedFor.has(id)) usedFor.set(id, r)
  return (
    <div>
      <Head icon={iconUrl(it.icon)} title={nameOf(it)} sub={it.loc ? it.name : it.cat === 'misc' ? kindLabel(kindOf(it)) : subLabel(it.sub)} grade={it.grade} />
      <Facts list={facts} />
      {extra?.description && <p className="mt-3 whitespace-pre-line text-[12.5px] leading-relaxed text-muted"><GameText text={extra.description} /></p>}
      {/* бойові параметри — лише ненульові: у деталей техніки й інструментів гра віддає самі нулі */}
      {extra?.weapon && Object.keys(WEAPON).some((k) => extra.weapon![k]) && (
        <Facts list={Object.entries(WEAPON).filter(([k]) => extra.weapon![k]).map(([k, l]) => [l, String(Math.round(extra.weapon![k] * 100) / 100)])} />
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => go('map', { search: `?loot=${encodeURIComponent(it.name)}` })}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-spice/50 px-3 text-[12.5px] font-medium text-spice hover:bg-spice/10"
          data-tip={t('Підсвітити на мапі скрині, у луті яких він є')}
        >
          <MapPin size={14} /> {t('Де випадає — на мапі')}
        </button>
        {makes.length > 0 && <CalcButton target={{ kind: 'item', id: it.id, qty: 1 }} />}
      </div>
      {makes.length > 0 && (
        <Section title={t('Як отримати')}>
          <ul className="grid gap-1.5">{makes.map((r) => <RecipeRow key={r.id} r={r} ix={ix} open={open} show="in" />)}</ul>
        </Section>
      )}
      {usedFor.size > 0 && (() => {
        const c = cap('used', [...usedFor.keys()], 60)
        return (
          <Section title={t('Де використовується — {n}', { n: usedFor.size })}>
            <div className="flex flex-wrap gap-1">
              {c.shown.map((id) => <Ref key={id} ix={ix} id={id} open={open} />)}
            </div>
            {c.more}
          </Section>
        )
      })()}
      {builds.length > 0 && (
        <Section title={t('У будівництві — {n}', { n: builds.length })}>
          <ul className="grid gap-0.5 text-[12px]">
            {cap('builds', builds, 30).shown.map((b) => (
              <li key={b.set + b.id}>
                <button type="button" onClick={() => navBuild(b)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-panel2">
                  <span className="min-w-0 flex-1 truncate">{buildName(b)} <span className="text-muted">· {setLabel(b.set)}</span></span>
                  <span className="font-mono text-[11px]">{b.cost.find(([id]) => id === it.id)?.[1]}×</span>
                </button>
              </li>
            ))}
          </ul>
          {cap('builds', builds, 30).more}
        </Section>
      )}
    </div>
  )
}

function Head({ icon, title, sub, grade }: { icon: string | null; title: string; sub?: string; grade?: number }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Icon src={icon} size={112} grade={grade} wide />
      <div className="min-w-[10rem] flex-1">
        <h2 className="text-balance font-display text-[16px] font-bold leading-snug">{title}</h2>
        {sub && <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p>}
      </div>
    </div>
  )
}

function Facts({ list }: { list: [string, string][] }) {
  if (!list.length) return null
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
      {list.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-2 border-b border-line/60 py-0.5">
          <dt className="text-muted">{k}</dt>
          <dd className="font-mono tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}


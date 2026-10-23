/**
 * Біржа (/market): стрічка оголошень «Куплю / Продам» з фільтрами в адресі (вид, предмет назвою, розділ довідника,
 * регіон, світ, ціна, свіжість, порядок); вкладки сегментом шляху — «Мої» (з закритими), «Угоди», «Гільдія», «Скарги»
 * (модераторам). Оголошення — /market/<id> (pages/market/ListingPage), нове й редагування — /market/new,
 * /market/<id>/edit (ListingEditor), предмет — /market/item/<id гри> (ItemPage), угода — /market/deal/<id> (DealPage).
 * Стрічка оновлюється сама (живий потік /api/market/stream).
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Handshake, LogIn, Plus, SearchX, ShieldAlert } from 'lucide-react'
import { FRESH, FRESH_LABEL, goodsOf, itemHref, listMarket, myDeals, SECTION_LABEL, SECTIONS, SIDE_LABEL, SORT_LABEL, SORTS, type Deal, type ListingRow, type MarketQuery } from '@/lib/market'
import { nameOf } from '@/lib/catalog'
import { REGIONS, type Region } from '@/lib/ddReset'
import { loginHref, useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { subscribe } from '@/lib/stream'
import { useUrlParam } from '@/lib/urlState'
import { MARKET_TABS, openPath, pathOf, useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Seg } from '@/components/ui/seg'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorAlert, Loading, PageError } from '@/components/states'
import { GuildTag } from '@/components/access/Access'
import { useCrumb } from '@/components/Crumbs'
import { SnInput, SnSkeleton, valueOf } from '@/components/sn'
import { DealCard, go, LISTING_GRID, ListingCard } from '@/components/market/bits'
import { iconOf, useGoods } from '@/components/market/names'
import { Icon } from '@/components/catalog/bits'
import { useMarketMe } from '@/components/market/me'

const ListingPage = lazy(() => import('./market/ListingPage'))
const ListingEditor = lazy(() => import('./market/ListingEditor'))
const ItemPage = lazy(() => import('./market/ItemPage'))
const DealPage = lazy(() => import('./market/DealPage'))
const Reports = lazy(() => import('./market/Reports'))

/** param — оголошення (чи «new»), предмет чи угода; sub — вкладка, «edit», «item», «deal» */
export default function Market({ param, sub }: { param: string | null; sub: string | null }) {
  const page = param === 'new' ? <ListingEditor id={null} />
    : sub === 'item' && param ? <ItemPage key={param} gid={param} />
      : sub === 'deal' && param ? <DealPage key={param} id={param} />
        : param && sub === 'edit' ? <ListingEditor key={param} id={param} />
          : param ? <ListingPage key={param} id={param} />
            : null
  if (page) return <Suspense fallback={<Loading page />}>{page}</Suspense>
  return <MarketHome />
}

type Tab = 'all' | (typeof MARKET_TABS)[number]

/** нове оголошення: без входу — спершу вхід (і назад сюди) */
export function newListing(search = '') {
  if (!useAuth.getState().user) { openPath(`/login?next=${encodeURIComponent('/market/new' + search)}`); return }
  useStore.getState().setView('market', { param: 'new', search })
}

function MarketHome() {
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const guild = useAuth((s) => s.guild)
  const sub = useStore((s) => s.sub)
  const setView = useStore((s) => s.setView)
  const me = useMarketMe()
  const raw: Tab = (MARKET_TABS as readonly string[]).includes(sub ?? '') ? (sub as Tab) : 'all'
  // без входу «моїх» і «угод» нема, без гільдії — «гільдії», без прав модератора — «скарг»
  const tab: Tab = ((raw === 'mine' || raw === 'deals') && !user) || (raw === 'guild' && !guild) || (raw === 'reports' && !me?.moderator) ? 'all' : raw
  const TAB_L: Record<Tab, string> = { all: t('Оголошення'), mine: t('Мої'), deals: t('Угоди'), guild: t('Гільдія'), reports: t('Скарги') }
  useCrumb([], { sub: tab === 'all' ? null : tab, value: TAB_L[tab] })
  const setTab = (v: Tab) => setView('market', { sub: v === 'all' ? null : v, search: v === 'all' || v === 'guild' || v === 'mine' ? location.search : '' })
  const tabHref = (v: Tab) => pathOf('market', null, false, null, v === 'all' ? null : v)
  const tabs = [
    { id: 'all' as const, label: TAB_L.all },
    ...(user ? [{ id: 'mine' as const, label: TAB_L.mine }, { id: 'deals' as const, label: TAB_L.deals }] : []),
    ...(guild ? [{ id: 'guild' as const, label: <span className="inline-flex items-center gap-1.5"><GuildTag tag={guild.tag} color={guild.color} />{TAB_L.guild}</span> }] : []),
    ...(me?.moderator ? [{ id: 'reports' as const, label: <span className="inline-flex items-center gap-1.5"><ShieldAlert size={13} />{TAB_L.reports}</span> }] : []),
  ]
  const post = () => newListing(tab === 'guild' && guild ? `?guild=${guild.id}` : '')

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={t('Біржа')}
          lead={t('Куплю й продам — предмети з гри за солари чи бартером. Ціни від спільноти, книга заявок, угоди з репутацією. Передача — у грі; торгівля за реальні гроші заборонена.')}
          actions={!ready ? undefined : user
            ? <Button onClick={post}><Plus size={15} />{t('Розмістити оголошення')}</Button>
            : <Button onClick={() => openPath(loginHref())}><LogIn size={15} />{t('Увійди, щоб торгувати')}</Button>}
        >
          {tabs.length > 1 && <div className="flex flex-wrap items-center gap-2"><Seg label={t('Розділ біржі')} value={tab} onChange={setTab} href={tabHref} items={tabs} /></div>}
          {(tab === 'all' || tab === 'guild' || tab === 'mine') && <Filters />}
        </PageHeader>
        {me?.ban && <ErrorAlert title={t('Тобі заборонено торгувати на біржі')} message={me.ban.until ? t('До {date}. Причина: {reason}', { date: new Date(me.ban.until).toLocaleDateString(), reason: me.ban.reason || '—' }) : t('Назавжди. Причина: {reason}', { reason: me.ban.reason || '—' })} />}
        {tab === 'deals' ? <DealsTab /> : tab === 'reports' ? <Suspense fallback={<Loading />}><Reports /></Suspense> : <Feed tab={tab} onPost={post} />}
      </div>
    </div>
  )
}

/** фільтри стрічки — у адресі (посилання з фільтром можна переслати) */
function useFilters() {
  const [side, setSide, sideHref] = useUrlParam<string>('side', '', (v) => v === 'buy' || v === 'sell')
  const [cat, setCat, catHref] = useUrlParam<string>('cat', '', (v) => (SECTIONS as string[]).includes(v))
  const [region, setRegion, regionHref] = useUrlParam<string>('region', '', (v) => v in REGIONS)
  const [fresh, setFresh, freshHref] = useUrlParam<string>('fresh', '', (v) => (FRESH as readonly string[]).includes(v))
  const [sort, setSort, sortHref] = useUrlParam<string>('sort', 'new', (v) => (SORTS as readonly string[]).includes(v))
  const [q, setQ] = useUrlParam<string>('q', '')
  const [world, setWorld] = useUrlParam<string>('world', '')
  const [min, setMin] = useUrlParam<string>('min', '', (v) => /^\d{1,12}$/.test(v))
  const [max, setMax] = useUrlParam<string>('max', '', (v) => /^\d{1,12}$/.test(v))
  return { side, setSide, sideHref, cat, setCat, catHref, region, setRegion, regionHref, fresh, setFresh, freshHref, sort, setSort, sortHref, q, setQ, world, setWorld, min, setMin, max, setMax }
}

function Filters() {
  const f = useFilters()
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SnInput type="search" size="lg" className="min-w-[min(240px,100%)] flex-1" modelValue={f.q} placeholder={t('Предмет: смола, пласталь, гвинтівка…')} accessibilityLabel={t('Пошук предмета')} onInput={(e: Event) => f.setQ(valueOf(e), { replace: true })} />
        <Seg label={t('Вид')} value={f.side} onChange={f.setSide} href={f.sideHref} items={[{ id: '', label: t('Усі') }, { id: 'sell', label: SIDE_LABEL.sell }, { id: 'buy', label: SIDE_LABEL.buy }]} />
      </div>
      <Seg size="sm" label={t('Розділ')} value={f.cat} onChange={f.setCat} href={f.catHref} items={[{ id: '', label: t('Усі розділи') }, ...SECTIONS.map((s) => ({ id: s, label: SECTION_LABEL[s] }))]} />
      <div className="flex flex-wrap items-center gap-2">
        <Seg size="sm" label={t('Регіон')} value={f.region} onChange={f.setRegion} href={f.regionHref} items={[{ id: '', label: t('Усі регіони') }, ...(Object.keys(REGIONS) as Region[]).map((r) => ({ id: r, label: REGIONS[r].label }))]} />
        <Seg size="sm" label={t('Свіжість')} value={f.fresh} onChange={f.setFresh} href={f.freshHref} items={FRESH.map((x) => ({ id: x, label: FRESH_LABEL[x] }))} />
        <Seg size="sm" label={t('Порядок')} value={f.sort} onChange={f.setSort} href={f.sortHref} items={SORTS.map((x) => ({ id: x, label: SORT_LABEL[x] }))} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <SnInput size="lg" modelValue={f.world} placeholder={t('Світ, напр. Hagga EU 7')} accessibilityLabel={t('Світ')} onInput={(e: Event) => f.setWorld(valueOf(e), { replace: true })} />
        <SnInput size="lg" type="number" inputmode="numeric" min={0} modelValue={f.min} placeholder={t('Ціна від')} accessibilityLabel={t('Ціна за штуку від')} onInput={(e: Event) => f.setMin(valueOf(e).replace(/\D/g, ''), { replace: true })} />
        <SnInput size="lg" type="number" inputmode="numeric" min={0} modelValue={f.max} placeholder={t('Ціна до')} accessibilityLabel={t('Ціна за штуку до')} onInput={(e: Event) => f.setMax(valueOf(e).replace(/\D/g, ''), { replace: true })} />
      </div>
    </div>
  )
}

/** стрічка оголошень (усі / мої / гільдії) */
function Feed({ tab, onPost }: { tab: Tab; onPost: () => void }) {
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const guild = useAuth((s) => s.guild)
  const f = useFilters()
  const ix = useGoods()
  const [rows, setRows] = useState<ListingRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(true)
  const [more, setMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const gen = useRef(0)
  const query = (): MarketQuery => ({
    scope: tab === 'mine' ? 'mine' : tab === 'guild' ? 'guild' : 'all', guild: tab === 'guild' ? guild?.id : undefined, state: tab === 'mine' ? 'all' : undefined,
    side: f.side, cat: f.cat, region: f.region, fresh: f.fresh, sort: f.sort, q: f.q.trim(), world: f.world.trim(), min: f.min, max: f.max,
  })
  const key = JSON.stringify(query())
  useEffect(() => {
    if (!ready) return
    let live = true
    const my = ++gen.current
    setBusy(true)
    const timer = setTimeout(() => {
      listMarket(query())
        .then((r) => { if (live && my === gen.current) { setRows(r.rows); setTotal(r.total); setFailed(false) } })
        .catch(() => live && setFailed(true))
        .finally(() => live && setBusy(false))
    }, f.q || f.world || f.min || f.max ? 250 : 0)
    return () => { live = false; clearTimeout(timer) }
  }, [key, ready, attempt]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let h: ReturnType<typeof setTimeout> | null = null
    const again = () => { if (h) return; h = setTimeout(() => { h = null; setAttempt((n) => n + 1) }, 1500) }
    const off = subscribe('/api/market/stream', again, again)
    return () => { off(); if (h) clearTimeout(h) }
  }, [])
  const showMore = async () => {
    const my = gen.current
    setMore(true)
    try {
      const r = await listMarket({ ...query(), offset: rows?.length ?? 0 })
      if (my === gen.current) setRows((cur) => [...(cur ?? []), ...r.rows])
    } catch { if (my === gen.current) setFailed(true) } finally { if (my === gen.current) setMore(false) }
  }
  // предмети, що відповідають пошуку, — щоб одразу відкрити книгу заявок одного з них
  const found = useMemo(() => {
    const s = f.q.trim().toLowerCase()
    if (!ix || s.length < 2) return []
    return goodsOf(ix).filter((i) => (i.loc || i.name).toLowerCase().includes(s) || i.name.toLowerCase().includes(s)).slice(0, 8)
  }, [ix, f.q])
  const filtered = !!(f.side || f.cat || f.region || f.fresh || f.q.trim() || f.world.trim() || f.min || f.max)
  const reset = () => { f.setSide(''); f.setCat(''); f.setRegion(''); f.setFresh(''); f.setQ(''); f.setWorld(''); f.setMin(''); f.setMax('') }

  const empty = filtered ? (
    <Empty icon={SearchX} title={t('Нічого не знайшлося')} description={t('Спробуй інший предмет, регіон чи ціну — або розмісти своє оголошення: хтось його побачить.')}>
      <Button variant="secondary" onClick={reset}>{t('Скинути фільтри')}</Button>
      {user && <Button onClick={onPost}><Plus size={15} />{t('Розмістити оголошення')}</Button>}
    </Empty>
  ) : (
    <Empty icon={Handshake} title={tab === 'mine' ? t('У тебе поки нема оголошень') : tab === 'guild' ? t('У гільдії поки нема оголошень') : t('Оголошень поки нема')} description={t('Продай зайве чи знайди потрібне: предмет із гри, кількість, ціна — і тобі напишуть.')}>
      {ready && (user ? <Button onClick={onPost}><Plus size={15} />{t('Розмістити оголошення')}</Button> : <Button onClick={() => openPath(loginHref())}><LogIn size={15} />{t('Увійти')}</Button>)}
    </Empty>
  )

  return (
    <>
      {found.length > 0 && (
        <section className="rounded-xl border border-line bg-panel p-3 shadow-sm">
          <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">{t('Книга заявок предмета')}</h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-1.5">
            {found.map((i) => (
              <li key={i.id}>
                <a href={itemHref(i.id)} onClick={go(itemHref(i.id))} className="flex min-w-0 items-center gap-2 rounded-lg border border-line px-2 py-1.5 hover:border-spice/50 hover:text-spice">
                  <Icon src={iconOf(ix, i.id)} size={30} grade={i.grade} />
                  <span className="min-w-0 break-words text-[13px] font-semibold leading-snug">{nameOf(i)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {failed && !rows && <PageError title={t('Оголошення не завантажились')} onRetry={() => { setFailed(false); setAttempt((n) => n + 1) }} />}
      {failed && rows && <ErrorAlert message={t('Список не оновився. Онови сторінку трохи згодом.')} />}
      {!rows && !failed && <ul className={LISTING_GRID} aria-busy="true">{Array.from({ length: 6 }, (_, i) => <li key={i} className="h-[200px] rounded-xl border border-line bg-panel p-3.5"><SnSkeleton lines={4} /></li>)}</ul>}
      {rows && (
        <div className={busy ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={busy}>
          {rows.length ? <ul className={LISTING_GRID}>{rows.map((l) => <ListingCard key={l.id} l={l} />)}</ul> : empty}
        </div>
      )}
      {rows && rows.length < total && <div className="flex justify-center py-2"><Button variant="secondary" loading={more} onClick={showMore}>{t('Показати ще ({n})', { n: total - rows.length })}</Button></div>}
    </>
  )
}

/** мої угоди: активні (пропозиції й прийняті) і завершені */
function DealsTab() {
  const user = useAuth((s) => s.user)
  const [state, setState, stateHref] = useUrlParam<'active' | 'done'>('state', 'active', (v) => v === 'done')
  const [rows, setRows] = useState<Deal[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setRows(null)
    myDeals(state).then((r) => live && setRows(r.rows), () => live && setFailed(true))
    return () => { live = false }
  }, [state])
  return (
    <section className="grid gap-2.5">
      <Seg label={t('Які угоди')} value={state} onChange={setState} href={stateHref} items={[{ id: 'active', label: t('Активні') }, { id: 'done', label: t('Завершені й скасовані') }]} />
      {failed && <PageError title={t('Угоди не завантажились')} onRetry={() => { setFailed(false); setState(state) }} />}
      {!rows && !failed && <Loading />}
      {rows && (rows.length
        ? <ul className={LISTING_GRID}>{rows.map((d) => <DealCard key={d.id} d={d} me={user?.id} />)}</ul>
        : <Empty icon={Handshake} title={state === 'active' ? t('Активних угод нема') : t('Завершених угод ще нема')} description={t('Запропонуй угоду на чуже оголошення — чи чекай пропозицій на своє.')} />)}
    </section>
  )
}

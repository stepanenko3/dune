/**
 * Бібліотека — розводить далі: бази, роадмапи, уміння, калькулятор (своє, гільдійське, публічне — у вкладках самих розділів).
 * LibraryBrowser — публічне одного виду (пошук, «Нові / Популярні / Копіюють», виділене модераторами — згори): вкладка
 * «Публічні» в кожному розділі. Давні /library/<вид> ведуть на «Публічні» розділу.
 */
import { useEffect, useRef, useState } from 'react'
import { Calculator, Castle, LibraryBig, LogIn, SearchX, Sparkles, TrendingUp } from 'lucide-react'
import { library, type Item } from '@/lib/items'
import { useAuth } from '@/lib/auth'
import { pathOf, useStore } from '@/store'
import { t } from '@/lib/i18n'
import { Seg } from '@/components/ui/seg'
import { plainClick } from '@/lib/urlState'
import { GuildTag } from '@/components/access/Access'
import { urlWith, useUrlParam } from '@/lib/urlState'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorAlert, PageError } from '@/components/states'
import { ItemGrid, ItemGridSkeleton } from '@/components/access/ItemCard'
import { SnInput, valueOf } from '@/components/sn'

/** вид — завжди один (бази, білди, роадмапи, розрахунки): усе впереміш погано читається */
export type K = 'base' | 'build' | 'roadmap' | 'calc'
type Sort = 'new' | 'stars' | 'copies'
/** порожня вкладка: що викласти — за видом (сама вкладка вже в розділі, тож «куди піти» не треба) */
const EMPTY: Record<K, { text: string }> = {
  base: { text: t('Виклади свою базу першою: «Доступ» → «Публічне».') },
  build: { text: t('Виклади свій білд першим: «Доступ» → «Публічне».') },
  roadmap: { text: t('Виклади свій роадмап першим: «Доступ» → «Публічне».') },
  calc: { text: t('Виклади свій розрахунок першим: «Доступ» → «Публічне».') },
}

/** розділи бібліотеки: вид речей, розділ сайту з вкладками «Мої · Гільдія · Публічні», значок і про що він */
const HUB: { kind: K; view: 'bases' | 'roadmap' | 'builds' | 'calcs'; title: () => string; about: () => string; icon: typeof Castle }[] = [
  { kind: 'base', view: 'bases', title: () => t('Бази'), about: () => t('Твої бази й бази гільдії: план, 3D, кошторис'), icon: Castle },
  { kind: 'roadmap', view: 'roadmap', title: () => t('Роадмапи'), about: () => t('Що будувати далі, скільки коштує і що вже зроблено'), icon: TrendingUp },
  { kind: 'build', view: 'builds', title: () => t('Уміння'), about: () => t('Планувальник умінь: п’ять шкіл, очки, збірка — посиланням'), icon: Sparkles },
  { kind: 'calc', view: 'calcs', title: () => t('Калькулятор'), about: () => t('Скільки сировини, крафтів, води й часу на будь-який набір предметів і будівель'), icon: Calculator },
]

/**
 * Бібліотека — сторінка, що розводить далі (як головна довідника): бази, роадмапи, уміння й калькулятор картками, на
 * кожній — скільки публічного і вкладки розділу («Мої · Гільдія · Публічні»; без входу — лише публічні).
 */
export function Library() {
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const guild = useAuth((s) => s.guilds)[0] ?? null
  const setView = useStore((s) => s.setView)
  const [totals, setTotals] = useState<Partial<Record<K, number>>>({})
  useEffect(() => {
    let live = true
    for (const h of HUB) library({ kind: h.kind }).then((r) => { if (live) setTotals((x) => ({ ...x, [h.kind]: r.total })) }).catch(() => {})
    return () => { live = false }
  }, [])
  const tabs = (h: (typeof HUB)[number]) => [
    ...(user ? [{ sub: null, label: <>{t('Мої')}</> }] : []),
    ...(user && guild ? [{ sub: 'guild', label: <span className="inline-flex items-center gap-1"><GuildTag tag={guild.tag} color={guild.color} />{t('Гільдія')}</span> }] : []),
    { sub: 'public', label: <>{t('Публічні')}{totals[h.kind] != null && <span className="ml-1 font-mono text-[11px] opacity-70">{totals[h.kind]}</span>}</> },
  ]
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={t('Бібліотека')}
          lead={
            <>
              {t('Бази, білди, роадмапи й розрахунки, які люди й гільдії виклали для всіх. Постав зірку тому, що сподобалось, або скопіюй собі — копія стане твоєю особистою, її можна змінювати як завгодно.')}{' '}
              {ready && (user ? t('Своє викладаєш кнопкою «Доступ» → «Публічне».') : t('Щоб копіювати й ставити зірки — увійди.'))}
            </>
          }
        />
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('Бібліотека')}>
          {HUB.map((h) => {
            const I = h.icon
            // картка — на розділ: своє (без входу — публічне); вкладки — одразу на потрібну
            const main = user ? null : 'public'
            return (
              <li key={h.kind} className="flex flex-col gap-3 rounded-xl border border-line bg-panel p-4 shadow-sm transition-colors hover:border-spice/40">
                <a href={pathOf(h.view, null, false, null, main)} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView(h.view, { sub: main }) }} className="group flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-spice/10 text-spice"><I size={19} /></span>
                  <span className="min-w-0">
                    <span className="block font-display text-[16px] font-bold group-hover:text-spice">{h.title()}</span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-muted">{h.about()}</span>
                  </span>
                </a>
                <div className="mt-auto flex flex-wrap gap-1.5">
                  {tabs(h).map((x) => (
                    <a
                      key={x.sub ?? 'mine'}
                      href={pathOf(h.view, null, false, null, x.sub)}
                      onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView(h.view, { sub: x.sub }) }}
                      className="inline-flex items-center rounded-md border border-line bg-panel2/60 px-2.5 py-1 text-[12.5px] font-medium text-muted hover:border-spice/50 hover:text-ink"
                    >
                      {x.label}
                    </a>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/** публічне одного виду: пошук, порядок, картки, «Показати ще» */
export function LibraryBrowser({ kind }: { kind: K }) {
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const setView = useStore((s) => s.setView)
  const [sort, setSort, sortHref] = useUrlParam<Sort>('sort', 'new', (v) => v === 'stars' || v === 'copies')
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get('q') || '')
  const [rows, setRows] = useState<Item[] | null>(null)
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)
  /** йде запит: список лишається на місці, але притемнений */
  const [busy, setBusy] = useState(true)
  const [more, setMore] = useState(false)
  /** «Спробувати ще» — перечитати з тими ж фільтрами */
  const [attempt, setAttempt] = useState(0)
  /** номер поточного списку (вид, порядок, пошук): відповідь «Показати ще» для старого — відкидаємо */
  const gen = useRef(0)

  useEffect(() => {
    history.replaceState(null, '', urlWith('q', q.trim() || null))
    let live = true
    gen.current++
    setMore(false)
    setBusy(true)
    const timer = setTimeout(() => {
      library({ kind, sort, q: q.trim() })
        .then((r) => { if (live) { setRows(r.rows); setTotal(r.total); setFailed(false) } })
        .catch(() => live && setFailed(true))
        .finally(() => live && setBusy(false))
    }, q ? 250 : 0)
    return () => { live = false; clearTimeout(timer) }
  }, [kind, sort, q, attempt])

  const showMore = async () => {
    const my = gen.current
    setMore(true)
    try {
      const r = await library({ kind, sort, q: q.trim(), offset: rows?.length ?? 0 })
      // поки вантажилось, перемкнули вид чи порядок — це вже чужий список
      if (my !== gen.current) return
      setRows((cur) => [...(cur ?? []), ...r.rows])
      setFailed(false)
    } catch {
      if (my === gen.current) setFailed(true)
    } finally {
      if (my === gen.current) setMore(false)
    }
  }
  // на вхід — без перезавантаження сторінки, і назад сюди ж
  const login = () => setView('login', { search: `?next=${encodeURIComponent(location.pathname + location.search)}` })

  const empty = q.trim() ? (
    <Empty icon={SearchX} title={t('Нічого не знайшлося')} description={t('Спробуй інше слово.')}>
      <Button variant="secondary" onClick={() => setQ('')}>{t('Скинути пошук')}</Button>
    </Empty>
  ) : (
    <Empty icon={LibraryBig} title={t('У бібліотеці поки нічого нема')} description={EMPTY[kind].text}>
      {!user && ready && <Button onClick={login}><LogIn size={15} />{t('Увійти')}</Button>}
    </Empty>
  )

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SnInput type="search" size="lg" className="min-w-[min(280px,100%)] flex-1" modelValue={q} placeholder={t('Пошук за назвою чи описом')} accessibilityLabel={t('Пошук у бібліотеці')} onInput={(e: Event) => setQ(valueOf(e))} />
        <Seg label={t('Порядок')} value={sort} onChange={setSort} href={sortHref} items={[{ id: 'new', label: t('Нові') }, { id: 'stars', label: t('Популярні') }, { id: 'copies', label: t('Копіюють') }]} />
      </div>
      {failed && !rows && <PageError title={t('Бібліотека не завантажилась')} onRetry={() => { setFailed(false); setAttempt((n) => n + 1) }} />}
      {failed && rows && <ErrorAlert message={t('Список не оновився. Онови сторінку трохи згодом.')} />}
      {!rows && !failed && <ItemGridSkeleton />}
      {rows && (
        <div className={busy ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={busy}>
          <ItemGrid items={rows} empty={empty} />
        </div>
      )}
      {rows && rows.length < total && (
        <div className="flex justify-center py-2"><Button variant="secondary" loading={more} onClick={showMore}>{t('Показати ще ({n})', { n: total - rows.length })}</Button></div>
      )}
    </>
  )
}

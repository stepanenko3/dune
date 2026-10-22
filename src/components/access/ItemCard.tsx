/**
 * Картка речі в бібліотеці, на сторінці людини чи гільдії: знімок (база; не вантажиться — значок виду) чи шапка виду —
 * у білда головна школа й очки, у роадмапу прогрес етапів; назва, опис мовою того, хто дивиться, чиє, доступ, зірки й
 * копії. Ctrl/⌘-клік — у новій вкладці, як звичайне посилання.
 */
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Calculator, CalendarDays, Castle, Copy, Inbox, MapPin, RotateCcw, Sparkles, Star, Trash2, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { hrefOf, KIND_LABEL, type Item } from '@/lib/items'
import { purgeBase, removeBase } from '@/lib/bases'
import { cn, plural } from '@/lib/utils'
import { locale, t } from '@/lib/i18n'
import { plainClick } from '@/lib/urlState'
import { aboutText, parseAbout, SCHOOLS } from '@/lib/skills'
import { calcAboutText } from '@/lib/calcs'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import { Empty } from '@/components/states'
import { SnSkeleton } from '@/components/sn'
import { SCHOOL_ICON } from '@/components/skills/icons'
import { RoadmapProgress } from '@/pages/RoadmapList'
import { ConfirmDialog } from '@/pages/Account'
import { AccessBadge, OwnerLink } from './Access'

const ICON = { base: Castle, roadmap: TrendingUp, build: Sparkles, calc: Calculator, marker: MapPin, place: MapPin, event: CalendarDays }

/** відкрити річ: бази й роадмапи — розділом застосунку, решта — адресою */
export function openItem(it: Pick<Item, 'kind' | 'id'>) {
  const setView = useStore.getState().setView
  if (it.kind === 'base') setView('bases', { base: it.id })
  else if (it.kind === 'roadmap') setView('roadmap', { param: it.id })
  else if (it.kind === 'event') setView('events', { param: it.id })
  else {
    const href = hrefOf(it)
    const [path, search] = href.split('?')
    setView(path.slice(1) as 'skills' | 'map', { search: search ? `?${search}` : '' })
  }
}

/** база в кошику: повернути чи стерти назавжди (лише тим, хто нею керує) */
function TrashActions({ it, onChange }: { it: Item; onChange?: () => void }) {
  const [asking, setAsking] = useState(false)
  const back = () => removeBase(it.id, true).then(() => { toast.success(t('«{name}» повернуто', { name: it.title })); onChange?.() }, (e) => toast.error((e as Error).message))
  const purge = () => purgeBase(it.id).then(() => { toast.success(t('«{name}» стерто назавжди', { name: it.title })); onChange?.() }, (e) => toast.error((e as Error).message))
  return (
    <div className="flex flex-wrap gap-1.5 px-3.5 pb-3">
      <Button size="sm" variant="secondary" onClick={back}><RotateCcw size={13} />{t('Повернути')}</Button>
      <Button size="sm" variant="ghost" className="text-bad hover:text-bad" onClick={() => setAsking(true)}><Trash2 size={13} />{t('Видалити назавжди')}</Button>
      {asking && createPortal(
        <ConfirmDialog danger title={t('Стерти «{name}» назавжди — разом з усіма версіями? Повернути вже не вийде.', { name: it.title })} confirm={t('Видалити назавжди')} onClose={() => setAsking(false)} onConfirm={() => void purge()} />,
        document.body,
      )}
    </div>
  )
}

/** шапка картки без знімка: значок і вид; у білда — головна школа й очки по школах, у роадмапу — прогрес етапів */
function KindHead({ it }: { it: Item }) {
  const I = ICON[it.kind]
  const about = it.kind === 'build' ? parseAbout(it.summary) : null
  const schools = about ? [...about.schools].sort((a, b) => b[1] - a[1]) : []
  const top = schools[0]
  const TI = top ? SCHOOL_ICON[top[0]] ?? I : I
  const name = (id: string) => SCHOOLS.find(([x]) => x === id)?.[1] ?? id
  return (
    <div className="grid aspect-[960/300] content-center gap-2 border-b border-line bg-panel2/50 px-4">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-spice/15 text-spice"><TI size={22} /></span>
        <span className="min-w-0 flex-1 truncate font-display text-[12px] font-semibold uppercase tracking-wide text-muted">{top ? name(top[0]) : KIND_LABEL[it.kind][0]}</span>
        {about && <span className="shrink-0 font-mono text-[13px] font-semibold text-ink">{plural(about.total, [t('очко'), t('очки'), t('очок')])}</span>}
        {/* подія — коли (за часом того, хто дивиться) */}
        {it.kind === 'event' && it.when && <span className="shrink-0 text-[13px] font-semibold text-ink">{new Date(it.when.starts).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
      {schools.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {schools.map(([id, n]) => {
            const SI = SCHOOL_ICON[id] ?? I
            return <span key={id} title={name(id)} className="inline-flex items-center gap-1 rounded-full bg-panel px-2 py-0.5 text-[11.5px] text-muted ring-1 ring-line"><SI size={12} className="text-spice" /><b className="font-mono font-semibold text-ink">{n}</b></span>
          })}
        </div>
      )}
      {it.kind === 'roadmap' && <RoadmapProgress summary={it.summary} />}
    </div>
  )
}

/** знімок бази; не вантажиться (ще малюється, помилка) — шапка виду замість білої картки */
function Thumb({ it, gone }: { it: Item; gone: boolean }) {
  const [bad, setBad] = useState(false)
  if (bad) return <KindHead it={it} />
  return (
    <div className="aspect-[960/560] overflow-hidden bg-[var(--plan-bg)]">
      {/* ?v= — щоб після правок бази браузер узяв новий знімок, а не старий з кешу */}
      <img src={`/api/bases/${it.id}/thumb.jpg?v=${it.updated}`} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} className={cn('h-full w-full object-cover transition-transform duration-300', gone ? 'opacity-50 grayscale' : 'group-hover:scale-[1.02]')} />
    </div>
  )
}

/** опис мовою того, хто дивиться (білди й розрахунки зберігають його українською) */
const summaryOf = (it: Item) =>
  // білд, чий опис розібрався, уже показано в шапці (школи й очки) — удруге не пишемо
  it.kind === 'build' ? (parseAbout(it.summary) ? '' : aboutText(it.summary)) : it.kind === 'calc' ? calcAboutText(it.summary) : it.summary

export function ItemCard({ it, onChange }: { it: Item; onChange?: () => void }) {
  // база в кошику — сіра, з поміткою й діями «повернути / стерти назавжди»
  const gone = !!it.deleted
  const summary = summaryOf(it)
  return (
    <li className={cn('group relative flex h-full flex-col overflow-hidden rounded-xl border shadow-sm transition-colors', gone ? 'border-dashed border-line bg-panel2/60 text-muted' : 'border-line bg-panel hover:border-spice/60')}>
      <a href={hrefOf(it)} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); openItem(it) }} className="flex flex-1 flex-col">
        {it.kind === 'base' ? <Thumb it={it} gone={gone} /> : <KindHead it={it} />}
        <div className="flex flex-1 flex-col gap-2 p-3.5">
          <div className="flex items-start gap-2">
            <h3 className={cn('min-w-0 flex-1 font-display text-[15.5px] font-bold leading-snug', gone && 'text-muted line-through decoration-1')}>{it.title}</h3>
            {it.featured && <span className="shrink-0 rounded-full bg-spice px-2 py-0.5 text-[10.5px] font-bold text-on-spice">{t('Вибране')}</span>}
          </div>
          {summary && <p className="line-clamp-2 text-[13px] leading-snug text-muted">{summary}</p>}
          {it.basedOn && <p className="text-[11.5px] text-muted">{t('на основі «{title}»', { title: it.basedOn.title })}</p>}
        </div>
      </a>
      {/* власник — своїм посиланням, тож поза посиланням картки (вкладені посилання не можна) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 pb-3">
        <OwnerLink owner={it.owner} />
        <span className="ml-auto flex items-center gap-2.5 text-[12px] tabular-nums text-muted">
          <span className="inline-flex items-center gap-1" title={t('Зірки')}><Star size={12} className={it.starred ? 'fill-current text-spice' : ''} />{it.stars}</span>
          <span className="inline-flex items-center gap-1" title={t('Скопіювали собі')}><Copy size={12} />{it.copies}</span>
        </span>
      </div>
      {gone && it.can?.manage && <TrashActions it={it} onChange={onChange} />}
      <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1.5">
        <AccessBadge visibility={it.visibility} owner={it.owner} className="pointer-events-auto bg-panel/95 shadow-sm" />
        {gone && <span className="rounded-full bg-ink/80 px-2 py-0.5 text-[11px] font-semibold text-panel shadow-sm">{t('У кошику з {date}', { date: new Date(it.deleted!).toLocaleDateString(locale()) })}</span>}
      </div>
    </li>
  )
}

const GRID = 'grid gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]'

/** empty — рядок (стане заголовком порожнього стану) чи готовий <Empty> з поясненням і діями */
/** onChange — після дії з карткою (повернули чи стерли базу з кошика): перечитати список; видалене — в кінці */
export function ItemGrid({ items, empty, onChange }: { items: Item[]; empty?: ReactNode; onChange?: () => void }) {
  if (!items.length) return typeof empty === 'string' || empty == null ? <Empty icon={Inbox} title={empty || t('Поки порожньо.')} /> : <>{empty}</>
  const sorted = [...items.filter((x) => !x.deleted), ...items.filter((x) => x.deleted)]
  return <ul className={GRID}>{sorted.map((it) => <ItemCard key={`${it.kind}:${it.id}`} it={it} onChange={onChange} />)}</ul>
}

/** скелет сітки, поки список вантажиться: ті самі колонки, що й у ItemGrid */
export function ItemGridSkeleton({ n = 6, height = 300 }: { n?: number; height?: number }) {
  return (
    <ul className={GRID} aria-busy="true" aria-label={t('Завантаження…')}>
      {Array.from({ length: n }, (_, i) => <li key={i}><SnSkeleton height={height} /></li>)}
    </ul>
  )
}

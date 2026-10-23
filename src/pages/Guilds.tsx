/**
 * Гільдії (як у грі — людина лише в одній, у гільдії — не більше guildCap людей): каталог — картки з гербом, регіоном,
 * мовами, стилем гри й розкладом у поясі глядача, фільтри (у адресі), пошук, «Мої заявки», створення нової; сторінка
 * гільдії — блоки її картки (видимі глядачеві), учасники й ролі, вміст, події, заявка за анкетою (/g/…/apply), черга
 * заявок і запрошення (офіцерам), налаштування (офіцерам — картка й набір, лідеру — ще назва й видалення); запрошення.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Calculator, Castle, Check, Settings, ChevronRight, Crown, Inbox, Link2, LogOut, MapPin, Plus, Shield, Sparkles, Trash2, TrendingUp, UserMinus, Users, CalendarClock, ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { del, get, patch, post } from '@/lib/api'
import { GUILD_RANK, GUILD_ROLE_LABEL, roleWithRank, loginHref, useAuth, type Guild, type GuildRole, type MyGuild, type User } from '@/lib/auth'
import type { Item } from '@/lib/items'
import { locale, t, T } from '@/lib/i18n'
import { pathOf, useStore, openPath } from '@/store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ActionsTrigger, Menu } from '@/components/ui/menu'
import { Seg } from '@/components/ui/seg'
import { plainClick, useUrlParam } from '@/lib/urlState'
import { PageHeader } from '@/components/PageHeader'
import { Empty, Loading, PageError } from '@/components/states'
import { Avatar, GuildTag } from '@/components/access/Access'
import { ItemGrid } from '@/components/access/ItemCard'
import { SnCheckbox, SnInput, SnTextarea, checkedOf, valueOf } from '@/components/sn'
import { cn, plural } from '@/lib/utils'
import { Field } from './Auth'
import { ColorPick, ConfirmDialog, Section, submitOnEnter } from './Account'
import { useCrumb } from '@/components/Crumbs'
import { useUnsaved } from '@/components/UnsavedBar'
import { GuildEvents } from '@/components/events/bits'
import { HOUSES, houseOf, useDecree } from '@/lib/decree'
import { Img } from '@/components/ui/img'
import { LANG_CODES, REGION_IDS, SIZES, SIZE_LABEL, STATUS_LABEL, STYLES, STYLE_LABEL, langLabel, regionLabel, sizeOf, type CardProfile, type MyRequest, type Size, type Style } from '@/lib/guildProfile'
import { myZone, summary, toViewer, utcLabel } from '@/lib/weekly'
import { useGuildNotes } from '@/lib/notify-guild'
import { ApplyForm } from './guild/Apply'
import { Queue } from './guild/Queue'
import { GuildSettings } from './guild/Settings'
import { GuildLinks, ProfileBlocks, ProfileFacts } from './guild/Profile'
import type { GuildData, Member } from './guild/types'

const run = async (fn: () => Promise<unknown>, ok?: string) => {
  try { await fn(); if (ok) toast.success(ok); return true } catch (e) { toast.error((e as Error).message); return false }
}
/** зміни в гільдіях міняють і меню облікового запису */
const refreshMe = () => useAuth.getState().load()

/** чи може людина подати заявку в цю гільдію (або чому ні: коротка причина; login — причину показати посиланням на вхід) */
type Join = { can: true } | { can: false; reason: string; login?: boolean }
function joinState(g: Guild, o: { user: User | null; mine: MyGuild | null; cap: number }): Join {
  if (!o.user) return { can: false, reason: t('треба увійти'), login: true }
  if (o.mine) return { can: false, reason: t('ти вже в гільдії') }
  if (!g.open) return { can: false, reason: t('лише за запрошенням') }
  if (g.members >= o.cap) return { can: false, reason: t('гільдія заповнена') }
  return { can: true }
}

/** скільки учасників із ліміту: «12 / 32» і смужка (повна — червона) */
function Capacity({ n, cap, className }: { n: number; cap: number; className?: string }) {
  const full = n >= cap
  return (
    <div className={cn('flex items-center gap-2 text-[12.5px] text-muted', className)} title={t('Учасників: {n} з {cap}', { n, cap })}>
      <Users size={13} aria-hidden />
      <span className={cn('tabular-nums', full && 'font-semibold text-bad')}>{n} / {cap}</span>
      <span className="sr-only">{t('Учасників: {n} з {cap}', { n, cap })}</span>
      <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-panel2" aria-hidden>
        <span className={cn('block h-full rounded-full', full ? 'bg-bad' : 'bg-spice')} style={{ width: `${Math.min(100, Math.round((n / Math.max(1, cap)) * 100))}%` }} />
      </span>
    </div>
  )
}

/** «приймає заявки» / «лише за запрошенням» / «заповнена» */
function StatusChips({ g, cap }: { g: Guild; cap: number }) {
  return (
    <>
      {g.open ? <span className="rounded-full bg-ok/10 px-2 py-0.5 text-[11px] font-semibold text-ok">{t('набір відкрито')}</span> : <span className="rounded-full bg-panel2 px-2 py-0.5 text-[11px] text-muted">{t('за запрошенням')}</span>}
      {g.members >= cap && <span className="rounded-full bg-bad/10 px-2 py-0.5 text-[11px] font-semibold text-bad">{t('заповнена')}</span>}
    </>
  )
}

/** bar — налаштування наявної гільдії: замість кнопки — смуга незбережених змін (components/UnsavedBar) */
/** identity — лише назва, тег, колір і дім (лідерові в налаштуваннях; опис і набір — у картці гільдії) */
function GuildForm({ initial, submit, label, bar, identity }: { initial?: Partial<Guild>; submit: (g: Partial<Guild>) => Promise<unknown>; label: string; bar?: boolean; identity?: boolean }) {
  const from = { name: '', tag: '', about: '', color: '#2f6fd0', open: true, ...initial }
  const [g, setG] = useState<Partial<Guild>>(from)
  const [busy, setBusy] = useState(false)
  const keys = identity ? (['name', 'tag', 'color', 'house'] as const) : (['name', 'tag', 'about', 'color', 'open', 'house'] as const)
  const go = async (e?: FormEvent) => { e?.preventDefault(); setBusy(true); await submit(identity ? Object.fromEntries(keys.map((k) => [k, g[k]])) : g); setBusy(false) }
  const dirty = !!bar && keys.some((k) => (g[k] ?? '') !== (from[k] ?? ''))
  useUnsaved(dirty, { save: () => go(), discard: () => setG(from), label: t('Налаштування гільдії не збережено') })
  return (
    <form onSubmit={go} onKeyDown={submitOnEnter} className="grid gap-3.5">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 sm:grid-cols-[1fr_140px]">
        <Field label={t('Назва')}>
          <SnInput size="lg" modelValue={g.name ?? ''} minLength={3} maxLength={40} required accessibilityLabel={t('Назва')} onInput={(e: Event) => setG({ ...g, name: valueOf(e) })} />
        </Field>
        <Field label={t('Тег')} hint={t('2–5 літер чи цифр')}>
          <SnInput size="lg" className="uppercase" modelValue={g.tag ?? ''} minLength={2} maxLength={5} required accessibilityLabel={t('Тег')} onInput={(e: Event) => setG({ ...g, tag: valueOf(e).toUpperCase() })} />
        </Field>
      </div>
      {!identity && (
        <Field label={t('Про гільдію')}>
          <SnTextarea size="lg" rows={3} modelValue={g.about ?? ''} maxLength={1000} placeholder={t('Сервер, чим займаєтесь, кого шукаєте')} accessibilityLabel={t('Про гільдію')} onInput={(e: Event) => setG({ ...g, about: valueOf(e) })} />
        </Field>
      )}
      <Field label={t('Колір')}><ColorPick value={g.color || '#2f6fd0'} onChange={(color) => setG({ ...g, color })} /></Field>
      {!identity && <SnCheckbox modelValue={!!g.open} label={t('Приймати заявки на вступ (інакше — лише за запрошенням)')} onChange={(e: Event) => setG({ ...g, open: checkedOf(e) })} />}
      <Field label={t('Дім у Ландсрааді')} hint={t('Указ тижня діє лише на людей дому-переможця. Учасникам, які свій дім не вказали, береться цей.')}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('Дім у Ландсрааді')}>
          {[...HOUSES.map((h) => ({ id: h.id, name: h.name, color: h.color as string | null })), { id: null, name: t('Не вказано'), color: null }].map((h) => {
            const on = (g.house ?? null) === h.id
            return (
              <button key={h.id ?? 'none'} type="button" role="radio" aria-checked={on} onClick={() => setG({ ...g, house: h.id })}
                className={cn('flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-[13.5px] font-semibold transition-colors', on ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40')}>
                {h.color && <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: h.color }} aria-hidden />}
                <span className="min-w-0 flex-1">{h.name}</span>
                {on && <Check size={15} className="shrink-0 text-spice" aria-hidden />}
              </button>
            )
          })}
        </div>
      </Field>
      <div className="flex items-center gap-2">
        <GuildTag tag={(g.tag || t('ТЕГ')).slice(0, 5)} color={g.color || '#2f6fd0'} />
        <span className="text-[13px] text-muted">{t('так виглядатиме тег на всьому гільдійському')}</span>
      </div>
      {!bar && <div><Button type="submit" disabled={busy}>{busy ? t('Зберігаю…') : label}</Button></div>}
    </form>
  )
}

type CatalogGuild = Guild & { profile: CardProfile }
interface GuildsData { list: CatalogGuild[]; requests: string[]; myRequests: MyRequest[]; cap: number }

/** герб гільдії чи її тег на кольорі */
function Emblem({ g, emblem, size = 48 }: { g: Guild; emblem: string | null; size?: number }) {
  return (
    <span className={cn('grid shrink-0 place-items-center overflow-hidden rounded-xl font-display font-bold text-white', !emblem && 'px-1', g.tag.length > 4 ? 'text-[10.5px]' : g.tag.length > 3 ? 'text-[12px]' : 'text-[14px]')} style={{ background: g.color, width: size, height: size, minWidth: size }}>
      {emblem ? <Img src={emblem} alt="" width={size} height={size} className="object-cover" style={{ width: size, height: size }} /> : g.tag}
    </span>
  )
}

/** картка гільдії: хто вони, скільки їх із ліміту, чи приймають заявки — і що з цим може людина */
function GuildCard({ g, cap, user, mine, requested, onApply, onCancel }: {
  g: CatalogGuild
  cap: number
  user: User | null
  mine: MyGuild | null
  requested: boolean
  onApply: () => void
  onCancel: () => void
}) {
  const setView = useStore((s) => s.setView)
  const here = mine?.id === g.id
  const join = joinState(g, { user, mine, cap })
  const p = g.profile
  const when = p.schedule.length ? summary(toViewer(p.schedule, p.tz, myZone())) : ''
  return (
    <li className={cn('flex flex-col overflow-hidden rounded-xl border bg-panel shadow-sm transition-colors hover:border-spice/60', here ? 'border-spice/60' : 'border-line')}>
      <div className="h-1.5 shrink-0" style={{ background: g.color }} />
      <a href={`/g/${g.slug}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('guild', { param: g.slug }) }} className="flex flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex items-start gap-3">
          <Emblem g={g} emblem={p.emblem} />
          <div className="min-w-0 flex-1">
            <h3 className="break-words font-display text-[15.5px] font-bold leading-snug">{g.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5"><StatusChips g={g} cap={cap} /></div>
          </div>
        </div>
        {(p.region || p.server || p.langs.length > 0) && (
          <p className="break-words text-[12.5px] leading-snug">
            {[regionLabel(p.region), p.server].filter(Boolean).join(' · ')}
            {p.langs.length > 0 && <span className="text-muted">{(p.region || p.server) ? ' · ' : ''}<span className="first-letter:uppercase">{p.langs.map(langLabel).join(', ')}</span></span>}
          </p>
        )}
        {p.styles.length > 0 && (
          <div className="flex flex-wrap gap-1">{p.styles.map((x) => <span key={x} className="rounded-full bg-spice/10 px-2 py-0.5 text-[11.5px] font-semibold text-spice">{STYLE_LABEL[x]}</span>)}</div>
        )}
        {when && <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-muted"><CalendarClock size={13} className="mt-0.5 shrink-0" aria-hidden /><span className="min-w-0 break-words">{when}</span></p>}
        {g.about && <p className="line-clamp-3 whitespace-pre-line break-words text-[13px] leading-snug text-muted">{g.about}</p>}
        <Capacity n={g.members} cap={cap} className="mt-auto pt-0.5" />
      </a>
      <div className="flex min-h-[3.25rem] flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line px-3.5 py-2.5">
        {here ? (
          <span className="text-[13px] font-semibold text-spice">{t('Твоя гільдія')} · {roleWithRank(mine!.role)}</span>
        ) : requested ? (
          <>
            <Button size="sm" variant="ghost" onClick={onCancel}>{t('Скасувати заявку')}</Button>
            <span className="text-[12px] text-muted">{t('Заявку подано')}</span>
          </>
        ) : join.can ? (
          <Button size="sm" variant="secondary" onClick={onApply}>{t('Подати заявку')}</Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" disabled>{t('Подати заявку')}</Button>
            {join.login
              ? <a href={loginHref()} className="text-[12px] font-medium text-spice hover:underline">{join.reason}</a>
              : <span className="text-[12px] text-muted">{join.reason}</span>}
          </>
        )}
      </div>
    </li>
  )
}

export function Guilds() {
  const { user, guild: mine, site } = useAuth()
  const setView = useStore((s) => s.setView)
  // пошук — в адресі: посилання «гільдії за словом» можна переслати, «Назад» його не губить
  const [q, setQ] = useUrlParam<string>('q', '')
  // які показати — сегментом шляху: /guilds/open (усі — без сегмента)
  const show: 'all' | 'open' = useStore((s) => s.sub) === 'open' ? 'open' : 'all'
  const setShow = (v: 'all' | 'open') => setView('guilds', { sub: v === 'open' ? 'open' : null, search: location.search })
  const showHref = (v: 'all' | 'open') => pathOf('guilds', null, false, null, v === 'open' ? 'open' : null) + location.search
  // шлях: «Гільдії [Усі / Приймають заявки]»
  useCrumb([], { sub: show === 'open' ? 'open' : null, value: show === 'open' ? t('Набір відкрито') : t('Усі') })
  const [data, setData] = useState<GuildsData | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  // фільтри — в адресі (посилання «гільдії EU українською» можна переслати)
  const [region, setRegion, regionHref] = useUrlParam<string>('region', '', (v) => (REGION_IDS as string[]).includes(v))
  const [lang, setLang, langHref] = useUrlParam<string>('lang', '', (v) => LANG_CODES.includes(v))
  const [style, setStyle, styleHref] = useUrlParam<string>('style', '', (v) => (STYLES as string[]).includes(v))
  const [size, setSize, sizeHref] = useUrlParam<string>('size', '', (v) => (SIZES as string[]).includes(v))
  const [tz, setTz, tzHref] = useUrlParam<string>('tz', '', (v) => /^UTC([+−]\d{1,2}(:\d\d)?)?$/.test(v))
  const [server, setServer, serverHref] = useUrlParam<string>('server', '')
  const seq = useRef(0)
  const load = () => {
    const n = ++seq.current
    return get<GuildsData>(`/api/guilds?q=${encodeURIComponent(q)}`)
      .then((r) => { if (n === seq.current) { setData(r); setError('') } })
      .catch((e) => { if (n === seq.current) setError((e as Error).message) })
  }
  useEffect(() => { const h = setTimeout(load, q ? 250 : 0); return () => clearTimeout(h) }, [q])
  const cap = data?.cap ?? site.guildCap
  const all = data?.list ?? []
  const list = useMemo(() => all.filter((g) => (show === 'all' || g.open)
    && (!region || g.profile.region === region) && (!lang || g.profile.langs.includes(lang)) && (!style || g.profile.styles.includes(style as Style))
    && (!size || sizeOf(g.members) === size) && (!tz || (g.profile.tz && utcLabel(g.profile.tz) === tz)) && (!server || g.profile.server.toLowerCase() === server.toLowerCase())), [data, show, region, lang, style, size, tz, server])
  const filtered = !!(region || lang || style || size || tz || server)
  /** гільдій на сайті нема взагалі (а не «нічого не знайшлося») */
  const noGuilds = !!data && !data.list.length && !q && show === 'all' && !filtered
  // варіанти фільтрів — лише ті, що є серед гільдій (і вибраний, навіть якщо зник)
  const present = <T extends string>(vals: T[], cur: string) => [...new Set([...vals, ...(cur ? [cur as T] : [])])]
  const regions = present(REGION_IDS.filter((r) => all.some((g) => g.profile.region === r)), region)
  const langs = present(LANG_CODES.filter((c) => all.some((g) => g.profile.langs.includes(c))), lang)
  const styles = present(STYLES.filter((x) => all.some((g) => g.profile.styles.includes(x))), style)
  const zones = present([...new Set(all.map((g) => (g.profile.tz ? utcLabel(g.profile.tz) : '')).filter(Boolean))].sort((a, b) => zoneMins(a) - zoneMins(b)), tz)
  const servers = present([...new Set(all.map((g) => g.profile.server).filter(Boolean))].sort((a, b) => a.localeCompare(b)), server)
  const filters: { key: string; label: string; value: string; set: (v: string) => void; href: (v: string) => string; items: { id: string; label: string }[] }[] = [
    { key: 'region', label: t('Регіон'), value: region, set: setRegion, href: regionHref, items: regions.map((r) => ({ id: r, label: regionLabel(r) })) },
    { key: 'tz', label: t('Пояс'), value: tz, set: setTz, href: tzHref, items: zones.map((z) => ({ id: z, label: z })) },
    { key: 'server', label: t('Сервер'), value: server, set: setServer, href: serverHref, items: servers.map((x) => ({ id: x, label: x })) },
    { key: 'lang', label: t('Мова'), value: lang, set: setLang, href: langHref, items: langs.map((c) => ({ id: c, label: langLabel(c) })) },
    { key: 'style', label: t('Стиль гри'), value: style, set: setStyle, href: styleHref, items: styles.map((x) => ({ id: x, label: STYLE_LABEL[x as Style] })) },
    { key: 'size', label: t('Розмір'), value: size, set: setSize, href: sizeHref, items: SIZES.map((x) => ({ id: x, label: SIZE_LABEL[x as Size] })) },
  ].filter((f) => f.items.length > 0 && (f.key !== 'size' || all.length > 1))
  const clear = () => { for (const f of filters) if (f.value) f.set('') }
  // непрочитані сповіщення про власні заявки (прийнято, відхилено) — підсвітити в «Моїх заявках» і позначити прочитаними
  const { notes, read } = useGuildNotes(!!user)
  const fresh = new Set(notes.filter((n) => n.kind !== 'guild.app.new').map((n) => n.data.guild as string))
  useEffect(() => { const mineNotes = notes.filter((n) => n.kind !== 'guild.app.new'); if (mineNotes.length) { const h = setTimeout(() => read(mineNotes), 4000); return () => clearTimeout(h) } }, [notes])
  const myReqs = (data?.myRequests ?? []).filter((r) => r.status !== 'closed' || fresh.has(r.guild.id)).slice(0, 6)
  const apply = (g: Guild) => setView('guild', { param: g.slug, sub: 'apply' })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={t('Усі гільдії')}
          lead={t('Гільдійські бази, роадмапи, білди й позначки на мапі бачать усі учасники. Вступають за запрошенням офіцера чи заявкою.')}
          actions={
            !user ? <Button onClick={() => openPath(loginHref())}>{t('Увійти, щоб вступити чи створити')}</Button>
              : mine ? (
                <>
                  <span className="text-[12.5px] text-muted">{t('ти вже в гільдії')}</span>
                  <Button disabled><Plus size={15} />{t('Створити гільдію')}</Button>
                </>
              ) : <Button onClick={() => setCreating(!creating)}><Plus size={15} />{t('Створити гільдію')}</Button>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <SnInput type="search" size="lg" className="block min-w-[min(220px,100%)] flex-1" modelValue={q} placeholder={t('Назва чи тег')} accessibilityLabel={t('Пошук гільдій')} onInput={(e: Event) => setQ(valueOf(e), { replace: true })} />
            <Seg label={t('Які показати')} value={show} onChange={setShow} href={showHref} items={[{ id: 'all', label: t('Усі') }, { id: 'open', label: t('Набір відкрито') }]} />
          </div>
          {filters.length > 0 && (
            <div className="mt-2.5 grid gap-2" role="group" aria-label={t('Фільтри')}>
              {filters.map((f) => (
                <div key={f.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:grid sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-3">
                  <span className="text-[12.5px] font-semibold text-muted">{f.label}</span>
                  <Seg size="sm" label={f.label} value={f.value} onChange={f.set} href={f.href} items={[{ id: '', label: t('Усі') }, ...f.items]} />
                </div>
              ))}
              {filtered && <div><Button size="sm" variant="ghost" onClick={clear}>{t('Скинути фільтри')}</Button></div>}
            </div>
          )}
        </PageHeader>
        {mine && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-spice/40 bg-spice/5 px-4 py-3">
            <GuildTag tag={mine.tag} color={mine.color} />
            {/* на телефоні текст на всю ширину, кнопка — рядком нижче (а не текст стовпчиком між значком і кнопкою) */}
            <p className="min-w-[min(100%,16rem)] flex-1 text-[13.5px] leading-snug">
              {t('Ти в гільдії «{name}» ({role}). Щоб вступити в іншу чи створити свою, спершу вийди з поточної.', { name: mine.name, role: GUILD_ROLE_LABEL[mine.role] })}
            </p>
            <Button size="sm" variant="secondary" onClick={() => setView('guild', { param: mine.slug })}>{t('До моєї гільдії')}</Button>
          </div>
        )}
        {myReqs.length > 0 && !mine && (
          <section className="grid gap-2 rounded-xl border border-line bg-panel px-4 py-3 shadow-sm" aria-label={t('Мої заявки')}>
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-bold"><ClipboardList size={15} className="text-spice" />{t('Мої заявки')}</h2>
            <ul className="grid gap-1.5">
              {myReqs.map((r) => (
                <li key={r.guild.id} className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg px-2 py-1.5', fresh.has(r.guild.id) && 'bg-spice/10')}>
                  <GuildTag tag={r.guild.tag} color={r.guild.color} />
                  <a href={`/g/${r.guild.slug}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('guild', { param: r.guild.slug }) }} className="min-w-0 break-words text-[13.5px] font-semibold hover:text-spice">{r.guild.name}</a>
                  <span className={cn('text-[12.5px] font-semibold', r.status === 'accepted' ? 'text-ok' : r.status === 'rejected' ? 'text-bad' : 'text-muted')}>{STATUS_LABEL[r.status]}</span>
                  {r.reason && <span className="basis-full break-words text-[12.5px] text-muted sm:basis-auto">{t('Причина: {reason}', { reason: r.reason })}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {creating && !mine && (
          <Section title={t('Нова гільдія')} hint={t('Ти станеш її лідером; потім запросиш согільдійців посиланням.')}>
            <GuildForm label={t('Створити')} submit={(g) => run(async () => { const r = await post<{ guild: Guild }>('/api/guilds', g); await refreshMe(); setView('guild', { param: r.guild.slug }) }, t('Гільдію створено'))} />
          </Section>
        )}
        {error ? <PageError message={error} onRetry={load} />
          : !data ? <Loading />
            : !list.length ? (
              <Empty icon={Users} title={noGuilds ? t('Гільдій ще нема') : q.trim() || filtered ? t('Не знайшлося.') : t('Нема відкритих гільдій')}
                description={noGuilds ? t('Стань першим: створи гільдію й запроси согільдійців посиланням.') : filtered ? t('Спробуй прибрати якийсь фільтр.') : q.trim() ? t('Спробуй іншу назву чи тег.') : t('Зараз жодна гільдія не приймає заявок — вступають за запрошенням.')}>
                {noGuilds && user && !mine && <Button onClick={() => setCreating(true)}><Plus size={15} />{t('Створити гільдію')}</Button>}
                {filtered && <Button variant="secondary" onClick={clear}>{t('Скинути фільтри')}</Button>}
              </Empty>
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
                {list.map((g) => (
                  <GuildCard key={g.id} g={g} cap={cap} user={user} mine={mine} requested={data.requests.includes(g.id)} onApply={() => apply(g)}
                    onCancel={() => run(async () => { await del(`/api/guilds/${g.slug}/requests`); load() }, t('Заявку скасовано'))} />
                ))}
              </ul>
            )}
      </div>
    </div>
  )
}

/** «UTC+5:30» → хвилини (для порядку поясів у фільтрі) */
const zoneMins = (z: string) => { const m = /^UTC(?:([+−])(\d{1,2})(?::(\d\d))?)?$/.exec(z); return m && m[1] ? (m[1] === '−' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : 0 }

// ---------- сторінка гільдії ----------
type Tab = 'home' | 'members' | 'items' | 'events' | 'invites' | 'requests' | 'settings' | 'apply'
const TABS: Tab[] = ['home', 'members', 'items', 'events', 'invites', 'requests', 'settings', 'apply']

export function GuildPage() {
  const slug = useStore((s) => s.param)
  const setView = useStore((s) => s.setView)
  const me = useAuth((s) => s.user)
  const mine = useAuth((s) => s.guild)
  const [d, setD] = useState<GuildData | null>(null)
  const [error, setError] = useState('')
  // вкладка — сегментом шляху: /g/<адреса>/items (головна — без сегмента)
  const sub = useStore((s) => s.sub)
  const tabParam: Tab = TABS.includes(sub as Tab) ? (sub as Tab) : 'home'
  const setTab = (v: Tab) => setView('guild', { param: slug, sub: v })
  const tabHref = (v: Tab) => pathOf('guild', null, false, slug, v)
  const [own, setOwn] = useState<Item[] | null>(null)
  const [leaving, setLeaving] = useState(false)
  const load = () => get<GuildData>(`/api/guilds/${slug}`).then((x) => { setD(x); setError('') }).catch((e) => setError((e as Error).message))
  useEffect(() => { setD(null); setOwn(null); load() }, [slug])
  const loadOwn = () => d && get<{ rows: Item[] }>(`/api/items?scope=guild:${d.guild.id}`).then((r) => setOwn(r.rows)).catch(() => setOwn([]))
  // вміст гільдії — учасникам на головній і у «Вмісті» (решті — лише публічне, воно вже в d.public)
  useEffect(() => { if (d?.rank && (tabParam === 'items' || tabParam === 'home') && !own) void loadOwn() }, [d, tabParam])
  // шлях: «Гільдії [Усі]» › назва › вкладка (окрема сторінка; головна — без неї)
  const TAB_CRUMB: Partial<Record<Tab, string>> = { members: t('Учасники'), items: d?.rank ? t('Вміст гільдії') : t('Публічне'), events: t('Події'), invites: t('Запрошення'), requests: t('Заявки'), settings: t('Налаштування'), apply: t('Заявка') }
  useCrumb(error ? [] : d ? [{ label: d.guild.name, view: 'guild', param: slug ?? undefined }, ...(TAB_CRUMB[tabParam] ? [{ label: TAB_CRUMB[tabParam]! }] : [])] : null)
  // свої сповіщення про цю гільдію (заявку прийнято чи відхилено) — показані на сторінці, тож прочитані
  const { notes, read } = useGuildNotes(!!me && !!d, d?.guild.id)
  const fresh = notes.filter((n) => n.kind !== 'guild.app.new')
  useEffect(() => { if (fresh.length) read(fresh) }, [notes])
  if (error) return <PageError page message={error} onRetry={load} />
  if (!d) return <Loading page />
  const g = d.guild
  const officer = d.rank >= GUILD_RANK.officer, leader = d.rank >= GUILD_RANK.leader
  const full = g.members >= d.cap
  const join = joinState(g, { user: me, mine, cap: d.cap })
  const tabs = [
    { id: 'home' as const, label: t('Головна') },
    { id: 'members' as const, label: t('Учасники · {n} з {cap}', { n: g.members, cap: d.cap }) },
    { id: 'items' as const, label: d.rank ? t('Вміст гільдії') : t('Публічне') },
    { id: 'events' as const, label: t('Події') },
    ...(officer ? [{ id: 'requests' as const, label: d.requests.length ? t('Заявки · {n}', { n: d.requests.length }) : t('Заявки') }, { id: 'invites' as const, label: t('Запрошення') }] : []),
    ...(officer ? [{ id: 'settings' as const, label: t('Налаштування') }] : []),
  ]
  const myRole = d.role && d.role !== 'admin' ? d.role : null
  // вкладка з адреси, якої цій людині не видно (запрошення й налаштування — офіцерам), — головна; заявка — тим, хто ще не в гільдії
  const tab: Tab = tabParam === 'apply' ? (!d.rank && me ? 'apply' : 'home') : tabs.some((x) => x.id === tabParam) ? tabParam : 'home'
  const req = d.request
  const showSeg = tab !== 'apply'

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          // значки — у рядку з назвою (як у баз і роадмапів)
          badges={
            <>
              {d.profile.emblem && <Emblem g={g} emblem={d.profile.emblem} size={28} />}
              <GuildTag tag={g.tag} color={g.color} className="px-2 py-0.5 text-[12.5px]" />
              <span className={cn('inline-flex items-center gap-1 text-[12.5px]', full ? 'font-semibold text-bad' : 'text-muted')} title={t('Учасників: {n} з {cap}', { n: g.members, cap: d.cap })}>
                <Users size={13} aria-hidden />{g.members} / {d.cap}
              </span>
              <StatusChips g={g} cap={d.cap} />
              {myRole && <span className="text-[12.5px] text-muted"><T text="ти — {role}" role={<b className="font-semibold text-spice">{roleWithRank(myRole)}</b>} /></span>}
              {d.role === 'admin' && <span className="text-[12.5px] text-muted">{t('ти адміністратор сайту')}</span>}
            </>
          }
          title={g.name}
          lead={g.about ? <span className="whitespace-pre-line">{g.about}</span> : undefined}
          actions={
            <>
              {!d.rank && tab !== 'apply' && (me
                ? req?.status === 'pending' ? (
                  <>
                    <span className="text-[12.5px] text-muted">{t('Заявку подано — чекає розгляду')}</span>
                    <Button variant="secondary" onClick={() => setTab('apply')}>{t('Змінити заявку')}</Button>
                    <Button variant="ghost" onClick={() => run(async () => { await del(`/api/guilds/${g.slug}/requests`); load() }, t('Заявку скасовано'))}>{t('Скасувати заявку')}</Button>
                  </>
                ) : join.can ? <Button onClick={() => setTab('apply')}>{req?.status === 'rejected' ? t('Подати знову') : t('Подати заявку')}</Button>
                  : (
                    <>
                      <span className="text-[12.5px] text-muted">{join.reason}</span>
                      <Button disabled>{t('Подати заявку')}</Button>
                    </>
                  )
                : <Button onClick={() => openPath(loginHref())}>{t('Увійти')}</Button>)}
              {/* рідше потрібне — у меню «Дії»: вийти, налаштування й видалення (лідерові) */}
              {(myRole && myRole !== 'leader') || officer ? (
                <Menu
                  trigger={<ActionsTrigger />}
                  items={[
                    ...(officer ? [{ label: t('Налаштування'), icon: <Settings size={14} />, onSelect: () => setTab('settings') }] : []),
                    ...(myRole && myRole !== 'leader' ? [{ label: t('Вийти з гільдії'), icon: <LogOut size={14} />, onSelect: () => setLeaving(true) }] : []),
                    ...(leader ? [{ kind: 'separator' as const }, { label: t('Видалити гільдію'), icon: <Trash2 size={14} />, danger: true, onSelect: () => setTab('settings') }] : []),
                  ]}
                />
              ) : null}
            </>
          }
        >
          {showSeg && <div><Seg label={t('Розділ гільдії')} value={tab} onChange={setTab} href={tabHref} items={tabs} /></div>}
        </PageHeader>
        {/* відповідь на заявку — тому, хто її подав (поки не в гільдії) */}
        {!d.rank && req && req.status === 'rejected' && tab !== 'apply' && (
          <p className="rounded-xl border border-bad/40 bg-bad/5 px-4 py-3 text-[13.5px] leading-snug">
            <b className="font-semibold">{t('Заявку відхилено.')}</b>{req.reason ? ` ${t('Причина: {reason}', { reason: req.reason })}` : ''}{g.open ? ` ${t('Можна подати знову.')}` : ''}
          </p>
        )}
        {!d.rank && me && !g.open && tab === 'home' && <p className="rounded-xl border border-line bg-panel px-4 py-3 text-[13.5px] leading-snug text-muted">{t('Набір закрито — вступають лише за запрошенням. Попроси його в офіцерів гільдії.')}</p>}
        {leaving && (
          <ConfirmDialog title={t('Вийти з гільдії «{name}»?', { name: g.name })} confirm={t('Вийти з гільдії')} onClose={() => setLeaving(false)}
            onConfirm={() => run(async () => { await post(`/api/guilds/${g.slug}/leave`); await refreshMe(); setView('guilds') }, t('Ти вийшов з гільдії'))} />
        )}

        {tab === 'home' && <GuildHome d={d} own={own} go={setTab} />}
        {tab === 'members' && <Members d={d} reload={load} />}
        {tab === 'items' && (d.rank ? (own ? <OwnContent items={own} onChange={() => void loadOwn()} /> : <Loading />) : <ItemGrid items={d.public} empty={t('Гільдія ще нічого не виклала публічно.')} />)}
        {tab === 'events' && <GuildEvents guild={g} canCreate={d.rank >= GUILD_RANK.member} />}
        {tab === 'invites' && officer && <Invites d={d} reload={load} />}
        {tab === 'apply' && <ApplyForm d={d} onCancel={() => setTab('home')} onDone={() => { void load(); setTab('home') }} />}
        {tab === 'requests' && officer && <Queue d={d} onChange={load} />}
        {tab === 'settings' && officer && (
          <>
            <GuildSettings d={d} reload={load} />
            {leader && (
              <>
                <Section title={t('Назва, тег, колір і дім')} hint={t('Це міняє лише лідер.')}>
                  <GuildForm bar identity initial={g} label={t('Зберегти')} submit={(x) => run(async () => { await patch(`/api/guilds/${g.slug}`, x); await refreshMe(); load(); void useDecree.getState().load() }, t('Збережено'))} />
                </Section>
                <DeleteGuild g={g} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** видалення гільдії: у вікні — спершу ввести її тег */
function DeleteGuild({ g }: { g: Guild }) {
  const setView = useStore((s) => s.setView)
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const ok = typed.trim().toUpperCase() === g.tag.toUpperCase()
  const go = () => {
    if (!ok) return
    setOpen(false)
    void run(async () => { await del(`/api/guilds/${g.slug}`); await refreshMe(); setView('guilds') }, t('Гільдію видалено'))
  }
  return (
    <Section title={t('Видалити гільдію')} danger hint={t('Учасники вийдуть, запрошення й заявки зникнуть. Гільдійські бази, роадмапи, білди й позначки стануть твоїми особистими.')}>
      <Button variant="destructive" onClick={() => { setTyped(''); setOpen(true) }}>
        <Trash2 size={15} />{t('Видалити гільдію')}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title={t('Видалити гільдію «{name}»?', { name: g.name })}
        description={t('Щоб видалити, введи тег гільдії: {tag}', { tag: g.tag })}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('Скасувати')}</Button>
            <Button variant="destructive" disabled={!ok} onClick={go}>{t('Видалити гільдію')}</Button>
          </>
        }
      >
        <SnInput size="lg" className="uppercase" modelValue={typed} placeholder={g.tag} accessibilityLabel={t('Тег')} onInput={(e: Event) => setTyped(valueOf(e))}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); go() } }} />
      </Modal>
    </Section>
  )
}

/** гільдійське, поділене за видами */
function OwnContent({ items, onChange }: { items: Item[]; onChange: () => void }) {
  const groups = useMemo(() => (['base', 'roadmap', 'build', 'calc', 'event', 'marker', 'place'] as const).map((k) => [k, items.filter((i) => i.kind === k)] as const).filter(([, l]) => l.length), [items])
  const NAME = { base: t('Бази'), roadmap: t('Роадмапи'), build: t('Білди'), calc: t('Розрахунки'), event: t('Події'), marker: t('Позначки на мапі'), place: t('Записи ресурсів') }
  if (!groups.length) return <ItemGrid items={[]} empty={t('У гільдії поки нічого нема. Створюючи базу, роадмап чи білд, вибери власником гільдію.')} />
  return (
    <div className="grid gap-3">
      {groups.map(([k, l]) => (
        <div key={k} className="grid gap-2">
          <h2 className="px-1 font-display text-[15px] font-bold">{NAME[k]} <span className="font-normal text-muted">{l.length}</span></h2>
          <ItemGrid items={l} onChange={onChange} />
        </div>
      ))}
    </div>
  )
}

/**
 * Головна гільдії: що в ній є (бази, роадмапи, білди, розрахунки, позначки — числами, клік веде у «Вміст»), найсвіжіше
 * й поруч — сама гільдія: заснована, скільки місць, як вступити, керівництво й нові учасники; офіцерам — заявки, що
 * чекають. Учасники бачать увесь вміст гільдії, решта — те, що гільдія виклала для всіх.
 */
function GuildHome({ d, own, go }: { d: GuildData; own: Item[] | null; go: (t: Tab) => void }) {
  const g = d.guild
  const member = d.rank > 0
  const items = member ? own : d.public
  const officer = d.rank >= GUILD_RANK.officer
  const KINDS = [
    { k: 'base', label: t('Бази'), icon: Castle },
    { k: 'roadmap', label: t('Роадмапи'), icon: TrendingUp },
    { k: 'build', label: t('Білди'), icon: Sparkles },
    { k: 'calc', label: t('Розрахунки'), icon: Calculator },
    ...(member ? [{ k: 'marker', label: t('Позначки на мапі'), icon: MapPin }] : []),
  ] as const
  const count = (k: string) => (items ?? []).filter((i) => i.kind === k && !i.deleted).length
  // чужим публічні бази вже показує свій блок картки — тут без них
  const basesBlock = !member && d.profile.show.bases !== 'hidden'
  const fresh = [...(items ?? [])].filter((i) => !i.deleted && i.kind !== 'marker' && i.kind !== 'place' && !(basesBlock && i.kind === 'base')).sort((a, b) => b.updated - a.updated).slice(0, 6)
  const lead = d.members.filter((m) => m.role === 'leader' || m.role === 'officer').sort((a, b) => GUILD_RANK[b.role] - GUILD_RANK[a.role])
  const newbies = member ? [...d.members].sort((a, b) => b.joined - a.joined).slice(0, 4) : []
  const pct = Math.min(100, Math.round((g.members / Math.max(1, d.cap)) * 100))
  const person = (m: Member) => (
    <li key={m.id}>
      <a href={`/u/${m.login}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); useStore.getState().setView('user', { param: m.login }) }} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-panel2/70">
        <Avatar name={m.name} color={m.color} size={28} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{m.name}</span>
        <span className="shrink-0 text-[12px] text-muted">{GUILD_ROLE_LABEL[m.role]}</span>
      </a>
    </li>
  )
  const more = (label: string, to: Tab) => (
    <button type="button" onClick={() => go(to)} className="inline-flex items-center gap-0.5 text-[12.5px] font-medium text-muted hover:text-spice">{label}<ChevronRight size={14} /></button>
  )
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-2.5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid min-w-0 gap-2.5">
        {/* чужим спершу — те, що гільдія розповідає про себе для набору */}
        {!member && <ProfileBlocks d={d} />}
        {/* що в гільдії — числами */}
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2.5 sm:grid-cols-3 xl:grid-cols-5 [&>li]:min-w-0" aria-label={member ? t('Вміст гільдії') : t('Публічне')}>
          {KINDS.map(({ k, label, icon: I }) => (
            <li key={k}>
              <button type="button" onClick={() => go('items')} className="group flex w-full items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-3 text-left shadow-sm transition-colors hover:border-spice/50">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-spice/10 text-spice"><I size={17} /></span>
                <span className="min-w-0">
                  <span className="block font-mono text-[20px] font-semibold leading-none tabular-nums">{items ? count(k) : '…'}</span>
                  <span className="mt-1 block break-words text-[12.5px] leading-snug text-muted group-hover:text-ink">{label}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <section className="grid gap-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
            <h2 className="font-display text-[16px] font-bold">{member ? t('Нове в гільдії') : t('Гільдія виклала для всіх')}</h2>
            {!!items?.length && more(t('Усе'), 'items')}
          </div>
          {!items ? <Loading /> : (
            <ItemGrid items={fresh} empty={<Empty icon={Inbox} title={member ? t('У гільдії поки нічого нема') : t('Гільдія ще нічого не виклала публічно.')} description={member ? t('Створюючи базу, роадмап чи білд, вибери власником гільдію — і воно з’явиться тут.') : undefined} />} />
          )}
        </section>
        {member && <ProfileBlocks d={d} />}
      </div>
      <aside className="grid gap-2.5">
        {officer && d.requests.length > 0 && (
          <button type="button" onClick={() => go('requests')} className="flex items-center gap-3 rounded-xl border border-spice/50 bg-spice/10 px-4 py-3 text-left shadow-sm hover:bg-spice/15">
            <Inbox size={18} className="shrink-0 text-spice" />
            <span className="min-w-0 flex-1 text-[13.5px] font-semibold">{t('Заявок на вступ: {n}', { n: d.requests.length })}</span>
            <ChevronRight size={16} className="text-muted" />
          </button>
        )}
        <Section title={t('Про гільдію')}>
          <dl className="grid gap-2.5 text-[13.5px]">
            <div className="flex items-center justify-between gap-3"><dt className="text-muted">{t('Тег')}</dt><dd><GuildTag tag={g.tag} color={g.color} /></dd></div>
            <ProfileFacts p={d.profile} />
            <div className="flex items-center justify-between gap-3"><dt className="text-muted">{t('Заснована')}</dt><dd className="font-medium">{new Date(g.created).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })}</dd></div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3"><dt className="text-muted">{t('Учасники')}</dt><dd className="font-mono font-semibold tabular-nums">{g.members} / {d.cap}</dd></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-panel2" aria-hidden><div className={cn('h-full rounded-full', pct >= 100 ? 'bg-bad' : 'bg-spice')} style={{ width: `${pct}%` }} /></div>
            </div>
            <div className="flex items-center justify-between gap-3"><dt className="text-muted">{t('Набір')}</dt><dd className="font-medium">{g.open ? t('відкрито') : t('за запрошенням')}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-muted">{t('Дім у Ландсрааді')}</dt><dd className="flex items-center gap-1.5 text-right font-medium">{houseOf(g.house) ? <><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: houseOf(g.house)!.color }} aria-hidden />{houseOf(g.house)!.name}</> : <span className="text-muted">{t('не вказано')}</span>}</dd></div>
          </dl>
          <div className="mt-3 empty:hidden"><GuildLinks p={d.profile} /></div>
        </Section>
        {(member || d.profile.show.officers !== 'hidden') && (
          <Section title={t('Керівництво')}>
            {lead.length ? <ul className="-mx-1.5 grid gap-0.5">{lead.map(person)}</ul> : <p className="text-[13px] text-muted">{t('Поки нікого.')}</p>}
          </Section>
        )}
        {member && (
          <Section title={t('Нові учасники')}>
            <ul className="-mx-1.5 grid gap-0.5">{newbies.map(person)}</ul>
            <div className="mt-2">{more(t('Усі учасники'), 'members')}</div>
          </Section>
        )}
      </aside>
    </div>
  )
}

/** що може роль — у підтвердженні зміни ролі */
const ROLE_CAN: Partial<Record<GuildRole, string>> = {
  recruit: t('Новобранець лише бачить гільдійське.'),
  member: t('Учасник бачить, створює й змінює гільдійське.'),
  officer: t('Офіцер ще й видаляє, міняє доступ, приймає заявки й запрошує.'),
}

function Members({ d, reload }: { d: GuildData; reload: () => void }) {
  const me = useAuth((s) => s.user)
  const g = d.guild
  const leader = d.rank >= GUILD_RANK.leader
  const officer = d.rank >= GUILD_RANK.officer
  const [ask, setAsk] = useState<{ m: Member; act: 'kick' | 'lead' | 'role'; role?: GuildRole } | null>(null)
  const setRole = (m: Member, role: GuildRole) => run(async () => { await patch(`/api/guilds/${g.slug}/members/${m.id}`, { role }); reload(); refreshMe() }, t('Роль змінено: {name} — {role}', { name: m.name, role: GUILD_ROLE_LABEL[role] }))
  const kick = (m: Member) => run(async () => { await del(`/api/guilds/${g.slug}/members/${m.id}`); reload() }, t('{name} більше не в гільдії', { name: m.name }))
  return (
    <Section title={t('Учасники')} hint={d.rank ? t('Новобранець бачить гільдійське; учасник ще й створює й змінює; офіцер ще й видаляє, міняє доступ, приймає й запрошує; лідер — усе.') : t('Склад гільдії бачать її учасники; тут — лідер і офіцери.')}>
      <ul className="divide-y divide-line">
        {d.members.map((m) => {
          const mine = m.id === me?.id
          // хто кого може змінювати: лідер — усіх, крім себе; офіцер — тих, хто нижче за офіцера
          const manage = !mine && officer && (leader || GUILD_RANK[m.role] < GUILD_RANK.officer) && m.role !== 'leader'
          const roles: GuildRole[] = leader ? ['recruit', 'member', 'officer'] : ['recruit', 'member']
          return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <Avatar name={m.name} color={m.color} size={32} />
              <div className="min-w-0 flex-1">
                <a href={`/u/${m.login}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); useStore.getState().setView('user', { param: m.login }) }} className="text-[14px] font-semibold hover:text-spice">{m.name}</a>
                <div className="text-[12px] text-muted">{[`@${m.login}`, m.nick && t('у грі {nick}', { nick: m.nick }), m.seen && t('був {date}', { date: new Date(m.seen).toLocaleDateString(locale()) })].filter(Boolean).join(' · ')}</div>
              </div>
              {manage ? (
                <>
                  <Seg size="sm" label={t('Роль: {name}', { name: m.name })} value={m.role} onChange={(r) => setAsk({ m, act: 'role', role: r })} items={roles.map((r) => ({ id: r, label: roleWithRank(r) }))} />
                  {leader && <Button size="sm" variant="ghost" title={t('Передати лідерство')} aria-label={t('Передати лідерство')} onClick={() => setAsk({ m, act: 'lead' })}><Crown size={14} /></Button>}
                  <Button size="sm" variant="ghost" title={t('Вигнати')} aria-label={t('Вигнати')} onClick={() => setAsk({ m, act: 'kick' })}><UserMinus size={14} /></Button>
                </>
              ) : (
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold', m.role === 'leader' ? 'bg-spice/15 text-spice' : m.role === 'officer' ? 'bg-ok/10 text-ok' : 'bg-panel2 text-muted')}>
                  {m.role === 'leader' && <Crown size={12} />}{m.role === 'officer' && <Shield size={12} />}{GUILD_ROLE_LABEL[m.role]}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {ask?.act === 'kick' && <ConfirmDialog danger title={t('Вигнати {name} з гільдії?', { name: ask.m.name })} confirm={t('Вигнати')} onClose={() => setAsk(null)} onConfirm={() => kick(ask.m)} />}
      {ask?.act === 'role' && ask.role && (
        <ConfirmDialog title={t('Змінити роль {name}?', { name: ask.m.name })} text={t('{from} → {to}. {what}', { from: GUILD_ROLE_LABEL[ask.m.role], to: GUILD_ROLE_LABEL[ask.role], what: ROLE_CAN[ask.role] })}
          confirm={t('Змінити роль')} onClose={() => setAsk(null)} onConfirm={() => setRole(ask.m, ask.role!)} />
      )}
      {ask?.act === 'lead' && <ConfirmDialog title={t('Передати лідерство')} text={t('Передати лідерство гільдії {name}? Ти станеш офіцером.', { name: ask.m.name })} confirm={t('Передати')} onClose={() => setAsk(null)} onConfirm={() => setRole(ask.m, 'leader')} />}
    </Section>
  )
}

function Invites({ d, reload }: { d: GuildData; reload: () => void }) {
  const [days, setDays] = useState<'1' | '7' | '30' | '0'>('7')
  // за замовчуванням — на одного: посилання, що втекло в чат, не впустить усіх
  const [uses, setUses] = useState<'1' | '5' | '25' | '0'>('1')
  const [role, setRole] = useState<'recruit' | 'member'>('member')
  const g = d.guild
  const link = (code: string) => `${location.origin}/invite/${code}`
  const copy = (code: string) => navigator.clipboard?.writeText(link(code)).then(() => toast.success(t('Посилання скопійовано')), () => toast.info(link(code)))
  return (
    <Section title={t('Запрошення')} hint={t('Посилання для согільдійців: хто його відкриє й увійде, стане учасником. Лише тим, хто ще не в гільдії.')}>
      {g.members >= d.cap && <p className="mb-3 text-[13px] font-medium text-bad">{t('Гільдія заповнена ({n} з {cap}): запрошення спрацюють, коли звільниться місце.', { n: g.members, cap: d.cap })}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5"><span className="text-[12.5px] font-semibold">{t('Діє')}</span><Seg label={t('Термін')} value={days} onChange={setDays} items={[{ id: '1', label: t('добу') }, { id: '7', label: t('тиждень') }, { id: '30', label: t('місяць') }, { id: '0', label: t('завжди') }]} /></div>
        <div className="grid gap-1.5"><span className="text-[12.5px] font-semibold">{t('Скільки разів')}</span><Seg label={t('Використань')} value={uses} onChange={setUses} items={[{ id: '1', label: '1' }, { id: '5', label: '5' }, { id: '25', label: '25' }, { id: '0', label: t('без меж') }]} /></div>
        <div className="grid gap-1.5"><span className="text-[12.5px] font-semibold">{t('Вступить як')}</span><Seg label={t('Роль після вступу')} value={role} onChange={setRole} items={[{ id: 'recruit', label: GUILD_ROLE_LABEL.recruit, tip: t('Бачить гільдійське, але нічого не змінює') }, { id: 'member', label: GUILD_ROLE_LABEL.member, tip: t('Бачить, створює й змінює гільдійське') }]} /></div>
        <Button onClick={() => run(async () => { const r = await post<{ code: string }>(`/api/guilds/${g.slug}/invites`, { days: +days, uses: +uses, role }); await copy(r.code); reload() })}><Link2 size={15} />{t('Створити й скопіювати')}</Button>
      </div>
      <ul className="mt-3 divide-y divide-line">
        {d.invites.map((i) => (
          <li key={i.code} className={cn('flex flex-wrap items-center gap-3 py-2.5', !i.live && 'opacity-50')}>
            <code className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{link(i.code)}</code>
            <span className="text-[12px] text-muted">
              {GUILD_ROLE_LABEL[i.role]} · {i.maxUses ? t('{n} з {max} разів', { n: i.uses, max: i.maxUses }) : plural(i.uses, [t('раз'), t('рази'), t('разів')])} · {i.expires ? (i.expires > Date.now() ? t('до {date}', { date: new Date(i.expires).toLocaleDateString(locale()) }) : t('минуло')) : t('безстрокове')}{i.by && ` · ${i.by}`}
            </span>
            {i.live && <Button size="sm" variant="secondary" onClick={() => copy(i.code)}>{t('Копіювати')}</Button>}
            <Button size="sm" variant="ghost" title={t('Відкликати')} aria-label={t('Відкликати')} onClick={() => run(async () => { await del(`/api/guilds/${g.slug}/invites/${i.code}`); reload() }, t('Запрошення відкликано'))}><Trash2 size={14} /></Button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** запрошення за посиланням: яка гільдія — і вступити (після входу; лише тим, хто ще не в гільдії, і якщо є місце) */
export function InvitePage() {
  const code = useStore((s) => s.param)
  const setView = useStore((s) => s.setView)
  const user = useAuth((s) => s.user)
  const mine = useAuth((s) => s.guild)
  const [d, setD] = useState<{ guild: Guild; member: boolean; cap: number } | null>(null)
  const [error, setError] = useState('')
  // запрошення нема (минуло, використане, хибне посилання) — «Спробувати ще» нічого не дасть; інша помилка — можна повторити
  const [gone, setGone] = useState(false)
  const load = () => get<{ guild: Guild; member: boolean; cap: number }>(`/api/invites/${code}`).then((x) => { setD(x); setError('') }).catch((e) => { setGone((e as { status?: number }).status === 404); setError((e as Error).message) })
  useEffect(() => { setD(null); load() }, [code])
  const accept = () => run(async () => { const r = await post<{ guild: MyGuild }>(`/api/invites/${code}/accept`); await refreshMe(); setView('guild', { param: r.guild.slug }) }, t('Ласкаво просимо до гільдії'))
  // чому вступити не можна (ті самі тексти, що й у відповідях сервера)
  const blocked = !d || d.member || !user ? '' : mine ? t('Спершу вийди з поточної гільдії') : d.guild.members >= d.cap ? t('Гільдія заповнена ({n} з {cap})', { n: d.guild.members, cap: d.cap }) : ''
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[460px] py-[8vh]">
        <div className="rounded-xl border border-line bg-panel p-6 text-center shadow-sm">
          {error ? (gone
            ? <PageError title={t('Запрошення недійсне')} message={t('Посилання минуло, його вже використали або в ньому помилка. Попроси в гільдії нове.')} className="border-0"><Button variant="secondary" onClick={() => setView('guilds')}>{t('До гільдій')}</Button></PageError>
            : <PageError message={error} onRetry={load} className="border-0" />) : !d ? <Loading /> : (
            <>
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl font-display text-[20px] font-bold text-white" style={{ background: d.guild.color }}>{d.guild.tag}</span>
              <p className="mt-4 text-[13px] text-muted">{t('Тебе запрошують до гільдії')}</p>
              <h1 className="mt-1 font-display text-[24px] font-bold">{d.guild.name}</h1>
              {d.guild.about && <p className="mt-2 whitespace-pre-line text-[14px] text-muted">{d.guild.about}</p>}
              <Capacity n={d.guild.members} cap={d.cap} className="mx-auto mt-3 max-w-[220px]" />
              <div className="mt-5 grid justify-items-center gap-2">
                {d.member ? <Button onClick={() => setView('guild', { param: d.guild.slug })}>{t('Ти вже тут — до гільдії')}</Button>
                  : user ? <Button onClick={accept} disabled={!!blocked} className="h-10 px-5">{t('Вступити')}</Button>
                    : <Button onClick={() => openPath(loginHref())} className="h-10 px-5">{t('Увійти чи зареєструватися, щоб вступити')}</Button>}
                {blocked && <p className="text-[13px] text-muted">{blocked}</p>}
                {blocked && mine && <Button size="sm" variant="ghost" onClick={() => setView('guild', { param: mine.slug })}>{t('До моєї гільдії')}</Button>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

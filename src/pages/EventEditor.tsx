/**
 * Нова подія (/events/new) і редагування (/events/<id>/edit): що й коли (вид, початок за часом людини — поруч час
 * серверів регіону, тривалість), де (сервер, місце текстом, точки на мапі гри: місце події й зона для глядачів),
 * реєстрація (формат «N на N» чи кожен сам за себе, місця, підтвердження, до коли), призи, опис і правила, контакти,
 * доступ (власник і видимість — лише для нової; далі — «Доступ» на сторінці події).
 * /events/new?from=<id> — «Створити схожу» (та сама подія без команд і результатів, через тиждень);
 * /events/new?guild=<id> — подія гільдії.
 */
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarPlus, LogIn, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { blankEvent, createEvent, EVENT_TYPES, fmtServer, formatOf, getEvent, myZone, saveEvent, TYPE_HINT, TYPE_LABEL, type EventDoc, type EventFull, type Point } from '@/lib/events'
import { REGIONS, type Region } from '@/lib/ddReset'
import { loginHref, useAuth } from '@/lib/auth'
import type { ApiError } from '@/lib/api'
import type { Visibility } from '@/lib/items'
import { locale, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { leaveFreely, openPath, useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Seg } from '@/components/ui/seg'
import { PageHeader } from '@/components/PageHeader'
import { ErrorAlert, Loading, PageError } from '@/components/states'
import { NewAccess, type OwnerRef } from '@/components/access/Access'
import { useCrumb } from '@/components/Crumbs'
import { useUnsaved } from '@/components/UnsavedBar'
import { SnCheckbox, SnInput, SnNumberField, SnTextarea, checkedOf, valueOf } from '@/components/sn'
import { Section } from './Account'
import { Field } from './Auth'
import { TYPE_ICON } from '@/components/events/bits'
import { PIN_LABEL, type PinKind } from '@/components/events/EventMap'

const EventMap = lazy(() => import('@/components/events/EventMap'))

const KEYS: (keyof EventDoc)[] = ['title', 'type', 'about', 'rules', 'starts', 'duration', 'region', 'server', 'place', 'arena', 'watch', 'watchNote', 'reg', 'prizes', 'fee', 'contact', 'stream', 'cancelled', 'cancelNote', 'results', 'resultsNote', 'bracket']
/** лише документ (без команд, прав і реєстру) */
const docOf = (ev: EventFull): EventDoc => Object.fromEntries(KEYS.map((k) => [k, ev[k]])) as unknown as EventDoc
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const pad = (n: number) => String(n).padStart(2, '0')
const toDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const toTime = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const fromParts = (date: string, time: string) => { const ms = new Date(`${date}T${time || '00:00'}`).getTime(); return Number.isFinite(ms) ? ms : null }

/** дата й час за часом людини: два поля */
function DateTime({ value, onChange, label }: { value: number; onChange: (ms: number) => void; label: string }) {
  const [date, setDate] = useState(toDate(value))
  const [time, setTime] = useState(toTime(value))
  useEffect(() => { setDate(toDate(value)); setTime(toTime(value)) }, [value])
  const emit = (d: string, tm: string) => { const ms = fromParts(d, tm); if (ms != null) onChange(ms) }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SnInput type="date" size="lg" modelValue={date} accessibilityLabel={label} className="min-w-[160px] flex-1" onInput={(e: Event) => { const v = valueOf(e); setDate(v); emit(v, time) }} />
      <SnInput type="time" size="lg" modelValue={time} accessibilityLabel={t('Час')} className="w-[130px]" onInput={(e: Event) => { const v = valueOf(e); setTime(v); emit(date, v) }} />
    </div>
  )
}

/** вибір картками (вид події): значок, назва й підказка */
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('flex min-w-0 flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors', on ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40')}>
      {children}
    </button>
  )
}

const DURATIONS = [30, 60, 90, 120, 180, 240, 360]
const SIZES = [1, 2, 3, 4, 5]

export function EventEditor({ id }: { id: string | null }) {
  const me = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const myGuilds = useAuth((s) => s.guilds)
  const setView = useStore((s) => s.setView)
  const [doc, setDoc] = useState<EventDoc | null>(null)
  /** збережене (з чим порівнюємо, чи є незбережене) */
  const [saved, setSaved] = useState<EventDoc | null>(null)
  const [base, setBase] = useState<number | null>(null)
  const [teams, setTeams] = useState(0)
  const [owner, setOwner] = useState<OwnerRef | null>(null)
  const [vis, setVis] = useState<Visibility>('public')
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<EventFull | null>(null)
  const [picking, setPicking] = useState<PinKind>('arena')
  const [customDur, setCustomDur] = useState(false)
  const [customSize, setCustomSize] = useState(false)
  const params = useMemo(() => new URLSearchParams(location.search), [])

  // що редагуємо: наявну подію, схожу на іншу чи порожню
  useEffect(() => {
    if (!ready || !me) return
    let live = true
    const start = (d: EventDoc, upd: number | null) => {
      if (!live) return
      setDoc(d); setSaved(d); setBase(upd)
      setCustomDur(!DURATIONS.includes(d.duration)); setCustomSize(!SIZES.includes(d.reg.teamSize))
    }
    if (id) {
      getEvent(id).then((ev) => {
        if (!ev.rights.edit) { setLoadError(t('змінювати цю подію тобі не можна')); return }
        setTeams(ev.teams.length)
        start(docOf(ev), ev.updated)
      }).catch((e) => live && setLoadError((e as Error).message))
    } else {
      const g = params.get('guild')
      const guild = g ? myGuilds.find((x) => x.id === g) : null
      setOwner(guild ? { kind: 'guild', id: guild.id } : { kind: 'user', id: me.id })
      setVis(guild ? 'guild' : 'public')
      const from = params.get('from')
      if (from) {
        // схожа: усе те саме, без скасування й результатів, через тиждень (минула — від сьогодні в той самий час);
        // тиждень — за календарем, а не 7 × 24 год: інакше після переходу на зимовий чи літній час зсунеться година
        getEvent(from).then((ev) => {
          const d = new Date(ev.starts)
          do d.setDate(d.getDate() + 7); while (d.getTime() < Date.now() + 3600_000)
          start({ ...docOf(ev), title: ev.title, starts: d.getTime(), cancelled: false, cancelNote: '', results: [], resultsNote: '', bracket: null, reg: { ...ev.reg, open: true, closes: null } }, null)
        }).catch(() => start(blankEvent(), null))
      } else start(blankEvent(), null)
    }
    return () => { live = false }
  }, [id, ready, me?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useCrumb(loadError ? [] : ready && !me ? [{ label: t('Нова подія') }] : doc ? [...(id ? [{ label: saved?.title || t('Подія'), view: 'events' as const, param: id }] : []), { label: id ? t('Редагування') : t('Нова подія') }] : null)
  const dirty = !!doc && !!saved && !same(doc, saved)
  const set = <K extends keyof EventDoc>(k: K, v: EventDoc[K]) => setDoc((d) => (d ? { ...d, [k]: v } : d))
  const setReg = (patch: Partial<EventDoc['reg']>) => setDoc((d) => (d ? { ...d, reg: { ...d.reg, ...patch } } : d))

  const submit = async (force?: number) => {
    if (!doc) return false
    setBusy(true); setError('')
    try {
      if (id) {
        const r = await saveEvent(id, { ...doc, base: force ?? base ?? undefined })
        setSaved(docOf(r)); setDoc(docOf(r)); setBase(r.updated); setConflict(null)
        toast.success(t('Подію збережено'))
        leaveFreely(() => setView('events', { param: id }))
      } else {
        const r = await createEvent({ ...doc, owner: owner ?? undefined, visibility: vis })
        setSaved(doc)
        toast.success(t('Подію створено'), { description: t('Поділись посиланням: «Поділитись» → «Текст для Discord».') })
        leaveFreely(() => setView('events', { param: r.id }))
      }
      return true
    } catch (e) {
      const row = (e as ApiError).body as { row?: EventFull } | null
      if ((e as ApiError).status === 409 && row?.row) setConflict(row.row)
      else setError((e as Error).message)
      return false
    } finally { setBusy(false) }
  }
  useUnsaved(dirty && !busy, { save: () => submit(), discard: () => setDoc(saved), label: id ? t('Зміни події не збережено') : t('Нову подію не збережено') })

  if (ready && !me) {
    return (
      <PageError page title={t('Події влаштовують ті, хто увійшов')} message={t('Увійди — і створиш подію за хвилину: час, формат, призи й місце на мапі.')}>
        <Button onClick={() => openPath(loginHref())}><LogIn size={15} />{t('Увійти')}</Button>
      </PageError>
    )
  }
  if (loadError) return <PageError page message={loadError}><Button variant="secondary" onClick={() => setView('events')}>{t('До подій')}</Button></PageError>
  if (!doc) return <Loading page />

  const ends = doc.starts + doc.duration * 60_000
  const server = fmtServer(doc.starts, doc.region)
  const zone = myZone()
  const pointSet = (k: PinKind, p: Point | null) => set(k, p)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <form className="mx-auto grid w-full max-w-[980px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-24" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <PageHeader
          title={id ? t('Редагування події') : t('Нова подія')}
          lead={id ? saved?.title : t('Бій 2 на 2, турнір, перегони чи збір: коли, де, хто може взяти участь і що на кону. Потім поділишся посиланням.')}
          actions={
            <>
              <Button variant="ghost" onClick={() => (id ? setView('events', { param: id }) : setView('events'))}>{t('Скасувати')}</Button>
              <Button type="submit" loading={busy}><CalendarPlus size={15} />{id ? t('Зберегти') : t('Створити подію')}</Button>
            </>
          }
        />
        {conflict && (
          <ErrorAlert title={t('Подію щойно змінили')} message={t('Хтось зберіг її, поки ти редагував. Можна взяти нову версію (твої правки зникнуть) або зберегти свою поверх.')}>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => { const d = docOf(conflict); setDoc(d); setSaved(d); setBase(conflict.updated); setConflict(null) }}>{t('Взяти нову версію')}</Button>
              <Button size="sm" variant="destructive" onClick={() => void submit(conflict.updated)}>{t('Зберегти мою поверх')}</Button>
            </div>
          </ErrorAlert>
        )}

        <Section title={t('Що й коли')}>
          <div className="grid gap-4">
            <Field label={t('Назва')}>
              <SnInput size="lg" modelValue={doc.title} minLength={3} maxLength={120} required placeholder={t('Напр.: Бій 2 на 2 біля Арракіна')} accessibilityLabel={t('Назва')} onInput={(e: Event) => set('title', valueOf(e))} />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-[13px] font-semibold">{t('Вид')}</span>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
                {EVENT_TYPES.map((k) => {
                  const I = TYPE_ICON[k]
                  return (
                    <Choice key={k} on={doc.type === k} onClick={() => set('type', k)}>
                      <span className="flex items-center gap-1.5 text-[13.5px] font-semibold"><I size={15} className="text-spice" />{TYPE_LABEL[k]}</span>
                      <span className="text-[12px] leading-snug text-muted">{TYPE_HINT[k]}</span>
                    </Choice>
                  )
                })}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Початок')} hint={zone ? t('За твоїм часом ({zone}). Кожен побачить свій.', { zone }) : t('За твоїм часом. Кожен побачить свій.')}>
                <DateTime value={doc.starts} label={t('Початок')} onChange={(ms) => set('starts', ms)} />
              </Field>
              <Field label={t('Тривалість')} hint={t('Кінець: {when}', { when: new Date(ends).toLocaleString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })}>
                <div className="grid gap-2">
                  <Seg size="sm" label={t('Тривалість')} value={customDur ? 'custom' : String(doc.duration)} onChange={(v) => { if (v === 'custom') setCustomDur(true); else { setCustomDur(false); set('duration', Number(v)) } }}
                    items={[...DURATIONS.map((m) => ({ id: String(m), label: m < 60 ? t('{m} хв', { m }) : m % 60 ? t('{h} год {m} хв', { h: Math.floor(m / 60), m: m % 60 }) : t('{h} год', { h: m / 60 }) })), { id: 'custom', label: t('Інше') }]} />
                  {customDur && <SnNumberField className="w-[200px]" modelValue={doc.duration} min={15} max={10080} step={15} accessibilityLabel={t('Тривалість, хвилин')} onChange={(e: Event) => set('duration', Math.max(15, Number(valueOf(e)) || 120))} />}
                </div>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Регіон серверів')} hint={server ? t('За часом серверів: {time}', { time: server }) : t('Щоб показати час серверів і знайти подію фільтром')}>
                <Seg size="sm" label={t('Регіон')} value={doc.region} onChange={(v) => set('region', v as Region | '')} items={[{ id: '', label: t('Не вказано') }, ...(Object.keys(REGIONS) as Region[]).map((r) => ({ id: r, label: REGIONS[r].label }))]} />
              </Field>
              <Field label={t('Сервер у грі')} hint={t('Світ чи сієтч, де збираєтесь')}>
                <SnInput size="lg" modelValue={doc.server} maxLength={60} accessibilityLabel={t('Сервер у грі')} onInput={(e: Event) => set('server', valueOf(e))} />
              </Field>
            </div>
          </div>
        </Section>

        <Section title={t('Де')} hint={t('Постав на мапі місце події й зону для глядачів — напр. PvE-зону, звідки видно бій. Вибери, що ставиш, і клацни по мапі.')}>
          <div className="grid gap-3">
            <Field label={t('Місце словами')}>
              <SnInput size="lg" modelValue={doc.place} maxLength={200} placeholder={t('Напр.: скелі на схід від Арракіна, сектор E5')} accessibilityLabel={t('Місце словами')} onInput={(e: Event) => set('place', valueOf(e))} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Seg size="sm" label={t('Що ставиш на мапі')} value={picking} onChange={setPicking} items={(['arena', 'watch'] as PinKind[]).map((k) => ({
                id: k, label: <span className="inline-flex items-center gap-1.5"><span className={cn('h-2.5 w-2.5 rounded-full', k === 'arena' ? 'bg-spice' : 'bg-[#2f9e8f]')} />{PIN_LABEL[k]}{doc[k] ? ' ✓' : ''}</span>,
              }))} />
              {(['arena', 'watch'] as PinKind[]).map((k) => doc[k] && (
                <Button key={k} size="sm" variant="ghost" onClick={() => pointSet(k, null)}><X size={13} />{t('Прибрати: {what}', { what: PIN_LABEL[k] })}</Button>
              ))}
            </div>
            <Suspense fallback={<div className="h-[340px] animate-pulse rounded-lg bg-panel2" />}>
              <EventMap arena={doc.arena} watch={doc.watch} picking={picking} onPick={(k, p) => { pointSet(k, p); if (k === 'arena' && !doc.watch) setPicking('watch') }} className="h-[340px]" />
            </Suspense>
            <Field label={t('Глядачам')} hint={t('Де стати, щоб бачити й не потрапити під вогонь; що можна й чого не можна')}>
              <SnTextarea size="lg" rows={2} modelValue={doc.watchNote} maxLength={300} placeholder={t('Напр.: PvE-зона на скелі на північ — звідти видно арену; у PvP-зону не заходьте')} accessibilityLabel={t('Глядачам')} onInput={(e: Event) => set('watchNote', valueOf(e))} />
            </Field>
          </div>
        </Section>

        <Section title={t('Реєстрація')}>
          <div className="grid gap-4">
            <SnCheckbox modelValue={doc.reg.open} label={t('Приймати реєстрацію на сайті')} onChange={(e: Event) => setReg({ open: checkedOf(e) })} />
            {doc.reg.open && (
              <>
                <div className="grid gap-1.5">
                  <span className="text-[13px] font-semibold">{t('Формат')}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Seg size="sm" label={t('Формат')} value={customSize ? 'custom' : String(doc.reg.teamSize)} onChange={(v) => { if (v === 'custom') setCustomSize(true); else { setCustomSize(false); setReg({ teamSize: Number(v) }) } }}
                      items={[...SIZES.map((n) => ({ id: String(n), label: formatOf(n) })), { id: 'custom', label: t('Інше') }]} />
                    {customSize && <SnNumberField className="w-[160px]" modelValue={doc.reg.teamSize} min={1} max={10} step={1} accessibilityLabel={t('Гравців у команді')} onChange={(e: Event) => setReg({ teamSize: Math.min(10, Math.max(1, Number(valueOf(e)) || 1)) })} />}
                  </div>
                  {id && teams > 0 && <p className="text-[12.5px] text-warn">{t('Уже зареєструвалось: {n}. Зміниш формат — команди лишаться як є, капітани поправлять склад.', { n: teams })}</p>}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={doc.reg.teamSize > 1 ? t('Скільки команд') : t('Скільки учасників')} hint={t('0 — без обмежень; далі — резерв')}>
                    <SnNumberField className="w-[200px]" modelValue={doc.reg.slots} min={0} max={256} step={1} accessibilityLabel={t('Скільки місць')} onChange={(e: Event) => setReg({ slots: Math.min(256, Math.max(0, Number(valueOf(e)) || 0)) })} />
                  </Field>
                  <div className="grid content-start gap-2 sm:pt-6">
                    <SnCheckbox modelValue={doc.reg.approval} label={t('Підтверджую кожну заявку сам')} onChange={(e: Event) => setReg({ approval: checkedOf(e) })} />
                    <SnCheckbox modelValue={doc.reg.closes != null} label={t('Закрити реєстрацію раніше за початок')} onChange={(e: Event) => setReg({ closes: checkedOf(e) ? doc.starts - 3600_000 : null })} />
                  </div>
                </div>
                {doc.reg.closes != null && (
                  <Field label={t('Реєстрація до')}><DateTime value={doc.reg.closes} label={t('Реєстрація до')} onChange={(ms) => setReg({ closes: ms })} /></Field>
                )}
              </>
            )}
          </div>
        </Section>

        <Section title={t('Призовий фонд')} hint={t('Що отримають переможці: солари, предмети, техніку. Порядок — за місцями.')}>
          <div className="grid gap-2">
            {doc.prizes.map((p, i) => (
              // на телефоні — за що приз і кнопка в рядку, сам приз — на всю ширину під ними (рядок — плашкою, щоб пари не злипались)
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 max-sm:rounded-lg max-sm:bg-panel2/50 max-sm:p-2 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto]">
                <SnInput size="lg" modelValue={p.label} maxLength={60} placeholder={t('{n} місце', { n: i + 1 })} accessibilityLabel={t('За що приз')} onInput={(e: Event) => set('prizes', doc.prizes.map((x, j) => (j === i ? { ...x, label: valueOf(e) } : x)))} />
                <SnInput size="lg" className="order-3 col-span-2 sm:order-none sm:col-span-1" modelValue={p.prize} maxLength={200} placeholder={t('Напр.: 50 000 соларів')} accessibilityLabel={t('Приз')} onInput={(e: Event) => set('prizes', doc.prizes.map((x, j) => (j === i ? { ...x, prize: valueOf(e) } : x)))} />
                <Button size="sm" variant="ghost" aria-label={t('Прибрати приз')} onClick={() => set('prizes', doc.prizes.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" disabled={doc.prizes.length >= 10} onClick={() => set('prizes', [...doc.prizes, { label: '', prize: '' }])}><Plus size={14} />{t('Додати приз')}</Button>
            </div>
            <Field label={t('Внесок за участь')} hint={t('Необов’язково: напр. «5 000 соларів з команди — у призовий фонд»')}>
              <SnInput size="lg" modelValue={doc.fee} maxLength={120} accessibilityLabel={t('Внесок за участь')} onInput={(e: Event) => set('fee', valueOf(e))} />
            </Field>
          </div>
        </Section>

        <Section title={t('Опис і правила')} hint={t('Розмітка як у роадмапах: **жирний**, [посилання](адреса), рядки «- » — список.')}>
          <div className="grid gap-3">
            <Field label={t('Про подію')}>
              <SnTextarea size="lg" rows={4} modelValue={doc.about} maxLength={4000} accessibilityLabel={t('Про подію')} onInput={(e: Event) => set('about', valueOf(e))} />
            </Field>
            <Field label={t('Правила')}>
              <SnTextarea size="lg" rows={4} modelValue={doc.rules} maxLength={4000} placeholder={t('Напр.:\n- без зброї Т6\n- бій до останнього\n- лут переможцю')} accessibilityLabel={t('Правила')} onInput={(e: Event) => set('rules', valueOf(e))} />
            </Field>
          </div>
        </Section>

        <Section title={t('Зв’язок і трансляція')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Як зв’язатися')} hint={t('Discord, нік у грі')}>
              <SnInput size="lg" modelValue={doc.contact} maxLength={200} accessibilityLabel={t('Як зв’язатися')} onInput={(e: Event) => set('contact', valueOf(e))} />
            </Field>
            <Field label={t('Трансляція')} hint={t('Посилання на Twitch чи YouTube (https://…)')}>
              <SnInput size="lg" type="url" modelValue={doc.stream} maxLength={300} accessibilityLabel={t('Трансляція')} onInput={(e: Event) => set('stream', valueOf(e))} />
            </Field>
          </div>
        </Section>

        {!id && owner && (
          <Section title={t('Доступ')} hint={t('Публічну подію бачать усі й знаходять у «Подіях»; гільдійську — лише учасники гільдії; «за посиланням» — ті, кому дасиш адресу.')}>
            <NewAccess owner={owner} visibility={vis} onChange={(o, v) => { setOwner(o); setVis(v) }} />
          </Section>
        )}

        {error && <ErrorAlert title={id ? t('Не вдалося зберегти') : t('Не вдалося створити подію')} message={error} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => (id ? setView('events', { param: id }) : setView('events'))}>{t('Скасувати')}</Button>
          <Button type="submit" loading={busy}><CalendarPlus size={15} />{id ? t('Зберегти') : t('Створити подію')}</Button>
        </div>
      </form>
    </div>
  )
}

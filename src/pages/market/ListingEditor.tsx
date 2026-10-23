/**
 * Нове оголошення (/market/new) і редагування (/market/<id>/edit): вид (куплю / продам), предмет із довідника гри,
 * кількість і мінімальна партія, оплата (солари, бартер чи те й те) і ціна за штуку, де торгуємо (регіон, світ, сервер),
 * строк дії, місце передачі (точка на мапі, база чи словами), контакт, примітка, від кого й хто бачить (лише для
 * нового) і правило біржі: торгівля за реальні гроші заборонена — без позначки сервер оголошення не прийме.
 * /market/new?gid=<id гри>&side=buy — з предметом і видом; ?guild=<id> — від гільдії.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Ban, Clock, Globe2, Handshake, LogIn, MapPin, MessageSquare, Plus, Trash2, Type, X } from 'lucide-react'
import { toast } from 'sonner'
import { blankListing, createListing, fmtSolari, getListing, PAY_HINT, PAY_LABEL, PAYS, saveListing, SIDE_HINT, SIDES, TTLS, type ListingDoc, type ListingFull, type Place } from '@/lib/market'
import { REGIONS, type Region } from '@/lib/ddReset'
import { loginHref, useAuth } from '@/lib/auth'
import { useBases } from '@/lib/bases'
import type { ApiError } from '@/lib/api'
import type { Visibility } from '@/lib/items'
import { t } from '@/lib/i18n'
import { fmtN, word } from '@/lib/utils'
import { leaveFreely, openPath, useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { ErrorAlert, Loading, PageError } from '@/components/states'
import { NewAccess, type OwnerRef } from '@/components/access/Access'
import { useCrumb } from '@/components/Crumbs'
import { useUnsaved } from '@/components/UnsavedBar'
import { SnCheckbox, SnInput, SnTextarea, checkedOf, valueOf } from '@/components/sn'
import { Section } from '../Account'
import { Field } from '../Auth'
import { CHOICES, Choice, SideChip } from '@/components/market/bits'
import { ItemPicker } from '@/components/market/ItemPicker'
import { refreshMarketMe, useMarketMe } from '@/components/market/me'
import { GoodName } from '@/components/market/names'

const EventMap = lazy(() => import('@/components/events/EventMap'))

const KEYS: (keyof ListingDoc)[] = ['side', 'gid', 'qty', 'minQty', 'pay', 'price', 'barter', 'negotiable', 'region', 'world', 'server', 'ttl', 'place', 'contact', 'note']
const docOf = (l: ListingFull): ListingDoc => {
  const d = Object.fromEntries(KEYS.map((k) => [k, l[k as keyof ListingFull]])) as unknown as ListingDoc
  // база, яку людина бачить, — id; іншу (назва без посилання) — лишаємо як є на сервері, тут її не змінюють
  return { ...d, contact: { site: l.contact.site, nick: l.contact.nick ?? '' } }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** число з поля (числове поле віддає число, текстове — рядок); порожньо — null */
const num = (v: unknown) => { const s = String(v ?? '').replace(/\s/g, ''); return s === '' ? null : Math.max(0, Math.floor(Number(s)) || 0) }
const dayWord = (n: number) => word(n, [t('день'), t('дні'), t('днів')])

type PlaceKind = 'none' | 'point' | 'base' | 'text'

export default function ListingEditor({ id }: { id: string | null }) {
  const me = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const myGuilds = useAuth((s) => s.guilds)
  const setView = useStore((s) => s.setView)
  const mine = useMarketMe()
  const [doc, setDoc] = useState<ListingDoc | null>(null)
  const [saved, setSaved] = useState<ListingDoc | null>(null)
  const [base, setBase] = useState<number | null>(null)
  const [owner, setOwner] = useState<OwnerRef | null>(null)
  const [vis, setVis] = useState<Visibility>('public')
  const [rules, setRules] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<ListingFull | null>(null)
  const [placeKind, setPlaceKind] = useState<PlaceKind>('none')
  const [baseTitle, setBaseTitle] = useState('')
  const params = useMemo(() => new URLSearchParams(location.search), [])

  useEffect(() => {
    if (!ready || !me) return
    let live = true
    const start = (d: ListingDoc, upd: number | null) => {
      if (!live) return
      setDoc(d); setSaved(d); setBase(upd)
      setPlaceKind(d.place?.kind ?? 'none')
    }
    if (id) {
      getListing(id).then((l) => {
        if (!l.rights.edit) { setLoadError(t('змінювати це оголошення тобі не можна')); return }
        if (l.place?.kind === 'base') setBaseTitle(l.place.title ?? '')
        start(docOf(l), l.updated)
      }).catch((e) => live && setLoadError((e as Error).message))
    } else {
      const g = params.get('guild')
      const guild = g ? myGuilds.find((x) => x.id === g) : null
      setOwner(guild ? { kind: 'guild', id: guild.id } : { kind: 'user', id: me.id })
      setVis(guild ? 'guild' : 'public')
      const side = params.get('side') === 'buy' ? 'buy' : 'sell'
      start(blankListing(side, params.get('gid') || ''), null)
    }
    return () => { live = false }
  }, [id, ready, me?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // останні регіон / світ / сервер / нік — у нове оголошення, поки людина їх ще не міняла
  useEffect(() => {
    const d = mine?.defaults
    if (id || !d) return
    const fill = (x: ListingDoc) => ({ ...x, region: x.region || d.region, world: x.world || d.world, server: x.server || d.server, contact: { ...x.contact, nick: x.contact.nick || d.nick } })
    setDoc((x) => (x ? fill(x) : x))
    setSaved((x) => (x ? fill(x) : x))
  }, [mine, id])

  useCrumb(loadError ? [] : ready && !me ? [{ label: t('Нове оголошення') }] : doc ? [...(id ? [{ label: t('Оголошення біржі'), view: 'market' as const, param: id }] : []), { label: id ? t('Редагування') : t('Нове оголошення') }] : null)
  const dirty = !!doc && !!saved && !same(doc, saved)
  const set = <K extends keyof ListingDoc>(k: K, v: ListingDoc[K]) => setDoc((d) => (d ? { ...d, [k]: v } : d))

  const submit = async (force?: number) => {
    if (!doc) return false
    if (!id && !rules) { setError(t('Підтверди правило біржі: торгівля за реальні гроші заборонена')); return false }
    setBusy(true); setError('')
    const body = { ...doc, price: doc.pay === 'barter' ? null : doc.price, barter: doc.pay === 'solari' ? [] : doc.barter.filter((b) => b.gid) }
    try {
      if (id) {
        const r = await saveListing(id, { ...body, base: force ?? base ?? undefined })
        setSaved(docOf(r)); setDoc(docOf(r)); setBase(r.updated); setConflict(null)
        toast.success(t('Оголошення збережено'))
        leaveFreely(() => setView('market', { param: id }))
      } else {
        const r = await createListing({ ...body, owner: owner ?? undefined, visibility: vis, rules: true })
        setSaved(doc)
        refreshMarketMe()
        toast.success(t('Оголошення розміщено'), r.matches.length ? { description: t('Є зустрічні заявки: {n} — дивись «Збіги»', { n: r.matches.length }) } : undefined)
        leaveFreely(() => setView('market', { param: r.id }))
      }
      return true
    } catch (e) {
      const row = (e as ApiError).body as { row?: ListingFull } | null
      if ((e as ApiError).status === 409 && row?.row) setConflict(row.row)
      else setError((e as Error).message)
      return false
    } finally { setBusy(false) }
  }
  useUnsaved(dirty && !busy, { save: () => submit(), discard: () => setDoc(saved), label: id ? t('Зміни оголошення не збережено') : t('Нове оголошення не збережено') })

  if (ready && !me) {
    return (
      <PageError page title={t('Торгують ті, хто увійшов')} message={t('Увійди — і розмістиш оголошення за хвилину: предмет, кількість, ціна.')}>
        <Button onClick={() => openPath(loginHref())}><LogIn size={15} />{t('Увійти')}</Button>
      </PageError>
    )
  }
  if (loadError) return <PageError page message={loadError}><Button variant="secondary" onClick={() => setView('market')}>{t('До біржі')}</Button></PageError>
  if (!doc) return <Loading page />

  const setPlace = (k: PlaceKind) => {
    setPlaceKind(k)
    if (k === 'none') set('place', null)
    else if (k === 'text') set('place', { kind: 'text', text: doc.place?.kind === 'text' ? doc.place.text : '' })
    else if (doc.place?.kind !== k) set('place', null)
  }
  const worlds = (doc.region && mine?.worlds[doc.region as Region]) || []
  const banned = mine?.ban

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <form className="mx-auto grid w-full max-w-[980px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-24" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <PageHeader
          title={id ? t('Редагування оголошення') : t('Нове оголошення')}
          lead={id ? undefined : t('Що продаєш чи шукаєш, скільки й почім, де передати. Покупці й продавці побачать його в стрічці й на сторінці предмета.')}
          actions={
            <>
              <Button variant="ghost" onClick={() => (id ? setView('market', { param: id }) : setView('market'))}>{t('Скасувати')}</Button>
              <Button type="submit" loading={busy} disabled={!!banned}><Handshake size={15} />{id ? t('Зберегти') : t('Розмістити')}</Button>
            </>
          }
        />
        {banned && <ErrorAlert title={t('Тобі заборонено торгувати на біржі')} message={banned.reason || '—'} />}
        {conflict && (
          <ErrorAlert title={t('Оголошення щойно змінили')} message={t('Хтось зберіг його, поки ти редагував. Можна взяти нову версію (твої правки зникнуть) або зберегти свою поверх.')}>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => { const d = docOf(conflict); setDoc(d); setSaved(d); setBase(conflict.updated); setConflict(null) }}>{t('Взяти нову версію')}</Button>
              <Button size="sm" variant="destructive" onClick={() => void submit(conflict.updated)}>{t('Зберегти мою поверх')}</Button>
            </div>
          </ErrorAlert>
        )}

        <Section title={t('Що')}>
          <div className="grid gap-4">
            <div className={CHOICES}>
              {SIDES.map((s) => (
                <Choice key={s} on={doc.side === s} onClick={() => set('side', s)}>
                  <SideChip side={s} />
                  <span className="text-[12px] leading-snug text-muted">{SIDE_HINT[s]}</span>
                </Choice>
              ))}
            </div>
            <div className="grid gap-1.5">
              <span className="text-[13px] font-semibold">{t('Предмет')}</span>
              <ItemPicker value={doc.gid} onChange={(gid) => set('gid', gid)} label={t('Предмет')} />
            </div>
          </div>
        </Section>

        <Section title={t('Скільки й почім')}>
          <div className="grid gap-4">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              <Field label={t('Кількість')}>
                <SnInput size="lg" type="number" inputmode="numeric" min={1} required modelValue={String(doc.qty || '')} accessibilityLabel={t('Кількість')} onInput={(e: Event) => set('qty', num(valueOf(e)) ?? 0)} />
              </Field>
              <Field label={t('Мінімальна партія')} hint={t('Порожньо — будь-яка кількість')}>
                <SnInput size="lg" type="number" inputmode="numeric" min={0} modelValue={doc.minQty ? String(doc.minQty) : ''} accessibilityLabel={t('Мінімальна партія')} onInput={(e: Event) => set('minQty', num(valueOf(e)) ?? 0)} />
              </Field>
            </div>
            <div className="grid gap-1.5">
              <span className="text-[13px] font-semibold">{t('Оплата')}</span>
              <div className={CHOICES}>
                {PAYS.map((p) => (
                  <Choice key={p} on={doc.pay === p} onClick={() => set('pay', p)}>
                    <span className="text-[13.5px] font-semibold">{PAY_LABEL[p]}</span>
                    <span className="text-[12px] leading-snug text-muted">{PAY_HINT[p]}</span>
                  </Choice>
                ))}
              </div>
            </div>
            {doc.pay !== 'barter' && (
              <Field label={t('Ціна за штуку, Solari')} hint={doc.price && doc.qty > 1 ? t('Разом за все: {sum}', { sum: fmtSolari(doc.price * doc.qty) }) : undefined}>
                <SnInput size="lg" type="number" inputmode="numeric" min={1} required modelValue={doc.price ? String(doc.price) : ''} accessibilityLabel={t('Ціна за штуку, Solari')} onInput={(e: Event) => set('price', num(valueOf(e)))} />
              </Field>
            )}
            {doc.pay !== 'solari' && (
              <div className="grid gap-2">
                <span className="text-[13px] font-semibold">{doc.side === 'sell' ? t('Що хочу натомість') : t('Що даю натомість')}</span>
                {doc.barter.map((b, i) => (
                  <div key={i} className="grid gap-2 rounded-lg border border-line p-2.5">
                    <ItemPicker compact value={b.gid} exclude={[doc.gid, ...doc.barter.filter((_, j) => j !== i).map((x) => x.gid)]} label={t('Предмет для бартеру')} onChange={(gid) => set('barter', doc.barter.map((x, j) => (j === i ? { ...x, gid } : x)))} />
                    <div className="flex flex-wrap items-center gap-2">
                      <SnInput size="lg" type="number" inputmode="numeric" min={1} className="w-[160px]" modelValue={String(b.qty || '')} accessibilityLabel={t('Кількість')} onInput={(e: Event) => set('barter', doc.barter.map((x, j) => (j === i ? { ...x, qty: num(valueOf(e)) ?? 0 } : x)))} />
                      <span className="text-[13px] text-muted">{t('шт.')}</span>
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => set('barter', doc.barter.filter((_, j) => j !== i))}><Trash2 size={13} />{t('Прибрати')}</Button>
                    </div>
                  </div>
                ))}
                {doc.barter.length < 3 && <Button size="sm" variant="secondary" className="justify-self-start" onClick={() => set('barter', [...doc.barter, { gid: '', qty: 1 }])}><Plus size={13} />{t('Додати предмет')}</Button>}
              </div>
            )}
            <label className="flex items-center gap-2 text-[13.5px]">
              <SnCheckbox checked={doc.negotiable} onChange={(e: Event) => set('negotiable', checkedOf(e))} accessibilityLabel={t('Торг доречний')} />
              {t('Торг доречний')}
            </label>
          </div>
        </Section>

        <Section title={t('Де торгуємо')} hint={t('Збіги шукаються в тому самому регіоні й світі. Сервер (січ) — якщо передати можна лише на ньому.')}>
          <div className="grid gap-4">
            <div className={CHOICES}>
              {(Object.keys(REGIONS) as Region[]).map((r) => (
                <Choice key={r} on={doc.region === r} onClick={() => set('region', r)}>
                  <span className="flex items-center gap-1.5 text-[13.5px] font-semibold"><Globe2 size={14} className="text-spice" />{REGIONS[r].label}</span>
                </Choice>
              ))}
            </div>
            <Field label={t('Світ')}>
              <SnInput size="lg" required maxLength={40} modelValue={doc.world} placeholder={t('Напр.: Hagga EU 7')} accessibilityLabel={t('Світ')} onInput={(e: Event) => set('world', valueOf(e))} />
            </Field>
            {worlds.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label={t('Світи, де вже торгують')}>
                {worlds.map((w) => <button key={w} type="button" onClick={() => set('world', w)} className="rounded-full border border-line px-2.5 py-1 text-[12.5px] hover:border-spice/50 hover:text-spice">{w}</button>)}
              </div>
            )}
            <Field label={t('Сервер (січ)')} hint={t('Порожньо — увесь світ')}>
              <SnInput size="lg" maxLength={40} modelValue={doc.server} accessibilityLabel={t('Сервер (січ)')} onInput={(e: Event) => set('server', valueOf(e))} />
            </Field>
          </div>
        </Section>

        <Section title={t('Строк дії')} hint={t('Потім оголошення закінчиться — продовжиш одним кліком.')}>
          <div className={CHOICES}>
            {TTLS.map((d) => (
              <Choice key={d} on={doc.ttl === d} onClick={() => set('ttl', d)}>
                <span className="flex items-center gap-1.5 text-[13.5px] font-semibold"><Clock size={14} className="text-spice" />{fmtN(d)} {dayWord(d)}</span>
              </Choice>
            ))}
          </div>
        </Section>

        <Section title={t('Де передати')} hint={t('Необов’язково: точка на мапі гри, твоя база чи словами.')}>
          <div className="grid gap-3">
            <div className={CHOICES}>
              {([['none', X, t('Домовимось пізніше')], ['point', MapPin, t('Точка на мапі')], ['base', Handshake, t('База')], ['text', Type, t('Словами')]] as const).map(([k, I, label]) => (
                <Choice key={k} on={placeKind === k} onClick={() => setPlace(k)}><span className="flex items-center gap-1.5 text-[13.5px] font-semibold"><I size={14} className="text-spice" />{label}</span></Choice>
              ))}
            </div>
            {placeKind === 'point' && (
              <Suspense fallback={<Loading />}>
                <EventMap arena={doc.place?.kind === 'point' ? doc.place.point : null} watch={null} picking="arena" labels={{ arena: t('Місце передачі') }} onPick={(_k, p) => set('place', { kind: 'point', point: p })} className="h-[min(420px,60vh)]" />
                <p className="text-[12.5px] text-muted">{doc.place?.kind === 'point' ? t('Точку поставлено — клікни деінде, щоб перенести') : t('Клікни на мапі, де передаси предмет')}</p>
              </Suspense>
            )}
            {placeKind === 'base' && <BasePick value={doc.place} keepTitle={baseTitle} onChange={(p) => set('place', p)} />}
            {placeKind === 'text' && (
              <SnInput size="lg" maxLength={200} modelValue={doc.place?.kind === 'text' ? doc.place.text : ''} placeholder={t('Напр.: Арракін, біля обміну')} accessibilityLabel={t('Де передати')} onInput={(e: Event) => set('place', { kind: 'text', text: valueOf(e) })} />
            )}
          </div>
        </Section>

        <Section title={t('Як зв’язатися')}>
          <div className="grid gap-3">
            <label className="flex items-start gap-2 text-[13.5px]">
              <SnCheckbox checked={doc.contact.site} onChange={(e: Event) => set('contact', { ...doc.contact, site: checkedOf(e) })} accessibilityLabel={t('Пропозиції й листування на сайті')} />
              <span><b className="font-semibold">{t('Пропозиції й листування на сайті')}</b><span className="block text-[12.5px] text-muted">{t('Тобі пропонують угоду тут, ти приймаєш — і далі листуєтесь в угоді')}</span></span>
            </label>
            <Field label={t('Нік у грі')} hint={t('Видно лише тим, хто увійшов на сайт')}>
              <SnInput size="lg" maxLength={40} modelValue={doc.contact.nick} accessibilityLabel={t('Нік у грі')} onInput={(e: Event) => set('contact', { ...doc.contact, nick: valueOf(e) })} />
            </Field>
            <Field label={t('Примітка')}>
              <SnTextarea size="lg" rows={3} maxLength={1000} modelValue={doc.note} placeholder={t('Напр.: віддам частинами, онлайн увечері')} accessibilityLabel={t('Примітка')} onInput={(e: Event) => set('note', valueOf(e))} />
            </Field>
          </div>
        </Section>

        {!id && owner && (
          <Section title={t('Від кого й хто бачить')} hint={t('Гільдійське оголошення з видимістю «Гільдія» — внутрішній ринок гільдії.')}>
            <NewAccess owner={owner} visibility={vis} onChange={(o, v) => { setOwner(o); setVis(v) }} />
          </Section>
        )}

        <section className="grid gap-2 rounded-xl border border-bad/40 bg-bad/5 p-4">
          <h2 className="flex items-center gap-2 font-display text-[16px] font-bold text-bad"><Ban size={17} />{t('Реальні гроші — заборонено')}</h2>
          <p className="text-[13.5px] leading-snug">{t('Купівля й продаж предметів, соларів чи акаунтів за реальні гроші (RMT) заборонені правилами гри й біржі. Такі оголошення ховаються, а людям закривають доступ до біржі.')}</p>
          {!id && (
            <label className="flex items-start gap-2 text-[13.5px] font-semibold">
              <SnCheckbox checked={rules} onChange={(e: Event) => setRules(checkedOf(e))} accessibilityLabel={t('Розумію: торгівля за реальні гроші заборонена')} />
              {t('Розумію: торгівля за реальні гроші заборонена')}
            </label>
          )}
        </section>

        {error && <ErrorAlert message={error} />}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {doc.gid && <span className="mr-auto flex flex-wrap items-center gap-1.5 text-[13px] text-muted"><SideChip side={doc.side} /><GoodName gid={doc.gid} className="font-semibold text-ink" /> ×{fmtN(doc.qty || 0)}</span>}
          <Button variant="ghost" onClick={() => (id ? setView('market', { param: id }) : setView('market'))}>{t('Скасувати')}</Button>
          <Button type="submit" loading={busy} disabled={!!banned}><MessageSquare size={15} />{id ? t('Зберегти') : t('Розмістити')}</Button>
        </div>
      </form>
    </div>
  )
}

/** база як місце передачі: свої й гільдійські бази картками */
function BasePick({ value, keepTitle, onChange }: { value: Place; keepTitle: string; onChange: (p: Place) => void }) {
  const { list, listError, loadList } = useBases()
  useEffect(() => { if (!list) void loadList() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const cur = value?.kind === 'base' ? value.base : null
  if (listError) return <ErrorAlert message={t('Бази не завантажились')} />
  if (!list) return <Loading />
  const shown = list.filter((b) => !b.deleted)
  if (!shown.length) return <p className="text-[13px] text-muted">{t('У тебе ще нема баз на сайті — вибери точку на мапі чи напиши словами.')}</p>
  return (
    <div className={CHOICES}>
      {cur && !shown.some((b) => b.id === cur) && <Choice on onClick={() => {}}><span className="text-[13.5px] font-semibold">{keepTitle || t('База')}</span></Choice>}
      {shown.map((b) => (
        <Choice key={b.id} on={cur === b.id} onClick={() => onChange({ kind: 'base', base: b.id })}>
          <span className="break-words text-[13.5px] font-semibold">{b.name}</span>
          {b.lead && <span className="text-[12px] leading-snug text-muted">{b.lead}</span>}
        </Choice>
      ))}
    </div>
  )
}

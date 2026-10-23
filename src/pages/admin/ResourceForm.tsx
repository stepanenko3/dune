/**
 * Запис розділу: створення й редагування в одній формі (поля з опису розділу), дії із записом, видалення, посилання
 * на сайт; під формою — пов'язані записи інших розділів (як relation managers у Filament: список із пошуком, створення
 * з уже заданим зв'язком; у кожній вкладці — скільки там записів), історія змін із різницею між версіями, для бази —
 * її фото (знімок 3D чи своє) і 3D (сховане, доки не відкрити; і редактор), для фонової задачі — журнал запуску
 * наживо, для даних гри — тексти всіма мовами. Службові поля — у згорнутому блоці «Технічні дані». Незбережені
 * зміни — у смужці внизу (зберегти / відкинути).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, ChevronDown, ChevronRight, Download, ExternalLink, ImageOff, Pencil, Plus, RefreshCw, RotateCcw, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { SnBadge, SnButton, SnInput, SnSkeleton, SnTabs, SnTabsContent, SnTabsList, SnTabsTrigger, SnTextarea, valueOf } from '@/components/sn'
import { Loading, PageError } from '@/components/states'
import { useBases } from '@/lib/bases'
import { useUrlParam } from '@/lib/urlState'
import { BaseViewer } from '@/components/base/BaseViewer'
import { Builder } from '@/components/base/builder/Builder'
import { LANGS, t } from '@/lib/i18n'
import { ApiError } from '@/lib/api'
import { adminApi, actionShown, fixedOf, goAdmin, hasPerm, relKey, resourceOf, siteHref, useAdmin, type BasePhoto, type Resource, type Row } from './api'
import { CronJobLog, LogView } from './log'
import { ResourceList } from './ResourceList'
import { History, VersionDiff, RevisionDiff } from './history'
import { removeRows, runAction } from './actions'
import { FieldInput, FieldShell, PermissionsBlocks, ValueView, textOf } from './fields'
import { Modal } from '@/components/ui/modal'
import { locale } from '@/lib/i18n'
import { PageHeader, Panel } from './ui'
import { useUnsaved } from '@/components/UnsavedBar'

const WIDE = new Set(['textarea', 'json', 'pairs', 'list', 'permissions', 'code'])
/** значення з адреси (?prefill=…) — для «Створити» з пов'язаного списку */
const prefill = (): Record<string, unknown> => { try { return JSON.parse(new URLSearchParams(location.search).get('prefill') || '{}') } catch { return {} } }
/** куди повернутись після «Створити» з вкладки картки (?back=users/u1) — на ту саму картку */
const backTo = (): string[] | null => { const b = new URLSearchParams(location.search).get('back'); return b ? b.split('/').map(decodeURIComponent) : null }

export function ResourceForm({ r, id }: { r: Resource; id: string | null }) {
  const creating = id === null
  const [row, setRow] = useState<Row | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>(() => (id === null ? prefill() : {}))
  const [, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** помилки біля полів (з сервера — яке поле; і обов'язкові порожні — до відправки) */
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({})
  /** поля з хибним JSON — зберегти не можна */
  const bad = useRef(new Set<string>())
  const [, bump] = useState(0)
  /** «Скасувати» — поля заново (у деяких — свій стан: власник «людина / гільдія / сайт», JSON, дата) */
  const [ver, setVer] = useState(0)
  /** «Технічні дані» розгорнуто (при створенні — так: там буває обов'язкове) */
  const [showAdv, setShowAdv] = useState(id === null)

  const load = () => {
    if (creating) return
    setRow(null)
    adminApi.one(r.name, id).then((x) => { setRow(x); setDraft({}) }).catch((e) => setError((e as Error).message))
  }
  useEffect(() => { setDraft(creating ? prefill() : {}); setError(''); load() }, [r.name, id])

  // створювати може й роль без права змінювати (і навпаки)
  const editable = (f: Resource['fields'][number]) => (creating ? r.canCreate : r.canWrite) && f.form !== false && (!f.readonly || (creating && f.create))
  const fields = r.fields.filter((f) => f.view !== 'none' && (creating ? editable(f) : true))
  // дозволи ролі — не в сітці форми, а окремими блоками під нею (група розділів — своя картка)
  const blocks = fields.filter((f) => f.type === 'permissions')
  // «чий» власник (людина / гільдія) — частина поля «Власник», окремим полем не показуємо
  const kinds = new Set(r.fields.map((f) => f.kindField).filter(Boolean))
  const value = (k: string) => (k in draft ? draft[k] : row?.[k])
  const dirty = Object.keys(draft).length > 0
  /** людина щось змінила сама (заповнене з ?prefill= — ще ні) */
  const [, setTouched] = useState(false)
  const change = (k: string, v: unknown) => { setTouched(true); setDraft((d) => ({ ...d, [k]: v })); setFieldErr((e) => { const { [k]: _, ...rest } = e; return rest }) }
  const canSave = creating ? r.canCreate : r.canWrite

  // незбережене (і новий запис) — смуга внизу, як на всьому сайті (components/UnsavedBar): поки вона є, піти з картки
  // не можна (смуга трусить), закрити вкладку — питає браузер
  useUnsaved((dirty || creating) && canSave, {
    save: () => { if (bad.current.size > 0) { toast.error(t('Виправ поля з помилками')); return } return save() },
    discard: () => { if (creating) goAdmin(backTo() ?? [r.name], { force: true }); else { setDraft({}); setTouched(false); setFieldErr({}); bad.current.clear(); setVer((n) => n + 1) } },
    label: creating ? t('Новий запис') : t('Є незбережені зміни'),
  })

  const save = async () => {
    if (bad.current.size) { toast.error(t('Виправ хибний JSON у полі «{field}»', { field: t(r.fields.find((f) => bad.current.has(f.key))?.label ?? '') })); return }
    // обов'язкові порожні — одразу біля полів
    if (creating) {
      const miss = fields.filter((f) => editable(f) && f.required && (value(f.key) == null || value(f.key) === ''))
      if (miss.length) { setFieldErr(Object.fromEntries(miss.map((f) => [f.key, t('Заповни це поле')]))); document.getElementById(`f-${miss[0].key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
    }
    setBusy(true)
    try {
      if (creating) {
        const out = await adminApi.create(r.name, draft)
        toast.success(t('{what}: створено', { what: t(r.one) }))
        // з вкладки картки — назад на неї, інакше — на новий запис
        goAdmin(backTo() ?? [r.name, out._id], { replace: true, force: true })
      } else {
        // updated, з яким картку відкрили, — щоб не затерти чужу зміну, зроблену тим часом
        const out = await adminApi.update(r.name, id, row && row.updated != null ? { ...draft, _updated: row.updated } : draft)
        toast.success(t('Збережено'))
        setDraft({}); setTouched(false)
        if (out._id !== id) goAdmin([r.name, out._id], { replace: true, force: true })
        else setRow(out)
      }
    } catch (e) {
      const field = e instanceof ApiError ? (e.body as { field?: string } | null)?.field : undefined
      if (field) { setFieldErr({ [field]: (e as Error).message }); document.getElementById(`f-${field}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  // Ctrl/⌘+S — зберегти, коли є що
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && (dirty || creating) && canSave) { e.preventDefault(); void saveRef.current() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [dirty, creating, canSave])
  const composed = row && r.titleFields ? r.titleFields.map((k) => { const f = r.fields.find((x) => x.key === k); return f ? textOf(f, row) : '' }).filter(Boolean).join(' · ') : ''
  // без власної назви — підпис від сервера (рецепт — назвою того, що з нього виходить)
  const title = creating ? t('Новий запис: {what}', { what: t(r.one) }) : row ? String((r.title && (row[r.title] || row[r.title + '__label'])) || composed || row._id) : '…'
  // назва запису — і в крихти над заголовком
  useEffect(() => { useAdmin.setState({ title: creating ? null : row ? title : null }); return () => useAdmin.setState({ title: null }) }, [creating, row, title])
  const href = row ? siteHref(r, row) : null
  const shown = fields.filter((f) => f.type !== 'permissions' && !kinds.has(f.key))
  const main = shown.filter((f) => !f.advanced)
  const advanced = shown.filter((f) => f.advanced)
  /** значення всієї форми (варіанти, що залежать від іншого поля) */
  const values = { ...(row ?? {}), ...draft }
  const cell = (f: Resource['fields'][number]) => {
    const canEdit = editable(f)
    return (
      <div key={`${f.key}:${ver}`} id={`f-${f.key}`} className={WIDE.has(f.type) || (f.refs && f.type === 'pairs') ? 'min-w-0 md:col-span-2' : 'min-w-0'}>
        {/* підказка «лише при створенні» на готовому записі — зайва */}
        <FieldShell f={{ ...f, required: canEdit && f.required, help: f.readonly && f.create && !creating ? undefined : f.help }} error={fieldErr[f.key]}>
          {canEdit
            ? <FieldInput f={f} value={value(f.key)} row={row ?? undefined} values={values} resource={r.name} onChange={(v) => change(f.key, v)} onKind={f.kindField ? (k) => change(f.kindField!, k) : undefined}
                onInvalid={(b) => { const had = bad.current.has(f.key); if (b) bad.current.add(f.key); else bad.current.delete(f.key); if (had !== b) bump((n) => n + 1) }} />
            : <div className="min-h-8 min-w-0 py-1 text-[14px]"><ValueView f={f} row={row ?? {}} /></div>}
        </FieldShell>
      </div>
    )
  }
  const rowActions = row ? r.actions.filter((a) => a.row && actionShown(a, row)) : []

  if (error) return <PageError title={t('Запис не відкрився')} message={error} onRetry={() => { setError(''); load() }} />
  if (!creating && !row) return <div className="grid gap-3"><SnSkeleton height={36} width="40%" /><SnSkeleton lines={8} /></div>

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 pb-24">
      <PageHeader
        title={title}
        actions={
          !creating && (
            <>
              {href && <SnButton variant="outline" href={href} target="_blank"><ExternalLink size={14} />{t('На сайті')}</SnButton>}
              {r.name === 'bases' && <SnButton variant="outline" href={`/api/bases/${encodeURIComponent(id!)}/export`}><Download size={14} />{t('Вивантажити')}</SnButton>}
              {rowActions.map((a) => (
                <SnButton key={a.key} variant={a.tone === 'critical' ? 'destructive' : 'outline'} onClick={async () => { if (await runAction(r, a, [id!])) load() }}>{t(a.label)}</SnButton>
              ))}
              {r.canDelete && (
                <SnButton variant="destructive" onClick={async () => { if (await removeRows(r, [id!])) goAdmin([r.name], { replace: true }) }}><Trash2 size={14} />{t('Видалити')}</SnButton>
              )}
            </>
          )
        }
      />
      <Panel>
        <form
          className="grid grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-4 md:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); void save() }}
        >
          {main.map(cell)}
        </form>
      </Panel>
      {/* службове (вміст як дані, внутрішні коди) — згорнутим; при створенні обов'язкове — відкритим */}
      {advanced.length > 0 && (
        <section className="rounded-xl border border-line bg-panel">
          <button type="button" aria-expanded={showAdv} onClick={() => setShowAdv((x) => !x)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-[14px] font-semibold">
            {showAdv ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
            {t('Технічні дані')}
            <span className="font-normal text-muted text-[12.5px]">{advanced.map((f) => t(f.label)).join(' · ')}</span>
          </button>
          {showAdv && <div className="grid grid-cols-[minmax(0,1fr)] gap-x-5 gap-y-4 border-t border-line px-4 py-4 md:grid-cols-2">{advanced.map(cell)}</div>}
        </section>
      )}
      {blocks.map((f) => (
        <PermissionsBlocks key={f.key} value={value(f.key)} readonly={!editable(f)} onChange={(v) => change(f.key, v)} />
      ))}
      {!creating && r.name === 'cron-jobs' && row && <CronJobLog job={String(row.key)} row={row} onDone={load} />}
      {!creating && r.name === 'cron-runs' && row && <Panel title={t('Журнал')}><LogView id={String(row.id)} name={String(row.job ?? '')} onDone={load} /></Panel>}
      {!creating && r.preview === 'base3d' && row && <BasePhotoPanel id={String(row.id)} canWrite={r.canWrite} version={Number(row.version)} />}
      {!creating && r.preview === 'base3d' && row && <Base3D id={String(row.id)} canWrite={r.canWrite} onSaved={load} />}
      {!creating && (r.name === 'base-history' || r.name === 'roadmap-history') && row && (
        <Panel title={t('Що змінилось у наступній версії')}><VersionDiff kind={r.name === 'base-history' ? 'base' : 'roadmap'} hid={Number(row.hid)} /></Panel>
      )}
      {!creating && r.name === 'revisions' && row && <Panel title={t('Різниця')}><RevisionDiff id={Number(row.id)} /></Panel>}
      {!creating && r.texts && row && <GameTexts kind={r.texts} id={id!} canWrite={!!resourceOf('game-texts')?.canWrite} />}
      {!creating && row && <Related r={r} id={id!} />}
    </div>
  )
}

/** назва й опис запису гри всіма мовами (свої правки — закріплені: імпорт їх не перепише) */
function GameTexts({ kind, id, canWrite }: { kind: string; id: string; canWrite: boolean }) {
  const [texts, setTexts] = useState<Record<string, { name: string; description: string; source?: string; locked?: boolean }> | null>(null)
  const [edit, setEdit] = useState<Record<string, { name: string; description: string }>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // не завантажились — так і кажемо (порожні поля вводили б в оману)
  useEffect(() => { adminApi.gameTexts(kind, id).then((r) => { setTexts(r.texts); setEdit({}); setErr('') }).catch((e) => setErr((e as Error).message)) }, [kind, id])
  const langs = useMemo(() => LANGS.filter((l) => l.code !== 'en'), [])
  // звідки текст — підписом («Файли гри», «Вручну»), як у розділі текстів гри
  const srcF = resourceOf('game-texts')?.fields.find((f) => f.key === 'source')
  // змінені тексти — у смузі незбережених змін (як решта панелі)
  const saveRef = useRef<() => Promise<void>>(async () => {})
  useUnsaved(canWrite && Object.keys(edit).length > 0, { save: () => saveRef.current(), discard: () => setEdit({}), label: t('Тексти мовами гри не збережено') })
  if (err) return <Panel title={t('Тексти мовами гри')}><p className="text-[13px] text-bad">{err}</p></Panel>
  if (!texts) return null
  const cur = (l: string) => edit[l] ?? { name: texts[l]?.name ?? '', description: texts[l]?.description ?? '' }
  const save = async () => {
    setBusy(true)
    try {
      await adminApi.saveGameTexts(kind, id, edit)
      toast.success(t('Тексти збережено'))
      const r = await adminApi.gameTexts(kind, id)
      setTexts(r.texts); setEdit({})
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  saveRef.current = save
  return (
    <Panel
      title={t('Тексти мовами гри')}
      description={t('Англійська — у полях вище. Порожньо — сайт покаже англійську назву.')}
      action={busy ? <span className="text-[12px] text-muted">{t('Зберігаю…')}</span> : undefined}
    >
      <div className="grid gap-2.5">
        {langs.map((l) => (
          <div key={l.code} className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-line p-2.5 md:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1.4fr)] md:items-start">
            <div className="flex items-center gap-2 pt-1.5 text-[13px] font-semibold">
              {l.name}
              {texts[l.code]?.source && <SnBadge size="sm" variant="outline" tone={texts[l.code]?.locked ? 'info' : 'neutral'}>{srcF ? textOf(srcF, { source: texts[l.code]!.source }) : texts[l.code]!.source}</SnBadge>}
            </div>
            <SnInput modelValue={cur(l.code).name} readOnly={!canWrite} placeholder={t('Назва')} accessibilityLabel={t('Назва: {lang}', { lang: l.name })} onInput={(e: Event) => setEdit((s) => ({ ...s, [l.code]: { ...cur(l.code), name: valueOf(e) } }))} />
            <SnTextarea rows={2} modelValue={cur(l.code).description} readOnly={!canWrite} placeholder={t('Опис')} accessibilityLabel={t('Опис: {lang}', { lang: l.name })} onInput={(e: Event) => setEdit((s) => ({ ...s, [l.code]: { ...cur(l.code), description: valueOf(e) } }))} />
          </div>
        ))}
      </div>
    </Panel>
  )
}

/** пов'язані записи (вкладками) та історія змін запису */
function Related({ r, id }: { r: Resource; id: string }) {
  const perms = useAdmin((s) => s.meta?.permissions ?? [])
  const canHistory = r.history && hasPerm(perms, 'revisions.view')
  // вкладка — в адресі (?tab=members), ключ — назва пов'язаного розділу (кілька зв'язків з одним — ще й поле)
  const tabs = r.relations.map((rel) => ({ key: relKey(rel, r.relations), rel, res: resourceOf(rel.resource) })).filter((x) => x.res)
  const keys = [...tabs.map((x) => x.key), ...(canHistory ? ['history'] : [])]
  const [cur, setCur] = useUrlParam('tab', keys[0] ?? 'history', (v) => keys.includes(v))
  // скільки записів у кожній вкладці (одним запитом)
  const [counts, setCounts] = useState<(number | null)[]>([])
  const countsKey = `${r.name}/${id}`
  useEffect(() => {
    if (!tabs.length) return
    adminApi.counts(tabs.map((x) => [x.rel.resource, fixedOf(x.rel, id)])).then(setCounts).catch(() => setCounts([]))
  }, [countsKey])
  if (!tabs.length && !canHistory) return null
  const tab = tabs.find((x) => x.key === cur)
  // «Створити» — для поточної вкладки, з уже заданим зв'язком (форма відкриється з ним заповненим); «містить» (has) — ні
  const create = tab?.res?.canCreate && !tab.rel.has
    ? () => goAdmin([tab.res!.name, 'new'], { search: `?prefill=${encodeURIComponent(JSON.stringify(fixedOf(tab.rel, id)))}&back=${encodeURIComponent([r.name, id].map(encodeURIComponent).join('/'))}` })
    : null
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 pt-2" aria-label={t('Пов\'язані записи')}>
      <SnTabs className="block min-w-0" modelValue={cur} onChange={(e: Event) => setCur(valueOf(e), { replace: true })}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 max-w-full overflow-x-auto">
            <SnTabsList>
              {tabs.map((x, i) => (
                <SnTabsTrigger key={x.key} value={x.key}>
                  {x.rel.label ? t(x.rel.label) : t(x.res!.label)}
                  {counts[i] != null && <span className="ml-1.5 text-[12px] font-normal tabular-nums text-muted">{counts[i]!.toLocaleString(locale())}</span>}
                </SnTabsTrigger>
              ))}
              {canHistory && <SnTabsTrigger value="history">{t('Історія змін')}</SnTabsTrigger>}
            </SnTabsList>
          </div>
          {create && <SnButton className="ml-auto" size="sm" variant="outline" onClick={create}><Plus size={14} />{t('Створити')}</SnButton>}
        </div>
        {tabs.map((x) => (
          <SnTabsContent key={x.key} value={x.key}>
            <div className="pt-1">{cur === x.key && <ResourceList r={x.res!} fixed={fixedOf(x.rel, id)} embedded />}</div>
          </SnTabsContent>
        ))}
        {canHistory && <SnTabsContent value="history"><div className="pt-1">{cur === 'history' && <History res={r.name} id={id} />}</div></SnTabsContent>}
      </SnTabs>
    </section>
  )
}

/**
 * База — тим самим переглядом, що й на сайті (план, 3D, легенда, приміщення), а з правом зміни — тим самим
 * редактором; «Назад» у редакторі повертає перегляд, після збереження запис панелі перечитується (нова версія).
 */
function Base3D({ id, canWrite, onSaved }: { id: string; canWrite: boolean; onSaved: () => void }) {
  // 3D важке — сховане, доки не відкрити (стан — в адресі: ?view=3d / ?view=edit)
  const [view, setView] = useUrlParam<'' | '3d' | 'edit'>('view', '', (v) => v === '3d' || v === 'edit')
  if (!view) {
    return (
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3" aria-label={t('База в 3D')}>
        <Box size={17} className="text-spice" />
        <h2 className="font-display text-[16px] font-bold">{t('База в 3D')}</h2>
        <span className="text-[13px] text-muted">{t('Сховано, щоб сторінка відкривалась швидко')}</span>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <SnButton size="sm" variant="outline" onClick={() => setView('3d')}><Box size={14} />{t('Показати 3D')}</SnButton>
          {canWrite && <SnButton size="sm" variant="outline" onClick={() => setView('edit')}><Pencil size={14} />{t('Редагувати в 3D')}</SnButton>}
        </div>
      </section>
    )
  }
  return <Base3DOpen id={id} canWrite={canWrite} onSaved={onSaved} edit={view === 'edit'} setEdit={(e) => setView(e ? 'edit' : '3d', { replace: true })} onHide={() => setView('', { replace: true })} />
}

function Base3DOpen({ id, canWrite, onSaved, edit, setEdit, onHide }: { id: string; canWrite: boolean; onSaved: () => void; edit: boolean; setEdit: (v: boolean) => void; onHide: () => void }) {
  const env = useBases((s) => s.docs[id])
  useEffect(() => { void useBases.getState().loadBase(id, true) }, [id])
  if (env === 'missing') return null
  if (env === 'error') return <PageError title={t('Базу не завантажено')} message={t('Не вдалося завантажити базу — перевір з’єднання й спробуй ще раз.')} onRetry={() => void useBases.getState().loadBase(id, true)} />
  const canEdit = canWrite && !!env?.item?.can?.edit
  return (
    <section className="grid min-w-0 gap-2.5 pt-2" aria-label={t('База в 3D')}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-[16px] font-bold">{t('База в 3D')}</h2>
        <div className="ml-auto flex gap-2">
          {canEdit && !edit && <SnButton size="sm" variant="outline" onClick={() => setEdit(true)}><Pencil size={14} />{t('Редагувати в 3D')}</SnButton>}
          <SnButton size="sm" variant="outline" href={`/bases/${encodeURIComponent(id)}`} target="_blank"><ExternalLink size={14} />{t('На сайті')}</SnButton>
          {!edit && <SnButton size="sm" variant="ghost" onClick={onHide}>{t('Сховати 3D')}</SnButton>}
        </div>
      </div>
      {!env
        ? <Loading lines={6} />
        : edit
          ? <Builder key={`${env.id}:${env.version}`} env={env} onExit={() => { setEdit(false); void useBases.getState().loadBase(id, true).then(onSaved) }} />
          : <BaseViewer key={`${env.id}:${env.version}`} env={env} initialTab="3d" />}
    </section>
  )
}

/**
 * Фото бази — те, що бачить увесь сайт (список баз, головна, прев'ю посилань): знімок 3D, який малює сервер, чи своє
 * зображення. Клік — збільшити; «Завантажити своє» замінює знімок, «Повернути знімок» — навпаки; «Намалювати заново» —
 * свіжий знімок 3D (буває до хвилини).
 */
function BasePhotoPanel({ id, canWrite, version }: { id: string; canWrite: boolean; version: number }) {
  const [p, setP] = useState<BasePhoto | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  const [broken, setBroken] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { adminApi.basePhoto(id).then((x) => { setP(x); setErr('') }).catch((e) => setErr((e as Error).message)) }, [id, version])
  useEffect(() => setBroken(false), [p?.url])
  const run = async (key: string, fn: () => Promise<BasePhoto>, done: string) => {
    setBusy(key)
    try { setP(await fn()); toast.success(done) } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const upload = (f: File | undefined) => { if (f) void run('up', () => adminApi.setBasePhoto(id, f), t('Фото бази змінено — його вже бачить увесь сайт')) }
  return (
    <Panel
      title={t('Фото бази')}
      description={p ? (p.custom ? t('Своє зображення — замість знімка 3D, його бачить увесь сайт.') : t('Знімок 3D, який малює сервер після кожного збереження.')) : undefined}
      action={p && <SnBadge size="sm" variant="soft" tone={p.custom ? 'info' : 'neutral'}>{p.custom ? t('Своє фото') : t('Знімок 3D')}</SnBadge>}
    >
      {err ? <p className="text-[13px] text-bad">{err}</p> : !p ? <SnSkeleton height={160} /> : (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,360px)_minmax(0,1fr)] sm:items-start">
          <button type="button" onClick={() => p.url && !broken && setZoom(true)} disabled={!p.url || broken}
            className="relative aspect-[1600/934] w-full overflow-hidden rounded-lg border border-line bg-panel2/50 enabled:hover:border-spice/50" aria-label={t('Збільшити фото бази')}>
            {p.url && !broken
              ? <img src={p.url} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
              : <span className="absolute inset-0 grid place-items-center gap-1 p-3 text-center text-[12.5px] text-muted"><ImageOff size={22} className="mx-auto" />{t('Знімка ще нема або він не вдався')}</span>}
            {busy === 'redraw' && <span className="absolute inset-0 grid place-items-center bg-panel/70 text-[13px]">{t('Малюю знімок…')}</span>}
          </button>
          {canWrite ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-2">
                <SnButton size="sm" variant="outline" loading={busy === 'up'} onClick={() => file.current?.click()}><Upload size={14} />{p.custom ? t('Замінити своє фото') : t('Завантажити своє фото')}</SnButton>
                {p.custom
                  ? <SnButton size="sm" variant="ghost" loading={busy === 'drop'} onClick={() => run('drop', () => adminApi.dropBasePhoto(id), t('Знову знімок 3D'))}><RotateCcw size={14} />{t('Повернути знімок 3D')}</SnButton>
                  : <SnButton size="sm" variant="ghost" loading={busy === 'redraw'} onClick={() => run('redraw', () => adminApi.redrawBasePhoto(id), t('Знімок намальовано заново'))}><RefreshCw size={14} />{t('Намалювати знімок заново')}</SnButton>}
              </div>
              <p className="text-[12.5px] text-muted">{t('Своє фото обріжеться по центру до пропорцій знімка. Підійде PNG, JPEG, WebP чи AVIF до 12 МБ.')}</p>
              <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
            </div>
          ) : <p className="text-[12.5px] text-muted">{t('Змінювати фото може той, кому можна змінювати бази.')}</p>}
        </div>
      )}
      {zoom && p?.url && (
        <Modal open onOpenChange={(o) => !o && setZoom(false)} title={t('Фото бази')} size="lg">
          <img src={p.url} alt="" className="max-h-[75vh] w-full rounded-lg object-contain" />
        </Modal>
      )}
    </Panel>
  )
}

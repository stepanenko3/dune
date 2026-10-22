/**
 * Запис розділу: створення й редагування в одній формі (поля з опису розділу), дії із записом, видалення, посилання
 * на сайт; під формою — пов'язані записи інших розділів (як relation managers у Filament: список із пошуком, створення
 * з уже заданим зв'язком), історія змін із різницею між версіями, для бази — 3D (і редактор), для даних гри — тексти
 * всіма мовами. Незбережені зміни — у смужці внизу (зберегти / відкинути).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { SnBadge, SnButton, SnInput, SnSkeleton, SnTabs, SnTabsContent, SnTabsList, SnTabsTrigger, SnTextarea, valueOf } from '@/components/sn'
import { Loading, PageError } from '@/components/states'
import { useBases } from '@/lib/bases'
import { useUrlParam } from '@/lib/urlState'
import { BaseViewer } from '@/components/base/BaseViewer'
import { Builder } from '@/components/base/builder/Builder'
import { LANGS, t } from '@/lib/i18n'
import { ApiError } from '@/lib/api'
import { adminApi, actionShown, fixedOf, goAdmin, hasPerm, resourceOf, siteHref, useAdmin, type Resource, type Row } from './api'
import { ResourceList } from './ResourceList'
import { History, VersionDiff, RevisionDiff } from './history'
import { removeRows, runAction } from './actions'
import { FieldInput, FieldShell, PermissionsBlocks, ValueView, textOf } from './fields'
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
  const title = creating ? t('Новий запис: {what}', { what: t(r.one) }) : row ? String((r.title && row[r.title]) || composed || row._id) : '…'
  // назва запису — і в крихти над заголовком
  useEffect(() => { useAdmin.setState({ title: creating ? null : row ? title : null }); return () => useAdmin.setState({ title: null }) }, [creating, row, title])
  const href = row ? siteHref(r, row) : null
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
          {fields.filter((f) => f.type !== 'permissions' && !kinds.has(f.key)).map((f) => {
            const canEdit = editable(f)
            return (
              <div key={`${f.key}:${ver}`} id={`f-${f.key}`} className={WIDE.has(f.type) ? 'min-w-0 md:col-span-2' : 'min-w-0'}>
                {/* підказка «лише при створенні» на готовому записі — зайва */}
                <FieldShell f={{ ...f, required: canEdit && f.required, help: f.readonly && f.create && !creating ? undefined : f.help }} error={fieldErr[f.key]}>
                  {canEdit
                    ? <FieldInput f={f} value={value(f.key)} row={row ?? undefined} onChange={(v) => change(f.key, v)} onKind={f.kindField ? (k) => change(f.kindField!, k) : undefined}
                        onInvalid={(b) => { const had = bad.current.has(f.key); if (b) bad.current.add(f.key); else bad.current.delete(f.key); if (had !== b) bump((n) => n + 1) }} />
                    : <div className="min-h-8 min-w-0 py-1 text-[14px]"><ValueView f={f} row={row ?? {}} /></div>}
                </FieldShell>
              </div>
            )
          })}
        </form>
      </Panel>
      {blocks.map((f) => (
        <PermissionsBlocks key={f.key} value={value(f.key)} readonly={!editable(f)} onChange={(v) => change(f.key, v)} />
      ))}
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
              {texts[l.code]?.source && <SnBadge size="sm" variant="outline" tone={texts[l.code]?.locked ? 'info' : 'neutral'}>{texts[l.code]!.source}</SnBadge>}
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
  // вкладка — в адресі (?tab=members), ключ — назва пов'язаного розділу
  const tabs = r.relations.map((rel) => ({ key: rel.resource, rel, res: resourceOf(rel.resource) })).filter((x) => x.res)
  const keys = [...tabs.map((x) => x.key), ...(canHistory ? ['history'] : [])]
  const [cur, setCur] = useUrlParam('tab', keys[0] ?? 'history', (v) => keys.includes(v))
  if (!tabs.length && !canHistory) return null
  const tab = tabs.find((x) => x.key === cur)
  // «Створити» — для поточної вкладки, з уже заданим зв'язком (форма відкриється з ним заповненим)
  const create = tab?.res?.canCreate
    ? () => goAdmin([tab.res!.name, 'new'], { search: `?prefill=${encodeURIComponent(JSON.stringify(fixedOf(tab.rel, id)))}&back=${encodeURIComponent([r.name, id].map(encodeURIComponent).join('/'))}` })
    : null
  return (
    <section className="grid min-w-0 gap-3 pt-2" aria-label={t('Пов\'язані записи')}>
      <SnTabs modelValue={cur} onChange={(e: Event) => setCur(valueOf(e), { replace: true })}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 overflow-x-auto">
            <SnTabsList>
              {tabs.map((x) => <SnTabsTrigger key={x.key} value={x.key}>{x.rel.label ? t(x.rel.label) : t(x.res!.label)}</SnTabsTrigger>)}
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
  const env = useBases((s) => s.docs[id])
  const [edit, setEdit] = useState(false)
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

/**
 * Список розділу: таблиця з пошуком, фільтрами, сортуванням, вибором стовпців і сторінками (усе — на сервері), вибір
 * рядків і масові дії, дії з рядком, створення. Фільтри за зв'язками (людина, гільдія, власник) — у «Фільтрах», текстом:
 * сервер шукає за іменем, поштою, назвою (весь список не тягнемо). embedded — пов'язаний список на картці іншого запису:
 * лише таблиця (умови fixed закріплені; «Створити» — у рядку вкладок картки, ResourceForm).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { SnButton, SnDataTable } from '@/components/sn'
import { ErrorAlert } from '@/components/states'
import { t } from '@/lib/i18n'
import { adminApi, actionShown, download, goAdmin, siteHref, type ListQuery, type Resource, type Row } from './api'
import { removeRows, runAction } from './actions'
import { columns, filters, requestFromUrl, tableLabels, tableRows, toQuery } from './table'
import { PageHeader } from './ui'
import { AnnouncementsBulk } from './AnnouncementsBulk'
import { ImportBase } from '@/components/base/ImportBase'
import { DuneLoader } from '@/components/ui/dune-loader'
import { cn } from '@/lib/utils'

/** стан таблиці (пошук, фільтри, сортування, сторінка) — в адресі з цим префіксом: посилання й «Назад» його зберігають */
const NS = 't'
/** сховані людиною стовпці — у браузері, для кожного розділу свої */
const hiddenKey = (name: string) => `admin:cols:${name}`
const readHidden = (name: string): string[] | null => { try { const v = localStorage.getItem(hiddenKey(name)); return v ? JSON.parse(v) : null } catch { return null } }

export function ResourceList({ r, fixed, embedded }: { r: Resource; fixed?: Record<string, string>; embedded?: boolean }) {
  const [data, setData] = useState<{ rows: Row[]; total: number }>({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  /** перший раз — ще нема рядків: тоді скелет таблиці; далі (пошук, фільтри, сторінки) — таблиця лишається, а поруч індикатор */
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [bulk, setBulk] = useState(false)
  const [baseImport, setBaseImport] = useState(false)
  const query = useRef<ListQuery>({ page: 0, size: embedded ? 10 : 25, search: '', sort: null, desc: false, filters: {} })
  const [exporting, setExporting] = useState(false)
  const seq = useRef(0)
  const fixedKey = JSON.stringify(fixed ?? {})

  const load = useCallback(async (q: ListQuery = query.current) => {
    query.current = q
    const n = ++seq.current
    setLoading(true)
    try {
      const res = await adminApi.list(r.name, { ...q, fixed: fixed && Object.keys(fixed).length ? fixed : undefined })
      if (n === seq.current) { setData({ rows: res.rows, total: res.total }); setError(''); setLoadedOnce(true) }
    } catch (e) {
      if (n === seq.current) setError((e as Error).message)
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }, [r.name, fixedKey])

  useEffect(() => {
    // відкрили за посиланням із фільтрами — одразу з ними (таблиця сама їх теж прочитає з адреси)
    const fromUrl = embedded ? null : requestFromUrl(NS)
    query.current = fromUrl ? toQuery(r, fromUrl) : { page: 0, size: embedded ? 10 : 25, search: '', sort: null, desc: false, filters: {} }
    setSelected([])
    void load()
  }, [r.name, load])

  // стовпці: сховані людиною (пам'ятає браузер) замість типово схованих
  const cols = useMemo(() => {
    const hidden = embedded ? null : readHidden(r.name)
    return columns(r)
      .filter((c) => !fixed || !(String(c.key).replace(/^f_/, '') in fixed))
      .map((c) => (hidden ? { ...c, defaultHidden: hidden.includes(String(c.key)) } : c))
  }, [r, fixedKey])
  const quick = useMemo(() => (embedded ? [] : (r.quick ?? []).map((q) => ({ key: q.key, label: t(q.label) }))), [r, embedded])
  const exportCsv = async () => {
    setExporting(true)
    try { await download(adminApi.exportUrl(r.name, query.current), `${r.name}.csv`) } catch (e) { toast.error((e as Error).message) } finally { setExporting(false) }
  }
  const flt = useMemo(() => filters({ ...r, fields: r.fields.filter((f) => !(fixed && f.key in fixed)) }, {}), [r, fixedKey])
  const rows = useMemo(() => tableRows(data.rows), [data.rows])
  const labels = useMemo(() => tableLabels(), [])
  const rowActions = useMemo(() => [
    { key: '__open', label: r.canWrite ? t('Редагувати') : t('Переглянути') },
    ...(r.link ? [{ key: '__site', label: t('Відкрити на сайті'), hidden: (row: Record<string, unknown>) => !siteHref(r, row.__row as Row) }] : []),
    ...(r.name === 'bases' ? [{ key: '__export', label: t('Вивантажити файлом') }] : []),
    ...r.actions.filter((a) => a.row).map((a) => ({ key: a.key, label: t(a.label), variant: a.tone === 'critical' ? 'destructive' : 'default', hidden: (row: Record<string, unknown>) => !actionShown(a, row.__row as Row) })),
    ...(r.canDelete ? [{ key: '__delete', label: t('Видалити'), variant: 'destructive' }] : []),
  ], [r])

  const onRowAction = async (e: Event) => {
    const { key, row } = (e as CustomEvent<{ key: string; row: Record<string, unknown> }>).detail
    const rec = row.__row as Row
    if (key === '__open') return goAdmin([r.name, rec._id])
    if (key === '__site') { const h = siteHref(r, rec); if (h) window.open(h, '_blank'); return }
    if (key === '__export') { await download(`/api/bases/${encodeURIComponent(rec._id)}/export`, `${rec._id}.json`).catch((e) => toast.error((e as Error).message)); return }
    if (key === '__delete') { if (await removeRows(r, [rec._id])) void load(); return }
    const a = r.actions.find((x) => x.key === key)
    if (a && (await runAction(r, a, [rec._id]))) void load()
  }
  const bulkActions = r.actions.filter((a) => a.bulk)
  // вибір рядків — лише коли з вибраним є що робити
  const canSelect = bulkActions.length > 0 || r.canDelete
  const globalActions = r.actions.filter((a) => a.global)
  // виконали щось із вибраними — вибір знімаємо (і в самій таблиці)
  const tableEl = useRef<HTMLElement & { clearSelection?: () => void }>(null)
  // поле пошуку таблиці сидить у тіньовому DOM двох рівнів і має 13 px: iPhone на фокусі збільшив би сторінку (і не
  // повернув) — додаємо йому свій стиль на сенсорних екранах (::part туди не дістає, розмір у полі — не змінною)
  useEffect(() => {
    let tries = 0, h = 0
    const fix = () => {
      const root = tableEl.current?.shadowRoot?.querySelector('sn-input')?.shadowRoot
      if (!root) { if (++tries < 40) h = window.setTimeout(fix, 150); return }
      if ((root as ShadowRoot & { swFix?: boolean }).swFix) return
      const sheet = new CSSStyleSheet()
      sheet.replaceSync('@media (pointer: coarse) { input { font-size: 16px !important; } }')
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      (root as ShadowRoot & { swFix?: boolean }).swFix = true
    }
    fix()
    return () => clearTimeout(h)
  }, [])
  const unselect = () => { tableEl.current?.clearSelection?.(); setSelected([]) }
  const runBulk = async (key: string) => {
    if (key === '__delete') { if (await removeRows(r, selected)) { unselect(); void load() } return }
    const a = r.actions.find((x) => x.key === key)!
    if (await runAction(r, a, selected)) { unselect(); void load() }
  }
  const create = () => goAdmin([r.name, 'new'])

  const actions = (
    <>
      {!embedded && globalActions.map((a) => (
        <SnButton key={a.key} variant="outline" onClick={async () => { if (await runAction(r, a, [])) void load() }}>{t(a.label)}</SnButton>
      ))}
      {!embedded && r.name === 'announcements' && r.canCreate && <SnButton variant="outline" onClick={() => setBulk(true)}>{t('Створити кілька')}</SnButton>}
      {!embedded && r.name === 'bases' && r.canCreate && <SnButton variant="outline" onClick={() => setBaseImport(true)}><Upload size={15} />{t('Імпортувати з файлу')}</SnButton>}
      {!embedded && <SnButton variant="outline" loading={exporting} data-tip={t('Усе, що зараз у таблиці (з пошуком і фільтрами), — файлом для Excel чи Google Таблиць')} onClick={exportCsv}><Download size={15} />{t('CSV')}</SnButton>}
      {r.canCreate && <SnButton variant="primary" onClick={create}><Plus size={15} />{t('Створити')}</SnButton>}
    </>
  )

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      {!embedded && <PageHeader title={t(r.label)} about={r.about ? t(r.about) : undefined} actions={actions} />}
      {error && <ErrorAlert title={t('Список не завантажився')} message={error} />}
      <div className={cn('relative min-w-0 overflow-x-auto transition-opacity', loading && loadedOnce && 'opacity-70')} aria-busy={loading}>
        {loading && loadedOnce && (
          <span role="status" className="pointer-events-none absolute right-2 top-12 z-10 inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-1 text-[12px] text-muted shadow-sm">
            <DuneLoader size={16} />{t('Завантаження…')}
          </span>
        )}
        <SnDataTable
          ref={tableEl}
          manual
          paginated
          selectable={canSelect}
          selectionMode={canSelect ? 'page' : 'none'}
          columnVisibility={!embedded}
          rowClickable
          urlSync={embedded ? false : NS}
          quickFilters={quick}
          locale={document.documentElement.lang || undefined}
          pageSizeOptions={embedded ? [10, 25, 50] : [25, 50, 100, 200]}
          loading={loading && !loadedOnce}
          columns={cols}
          rows={rows}
          total={data.total}
          filters={flt}
          rowActions={rowActions}
          labels={labels}
          emptyTitle={t('Нічого немає')}
          emptyDescription={embedded ? t('Тут поки порожньо.') : t('Спробуй інший пошук чи фільтри.')}
          onRequest={(e: Event) => void load(toQuery(r, (e as CustomEvent).detail))}
          onRowClick={(e: Event) => goAdmin([r.name, ((e as CustomEvent).detail.__row as Row)._id])}
          onRowAction={onRowAction}
          onSelectionChange={(e: Event) => setSelected((e as CustomEvent<{ selected: string[] }>).detail.selected)}
          onColumnVisibilityChange={(e: Event) => {
            if (embedded) return
            const vis = (e as CustomEvent<Record<string, boolean>>).detail
            try { localStorage.setItem(hiddenKey(r.name), JSON.stringify(Object.entries(vis).filter(([, v]) => !v).map(([k]) => k))) } catch { /* приватний режим — не пам'ятаємо */ }
          }}
        >
          {selected.length > 0 && (
            <div slot="bulk-actions" className="flex flex-wrap items-center gap-1.5">
              {bulkActions.map((a) => (
                <SnButton key={a.key} size="sm" variant={a.tone === 'critical' ? 'destructive' : 'outline'} onClick={() => runBulk(a.key)}>{t(a.label)}</SnButton>
              ))}
              {r.canDelete && <SnButton size="sm" variant="destructive" onClick={() => runBulk('__delete')}>{t('Видалити')}</SnButton>}
            </div>
          )}
        </SnDataTable>
      </div>
      {bulk && <AnnouncementsBulk onClose={(done) => { setBulk(false); if (done) void load() }} />}
      {baseImport && <ImportBase open={baseImport} onOpenChange={setBaseImport} onImported={(id) => goAdmin(['bases', id])} />}
    </div>
  )
}

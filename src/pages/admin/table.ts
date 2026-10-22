/**
 * Таблиця розділу на sn-datatable: колонки, фільтри й підписи з опису розділу; запит таблиці (пошук, фільтри,
 * сортування, сторінка) → запит до сервера.
 */
import { html } from 'lit'
import { t } from '@/lib/i18n'
import { plainClick } from '@/lib/urlState'
import { adminHref, goAdmin, type Field, type ListQuery, type Resource, type Row } from './api'
import { linkOf, textOf } from './fields'

/** у таблиці ключ рядка — _id (у деяких розділах «id» не унікальний), тож колонки — з префіксом */
export const colKey = (k: string) => 'f_' + k
export function tableRows(rows: Row[]) {
  return rows.map((r) => {
    const o: Record<string, unknown> = { id: r._id, __row: r }
    for (const [k, v] of Object.entries(r)) o[colKey(k)] = v
    return o
  })
}

export function columns(r: Resource) {
  return r.fields.filter((f) => f.list !== false).map((f) => {
    const c: Record<string, unknown> = { key: colKey(f.key), header: t(f.label), sortable: !!f.sort, toggleable: true, mono: !!f.mono, ...(f.hidden ? { defaultHidden: true } : {}) }
    // так / ні: галочка й прочерк (вбудована іконка таблиці «dash» у наборі іконок — логотип Dash, літера «D»)
    // посилання на інший запис (людина, гільдія, власник, запис у журналі) — у самій комірці; рядок при цьому не відкривається
    if (f.ref || f.type === 'relation' || f.type === 'owner') c.cell = ({ row }: { row: Record<string, unknown> }) => {
      const r = row.__row as Row, s = cellText(f, r), to = linkOf(f, r)
      return to && s ? html`<a href=${adminHref(to)} style="color:rgb(var(--c-spice))" @click=${(e: MouseEvent) => { if (!plainClick(e)) return; e.preventDefault(); goAdmin(to) }}>${s}</a>` : s
    }
    else if (f.type === 'bool') c.cell = ({ value }: { value: unknown }) => (value
      ? html`<span role="img" aria-label=${t('Так')} title=${t('Так')} style="display:inline-flex;color:rgb(var(--c-ok))"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>`
      : html`<span role="img" aria-label=${t('Ні')} title=${t('Ні')} style="color:rgb(var(--c-muted))">—</span>`)
    else if (f.type === 'select' && f.tones) {
      // бейдж із підписом мовою сайту (badgeTones показав би саме значення — «admin»)
      c.cell = ({ value, row }: { value: unknown; row: Record<string, unknown> }) =>
        value == null || value === '' ? '' : html`<sn-badge tone=${f.tones![String(value)] ?? 'neutral'} variant="soft">${textOf(f, row.__row as Row)}</sn-badge>`
    } else if (f.type === 'flag') {
      c.cell = ({ value }: { value: unknown }) => (value ? html`<sn-badge tone="warning" variant="soft">${textOf(f, { [f.key]: value })}</sn-badge>` : '')
    } else if (f.type === 'color') {
      c.cell = ({ value }: { value: unknown }) => (value ? html`<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:14px;height:14px;border-radius:999px;background:${String(value)};border:1px solid var(--border)"></span>${String(value)}</span>` : '')
    } else if (f.type === 'int' || f.type === 'num') c.format = 'numeric'
    // короткі ключі, розклади й дати — одним рядком (перенос посеред «catalog-sync» чи «0 4 * * 3» читається як два
    // значення); довгі id (адреси баз) хай переносяться, інакше стискають назви
    else if (f.mono || f.type === 'datetime') c.cell = ({ row }: { row: Record<string, unknown> }) => {
      const s = cellText(f, row.__row as Row)
      return f.type === 'datetime' || s.length <= 20 ? html`<span style="white-space:nowrap">${s}</span>` : s
    }
    // довге обрізаємо, а повністю — у підказці
    else c.cell = ({ row }: { row: Record<string, unknown> }) => {
      const full = textOf(f, row.__row as Row), s = cellText(f, row.__row as Row)
      return s === full ? s : html`<span title=${full}>${s}</span>`
    }
    return c
  })
}
const cellText = (f: Field, row: Row) => {
  const s = textOf(f, row)
  return s.length > 90 ? s.slice(0, 90) + '…' : s
}

export function filters(r: Resource, relationOptions: Record<string, { value: string; label: string }[]>) {
  return r.fields.filter((f) => f.filter).map((f) => {
    const base = { key: colKey(f.key), label: t(f.label) }
    switch (f.type) {
      case 'select': return { ...base, type: 'multiselect', options: (f.options || []).map((o) => ({ value: o.value, label: t(o.label) })) }
      // зв'язки (людина, гільдія, власник) — текстом: сервер шукає за іменем, поштою, назвою (не тягнемо весь список)
      case 'relation': return relationOptions[f.key]?.length ? { ...base, type: 'select', options: relationOptions[f.key] } : { ...base, type: 'text' }
      case 'owner': return { ...base, type: 'text' }
      case 'bool': return { ...base, type: 'ternary', trueLabel: t('Так'), falseLabel: t('Ні') }
      case 'flag': return { ...base, type: 'ternary', trueLabel: t('Так'), falseLabel: t('Ні') }
      case 'datetime': return { ...base, type: 'date-range' }
      case 'int': case 'num': return { ...base, type: 'number-range' }
      default: return { ...base, type: 'text' }
    }
  })
}

export interface TableRequest {
  search: string
  filterValues: Record<string, unknown>
  sorting: { key: string; desc: boolean }[]
  pagination: { pageIndex: number; pageSize: number }
  activeQuickFilters?: string[]
}

/** день «2026-10-19» → межа доби за годинником людини (а не UTC) */
const dayMs = (d: string, end = false) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return Date.parse(d)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (end ? 1 : 0)).getTime() - (end ? 1 : 0)
}
/** значення швидкого фільтра: '-7d' — тиждень тому від зараз */
const quickValue = (v: unknown): unknown => {
  if (typeof v === 'string') { const m = /^-(\d+)d$/.exec(v); return m ? Date.now() - Number(m[1]) * 86_400_000 : v }
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, quickValue(x)]))
  return v
}

/** стан таблиці з адреси (ns_q, ns_s, ns_p, ns_ps, ns_qf, ns_f — так пише sn-datatable з urlSync) */
export function requestFromUrl(ns: string): TableRequest | null {
  const p = new URLSearchParams(location.search), g = (k: string) => p.get(`${ns}_${k}`)
  if (!['q', 's', 'p', 'ps', 'qf', 'f'].some((k) => g(k) != null)) return null
  let filterValues: Record<string, unknown> = {}
  try { filterValues = JSON.parse(g('f') || '{}') } catch { /* хибне в адресі — без фільтрів */ }
  return {
    search: g('q') || '',
    filterValues,
    sorting: (g('s') || '').split(',').filter(Boolean).map((x) => (x.startsWith('-') ? { key: x.slice(1), desc: true } : { key: x, desc: false })),
    pagination: { pageIndex: Math.max(0, Number(g('p') || 1) - 1), pageSize: Number(g('ps')) || 25 },
    activeQuickFilters: (g('qf') || '').split(',').filter(Boolean),
  }
}
/** запит таблиці → запит до сервера */
export function toQuery(r: Resource, req: TableRequest): ListQuery {
  const f: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(req.filterValues || {})) {
    if (v == null || v === '') continue
    const field = r.fields.find((x) => colKey(x.key) === k)
    if (!field) continue
    if (field.type === 'bool' || field.type === 'flag') f[field.key] = v === true || v === 'true' ? 'yes' : 'no'
    else if (field.type === 'datetime') { const d = v as { start?: string; end?: string }; f[field.key] = { from: d.start ? dayMs(d.start) : null, to: d.end ? dayMs(d.end, true) : null } }
    else if (field.type === 'int' || field.type === 'num') { const d = v as { min?: number; max?: number; from?: number; to?: number }; f[field.key] = { from: d.min ?? d.from ?? null, to: d.max ?? d.to ?? null } }
    else if (field.type === 'relation' || field.type === 'owner') f[field.key] = { q: String(v) }
    else f[field.key] = v
  }
  // швидкі фільтри — поверх звичайних
  for (const k of req.activeQuickFilters ?? []) Object.assign(f, quickValue(r.quick?.find((q) => q.key === k)?.filters ?? {}) as Record<string, unknown>)
  const s = req.sorting?.[0]
  return {
    page: req.pagination?.pageIndex ?? 0,
    size: req.pagination?.pageSize ?? 25,
    search: req.search || '',
    sort: s ? s.key.replace(/^f_/, '') : null,
    desc: !!s?.desc,
    filters: f,
  }
}

/** підписи sn-datatable мовою сайту */
export const tableLabels = () => ({
  search: t('Пошук'), filters: t('Фільтри'), columns: t('Стовпці'), visibleColumns: t('Показані стовпці'), hiddenColumns: t('Сховані стовпці'),
  moveColumnUp: t('{label} — раніше'), moveColumnDown: t('{label} — пізніше'), hideColumn: t('Сховати {label}'), showColumn: t('Показати {label}'),
  apply: t('Застосувати'), clearAll: t('Скинути все'), clearFilters: t('Скинути фільтри ({count})'), removeFilter: t('Прибрати фільтр «{label}»'),
  selectedCount: t('Вибрано: {count}'), clearSelection: t('Зняти вибір'), loading: t('Завантаження…'), selectAll: t('Вибрати все'), selectRow: t('Вибрати рядок'),
  booleanTrue: t('Так'), booleanFalse: t('Ні'), rowActions: t('Дії з рядком'), actions: t('Дії'), rows: t('Рядків'), rowsPerPage: t('Рядків на сторінці'),
  pageInfo: t('Сторінка {page} з {pages}'), previousPage: t('Попередня сторінка'), nextPage: t('Наступна сторінка'), previous: t('Назад'), next: t('Далі'),
  emptyTitle: t('Нічого немає'), emptyFiltered: t('Спробуй інший пошук чи фільтри.'), emptyInitial: t('Тут поки порожньо.'),
  filterAll: t('Усі'), filterYes: t('Так'), filterNo: t('Ні'), searchFilter: t('Шукати: {label}…'), rangeMin: t('Від'), rangeMax: t('До'),
  rangeMinLabel: t('{label}: від'), rangeMaxLabel: t('{label}: до'), rangeStartLabel: t('{label}: з'), rangeEndLabel: t('{label}: по'), close: t('Закрити'),
  sort: t('Сортування'), sortBy: t('Сортувати за'), ascending: t('За зростанням'), descending: t('За спаданням'), groupBy: t('Групувати'), groupByNone: t('Без групування'),
  columnSearchPlaceholder: t('{header}…'), toggleCell: t('Перемкнути: {header}'), save: t('Зберегти'), cancel: t('Скасувати'),
})

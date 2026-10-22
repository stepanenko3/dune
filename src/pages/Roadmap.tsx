/**
 * Роадмап — документ (див. src/lib/roadmap.ts), повністю редагований тим, кому дано «редагувати»:
 * назва, вступ і цифри, «Зараз є», етапи (таблиця вартості, задачі, опис, порядок) і розділи з колонками.
 * Прогрес (статус етапу, задачі, «зібрано» на картках) — окремо від документа: чий він і хто відмічає, вирішують
 * права роадмапу (кнопка «Права», components/roadmap/RoadmapRights.tsx); сервер перевіряє те саме.
 * Тексти — у мінімальній розмітці (src/lib/md.tsx): **жирний**, [посилання](адреса), списки.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown, ArrowUp, Check, CheckCircle2, Circle, CircleDot, Eye, EyeOff, FileQuestion, History, ListPlus, Pencil, Plus, RotateCcw, Sigma, Table2, Trash2, Undo2, X,
} from 'lucide-react'
import { CopyCta, MembersButton, openRoadmapCopy, ProgressWhose, useMembers, useRightsExtra, type Who } from '@/components/roadmap/RoadmapRights'
import { useAuth } from '@/lib/auth'
import { Card, SectionTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import {
  blankSection, blankStage, blankTable, emptyPState, newId, nextStatus, statusOf, STATUS_LABEL, useRoadmap,
  type PState, type RBlock, type RColumn, type RoadmapDoc, type Revision, type RSection, type RStage, type RStatus, type RTable,
} from '@/lib/roadmap'
import { inline, Md } from '@/lib/md'
import { cn, word } from '@/lib/utils'
import { useStore } from '@/store'
import { ConfirmDialog } from '@/pages/Account'
import { ItemActions, ItemBar } from '@/components/access/Access'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorAlert, Loading, PageError } from '@/components/states'
import { SnCheckbox, SnInput, SnTextarea, checkedOf, valueOf } from '@/components/sn'
import { locale, t, T } from '@/lib/i18n'
import { prefGet, prefSet } from '@/lib/prefs'
import { useCrumb, useScopeOf } from '@/components/Crumbs'
import { useUnsaved } from '@/components/UnsavedBar'

type Edit = (recipe: (d: RoadmapDoc) => void, key?: string) => void

// шрифт самого поля sn-input лежить у тіньовому DOM — дістаємо його через ::part(input); розмір не міняємо (iPhone: ≥16px)
const IN = {
  bold: '[&::part(input)]:font-bold',
  semi: '[&::part(input)]:font-semibold',
  mono: '[&::part(input)]:font-mono',
  display: '[&::part(input)]:font-display',
  right: '[&::part(input)]:text-right',
  caps: '[&::part(input)]:uppercase [&::part(input)]:tracking-[0.14em]',
}
const iconBtn = 'grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line text-muted transition-colors hover:text-ink disabled:opacity-30'
const ghostBtn = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-line px-2.5 text-[12.5px] text-muted transition-colors hover:border-spice/60 hover:text-ink'

function move<T>(a: T[], i: number, d: -1 | 1) {
  const j = i + d
  if (j < 0 || j >= a.length) return
  ;[a[i], a[j]] = [a[j], a[i]]
}
/** видалення з «Повернути» в тості: вставляє елемент назад на те саме місце */
function removeWithUndo<T>(edit: Edit, pick: (d: RoadmapDoc) => T[], i: number, message: string) {
  let removed: T | undefined
  edit((d) => { removed = pick(d).splice(i, 1)[0] })
  toast(message, { action: { label: t('Повернути'), onClick: () => edit((d) => { if (removed !== undefined) pick(d).splice(i, 0, removed) }) } })
}

// ---------- поля ----------
function Text({ value, onChange, className, placeholder, label, size }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; label: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <SnInput
      {...(size ? { size } : {})}
      modelValue={value}
      placeholder={placeholder}
      accessibilityLabel={label}
      className={cn('w-full min-w-0', className)}
      onInput={(e: Event) => onChange(valueOf(e))}
    />
  )
}
/** багаторядкове поле: росте разом із текстом (field-sizing у самого sn-textarea) */
function Area({ value, onChange, className, placeholder, label, rows = 2 }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; label: string; rows?: number }) {
  return (
    <SnTextarea
      rows={rows}
      modelValue={value}
      placeholder={placeholder}
      accessibilityLabel={label}
      className={cn('w-full min-w-0', className)}
      onInput={(e: Event) => onChange(valueOf(e))}
    />
  )
}
const MD_HINT = t('**жирний**, [посилання](адреса), «- » список, «1. » нумерований, порожній рядок — абзац, ![назва](картинка), {{вид|бейдж}}')

// ---------- таблиця ----------
const cellTd = 'border-b border-line py-1 text-right align-top first:pr-2.5 first:text-left [&+td]:whitespace-nowrap [&+td]:pl-2.5 [&+td]:font-mono'
const colsOf = (tb: RTable) => Math.max(tb.head.length + 1, ...tb.rows.map((r) => r.cells.length), 1)

function TableView({ table }: { table: RTable }) {
  const n = colsOf(table)
  const head = table.head.some((h) => h.trim())
  return (
    <table className="w-full border-collapse text-[13px] tabular-nums">
      <tbody>
        {head && (
          <tr>
            <th className="border-b border-line py-1" />
            {Array.from({ length: n - 1 }, (_, j) => (
              <th key={j} className="border-b border-line py-1 pl-2.5 text-right text-[11.5px] font-semibold text-muted">{table.head[j] ?? ''}</th>
            ))}
          </tr>
        )}
        {table.rows.map((r, i) => (
          <tr key={i} className={cn(r.sum && 'font-bold')}>
            {Array.from({ length: n }, (_, j) => (
              <td key={j} className={cellTd}>{r.cells[j] ?? ''}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TableEdit({ table, set, onRemove }: { table: RTable; set: (fn: (tb: RTable) => void, key?: string) => void; onRemove: () => void }) {
  const n = colsOf(table)
  // рядки замість <table>: на телефоні назва — окремим рядком на всю ширину, числа під нею;
  // від sm — усе в один рядок. Числові стовпці однакової ширини, тож заголовки стоять над ними.
  const val = 'min-w-0 flex-1 sm:w-24 sm:flex-none'
  const tools = 'flex w-[60px] shrink-0 justify-end gap-1'
  return (
    <div className="grid gap-1.5 rounded-lg border border-line/70 bg-panel2/30 p-2">
      {n > 1 && (
        <div className="flex flex-wrap items-center gap-1 sm:flex-nowrap">
          <span className="hidden flex-1 text-[11px] font-semibold text-muted sm:block">{t('Назва')}</span>
          {Array.from({ length: n - 1 }, (_, j) => (
            <span key={j} className={cn(val, 'flex items-center gap-0.5')}>
              <SnInput
                modelValue={table.head[j] ?? ''}
                placeholder={t('Стовпець')}
                accessibilityLabel={t('Заголовок стовпця {n}', { n: j + 2 })}
                onInput={(e: Event) => { const v = valueOf(e); set((x) => { while (x.head.length < j + 1) x.head.push(''); x.head[j] = v }, `th${j}`) }}
                className={cn('w-full min-w-0', IN.right, IN.semi)}
              />
              {n > 2 && (
                <button type="button" className="grid h-6 w-5 shrink-0 place-items-center text-muted hover:text-ink" aria-label={t('Прибрати стовпець')} onClick={() => set((x) => { x.head.splice(j, 1); for (const r of x.rows) r.cells.splice(j + 1, 1) })}>
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          <span className={tools} />
        </div>
      )}
      {table.rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1 border-t border-line/50 pt-1 first:border-0 first:pt-0 sm:flex-nowrap sm:border-0 sm:pt-0">
          <SnInput
            modelValue={r.cells[0] ?? ''}
            placeholder={t('Назва')}
            accessibilityLabel={t('Рядок {n}, назва', { n: i + 1 })}
            onInput={(e: Event) => { const v = valueOf(e); set((x) => { const c = x.rows[i].cells; if (!c.length) c.push(''); c[0] = v }, `td${i}-0`) }}
            className={cn('w-full min-w-0 basis-full sm:basis-auto sm:flex-1', r.sum && IN.bold)}
          />
          {Array.from({ length: n - 1 }, (_, k) => {
            const j = k + 1
            return (
              <SnInput
                key={j}
                modelValue={r.cells[j] ?? ''}
                accessibilityLabel={table.head[k] ? t('Рядок {n}, {col}', { n: i + 1, col: table.head[k] }) : t('Рядок {n}, стовпець {col}', { n: i + 1, col: j + 1 })}
                onInput={(e: Event) => { const v = valueOf(e); set((x) => { const c = x.rows[i].cells; while (c.length < j + 1) c.push(''); c[j] = v }, `td${i}-${j}`) }}
                className={cn(val, IN.right, IN.mono, r.sum && IN.bold)}
              />
            )
          })}
          <span className={tools}>
            <button type="button" aria-pressed={!!r.sum} aria-label={t('Рядок-підсумок')} title={t('Підсумок (жирним)')} onClick={() => set((x) => { x.rows[i].sum = !x.rows[i].sum || undefined })} className={cn(iconBtn, r.sum && 'border-spice/60 text-spice')}>
              <Sigma size={13} />
            </button>
            <button type="button" aria-label={t('Прибрати рядок')} onClick={() => set((x) => { x.rows.splice(i, 1) })} className={iconBtn}>
              <Trash2 size={13} />
            </button>
          </span>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={ghostBtn} onClick={() => set((x) => { x.rows.push({ cells: Array(n).fill('') }) })}><Plus size={13} /> {t('Рядок')}</button>
        <button type="button" className={ghostBtn} onClick={() => set((x) => { while (x.head.length < n - 1) x.head.push(''); x.head.push(''); for (const r of x.rows) { while (r.cells.length < n) r.cells.push(''); r.cells.push('') } })}><Plus size={13} /> {t('Стовпець')}</button>
        <button type="button" className={cn(ghostBtn, 'ml-auto')} onClick={onRemove}><Trash2 size={13} /> {t('Прибрати таблицю')}</button>
      </div>
    </div>
  )
}

// ---------- етап ----------
const STATUS_ICON: Record<RStatus, typeof Circle> = { todo: Circle, doing: CircleDot, done: CheckCircle2 }

function StatusButton({ status, onClick, readOnly }: { status: RStatus; onClick: () => void; readOnly?: boolean }) {
  const I = STATUS_ICON[status]
  // хто лише дивиться — статус як позначка, не кнопка
  if (readOnly)
    return (
      <span className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-semibold', status === 'done' ? 'border-ok/40 bg-ok/15 text-ok' : status === 'doing' ? 'border-spice/50 bg-spice/15 text-spice' : 'border-line text-muted')}>
        <I size={14} /> {STATUS_LABEL[status]}
      </span>
    )
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('Натисни, щоб змінити статус')}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-semibold transition-colors',
        status === 'done' ? 'border-ok/40 bg-ok/15 text-ok' : status === 'doing' ? 'border-spice/50 bg-spice/15 text-spice' : 'border-line text-muted hover:text-ink',
      )}
    >
      <I size={14} /> {STATUS_LABEL[status]}
    </button>
  )
}

/** хто з учасників уже відмітив (прогрес учасників): кружечки з ініціалами */
function WhoDots({ who }: { who?: Who[] }) {
  if (!who?.length) return null
  return (
    <span className="inline-flex shrink-0 items-center -space-x-1.5" title={who.map((w) => w.name).join(', ')} aria-label={t('Відмітили: {names}', { names: who.map((w) => w.name).join(', ') })}>
      {who.slice(0, 5).map((w) => (
        <span key={w.id} className="grid h-5 w-5 place-items-center rounded-full border border-panel text-[9px] font-bold text-white" style={{ background: w.color }}>{w.name.trim().slice(0, 1).toUpperCase()}</span>
      ))}
      {who.length > 5 && <span className="pl-2 text-[11px] text-muted">+{who.length - 5}</span>}
    </span>
  )
}

/** прогрес етапу: стан, чи можна відмічати, відмітити; who — хто з учасників (за id етапу, задачі, картки) */
interface Marks { st: PState; canMark: boolean; mark: (kind: 's' | 't' | 'c', id: string, value: RStatus | boolean) => void; who?: Map<string, Who[]> }

function Stage({ s, n, count, editing, edit, marks }: { s: RStage; n: number; count: number; editing: boolean; edit: Edit; marks: Marks }) {
  const i = n - 1
  const up = (fn: (s: RStage) => void, key?: string) => edit((d) => { const x = d.stages.find((y) => y.id === s.id); if (x) fn(x) }, key && `${s.id}:${key}`)
  const status = statusOf(marks.st, s.id)
  const doneTasks = s.tasks.filter((task) => marks.st.t[task.id]).length
  return (
    <li
      className={cn(
        'grid min-w-0 content-start gap-2.5 rounded-xl border bg-panel p-3.5 shadow-sm sm:px-4',
        status === 'done' ? 'border-ok/35' : status === 'doing' ? 'border-spice/50' : 'border-line',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <span className={cn('grid h-[26px] w-[26px] flex-none place-items-center rounded-full font-mono text-[13px] font-semibold', status === 'done' ? 'bg-ok text-panel' : 'bg-ink text-panel')}>
          {status === 'done' ? <Check size={15} strokeWidth={3} /> : n}
        </span>
        {editing ? (
          <Text value={s.title} onChange={(v) => up((x) => { x.title = v }, 'title')} label={t('Назва етапу')} className={cn('flex-[1_1_14ch]', IN.display, IN.bold)} />
        ) : (
          <h3 className={cn('min-w-0 flex-[1_1_14ch] text-balance font-display text-[14px] font-bold leading-snug', status === 'done' && 'text-muted line-through decoration-1')}>{s.title}</h3>
        )}
        <WhoDots who={marks.who?.get(s.id)} />
        <StatusButton status={status} readOnly={!marks.canMark} onClick={() => marks.mark('s', s.id, nextStatus(status))} />
        {!editing && s.badge && <span className="whitespace-nowrap rounded-full border border-line bg-panel2 px-2 py-0.5 text-[11.5px] font-semibold text-muted">{s.badge}</span>}
      </div>

      {editing ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Text value={s.badge} onChange={(v) => up((x) => { x.badge = v }, 'badge')} label={t('Позначка')} placeholder={t('Позначка: «ціна з гри», «оцінка»…')} className="flex-1" />
            <button type="button" className={iconBtn} disabled={i === 0} aria-label={t('Вище')} onClick={() => edit((d) => move(d.stages, i, -1))}><ArrowUp size={14} /></button>
            <button type="button" className={iconBtn} disabled={i === count - 1} aria-label={t('Нижче')} onClick={() => edit((d) => move(d.stages, i, 1))}><ArrowDown size={14} /></button>
            <button type="button" className={iconBtn} aria-label={t('Видалити етап')} onClick={() => removeWithUndo(edit, (d) => d.stages, i, t('Етап «{title}» видалено', { title: s.title }))}><Trash2 size={14} /></button>
          </div>
          <Area value={s.why} onChange={(v) => up((x) => { x.why = v }, 'why')} label={t('Навіщо')} placeholder={t('Навіщо цей етап, що дає')} />
        </>
      ) : (
        s.why && <Md text={s.why} className="text-[13.5px]" />
      )}

      {editing ? (
        s.table ? (
          <TableEdit table={s.table} set={(fn, key) => up((x) => { if (x.table) fn(x.table) }, key && 'table:' + key)} onRemove={() => up((x) => { x.table = null })} />
        ) : (
          <button type="button" className={cn(ghostBtn, 'w-fit')} onClick={() => up((x) => { x.table = blankTable() })}><Table2 size={13} /> {t('Додати таблицю вартості')}</button>
        )
      ) : (
        s.table && s.table.rows.length > 0 && <TableView table={s.table} />
      )}

      {(s.tasks.length > 0 || editing) && (
        <div className="grid gap-1">
          {s.tasks.length > 0 && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              <T text="Задачі {count}" count={<span className="font-mono">{doneTasks}/{s.tasks.length}</span>} />
            </p>
          )}
          <ul className="grid gap-1">
            {s.tasks.map((task, j) => (
              <li key={task.id} className="flex items-start gap-2">
                <SnCheckbox
                  modelValue={!!marks.st.t[task.id]}
                  disabled={!marks.canMark}
                  onChange={(e: Event) => marks.mark('t', task.id, checkedOf(e))}
                  accessibilityLabel={task.text || t('Задача')}
                  className="mt-[3px] shrink-0"
                />
                {editing ? (
                  <>
                    <Text value={task.text} onChange={(v) => up((x) => { x.tasks[j].text = v }, 'task' + task.id)} label={t('Задача')} placeholder={t('Що зробити')} />
                    <button type="button" className={iconBtn} aria-label={t('Прибрати задачу')} onClick={() => up((x) => { x.tasks.splice(j, 1) })}><X size={13} /></button>
                  </>
                ) : (
                  <span className={cn('flex-1 text-[13.5px]', marks.st.t[task.id] && 'text-muted line-through decoration-1')}>{inline(task.text)}</span>
                )}
              </li>
            ))}
          </ul>
          {editing && (
            <button type="button" className={cn(ghostBtn, 'w-fit')} onClick={() => up((x) => { x.tasks.push({ id: newId(), text: '' }) })}><ListPlus size={13} /> {t('Задача')}</button>
          )}
        </div>
      )}

      {editing ? (
        <Area value={s.meta} onChange={(v) => up((x) => { x.meta = v }, 'meta')} label={t('Примітка')} placeholder={t('Примітка: що ще треба, відкриття, енергія…')} />
      ) : (
        s.meta && <Md text={s.meta} className="text-[12.5px] text-muted" />
      )}
    </li>
  )
}

// ---------- «Зараз є» ----------
function Sidebar({ doc, editing, edit }: { doc: RoadmapDoc; editing: boolean; edit: Edit }) {
  const up = (id: string, fn: (b: RBlock) => void, key: string) => edit((d) => { const b = d.sidebar.find((x) => x.id === id); if (b) fn(b) }, `side:${id}:${key}`)
  return (
    <Card className="grid content-start gap-2">
      {editing ? (
        <Text value={doc.sidebarTitle} onChange={(v) => edit((d) => { d.sidebarTitle = v }, 'sideTitle')} label={t('Назва блоку')} className={cn(IN.display, IN.semi, IN.caps)} />
      ) : (
        <SectionTitle className="mb-0">{doc.sidebarTitle || t('Зараз є')}</SectionTitle>
      )}
      {doc.sidebar.map((b, i) => (
        <div key={b.id} className="grid gap-1">
          {editing ? (
            <>
              <div className="flex items-center gap-1">
                <Text value={b.title} onChange={(v) => up(b.id, (x) => { x.title = v }, 'title')} label={t('Підзаголовок')} placeholder={t('Підзаголовок')} className={IN.semi} />
                <button type="button" className={iconBtn} disabled={i === 0} aria-label={t('Вище')} onClick={() => edit((d) => move(d.sidebar, i, -1))}><ArrowUp size={13} /></button>
                <button type="button" className={iconBtn} disabled={i === doc.sidebar.length - 1} aria-label={t('Нижче')} onClick={() => edit((d) => move(d.sidebar, i, 1))}><ArrowDown size={13} /></button>
                <button type="button" className={iconBtn} aria-label={t('Прибрати')} onClick={() => removeWithUndo(edit, (d) => d.sidebar, i, t('Блок «{title}» видалено', { title: b.title }))}><Trash2 size={13} /></button>
              </div>
              <Area value={b.body} onChange={(v) => up(b.id, (x) => { x.body = v }, 'body')} label={b.title || t('Текст')} placeholder={t('- пункт списку')} />
            </>
          ) : (
            <>
              {b.title && <h3 className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{b.title}</h3>}
              <Md text={b.body} className="text-[13.5px] [&_b]:font-mono" />
            </>
          )}
        </div>
      ))}
      {editing && (
        <button type="button" className={cn(ghostBtn, 'w-fit')} onClick={() => edit((d) => { d.sidebar.push({ id: newId(), title: '', body: '' }) })}><Plus size={13} /> {t('Блок')}</button>
      )}
      {editing ? (
        <Area value={doc.note} onChange={(v) => edit((d) => { d.note = v }, 'note')} label={t('Нотатка')} placeholder={t('Нотатка внизу блоку (указ тижня тощо)')} />
      ) : (
        doc.note && <Md text={doc.note} className="mt-1.5 rounded-lg border border-line bg-panel2/60 px-3 py-2.5 text-[12.5px] text-muted" />
      )}
    </Card>
  )
}

// ---------- розділи ----------
/** кнопка «зібрано» на картці: натиснута — зелена галочка; readOnly — лише позначка (відмічати не можна) */
function GotButton({ on, title, onClick, readOnly }: { on: boolean; title: string; onClick: () => void; readOnly?: boolean }) {
  if (readOnly)
    return on ? <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-ok/50 bg-ok/15 px-2 text-[11.5px] font-medium text-ok"><CheckCircle2 size={14} />{t('Зібрано')}</span> : null
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? t('«{title}» — зібрано, зняти позначку', { title }) : t('Відмітити «{title}» як зібране', { title })}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium transition-colors [@media(pointer:coarse)]:h-9',
        on ? 'border-ok/50 bg-ok/15 text-ok' : 'border-line text-muted hover:border-ok/50 hover:text-ok',
      )}
    >
      {on ? <CheckCircle2 size={14} /> : <Circle size={14} />}
      {on ? t('Зібрано') : t('Відмітити')}
    </button>
  )
}

/** «зібрано»: відмічені картки (id) і перемикач; hide — сховати відмічені; readOnly — відмічати не можна */
interface Got { ids: string[]; toggle: (id: string) => void; hide: boolean; readOnly: boolean; who?: Map<string, Who[]> }

function Section({ s, i, count, editing, edit, got }: { s: RSection; i: number; count: number; editing: boolean; edit: Edit; got: Got }) {
  const up = (fn: (s: RSection) => void, key?: string) => edit((d) => { const x = d.sections.find((y) => y.id === s.id); if (x) fn(x) }, key && `sec:${s.id}:${key}`)
  const upCol = (id: string, fn: (c: RColumn) => void, key?: string) => up((x) => { const c = x.columns.find((y) => y.id === id); if (c) fn(c) }, key && `col:${id}:${key}`)
  const collect = !!s.collect && !editing
  const gotHere = s.columns.filter((c) => got.ids.includes(c.id)).length
  const cols = collect && got.hide ? s.columns.filter((c) => !got.ids.includes(c.id)) : s.columns
  // усе в розділі зібрано й зібране сховане — розділ не показуємо
  if (collect && got.hide && s.columns.length > 0 && cols.length === 0) return null
  return (
    <Card className="grid gap-3 lg:col-span-2">
      {editing ? (
        <div className="flex items-center gap-1">
          <Text value={s.title} onChange={(v) => up((x) => { x.title = v }, 'title')} label={t('Назва розділу')} className={cn(IN.display, IN.semi, IN.caps)} />
          <button type="button" className={iconBtn} disabled={i === 0} aria-label={t('Вище')} onClick={() => edit((d) => move(d.sections, i, -1))}><ArrowUp size={14} /></button>
          <button type="button" className={iconBtn} disabled={i === count - 1} aria-label={t('Нижче')} onClick={() => edit((d) => move(d.sections, i, 1))}><ArrowDown size={14} /></button>
          <button type="button" className={iconBtn} aria-label={t('Видалити розділ')} onClick={() => removeWithUndo(edit, (d) => d.sections, i, t('Розділ «{title}» видалено', { title: s.title }))}><Trash2 size={14} /></button>
        </div>
      ) : (
        <div className="flex items-baseline justify-between gap-3">
          <SectionTitle className="mb-0">{s.title}</SectionTitle>
          {collect && (
            <span className={cn('whitespace-nowrap font-mono text-[12px] tabular-nums', gotHere === s.columns.length ? 'text-ok' : 'text-muted')}>
              <T text="зібрано {got}/{total}" got={<b className="text-ink">{gotHere}</b>} total={s.columns.length} />
            </span>
          )}
        </div>
      )}
      {editing && (
        <label className="flex w-fit items-center gap-2 text-[12.5px] text-muted">
          <SnCheckbox modelValue={!!s.collect} onChange={(e: Event) => { const v = checkedOf(e); up((x) => { if (v) x.collect = true; else delete x.collect }) }} accessibilityLabel={t('Картки можна відмічати «зібрано»')} />
          {t('Картки можна відмічати «зібрано»')}
        </label>
      )}

      {editing ? (
        <Area value={s.body} onChange={(v) => up((x) => { x.body = v }, 'body')} label={t('Вступ розділу')} placeholder={t("Вступ (необов'язково)")} />
      ) : (
        s.body && <Md text={s.body} className="text-[13.5px]" />
      )}

      {(s.stats.length > 0 || editing) && (
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-x-6 gap-y-3">
          {s.stats.map((x, j) => (
            <li key={j} className={cn(editing && 'grid gap-1')}>
              {editing ? (
                <>
                  <div className="flex gap-1">
                    <Text value={x.value} onChange={(v) => up((y) => { y.stats[j].value = v }, `sv${j}`)} label={t('Число')} placeholder="≈ 2 000" className={cn(IN.mono, IN.semi)} />
                    <button type="button" className={iconBtn} aria-label={t('Прибрати')} onClick={() => up((y) => { y.stats.splice(j, 1) })}><X size={13} /></button>
                  </div>
                  <Text value={x.label} onChange={(v) => up((y) => { y.stats[j].label = v }, `sl${j}`)} label={t('Підпис')} placeholder={t('чого саме')} />
                </>
              ) : (
                <>
                  <b className="block font-mono text-[20px] font-semibold leading-tight tabular-nums">{x.value}</b>
                  <span className="text-[12.5px] text-muted">{x.label}</span>
                </>
              )}
            </li>
          ))}
          {editing && (
            <li>
              <button type="button" className={ghostBtn} onClick={() => up((y) => { y.stats.push({ value: '', label: '' }) })}><Plus size={13} /> {t('Цифра')}</button>
            </li>
          )}
        </ul>
      )}

      {(s.columns.length > 0 || editing) && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] items-start gap-x-7 gap-y-4">
          {cols.map((c, j) => (
            <div key={c.id} className={cn('grid min-w-0 content-start gap-2', collect && 'rounded-xl border p-3 transition-colors', collect && (got.ids.includes(c.id) ? 'border-ok/45 bg-ok/[0.06]' : 'border-line'))}>
              {editing ? (
                <>
                  <div className="flex items-center gap-1">
                    <Text value={c.title} onChange={(v) => upCol(c.id, (y) => { y.title = v }, 'title')} label={t('Назва колонки')} placeholder={t('Назва колонки')} className={IN.semi} />
                    <button type="button" className={iconBtn} disabled={j === 0} aria-label={t('Лівіше')} onClick={() => up((y) => move(y.columns, j, -1))}><ArrowUp size={13} className="-rotate-90" /></button>
                    <button type="button" className={iconBtn} disabled={j === s.columns.length - 1} aria-label={t('Правіше')} onClick={() => up((y) => move(y.columns, j, 1))}><ArrowDown size={13} className="-rotate-90" /></button>
                    <button type="button" className={iconBtn} aria-label={t('Прибрати колонку')} onClick={() => removeWithUndo(edit, (d) => d.sections.find((y) => y.id === s.id)!.columns, j, t('Колонку «{title}» видалено', { title: c.title }))}><Trash2 size={13} /></button>
                  </div>
                  {c.table ? (
                    <TableEdit table={c.table} set={(fn, key) => upCol(c.id, (y) => { if (y.table) fn(y.table) }, key && 'table:' + key)} onRemove={() => upCol(c.id, (y) => { y.table = null })} />
                  ) : (
                    <button type="button" className={cn(ghostBtn, 'w-fit')} onClick={() => upCol(c.id, (y) => { y.table = blankTable() })}><Table2 size={13} /> {t('Таблиця')}</button>
                  )}
                  <Area value={c.body} onChange={(v) => upCol(c.id, (y) => { y.body = v }, 'body')} label={c.title || t('Текст колонки')} rows={4} />
                </>
              ) : (
                <>
                  {collect ? (
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[13.5px] font-semibold">{c.title}</h3>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <WhoDots who={got.who?.get(c.id)} />
                        <GotButton on={got.ids.includes(c.id)} title={c.title} onClick={() => got.toggle(c.id)} readOnly={got.readOnly} />
                      </span>
                    </div>
                  ) : (
                    c.title && <h3 className="text-[13.5px] font-semibold">{c.title}</h3>
                  )}
                  {c.table && c.table.rows.length > 0 && <TableView table={c.table} />}
                  <Md text={c.body} className={cn('text-[13.5px]', c.table && 'text-[12.5px] text-muted')} />
                </>
              )}
            </div>
          ))}
          {editing && (
            <button type="button" className={cn(ghostBtn, 'w-fit')} onClick={() => up((y) => { y.columns.push({ id: newId(), title: '', body: '', table: null }) })}><Plus size={13} /> {t('Колонка')}</button>
          )}
        </div>
      )}

      {editing ? (
        <Area value={s.sources} onChange={(v) => up((x) => { x.sources = v }, 'sources')} label={t('Джерела')} placeholder={t('Джерела: [назва](https://…) · [назва](https://…)')} />
      ) : (
        s.sources && <Md text={s.sources} className="text-[12.5px] text-muted" />
      )}
    </Card>
  )
}

// ---------- історія версій ----------
function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { history, restore } = useRoadmap.getState()
  const [rows, setRows] = useState<Revision[] | null>(null)
  const [error, setError] = useState('')
  const reload = () => { setError(''); history().then(setRows).catch(() => setError(t('Сервер зараз не відповідає. Спробуй ще раз трохи згодом.'))) }
  useEffect(reload, [history]) // eslint-disable-line react-hooks/exhaustive-deps
  const fmt = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="absolute right-0 top-full z-20 mt-1.5 w-[min(340px,calc(100vw-24px))] rounded-xl border border-line bg-panel p-2 shadow-lg">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[12px] font-semibold text-muted">{t('Попередні версії')}</span>
        <button type="button" className={iconBtn} aria-label={t('Закрити')} onClick={onClose}><X size={13} /></button>
      </div>
      {error ? (
        <div className="grid gap-2 p-1">
          <ErrorAlert title={t('Історія не завантажилась')} message={error} />
          <button type="button" className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-line px-2.5 text-[12.5px] hover:border-spice/60" onClick={reload}><RotateCcw size={13} /> {t('Спробувати ще')}</button>
        </div>
      ) : !rows ? (
        <Loading lines={3} className="p-3" />
      ) : rows.length === 0 ? (
        <Empty icon={History} title={t('Попередніх версій ще нема')} description={t("Версія з'являється після першої правки.")} framed={false} />
      ) : (
        <ul className="grid max-h-[50vh] gap-0.5 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.hid} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel2">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{fmt(r.updated)}</span>
                <span className="block text-[11.5px] text-muted">{r.summary}</span>
              </span>
              <button type="button" className="h-7 rounded-md border border-line px-2 text-[12px] hover:border-spice/60" onClick={() => { restore(r.hid); onClose() }}>
                {t('Відновити')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// незбережене — у смузі внизу; тут — лише хід збереження
const SAVE_LABEL = { idle: '', pending: '', saving: t('Зберігаю…'), saved: t('Збережено'), error: t('Не збережено') } as const

// ---------- сторінка ----------
export function Roadmap({ id }: { id: string }) {
  const { doc, item, state, save, undo, load, edit: rawEdit, undoLast, rights, progress, mark } = useRoadmap()
  const current = useRoadmap((s) => s.id)
  const setView = useStore((s) => s.setView)
  const me = useAuth((s) => s.user)
  // права роадмапу — у вікні «Доступ» (під «Хто бачить»)
  const rightsExtra = useRightsExtra()
  const [editing, setEditing] = useState(false)
  const [hist, setHist] = useState(false)
  /** зберегти (якщо є що) і, коли вдалось, вийти з редагування — і з «Готово», і зі смуги внизу */
  const finish = async () => {
    const r = useRoadmap.getState()
    const dirty = r.save === 'pending' || r.save === 'error'
    if (dirty) await r.commit()
    // не вдалось чи хтось змінив тим часом (409 — свіжа версія на екрані, «Лишити мою» в повідомленні) — лишаємось
    if (!dirty || useRoadmap.getState().save === 'saved') { setEditing(false); setHist(false) }
  }
  // правки — лише на екрані, доки не збережеш: смуга внизу «Зберегти» / «Скасувати» (і не пускає зі сторінки)
  useUnsaved(save === 'pending' || save === 'error', {
    save: finish,
    discard: () => { useRoadmap.getState().discard(); setEditing(false); setHist(false) },
    label: t('Роадмап змінено'),
  })
  const [removing, setRemoving] = useState(false)
  useEffect(() => { if (current !== id || !doc) load(id) }, [id])
  // пішли зі сторінки роадмапу — живі оновлення закрити
  useEffect(() => () => useRoadmap.getState().leave(), [])
  const edit: Edit = (recipe, key) => rawEdit(recipe, { key })
  const canEdit = !!rights?.edit
  // прогрес — з сервера (lib/roadmap: progress), за правами роадмапу; «Сховати зібране» — лише вигляд, у браузері
  const st = progress?.state ?? emptyPState()
  const canMark = !!rights?.mark && !!progress?.scope
  // хто з учасників що відмітив (гільдія, «у кожного свій») — кружечки на етапах і картках
  const who = useMembers(id, !!rights?.members && progress?.mode === 'each')
  const marks: Marks = { st, canMark, mark: (k, mid, v) => void mark(k, mid, v), who }
  const gotIds = Object.keys(st.c)
  const [hideGot, setHideGot] = useState(() => prefGet('roadmap:hideGot', false))
  const got: Got = { ids: gotIds, toggle: (cid) => void mark('c', cid, !st.c[cid]), hide: hideGot, readOnly: !canMark, who }
  // шлях: Роадмапи (вкладка, де роадмап лежить) › назва
  const scope = useScopeOf(item?.owner)
  useCrumb(state === 'error' || state === 'missing' ? [] : doc && current === id ? [{ label: doc.title || t('Без назви') }] : null, { sub: scope })

  if (state === 'error') return <PageError page title={t('Роадмап не завантажився')} onRetry={() => load(id)} />
  if (state === 'missing') return (
    <div className="grid flex-1 place-items-center p-4">
      <div className="w-full max-w-[560px]">
        <Empty icon={FileQuestion} title={t('Такого роадмапу нема')} description={t('Його видалили, або він не твій і не відкритий тобі.')}>
          <Button variant="secondary" onClick={() => setView('roadmap')}>{t('До списку роадмапів')}</Button>
        </Empty>
      </div>
    </div>
  )
  if (!doc || current !== id) return <Loading page label={t('Завантаження роадмапу…')} />
  const remove = async () => {
    const r = await fetch(`/api/roadmaps/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } })
    if (!r.ok) { toast.error(t('Не вдалося видалити'), { description: (await r.json().catch(() => ({}))).error }); return }
    toast.success(t('Роадмап видалено'))
    setView('roadmap')
  }

  const done = doc.stages.filter((s) => statusOf(st, s.id) === 'done').length
  const doing = doc.stages.filter((s) => statusOf(st, s.id) === 'doing').length
  const tasks = doc.stages.flatMap((s) => s.tasks)
  const pct = doc.stages.length ? Math.round(((done + doing * 0.5) / doc.stages.length) * 100) : 0
  const collectCols = doc.sections.filter((s) => s.collect).flatMap((s) => s.columns)
  const gotN = collectCols.filter((c) => gotIds.includes(c.id)).length

  const toolbar: ReactNode = (
    <div className="relative flex flex-wrap items-center gap-1.5">
      {editing && (
        <>
          <span className={cn('text-[12px]', save === 'error' ? 'text-bad' : 'text-muted')} aria-live="polite">{SAVE_LABEL[save]}</span>
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12.5px] disabled:opacity-40" disabled={!undo.length} onClick={undoLast}>
            <Undo2 size={14} /> {t('Скасувати правку')}
          </button>
          {rights?.history && (
            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[12.5px]" aria-expanded={hist} onClick={() => setHist(!hist)}>
              <History size={14} /> {t('Історія')}
            </button>
          )}
          {hist && <HistoryPanel onClose={() => setHist(false)} />}
        </>
      )}
      {/* як у бази: зірка, «Доступ», решта — у меню «Дії» (копія для того, хто й так змінює, видалення), головне — «Редагувати» */}
      {!editing && item && (
        <ItemActions
          item={item}
          onCopy={rights?.copy || !me ? openRoadmapCopy : null}
          accessExtra={rightsExtra}
          onChange={(it) => useRoadmap.getState().setItem({ ...it, can: it.can ?? item.can })}
          copyInMenu={canEdit}
          more={item.can?.manage ? [{ kind: 'separator' as const }, { label: t('Видалити'), icon: <Trash2 size={14} />, danger: true, onSelect: () => setRemoving(true) }] : []}
        />
      )}
      {canEdit && (
        <Button size="sm" disabled={editing && save === 'saving'} onClick={() => { if (editing) void finish(); else { setEditing(true); setHist(false) } }}>
          {editing ? <><Check size={14} /> {t('Готово')}</> : <><Pencil size={14} /> {t('Редагувати')}</>}
        </Button>
      )}
      {removing && <ConfirmDialog danger title={t('Видалити роадмап «{title}» назавжди, з історією?', { title: doc.title || t('Без назви') })} confirm={t('Видалити назавжди')} onClose={() => setRemoving(false)} onConfirm={() => void remove()} />}
    </div>
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        {/* z-10: панель історії випадає поверх етапів нижче */}
        <PageHeader
          className="relative z-10"
          badges={item && <ItemBar item={item} actions={false} className="min-w-0" />}
          title={doc.title || t('Без назви')}
          lead={!editing && doc.lead ? inline(doc.lead) : undefined}
          actions={toolbar}
        >
          {editing ? (
            <>
              <div className="grid gap-1.5">
                <Text value={doc.title} onChange={(v) => edit((d) => { d.title = v }, 'title')} label={t('Назва')} size="lg" className={cn(IN.display, IN.bold)} />
                {!doc.title.trim() && <p className="text-[11.5px] text-warn">{t('Без назви роадмап важко знайти в списках — дай йому назву.')}</p>}
                <Area value={doc.lead} onChange={(v) => edit((d) => { d.lead = v }, 'lead')} label={t('Вступ')} placeholder={t('Коротко: про що цей роадмап')} />
              </div>
              <div className="grid gap-1.5">
                <p className="text-[11.5px] text-muted">{t('Ключові цифри (жирне — **ось так**)')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {doc.facts.map((f, i) => (
                    <span key={i} className="flex w-[min(260px,100%)] items-center gap-1">
                      <Text value={f} onChange={(v) => edit((d) => { d.facts[i] = v }, `fact${i}`)} label={t('Цифра {n}', { n: i + 1 })} className={IN.mono} />
                      <button type="button" className={iconBtn} aria-label={t('Прибрати')} onClick={() => edit((d) => { d.facts.splice(i, 1) })}><X size={13} /></button>
                    </span>
                  ))}
                  <button type="button" className={ghostBtn} onClick={() => edit((d) => { d.facts.push('') })}><Plus size={13} /> {t('Цифра')}</button>
                </div>
                <p className="text-[11.5px] text-muted">{t('Розмітка в текстах: {hint}.', { hint: MD_HINT })}</p>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2">
              {(doc.stages.length > 0 || collectCols.length > 0) && (
                <div className="flex w-full flex-wrap items-center gap-2">
                  <ProgressWhose />
                  <MembersButton doc={doc} />
                  <CopyCta />
                </div>
              )}
              {doc.stages.length > 0 && (
                <div className="flex min-w-[220px] flex-1 items-center gap-2.5" aria-label={t('Прогрес')}>
                  <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-panel2">
                    <div className="h-full rounded-full bg-spice transition-[width] duration-500" style={{ width: pct + '%' }} />
                  </div>
                  <span className="whitespace-nowrap font-mono text-[12.5px] text-muted">
                    <T text="{done}/{total} {stages}" done={<b className="text-ink">{done}</b>} total={doc.stages.length} stages={word(doc.stages.length, [t('етап'), t('етапи'), t('етапів')])} />
                    {tasks.length > 0 && <> · <T text="задач {done}/{total}" done={<b className="text-ink">{tasks.filter((task) => st.t[task.id]).length}</b>} total={tasks.length} /></>}
                  </span>
                </div>
              )}
              {collectCols.length > 0 && (
                <div className="flex min-w-[260px] flex-1 flex-wrap items-center gap-2.5" aria-label={t('Зібрано')}>
                  <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-panel2">
                    <div className="h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: Math.round((gotN / collectCols.length) * 100) + '%' }} />
                  </div>
                  <span className="whitespace-nowrap font-mono text-[12.5px] text-muted">
                    <T text="зібрано {got}/{total}" got={<b className="text-ink">{gotN}</b>} total={collectCols.length} />
                  </span>
                  <Toggle pressed={hideGot} onPressedChange={(v) => { setHideGot(v); prefSet('roadmap:hideGot', v) }}>
                    {hideGot ? <EyeOff size={14} /> : <Eye size={14} />} {t('Сховати зібране')}
                  </Toggle>
                </div>
              )}
              <ul className="flex flex-wrap gap-x-[18px] gap-y-1.5 font-mono text-[13px] font-medium tabular-nums text-muted [&_b]:font-semibold [&_b]:text-ink" aria-label={t('Основні цифри')}>
                {doc.facts.filter((f) => f.trim()).map((f, i) => <li key={i}>{inline(f)}</li>)}
              </ul>
            </div>
          )}
        </PageHeader>

        <section className="grid grid-cols-[minmax(0,1fr)] items-start gap-2.5 lg:grid-cols-[300px_minmax(0,1fr)]" aria-label={t('Роадмап')}>
          {/* довідник без етапів (лише розділи): без порожнього «Етапів поки немає», бічний блок — на всю ширину */}
          {!editing && doc.stages.length === 0 && doc.sections.length > 0 ? (
            doc.sidebar.length > 0 ? (
              <div className="lg:col-span-2"><Sidebar doc={doc} editing={false} edit={edit} /></div>
            ) : (
              doc.note && <Md text={doc.note} className="rounded-lg border border-line bg-panel2/60 px-3 py-2.5 text-[13px] text-muted lg:col-span-2" />
            )
          ) : (
            <>
              <Sidebar doc={doc} editing={editing} edit={edit} />

              <div className="grid gap-2.5">
                <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(400px,100%),1fr))] gap-2.5">
                  {doc.stages.map((s, i) => (
                    <Stage key={s.id} s={s} n={i + 1} count={doc.stages.length} editing={editing} edit={edit} marks={marks} />
                  ))}
                </ol>
                {editing && (
                  <button type="button" className={cn(ghostBtn, 'h-10 w-full justify-center')} onClick={() => edit((d) => { d.stages.push(blankStage()) })}>
                    <Plus size={14} /> {t('Етап')}
                  </button>
                )}
                {!editing && doc.stages.length === 0 && (
                  <Empty icon={ListPlus} title={t('Етапів поки немає')} description={canEdit ? t('Розбий роадмап на етапи: що будувати, у якому порядку і скільки це коштує.') : t('Власник ще не додав жодного етапу.')}>
                    {canEdit && <Button onClick={() => setEditing(true)}><Pencil size={15} />{t('Додати перший етап')}</Button>}
                  </Empty>
                )}
              </div>
            </>
          )}

          {doc.sections.map((s, i) => (
            <Section key={s.id} s={s} i={i} count={doc.sections.length} editing={editing} edit={edit} got={got} />
          ))}
          {editing && (
            <button type="button" className={cn(ghostBtn, 'h-10 w-full justify-center lg:col-span-2')} onClick={() => edit((d) => { d.sections.push(blankSection()) })}>
              <Plus size={14} /> {t('Розділ')}
            </button>
          )}
        </section>
      </div>
    </div>
  )
}

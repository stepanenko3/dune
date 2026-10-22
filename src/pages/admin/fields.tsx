/**
 * Поля панелі керування: показ значення (у таблиці й картці) і поле форми для кожного типу — усе на компонентах
 * @snotax/ui. Типи — як у server/admin/engine.mjs.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import {
  SnBadge, SnButton, SnCheckbox, SnColorPicker, SnField, SnFieldDescription, SnFieldLabel, SnInput, SnNumberField, SnSegmented, SnSegmentedItem, SnSelect,
  SnSkeleton, SnSwitch, SnTextarea, checkedOf, sn, valueOf,
} from '@/components/sn'
import { locale, t } from '@/lib/i18n'
import { adminApi, adminHref, adminLink, resourceOf, type Field, type Option } from './api'
import { Panel } from './ui'

const SnCombobox = sn('sn-combobox')
const SnComboboxInput = sn('sn-combobox-input')
const SnComboboxContent = sn('sn-combobox-content')
const SnComboboxList = sn('sn-combobox-list')
const SnComboboxItem = sn('sn-combobox-item')
const SnComboboxEmpty = sn('sn-combobox-empty')

export const fmtDate = (ms: unknown, withTime = true) =>
  typeof ms === 'number' && ms > 0
    ? new Date(ms).toLocaleString(locale(), withTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' })
    : ''

/** куди в панелі веде значення поля: [розділ, id] чи [розділ]; null — нікуди (чи цей розділ людині не видно) */
export function linkOf(f: Field, row: Record<string, unknown>): string[] | null {
  const v = row[f.key]
  let parts: string[] | null = null
  if (f.ref) { const r = row[f.key + '__ref']; parts = Array.isArray(r) && r.length ? r.map(String) : null }
  else if (v == null || v === '') return null
  else if (f.type === 'relation' && f.resource) parts = [f.resource, String(v)]
  else if (f.type === 'owner' && f.kindField) parts = row[f.kindField] === 'user' ? ['users', String(v)] : row[f.kindField] === 'guild' ? ['guilds', String(v)] : null
  return parts && resourceOf(parts[0]) ? parts : null
}

/**
 * Службовий текст мовою людини: назви задач, вбудованих ролей, примітки до версій (вони зберігаються українською —
 * як серверний noteText); те, що написали люди, t() лишає як є.
 */
export function trText(s: string): string {
  const imp = /^Імпортовано з файлу: (.+)$/.exec(s)
  if (imp) return t('Імпортовано з файлу: {from}', { from: imp[1] })
  const m = /^Відновлено версію (\d+)$/.exec(s)
  if (m) return t('Відновлено версію {n}', { n: m[1] })
  if (s === 'Перенесено з коду') return t('Початкова версія')
  if (s === 'Змінено в панелі керування') return t('Змінено в панелі керування')
  return t(s)
}

/** значення як текст (таблиця, пошук, підписи) */
export function textOf(f: Field, row: Record<string, unknown>): string {
  if (f.ref) {
    // назва запису з сервера; немає — сам розділ («Налаштування») чи id
    const l = row[f.key + '__label'], r = row[f.key + '__ref']
    if (l != null && l !== '') return row[f.key + '__tr'] ? trText(String(l)) : String(l)
    if (Array.isArray(r) && r.length === 1) return t(resourceOf(String(r[0]))?.label ?? String(r[0]))
    return Array.isArray(r) && r.length > 1 ? String(r[1]) : ''
  }
  const v = row[f.key]
  if (v == null || v === '') return ''
  switch (f.type) {
    case 'datetime': return fmtDate(v)
    case 'flag': return fmtDate(v)
    case 'bool': return v ? t('Так') : t('Ні')
    case 'select': return t(f.options?.find((o) => o.value === String(v) || o.also?.includes(String(v)))?.label ?? String(v))
    case 'owner': if (f.kindField && row[f.kindField] === 'site') return t('Сайт'); return String(row[f.key + '__label'] ?? v)
    case 'relation': return String(row[f.key + '__label'] ?? v)
    case 'pairs': return (v as [string, number][]).map(([id, n]) => `${n}× ${id}`).join(', ')
    case 'list': return (v as string[]).join(', ')
    case 'json': { const s = JSON.stringify(v); return s.length > 80 ? s.slice(0, 80) + '…' : s }
    default: return f.tr ? trText(String(v)) : String(v)
  }
}

/** значення в картці запису: бейджі, кольори, посилання */
export function ValueView({ f, row }: { f: Field; row: Record<string, unknown> }) {
  const v = row[f.key]
  const to = linkOf(f, row)
  if (to) return <a href={adminHref(to)} onClick={adminLink(to)} className="text-spice hover:underline">{textOf(f, row)}</a>
  if (f.ref) { const s = textOf(f, row); return s ? <span>{s}</span> : <span className="text-muted">—</span> }
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return <span className="text-muted">—</span>
  if (f.tones && f.type === 'select') return <SnBadge tone={f.tones[String(v)] ?? 'neutral'} variant="soft">{textOf(f, row)}</SnBadge>
  if (f.type === 'color') return <span className="inline-flex items-center gap-2"><span className="h-4 w-4 rounded-full border border-line" style={{ background: String(v) }} />{String(v)}</span>
  if (f.type === 'bool') return <SnBadge tone={v ? 'success' : 'neutral'} variant="soft">{textOf(f, row)}</SnBadge>
  if (f.type === 'flag') return <SnBadge tone="warning" variant="soft">{textOf(f, row)}</SnBadge>
  if (f.view === 'request' && v && typeof v === 'object') return <RequestView v={v as Record<string, unknown>} />
  if (f.type === 'json' || f.type === 'permissions') return <pre className="max-h-[320px] max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md bg-panel2/60 p-2 font-mono text-[12px]">{JSON.stringify(v, null, 2)}</pre>
  if (f.type === 'code') return <pre className="max-h-[420px] max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md bg-panel2/60 p-2 font-mono text-[12px] leading-relaxed">{String(v)}</pre>
  if (f.type === 'owner') return <span>{textOf(f, row)}</span>
  if (f.type === 'url') return <a className="text-spice underline" href={String(v)} target="_blank" rel="noopener">{String(v)}</a>
  return <span className={f.mono ? 'break-all font-mono text-[12.5px]' : 'whitespace-pre-wrap break-words'}>{textOf(f, row)}</span>
}

/** подробиці запиту з журналу: відповідь, тривалість, звідки, що надіслали (секрети сервер уже сховав) */
function RequestView({ v }: { v: Record<string, unknown> }) {
  const st = Number(v.status)
  const body = v.body && typeof v.body === 'object' && Object.keys(v.body as object).length ? (v.body as Record<string, unknown>) : null
  const row = (label: string, value: ReactNode) => <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-2 py-1"><span className="text-muted">{label}</span><span className="min-w-0 break-words">{value}</span></div>
  return (
    <div className="grid text-[13px]">
      {st > 0 && row(t('Відповідь сайту'), <span>{st} — {st >= 500 ? t('помилка сервера') : st >= 400 ? t('Відмовлено') : t('Успішно')}</span>)}
      {v.ms != null && row(t('Тривалість'), t('{n} мс', { n: Number(v.ms) }))}
      {typeof v.ip === 'string' && row(t('Звідки (IP)'), <span className="font-mono">{v.ip}</span>)}
      {typeof v.id === 'string' && row(t('Створений запис'), <span className="font-mono">{v.id}</span>)}
      {body && row(t('Що надіслали'), (
        <dl className="grid gap-0.5">
          {Object.entries(body).map(([k, x]) => (
            <div key={k} className="flex min-w-0 gap-2"><dt className="shrink-0 font-mono text-[12px] text-muted">{k}</dt><dd className="min-w-0 break-all font-mono text-[12px]">{typeof x === 'string' ? x : JSON.stringify(x)}</dd></div>
          ))}
        </dl>
      ))}
    </div>
  )
}

/** обгортка поля: підпис, саме поле, підказка, помилка */
export function FieldShell({ f, children, error }: { f: Pick<Field, 'key' | 'label' | 'help' | 'required'>; children: ReactNode; error?: string }) {
  return (
    <SnField data-invalid={error ? '' : undefined}>
      <SnFieldLabel>{t(f.label)}{f.required && <span className="text-bad"> *</span>}</SnFieldLabel>
      {children}
      {f.help && <SnFieldDescription>{t(f.help)}</SnFieldDescription>}
      {error && <p className="text-[12.5px] text-bad">{error}</p>}
    </SnField>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const toDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const toTime = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

/** дата й час (мітка в мс): два поля — дата і година */
function DateTimeInput({ value, onChange, label }: { value: unknown; onChange: (v: number | null) => void; label: string }) {
  const ms = typeof value === 'number' ? value : null
  const [date, setDate] = useState(ms ? toDate(ms) : '')
  const [time, setTime] = useState(ms ? toTime(ms) : '')
  useEffect(() => { setDate(ms ? toDate(ms) : ''); setTime(ms ? toTime(ms) : '') }, [ms])
  const emit = (d: string, tm: string) => {
    if (!d) return onChange(null)
    const parsed = new Date(`${d}T${tm || '00:00'}`).getTime()
    if (Number.isFinite(parsed)) onChange(parsed)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SnInput type="date" modelValue={date} accessibilityLabel={label} className="min-w-[150px] flex-1" onInput={(e: Event) => { const v = valueOf(e); setDate(v); emit(v, time) }} />
      <SnInput type="time" modelValue={time} accessibilityLabel={t('Час')} className="w-[120px]" onInput={(e: Event) => { const v = valueOf(e); setTime(v); emit(date, v) }} />
      {ms != null && <SnButton variant="ghost" size="icon-sm" accessibilityLabel={t('Очистити')} onClick={() => { setDate(''); setTime(''); onChange(null) }}><X size={14} /></SnButton>}
    </div>
  )
}

/** вибір запису іншого розділу: пошук на сервері (щонайбільше 30 варіантів), підпис замість id */
export function RelationInput({ resource, value, label, onChange, placeholder }: { resource: string; value: unknown; label?: string | null; onChange: (v: string | null) => void; placeholder?: string }) {
  const [opts, setOpts] = useState<Option[]>([])
  const [q, setQ] = useState('')
  const [known, setKnown] = useState<Option | null>(null)
  /** варіанти тягнемо, лише коли поле відкрили (на картці таких полів буває кілька) */
  const [active, setActive] = useState(false)
  const box = useRef<HTMLElement>(null)
  const v = value == null ? '' : String(value)
  useEffect(() => {
    if (!active) return
    const h = setTimeout(() => adminApi.options(resource, q).then(setOpts).catch(() => setOpts([])), q ? 220 : 0)
    return () => clearTimeout(h)
  }, [resource, q, active])
  // підпис вибраного, якщо його нема серед знайденого (відкрили запис з уже заданим зв'язком)
  useEffect(() => {
    if (!v || label || opts.some((o) => o.value === v) || known?.value === v) return
    adminApi.options(resource, '', [v]).then((o) => setKnown(o[0] ?? { value: v, label: v })).catch(() => {})
  }, [v, resource, label, opts, known])
  const all = useMemo(() => {
    const cur = v && !opts.some((o) => o.value === v) ? [{ value: v, label: label || (known?.value === v ? known.label : v) }] : []
    return [...cur, ...opts]
  }, [opts, v, label, known])
  return (
    <SnCombobox
      ref={box}
      className="block min-w-0"
      modelValue={v}
      showClear
      onFocus={() => setActive(true)}
      onChange={(e: Event) => onChange(valueOf<string>(e) || null)}
      onInput={() => setQ(String((box.current as unknown as { inputValue?: string })?.inputValue ?? ''))}
    >
      <SnComboboxInput placeholder={placeholder || t('Почни вводити, щоб знайти')} />
      <SnComboboxContent>
        <SnComboboxList>
          {all.map((o) => <SnComboboxItem key={o.value} value={o.value}>{o.label}</SnComboboxItem>)}
        </SnComboboxList>
        <SnComboboxEmpty>{t('Нічого не знайшлося')}</SnComboboxEmpty>
      </SnComboboxContent>
    </SnCombobox>
  )
}

/** власник: людина чи гільдія — перемикач і пошук у відповідному розділі */
export function OwnerInput({ value, kind, label, onChange }: { value?: string | null; kind?: string | null; label?: string | null; onChange: (id: string | null, kind: string) => void }) {
  const [k, setK] = useState(kind || 'user')
  useEffect(() => { if (kind) setK(kind) }, [kind])
  return (
    <div className="grid gap-1.5">
      <SnSegmented size="sm" modelValue={k} onChange={(e: Event) => { const nk = valueOf(e); setK(nk); onChange(nk === 'site' ? 'site' : null, nk) }}>
        <SnSegmentedItem value="user">{t('Людина')}</SnSegmentedItem>
        <SnSegmentedItem value="guild">{t('Гільдія')}</SnSegmentedItem>
        <SnSegmentedItem value="site">{t('Сайт')}</SnSegmentedItem>
      </SnSegmented>
      {k === 'site'
        ? <p className="text-[12.5px] text-muted">{t('Офіційне від сайту: не в чиємусь списку, а в бібліотеці')}</p>
        : <RelationInput key={k} resource={k === 'guild' ? 'guilds' : 'users'} value={k === (kind || 'user') ? value : null} label={k === (kind || 'user') ? label : null}
            placeholder={k === 'guild' ? t('Знайти гільдію') : t('Знайти людину')} onChange={(id) => onChange(id, k)} />}
    </div>
  )
}

/**
 * Дозволи ролі — окремими блоками під формою: «На сайті» (вхід у панель, модерація, налаштування, указ) і кожна група
 * розділів своєю карткою; розділ — рядок, можливості (перегляд, створення, зміна, видалення, дії) — галочками.
 * Ширини стовпців однакові в усіх блоках, тож «Створення» чи «Видалення» стоять одне під одним по всій сторінці.
 */
const PERM_COLS = <colgroup><col className="w-[34%] sm:w-[230px]" /><col className="w-[64px]" /><col className="w-[92px]" /><col className="w-[92px]" /><col className="w-[92px]" /><col className="w-[92px]" /><col /></colgroup>
export function PermissionsBlocks({ value, onChange, readonly }: { value: unknown; onChange: (v: string[]) => void; readonly?: boolean }) {
  const [cat, setCat] = useState<Awaited<ReturnType<typeof adminApi.permissionsCatalog>> | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { adminApi.permissionsCatalog().then(setCat).catch((e) => setErr((e as Error).message)) }, [])
  const set = new Set(Array.isArray(value) ? (value as string[]) : [])
  /**
   * Зняти одне право, коли роль має «розділ.*», — розгортаємо «*» у явний список без цього права (інакше галочка
   * лишалась би: «*» її покриває).
   */
  const toggle = (p: string, on: boolean, all: string[] = []) => {
    const n = new Set(set)
    const wild = p.split('.')[0] + '.*'
    if (!on && n.has(wild)) { n.delete(wild); for (const x of all) n.add(x) }
    if (on) n.add(p); else n.delete(p)
    onChange([...n])
  }
  const toggleRow = (name: string, abilities: string[], on: boolean) => {
    const n = new Set(set)
    for (const a of abilities) if (on) n.add(`${name}.${a}`); else n.delete(`${name}.${a}`)
    n.delete(`${name}.*`)
    onChange([...n])
  }
  if (err) return <Panel title={t('Дозволи')}><p className="text-[13.5px] text-bad">{err}</p></Panel>
  if (!cat) return <Panel title={t('Дозволи')}><SnSkeleton lines={6} /></Panel>
  if (set.has('*')) return <Panel title={t('Дозволи')}><p className="text-[13.5px] text-muted">{t('Усі права — це роль адміністратора.')}</p></Panel>
  const has = (name: string, a: string) => set.has(`${name}.${a}`) || set.has(`${name}.*`)
  const ABIL: Record<string, string> = { view: t('Перегляд'), create: t('Створення'), edit: t('Зміна'), delete: t('Видалення') }
  const groups = [...new Set(cat.sections.map((x) => x.group))]
  const box = (on: boolean, label: string, fn: (v: boolean) => void) => <SnCheckbox modelValue={on} disabled={readonly} accessibilityLabel={label} onChange={(e: Event) => fn(checkedOf(e))} />
  return (
    <>
      <Panel title={t('Дозволи на сайті')} description={t('Що роль може поза розділами панелі.')}>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {cat.site.map((p) => (
            <div key={p.key} className="flex items-center gap-2 text-[13.5px]">
              {box(set.has(p.key) || (p.key.startsWith('site.') && set.has('site.*')), t(p.label), (on) => toggle(p.key, on, cat.site.map((x) => x.key).filter((k) => k.startsWith('site.'))))}
              <span>{t(p.label)}</span>
            </div>
          ))}
        </div>
      </Panel>
      {groups.map((g) => (
        <Panel key={g} title={t('Дозволи: {group}', { group: t(g) })}>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[640px] table-fixed text-[13px]">
              {PERM_COLS}
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-muted">
                  <th className="py-1.5 pr-2 font-medium">{t('Розділ')}</th>
                  <th className="px-2 py-1.5 font-medium">{t('Усе')}</th>
                  {['view', 'create', 'edit', 'delete'].map((a) => <th key={a} className="px-2 py-1.5 font-medium">{ABIL[a]}</th>)}
                  <th className="px-2 py-1.5 font-medium">{t('Дії')}</th>
                </tr>
              </thead>
              <tbody>
                {cat.sections.filter((x) => x.group === g).map((sec) => (
                  <tr key={sec.name} className="border-b border-line/60 align-top last:border-0">
                    <td className="truncate py-2 pr-2" title={t(sec.label)}>{t(sec.label)}</td>
                    <td className="px-2 py-2">{box(sec.abilities.every((a) => has(sec.name, a)), t('Усе: {section}', { section: t(sec.label) }), (on) => toggleRow(sec.name, sec.abilities, on))}</td>
                    {['view', 'create', 'edit', 'delete'].map((a) => (
                      <td key={a} className="px-2 py-2">{sec.abilities.includes(a) && box(has(sec.name, a), `${t(sec.label)}: ${ABIL[a]}`, (on) => toggle(`${sec.name}.${a}`, on, sec.abilities.map((x) => `${sec.name}.${x}`)))}</td>
                    ))}
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {Object.entries(sec.actions).map(([a, label]) => (
                          <div key={a} className="flex items-center gap-1.5">
                            {box(has(sec.name, a), `${t(sec.label)}: ${t(label)}`, (on) => toggle(`${sec.name}.${a}`, on, sec.abilities.map((x) => `${sec.name}.${x}`)))}
                            <span className="text-[12.5px]">{t(label)}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </>
  )
}

/** пари [id, кількість] — інгредієнти рецепта, ціна будівлі */
function PairsInput({ value, onChange }: { value: unknown; onChange: (v: [string, number][]) => void }) {
  const list = (Array.isArray(value) ? value : []) as [string, number][]
  const set = (i: number, p: [string, number]) => onChange(list.map((x, j) => (j === i ? p : x)))
  return (
    <div className="grid gap-1.5">
      {list.map(([id, n], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <SnInput className="min-w-0 flex-1" modelValue={id} placeholder={t('id предмета')} accessibilityLabel={t('id предмета')} onInput={(e: Event) => set(i, [valueOf(e), n])} />
          <SnNumberField className="w-[130px]" modelValue={n} min={0} accessibilityLabel={t('Кількість')} onChange={(e: Event) => set(i, [id, Number(valueOf(e)) || 0])} />
          <SnButton variant="ghost" size="icon-sm" accessibilityLabel={t('Прибрати')} onClick={() => onChange(list.filter((_, j) => j !== i))}><X size={14} /></SnButton>
        </div>
      ))}
      <div><SnButton size="sm" variant="outline" onClick={() => onChange([...list, ['', 1]])}><Plus size={14} />{t('Додати рядок')}</SnButton></div>
    </div>
  )
}

/** JSON: текстом, перевірка при виході з поля */
function JsonInput({ value, onChange, readonly, onInvalid }: { value: unknown; onChange: (v: unknown) => void; readonly?: boolean; onInvalid?: (bad: boolean) => void }) {
  const [text, setText] = useState(() => (value === undefined || value === null ? '' : JSON.stringify(value, null, 2)))
  const [err, setErr] = useState('')
  useEffect(() => { setText(value === undefined || value === null ? '' : JSON.stringify(value, null, 2)) }, [value])
  return (
    <div className="grid gap-1">
      <SnTextarea
        className="sn-code block min-w-0 max-w-full"
        rows={Math.min(16, Math.max(6, text.split('\n').length + 1))}
        modelValue={text}
        readOnly={readonly}
        onInput={(e: Event) => {
          // хибний JSON — одразу видно (і зберегти не дасть картка), а не мовчки старе значення
          const v = valueOf(e)
          setText(v)
          let bad = false
          if (v.trim()) { try { JSON.parse(v) } catch { bad = true } }
          onInvalid?.(bad)
        }}
        onBlur={() => {
          if (!text.trim()) { setErr(''); onInvalid?.(false); onChange(null); return }
          try { onChange(JSON.parse(text)); setErr(''); onInvalid?.(false) } catch (e) { setErr(t('Хибний JSON: {error}', { error: (e as Error).message })); onInvalid?.(true) }
        }}
      />
      {err && <p className="text-[12.5px] text-bad">{err}</p>}
    </div>
  )
}

/** поле форми за типом */
export function FieldInput({ f, value, row, onChange, onKind, readonly, onInvalid }: { f: Field; value: unknown; row?: Record<string, unknown>; onChange: (v: unknown) => void; onKind?: (kind: string) => void; readonly?: boolean; onInvalid?: (bad: boolean) => void }) {
  const label = t(f.label)
  if (readonly && f.type !== 'json' && f.type !== 'permissions') return <div className="min-h-8 py-1 text-[14px]"><ValueView f={f} row={{ ...(row || {}), [f.key]: value }} /></div>
  switch (f.type) {
    case 'textarea':
      return <SnTextarea rows={4} modelValue={value == null ? '' : String(value)} maxLength={f.max} accessibilityLabel={label} onInput={(e: Event) => onChange(valueOf(e))} />
    case 'int': case 'num':
      return <SnNumberField modelValue={value == null ? null : Number(value)} step={f.type === 'int' ? 1 : 0.1} accessibilityLabel={label} onChange={(e: Event) => { const v = valueOf<number | null>(e); onChange(v == null || Number.isNaN(Number(v)) ? null : Number(v)) }} />
    case 'bool':
      return <SnSwitch modelValue={!!value} accessibilityLabel={label} onChange={(e: Event) => onChange(checkedOf(e))} />
    case 'flag':
      return (
        <div className="flex items-center gap-3">
          <SnSwitch modelValue={value != null} accessibilityLabel={label} onChange={(e: Event) => onChange(checkedOf(e) ? Date.now() : null)} />
          {value != null && <span className="text-[13px] text-muted">{fmtDate(value)}</span>}
        </div>
      )
    case 'datetime':
      return <DateTimeInput value={value} label={label} onChange={onChange} />
    case 'select':
      return <SnSelect modelValue={value == null ? '' : String(value)} options={(f.options || []).map((o) => ({ value: o.value, label: t(o.label) }))} placeholder={t('Вибери')} accessibilityLabel={label} onChange={(e: Event) => onChange(valueOf(e))} />
    case 'relation':
      return <RelationInput resource={f.resource!} value={value} label={row?.[f.key + '__label'] as string | null} onChange={onChange} />
    case 'owner':
      return <OwnerInput value={value as string | null} kind={(row?.[f.kindField!] as string) ?? null} label={row?.[f.key + '__label'] as string | null} onChange={(id, kind) => { onChange(id); onKind?.(kind) }} />
    case 'permissions':
      return <PermissionsBlocks value={value} onChange={onChange} readonly={readonly} />
    case 'code':
      return <SnTextarea className="sn-code block min-w-0 max-w-full" rows={10} modelValue={value == null ? '' : String(value)} accessibilityLabel={label} onInput={(e: Event) => onChange(valueOf(e))} />
    case 'color':
      return <SnColorPicker modelValue={value == null ? '' : String(value)} presets={['#d9481f', '#ee8a2c', '#c9a227', '#5f9e4b', '#2f9e8f', '#2f6fd0', '#6a5acd', '#a855a8']} accessibilityLabel={label} onChange={(e: Event) => onChange(valueOf(e))} />
    case 'json':
      return <JsonInput value={value} onChange={onChange} readonly={readonly} onInvalid={onInvalid} />
    case 'pairs':
      return <PairsInput value={value} onChange={onChange} />
    case 'list':
      return <SnTextarea rows={4} modelValue={Array.isArray(value) ? value.join('\n') : ''} placeholder={t('По одному в рядку')} accessibilityLabel={label} onInput={(e: Event) => onChange(valueOf(e).split('\n').map((s: string) => s.trim()).filter(Boolean))} />
    default:
      return <SnInput type={f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'} modelValue={value == null ? '' : String(value)} maxLength={f.max} accessibilityLabel={label} className={f.mono ? 'font-mono' : undefined} onInput={(e: Event) => onChange(valueOf(e))} />
  }
}

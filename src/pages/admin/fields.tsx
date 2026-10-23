/**
 * Поля панелі керування: показ значення (у таблиці й картці) і поле форми для кожного типу — усе на компонентах
 * @snotax/ui. Типи — як у server/admin/engine.mjs. Зображення — картинкою (збільшити, завантажити нове в сховище,
 * прибрати); id записів у списках і парах (інгредієнти, станції) — вибором зі списку з іконкою й назвою.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ImageOff, Link2, Plus, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/modal'
import {
  SnBadge, SnButton, SnCheckbox, SnColorPicker, SnField, SnFieldDescription, SnFieldLabel, SnInput, SnNumberField, SnSegmented, SnSegmentedItem, SnSelect,
  SnSkeleton, SnSwitch, SnTextarea, checkedOf, sn, valueOf,
} from '@/components/sn'
import { locale, t } from '@/lib/i18n'
import { adminApi, adminHref, adminLink, resourceOf, type Field, type Option } from './api'
import { wikiImg } from '@/lib/catalog'
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

/**
 * адреса зображення з того, що лежить у полі: наше сховище (/media/…) і адреси сайту — як є; шлях іконки гри
 * (assets/Dune/…) — через /catalog-icons; картинки вікі — через /catalog-wiki (сайт кешує їх у себе)
 */
export function imageSrc(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const s = v.trim()
  if (/^https:\/\/media\.awakening\.wiki\//.test(s)) return wikiImg(s)
  if (s.startsWith('/') || /^https?:\/\//.test(s) || s.startsWith('data:image/')) return s
  if (/^assets\//.test(s)) return `/catalog-icons/${s}.webp`
  return null
}

/** тривалість у мс — словами: «850 мс», «4,2 с», «3 хв 5 с», «1 год 12 хв» */
export function fmtDuration(ms: unknown): string {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n < 1000) return t('{n} мс', { n: Math.round(n) })
  const s = n / 1000
  if (s < 60) return t('{n} с', { n: s < 10 ? s.toLocaleString(locale(), { maximumFractionDigits: 1 }) : Math.round(s) })
  const m = Math.floor(s / 60)
  if (m < 60) return t('{m} хв {s} с', { m, s: Math.round(s % 60) })
  return t('{h} год {m} хв', { h: Math.floor(m / 60), m: m % 60 })
}

/** розклад cron словами (часті випадки); незвичний — null */
export function cronText(expr: unknown): string | null {
  const p = String(expr ?? '').trim().split(/\s+/)
  if (p.length !== 5) return null
  const [mi, h, dom, mon, dow] = p
  const num = (x: string) => /^\d+$/.test(x)
  const hm = (hh: string, mm: string) => `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`
  if (mon !== '*') return null
  let m: RegExpExecArray | null
  if ((m = /^\*\/(\d+)$/.exec(mi)) && h === '*' && dom === '*' && dow === '*') return t('кожні {n} хв', { n: m[1] })
  if (mi === '*' && h === '*' && dom === '*' && dow === '*') return t('щохвилини')
  if (num(mi) && h === '*' && dom === '*' && dow === '*') return t('щогодини о :{mm}', { mm: mi.padStart(2, '0') })
  if (num(mi) && (m = /^\*\/(\d+)$/.exec(h)) && dom === '*' && dow === '*') return t('кожні {n} год о :{mm}', { n: m[1], mm: mi.padStart(2, '0') })
  if (num(mi) && num(h) && dom === '*' && dow === '*') return t('щодня о {time}', { time: hm(h, mi) })
  if (num(mi) && num(h) && dom === '*' && /^[0-7]$/.test(dow)) {
    // 7 січня 2024 — неділя: день тижня мовою сайту
    const day = new Date(2024, 0, 7 + (Number(dow) % 7)).toLocaleDateString(locale(), { weekday: 'long' })
    return t('щотижня: {day} о {time}', { day, time: hm(h, mi) })
  }
  if (num(mi) && num(h) && num(dom) && dow === '*') return t('щомісяця {d}-го о {time}', { d: dom, time: hm(h, mi) })
  return null
}

/** мініатюра: картинка в рамці; нема чи не завантажилась — значок */
export function ImageThumb({ src, size = 28, className }: { src: string | null; size?: number; className?: string }) {
  const [bad, setBad] = useState(false)
  useEffect(() => setBad(false), [src])
  return (
    <span className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-panel2/60 ${className ?? ''}`} style={{ width: size, height: size }}>
      {src && !bad ? <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" onError={() => setBad(true)} /> : <ImageOff size={Math.max(12, Math.round(size * 0.45))} className="text-muted" aria-hidden />}
    </span>
  )
}

/** зображення на весь екран (у вікні), з адресою під ним */
function ImageZoom({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} size="lg">
      <div className="grid gap-2">
        <div className="grid min-h-[200px] place-items-center rounded-lg border border-line bg-[repeating-conic-gradient(rgb(var(--c-panel2))_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] p-3">
          <img src={src} alt="" className="max-h-[70vh] max-w-full object-contain" />
        </div>
        <a href={src} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 break-all text-[12.5px] text-spice hover:underline"><Link2 size={13} className="shrink-0" />{t('Відкрити окремо')}</a>
      </div>
    </Modal>
  )
}

/** зображення в картці: мініатюра, клік — збільшити */
export function ImageView({ value, label, size = 72 }: { value: unknown; label: string; size?: number }) {
  const src = imageSrc(value)
  const [zoom, setZoom] = useState(false)
  if (!src) return <span className="text-muted">—</span>
  return (
    <>
      <button type="button" onClick={() => setZoom(true)} className="rounded-md outline-offset-2 hover:opacity-90" aria-label={t('Збільшити: {what}', { what: label })} title={t('Збільшити')}>
        <ImageThumb src={src} size={size} />
      </button>
      {zoom && <ImageZoom src={src} title={label} onClose={() => setZoom(false)} />}
    </>
  )
}

/** id у парі чи списку → [назва, іконка] з того, що дав сервер (<key>__refs) */
type Refs = Record<string, [string, string | null]>
const refsOf = (f: Field, row: Record<string, unknown>) => (row[f.key + '__refs'] ?? {}) as Refs

/** пари й списки записів у картці: значками з іконкою, кількістю й назвою — посиланнями на записи */
function RefChips({ f, row }: { f: Field; row: Record<string, unknown> }) {
  const refs = refsOf(f, row)
  const v = row[f.key]
  const list: [string, number | null][] = f.type === 'pairs' ? ((v as [string, number][]) ?? []) : ((v as string[]) ?? []).map((id) => [id, null])
  if (!list.length) return <span className="text-muted">—</span>
  const canOpen = !!(f.refs && resourceOf(f.refs))
  return (
    <ul className="flex flex-wrap gap-1.5">
      {list.map(([id, n], i) => {
        const r = refs[id]
        const body = (
          <>
            <ImageThumb src={imageSrc(r?.[1])} size={24} />
            {n != null && <span className="font-semibold tabular-nums">{n}×</span>}
            <span className="min-w-0 break-words">{r?.[0] ?? id}</span>
            {!r && <span className="text-[11.5px] text-muted">{t('немає в даних гри')}</span>}
          </>
        )
        const cls = 'inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-panel2/40 py-0.5 pl-0.5 pr-2 text-[13px]'
        return (
          <li key={`${id}:${i}`} className="max-w-full">
            {canOpen && r ? <a href={adminHref([f.refs!, id])} onClick={adminLink([f.refs!, id])} title={id} className={`${cls} hover:border-spice/50 hover:text-spice`}>{body}</a> : <span className={cls} title={id}>{body}</span>}
          </li>
        )
      })}
    </ul>
  )
}

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
  // порожнє поле-назва з підписом від сервера (рецепт без назви — назвою того, що з нього виходить)
  if ((v == null || v === '') && row[f.key + '__label'] != null && f.type !== 'relation' && f.type !== 'owner') return String(row[f.key + '__label'])
  if (v == null || v === '') return ''
  if (f.format === 'duration') return fmtDuration(v)
  switch (f.type) {
    case 'datetime': return fmtDate(v)
    case 'flag': return fmtDate(v)
    case 'bool': return v ? t('Так') : t('Ні')
    case 'select': return t(f.options?.find((o) => o.value === String(v) || o.also?.includes(String(v)))?.label ?? String(v))
    case 'owner': if (f.kindField && row[f.kindField] === 'site') return t('Сайт'); return String(row[f.key + '__label'] ?? v)
    case 'relation': return String(row[f.key + '__label'] ?? v)
    case 'pairs': { const refs = refsOf(f, row); return (v as [string, number][]).map(([id, n]) => `${n}× ${refs[id]?.[0] ?? id}`).join(', ') }
    case 'list': { const refs = refsOf(f, row); return (v as string[]).map((id) => refs[id]?.[0] ?? id).join(', ') }
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
  if (f.image) return <ImageView value={v} label={t(f.label)} />
  if ((v == null || v === '') && row[f.key + '__label'] != null && f.type !== 'relation') return <span className="text-muted">{textOf(f, row)}</span>
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return <span className="text-muted">—</span>
  if (f.refs && (f.type === 'pairs' || f.type === 'list')) return <RefChips f={f} row={row} />
  if (f.view === 'cron') { const h = cronText(v); return <span className="inline-flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-[12.5px]">{String(v)}</span>{h && <span className="text-muted">{h}</span>}</span> }
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

/**
 * вибір запису іншого розділу: пошук на сервері (щонайбільше 30 варіантів, у даних гри — і назвою мовою сайту),
 * підпис замість id; у розділу з зображенням — іконка біля кожного варіанта й біля вибраного
 */
export function RelationInput({ resource, value, label, icon, onChange, placeholder, accessibilityLabel }: { resource: string; value: unknown; label?: string | null; icon?: string | null; onChange: (v: string | null, o?: Option) => void; placeholder?: string; accessibilityLabel?: string }) {
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
  // фокус і введення — рідними подіями з тіньового DOM (обгортка sn() пропускає лише власні події елемента): відкрили
  // поле — тягнемо варіанти, вводять — шукаємо на сервері
  useEffect(() => {
    const node = box.current
    if (!node) return
    const focus = () => setActive(true)
    const input = () => { setActive(true); setQ(String((node as unknown as { search?: string; inputValue?: string }).search ?? (node as unknown as { inputValue?: string }).inputValue ?? '')) }
    node.addEventListener('focusin', focus)
    node.addEventListener('input', input)
    return () => { node.removeEventListener('focusin', focus); node.removeEventListener('input', input) }
  }, [])
  // підпис вибраного, якщо його нема серед знайденого (відкрили запис з уже заданим зв'язком)
  useEffect(() => {
    if (!v || label || opts.some((o) => o.value === v) || known?.value === v) return
    adminApi.options(resource, '', [v]).then((o) => setKnown(o[0] ?? { value: v, label: v })).catch(() => {})
  }, [v, resource, label, opts, known])
  const all = useMemo(() => {
    const cur: Option[] = v && !opts.some((o) => o.value === v) ? [{ value: v, label: label || (known?.value === v ? known.label : v), icon: icon ?? (known?.value === v ? known.icon : null) }] : []
    return [...cur, ...opts]
  }, [opts, v, label, icon, known])
  // іконки є — розділ із зображеннями (предмети, пристрої): показуємо їх і біля вибраного
  const withIcons = all.some((o) => o.icon)
  const sel = all.find((o) => o.value === v)
  const combo = (
    <SnCombobox
      ref={box}
      className="block min-w-0 flex-1"
      modelValue={v}
      showClear
      onChange={(e: Event) => { const nv = valueOf<string>(e) || null; onChange(nv, all.find((o) => o.value === nv)) }}
    >
      <SnComboboxInput placeholder={placeholder || t('Почни вводити, щоб знайти')} label={accessibilityLabel} />
      <SnComboboxContent>
        <SnComboboxList>
          {all.map((o) => {
            // однакові назви (різні записи гри з тією ж назвою) — ще й кодом, щоб розрізнити
            const label = all.some((x) => x !== o && x.label === o.label) ? `${o.label} · ${o.value}` : o.label
            return (
              <SnComboboxItem key={o.value} value={o.value} title={o.value}>
                {withIcons ? <span className="flex min-w-0 items-center gap-2"><ImageThumb src={imageSrc(o.icon)} size={26} />{label}</span> : label}
              </SnComboboxItem>
            )
          })}
        </SnComboboxList>
        <SnComboboxEmpty>{t('Нічого не знайшлося')}</SnComboboxEmpty>
      </SnComboboxContent>
    </SnCombobox>
  )
  // обгортка — завжди та сама (інакше, щойно прийдуть варіанти з іконками, поле змонтувалося б заново й загубило введене)
  return <div className="flex min-w-0 items-center gap-2">{(withIcons || icon) && <ImageThumb src={imageSrc(sel?.icon ?? icon)} size={34} />}{combo}</div>
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

/** пари [id, кількість] — інгредієнти рецепта, ціна будівлі: запис — вибором зі списку (з іконкою й назвою) */
function PairsInput({ f, value, refs, onChange }: { f: Field; value: unknown; refs: Refs; onChange: (v: [string, number][]) => void }) {
  const list = (Array.isArray(value) ? value : []) as [string, number][]
  const set = (i: number, p: [string, number]) => onChange(list.map((x, j) => (j === i ? p : x)))
  // ключі рядків: прибрали рядок посередині — решта полів не переплутує свій стан
  const keys = useRef<number[]>([])
  const next = useRef(0)
  while (keys.current.length < list.length) keys.current.push(next.current++)
  keys.current.length = list.length
  const what = f.refs ? t(resourceOf(f.refs)?.one ?? 'Запис') : t('id предмета')
  return (
    <div className="grid gap-2">
      {list.map(([id, n], i) => (
        <div key={keys.current[i]} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            {f.refs
              ? <RelationInput resource={f.refs} value={id || null} label={refs[id]?.[0]} icon={refs[id]?.[1]} accessibilityLabel={what} placeholder={t('Знайти: {what}', { what: what.toLowerCase() })} onChange={(nv) => set(i, [nv ?? '', n])} />
              : <SnInput className="min-w-0" modelValue={id} placeholder={t('id предмета')} accessibilityLabel={t('id предмета')} onInput={(e: Event) => set(i, [valueOf(e), n])} />}
          </div>
          <SnNumberField className="w-full min-w-[110px]" modelValue={n} min={0} accessibilityLabel={t('Кількість')} onChange={(e: Event) => set(i, [id, Number(valueOf(e)) || 0])} />
          <SnButton variant="ghost" size="icon-sm" accessibilityLabel={t('Прибрати')} onClick={() => { keys.current.splice(i, 1); onChange(list.filter((_, j) => j !== i)) }}><X size={14} /></SnButton>
        </div>
      ))}
      {!list.length && <p className="text-[13px] text-muted">{t('Порожньо.')}</p>}
      <div><SnButton size="sm" variant="outline" onClick={() => onChange([...list, ['', 1]])}><Plus size={14} />{t('Додати')}</SnButton></div>
    </div>
  )
}

/** список id записів (станції рецепта, потрібні вміння): значками з «×», новий — вибором зі списку */
function RefListInput({ f, value, refs, onChange }: { f: Field; value: unknown; refs: Refs; onChange: (v: string[]) => void }) {
  const list = (Array.isArray(value) ? value : []) as string[]
  // підписи того, що вибрали тут (сервер їх ще не знає)
  const [picked, setPicked] = useState<Refs>({})
  const [k, setK] = useState(0)
  const what = t(resourceOf(f.refs!)?.one ?? 'Запис')
  return (
    <div className="grid gap-2">
      {list.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((id) => {
            const r = refs[id] ?? picked[id]
            return (
              <li key={id} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-panel2/40 py-0.5 pl-0.5 pr-1 text-[13px]" title={id}>
                <ImageThumb src={imageSrc(r?.[1])} size={24} />
                <span className="min-w-0 break-words">{r?.[0] ?? id}</span>
                <SnButton variant="ghost" size="icon-sm" accessibilityLabel={t('Прибрати: {what}', { what: r?.[0] ?? id })} onClick={() => onChange(list.filter((x) => x !== id))}><X size={13} /></SnButton>
              </li>
            )
          })}
        </ul>
      ) : <p className="text-[13px] text-muted">{t('Порожньо.')}</p>}
      <RelationInput key={k} resource={f.refs!} value={null} accessibilityLabel={t('Додати: {what}', { what })} placeholder={t('Додати: {what}', { what: what.toLowerCase() })}
        onChange={(id, o) => { if (!id) return; if (!list.includes(id)) { setPicked((p) => ({ ...p, [id]: [o?.label ?? id, o?.icon ?? null] })); onChange([...list, id]) } setK((n) => n + 1) }} />
    </div>
  )
}

/** зображення в формі: що зараз (клік — збільшити), завантажити нове в сховище (чи перетягнути файл), прибрати, адреса */
function ImageInput({ f, value, resource, onChange }: { f: Field; value: unknown; resource?: string; onChange: (v: string | null) => void }) {
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(false)
  const [edit, setEdit] = useState(false)
  const [over, setOver] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const src = imageSrc(value)
  const label = t(f.label)
  const send = async (x: File | undefined) => {
    if (!x || !resource) return
    if (!x.type.startsWith('image/')) { toast.error(t('Це не зображення')); return }
    setBusy(true)
    try { const { url } = await adminApi.upload(resource, x); onChange(url); toast.success(t('Зображення завантажено — збережи запис')) } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-wrap items-start gap-3">
      <button
        type="button"
        onClick={() => (src ? setZoom(true) : file.current?.click())}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void send(e.dataTransfer.files?.[0]) }}
        className={`grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border bg-panel2/50 transition-colors ${over ? 'border-spice' : 'border-line hover:border-spice/50'}`}
        aria-label={src ? t('Збільшити: {what}', { what: label }) : t('Завантажити: {what}', { what: label })}
      >
        {src ? <ImageThumb src={src} size={94} className="border-0 bg-transparent" /> : <span className="grid place-items-center gap-1 text-[11.5px] text-muted"><ImageOff size={20} />{t('Нема')}</span>}
      </button>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          <SnButton size="sm" variant="outline" loading={busy} disabled={!resource || undefined} onClick={() => file.current?.click()}><Upload size={14} />{src ? t('Замінити') : t('Завантажити')}</SnButton>
          {value != null && value !== '' && <SnButton size="sm" variant="ghost" onClick={() => onChange(null)}><Trash2 size={14} />{t('Прибрати')}</SnButton>}
          <SnButton size="sm" variant="ghost" aria-pressed={edit} onClick={() => setEdit((x) => !x)}>{t('Адреса')}</SnButton>
        </div>
        {edit
          ? <SnInput className="font-mono" modelValue={value == null ? '' : String(value)} placeholder="/media/… · https://…" accessibilityLabel={t('Адреса: {what}', { what: label })} onInput={(e: Event) => onChange(valueOf(e) || null)} />
          : <p className="min-w-0 break-all font-mono text-[11.5px] text-muted">{value ? String(value) : t('Зображення нема — завантаж файл чи перетягни його сюди')}</p>}
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void send(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      {zoom && src && <ImageZoom src={src} title={label} onClose={() => setZoom(false)} />}
    </div>
  )
}

/** вибір із довгого списку (наборів, категорій пристроїв): поле з пошуком серед варіантів */
function SearchSelect({ value, options, label, onChange }: { value: unknown; options: Option[]; label: string; onChange: (v: string | null) => void }) {
  const v = value == null ? '' : String(value)
  const all = v && !options.some((o) => o.value === v) ? [{ value: v, label: v }, ...options] : options
  return (
    <SnCombobox className="block min-w-0" modelValue={v} showClear onChange={(e: Event) => onChange(valueOf<string>(e) || null)}>
      <SnComboboxInput placeholder={t('Почни вводити, щоб знайти')} label={label} />
      <SnComboboxContent>
        <SnComboboxList>
          {all.map((o) => <SnComboboxItem key={o.value} value={o.value} title={o.value}>{t(o.label)}</SnComboboxItem>)}
        </SnComboboxList>
        <SnComboboxEmpty>{t('Нічого не знайшлося')}</SnComboboxEmpty>
      </SnComboboxContent>
    </SnCombobox>
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

/** варіанти select: залежні — лише ті, що є у вибраному значенні іншого поля (підкатегорії категорії); без повторів */
export function selectOptions(f: Field, values?: Record<string, unknown>): Option[] {
  const parent = f.dependsOn ? values?.[f.dependsOn] : undefined
  const seen = new Set<string>()
  return (f.options || []).filter((o) => parent == null || parent === '' || o.parent == null || o.parent === String(parent)).filter((o) => (seen.has(o.value) ? false : (seen.add(o.value), true)))
}

/**
 * поле форми за типом. values — поточні значення всієї форми (варіанти, що залежать від іншого поля); resource — розділ
 * запису (куди завантажувати зображення)
 */
export function FieldInput({ f, value, row, values, resource, onChange, onKind, readonly, onInvalid }: { f: Field; value: unknown; row?: Record<string, unknown>; values?: Record<string, unknown>; resource?: string; onChange: (v: unknown) => void; onKind?: (kind: string) => void; readonly?: boolean; onInvalid?: (bad: boolean) => void }) {
  const label = t(f.label)
  if (readonly && f.type !== 'json' && f.type !== 'permissions') return <div className="min-h-8 py-1 text-[14px]"><ValueView f={f} row={{ ...(row || {}), [f.key]: value }} /></div>
  if (f.image) return <ImageInput f={f} value={value} resource={resource} onChange={onChange} />
  if (f.refs && f.type === 'pairs') return <PairsInput f={f} value={value} refs={row ? refsOf(f, row) : {}} onChange={onChange} />
  if (f.refs && f.type === 'list') return <RefListInput f={f} value={value} refs={row ? refsOf(f, row) : {}} onChange={onChange} />
  // довгий список варіантів (набори, категорії пристроїв) — з пошуком
  if (f.type === 'select' && selectOptions(f, values).length > 30) return <SearchSelect value={value} options={selectOptions(f, values)} label={label} onChange={onChange} />
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
    case 'select': {
      const opts = selectOptions(f, values)
      // значення, якого нема серед варіантів (давнє), — теж видно
      const cur = value == null ? '' : String(value)
      const list = cur && !opts.some((o) => o.value === cur) ? [{ value: cur, label: cur }, ...opts] : opts
      return <SnSelect modelValue={cur} options={list.map((o) => ({ value: o.value, label: t(o.label) }))} placeholder={t('Вибери')} accessibilityLabel={label} onChange={(e: Event) => onChange(valueOf(e))} />
    }
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
      return <PairsInput f={f} value={value} refs={{}} onChange={onChange} />
    case 'list':
      return <SnTextarea rows={4} modelValue={Array.isArray(value) ? value.join('\n') : ''} placeholder={t('По одному в рядку')} accessibilityLabel={label} onInput={(e: Event) => onChange(valueOf(e).split('\n').map((s: string) => s.trim()).filter(Boolean))} />
    default: {
      const input = <SnInput type={f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'} modelValue={value == null ? '' : String(value)} maxLength={f.max} accessibilityLabel={label} className={f.mono ? 'font-mono' : undefined} onInput={(e: Event) => onChange(valueOf(e))} />
      // розклад — ще й словами, щоб було видно, що вийшло
      if (f.view === 'cron') { const h = cronText(value); return <div className="grid gap-1">{input}{h && <p className="text-[12.5px] text-muted">{t('Тобто: {when}', { when: h })}</p>}</div> }
      return input
    }
  }
}

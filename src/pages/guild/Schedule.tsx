/**
 * Розклад активності гільдії (і години онлайну кандидата): перегляд — тиждень з понеділка, у кожному дні смуга доби з
 * годинами гри в поясі глядача й підписом; редактор — рядки «дні + з — до» (до 6), дні — кнопки-перемикачі.
 */
import { Plus, Trash2 } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { SnInput, valueOf } from '@/components/sn'
import { WEEK_ORDER, hhmm, myZone, toViewer, utcLabel, weekdays, type Slot } from '@/lib/weekly'
import { tzLabel } from '@/lib/guildProfile'

/** тиждень зі смугами; tz — пояс, у якому розклад вписано (null — пояс глядача) */
export function ScheduleView({ slots, tz, compact }: { slots: Slot[]; tz: string | null; compact?: boolean }) {
  const mine = myZone()
  const spans = toViewer(slots, tz, mine)
  const names = weekdays(compact ? 'short' : 'long')
  return (
    <div className="grid gap-2">
      <ul className="grid gap-1.5">
        {WEEK_ORDER.map((d) => {
          const day = spans.filter((s) => s.day === d)
          return (
            <li key={d} className="grid grid-cols-[minmax(0,1fr)] gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)_10.5rem] sm:items-center sm:gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 sm:block">
                <span className={cn('text-[13px] first-letter:uppercase', day.length ? 'font-semibold' : 'text-muted')}>{names[d]}</span>
                <span className="text-[12px] tabular-nums text-muted sm:hidden">{day.map((s) => `${hhmm(s.from)}–${hhmm(s.to)}`).join(', ')}</span>
              </div>
              <div className="relative h-5 overflow-hidden rounded-md bg-panel2" aria-hidden>
                {[6, 12, 18].map((h) => <span key={h} className="absolute inset-y-0 w-px bg-line" style={{ left: `${(h / 24) * 100}%` }} />)}
                {day.map((s, i) => <span key={i} className="absolute inset-y-0.5 rounded bg-spice/80" style={{ left: `${(s.from / 1440) * 100}%`, width: `${((s.to - s.from) / 1440) * 100}%` }} />)}
              </div>
              <span className="hidden text-right text-[12px] font-semibold tabular-nums sm:block">{day.map((s) => `${hhmm(s.from)}–${hhmm(s.to)}`).join(', ')}</span>
            </li>
          )
        })}
      </ul>
      <p className="text-[12px] leading-snug text-muted">
        {t('Час — твій ({zone}).', { zone: utcLabel(mine) })}{tz && tz !== mine ? ` ${t('Вписано за поясом {zone}.', { zone: tzLabel(tz) })}` : ''}
      </p>
    </div>
  )
}

const MAX_SLOTS = 6
/** редактор розкладу: рядки «дні + з — до» */
export function ScheduleEditor({ value, onChange, label }: { value: Slot[]; onChange: (v: Slot[]) => void; label: string }) {
  const names = weekdays('short')
  const set = (i: number, s: Partial<Slot>) => onChange(value.map((x, k) => (k === i ? { ...x, ...s } : x)))
  return (
    <div className="grid gap-2.5" role="group" aria-label={label}>
      {value.map((s, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-line bg-panel2/30 p-2.5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Дні')}>
            {WEEK_ORDER.map((d) => (
              <Toggle key={d} pressed={s.days.includes(d)} aria-label={names[d]} onPressedChange={(on) => set(i, { days: on ? [...s.days, d].sort() : s.days.filter((x) => x !== d) })}>
                <span className="first-letter:uppercase">{names[d]}</span>
              </Toggle>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SnInput type="time" size="lg" className="w-[8.5rem]" modelValue={s.from} accessibilityLabel={t('З')} onInput={(e: Event) => set(i, { from: valueOf(e).slice(0, 5) })} />
            <span className="text-muted">—</span>
            <SnInput type="time" size="lg" className="w-[8.5rem]" modelValue={s.to} accessibilityLabel={t('До')} onInput={(e: Event) => set(i, { to: valueOf(e).slice(0, 5) })} />
            <Button size="sm" variant="ghost" className="ml-auto" title={t('Прибрати рядок')} aria-label={t('Прибрати рядок')} onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 size={14} /></Button>
          </div>
          {s.to && s.from && s.to <= s.from && <p className="text-[12px] text-muted">{t('До наступного дня (через північ)')}</p>}
        </div>
      ))}
      {value.length < MAX_SLOTS && (
        <div><Button size="sm" variant="secondary" onClick={() => onChange([...value, { days: value.length ? [6, 0] : [1, 2, 3, 4, 5], from: '20:00', to: '23:00' }])}><Plus size={14} />{t('Додати години')}</Button></div>
      )}
    </div>
  )
}

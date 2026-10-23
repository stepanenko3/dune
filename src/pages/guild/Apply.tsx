/**
 * Заявка до гільдії — окрема сторінка /g/<адреса>/apply (довга анкета на телефоні — одна прокрутка, а не вікно):
 * вступ від гільдії, питання анкети (текст, вибір, рівень, години онлайну), кілька слів від себе. Чекаючу заявку можна
 * змінити (відповіді підставлено), відхилену — подати знову.
 */
import { useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { post } from '@/lib/api'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { SnInput, SnTextarea, valueOf } from '@/components/sn'
import { Section } from '../Account'
import { Field } from '../Auth'
import { LEVEL_MAX, STATUS_LABEL, type Answer, type Question } from '@/lib/guildProfile'
import { myZone, type Slot } from '@/lib/weekly'
import { ScheduleEditor } from './Schedule'
import type { GuildData } from './types'

/** чи порожня відповідь (для обов'язкових) */
const empty = (v: Answer | undefined) => v == null || v === '' || (Array.isArray(v) && !v.length)

function QuestionInput({ q, value, onChange }: { q: Question; value: Answer | undefined; onChange: (v: Answer | undefined) => void }) {
  if (q.type === 'text') return <SnTextarea size="lg" rows={3} maxLength={1000} modelValue={(value as string) ?? ''} accessibilityLabel={q.label} onInput={(e: Event) => onChange(valueOf(e))} />
  if (q.type === 'level') {
    return <SnInput type="number" size="lg" className="w-[9rem]" min={1} max={LEVEL_MAX} inputmode="numeric" modelValue={value == null ? '' : String(value)} accessibilityLabel={q.label} onInput={(e: Event) => { const v = valueOf(e); onChange(v === '' ? undefined : Number(v)) }} />
  }
  if (q.type === 'hours') return <ScheduleEditor label={q.label} value={(value as Slot[]) ?? []} onChange={(v) => onChange(v.length ? v : undefined)} />
  // вибір: кнопки-перемикачі; один варіант — натиснутий знімає інші
  const cur = (value as string[]) ?? []
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={q.label}>
      {(q.options ?? []).map((o) => (
        <Toggle key={o} size="default" pressed={cur.includes(o)} onPressedChange={(on) => onChange(on ? (q.multi ? [...cur, o] : [o]) : cur.filter((x) => x !== o))}>
          <span className="whitespace-normal break-words text-left">{o}</span>
        </Toggle>
      ))}
    </div>
  )
}

export function ApplyForm({ d, onDone, onCancel }: { d: GuildData; onDone: () => void; onCancel: () => void }) {
  const form = d.profile.form
  const again = d.request?.status === 'pending'
  const [answers, setAnswers] = useState<Record<string, Answer | undefined>>(() => (again ? { ...d.request!.answers } : {}))
  const [note, setNote] = useState(again ? d.request!.note : '')
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const missing = form.questions.filter((q) => q.required && empty(answers[q.id]))
  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    setTried(true)
    if (missing.length) { toast.error(t('Дай відповідь на обов’язкові питання')); return }
    setBusy(true)
    try {
      await post(`/api/guilds/${d.guild.slug}/requests`, { note: note.trim(), answers, tz: myZone() })
      toast.success(again ? t('Заявку змінено') : t('Заявку подано'))
      onDone()
    } catch (err) { toast.error((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={send} className="grid max-w-[760px] gap-2.5">
      {d.request && d.request.status !== 'pending' && (
        <p className={cn('rounded-xl border px-4 py-3 text-[13.5px] leading-snug', d.request.status === 'rejected' ? 'border-bad/40 bg-bad/5' : 'border-line bg-panel')}>
          {t('Попередня заявка: {status}.', { status: STATUS_LABEL[d.request.status] })}{d.request.reason ? ` ${t('Причина: {reason}', { reason: d.request.reason })}` : ''}
        </p>
      )}
      <Section title={again ? t('Змінити заявку до «{name}»', { name: d.guild.name }) : t('Заявка до «{name}»', { name: d.guild.name })} hint={form.intro || t('Офіцери гільдії побачать твої відповіді й вирішать. Прийнятий — новобранець.')}>
        <div className="grid gap-5">
          {form.questions.map((q, i) => (
            <div key={q.id} className="grid gap-1.5">
              <div className="text-[14px] font-semibold leading-snug">
                <span className="text-muted">{i + 1}. </span>{q.label}{q.required && <span className="text-spice" title={t('обов’язково')}> *</span>}
              </div>
              {q.type === 'choice' && q.multi && <div className="text-[12px] text-muted">{t('Можна кілька')}</div>}
              {q.type === 'hours' && <div className="text-[12px] text-muted">{t('За твоїм часом — офіцери побачать у своєму')}</div>}
              <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswers({ ...answers, [q.id]: v })} />
              {tried && q.required && empty(answers[q.id]) && <p className="text-[12.5px] font-medium text-bad">{t('Це питання обов’язкове')}</p>}
            </div>
          ))}
          <Field label={t('Кілька слів від себе')} hint={t('Хто ти, звідки, чому до нас (необов’язково)')}>
            <SnTextarea size="lg" rows={3} maxLength={1000} modelValue={note} accessibilityLabel={t('Кілька слів від себе')} onInput={(e: Event) => setNote(valueOf(e))} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={busy}><Send size={15} />{again ? t('Зберегти заявку') : t('Подати заявку')}</Button>
            <Button variant="ghost" onClick={onCancel}>{t('Скасувати')}</Button>
          </div>
        </div>
      </Section>
    </form>
  )
}

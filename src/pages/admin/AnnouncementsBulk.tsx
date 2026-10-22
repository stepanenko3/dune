/**
 * Масове створення оголошень: серією (одне оголошення щодня / щотижня / щомісяця N разів — дати зсуваються разом)
 * або списком (кілька різних одним махом, рядок таблиці — оголошення). Усе — одним пакетом: його видно у фільтрі
 * «Пакет», і його можна разом зсунути, вимкнути чи видалити.
 */
import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { SnButton, SnInput, SnSegmented, SnSegmentedItem, SnSelect, valueOf } from '@/components/sn'
import { Modal } from '@/components/ui/modal'
import { post } from '@/lib/api'
import { locale, t } from '@/lib/i18n'
import { FieldInput, FieldShell } from './fields'
import { resourceOf, type Field } from './api'

type A = Record<string, unknown>

export function AnnouncementsBulk({ onClose }: { onClose: (done: boolean) => void }) {
  const r = resourceOf('announcements')
  const [mode, setMode] = useState<'series' | 'list'>('series')
  const [tpl, setTpl] = useState<A>({ tone: 'info', audience: 'all', dismissible: true, enabled: true })
  const [every, setEvery] = useState('week')
  const [count, setCount] = useState(4)
  const [list, setList] = useState<A[]>([{ title: '', tone: 'info' }, { title: '', tone: 'info' }])
  const [busy, setBusy] = useState(false)
  const field = (k: string) => r?.fields.find((f) => f.key === k) as Field
  const keys = ['title', 'body', 'tone', 'audience', 'guild_id', 'lang', 'link_url', 'link_label', 'starts', 'ends', 'dismissible']

  // прев'ю серії: дати кожного з N
  const preview = useMemo(() => {
    if (mode !== 'series' || typeof tpl.starts !== 'number') return []
    return Array.from({ length: Math.min(count, 12) }, (_, i) => {
      const d = new Date(tpl.starts as number)
      if (every === 'month') d.setMonth(d.getMonth() + i)
      else d.setDate(d.getDate() + i * (every === 'day' ? 1 : 7))
      return d.toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    })
  }, [mode, tpl.starts, every, count])

  const submit = async () => {
    setBusy(true)
    try {
      const body = mode === 'series' ? { template: tpl, repeat: { every, count } } : { items: list.filter((a) => String(a.title || '').trim()) }
      const out = await post<{ created: number }>('/api/admin/announcements/bulk', body)
      toast.success(t('Створено оголошень: {n}', { n: out.created }))
      onClose(true)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (!r) return null
  const TONES = field('tone').options!.map((o) => ({ value: o.value, label: t(o.label) }))

  return (
    <Modal open onOpenChange={(o) => !o && onClose(false)} title={t('Створити кілька оголошень')} description={t('Усі підуть одним пакетом — його потім можна зсунути, вимкнути чи видалити разом.')} size="lg"
        footer={
        <>
          <SnButton variant="ghost" onClick={() => onClose(false)}>{t('Скасувати')}</SnButton>
          <SnButton variant="primary" loading={busy} onClick={submit}>
            {mode === 'series' ? t('Створити {n}', { n: count }) : t('Створити {n}', { n: list.filter((a) => String(a.title || '').trim()).length })}
          </SnButton>
        </>
      }>
      <div className="grid gap-4">
        <SnSegmented modelValue={mode} onChange={(e: Event) => setMode(valueOf(e) as 'series' | 'list')}>
          <SnSegmentedItem value="series">{t('Серія: те саме кілька разів')}</SnSegmentedItem>
          <SnSegmentedItem value="list">{t('Список: різні одним махом')}</SnSegmentedItem>
        </SnSegmented>

        {mode === 'series' ? (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 md:grid-cols-2">
              {keys.map((k) => field(k) && (
                <div key={k} className={k === 'body' ? 'md:col-span-2' : undefined}>
                  <FieldShell f={{ ...field(k), required: k === 'title' || k === 'starts' }}>
                    <FieldInput f={field(k)} value={tpl[k]} onChange={(v) => setTpl((s) => ({ ...s, [k]: v }))} />
                  </FieldShell>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border border-line p-3 md:grid-cols-[1fr_10rem]">
              <FieldShell f={{ key: 'every', label: 'Повторювати' }}>
                <SnSegmented modelValue={every} onChange={(e: Event) => setEvery(valueOf(e))}>
                  <SnSegmentedItem value="day">{t('щодня')}</SnSegmentedItem>
                  <SnSegmentedItem value="week">{t('щотижня')}</SnSegmentedItem>
                  <SnSegmentedItem value="month">{t('щомісяця')}</SnSegmentedItem>
                </SnSegmented>
              </FieldShell>
              <FieldShell f={{ key: 'count', label: 'Скільки разів' }}>
                <SnInput type="number" modelValue={String(count)} min={1} max={100} accessibilityLabel={t('Скільки разів')} onInput={(e: Event) => setCount(Math.max(1, Math.min(100, Number(valueOf(e)) || 1)))} />
              </FieldShell>
              {preview.length > 0 && (
                <ul className="flex flex-wrap gap-1.5 text-[12px] text-muted md:col-span-2">
                  {preview.map((p, i) => <li key={i} className="rounded-full bg-panel2 px-2 py-0.5">{p}</li>)}
                  {count > preview.length && <li className="px-1">… {t('ще {n}', { n: count - preview.length })}</li>}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="grid gap-2">
            {list.map((a, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-line p-2.5 md:grid-cols-[minmax(0,1.6fr)_9rem_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                <SnInput modelValue={String(a.title || '')} placeholder={t('Заголовок')} accessibilityLabel={t('Заголовок')} onInput={(e: Event) => setList((l) => l.map((x, j) => (j === i ? { ...x, title: valueOf(e) } : x)))} />
                <SnSelect modelValue={String(a.tone || 'info')} options={TONES} accessibilityLabel={t('Тон')} onChange={(e: Event) => setList((l) => l.map((x, j) => (j === i ? { ...x, tone: valueOf(e) } : x)))} />
                <FieldInput f={field('starts')} value={a.starts} onChange={(v) => setList((l) => l.map((x, j) => (j === i ? { ...x, starts: v } : x)))} />
                <FieldInput f={field('ends')} value={a.ends} onChange={(v) => setList((l) => l.map((x, j) => (j === i ? { ...x, ends: v } : x)))} />
                <SnButton variant="ghost" size="icon-sm" accessibilityLabel={t('Прибрати')} onClick={() => setList((l) => l.filter((_, j) => j !== i))}><X size={14} /></SnButton>
              </div>
            ))}
            <div><SnButton size="sm" variant="outline" onClick={() => setList((l) => [...l, { title: '', tone: 'info' }])}><Plus size={14} />{t('Ще одне')}</SnButton></div>
            <p className="text-[12.5px] text-muted">{t('Порожні рядки пропускаємо. Текст, аудиторію й посилання можна дописати потім у кожному.')}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}

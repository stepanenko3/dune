/**
 * Збережені розрахунки на сторінці калькулятора — як білди в планувальнику вмінь: дії одним меню («Зберегти»,
 * «Копіювати посилання»; свої й публічні — сторінка «Калькулятор» у хлібних крихтах), вікно збереження (новий чи поверх
 * відкритого — назва, нотатки, чий і хто бачить) і рядок відкритого розрахунку (назва, нотатки, доступ).
 */
import { useState, type FormEvent } from 'react'
import { Eraser, Link2, LogIn, Save, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { calcAboutText, createCalc, updateCalc, type CalcDoc, type SavedCalc } from '@/lib/calcs'
import { useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import type { Visibility } from '@/lib/items'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ActionsTrigger, Menu, type MenuEntry } from '@/components/ui/menu'
import { Modal } from '@/components/ui/modal'
import { ErrorAlert } from '@/components/states'
import { SnInput, SnTextarea, valueOf } from '@/components/sn'
import { ItemActions, ItemBar, NewAccess, type OwnerRef } from '@/components/access/Access'
import { PageHeader } from '@/components/PageHeader'
import { useNewRights } from '@/components/access/Rights'
import { Field } from '@/pages/Auth'

/** що зберігати: усе, крім назви й нотаток (їх пише людина у вікні) */
export type CalcState = Omit<CalcDoc, 'name' | 'notes'>

/** меню дій з розрахунком; зберегти й список — після входу */
export function CalcMenu({ canSave, link, open, dirty, onSave, onBack, onDelete, onClear }: {
  /** чи є що зберігати (цілі) */
  canSave: boolean
  /** посилання на те, що зараз на сторінці: на відкритий розрахунок чи на цілі (?t=…); null — нема чим ділитися */
  link: string | null
  open: SavedCalc | null
  dirty: boolean
  onSave: () => void
  /** відкрито збережений чи за посиланням — повернутися до свого розрахунку */
  onBack?: (() => void) | null
  /** видалити відкритий збережений (тому, хто ним керує) */
  onDelete?: (() => void) | null
  /** очистити свій список (коли нічого не відкрито) */
  onClear?: (() => void) | null
}) {
  const user = useAuth((s) => s.user)
  // як у планувальнику: відкрито чуже чи збережене — «назад до свого» (і «Видалити»), своє — «Очистити»
  const last: MenuEntry[] = onBack
    ? [{ kind: 'separator' }, { label: t('Повернутися до свого розрахунку'), icon: <Undo2 size={14} />, onSelect: onBack }, ...(onDelete ? [{ label: t('Видалити розрахунок'), icon: <Trash2 size={14} />, danger: true, onSelect: onDelete }] : [])]
    : onClear !== undefined ? [{ kind: 'separator' }, { label: t('Очистити розрахунок'), icon: <Eraser size={14} />, danger: true, onSelect: () => onClear?.(), disabled: !onClear }] : []
  // без входу — на вхід без перезавантаження сторінки, і назад сюди ж
  const need = (go: () => void) => () => { if (user) go(); else useStore.getState().setView('login', { search: `?next=${encodeURIComponent(location.pathname + location.search)}` }) }
  const copy = () => {
    if (!link) return
    // посилання на розрахунок відкриє лише той, хто його бачить; і показує збережену версію, не поточні правки
    const note = open?.item.visibility === 'private'
      ? t('Розрахунок особистий — за цим посиланням його відкриєш лише ти. Щоб поділитися, зміни доступ.')
      : open && dirty
        ? t('Посилання — на збережену версію; останні зміни спершу збережи.')
        : undefined
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(link))
      .then(() => toast.success(t('Посилання скопійовано'), { description: note, id: 'calc-link' }), () => toast.info(link, { id: 'calc-link' }))
  }
  return (
    <Menu
      trigger={<ActionsTrigger />}
      items={!user ? [
        // гість: розрахунок — у цьому браузері й в адресі (поділитися — посиланням); в акаунт — після входу
        { label: t('Копіювати посилання'), icon: <Link2 size={14} />, onSelect: copy, disabled: !link },
        { kind: 'separator' },
        { kind: 'label', label: t('Без входу розрахунок зберігається в цьому браузері') },
        { label: t('Увійти, щоб зберігати в акаунті'), icon: <LogIn size={14} />, onSelect: need(onSave) },
        ...last,
      ] : [
        { label: t('Зберегти'), icon: <Save size={14} />, onSelect: need(onSave), disabled: !canSave, hint: open && dirty ? t('є зміни') : undefined },
        { label: t('Копіювати посилання'), icon: <Link2 size={14} />, onSelect: copy, disabled: !link },
        // свої й публічні розрахунки — сторінка «Калькулятор» (у хлібних крихтах)
        ...last,
      ]}
    />
  )
}

/**
 * Відкритий збережений розрахунок — блоком, як шапка бази й відкритий білд: назва, поруч доступ і власник (і «є
 * незбережені зміни»), підсумок і нотатки; дії — зірка, «Копіювати собі», «Доступ». Решта — у «Дії» калькулятора.
 */
export function OpenCalc({ c, dirty, onChange, onSave }: { c: SavedCalc; dirty: boolean; onChange: (c: SavedCalc) => void; onSave: () => void }) {
  return (
    <PageHeader
      className="gap-2 py-3"
      title={c.name}
      badges={
        <>
          <ItemBar item={c.item} actions={false} className="min-w-0" />
          {dirty && (
            <button type="button" onClick={onSave} title={t('Зберегти зміни')} className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11.5px] font-semibold text-warn hover:bg-warn/20">
              {t('Є незбережені зміни')}
            </button>
          )}
        </>
      }
      lead={(c.about || c.notes) ? (
        <>
          {c.about && <span className="block">{calcAboutText(c.about)}</span>}
          {c.notes && <span className="mt-1 block whitespace-pre-line text-ink/90">{c.notes}</span>}
        </>
      ) : undefined}
      actions={<ItemActions item={c.item} onChange={(it) => onChange({ ...c, item: { ...it, can: it.can ?? c.item.can } })} />}
    />
  )
}

export function SaveCalcDialog({ doc, open, onClose, onSaved }: { doc: CalcState; open: SavedCalc | null; onClose: () => void; onSaved: (c: SavedCalc) => void }) {
  const user = useAuth((s) => s.user)!
  const canUpdate = !!open?.item.can?.edit
  const [mode, setMode] = useState<'update' | 'new'>(canUpdate ? 'update' : 'new')
  const [name, setName] = useState(open && canUpdate ? open.name : '')
  const [notes, setNotes] = useState(open && canUpdate ? open.notes : '')
  const [owner, setOwner] = useState<OwnerRef>({ kind: 'user', id: user.id })
  // права нової речі — у тому ж вікні, під «Хто власник» і «Хто бачить»
  const rights = useNewRights('calc')
  const [vis, setVis] = useState<Visibility>('private')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      const body = { ...doc, name, notes }
      const c = mode === 'update' && open ? await updateCalc(open.id, body) : await createCalc(body, owner, vis)
      if (!(mode === 'update' && open)) await rights.apply(c, owner, vis)
      toast.success(mode === 'update' ? t('Розрахунок оновлено') : t('Розрахунок збережено'))
      onSaved(c)
      onClose()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={t('Зберегти розрахунок')} description={calcAboutText(doc.about)}>
      <form onSubmit={submit} className="grid gap-4">
        {canUpdate && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
            {(['update', 'new'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); if (m === 'new') { setName(''); setNotes('') } else { setName(open!.name); setNotes(open!.notes) } }}
                className={cn('rounded-lg border px-3 py-2.5 text-left text-[13.5px] font-semibold transition-colors', mode === m ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40')}>
                {m === 'update' ? t('Оновити «{name}»', { name: open!.name }) : t('Новий розрахунок')}
              </button>
            ))}
          </div>
        )}
        <Field label={t('Назва')}>
          <SnInput modelValue={name} maxLength={80} required autofocus placeholder={t('Наприклад: Сталь на тиждень')} accessibilityLabel={t('Назва')}
            onInput={(e: Event) => setName(valueOf(e))}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }} />
        </Field>
        <Field label={t('Нотатки')} hint={t('Для чого розрахунок, де брати сировину, хто що робить')}>
          <SnTextarea rows={4} modelValue={notes} maxLength={4000} accessibilityLabel={t('Нотатки')} onInput={(e: Event) => setNotes(valueOf(e))} />
        </Field>
        {mode === 'new' && <NewAccess owner={owner} visibility={vis} rights={rights} onChange={(o, v) => { setOwner(o); setVis(v) }} />}
        {error && <ErrorAlert title={t('Не вдалося зберегти розрахунок')} message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button>
          <Button type="submit" disabled={busy || !name.trim()} loading={busy}>{busy ? t('Зберігаю…') : mode === 'update' ? t('Оновити') : t('Зберегти')}</Button>
        </div>
      </form>
    </Modal>
  )
}

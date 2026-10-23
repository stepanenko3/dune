/**
 * Збережені білди в планувальнику вмінь: меню дій — «Зберегти» (новий чи оновити відкритий — назва, нотатки, чий і хто
 * бачить), посилання; відкрито збережений чи чужий — «Повернутися до свого білду» (і «Видалити білд»), свій — «Очистити білд»; свої й публічні — сторінка «Уміння»; і блок
 * доступу відкритого білду (зірка, копія собі, доступ).
 * Сам білд — код планувальника (той самий, що в адресі ?b=…) і знімок «вузол: ранг» (lib/skills.snap): за ним білд
 * відкривається тим самим і після оновлення гри. Опис (школи й очки) — українською, показуємо мовою сайту (aboutText).
 */
import { useState, useSyncExternalStore, type FormEvent } from 'react'
import { Copy, Eraser, LogIn, MoreHorizontal, Save, Trash2, Undo2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { post, put } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { aboutText, type Snap } from '@/lib/skills'
import type { Item, Visibility } from '@/lib/items'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ActionsTrigger, Menu, type MenuEntry } from '@/components/ui/menu'
import { ErrorAlert } from '@/components/states'
import { SnInput, SnTextarea, valueOf } from '@/components/sn'
import { ItemActions, ItemBar, NewAccess, type OwnerRef } from '@/components/access/Access'
import { PageHeader } from '@/components/PageHeader'
import { useNewRights } from '@/components/access/Rights'
import { useStore } from '@/store'
import { Field } from '@/pages/Auth'

export interface SavedBuild { id: string; name: string; code: string; notes: string; about: string; snap?: Snap | null; item: Item }

/** на вхід — без перезавантаження сторінки, і назад сюди ж */
const toLogin = () => useStore.getState().setView('login', { search: `?next=${encodeURIComponent(location.pathname + location.search)}` })

/** вузький екран (до sm): «Дії» — значком */
const narrow = typeof matchMedia === 'function' ? matchMedia('(max-width: 639.98px)') : null
const usePhone = () => useSyncExternalStore((f) => { narrow?.addEventListener('change', f); return () => narrow?.removeEventListener('change', f) }, () => !!narrow?.matches)

/**
 * Дії планувальника одним меню (місце у верхньому рядку — для шкіл і очок): копіювати посилання, зберегти,
 * мої білди, бібліотека білдів, скинути. Вікна — поза темним блоком дерева (portal), щоб мали звичайні кольори.
 */
export function BuildsBar({ code, about, snap, open, onOpen, onCopy, onReset, onBack, onDelete }: {
  code: string; about: string; snap: () => Snap; open: SavedBuild | null; onOpen: (b: SavedBuild | null) => void; onCopy: () => void
  /** очистити свій білд (лише коли нічого не відкрито) */
  onReset: () => void
  /** відкрито збережений чи чужий білд — повернутися до свого (той, що був до нього) */
  onBack?: (() => void) | null
  /** видалити відкритий збережений білд (тому, хто ним керує) */
  onDelete?: (() => void) | null
}) {
  const user = useAuth((s) => s.user)
  const phone = usePhone()
  const [saving, setSaving] = useState(false)
  const need = () => { if (!user) { toLogin(); return false } return true }
  // відкрито чужий чи збережений — одна дія «назад до свого»; свій — «Очистити» (їх ніколи не видно разом)
  const last: MenuEntry[] = onBack
    ? [{ kind: 'separator' }, { label: t('Повернутися до свого білду'), icon: <Undo2 size={14} />, onSelect: onBack }, ...(onDelete ? [{ label: t('Видалити білд'), icon: <Trash2 size={14} />, danger: true, onSelect: onDelete }] : [])]
    : [{ kind: 'separator' }, { label: t('Очистити білд'), icon: <Eraser size={14} />, danger: true, onSelect: onReset, disabled: !code }]
  return (
    <>
      <Menu
        // на телефоні — лише значок «…» (місце в одному рядку з назвою школи й очками), з sm — «Дії» словом
        trigger={phone ? <Button variant="secondary" size="icon" aria-label={t('Дії')}><MoreHorizontal size={15} /></Button> : <ActionsTrigger />}
        items={!user ? [
          // гість: білд — у цьому браузері й в адресі (поділитися — посиланням); в акаунт — після входу
          { label: t('Копіювати посилання'), icon: <Copy size={14} />, onSelect: onCopy },
          { kind: 'separator' },
          { kind: 'label', label: t('Без входу білд зберігається в цьому браузері') },
          { label: t('Увійти, щоб зберігати в акаунті'), icon: <LogIn size={14} />, onSelect: toLogin },
          ...last,
        ] : [
          // порожній білд зберігати нема чого
          { label: open?.item.can?.edit ? t('Зберегти (оновити «{name}»)', { name: open.name }) : t('Зберегти'), icon: <Save size={14} />, onSelect: () => { if (need()) setSaving(true) }, disabled: !code, hint: code ? undefined : t('порожній') },
          { label: t('Копіювати посилання'), icon: <Copy size={14} />, onSelect: onCopy },
          // свої й публічні білди — сторінка «Уміння» в хлібних крихтах
          ...last,
        ]}
      />
      {saving && createPortal(<SaveDialog code={code} about={about} snap={snap} open={open} onClose={() => setSaving(false)} onSaved={onOpen} />, document.body)}
    </>
  )
}

/**
 * Відкритий збережений білд — окремим блоком над планувальником, як шапка бази: назва, поруч доступ і власник, опис і
 * нотатки; дії — зірка, «Копіювати собі», «Доступ». Решта («Зберегти», «Закрити білд»…) — у «Дії» планувальника: одне меню.
 */
export function OpenBuild({ b, onChange }: { b: SavedBuild; onChange: (b: SavedBuild) => void }) {
  return (
    <PageHeader
      className="shrink-0 gap-2 py-3"
      title={b.name}
      badges={<ItemBar item={b.item} actions={false} className="min-w-0" />}
      lead={(b.about || b.notes) ? (
        <>
          {b.about && <span className="block">{aboutText(b.about)}</span>}
          {b.notes && <span className="mt-1 block whitespace-pre-line text-ink/90">{b.notes}</span>}
        </>
      ) : undefined}
      actions={
        <ItemActions
          item={b.item}
          onChange={(it) => onChange({ ...b, item: { ...it, can: it.can ?? b.item.can } })}
        />
      }
    />
  )
}

function SaveDialog({ code, about, snap, open, onClose, onSaved }: { code: string; about: string; snap: () => Snap; open: SavedBuild | null; onClose: () => void; onSaved: (b: SavedBuild) => void }) {
  const user = useAuth((s) => s.user)!
  const canUpdate = !!open?.item.can?.edit
  const [mode, setMode] = useState<'update' | 'new'>(canUpdate ? 'update' : 'new')
  const [name, setName] = useState(open && canUpdate ? open.name : '')
  const [notes, setNotes] = useState(open && canUpdate ? open.notes : '')
  const [owner, setOwner] = useState<OwnerRef>({ kind: 'user', id: user.id })
  // права нової речі — у тому ж вікні, під «Хто власник» і «Хто бачить»
  const rights = useNewRights('build')
  const [vis, setVis] = useState<Visibility>('private')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      const doc = { name, notes, code, about, snap: snap() }
      const b = mode === 'update' && open
        ? await put<SavedBuild>(`/api/builds/${open.id}`, doc)
        : await post<SavedBuild>('/api/builds', { ...doc, owner, visibility: vis })
      if (!(mode === 'update' && open)) await rights.apply(b, owner, vis)
      toast.success(mode === 'update' ? t('Білд оновлено') : t('Білд збережено'))
      onSaved(b)
      onClose()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={t('Зберегти білд')} description={aboutText(about)}>
      <form onSubmit={submit} className="grid gap-4">
        {canUpdate && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
            {(['update', 'new'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); if (m === 'new') { setName(''); setNotes('') } else { setName(open!.name); setNotes(open!.notes) } }}
                className={`rounded-lg border px-3 py-2.5 text-left text-[13.5px] font-semibold transition-colors ${mode === m ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40'}`}>
                {m === 'update' ? t('Оновити «{name}»', { name: open!.name }) : t('Новий білд')}
              </button>
            ))}
          </div>
        )}
        <Field label={t('Назва')}>
          <SnInput modelValue={name} maxLength={80} required autofocus placeholder={t('Наприклад: Мечник для Глибокої пустелі')} accessibilityLabel={t('Назва')}
            onInput={(e: Event) => setName(valueOf(e))}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }} />
        </Field>
        <Field label={t('Нотатки')} hint={t('Навіщо білд, порядок прокачки, зброя й броня')}>
          <SnTextarea rows={4} modelValue={notes} maxLength={4000} accessibilityLabel={t('Нотатки')} onInput={(e: Event) => setNotes(valueOf(e))} />
        </Field>
        {mode === 'new' && <NewAccess owner={owner} visibility={vis} rights={rights} onChange={(o, v) => { setOwner(o); setVis(v) }} />}
        {error && <ErrorAlert title={t('Не вдалося зберегти білд')} message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button>
          <Button type="submit" disabled={busy || !name.trim()} loading={busy}>{busy ? t('Зберігаю…') : mode === 'update' ? t('Оновити') : t('Зберегти')}</Button>
        </div>
      </form>
    </Modal>
  )
}

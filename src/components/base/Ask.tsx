/**
 * Вікна баз замість confirm() / prompt() браузера (ті — мовою браузера й «сайт … каже»): підтвердження й назва.
 * Монтуй, коли треба: відкрите, поки змонтоване. Тут же — спільні дії кошика (список баз і сторінка бази).
 */
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { SnInput, valueOf } from '@/components/sn'
import { purgeBase, removeBase } from '@/lib/bases'
import { t } from '@/lib/i18n'

/** «Точно?» — підпис кнопки, danger — червона (видалення) */
export function Confirm({ title, text, confirm, danger, onClose, onConfirm }: {
  title: ReactNode
  text?: ReactNode
  confirm: string
  danger?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open
      size="sm"
      onOpenChange={onClose}
      title={title}
      description={text}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button>
          <Button variant={danger ? 'destructive' : 'default'} onClick={() => { onClose(); onConfirm() }}>{confirm}</Button>
        </>
      }
    >
      {null}
    </Modal>
  )
}

/** назва (копії бази тощо): Enter — готово; порожню не приймаємо */
export function NameDialog({ title, label, value, confirm, max = 120, onClose, onSubmit }: {
  title: ReactNode
  label: string
  value: string
  confirm: string
  max?: number
  onClose: () => void
  onSubmit: (name: string) => void
}) {
  const [v, setV] = useState(value)
  const ok = v.trim().length > 0
  const done = () => { if (!ok) return; onClose(); onSubmit(v.trim()) }
  return (
    <Modal
      open
      size="sm"
      onOpenChange={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('Скасувати')}</Button>
          <Button onClick={done} disabled={!ok}>{confirm}</Button>
        </>
      }
    >
      <SnInput size="md" autofocus modelValue={v} maxLength={max} accessibilityLabel={label}
        onInput={(e: Event) => setV(valueOf(e) ?? '')}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); done() } }} />
    </Modal>
  )
}

/** у кошик — з «Повернути» в повідомленні (помилку повернення теж показуємо) */
export async function trashBase(b: { id: string; name: string }) {
  try {
    await removeBase(b.id)
    toast.success(t('«{name}» видалено', { name: b.name }), { action: { label: t('Повернути'), onClick: () => void untrashBase(b) } })
  } catch (e) {
    toast.error((e as Error).message)
  }
}
/** з кошика назад */
export async function untrashBase(b: { id: string; name: string }) {
  try {
    await removeBase(b.id, true)
    toast.success(t('«{name}» повернуто', { name: b.name }))
  } catch (e) {
    toast.error((e as Error).message)
  }
}
/** стерти назавжди (лише з кошика); true — стерто */
export async function eraseBase(b: { id: string; name: string }) {
  try {
    await purgeBase(b.id)
    toast.success(t('«{name}» стерто назавжди', { name: b.name }))
    return true
  } catch (e) {
    toast.error((e as Error).message)
    return false
  }
}

/**
 * Скарга на оголошення, угоду чи людину: причина картками (RMT — окремою, першою), коротко — що сталося. Модератори
 * бачать скарги в черзі біржі; три скарги «RMT» від різних людей ховають оголошення одразу.
 */
import { useState } from 'react'
import { Flag } from 'lucide-react'
import { toast } from 'sonner'
import { report, REASON_HINT, REASON_LABEL, REASONS, type Reason } from '@/lib/market'
import { loginHref, useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { openPath } from '@/store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ErrorAlert } from '@/components/states'
import { SnTextarea, valueOf } from '@/components/sn'
import { CHOICES, Choice } from './bits'

export function ReportButton({ target, label = t('Поскаржитись'), size = 'sm' }: { target: { kind: 'listing' | 'deal' | 'user'; id: string }; label?: string; size?: 'sm' | 'xs' }) {
  const me = useAuth((s) => s.user)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<Reason | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async () => {
    if (!reason) { setError(t('Вибери причину скарги')); return }
    setBusy(true); setError('')
    try {
      await report(target, reason, note)
      toast.success(t('Скаргу надіслано — модератори розглянуть'))
      setOpen(false)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <>
      <Button size={size} variant="ghost" className="text-muted hover:text-bad" onClick={() => { if (!me) { openPath(loginHref()); return } setReason(null); setNote(''); setError(''); setOpen(true) }}><Flag size={13} />{label}</Button>
      <Modal open={open} onOpenChange={setOpen} title={t('Скарга')} description={t('Що не так? Модератори побачать скаргу й твій коментар.')}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t('Скасувати')}</Button><Button variant="destructive" loading={busy} onClick={send}><Flag size={14} />{t('Надіслати скаргу')}</Button></>}>
        <div className="grid gap-3">
          <div className={CHOICES}>
            {REASONS.map((r) => (
              <Choice key={r} on={reason === r} onClick={() => setReason(r)} className={r === 'rmt' ? 'border-bad/40' : undefined}>
                <span className="text-[13.5px] font-semibold">{REASON_LABEL[r]}</span>
                <span className="text-[12px] leading-snug text-muted">{REASON_HINT[r]}</span>
              </Choice>
            ))}
          </div>
          <SnTextarea size="lg" rows={3} maxLength={500} modelValue={note} placeholder={t('Коротко: що сталося')} accessibilityLabel={t('Коментар до скарги')} onInput={(e: Event) => setNote(valueOf(e))} />
          {error && <ErrorAlert message={error} />}
        </div>
      </Modal>
    </>
  )
}

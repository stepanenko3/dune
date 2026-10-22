/**
 * Незбережені правки, які вже не записати в цю базу (людину вигнали з гільдії, доступ змінили, базу стерли, чи
 * чернетка не вмістилась у пам'ять браузера): зберегти їх як свою нову базу або вивантажити файлом — його можна
 * імпортувати на сторінці «Бази».
 */
import { useState } from 'react'
import { Download, Save } from 'lucide-react'
import { toast } from 'sonner'
import { createBase, type BaseDoc } from '@/lib/bases'
import { t } from '@/lib/i18n'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { dropDraft } from './store'

/** файл чернетки — той самий формат, що й «Вивантажити» бази (імпорт його прийме) */
export function downloadDraft(id: string, doc: BaseDoc) {
  const file = { format: 'sandwalkers-base/1', name: doc.ui?.name || '', id, version: 0, exportedAt: new Date().toISOString(), site: { name: 'Sandwalkers', url: location.origin }, doc }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }))
  a.download = `${id}-draft.json`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

export function DraftRescue({ id, doc, reason, canSave = true }: { id: string; doc: BaseDoc; reason: string; canSave?: boolean }) {
  const [busy, setBusy] = useState(false)
  const saveAsMine = async () => {
    setBusy(true)
    try {
      const name = `${doc.ui?.name || t('База')} — ${t('моя копія')}`.slice(0, 80)
      // примітка — службова, українською (мовою людини її показує сторінка версій)
      const b = await createBase({ ...doc, ui: { ...(doc.ui || {}), name } }, 'Копія чернетки')
      dropDraft(id)
      toast.success(t('Збережено як твою базу «{name}»', { name }))
      useStore.getState().setView('bases', { base: b.id, edit: true })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div role="alert" className="grid gap-2 rounded-xl border border-warn/50 bg-warn/10 px-4 py-3 text-[13.5px]">
      <p className="font-semibold">{reason}</p>
      <p className="text-muted">{t('Твої незбережені правки ще тут — збережи їх як свою базу або вивантаж файлом (його можна імпортувати на сторінці «Бази»).')}</p>
      <div className="flex flex-wrap gap-2">
        {canSave && <Button loading={busy} onClick={saveAsMine}><Save size={15} />{t('Зберегти як мою базу')}</Button>}
        <Button variant="secondary" onClick={() => downloadDraft(id, doc)}><Download size={15} />{t('Вивантажити чернетку')}</Button>
      </div>
    </div>
  )
}

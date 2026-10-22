/**
 * Дії панелі: підтвердження (sn-alert-dialog) і дії з полями (sn-dialog з формою). runAction — спільний запуск:
 * питає, що треба, шле на сервер, показує результат.
 */
import { useState } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { SnAlertDialog, SnButton } from '@/components/sn'
import { Modal } from '@/components/ui/modal'
import { t } from '@/lib/i18n'
import { plural } from '@/lib/utils'
import { adminApi, goAdmin, type Action, type Resource } from './api'
import { FieldInput, FieldShell } from './fields'

interface Ask { title: string; description?: string; destructive?: boolean; confirm: string; resolve: (ok: boolean) => void }
interface Form { action: Action; resolve: (v: Record<string, unknown> | null) => void }
const useAsk = create<{ ask: Ask | null; form: Form | null }>(() => ({ ask: null, form: null }))

/** «Точно?» — true, якщо підтвердили */
export const confirmAsk = (title: string, opts: { description?: string; destructive?: boolean; confirm?: string } = {}) =>
  new Promise<boolean>((resolve) => useAsk.setState({ ask: { title, description: opts.description, destructive: opts.destructive, confirm: opts.confirm ?? t('Так'), resolve } }))

const askForm = (action: Action) => new Promise<Record<string, unknown> | null>((resolve) => useAsk.setState({ form: { action, resolve } }))

/** запустити дію розділу для вибраних записів; true — виконано */
export async function runAction(r: Resource, a: Action, ids: string[]): Promise<boolean> {
  let input: Record<string, unknown> = {}
  if (a.fields?.length) {
    const v = await askForm(a)
    if (!v) return false
    input = v
  } else if (a.confirm && !(await confirmAsk(ids.length > 1 ? t('{action}: вибрано {n}', { action: t(a.label), n: ids.length }) : t(a.label), { description: t(a.confirm), destructive: a.tone === 'critical' }))) return false
  try {
    const res = await adminApi.action(r.name, a.key, ids, input)
    toast.success(res.message ? t(res.message) : ids.length > 1 ? t('{action}: виконано для {n}', { action: t(a.label), n: ids.length }) : t('{action}: виконано', { action: t(a.label) }))
    // дія створила запис (копію) — одразу його відкриваємо
    if (res.open?.length) goAdmin(res.open)
    return true
  } catch (e) {
    toast.error((e as Error).message)
    return false
  }
}

/** видалити записи після підтвердження; true — видалено */
export async function removeRows(r: Resource, ids: string[]): Promise<boolean> {
  const ok = await confirmAsk(ids.length > 1 ? t('Видалити {what}?', { what: plural(ids.length, [t('запис'), t('записи'), t('записів')]) }) : t('Видалити запис?'), {
    // що ще зникне разом із записом — у кожного розділу своє
    description: r.removeNote ? `${t('Це назавжди.')} ${t(r.removeNote)}` : t('Це назавжди.'), destructive: true, confirm: t('Видалити'),
  })
  if (!ok) return false
  try {
    const res = await adminApi.remove(r.name, ids)
    toast.success(t('Видалено: {n}', { n: res.removed }))
    return true
  } catch (e) {
    toast.error((e as Error).message)
    return false
  }
}

/** вікна підтвердження й форм дій — один раз у панелі */
export function ActionHost() {
  const { ask, form } = useAsk()
  return (
    <>
      <SnAlertDialog
        open={!!ask}
        title={ask?.title ?? ''}
        description={ask?.description}
        confirmLabel={ask?.confirm ?? t('Так')}
        cancelLabel={t('Скасувати')}
        destructive={!!ask?.destructive}
        onConfirm={() => { ask?.resolve(true); useAsk.setState({ ask: null }) }}
        onCancel={() => { ask?.resolve(false); useAsk.setState({ ask: null }) }}
        onOpenChange={(e: CustomEvent<{ open: boolean }>) => { if (!e.detail.open && useAsk.getState().ask) { ask?.resolve(false); useAsk.setState({ ask: null }) } }}
      />
      {form && <ActionForm form={form} />}
    </>
  )
}

function ActionForm({ form }: { form: Form }) {
  const [v, setV] = useState<Record<string, unknown>>({})
  const [tried, setTried] = useState(false)
  const a = form.action
  // обов'язкові поля — до відправки (сервер теж перевіряє)
  const missing = (a.fields || []).filter((f) => f.required && (v[f.key] == null || v[f.key] === ''))
  const close = (out: Record<string, unknown> | null) => {
    if (out && missing.length) { setTried(true); return }
    form.resolve(out); useAsk.setState({ form: null })
  }
  return (
    <Modal open onOpenChange={(o) => !o && close(null)} title={t(a.label)} description={a.confirm ? t(a.confirm) : undefined} size="sm"
      footer={
        <>
          <SnButton variant="ghost" onClick={() => close(null)}>{t('Скасувати')}</SnButton>
          <SnButton variant={a.tone === 'critical' ? 'destructive' : 'primary'} onClick={() => close(v)}>{t(a.label)}</SnButton>
        </>
      }>
      <form className="grid gap-3.5" onSubmit={(e) => { e.preventDefault(); close(v) }}>
        {(a.fields || []).map((f) => (
          <FieldShell key={f.key} f={f} error={tried && missing.includes(f) ? t('Заповни це поле') : undefined}>
            <FieldInput f={f} value={v[f.key]} onChange={(x) => setV((o) => ({ ...o, [f.key]: x }))} />
          </FieldShell>
        ))}
      </form>
    </Modal>
  )
}

/**
 * Підтвердження одним вікном на весь сайт — sn-alert-dialog з @snotax/ui: confirmAsk({ title, … }) повертає обіцянку
 * «так / ні», а ConfirmHost (раз у App) малює саме вікно. Для дій, після яких сторінка кудись перейде чи щось
 * зміниться, — копіювати, піти з незбереженими змінами.
 */
import { create } from 'zustand'
import { t } from '@/lib/i18n'
import { SnAlertDialog } from '@/components/sn'

interface Ask { title: string; description?: string; confirm?: string; destructive?: boolean; resolve: (ok: boolean) => void }
const useAsk = create<{ ask: Ask | null }>(() => ({ ask: null }))

/** спитати; ще відкрите попереднє питання вважаємо скасованим */
export function confirmAsk(a: Omit<Ask, 'resolve'>): Promise<boolean> {
  useAsk.getState().ask?.resolve(false)
  return new Promise((resolve) => useAsk.setState({ ask: { ...a, resolve } }))
}

export function ConfirmHost() {
  const ask = useAsk((s) => s.ask)
  const done = (ok: boolean) => { const a = useAsk.getState().ask; if (!a) return; useAsk.setState({ ask: null }); a.resolve(ok) }
  return (
    <SnAlertDialog
      open={!!ask}
      title={ask?.title ?? ''}
      description={ask?.description}
      confirmLabel={ask?.confirm ?? t('Так')}
      cancelLabel={t('Скасувати')}
      destructive={!!ask?.destructive}
      onConfirm={() => done(true)}
      onCancel={() => done(false)}
      onOpenChange={(e: CustomEvent<{ open: boolean }>) => { if (!e.detail.open) done(false) }}
    />
  )
}

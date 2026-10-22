/**
 * Висувна панель вузького екрана (знизу). На широкому — звичайна колонка (.sheet-lg у index.css).
 */
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useStore } from '@/store'
import { t } from '@/lib/i18n'

export const SHEET_BASE =
  'sheet fixed inset-x-0 bottom-0 z-[960] h-[78dvh] w-full rounded-t-2xl border-t border-line bg-panel shadow-2xl transition-transform duration-200'

export function SheetBackdrop({ open, className }: { open: boolean; className: string }) {
  return open ? <div className={`fixed inset-0 z-[950] bg-black/50 ${className}`} onClick={() => useStore.getState().setSheet(null)} /> : null
}

export function SheetHead({ title, className, aside }: { title: string; className: string; aside?: ReactNode }) {
  return (
    <div className={`relative flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 ${className}`}>
      <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-display text-[12px] font-semibold uppercase tracking-wide">{title}</span>
      {aside}
      <button
        onClick={() => useStore.getState().setSheet(null)}
        aria-label={t('Закрити')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line text-muted transition-colors hover:text-ink"
      >
        <X size={15} />
      </button>
    </div>
  )
}

/**
 * Вікно поверх сторінки — sn-dialog з @snotax/ui (рідний <dialog>: фокус усередині, Esc, клік повз і хрестик —
 * закрити) у складеному режимі: заголовок, опис і підвал — наші (вбудований підвал діалогу має лише англійське «Close»).
 */
import type { ReactNode } from 'react'
import { SnDialog, SnDialogContent, SnDialogDescription, SnDialogFooter, SnDialogHeader, SnDialogTitle } from '@/components/sn'

export function Modal({ open, onOpenChange, title, description, children, footer, className, size = 'md' }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  /** кнопки внизу (у смузі підвалу) */
  footer?: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <SnDialog open={open} size={size} onOpenChange={(e: CustomEvent<{ open: boolean }>) => { if (!e.detail.open) onOpenChange(false) }}>
      <SnDialogContent scrollable>
        <SnDialogHeader>
          <SnDialogTitle>{title}</SnDialogTitle>
          {description && <SnDialogDescription>{description}</SnDialogDescription>}
        </SnDialogHeader>
        {/* вміст монтуємо лише відкритим: форми всередині щоразу починають з чистого стану */}
        {/* page-theme: вікно світле (чи темне) як сайт, навіть поверх сторінки зі своєю палітрою (уміння) */}
        {open && <div className={className ? `page-theme ${className}` : 'page-theme'}>{children}</div>}
        {open && footer && <SnDialogFooter>{footer}</SnDialogFooter>}
      </SnDialogContent>
    </SnDialog>
  )
}

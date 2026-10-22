/**
 * Стани сторінок і блоків — однаково по всьому сайту, на компонентах @snotax/ui:
 *   • Loading — завантаження: спінер із підписом (сторінка) чи скелетон (блок);
 *   • Empty — порожньо (sn-empty-state): іконка, заголовок, пояснення, дії;
 *   • PageError — помилка на всю сторінку чи блок (той самий sn-empty-state, з кнопкою «Спробувати ще»);
 *   • ErrorAlert — помилка в формі чи над списком (sn-alert, червона).
 */
import type { ReactNode } from 'react'
import { CircleAlert, RotateCcw, type LucideIcon } from 'lucide-react'
import {
  SnAlert, SnAlertDescription, SnAlertTitle, SnButton, SnEmptyState, SnEmptyStateContent, SnEmptyStateDescription, SnEmptyStateHeader,
  SnEmptyStateMedia, SnEmptyStateTitle, SnSkeleton,
} from '@/components/sn'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { DuneLoader } from '@/components/ui/dune-loader'

/** завантаження: page — на всю сторінку (по центру), інакше — рядок у блоці; lines — скелетон замість спінера */
export function Loading({ label, page, lines, className }: { label?: string; page?: boolean; lines?: number; className?: string }) {
  if (lines) return <div className={cn('grid gap-2', className)} aria-busy="true"><SnSkeleton lines={lines} /></div>
  return (
    <div className={cn(page ? 'grid flex-1 place-items-center p-6' : 'flex items-center justify-center gap-2 py-6', className)} aria-busy="true" role="status">
      <div className={cn('flex items-center gap-2.5 text-[13.5px] text-muted', page && 'flex-col gap-3')}>
        {/* індикатор у стилі Дюни — живе лого (components/ui/dune-loader) */}
        <DuneLoader size={page ? 56 : 26} label={label || t('Завантаження…')} />
        <span>{label || t('Завантаження…')}</span>
      </div>
    </div>
  )
}

/** порожньо: заголовок, пояснення, дії (кнопки) */
export function Empty({ icon: Icon, title, description, children, className, framed = true }: {
  icon?: LucideIcon; title: string; description?: ReactNode; children?: ReactNode; className?: string; framed?: boolean
}) {
  return (
    <SnEmptyState variant={framed ? 'outlined' : 'plain'} className={cn('block', className)}>
      <SnEmptyStateHeader>
        {Icon && <SnEmptyStateMedia><Icon size={22} /></SnEmptyStateMedia>}
        <SnEmptyStateTitle>{title}</SnEmptyStateTitle>
        {description && <SnEmptyStateDescription>{description}</SnEmptyStateDescription>}
      </SnEmptyStateHeader>
      {children && <SnEmptyStateContent><div className="flex flex-wrap items-center justify-center gap-2">{children}</div></SnEmptyStateContent>}
    </SnEmptyState>
  )
}

/** помилка на всю сторінку чи блок: що сталось і що робити; onRetry — кнопка «Спробувати ще» */
export function PageError({ title, message, onRetry, page, className, children }: { title?: string; message?: string; onRetry?: () => void; page?: boolean; className?: string; children?: ReactNode }) {
  const body = (
    <Empty icon={CircleAlert} title={title || t('Не вдалося завантажити')} description={message || t('Онови сторінку трохи згодом.')} className={className}>
      {onRetry && <SnButton variant="outline" onClick={onRetry}><RotateCcw size={14} />{t('Спробувати ще')}</SnButton>}
      {children}
    </Empty>
  )
  return page ? <div className="grid flex-1 place-items-center p-4"><div className="w-full max-w-[560px]">{body}</div></div> : body
}

/** помилка в формі чи над списком */
export function ErrorAlert({ title, message, className, children }: { title?: string; message: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <SnAlert variant="destructive" appearance="soft" role="alert" className={cn('block', className)}>
      {title && <SnAlertTitle>{title}</SnAlertTitle>}
      <SnAlertDescription>{message}</SnAlertDescription>
      {children}
    </SnAlert>
  )
}

/**
 * Шапка сторінки — однакова на всіх сторінках сайту (заголовок не «стрибає» при переході між розділами): та сама
 * картка, той самий розмір і висота заголовка, вступ, дії праворуч, під ними — довільний рядок (вкладки, фільтри).
 * Сторінки-інструменти на всю ширину (довідник, мапа, уміння) мають компактну шапку — compact.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageHeader({ title, badges, lead, actions, meta, children, compact, className }: {
  title: ReactNode
  /** у рядку з назвою, після неї: доступ, власник */
  badges?: ReactNode
  /** вступ під заголовком */
  lead?: ReactNode
  /** кнопки праворуч */
  actions?: ReactNode
  /** над заголовком: значки доступу, власник, «назад» */
  meta?: ReactNode
  /** під заголовком на всю ширину: вкладки, фільтри, факти */
  children?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <header className={cn('grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sm', compact && 'gap-2 py-2.5', className)}>
      {meta && <div className="flex min-w-0 flex-wrap items-center gap-2">{meta}</div>}
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-full">
          {badges ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className={cn('min-h-[1.2em] min-w-0 break-words font-display font-bold leading-tight tracking-[-0.01em]', compact ? 'text-[18px]' : 'text-[clamp(20px,2.4vw,28px)]')}>{title}</h1>
              {badges}
            </div>
          ) : (
            <h1 className={cn('min-h-[1.2em] break-words font-display font-bold leading-tight tracking-[-0.01em]', compact ? 'text-[18px]' : 'text-[clamp(20px,2.4vw,28px)]')}>{title}</h1>
          )}
          {lead && <div className="mt-1 max-w-[75ch] text-[14px] leading-snug text-muted">{lead}</div>}
        </div>
        {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  )
}

/** Дрібні спільні шматки сторінок панелі: шапка сторінки (крихти над нею малює AdminApp), картка-секція. */
import type { ReactNode } from 'react'
import { SnCard, SnCardContent, SnCardDescription, SnCardHeader, SnCardTitle, SnCardAction } from '@/components/sn'

export function PageHeader({ title, about, actions }: { title: ReactNode; about?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      {/* опис не стискається в стовпчик біля кнопок: вужче за 20rem — кнопки переходять у рядок нижче */}
      <div className="min-w-[min(100%,20rem)] max-w-full flex-1">
        <h1 className="line-clamp-2 break-words font-display text-[clamp(19px,2.4vw,26px)] font-bold leading-tight [overflow-wrap:anywhere]" title={typeof title === 'string' ? title : undefined}>{title}</h1>
        {about && <p className="mt-1 max-w-[80ch] text-[13.5px] leading-snug text-muted">{about}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Panel({ title, description, action, children, className }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <SnCard className={className}>
      {(title || action) && (
        <SnCardHeader>
          {title && <SnCardTitle>{title}</SnCardTitle>}
          {description && <SnCardDescription>{description}</SnCardDescription>}
          {action && <SnCardAction>{action}</SnCardAction>}
        </SnCardHeader>
      )}
      <SnCardContent>{children}</SnCardContent>
    </SnCard>
  )
}

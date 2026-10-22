import type { ReactNode } from 'react'
import { t } from '@/lib/i18n'
import { PageHeader } from '@/components/PageHeader'

/**
 * Шапка сторінки бази — спільна шапка сайту (PageHeader), щільніша: назва зі значком версії, поруч — доступ і власник (шлях —
 * у хлібних крихтах), вступ, усі дії праворуч одним рядком; під ними — ключові цифри (факти — HTML із <b>, очищений сервером).
 */
export function PageHead({ title, badges, lead, facts, actions, meta }: { title: ReactNode; badges?: ReactNode; lead: string; facts: string[]; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <PageHeader title={title} badges={badges} lead={lead || undefined} actions={actions} meta={meta} className="gap-2 py-3">
      {facts.length > 0 && (
        <ul className="flex flex-wrap gap-x-[18px] gap-y-1.5 font-mono text-[13px] font-medium tabular-nums text-muted [&_b]:font-semibold [&_b]:text-ink" aria-label={t('Основні цифри')}>
          {facts.map((f, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: f }} />
          ))}
        </ul>
      )}
    </PageHeader>
  )
}

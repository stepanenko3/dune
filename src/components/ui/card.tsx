/**
 * Два рівні поверхонь, як у Satisfactory: панелі верхнього рівня (шапка, колонки, мапа) —
 * rounded-xl + shadow-lg прямо на фоні; блоки всередині прокрутки — Card (shadow-sm).
 */
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-line bg-panel p-3.5 shadow-sm', className)} {...rest}>
      {children}
    </section>
  )
}

export function SectionTitle({ className, children, aside }: { className?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className={cn('mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}>
      <h2 className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{children}</h2>
      {aside && <div className="ml-auto flex items-center gap-1.5">{aside}</div>}
    </div>
  )
}

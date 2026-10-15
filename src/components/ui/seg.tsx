/** Сегментований перемикач: рівні плану, камери 3D, регіони — одна форма на всі. */
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export function Seg<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  items: { id: T; label: ReactNode; tip?: string }[]
  label: string
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex max-w-full overflow-x-auto rounded-lg border border-line/80 bg-panel2/60 p-0.5', className)}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={it.id === value}
          data-tip={it.tip}
          onClick={() => onChange(it.id)}
          className={cn(
            'whitespace-nowrap rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2 py-1 text-[11.5px]' : 'px-2.5 py-1.5 text-[12.5px]',
            it.id === value ? 'bg-panel text-spice shadow-sm dark:bg-bg' : 'text-muted hover:text-ink',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

/** Прапорець рядком: «Підписи», «Координати»… */
export function Check({ checked, onChange, children, className }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; className?: string }) {
  return (
    <label className={cn('inline-flex cursor-pointer select-none items-center gap-1.5 text-[12.5px] text-muted hover:text-ink', className)}>
      <input type="checkbox" className="h-3.5 w-3.5 accent-[rgb(var(--c-spice))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  )
}

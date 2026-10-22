/** Сегментований перемикач: рівні плану, камери 3D, регіони — одна форма на всі. Не влазить у ширину (телефон) — кнопки
 * переносяться в наступний рядок, а не ховаються за непомітною прокруткою. */
import { cn } from '@/lib/utils'
import { plainClick } from '@/lib/urlState'
import type { KeyboardEvent, ReactNode } from 'react'

/**
 * href — вкладка зі своєю адресою: кнопки стають посиланнями (відкрити в новій вкладці, переслати), звичайний клік
 * перемикає без перезавантаження (onChange сам пише адресу — useUrlParam).
 */
export function Seg<T extends string>({
  value,
  onChange,
  items,
  label,
  className,
  size = 'md',
  href,
}: {
  value: T
  onChange: (v: T) => void
  items: { id: T; label: ReactNode; tip?: string }[]
  label: string
  className?: string
  size?: 'sm' | 'md'
  href?: (v: T) => string
}) {
  const cls = (on: boolean) => cn(
    'whitespace-nowrap rounded-md font-medium transition-colors',
    // на сенсорному екрані — вищі кнопки: у 24 px пальцем не влучити
    size === 'sm' ? 'px-2 py-1 text-[11.5px] [@media(pointer:coarse)]:py-2' : 'px-2.5 py-1.5 text-[12.5px] [@media(pointer:coarse)]:py-2',
    on ? 'bg-panel text-spice shadow-sm dark:bg-bg' : 'text-muted hover:text-ink',
  )
  // вкладки: у порядку Tab — лише обрана, між іншими — стрілки (як у звичайних вкладках)
  const arrows = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0
    if (!d) return
    e.preventDefault()
    const box = e.currentTarget as HTMLElement
    const i = items.findIndex((it) => it.id === value)
    const n = d === -Infinity ? 0 : d === Infinity ? items.length - 1 : (i + d + items.length) % items.length
    if (items[n].id !== value) onChange(items[n].id)
    setTimeout(() => box.querySelectorAll<HTMLElement>('[role="tab"]')[n]?.focus())
  }
  return (
    <div role={href ? 'tablist' : 'group'} onKeyDown={href ? arrows : undefined} aria-label={label} className={cn('inline-flex max-w-full flex-wrap justify-self-start rounded-lg border border-line/80 bg-panel2/60 p-0.5', className)}>
      {items.map((it) => href ? (
        <a
          key={it.id}
          href={href(it.id)}
          role="tab"
          aria-selected={it.id === value}
          tabIndex={it.id === value ? 0 : -1}
          data-tip={it.tip}
          // вибране вже — нічого не міняємо (інакше сторінка скидала б стан, а нового запиту не було б)
          onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); if (it.id !== value) onChange(it.id) }}
          className={cls(it.id === value)}
        >
          {it.label}
        </a>
      ) : (
        <button
          key={it.id}
          type="button"
          aria-pressed={it.id === value}
          data-tip={it.tip}
          onClick={() => { if (it.id !== value) onChange(it.id) }}
          className={cls(it.id === value)}
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

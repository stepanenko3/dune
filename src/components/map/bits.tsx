/** Дрібниці панелі мапи: іконка зі спрайта TH.GL, згортаний розділ, рядок типу. */
import { useState, type ReactNode } from 'react'
import { ChevronRight, Eye, EyeOff } from 'lucide-react'
import { prefGet, prefSet } from '@/lib/prefs'
import { cn, fmtN } from '@/lib/utils'

export const SPRITE = '/api/map/icons.webp'

export function SpriteIcon({ icon, px = 18, dims, className }: { icon: [number, number, number, number] | null; px?: number; dims: [number, number] | null; className?: string }) {
  if (!icon || !dims) return <span className={cn('inline-block shrink-0 rounded-sm bg-line', className)} style={{ width: px, height: px }} />
  const [x, y, w] = icon
  const k = px / w
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0', className)}
      style={{
        width: px,
        height: px,
        backgroundImage: `url(${SPRITE})`,
        backgroundPosition: `${-x * k}px ${-y * k}px`,
        backgroundSize: `${dims[0] * k}px ${dims[1] * k}px`,
      }}
    />
  )
}

/** Розділ панелі: <details>, стан згортання запам'ятовується; праворуч — «показати / сховати все». */
export function Section({
  id,
  title,
  count,
  defaultOpen = true,
  onAll,
  allOn,
  children,
}: {
  id: string
  title: ReactNode
  count?: ReactNode
  defaultOpen?: boolean
  onAll?: (on: boolean) => void
  allOn?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => prefGet<Record<string, boolean>>('map:sections', {})[id] ?? defaultOpen)
  return (
    <details
      open={open}
      onToggle={(e) => {
        const on = (e.currentTarget as HTMLDetailsElement).open
        // браузер шле toggle і при монтуванні — не перезаписуємо той самий стан
        if (on === open) return
        setOpen(on)
        prefSet('map:sections', { ...prefGet<Record<string, boolean>>('map:sections', {}), [id]: on })
      }}
      className="group border-t border-line first:border-t-0"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={13} className="shrink-0 text-muted transition-transform group-open:rotate-90" />
        <span className="min-w-0 flex-1 truncate font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</span>
        {count != null && <span className="font-mono text-[10px] text-muted">{count}</span>}
        {onAll && (
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-panel2 hover:text-ink"
            data-tip={allOn ? 'Сховати все' : 'Показати все'}
            aria-label={allOn ? 'Сховати все' : 'Показати все'}
            onClick={(e) => { e.preventDefault(); onAll(!allOn) }}
          >
            {allOn ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
      </summary>
      <div className="px-2 pb-2">{children}</div>
    </details>
  )
}

export function TypeRow({
  icon,
  dims,
  label,
  count,
  on,
  onToggle,
  ring,
}: {
  icon: [number, number, number, number] | null
  dims: [number, number] | null
  label: string
  count: number
  on: boolean
  onToggle: () => void
  ring?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-panel2',
        on ? 'text-ink' : 'text-muted',
      )}
    >
      <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border', on ? 'border-spice bg-spice text-on-spice' : 'border-line')}>
        {on && <svg viewBox="0 0 10 10" className="h-2.5 w-2.5"><path d="M2 5.2 4.1 7.3 8 2.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      <SpriteIcon icon={icon} dims={dims} px={18} className={on ? '' : 'opacity-60'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {ring && <span className="h-2 w-2 shrink-0 rounded-full bg-spice" data-tip="Підсвічено для вибраного ресурсу" />}
      <span className="font-mono text-[10.5px] tabular-nums text-muted">{fmtN(count)}</span>
    </button>
  )
}

/**
 * Перемикач «увімкнено / вимкнено» — sn-toggle з @snotax/ui: увімкнений має рамку, тло й текст кольору спайсу, тож
 * стан видно одразу (а не лише трохи темнішим тлом звичайної кнопки). Для дій (зберегти, скасувати) — Button.
 */
import type { ReactNode } from 'react'
import { SnToggle } from '@/components/sn'
import { cn } from '@/lib/utils'

export function Toggle({ pressed, onPressedChange, children, size = 'sm', disabled, title, className, ...aria }: {
  pressed: boolean
  onPressedChange: (v: boolean) => void
  children: ReactNode
  size?: 'sm' | 'default'
  disabled?: boolean
  title?: string
  className?: string
  'aria-label'?: string
  'data-tip'?: string
}) {
  return (
    <SnToggle
      variant="outline"
      size={size}
      pressed={pressed}
      disabled={!!disabled}
      title={title}
      className={cn('shrink-0', className)}
      {...aria}
      onPressedChange={(e: CustomEvent<{ pressed: boolean }>) => onPressedChange(e.detail.pressed)}
    >
      {children}
    </SnToggle>
  )
}

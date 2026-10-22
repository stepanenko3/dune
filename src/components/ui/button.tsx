/**
 * Кнопка сайту — sn-button з @snotax/ui. Назви варіантів і розмірів — ті самі, що були (default/secondary/ghost/
 * destructive/outline; default/sm/icon/xs), тож сторінки їх не міняли. Іконки lucide — дітьми, як і раніше.
 */
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'
import { SnButton } from '@/components/sn'

const VARIANT = { default: 'primary', secondary: 'secondary', ghost: 'ghost', destructive: 'destructive', outline: 'outline', link: 'link' } as const
const SIZE = { default: 'lg', sm: 'default', icon: 'icon', xs: 'xs', lg: 'lg' } as const

export interface ButtonProps {
  variant?: keyof typeof VARIANT | null
  size?: keyof typeof SIZE | null
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  loading?: boolean
  href?: string
  className?: string
  style?: CSSProperties
  title?: string
  children?: ReactNode
  onClick?: MouseEventHandler<HTMLElement>
  'aria-label'?: string
  'aria-pressed'?: boolean
  'data-tip'?: string
}

export function Button({ variant, size, type = 'button', disabled, loading, href, className, style, title, children, onClick, ...aria }: ButtonProps) {
  return (
    <SnButton
      variant={VARIANT[variant ?? 'default']}
      size={SIZE[size ?? 'default']}
      type={type}
      disabled={!!disabled}
      loading={!!loading}
      href={href}
      className={className}
      style={style}
      title={title}
      onClick={disabled || loading ? undefined : onClick}
      accessibilityLabel={aria['aria-label']}
      {...(aria['aria-pressed'] != null ? { 'aria-pressed': String(aria['aria-pressed']) } : {})}
      {...(aria['data-tip'] ? { 'data-tip': aria['data-tip'] } : {})}
    >
      {children}
    </SnButton>
  )
}

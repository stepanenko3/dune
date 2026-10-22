/**
 * Меню-дропдаун на sn-dropdown-menu (@snotax/ui): кнопка-тригер і пункти — дії (onSelect), посилання (href) чи вибір
 * одного з кількох (radio). Один вигляд на весь сайт: тема в шапці, дії планувальника вмінь, дії з білдом…
 */
import type { ReactNode } from 'react'
import { Check, ChevronDown, MoreHorizontal } from 'lucide-react'
import { SnDropdownMenu, SnDropdownMenuContent, SnDropdownMenuItem, SnDropdownMenuLabel, SnDropdownMenuSeparator, SnDropdownMenuTrigger } from '@/components/sn'
import { cn } from '@/lib/utils'
import { openPath } from '@/store'
import { t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

/** кнопка меню дій — однакова на всіх сторінках: «··· Дії ⌄» */
export function ActionsTrigger({ label }: { label?: string }) {
  return <Button variant="secondary" size="sm" aria-label={label ?? t('Дії')}><MoreHorizontal size={15} />{label ?? t('Дії')}<ChevronDown size={14} className="opacity-70" /></Button>
}

export type MenuEntry =
  | { kind?: 'item'; label: ReactNode; icon?: ReactNode; onSelect?: () => void; href?: string; danger?: boolean; checked?: boolean; disabled?: boolean; hint?: ReactNode }
  | { kind: 'separator' }
  | { kind: 'label'; label: ReactNode }

export function Menu({ trigger, items, align = 'end', className }: { trigger: ReactNode; items: MenuEntry[]; align?: 'start' | 'end'; className?: string }) {
  return (
    <SnDropdownMenu className={cn('relative shrink-0', className)}>
      <SnDropdownMenuTrigger>{trigger}</SnDropdownMenuTrigger>
      <SnDropdownMenuContent align={align} className="min-w-[13rem]">
        {items.map((it, i) => {
          if (it.kind === 'separator') return <SnDropdownMenuSeparator key={i} />
          if (it.kind === 'label') return <SnDropdownMenuLabel key={i}>{it.label}</SnDropdownMenuLabel>
          const body = (
            <span className={cn('flex w-full items-center gap-2 text-[13.5px]', it.danger && 'text-bad')}>
              <span className="flex w-4 shrink-0 justify-center">{it.icon}</span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.hint && <span className="shrink-0 text-[12px] text-muted">{it.hint}</span>}
              {it.checked && <Check size={14} className="shrink-0 text-spice" />}
            </span>
          )
          return (
            <SnDropdownMenuItem
              key={i}
              // disabled — лише коли справді вимкнено: будь-яке значення (навіть undefined) пункт вважає вимкненим
              {...(it.disabled ? { disabled: true } : {})}
              onSelect={() => { if (it.href) openPath(it.href); else it.onSelect?.() }}
            >
              {body}
            </SnDropdownMenuItem>
          )
        })}
      </SnDropdownMenuContent>
    </SnDropdownMenu>
  )
}

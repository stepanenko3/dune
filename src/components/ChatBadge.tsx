/**
 * Значок розмов у шапці: кількість непрочитаних (особисті й угоди; гільдійська й «без звуку» не рахуються), клік — до
 * розмов. Без входу значка нема. Лічильник оновлює з'єднання розмов (lib/chat).
 */
import { MessagesSquare } from 'lucide-react'
import { useChatState } from '@/lib/chat'
import { useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { plainClick } from '@/lib/urlState'
import { openPath, useStore } from '@/store'

export function ChatBadge({ pill }: { pill: string }) {
  const user = useAuth((s) => s.user)
  const unread = useChatState((s) => s.unread)
  const on = useStore((s) => s.view === 'chats')
  if (!user) return null
  return (
    <a href="/chats" onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); openPath('/chats') }} aria-current={on ? 'page' : undefined}
      aria-label={unread ? t('Розмови: непрочитаних {n}', { n: unread }) : t('Розмови')} data-tip={t('Розмови')} className={cn(pill, 'relative w-10 shrink-0 justify-center px-0', on && 'text-spice')}>
      <MessagesSquare size={17} className={unread || on ? 'text-spice' : 'text-muted'} />
      {unread > 0 && <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-spice px-1 text-[10.5px] font-bold leading-none text-on-spice">{unread > 99 ? '99+' : unread}</span>}
    </a>
  )
}

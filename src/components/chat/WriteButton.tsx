/**
 * «Написати» — особиста розмова з людиною (є — та сама, нема — нова) і одразу до неї. Без входу — спершу вхід.
 */
import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { openDirect } from '@/lib/chat'
import { loginHref, useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { openPath } from '@/store'
import { Button } from '@/components/ui/button'

export function WriteButton({ user, label = t('Написати'), variant = 'secondary', size }: { user: string; label?: string; variant?: 'secondary' | 'default' | 'ghost'; size?: 'sm' }) {
  const me = useAuth((s) => s.user)
  const [busy, setBusy] = useState(false)
  if (me?.id === user) return null
  const go = async () => {
    if (!me) { openPath(loginHref()); return }
    setBusy(true)
    try { openPath(`/chats/${(await openDirect(user)).id}`) } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return <Button variant={variant} size={size} loading={busy} onClick={go}><MessageSquare size={15} />{label}</Button>
}

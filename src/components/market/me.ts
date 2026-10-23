/**
 * Біржа «для мене»: останні регіон / світ / сервер / нік (для нового оголошення), заборона, підказки світів, чи я
 * модератор. Читається раз на людину (змінилась людина — знову); refreshMarketMe — після нового оголошення.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { marketMe, type MarketMe } from '@/lib/market'
import { useAuth } from '@/lib/auth'

const useMe = create<{ me: MarketMe | null; who: string | null | undefined }>(() => ({ me: null, who: undefined }))

export function refreshMarketMe() {
  const who = useAuth.getState().user?.id ?? null
  marketMe().then((me) => useMe.setState({ me, who }), () => {})
}

export function useMarketMe(): MarketMe | null {
  const ready = useAuth((s) => s.ready)
  const uid = useAuth((s) => s.user?.id ?? null)
  const { me, who } = useMe()
  useEffect(() => {
    if (!ready || who === uid) return
    useMe.setState({ who: uid, me: null })
    refreshMarketMe()
  }, [ready, uid, who])
  return who === uid ? me : null
}

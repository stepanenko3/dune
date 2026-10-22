/**
 * Смуга завантаження вгорі сторінки, як nprogress: тонка смужка спайсу наростає зліва направо, поки щось вантажиться
 * (lib/busy); закінчилось — добігає до краю й тане. З'являється за 80 мс і тримається щонайменше 600 мс, щоб її встигли
 * побачити (а миттєве — не блимало). Сам індикатор у стилі Дюни — components/ui/dune-loader (лого в шапці теж він).
 */
import { useEffect, useRef, useState } from 'react'
import { useBusyStore } from '@/lib/busy'
import { t } from '@/lib/i18n'

export function TopLoader() {
  const n = useBusyStore((s) => s.n)
  const [w, setW] = useState(0)
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null)
  const since = useRef(0)
  useEffect(() => {
    if (n > 0) {
      if (shown || timer.current) return
      timer.current = setTimeout(() => {
        timer.current = null
        since.current = Date.now()
        setShown(true)
        setW(8)
        // наближаємось до 90 %, але не доходимо, доки не закінчиться
        trickle.current = setInterval(() => setW((x) => x + (90 - x) * 0.08), 200)
      }, 80)
      return
    }
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (!shown) return
    if (trickle.current) { clearInterval(trickle.current); trickle.current = null }
    // показали — тримаємо щонайменше 600 мс, тоді добігає до краю й тане
    const wait = Math.max(0, 600 - (Date.now() - since.current))
    const h1 = setTimeout(() => setW(100), wait)
    const h2 = setTimeout(() => { setShown(false); setW(0) }, wait + 450)
    return () => { clearTimeout(h1); clearTimeout(h2) }
  }, [n, shown])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (trickle.current) clearInterval(trickle.current) }, [])
  return (
    <div
      className="top-loader pointer-events-none fixed inset-x-0 top-0 z-[2000] h-[3px]"
      style={{ opacity: shown && w < 100 ? 1 : 0 }}
      role="progressbar"
      aria-hidden={!shown}
      aria-label={t('Завантаження…')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(w)}
    >
      <div className="top-loader-bar" style={{ width: `${w}%` }} />
    </div>
  )
}

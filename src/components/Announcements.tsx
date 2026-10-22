/**
 * Оголошення вгорі сайту (їх веде адміністрація в панелі керування, з датами показу): sn-banner кожне, тон — з
 * оголошення. Закрите людиною не повертається (localStorage, за id); без дат кінця — до вимкнення. Список
 * перечитуємо раз на 5 хвилин: заплановані з'являються самі, завершені — зникають.
 */
import { useEffect, useState } from 'react'
import { SnBanner, SnButton } from '@/components/sn'
import { get } from '@/lib/api'
import { t } from '@/lib/i18n'
import { useAuth } from '@/lib/auth'

interface Ann { id: number; title: string; body: string; tone: 'info' | 'success' | 'warning' | 'critical'; link: { url: string; label: string } | null; dismissible: boolean }

const KEY = 'announcements:closed'
const readClosed = (): number[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }

export function Announcements() {
  const user = useAuth((s) => s.user?.id ?? null)
  const [list, setList] = useState<Ann[]>([])
  const [closed, setClosed] = useState<number[]>(readClosed)
  useEffect(() => {
    const load = () => get<{ list: Ann[] }>('/api/announcements').then((r) => setList(r.list)).catch(() => {})
    load()
    const h = setInterval(load, 5 * 60_000)
    return () => clearInterval(h)
  }, [user])
  const shown = list.filter((a) => !closed.includes(a.id))
  if (!shown.length) return null
  const close = (id: number) => {
    const next = [...closed.filter((x) => list.some((a) => a.id === x)), id]
    setClosed(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* без сховища */ }
  }
  return (
    <div className="mx-1.5 mb-1.5 grid gap-1.5 sm:mx-2.5">
      {shown.map((a) => (
        <SnBanner key={a.id} heading={a.title} tone={a.tone} dismissible={a.dismissible} onDismiss={() => close(a.id)}>
          {a.body && <span className="whitespace-pre-line">{a.body}</span>}
          {a.link && (
            <SnButton slot="secondary-actions" size="sm" variant="outline" href={a.link.url} target={/^https?:/.test(a.link.url) ? '_blank' : undefined}>
              {a.link.label || t('Детальніше')}
            </SnButton>
          )}
        </SnBanner>
      ))}
    </div>
  )
}

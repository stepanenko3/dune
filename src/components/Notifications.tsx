/**
 * Дзвоник у шапці: скільки непрочитаних сповіщень і список (найсвіжіші згори). Клік — на сторінку, про яку
 * сповіщення, і воно прочитане; «Позначити все прочитаним». Лічильник оновлюється наживо (потік лише цій людині).
 * Без входу дзвоника нема.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import { listNotes, noteOf, readNotes, type Note } from '@/lib/notifications'
import { fmtAgo } from '@/lib/market'
import { useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { subscribe } from '@/lib/stream'
import { cn } from '@/lib/utils'
import { plainClick } from '@/lib/urlState'
import { useMenuKeys } from '@/lib/menuKeys'
import { openPath } from '@/store'
import { GoodName } from '@/components/market/names'

export function Notifications({ pill }: { pill: string }) {
  const user = useAuth((s) => s.user)
  const [unread, setUnread] = useState(0)
  const [rows, setRows] = useState<Note[] | null>(null)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useMenuKeys(open, box, useCallback(() => setOpen(false), []))
  const load = useCallback(() => listNotes().then((r) => { setRows(r.rows); setUnread(r.unread) }, () => {}), [])
  useEffect(() => {
    if (!user) { setRows(null); setUnread(0); return }
    void load()
    return subscribe('/api/notifications/stream', (ev) => {
      const e = ev as { op?: string; unread?: number }
      if (e.op !== 'note') return
      setUnread(e.unread ?? 0)
      void load()
    }, () => void load())
  }, [user?.id, load])
  if (!user) return null
  const click = (n: Note) => (e: React.MouseEvent) => {
    if (!n.read) { void readNotes([n.id]).then((r) => setUnread(r.unread), () => {}); setRows((cur) => cur?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null) }
    if (!plainClick(e)) return
    e.preventDefault()
    setOpen(false)
    openPath(noteOf(n).href)
  }
  const all = async () => {
    try { const r = await readNotes('all'); setUnread(r.unread); setRows((cur) => cur?.map((x) => ({ ...x, read: true })) ?? null) } catch { /* спробує знову */ }
  }
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={unread ? t('Сповіщення: непрочитаних {n}', { n: unread }) : t('Сповіщення')} className={cn(pill, 'relative w-10 justify-center px-0')}>
        <Bell size={17} className={unread ? 'text-spice' : 'text-muted'} />
        {unread > 0 && <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-spice px-1 text-[10.5px] font-bold leading-none text-on-spice">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div role="menu" className="fixed inset-x-2 top-[64px] z-[950] grid max-h-[min(70vh,560px)] grid-rows-[auto_minmax(0,1fr)] rounded-xl border border-line bg-panel shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+6px)] sm:w-[380px]">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <b className="text-[14px]">{t('Сповіщення')}</b>
            {unread > 0 && <button type="button" onClick={all} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-semibold text-spice hover:bg-spice/10"><CheckCheck size={14} />{t('Позначити все прочитаним')}</button>}
          </div>
          <ul className="overflow-y-auto overscroll-contain p-1.5">
            {!rows && <li className="p-3 text-[13px] text-muted">{t('Завантаження…')}</li>}
            {rows && !rows.length && <li className="p-4 text-center text-[13px] text-muted">{t('Поки нічого. Тут з’являться зустрічні заявки, пропозиції угод і повідомлення.')}</li>}
            {rows?.map((n) => {
              const { text, href } = noteOf(n)
              const gid = typeof n.data.gid === 'string' ? n.data.gid : null
              return (
                <li key={n.id}>
                  <a role="menuitem" href={href} onClick={click(n)} className={cn('grid gap-0.5 rounded-lg px-2.5 py-2 text-[13px] leading-snug hover:bg-panel2', !n.read && 'bg-spice/5')}>
                    <span className="flex items-start gap-2">
                      {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-spice" aria-label={t('Непрочитане')} />}
                      <span className={cn('min-w-0 break-words', !n.read && 'font-semibold')}>{text}</span>
                    </span>
                    <span className="text-[12px] text-muted">{gid && <><GoodName gid={gid} /> · </>}{fmtAgo(n.created)}</span>
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

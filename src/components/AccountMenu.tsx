/**
 * Кнопка облікового запису в шапці: без входу — «Увійти»; з входом — аватар, а в меню — моя сторінка, налаштування,
 * моя гільдія (одна) чи пошук гільдії, усі гільдії, панель керування (модераторам і адміністраторам), вихід.
 */
import { useCallback, useRef, useState } from 'react'
import { LayoutDashboard, LogIn, LogOut, Settings, User as UserIcon, Users, LibraryBig } from 'lucide-react'
import { roleWithRank, loginHref, useAuth, roleLabel, canAdmin } from '@/lib/auth'
import { useStore, type View } from '@/store'
import { Avatar, GuildTag } from '@/components/access/Access'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { plainClick } from '@/lib/urlState'
import { useMenuKeys } from '@/lib/menuKeys'

export function AccountMenu({ pill }: { pill: string }) {
  const { user, guild, ready } = useAuth()
  const setView = useStore((s) => s.setView)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useMenuKeys(open, box, useCallback(() => setOpen(false), []))

  if (!ready) return <div className={cn(pill, 'w-12 shrink-0')} aria-hidden />
  if (!user)
    return (
      <a href={loginHref()} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('login', { search: `?next=${encodeURIComponent(location.pathname + location.search)}` }) }} className={cn(pill, 'shrink-0 gap-2 px-3 text-[13px] font-semibold text-spice hover:text-ink')}>
        <LogIn size={16} />
        <span className="hidden sm:inline">{t('Увійти')}</span>
      </a>
    )

  const go = (v: View, param?: string) => { setOpen(false); setView(v, { param }) }
  const item = 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] text-ink hover:bg-panel2'
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={t('Обліковий запис: {name}', { name: user.name })} className={cn(pill, 'gap-2 px-2 sm:px-2.5')}>
        <Avatar name={user.name} color={user.color} size={30} />
        <span className="hidden max-w-[9rem] truncate text-[13px] font-semibold lg:inline">{user.name}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-[950] w-[min(280px,calc(100vw-16px))] rounded-xl border border-line bg-panel p-1.5 shadow-2xl">
          <div className="flex items-center gap-2.5 px-2.5 pb-2 pt-1.5">
            <Avatar name={user.name} color={user.color} size={36} />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold">{user.name}</div>
              <div className="truncate text-[12px] text-muted">@{user.login}{user.role !== 'user' && roleLabel(user) && ` · ${roleLabel(user)}`}</div>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <button role="menuitem" className={item} onClick={() => go('user', user.login)}><UserIcon size={15} className="text-muted" />{t('Мій профіль')}</button>
          <button role="menuitem" className={item} onClick={() => go('account', user.login)}><Settings size={15} className="text-muted" />{t('Налаштування профілю')}</button>
          <div className="my-1 h-px bg-line" />
          {/* бібліотека — тут і вкладкою «Публічні» в кожному розділі (у верхньому меню її нема) */}
          <button role="menuitem" className={item} onClick={() => go('library')}><LibraryBig size={15} className="text-muted" />{t('Бібліотека')}</button>
          <div className="my-1 h-px bg-line" />
          {guild && (
            <button role="menuitem" className={item} onClick={() => go('guild', guild.slug)}>
              <GuildTag tag={guild.tag} color={guild.color} />
              <span className="min-w-0 flex-1 truncate">{guild.name}</span>
              <span className="text-[11.5px] text-muted">{roleWithRank(guild.role)}</span>
            </button>
          )}
          <button role="menuitem" className={item} onClick={() => go('guilds')}><Users size={15} className="text-muted" />{guild ? t('Усі гільдії') : t('Знайти гільдію')}</button>
          {canAdmin(user) && (
            <>
              <div className="my-1 h-px bg-line" />
              <button role="menuitem" className={item} onClick={() => go('admin')}><LayoutDashboard size={15} className="text-muted" />{t('Панель керування')}</button>
            </>
          )}
          <div className="my-1 h-px bg-line" />
          <button role="menuitem" className={item} onClick={() => useAuth.getState().logout()}><LogOut size={15} className="text-muted" />{t('Вийти')}</button>
        </div>
      )}
    </div>
  )
}

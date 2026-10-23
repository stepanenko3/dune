/**
 * Розмови (/chats, /chats/<id>): список своїх — особисті, угоди біржі, гільдійська — з непрочитаними й останнім
 * повідомленням, і відкрита розмова (components/chat/ChatView). Широкий екран — список ліворуч, розмова праворуч;
 * телефон — або список, або розмова (з «назад»). Список оновлюється сам (WebSocket).
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Ban, Bell, BellOff, Handshake, MessagesSquare, Shield, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { blockUser, listChats, muteChat, useChatEvents, type Chat } from '@/lib/chat'
import { loginHref, useAuth } from '@/lib/auth'
import { fmtAgo } from '@/lib/market'
import { t } from '@/lib/i18n'
import { cn, fmtN } from '@/lib/utils'
import { plainClick } from '@/lib/urlState'
import { openPath, useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Empty, Loading, PageError } from '@/components/states'
import { Avatar, GuildTag } from '@/components/access/Access'
import { useCrumb } from '@/components/Crumbs'
import { confirmAsk } from '@/components/ui/confirm'
import { ChatView } from '@/components/chat/ChatView'
import { GoodName, iconOf, useGoods } from '@/components/market/names'
import { Icon } from '@/components/catalog/bits'

const go = (href: string) => (e: React.MouseEvent) => { if (!plainClick(e)) return; e.preventDefault(); openPath(href) }

/** назва розмови: співрозмовник, гільдія чи угода */
export function ChatTitle({ c }: { c: Chat }) {
  if (c.kind === 'direct') return <>{c.other?.name ?? t('Людину видалено')}</>
  if (c.kind === 'guild') return <>{c.guild ? c.guild.name : t('Гільдія')}</>
  return <>{t('Угода')}: {c.deal?.gid ? <GoodName gid={c.deal.gid} /> : null}{c.deal?.qty ? ` ×${fmtN(c.deal.qty)}` : ''}</>
}
function ChatIcon({ c, size = 40 }: { c: Chat; size?: number }) {
  const ix = useGoods()
  if (c.kind === 'direct' && c.other) return <Avatar name={c.other.name} color={c.other.color} size={size} />
  if (c.kind === 'guild' && c.guild) return <span className="grid shrink-0 place-items-center" style={{ width: size, height: size }}><GuildTag tag={c.guild.tag} color={c.guild.color} /></span>
  if (c.kind === 'deal' && c.deal?.gid) return <Icon src={iconOf(ix, c.deal.gid)} size={size} />
  return <span className="grid shrink-0 place-items-center rounded-full bg-panel2 text-muted" style={{ width: size, height: size }}><MessagesSquare size={size * 0.45} /></span>
}

export default function Chats() {
  const me = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const param = useStore((s) => s.param)
  const [rows, setRows] = useState<Chat[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<Chat | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const load = () => listChats().then((r) => { setRows(r.rows); setFailed(false) }, () => setFailed(true))
  useEffect(() => { if (ready && me) void load() }, [ready, me?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // нове повідомлення, прочитано, змінилась розмова — перечитати список (не частіше разу на 0,8 с)
  useChatEvents((e) => {
    if (e.t !== 'msg' && e.t !== 'read' && e.t !== 'chat' && e.t !== 'del') return
    if (timer.current) return
    timer.current = setTimeout(() => { timer.current = null; void load() }, 800)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => { if (!param) setOpen(null) }, [param])
  useCrumb(!ready ? null : param ? (open ? [{ label: open.kind === 'direct' ? open.other?.name ?? t('Розмова') : open.kind === 'guild' ? open.guild?.name ?? t('Гільдія') : t('Угода') }] : null) : [])

  if (ready && !me) {
    return (
      <PageError page title={t('Розмови — для тих, хто увійшов')} message={t('Увійди — і зможеш писати гравцям, гільдії й сторонам угод.')}>
        <Button onClick={() => openPath(loginHref())}>{t('Увійти')}</Button>
      </PageError>
    )
  }
  if (failed && !rows) return <PageError page title={t('Розмови не завантажились')} onRetry={() => void load()} />
  if (!rows) return <Loading page />

  const list = (
    <ul className="grid gap-0.5" aria-label={t('Розмови')}>
      {rows.map((c) => {
        const on = c.id === param
        const mineLast = c.lastUser?.id === me?.id
        return (
          <li key={c.id}>
            <a href={`/chats/${c.id}`} onClick={go(`/chats/${c.id}`)} aria-current={on ? 'page' : undefined}
              className={cn('flex min-w-0 items-center gap-3 rounded-lg px-2.5 py-2', on ? 'bg-spice/10' : 'hover:bg-panel2')}>
              <ChatIcon c={c} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cn('min-w-0 flex-1 break-words text-[14px] leading-snug', c.unread ? 'font-bold' : 'font-semibold')}><ChatTitle c={c} /></span>
                  {c.lastAt && <span className="shrink-0 text-[11.5px] text-muted">{fmtAgo(c.lastAt)}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className={cn('line-clamp-2 min-w-0 flex-1 break-words text-[12.5px]', c.unread ? 'text-ink' : 'text-muted')}>
                    {c.lastText ? <>{mineLast ? `${t('Ти')}: ` : c.kind !== 'direct' && c.lastUser ? `${c.lastUser.name}: ` : ''}{c.lastText}</> : <i>{t('Ще без повідомлень')}</i>}
                  </span>
                  {c.muted && <BellOff size={12} className="shrink-0 text-muted" aria-label={t('Без звуку')} />}
                  {c.unread > 0 && <span className={cn('grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-bold', c.muted ? 'bg-panel2 text-muted' : 'bg-spice text-on-spice')}>{c.unread > 99 ? '99+' : c.unread}</span>}
                </span>
              </span>
            </a>
          </li>
        )
      })}
    </ul>
  )
  const empty = (
    <Empty icon={MessagesSquare} title={t('Розмов поки нема')} description={t('Напиши гравцю з його сторінки чи з оголошення на біржі. Розмова твоєї гільдії з’явиться тут сама.')} />
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden" data-scroll>
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-2 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* список: на телефоні — лише коли розмову не відкрито */}
        <aside className={cn('rounded-xl border border-line bg-panel p-1.5 shadow-sm lg:sticky lg:top-0 lg:block lg:max-h-[calc(100dvh-112px)] lg:overflow-y-auto', param && 'hidden')}>
          <h1 className="px-2.5 pb-1 pt-2 font-display text-[18px] font-bold">{t('Розмови')}</h1>
          {rows.length ? list : empty}
        </aside>
        {param ? (
          <section className="grid min-h-[calc(100dvh-112px)] grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-2">
            {open ? <ChatHead c={open} onChange={(c) => { setOpen(c); void load() }} /> : <div className="h-[60px] rounded-xl border border-line bg-panel" />}
            <ChatView key={param} chatId={param} onChat={setOpen} className="px-1" />
          </section>
        ) : (
          <section className="hidden place-items-center rounded-xl border border-dashed border-line text-[13.5px] text-muted lg:grid">{t('Вибери розмову ліворуч')}</section>
        )}
      </div>
    </div>
  )
}

/** шапка розмови: хто / що, дії (без звуку, заблокувати, перейти до людини / угоди / гільдії) */
function ChatHead({ c, onChange }: { c: Chat; onChange: (c: Chat) => void }) {
  const mute = async () => {
    try { await muteChat(c.id, !c.muted); onChange({ ...c, muted: !c.muted }) } catch (e) { toast.error((e as Error).message) }
  }
  const block = async () => {
    if (!c.other) return
    const on = !c.blocked?.byMe
    if (on && !(await confirmAsk({ title: t('Заблокувати {name}?', { name: c.other.name }), description: t('Ви не зможете писати одне одному, доки не розблокуєш.'), confirm: t('Заблокувати'), destructive: true }))) return
    try { await blockUser(c.other.id, on); onChange({ ...c, canWrite: !on && !c.blocked?.byThem, blocked: { byMe: on, byThem: !!c.blocked?.byThem } }) } catch (e) { toast.error((e as Error).message) }
  }
  const sub = c.kind === 'direct' ? (c.other ? `@${c.other.login}` : '') : c.kind === 'guild' ? t('Гільдія · учасників: {n}', { n: fmtN(c.members ?? 0) }) : (c.others ?? []).map((p) => p.name).join(', ')
  const link = c.kind === 'direct' && c.other ? `/u/${c.other.login}` : c.kind === 'deal' && c.deal ? `/market/deal/${c.deal.id}` : c.kind === 'guild' && c.guild ? `/g/${c.guild.slug}` : null
  const LinkIcon = c.kind === 'direct' ? UserRound : c.kind === 'deal' ? Handshake : Shield
  return (
    <header className="sticky top-0 z-20 flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-2 py-2 shadow-sm">
      <a href="/chats" onClick={go('/chats')} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-panel2 hover:text-ink lg:hidden" aria-label={t('До розмов')}><ArrowLeft size={18} /></a>
      <ChatIcon c={c} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block break-words font-semibold leading-snug"><ChatTitle c={c} /></span>
        {sub && <span className="block break-words text-[12px] text-muted">{sub}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        {link && <a href={link} onClick={go(link)} className="grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-panel2 hover:text-ink" aria-label={c.kind === 'direct' ? t('Сторінка людини') : c.kind === 'deal' ? t('До угоди') : t('До гільдії')} title={c.kind === 'direct' ? t('Сторінка людини') : c.kind === 'deal' ? t('До угоди') : t('До гільдії')}><LinkIcon size={17} /></a>}
        <button type="button" onClick={mute} aria-pressed={c.muted} className="grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-panel2 hover:text-ink" aria-label={c.muted ? t('Увімкнути сповіщення') : t('Без звуку')} title={c.muted ? t('Увімкнути сповіщення') : t('Без звуку')}>{c.muted ? <BellOff size={17} /> : <Bell size={17} />}</button>
        {c.kind === 'direct' && c.other && <button type="button" onClick={block} aria-pressed={!!c.blocked?.byMe} className={cn('grid h-10 w-10 place-items-center rounded-lg hover:bg-panel2', c.blocked?.byMe ? 'text-bad' : 'text-muted hover:text-bad')} aria-label={c.blocked?.byMe ? t('Розблокувати') : t('Заблокувати')} title={c.blocked?.byMe ? t('Розблокувати') : t('Заблокувати')}><Ban size={17} /></button>}
      </span>
    </header>
  )
}

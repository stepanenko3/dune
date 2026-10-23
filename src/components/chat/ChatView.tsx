/**
 * Розмова — один компонент на всі місця: сторінка розмов, угода біржі, панель керування (лише читання). Повідомлення
 * в потоці сторінки (на телефоні — одна прокрутка), поле вводу прилипає знизу. Нове, змінене, видалене, реакції,
 * «друкує…» й «переглянуто» — миттєво (WebSocket, lib/chat); без нього розмова перепитує сервер сама.
 * Дії з повідомленням (відповісти, реакція, змінити своє 15 хв, видалити своє) — наведенням чи дотиком.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, CheckCheck, CornerUpLeft, Pencil, Send, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { deleteMsg, editMsg, EDIT_MIN, focusChat, getChat, MAX_TEXT, olderMessages, reactMsg, REACTIONS, readChat, sendMsg, sendTyping, useChatEvents, useChatState, type Chat, type Msg } from '@/lib/chat'
import { useAuth } from '@/lib/auth'
import { locale, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { confirmAsk } from '@/components/ui/confirm'
import { Loading, PageError } from '@/components/states'
import { Avatar } from '@/components/access/Access'
import { EmojiPicker } from './EmojiPicker'

const GROUP_MS = 5 * 60_000
const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g

/** посилання в тексті — клікабельні (нова вкладка, без передачі адреси сайту) */
function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  return <>{parts.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline decoration-1 underline-offset-2 hover:text-spice">{p}</a> : <Fragment key={i}>{p}</Fragment>))}</>
}
const dayOf = (ms: number) => new Date(ms).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long' })
const timeOf = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
/** найближчий прокручуваний предок (сторінка сайту гортається у своєму контейнері) */
const scrollerOf = (el: HTMLElement | null): HTMLElement | null => {
  for (let x = el?.parentElement; x; x = x.parentElement) { const o = getComputedStyle(x).overflowY; if (o === 'auto' || o === 'scroll') return x }
  return null
}

export function ChatView({ chatId, admin = false, onChat, empty, className, surface = 'page' }: {
  chatId: string
  /** панель керування: лише читання, з /api/admin/chats */
  admin?: boolean
  /** розмову завантажено чи змінено (шапку малює сторінка) */
  onChat?: (c: Chat) => void
  /** що показати, поки повідомлень нема */
  empty?: ReactNode
  className?: string
  /** на чому лежить (фон поля вводу, що прилипає знизу): тло сторінки чи картка */
  surface?: 'page' | 'panel'
}) {
  const me = useAuth((s) => s.user)
  const live = useChatState((s) => s.live)
  const [chat, setChat] = useState<Chat | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [more, setMore] = useState(false)
  const [err, setErr] = useState('')
  const [older, setOlder] = useState(false)
  const [text, setText] = useState('')
  const [reply, setReply] = useState<Msg | null>(null)
  const [editing, setEditing] = useState<Msg | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [typing, setTyping] = useState<Record<string, { name: string; until: number }>>({})
  const [, tick] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const lastTyping = useRef(0)
  const readAt = useRef(0)
  const coarse = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, [])
  const readOnly = admin || chat?.readOnly
  const setChatBoth = (c: Chat) => { setChat(c); onChat?.(c) }

  const nearBottom = () => { const s = scrollerOf(box.current); return !s || s.scrollHeight - s.scrollTop - s.clientHeight < 160 }
  const toBottom = () => requestAnimationFrame(() => { const s = scrollerOf(box.current); if (s) s.scrollTop = s.scrollHeight })
  /** прочитано все, що вже показано (не частіше разу на секунду; у фоновій вкладці — ні) */
  const markRead = (list = msgs) => {
    if (admin || document.visibilityState !== 'visible' || !list.length) return
    const at = list[list.length - 1].at
    if (at <= readAt.current) return
    readAt.current = at
    void readChat(chatId, at).catch(() => {})
  }

  // завантаження
  useEffect(() => {
    let alive = true
    setChat(null); setMsgs([]); setErr(''); setReply(null); setEditing(null); readAt.current = 0
    getChat(chatId, admin).then((r) => {
      if (!alive) return
      setChatBoth(r.chat); setMsgs(r.messages); setMore(r.more)
      toBottom()
      markRead(r.messages)
    }, (e) => alive && setErr((e as Error).message))
    if (!admin) focusChat(chatId)
    return () => { alive = false; if (!admin) focusChat(null) }
  }, [chatId, admin]) // eslint-disable-line react-hooks/exhaustive-deps

  // миттєві події
  useChatEvents((e) => {
    if (admin || !('chat' in e) || e.chat !== chatId) return
    if (e.t === 'msg') {
      const stick = nearBottom()
      setMsgs((cur) => (cur.some((m) => m.id === e.message.id) ? cur : [...cur, e.message]))
      setTyping((cur) => { const n = { ...cur }; if (e.message.user) delete n[e.message.user.id]; return n })
      if (stick || e.message.user?.id === me?.id) { toBottom(); setTimeout(() => markRead([e.message]), 50) }
    } else if (e.t === 'edit') setMsgs((cur) => cur.map((m) => (m.id === e.message.id ? { ...e.message, reactions: m.reactions } : m)))
    else if (e.t === 'del') setMsgs((cur) => cur.map((m) => (m.id === e.id ? { ...m, text: '', deleted: Date.now(), reactions: [] } : m)))
    else if (e.t === 'react') setMsgs((cur) => cur.map((m) => (m.id === e.id ? { ...m, reactions: e.reactions.map((x) => ({ emoji: x.emoji, n: x.n, mine: !!x.users?.includes(me?.id ?? '') })) } : m)))
    else if (e.t === 'typing' && e.user.id !== me?.id) setTyping((cur) => ({ ...cur, [e.user.id]: { name: e.user.name, until: Date.now() + 4000 } }))
    else if (e.t === 'read' && e.user !== me?.id) setChat((c) => (c ? { ...c, otherRead: Math.max(c.otherRead ?? 0, e.at) } : c))
    else if (e.t === 'chat') getChat(chatId).then((r) => setChatBoth(r.chat), () => {})
  }, [chatId, admin, me?.id])

  // без WebSocket — перепитуємо кожні 4 с; «друкує…» гасне сам
  useEffect(() => {
    if (admin || live) return
    const h = setInterval(() => {
      getChat(chatId).then((r) => {
        setChat(r.chat)
        setMsgs((cur) => {
          const byId = new Map(r.messages.map((m) => [m.id, m]))
          const kept = cur.map((m) => byId.get(m.id) ?? m)
          const added = r.messages.filter((m) => !cur.some((x) => x.id === m.id))
          if (added.length && nearBottom()) { toBottom(); setTimeout(() => markRead(added), 50) }
          return [...kept, ...added]
        })
      }, () => {})
    }, 4000)
    return () => clearInterval(h)
  }, [chatId, admin, live]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!Object.keys(typing).length) return
    const h = setInterval(() => {
      tick((n) => n + 1)
      setTyping((cur) => { const now = Date.now(); const n = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > now)); return Object.keys(n).length === Object.keys(cur).length ? cur : n })
    }, 1000)
    return () => clearInterval(h)
  }, [typing])
  // повернувся у вкладку — прочитано
  useEffect(() => {
    const on = () => markRead()
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  })

  const loadOlder = async () => {
    if (!msgs.length) return
    setOlder(true)
    const s = scrollerOf(box.current)
    const from = s ? s.scrollHeight - s.scrollTop : 0
    try {
      const r = await olderMessages(chatId, msgs[0].at, admin)
      setMsgs((cur) => [...r.messages.filter((m) => !cur.some((x) => x.id === m.id)), ...cur])
      setMore(r.more)
      // лишитися на тому самому повідомленні
      requestAnimationFrame(() => { if (s) s.scrollTop = s.scrollHeight - from })
    } catch (e) { toast.error((e as Error).message) } finally { setOlder(false) }
  }

  const submit = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      if (editing) {
        const m = await editMsg(chatId, editing.id, body)
        setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...m, reactions: x.reactions } : x)))
        setEditing(null)
      } else {
        const m = await sendMsg(chatId, body, reply?.id)
        setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]))
        setReply(null)
        toBottom()
      }
      setText('')
      input.current?.focus()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  const onInput = (v: string) => {
    setText(v.slice(0, MAX_TEXT))
    if (!editing && v && Date.now() - lastTyping.current > 2500) { lastTyping.current = Date.now(); sendTyping(chatId) }
  }
  const insert = (s: string) => {
    const el = input.current
    if (!el) { setText((x) => x + s); return }
    const a = el.selectionStart ?? text.length, b = el.selectionEnd ?? text.length
    const next = (text.slice(0, a) + s + text.slice(b)).slice(0, MAX_TEXT)
    setText(next)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + s.length, a + s.length) })
  }
  const react = async (m: Msg, emoji: string) => {
    const on = !m.reactions.find((x) => x.emoji === emoji)?.mine
    try { const r = await reactMsg(chatId, m.id, emoji, on); setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, reactions: r.reactions } : x))) } catch (e) { toast.error((e as Error).message) }
    setActive(null)
  }
  const remove = async (m: Msg) => {
    setActive(null)
    if (!(await confirmAsk({ title: t('Видалити повідомлення?'), description: t('Його не побачить ніхто, і повернути не вийде.'), confirm: t('Видалити'), destructive: true }))) return
    try { await deleteMsg(chatId, m.id); setMsgs((cur) => cur.map((x) => (x.id === m.id ? { ...x, text: '', deleted: Date.now(), reactions: [] } : x))) } catch (e) { toast.error((e as Error).message) }
  }
  // висота поля — за текстом (до 6 рядків)
  useEffect(() => { const el = input.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px` }, [text])

  if (err) return <PageError message={err} />
  if (!chat) return <Loading />
  const myLast = [...msgs].reverse().find((m) => m.user?.id === me?.id && !m.deleted)
  const typers = Object.values(typing).filter((x) => x.until > Date.now()).map((x) => x.name)

  return (
    <div ref={box} className={cn('grid grid-cols-[minmax(0,1fr)] content-end', className)}>
      {more && <div className="flex justify-center pb-2"><Button size="sm" variant="secondary" loading={older} onClick={loadOlder}>{t('Раніші повідомлення')}</Button></div>}
      {!msgs.length && <div className="py-6 text-center text-[13px] text-muted">{empty ?? (readOnly ? t('Повідомлень нема') : t('Поки тихо. Напиши першим.'))}</div>}
      <ol className="grid gap-0.5" aria-label={t('Повідомлення')}>
        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          const newDay = !prev || dayOf(prev.at) !== dayOf(m.at)
          const grouped = !newDay && prev && prev.user?.id === m.user?.id && m.at - prev.at < GROUP_MS
          const mine = !!me && m.user?.id === me.id
          const canEdit = mine && !m.deleted && !readOnly && Date.now() - m.at < EDIT_MIN * 60_000
          const open = active === m.id
          return (
            <Fragment key={m.id}>
              {newDay && <li className="py-2 text-center text-[11.5px] font-semibold uppercase tracking-wide text-muted" aria-hidden>{dayOf(m.at)}</li>}
              <li className={cn('group flex gap-2', mine ? 'flex-row-reverse' : '', grouped ? 'mt-0' : 'mt-2')}>
                <span className="w-8 shrink-0">{!mine && !grouped && m.user && <Avatar name={m.user.name} color={m.user.color} size={32} />}</span>
                <div className={cn('grid max-w-[min(560px,82%)] gap-1', mine ? 'justify-items-end' : 'justify-items-start')}>
                  {!grouped && !mine && <span className="px-1 text-[12px] font-semibold text-muted">{m.user?.name ?? t('Людину видалено')}</span>}
                  <div
                    onClick={() => !readOnly && !m.deleted && setActive(open ? null : m.id)}
                    className={cn('relative min-w-0 rounded-2xl px-3 py-2 text-[14px] leading-snug', mine ? 'bg-spice/15' : 'bg-panel2', m.deleted && 'italic text-muted', !readOnly && !m.deleted && 'cursor-pointer')}
                  >
                    {m.quote && (
                      <span className="mb-1 block border-l-2 border-spice/60 pl-2 text-[12.5px] text-muted">
                        <b className="font-semibold">{m.quote.user?.name ?? t('Людину видалено')}</b>{' · '}{m.quote.deleted ? t('Повідомлення видалено') : m.quote.text}
                      </span>
                    )}
                    {m.deleted ? t('Повідомлення видалено') : <span className="whitespace-pre-wrap break-words"><Linkified text={m.text} /></span>}
                    <span className="ml-2 inline-flex translate-y-0.5 items-center gap-1 align-baseline text-[11px] text-muted">
                      {m.edited && !m.deleted && <span>{t('змінено')}</span>}
                      {timeOf(m.at)}
                      {mine && chat.kind === 'direct' && m.id === myLast?.id && ((chat.otherRead ?? 0) >= m.at ? <CheckCheck size={13} className="text-spice" aria-label={t('Переглянуто')} /> : <Check size={13} aria-label={t('Надіслано')} />)}
                    </span>
                  </div>
                  {m.reactions.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {m.reactions.map((r) => (
                        <button key={r.emoji} type="button" disabled={readOnly} onClick={() => react(m, r.emoji)} aria-pressed={!!r.mine} className={cn('inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[13px]', r.mine ? 'border-spice/60 bg-spice/10' : 'border-line bg-panel')}>
                          <span>{r.emoji}</span><span className="text-[12px] tabular-nums text-muted">{r.n}</span>
                        </button>
                      ))}
                    </span>
                  )}
                  {/* дії: дотиком — під повідомленням; мишею — при наведенні */}
                  {!readOnly && !m.deleted && (
                    <span className={cn('flex flex-wrap items-center gap-0.5 rounded-full border border-line bg-panel px-1 shadow-sm', open ? 'flex' : coarse ? 'hidden' : 'hidden group-hover:flex')}>
                      {REACTIONS.map((e) => <button key={e} type="button" onClick={(ev) => { ev.stopPropagation(); void react(m, e) }} className="grid h-8 w-8 place-items-center rounded-full text-[16px] hover:bg-panel2" aria-label={t('Реакція {emoji}', { emoji: e })}>{e}</button>)}
                      <button type="button" onClick={(ev) => { ev.stopPropagation(); setReply(m); setEditing(null); setActive(null); input.current?.focus() }} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-panel2 hover:text-ink" aria-label={t('Відповісти')}><CornerUpLeft size={15} /></button>
                      {canEdit && <button type="button" onClick={(ev) => { ev.stopPropagation(); setEditing(m); setReply(null); setText(m.text); setActive(null); input.current?.focus() }} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-panel2 hover:text-ink" aria-label={t('Змінити')}><Pencil size={14} /></button>}
                      {mine && <button type="button" onClick={(ev) => { ev.stopPropagation(); void remove(m) }} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-panel2 hover:text-bad" aria-label={t('Видалити')}><Trash2 size={14} /></button>}
                    </span>
                  )}
                </div>
              </li>
            </Fragment>
          )
        })}
      </ol>
      <div className="min-h-[22px] px-10 pt-1 text-[12.5px] italic text-muted" aria-live="polite">
        {typers.length ? (typers.length === 1 ? t('{name} друкує…', { name: typers[0] }) : t('Друкують: {names}…', { names: typers.join(', ') })) : ''}
      </div>
      {readOnly ? (
        <p className="py-2 text-center text-[12.5px] text-muted">{admin ? t('Перегляд у панелі керування — лише читання') : t('Ця розмова — лише для читання')}</p>
      ) : !chat.canWrite ? (
        <p className="rounded-lg bg-panel2 px-3 py-2.5 text-center text-[13px] text-muted">{chat.blocked?.byMe ? t('Ти заблокував цю людину — розблокуй, щоб писати') : chat.blocked?.byThem ? t('Ця людина обмежила, хто може їй писати') : t('Писати в цю розмову зараз не можна')}</p>
      ) : (
        <form className={cn('sticky bottom-0 z-10 -mx-1 grid gap-1.5 px-1 pb-1 pt-2 backdrop-blur', surface === 'panel' ? 'bg-panel/95' : 'bg-bg/95')} onSubmit={(e) => { e.preventDefault(); void submit() }}>
          {(reply || editing) && (
            <div className="flex items-center gap-2 rounded-lg border-l-2 border-spice bg-panel2 px-3 py-1.5 text-[12.5px]">
              {editing ? <Pencil size={13} className="shrink-0 text-spice" /> : <CornerUpLeft size={13} className="shrink-0 text-spice" />}
              <span className="min-w-0 flex-1 break-words text-muted">{editing ? t('Змінюєш повідомлення') : <><b className="font-semibold text-ink">{reply!.user?.name}</b>{' · '}{reply!.text.slice(0, 120)}</>}</span>
              <button type="button" onClick={() => { setReply(null); if (editing) { setEditing(null); setText('') } }} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:text-ink" aria-label={t('Скасувати')}><X size={14} /></button>
            </div>
          )}
          <div className="flex items-end gap-1.5 rounded-xl border border-line bg-panel p-1 shadow-sm focus-within:border-spice/60">
            <EmojiPicker onPick={insert} />
            <textarea
              ref={input}
              rows={1}
              value={text}
              maxLength={MAX_TEXT}
              placeholder={t('Повідомлення')}
              aria-label={t('Повідомлення')}
              onChange={(e) => onInput(e.target.value)}
              // Enter — надіслати (на телефоні — новий рядок, надсилає кнопка); Shift+Enter — новий рядок
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.nativeEvent.isComposing) { e.preventDefault(); void submit() } if (e.key === 'Escape' && (reply || editing)) { setReply(null); if (editing) { setEditing(null); setText('') } } }}
              className="max-h-40 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-1.5 py-2.5 text-[15px] leading-snug shadow-none outline-none ring-0 placeholder:text-muted focus:outline-none focus-visible:outline-none focus-visible:ring-0"
            />
            <button type="submit" disabled={!text.trim() || busy} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-spice text-on-spice transition-opacity disabled:opacity-40" aria-label={editing ? t('Зберегти') : t('Надіслати')}>
              {editing ? <Check size={18} /> : <Send size={17} />}
            </button>
          </div>
        </form>
      )}
      {!live && !admin && <span className="sr-only">{t('Нові повідомлення приходять із затримкою')}</span>}
    </div>
  )
}

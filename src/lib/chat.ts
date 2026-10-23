/**
 * Розмови на клієнті (server/routes/chats.mjs): типи, виклики API і одне WebSocket-з'єднання на вкладку (/api/chats/ws):
 * нові / змінені / видалені повідомлення, реакції, «друкує…», «прочитано». Обрив — перепідключення з затримкою, що
 * росте; поки з'єднання нема, відкрита розмова перепитує сервер сама (useChatEvents повідомляє, чи воно живе).
 * Лічильник непрочитаних — для значка в шапці.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { del, get, patch, post } from './api'
import { useAuth } from './auth'

export type ChatKind = 'direct' | 'deal' | 'guild'
export interface Person { id: string; login: string; name: string; color: string }
export interface Reaction { emoji: string; n: number; mine?: boolean; users?: string[] }
export interface Msg {
  id: string
  chat: string
  user: Person | null
  text: string
  at: number
  edited: number | null
  deleted: number | null
  reply: string | null
  quote: { id: string; user: Person | null; text: string; deleted: boolean } | null
  reactions: Reaction[]
}
export interface Chat {
  id: string
  kind: ChatKind
  lastAt: number | null
  lastText: string
  lastUser?: Person | null
  unread: number
  muted: boolean
  canWrite: boolean
  created: number
  other?: Person | null
  blocked?: { byMe: boolean; byThem: boolean }
  otherRead?: number
  guild?: { id: string; slug: string; name: string; tag: string; color: string } | null
  members?: number
  deal?: { id: string; gid?: string; status?: string; qty?: number }
  others?: Person[]
  /** панель керування: лише читання */
  readOnly?: boolean
  people?: Person[]
}
export type ChatEvent =
  | { t: 'hello' } | { t: 'pong' }
  | { t: 'msg'; chat: string; message: Msg }
  | { t: 'edit'; chat: string; message: Msg }
  | { t: 'del'; chat: string; id: string }
  | { t: 'react'; chat: string; id: string; reactions: Reaction[] }
  | { t: 'typing'; chat: string; user: { id: string; name: string } }
  | { t: 'read'; chat: string; user: string; at: number }
  | { t: 'chat'; chat: string }

export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥']
export const EDIT_MIN = 15
export const MAX_TEXT = 2000

// ---------- API ----------
export const listChats = () => get<{ rows: Chat[]; unread: number }>('/api/chats')
export const chatUnread = () => get<{ n: number }>('/api/chats/unread')
export const openDirect = (user: string) => post<{ id: string }>('/api/chats/direct', { user })
export const openGuildChat = (guild?: string) => post<{ id: string }>('/api/chats/guild', guild ? { guild } : {})
export const getChat = (id: string, admin = false) => get<{ chat: Chat; messages: Msg[]; more: boolean }>(`${admin ? '/api/admin/chats' : '/api/chats'}/${encodeURIComponent(id)}`)
export const olderMessages = (id: string, before: number, admin = false) =>
  admin ? get<{ messages: Msg[]; more: boolean }>(`/api/admin/chats/${encodeURIComponent(id)}?before=${before}`) : get<{ messages: Msg[]; more: boolean }>(`/api/chats/${encodeURIComponent(id)}/messages?before=${before}`)
export const sendMsg = (id: string, text: string, reply?: string | null) => post<Msg>(`/api/chats/${id}/messages`, { text, ...(reply ? { reply } : {}) })
export const editMsg = (id: string, mid: string, text: string) => patch<Msg>(`/api/chats/${id}/messages/${mid}`, { text })
export const deleteMsg = (id: string, mid: string) => del<{ ok: boolean }>(`/api/chats/${id}/messages/${mid}`)
export const reactMsg = (id: string, mid: string, emoji: string, on: boolean) => post<{ reactions: Reaction[] }>(`/api/chats/${id}/messages/${mid}/react`, { emoji, on })
export const readChat = (id: string, at?: number) => post<{ ok: boolean }>(`/api/chats/${id}/read`, at ? { at } : {})
export const typingHttp = (id: string) => post<{ ok: boolean }>(`/api/chats/${id}/typing`)
export const muteChat = (id: string, on: boolean) => post<{ muted: boolean }>(`/api/chats/${id}/mute`, { on })
export const blockUser = (user: string, on: boolean) => post<{ blocked: boolean }>('/api/chats/block', { user, on })
export const adminChats = (q: { kind?: string; q?: string; offset?: number }) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v) s.set(k, String(v))
  return get<{ rows: (Chat & { ref: string; messages: number; people: Person[] })[]; total: number }>(`/api/admin/chats?${s}`)
}

// ---------- WebSocket ----------
type Listener = (e: ChatEvent) => void
const listeners = new Set<Listener>()
let ws: WebSocket | null = null
let delay = 1000
let timer: ReturnType<typeof setTimeout> | null = null
let focus: string | null = null
let wanted = false

/** стан з'єднання й лічильник непрочитаних (значок у шапці) */
export const useChatState = create<{ live: boolean; unread: number }>(() => ({ live: false, unread: 0 }))
export const refreshUnread = () => chatUnread().then((r) => useChatState.setState({ unread: r.n }), () => {})

function connect() {
  if (!wanted || ws || timer || typeof WebSocket === 'undefined') return
  const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/chats/ws`)
  ws = s
  s.onopen = () => {
    delay = 1000
    useChatState.setState({ live: true })
    if (focus) s.send(JSON.stringify({ t: 'focus', chat: focus }))
    void refreshUnread()
  }
  s.onmessage = (m) => {
    let e: ChatEvent
    try { e = JSON.parse(m.data) } catch { return }
    // нове повідомлення не в тій розмові, що відкрита, — лічильник шапки перечитуємо (сервер знає про «без звуку»)
    if (e.t === 'msg' || e.t === 'read' || e.t === 'chat') void refreshUnread()
    for (const fn of [...listeners]) fn(e)
  }
  s.onclose = () => {
    ws = null
    useChatState.setState({ live: false })
    if (!wanted) return
    const wait = Math.min(30_000, delay) * (0.75 + Math.random() * 0.5)
    delay = Math.min(30_000, delay * 2)
    timer = setTimeout(() => { timer = null; connect() }, wait)
  }
  s.onerror = () => s.close()
}
function disconnect() {
  wanted = false
  if (timer) { clearTimeout(timer); timer = null }
  ws?.close()
  ws = null
}

/** з'єднання живе, поки людина на сайті й увійшла (викликає App) */
export function useChatSocket() {
  const uid = useAuth((s) => s.user?.id ?? null)
  useEffect(() => {
    if (!uid) { disconnect(); useChatState.setState({ unread: 0 }); return }
    wanted = true
    connect()
    void refreshUnread()
    const wake = () => { if (document.visibilityState === 'visible') { delay = 1000; connect() } }
    document.addEventListener('visibilitychange', wake)
    addEventListener('online', wake)
    // запасний шлях без WebSocket: лічильник — раз на хвилину
    const h = setInterval(() => { if (!useChatState.getState().live) void refreshUnread() }, 60_000)
    return () => { document.removeEventListener('visibilitychange', wake); removeEventListener('online', wake); clearInterval(h); disconnect() }
  }, [uid])
}

/** слухати події розмов (поки компонент на сторінці) */
export function useChatEvents(fn: Listener, deps: unknown[] = []) {
  useEffect(() => {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
}
/** яку розмову людина зараз дивиться (сервер не шле сповіщень про неї) */
export function focusChat(id: string | null) {
  focus = id
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'focus', chat: id }))
}
/** «друкую…» — через WebSocket, без нього — запитом (сервер сам не частіше разу на 2 с) */
export function sendTyping(id: string) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'typing', chat: id }))
  else void typingHttp(id).catch(() => {})
}

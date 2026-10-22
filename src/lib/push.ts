/**
 * Нагадування про бурю: підписка Web Push у цьому браузері. Вибір (за 24 чи 12 год, вимкнено) — у
 * налаштуваннях браузера; регіон береться з таймера, і при його зміні підписка оновлюється. «Увімкнено» звіряємо з
 * самою підпискою браузера (її могли відкликати) і раз на добу нагадуємо про неї серверу (він міг її забути).
 * Клік по нагадуванню (public/sw.js) не перезавантажує відкриту вкладку: служба шле їй адресу, і сайт сам переходить.
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import { prefGet, prefSet } from '@/lib/prefs'
import { t } from './i18n'
import { useDDRegion } from '@/lib/ddReset'
import { goUrl } from '@/lib/urlState'
import { fromLocation, useStore } from '@/store'
import { useAuth } from '@/lib/auth'

export type Lead = 0 | 12 | 24

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext

const b64 = (s: string) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || t('Сервер відповів помилкою ({code})', { code: r.status }))
    return j
  })

async function subscription(create: boolean) {
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub && create) {
    const { key } = await fetch('/api/push/key').then((r) => r.json())
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) })
  }
  return sub
}

export const useReminder = create<{ lead: Lead; busy: boolean; setLead: (l: Lead) => Promise<void>; test: () => Promise<void> }>((set, get) => ({
  lead: prefGet<Lead>('storm:remind', 0),
  busy: false,
  setLead: async (lead) => {
    // нагадування — лише людям, що увійшли (сервер без входу підписки не прийме)
    if (lead && !useAuth.getState().user) { toast.error(t('Нагадування — після входу')); return }
    if (!pushSupported()) { toast.error(t('Цей браузер не вміє нагадувань'), { description: t('Потрібен сучасний браузер; на iPhone — сайт, доданий на головний екран.') }); return }
    set({ busy: true })
    try {
      if (lead === 0) {
        const sub = await subscription(false)
        if (sub) { await post('/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe() }
      } else {
        if ((await Notification.requestPermission()) !== 'granted') {
          toast.error(t('Сповіщення заборонені'), { description: t('Дозволь їх для цього сайту в налаштуваннях браузера і спробуй ще раз.') })
          return
        }
        const sub = await subscription(true)
        await post('/api/push/subscribe', { sub: sub!.toJSON(), region: useDDRegion.getState().region, lead })
        if (get().lead === 0) toast.success(t('Нагадаю за {n} год до бурі', { n: lead }), { description: t('Працює, навіть коли сайт закритий — аби браузер був запущений.') })
      }
      prefSet('storm:remind', lead)
      set({ lead })
    } catch (e) {
      toast.error(t('Не вдалося змінити нагадування'), { description: (e as Error).message })
    } finally {
      set({ busy: false })
    }
  },
  test: async () => {
    try {
      const sub = await subscription(false)
      const r = sub ? await post('/api/push/test', { endpoint: sub.endpoint }) : { ok: false }
      if (!r.ok) toast.error(t('Пробне сповіщення не пішло'), { description: t('Вимкни й увімкни нагадування ще раз.') })
    } catch (e) {
      toast.error(t('Пробне сповіщення не пішло'), { description: (e as Error).message })
    }
  },
}))

// змінили регіон — оновити підписку, щоб нагадування прийшло за часом свого сервера
useDDRegion.subscribe((s, prev) => {
  const { lead, setLead } = useReminder.getState()
  if (s.region !== prev.region && lead) setLead(lead)
})

/** перейти на адресу сайту без перезавантаження (як клік по вкладці): розділ і параметри адреси */
export function openInApp(url: string) {
  goUrl(url)
  useStore.setState({ ...fromLocation(), sheet: null })
}

/**
 * «Нагадування увімкнено» — лише якщо підписка в браузері справді є і сповіщення дозволені: інакше перемикач брехав
 * би. Є — раз на добу підтверджуємо її серверу (той прибирає підписки, які служба push відкинула).
 */
async function checkReminder() {
  const { lead } = useReminder.getState()
  // підписку підтверджуємо від імені людини — без входу нема від чийого
  if (!lead || !pushSupported() || !useAuth.getState().user) return
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = Notification.permission === 'granted' ? await reg?.pushManager.getSubscription() : null
    if (!sub) { prefSet('storm:remind', 0); useReminder.setState({ lead: 0 }); return }
    if (Date.now() - prefGet<number>('storm:syncedUser', 0) < 24 * 3600_000) return
    await post('/api/push/subscribe', { sub: sub.toJSON(), region: useDDRegion.getState().region, lead })
    prefSet('storm:syncedUser', Date.now())
  } catch { /* мережа — наступного разу */ }
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  // клік по нагадуванню у вже відкритій вкладці: служба шле адресу — переходимо самі, нічого не перезавантажуючи
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string; url?: string } | null
    if (d?.type === 'sw:open' && typeof d.url === 'string' && /^\/(?!\/)/.test(d.url)) openInApp(d.url)
  })
  navigator.serviceWorker.startMessages?.()
  // після того, як стало відомо, хто увійшов (підписки тепер — людей: давню без людини підтверджуємо вже з входом)
  setTimeout(() => {
    if (useAuth.getState().ready) void checkReminder()
    else { const off = useAuth.subscribe((a) => { if (a.ready) { off(); void checkReminder() } }) }
  }, 3000)
}

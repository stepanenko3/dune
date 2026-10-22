/**
 * Живі оновлення (SSE) для списків сайту: одне з'єднання на адресу, спільне для всіх, хто підписався. Обрив —
 * перепідключення із затримкою, що росте (1 → 2 → 4 … → 60 с, з розкидом), а не кожні 3 с без кінця; у фоновій
 * вкладці не підключаємось, повертаємось, щойно її відкрили чи з'явилась мережа. Після відновлення — onReopen:
 * список перечитують, бо події за час обриву пропали. Останній, хто відписався, закриває з'єднання.
 */
type Handler = (data: unknown) => void
interface Conn { url: string; es: EventSource | null; subs: Set<Sub>; delay: number; timer: ReturnType<typeof setTimeout> | null; dropped: boolean }
interface Sub { onMessage: Handler; onReopen?: () => void }

const conns = new Map<string, Conn>()

function connect(c: Conn) {
  if (c.es || c.timer || !c.subs.size || typeof EventSource === 'undefined') return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  const es = new EventSource(c.url)
  c.es = es
  es.onopen = () => {
    c.delay = 1000
    // відновились після обриву — те, що змінилось тим часом, перечитують самі списки
    if (c.dropped) { c.dropped = false; for (const s of c.subs) s.onReopen?.() }
  }
  es.onmessage = (m) => {
    let data: unknown
    try { data = JSON.parse(m.data) } catch { return }
    for (const s of [...c.subs]) s.onMessage(data)
  }
  es.onerror = () => {
    // браузер перепідключався б сам кожні ~3 с без кінця (а на 502 — здався б назавжди): закриваємо й плануємо самі
    es.close()
    c.es = null
    c.dropped = true
    const wait = Math.min(60_000, c.delay) * (0.75 + Math.random() * 0.5)
    c.delay = Math.min(60_000, c.delay * 2)
    c.timer = setTimeout(() => { c.timer = null; connect(c) }, wait)
  }
}

if (typeof window !== 'undefined') {
  const wake = () => { for (const c of conns.values()) if (!c.es) { if (c.timer) { clearTimeout(c.timer); c.timer = null } connect(c) } }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake() })
  window.addEventListener('online', wake)
}

/** підписатися на потік; повертає «відписатися» */
export function subscribe(url: string, onMessage: Handler, onReopen?: () => void): () => void {
  let c = conns.get(url)
  if (!c) { c = { url, es: null, subs: new Set(), delay: 1000, timer: null, dropped: false }; conns.set(url, c) }
  const sub: Sub = { onMessage, onReopen }
  c.subs.add(sub)
  connect(c)
  return () => {
    c!.subs.delete(sub)
    if (c!.subs.size) return
    c!.es?.close()
    if (c!.timer) clearTimeout(c!.timer)
    conns.delete(url)
  }
}

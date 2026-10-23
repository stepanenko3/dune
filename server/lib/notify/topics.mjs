/*
 * Звідки беруться теми сповіщень: кому сповіщати річ (scope — з реєстру речей) і перевірка «подія скоро почнеться»
 * (щохвилини з планувальника; одне сповіщення на подію й її час — перенесена подія сповістить знову).
 */
import { SOON_MIN } from './messages.mjs'

/**
 * scope речі з реєстру: публічна — усім (якщо тема публічна); гільдійна річ (будь-яка видимість: її бачать учасники) —
 * гільдії; особиста непублічна — лише власнику. Сховане модерацією — нікому.
 */
export function scopeOf(it) {
  if (!it || it.hidden) return null
  const owner = { kind: it.owner_kind, id: it.owner_id }
  return { visibility: it.visibility === 'public' ? 'public' : 'restricted', guild: it.owner_kind === 'guild' ? it.owner_id : null, owner }
}

export const eventData = (ev) => ({ id: ev.id, title: ev.title, type: ev.type, starts: ev.starts })

/** події, що почнуться протягом SOON_MIN хвилин і ще не сповіщені; результат — скільки сповіщено */
export async function notifyEventsSoon({ db, items, notify, now = Date.now }) {
  const t0 = now()
  const rows = await db.all('SELECT id, doc, starts FROM events WHERE starts > ? AND starts <= ?', t0, t0 + SOON_MIN * 60_000)
  let n = 0
  for (const r of rows) {
    const scope = scopeOf(await items.get('event', r.id))
    if (!scope) continue
    if (!(await notify.once(`event.soon:${r.id}:${r.starts}`))) continue
    const doc = JSON.parse(r.doc)
    await notify.emit('event.soon', eventData({ id: r.id, ...doc, starts: Number(r.starts) }), scope)
    n++
  }
  return n
}

/*
 * Service worker лише для нагадувань (Web Push): показати сповіщення і відкрити сайт по кліку.
 * Нічого не кешує — застосунок працює як і без нього.
 * Клік не перезавантажує відкриту вкладку (там може бути незбережене): вкладці з мапою чи головною шлемо адресу —
 * сайт перейде сам (src/lib/push.ts); інших вкладок не чіпаємо — відкриваємо нову.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: e.data && e.data.text() } }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Sandwalkers', {
      body: d.body || '',
      tag: d.tag,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      data: { url: d.url || '/map?m=deepdesert_1' },
    }),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = new URL((e.notification.data && e.notification.data.url) || '/map?m=deepdesert_1', self.location.origin)
  // лише адреси цього сайту
  const url = target.origin === self.location.origin ? target.pathname + target.search : '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const ours = list.filter((c) => c.url.startsWith(self.location.origin + '/'))
      const path = (c) => new URL(c.url).pathname
      // вкладка з мапою, інакше — з головною: перехід усередині сайту, без перезавантаження
      const c = ours.find((x) => path(x).startsWith('/map')) || ours.find((x) => path(x) === '/')
      if (c) {
        c.postMessage({ type: 'sw:open', url })
        return c.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})

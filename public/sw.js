/*
 * Service worker сайту: застосунок на головному екрані (PWA), робота без мережі й нагадування (Web Push).
 *
 * Кеші (що й як):
 *   сторінка (навігація)      — спершу мережа; без мережі — збережена оболонка (головна, «/»): застосунок відкривається
 *                               й сам показує, що даних нема. Оболонку беремо запитом БЕЗ cookie — у кеш не потрапляє
 *                               нічого приватного (сторінка конкретної бази тощо може мати в заголовку назву приватної речі);
 *   /assets/*                 — файли збірки з відбитком у назві: не змінюються — спершу кеш, нема — мережа (і в кеш);
 *   /media/*, /catalog-icons/* — картинки: спершу кеш, з обмеженням кількості (найдавніші витісняються);
 *   іконки, маніфест          — віддаємо з кешу й тихо оновлюємо;
 *   /api/* і решта            — не чіпаємо взагалі (лише мережа): приватних даних у кеші нема, потоки SSE ідуть як ішли.
 *
 * Оновлення без поломок: новий sw.js (змінено VERSION) стає до роботи одразу (skipWaiting + claim) і прибирає кеші
 * старої версії, крім картинок. Нову збірку сайту (новий index.html) помічає сама сторінка (src/lib/pwa.ts) і
 * пропонує «Оновити»; перезавантаження й так бере свіжу сторінку з мережі.
 *
 * У розробці (Vite, /sw.js?dev) — лише нагадування: жодного кешу (/src, /@vite, HMR мають іти повз).
 *
 * Нагадування: показати сповіщення і відкрити сайт по кліку. Клік не перезавантажує відкриту вкладку (там може бути
 * незбережене): вкладці з мапою чи головною шлемо адресу — сайт перейде сам (src/lib/push.ts); інших вкладок не
 * чіпаємо — відкриваємо нову.
 */
const VERSION = 2
const DEV = new URL(self.location.href).searchParams.has('dev')
const SHELL = `shell-v${VERSION}`
const ASSETS = `assets-v${VERSION}`
const IMAGES = 'images-v1'
/** скільки картинок тримати (кожна — десятки КБ: разом кілька десятків МБ щонайбільше) */
const IMAGES_MAX = 600
/** скільки файлів збірки тримати (кілька збірок поспіль — старі шматки витісняються) */
const ASSETS_MAX = 400
/** оболонка: головна і те, без чого вона не має вигляду застосунку */
const SHELL_URLS = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/apple-touch-icon.png']
/** коли востаннє оновлювали оболонку (не частіше разу на 10 хв — щонавігації тягнути головну не треба) */
let lastShell = 0

self.addEventListener('install', (e) => {
  self.skipWaiting()
  if (!DEV) e.waitUntil(saveShell().catch(() => {}))
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // кеші старих версій (і будь-які в розробці) — геть; картинки переживають версії
    const keep = DEV ? [] : [SHELL, ASSETS, IMAGES]
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k)
    await self.clients.claim()
  })())
})

/**
 * Оболонку — у кеш: головна без cookie (нічого особистого) і всі файли збірки, які вона тягне (скрипти, стилі,
 * modulepreload), — щоб і перше відкриття без мережі вже мало, чим намалюватись.
 */
async function saveShell() {
  const res = await fetch('/', { credentials: 'omit', cache: 'no-cache' })
  if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return
  const html = await res.clone().text()
  const shell = await caches.open(SHELL)
  await shell.put('/', res)
  await Promise.all(SHELL_URLS.slice(1).map((u) => fetch(u, { cache: 'no-cache' }).then((r) => r.ok && shell.put(u, r)).catch(() => {})))
  const files = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))]
  shellFiles = files
  await warm(files, false)
  lastShell = Date.now()
}
/** файли збірки, які тягне оболонка (з останнього saveShell) */
let shellFiles = []

/**
 * Файли збірки — у кеш: ці й ті, на які вони посилаються (шматки сторінок, які застосунок довантажує на ходу: їхні
 * назви стоять рядками в коді), — тоді без мережі відкривається будь-який розділ, а не лише вже відвіданий. Уже
 * закешоване не тягнемо (між збірками змінюється лише частина файлів); панель керування — ні (вона лише адмінам);
 * людина просила економити трафік (Save-Data) — лише те, що потрібне оболонці. Глибоко — лише на прохання сторінки
 * (sw:warm, src/lib/pwa.ts), коли вона вже завантажилась: встановлення служби не чекає на кілька мегабайтів.
 */
async function warm(start, deep) {
  const assets = await caches.open(ASSETS)
  if (self.navigator.connection && self.navigator.connection.saveData) deep = false
  const seen = new Set(start)
  const queue = [...start]
  while (queue.length && seen.size < ASSETS_MAX / 2) {
    const u = queue.shift()
    let r = await assets.match(u)
    if (!r) {
      r = await fetch(u).catch(() => null)
      if (!storable(r)) continue
      await assets.put(u, r.clone())
    }
    if (!deep || !u.endsWith('.js')) continue
    const code = await r.text()
    for (const m of code.matchAll(/["'`/](assets\/[\w.-]+\.(?:js|css))["'`]/g)) {
      const f = '/' + m[1]
      if (!seen.has(f) && !/\/Admin/.test(f)) { seen.add(f); queue.push(f) }
    }
  }
  return deep
}

/** у кеші не більше max записів: найдавніші (порядок додавання) — геть */
async function trim(name, max) {
  const c = await caches.open(name)
  const keys = await c.keys()
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i])
}

/** відповідь можна класти в кеш: успішна, своя, не «приватна» й не частина файла */
const storable = (r) => r && r.ok && r.status === 200 && r.type === 'basic' && !/no-store|private/.test(r.headers.get('cache-control') || '')

/** спершу кеш; нема — мережа, і вдале — в кеш (з обмеженням кількості) */
async function cacheFirst(e, name, max) {
  const c = await caches.open(name)
  const hit = await c.match(e.request)
  if (hit) return hit
  const res = await fetch(e.request)
  if (storable(res)) e.waitUntil(c.put(e.request, res.clone()).then(() => trim(name, max)).catch(() => {}))
  return res
}

/** сторінка: спершу мережа; без мережі — оболонка з кешу (застосунок сам розбере адресу) */
async function page(e) {
  try {
    const res = await fetch(e.request)
    // сайт міг оновитись — свіжа оболонка (без cookie) у кеш, але не щоразу
    if (res.ok && Date.now() - lastShell > 10 * 60_000) { lastShell = Date.now(); e.waitUntil(saveShell().catch(() => {})) }
    return res
  } catch (err) {
    const hit = await caches.match('/', { cacheName: SHELL })
    if (hit) return hit
    throw err
  }
}

/** дрібна статика з оболонки: з кешу одразу, а з мережі — тихо оновити на наступний раз */
async function stale(e) {
  const c = await caches.open(SHELL)
  const hit = await c.match(e.request, { ignoreSearch: true })
  const net = fetch(e.request).then((r) => { if (storable(r)) c.put(e.request, r.clone()).catch(() => {}); return r })
  if (hit) { e.waitUntil(net.catch(() => {})); return hit }
  return net
}

if (!DEV) {
  self.addEventListener('fetch', (e) => {
    const req = e.request
    if (req.method !== 'GET' || req.headers.has('range')) return
    const url = new URL(req.url)
    if (url.origin !== self.location.origin) return
    const p = url.pathname
    if (req.mode === 'navigate') {
      // файли (картинка, json), відкриті напряму, — не сторінки застосунку
      if (/^\/(api|media|map-tiles|versions|catalog-icons|catalog-wiki)\//.test(p)) return
      return e.respondWith(page(e))
    }
    if (p.startsWith('/assets/')) return e.respondWith(cacheFirst(e, ASSETS, ASSETS_MAX))
    if (p.startsWith('/media/') || p.startsWith('/catalog-icons/')) return e.respondWith(cacheFirst(e, IMAGES, IMAGES_MAX))
    if (SHELL_URLS.includes(p) && p !== '/') return e.respondWith(stale(e))
    // решта (/api, потоки, тайли, моделі) — повз: лише мережа
  })
}

// від сторінки: sw:warm — сторінка завантажилась, можна тягнути шматки решти розділів (для роботи без мережі);
// sw:skip — нова версія служби одразу (вона й так не чекає, але про всяк випадок)
let warming = null
self.addEventListener('message', (e) => {
  const type = e.data && e.data.type
  if (type === 'sw:skip') self.skipWaiting()
  if (type === 'sw:warm' && !DEV && !warming) {
    warming = (shellFiles.length ? Promise.resolve() : saveShell())
      .then(async () => {
        // цю збірку вже прогріто — нічого не робимо (позначка — у кеші оболонки: служба живе недовго, пам'ять губиться)
        const shell = await caches.open(SHELL)
        const sig = shellFiles.join(' ')
        const done = await shell.match('/sw-warm')
        if (!sig || (done && (await done.text()) === sig)) return
        if (await warm(shellFiles, true)) await shell.put('/sw-warm', new Response(sig))
      })
      .catch(() => {})
      .finally(() => { warming = null })
    e.waitUntil(warming)
  }
})

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { title: e.data && e.data.text() } }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Sandwalkers', {
      body: d.body || '',
      tag: d.tag,
      icon: '/icons/icon-192.png',
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

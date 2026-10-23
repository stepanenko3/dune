/**
 * Застосунок на головному екрані (PWA): реєстрація service worker (public/sw.js) — завжди, не лише для нагадувань, — і
 * підказка «Оновити», коли вийшла нова збірка сайту.
 *
 * Служба кешує оболонку й файли збірки (без мережі сайт відкривається), а сторінку завжди бере спершу з мережі — тож
 * перезавантаження й так дає свіже. Відкрита ж вкладка живе довго: раз на годину й при поверненні до неї звіряємо
 * головний скрипт свіжої головної з тим, що працює тут, і, якщо він інший, пропонуємо «Оновити» (тихо, без примусу:
 * людина може дописувати своє). Нова версія самої служби стає до роботи тихо (skipWaiting у sw.js).
 *
 * У розробці (Vite) служба — лише для нагадувань (/sw.js?dev): нічого не кешує, /src і /@vite ідуть повз.
 */
import { toast } from 'sonner'
import { t } from './i18n'

/** сайт працює з Vite у розробці (не зібраний): Vite підставляє значення під час збірки */
const DEV = !!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV
/** адреса служби: у розробці — без кешу (та сама адреса має бути й у підписці на нагадування, src/lib/push.ts) */
export const SW_URL = DEV ? '/sw.js?dev' : '/sw.js'

export const swSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && window.isSecureContext

/** зареєструвати службу (повторно — та сама реєстрація; змінена адреса — оновлення) */
export const registerSW = () => navigator.serviceWorker.register(SW_URL)

/** головний скрипт збірки в розмітці: «/assets/index-AbC123.js» */
const entryOf = (html: string) => /<script[^>]+type="module"[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1] ?? null

let told = false
let checkedAt = 0
async function checkBuild() {
  if (told || Date.now() - checkedAt < 15 * 60_000) return
  checkedAt = Date.now()
  const mine = document.querySelector('script[type=module][src^="/assets/"]')?.getAttribute('src') ?? null
  if (!mine) return
  try {
    // без cookie: потрібна лише розмітка загальної головної
    const r = await fetch('/', { cache: 'no-store', credentials: 'omit' })
    const fresh = r.ok ? entryOf(await r.text()) : null
    if (!fresh || fresh === mine) return
    told = true
    toast(t('Вийшла нова версія сайту'), {
      id: 'pwa-update',
      duration: Infinity,
      description: t('Онови сторінку, коли зручно: незбережене спершу збережи.'),
      action: { label: t('Оновити'), onClick: () => location.reload() },
    })
  } catch { /* без мережі — наступного разу */ }
}

/** до роботи: служба і стеження за новими збірками (лише на зібраному сайті) */
export function initPwa() {
  if (!swSupported()) return
  const start = () => {
    registerSW().then(async (reg) => {
      if (DEV) return
      // служба готова — хай тягне шматки інших розділів (без мережі відкриються й ті, де людина ще не була)
      const ready = await navigator.serviceWorker.ready
      ready.active?.postMessage({ type: 'sw:warm' })
      // повернулись до вкладки — і чи не змінилась служба, і чи не вийшла нова збірка
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return
        reg.update().catch(() => {})
        void checkBuild()
      })
      setInterval(() => void checkBuild(), 60 * 60_000)
    }).catch(() => { /* приватне вікно, вимкнено в браузері — сайт працює й без служби */ })
  }
  // після завантаження сторінки: реєстрація й кешування оболонки не змагаються з першим малюванням
  if (document.readyState === 'complete') start()
  else addEventListener('load', start, { once: true })
}

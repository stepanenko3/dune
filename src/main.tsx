import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/unbounded/500.css'
import '@fontsource/unbounded/700.css'
import '@fontsource/golos-text/400.css'
import '@fontsource/golos-text/500.css'
import '@fontsource/golos-text/600.css'
import '@fontsource/golos-text/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import '@snotax/ui/properties.css'
import './index.css'
import { mountTooltips } from '@/lib/tooltips'
import { initI18n, t } from '@/lib/i18n'
import { reloadOnce } from '@/components/ErrorBoundary'
import { installBusyFetch } from '@/lib/busy'
import { initPwa } from '@/lib/pwa'

mountTooltips()
// усі запити сайту — у лічильник завантажень (смуга-дюна вгорі, components/TopLoader)
installBusyFetch()
// застосунок на головному екрані: service worker (без мережі — оболонка з кешу) і «Оновити» для нової збірки
initPwa()

// спершу мова (словник потрібен уже константам модулів), потім — сам застосунок; качається App-*.js разом зі словником
// (modulepreload у index.html — плагін preloadApp у vite.config.mts), тут він лише виконується
initI18n().then(async () => {
  const { default: App } = await import('./App')
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}).catch(() => {
  // шматка застосунку вже нема (сайт оновився, поки сторінка вантажилась) — перезавантажуємо раз, а не білий екран
  if (!reloadOnce('main')) document.getElementById('root')!.textContent = t('Сторінка не відкрилась. Онови її трохи згодом.')
})

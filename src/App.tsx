import { lazy, Suspense } from 'react'
import { Toaster } from 'sonner'
import { Header } from '@/components/Header'
import { useStore } from '@/store'
import { BasePage } from '@/pages/BasePage'
import { Roadmap } from '@/pages/Roadmap'

// мапа тягне Leaflet і власний шар точок — вантажимо, лише коли її відкрили
const MapPage = lazy(() => import('@/pages/MapPage'))

export default function App() {
  const view = useStore((s) => s.view)
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg text-ink">
      <Header />
      <main className="flex min-h-0 flex-1 flex-col px-1.5 pb-1.5 sm:px-2.5 sm:pb-2.5">
        {view === 'map' ? (
          <Suspense fallback={<div className="grid flex-1 place-items-center text-muted">Завантаження мапи…</div>}>
            <MapPage />
          </Suspense>
        ) : view === 'plan' ? (
          <Roadmap />
        ) : (
          <BasePage key={view} base={view} />
        )}
      </main>
      <Toaster
        position="bottom-center"
        style={{ zIndex: 980 }}
        toastOptions={{ classNames: { toast: '!bg-panel !text-ink !border-line !shadow-lg', description: '!text-muted' } }}
      />
    </div>
  )
}

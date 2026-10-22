/** Невідома адреса: кажемо прямо й даємо, куди піти (раніше вона мовчки ставала головною) */
import { Castle, Home as HomeIcon, LibraryBig, Map as MapIcon, SearchX } from 'lucide-react'
import { t } from '@/lib/i18n'
import { useStore, type View } from '@/store'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/states'

export function NotFound() {
  const go = (v: View) => useStore.getState().setView(v)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[720px] grid-cols-[minmax(0,1fr)] gap-2.5 py-10">
        <Empty icon={SearchX} title={t('Такої сторінки нема')} description={t('Можливо, посилання застаріло чи в ньому помилка. Ось куди можна піти:')}>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => go('home')}><HomeIcon size={15} />{t('На головну')}</Button>
            <Button variant="secondary" onClick={() => go('bases')}><Castle size={15} />{t('Бази')}</Button>
            <Button variant="secondary" onClick={() => go('map')}><MapIcon size={15} />{t('Мапа')}</Button>
            <Button variant="secondary" onClick={() => go('library')}><LibraryBig size={15} />{t('Бібліотека')}</Button>
          </div>
        </Empty>
      </div>
    </div>
  )
}

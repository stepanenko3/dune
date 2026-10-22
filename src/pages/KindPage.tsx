/**
 * Розділи «Уміння» (/builds — збережені білди) і «Калькулятор» (/calcs — збережені розрахунки) — як «Бази» й «Роадмапи»:
 * «Мої · Гільдія · Публічні» (components/ScopeTabs; публічні — LibraryBrowser, як у бібліотеці), картками; сам інструмент
 * (планувальник умінь, калькулятор) — підсторінка розділу: звідси кнопкою, там же відкривається збережене й створюється нове.
 */
import { useCallback, useEffect, useState } from 'react'
import { Calculator, Library, LogIn, Sparkles } from 'lucide-react'
import { get } from '@/lib/api'
import { t } from '@/lib/i18n'
import type { Item } from '@/lib/items'
import { openPath, useStore } from '@/store'
import { loginHref, useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorAlert, PageError } from '@/components/states'
import { ItemGrid, ItemGridSkeleton } from '@/components/access/ItemCard'
import { ScopeTabs, useScope } from '@/components/ScopeTabs'
import { LibraryBrowser } from '@/pages/Library'

const META = {
  build: {
    title: () => t('Уміння'),
    lead: () => t('Білди умінь: твої, гільдійські й публічні. Відкрий білд — планувальник покаже його; новий збери в планувальнику й збережи.'),
    open: () => t('Відкрити планувальник'),
    empty: () => t('Білдів поки нема'),
    emptyGuild: () => t('У гільдії білдів поки нема'),
    hint: () => t('Збери білд у планувальнику умінь і збережи його — він з’явиться тут.'),
    view: 'skills' as const,
    icon: Sparkles,
    guest: () => t('Планувальником можна користуватись без входу: білд зберігається в цьому браузері й в адресі сторінки, поділитися ним — посиланням. Увійди, щоб зберігати білди в акаунті й ділитися з гільдією.'),
  },
  calc: {
    title: () => t('Калькулятор'),
    lead: () => t('Скільки сировини, крафтів, води й часу на будь-який набір предметів і будівель. Тут — збережені розрахунки: твої, гільдійські й публічні; новий — у калькуляторі.'),
    open: () => t('Відкрити калькулятор'),
    empty: () => t('Розрахунків поки нема'),
    emptyGuild: () => t('У гільдії розрахунків поки нема'),
    hint: () => t('Додай цілі в калькуляторі й збережи розрахунок — він з’явиться тут.'),
    view: 'calculator' as const,
    icon: Calculator,
    guest: () => t('Калькулятором можна користуватись без входу: розрахунок зберігається в цьому браузері й в адресі сторінки, поділитися ним — посиланням. Увійди, щоб зберігати розрахунки в акаунті й ділитися з гільдією.'),
  },
}

export function KindPage({ kind }: { kind: 'build' | 'calc' }) {
  const m = META[kind]
  const setView = useStore((s) => s.setView)
  const sc = useScope()
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const [rows, setRows] = useState<Item[] | null>(null)
  const [failed, setFailed] = useState(false)
  const scope = sc.scope === 'guild' ? `guild:${sc.guild?.id}` : 'mine'
  const load = useCallback(() => {
    if (sc.scope === 'public') return
    setFailed(false)
    get<{ rows: Item[] }>(`/api/items?kind=${kind}&scope=${encodeURIComponent(scope)}`).then((r) => setRows(r.rows)).catch(() => setFailed(true))
  }, [kind, scope, sc.scope])
  useEffect(() => { setRows(null); load() }, [load])
  const Icon = m.icon
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader title={m.title()} lead={m.lead()} actions={ready && !user ? undefined : <Button onClick={() => setView(m.view)}><Icon size={15} />{m.open()}</Button>}>
          <ScopeTabs {...sc} />
        </PageHeader>
        {/* гість: інструмент працює й без входу — одразу сказати, де лишається зроблене */}
        {ready && !user && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-spice/40 bg-spice/10 px-4 py-3">
            <Icon size={20} className="shrink-0 text-spice" />
            <p className="min-w-[min(320px,100%)] flex-1 text-[13.5px] leading-snug">{m.guest()}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setView(m.view)}><Icon size={15} />{m.open()}</Button>
              <Button variant="secondary" onClick={() => openPath(loginHref())}><LogIn size={15} />{t('Увійти')}</Button>
            </div>
          </div>
        )}
        {sc.scope === 'public' ? <LibraryBrowser kind={kind} /> : (
          <>
            {failed && !rows && <PageError title={t('Список не завантажився')} onRetry={load} />}
            {failed && rows && <ErrorAlert message={t('Список не оновився. Онови сторінку трохи згодом.')} />}
            {!rows && !failed && <ItemGridSkeleton n={3} height={180} />}
            {rows && (
              <ItemGrid
                items={rows}
                onChange={load}
                empty={(
                  <Empty icon={Icon} title={sc.scope === 'guild' ? m.emptyGuild() : m.empty()} description={m.hint()}>
                    <Button onClick={() => setView(m.view)}><Icon size={15} />{m.open()}</Button>
                    <Button variant="secondary" onClick={() => sc.set('public')}><Library size={15} />{t('Подивитись публічні')}</Button>
                  </Empty>
                )}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

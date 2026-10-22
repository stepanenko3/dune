/**
 * Перегляд бази: план (рівні, підписи, приміщення) і 3D ліворуч, легенда й приміщення праворуч (на вузькому екрані —
 * висувний лист). Той самий компонент — на сторінці бази й у панелі керування (картка бази). Модель, підрахунки й
 * 3D-сцена — у контексті бази (ctx.ts), тут лише стан показу: вкладка, рівень, вибране приміщення, шари плану.
 * Вкладка й рівень плану — в адресі (?view=, ?level=): посилання відкриває той самий вигляд.
 */
import { useEffect, useMemo, useState } from 'react'
import { List } from 'lucide-react'
import type { BaseEnvelope } from '@/lib/bases'
import { prefGet, prefSet } from '@/lib/prefs'
import { useUrlParam } from '@/lib/urlState'
import { t } from '@/lib/i18n'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { Seg } from '@/components/ui/seg'
import { Button } from '@/components/ui/button'
import { SHEET_BASE, SheetBackdrop, SheetHead } from '@/components/ui/sheet'
import { context, type Level } from '@/components/base/ctx'
import { PlanView, type PlanOpts } from '@/components/base/PlanView'
import { ThreeView } from '@/components/base/ThreeView'
import { Legend, Rooms } from '@/components/base/SidePanel'

type Tab = 'plan' | '3d'

/** side: false — без легенди й переліку приміщень (перегляд у генераторі баз) */
export function BaseViewer({ env, C = context(env.id, env.version, env.doc), initialTab, side = true }: { env: BaseEnvelope; C?: ReturnType<typeof context>; initialTab?: Tab; side?: boolean }) {
  const base = env.id
  // вкладка — в адресі (?view=3d), без неї — та, що була востаннє (чи initialTab)
  const [def] = useState<Tab>(() => initialTab ?? (prefGet<Tab>('base:tab', 'plan') === '3d' ? '3d' : 'plan'))
  const [tab, setTabUrl, tabHref] = useUrlParam<Tab>('view', def, (v) => v === 'plan' || v === '3d', { always: true })
  // рівень за замовчуванням — сталий для сцени (як і камера в ThreeView): інакше рівні перемикались би туди-сюди
  const levelDef = useMemo(() => C.level, [C])
  const [level, setLevelUrl, levelHref] = useUrlParam<Level>('level', levelDef, (v) => C.M.levels.some((l: any) => l.key === v))
  const [highlight, setHighlight] = useState<string | null>(null)
  const [opts, setOptsState] = useState<PlanOpts>(() => ({
    items: prefGet('base:items', true),
    labels: prefGet('base:labels', true),
    coords: prefGet('base:coords', false),
  }))
  const sideOpen = useStore((s) => s.sheet === 'base-side')
  // рівень з адреси (і «назад») — у контекст бази: його пам'ятає наступний показ
  useEffect(() => { C.level = level }, [C, level])

  const setTab = (v: Tab) => {
    setTabUrl(v)
    prefSet('base:tab', v)
  }
  const setLevel = (l: Level) => {
    C.level = l
    setLevelUrl(l)
    prefSet(`base:${base}:level`, l)
  }
  const setOpts = (o: PlanOpts) => {
    setOptsState(o)
    prefSet('base:items', o.items)
    prefSet('base:labels', o.labels)
    prefSet('base:coords', o.coords)
  }
  // зі списку — повторний клік знімає вибір, рівень плану перемикається на рівень приміщення,
  // а з 3D повертаємось на план; клік по самому плану лише вибирає (як select() в app.js)
  const select = (id: string, fromList: boolean) => {
    const next = highlight === id && fromList ? null : id
    setHighlight(next)
    const r = next ? C.M.rooms.find((x: any) => x.id === next) : null
    if (r && fromList) {
      const lvl = C.levelOf(r)
      if (lvl !== level) setLevel(lvl)
    }
    if (tab !== 'plan' && fromList) setTab('plan')
  }

  return (
    <>
      {/* обидві колонки липкі: та, що нижча, стоїть на місці, поки гортається вища (3D поруч із довгим
          списком приміщень, або легенда поруч із високим планом) */}
      <div className={cn('grid grid-cols-[minmax(0,1fr)] items-start gap-2.5', side && 'lg:grid-cols-[minmax(0,1fr)_330px]')}>
        <section className={cn('min-w-0 overflow-hidden rounded-xl border border-line bg-panel shadow-sm', side && 'lg:sticky lg:top-0')} aria-label={t('Перегляд бази')}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <Seg<Tab>
              label={t('Вид')}
              value={tab}
              onChange={setTab}
              href={tabHref}
              items={[
                { id: 'plan', label: t('План') },
                { id: '3d', label: '3D' },
              ]}
            />
            <div className="flex-1" />
            {side && (
              <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => useStore.getState().setSheet('base-side')}>
                <List size={14} /> {t('Легенда і приміщення')}
              </Button>
            )}
          </div>
          {tab === 'plan' ? (
            <PlanView C={C} level={level} onLevel={setLevel} levelHref={levelHref} opts={opts} onOpts={setOpts} highlight={highlight} onSelect={(id) => select(id, false)} />
          ) : (
            <ThreeView C={C} />
          )}
        </section>

        {side && <SheetBackdrop open={sideOpen} className="lg:hidden" />}
        {side && (
        <aside className={cn(SHEET_BASE, 'sheet-lg flex flex-col lg:block lg:w-auto lg:self-stretch lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none')} data-open={sideOpen ? 'yes' : 'no'} aria-label={t('Легенда і приміщення')}>
          <SheetHead title={t('Легенда і приміщення')} className="lg:hidden" />
          {/* колонка розтягнута на висоту ряду (.sheet-lg робить її static), тож липне її вміст */}
          <div className="grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto p-2.5 lg:sticky lg:top-0 lg:overflow-visible lg:p-0">
            <Legend M={C.M} />
            <Rooms C={C} highlight={highlight} onSelect={(id) => select(id, true)} />
          </div>
        </aside>
        )}
      </div>
    </>
  )
}

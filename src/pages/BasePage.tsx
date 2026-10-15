/**
 * Сторінка бази (Main або DD) — перенесена з classic.html/app.js: план і 3D ліворуч, легенда й
 * приміщення праворуч (на вузькому екрані — висувний лист), під ними ліміти, етапи, кошторис і версії.
 * Модель, підрахунки і 3D-сцена живуть у контексті бази (components/base/ctx.ts) — переживають
 * перемикання вкладок; тут лише стан показу.
 */
import { useState } from 'react'
import { List } from 'lucide-react'
import type { BaseId } from '@/lib/engine'
import { prefGet, prefSet } from '@/lib/prefs'
import { useStore } from '@/store'
import { cn } from '@/lib/utils'
import { Seg } from '@/components/ui/seg'
import { Button } from '@/components/ui/button'
import { SHEET_BASE, SheetBackdrop, SheetHead } from '@/components/ui/sheet'
import { context, type Level } from '@/components/base/ctx'
import { PageHead } from '@/components/base/PageHead'
import { PlanView, type PlanOpts } from '@/components/base/PlanView'
import { ThreeView } from '@/components/base/ThreeView'
import { Legend, Rooms } from '@/components/base/SidePanel'
import { BuildPlan, Limits } from '@/components/base/BuildCards'
import { CostCard } from '@/components/base/CostCard'
import { Versions } from '@/components/base/Versions'

type Tab = 'plan' | '3d'

export function BasePage({ base }: { base: BaseId }) {
  const C = context(base)
  const UI = C.UI
  const [tab, setTabState] = useState<Tab>(() => (prefGet<Tab>('base:tab', 'plan') === '3d' ? '3d' : 'plan'))
  const [level, setLevelState] = useState<Level>(C.level)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [opts, setOptsState] = useState<PlanOpts>(() => ({
    items: prefGet('base:items', true),
    labels: prefGet('base:labels', true),
    coords: prefGet('base:coords', false),
  }))
  const sideOpen = useStore((s) => s.sheet === 'base-side')

  const setTab = (t: Tab) => {
    setTabState(t)
    prefSet('base:tab', t)
  }
  const setLevel = (l: Level) => {
    C.level = l
    setLevelState(l)
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
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid max-w-[1480px] gap-2.5">
        <PageHead title={UI.name} lead={UI.lead} facts={UI.facts} />

        <div className="grid items-start gap-2.5 lg:grid-cols-[minmax(0,1fr)_330px]">
          <section className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel shadow-sm" aria-label="Перегляд бази">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
              <Seg<Tab>
                label="Вид"
                value={tab}
                onChange={setTab}
                items={[
                  { id: 'plan', label: 'План' },
                  { id: '3d', label: '3D' },
                ]}
              />
              <div className="flex-1" />
              <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => useStore.getState().setSheet('base-side')}>
                <List size={14} /> Легенда і приміщення
              </Button>
            </div>
            {tab === 'plan' ? (
              <PlanView C={C} level={level} onLevel={setLevel} opts={opts} onOpts={setOpts} highlight={highlight} onSelect={(id) => select(id, false)} />
            ) : (
              <ThreeView C={C} />
            )}
          </section>

          <SheetBackdrop open={sideOpen} className="lg:hidden" />
          <aside className={cn(SHEET_BASE, 'sheet-lg flex flex-col lg:block lg:w-auto lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none')} data-open={sideOpen ? 'yes' : 'no'} aria-label="Легенда і приміщення">
            <SheetHead title="Легенда і приміщення" className="lg:hidden" />
            <div className="grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto p-2.5 lg:overflow-visible lg:p-0">
              <Legend base={base} />
              <Rooms C={C} highlight={highlight} onSelect={(id) => select(id, true)} />
            </div>
          </aside>
        </div>

        <div className="grid items-start gap-2.5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Limits C={C} />
          <BuildPlan C={C} />
          <CostCard C={C} />
        </div>

        <Versions base={base} />
      </div>
    </div>
  )
}

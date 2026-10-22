/**
 * 2D-план: рівні (з адресою), прапорці, SVG рушія і підпис рівня. Клік по приміщенню на плані — вибір. План ширший за
 * телефон — гортається в рамці; «Уся ширина» — вмістити його цілком (дрібніше, але видно все).
 */
import { useMemo, useRef, useState } from 'react'
import { Check, Seg } from '@/components/ui/seg'
import { t } from '@/lib/i18n'
import { prefGet, prefSet } from '@/lib/prefs'
import { cn } from '@/lib/utils'
import { FULL_CLASS, FullscreenButton, useFullscreen } from '@/lib/fullscreen'
import { levelName } from './tr'
import type { BaseCtx, Level } from './ctx'

export interface PlanOpts {
  items: boolean
  labels: boolean
  coords: boolean
}

export function PlanView({
  C,
  level,
  onLevel,
  levelHref,
  opts,
  onOpts,
  highlight,
  onSelect,
}: {
  C: BaseCtx
  level: Level
  onLevel: (l: Level) => void
  levelHref?: (l: Level) => string
  opts: PlanOpts
  onOpts: (o: PlanOpts) => void
  highlight: string | null
  onSelect: (id: string) => void
}) {
  const svg = useMemo(
    () => C.P.render({ level, items: opts.items, labels: opts.labels, coords: opts.coords, highlight }),
    [C, level, opts.items, opts.labels, opts.coords, highlight],
  )
  const [fit, setFit] = useState(() => prefGet('base:planFit', false))
  const box = useRef<HTMLDivElement>(null)
  const full = useFullscreen(box)
  return (
    <div ref={box} className={cn(full.on && FULL_CLASS)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel2/40 px-3 py-2.5">
        <Seg<Level>
          label={t('Рівень')}
          value={level}
          onChange={onLevel}
          href={levelHref}
          items={C.M.levels.map((l: any) => ({ id: l.key, label: levelName(C.UI.levelButtons[l.key]) }))}
        />
        <Check checked={opts.items} onChange={(v) => onOpts({ ...opts, items: v })}>{t('Обладнання і техніка')}</Check>
        <Check checked={opts.labels} onChange={(v) => onOpts({ ...opts, labels: v })}>{t('Підписи')}</Check>
        <Check checked={opts.coords} onChange={(v) => onOpts({ ...opts, coords: v })}>{t('Координати')}</Check>
        <span className="md:hidden"><Check checked={fit} onChange={(v) => { setFit(v); prefSet('base:planFit', v) }}>{t('Уся ширина')}</Check></span>
        <FullscreenButton {...full} className="ml-auto" />
      </div>
      {/* SVG — рядок із plan2d.js; кліки ловимо делегуванням, бо вузли щоразу нові */}
      <div
        className={cn('plan-wrap', fit && '[&_svg]:!min-w-0', full.on && 'grid min-h-0 flex-1 place-items-center overflow-auto [&_svg]:!h-full [&_svg]:!max-h-full [&_svg]:!w-auto [&_svg]:!max-w-full [&_svg]:!min-w-0')}
        onClick={(e) => {
          const g = (e.target as Element).closest('[data-room]')
          if (g) onSelect(g.getAttribute('data-room')!)
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div
        className="flex flex-wrap justify-between gap-x-4 gap-y-1.5 border-t border-line px-3.5 py-2.5 text-[13px] text-muted [&_strong]:font-semibold [&_strong]:text-ink"
        dangerouslySetInnerHTML={{ __html: C.UI.captions[level] }}
      />
    </div>
  )
}

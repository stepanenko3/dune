/**
 * Під планом: план будівництва по етапах і ліміт будівельних елементів. Ліміт рахується з тих самих кількостей,
 * що й калькулятор бази (useBaseTargets) — правки в калькуляторі одразу видно тут.
 */
import { Card, SectionTitle } from '@/components/ui/card'
import { cn, fmtN } from '@/lib/utils'
import { t } from '@/lib/i18n'
import type { BaseCtx } from './ctx'
import { lab, stageName } from './tr'
import { buildCat, useBaseTargets } from './BaseCalc'
import { findBuild } from '@/lib/calc'
import { buildName, type CatalogIndex } from '@/lib/catalog'
import { PRESETS } from './builder/labels'

// кольори груп деталей — ті самі, що на плані: фундамент як квадрати, перекриття як трикутники
const GROUP_BG: Record<string, string> = {
  f: 'var(--sq)',
  d: 'var(--tri)',
  w: 'var(--wall)',
  g: 'var(--shield)',
  o: 'rgb(var(--c-muted))',
  e: 'var(--plan-accent)',
}

/** будівля, додана в калькулятор із довідника (id гри): назва станції редактора мовою сайту, а як нема — з довідника */
function buildLabel(ix: CatalogIndex | null, key: string) {
  const pr = PRESETS.find((p) => p.type === key)
  if (pr) return lab(pr.name)
  const b = ix ? findBuild(ix, key) : null
  return b ? buildName(b) : t('Будівля з довідника')
}

export function Limits({ C }: { C: BaseCtx }) {
  const model = C.B.budget(C.res)
  const { c, qtyOf, targets, ix } = useBaseTargets(C)
  // групи деталей — з кількостей калькулятора; пентащит займає стільки ж елементів, скільки в моделі на штуку
  const shields = c.devices.find((x: any) => x.id === 'shield')?.n ?? 0
  const perShield = shields ? (model.groups.find((g: any) => g.id === 'g')?.n ?? 0) / shields : 2
  // рядок калькулятора → група ліміту за правилом рушія (C.B.groupOf): у старих базах рядки — види деталей
  // (fsq, csq…), у базах із деталей гри — форми (foundation, triangle_floor…), тож за id їх не скласти
  const n: Record<string, number> = { f: 0, d: 0, w: 0, o: 0, g: Math.round(qtyOf('dev:shield') * perShield) }
  for (const x of targets) {
    if (!x.id.startsWith('row:')) continue
    const g = C.B.groupOf?.(x.id.slice(4)) as string | null | undefined
    if (g && g in n) n[g] += x.qty
  }
  const groups = model.groups.map((g: any) => ({ ...g, n: n[g.id] ?? g.n }))
  // інші ліміти — теж з калькулятора: пристрої з категорією, будівлі з довідника — за набором, двері — з прорізів
  const catOf = (t: (typeof targets)[number]) => (t.kind === 'build' ? (ix ? buildCat(findBuild(ix, t.id)) : null) : t.cat ?? null)
  const cats = (C.B.LIMITS as { id: string; name: string; cap: number }[]).map((l) => {
    const items: [string, number][] = targets
      .filter((t) => catOf(t) === l.id)
      .map((t) => [t.kind === 'build' ? buildLabel(ix, t.id) : t.name ?? t.id, t.qty])
    if (l.id === 'doors' && qtyOf('row:door')) items.unshift([t('Двері в прорізах'), qtyOf('row:door')])
    items.sort((a, b) => b[1] - a[1])
    return { ...l, items, n: items.reduce((a, [, q]) => a + q, 0) }
  })
  const bud = { groups, cats, total: groups.reduce((a: number, g: any) => a + g.n, 0) }
  const cap: number = C.B.LIMITS[0].cap
  const over = bud.total - cap
  const scale = Math.max(bud.total, cap) * 1.04
  const pc = (n: number) => ((n / scale) * 100).toFixed(3) + '%'
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SectionTitle className="mb-0">{t('Будівельні елементи')}</SectionTitle>
        <div className="font-mono text-[22px] font-semibold leading-none tabular-nums">
          <b>{fmtN(bud.total)}</b>
          <span className="ml-1.5 text-[13px] font-medium text-muted">{t('з {cap}', { cap: fmtN(cap) })}</span>
        </div>
        <span role="status" className={cn('rounded-full px-2.5 py-0.5 text-[13px] font-semibold', over > 0 ? 'bg-bad/15 text-bad' : 'bg-ok/15 text-ok')}>
          {over > 0 ? t('більше на {n}', { n: fmtN(over) }) : t('лишається {n}', { n: fmtN(-over) })}
        </span>
      </div>
      <div className="relative mb-3 mt-[30px] flex h-[18px] rounded-[5px] border border-line bg-panel2" role="img" aria-label={t('Розподіл деталей відносно ліміту')}>
        {bud.groups
          .filter((g: any) => g.n > 0)
          .map((g: any) => (
            <span
              key={g.id}
              className="h-full shadow-[inset_-1px_0_0_rgb(var(--c-panel))] first:rounded-l-[4px]"
              style={{ width: pc(g.n), background: GROUP_BG[g.id] }}
              data-tip={t('{name}: {n}', { name: lab(g.name), n: fmtN(g.n) })}
            />
          ))}
        {over > 0 && <span className="absolute -bottom-1.5 h-[3px] rounded-sm bg-bad" style={{ left: pc(cap), width: pc(over) }} />}
        <span className="absolute -bottom-[7px] -top-[7px] -ml-px w-0.5 bg-ink" style={{ left: pc(cap) }}>
          <span className="absolute bottom-full right-0 whitespace-nowrap pb-[3px] font-mono text-[11.5px] leading-none text-ink">{t('ліміт {cap}', { cap: fmtN(cap) })}</span>
        </span>
      </div>
      <ul className="mb-3.5 grid grid-cols-[repeat(auto-fill,minmax(min(210px,100%),1fr))] gap-x-5 gap-y-1 text-[13px]">
        {bud.groups.map((g: any) => (
          <li key={g.id} className="flex items-center gap-2">
            <span className="h-3 w-3 flex-none rounded-[3px] border border-line" style={{ background: GROUP_BG[g.id] }} />
            <span>{lab(g.name)}</span>
            <b className="ml-auto font-mono text-[12.5px] font-medium tabular-nums">{fmtN(g.n)}</b>
          </li>
        ))}
      </ul>
      <h3 className="mb-2.5 mt-4 text-[13.5px] font-semibold">{t('Інші ліміти бази')}</h3>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(250px,100%),1fr))] gap-x-[22px] gap-y-3">
        {bud.cats.slice(1).map((c: any) => {
          const bad = c.n > c.cap
          return (
            <li key={c.id} className="min-w-0">
              <div className="flex items-baseline gap-2 text-[13px]">
                <span>{lab(c.name)}</span>
                <b className={cn('ml-auto font-mono font-semibold tabular-nums', bad && 'text-bad')}>
                  {fmtN(c.n)} <i className="font-normal not-italic text-muted">/ {fmtN(c.cap)}</i>
                </b>
              </div>
              <div className="my-1 h-1.5 overflow-hidden rounded-[3px] border border-line bg-panel2">
                <span className={cn('block h-full', bad ? 'bg-bad' : 'bg-spice')} style={{ width: Math.min(100, (c.n / c.cap) * 100).toFixed(2) + '%' }} />
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** коротко «що: скільки» — без узгодження числа з іменником (не буде «дверей 1») */
const SHORT: Record<string, string> = {
  fsq: t('фунд. кв.: {n}'), ftri: t('фунд. тр.: {n}'), ramp: t('пандуси: {n}'), csq: t('перекр. кв.: {n}'), ctri: t('перекр. тр.: {n}'), slope: t('скати: {n}'),
  wall: t('стіни: {n}'), window: t('вікна: {n}'), door: t('двері: {n}'), open: t('проходи: {n}'), wedge: t('скісні: {n}'), lean: t('похилі: {n}'),
  penta: t('пентащити: {n}'), rail: t('поручні: {n}'), stairs: t('сходи: {n}'), pillar: t('колони: {n}'),
}

export function BuildPlan({ C }: { C: BaseCtx }) {
  const how: string[] | undefined = C.UI.howto
  const eq: [string, number][] = C.B.equipment()
  const num = 'pt-px text-right font-mono text-[12.5px] font-semibold leading-[1.6] text-muted'
  return (
    <Card>
      <SectionTitle>{t('План будівництва')}</SectionTitle>
      {how && (
        <div className="mb-3.5 rounded-lg border border-line bg-panel2/60 px-3.5 py-3 text-[13.5px]">
          <h3 className="mb-1.5 text-[13.5px] font-semibold">{t('Як будувати від кута ділянки')}</h3>
          <ol className="grid list-decimal gap-1.5 pl-[18px]">
            {how.map((x, i) => (
              <li key={i} dangerouslySetInnerHTML={{ __html: x }} />
            ))}
          </ol>
        </div>
      )}
      <ol className="grid gap-3 text-[14px]">
        {C.res.stages.map((st: any, i: number) => (
          <li key={st.id} className="grid grid-cols-[2.2ch_1fr] gap-2">
            <span className={num}>{i + 1}</span>
            <div className="min-w-0">
              <b className="font-semibold">{stageName(st.name)}.</b> <span className="text-muted" dangerouslySetInnerHTML={{ __html: lab(st.note) }} />
              <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 font-mono text-[12.5px] font-medium">
                {C.B.KINDS.filter((k: any) => SHORT[k.id] && st.n[k.id]).map((k: any) => (
                  <span key={k.id} className="whitespace-nowrap">{SHORT[k.id].replace('{n}', fmtN(st.n[k.id]))}</span>
                ))}
              </div>
            </div>
          </li>
        ))}
        <li className="grid grid-cols-[2.2ch_1fr] gap-2">
          <span className={num}>{C.res.stages.length + 1}</span>
          <div className="min-w-0">
            <b className="font-semibold">{t('Пристрої й обладнання.')}</b>
            <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 font-mono text-[12.5px] font-medium">
              {eq.map(([n, c]) => (
                <span key={n} className="whitespace-nowrap">{lab(n)}{c > 1 ? ' ×' + c : ''}</span>
              ))}
            </div>
          </div>
        </li>
      </ol>
    </Card>
  )
}

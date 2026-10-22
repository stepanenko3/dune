/** Бокова колонка бази: легенда плану і приміщення по рівнях з описом вибраного. */
import { Card, SectionTitle } from '@/components/ui/card'
import { cn, plural } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { Empty } from '@/components/states'
import { listed, type BaseCtx, type Level } from './ctx'
import { fmt2, lab, levelName } from './tr'

/** легенда — лише те, що є в цій базі: парапети (палуби), похилі плити, зали крізь кілька рівнів */
export function Legend({ M }: { M: any }) {
  const rooms: any[] = M.rooms
  const deck = rooms.some((r) => r.h === 0 || (r.open || []).some((o: any) => o.type === 'balcony'))
  const slope = rooms.some((r) => r.profile)
  const tall = rooms.some((r) => r.h > 0 && M.levels.some((l: any) => l.z0 > r.z0 && l.z0 < r.z0 + r.h))
  const sw = 'block h-[18px] w-[26px]'
  return (
    <Card>
      <SectionTitle>{t('Легенда')}</SectionTitle>
      <div className="grid grid-cols-[26px_1fr] items-center gap-x-2.5 gap-y-[7px] text-[13px]">
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><rect x="4" y="1" width="16" height="16" fill="var(--sq)" stroke="var(--seam)" /></svg>
        <span>{t('Квадратна плита')}</span>
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><polygon points="3,16 21,16 12,1" fill="var(--tri)" stroke="var(--seam)" /></svg>
        <span>{t('Трикутна плита')}</span>
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><line x1="2" y1="9" x2="24" y2="9" stroke="var(--wall)" strokeWidth="2.4" /></svg>
        <span>{t('Стіна')}</span>
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><line x1="2" y1="9" x2="24" y2="9" stroke="var(--wall)" strokeWidth="2.4" strokeDasharray="3 4" /></svg>
        <span>{t('Двері')}</span>
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><line x1="2" y1="9" x2="24" y2="9" stroke="var(--shield)" strokeWidth="4.5" /></svg>
        <span>{t('Пентащит (проїзд, проліт)')}</span>
        {deck && (
          <>
            <svg className={sw} viewBox="0 0 26 18" aria-hidden><line x1="2" y1="9" x2="24" y2="9" stroke="var(--wall)" strokeWidth="1.3" strokeDasharray="1.5 3.5" /></svg>
            <span>{t('Парапет (палуба, балкон)')}</span>
          </>
        )}
        <svg className={sw} viewBox="0 0 26 18" aria-hidden>
          <rect x="2" y="3" width="22" height="12" fill="var(--item-fill)" stroke="var(--item)" />
          <path d="M7 3v12M12 3v12M17 3v12" stroke="var(--item)" strokeWidth="0.8" />
          <path d="M4 9h15" stroke="var(--item)" strokeWidth="1.4" />
          <path d="M19 6l4 3-4 3z" fill="var(--item)" />
        </svg>
        <span>{t('Сходи, стрілка — вгору')}</span>
        {slope && (
          <>
            <svg className={sw} viewBox="0 0 26 18" aria-hidden>
              <rect x="3" y="2" width="20" height="14" fill="var(--sq)" />
              <path d="M3 6h20M3 10h20M3 14h20" stroke="var(--seam)" strokeWidth="1.2" />
            </svg>
            <span>{t('Похилі плити (заокруглення)')}</span>
          </>
        )}
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><rect x="3" y="3" width="20" height="12" fill="var(--item-fill)" stroke="var(--item)" strokeDasharray="4 2.5" /></svg>
        <span>{t('Техніка й обладнання')}</span>
        {tall && (
          <>
            <svg className={sw} viewBox="0 0 26 18" aria-hidden>
              <defs>
                <pattern id="lg-h" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="5" height="5" fill="var(--hatch-bg)" />
                  <line x1="0" y1="0" x2="0" y2="5" stroke="var(--hatch-ln)" />
                </pattern>
              </defs>
              <rect x="3" y="2" width="20" height="14" fill="url(#lg-h)" stroke="var(--wall)" />
            </svg>
            <span>{t('Висота залу йде крізь рівень')}</span>
          </>
        )}
      </div>
    </Card>
  )
}

export function Rooms({ C, highlight, onSelect }: { C: BaseCtx; highlight: string | null; onSelect: (id: string) => void }) {
  const r = highlight ? C.M.rooms.find((x: any) => x.id === highlight) : null
  if (!C.M.rooms.some(listed))
    return (
      <Card>
        <SectionTitle>{t('Приміщення')}</SectionTitle>
        <Empty framed={false} title={t('Приміщень ще нема')} description={t('Їх називають у редакторі: інструмент «Приміщення» — клік по підлозі.')} />
      </Card>
    )
  return (
    <Card>
      <SectionTitle>{t('Приміщення')}</SectionTitle>
      <div className="grid gap-0.5">
        {C.M.levels.map((lv: any) => lv.key as Level).map((l: Level) => {
          const rs = C.M.rooms.filter((x: any) => listed(x) && C.levelOf(x) === l)
          if (!rs.length) return null
          return (
            <div key={l} className="grid gap-0.5">
              <div className="mb-1 mt-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted first:mt-0">{levelName(C.UI.levelNames[l])}</div>
              {rs.map((x: any) => {
                const on = highlight === x.id
                const meta = x.h > 0 ? t('{area} пл · +{from}…+{to}', { area: Math.round(C.M.roomArea(x)), from: fmt2(x.z0), to: fmt2(x.z0 + x.h) }) : t('палуба +{z}', { z: fmt2(x.z0) })
                return (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onSelect(x.id)}
                    className={cn(
                      'grid grid-cols-[1fr_auto] gap-2 rounded-md px-2 py-1.5 text-left text-[13.5px] font-medium leading-snug transition-colors',
                      on ? 'bg-spice/15 text-spice' : 'text-ink hover:bg-panel2',
                    )}
                  >
                    <span>{x.name}</span>
                    <span className="whitespace-nowrap font-mono text-[12px] font-normal tabular-nums opacity-70">{meta}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="mt-3 border-t border-line pt-3 text-[13.5px]">{r ? <Detail r={r} /> : <p className="text-muted">{t('Обери приміщення, щоб підсвітити його на плані.')}</p>}</div>
    </Card>
  )
}

function Detail({ r }: { r: any }) {
  // світильники й люки — дрібниці плану, у переліку обладнання їх не показуємо
  const items = (r.items || []).filter((it: any) => it.kind !== 'light' && it.kind !== 'hatch')
  const counts: Record<string, number> = {}
  for (const it of items) {
    const n = it.kind === 'stairs' ? t('{name} (+{from} → +{to})', { name: lab(it.name), from: fmt2(it.from), to: fmt2(it.to) }) : lab(it.full || it.name)
    counts[n] = (counts[n] || 0) + 1
  }
  const sq = r.tiles.filter((t: any) => t.k === 's').length, tr = r.tiles.length - sq
  return (
    <>
      <h3 className="mb-1 text-[14px] font-semibold">{r.name}</h3>
      <p className="mb-1.5 text-muted">{r.note || ''}</p>
      <p className="mb-1.5 text-muted">
        {plural(sq, [t('квадрат'), t('квадрати'), t('квадратів')])} · {plural(tr, [t('трикутник'), t('трикутники'), t('трикутників')])} · {r.h > 0 ? t('від +{from} до +{to}', { from: fmt2(r.z0), to: fmt2(r.z0 + r.h) }) : t('на висоті +{z}', { z: fmt2(r.z0) })}
      </p>
      {items.length > 0 && (
        <ul className="list-disc pl-[18px]">
          {Object.entries(counts).map(([n, c]) => (
            <li key={n}>{n}{c > 1 ? ' ×' + c : ''}</li>
          ))}
        </ul>
      )}
    </>
  )
}

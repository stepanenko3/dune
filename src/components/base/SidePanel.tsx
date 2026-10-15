/** Бокова колонка бази: легенда плану і приміщення по рівнях з описом вибраного. */
import { Card, SectionTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { listed, type BaseCtx, type Level } from './ctx'

export function Legend({ base }: { base: string }) {
  const main = base === 'main'
  const sw = 'block h-[18px] w-[26px]'
  return (
    <Card>
      <SectionTitle>Легенда</SectionTitle>
      <div className="grid grid-cols-[26px_1fr] items-center gap-x-2.5 gap-y-[7px] text-[13px]">
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><rect x="4" y="1" width="16" height="16" fill="var(--sq)" stroke="var(--seam)" /></svg>
        <span>Квадратна плита</span>
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><polygon points="3,16 21,16 12,1" fill="var(--tri)" stroke="var(--seam)" /></svg>
        <span>Трикутна плита</span>
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><line x1="2" y1="9" x2="24" y2="9" stroke="var(--wall)" strokeWidth="2.4" /></svg>
        <span>Стіна</span>
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><line x1="2" y1="9" x2="24" y2="9" stroke="var(--wall)" strokeWidth="2.4" strokeDasharray="3 4" /></svg>
        <span>Двері</span>
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><line x1="2" y1="9" x2="24" y2="9" stroke="var(--shield)" strokeWidth="4.5" /></svg>
        <span>Пентащит (проїзд, проліт)</span>
        {main && (
          <>
            <svg className={sw} viewBox="0 0 26 18" aria-hidden><line x1="2" y1="9" x2="24" y2="9" stroke="var(--wall)" strokeWidth="1.3" strokeDasharray="1.5 3.5" /></svg>
            <span>Парапет (палуба, балкон)</span>
          </>
        )}
        <svg className={sw} viewBox="0 0 26 18" aria-hidden>
          <rect x="2" y="3" width="22" height="12" fill="var(--item-fill)" stroke="var(--item)" />
          <path d="M7 3v12M12 3v12M17 3v12" stroke="var(--item)" strokeWidth="0.8" />
          <path d="M4 9h15" stroke="var(--item)" strokeWidth="1.4" />
          <path d="M19 6l4 3-4 3z" fill="var(--item)" />
        </svg>
        <span>Сходи, стрілка — вгору</span>
        {main && (
          <>
            <svg className={sw} viewBox="0 0 26 18" aria-hidden>
              <rect x="3" y="2" width="20" height="14" fill="var(--sq)" />
              <path d="M3 6h20M3 10h20M3 14h20" stroke="var(--seam)" strokeWidth="1.2" />
            </svg>
            <span>Похилі плити (заокруглення)</span>
          </>
        )}
        <svg className={sw} viewBox="0 0 26 18" aria-hidden><rect x="3" y="3" width="20" height="12" fill="var(--item-fill)" stroke="var(--item)" strokeDasharray="4 2.5" /></svg>
        <span>Техніка й обладнання</span>
        {main && (
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
            <span>Висота залу йде крізь рівень</span>
          </>
        )}
      </div>
    </Card>
  )
}

export function Rooms({ C, highlight, onSelect }: { C: BaseCtx; highlight: string | null; onSelect: (id: string) => void }) {
  const r = highlight ? C.M.rooms.find((x: any) => x.id === highlight) : null
  return (
    <Card>
      <SectionTitle>Приміщення</SectionTitle>
      <div className="grid gap-0.5">
        {(['g', 'u', 't', 'r'] as Level[]).map((l) => {
          const rs = C.M.rooms.filter((x: any) => listed(x) && C.levelOf(x) === l)
          if (!rs.length) return null
          return (
            <div key={l} className="grid gap-0.5">
              <div className="mb-1 mt-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted first:mt-0">{C.UI.levelNames[l]}</div>
              {rs.map((x: any) => {
                const on = highlight === x.id
                const meta = x.h > 0 ? `${Math.round(C.M.roomArea(x))} пл · +${x.z0}…${x.z0 + x.h}` : `палуба +${x.z0}`
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
      <div className="mt-3 border-t border-line pt-3 text-[13.5px]">{r ? <Detail r={r} /> : <p className="text-muted">Обери приміщення, щоб підсвітити його на плані.</p>}</div>
    </Card>
  )
}

function Detail({ r }: { r: any }) {
  // світильники й люки — дрібниці плану, у переліку обладнання їх не показуємо
  const items = (r.items || []).filter((it: any) => it.kind !== 'light' && it.kind !== 'hatch')
  const counts: Record<string, number> = {}
  for (const it of items) {
    const n = it.kind === 'stairs' ? `${it.name} (+${it.from} → +${it.to})` : it.full || it.name
    counts[n] = (counts[n] || 0) + 1
  }
  const sq = r.tiles.filter((t: any) => t.k === 's').length, tr = r.tiles.length - sq
  return (
    <>
      <h3 className="mb-1 text-[14px] font-semibold">{r.name}</h3>
      <p className="mb-1.5 text-muted">{r.note || ''}</p>
      <p className="mb-1.5 text-muted">
        {sq} квадратів · {tr} трикутників · {r.h > 0 ? `від +${r.z0} до +${r.z0 + r.h}` : `на висоті +${r.z0}`}
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

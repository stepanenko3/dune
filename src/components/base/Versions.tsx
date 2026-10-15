/** Історія версій цієї бази: знімок 3D, перелік змін і коміт. Знімки віддає API (/versions/…). */
import { Card, SectionTitle } from '@/components/ui/card'
import { VERSIONS, BASES, type BaseId } from '@/lib/engine'

const REPO = 'https://github.com/stepanenko3/dune/commit/'
const date = (d: string) => d.split('-').reverse().join('.')

export function Versions({ base }: { base: BaseId }) {
  const list = VERSIONS.filter((v) => v.base === base)
  const name = BASES[base].ui.name
  if (!list.length) return null
  return (
    <Card>
      <SectionTitle>Версії</SectionTitle>
      <div>
        {list.map((v) => (
          <details key={v.id} className="group border-t border-line first:border-t-0">
            <summary className="grid cursor-pointer list-none grid-cols-[3.2ch_1fr_auto] items-baseline gap-2.5 px-0.5 py-2 text-[13.5px] [&::-webkit-details-marker]:hidden">
              <b className="text-right font-mono text-[12.5px] font-semibold text-muted group-open:text-spice group-hover:text-spice">{v.n}</b>
              <span className="min-w-0">{v.title}</span>
              <time dateTime={v.date} className="font-mono text-[12px] font-medium tabular-nums text-muted">{date(v.date)}</time>
            </summary>
            <div className="pb-3.5 pl-[calc(3.2ch+12px)] pr-0.5 pt-0.5 text-[13.5px] max-sm:pl-0.5">
              <ul className="mb-2.5 grid list-disc gap-1 pl-4 text-muted">
                {v.changes.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
              <img
                src={'/' + v.img}
                alt={`${name}, версія ${v.n}, вигляд 3D`}
                width={960}
                height={655}
                loading="lazy"
                className="block h-auto w-full max-w-[640px] rounded-md border border-line bg-panel2"
              />
              <p className="mt-2 text-[12.5px] text-muted">
                {v.commit ? (
                  <>
                    Коміт{' '}
                    <a href={REPO + v.commit} target="_blank" rel="noopener" className="font-mono underline underline-offset-2 hover:text-ink">
                      {v.commit}
                    </a>
                  </>
                ) : (
                  'Поточна версія'
                )}
              </p>
            </div>
          </details>
        ))}
      </div>
    </Card>
  )
}

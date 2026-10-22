/**
 * Сітка турніру на вибування: раунди стовпцями, у матчі — дві команди, переможець підсвічено; організатор клацає
 * переможця (ще раз — скасувати), наступні раунди заповнюються самі (engine/bracket). Пропуск проходить далі сам.
 * Ще нема сітки — організатор складає її з підтверджених команд: за порядком реєстрації чи навмання.
 */
import { useState } from 'react'
import { Check, Shuffle, Trophy } from 'lucide-react'
import { cleanPicks, matchesOf, seedOf, type Match } from '@/engine/bracket.mjs'
import type { Bracket, Team, Win } from '@/lib/events'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Seg } from '@/components/ui/seg'

/** назва раунду від фіналу: «Фінал», «Півфінал», «Чвертьфінал», «1/8 фіналу» */
function roundName(r: number, n: number) {
  const left = n - r
  if (left === 1) return t('Фінал')
  if (left === 2) return t('Півфінал')
  if (left === 3) return t('Чвертьфінал')
  return t('1/{n} фіналу', { n: 2 ** (left - 1) })
}

function Side({ id, bye, win, lose, name, onPick }: { id: string | null; bye: boolean; win: boolean; lose: boolean; name: (id: string) => string; onPick?: () => void }) {
  const body = (
    <>
      <span className={cn('min-w-0 flex-1 truncate', !id && 'italic text-muted')}>{id ? name(id) : bye ? t('пропуск') : '—'}</span>
      {win && <Check size={14} className="shrink-0" />}
    </>
  )
  const cls = cn('flex h-8 w-full items-center gap-1.5 px-2.5 text-left text-[13px]', win ? 'bg-spice/15 font-semibold text-spice' : lose ? 'text-muted line-through decoration-1' : '')
  return onPick
    ? <button type="button" aria-pressed={win} onClick={onPick} className={cn(cls, 'transition-colors hover:bg-spice/10')} title={t('Переміг')}>{body}</button>
    : <div className={cls}>{body}</div>
}

function MatchCard({ m, name, onPick }: { m: Match; name: (id: string) => string; onPick?: (side: 'a' | 'b') => void }) {
  const real = !!(m.a && m.b)
  const live = onPick && real
  return (
    <div className={cn('divide-y divide-line overflow-hidden rounded-lg border bg-panel shadow-sm', m.w && real ? 'border-spice/40' : 'border-line')}>
      <Side id={m.a} bye={m.aBye} win={m.w === 'a' && !m.auto} lose={real && m.w === 'b'} name={name} onPick={live ? () => onPick('a') : undefined} />
      <Side id={m.b} bye={m.bBye} win={m.w === 'b' && !m.auto} lose={real && m.w === 'a'} name={name} onPick={live ? () => onPick('b') : undefined} />
    </div>
  )
}

export function BracketView({ bracket, teams, edit, busy, onChange }: { bracket: Bracket; teams: Map<string, Team>; edit: boolean; busy?: boolean; onChange: (b: Bracket) => void }) {
  const { rounds, champion } = matchesOf(bracket.seed, bracket.picks)
  const name = (id: string) => teams.get(id)?.name ?? t('Команду знято')
  const pick = (r: number, i: number, side: 'a' | 'b') => {
    const picks: Win[][] = rounds.map((round, k) => round.map((m, j) => (k === r && j === i ? (m.w === side ? null : side) : m.a && m.b ? m.w : null)))
    onChange({ seed: bracket.seed, picks: cleanPicks(bracket.seed, picks) })
  }
  return (
    <div className={cn('-mx-1 overflow-x-auto px-1 pb-1', busy && 'pointer-events-none opacity-70')}>
      <div className="flex min-w-max items-stretch gap-3">
        {rounds.map((round, r) => (
          <div key={r} className="flex w-[190px] flex-col gap-2">
            <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{roundName(r, rounds.length)}</h3>
            <div className="flex flex-1 flex-col justify-around gap-2.5">
              {round.map((m, i) => <MatchCard key={i} m={m} name={name} onPick={edit ? (side) => pick(r, i, side) : undefined} />)}
            </div>
          </div>
        ))}
        <div className="flex w-[170px] flex-col gap-2">
          <h3 className="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{t('Переможець')}</h3>
          <div className="flex flex-1 flex-col justify-around">
            <div className={cn('grid justify-items-center gap-1.5 rounded-xl border px-3 py-4 text-center', champion ? 'border-spice/60 bg-spice/10' : 'border-dashed border-line')}>
              <Trophy size={22} className={champion ? 'text-spice' : 'text-muted'} />
              <span className={cn('break-words font-display text-[14px] font-bold', !champion && 'font-normal text-muted')}>{champion ? name(champion) : t('ще не визначено')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** скласти сітку з підтверджених команд: за порядком реєстрації (перші — сильніші) чи навмання */
export function MakeBracket({ teams, busy, onMake }: { teams: Team[]; busy?: boolean; onMake: (b: Bracket) => void }) {
  const [order, setOrder] = useState<'reg' | 'random'>('reg')
  const ids = teams.map((x) => x.id)
  const make = () => {
    const list = order === 'random' ? [...ids].sort(() => Math.random() - 0.5) : ids
    onMake({ seed: seedOf(list), picks: [] })
  }
  if (ids.length < 2) return <p className="text-[13px] text-muted">{t('Сітку можна скласти, коли підтверджено щонайменше дві команди.')}</p>
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Seg size="sm" label={t('Порядок у сітці')} value={order} onChange={setOrder} items={[{ id: 'reg', label: t('Як зареєструвались') }, { id: 'random', label: <span className="inline-flex items-center gap-1"><Shuffle size={12} />{t('Навмання')}</span> }]} />
      <Button size="sm" loading={busy} onClick={make}><Trophy size={14} />{t('Скласти сітку ({n} команд)', { n: ids.length })}</Button>
    </div>
  )
}

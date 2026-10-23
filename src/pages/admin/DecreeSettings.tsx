/**
 * Указ Ландсрааду цього тижня в панелі керування (дозвіл site.decree): спершу — дім, що виграв Ландсраад (у грі указ
 * обирає дім-переможець і діє лише на його людей), потім — сам указ. Усі варіанти — картками одразу; указ без дому не
 * вибрати (картки неактивні з поясненням). Зміна дому при вибраному указі зберігається одразу.
 */
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Loading } from '@/components/states'
import { t } from '@/lib/i18n'
import { DECREES, HOUSES, houseOf, useDecree, type DecreeId, type House } from '@/lib/decree'
import { fmtWhen } from '@/lib/ddReset'
import { cn } from '@/lib/utils'

const card = (on: boolean) => cn('grid gap-1 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60', on ? 'border-spice/70 bg-spice/10' : 'border-line hover:border-spice/40')

export function DecreeSettings() {
  const { id, until, house, loaded, load, set, canSet } = useDecree()
  useEffect(() => { if (!loaded) void load() }, [loaded, load])
  // дім, вибраний до указу (указу ще нема — зберігати нічого; збережеться разом з указом)
  const [picked, setPicked] = useState<House | null>(null)
  const winner = id ? house : picked
  if (!loaded) return <Loading lines={3} />
  const pickHouse = (h: House) => {
    setPicked(h)
    if (id && h !== house) void set(id, h)
  }
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <h3 className="text-[14px] font-semibold">{t('Хто виграв Ландсраад')}</h3>
        <p className="text-[13px] text-muted">{t('Указ діє лише на людей дому-переможця. Інший дім бачить указ, але калькулятор для нього його не рахує.')}</p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('Хто виграв Ландсраад')}>
          {HOUSES.map((h) => (
            <button key={h.id} type="button" role="radio" disabled={!canSet} aria-checked={winner === h.id} onClick={() => pickHouse(h.id)} className={card(winner === h.id)}>
              <span className="flex items-center gap-2 text-[13.5px] font-semibold">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: h.color }} aria-hidden />
                {h.name}
                {winner === h.id && <Check size={14} className="ml-auto text-spice" />}
              </span>
            </button>
          ))}
        </div>
        {id && !house && <p className="text-[12.5px] text-warn">{t('Дім-переможець цього указу не вказано — поки він діє на всіх. Вибери дім.')}</p>}
      </div>
      <div className="grid gap-2">
        <h3 className="text-[14px] font-semibold">{t('Указ')}</h3>
        <p className="text-[13px] text-muted">
          {id && until
            ? t('Діє до {when} (буря Коріоліса) — потім скинеться сам.', { when: fmtWhen(until) })
            : winner
              ? t('Указ не вказано. Вибраний діятиме для {house} до найближчої бурі Коріоліса.', { house: houseOf(winner)!.of })
              : t('Спершу вибери дім, що виграв Ландсраад, — указ без нього не вибрати.')}
        </p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <button type="button" disabled={!canSet} aria-pressed={!id} onClick={() => set(null)} className={card(!id)}>
            <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">{!id && <Check size={14} className="text-spice" />}{t('Не вказано')}</span>
            <span className="text-[12.5px] text-muted">{t('Указ ще не відомий')}</span>
          </button>
          {DECREES.map((d) => (
            <button key={d.id} type="button" disabled={!canSet || !winner} title={!winner ? t('Спершу вибери дім-переможець') : undefined} aria-pressed={id === d.id}
              onClick={() => winner && set(d.id as DecreeId, winner)} className={card(id === d.id)}>
              <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">{id === d.id && <Check size={14} className="text-spice" />}{d.name}</span>
              <span className="text-[12.5px] leading-snug text-muted">{d.effect}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

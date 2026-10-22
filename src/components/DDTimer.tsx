/**
 * Буря Коріоліса (скидання Глибокої пустелі):
 *   StormCard  — картка на головній: відлік, регіон, нагадування (Web Push за 24/12 год);
 *   DDTimer    — на мапі Глибокої пустелі: відлік, коли буря за місцевим часом, регіон;
 *   StormAlert — смуга під шапкою на всіх сторінках, коли до бурі менше доби (можна сховати до наступної бурі);
 *   StormLeft  — лише відлік «буря через …» (підпис до карти на головній, рядок розкладки на мапі).
 * За 6 год — попередження, як Communinet у грі. Якщо мапа ще з минулого тижня — підказка, що TH.GL не оновив її.
 * Відлік змінюється щосекунди — читачам екрана його не оголошуємо: окрема прихована «жива» ділянка каже лише, коли
 * змінилась година (в останні 6 год).
 */
import { useEffect, useState } from 'react'
import { Bell, BellOff, CloudLightning, Wind, X } from 'lucide-react'
import { firstStormOfWeek, fmtLeft, fmtWhen, lastReset, nextReset, REGIONS, useDDRegion, WARN, WEEK, type Region } from '@/lib/ddReset'
import { openInApp, pushSupported, useReminder, type Lead } from '@/lib/push'
import { loginHref, useAuth } from '@/lib/auth'
import { openPath } from '@/store'
import { plainClick } from '@/lib/urlState'
import { t, T } from '@/lib/i18n'
import { Seg } from '@/components/ui/seg'
import { prefGet, prefSet } from '@/lib/prefs'
import { cn } from '@/lib/utils'

const DAY = 24 * 3600 * 1000
const HOUR = 3600 * 1000

/** «зараз», що оновлюється: щосекунди в останню годину, інакше раз на 15 с (і для відліку до нового указу) */
export function useStorm() {
  const region = useDDRegion((s) => s.region)
  const [now, setNow] = useState(Date.now)
  const next = nextReset(region, now)
  const step = next - now < 3600_000 ? 1000 : 15_000
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), step)
    return () => clearInterval(id)
  }, [step])
  return { now, next, left: next - now, prev: lastReset(region, now), warn: next - now <= WARN }
}

const REGION_IDS = Object.keys(REGIONS) as Region[]
/** на сенсорному екрані — кнопки не нижчі за 40 px */
const TOUCH_SEG = '[&>*]:inline-flex [&>*]:items-center [&>*]:justify-center [@media(pointer:coarse)]:[&>*]:min-h-10'

/** регіон сервера — картками поруч (усі чотири видно одразу) */
function RegionCards({ className }: { className?: string }) {
  const { region, setRegion } = useDDRegion()
  return (
    <Seg<Region>
      label={t('Регіон сервера')}
      size="sm"
      value={region}
      onChange={setRegion}
      items={REGION_IDS.map((r) => ({ id: r, label: REGIONS[r].label }))}
      className={cn('grid grid-cols-2 sm:grid-cols-4', TOUCH_SEG, className)}
    />
  )
}

/** регіон сервера — такими самими невеликими перемикачами, як мапи й розкладки в панелі мапи */
function RegionChips() {
  const { region, setRegion } = useDDRegion()
  return (
    <div role="radiogroup" aria-label={t('Регіон сервера')} className="flex flex-wrap gap-1">
      {REGION_IDS.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={region === r}
          onClick={() => setRegion(r)}
          className={cn(
            'inline-flex min-h-7 items-center justify-center rounded-md border px-2 py-0.5 text-[12px] leading-tight transition-colors [@media(pointer:coarse)]:min-h-9',
            region === r ? 'border-spice/60 bg-spice/10 font-semibold text-spice' : 'border-line/80 bg-panel2/40 text-ink/85 hover:border-spice/40 hover:text-ink',
          )}
        >
          {REGIONS[r].label}
        </button>
      ))}
    </div>
  )
}

/**
 * Мапа ще з минулого тижня: поточну розкладку вперше побачили ще до першої бурі цього тижня (розкладка одна на всі
 * регіони — TH.GL міняє її після бурі в Океанії), а остання буря була недавно.
 */
const isStale = (since: string | null | undefined, prev: number, now: number) =>
  !!since && Date.parse(since) < firstStormOfWeek(prev) - HOUR && now - prev < 2 * DAY

/** прихована «жива» ділянка: в останні 6 год — «буря через 5 год», раз на годину, а не щосекунди */
function StormLive({ left, warn }: { left: number; warn: boolean }) {
  return (
    <span className="sr-only" aria-live="polite">
      {warn ? t('Буря Коріоліса через {n} год', { n: Math.max(1, Math.ceil(left / HOUR)) }) : ''}
    </span>
  )
}

export function StormCard({ since }: { since?: string | null }) {
  const { now, next, left, prev, warn } = useStorm()
  const { lead, busy, setLead, test } = useReminder()
  // нагадування — лише після входу (підписка — людини)
  const user = useAuth((s) => s.user)
  const stale = isStale(since, prev, now)
  const pct = Math.min(100, Math.max(0, ((now - prev) / WEEK) * 100))
  const Icon = warn ? CloudLightning : Wind
  const leads: { v: Lead; label: string }[] = [{ v: 0, label: t('Ні') }, { v: 24, label: t('За добу') }, { v: 12, label: t('За 12 год') }]
  return (
    <section className={cn('grid content-start gap-3 rounded-xl border p-4 shadow-sm', warn ? 'border-spice/60 bg-spice/10' : 'border-line bg-panel')} aria-labelledby="h-storm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Icon size={18} className={cn('shrink-0', warn ? 'animate-pulse text-spice' : 'text-spice')} />
        <h2 id="h-storm" className="font-display text-[16px] font-bold">{t('Буря Коріоліса')}</h2>
      </div>
      <div className="grid gap-1.5">
        <span className="text-[13px] text-muted">{warn ? t('Буря наближається — до неї') : t('Глибоку пустелю зітре через')}</span>
        <b className="font-mono text-[30px] font-semibold leading-none tabular-nums">{fmtLeft(left)}</b>
        <StormLive left={left} warn={warn} />
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel2" aria-hidden>
          <div className={cn('h-full rounded-full', warn ? 'bg-spice' : 'bg-spice/60')} style={{ width: pct + '%' }} />
        </div>
      </div>
      <p className="text-[12.5px] text-muted">
        {warn
          ? t('Заберіть лут зі сховищ форпосту і виведіть техніку: бази в Хагга буря не зачепить.')
          : t('Наступна — {when} за вашим часом. Час орієнтовний: звіряйтеся з Communinet у грі, він попереджає за 6 год.', { when: fmtWhen(next) })}
      </p>
      {stale && <p className="text-[12.5px] text-spice">{t("Мапа ще показує минулий тиждень — нова розкладка з'явиться найближчим часом.")}</p>}
      <div className="grid gap-1">
        <span className="text-[12px] text-muted">{t('Сервер')}</span>
        <RegionCards />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-line pt-3">
        {lead ? <Bell size={15} className="text-spice" /> : <BellOff size={15} className="text-muted" />}
        <span className="text-[13px]">{t('Нагадати')}</span>
        {!user ? (
          <span className="text-[12px] text-muted">
            <T text="— після входу: {link}" link={<a href={loginHref()} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); openPath(loginHref()) }} className="font-medium text-spice underline-offset-2 hover:underline">{t('Увійти')}</a>} />
          </span>
        ) : pushSupported() ? (
          <>
            <span className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label={t('Нагадати про бурю')}>
              {leads.map((l) => (
                <button
                  key={l.v}
                  type="button"
                  disabled={busy}
                  aria-pressed={lead === l.v}
                  onClick={() => setLead(l.v)}
                  className={cn('whitespace-nowrap rounded px-2 py-0.5 text-[12px] transition-colors disabled:opacity-50 [@media(pointer:coarse)]:min-h-10', lead === l.v ? 'bg-spice/15 text-spice' : 'text-muted hover:text-ink')}
                >
                  {l.label}
                </button>
              ))}
            </span>
            {lead > 0 && <button type="button" onClick={test} className="text-[12px] text-muted underline underline-offset-2 hover:text-ink [@media(pointer:coarse)]:min-h-10">{t('Надіслати пробне')}</button>}
          </>
        ) : (
          <span className="text-[12px] text-muted">{t('цей браузер не вміє сповіщень (на iPhone — додай сайт на головний екран)')}</span>
        )}
      </div>
    </section>
  )
}

/**
 * На мапі Глибокої пустелі: скільки до бурі, коли вона за місцевим часом, регіон сервера; since — коли поточну
 * розкладку вперше побачили (з історії розкладок): мапа ще з минулого тижня — підказка.
 */
export function DDTimer({ since, className, narrow }: { since?: string | null; className?: string; narrow?: boolean }) {
  const { now, next, left, prev, warn } = useStorm()
  const Icon = warn ? CloudLightning : Wind
  // у вузькій панелі мапи заголовок «Буря Коріоліса» вже над блоком — тут лише відлік, коли саме, регіон і підказка
  if (narrow) return (
    <div className={cn('grid gap-2 text-[12px]', className)}>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Icon size={14} className={cn('shrink-0 text-spice', warn && 'animate-pulse')} aria-hidden />
        <b className="font-mono text-[12.5px] tabular-nums">{fmtLeft(left)}</b>
        <span className="text-muted">· {fmtWhen(next)}</span>
        <StormLive left={left} warn={warn} />
      </p>
      <RegionChips />
      <p className="text-[11px] leading-snug text-muted">
        {warn ? t('Заберіть лут зі сховищ форпосту і виведіть техніку: бази в Хагга буря не зачепить.') : t('Час орієнтовний: звіряйтеся з Communinet у грі, він попереджає за 6 год.')}
      </p>
      {isStale(since, prev, now) && <p className="text-[11.5px] leading-snug text-spice">{t("Мапа ще показує минулий тиждень — нова розкладка з'явиться найближчим часом.")}</p>}
    </div>
  )
  return (
    <div className={cn('grid gap-2 text-[12px]', className)}>
      <div className="flex items-center gap-2.5">
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-spice/10 text-spice', warn && 'animate-pulse')}><Icon size={15} aria-hidden /></span>
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block text-[12.5px]"><T text="Буря Коріоліса через {left}" left={<b className="font-mono tabular-nums">{fmtLeft(left)}</b>} /></span>
          <span className="block text-muted">{fmtWhen(next)}</span>
        </span>
        <StormLive left={left} warn={warn} />
      </div>
      <RegionCards />
      <p className="text-[11px] leading-snug text-muted">
        {warn ? t('Заберіть лут зі сховищ форпосту і виведіть техніку: бази в Хагга буря не зачепить.') : t('Час орієнтовний: звіряйтеся з Communinet у грі, він попереджає за 6 год.')}
      </p>
      {isStale(since, prev, now) && <p className="text-[11.5px] leading-snug text-spice">{t("Мапа ще показує минулий тиждень — нова розкладка з'явиться найближчим часом.")}</p>}
    </div>
  )
}

/** мапа Глибокої пустелі ще з минулого тижня (для рядка розкладки на мапі) */
export function useStale(since?: string | null) {
  const { now, prev } = useStorm()
  return isStale(since, prev, now)
}

/** лише відлік «через 3 д 20 год»; за 6 год до бурі — кольором і з іконкою блискавки */
export function StormLeft({ className }: { className?: string }) {
  const { left, warn } = useStorm()
  const Icon = warn ? CloudLightning : Wind
  return (
    <span className={cn('inline-flex items-center gap-1.5', warn && 'text-spice', className)}>
      <Icon size={14} className={cn('shrink-0', warn && 'animate-pulse')} />
      <T text="буря через {left}" left={<b className="font-mono font-semibold tabular-nums">{fmtLeft(left)}</b>} />
    </span>
  )
}

/** смуга під шапкою: менше доби до бурі; «сховати» — до наступної бурі */
export function StormAlert() {
  const { next, left, warn } = useStorm()
  const [hidden, setHidden] = useState(() => prefGet<number>('storm:hidden', 0) === next)
  useEffect(() => setHidden(prefGet<number>('storm:hidden', 0) === next), [next])
  if (left > DAY || hidden) return null
  // звичайний клік — без перезавантаження; з Ctrl/⌘ чи середньою — нова вкладка, як у звичайного посилання
  const go = (e: React.MouseEvent) => { if (!plainClick(e)) return; e.preventDefault(); openInApp('/map?m=deepdesert_1') }
  return (
    <div className="px-1.5 pb-1.5 sm:px-2.5 sm:pb-2.5">
      <div className={cn('flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px] shadow-sm', warn ? 'border-spice/70 bg-spice/15' : 'border-spice/40 bg-panel')}>
        <CloudLightning size={16} className={cn('shrink-0 text-spice', warn && 'animate-pulse')} />
        <span className="min-w-0 flex-1">
          <T text="Буря Коріоліса через {left}" left={<b className="font-mono tabular-nums">{fmtLeft(left)}</b>} />
          <span className="hidden sm:inline"> {t('— заберіть лут з Глибокої пустелі і виведіть техніку.')}</span>{' '}
          <a href="/map?m=deepdesert_1" onClick={go} className="whitespace-nowrap underline underline-offset-2 hover:text-spice">{t('Мапа Глибокої пустелі')}</a>
        </span>
        <StormLive left={left} warn={warn} />
        <button
          type="button"
          aria-label={t('Сховати до наступної бурі')}
          title={t('Сховати до наступної бурі')}
          onClick={() => { prefSet('storm:hidden', next); setHidden(true) }}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:text-ink [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:w-10"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  )
}

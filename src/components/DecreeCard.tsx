/**
 * Указ Ландсрааду на тиждень — картка на головній: лише показує указ сайту (його виставляє адміністрація в панелі
 * керування; тим, хто може, — посилання туди). Після бурі Коріоліса указ сам скидається.
 * Відлік до нового указу: новий указ діє з тижневого скидання (вівторок) — тоді ж, що й буря; якщо указ уже
 * вибрано, — до часу, який записав сервер (until).
 * Указ із торговцем Ландсрааду — посилання на мапу Арракіна й Селища Харко з цим торговцем у фокусі.
 * Указ діє лише на людей дому, що виграв Ландсраад: картка каже, чи діє він на тебе (твій дім — свій із профілю чи дім
 * гільдії); хто дім не вказав — бачить, для якого дому указ, і (увійшовши) посилання «вказати свій дім».
 */
import { Fragment, useEffect } from 'react'
import { Hourglass, Landmark, MapPin } from 'lucide-react'
import { DECREE_CITIES, decreeOf, houseOf, spotUrl, useDecree } from '@/lib/decree'
import { useAuth } from '@/lib/auth'
import { fmtLeft, fmtWhen } from '@/lib/ddReset'
import { useStorm } from '@/components/DDTimer'
import { openInApp } from '@/lib/push'
import { plainClick } from '@/lib/urlState'
import { t, T } from '@/lib/i18n'

/** звичайний клік — без перезавантаження; з Ctrl/⌘ чи середньою — нова вкладка, як у звичайного посилання */
const go = (url: string) => (e: React.MouseEvent) => { if (!plainClick(e)) return; e.preventDefault(); openInApp(url) }

export function DecreeCard() {
  const { id, until, canSet, loaded, load, house, me, reach } = useDecree()
  const user = useAuth((s) => s.user)
  // увійшла чи вийшла людина — її дім інший: перечитуємо
  useEffect(() => { if (loaded) load() }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const win = houseOf(house)
  useEffect(() => { if (!loaded) load() }, [loaded, load])
  const d = decreeOf(id)
  const { now, next } = useStorm()
  const end = until && until > now ? until : next
  // строк указу минув (тижневе скидання) — сервер його вже «забув»: перечитуємо, і картка показує «не вибрано»
  const expired = !!until && now >= until
  useEffect(() => { if (expired) load() }, [expired, load])
  // хтось інший вибрав указ — підхоплюємо, щойно вкладка знову на екрані
  useEffect(() => {
    const vis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [load])
  return (
    <section className="grid content-start gap-3 rounded-xl border border-line bg-panel p-4 shadow-sm" aria-labelledby="h-decree">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Landmark size={18} className="text-spice" />
        <h2 id="h-decree" className="font-display text-[16px] font-bold">{t('Указ Ландсрааду')}</h2>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-muted" title={t('Новий указ — {when} за вашим часом, із тижневим скиданням (тоді ж, що й буря)', { when: fmtWhen(end) })}>
          <Hourglass size={14} className="shrink-0" />
          <T text="новий через {left}" left={<b className="font-mono font-semibold tabular-nums text-ink">{fmtLeft(end - now)}</b>} />
        </span>
      </div>
      {d ? (
        <div className="grid gap-1">
          <p className="font-display text-[15px] font-bold">{d.name}</p>
          {win && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: win.color }} aria-hidden />
              {t('Обрав {house} — переможець Ландсрааду', { house: win.name })}
            </p>
          )}
          <p className="text-[14px]">{d.effect}</p>
          <p className="text-[12px] text-muted">{t('Новий указ — {when}, із тижневим скиданням', { when: fmtWhen(end) })}</p>
          {d.spot && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px]">
              <MapPin size={14} className="shrink-0 text-spice" />
              <span className="text-muted">{t('Показати на карті:')}</span>
              {DECREE_CITIES.map((m, i) => (
                <Fragment key={m}>
                  {i > 0 && <span className="text-muted" aria-hidden>·</span>}
                  <a href={spotUrl(m, d.spot!)} onClick={go(spotUrl(m, d.spot!))} className="text-spice hover:underline">{m === 'sh_arrakeen' ? t('Арракін') : t('Селище Харко')}</a>
                </Fragment>
              ))}
            </p>
          )}
          {win && reach === 'on' && (
            <p className="rounded-md bg-ok/10 px-2 py-1 text-[13px] text-ok">{me?.own ? t('Діє на тебе: твій дім — {house}.', { house: win.name }) : t('Діє на тебе: дім твоєї гільдії — {house}.', { house: win.name })}</p>
          )}
          {win && reach === 'off' && (
            <p className="rounded-md bg-panel2 px-2 py-1 text-[13px]">{t('Указ діє лише для {house} — на тебе не поширюється.', { house: win.of })}</p>
          )}
          {win && reach === 'unknown' && (
            <p className="rounded-md bg-panel2 px-2 py-1 text-[13px]">
              {t('Діє указ «{name}» для {house}.', { name: d.name, house: win.of })}{' '}
              {user
                ? <a href={`/u/${user.login}/settings`} onClick={go(`/u/${user.login}/settings`)} className="whitespace-nowrap text-spice hover:underline">{t('Вказати свій дім')}</a>
                : <span className="text-muted">{t('Увійди й вкажи свій дім — і калькулятор його врахує.')}</span>}
            </p>
          )}
          {(d.id === 'production' || d.id === 'refining') && reach === 'on' && (
            <p className="text-[12.5px] text-muted">{t('Калькулятор у довіднику вже рахує з цим указом.')}</p>
          )}
        </div>
      ) : (
        <p className="text-[13.5px] text-muted">{t('Указ цього тижня ще не вказано. Він діє на весь сервер і скидається з бурею.')}</p>
      )}
      {canSet && <a href="/admin/site-settings" className="text-[12.5px] text-spice hover:underline">{d ? t('Змінити в панелі керування') : t('Вказати в панелі керування')}</a>}
    </section>
  )
}

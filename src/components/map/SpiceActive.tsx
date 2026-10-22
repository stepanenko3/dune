/**
 * Картка поля меланжу: чи воно зараз активне (від першої позначки, яку видно, — строк і хто підтвердив) і кнопки
 * «Позначити активним» / «Зняти мою позначку» з видимістю: для себе, гільдії чи всіх. Гостям — лише стан і вхід.
 */
import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { toast } from 'sonner'
import { loginHref, useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { prefGet, prefSet } from '@/lib/prefs'
import { plainClick } from '@/lib/urlState'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { clockOf, namesText, spanText, useSpice, VIS_LABEL, type SpiceField, type SpiceSize, type SpiceVis } from '@/lib/map/spice'

const PREF = 'map:spice-vis'
const TILE = 'inline-flex min-h-7 items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] leading-tight transition-colors [@media(pointer:coarse)]:min-h-9'

/** видимість нової позначки поза React (вибір місця великого поля на мапі) */
export function spiceVisNow(): SpiceVis {
  const v = prefGet<SpiceVis>(PREF, useAuth.getState().guilds.length ? 'guild' : 'private')
  return v === 'guild' && !useAuth.getState().guilds.length ? 'private' : v
}

/** видимість нової позначки: остання вибрана; гільдія — лише якщо людина в гільдії */
export function useSpiceVis(): [SpiceVis, (v: SpiceVis) => void, boolean] {
  const inGuild = useAuth((s) => s.guilds.length > 0)
  const [v, setV] = useState<SpiceVis>(() => prefGet<SpiceVis>(PREF, inGuild ? 'guild' : 'private'))
  const value = v === 'guild' && !inGuild ? 'private' : v
  return [value, (x) => { setV(x); prefSet(PREF, x) }, inGuild]
}

/** «зараз» з поправкою на годинник сервера; тікає щохвилини, поки картка відкрита */
function useNow() {
  const skew = useSpice((s) => s.skew)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(h) }, [])
  return now + skew
}

export function SpiceActive({ field, at }: { field: SpiceField | null; at: { map: string; layout: number | null; size: SpiceSize; x: number; y: number } }) {
  const user = useAuth((s) => s.user)
  const busy = useSpice((s) => s.busy)
  const [vis, setVis, inGuild] = useSpiceVis()
  const now = useNow()
  const mine = field?.mine ?? null
  const act = async (visibility: SpiceVis) => {
    try {
      await useSpice.getState().mark({ ...at, x: field?.x ?? at.x, y: field?.y ?? at.y, visibility })
    } catch (e) { toast.error((e as Error).message) }
  }
  const pickVis = (v: SpiceVis) => {
    setVis(v)
    // своя позначка вже є — міняємо їй видимість одразу
    if (mine && mine.visibility !== v) void act(v)
  }
  const unmark = async () => {
    if (!mine) return
    try { await useSpice.getState().unmark(mine.id) } catch (e) { toast.error((e as Error).message) }
  }
  const shown = mine?.visibility ?? vis
  return (
    <div className="mt-2 rounded-md border border-line bg-panel2/40 p-2">
      {field ? (
        <>
          <div className="flex items-center gap-1.5 font-semibold text-spice">
            <span className="spice-dot" aria-hidden /> {t('Активне поле')}
            <span className="ml-auto text-[10.5px] font-normal text-muted">{VIS_LABEL[field.vis]}</span>
          </div>
          <div className="mt-1 grid gap-0.5 text-[11.5px] leading-snug">
            <div>{t('Позначено о {time} · {ago} тому', { time: clockOf(field.first), ago: spanText(now - field.first) })}</div>
            <div className="text-muted">
              {field.expires > now ? t('Ймовірно зникне ≈ {time} (через {left})', { time: clockOf(field.expires), left: spanText(field.expires - now) }) : t('Строк минув')}
            </div>
            <div className="break-words">{t('Позначили {n}: {names}', { n: field.n, names: namesText(field) })}</div>
          </div>
        </>
      ) : (
        <div className="text-[11.5px] text-muted">{t('Ніхто не позначив це поле активним (з тих позначок, що тобі видно).')}</div>
      )}
      {user ? (
        <>
          <div role="radiogroup" aria-label={t('Хто бачить мою позначку')} className="mt-2 flex flex-wrap gap-1">
            {(['private', 'guild', 'public'] as const).map((v) => {
              const locked = v === 'guild' && !inGuild
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={shown === v}
                  disabled={locked || busy}
                  onClick={() => pickVis(v)}
                  data-tip={locked ? t('Ти не в гільдії') : undefined}
                  className={cn(TILE, shown === v ? 'border-spice/60 bg-spice/10 font-semibold text-spice' : 'border-line/80 bg-panel2/40 text-ink/85 hover:border-spice/40', locked && 'cursor-not-allowed opacity-50')}
                >
                  {locked && <Lock size={11} aria-hidden />}
                  {VIS_LABEL[v]}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {mine ? (
              <button type="button" disabled={busy} onClick={unmark} className={cn('h-7 rounded-md border border-line px-2.5 text-[11.5px] font-medium hover:bg-panel2 [@media(pointer:coarse)]:h-10')}>
                {t('Зняти мою позначку')}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void act(vis)} className={cn('h-7 rounded-md border border-spice/60 bg-spice/10 px-2.5 text-[11.5px] font-semibold text-spice hover:bg-spice/20 [@media(pointer:coarse)]:h-10')}>
                {field ? t('Підтвердити: активне') : t('Позначити активним')}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="mt-2 text-[11.5px]">
          <a href={loginHref()} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); useStore.getState().setView('login', { search: `?next=${encodeURIComponent(location.pathname + location.search)}` }) }} className="text-spice underline-offset-2 hover:underline">{t('Увійди')}</a>, {t('щоб позначати активні поля.')}
        </div>
      )}
    </div>
  )
}

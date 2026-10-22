/**
 * 3D-вкладка: сцена view3d.js у .three-wrap, камери, поверхи, зріз і прапорці. Камера й зріз — в адресі (?cam=,
 * ?cut=), тож вигляд можна переслати посиланням і «назад» його повертає.
 * Сцену створюємо ліниво, коли вкладку вперше показали, і тримаємо в контексті бази (не більше кількох живих —
 * ctx.ts, touchView): StrictMode двічі монтує ефект — другий раз просто знаходить готову сцену. Браузер забрав
 * контекст WebGL — сцена створюється наново (двічі поспіль — показуємо, що 3D недоступне).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { VIEW3D } from '@/lib/engine'
import { Check, Seg } from '@/components/ui/seg'
import { locale, t } from '@/lib/i18n'
import { useUrlParam } from '@/lib/urlState'
import { cn } from '@/lib/utils'
import { FULL_CLASS, FullscreenButton, useFullscreen } from '@/lib/fullscreen'
import { dropView, opts3d, touchView, type BaseCtx, type Cam } from './ctx'
import { levelName } from './tr'

const CAMS: { id: Cam; label: string }[] = [
  { id: 'quarter', label: '3/4' },
  { id: 'front', label: t('Фронт') },
  { id: 'back', label: t('Тил') },
  { id: 'top', label: t('Зверху') },
]
/** палець (телефон, планшет) — інша підказка, ніж миша */
const touch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

export function ThreeView({ C }: { C: BaseCtx }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  // нова сцена після втрати контексту
  const [gen, setGen] = useState(0)
  // камера за замовчуванням — та, з якою відкрили сцену, і не міняється з кожним перемиканням: якби вона йшла за C.cam,
  // вибір «старого замовчування» прибирав би ?cam з адреси, хук брав би нове замовчування — і вид стрибав би туди-сюди
  const camDef = useMemo(() => C.cam, [C])
  const [cam, setCamUrl, camHref] = useUrlParam<Cam>('cam', camDef, (v) => CAMS.some((c) => c.id === v))
  // зріз: «all» — уся база; число — висота (крок 0,25)
  const [cutRaw, setCutUrl] = useUrlParam<string>('cut', 'all', (v) => v === 'all' || (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) < C.UI.all))
  const cut = cutRaw === 'all' ? C.UI.all : Number(cutRaw)
  const [o, setO] = useState({ ...opts3d })
  const outer = useRef<HTMLDivElement>(null)
  const full = useFullscreen(outer)

  // «тільки плити» завжди показує один поверх (крім «уся база») — та сама логіка, що в app.js
  const floorFor = (v: number, iso: boolean, found: boolean) => {
    if ((!iso && !found) || v >= C.UI.all) return -1
    const lv = C.M.levels.filter((l: any) => l.z0 < v - 0.05)
    const z = (lv[lv.length - 1] || C.M.levels[0]).z0
    return z > 0 ? z - 0.009 : -1 // між карнизами (−0.02) і дахами (−0.004), не на плиті
  }
  const applyCut = (v: number, opt = o) => {
    C.cut = v
    if (C.view) C.view.setCut(v >= C.UI.all ? 99 : v, floorFor(v, opt.iso, opt.found))
  }
  // повзунок — замість поточного кроку історії (інакше «назад» ішов би по кожному зсуву); кнопки поверхів — новий крок
  const setCut = (v: number, replace = false) => setCutUrl(v >= C.UI.all ? 'all' : String(Math.round(v * 100) / 100), { replace })
  const setOpt = (k: keyof typeof opts3d, v: boolean) => {
    const next = { ...o, [k]: v }
    opts3d[k] = v
    setO(next)
    const view = C.view
    if (view) {
      if (k === 'interior') view.setInterior(v)
      if (k === 'found') view.setFoundation(v)
      if (k === 'tiles') view.setTileColors(v)
      if (k === 'labels') view.setLabels(v)
    }
    if (k === 'iso' || k === 'found') applyCut(C.cut, next)
  }

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    if (!C.view) {
      try {
        const box = document.createElement('div')
        box.className = 'three-base'
        const v = VIEW3D.create(box, {
          // браузер забрав контекст (забагато сцен, сон вкладки): сцену — наново; кілька разів поспіль — здаємось
          onContextLost: () => setTimeout(() => {
            if (C.view !== v) return
            dropView(C)
            C.lost = (C.lost || 0) + 1
            if (C.lost > 2) setFailed(true)
            else setGen((g) => g + 1)
          }),
        }, C.M)
        v.setView(C.cam)
        C.view = v
        C.box = box
      } catch {
        setFailed(true)
        return
      }
    }
    touchView(C)
    const view = C.view!
    el.appendChild(C.box!)
    view.setInterior(opts3d.interior)
    view.setFoundation(opts3d.found)
    view.setTileColors(opts3d.tiles)
    view.setLabels(opts3d.labels)
    view.setCut(C.cut >= C.UI.all ? 99 : C.cut, floorFor(C.cut, opts3d.iso, opts3d.found))
    // старт — наступним кадром: stop() не скасовує вже запланований кадр, і негайний start()
    // після stop() (StrictMode, швидке перемикання вкладок) запустив би два цикли рендеру
    const raf = requestAnimationFrame(() => view.start())
    // сцену не знищуємо: зупиняємо цикл кадрів і виймаємо з DOM до наступного показу
    return () => {
      cancelAnimationFrame(raf)
      view.stop()
      C.box?.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [C, gen])

  // камера й зріз з адреси (зокрема «назад» / «вперед») — у сцену
  useEffect(() => {
    if (C.cam !== cam) { C.cam = cam; C.view?.setView(cam) }
  }, [C, cam])
  useEffect(() => {
    if (Math.abs(C.cut - cut) > 1e-6) applyCut(cut)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [C, cut])

  const cutKey = Object.keys(C.cuts).find((k) => Math.abs(C.cuts[k][0] - cut) < 0.01) || ''
  const cutLabel = cut >= C.UI.all ? t('усе') : '+' + Number(cut).toLocaleString(locale(), { maximumFractionDigits: 2 })

  return (
    <div ref={outer} className={cn(full.on && FULL_CLASS)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel2/40 px-3 py-2.5">
        <Seg<Cam> label={t('Камера')} value={cam} onChange={(c) => setCamUrl(c)} href={camHref} items={CAMS} />
        <Seg<string>
          label={t('Поверх')}
          value={cutKey}
          onChange={(k) => setCut(C.cuts[k][0])}
          items={Object.keys(C.cuts).map((k) => ({ id: k, label: k === 'cut-all' ? t('Уся база') : levelName(C.UI.cutButtons[k]) }))}
        />
        <Check checked={o.iso} onChange={(v) => setOpt('iso', v)}>{t('Лише цей поверх')}</Check>
        {/* на телефоні повзунок — окремим рядком на всю ширину; підпис значення — сталої ширини (найширший із можливих):
            інакше, поки тягнеш, «+5,25» ↔ «усе» міняє ширину, рядок перескладається і повзунок стрибає з-під пальця */}
        <label className="flex w-full items-center gap-2 text-[12.5px] text-muted sm:inline-flex sm:w-auto">
          {t('Зріз')}
          <input
            type="range"
            min={0.5}
            max={C.UI.all}
            step={0.25}
            value={cut}
            onChange={(e) => setCut(Number(e.target.value), true)}
            className="min-w-0 flex-1 accent-[rgb(var(--c-spice))] sm:w-[170px] sm:flex-none"
          />
          <span className="grid font-mono text-[13px] font-semibold tabular-nums text-ink">
            <span className="invisible col-start-1 row-start-1" aria-hidden>{t('усе')}</span>
            <span className="invisible col-start-1 row-start-1" aria-hidden>+{(Math.floor(C.UI.all) + 0.75).toLocaleString(locale(), { maximumFractionDigits: 2 })}</span>
            <span className="col-start-1 row-start-1">{cutLabel}</span>
          </span>
        </label>
        <Check checked={o.found} onChange={(v) => setOpt('found', v)}>{t('Тільки плити підлоги')}</Check>
        <Check checked={o.interior} onChange={(v) => setOpt('interior', v)}>{t('Обладнання всередині')}</Check>
        <Check checked={o.tiles} onChange={(v) => setOpt('tiles', v)}>{t('Кольори плиток')}</Check>
        <Check checked={o.labels} onChange={(v) => setOpt('labels', v)}>{t('Підписи')}</Check>
        <FullscreenButton {...full} className="ml-auto" />
      </div>
      <div className={cn('three-wrap', full.on && '!h-auto min-h-0 flex-1')} ref={wrap}>
        {failed && <div className="three-msg">{t('Не вдалося показати 3D. Онови сторінку — план працює й без нього.')}</div>}
      </div>
      <div className="border-t border-line px-3.5 py-2.5 text-[13px] text-muted">
        <span>{touch() ? t('Пальцем — обертання, двома пальцями — масштаб і зсув.') : t('Мишею — обертання, колесо — масштаб, права кнопка — зсув.')}</span>
      </div>
    </div>
  )
}

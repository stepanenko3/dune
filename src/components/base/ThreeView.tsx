/**
 * 3D-вкладка: сцена view3d.js у .three-wrap, камери, поверхи, зріз і прапорці.
 * Сцену створюємо ліниво, коли вкладку вперше показали, і тримаємо в контексті бази:
 * StrictMode двічі монтує ефект — другий раз просто знаходить готову сцену.
 */
import { useEffect, useRef, useState } from 'react'
import { VIEW3D } from '@/lib/engine'
import { Check, Seg } from '@/components/ui/seg'
import { opts3d, type BaseCtx, type Cam } from './ctx'

const CAMS: { id: Cam; label: string }[] = [
  { id: 'quarter', label: '3/4' },
  { id: 'front', label: 'Фронт' },
  { id: 'back', label: 'Тил' },
  { id: 'top', label: 'Зверху' },
]

export function ThreeView({ C }: { C: BaseCtx }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const [cut, setCutState] = useState(C.cut)
  const [cam, setCam] = useState(C.cam)
  const [o, setO] = useState({ ...opts3d })

  // «тільки плити» завжди показує один поверх (крім «уся база») — та сама логіка, що в app.js
  const floorFor = (v: number, iso: boolean, found: boolean) => {
    if ((!iso && !found) || v >= C.UI.all) return -1
    const lv = C.M.levels.filter((l: any) => l.z0 < v - 0.05)
    const z = (lv[lv.length - 1] || C.M.levels[0]).z0
    return z > 0 ? z - 0.009 : -1 // між карнизами (−0.02) і дахами (−0.004), не на плиті
  }
  const setCut = (v: number, opt = o) => {
    C.cut = v
    setCutState(v)
    if (C.view) C.view.setCut(v >= C.UI.all ? 99 : v, floorFor(v, opt.iso, opt.found))
  }
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
    if (k === 'iso' || k === 'found') setCut(C.cut, next)
  }

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    if (!C.view) {
      try {
        const box = document.createElement('div')
        box.className = 'three-base'
        C.view = VIEW3D.create(box, {}, C.M)
        C.box = box
      } catch {
        setFailed(true)
        return
      }
    }
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
  }, [C])

  const cutKey = Object.keys(C.cuts).find((k) => Math.abs(C.cuts[k][0] - cut) < 0.01) || ''
  const cutLabel = cut >= C.UI.all ? 'усе' : '+' + Number(cut).toFixed(2).replace(/\.?0+$/, '')

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel2/40 px-3 py-2.5">
        <Seg<Cam>
          label="Камера"
          value={cam}
          onChange={(c) => {
            C.cam = c
            setCam(c)
            C.view?.setView(c)
          }}
          items={CAMS}
        />
        <Seg<string>
          label="Поверх"
          value={cutKey}
          onChange={(k) => setCut(C.cuts[k][0])}
          items={Object.keys(C.cuts).map((k) => ({ id: k, label: k === 'cut-all' ? 'Уся база' : C.UI.cutButtons[k] }))}
        />
        <Check checked={o.iso} onChange={(v) => setOpt('iso', v)}>Лише цей поверх</Check>
        <label className="inline-flex items-center gap-2 text-[12.5px] text-muted">
          Зріз
          <input
            type="range"
            min={0.5}
            max={C.UI.all}
            step={0.25}
            value={cut}
            onChange={(e) => setCut(Number(e.target.value))}
            className="w-[150px] accent-[rgb(var(--c-spice))] sm:w-[170px]"
          />
          <span className="min-w-[5ch] font-mono text-[13px] font-semibold tabular-nums text-ink">{cutLabel}</span>
        </label>
        <Check checked={o.found} onChange={(v) => setOpt('found', v)}>Тільки плити підлоги</Check>
        <Check checked={o.interior} onChange={(v) => setOpt('interior', v)}>Обладнання всередині</Check>
        <Check checked={o.tiles} onChange={(v) => setOpt('tiles', v)}>Кольори плиток</Check>
        <Check checked={o.labels} onChange={(v) => setOpt('labels', v)}>Підписи</Check>
      </div>
      <div className="three-wrap" ref={wrap}>
        {failed && <div className="three-msg">Не вдалося завантажити three.js. Онови сторінку — план працює без нього.</div>}
      </div>
      <div className="border-t border-line px-3.5 py-2.5 text-[13px] text-muted">
        <span>Мишею — обертання, колесо — масштаб, права кнопка — зсув.</span>
      </div>
    </div>
  )
}

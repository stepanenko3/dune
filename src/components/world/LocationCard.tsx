/**
 * Картка місця карти світу: категорія гри, назва й опис з гри, підказка діалогу переходу, для групи чи ні, детальна
 * мапа (якщо вона є на сайті), і переходи — як дістатися сюди й куди звідси (з умовами гри). Назви інших місць —
 * посилання на їхні картки.
 */
import type { ReactNode } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Car, Map as MapIcon, Plane, Users } from 'lucide-react'
import { T, t } from '@/lib/i18n'
import { plainClick } from '@/lib/urlState'
import { cn } from '@/lib/utils'
import { MAP_ORDER } from '@/lib/map/data'
import { openPath } from '@/store'
import { catColor, catName, fromOverland, isEdge, isPad, linkReqs, linksOf, type World, type WorldLink, type WorldLoc } from '@/lib/world'

/** посилання на картку іншого місця */
function Place({ w, id, hrefOf, onPick }: { w: World; id: string; hrefOf: (id: string) => string; onPick: (id: string) => void }) {
  const l = w.locations.find((x) => x.id === id)
  if (!l) return null
  return (
    <a href={hrefOf(id)} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); onPick(id) }} className="font-semibold text-ink underline decoration-line underline-offset-[3px] hover:text-spice hover:decoration-spice">
      {l.name}
    </a>
  )
}

/** умови переходу: варіанти через «або», умови варіанта — плашками */
function Reqs({ link }: { link: WorldLink }) {
  const opts = linkReqs(link)
  if (!opts.length) return <p className="text-[12.5px] text-ok">{t('Без умов')}</p>
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {opts.map((o, i) => (
        <span key={i} className="contents">
          {i > 0 && <span className="text-[12px] text-muted">{t('або')}</span>}
          {o.map((s) => <span key={s} className="max-w-full break-words rounded-md border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[12px] leading-snug text-ink">{s}</span>)}
        </span>
      ))}
    </div>
  )
}

function Step({ icon, title, children }: { icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2 gap-y-1 py-2">
      <span className="mt-0.5 text-muted" aria-hidden>{icon}</span>
      <div className="grid min-w-0 gap-1">
        <p className="break-words text-[13.5px] leading-snug">{title}</p>
        {children}
      </div>
    </li>
  )
}

/** bare — без власної рамки (усередині панелі мапи) */
export function LocationCard({ w, loc, hrefOf, onPick, bare }: { w: World; loc: WorldLoc; hrefOf: (id: string) => string; onPick: (id: string) => void; bare?: boolean }) {
  const { into, out } = linksOf(w, loc.id)
  const place = (id: string) => <Place w={w} id={id} hrefOf={hrefOf} onPick={onPick} />
  const isOverland = loc.id === w.overland
  const map = loc.map && MAP_ORDER.includes(loc.map) ? loc.map : null
  const toOverland = out.some((l) => l.to === w.overland)
  const reach = fromOverland(w).filter((l) => l.to !== loc.id)

  /** сюди: з карти поверхні, таксі чи з іншого місця */
  const intoStep = (l: WorldLink) => {
    if (l.mode === 'taxi') return (
      <Step key={l.from + l.mode} icon={<Car size={16} />} title={<T text="Таксі-орнітоптер — {place}" place={place(l.from)} />}>
        <p className="text-[12.5px] text-muted">{t('Пілоти орнітоптерів за плату возять між поселеннями й торговими постами.')}{l.points > 1 ? ' ' + t('Посадок тут: {n}.', { n: l.points }) : ''}</p>
      </Step>
    )
    if (l.from === w.overland) return (
      <Step key={l.from} icon={<Plane size={16} />} title={<T text="{place} — долетіти орнітоптером до кола посадки" place={place(l.from)} />}>
        {(l.points > 1 || l.dimension) && (
          <p className="text-[12.5px] text-muted">
            {l.points > 1 ? t('Точок прибуття: {n} — по краях мапи.', { n: l.points }) : ''}{l.points > 1 && l.dimension ? ' ' : ''}
            {l.dimension ? t('Перед переходом вибираєш інстанс (сервер) — PvE чи PvP.') : ''}
          </p>
        )}
        <Reqs link={l} />
      </Step>
    )
    return <Step key={l.from} icon={<ArrowDownToLine size={16} />} title={<T text="{place}" place={place(l.from)} />}><Reqs link={l} /></Step>
  }
  /** звідси: на карту поверхні, таксі чи до іншого місця */
  const outStep = (l: WorldLink) => {
    if (l.mode === 'taxi') return <Step key={l.to + l.mode} icon={<Car size={16} />} title={<T text="Таксі-орнітоптер — {place}" place={place(l.to)} />} />
    if (l.to === w.overland) return (
      <Step key={l.to} icon={<ArrowUpFromLine size={16} />} title={<T text="{place}" place={place(l.to)} />}>
        <p className="text-[12.5px] text-muted">
          {isEdge(l) ? t('Вилетіти за край мапи на літальному апараті.') : isPad(l) ? t('Злетіти на своєму орнітоптері зі стоянки.') : t('Через вихід із цього місця.')}
          {loc.exits.length > 1 ? ' ' + t('Виходів на карту поверхні: {n} (ромбики на схемі).', { n: loc.exits.length }) : ''}
        </p>
        <Reqs link={l} />
      </Step>
    )
    return <Step key={l.to} icon={<ArrowUpFromLine size={16} />} title={<T text="{place}" place={place(l.to)} />}><Reqs link={l} /></Step>
  }

  return (
    <section aria-labelledby="wm-card-title" className={cn('grid grid-cols-[minmax(0,1fr)] gap-3', bare ? 'px-3 py-3' : 'rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sm')}>
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          {!isOverland && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2/70 px-1.5 py-0.5 font-medium text-muted">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: catColor(loc.tag) }} aria-hidden />
              {catName(w, loc.tag)}
            </span>
          )}
          {loc.group === 'party' && <span className="inline-flex items-center gap-1 rounded-md border border-line bg-panel2/70 px-1.5 py-0.5 font-medium text-muted"><Users size={12} aria-hidden />{t('Для групи')}</span>}
        </div>
        <h2 id="wm-card-title" className="break-words font-display text-[20px] font-bold leading-tight">{loc.name}</h2>
        {loc.title && loc.title !== loc.name && <p className="break-words text-[13px] text-muted">{loc.title}</p>}
      </div>
      {loc.desc && <p className="break-words text-[14px] leading-relaxed">{loc.desc}</p>}
      {isOverland && w.about.map((s) => <p key={s} className="break-words text-[14px] leading-relaxed">{s}</p>)}
      {loc.note && <p className="break-words rounded-lg bg-panel2/70 px-3 py-2 text-[13px] italic text-muted">«{loc.note}»</p>}
      {loc.hidden && <p className="break-words text-[13px] text-spice">{t('На карті поверхні в грі це місце видно лише тоді, коли воно потрібне за сюжетом.')}</p>}
      {!loc.pos && !isOverland && <p className="break-words text-[13px] text-muted">{t('Окремої позначки на карті поверхні нема — сюди переносить перехід.')}</p>}
      {map && (
        <div>
          <a href={`/map?m=${map}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); openPath(`/map?m=${map}`) }}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-[13px] font-medium shadow-sm hover:border-spice/60 hover:text-spice">
            <MapIcon size={15} aria-hidden />{t('Детальна мапа')}
          </a>
        </div>
      )}

      {!isOverland && into.length > 0 && (
        <div>
          <h3 className="font-display text-[14px] font-bold">{t('Як дістатися')}</h3>
          <ul className="divide-y divide-line">{into.map(intoStep)}</ul>
        </div>
      )}
      {!isOverland && out.length > 0 && (
        <div>
          <h3 className="font-display text-[14px] font-bold">{t('Куди звідси')}</h3>
          <ul className="divide-y divide-line">{out.map(outStep)}</ul>
        </div>
      )}
      {(isOverland || toOverland) && reach.length > 0 && (
        <div className="grid gap-1.5">
          <h3 className="font-display text-[14px] font-bold">{isOverland ? t('Куди можна долетіти') : t('Далі картою поверхні')}</h3>
          {!isOverland && <p className="text-[12.5px] text-muted">{t('З карти поверхні — до будь-якого з цих місць (лінії на схемі; пунктир — з умовою).')}</p>}
          <ul className="flex flex-wrap gap-1.5">
            {reach.map((l) => (
              <li key={l.to} className="max-w-full">
                <a href={hrefOf(l.to)} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); onPick(l.to) }}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-panel2/60 px-2 py-1 text-[12.5px] hover:border-spice/60 hover:text-spice">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: catColor(w.locations.find((x) => x.id === l.to)?.tag ?? null) }} aria-hidden />
                  <span className="break-words">{w.locations.find((x) => x.id === l.to)?.name}</span>
                  {linkReqs(l).length > 0 && <span className="text-warn" title={linkReqs(l).map((o) => o.join(', ')).join(' / ')}>*</span>}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

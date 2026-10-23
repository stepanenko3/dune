/**
 * Головна: «вікно» на Глибоку пустелю цього тижня (справжні тайли, сітка секторів, скан, що
 * проявляє меланж і титан; активні поля меланжу пульсують), під ним — що корисного зараз у пустелі, найближчі події
 * спільноти, розділи застосунку і стан записів про ресурси. Числа — з /api/home, тобто з тих самих даних, що й мапа для
 * поточної розкладки: точки з джерела мапи, великі поля — ще й місця з файлів гри та позначок гравців, активні поля — ті,
 * що бачить людина.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Castle, Check, Map as MapIcon, TrendingUp } from 'lucide-react'
import { useStore } from '@/store'
import { emptyPState, statusOf, type PState, type RoadmapDoc } from '@/lib/roadmap'
import { useAuth } from '@/lib/auth'
import { thumbUrl, useBases } from '@/lib/bases'
import { StormCard, StormLeft } from '@/components/DDTimer'
import { DecreeCard } from '@/components/DecreeCard'
import { UpcomingEvents } from '@/components/events/bits'
import { cn, fmtP, plural, splitEn, word } from '@/lib/utils'
import { locale, t, T } from '@/lib/i18n'
import { get } from '@/lib/api'
import { plainClick } from '@/lib/urlState'
import { DataStamp } from '@/components/DataStamp'
import { Button } from '@/components/ui/button'
import { ErrorAlert } from '@/components/states'
import { SnSkeleton } from '@/components/sn'
import { prefGet } from '@/lib/prefs'
import type { ModelKey, ScanLine } from './Orni3D'
import { DesertScan, type ScanDot } from './DesertScan'
import './home.css'
import { DuneLoading } from '@/components/ui/dune-loader'
import { clockOf, spanText } from '@/lib/map/spice'
import { Img } from '@/components/ui/img'

interface HomeData {
  dd: {
    layout: number
    layouts: number
    since: string | null
    tiles: string
    bounds: [[number, number], [number, number]]
    transformation: [number, number, number, number]
    /** id шарів мапи (посилання «відкрити шар на мапі») */
    layers: Record<'titanium' | 'stravidium' | 'spice_small' | 'spice_medium' | 'spice_large' | 'shipwreck' | 'ecolab' | 'cave', string>
    counts: Record<string, number>
    /** найкращі сектори [сектор, вузлів, 1 — чистий острівець руди]: острівці — першими */
    top: Record<'titanium' | 'stravidium' | 'spice_medium' | 'spice_large', [string, number, 1?][]>
    dots: Record<'spice_large' | 'spice_medium' | 'spice_small' | 'titanium' | 'stravidium', [number, number][]>
    /** меланж: точка, звідки в межах радіуса найбільше середніх і великих полів */
    spiceSpot?: { x: number; y: number; n: number; large: number; radius: number; sector: string | null } | null
  } | null
  /** активні поля меланжу, які бачить людина (позначки гравців): окремо від тижня — міняються щохвилини */
  active: Active | null
  places: { total: number; ok: number; recent: { id: string; res: string; place: string; zone: string; ok: boolean; updated: number }[] }
  syncedAt: string
}

type Active = { now: number; total: number; fields: { size: 'small' | 'medium' | 'large'; x: number; y: number; sector: string | null; first: number; expires: number; n: number }[] }
type Go = (v: 'bases' | 'roadmap' | 'map', search?: string) => (e: React.MouseEvent) => void

// сцена орні/дрона — three.js і понад сотню КБ свого коду: окремим шматком, щоб головна з'являлась, не чекаючи на неї
const Orni3D = lazy(() => import('./Orni3D').then((m) => ({ default: m.Orni3D })))

const ZONE = { hagga: t('Хагга'), dd: t('Глибока пустеля'), city: t('Місто') } as Record<string, string>
/** мапа, де показувати запис ресурсу з цієї зони */
const ZONE_MAP: Record<string, string> = { hagga: 'survival_1', dd: 'deepdesert_1', city: 'sh_arrakeen' }
/** «сьогодні», «вчора», «5 днів тому» — мовою людини, з правильною формою слова */
const ago = (at: number) => {
  const d = Math.round((Date.now() - at) / 86400000)
  if (d <= 0) return t('сьогодні')
  try { return new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' }).format(-d, 'day') } catch { return t('{n} дн. тому', { n: d }) }
}
/** «5 вузлів», «1 велике поле»: слово за числом — форми вже перекладені */
const nodes = (n: number) => plural(n, [t('вузол'), t('вузли'), t('вузлів')])
const bigFields = (n: number) => plural(n, [t('велике поле'), t('великі поля'), t('великих полів')])
const midFields = (n: number) => plural(n, [t('середнє поле'), t('середні поля'), t('середніх полів')])

export function Home() {
  const [data, setData] = useState<HomeData | null>(null)
  const [failed, setFailed] = useState(false)
  const setView = useStore((s) => s.setView)
  // орні (модель на 3 МБ, шейдери) — після скану мапи: на телефоні його завантаження займає сторінку на секунду-дві, і
  // скан би стояв; мапи не видно — не довше кількох секунд
  const [orniGo, setOrniGo] = useState(false)
  const onScanned = useCallback(() => setOrniGo(true), [])
  useEffect(() => {
    const h = setTimeout(() => setOrniGo(true), 4500)
    return () => clearTimeout(h)
  }, [])
  const reload = useRef<() => void>(() => {})
  useEffect(() => {
    let last = ''
    const load = () =>
      fetch('/api/home')
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .then((body) => {
          if (body === last) return
          last = body
          setFailed(false)
          // тиждень Глибокої пустелі той самий — той самий об'єкт: скан мапи не програється заново
          setData((prev) => {
            const next = JSON.parse(body) as HomeData
            if (prev?.dd && next.dd && JSON.stringify(prev.dd) === JSON.stringify(next.dd)) next.dd = prev.dd
            return next
          })
        })
        .catch(() => { if (!last) setFailed(true) })
    reload.current = () => { setFailed(false); load() }
    load()
    // відкрита сторінка сама підхоплює новий тиждень (нову розкладку TH.GL виставляє не одразу після бурі, а сервер
    // сам її перевіряє): перепитуємо раз на 5 хв і щоразу, коли вкладка знову на екрані
    const h = setInterval(() => { if (!document.hidden) load() }, 5 * 60_000)
    const vis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(h); document.removeEventListener('visibilitychange', vis) }
  }, [])
  const go: Go = (v, search) => (e) => {
    // Ctrl/⌘/середня кнопка — браузер сам відкриє посилання в новій вкладці
    if (!plainClick(e)) return
    e.preventDefault()
    setView(v, search ? { search } : undefined)
  }
  const dd = data?.dd

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <section className="home-hero relative overflow-hidden rounded-2xl px-5 py-7 sm:px-9 sm:py-10 lg:py-12">
          <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] lg:gap-12">
            <div className="home-lead max-w-[34rem]">
              <h1 className="home-word">Sandwalkers</h1>
              <p className="mt-5 max-w-[30rem] text-[16px] leading-relaxed text-[rgb(235_220_196/0.78)]">
                {t('Для гравців Dune: Awakening — самих і гільдією. Бази з планом, 3D і кошторисом, роадмапи, білди умінь і мапа всього, що є на Арракісі, з твоїми й гільдійськими позначками поверх. Найкраще люди викладають у бібліотеку.')}
              </p>
              <div className="mt-7 flex flex-wrap gap-2.5">
                <a href="/map" onClick={go('map')} className="inline-flex h-11 items-center gap-2 rounded-lg bg-spice px-5 text-[14px] font-semibold text-on-spice transition-colors hover:bg-spice/90">
                  <MapIcon size={17} /> {t('Відкрити мапу')}
                </a>
                <a href="/bases" onClick={go('bases')} className="inline-flex h-11 items-center gap-2 rounded-lg border border-[rgb(235_220_196/0.25)] px-5 text-[14px] font-semibold text-[rgb(235_220_196)] transition-colors hover:bg-[rgb(235_220_196/0.08)]">
                  <Castle size={17} /> {t('Бази')}
                </a>
              </div>
            </div>
            {dd ? <DesertWindow dd={dd} active={data?.active ?? null} onScanned={onScanned} /> : <div className={cn('home-map w-full max-w-[520px] justify-self-end bg-[rgb(255_255_255/0.04)]', !failed && 'animate-pulse')} aria-hidden />}
          </div>
        </section>

        {dd && <OrniSection dd={dd} start={orniGo} />}

        {failed && (
          <ErrorAlert title={t('Зведення тижня не завантажилось')} message={t('Тому тут не видно Глибокої пустелі цього тижня. Спробуй ще раз за хвилину.')}>
            <Button size="xs" variant="outline" className="mt-2" onClick={() => reload.current()}>{t('Спробувати ще')}</Button>
          </ErrorAlert>
        )}

        {/* тиждень: коли буря і який указ — окремими картками */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 md:grid-cols-2">
          <StormCard since={dd?.since} />
          <DecreeCard />
        </div>

        {/* події спільноти: найближчі бої, турніри, збори */}
        <UpcomingEvents onNew={() => { if (useAuth.getState().user) setView('events', { param: 'new' }); else setView('login', { search: `?next=${encodeURIComponent('/events/new')}` }) }} />

        {dd && <WeekSection dd={dd} active={data?.active ?? null} go={go} />}

        <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <BasesTile go={go} />
          <div className="grid gap-2.5">
            <a href="/map" onClick={go('map')} className="group grid gap-2 rounded-xl border border-line bg-panel p-4 shadow-sm transition-colors hover:border-spice/50">
              <div className="flex items-center gap-2">
                <MapIcon size={18} className="text-spice" />
                <h2 className="font-display text-[16px] font-bold">{t('Мапа')}</h2>
                <ArrowRight size={16} className="ml-auto text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-spice" />
              </div>
              <p className="text-[13.5px] leading-snug text-muted">
                {t('Хагга, Глибока пустеля, Арракін, Харко і підземелля: руда, лут зі скринь, печери, уламки, торговці. Наведи на локацію — побачиш, що там випадає і яка руда поруч.')}
              </p>
            </a>
            <RoadmapTile go={go} />
          </div>
        </div>

        {data && data.places.total > 0 && <PlacesSection p={data.places} go={go} />}

        <p className="px-1 pb-2 text-[12px] text-muted">
          {t('Бази, записи про ресурси й позначки полів меланжу — від гравців сайту.')}
          <DataStamp sep sections={['maps', 'markers', 'items']} />
        </p>
      </div>
    </div>
  )
}

/** Кольори ресурсів — як у грі: титан сіро-сталевий, стравідій бірюзовий, меланж від жовтого до червоного. */
const RES = {
  titanium: { color: '#c9d3dd', name: t('титан') },
  stravidium: { color: '#45d3b8', name: t('стравідій') },
  spice: { color: '#ee8a2c', name: t('меланж') },
}

/**
 * Мапа Глибокої пустелі цього тижня: тайли z1, сітка секторів і точки, які проявляє скан (полотно DesertScan).
 * Після скану — найкращий сектор для титану, стравідію і меланжу, кожен своїм кольором.
 */
function DesertWindow({ dd, active, onScanned: scannedUp }: { dd: NonNullable<HomeData['dd']>; active: Active | null; onScanned: () => void }) {
  const [a, b, c, d] = dd.transformation
  const S = 1000 / 9
  // точки в координатах мапи 0…1000, шарами: титан, стравідій, меланж від малого до великого (великий — зверху).
  // Координати гри → частка квадрата тайлів: lat = x гри, lng = y гри
  const dots = useMemo(() => {
    const at = (list: [number, number][] | undefined, r: number, fill: string): ScanDot[] =>
      (list ?? []).map((p) => ({ x: ((a * p[1] + b) / 512) * 1000, y: ((c * p[0] + d) / 512) * 1000, r, fill }))
    return [
      ...at(dd.dots.titanium, 3.2, RES.titanium.color),
      ...at(dd.dots.stravidium, 3.2, RES.stravidium.color),
      ...at(dd.dots.spice_small, 3.6, '#f2c14e'),
      ...at(dd.dots.spice_medium, 6, '#ee8a2c'),
      ...at(dd.dots.spice_large, 8.5, '#d9481f'),
    ]
  }, [dd, a, b, c, d])
  // активні поля (позначки гравців, які бачить людина) — кільцями, що розходяться, як на мапі
  const pulses = (active?.fields ?? []).map((f) => ({ key: `${f.size}@${f.x}:${f.y}`, x: ((a * f.y + b) / 512) * 1000, y: ((c * f.x + d) / 512) * 1000, r: f.size === 'large' ? 15 : f.size === 'medium' ? 11 : 8 }))
  /** скан дійшов до низу — проступають найкращі сектори */
  const [scanned, setScanned] = useState(false)
  const onScanned = useCallback(() => { setScanned(true); scannedUp() }, [scannedUp])
  // меланж — найкраща точка (коло радіуса, у якому найбільше середніх і великих полів), а не сектор
  const ss = dd.spiceSpot
  const spot = ss ? { cx: ((a * ss.y + b) / 512) * 1000, cy: ((c * ss.x + d) / 512) * 1000, r: Math.abs((a * ss.radius) / 512) * 1000, text: t('меланж: {fields} поруч', { fields: plural(ss.n, [t('поле'), t('поля'), t('полів')]) }) } : null
  // руда: усі чисті острівці (сектори, де руда завжди одна), інакше — найкращий сектор
  const ore = (rows: [string, number, 1?][]) => { const isl = rows.filter((r) => r[2]); return isl.length ? isl : rows.slice(0, 1) }
  const best = [
    ...ore(dd.top.titanium).map((r) => ({ key: 'titanium:' + r[0], sector: r[0], text: t('титан {n}', { n: r[1] }), color: RES.titanium.color })),
    ...ore(dd.top.stravidium).map((r) => ({ key: 'stravidium:' + r[0], sector: r[0], text: t('стравідій {n}', { n: r[1] }), color: RES.stravidium.color })),
  ].filter(Boolean) as { key: string; sector: string; text: string; color: string }[]
  // підписи над клітинками; якщо клітинки однакові чи поруч — наступний підпис нижче, щоб не налазили
  const placed: { x: number; y: number; w: number }[] = []
  const labels = best.map((l, k) => {
    const r = l.sector.charCodeAt(0) - 65, col = Number(l.sector.slice(1)) - 1
    const X = col * S, Y = (8 - r) * S
    // ширина підпису Unbounded 24px ≈ 17 px на знак
    const w = (l.sector.length + 3 + l.text.length) * 17 + 16
    let ly = Y - 14
    const cx = Math.min(Math.max(X + S / 2, w / 2 + 8), 1000 - w / 2 - 8)
    while (placed.some((p) => Math.abs(p.y - ly) < 34 && Math.abs(p.x - cx) < (p.w + w) / 2)) ly += 36
    if (ly < 34) ly = Y + S + 32
    placed.push({ x: cx, y: ly, w })
    return { ...l, X, Y, lx: cx, ly, inset: k * 5 }
  })
  return (
    <div className="grid w-full max-w-[520px] gap-2.5 justify-self-center lg:justify-self-end">
      {/* усе про тиждень в одному місці: яка розкладка і скільки до бурі, що її змінить */}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[rgb(235_220_196/0.75)]">
        <span className="flex items-center gap-2">
          <span className="home-now inline-block h-2 w-2 shrink-0 rounded-full" aria-hidden />
          {t('Глибока пустеля — розкладка {n} з {total}', { n: dd.layout, total: dd.layouts })}
        </span>
        <StormLeft className="ml-auto" />
      </p>
      <figure className="home-map w-full" aria-label={t('Глибока пустеля, розкладка {n}: титан, стравідій і меланж', { n: dd.layout })}>
        {[0, 1].map((y) => [0, 1].map((x) => <img key={`${x}${y}`} src={`/map-tiles/${dd.tiles}/1/${y}/${x}.webp`} alt="" style={{ left: `${x * 50}%`, top: `${y * 50}%` }} />))}
        <svg viewBox="0 0 1000 1000" className="absolute inset-0 h-full w-full">
          <g stroke="rgb(28 19 12 / 0.35)" strokeWidth="1.5">
            {Array.from({ length: 8 }, (_, k) => (k + 1) * S).map((v) => (
              <g key={v}>
                <line x1={v} y1="0" x2={v} y2="1000" />
                <line x1="0" y1={v} x2="1000" y2={v} />
              </g>
            ))}
          </g>
        </svg>
        <DesertScan dots={dots} onDone={onScanned} />
        <svg viewBox="0 0 1000 1000" className="absolute inset-0 h-full w-full">
          <g className={cn('home-late', scanned && 'is-on')}>
            {labels.map((l) => (
              <rect key={'r' + l.key} x={l.X + 3 + l.inset} y={l.Y + 3 + l.inset} width={S - 6 - l.inset * 2} height={S - 6 - l.inset * 2} rx="6" fill="none" stroke={l.color} strokeWidth="4" />
            ))}
            {spot && <circle cx={spot.cx} cy={spot.cy} r={spot.r} fill="rgb(232 131 58 / 0.12)" stroke={RES.spice.color} strokeWidth="4" strokeDasharray="10 6" />}
            {pulses.map((p) => (
              <g key={p.key} className="home-field">
                <circle cx={p.x} cy={p.y} r={p.r} fill="#ee8a2c" stroke="rgb(28 19 12 / 0.8)" strokeWidth="3" />
                <circle cx={p.x} cy={p.y} r={p.r} fill="none" stroke="#ee8a2c" strokeWidth="4" className="home-field-ring" />
              </g>
            ))}
            {labels.map((l) => (
              <text key={'t' + l.key} x={l.lx} y={l.ly} textAnchor="middle" fill={l.color} stroke="rgb(28 19 12 / 0.9)" strokeWidth="7" paintOrder="stroke" style={{ font: '700 24px Unbounded, sans-serif' }}>
                {l.sector} · {l.text}
              </text>
            ))}
            {spot && (
              <text x={Math.min(Math.max(spot.cx, 180), 820)} y={spot.cy - spot.r - 12 < 30 ? spot.cy + spot.r + 34 : spot.cy - spot.r - 12} textAnchor="middle" fill={RES.spice.color} stroke="rgb(28 19 12 / 0.9)" strokeWidth="7" paintOrder="stroke" style={{ font: '700 24px Unbounded, sans-serif' }}>
                {spot.text}
              </text>
            )}
          </g>
        </svg>
      </figure>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[rgb(235_220_196/0.75)]" aria-label={t('Легенда')}>
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: RES.titanium.color }} />{t('Титан')}</li>
        <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: RES.stravidium.color }} />{t('Стравідій')}</li>
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#f2c14e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ee8a2c]" />
          <span className="h-3 w-3 rounded-full bg-[#d9481f]" />
          {t('Меланж: мале, середнє, велике поле')}
        </li>
        {pulses.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span className="home-now is-spice inline-block h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden />
            {t('Активне зараз (позначки гравців)')}
          </li>
        )}
      </ul>
    </div>
  )
}

/** Орнітоптер окремим блоком; моделі немає або WebGL недоступний — немає й блоку. */
function OrniSection({ dd, start }: { dd: NonNullable<HomeData['dd']>; start: boolean }) {
  const [missing, setMissing] = useState(false)
  const onMissing = useCallback(() => setMissing(true), [])
  const spice = dd.top.spice_large[0] ?? dd.top.spice_medium[0]
  const scan: ScanLine[] = [
    { label: t('тиждень'), value: t('розкладка {n}', { n: dd.layout }) },
    ...(dd.top.titanium[0] ? [{ label: t('титан'), value: t('{sector} — {count}', { sector: dd.top.titanium[0][0], count: nodes(dd.top.titanium[0][1]) }) }] : []),
    ...(dd.top.stravidium[0] ? [{ label: t('стравідій'), value: t('{sector} — {count}', { sector: dd.top.stravidium[0][0], count: nodes(dd.top.stravidium[0][1]) }) }] : []),
    ...(spice ? [{ label: t('меланж'), value: t('{sector} — {count}', { sector: spice[0], count: dd.top.spice_large[0] ? bigFields(spice[1]) : midFields(spice[1]) }) }] : []),
  ]
  if (missing) return null
  const aside = (model: ModelKey) =>
    model === 'drone' ? (
      <div className="max-w-[28rem]">
        <h2 id="h-orni" className="font-display text-[22px] font-bold text-[rgb(235_220_196)]">{t('Дрон-розвідник')}</h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-[rgb(235_220_196/0.75)]">
          {t('Покрути мишею. «Злетіти» — дрон прокидається, встає на ноги, присідає й відштовхується, а турбіни лягають горизонтально. У повітрі вмикається сканер: око дивиться вниз і покаже, де цього тижня найбільше титану, стравідію і меланжу. «Патрулювати» — дрон нахиляється й летить над дюнами.')}
        </p>
        <p className="mt-3 text-[12px] text-[rgb(235_220_196/0.45)]">
          <T
            text="Модель: {model} від {author}, {license}."
            model={<a className="underline hover:text-[rgb(235_220_196/0.8)]" href="https://sketchfab.com/3d-models/buster-drone-294e79652f494130ad2ab00a13fdbafd" target="_blank" rel="noopener">«Buster Drone»</a>}
            author={<a className="underline hover:text-[rgb(235_220_196/0.8)]" href="https://sketchfab.com/lavadragon" target="_blank" rel="noopener">LaVADraGoN</a>}
            license={<a className="underline hover:text-[rgb(235_220_196/0.8)]" href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>}
          />
        </p>
      </div>
    ) : (
      <div className="max-w-[28rem]">
        <h2 id="h-orni" className="font-display text-[22px] font-bold text-[rgb(235_220_196)]">{t('Орнітоптер')}</h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-[rgb(235_220_196/0.75)]">
          {t('Покрути мишею. «Злетіти» — крила розкриваються й розганяються, орні відривається від піску, опори й рампа ховаються. У повітрі вмикається сканер: він покаже, де цього тижня найбільше титану, стравідію і меланжу. Крила, опори й рампу можна рухати окремо кнопками під моделлю.')}
        </p>
        <p className="mt-3 text-[12px] text-[rgb(235_220_196/0.45)]">
          <T
            text="Модель: {model} від {author}, {license}."
            model={<a className="underline hover:text-[rgb(235_220_196/0.8)]" href="https://sketchfab.com/3d-models/atreides-ornithopter-dune-cf7ff8d98ed34258a041d5873291a3f2" target="_blank" rel="noopener">«Atreides ornithopter Dune»</a>}
            author={<a className="underline hover:text-[rgb(235_220_196/0.8)]" href="https://sketchfab.com/joanrafe15" target="_blank" rel="noopener">jorafe</a>}
            license={<a className="underline hover:text-[rgb(235_220_196/0.8)]" href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>}
          />
        </p>
      </div>
    )
  return (
    <section className="home-hero relative overflow-hidden rounded-2xl px-5 py-6 sm:px-9" aria-labelledby="h-orni">
      {/* шматок зі сценою (three.js) — теж лише після скану: поки він вантажиться й розбирається, на телефоні скан би стояв */}
      {start ? (
        <Suspense fallback={<OrniLoading aside={aside} />}>
          <Orni3D start scan={scan} onMissing={onMissing} aside={aside} />
        </Suspense>
      ) : (
        <OrniLoading aside={aside} />
      )}
    </section>
  )
}

/** поки вантажиться шматок сцени: та сама сітка й рамка, що в Orni3D до готовності моделі, — текст поруч не стрибає */
function OrniLoading({ aside }: { aside: (model: ModelKey) => React.ReactNode }) {
  const model: ModelKey = prefGet<string>('scene:model', 'orni') === 'drone' ? 'drone' : 'orni'
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="orni-stage">
        <div className="orni3d relative aspect-[16/10] w-full">
          <div className="absolute inset-0 grid place-items-center"><DuneLoading page label={t('Завантаження моделі…')} className="text-[rgb(235_220_196/0.7)]" /></div>
        </div>
      </div>
      <div className="lg:col-start-2 lg:row-start-1 lg:self-center">{aside(model)}</div>
    </div>
  )
}

/** Цей тиждень: де найбільше руди за секторами, скільки полів меланжу і місць із лутом. */
function WeekSection({ dd, active, go }: { dd: NonNullable<HomeData['dd']>; active: Active | null; go: Go }) {
  const L = dd.layers
  const lists: { title: string; count: (n: number) => string; rows: [string, number, 1?][]; layer: string; total: number }[] = [
    { title: t('Титан'), count: nodes, rows: dd.top.titanium, layer: L.titanium, total: dd.counts.titanium },
    { title: t('Стравідій'), count: nodes, rows: dd.top.stravidium, layer: L.stravidium, total: dd.counts.stravidium },
    { title: t('Середні поля меланжу'), count: (n) => plural(n, [t('поле'), t('поля'), t('полів')]), rows: dd.top.spice_medium, layer: `${L.spice_medium},${L.spice_large}`, total: dd.counts.spice_medium + dd.counts.spice_large },
  ]
  const extra = {
    wrecks: plural(dd.counts.shipwreck, [t('уламок корабля'), t('уламки кораблів'), t('уламків кораблів')]),
    labs: plural(dd.counts.ecolab, [t('випробувальна станція'), t('випробувальні станції'), t('випробувальних станцій')]),
    caves: plural(dd.counts.cave, [t('печера'), t('печери'), t('печер')]),
  }
  return (
    <section className="rounded-xl border border-line bg-panel p-4 shadow-sm sm:p-5" aria-labelledby="h-week">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="h-week" className="font-display text-[18px] font-bold">{t('Цей тиждень у Глибокій пустелі')}</h2>
        <p className="text-[13px] text-muted">{t('Де найбільше — за секторами. Натисни сектор, щоб відкрити шар на мапі.')}</p>
        <p className="text-[12.5px] text-muted">
          <T
            text="PvE і PvP-сервери Глибокої пустелі мають, судячи з усіх трекерів, ту саму розкладку й той самий лут. Але на PvP — у рядах B–I за щитом — видобуток усіх ресурсів {mult}."
            mult={<b className="text-ink">×{fmtP(2.5)}</b>}
          />
        </p>
      </div>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-3">
        {lists.map((l) => {
          const max = Math.max(1, ...l.rows.map((r) => r[1]))
          return (
            <div key={l.title} className="min-w-0">
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-[14px] font-semibold">{l.title}</h3>
                <span className="ml-auto font-mono text-[12px] tabular-nums text-muted">{l.count(l.total)}</span>
              </div>
              {l.rows.length ? (
                <ul className="grid gap-1">
                  {l.rows.map(([s, n, island]) => (
                    <li key={s}>
                      <a href={`/map?m=deepdesert_1&l=${l.layer}`} onClick={go('map', `?m=deepdesert_1&l=${l.layer}`)} className="group grid grid-cols-[2.6rem_minmax(0,1fr)_3rem] items-center gap-2 rounded-md px-1 py-0.5 hover:bg-panel2">
                        <span className="font-mono text-[13px] font-semibold" data-tip={island ? t('Чистий острівець: руда тут завжди одна') : undefined}>
                          {s}
                          {island && <span className="ml-0.5 text-spice" aria-label={t('Чистий острівець: руда тут завжди одна')}>◆</span>}
                        </span>
                        <span className="h-2 overflow-hidden rounded-full bg-panel2">
                          <span className="block h-full rounded-full bg-spice/80 group-hover:bg-spice" style={{ width: `${(n / max) * 100}%` }} />
                        </span>
                        <span className="text-right font-mono text-[12.5px] tabular-nums text-muted">{n}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] text-muted">{t('Цього тижня немає.')}</p>
              )}
            </div>
          )
        })}
      </div>
      <ActiveFields dd={dd} active={active} go={go} />
      <p className="mt-4 text-[13px] text-muted">
        {dd.counts.spice_large
          ? t('Ще в пустелі: {wrecks}, {labs}, {caves}, {spice}.', { ...extra, spice: bigFields(dd.counts.spice_large) })
          : t('Ще в пустелі: {wrecks}, {labs}, {caves}. Великих полів меланжу цього тижня немає.', extra)}
      </p>
    </section>
  )
}

const SIZE_NAME = { small: t('мале поле'), medium: t('середнє поле'), large: t('велике поле') }
/**
 * Активні поля меланжу зараз — позначки гравців, які бачить людина (свої, гільдії, публічні): де, яке, відколи й
 * приблизно доки. Посилання — на мапу з шаром полів; позначити поле — там же.
 */
function ActiveFields({ dd, active, go }: { dd: NonNullable<HomeData['dd']>; active: Active | null; go: Go }) {
  const L = dd.layers
  const href = `?m=deepdesert_1&l=${L.spice_small},${L.spice_medium},${L.spice_large}`
  const now = active?.now ?? Date.now()
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold">
          <span className="home-now is-spice inline-block h-2 w-2 shrink-0 rounded-full" aria-hidden />
          {t('Активні поля меланжу зараз')}
        </h3>
        <span className="font-mono text-[12px] tabular-nums text-muted">{plural(active?.total ?? 0, [t('поле'), t('поля'), t('полів')])}</span>
        <a href={`/map${href}`} onClick={go('map', href)} className="ml-auto text-[13px] font-semibold text-spice hover:underline">{t('Позначити на мапі')}</a>
      </div>
      {active?.fields.length ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {active.fields.slice(0, 9).map((f) => (
            <li key={`${f.size}@${f.x}:${f.y}`}>
              <a href={`/map${href}`} onClick={go('map', href)} className="flex min-w-0 flex-wrap items-baseline gap-x-2 rounded-md px-1 py-0.5 hover:bg-panel2">
                <span className="font-mono text-[13px] font-semibold">{f.sector ?? '—'}</span>
                <span className="text-[13px]">{SIZE_NAME[f.size]}</span>
                <span className="text-[12.5px] text-muted">{t('з {time} ({ago} тому) · {n} позн.', { time: clockOf(f.first), ago: spanText(now - f.first), n: f.n })}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">{t('Зараз ніхто з тих, чиї позначки ти бачиш, не позначив активних полів. Бачиш поле в грі — познач його на мапі.')}</p>
      )}
    </div>
  )
}

/**
 * Плитка «Бази»: знімок 3D твоєї першої бази (малює сервер, щойно базу збережуть). Своїх баз немає (гість, новенький) чи
 * знімок не завантажився — знімок нашої Main з public/img, щоб плитка ніколи не була сірою
 */
const DEFAULT_BASE_IMG = '/img/base-default.jpg'
function BasesTile({ go }: { go: Go }) {
  const list = useBases((s) => s.list)
  useEffect(() => { if (!useBases.getState().list) useBases.getState().loadList() }, [])
  const live = (list ?? []).filter((b) => !b.deleted)
  const main = live.find((b) => b.id === 'main') ?? live[0]
  const dd = live.find((b) => b.id === 'dd') ?? live.find((b) => b !== main)
  const [broken, setBroken] = useState(false)
  const src = main && !broken ? thumbUrl(main) : DEFAULT_BASE_IMG
  return (
    <a href="/bases" onClick={go('bases')} className="group relative grid min-h-[320px] overflow-hidden rounded-xl border border-line bg-[#2a2118] shadow-sm transition-colors hover:border-spice/50">
      <Img src={src} onError={() => setBroken(true)} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
      <div className="absolute inset-0 bg-gradient-to-t from-[rgb(20_14_8/0.88)] via-[rgb(20_14_8/0.25)] to-transparent" aria-hidden />
      {dd && !broken && (
        <Img src={thumbUrl(dd)} className="absolute right-4 top-4 hidden w-[34%] rounded-lg border border-[rgb(255_255_255/0.25)] shadow-xl sm:block" />
      )}
      <div className="relative mt-auto grid gap-1.5 self-end p-5 text-[rgb(245_236_222)]">
        <div className="flex items-center gap-2">
          <Castle size={18} className="text-spice" />
          <h2 className="font-display text-[20px] font-bold">{t('Бази')}</h2>
          <ArrowRight size={18} className="ml-1 transition-transform group-hover:translate-x-0.5" />
        </div>
        <p className="max-w-[36rem] text-[13.5px] leading-snug text-[rgb(245_236_222/0.82)]">
          {t('Плануй базу з тих самих деталей, що й у грі: 3D, план по рівнях, ліміти, етапи будівництва і кошторис матеріалів.')}
        </p>
      </div>
    </a>
  )
}

function PlacesSection({ p, go }: { p: HomeData['places']; go: Go }) {
  const pc = p.total ? Math.round((p.ok / p.total) * 100) : 0
  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border border-line bg-panel p-4 shadow-sm sm:p-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]" aria-labelledby="h-ours">
      <div>
        <h2 id="h-ours" className="font-display text-[18px] font-bold">{t('Записи про ресурси')}</h2>
        <p className="mt-1 text-[13px] leading-snug text-muted">{t('Де брати унікальні ресурси: записи сайту поверх мапи.')}</p>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="font-display text-[34px] font-bold leading-none">{p.total}</span>
          <span className="text-[13px] text-muted">{t('{records}, перевірено в грі {n}', { records: word(p.total, [t('запис'), t('записи'), t('записів')]), n: p.ok })}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel2" role="img" aria-label={t('Перевірено {pc}%', { pc })}>
          <span className="block h-full rounded-full bg-ok" style={{ width: `${pc}%` }} />
        </div>
        <a href="/map" onClick={go('map')} className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-spice hover:underline">
          {t('Переглянути на мапі')} <ArrowRight size={14} />
        </a>
      </div>
      <div className="min-w-0">
        <h3 className="mb-1.5 text-[13px] font-semibold text-muted">{t('Нещодавно змінені')}</h3>
        <ul className="divide-y divide-line">
          {p.recent.map((r) => (
            <li key={r.id}>
              <a
                href={`/map?r=${r.id}&m=${ZONE_MAP[r.zone] ?? 'survival_1'}`}
                onClick={go('map', `?r=${r.id}&m=${ZONE_MAP[r.zone] ?? 'survival_1'}`)}
                className="flex min-w-0 items-center gap-3 py-2 hover:text-spice"
              >
                <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full', r.ok ? 'bg-ok/15 text-ok' : 'bg-panel2 text-muted')}>
                  {r.ok ? <Check size={12} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                </span>
                <span className="min-w-0 flex-1 break-words text-[14px] font-medium leading-snug">{splitEn(r.res)[0]}</span>
                <span className="hidden min-w-0 max-w-[40%] truncate text-[12.5px] text-muted sm:block">{splitEn(r.place)[0]}</span>
                <span className="shrink-0 rounded-full bg-panel2 px-2 py-0.5 text-[11px] text-muted">{ZONE[r.zone] ?? ZONE.hagga}</span>
                <span className="hidden shrink-0 text-[11.5px] text-muted md:block">{ago(r.updated)}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Плитка роадмапу: етапи з живого документа, з позначкою статусу. */
/** Плитка роадмапу: перший з моїх чи гільдійських (основної гільдії — першим), з етапами; без входу — запрошення. */
function RoadmapTile({ go }: { go: Go }) {
  const user = useAuth((st) => st.user)
  const ready = useAuth((st) => st.ready)
  const [rm, setRm] = useState<{ id: string; doc: RoadmapDoc; state: PState } | null | 'none' | 'error'>(null)
  useEffect(() => {
    if (!ready) return
    if (!user) { setRm('none'); return }
    let live = true
    get<{ rows: { id: string; owner: { id: string } }[] }>('/api/roadmaps').then(async (r) => {
      const first = r.rows.find((x) => x.owner.id === user.mainGuild) ?? r.rows[0]
      if (!first) { if (live) setRm('none'); return }
      // прогрес — той, що людині показано (свій, гільдії, спільний), окремо від документа
      const d = await get<{ doc: RoadmapDoc; progress?: { state: PState } }>(`/api/roadmaps/${first.id}`)
      if (live) setRm({ id: first.id, doc: d.doc, state: d.progress?.state ?? emptyPState() })
    }).catch(() => { if (live) setRm('error') })
    return () => { live = false }
  }, [ready, user?.id])
  const loaded = rm && typeof rm === 'object' ? rm : null
  const doc = loaded?.doc ?? null
  const stages = doc?.stages ?? []
  const status = (id: string) => statusOf(loaded?.state, id)
  const done = stages.filter((s) => status(s.id) === 'done').length
  const href = loaded ? `/roadmap/${loaded.id}` : '/roadmap'
  return (
    <a href={href} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); useStore.getState().setView('roadmap', { param: loaded?.id ?? null }) }} className="group grid content-start gap-2.5 rounded-xl border border-line bg-panel p-4 shadow-sm transition-colors hover:border-spice/50">
      <div className="flex items-center gap-2">
        <TrendingUp size={18} className="text-spice" />
        <h2 className="line-clamp-2 min-w-0 break-words font-display text-[16px] font-bold leading-snug">{doc?.title || t('Роадмапи')}</h2>
        {stages.length > 0 && <span className="font-mono text-[12px] text-muted">{done}/{stages.length}</span>}
        <ArrowRight size={16} className="ml-auto text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-spice" />
      </div>
      <ol className="grid gap-1.5 text-[13.5px]">
        {stages.slice(0, 6).map((s, i) => (
          <li key={s.id} className={cn('flex items-center gap-2.5', status(s.id) === 'done' && 'text-muted line-through decoration-1')}>
            <span
              className={cn(
                'grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[11px]',
                status(s.id) === 'done' ? 'border-ok bg-ok text-panel' : status(s.id) === 'doing' ? 'border-spice text-spice' : 'border-line text-muted',
              )}
            >
              {status(s.id) === 'done' ? <Check size={12} strokeWidth={3} /> : i + 1}
            </span>
            {s.title}
          </li>
        ))}
        {rm === null && <li aria-busy="true" aria-label={t('Завантаження…')}><SnSkeleton lines={4} /></li>}
        {rm === 'error' && <li className="text-muted">{t('Роадмапи зараз не завантажились. Онови сторінку трохи згодом.')}</li>}
        {rm === 'none' && <li className="text-muted">{user ? t('Роадмапів поки нема — створи перший, особистий чи гільдійський.') : t('Увійди, щоб вести свої й гільдійські роадмапи.')}</li>}
      </ol>
    </a>
  )
}

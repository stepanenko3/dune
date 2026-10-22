/**
 * Палітра будівельника (зліва): категорії деталей гри (фундаменти, перекриття, стіни, вікна й двері, скісні стіни,
 * дахи, сходи, колони, поручні, пентащит) — базові форми з іконками з довідника; варіанти (ліва/права, «вар. 2») —
 * у картці деталі, «Замінити на…». Нижче — окремою секцією «Станції»: пристрої гри (фабрикатори, переробники, сховища,
 * вода, енергія, різне) і техніка для місця стоянки, розділами як у грі: ставляться так само — примара під курсором,
 * клік, R — поворот. Пошук — і деталей, і станцій. Вибране — те, що в примарі; «Вибирати поставлене» — без нічого
 * (клік вибирає, тягни — перемістити). Усе — лише те, що є в грі (довідник awakening.wiki).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { MousePointer2 } from 'lucide-react'
import { PIECES, VIEW3D } from '@/lib/engine'
import { loadCatalog, wikiImg } from '@/lib/catalog'
import { locale, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { SnInput, valueOf } from '@/components/sn'
import { fmt2, lab } from '../tr'
import { useBuilder } from './store'
import { KINDS, PRESET_GROUPS, PRESETS, type Preset } from './labels'
import { camHint, useCamMode } from '../camMode'

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

/** значок станції: іконка пристрою з гри, а як нема (техніка, давні станції) — слід (ширина × глибина в масштабі) у
 * кольорі типу, як вона стоїть у 3D */
export function StationIcon({ p, size = 40 }: { p: Pick<Preset, 'kind' | 'w' | 'd'> & { type?: string }; size?: number }) {
  const icons = useIcons()
  const src = p.type ? icons?.get(p.type) : undefined
  if (src) return <span className="grid shrink-0 place-items-center overflow-hidden rounded-md bg-panel2" style={{ width: size, height: size }} aria-hidden><img src={src} alt="" width={size} height={size} loading="lazy" className="h-full w-full object-contain" /></span>
  const k = (size - 10) / Math.max(p.w, p.d, 0.1)
  const w = Math.max(3, p.w * k), d = Math.max(3, p.d * k)
  const c = hex(VIEW3D.ITEM_COLORS?.[p.kind] ?? 0x999999)
  return (
    <span className="grid shrink-0 place-items-center rounded-md bg-panel2" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <rect x={(size - w) / 2} y={(size - d) / 2} width={w} height={d} rx={1.5} fill={c} fillOpacity={0.75} stroke={c} strokeWidth={1.2} />
      </svg>
    </span>
  )
}

/** іконки деталей і пристроїв — картинки модулів довідника за id гри (форма деталі й тип станції — і є id модуля) */
let iconCache: Map<string, string> | null = null
export function useIcons() {
  const [m, setM] = useState<Map<string, string> | null>(iconCache)
  useEffect(() => {
    if (iconCache) return
    loadCatalog().then((ix) => {
      if (ix === 'syncing') return
      const out = new Map<string, string>()
      for (const b of ix.cat.buildables) {
        if (!b.img) continue
        out.set(b.id, wikiImg(b.img)!)
      }
      iconCache = out
      setM(out)
    }).catch(() => {})
  }, [])
  return m
}

export function PieceIcon({ id, size = 40 }: { id: string; size?: number }) {
  const icons = useIcons()
  const src = icons?.get(id) ?? icons?.get(PIECES.SHAPES[id]?.variantOf ?? '')
  return (
    <span className="grid shrink-0 place-items-center overflow-hidden rounded-md bg-panel2" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" width={size} height={size} loading="lazy" className="h-full w-full object-contain" /> : <span className="text-[10px] text-muted">{lab(PIECES.SHAPES[id]?.name ?? '').slice(0, 2)}</span>}
    </span>
  )
}

export function Palette() {
  const camMode = useCamMode()
  const piece = useBuilder((s) => s.piece)
  const preset = useBuilder((s) => s.preset)
  const ed = useBuilder.getState
  const [q, setQ] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const stations = useRef<HTMLElement>(null)
  const words = useMemo(() => q.toLocaleLowerCase(locale()).split(/\s+/).filter(Boolean), [q])
  const groups = useMemo(() => {
    const all = Object.values(PIECES.SHAPES).filter((s) => (words.length ? true : !s.variantOf) && words.every((w) => lab(s.name).toLocaleLowerCase(locale()).includes(w)))
    return PIECES.CATS.map(([cat, name]) => ({ cat, name: lab(name), list: all.filter((s) => s.cat === cat) })).filter((g) => g.list.length)
  }, [words])
  // станції — розділами, як у грі (порядок — як у довіднику); пошук — і за назвою, і за типом, і за розділом
  const kinds = useMemo(() => {
    const all = PRESETS.map((p, i) => ({ p, i }))
    return PRESET_GROUPS.map(([kind, name]) => ({
      kind, name,
      list: all.filter(({ p }) => p.group === kind && words.every((w) => `${lab(p.name)} ${p.full ? lab(p.full) : ''} ${KINDS[p.kind] ?? p.kind} ${name}`.toLocaleLowerCase(locale()).includes(w))),
    })).filter((g) => g.list.length)
  }, [words])
  // список — relative, тож offsetTop секції — від його верху
  const jump = (el: HTMLElement | null) => { if (el) list.current?.scrollTo({ top: el.offsetTop - 4, behavior: 'smooth' }) }
  const cell = (on: boolean) => cn('grid justify-items-center gap-0.5 rounded-md border p-1 text-center text-[10px] leading-tight', on ? 'border-spice bg-spice/20 text-ink' : 'border-transparent text-muted hover:border-line hover:text-ink')
  return (
    <aside className="flex min-h-0 w-[236px] shrink-0 flex-col border-r border-line bg-panel" aria-label={t('Деталі й станції')}>
      <div className="grid gap-1.5 border-b border-line p-2">
        <SnInput type="text" enterkeyhint="search" size="sm" clearable modelValue={q} placeholder={t('Знайти деталь чи станцію')} accessibilityLabel={t('Знайти деталь чи станцію')}
          onInput={(e: Event) => setQ(valueOf(e) ?? '')}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Escape') setQ('') }} />
        <button type="button" aria-pressed={!piece && preset == null} onClick={() => ed().set({ piece: null, preset: null })} className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[12.5px]', !piece && preset == null ? 'border-spice bg-spice/20 text-ink' : 'border-line text-muted hover:text-ink')} title={t('Без деталі: клік вибирає поставлене, тягни вибране — перемістити (Esc)')}>
          <MousePointer2 size={13} /> {t('Вибирати поставлене')}
        </button>
        <div className="grid grid-cols-2 gap-1 text-[11.5px]" role="group" aria-label={t('Перейти до')}>
          <button type="button" onClick={() => list.current?.scrollTo({ top: 0, behavior: 'smooth' })} className="rounded border border-line px-1.5 py-0.5 text-muted hover:text-ink">{t('Деталі')}</button>
          <button type="button" onClick={() => jump(stations.current)} className={cn('rounded border px-1.5 py-0.5 hover:text-ink', preset != null ? 'border-spice text-ink' : 'border-line text-muted')}>{t('Станції')}</button>
        </div>
      </div>
      <div ref={list} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {groups.map((g) => (
          <section key={g.cat} className="mb-2.5">
            <h4 className="mb-1 text-[11px] font-semibold text-muted">{g.name}</h4>
            <div className="grid grid-cols-3 gap-1">
              {g.list.map((s) => (
                <button key={s.id} type="button" aria-pressed={piece === s.id} onClick={() => ed().set({ piece: s.id, sel: null })} title={lab(s.name)} className={cell(piece === s.id)}>
                  <PieceIcon id={s.id} size={44} />
                  <span className="line-clamp-2">{lab(s.name)}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        <section ref={stations} className="mt-1 border-t border-line pt-2" aria-label={t('Станції')}>
          <h3 className="mb-0.5 font-display text-[13px] font-bold text-ink">{t('Станції')}</h3>
          <p className="mb-2 text-[10.5px] leading-snug text-muted">{t('Пристрої гри й техніка для місця стоянки — ставляться, як деталі: клік, R — поворот на 15°.')}</p>
          {kinds.map((g) => (
            <div key={g.kind} className="mb-2.5">
              <h4 className="mb-1 text-[11px] font-semibold text-muted">{g.name}</h4>
              <div className="grid grid-cols-3 gap-1">
                {g.list.map(({ p, i }) => (
                  <button key={i} type="button" aria-pressed={preset === i} onClick={() => ed().set({ preset: i, sel: null })} title={`${lab(p.full || p.name)} · ${fmt2(p.w)}×${fmt2(p.d)}`} className={cell(preset === i)}>
                    <StationIcon p={p} size={44} />
                    <span className="line-clamp-2">{lab(p.name)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!kinds.length && <p className="text-[11px] text-muted">{t('Станцій з такою назвою нема')}</p>}
        </section>
      </div>
      <p className="border-t border-line px-2 py-1.5 text-[10.5px] leading-snug text-muted">
        {t('Клік — поставити, тягни — рядом, ПКМ — прибрати. R — поворот, F — дзеркально. Вибране: тягни чи стрілки — перемістити.')} {camHint(camMode)}
      </p>
    </aside>
  )
}

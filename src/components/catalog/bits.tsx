/**
 * Спільні дрібниці довідника: іконка предмета з підкладкою тіру і посилання-«чип» на предмет чи пристрій.
 * Ними користуються і довідник, і калькулятор виробництва.
 */
import { useEffect, useMemo, useState } from 'react'
import { Hammer } from 'lucide-react'
import { iconUrl, nameOf, sectionOfItem, type CatalogIndex, type CPlace } from '@/lib/catalog'
import { cn, fmtN } from '@/lib/utils'
import { t } from '@/lib/i18n'

export type Open = (k: 'item' | 'place', id: string) => void

const go = (url: string) => {
  history.pushState(null, '', url)
  dispatchEvent(new PopStateEvent('popstate'))
}
/** відкрити запис довідника з будь-якої сторінки (адреса /catalog/<розділ>/<id>, без перезавантаження) */
export function openInCatalog(ix: CatalogIndex, kind: 'item' | 'place', id: string) {
  const it = kind === 'item' ? ix.item.get(id) : null
  const section = it ? sectionOfItem(it) : 'placeable'
  go(`/catalog/${section}/${encodeURIComponent(id)}`)
}

/** будівельний запис пристрою: у грі це той самий рядок (id пристрою = id модуля), ціна будівництва — у ньому */
export function buildOfPlace(ix: CatalogIndex, p: CPlace) {
  return ix.cat.buildables.find((b) => b.id === p.id) ?? null
}

/** відкрити модуль довідника (id гри): пристрій — його карткою (там і ціна, і що на ньому крафтиться) */
export function openBuild(ix: CatalogIndex, key: string) {
  const place = ix.place.has(key) ? key : undefined
  go(place ? `/catalog/placeable/${encodeURIComponent(place)}` : `/catalog/building/${encodeURIComponent(key)}`)
}

/**
 * Іконка предмета з підкладкою кольору тіру, як у грі: сірий → зелений → синій → фіолетовий → золотий.
 * wide — велика картинка в картці: висота size, ширина — за самою картинкою (зброя й техніка в грі ширші, 2:1),
 * а не вписана в квадрат
 */
export const TIER_BG = ['rgb(var(--c-panel2))', '#3b4a35', '#2e4a3a', '#2c3f57', '#4a3460', '#5a4520', '#6a3a1c']
export function Icon({ src, size, grade, wide }: { src: string | null; size: number; grade?: number; wide?: boolean }) {
  // спершу кольоровий рендер (…R_D), якщо його немає — базова іконка, далі — заглушка
  const tries = useMemo(() => {
    const r = src?.startsWith('/catalog-icons/') ? src.replace(/_D\.webp$/, 'R_D.webp') : null
    return [r, src].filter(Boolean) as string[]
  }, [src])
  const [k, setK] = useState(0)
  useEffect(() => setK(0), [src])
  const url = tries[k]
  return (
    <span
      className={cn('relative grid shrink-0 place-items-center overflow-hidden', wide ? 'rounded-lg' : 'rounded-md')}
      style={{ ...(wide ? { height: size, minWidth: size, maxWidth: size * 2 } : { width: size, height: size }), background: grade != null ? TIER_BG[Math.min(grade, 6)] : 'rgb(var(--c-panel2))' }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          width={size}
          height={size}
          // широка: висота — рівно size, ширина — за пропорціями картинки (у сітці відсоткова висота не працює)
          style={wide ? { height: size, width: 'auto', maxWidth: size * 2 } : undefined}
          className={wide ? 'object-contain' : 'h-full w-full object-contain'}
          onError={() => setK((x) => x + 1)}
        />
      ) : (
        <Hammer size={size * 0.4} className="text-muted" />
      )}
      {grade != null && grade > 0 && (
        <span className={cn('absolute bottom-0 right-0 bg-black/60 font-mono leading-tight text-white', wide ? 'rounded-tl-md px-1.5 py-0.5 text-[12px]' : 'rounded-tl px-0.5 text-[9px]')}>{grade}</span>
      )}
    </span>
  )
}

/** was — кількість без указу тижня: показується закресленою, якщо указ її змінив */
export function Ref({ ix, id, qty, was, open }: { ix: CatalogIndex; id: string; qty?: number; was?: number; open: Open }) {
  const it = ix.item.get(id)
  const pl = it ? null : ix.place.get(id)
  const x = it ?? pl
  return (
    <button
      type="button"
      onClick={() => x && open(it ? 'item' : 'place', id)}
      disabled={!x}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-line/80 bg-panel2/40 py-0.5 pl-0.5 pr-2 text-left text-[12px] hover:border-spice/50 disabled:opacity-70"
    >
      <Icon src={x ? iconUrl(x.icon) : null} size={22} grade={x?.grade} />
      {qty != null && (
        <span className="font-mono text-[11.5px] font-semibold">
          {was != null && was !== qty && <s className="mr-1 font-normal text-muted" title={t('Без указу тижня')}>{fmtN(was)}</s>}
          <span className={cn(was != null && was !== qty && 'text-spice')}>{fmtN(qty)}×</span>
        </span>
      )}
      <span className="truncate">{nameOf(x ?? undefined, id)}</span>
    </button>
  )
}


/** сітка сама вирішує, скільки стовпців влазить: телефон — один, сторінка бази — кілька */
export const cols = (min: number): React.CSSProperties => ({ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}px), 1fr))` })

/**
 * рядок «іконка · назва · кількість», клік — у довідник; share — частка від найбільшого (смужка за рядком);
 * dim — притишений (є в списку, але зараз не враховується)
 */
export function Line({ ix, id, qty, sub, share, dim, open }: { ix: CatalogIndex; id: string; qty: string; sub?: React.ReactNode; share?: number; dim?: boolean; open: Open }) {
  const it = ix.item.get(id)
  const x = it ?? ix.place.get(id)
  const pct = share != null ? Math.max(2, share * 100) : null
  return (
    <li>
      <button
        type="button"
        onClick={() => x && open(it ? 'item' : 'place', id)}
        disabled={!x}
        className={cn('group flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-opacity hover:bg-panel2/60', dim && 'opacity-40')}
        style={pct != null && !dim ? { backgroundImage: `linear-gradient(to right, rgb(var(--c-spice) / 0.12) ${pct}%, transparent ${pct}%)` } : undefined}
      >
        <Icon src={x ? iconUrl(x.icon) : null} size={28} grade={x?.grade} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-tight group-hover:text-spice">{nameOf(x, id)}</span>
          {sub && <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-tight text-muted">{sub}</span>}
        </span>
        <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums">{qty}</span>
      </button>
    </li>
  )
}

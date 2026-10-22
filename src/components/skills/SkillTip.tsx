/**
 * Картка навички — поповер біля вузла, як підказка в грі: назва мовою сайту (і англійська дрібно), тип і
 * гілка, ранг «− r / max +», слот, опис, таблиця рангів і умови тренера.
 * Таблиця — головне: стовпчики — ранги, рядки — очки й кожен стат; що змінюється від рангу до рангу — яскраво,
 * що однакове на всіх рангах — однією клітинкою на всю ширину; взяті ранги залиті, наступний — в обводці.
 * Немає даних гри мовою сайту — та сама таблиця з англійських бонусів questlog.
 * Позиція: праворуч від вузла (не влазить — ліворуч), по вертикалі — в межах екрана; вузький екран — шторка знизу.
 */
import { useEffect } from 'react'
import { Lock, Minus, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { KIND, typeOf, rankCost, type Skill } from '@/lib/skills'
import { fmtStat, locRanks, partIds, skillName, useLoc } from '@/lib/skillsUk'
import { useAnchor } from './anchor'

const W = 380
const GAP = 10 // від вузла до картки: курсор перетинає його за мить

export function GameText({ text }: { text: string }) {
  // кольорові вставки гри (<span style="color:…">) — кольором, решта тегів — геть
  const parts: React.ReactNode[] = []
  const re = /<span style="color:\s*(#[0-9a-fA-F]{3,8})">([\s\S]*?)<\/span>/g
  const plain = (v: string) => v.replace(/<[^>]*>/g, '')
  let at = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    parts.push(plain(text.slice(at, m.index)))
    parts.push(<span key={m.index} className="font-semibold" style={{ color: m[1] }}>{plain(m[2])}</span>)
    at = m.index + m[0].length
  }
  parts.push(plain(text.slice(at)))
  return <>{parts}</>
}

/** рядки таблиці: назва стату й значення на кожному ранзі ('' — на цьому ранзі стату немає) */
function rows(s: Skill, loc: ReturnType<typeof locRanks>): [string, string[]][] {
  const out = new Map<string, string[]>()
  const per = loc ? loc.stats : s.levels.map((l) => l.bonuses.map(([name, v, pct]) => ({ name, text: `${v}${pct ? '%' : ''}` })))
  per.forEach((list, r) => {
    for (const st of list) {
      const name = st.name
      const text = 'text' in st ? st.text : fmtStat(st)
      if (!out.has(name)) out.set(name, Array(s.max).fill(''))
      out.get(name)![r] = text
    }
  })
  return [...out]
}

/** умови рангів, сусідні однакові — разом: «Ранги 2–3: …» */
function reqGroups(req: string[]) {
  const g: { from: number; to: number; text: string }[] = []
  req.forEach((text, i) => {
    const last = g[g.length - 1]
    if (last && last.text === text) last.to = i + 1
    else g.push({ from: i + 1, to: i + 1, text })
  })
  return g
}

export function SkillTip({
  s, el, out, rank, branch, slot, pinned, onUp, onDown, onEquip, onClose, onEnter, onLeave,
}: {
  s: Skill
  el: HTMLElement
  /** зникає (анімація), ще на екрані */
  out: boolean
  rank: number
  branch: string | null
  /** слот: null — вузол не ставиться в слоти чи не взятий; in/out — уже в слоті чи ні */
  slot: { label: string; in: boolean } | null
  pinned: boolean
  onUp: () => void
  onDown: () => void
  onEquip: () => void
  onClose: () => void
  onEnter: () => void
  onLeave: () => void
}) {
  const map = useLoc((u) => u.map)
  const ids = partIds(s)
  const info = useLoc((u) => u.info[ids.join('+')])
  const loc = locRanks(s, map)
  const name = skillName(s, map)
  const table = rows(s, loc)
  const { box, pos, sheet, frame } = useAnchor(el, W, GAP)
  useEffect(() => { useLoc.getState().loadInfo(ids) }, [ids.join('+')]) // eslint-disable-line react-hooks/exhaustive-deps

  const desc = info && info !== 'loading' && info !== 'fail' && info.desc ? info.desc : null
  const req = info && info !== 'loading' && info !== 'fail' ? reqGroups(info.req) : []

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={name}
      data-skill-tip
      data-out={out || undefined}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      className={cn(
        'sk-night sk-tip fixed z-50 grid gap-2.5 overflow-y-auto border border-line p-3.5 shadow-[0_18px_50px_rgb(0_0_0/0.45)]',
        frame.className,
        !pos && 'invisible',
      )}
      style={frame.style}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-line bg-panel">
          {s.icon && <img src={`/catalog-icons/${s.icon}.webp`} alt="" className="h-9 w-9 object-contain" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15.5px] font-bold leading-snug">{name}</h2>
          <p className="text-[11.5px] leading-snug text-muted">
            {branch ? t('{kind}, гілка «{branch}»', { kind: KIND[typeOf(s)], branch }) : KIND[typeOf(s)]}
            {name !== s.name ? <span className="block opacity-80">{s.name}</span> : null}
          </p>
        </div>
        {(pinned || sheet) && (
          <button type="button" onClick={onClose} className="-mr-1 -mt-1 grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-ink/10 hover:text-ink" aria-label={t('Закрити картку')}>
            <X size={15} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onDown} disabled={!rank} className="grid h-8 w-8 place-items-center rounded-md border border-line hover:border-spice disabled:opacity-35" aria-label={t('Ранг нижче')}><Minus size={14} /></button>
        <b className="min-w-[3.2rem] text-center font-mono text-[15px] tabular-nums">{rank} / {s.max}</b>
        <button type="button" onClick={onUp} disabled={rank >= s.max} className="grid h-8 w-8 place-items-center rounded-md border border-line hover:border-spice disabled:opacity-35" aria-label={t('Ранг вище')}><Plus size={14} /></button>
        {slot && (
          <button type="button" onClick={onEquip} className={cn('h-8 rounded-md border px-2.5 text-[12.5px]', slot.in ? 'border-spice bg-spice/20' : 'border-line hover:border-spice')}>
            {slot.in ? t('Зняти зі слота') : slot.label}
          </button>
        )}
        <span className="ml-auto text-[11.5px] text-muted">{t('усі ранги — {n} оч.', { n: rankCost(s, s.max) })}</span>
      </div>

      <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-ink/80">
        {desc ? (
          <GameText text={desc} />
        ) : info === 'loading' || (!info && map) ? (
          // опис ще їде — сірі рядки на його місці, щоб картка не стрибала
          <span className="grid gap-1.5 py-0.5" aria-label={t('Завантажую опис')}>
            {[100, 94, 70].map((w) => <span key={w} className="h-[10px] animate-pulse rounded bg-ink/10" style={{ width: `${w}%` }} />)}
          </span>
        ) : (
          <GameText text={s.locDesc || s.desc} />
        )}
      </p>

      {/* ранги: очки й стати; що змінюється — яскраво, однакове на всіх рангах — однією клітинкою */}
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="py-1 pr-2 text-left font-normal text-muted">{t('Ранг')}</th>
            {s.levels.map((_, i) => (
              <th key={i} className={cn('w-[3.6rem] rounded-t-md py-1 text-center font-mono font-semibold', i < rank ? 'bg-spice text-on-spice' : i === rank ? 'text-spice ring-1 ring-inset ring-spice/60' : 'text-muted')}>
                {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-line">
            <td className="py-1 pr-2 text-muted">{t('Очки')}</td>
            {s.levels.map((l, i) => (
              <td key={i} className={cn('py-1 text-center font-mono tabular-nums', i < rank ? 'bg-spice/15 text-ink' : 'text-ink/80')}>{l.cost}</td>
            ))}
          </tr>
          {table.map(([label, vals]) => {
            const same = vals.every((v) => v === vals[0])
            return (
              <tr key={label} className="border-t border-line align-top">
                <td className="py-1 pr-2 leading-snug text-ink/85">{label}</td>
                {same ? (
                  <td colSpan={s.max} className="py-1 text-center font-mono tabular-nums text-ink/70" title={t('Однаково на всіх рангах')}>{vals[0] || '—'}</td>
                ) : (
                  vals.map((v, i) => (
                    <td key={i} className={cn('py-1 text-center font-mono tabular-nums', i < rank && 'bg-spice/15', v && v !== vals[i - 1] ? 'font-semibold text-ink' : 'text-ink/55')}>{v || '—'}</td>
                  ))
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!loc && s.levels.some((l) => l.buffs.length) && (
        <p className="text-[11.5px] text-muted">{t('Дає: {list}', { list: [...new Set(s.levels.flatMap((l) => l.buffs))].join(', ') })}</p>
      )}
      {!table.length && loc && <p className="text-[11.5px] text-muted">{t('Числових значень у грі в цього вузла немає — що він робить, сказано в описі.')}</p>}

      {req.length > 0 && (
        <ul className="grid gap-1 text-[11.5px] text-muted">
          {req.map((g) => (
            <li key={g.from} className="flex gap-1.5">
              <Lock size={11} className="mt-[3px] shrink-0" />
              <span><b className="font-semibold text-ink/80">{g.from === g.to ? t('Ранг {n}:', { n: g.from }) : t('Ранги {from}–{to}:', { from: g.from, to: g.to })}</b> {g.text}</span>
            </li>
          ))}
        </ul>
      )}
      {!map && <p className="text-[11px] text-muted">{t('Точні значення рангів зараз не завантажились — показано запасні дані (англійською).')}</p>}
    </div>
  )
}

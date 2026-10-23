/**
 * Мінімальна розмітка для текстів, які редагують у застосунку (роадмап): без HTML, лише
 *   **жирний**, [посилання](адреса), рядки «- …» — список, «1. …» — нумерований, «### …» — підзаголовок,
 *   порожній рядок — новий абзац, ![назва](адреса) — картинка (абзац, що з неї починається, — картинка ліворуч, рядки абзацу
 *   праворуч), {{вид|текст}} — бейдж (види — BADGES; рядок лише з бейджів — їхній ряд).
 * Посилання «/map?…», «/catalog/…» — всередині застосунку, без перезавантаження сторінки.
 */
import type { ReactNode } from 'react'
import {
  Ban, BookOpen, CalendarDays, CircleCheck, Coins, FlaskConical, Gift, Hourglass, Layers, MapPin, Medal, Package, PartyPopper, ScrollText, Store, Tag,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ourImg } from '@/lib/media'
import { Img as MediaImg } from '@/components/ui/img'
import { openPath } from '@/store'

/**
 * Бейджі {{вид|текст}}: доступність (ok — можна отримати, soon — ще можна, але до строку, gone — уже ні), спосіб отримати
 * (кожен своїм кольором і значком) і подробиці (ціна, де, коли, ранг, скільки — без рамки, значок і текст). Невідомий вид —
 * простий сірий бейдж.
 */
export const BADGES: Record<string, { icon: LucideIcon; cls: string; info?: boolean }> = {
  ok: { icon: CircleCheck, cls: 'border-ok/40 bg-ok/10 text-ok font-semibold' },
  soon: { icon: Hourglass, cls: 'border-warn/50 bg-warn/15 text-warn font-semibold' },
  gone: { icon: Ban, cls: 'border-line bg-panel2 text-muted' },
  tech: { icon: FlaskConical, cls: 'border-sky-500/35 bg-sky-500/10 text-sky-800 dark:text-sky-300' },
  buy: { icon: Store, cls: 'border-spice/35 bg-spice/10 text-spice' },
  dlc: { icon: Package, cls: 'border-violet-500/35 bg-violet-500/10 text-violet-800 dark:text-violet-300' },
  event: { icon: PartyPopper, cls: 'border-pink-500/35 bg-pink-500/10 text-pink-800 dark:text-pink-300' },
  reward: { icon: Gift, cls: 'border-teal-500/35 bg-teal-500/10 text-teal-800 dark:text-teal-300' },
  story: { icon: BookOpen, cls: 'border-indigo-500/35 bg-indigo-500/10 text-indigo-800 dark:text-indigo-300' },
  contract: { icon: ScrollText, cls: 'border-stone-500/35 bg-stone-500/10 text-stone-800 dark:text-stone-300' },
  price: { info: true, icon: Coins, cls: '' },
  where: { info: true, icon: MapPin, cls: '' },
  when: { info: true, icon: CalendarDays, cls: '' },
  rank: { info: true, icon: Medal, cls: '' },
  count: { info: true, icon: Layers, cls: '' },
}
const BADGE_RE = /\{\{([a-z]+)\|((?:[^}]|\}(?!\}))+)\}\}/
/** рядок лише з бейджів (і пробілів) — їхній ряд, а не абзац */
const onlyBadges = (l: string) => BADGE_RE.test(l) && !l.replace(new RegExp(BADGE_RE.source, 'g'), '').trim()

function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  const b = BADGES[kind] ?? { icon: Tag, cls: 'border-line bg-panel2/60 text-ink' }
  const Icon = b.icon
  return b.info ? (
    <span data-badge={kind} className="inline-flex max-w-full items-center gap-1 align-middle text-[12px] leading-[18px] text-ink/85">
      <Icon size={13} className="shrink-0 text-muted" aria-hidden />
      <span className="min-w-0">{children}</span>
    </span>
  ) : (
    <span data-badge={kind} className={cn('inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-px align-middle text-[11.5px] font-medium leading-[18px] [&_a]:no-underline hover:[&_a]:underline', b.cls)}>
      <Icon size={12} className="shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </span>
  )
}

const sitePath = (u: string) => /^\/(?![\/\\])/.test(u) && !/[\u0000-\u001f\\]/.test(u)
/** зовнішня — лише http(s); внутрішня — шлях цього сайту (не «//чужий» і не «/\чужий», які браузер вважає чужим сайтом) */
const safeHref = (u: string) => (/^https?:\/\//.test(u) || sitePath(u) ? u : null)

/** картинки — лише з цього сайту (давні адреси CDN іконок гри — через наш проксі з медіатеки, lib/media): чужа адреса в тексті не стежить за глядачами */
export const safeImg = (u: string): string | null => (sitePath(u) ? u : ourImg(u))
const IMG_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*/

function Img({ src, alt, className, boxClassName }: { src: string; alt: string; className?: string; boxClassName?: string }) {
  return <MediaImg src={src} alt={alt} className={cn('inline-block object-contain', className)} boxClassName={boxClassName} />
}

function go(e: React.MouseEvent, href: string) {
  if (!href.startsWith('/') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  openPath(href)
}

/** **жирний**, [текст](адреса), ![назва](картинка) і {{вид|бейдж}} усередині рядка */
export function inline(s: string, key = ''): ReactNode[] {
  const out: ReactNode[] = []
  const re = new RegExp(/\*\*(.+?)\*\*|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|/.source + BADGE_RE.source, 'g')
  let last = 0
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    if (m[1] != null) out.push(<b key={key + n++}>{m[1]}</b>)
    else if (m[6] != null) out.push(<Badge key={key + n++} kind={m[6]}>{inline(m[7], `${key}${n}b`)}</Badge>)
    else if (m[3] != null) {
      const src = safeImg(m[3])
      out.push(src ? <Img key={key + n++} src={src} alt={m[2]} className="h-[1.4em] w-auto align-middle" /> : m[2])
    } else {
      const href = safeHref(m[5])
      out.push(
        href ? (
          <a key={key + n++} href={href} onClick={(e) => go(e, href)} {...(href.startsWith('/') ? {} : { target: '_blank', rel: 'noopener' })}>
            {m[4]}
          </a>
        ) : (
          m[4]
        ),
      )
    }
    last = re.lastIndex
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

export function Md({ text, className }: { text: string; className?: string }) {
  if (!text.trim()) return null
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let i = 0
  let k = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    if (/^\s*[-•]\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l)
      const items: string[] = []
      const re = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-•]\s+/
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''))
      const L = ordered ? 'ol' : 'ul'
      blocks.push(
        <L key={k++} className={cn('grid gap-[5px] pl-[18px]', ordered ? 'list-decimal' : 'list-disc')}>
          {items.map((t, j) => <li key={j}>{inline(t, `${k}-${j}-`)}</li>)}
        </L>,
      )
      continue
    }
    if (/^#{1,3}\s+/.test(l)) {
      blocks.push(<h4 key={k++} className="font-semibold">{inline(l.replace(/^#{1,3}\s+/, ''))}</h4>)
      i++
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*([-•]|\d+[.)]|#{1,3})\s+/.test(lines[i])) para.push(lines[i++])
    const text = para.join(' ')
    const pic = IMG_RE.exec(para[0])
    const src = pic && safeImg(pic[2])
    // рядки праворуч від картинки (чи окремий абзац): ряд бейджів — ряд, решта — текст
    const rows = (ls: string[], key: string) =>
      ls.filter((l) => l.trim()).map((l, j) =>
        onlyBadges(l) ? <div key={key + j} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">{inline(l, `${key}${j}-`)}</div> : <p key={key + j}>{inline(l, `${key}${j}-`)}</p>)
    if (pic && src) {
      // картка: картинка ліворуч, рядки абзацу — праворуч
      const rest = [para[0].slice(pic[0].length), ...para.slice(1)]
      blocks.push(
        <div key={k++} className="flex items-start gap-3">
          <Img src={src} alt={pic[1]} className="h-16 w-16 shrink-0 rounded-md bg-panel2/60 p-1" boxClassName="shrink-0 rounded-md" />
          <div className="grid min-w-0 gap-1.5">{rows(rest, `${k}-`)}</div>
        </div>,
      )
    } else if (para.some(onlyBadges)) blocks.push(<div key={k++} className="grid gap-1.5">{rows(para, `${k}-`)}</div>)
    else blocks.push(<p key={k++}>{inline(text)}</p>)
  }
  return <div className={cn('grid gap-2 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-spice [&_b]:font-semibold', className)}>{blocks}</div>
}

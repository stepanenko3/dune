/**
 * Блоки сторінки гільдії з її картки: правила, вимоги, розклад (у поясі глядача), Discord і Telegram, мітка бази на
 * мапі, публічні бази й найближчі події; збоку — факти (регіон і сервер, пояс, мови, стиль гри). Сервер уже прибрав
 * сховане від чужого, тут — лише не показати порожнє.
 */
import { useEffect, useState } from 'react'
import { ExternalLink, MapPin, Send } from 'lucide-react'
import { t } from '@/lib/i18n'
import { plainClick } from '@/lib/urlState'
import { openPath } from '@/store'
import { listEvents, type EventRow } from '@/lib/events'
import { ItemGrid } from '@/components/access/ItemCard'
import { EVENT_GRID, EventCard, useNow } from '@/components/events/bits'
import { Section } from '../Account'
import { STYLE_LABEL, langLabel, regionLabel, tzLabel, type GuildProfile } from '@/lib/guildProfile'
import { ScheduleView } from './Schedule'
import type { GuildData } from './types'

const visible = (p: GuildProfile, b: keyof GuildProfile['show']) => p.show[b] !== 'hidden'

/** рядки «Про гільдію» з картки (для <dl> у боковій колонці) */
export function ProfileFacts({ p }: { p: GuildProfile }) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"><dt className="text-muted">{label}</dt><dd className="min-w-0 break-words text-right font-medium">{value}</dd></div>
  )
  return (
    <>
      {(p.region || p.server) && row(t('Де грає'), [regionLabel(p.region), p.server].filter(Boolean).join(' · '))}
      {p.tz && row(t('Пояс'), tzLabel(p.tz))}
      {p.langs.length > 0 && row(t('Мови'), <span className="first-letter:uppercase">{p.langs.map(langLabel).join(', ')}</span>)}
      {p.styles.length > 0 && row(t('Стиль гри'), p.styles.map((s) => STYLE_LABEL[s]).join(', '))}
    </>
  )
}

/** Discord і Telegram — кнопками-посиланнями */
export function GuildLinks({ p }: { p: GuildProfile }) {
  if (!visible(p, 'links') || (!p.links.discord && !p.links.telegram)) return null
  const a = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-panel2/50 px-3 text-[13px] font-semibold hover:border-spice/50">
      {label === 'Telegram' ? <Send size={14} /> : <ExternalLink size={14} />}{label}
    </a>
  )
  return <div className="flex flex-wrap gap-2">{p.links.discord && a(p.links.discord, 'Discord')}{p.links.telegram && a(p.links.telegram, 'Telegram')}</div>
}

function GuildUpcoming({ guildId }: { guildId: string }) {
  const [rows, setRows] = useState<EventRow[] | null>(null)
  const now = useNow()
  useEffect(() => {
    let live = true
    listEvents({ scope: 'guild', guild: guildId, when: 'upcoming', limit: 3 }).then((r) => live && setRows(r.rows), () => live && setRows([]))
    return () => { live = false }
  }, [guildId])
  if (!rows?.length) return null
  return (
    <section className="grid gap-2.5">
      <h2 className="px-1 font-display text-[16px] font-bold">{t('Найближчі події')}</h2>
      <ul className={EVENT_GRID}>{rows.map((ev) => <EventCard key={ev.id} ev={ev} now={now} />)}</ul>
    </section>
  )
}

/** основна колонка головної гільдії: блоки картки */
export function ProfileBlocks({ d }: { d: GuildData }) {
  const p = d.profile
  const bases = d.public.filter((i) => i.kind === 'base' && !i.deleted)
  return (
    <>
      {visible(p, 'rules') && p.rules && <Section title={t('Правила')}><p className="whitespace-pre-line break-words text-[14px] leading-relaxed">{p.rules}</p></Section>}
      {visible(p, 'requirements') && p.requirements && <Section title={t('Вимоги до новачків')}><p className="whitespace-pre-line break-words text-[14px] leading-relaxed">{p.requirements}</p></Section>}
      {visible(p, 'schedule') && p.schedule.length > 0 && <Section title={t('Розклад активності')}><ScheduleView slots={p.schedule} tz={p.tz} /></Section>}
      {visible(p, 'map') && d.mapBases.length > 0 && (
        <Section title={t('База гільдії на мапі')}>
          <ul className="grid gap-1.5">
            {d.mapBases.map((m) => (
              <li key={m.id}>
                <a href={`/map?marker=${m.id}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); openPath(`/map?marker=${m.id}`) }} className="inline-flex items-center gap-2 text-[14px] font-semibold hover:text-spice">
                  <MapPin size={16} className="shrink-0 text-spice" /><span className="break-words">{m.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {visible(p, 'bases') && bases.length > 0 && (
        <section className="grid gap-2.5">
          <h2 className="px-1 font-display text-[16px] font-bold">{t('Публічні бази')}</h2>
          <ItemGrid items={bases.slice(0, 6)} />
        </section>
      )}
      {visible(p, 'events') && <GuildUpcoming guildId={d.guild.id} />}
    </>
  )
}

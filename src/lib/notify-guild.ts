/**
 * Сповіщення набору гільдії (види guild.app.*, сервер — app.mjs, підписка на шину гільдії): текст мовою людини й
 * адреса, куди веде. Дзвоник у шапці (спільний, з біржі) бере їх звідси — GUILD_NOTES[вид](дані, скільки).
 * Поки дзвоника нема, сторінки гільдій самі показують непрочитане (useGuildNotes) і позначають його прочитаним.
 */
import { useEffect, useState } from 'react'
import { get, post } from './api'
import { t } from './i18n'

export interface Note { id: string; kind: string; data: Record<string, unknown>; count: number; read: boolean; created: number }
type Data = { guild?: string; slug?: string; name?: string; tag?: string; reason?: string }

export const GUILD_NOTES: Record<string, (d: Data, count: number) => { text: string; href: string }> = {
  'guild.app.new': (d, n) => ({ text: n > 1 ? t('Нові заявки до «{name}»: {n}', { name: d.name ?? '', n }) : t('Нова заявка до «{name}»', { name: d.name ?? '' }), href: `/g/${d.slug}/requests` }),
  'guild.app.sent': (d) => ({ text: t('Заявку до «{name}» подано — офіцери її побачать', { name: d.name ?? '' }), href: `/g/${d.slug}` }),
  'guild.app.accepted': (d) => ({ text: t('Тебе прийнято до «{name}»', { name: d.name ?? '' }), href: `/g/${d.slug}` }),
  'guild.app.rejected': (d) => ({ text: d.reason ? t('Заявку до «{name}» відхилено: {reason}', { name: d.name ?? '', reason: d.reason }) : t('Заявку до «{name}» відхилено', { name: d.name ?? '' }), href: `/g/${d.slug}` }),
}

/**
 * непрочитані сповіщення набору (для гільдії guildId чи всіх гільдій); read() — позначити показані прочитаними.
 * Без входу — порожньо.
 */
export function useGuildNotes(on: boolean, guildId?: string) {
  const [notes, setNotes] = useState<Note[]>([])
  useEffect(() => {
    if (!on) { setNotes([]); return }
    let live = true
    get<{ rows: Note[] }>('/api/notifications?limit=50')
      .then((r) => { if (live) setNotes(r.rows.filter((n) => !n.read && n.kind in GUILD_NOTES && (!guildId || n.data.guild === guildId))) })
      .catch(() => {})
    return () => { live = false }
  }, [on, guildId])
  const read = (list = notes) => {
    if (!list.length) return
    void post('/api/notifications/read', { ids: list.map((n) => n.id) }).catch(() => {})
  }
  return { notes, read }
}

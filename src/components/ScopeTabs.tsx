/**
 * «Мої · Гільдія · Публічні» — однаковий перемикач у кожному розділі з речами (бази, роадмапи, білди, розрахунки): своє,
 * своєї гільдії і публічне всіх (те, що раніше було лише в бібліотеці). Вибране — сегментом шляху (/bases/public), тож посилання
 * відкривається там само. Без входу — лише публічне. Вкладка «Гільдія» — якщо людина в гільдії.
 */
import { useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { pathOf, useStore } from '@/store'
import { Seg } from '@/components/ui/seg'
import { GuildTag } from '@/components/access/Access'
import { useCrumb } from '@/components/Crumbs'

export type Scope = 'mine' | 'guild' | 'public'
const SCOPES: Scope[] = ['mine', 'guild', 'public']

/** вибрана вкладка (сегмент шляху: /bases/public…); без входу — завжди публічне, без гільдії — «Гільдія» стає «Мої» */
export function useScope() {
  const user = useAuth((s) => s.user)
  const guild = useAuth((s) => s.guilds)[0] ?? null
  const view = useStore((s) => s.view)
  const sub = useStore((s) => s.sub)
  const v: Scope = SCOPES.includes(sub as Scope) ? (sub as Scope) : 'mine'
  const set = (nv: Scope) => useStore.getState().setView(view, { sub: nv })
  const href = (nv: Scope) => pathOf(view, null, false, null, nv)
  const scope: Scope = !user ? 'public' : v === 'guild' && !guild ? 'mine' : v
  return { scope, set, href, guild, user }
}

export function ScopeTabs({ scope, set, href }: Pick<ReturnType<typeof useScope>, 'scope' | 'set' | 'href'>) {
  const user = useAuth((s) => s.user)
  const guild = useAuth((s) => s.guilds)[0] ?? null
  const items: { id: Scope; label: React.ReactNode }[] = [
    ...(user ? [{ id: 'mine' as const, label: t('Мої') }] : []),
    ...(user && guild ? [{ id: 'guild' as const, label: <span className="inline-flex items-center gap-1.5"><GuildTag tag={guild.tag} color={guild.color} />{t('Гільдія')}</span> }] : []),
    { id: 'public', label: t('Публічні') },
  ]
  // шлях: розділ зі значком відкритої вкладки — «Бази [Мої]»
  useCrumb([], { sub: scope === 'mine' ? null : scope })
  if (items.length < 2) return null
  return <Seg label={t('Чиї')} value={scope} onChange={(v) => set(v)} href={href} items={items} />
}

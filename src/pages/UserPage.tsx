/** Сторінка людини: ім'я, нік у грі, про себе, гільдії й усе, що вона виклала публічно. */
import { useCallback, useEffect, useState } from 'react'
import { Castle, Inbox, Settings, UserX } from 'lucide-react'
import { ApiError, get } from '@/lib/api'
import { roleWithRank, useAuth, type GuildRole, type User, roleLabel } from '@/lib/auth'
import type { Item } from '@/lib/items'
import { useStore } from '@/store'
import { locale, t, T } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Avatar, GuildTag } from '@/components/access/Access'
import { ItemGrid } from '@/components/access/ItemCard'
import { PageHeader } from '@/components/PageHeader'
import { Empty, Loading, PageError } from '@/components/states'
import { plainClick } from '@/lib/urlState'
import { useCrumb } from '@/components/Crumbs'

interface Data { user: User; guilds: { id: string; slug: string; name: string; tag: string; color: string; role: GuildRole }[]; items: Item[] }

export function UserPage() {
  const login = useStore((s) => s.param)
  const setView = useStore((s) => s.setView)
  const me = useAuth((s) => s.user)
  const [d, setD] = useState<Data | null>(null)
  /** missing — такої людини нема (404); error — не вдалося завантажити */
  const [fail, setFail] = useState<'missing' | 'error' | null>(null)
  const load = useCallback(() => {
    setD(null)
    setFail(null)
    get<Data>(`/api/users/${login}`).then(setD).catch((e) => setFail(e instanceof ApiError && e.status === 404 ? 'missing' : 'error'))
  }, [login])
  useEffect(load, [load])
  // шлях: Гільдії › гільдія людини › людина (без гільдії — з головної); свій профіль — одразу з головної
  const g = d && d.user.id !== me?.id ? d.guilds[0] : undefined
  useCrumb(fail ? [] : d ? [...(g ? [{ label: t('Гільдії'), view: 'guilds' as const, value: t('Усі') }, { label: g.name, view: 'guild' as const, param: g.slug }] : []), { label: d.user.name }] : null)
  if (fail === 'missing') return (
    <div className="grid flex-1 place-items-center p-4">
      <div className="w-full max-w-[560px]">
        <Empty icon={UserX} title={t('Такої людини нема')} description={t('Перевір адресу: можливо, людина змінила логін.')}>
          <Button variant="secondary" onClick={() => setView('library')}>{t('До бібліотеки')}</Button>
        </Empty>
      </div>
    </div>
  )
  if (fail) return <PageError page title={t('Сторінка не завантажилась')} onRetry={load} />
  if (!d) return <Loading page />
  const u = d.user
  const mine = me?.id === u.id
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={<span className="inline-flex max-w-full items-center gap-2.5"><Avatar name={u.name} color={u.color} size={32} /><span className="min-w-0 break-words">{u.name}</span></span>}
          lead={
            <>
              <span className="block text-[13px]">
                @{u.login}{u.nick && <> · <T text="у грі {nick}" nick={<b className="font-semibold text-ink">{u.nick}</b>} /></>}{u.role !== 'user' && roleLabel(u) && <> · {roleLabel(u)}</>} · {t('на сайті з {date}', { date: new Date(u.created).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) })}
              </span>
              {u.bio && <span className="mt-2 block max-w-[70ch] whitespace-pre-line text-[14px] leading-relaxed text-ink">{u.bio}</span>}
            </>
          }
          actions={mine && <Button variant="secondary" onClick={() => setView('account', { param: d.user.login })}><Settings size={15} />{t('Налаштування')}</Button>}
        >
          {d.guilds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {d.guilds.map((g) => (
                <a key={g.id} href={`/g/${g.slug}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('guild', { param: g.slug }) }} className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-panel2/50 px-2.5 py-1 text-[12.5px] hover:border-spice/50">
                  <GuildTag tag={g.tag} color={g.color} />
                  <span className="min-w-0 truncate font-medium">{g.name}</span>
                  <span className="shrink-0 text-muted">{roleWithRank(g.role)}</span>
                </a>
              ))}
            </div>
          )}
        </PageHeader>
        <h2 className="px-1 pt-1 font-display text-[15px] font-bold">{t('Публічне')}</h2>
        <ItemGrid
          items={d.items}
          empty={mine ? (
            <Empty icon={Inbox} title={t('Ти ще нічого не виклав')} description={t('Відкрий базу, білд чи роадмап → «Доступ» → «Публічне» — і вони з’являться тут і в бібліотеці.')}>
              <Button variant="secondary" onClick={() => setView('bases')}><Castle size={15} />{t('До моїх баз')}</Button>
            </Empty>
          ) : (
            <Empty icon={Inbox} title={t('Нічого публічного поки нема')} description={t('Тут з’являться бази, білди, роадмапи й розрахунки, які ця людина виставить для всіх.')} />
          )}
        />
      </div>
    </div>
  )
}

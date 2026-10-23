/**
 * Розмови в панелі керування (дозвіл site.chats): усі розмови сайту — особисті, угод біржі, гільдій — з пошуком за
 * людиною, текстом і видом; відкрита розмова — той самий компонент, що на сайті (ChatView), лише для читання.
 */
import { useEffect, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { adminChats, type ChatKind, type Person } from '@/lib/chat'
import { fmtAgo } from '@/lib/market'
import { t } from '@/lib/i18n'
import { cn, fmtN } from '@/lib/utils'
import { Seg } from '@/components/ui/seg'
import { Button } from '@/components/ui/button'
import { Empty, Loading, PageError } from '@/components/states'
import { SnInput, valueOf } from '@/components/sn'
import { Avatar, GuildTag } from '@/components/access/Access'
import { ChatView } from '@/components/chat/ChatView'
import { GoodName } from '@/components/market/names'
import { adminHref, adminLink } from './api'
import { PageHeader } from './ui'

type Row = Awaited<ReturnType<typeof adminChats>>['rows'][number] & { guild?: { name: string; tag: string; color: string } | null }
const KIND_L: Record<ChatKind, () => string> = { direct: () => t('Особиста'), deal: () => t('Угода'), guild: () => t('Гільдія') }

export function ChatsAdmin({ id }: { id: string | null }) {
  return id ? <ChatOne id={id} /> : <ChatList />
}

function People({ list }: { list: Person[] }) {
  return <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">{list.map((p) => <span key={p.id} className="inline-flex items-center gap-1.5 text-[13px] font-semibold"><Avatar name={p.name} color={p.color} size={20} />{p.name}</span>)}</span>
}

function ChatList() {
  const [kind, setKind] = useState<'' | ChatKind>('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    const h = setTimeout(() => adminChats({ kind, q: q.trim() }).then((r) => { if (live) { setRows(r.rows as Row[]); setTotal(r.total) } }, (e) => live && setErr((e as Error).message)), q ? 250 : 0)
    return () => { live = false; clearTimeout(h) }
  }, [kind, q])
  const more = async () => {
    const r = await adminChats({ kind, q: q.trim(), offset: rows?.length ?? 0 })
    setRows((cur) => [...(cur ?? []), ...(r.rows as Row[])])
  }
  return (
    <div className="grid gap-4">
      <PageHeader title={t('Розмови')} count={rows ? t('усього: {n}', { n: fmtN(total) }) : undefined} />
      <p className="max-w-[75ch] text-[13.5px] text-muted">{t('Усі розмови сайту — лише для читання. Відкривай розмову, коли розбираєш скаргу чи порушення.')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Seg label={t('Вид розмови')} value={kind} onChange={setKind} items={[{ id: '' as const, label: t('Усі') }, ...(['direct', 'deal', 'guild'] as ChatKind[]).map((k) => ({ id: k, label: KIND_L[k]() }))]} />
        <SnInput type="search" size="lg" className="min-w-[min(260px,100%)] flex-1" modelValue={q} placeholder={t('Людина, текст чи id')} accessibilityLabel={t('Пошук розмов')} onInput={(e: Event) => setQ(valueOf(e))} />
      </div>
      {err && <PageError message={err} />}
      {!rows && !err && <Loading />}
      {rows && !rows.length && <Empty icon={MessagesSquare} title={t('Розмов не знайдено')} />}
      {rows && rows.length > 0 && (
        <ul className="grid gap-2">
          {rows.map((c) => (
            <li key={c.id}>
              <a href={adminHref(['chats', c.id])} onClick={adminLink(['chats', c.id])} className="grid gap-1.5 rounded-xl border border-line bg-panel px-4 py-3 shadow-sm hover:border-spice/50">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11.5px] font-semibold', c.kind === 'deal' ? 'bg-spice/10 text-spice' : 'bg-panel2')}>{KIND_L[c.kind]()}</span>
                  {c.guild && <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold"><GuildTag tag={c.guild.tag} color={c.guild.color} />{c.guild.name}</span>}
                  {c.kind === 'deal' && c.deal?.gid && <span className="text-[13px] font-semibold"><GoodName gid={c.deal.gid} /></span>}
                  <span className="ml-auto text-[12px] text-muted">{t('повідомлень: {n}', { n: fmtN(c.messages) })}{c.lastAt ? ` · ${fmtAgo(c.lastAt)}` : ''}</span>
                </span>
                {c.kind !== 'guild' && <People list={c.people} />}
                {c.lastText && <span className="line-clamp-2 break-words text-[13px] text-muted">{c.lastText}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length < total && <div className="flex justify-center"><Button variant="secondary" onClick={more}>{t('Показати ще ({n})', { n: total - rows.length })}</Button></div>}
    </div>
  )
}

function ChatOne({ id }: { id: string }) {
  const [people, setPeople] = useState<Person[]>([])
  const [kind, setKind] = useState<ChatKind | null>(null)
  return (
    <div className="grid gap-4">
      <PageHeader title={kind ? `${t('Розмова')} · ${KIND_L[kind]()}` : t('Розмова')} />
      {people.length > 0 && <People list={people} />}
      <div className="rounded-xl border border-line bg-panel p-3 shadow-sm">
        <ChatView chatId={id} admin surface="panel" onChat={(c) => { setPeople(c.people ?? []); setKind(c.kind) }} />
      </div>
    </div>
  )
}

/**
 * «Сповіщення в Discord і Telegram» (/notify): канали людини й її гільдії. Свої веде людина, гільдійні — офіцер і
 * лідер (учасник бачить, що підключено). Додати — дві картки поруч: Discord (адреса вебхука каналу) і Telegram
 * (посилання на бота сайту з одноразовим кодом; сторінка чекає, поки чат підключиться). У каналу — теми-перемикачі,
 * мова повідомлень, пробне повідомлення, вимкнення через помилку служби (з причиною) і видалення.
 */
import { useEffect, useRef, useState } from 'react'
import { BellRing, Hash, Send, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorAlert, Loading } from '@/components/states'
import { useCrumb } from '@/components/Crumbs'
import { Button } from '@/components/ui/button'
import { SnInput, valueOf } from '@/components/sn'
import { loginHref, useAuth } from '@/lib/auth'
import { LANGS, currentLang, t } from '@/lib/i18n'
import {
  addDiscord, kindLabel, linkStatus, loadNotify, removeChannel, telegramLink, testChannel, topicHint, topicLabel, updateChannel,
  type Channel, type NotifyState, type OwnerBlock, type TelegramLink, type Topic,
} from '@/lib/notify'
import { cn } from '@/lib/utils'

const MAX = 5

export default function Notify() {
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const [st, setSt] = useState<NotifyState | null>(null)
  const [error, setError] = useState<string | null>(null)
  useCrumb([])
  const load = () => loadNotify().then((r) => { setSt(r); setError(null) }).catch((e) => setError(e?.message || t('не вдалося завантажити')))
  useEffect(() => { if (user) load() }, [user?.id])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1100px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={t('Сповіщення в Discord і Telegram')}
          lead={t('Підключи канал Discord чи чат Telegram — і туди приходитимуть нові події, нагадування перед початком і новини про патчі гри. Для себе чи для всієї гільдії.')}
        />
        {!ready ? <Loading lines={3} /> : !user ? (
          <Empty icon={BellRing} title={t('Увійди, щоб підключити сповіщення')}>
            <Button href={loginHref()}>{t('Увійти')}</Button>
          </Empty>
        ) : error ? <ErrorAlert message={error} /> : !st ? <Loading lines={4} /> : (
          st.owners.map((o) => <OwnerSection key={`${o.owner.kind}:${o.owner.id}`} block={o} st={st} reload={load} admin={user.role === 'admin'} />)
        )}
      </div>
    </div>
  )
}

function OwnerSection({ block, st, reload, admin }: { block: OwnerBlock; st: NotifyState; reload: () => void; admin: boolean }) {
  const guild = block.owner.kind === 'guild'
  const title = guild ? t('Гільдія {name}', { name: block.guild?.name ?? '' }) : t('Мої сповіщення')
  return (
    <section aria-label={title} className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sm">
      <div className="grid gap-0.5">
        <h2 className="break-words font-display text-[17px] font-bold">{title}</h2>
        <p className="text-[13px] text-muted">
          {guild ? (block.manage ? t('Сповіщення для всієї гільдії: у її канал Discord чи чат Telegram.') : t('Канали гільдії налаштовують офіцери й лідер.')) : t('Лише для тебе: особистий чат Telegram чи твій сервер Discord.')}
        </p>
      </div>
      {block.channels.length > 0 && (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {block.channels.map((c) => (block.manage ? <ChannelCard key={c.id} c={c} st={st} guild={guild} reload={reload} /> : <ChannelLine key={c.id} c={c} />))}
        </ul>
      )}
      {block.manage && (block.channels.length < MAX ? <AddChannel block={block} st={st} reload={reload} admin={admin} /> : (
        <p className="text-[13px] text-muted">{t('Підключено найбільше можливих каналів ({n}). Щоб додати інший, прибери один із цих.', { n: MAX })}</p>
      ))}
      {!block.manage && !block.channels.length && <p className="text-[13px] text-muted">{t('Гільдія ще не підключила жодного каналу.')}</p>}
    </section>
  )
}

const KindIcon = ({ kind, size = 16 }: { kind: Channel['kind']; size?: number }) => (kind === 'discord' ? <Hash size={size} /> : <Send size={size} />)

function ChannelLine({ c }: { c: Channel }) {
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-panel2/40 px-3 py-2 text-[14px]">
      <KindIcon kind={c.kind} />
      <span className="min-w-0 break-words font-semibold">{c.label || kindLabel(c.kind)}</span>
      <span className="text-[12.5px] text-muted">{kindLabel(c.kind)}{!c.enabled && ` · ${t('вимкнено')}`}</span>
    </li>
  )
}

function ChannelCard({ c: initial, st, guild, reload }: { c: Channel; st: NotifyState; guild: boolean; reload: () => void }) {
  const [c, setC] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [sure, setSure] = useState(false)
  useEffect(() => setC(initial), [initial])
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setNote(null)
    try { await fn() } catch (e) { setNote({ ok: false, text: (e as Error)?.message || t('не вдалося') }) } finally { setBusy(null) }
  }
  const topics = c.topics ?? []
  const toggle = (x: Topic) => run('topic:' + x, async () => setC(await updateChannel(c.id, { topics: topics.includes(x) ? topics.filter((y) => y !== x) : [...topics, x] })))
  const langName = LANGS.find((l) => l.code === c.lang)?.name ?? c.lang
  return (
    <li className={cn('grid grid-cols-[minmax(0,1fr)] gap-2.5 rounded-lg border bg-panel2/30 px-3 py-3', c.enabled ? 'border-line' : 'border-rose-500/50')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <KindIcon kind={c.kind} size={18} />
          <span className="min-w-0 break-words text-[15px] font-semibold">{c.label || kindLabel(c.kind)}</span>
          <span className="text-[12.5px] text-muted">{kindLabel(c.kind)}</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" loading={busy === 'test'} onClick={() => run('test', async () => {
            const r = await testChannel(c.id)
            setC(r.channel)
            // канал вимкнено — причину вже видно в його картці
            setNote(r.ok ? { ok: true, text: t('Пробне повідомлення надіслано — перевір канал.') } : r.channel.enabled ? { ok: false, text: r.error || t('не вдалося') } : null)
          })}>{t('Надіслати пробне')}</Button>
          {sure ? (
            <Button size="sm" variant="destructive" loading={busy === 'del'} onClick={() => run('del', async () => { await removeChannel(c.id); reload() })}>{t('Так, відключити')}</Button>
          ) : (
            <Button size="sm" variant="ghost" aria-label={t('Відключити канал')} onClick={() => setSure(true)}><Trash2 size={15} /></Button>
          )}
        </span>
      </div>
      {!c.enabled && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-rose-500/10 px-2.5 py-1.5 text-[13px] text-rose-700 dark:text-rose-300">
          <span className="min-w-0 break-words">{t('Вимкнено: {why}', { why: c.error || t('служба не прийняла повідомлення') })}</span>
          <Button size="xs" variant="outline" loading={busy === 'on'} onClick={() => run('on', async () => setC(await updateChannel(c.id, { enabled: true })))}>{t('Увімкнути знову')}</Button>
        </div>
      )}
      {c.enabled && c.error && <p className="break-words text-[12.5px] text-spice">{t('Остання спроба не вдалась: {why}', { why: c.error })}</p>}
      <div className="grid gap-1.5" role="group" aria-label={t('Що надсилати')}>
        {st.topics.map((x) => (
          <button
            key={x} type="button" aria-pressed={topics.includes(x)} disabled={!!busy} onClick={() => toggle(x)}
            className={cn('flex min-w-0 items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors', topics.includes(x) ? 'border-spice/60 bg-spice/10' : 'border-line hover:border-spice/40')}
          >
            <span aria-hidden className={cn('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border text-[11px] leading-none', topics.includes(x) ? 'border-spice bg-spice text-white' : 'border-line')}>{topics.includes(x) ? '✓' : ''}</span>
            <span className="grid min-w-0">
              <span className="text-[14px] font-semibold">{topicLabel(x)}</span>
              <span className="text-[12.5px] text-muted">{topicHint(x, guild)}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        <span>{t('Мова повідомлень: {lang}', { lang: langName ?? '' })}</span>
        {c.lang !== currentLang() && (
          <Button size="xs" variant="outline" loading={busy === 'lang'} onClick={() => run('lang', async () => setC(await updateChannel(c.id, { lang: 'current' })))}>{t('Мовою сайту зараз')}</Button>
        )}
      </p>
      {note && <p className={cn('text-[13px]', note.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>{note.text}</p>}
    </li>
  )
}

function AddChannel({ block, st, reload, admin }: { block: OwnerBlock; st: NotifyState; reload: () => void; admin: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{t('Підключити канал')}</h3>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-2">
        <DiscordCard block={block} st={st} reload={reload} />
        <TelegramCard block={block} st={st} reload={reload} admin={admin} />
      </div>
    </div>
  )
}

function DiscordCard({ block, st, reload }: { block: OwnerBlock; st: NotifyState; reload: () => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setError(null)
    try { await addDiscord(block.owner, url.trim(), st.topics); setUrl(''); reload() } catch (e) { setError((e as Error)?.message || t('не вдалося')) } finally { setBusy(false) }
  }
  return (
    <div className="grid content-start gap-2 rounded-lg border border-line bg-panel2/30 px-3 py-3">
      <span className="flex items-center gap-2 text-[15px] font-semibold"><Hash size={18} />Discord</span>
      <ol className="list-decimal space-y-0.5 pl-5 text-[13px] text-muted">
        <li>{t('Налаштування каналу → Інтеграції → Вебхуки → «Новий вебхук».')}</li>
        <li>{t('«Копіювати URL вебхука» і встав сюди.')}</li>
      </ol>
      <SnInput size="lg" className="w-full" modelValue={url} placeholder="https://discord.com/api/webhooks/…" accessibilityLabel={t('Адреса вебхука Discord')} onInput={(e: Event) => setUrl(valueOf(e))} />
      {error && <p className="break-words text-[13px] text-rose-700 dark:text-rose-300">{error}</p>}
      <div><Button loading={busy} disabled={!url.trim()} onClick={submit}>{t('Підключити Discord')}</Button></div>
    </div>
  )
}

function TelegramCard({ block, st, reload, admin }: { block: OwnerBlock; st: NotifyState; reload: () => void; admin: boolean }) {
  const [link, setLink] = useState<TelegramLink | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])
  // чекаємо, поки людина натисне «Start» у Telegram: тоді канал з'являється сам
  useEffect(() => {
    if (!link) return
    timer.current = setInterval(() => {
      linkStatus(link.code, block.owner).then((s) => {
        if (s.state === 'waiting') return
        if (timer.current) clearInterval(timer.current)
        setLink(null)
        if (s.state === 'done') reload()
        else setError(t('Посилання застаріло — візьми нове.'))
      }).catch(() => {})
    }, 3000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [link?.code])
  const guild = block.owner.kind === 'guild'
  return (
    <div className="grid content-start gap-2 rounded-lg border border-line bg-panel2/30 px-3 py-3">
      <span className="flex items-center gap-2 text-[15px] font-semibold"><Send size={18} />Telegram</span>
      {!st.telegram ? (
        <p className="text-[13px] text-muted">{admin ? t('Бот Telegram ще не налаштовано: потрібен токен бота в налаштуваннях сервера.') : t('Telegram скоро буде: бот сайту ще не налаштований.')}</p>
      ) : link ? (
        <>
          <p className="text-[13px] text-muted">{guild ? t('Відкрий посилання й вибери чат гільдії — бот приєднається й надішле пробне повідомлення.') : t('Відкрий посилання й натисни «Start» — бот надішле пробне повідомлення.')}</p>
          <div className="flex flex-wrap gap-2">
            <Button href={guild ? link.group : link.private}>{guild ? t('Додати бота в групу') : t('Відкрити бота')}</Button>
            <Button variant="outline" href={guild ? link.private : link.group}>{guild ? t('Особистий чат') : t('У групу')}</Button>
          </div>
          <p className="text-[12.5px] text-muted">{t('Чекаємо на підключення… Посилання діє пів години.')}</p>
        </>
      ) : (
        <>
          <p className="text-[13px] text-muted">{guild ? t('Бот сайту в чаті гільдії: отримай посилання й додай бота в групу.') : t('Бот сайту в особистому чаті: отримай посилання й натисни «Start».')}</p>
          {error && <p className="text-[13px] text-rose-700 dark:text-rose-300">{error}</p>}
          <div>
            <Button loading={busy} onClick={async () => {
              setBusy(true); setError(null)
              try { setLink(await telegramLink(block.owner, st.topics)) } catch (e) { setError((e as Error)?.message || t('не вдалося')) } finally { setBusy(false) }
            }}>{t('Отримати посилання')}</Button>
          </div>
        </>
      )}
    </div>
  )
}

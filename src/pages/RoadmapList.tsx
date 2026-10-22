/**
 * Роадмапи: «Мої · Гільдія · Публічні» (components/ScopeTabs) — свої й гільдійські з прогресом етапів, публічні всіх
 * (LibraryBrowser — те саме, що в бібліотеці); новий — з назвою, власником, видимістю й правами. Без входу — публічні.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, Library, Plus, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { get, post } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { plainClick } from '@/lib/urlState'
import { progressOf } from '@/lib/roadmap'
import type { Item, Visibility } from '@/lib/items'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { AccessBadge, GuildTag, NewAccess, type OwnerRef } from '@/components/access/Access'
import { useNewRights } from '@/components/access/Rights'
import { SnInput, SnSkeleton, valueOf } from '@/components/sn'
import { PageHeader } from '@/components/PageHeader'
import { ScopeTabs, useScope } from '@/components/ScopeTabs'
import { LibraryBrowser } from '@/pages/Library'
import { Empty, ErrorAlert, PageError } from '@/components/states'
import { locale, t } from '@/lib/i18n'
import { Field } from './Auth'

/** речі, згруповані за власником: я — першим, далі гільдії */
export function byOwner(items: Item[], meId?: string) {
  const groups = new Map<string, { key: string; owner: Item['owner']; items: Item[] }>()
  for (const it of items) {
    const key = `${it.owner.kind}:${it.owner.id}`
    if (!groups.has(key)) groups.set(key, { key, owner: it.owner, items: [] })
    groups.get(key)!.items.push(it)
  }
  return [...groups.values()].sort((a, b) => (a.owner.id === meId ? -1 : b.owner.id === meId ? 1 : a.owner.name.localeCompare(b.owner.name, locale())))
}

export function NewRoadmap({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user, guilds } = useAuth()
  const setView = useStore((s) => s.setView)
  const main = guilds.find((g) => g.id === user?.mainGuild && g.role !== 'recruit')
  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState<OwnerRef>(main ? { kind: 'guild', id: main.id } : { kind: 'user', id: user?.id || '' })
  // права нової речі — у тому ж вікні, під «Хто власник» і «Хто бачить»
  const rights = useNewRights('roadmap')
  const [vis, setVis] = useState<Visibility>(main ? 'guild' : 'private')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await post<{ id: string }>('/api/roadmaps', { title, owner, visibility: vis })
      await rights.apply(r, owner, vis)
      toast.success(t('Роадмап створено'))
      setView('roadmap', { param: r.id })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('Новий роадмап')} description={t('Етапи, задачі, таблиці витрат — що будувати далі й що вже зроблено.')}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label={t('Назва')}>
          <SnInput
            modelValue={title}
            maxLength={120}
            required
            autofocus
            placeholder={t('Наприклад: дорога до орнітоптера')}
            accessibilityLabel={t('Назва')}
            onInput={(e: Event) => setTitle(valueOf(e))}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && title.trim() && !busy) { e.preventDefault(); void submit() } }}
          />
        </Field>
        <NewAccess owner={owner} visibility={vis} rights={rights} onChange={(o, v) => { setOwner(o); setVis(v) }} />
        {error && <ErrorAlert title={t('Не вдалося створити роадмап')} message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Скасувати')}</Button>
          <Button type="submit" disabled={busy || !title.trim()} loading={busy}>{busy ? t('Створюю…') : t('Створити')}</Button>
        </div>
      </form>
    </Modal>
  )
}

/** скелет списку: заголовок власника й картки тієї ж форми, що й справжні */
function ListSkeleton() {
  return (
    <section className="grid gap-2" aria-busy="true" aria-label={t('Завантаження…')}>
      <SnSkeleton height={22} width="12rem" />
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))]">
        {[0, 1, 2].map((i) => <li key={i}><SnSkeleton height={104} /></li>)}
      </ul>
    </section>
  )
}

/** смужка прогресу етапів (з опису роадмапу в списку); не розібрався — нічого */
export function RoadmapProgress({ summary, className }: { summary: string; className?: string }) {
  const p = progressOf(summary)
  if (!p || !p.n) return null
  return (
    <div className={className} aria-label={summary}>
      <div className="h-1.5 overflow-hidden rounded-full bg-line/50">
        <div className="h-full rounded-full bg-spice" style={{ width: `${Math.round((p.done / p.n) * 100)}%` }} />
      </div>
    </div>
  )
}

export function RoadmapList() {
  const user = useAuth((s) => s.user)
  const ready = useAuth((s) => s.ready)
  const setView = useStore((s) => s.setView)
  // на вхід — без перезавантаження сторінки, і назад сюди ж
  const login = () => setView('login', { search: `?next=${encodeURIComponent(location.pathname + location.search)}` })
  const [rows, setRows] = useState<Item[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const load = useCallback(() => {
    setFailed(false)
    get<{ rows: Item[] }>('/api/roadmaps').then((r) => setRows(r.rows)).catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])
  const sc = useScope()
  // вкладка: мої — особисті, гільдія — роадмапи моєї гільдії
  const shown = useMemo(() => (rows ?? []).filter((it) => (sc.scope === 'guild' ? it.owner.kind === 'guild' && it.owner.id === sc.guild?.id : it.owner.kind === 'user' && it.owner.id === user?.id)), [rows, sc.scope, sc.guild?.id, user?.id])
  const groups = useMemo(() => byOwner(shown, user?.id), [shown, user?.id])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={t('Роадмапи')}
          lead={t('Що будувати далі, скільки коштує і що вже зроблено: твої, гільдійські й публічні роадмапи всіх.')}
          actions={user ? <Button onClick={() => setOpen(true)}><Plus size={15} />{t('Новий роадмап')}</Button> : ready && <Button onClick={login}>{t('Увійти, щоб вести свої')}</Button>}
        >
          <ScopeTabs {...sc} />
        </PageHeader>
        {sc.scope === 'public' && <LibraryBrowser kind="roadmap" />}
        {sc.scope !== 'public' && <>
        {failed && !rows && <PageError title={t('Роадмапи не завантажились')} onRetry={load} />}
        {failed && rows && <ErrorAlert message={t('Список не оновився. Онови сторінку трохи згодом.')} />}
        {!rows && !failed && <ListSkeleton />}
        {rows && !shown.length && (
          <Empty icon={TrendingUp} title={sc.scope === 'guild' ? t('У гільдії роадмапів поки нема') : t('Роадмапів поки нема')} description={t('Створи перший — особистий чи для гільдії: етапи, задачі й таблиці витрат в одному місці.')}>
            <Button onClick={() => setOpen(true)}><Plus size={15} />{t('Створи перший роадмап')}</Button>
            <Button variant="secondary" onClick={() => sc.set('public')}><Library size={15} />{t('Подивитись публічні')}</Button>
          </Empty>
        )}
        {groups.map((g) => (
          <section key={g.key} className="grid gap-2">
            <h2 className="flex items-center gap-2 px-1 font-display text-[15px] font-bold">
              {g.owner.kind === 'guild' ? <><GuildTag tag={g.owner.tag || '?'} color={g.owner.color} />{g.owner.name}</> : g.owner.id === user?.id ? t('Мої') : g.owner.name}
            </h2>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))]">
              {g.items.map((it) => (
                <li key={it.id}>
                  {/* Ctrl/⌘-клік і середня кнопка — як у звичайного посилання (нова вкладка) */}
                  <a href={`/roadmap/${it.id}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('roadmap', { param: it.id }) }} className="group grid h-full gap-2 rounded-xl border border-line bg-panel p-4 shadow-sm transition-colors hover:border-spice/60">
                    <div className="flex items-start gap-2">
                      <TrendingUp size={17} className="mt-0.5 shrink-0 text-spice" />
                      {/* довга назва — у два рядки, а не обрізана */}
                      <h3 className="line-clamp-2 min-w-0 flex-1 break-words font-display text-[15.5px] font-bold leading-snug" title={it.title}>{it.title}</h3>
                      <ArrowRight size={16} className="mt-0.5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-spice" />
                    </div>
                    <p className="text-[13px] text-muted">{it.summary}</p>
                    <RoadmapProgress summary={it.summary} />
                    <div className="flex flex-wrap items-center gap-2">
                      <AccessBadge visibility={it.visibility} owner={it.owner} />
                      <span className="text-[12px] text-muted">{t('змінено {date}', { date: new Date(it.updated).toLocaleDateString(locale()) })}</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
        </>}
      </div>
      {open && <NewRoadmap open={open} onOpenChange={setOpen} />}
    </div>
  )
}

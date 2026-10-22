/**
 * Розділ «Бази»: «Мої · Гільдія · Публічні» (components/ScopeTabs; публічні всіх — LibraryBrowser, як у бібліотеці); свої
 * й гільдійські — картками — знімок 3D поточної версії (малює сервер),
 * назва, вступ, ключові цифри й значок доступу. Тут же створити нову (порожню чи копією наявної — і чию, і хто
 * бачить), імпортувати з файлу (вивантаженого на сторінці бази), копіювати, видалити (кнопки — лише тим, кому
 * можна; на телефоні — завжди видно, з мишею — при наведенні); видалені — окремим списком, їх можна повернути.
 * Копія — та сама, що з бібліотеки («на основі …», лічильник копій).
 */
import { useEffect, useState, type FormEvent } from 'react'
import { ArrowRight, Building2, Copy, Library, PencilRuler, Plus, RotateCcw, Sparkles, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { blankBase, copyBase, createBase, thumbUrl, useBases, useBasesLive, type BaseSummary } from '@/lib/bases'
import { plainClick } from '@/lib/urlState'
import { Confirm, NameDialog, eraseBase, trashBase, untrashBase } from '@/components/base/Ask'
import { useStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { creatorGuilds, loginHref, useAuth } from '@/lib/auth'
import type { Visibility } from '@/lib/items'
import { AccessBadge, GuildTag, NewAccess, type OwnerRef } from '@/components/access/Access'
import { useNewRights } from '@/components/access/Rights'
import { byOwner } from './RoadmapList'
import { Field } from './Auth'
import { SnInput, valueOf } from '@/components/sn'
import { PageHeader } from '@/components/PageHeader'
import { ScopeTabs, useScope } from '@/components/ScopeTabs'
import { LibraryBrowser } from '@/pages/Library'
import { Empty, Loading, PageError } from '@/components/states'
import { ImportBase } from '@/components/base/ImportBase'
import { locale, t } from '@/lib/i18n'
import { cn, word } from '@/lib/utils'

const IMG = 'h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]'

/** редактор — з комп'ютера: на телефоні після створення відкриваємо сторінку бази */
const narrow = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 767px)').matches

/** прев'ю бази — знімок 3D поточної версії, який малює сервер (браузер лише показує картинку); null — не вдався */
function Thumb3D({ name, src }: { name: string; src: string | null }) {
  const [failed, setFailed] = useState(false)
  if (failed || !src) return <div className="grid h-full w-full place-items-center text-[12px] text-muted">{t('Знімок недоступний')}</div>
  return <img src={src} alt={t('{name}, 3D', { name })} loading="lazy" decoding="async" onError={() => setFailed(true)} className={IMG} />
}

function NewBase({ list, open, onOpenChange }: { list: BaseSummary[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user, guilds } = useAuth()
  const main = creatorGuilds(guilds).find((g) => g.id === user?.mainGuild)
  const [name, setName] = useState('')
  const [from, setFrom] = useState('')
  const [owner, setOwner] = useState<OwnerRef>(main ? { kind: 'guild', id: main.id } : { kind: 'user', id: user?.id || '' })
  // права нової речі — у тому ж вікні, під «Хто власник» і «Хто бачить»
  const rights = useNewRights('base')
  const [vis, setVis] = useState<Visibility>(main ? 'guild' : 'private')
  const [busy, setBusy] = useState(false)
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const n = name.trim()
    if (!n) return
    setBusy(true)
    try {
      // примітка до першої версії — службова, українською: мовою людини її показує сервер (noteText)
      const b = from ? await copyBase(from, n, owner, vis) : await createBase(await blankBase(n), 'Нова база', owner, vis)
      await rights.apply(b, owner, vis)
      toast.success(t('Базу «{name}» створено', { name: n }))
      useStore.getState().setView('bases', narrow() ? { base: b.id } : { base: b.id, edit: true })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const templates = [{ id: '', name: t('Порожня'), sub: t('одна ділянка 10×10') }, ...list.filter((b) => !b.deleted).map((b) => ({ id: b.id, name: b.name, sub: t('копія') }))]
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('Нова база')} description={t('Порожня чи копія наявної; одразу відкриється редактор.')}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label={t('Назва')}>
          <SnInput size="md" autofocus required modelValue={name} maxLength={120} placeholder={t('Наприклад: Аванпост на Хагга')} accessibilityLabel={t('Назва')}
            onInput={(e: Event) => setName(valueOf(e) ?? '')}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && name.trim() && !busy) { e.preventDefault(); void submit() } }} />
        </Field>
        <div className="grid gap-1.5">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('Шаблон')}</span>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
            {templates.map((tpl) => (
              <button key={tpl.id} type="button" aria-pressed={from === tpl.id} onClick={() => setFrom(tpl.id)}
                className={cn('grid gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors', from === tpl.id ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40')}>
                <span className="truncate text-[13.5px] font-semibold">{tpl.name}</span>
                <span className="text-[12px] text-muted">{tpl.sub}</span>
              </button>
            ))}
            {/* генератор — своя сторінка з параметрами й переглядом */}
            <a href="/bases/generate" onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); onOpenChange(false); useStore.getState().setView('bases', { param: 'generate' }) }}
              className="grid gap-0.5 rounded-lg border border-dashed border-spice/50 px-3 py-2 text-left transition-colors hover:border-spice hover:bg-spice/5">
              <span className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold"><Sparkles size={13} className="text-spice" /> {t('Згенерувати…')}</span>
              <span className="text-[12px] text-muted">{t('з ділянок і того, що потрібно')}</span>
            </a>
          </div>
        </div>
        <NewAccess owner={owner} visibility={vis} rights={rights} onChange={(o, v) => { setOwner(o); setVis(v) }} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Скасувати')}</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? t('Створюю…') : narrow() ? t('Створити') : t('Створити й редагувати')}</Button>
        </div>
      </form>
    </Modal>
  )
}

export function BasesList() {
  const setView = useStore((s) => s.setView)
  const list = useBases((s) => s.list)
  const failed = useBases((s) => s.listError)
  const { user, guilds, ready } = useAuth()
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [ask, setAsk] = useState<{ act: 'copy' | 'trash' | 'purge'; b: BaseSummary } | null>(null)
  useBasesLive()
  useEffect(() => { void useBases.getState().loadList() }, [])
  const live = (list || []).filter((b) => !b.deleted)
  const gone = (list || []).filter((b) => b.deleted)
  const sc = useScope()
  // вкладка: мої — особисті, гільдія — бази моєї гільдії (видалені — у своїй вкладці так само)
  const inTab = (b: BaseSummary) => (sc.scope === 'guild' ? b.item.owner.kind === 'guild' && b.item.owner.id === sc.guild?.id : b.item.owner.kind === 'user' && b.item.owner.id === user?.id)
  const shown = live.filter(inTab)
  const goneHere = gone.filter(inTab)
  const groups = byOwner(shown.map((b) => b.item), user?.id).map((g) => ({ ...g, bases: g.items.map((it) => shown.find((b) => b.id === it.id)!).filter(Boolean) }))

  const copy = async (b: BaseSummary, name: string) => {
    try {
      // копія — тому ж власнику, якщо в ньому можна створювати; інакше — собі
      const o = b.item.owner
      const owner = o.kind === 'guild' && creatorGuilds(guilds).some((g) => g.id === o.id) ? { kind: 'guild' as const, id: o.id } : undefined
      const nb = await copyBase(b.id, name, owner, owner ? 'guild' : 'private')
      toast.success(t('Створено «{name}»', { name }))
      setView('bases', narrow() ? { base: nb.id } : { base: nb.id, edit: true })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={t('Бази')}
          lead={t('Твої, гільдійські й публічні. План по рівнях, 3D, ліміти, етапи будівництва і кошторис для кожної — і редактор, у якому їх можна змінити чи зібрати нову.')}
          actions={
            <>
              {user && <Button variant="secondary" onClick={() => setImporting(true)} title={t('Нова база з файлу, вивантаженого на сторінці бази')}><Upload size={15} /> {t('Імпортувати')}</Button>}
              <Button variant="secondary" href="/bases/generate" onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('bases', { param: 'generate' }) }} title={t('База з деталей гри за твоїми ділянками й потребами')}><Sparkles size={15} /> {t('Згенерувати')}</Button>
              {user ? <Button onClick={() => setCreating(true)} disabled={!list}><Plus size={15} /> {t('Нова база')}</Button> : ready && <Button onClick={() => location.assign(loginHref())}>{t('Увійти, щоб мати свої')}</Button>}
            </>
          }
        >
          <ScopeTabs {...sc} />
        </PageHeader>
        {sc.scope === 'public' && <LibraryBrowser kind="base" />}
        {sc.scope !== 'public' && <>
        {!list && (failed
          ? <PageError title={t('Бази не завантажились')} message={t('Бази зараз не завантажились. Онови сторінку трохи згодом.')} onRetry={() => useBases.getState().loadList()} />
          : <Loading label={t('Завантаження баз…')} />)}
        {list && !shown.length && (
          <Empty icon={Building2} title={sc.scope === 'guild' ? t('У гільдії баз поки нема') : t('Баз поки нема')} description={t('Створи першу — особисту чи для гільдії, імпортуй з файлу або скопіюй собі з бібліотеки.')}>
            <Button onClick={() => setCreating(true)}><Plus size={15} /> {t('Нова база')}</Button>
            <Button variant="secondary" onClick={() => setView('bases', { param: 'generate' })}><Sparkles size={15} /> {t('Згенерувати')}</Button>
            <Button variant="secondary" onClick={() => setImporting(true)}><Upload size={15} /> {t('Імпортувати')}</Button>
            <Button variant="ghost" onClick={() => sc.set('public')}><Library size={15} />{t('Подивитись публічні')}</Button>
          </Empty>
        )}
        {groups.map((g) => (
          <section key={g.key} className="grid gap-2">
            <h2 className="flex items-center gap-2 px-1 font-display text-[15px] font-bold">
              {g.owner.kind === 'guild' ? <><GuildTag tag={g.owner.tag || '?'} color={g.owner.color} />{g.owner.name}</> : g.owner.id === user?.id ? t('Мої') : g.owner.name}
            </h2>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(min(420px,100%),1fr))]">
            {g.bases.map((b) => {
              return (
                <li key={b.id} className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-sm transition-colors hover:border-spice/60">
                  <a href={`/bases/${b.id}`} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('bases', { base: b.id }) }} className="flex flex-1 flex-col">
                    <div className="aspect-[960/560] overflow-hidden bg-[var(--plan-bg)]">
                      <Thumb3D key={thumbUrl(b)} name={b.name} src={b.thumb === null ? null : thumbUrl(b)} />
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-3.5">
                      <div className="flex items-center gap-2">
                        <h3 className="font-display text-[16px] font-bold">{b.name}</h3>
                        <span className="rounded-full bg-panel2 px-2 py-0.5 font-mono text-[10.5px] text-muted">v{b.version}</span>
                        <ArrowRight size={16} className="ml-auto text-muted transition-colors group-hover:text-spice" />
                      </div>
                      {b.lead && <p className="text-[13px] leading-snug text-muted">{b.lead}</p>}
                      <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] tabular-nums text-muted [&_b]:font-semibold [&_b]:text-ink">
                        {(b.facts.length ? b.facts : [
                          `<b>${b.rooms}</b> ${word(b.rooms, [t('приміщення'), t('приміщення'), t('приміщень')])}`,
                          `<b>${b.tiles}</b> ${word(b.tiles, [t('плита'), t('плити'), t('плит')])}`,
                          `<b>${b.items}</b> ${word(b.items, [t('пристрій'), t('пристрої'), t('пристроїв')])}`,
                        ]).map((f, i) => (
                          <li key={i} dangerouslySetInnerHTML={{ __html: f }} />
                        ))}
                      </ul>
                    </div>
                  </a>
                  <div className="pointer-events-none absolute left-2 top-2"><AccessBadge visibility={b.item.visibility} owner={b.item.owner} className="bg-panel/95 shadow-sm" /></div>
                  {/* дії — поверх картки: з мишею — при наведенні (і з клавіатури), на телефоні — завжди; лише ті, що можна.
                      Редагувати — з комп'ютера (редактор на телефоні непридатний) */}
                  <div className="absolute right-2 top-2 flex gap-1 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0">
                    {b.item.can?.edit && (
                      <Button variant="secondary" size="icon" className="max-md:hidden" title={t('Редагувати')} aria-label={t('Редагувати «{name}»', { name: b.name })} onClick={() => setView('bases', { base: b.id, edit: true })}>
                        <PencilRuler size={14} />
                      </Button>
                    )}
                    {user && (
                      <Button variant="secondary" size="icon" title={t('Копіювати як нову базу')} aria-label={t('Копіювати «{name}»', { name: b.name })} onClick={() => setAsk({ act: 'copy', b })}>
                        <Copy size={14} />
                      </Button>
                    )}
                    {b.item.can?.manage && (
                      <Button variant="secondary" size="icon" title={t('Видалити')} aria-label={t('Видалити «{name}»', { name: b.name })} onClick={() => setAsk({ act: 'trash', b })}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          </section>
        ))}
        {goneHere.length > 0 && (
          <details className="rounded-xl border border-line bg-panel px-4 py-2.5">
            <summary className="cursor-pointer text-[13px] text-muted">{t('Видалені бази · {n}', { n: goneHere.length })}</summary>
            <ul className="mt-2 grid gap-1.5">
              {goneHere.map((b) => (
                <li key={b.id} className="flex items-center gap-2 text-[13.5px]">
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  <span className="font-mono text-[11.5px] text-muted">{new Date(b.deleted!).toLocaleDateString(locale())}</span>
                  <Button variant="secondary" size="sm" onClick={() => void untrashBase(b)}>
                    <RotateCcw size={13} /> {t('Повернути')}
                  </Button>
                  {(b.item.can as { own?: boolean } | undefined)?.own && (
                    <Button variant="ghost" size="sm" className="text-bad hover:text-bad" onClick={() => setAsk({ act: 'purge', b })}>
                      <Trash2 size={13} /> {t('Видалити назавжди')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
        </>}
      </div>
      {creating && list && <NewBase list={list} open={creating} onOpenChange={setCreating} />}
      {ask?.act === 'copy' && (
        <NameDialog title={t('Копія бази «{name}»', { name: ask.b.name })} label={t('Назва копії')} value={t('{name} — копія', { name: ask.b.name })} confirm={t('Копіювати')}
          onClose={() => setAsk(null)} onSubmit={(name) => void copy(ask.b, name)} />
      )}
      {ask?.act === 'trash' && (
        <Confirm danger title={t('Видалити базу «{name}»?', { name: ask.b.name })} text={t('Вона піде в кошик — її можна буде повернути зі списку видалених.')} confirm={t('Видалити')}
          onClose={() => setAsk(null)} onConfirm={() => void trashBase(ask.b)} />
      )}
      {ask?.act === 'purge' && (
        <Confirm danger title={t('Стерти «{name}» назавжди?', { name: ask.b.name })} text={t('Разом з усіма версіями. Повернути вже не вийде.')} confirm={t('Видалити назавжди')}
          onClose={() => setAsk(null)} onConfirm={() => void eraseBase(ask.b)} />
      )}
      {importing && <ImportBase open={importing} onOpenChange={setImporting} />}
    </div>
  )
}

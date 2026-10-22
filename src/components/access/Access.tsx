/**
 * Чиє це і хто бачить — на кожній речі: значок доступу (особисте, гільдія, за посиланням, публічне), власник
 * (людина чи гільдія з тегом), «на основі …»; вибір власника й видимості — картками поруч (без випадних списків);
 * вікно «Доступ» і рядок дій над річчю (доступ, зірка, копія собі).
 */
import { useState, type ReactNode } from 'react'
import { Copy, Globe, Link2, Lock, Shield, Star, BadgeCheck } from 'lucide-react'
import { toast } from 'sonner'
import { creatorGuilds, loginHref, useAuth, type MyGuild } from '@/lib/auth'
import { copyItem, hrefOf, setAccess, star, type Item, type Owner, type Visibility } from '@/lib/items'
import { useStore, openPath } from '@/store'
import { t, T } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ActionsTrigger, Menu, type MenuEntry } from '@/components/ui/menu'
import { confirmAsk } from '@/components/ui/confirm'
import { ErrorAlert } from '@/components/states'
import { cn } from '@/lib/utils'
import { plainClick } from '@/lib/urlState'
import { useItemRightsExtra, type NewRights } from '@/components/access/Rights'

export const VIS_META: Record<Visibility, { label: string; icon: typeof Lock; hint: string; cls: string }> = {
  private: { label: t('Особисте'), icon: Lock, hint: t('Бачиш лише ти'), cls: 'border-line bg-panel2 text-muted' },
  guild: { label: t('Гільдія'), icon: Shield, hint: t('Бачать учасники гільдії; змінюють учасники, керують офіцери'), cls: 'border-spice/40 bg-spice/10 text-spice' },
  link: { label: t('За посиланням'), icon: Link2, hint: t('Бачить кожен, у кого є адреса; у списках і бібліотеці не видно'), cls: 'border-warn/40 bg-warn/10 text-warn' },
  public: { label: t('Публічне'), icon: Globe, hint: t('Бачать усі; є в бібліотеці'), cls: 'border-ok/40 bg-ok/10 text-ok' },
}
export const visFor = (ownerKind: 'user' | 'guild' | 'site'): Visibility[] => (ownerKind === 'guild' ? ['guild', 'link', 'public'] : ['private', 'link', 'public'])

/** ініціали на кольорі людини */
export function Avatar({ name, color, size = 28, className }: { name: string; color: string; size?: number; className?: string }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-display font-bold text-white', className)}
      style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {letters}
    </span>
  )
}

/** тег гільдії: [SW] у її кольорі */
export function GuildTag({ tag, color, className }: { tag: string; color: string; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded px-1.5 py-px font-display text-[10.5px] font-bold tracking-wide text-white', className)} style={{ background: color }}>
      {tag}
    </span>
  )
}

/** значок доступу; withOwner — ще й чиє (тег гільдії чи ім'я людини) */
export function AccessBadge({ visibility, owner, size = 'sm', className }: { visibility: Visibility; owner?: Owner; size?: 'sm' | 'md'; className?: string }) {
  const m = VIS_META[visibility]
  const label = visibility === 'guild' && owner?.tag ? t('Гільдія {tag}', { tag: owner.tag }) : m.label
  return (
    <span
      title={m.hint}
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-full border font-medium', size === 'md' ? 'px-2.5 py-1 text-[12px]' : 'px-2 py-0.5 text-[11px]', m.cls, className)}
    >
      <m.icon size={size === 'md' ? 13 : 11} aria-hidden />
      {label}
    </span>
  )
}

/** власник посиланням: гільдія — на її сторінку, людина — на її */
export function OwnerLink({ owner, className }: { owner: Owner; className?: string }) {
  const setView = useStore((s) => s.setView)
  // сам сайт (офіційний вміст) — знак сайту й назва, без посилання на людину чи гільдію
  if (owner.kind === 'site') return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted', className)} title={t('Офіційне від сайту')}>
      <BadgeCheck size={16} className="shrink-0 text-spice" /><span className="truncate">{owner.name}</span>
    </span>
  )
  const href = owner.kind === 'guild' ? `/g/${owner.slug}` : `/u/${owner.login}`
  const ok = owner.kind === 'guild' ? !!owner.slug : !!owner.login
  const body = (
    <>
      {owner.kind === 'guild' ? <GuildTag tag={owner.tag || '?'} color={owner.color} /> : <Avatar name={owner.name} color={owner.color} size={18} />}
      <span className="truncate">{owner.name}</span>
    </>
  )
  if (!ok) return <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted', className)}>{body}</span>
  return (
    <a
      href={href}
      onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); e.stopPropagation(); setView(owner.kind === 'guild' ? 'guild' : 'user', { param: owner.kind === 'guild' ? owner.slug! : owner.login! }) }}
      className={cn('inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted hover:text-ink', className)}
    >
      {body}
    </a>
  )
}

export type OwnerRef = { kind: 'user' | 'guild' | 'site'; id: string }

/** картка вибору */
function Choice({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-col items-start gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        on ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40',
      )}
    >
      {children}
    </button>
  )
}

/** чиє: я (особисте) чи одна з гільдій, де я щонайменше учасник */
export function OwnerPicker({ value, onChange, guilds }: { value: OwnerRef; onChange: (o: OwnerRef) => void; guilds?: MyGuild[] }) {
  const me = useAuth((s) => s.user)
  const all = useAuth((s) => s.guilds)
  const gs = creatorGuilds(guilds ?? all)
  if (!me) return null
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
      <Choice on={value.kind === 'user'} onClick={() => onChange({ kind: 'user', id: me.id })}>
        <span className="flex items-center gap-2 text-[13.5px] font-semibold"><Avatar name={me.name} color={me.color} size={20} />{t('Я')}</span>
        <span className="text-[12px] text-muted">{t('Твоє особисте')}</span>
      </Choice>
      {gs.map((g) => (
        <Choice key={g.id} on={value.kind === 'guild' && value.id === g.id} onClick={() => onChange({ kind: 'guild', id: g.id })}>
          <span className="flex min-w-0 items-center gap-2 text-[13.5px] font-semibold"><GuildTag tag={g.tag} color={g.color} /><span className="truncate">{g.name}</span></span>
          <span className="text-[12px] text-muted">{t('Гільдії — бачать усі учасники')}</span>
        </Choice>
      ))}
      {(me.role === 'admin' || !!me.perms?.some((p) => p === '*' || p === 'site.*' || p === 'site.content')) && (
        <Choice on={value.kind === 'site'} onClick={() => onChange({ kind: 'site', id: 'site' })}>
          <span className="flex items-center gap-2 text-[13.5px] font-semibold"><BadgeCheck size={18} className="text-spice" />{t('Сайт')}</span>
          <span className="text-[12px] text-muted">{t('Офіційне: не в чиємусь списку, а в бібліотеці')}</span>
        </Choice>
      )}
    </div>
  )
}

/** хто бачить: варіанти — за видом власника */
export function VisPicker({ ownerKind, value, onChange }: { ownerKind: 'user' | 'guild' | 'site'; value: Visibility; onChange: (v: Visibility) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
      {visFor(ownerKind).map((v) => {
        const m = VIS_META[v]
        return (
          <Choice key={v} on={value === v} onClick={() => onChange(v)}>
            <span className="flex items-center gap-1.5 text-[13.5px] font-semibold"><m.icon size={14} className={cn(m.cls.split(' ').find((c) => c.startsWith('text-')))} />{m.label}</span>
            <span className="text-[12px] leading-snug text-muted">{m.hint}</span>
          </Choice>
        )
      })}
    </div>
  )
}

/** власник і видимість для нової речі — разом (видимість підлаштовується під власника) */
export function NewAccess({ owner, visibility, onChange, rights }: { owner: OwnerRef; visibility: Visibility; onChange: (o: OwnerRef, v: Visibility) => void; rights?: NewRights }) {
  const fix = (o: OwnerRef, v: Visibility): Visibility => (visFor(o.kind).includes(v) ? v : o.kind === 'guild' ? 'guild' : 'private')
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('Хто власник')}</span>
        <OwnerPicker value={owner} onChange={(o) => onChange(o, fix(o, visibility))} />
      </div>
      <div className="grid gap-1.5">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('Хто бачить')}</span>
        <VisPicker ownerKind={owner.kind} value={visibility} onChange={(v) => onChange(owner, v)} />
      </div>
      {/* права нової речі (useNewRights) — від вибраних тут власника й видимості */}
      {rights?.render(owner, visibility)}
    </div>
  )
}

/**
 * Додаток до вікна «Доступ» для речі зі своїми правами (роадмап): render — розділ під «Хто бачить», що бачить
 * вибраного власника й видимість ще до збереження; save — після збереження доступу (помилка — лишаємо вікно відкритим).
 */
export interface AccessExtra {
  render: (owner: OwnerRef, visibility: Visibility) => ReactNode
  /** повертає оновлену річ, якщо права змінились (права могли змінити й «змінювати» в неї) */
  save: (owner: OwnerRef, visibility: Visibility) => Promise<Item | void>
  /** вікно відкрили — почати з того, що збережено */
  reset?: () => void
}

/** вікно «Доступ»: передати (собі чи гільдії), хто бачить, і (extra) права самої речі */
export function AccessDialog({ item, open, onOpenChange, onSaved, extra }: { item: Item; open: boolean; onOpenChange: (v: boolean) => void; onSaved?: (it: Item) => void; extra?: AccessExtra }) {
  const me = useAuth((s) => s.user)
  const [owner, setOwner] = useState<OwnerRef>({ kind: item.owner.kind, id: item.owner.id })
  const [vis, setVis] = useState<Visibility>(item.visibility)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // чужа річ (адміністратор) чи гільдійська для офіцера: власника лишаємо, міняємо лише видимість
  const foreign = (item.owner.kind === 'user' && item.owner.id !== me?.id) || (item.owner.kind === 'site' && item.can?.own !== true) || (item.owner.kind === 'guild' && item.can?.own === false)
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const same = owner.kind === item.owner.kind && owner.id === item.owner.id
      const it0 = same && vis === item.visibility ? item : await setAccess(item, same ? null : owner, vis)
      const it = (await extra?.save(owner, vis)) || it0
      toast.success(t('Доступ змінено'))
      onSaved?.(it)
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size={extra ? 'lg' : 'md'}
      title={t('Доступ: {title}', { title: item.title })}
      description={extra ? t('Чия це річ, хто її бачить і хто що з нею може. Публічне потрапляє в бібліотеку.') : t('Чия це річ і хто її бачить. Публічне потрапляє в бібліотеку.')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Скасувати')}</Button>
          <Button onClick={save} disabled={busy} loading={busy}>{busy ? t('Зберігаю…') : t('Зберегти')}</Button>
        </>
      }
    >
      <div className="grid gap-4">
        {foreign ? (
          <p className="text-[13px] text-muted"><T text="Власник — {owner}. Ти змінюєш лише видимість." owner={<OwnerLink owner={item.owner} />} /></p>
        ) : (
          <NewAccess owner={owner} visibility={vis} onChange={(o, v) => { setOwner(o); setVis(v) }} />
        )}
        {foreign && <VisPicker ownerKind={item.owner.kind} value={vis} onChange={setVis} />}
        {extra?.render(foreign ? { kind: item.owner.kind, id: item.owner.id } : owner, vis)}
        {error && <ErrorAlert title={t('Не вдалося змінити доступ')} message={error} />}
      </div>
    </Modal>
  )
}

/**
 * Рядок над річчю: значок доступу, власник, «на основі …», дії — «Доступ» (керує власник чи офіцер гільдії), зірка
 * (бази, білди, роадмапи, розрахунки), «Копіювати собі» (усе, що бачиш, — крім свого). actions={false} — лише значки,
 * а дії (ItemActions) сторінка ставить сама, поряд зі своїми кнопками.
 */
export function ItemBar({ item, onChange, className, extra, actions = true, onCopy, accessExtra }: { item: Item; onChange?: (it: Item) => void; className?: string; extra?: ReactNode; actions?: boolean; onCopy?: (() => void) | null; accessExtra?: AccessExtra }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}>
      <AccessBadge visibility={item.visibility} owner={item.owner} size="md" />
      <OwnerLink owner={item.owner} />
      {item.basedOn && <span className="text-[12px] text-muted">{t('на основі «{title}» ({owner})', { title: item.basedOn.title, owner: item.basedOn.owner })}</span>}
      {item.hidden && <span className="rounded-full bg-bad/15 px-2 py-0.5 text-[11px] font-semibold text-bad">{t('Приховано модератором')}</span>}
      {(actions || extra) && (
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {extra}
          {actions && <ItemActions item={item} onChange={onChange} onCopy={onCopy} accessExtra={accessExtra} />}
        </span>
      )}
    </div>
  )
}

/**
 * Дії з річчю: зірка, «Копіювати собі», «Доступ» (з вікном доступу) — кнопки без обгортки, у ряд до інших.
 * onCopy — своя копія (роадмап: вікно «куди й з позначками»); null — копіювати не можна (кнопки нема).
 * more — другорядні дії сторінки: тоді в кінці меню «Дії» з ними; copyInMenu — «Копіювати» теж туди (тому, хто й так змінює річ,
 * копія — рідка дія), інакше копіювання лишається кнопкою — для гостя це головне.
 */
export function ItemActions({ item, onChange, onCopy, accessExtra: own, more, copyInMenu }: { item: Item; onChange?: (it: Item) => void; onCopy?: (() => void) | null; accessExtra?: AccessExtra; more?: MenuEntry[]; copyInMenu?: boolean }) {
  const me = useAuth((s) => s.user)
  const guilds = useAuth((s) => s.guilds)
  // власник дозволив копіювати лише в гільдію
  const guildOnly = !!item.can?.copyTo && !item.can.copyTo.includes('user')
  // права речі — у вікні «Доступ»; роадмап має свої (з прогресом), решта — спільні (components/access/Rights)
  const generic = useItemRightsExtra(item)
  const accessExtra = own ?? generic
  const setView = useStore((s) => s.setView)
  const [open, setOpen] = useState(false)
  const [stars, setStars] = useState({ n: item.stars, on: !!item.starred })
  const starable = item.kind === 'base' || item.kind === 'build' || item.kind === 'roadmap' || item.kind === 'calc'
  const mine = item.owner.kind === 'user' && item.owner.id === me?.id
  const toggleStar = async () => {
    if (!me) { openPath(loginHref()); return }
    try {
      const r = await star(item, !stars.on)
      setStars({ n: r.stars, on: r.starred })
    } catch (e) { toast.error((e as Error).message) }
  }
  const copy = async () => {
    if (!me) { openPath(loginHref()); return }
    if (onCopy) { onCopy(); return }
    // лише в гільдію (так вирішив власник) — у твою гільдію, де ти щонайменше учасник
    const to = item.can?.copyTo && !item.can.copyTo.includes('user') ? creatorGuilds(guilds)[0] : null
    // спершу спитати: копія — нова річ, і одразу відкриємо її
    const ok = await confirmAsk({
      title: to ? t('Скопіювати «{title}» у гільдію?', { title: item.title }) : t('Скопіювати «{title}» собі?', { title: item.title }),
      description: to ? t('Копію бачитиме вся гільдія; змінити доступ можна будь-коли. Відкриємо її одразу.') : t('Копія буде твоєю особистою — змінюй як хочеш. Відкриємо її одразу.'),
      confirm: t('Копіювати'),
    })
    if (!ok) return
    try {
      const it = await copyItem(item, to ? { kind: 'guild', id: to.id } : undefined)
      toast.success(to ? t('Скопійовано в гільдію') : t('Скопійовано собі'), { description: it.title })
      // одразу — на копію (та сама сторінка, як планувальник чи калькулятор, підхоплює нову адресу)
      if (it.kind === 'base') setView('bases', { base: it.id })
      else if (it.kind === 'roadmap') setView('roadmap', { param: it.id })
      else { openPath(hrefOf(it)); dispatchEvent(new PopStateEvent('popstate')) }
    } catch (e) { toast.error((e as Error).message) }
  }
  const canCopy = starable && !mine && onCopy !== null && item.can?.copy !== false && (!item.can?.copyTo || item.can.copyTo.includes('user') || creatorGuilds(guilds).length > 0)
  const copyLabel = guildOnly ? t('Копіювати в гільдію') : t('Копіювати собі')
  const copyTip = guildOnly ? t('Копію бачить уся гільдія; змінити доступ можна будь-коли.') : t('Копія — твоя особиста, змінюй як хочеш')
  const menu: MenuEntry[] = more ? [...(canCopy && copyInMenu ? [{ label: copyLabel, icon: <Copy size={14} />, onSelect: () => void copy() }] : []), ...more] : []
  return (
    <>
      {starable && (item.visibility === 'public' || stars.n > 0) && (
        <Button variant="secondary" size="sm" onClick={toggleStar} aria-pressed={stars.on} title={stars.on ? t('Прибрати зірку') : t('Поставити зірку')}>
          <Star size={14} className={stars.on ? 'fill-current text-spice' : ''} />
          {stars.n}
        </Button>
      )}
      {canCopy && !(more && copyInMenu) && (
        <Button variant="secondary" size="sm" onClick={copy} title={copyTip}>
          <Copy size={14} />
          {copyLabel}
        </Button>
      )}
      {item.can?.manage && (
        <Button variant="secondary" size="sm" onClick={() => { accessExtra?.reset?.(); setOpen(true) }}>
          <Shield size={14} />
          {t('Доступ')}
        </Button>
      )}
      {menu.length > 0 && (
        <Menu trigger={<ActionsTrigger />} items={menu} />
      )}
      {open && <AccessDialog item={item} open={open} onOpenChange={setOpen} onSaved={(it) => onChange?.(it)} extra={accessExtra} />}
    </>
  )
}

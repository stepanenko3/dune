/**
 * Права й прогрес роадмапу в інтерфейсі: вікно «Права» (кожне право — рядок карток-рівнів поруч, без випадних
 * списків; згори — готові набори), підпис «чий прогрес» зі скиданням, «Прогрес учасників» (хто що відмітив чи журнал
 * спільного), заклик «Скопіювати собі, щоб відмічати» і вікно копії (куди + перенести позначки). Що можна — каже
 * сервер (rights у lib/roadmap); тут лише показуємо, перевіряє він сам.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { Copy, Globe, LogIn, RotateCcw, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Avatar, GuildTag } from '@/components/access/Access'
import { ConfirmDialog } from '@/pages/Account'
import { SnCheckbox, checkedOf } from '@/components/sn'
import { Empty, ErrorAlert, Loading } from '@/components/states'
import { creatorGuilds, loginHref, useAuth } from '@/lib/auth'
import { copyItem } from '@/lib/items'
import { locale, t } from '@/lib/i18n'
import { useRoadmap, type Access, type Mode, type PState, type RoadmapDoc } from '@/lib/roadmap'
import { normAccess, type OwnerKind } from '@/lib/roadmapLevels'
import type { AccessExtra } from '@/components/access/Access'
import { Card, changedRights, grid, RightsSection } from '@/components/access/Rights'
import { useStore, openPath } from '@/store'

/** людина з позначкою (прогрес учасників) */
export interface Who { id: string; name: string; color: string }



/**
 * Права роадмапу як додаток до вікна «Доступ» (components/access): чернетка прав — тут, збереження — після доступу,
 * лише того, що змінилось проти збереженого (решта збереженого, що зараз не діє, лишається).
 */
export function useRightsExtra(): AccessExtra | undefined {
  const { access, rights, item, id } = useRoadmap()
  const me = useAuth((s) => s.user)
  const myGuilds = useAuth((s) => s.guilds)
  const [draft, setDraft] = useState<Access | null>(access)
  const [own, setOwn] = useState<boolean | null>(null)
  useEffect(() => { setDraft(access); setOwn(null) }, [access])
  if (!access || !rights || !item || !draft || (!rights.settings && !rights.manage)) return undefined
  return {
    reset: () => { setDraft(access); setOwn(null) },
    render: (o, v) => {
      const ok = o.kind as OwnerKind
      return (
        <RightsSection
          kind="roadmap"
          ok={ok}
          vis={v}
          draft={normAccess(draft, ok)}
          setDraft={setDraft}
          own={own}
          setOwn={setOwn}
          stored={normAccess(access, ok)}
          mine={ok === 'user' && o.id === me?.id}
          guild={ok !== 'guild' ? undefined : item.owner.kind === 'guild' && item.owner.id === o.id ? { tag: item.owner.tag || '?', color: item.owner.color } : myGuilds.find((g) => g.id === o.id)}
          canSettings={rights.settings}
          settingsLevel={rights.settingsLevel}
        />
      )
    },
    save: async (o, v) => {
      if (!rights.settings || v === 'private') return
      const ok = o.kind as OwnerKind
      const patch = changedRights(draft, access, ok, v, 'roadmap', rights.settingsLevel)
      if (!Object.keys(patch).length) return
      const r = await fetch(`/api/roadmaps/${id}/access-settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || t('Не вдалося змінити права'))
      useRoadmap.getState().load(id!)
    },
  }
}

/** підпис «чий прогрес на екрані» + скинути свій чи спільний */
export function ProgressWhose() {
  const { progress, rights, item, resetProgress } = useRoadmap()
  const me = useAuth((s) => s.user)
  const [confirm, setConfirm] = useState<'mine' | 'shared' | null>(null)
  if (!progress || !item) return null
  const tag = item.owner.kind === 'guild' ? <GuildTag tag={item.owner.tag || '?'} color={item.owner.color} /> : null
  const text: ReactNode =
    progress.whose === 'mine' ? (progress.mode === 'each' && progress.people > 1 ? t('Твій прогрес · ведуть {n}', { n: progress.people }) : t('Твій прогрес'))
      : progress.whose === 'guild' ? <>{t('Прогрес гільдії')} {tag}</>
        : progress.whose === 'site' ? t('Прогрес авторів сайту')
          : progress.whose === 'all' ? (progress.people ? t('Спільний прогрес · відмічали {n}', { n: progress.people }) : t('Спільний прогрес'))
            : progress.whose === 'owner' ? t('Прогрес автора')
              : progress.mode === 'each' && !me ? t('У кожного свій прогрес') : t('Прогрес тобі не показано')
  const view = progress.scope && !rights?.mark
  const mine = progress.scope === (me ? `u:${me.id}` : '')
  const shared = !!progress.scope && !mine && (rights?.settings || (progress.scope === 'all' && me?.perms?.some((p) => p === '*' || p === 'site.*' || p === 'site.moderate')))
  const any = Object.keys(progress.state.s).length + Object.keys(progress.state.t).length + Object.keys(progress.state.c).length > 0
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-panel2/60 px-2.5 text-[12px] font-medium">
        {progress.whose === 'all' ? <Globe size={13} className="text-muted" /> : progress.whose === 'guild' ? <Users size={13} className="text-muted" /> : null}
        {text}
        {view && <span className="text-muted">· {t('лише перегляд')}</span>}
      </span>
      {any && (mine && rights?.mark ? (
        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted hover:text-ink [@media(pointer:coarse)]:h-9" onClick={() => setConfirm('mine')}><RotateCcw size={13} /> {t('Скинути')}</button>
      ) : shared ? (
        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted hover:text-ink [@media(pointer:coarse)]:h-9" onClick={() => setConfirm('shared')}><RotateCcw size={13} /> {t('Скинути спільний')}</button>
      ) : null)}
      {confirm && (
        <ConfirmDialog
          danger
          title={confirm === 'mine' ? t('Скинути твій прогрес у цьому роадмапі?') : t('Скинути спільний прогрес для всіх?')}
          text={t('Одразу після скидання його можна повернути кнопкою в повідомленні.')}
          confirm={t('Скинути')}
          onClose={() => setConfirm(null)}
          onConfirm={() => { void resetProgress(confirm); setConfirm(null) }}
        />
      )}
    </span>
  )
}

// ---------- прогрес учасників ----------
interface Person { id: string; name: string; login: string; color: string; role: string | null; state: PState }
interface LogRow { at: number; kind: 's' | 't' | 'c'; item: string; value: string | null; by: { id: string; name: string; color: string } | null }
interface MembersRes { mode: Mode; people?: Person[]; others?: number; log?: LogRow[] }

const fetchMembers = async (id: string): Promise<MembersRes> => {
  const r = await fetch(`/api/roadmaps/${id}/progress/members`)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || t('Сервер не відповідає.'))
  return body
}

/** хто з учасників що відмітив (без мене): Map(id етапу / задачі / картки → люди); оновлюється з моїми позначками */
export function useMembers(id: string, on: boolean): Map<string, Who[]> | undefined {
  const me = useAuth((s) => s.user)
  const state = useRoadmap((s) => s.progress?.state)
  const [data, setData] = useState<MembersRes | null>(null)
  useEffect(() => {
    if (!on) { setData(null); return }
    let live = true
    fetchMembers(id).then((d) => { if (live) setData(d) }).catch(() => {})
    return () => { live = false }
  }, [id, on, state])
  return useMemo(() => {
    if (!data?.people) return undefined
    const m = new Map<string, Who[]>()
    for (const p of data.people) {
      if (p.id === me?.id) continue
      const add = (k: string) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push({ id: p.id, name: p.name, color: p.color }) }
      for (const [k, v] of Object.entries(p.state.s)) if (v === 'done') add(k)
      for (const k of Object.keys(p.state.t)) add(k)
      for (const k of Object.keys(p.state.c)) add(k)
    }
    return m
  }, [data, me?.id])
}

/** назва етапу / задачі / картки за id (для журналу) */
function nameOf(doc: RoadmapDoc, kind: 's' | 't' | 'c', id: string) {
  if (kind === 's') return doc.stages.find((s) => s.id === id)?.title
  if (kind === 't') return doc.stages.flatMap((s) => s.tasks).find((x) => x.id === id)?.text
  return doc.sections.flatMap((s) => s.columns).find((c) => c.id === id)?.title
}

function MembersDialog({ doc, onClose }: { doc: RoadmapDoc; onClose: () => void }) {
  const id = useRoadmap((s) => s.id)!
  const [data, setData] = useState<MembersRes | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { fetchMembers(id).then(setData).catch((e) => setError((e as Error).message)) }, [id])
  const stages = doc.stages.map((s) => s.id)
  const tasks = doc.stages.flatMap((s) => s.tasks.map((x) => x.id))
  const cards = doc.sections.filter((s) => s.collect).flatMap((s) => s.columns.map((c) => c.id))
  const fmt = (ms: number) => new Date(ms).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const VALUE: Record<string, string> = { done: t('Готово'), doing: t('У роботі') }
  return (
    <Modal open onOpenChange={(v) => { if (!v) onClose() }} title={data?.mode === 'each' || !data ? t('Прогрес учасників') : t('Хто відмічав')}>
      {error ? <ErrorAlert title={t('Не завантажилось')} message={error} />
        : !data ? <Loading lines={4} />
          : data.mode === 'each' ? (
            <div className="grid gap-2">
              {!data.people?.length ? <Empty icon={Users} title={t('Ще нікого')} framed={false} /> : (
                <ul className="grid gap-1">
                  {data.people.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1.5 py-1.5 hover:bg-panel2">
                      <span className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px]"><Avatar name={p.name} color={p.color} size={22} /><span className="truncate">{p.name}</span></span>
                      <span className="flex gap-3 font-mono text-[12px] tabular-nums text-muted">
                        {stages.length > 0 && <span title={t('Етапи')}>{t('етапи')} <b className="text-ink">{stages.filter((s) => p.state.s[s] === 'done').length}</b>/{stages.length}</span>}
                        {tasks.length > 0 && <span title={t('Задачі')}>{t('задачі')} <b className="text-ink">{tasks.filter((x) => p.state.t[x]).length}</b>/{tasks.length}</span>}
                        {cards.length > 0 && <span title={t('Зібрано')}>{t('зібрано')} <b className="text-ink">{cards.filter((c) => p.state.c[c]).length}</b>/{cards.length}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {!!data.others && <p className="text-[12px] text-muted">{t('Ще {n} людей поза гільдією ведуть свій прогрес — його бачать лише вони самі.', { n: data.others })}</p>}
            </div>
          ) : !data.log?.length ? <Empty icon={Users} title={t('Ще ніхто не відмічав')} framed={false} /> : (
            <ul className="grid max-h-[60vh] gap-0.5 overflow-y-auto">
              {data.log.map((l, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-panel2">
                  {l.by ? <Avatar name={l.by.name} color={l.by.color} size={20} /> : <span className="h-5 w-5 rounded-full bg-panel2" />}
                  <span className="min-w-0 flex-1 truncate">
                    <b className="font-semibold">{l.by?.name ?? t('Видалений обліковий запис')}</b>
                    {' · '}«{nameOf(doc, l.kind, l.item) ?? t('видалене')}» — {l.kind === 's' && l.value ? VALUE[l.value] ?? '' : l.value ? t('відмічено') : t('позначку знято')}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted">{fmt(l.at)}</span>
                </li>
              ))}
            </ul>
          )}
    </Modal>
  )
}

/** кнопка «Прогрес учасників» / «Хто відмічав» */
export function MembersButton({ doc }: { doc: RoadmapDoc }) {
  const { rights, progress } = useRoadmap()
  const [open, setOpen] = useState(false)
  // у спільному — журнал; особистий прогрес власника не журналюється, тож там кнопки нема
  if (!rights?.members || !progress || (progress.mode !== 'each' && (!progress.scope || progress.scope.startsWith('u:')))) return null
  return (
    <>
      <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-[12px] text-muted hover:text-ink [@media(pointer:coarse)]:h-9" onClick={() => setOpen(true)}>
        <Users size={13} /> {progress.mode === 'each' ? t('Прогрес учасників') : t('Хто відмічав')}
      </button>
      {open && <MembersDialog doc={doc} onClose={() => setOpen(false)} />}
    </>
  )
}

// ---------- копія ----------
const useCopyDialog = create<{ open: boolean; set: (v: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }))
/** відкрити вікно копії (кнопка «Копіювати собі» над роадмапом теж веде сюди) */
export const openRoadmapCopy = () => useCopyDialog.getState().set(true)

function CopyDialog() {
  const { open, set } = useCopyDialog()
  const { item, rights, progress } = useRoadmap()
  const me = useAuth((s) => s.user)
  const guilds = creatorGuilds(useAuth((s) => s.guilds))
  const setView = useStore((s) => s.setView)
  const to = rights?.copyTo ?? []
  const targets = [...(to.includes('user') && me ? [{ kind: 'user' as const, id: me.id }] : []), ...(to.includes('guild') ? guilds.map((g) => ({ kind: 'guild' as const, id: g.id })) : [])]
  const [target, setTarget] = useState(0)
  const marks = progress ? Object.keys(progress.state.s).length + Object.keys(progress.state.t).length + Object.keys(progress.state.c).length : 0
  const [carry, setCarry] = useState(true)
  const [busy, setBusy] = useState(false)
  if (!open || !item) return null
  const go = async () => {
    const o = targets[target]
    if (!o) return
    setBusy(true)
    try {
      const it = await copyItem(item, o, { progress: carry && marks > 0 })
      toast.success(o.kind === 'user' ? t('Скопійовано собі') : t('Скопійовано в гільдію'), { description: t('Копія — окремий роадмап; змінити доступ можна будь-коли.') })
      set(false)
      setView('roadmap', { param: it.id })
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Modal
      open
      onOpenChange={set}
      title={t('Копіювати «{title}»', { title: item.title })}
      description={t('Копія — окремий роадмап: змінюй і відмічай як хочеш.')}
      footer={
        <>
          <Button variant="ghost" onClick={() => set(false)}>{t('Скасувати')}</Button>
          <Button onClick={go} disabled={busy || !targets.length} loading={busy}><Copy size={14} />{t('Копіювати')}</Button>
        </>
      }
    >
      <div className="grid gap-3">
        {!targets.length ? <p className="text-[13px] text-muted">{t('Копіювати можна лише в гільдію, де ти щонайменше учасник.')}</p> : (
          <div className={grid}>
            {targets.map((o, i) => {
              const g = o.kind === 'guild' ? guilds.find((x) => x.id === o.id) : null
              return (
                <Card
                  key={o.kind + o.id}
                  on={target === i}
                  onClick={() => setTarget(i)}
                  title={g ? <span className="flex min-w-0 items-center gap-1.5"><GuildTag tag={g.tag} color={g.color} /><span className="truncate">{g.name}</span></span> : t('Мені особисто')}
                  hint={g ? t('Гільдії — бачать усі учасники') : t('Твоє особисте')}
                />
              )
            })}
          </div>
        )}
        {marks > 0 && (
          <label className="flex items-center gap-2 text-[13px]">
            <SnCheckbox modelValue={carry} onChange={(e: Event) => setCarry(checkedOf(e))} accessibilityLabel={t('Перенести позначки, які бачу зараз')} />
            {t('Перенести позначки, які бачу зараз ({n})', { n: marks })}
          </label>
        )}
      </div>
    </Modal>
  )
}

/** заклик для тих, хто не може відмічати: увійти чи скопіювати собі; і саме вікно копії */
export function CopyCta() {
  const { rights, progress } = useRoadmap()
  const me = useAuth((s) => s.user)
  if (!rights || !progress) return <CopyDialog />
  const btn = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-spice/50 bg-spice/10 px-2.5 text-[12.5px] font-semibold text-spice hover:bg-spice/15 [@media(pointer:coarse)]:h-10'
  let cta: ReactNode = null
  if (!me) cta = <button type="button" className={btn} onClick={() => openPath(loginHref())}><LogIn size={14} /> {progress.mark === 'users' ? t('Увійди, щоб відмічати') : t('Увійди, щоб скопіювати собі')}</button>
  else if (!rights.mark && rights.copy && rights.copyTo.length) cta = <button type="button" className={btn} onClick={openRoadmapCopy}><Copy size={14} /> {t('Скопіювати собі, щоб відмічати')}</button>
  return <>{cta}<CopyDialog /></>
}

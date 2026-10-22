/**
 * Права речі в інтерфейсі (вікно «Доступ»): шкала рівнів картками (ранги гільдії цифрами), розділ «Права» для будь-якого
 * виду й права за замовчуванням для речі без своїх (useItemRightsExtra). Правила рівнів — src/lib/roadmapLevels.ts
 * (те саме, що перевіряє сервер). Роадмап має свій додаток з прогресом — components/roadmap/RoadmapRights.tsx.
 */
import { Fragment, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { GuildTag, type AccessExtra, type OwnerRef } from '@/components/access/Access'
import { GUILD_RANK, useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { t } from '@/lib/i18n'
import type { Item, Kind as ItemKind, Visibility } from '@/lib/items'
import type { Access, Level, Mode, RightKey, Rights } from '@/lib/roadmap'
import { defaultAccess, effectiveAccess, levelsFor, modesFor, normAccess, RIGHT_KEYS, rightsFor, type OwnerKind, type Vis } from '@/lib/roadmapLevels'
import { cn } from '@/lib/utils'
import { DuneLoading } from '@/components/ui/dune-loader'

/** ранги гільдії; цифрою — як ранг у грі: лідер 4, офіцер 3, учасник 2, новобранець 1 («3+» — офіцер і вище) */
const RANKS: Level[] = ['owner', 'officer', 'member', 'recruit']
const RANK_N: Partial<Record<Level, string>> = { owner: '4', officer: '3+', member: '2+', recruit: '1+' }

/** назва рівня для такого власника; mine — дивиться сам власник (тоді «Лише я») */
function levelLabel(l: Level, ok: OwnerKind, mine: boolean): string {
  switch (l) {
    case 'nobody': return t('Ніхто')
    case 'owner': return ok === 'guild' ? t('Лідер') : ok === 'site' ? t('Автори сайту') : mine ? t('Лише я') : t('Власник')
    case 'officer': return t('Офіцери й лідер')
    case 'member': return t('Учасники й вище')
    case 'recruit': return t('Уся гільдія')
    case 'users': return t('Усі, хто увійшов')
    case 'anyone': return t('Усі, і без входу')
  }
}
const LEVEL_HINT: Partial<Record<Level, string>> = {
  recruit: t('З новобранцями'),
  users: t('Кожен, хто бачить роадмап і увійшов'),
  anyone: t('Кожен, хто бачить роадмап'),
}
/** те саме не про роадмап (база, білд…) */
const LEVEL_HINT_ANY: Partial<Record<Level, string>> = {
  recruit: t('З новобранцями'),
  users: t('Кожен, хто бачить і увійшов'),
  anyone: t('Кожен, хто бачить'),
}
/** ранг цифрою перед назвою — лише в гільдії (у людини й сайту рангів нема) */
const RankN = ({ l, ok }: { l: Level; ok: OwnerKind }) => (ok === 'guild' && RANK_N[l] ? <span className="mr-1 inline-grid min-w-[22px] place-items-center rounded bg-ink/10 px-1 font-mono text-[11px] font-semibold">{RANK_N[l]}</span> : null)

const MODE_META: Record<Mode, { label: string; hint: (ok: OwnerKind) => string }> = {
  owner: { label: t('Прогрес власника'), hint: (ok) => (ok === 'guild' ? t('Один на гільдію: відмічають ті, кому дано; інші бачать') : ok === 'site' ? t('Один, його ведуть автори сайту; інші бачать') : t('Твій: відмічаєш ти; інші, кому відкрито, бачать')) },
  each: { label: t('У кожного свій'), hint: (ok) => (ok === 'guild' ? t('Кожен веде свій; гільдія бачить прогрес учасників') : t('Кожен, хто увійшов, веде свій')) },
  all: { label: t('Спільний на всіх'), hint: () => t('Один на всіх, хто бачить роадмап') },
}

/** рядки розділу «Права»: що це право і підказка (у роадмапу — свої, про етапи й роадмап) */
const ROWS: { key: RightKey; label: string; hint: string; roadmapHint?: string }[] = [
  { key: 'edit', label: t('Хто редагує зміст'), hint: t('Змінювати саму річ; відновлювати її версії'), roadmapHint: t('Етапи, задачі, розділи й картки; відновлення версій') },
  { key: 'mark', label: t('Хто відмічає прогрес'), hint: t('«Ніхто» — роадмап лише копіюють собі, щоб відмічати') },
  { key: 'seeProgress', label: t('Хто бачить прогрес'), hint: t('Спільний запис — власника чи «на всіх»') },
  { key: 'members', label: t('Хто бачить прогрес учасників'), hint: t('Хто що відмітив; у спільному — журнал позначок') },
  { key: 'copy', label: t('Хто може копіювати'), hint: t('Копія — окрема річ нового власника'), roadmapHint: t('Копія — окремий роадмап нового власника') },
  { key: 'history', label: t('Хто бачить історію версій'), hint: t('Попередні версії змісту') },
  { key: 'settings', label: t('Хто міняє права'), hint: t('Вирішує власник (у гільдії — лідер)') },
]

/**
 * Готові набори прав одним натиском — за видимістю: у гільдійському лише ранги, у відкритому — ще й «усі». Набір, де
 * щось для цього роадмапу не діє, не показуємо.
 */
const PRESETS: { key: string; label: string; hint: string; for: OwnerKind[]; vis: ('guild' | 'open')[]; patch: Partial<Access> }[] = [
  { key: 'mine', label: t('Особистий трекер'), hint: t('Відмічаю я, інші бачать'), for: ['user'], vis: ['open'], patch: { progress: 'owner', mark: 'owner', seeProgress: 'anyone' } },
  { key: 'guild', label: t('Гільдія веде спільно'), hint: t('Учасники відмічають один прогрес, гості бачать'), for: ['guild'], vis: ['open'], patch: { progress: 'owner', mark: 'member', seeProgress: 'anyone' } },
  { key: 'guild-in', label: t('Гільдія веде спільно'), hint: t('Учасники (2+) відмічають один прогрес гільдії'), for: ['guild'], vis: ['guild'], patch: { progress: 'owner', mark: 'member' } },
  { key: 'each-in', label: t('Кожен учасник — своє'), hint: t('У кожного в гільдії свій прогрес'), for: ['guild'], vis: ['guild'], patch: { progress: 'each', mark: 'recruit' } },
  { key: 'copy-in', label: t('Лише скопіювати'), hint: t('Тут не відмічають — копіюють собі'), for: ['guild'], vis: ['guild'], patch: { mark: 'nobody', copy: 'recruit' } },
  { key: 'each', label: t('Довідник: кожен збирає своє'), hint: t('У кожного свій прогрес'), for: ['user', 'guild', 'site'], vis: ['open'], patch: { progress: 'each', mark: 'users' } },
  { key: 'all', label: t('Спільний на всіх'), hint: t('Один прогрес, відмічає кожен, хто увійшов'), for: ['user', 'guild', 'site'], vis: ['open'], patch: { progress: 'all', mark: 'users', seeProgress: 'anyone' } },
  { key: 'copy', label: t('Лише скопіювати'), hint: t('Тут не відмічають — копіюють собі'), for: ['user', 'guild', 'site'], vis: ['open'], patch: { mark: 'nobody', copy: 'users' } },
]

/** картка вибору (як у «Доступ») */
export function Card({ on, onClick, disabled, title, hint, why }: { on: boolean; onClick: () => void; disabled?: boolean; title: ReactNode; hint?: string; why?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={disabled ? why : undefined}
      onClick={onClick}
      className={cn(
        'flex min-h-11 min-w-0 flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        on ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40',
      )}
    >
      <span className="text-[13px] font-semibold leading-tight">{title}</span>
      {hint && <span className="text-[11.5px] leading-snug text-muted">{hint}</span>}
    </button>
  )
}

export const grid = 'grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1.5'

/**
 * Один рядок рівнів. У відкритому роадмапі гільдії ранги не розкладаємо поруч з «усіма»: одна картка «Гільдія», а
 * вибравши її — «від рангу: 4 · 3+ · 2+ · 1+» під нею (сказав користувач: у публічному — без рангів, гільдія — з рангом).
 */
function LevelRow({ levels, value, onChange, ok, mine, guild, disabled, why, roadmap }: {
  levels: Level[]; value: Level; onChange: (l: Level) => void; ok: OwnerKind; mine: boolean; roadmap: boolean
  guild?: { tag: string; color: string }; disabled?: boolean; why?: string
}) {
  const ranks = levels.filter((l) => RANKS.includes(l))
  const grouped = ok === 'guild' && ranks.length > 0 && levels.some((l) => l === 'users' || l === 'anyone')
  const card = (l: Level) => (
    <Card key={l} on={value === l} disabled={disabled} why={why} onClick={() => onChange(l)} title={<><RankN l={l} ok={ok} />{levelLabel(l, ok, mine)}</>} hint={(roadmap ? LEVEL_HINT : LEVEL_HINT_ANY)[l]} />
  )
  if (!grouped) return <div className={grid}>{levels.map(card)}</div>
  const inGuild = RANKS.includes(value)
  return (
    <div className="grid gap-1.5">
      <div className={grid}>
        {levels.filter((l) => l === 'nobody').map(card)}
        <Card
          on={inGuild}
          disabled={disabled}
          why={why}
          onClick={() => { if (!inGuild) onChange(ranks.includes('member') ? 'member' : ranks[0]) }}
          title={<span className="flex min-w-0 items-center gap-1.5">{guild && <GuildTag tag={guild.tag} color={guild.color} />}{t('Гільдія')}</span>}
          hint={t('Від вибраного рангу й вище')}
        />
        {levels.filter((l) => l === 'users' || l === 'anyone').map(card)}
      </div>
      {inGuild && (
        <div className="flex flex-wrap items-center gap-1.5 pl-1">
          <span className="text-[12px] text-muted">{t('Від рангу:')}</span>
          {ranks.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={value === l}
              disabled={disabled}
              onClick={() => onChange(l)}
              className={cn('inline-flex h-9 items-center rounded-md border px-2.5 text-[12.5px] disabled:opacity-45', value === l ? 'border-spice/70 bg-spice/10 font-semibold' : 'border-line text-muted hover:border-spice/40')}
            >
              <RankN l={l} ok={ok} />{levelLabel(l, ok, mine)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Розділ «Права» у вікні «Доступ» будь-якої речі: що діє — за вибраними там власником і видимістю (ще до збереження):
 * «Особисте» — без вибору, «Гільдія» — ранги, відкрите — ще й «усі». Лише права цього виду (rightsFor: у бази —
 * редагувати, копіювати, історія, права; у роадмапу — ще й прогрес). Роадмап: або готовий набір, або свої
 * налаштування (сказав користувач); набір ховає окремі права, лишаючи підсумок. В інших видів прав мало — одразу рядки.
 */
export function RightsSection({ kind, ok, vis, draft, setDraft, own, setOwn, stored, mine, guild, canSettings, settingsLevel }: {
  kind: ItemKind; ok: OwnerKind; vis: Vis; draft: Access; setDraft: (a: Access) => void; own: boolean | null; setOwn: (v: boolean) => void
  stored: Access; mine: boolean; guild?: { tag: string; color: string }; canSettings: boolean; settingsLevel: boolean
}) {
  const roadmap = kind === 'roadmap'
  const keys = rightsFor(kind)
  const eff = effectiveAccess(draft, ok, vis, kind)
  const levels = Object.fromEntries(RIGHT_KEYS.map((k) => [k, keys.includes(k) ? levelsFor(k, ok, vis) : []])) as Record<RightKey, Level[]>
  const allModes = modesFor(vis)
  const head = <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('Права')}</h3>
  // «Особисте»: вибору нема — бачиш, змінюєш і відмічаєш лише ти
  if (vis === 'private') return (
    <section className="grid gap-1.5 border-t border-line pt-3">
      {head}
      <p className="text-[13px] leading-relaxed text-muted">{!roadmap ? t('Особисте бачиш і змінюєш лише ти. Вибери вище «Гільдія», «За посиланням» чи «Публічне» — і тут з’явиться вибір прав: у гільдійському — за рангами, у відкритому — для всіх.') : t('Особистий роадмап бачиш, змінюєш і відмічаєш лише ти. Вибери вище «Гільдія», «За посиланням» чи «Публічне» — і тут з’явиться вибір прав: у гільдійському — за рангами, у відкритому — для всіх.')}</p>
    </section>
  )
  const set = (patch: Partial<Access>) => setDraft({ ...draft, ...patch })
  const valid = (p: Partial<Access>) => (Object.entries(p) as [keyof Access, string][]).every(([k, v]) => (k === 'progress' ? allModes.includes(v as Mode) : (levels[k as RightKey] ?? []).includes(v as Level)))
  const presets = !roadmap ? [] : PRESETS.filter((p) => p.for.includes(ok) && p.vis.includes(vis === 'guild' ? 'guild' : 'open') && valid(p.patch))
  // набір — повні права: типові для власника плюс його зміни; «хто міняє права» набір не чіпає
  const full = (p: Partial<Access>): Access => ({ ...defaultAccess(ok, kind), ...p, settings: draft.settings })
  const same = (a: Access, b: Access) => (Object.keys(a) as (keyof Access)[]).every((k) => k === 'settings' || JSON.stringify(a[k]) === JSON.stringify(b[k]))
  const picked = presets.find((p) => same(eff, effectiveAccess(full(p.patch), ok, vis, kind)))
  const showOwn = own === true || !picked
  const progressMoved = roadmap && eff.progress !== effectiveAccess(stored, ok, vis, kind).progress
  // зайве ховаємо (сказав користувач): «хто бачить прогрес» — коли в кожного свій; «прогрес учасників» — коли прогрес
  // один на всіх і бачать його всі, кому видно роадмап
  const widest = (k: RightKey) => levels[k][levels[k].length - 1]
  const hidden = (k: RightKey) => !levels[k]?.length || (k === 'seeProgress' && eff.progress === 'each') || (k === 'members' && eff.progress === 'all' && eff.seeProgress === widest('seeProgress'))
  if (!canSettings) return (
    <section className="grid gap-1.5 border-t border-line pt-3">
      {head}
      <p className="text-[13px] text-muted">{roadmap ? t('Права цього роадмапу міняє лише власник (у гільдії — лідер).') : t('Права цього міняє лише власник (у гільдії — лідер).')}</p>
    </section>
  )
  return (
    <section className="grid gap-4 border-t border-line pt-3">
      {presets.length > 0 && (
        <div className="grid gap-1.5">
          {head}
          <div className={grid}>
            {presets.map((p) => <Card key={p.key} on={!showOwn && picked?.key === p.key} onClick={() => { setOwn(false); setDraft(full(p.patch)) }} title={p.label} hint={p.hint} />)}
            <Card on={showOwn} onClick={() => setOwn(true)} title={t('Свої налаштування')} hint={t('Кожне право — окремо')} />
          </div>
        </div>
      )}

      {!showOwn && (
        <div className="grid gap-1 rounded-lg border border-line bg-panel2/40 p-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('Що в наборі')}</h3>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
            {roadmap && <><dt className="text-muted">{t('Чий прогрес')}</dt><dd>{MODE_META[eff.progress].label}</dd></>}
            {ROWS.filter((r) => !hidden(r.key)).map((r) => (
              <Fragment key={r.key}>
                <dt className="text-muted">{r.label}</dt>
                <dd><RankN l={eff[r.key] as Level} ok={ok} />{levelLabel(eff[r.key] as Level, ok, mine)}{r.key === 'copy' && eff.copy !== 'nobody' && eff.copyTo.length ? ` · ${eff.copyTo.map((x) => (x === 'user' ? t('В особисте') : t('У гільдію'))).join(', ')}` : ''}</dd>
              </Fragment>
            ))}
          </dl>
          {progressMoved && <p className="text-[12px] text-muted">{t('Позначки не зникають: повернеш як було — повернуться й вони.')}</p>}
        </div>
      )}

      {showOwn && <>
        {!presets.length && head}
        {keys.includes('mark') && (
          <div className="grid gap-1.5">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('Чий прогрес')}</h3>
            <div className={grid}>
              {allModes.map((m) => <Card key={m} on={eff.progress === m} onClick={() => set({ progress: m })} title={MODE_META[m].label} hint={MODE_META[m].hint(ok)} />)}
            </div>
            {progressMoved && <p className="text-[12px] text-muted">{t('Позначки не зникають: повернеш як було — повернуться й вони.')}</p>}
          </div>
        )}

        {ROWS.map((r) => {
          const lockSettings = r.key === 'settings' && !settingsLevel
          if (hidden(r.key)) return null
          return (
            <div key={r.key} className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{r.label}</h3>
                <span className="text-[11.5px] text-muted">{roadmap ? r.roadmapHint ?? r.hint : r.hint}</span>
              </div>
              <LevelRow
                roadmap={roadmap}
                levels={levels[r.key]}
                value={eff[r.key] as Level}
                onChange={(l) => set({ [r.key]: l } as Partial<Access>)}
                ok={ok}
                mine={mine}
                guild={guild}
                disabled={lockSettings}
                why={lockSettings ? t('Вирішує власник (у гільдії — лідер)') : undefined}
              />
              {r.key === 'edit' && eff.edit === 'users' && (
                <p className="flex items-start gap-1.5 text-[12px] text-warn"><AlertTriangle size={14} className="shrink-0" />{t('Вікі-режим: зміст править кожен, хто увійшов. Кожна правка — версія з автором, усе можна відновити з історії.')}</p>
              )}
              {r.key === 'mark' && eff.progress !== 'each' && LEVELS_ORDER.indexOf(eff.mark) > LEVELS_ORDER.indexOf(eff.seeProgress) && eff.mark !== 'nobody' && (
                <p className="text-[12px] text-muted">{t('Відмічати зможуть лише ті, хто й бачить прогрес.')}</p>
              )}
              {r.key === 'copy' && eff.copy !== 'nobody' && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] text-muted">{t('Куди:')}</span>
                  {(['user', 'guild'] as const).map((to) => {
                    const on = eff.copyTo.includes(to)
                    return (
                      <button
                        key={to}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set({ copyTo: on ? eff.copyTo.filter((x) => x !== to) : [...eff.copyTo, to] })}
                        className={cn('h-9 rounded-md border px-3 text-[12.5px]', on ? 'border-spice/70 bg-spice/10 font-semibold' : 'border-line text-muted hover:border-spice/40')}
                      >
                        {to === 'user' ? t('В особисте') : t('У гільдію')}
                      </button>
                    )
                  })}
                  {!eff.copyTo.length && <span className="text-[12px] text-warn">{t('Нікуди — тож копіювати не вийде')}</span>}
                </div>
              )}
            </div>
          )
        })}
      </>}
    </section>
  )
}
const LEVELS_ORDER: Level[] = ['nobody', 'owner', 'officer', 'member', 'recruit', 'users', 'anyone']

/**
 * Права як додаток до вікна «Доступ» для будь-якої речі (бази, білди, розрахунки, позначки, ресурси): збережені права й
 * що людина може — з сервера, коли вікно відкривають; зберігаються після доступу, лише змінене.
 */
export function useItemRightsExtra(item: Item): AccessExtra | undefined {
  const me = useAuth((s) => s.user)
  const myGuilds = useAuth((s) => s.guilds)
  const [data, setData] = useState<{ access: Access; rights: Rights } | null>(null)
  const [draft, setDraft] = useState<Access | null>(null)
  const [error, setError] = useState('')
  if (!item.can?.manage) return undefined
  const kind = item.kind as ItemKind
  return {
    reset: () => {
      setData(null); setDraft(null); setError('')
      api<{ access?: Access; rights: Rights }>(`/api/items/${kind}/${item.id}`)
        .then((r) => { if (r.access) { setData({ access: r.access, rights: r.rights }); setDraft(r.access) } })
        .catch((e) => setError((e as Error).message))
    },
    render: (o, v) => {
      if (error) return <p className="border-t border-line pt-3 text-[12.5px] text-bad">{error}</p>
      if (!data || !draft) return <div className="border-t border-line pt-3"><DuneLoading label={t('Завантаження…')} /></div>
      const ok = o.kind as OwnerKind
      return (
        <RightsSection
          kind={kind}
          ok={ok}
          vis={v}
          draft={normAccess(draft, ok, kind)}
          setDraft={setDraft}
          own={true}
          setOwn={() => {}}
          stored={normAccess(data.access, ok, kind)}
          mine={ok === 'user' && o.id === me?.id}
          guild={ok !== 'guild' ? undefined : item.owner.kind === 'guild' && item.owner.id === o.id ? { tag: item.owner.tag || '?', color: item.owner.color } : myGuilds.find((g) => g.id === o.id)}
          canSettings={data.rights.settings}
          settingsLevel={data.rights.settingsLevel}
        />
      )
    },
    save: async (o, v) => {
      if (!data || !draft || !data.rights.settings || v === 'private') return
      const ok = o.kind as OwnerKind
      const patch = changedRights(draft, data.access, ok, v, kind, data.rights.settingsLevel)
      if (!Object.keys(patch).length) return
      const r = await api<{ item: Item }>(`/api/items/${kind}/${item.id}/rights`, { method: 'PATCH', body: patch })
      return r.item
    },
  }
}

/** що з чернетки прав відрізняється від збереженого (за видимістю, що діятиме) — лише це й шлемо */
export function changedRights(draft: Access, stored: Access, ok: OwnerKind, v: Vis, kind: ItemKind, settingsLevel: boolean): Partial<Access> {
  const keys = new Set<string>([...rightsFor(kind), ...(rightsFor(kind).includes('mark') ? ['progress'] : []), ...(rightsFor(kind).includes('copy') ? ['copyTo'] : [])])
  const want = effectiveAccess(normAccess(draft, ok, kind), ok, v, kind), now = effectiveAccess(normAccess(stored, ok, kind), ok, v, kind)
  return Object.fromEntries((Object.keys(want) as (keyof Access)[])
    .filter((k) => keys.has(k) && JSON.stringify(want[k]) !== JSON.stringify(now[k]) && (k !== 'settings' || settingsLevel))
    .map((k) => [k, want[k]])) as Partial<Access>
}

/** права нової речі: розділ під «Хто власник» і «Хто бачить» у вікнах створення; apply — після створення */
export interface NewRights {
  render: (owner: OwnerRef, visibility: Visibility) => ReactNode
  /** записати вибране (лише змінене проти типового); помилку показує як повідомлення — річ уже створена */
  apply: (item: { id: string }, owner: OwnerRef, visibility: Visibility) => Promise<void>
}

/**
 * Права для вікна створення: ті самі, що в «Доступ», від типових для вибраного власника. Права гільдійської речі
 * міняють офіцери й лідер — новобранець і учасник бачать про це примітку (змінити можна буде пізніше, у «Доступ»).
 */
export function useNewRights(kind: ItemKind): NewRights {
  const me = useAuth((s) => s.user)
  const myGuilds = useAuth((s) => s.guilds)
  const [draft, setDraft] = useState<Access | null>(null)
  const [own, setOwn] = useState<boolean | null>(null)
  const rank = (o: OwnerRef) => (o.kind === 'guild' ? GUILD_RANK[myGuilds.find((g) => g.id === o.id)?.role ?? 'recruit'] : 4)
  // хто міняє права гільдійської речі — типово офіцер і вище; «хто міняє права» — лише лідер
  const may = (o: OwnerRef) => o.kind !== 'guild' || rank(o) >= 3
  return {
    render: (o, v) => {
      const ok = o.kind as OwnerKind
      if (!may(o)) return (
        <section className="grid gap-1.5 border-t border-line pt-3">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t('Права')}</h3>
          <p className="text-[13px] text-muted">{t('Права гільдійської речі міняють офіцери й лідер — у «Доступ», коли її створено. Поки що діють типові.')}</p>
        </section>
      )
      return (
        <RightsSection
          kind={kind}
          ok={ok}
          vis={v as Vis}
          draft={normAccess(draft ?? defaultAccess(ok, kind), ok, kind)}
          setDraft={setDraft}
          own={own}
          setOwn={setOwn}
          stored={defaultAccess(ok, kind)}
          mine={ok === 'user' && o.id === me?.id}
          guild={ok === 'guild' ? myGuilds.find((g) => g.id === o.id) : undefined}
          canSettings
          settingsLevel={rank(o) >= 4}
        />
      )
    },
    apply: async (item, o, v) => {
      if (!draft || !may(o) || v === 'private') return
      const ok = o.kind as OwnerKind
      const patch = changedRights(draft, defaultAccess(ok, kind), ok, v as Vis, kind, rank(o) >= 4)
      if (!Object.keys(patch).length) return
      try { await api(`/api/items/${kind}/${item.id}/rights`, { method: 'PATCH', body: patch }) } catch (e) {
        toast.error(t('Створено, але права не збереглись'), { description: (e as Error).message })
      }
    },
  }
}

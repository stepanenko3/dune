/**
 * Запис ресурсу — наш шар поверх даних гри: де брати унікальні ресурси, або просто своя точка («Тактичний
 * радкостюм — випробувальна станція №89»). Запис прив'язується до точок, до типів точок гри і до предмета луту;
 * галочка біля запису в списку — фільтр мапи: лишаються тільки місця, де є позначені ресурси.
 * Тут — розгорнутий вибраний запис і форма (новий чи зміна); список — у MarksPanel разом із позначками.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Crosshair, MapPin, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { usePlaces, type Place } from '@/lib/places'
import { useMapUi, type Draft } from '@/lib/map/ui'
import { onMapOf, usePubMarks } from '@/lib/map/marks'
import { labelOf, loadLoot, mapName, type Loot, type MapDef, type SourceResp } from '@/lib/map/data'
import { cn, splitEn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { checkedOf, SnCheckbox, SnInput, SnTextarea, valueOf } from '@/components/sn'
import { Button } from '@/components/ui/button'
import { Seg } from '@/components/ui/seg'
import { useAuth, creatorGuilds } from '@/lib/auth'
import { ItemBar, NewAccess, type OwnerRef } from '@/components/access/Access'
import { useNewRights } from '@/components/access/Rights'
import type { Visibility } from '@/lib/items'
import { boxes, Confirm, TOUCH, TOUCH_SEG } from './bits'

const ZONES = { hagga: t('Хагга'), dd: t('Глибока пустеля'), city: t('Міста') } as const

/** запис на цій мапі: точки, типи точок чи мапи його регіону */
export const onMap = (p: Place, map: string) => onMapOf(p, map)

export const newDraft = (map: string): Draft => ({
  res: '',
  place: '',
  zone: map === 'deepdesert_1' ? 'dd' : map.startsWith('sh_') ? 'city' : 'hagga',
  area: '',
  how: '',
  loot: '',
  pins: [],
  types: [],
})

/** вибраний запис: місце, як дістати, доступ, лут, типи точок, точки й дії; extra — ще кнопки (для чужих публічних) */
export function PlaceDetail({
  r,
  def,
  layout,
  resp,
  loot,
  onLootRetry,
  onFly,
  onChanged,
  extra,
}: {
  r: Place
  def: MapDef
  layout: number | null
  resp: SourceResp
  loot: (Loot & { loading: boolean; failed?: boolean }) | null
  /** пошук луту не вдався — шукати ще раз */
  onLootRetry?: () => void
  onFly: (x: number, y: number) => void
  /** доступ змінився — перечитати список */
  onChanged: () => void
  extra?: ReactNode
}) {
  const { patch, remove } = usePlaces()
  const edit = useMapUi((s) => s.edit)
  const [asking, setAsking] = useState(false)
  const pins = r.pins.filter((p) => p.map === def.id)
  const types = r.types.filter((t) => t.map === def.id)
  const best = loot?.hits.reduce((m, h) => Math.max(m, h.chance ?? 0), 0) ?? 0
  const where = [...(loot?.places ?? [])].sort((a, b) => b.best - a.best || b.n - a.n).slice(0, 8)
  return (
    <div className="mx-1 mb-1.5 mt-0.5 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5 break-words rounded-lg border border-line bg-panel2/40 p-2 text-[12px]">
      <div className="text-[11.5px] text-muted">
        <b className="font-semibold text-ink">{splitEn(r.place)[0]}</b>
        {r.area && ` · ${r.area}`}
      </div>
      {r.how && <p className="whitespace-pre-line leading-snug">{r.how}</p>}
      {r.item && <ItemBar item={r.item} onChange={onChanged} />}
      {extra && <div className="flex flex-wrap gap-1.5">{extra}</div>}
      {r.loot && (
        <div className="rounded-md bg-spice/10 px-2 py-1.5 text-[11.5px]">
          <div className="flex flex-wrap items-center gap-x-1.5">
            <span>
              <b>{r.loot}</b>:{' '}
              {loot?.loading ? t('шукаю…') : loot?.failed ? t('не вдалося перевірити лут') : loot?.hits.length ? (best ? t('{boxes}, до {best}%', { boxes: boxes(loot.hits.length), best }) : boxes(loot.hits.length)) : t('тут не випадає')}
            </span>
            {loot?.failed && onLootRetry && (
              <Button size="xs" variant="ghost" onClick={onLootRetry}><RefreshCw size={11} /> {t('Спробувати ще')}</Button>
            )}
          </div>
          {where.length > 0 && (
            <ul className="mt-1 grid grid-cols-[minmax(0,1fr)]">
              {where.map((p) => (
                <li key={`${p.type}:${p.i}`}>
                  <button type="button" onClick={() => onFly(p.x, p.y)} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-spice/10 [@media(pointer:coarse)]:min-h-10">
                    <span className="w-9 shrink-0 text-right font-mono text-[10.5px] font-semibold text-spice">{p.best}%</span>
                    <span className="min-w-0 flex-1 truncate">{p.name || labelOf(resp.labels, p.type)}</span>
                    {p.n > 1 && <span className="font-mono text-[10px] text-muted">×{p.n}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {types.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {types.map((ty) => (
            <span key={ty.type} className="rounded-full border border-spice/40 px-2 py-0.5 text-[11px]" data-tip={t('Усі такі точки обведено на мапі')}>
              ◯ {labelOf(resp.labels, ty.type)}
            </span>
          ))}
        </div>
      )}
      {pins.length > 0 && (
        <ul className="grid grid-cols-[minmax(0,1fr)]">
          {pins.map((p, i) => {
            const other = def.id === 'deepdesert_1' && p.layout != null && p.layout !== layout
            return (
              <li key={i}>
                <button type="button" onClick={() => onFly(p.x, p.y)} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-panel2 [@media(pointer:coarse)]:min-h-10">
                  <MapPin size={12} className="shrink-0 text-spice" />
                  <span className="min-w-0 flex-1 truncate">{p.label || t('Точка')}</span>
                  {other && <span className="text-[10px] text-warn" data-tip={t('Точка з іншої розкладки Глибокої пустелі')}>{t('розкладка {n}', { n: p.layout })}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <SnCheckbox
          className="mr-auto text-[11.5px] text-muted"
          modelValue={r.ok}
          disabled={!r.item?.can?.edit}
          label={t('перевірено')}
          onChange={(e: Event) => void patch(r.id, { ok: checkedOf(e) })}
        />
        {r.item?.can?.edit && <Button size="xs" variant="secondary" onClick={() => edit({ ...r })}>
          <Pencil size={11} /> {t('Змінити')}
        </Button>}
        {r.item?.can?.manage && <Button size="xs" variant="ghost" onClick={() => setAsking(true)} aria-label={t('Видалити запис')} data-tip={t('Видалити запис')}>
          <Trash2 size={12} />
        </Button>}
      </div>
      {asking && (
        <Confirm
          title={t('Видалити запис «{res}» — {place}?', { res: splitEn(r.res)[0], place: splitEn(r.place)[0] })}
          confirm={t('Видалити')}
          onClose={() => setAsking(false)}
          onConfirm={() => void remove(r.id).then((ok) => ok && usePubMarks.getState().drop(`place:${r.id}`))}
        />
      )}
    </div>
  )
}

/** форма запису: новий (draft без id) чи зміна свого */
export function PlaceEditor({ def, layout, resp, counts }: { def: MapDef; layout: number | null; resp: SourceResp; counts: Record<string, number> }) {
  const { draft, patchDraft, edit, picking, setPicking, select } = useMapUi()
  const { add, patch } = usePlaces()
  const { user, guilds } = useAuth()
  const main = creatorGuilds(guilds).find((g) => g.id === user?.mainGuild)
  const [owner, setOwner] = useState<OwnerRef>(main ? { kind: 'guild', id: main.id } : { kind: 'user', id: user?.id || '' })
  // права нової речі — у тому ж вікні, під «Хто власник» і «Хто бачить»
  const rights = useNewRights('place')
  const [vis, setVis] = useState<Visibility>(main ? 'guild' : 'private')
  const [busy, setBusy] = useState(false)
  /** скільки контейнерів з цим лутом; -1 — перевірити не вдалося */
  const [lootN, setLootN] = useState<number | null>(null)
  const [addType, setAddType] = useState(false)
  const d = draft as Draft
  const lootQ = d.loot?.trim() || ''
  useEffect(() => {
    setLootN(null)
    if (lootQ.length < 3) return
    const t = setTimeout(() => loadLoot(def.id, layout, lootQ).then((l) => setLootN(l.hits.length)).catch(() => setLootN(-1)), 350)
    return () => clearTimeout(t)
  }, [lootQ, def.id, layout])
  // типи точок цієї мапи, яких у записі ще немає — за групами, як у шарах
  const typeGroups = resp.source.groups
    .map((g) => ({ id: g.id, types: g.types.filter((ty) => counts[ty.id] && !d.types?.some((x) => x.map === def.id && x.type === ty.id)) }))
    .filter((g) => g.types.length)

  async function save(e?: React.SyntheticEvent) {
    e?.preventDefault()
    if (busy || !d.res?.trim() || !d.place?.trim()) return
    setBusy(true)
    const { id, ...body } = d
    const { item: _item, created: _c, updated, ...clean } = body as typeof body & { item?: unknown; created?: number; updated?: number }
    // base — версія, яку правили: якщо хтось устиг змінити запис, сервер не дасть затерти його правки
    const row = id ? await patch(id, { ...clean, ...(updated ? { base: updated } : {}) }) : await add({ ...clean, owner, visibility: vis })
    if (!id && row) await rights.apply(row, owner, vis)
    setBusy(false)
    if (row) {
      edit(null)
      select(row.id)
    }
  }

  // у <sn-input> Enter форму не надсилає — робимо це самі (крім набору ієрогліфів: там Enter підтверджує слово)
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void save(e)
  }

  return (
    <form onSubmit={(e) => void save(e)} className="mx-1 mb-2 mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-spice/50 bg-panel2/40 p-2.5 text-[12px]">
      <div className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-spice">{d.id ? t('Змінити запис') : t('Новий запис')}</div>
      <label className="grid gap-0.5 text-[11px] text-muted">
        {t('Ресурс')}
        <SnInput modelValue={d.res || ''} maxLength={160} placeholder={t('Тактичний радіаційний костюм')} accessibilityLabel={t('Ресурс')} onInput={(e: Event) => patchDraft({ res: valueOf(e) })} onKeyDown={onEnter} />
      </label>
      <label className="grid gap-0.5 text-[11px] text-muted">
        {t('Місце')}
        <SnInput modelValue={d.place || ''} maxLength={160} placeholder={t('Випробувальна станція №89')} accessibilityLabel={t('Місце')} onInput={(e: Event) => patchDraft({ place: valueOf(e) })} onKeyDown={onEnter} />
      </label>
      <div className="grid gap-0.5 text-[11px] text-muted">
        {t('Регіон')}
        {/* усі три поруч, а не випадним списком */}
        <Seg<Draft['zone'] & string>
          label={t('Регіон')}
          size="sm"
          value={d.zone || 'hagga'}
          onChange={(v) => patchDraft({ zone: v })}
          items={(Object.keys(ZONES) as (keyof typeof ZONES)[]).map((k) => ({ id: k, label: ZONES[k] }))}
          className={cn('grid w-full grid-cols-3', TOUCH_SEG)}
        />
      </div>
      <label className="grid gap-0.5 text-[11px] text-muted">
        {t('Район')}
        <SnInput modelValue={d.area || ''} maxLength={200} accessibilityLabel={t('Район')} onInput={(e: Event) => patchDraft({ area: valueOf(e) })} onKeyDown={onEnter} />
      </label>
      <label className="grid gap-0.5 text-[11px] text-muted">
        {t('Як дістати')}
        <SnTextarea rows={4} modelValue={d.how || ''} maxLength={2000} accessibilityLabel={t('Як дістати')} onInput={(e: Event) => patchDraft({ how: valueOf(e) })} />
      </label>
      <label className="grid gap-0.5 text-[11px] text-muted">
        <span>
          {t('Предмет у луті (твоєю мовою або англійською)')}
          {lootQ.length >= 3 && <b className="ml-1 font-mono text-ink">{lootN == null ? '…' : lootN < 0 ? t('не вдалося перевірити лут') : boxes(lootN)}</b>}
        </span>
        <SnInput modelValue={d.loot || ''} maxLength={120} placeholder={t('Промислова помпа')} accessibilityLabel={t('Предмет у луті')} onInput={(e: Event) => patchDraft({ loot: valueOf(e) })} onKeyDown={onEnter} />
      </label>
      <div className="grid gap-1">
        <span className="text-[11px] text-muted">{t('Типи точок')}</span>
        <div className="flex flex-wrap gap-1">
          {(d.types || []).map((ty, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-line py-0.5 pl-2 pr-0.5 text-[11px]">
              {ty.map !== def.id && <span className="text-muted">{mapName(resp.labels, ty.map)}:</span>}
              {labelOf(resp.labels, ty.type)}
              <button type="button" aria-label={t('Прибрати тип')} className={cn('grid h-5 w-5 place-items-center rounded-full text-muted hover:text-bad', TOUCH)} onClick={() => patchDraft({ types: d.types!.filter((_, j) => j !== i) })}>
                <X size={11} />
              </button>
            </span>
          ))}
          {typeGroups.length > 0 && (
            <button
              type="button"
              aria-expanded={addType}
              onClick={() => setAddType(!addType)}
              className={cn('inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-line px-2 text-[11px] text-muted hover:text-ink [@media(pointer:coarse)]:h-10', addType && 'border-solid text-ink')}
            >
              <Plus size={11} /> {t('тип')}
            </button>
          )}
        </div>
        {/* типи цієї мапи — усі поруч, за групами (а не випадним списком) */}
        {addType && (
          <div aria-label={t('Додати тип точок')} className="grid max-h-56 gap-1.5 overflow-y-auto rounded-md border border-line p-1.5">
            {typeGroups.map((g) => (
              <div key={g.id} className="grid gap-1">
                <span className="font-display text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted">{labelOf(resp.labels, g.id)}</span>
                <div className="flex flex-wrap gap-1">
                  {g.types.map((ty) => (
                    <button
                      key={ty.id}
                      type="button"
                      onClick={() => patchDraft({ types: [...(d.types || []), { map: def.id, type: ty.id }] })}
                      className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] hover:border-spice/60 hover:bg-spice/10 [@media(pointer:coarse)]:min-h-10"
                    >
                      {labelOf(resp.labels, ty.id)} <span className="font-mono text-[10px] text-muted">{counts[ty.id]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-1">
        <span className="text-[11px] text-muted">{def.id === 'deepdesert_1' && layout != null ? t('Точки · розкладка {n}', { n: layout }) : t('Точки')}</span>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
          {(d.pins || []).map((p, i) => (
            <li key={i} className="flex items-center gap-1.5 text-[11.5px]">
              <MapPin size={12} className="shrink-0 text-spice" />
              <SnInput
                size="sm"
                className="min-w-0 flex-1"
                modelValue={p.label || ''}
                maxLength={120}
                placeholder={`${mapName(resp.labels, p.map)} ${p.x}, ${p.y}`}
                accessibilityLabel={t('Підпис точки')}
                onInput={(e: Event) => patchDraft({ pins: d.pins!.map((x, j) => (j === i ? { ...x, label: valueOf(e) } : x)) })}
                onKeyDown={onEnter}
              />
              {p.layout != null && <span className="shrink-0 font-mono text-[10px] text-muted">{t('розкладка {n}', { n: p.layout })}</span>}
              <button type="button" aria-label={t('Прибрати точку')} className={cn('grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:text-bad', TOUCH)} onClick={() => patchDraft({ pins: d.pins!.filter((_, j) => j !== i) })}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
        <Button size="xs" variant={picking ? 'default' : 'outline'} onClick={() => setPicking(!picking)} className="justify-self-start">
          <Crosshair size={12} /> {picking ? t('Клацай на мапі… (Esc)') : t('Вказати на мапі')}
        </Button>
      </div>
      {!d.id && <NewAccess owner={owner} visibility={vis} rights={rights} onChange={(o, v) => { setOwner(o); setVis(v) }} />}
      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={busy || !d.res?.trim() || !d.place?.trim()}>
          {d.id ? t('Зберегти') : t('Додати')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => edit(null)}>
          {t('Скасувати')}
        </Button>
      </div>
    </form>
  )
}

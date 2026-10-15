/**
 * «Наші ресурси» — наш шар поверх даних гри: де брати унікальні ресурси.
 * Запис можна прив'язати трьома способами, і мапа покаже все разом:
 *   точки (ромби), типи точок гри (кільця навколо всіх печер / уламків…),
 *   предмет луту (усі контейнери, де він випадає, з відсотком).
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, Crosshair, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react'
import { usePlaces, type Place } from '@/lib/places'
import { useMapUi, type Draft } from '@/lib/map/ui'
import { labelOf, loadLoot, MAP_SHORT, ZONE_MAPS, type LootHit, type MapDef, type SourceResp } from '@/lib/map/data'
import { cn, fmtN, splitEn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Section } from './bits'

const ZONES = { hagga: 'Хагга', dd: 'Глибока пустеля', city: 'Міста' } as const

export const onMap = (p: Place, map: string) =>
  p.pins?.some((x) => x.map === map) || p.types?.some((t) => t.map === map) || (ZONE_MAPS[p.zone] || []).includes(map)

export function PlacesSection({
  def,
  layout,
  resp,
  counts,
  loot,
  onFly,
  onSwitchMap,
}: {
  def: MapDef
  layout: number | null
  resp: SourceResp
  counts: Record<string, number>
  /** лут вибраного запису на цій мапі */
  loot: { hits: LootHit[]; loading: boolean } | null
  onFly: (x: number, y: number) => void
  onSwitchMap: (map: string, select?: string) => void
}) {
  const { rows, ready, error, patch, remove } = usePlaces()
  const { selected, select, draft, edit } = useMapUi()
  const [q, setQ] = useState('')
  const here = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const m = rows.filter((r) => !ql || [r.res, r.place, r.area, r.how, r.loot].some((x) => String(x || '').toLowerCase().includes(ql)))
    return {
      on: m.filter((r) => onMap(r, def.id)).sort((a, b) => a.res.localeCompare(b.res, 'uk')),
      off: m.filter((r) => !onMap(r, def.id)).sort((a, b) => a.res.localeCompare(b.res, 'uk')),
    }
  }, [rows, def.id, q])
  const okN = rows.filter((r) => r.ok).length
  // вибрали запис на мапі або щойно додали — показати його в списку
  useEffect(() => {
    if (selected) requestAnimationFrame(() => document.getElementById('place-' + selected)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }, [selected])

  return (
    <Section id="ours" title="Наші ресурси" count={`${here.on.length} · ✓${okN}`}>
      <div className="mb-1.5 flex gap-1.5">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Фільтр: ресурс, місце, лут"
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-panel2/60 px-2 text-[12px] placeholder:text-muted focus:border-spice focus:outline-none"
        />
        <Button
          size="xs"
          onClick={() => edit({ res: '', place: '', zone: def.id === 'deepdesert_1' ? 'dd' : def.id.startsWith('sh_') ? 'city' : 'hagga', area: '', how: '', loot: '', pins: [], types: [] })}
          data-tip="Новий запис: що, де і як дістати"
        >
          <Plus size={12} /> Додати
        </Button>
      </div>
      {draft && !draft.id && <Editor def={def} layout={layout} resp={resp} counts={counts} />}
      {!ready && <p className="px-1.5 py-1 text-[12px] text-muted">Завантаження записів…</p>}
      {error && <p className="px-1.5 py-1 text-[12px] text-bad">{error}</p>}
      {ready && !here.on.length && !draft && <p className="px-1.5 py-1 text-[12px] text-muted">На цій мапі записів немає.</p>}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
        {here.on.map((r) => (
          <li key={r.id} id={'place-' + r.id} className="scroll-mt-2">
            <Row r={r} on={selected === r.id} onClick={() => select(selected === r.id ? null : r.id)} />
            {selected === r.id && (draft?.id === r.id ? (
              <Editor def={def} layout={layout} resp={resp} counts={counts} />
            ) : (
              <Detail r={r} def={def} layout={layout} resp={resp} loot={loot} onFly={onFly} patch={patch} remove={remove} onEdit={() => edit({ ...r })} />
            ))}
          </li>
        ))}
      </ul>
      {here.off.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer px-1.5 py-1 text-[11.5px] text-muted hover:text-ink">На інших мапах — {here.off.length}</summary>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
            {here.off.map((r) => {
              const m = r.pins?.[0]?.map || r.types?.[0]?.map || ZONE_MAPS[r.zone]?.[0]
              return (
                <li key={r.id}>
                  <Row r={r} on={false} hint={m ? MAP_SHORT[m] || labelOf(resp.labels, m) : undefined} onClick={() => m && onSwitchMap(m, r.id)} />
                </li>
              )
            })}
          </ul>
        </details>
      )}
    </Section>
  )
}

/**
 * Найкращі контейнери за шансом. Сусідні (до ~30 м) з однаковим шансом склеюємо:
 * у таборі часто три однакові скрині поруч — у списку це одне місце «×3».
 */
function topHits(hits: LootHit[]) {
  const out: (LootHit & { n: number })[] = []
  for (const h of [...hits].sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0))) {
    const near = out.find((o) => o.chance === h.chance && o.type === h.type && Math.hypot(o.x - h.x, o.y - h.y) < 3000)
    if (near) near.n++
    else out.push({ ...h, n: 1 })
  }
  return out.slice(0, 6)
}

function Row({ r, on, onClick, hint }: { r: Place; on: boolean; onClick: () => void; hint?: string }) {
  const [name, en] = splitEn(r.res)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={on}
      className={cn('flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left transition-colors', on ? 'bg-spice/12 ring-1 ring-spice/40' : 'hover:bg-panel2')}
    >
      <span className={cn('mt-0.5 h-3 w-3 shrink-0 rotate-45 rounded-[2px] border-2', on ? 'border-spice bg-spice' : 'border-spice/70')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold leading-tight">{name}</span>
        <span className="block truncate text-[11px] leading-tight text-muted">{en ? `${en} · ` : ''}{splitEn(r.place)[0]}</span>
      </span>
      {hint && <span className="shrink-0 rounded bg-panel2 px-1 font-mono text-[9.5px] text-muted">{hint}</span>}
      {r.ok && <Check size={13} className="mt-0.5 shrink-0 text-ok" aria-label="перевірено" />}
    </button>
  )
}

function Detail({
  r,
  def,
  layout,
  resp,
  loot,
  onFly,
  patch,
  remove,
  onEdit,
}: {
  r: Place
  def: MapDef
  layout: number | null
  resp: SourceResp
  loot: { hits: LootHit[]; loading: boolean } | null
  onFly: (x: number, y: number) => void
  patch: (id: string, p: Partial<Place>) => Promise<Place | null>
  remove: (id: string) => Promise<boolean>
  onEdit: () => void
}) {
  const pins = r.pins.filter((p) => p.map === def.id)
  const types = r.types.filter((t) => t.map === def.id)
  const best = loot?.hits.reduce((m, h) => Math.max(m, h.chance ?? 0), 0) ?? 0
  return (
    <div className="mx-1 mb-2 mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 break-words rounded-lg border border-line bg-panel2/40 p-2.5 text-[12px]">
      <div>
        <div className="font-semibold">{splitEn(r.place)[0]}</div>
        {r.area && <div className="text-[11.5px] text-muted">{r.area}</div>}
      </div>
      {r.how && <p className="whitespace-pre-line leading-snug">{r.how}</p>}
      {r.loot && (
        <div className="rounded-md bg-spice/10 px-2 py-1.5 text-[11.5px]">
          <b>Лут «{r.loot}»:</b>{' '}
          {loot?.loading ? 'шукаю…' : loot?.hits.length ? (
            <>
              {fmtN(loot.hits.length)} контейнерів на цій мапі{best ? `, до ${best}%` : ''} — кружечки на мапі.
              <ul className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-0.5">
                {topHits(loot.hits).map((h) => (
                  <li key={`${h.type}:${h.i}`}>
                    <button type="button" onClick={() => onFly(h.x, h.y)} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-spice/10">
                      <span className="w-9 shrink-0 text-right font-mono text-[10.5px] font-semibold text-spice">{h.chance != null ? `${h.chance}%` : '—'}</span>
                      <span className="min-w-0 flex-1 truncate">{h.name || labelOf(resp.labels, h.type)}</span>
                      {h.n > 1 && <span className="font-mono text-[10px] text-muted">×{h.n}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            'на цій мапі TH.GL такого не знає.'
          )}
        </div>
      )}
      {types.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {types.map((t) => (
            <span key={t.type} className="rounded-full border border-spice/40 px-2 py-0.5 text-[11px]" data-tip="Усі такі точки обведено на мапі">
              ◯ {labelOf(resp.labels, t.type)}
            </span>
          ))}
        </div>
      )}
      {pins.length > 0 && (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {pins.map((p, i) => {
            const other = def.id === 'deepdesert_1' && p.layout != null && p.layout !== layout
            return (
              <li key={i}>
                <button type="button" onClick={() => onFly(p.x, p.y)} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-panel2">
                  <MapPin size={12} className="shrink-0 text-spice" />
                  <span className="min-w-0 flex-1 truncate">{p.label || 'Точка'}</span>
                  {other && <span className="text-[10px] text-warn" data-tip="Точка з іншого тижня Deep Desert: зараз там може бути інакше">тиждень {p.layout}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <label className="mr-auto inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted">
          <input type="checkbox" className="accent-[rgb(var(--c-spice))]" checked={r.ok} onChange={(e) => patch(r.id, { ok: e.target.checked })} />
          перевірено в грі
        </label>
        <Button size="xs" variant="secondary" onClick={onEdit}>
          <Pencil size={11} /> Змінити
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            if (confirm(`Видалити запис «${r.res}» — ${r.place}?`)) void remove(r.id)
          }}
          aria-label="Видалити запис"
          data-tip="Видалити запис"
        >
          <Trash2 size={12} />
        </Button>
      </div>
    </div>
  )
}

function Editor({ def, layout, resp, counts }: { def: MapDef; layout: number | null; resp: SourceResp; counts: Record<string, number> }) {
  const { draft, patchDraft, edit, picking, setPicking, select } = useMapUi()
  const { add, patch } = usePlaces()
  const [busy, setBusy] = useState(false)
  const [lootN, setLootN] = useState<number | null>(null)
  const d = draft as Draft
  const lootQ = d.loot?.trim() || ''
  useEffect(() => {
    setLootN(null)
    if (lootQ.length < 3) return
    const t = setTimeout(() => loadLoot(def.id, layout, lootQ).then((h) => setLootN(h.length)).catch(() => setLootN(null)), 350)
    return () => clearTimeout(t)
  }, [lootQ, def.id, layout])
  const typeOpts = resp.source.groups.flatMap((g) => g.types).filter((t) => counts[t.id] && !d.types?.some((x) => x.map === def.id && x.type === t.id))
  const field = 'h-8 w-full rounded-md border border-line bg-panel px-2 text-[12.5px] focus:border-spice focus:outline-none'

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!d.res?.trim() || !d.place?.trim()) return
    setBusy(true)
    const { id, ...body } = d
    const row = id ? await patch(id, body) : await add(body)
    setBusy(false)
    if (row) {
      edit(null)
      select(row.id)
    }
  }

  return (
    <form onSubmit={save} className="mx-1 mb-2 mt-1 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-lg border border-spice/50 bg-panel2/40 p-2.5 text-[12px]">
      <div className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-spice">{d.id ? 'Змінити запис' : 'Новий запис'}</div>
      <label className="grid gap-0.5 text-[11px] text-muted">
        Ресурс
        <input className={field} required maxLength={160} value={d.res || ''} onChange={(e) => patchDraft({ res: e.target.value })} placeholder="Промислові помпи (Industrial Pump)" />
      </label>
      <label className="grid gap-0.5 text-[11px] text-muted">
        Місце
        <input className={field} required maxLength={160} value={d.place || ''} onChange={(e) => patchDraft({ place: e.target.value })} placeholder="Вартове місто (Sentinel City)" />
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="grid gap-0.5 text-[11px] text-muted">
          Регіон
          <select className={field} value={d.zone || 'hagga'} onChange={(e) => patchDraft({ zone: e.target.value as Draft['zone'] })}>
            {Object.entries(ZONES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-0.5 text-[11px] text-muted">
          Район
          <input className={field} maxLength={200} value={d.area || ''} onChange={(e) => patchDraft({ area: e.target.value })} placeholder="Східна Щитова стіна" />
        </label>
      </div>
      <label className="grid gap-0.5 text-[11px] text-muted">
        Як дістати
        <textarea className={cn(field, 'h-20 resize-y py-1.5')} maxLength={2000} value={d.how || ''} onChange={(e) => patchDraft({ how: e.target.value })} placeholder="Де саме скриня, що з ворогами, хто продає" />
      </label>
      <label className="grid gap-0.5 text-[11px] text-muted">
        <span>
          Предмет у луті <span className="opacity-70">(назва з гри, укр. або англ.)</span>
          {lootQ.length >= 3 && <b className="ml-1 font-mono text-ink">{lootN == null ? '…' : `${fmtN(lootN)} контейнерів`}</b>}
        </span>
        <input className={field} maxLength={120} value={d.loot || ''} onChange={(e) => patchDraft({ loot: e.target.value })} placeholder="Industrial Pump" />
      </label>
      <div className="grid gap-1">
        <span className="text-[11px] text-muted">Типи точок на мапі «{MAP_SHORT[def.id] || labelOf(resp.labels, def.id)}»</span>
        <div className="flex flex-wrap gap-1">
          {(d.types || []).map((t, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px]">
              {t.map !== def.id && <span className="text-muted">{MAP_SHORT[t.map] || t.map}:</span>}
              {labelOf(resp.labels, t.type)}
              <button type="button" aria-label="Прибрати тип" className="text-muted hover:text-bad" onClick={() => patchDraft({ types: d.types!.filter((_, j) => j !== i) })}>
                <X size={11} />
              </button>
            </span>
          ))}
          <select
            className="h-6 rounded-md border border-dashed border-line bg-transparent px-1 text-[11px] text-muted"
            value=""
            onChange={(e) => e.target.value && patchDraft({ types: [...(d.types || []), { map: def.id, type: e.target.value }] })}
          >
            <option value="">+ тип</option>
            {typeOpts.map((t) => (
              <option key={t.id} value={t.id}>{labelOf(resp.labels, t.id)} ({counts[t.id]})</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-1">
        <span className="text-[11px] text-muted">
          Точки {def.id === 'deepdesert_1' && <span className="text-warn">— прив'язуються до тижня {layout}: після бурі мапа інша</span>}
        </span>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {(d.pins || []).map((p, i) => (
            <li key={i} className="flex items-center gap-1.5 text-[11.5px]">
              <MapPin size={12} className="shrink-0 text-spice" />
              <input
                className="h-6 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 hover:border-line focus:border-spice focus:outline-none"
                value={p.label || ''}
                placeholder={`${MAP_SHORT[p.map] || p.map} ${p.x}, ${p.y}`}
                onChange={(e) => patchDraft({ pins: d.pins!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              />
              {p.layout != null && <span className="font-mono text-[10px] text-muted">т.{p.layout}</span>}
              <button type="button" aria-label="Прибрати точку" className="text-muted hover:text-bad" onClick={() => patchDraft({ pins: d.pins!.filter((_, j) => j !== i) })}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
        <Button size="xs" variant={picking ? 'default' : 'outline'} onClick={() => setPicking(!picking)} className="justify-self-start">
          <Crosshair size={12} /> {picking ? 'Клацни на мапі… (Esc — досить)' : 'Вказати на мапі'}
        </Button>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" type="submit" disabled={busy || !d.res?.trim() || !d.place?.trim()}>
          {d.id ? 'Зберегти' : 'Додати'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => edit(null)}>
          Скасувати
        </Button>
      </div>
    </form>
  )
}

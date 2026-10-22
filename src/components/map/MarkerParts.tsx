/**
 * Позначка на мапі в панелі: значок виду, розгорнута вибрана (вид, точка, нотатка, доступ, дії) і форма —
 * нова («+ Позначка» → клік на мапі → назва, вид, нотатка, чия й хто бачить) чи зміна своєї.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Crosshair, Pencil, Trash2 } from 'lucide-react'
import { useAuth, creatorGuilds } from '@/lib/auth'
import { MARKER_KINDS, markerKind, useMarkers, type Marker, type MarkerDraft } from '@/lib/markers'
import { usePubMarks } from '@/lib/map/marks'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { SnInput, SnTextarea, valueOf } from '@/components/sn'
import { Button } from '@/components/ui/button'
import { ItemBar, NewAccess, type OwnerRef } from '@/components/access/Access'
import { useNewRights } from '@/components/access/Rights'
import type { Visibility } from '@/lib/items'
import { Confirm, fmtPoint } from './bits'

/** кружечок виду позначки (база гільдії — кольором гільдії, як на мапі) */
export function MarkerGlyph({ m, size = 20 }: { m: Pick<Marker, 'kind'> & { item?: Marker['item'] }; size?: number }) {
  const k = markerKind(m.kind)
  const color = m.kind === 'base' && m.item?.owner.kind === 'guild' ? m.item.owner.color : k.color
  return (
    <span className="grid shrink-0 place-items-center rounded-full font-bold text-white" style={{ width: size, height: size, background: color, fontSize: Math.round(size * 0.52) }} aria-hidden>
      {k.glyph}
    </span>
  )
}

/**
 * вибрана позначка: вид, розкладка, точка (з сектором у Глибокій пустелі), нотатка, доступ і дії; extra — ще кнопки
 * (для чужих публічних)
 */
export function MarkerDetail({ m, sector, onChanged, extra }: { m: Marker; sector?: string | null; onChanged: () => void; extra?: ReactNode }) {
  const { setDraft, remove } = useMarkers()
  const [asking, setAsking] = useState(false)
  const k = markerKind(m.kind)
  return (
    <div className="mx-1 mb-2 mt-1 grid min-w-0 gap-2 break-words rounded-lg border border-line bg-panel2/40 p-2.5 text-[12.5px]">
      <div className="text-[11.5px] text-muted">{[k.label, m.layout != null ? t('розкладка {n}', { n: m.layout }) : null, fmtPoint(m.x, m.y, sector)].filter(Boolean).join(' · ')}</div>
      {m.note && <p className="whitespace-pre-line leading-snug">{m.note}</p>}
      <ItemBar item={m.item} onChange={onChanged} />
      {extra && <div className="flex flex-wrap gap-1.5">{extra}</div>}
      {(m.item.can?.edit || m.item.can?.manage) && (
        <div className="flex gap-1.5">
          {m.item.can?.edit && <Button size="xs" variant="secondary" onClick={() => setDraft({ id: m.id, map: m.map, x: m.x, y: m.y, layout: m.layout, kind: m.kind, title: m.title, note: m.note })}><Pencil size={11} /> {t('Змінити')}</Button>}
          {m.item.can?.manage && (
            <Button size="xs" variant="ghost" aria-label={t('Видалити позначку')} data-tip={t('Видалити позначку')} onClick={() => setAsking(true)}>
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      )}
      {asking && (
        <Confirm
          title={t('Видалити позначку «{title}»?', { title: m.title })}
          confirm={t('Видалити')}
          onClose={() => setAsking(false)}
          onConfirm={async () => {
            await remove(m.id)
            usePubMarks.getState().drop(`marker:${m.id}`)
          }}
        />
      )}
    </div>
  )
}

export function MarkerEditor({ draft, sector }: { draft: MarkerDraft; sector?: string | null }) {
  const { user, guilds } = useAuth()
  const { save, setDraft, setPicking } = useMarkers()
  const main = creatorGuilds(guilds).find((g) => g.id === user?.mainGuild)
  const [d, setD] = useState<MarkerDraft>(draft)
  const [owner, setOwner] = useState<OwnerRef>(main ? { kind: 'guild', id: main.id } : { kind: 'user', id: user?.id || '' })
  // права нової речі — у тому ж вікні, під «Хто власник» і «Хто бачить»
  const rights = useNewRights('marker')
  const [vis, setVis] = useState<Visibility>(main ? 'guild' : 'private')
  const [busy, setBusy] = useState(false)
  useEffect(() => setD((x) => ({ ...x, map: draft.map, x: draft.x, y: draft.y, layout: draft.layout })), [draft.map, draft.x, draft.y, draft.layout])
  const nameRef = useRef<HTMLElement>(null)
  // поле назви одразу готове до вводу (sn-input малює поле в наступну мікрозадачу — чекаємо кадр)
  useEffect(() => {
    const id = requestAnimationFrame(() => nameRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])
  const submit = async (e?: React.SyntheticEvent) => {
    e?.preventDefault()
    if (busy || !d.title.trim()) return
    setBusy(true)
    const m = await save(d.id ? d : { ...d, owner, visibility: vis })
    if (!d.id && m) await rights.apply(m, owner, vis)
    setBusy(false)
  }
  // у <sn-input> Enter форму не надсилає — робимо це самі (крім набору ієрогліфів: там Enter підтверджує слово)
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit(e)
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="mx-1 mb-2 mt-1 grid min-w-0 gap-2 rounded-lg border border-spice/50 bg-panel2/40 p-2.5 text-[12px]">
      <div className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-spice">{d.id ? t('Змінити позначку') : t('Нова позначка')}</div>
      <div className="flex flex-wrap gap-1">
        {MARKER_KINDS.map((k) => (
          <button key={k.id} type="button" aria-pressed={d.kind === k.id} onClick={() => setD({ ...d, kind: k.id })}
            className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:px-3', d.kind === k.id ? 'border-spice/70 bg-spice/10 text-ink' : 'border-line text-muted hover:text-ink')}>
            <span className="grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold text-white" style={{ background: k.color }}>{k.glyph}</span>{k.label}
          </button>
        ))}
      </div>
      <label className="grid gap-0.5 text-[11px] text-muted">
        {t('Назва')}
        <SnInput ref={nameRef} modelValue={d.title} maxLength={80} placeholder={t('Наприклад: база гільдії')} accessibilityLabel={t('Назва')} onInput={(e: Event) => setD((x) => ({ ...x, title: valueOf(e) }))} onKeyDown={onEnter} />
      </label>
      <label className="grid gap-0.5 text-[11px] text-muted">
        {t('Нотатка')}
        <SnTextarea rows={3} modelValue={d.note} maxLength={1000} accessibilityLabel={t('Нотатка')} onInput={(e: Event) => setD((x) => ({ ...x, note: valueOf(e) }))} />
      </label>
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
        {[fmtPoint(d.x, d.y, sector), d.layout != null ? t('розкладка {n}', { n: d.layout }) : null].filter(Boolean).join(' · ')}
        <Button size="xs" variant="ghost" onClick={() => setPicking(true)}><Crosshair size={11} /> {t('інша точка')}</Button>
      </div>
      {!d.id && <NewAccess owner={owner} visibility={vis} rights={rights} onChange={(o, v) => { setOwner(o); setVis(v) }} />}
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={busy || !d.title.trim()}>{d.id ? t('Зберегти') : t('Додати')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t('Скасувати')}</Button>
      </div>
    </form>
  )
}

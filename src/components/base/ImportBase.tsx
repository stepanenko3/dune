/**
 * Імпорт бази з файлу (вікно на сторінці «Бази»): файл .json, вивантажений кнопкою «Вивантажити» на сторінці бази
 * (чи інший документ бази), або вставлений текст. «Перевірити» — сервер перевіряє файл, нічого не створюючи (dryRun):
 * помилки — з місцем у файлі, попередження (що виправиться саме) і підсумок (скільки деталей, станцій, рівнів…).
 * Тоді — назва, чиє і хто бачить (як у «Нова база») і «Імпортувати»: нова база з власною історією.
 */
import { useRef, useState } from 'react'
import { FileJson, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { IMPORT_MAX_BYTES, importBase, type ImportIssue, type ImportResult } from '@/lib/bases'
import { creatorGuilds, useAuth } from '@/lib/auth'
import type { Visibility } from '@/lib/items'
import { useStore } from '@/store'
import { locale, t } from '@/lib/i18n'
import { fmtN, word } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ErrorAlert } from '@/components/states'
import { NewAccess, type OwnerRef } from '@/components/access/Access'
import { useNewRights } from '@/components/access/Rights'
import { SnAlert, SnAlertDescription, SnAlertTitle, SnInput, SnTextarea, valueOf } from '@/components/sn'
import { Field } from '@/pages/Auth'

/** частини місця в документі словами: «doc.pieces[12].shape» → «деталь 13 · форма» */
const PARTS: Record<string, (n?: number) => string> = {
  pieces: (n) => (n == null ? t('деталі') : t('деталь {n}', { n })),
  items: (n) => (n == null ? t('станції') : t('станція {n}', { n })),
  zones: (n) => (n == null ? t('приміщення') : t('приміщення {n}', { n })),
  rooms: (n) => (n == null ? t('приміщення') : t('приміщення {n}', { n })),
  claims: (n) => (n == null ? t('ділянки') : t('ділянка {n}', { n })),
  tiles: (n) => (n == null ? t('плитки') : t('плитка {n}', { n })),
  levels: () => t('рівні'), heights: () => t('висоти'), ui: () => t('підписи'), name: () => t('назва'), format: () => t('формат'),
  shape: () => t('форма'), rot: () => t('поворот'), ang: () => t('кут'), c: () => t('місце'), w: () => t('ширина'), d: () => t('глибина'), h: () => t('висота'),
}
function placeOf(path: string) {
  return path.replace(/^doc\./, '').split('.').filter(Boolean).map((p) => {
    const m = /^(\w+)(?:\[(\d+)\])?$/.exec(p)
    if (!m) return p
    const f = PARTS[m[1]]
    return f ? f(m[2] != null ? Number(m[2]) + 1 : undefined) : m[2] != null ? `${m[1]} ${Number(m[2]) + 1}` : m[1]
  }).join(' · ')
}

/** зауваження списком: де в файлі — коротко словами, що не так — текстом */
function Issues({ list }: { list: ImportIssue[] }) {
  return (
    <ul className="mt-1 grid max-h-[220px] gap-1 overflow-y-auto overscroll-contain text-[12.5px]">
      {list.map((x, i) => (
        <li key={i} className="min-w-0 break-words">
          {x.path && <span className="mr-1.5 rounded bg-panel2 px-1 py-px text-[11.5px] text-muted">{placeOf(x.path)}</span>}
          {x.message}
        </li>
      ))}
    </ul>
  )
}

const mb = (n: number) => (n / 1048576).toLocaleString(locale(), { maximumFractionDigits: 1 })

/** onImported — куди далі (панель керування відкриває запис бази в себе); без нього — сторінка нової бази на сайті */
export function ImportBase({ open, onOpenChange, onImported }: { open: boolean; onOpenChange: (v: boolean) => void; onImported?: (id: string) => void }) {
  const { user, guilds } = useAuth()
  const main = creatorGuilds(guilds).find((g) => g.id === user?.mainGuild)
  const [file, setFile] = useState<{ name: string; size: number; text: string } | null>(null)
  const [text, setText] = useState('')
  const [bad, setBad] = useState<string | null>(null)
  const [res, setRes] = useState<ImportResult | null>(null)
  const [doc, setDoc] = useState<unknown>(null)
  const [busy, setBusy] = useState<null | 'check' | 'import'>(null)
  const [name, setName] = useState('')
  const [owner, setOwner] = useState<OwnerRef>(main ? { kind: 'guild', id: main.id } : { kind: 'user', id: user?.id || '' })
  // права нової речі — у тому ж вікні, під «Хто власник» і «Хто бачить»
  const rights = useNewRights('base')
  const [vis, setVis] = useState<Visibility>(main ? 'guild' : 'private')
  const pick = useRef<HTMLInputElement>(null)

  // інший файл чи текст — перевірку робимо заново
  const reset = () => { setRes(null); setDoc(null); setBad(null) }
  const choose = async (f: File | undefined) => {
    if (!f) return
    reset()
    if (f.size > IMPORT_MAX_BYTES) { setFile(null); setBad(t('Файл завеликий: {size} МБ, можна до {max} МБ.', { size: mb(f.size), max: mb(IMPORT_MAX_BYTES) })); return }
    setFile({ name: f.name, size: f.size, text: await f.text() })
  }
  const source = file ? file.text : text

  const check = async () => {
    reset()
    let parsed: unknown
    try {
      parsed = JSON.parse(source)
    } catch {
      setBad(t('Текст не читається як файл бази — можливо, його обрізано чи вставлено не повністю.'))
      return
    }
    setBusy('check')
    try {
      const r = await importBase(parsed, { dryRun: true })
      setRes(r)
      if (r.ok) { setDoc(parsed); setName(r.summary?.name || '') }
    } catch (e) {
      setBad((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const run = async () => {
    if (!doc) return
    setBusy('import')
    try {
      const r = await importBase(doc, { owner, visibility: vis, name: name.trim() || undefined })
      if (!r.ok || !r.id) { setRes(r); return }
      await rights.apply({ id: r.id }, owner, vis)
      toast.success(t('Базу «{name}» імпортовано', { name: r.base?.doc.ui?.name || name }))
      onOpenChange(false)
      if (onImported) onImported(r.id!)
      else useStore.getState().setView('bases', { base: r.id })
    } catch (e) {
      setBad((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const s = res?.summary
  const ready = !!res?.ok && !!doc
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('Імпортувати базу')}
      description={t('Файл, вивантажений кнопкою «Вивантажити» на сторінці бази. Спершу перевіримо — і лише тоді створимо нову базу; наявні не зміняться.')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Скасувати')}</Button>
          {ready
            ? <Button onClick={run} loading={busy === 'import'} disabled={!!busy}>{busy === 'import' ? t('Імпортую…') : t('Імпортувати')}</Button>
            : <Button onClick={check} loading={busy === 'check'} disabled={!!busy || !source.trim()}>{busy === 'check' ? t('Перевіряю…') : t('Перевірити')}</Button>}
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <input ref={pick} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = '' }} />
          {file ? (
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-panel2/40 px-3 py-2 text-[13.5px]">
              <FileJson size={16} className="shrink-0 text-spice" />
              <span className="min-w-0 flex-1 truncate font-semibold">{file.name}</span>
              <span className="shrink-0 font-mono text-[12px] text-muted">{file.size < 1048576 ? t('{n} КБ', { n: fmtN(Math.ceil(file.size / 1024)) }) : t('{n} МБ', { n: mb(file.size) })}</span>
              <Button variant="ghost" size="icon" onClick={() => { setFile(null); reset() }} aria-label={t('Прибрати файл')} title={t('Прибрати файл')}><X size={14} /></Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => pick.current?.click()}><Upload size={15} /> {t('Вибрати файл .json')}</Button>
                <span className="text-[12.5px] text-muted">{t('або встав текст файлу нижче')}</span>
              </div>
              <SnTextarea rows={5} modelValue={text} className="font-mono" placeholder={t('Встав сюди весь текст файлу бази')} accessibilityLabel={t('Текст файлу бази')}
                onInput={(e: Event) => { setText(valueOf(e) ?? ''); if (res || bad) reset() }} />
            </>
          )}
        </div>

        {bad && <ErrorAlert title={t('Не вдалося перевірити')} message={bad} />}
        {res && res.errors.length > 0 && (
          <ErrorAlert title={t('У файлі є помилки — базу не створено ({n})', { n: res.errors.length })} message={<Issues list={res.errors} />} />
        )}
        {res && res.warnings.length > 0 && (
          <SnAlert variant="warning" appearance="soft" className="block">
            <SnAlertTitle>{res.ok ? t('Виправиться саме') : t('Ще зауваження')}</SnAlertTitle>
            <SnAlertDescription><Issues list={res.warnings} /></SnAlertDescription>
          </SnAlert>
        )}
        {res?.ok && s && (
          <div className="grid gap-1.5 rounded-lg border border-ok/40 bg-ok/10 px-3.5 py-2.5 text-[13.5px]">
            <b className="font-display text-[14.5px]">{t('Файл у порядку: «{name}»', { name: s.name })}</b>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12.5px] tabular-nums text-muted [&_b]:font-semibold [&_b]:text-ink">
              {s.format === 2 ? (
                <>
                  <li><b>{fmtN(s.pieces)}</b> {word(s.pieces, [t('деталь'), t('деталі'), t('деталей')])}</li>
                  <li><b>{fmtN(s.items)}</b> {word(s.items, [t('станція'), t('станції'), t('станцій')])}</li>
                  <li><b>{fmtN(s.levels)}</b> {word(s.levels, [t('рівень'), t('рівні'), t('рівнів')])}</li>
                  <li><b>{fmtN(s.zones)}</b> {word(s.zones, [t('приміщення'), t('приміщення'), t('приміщень')])}</li>
                </>
              ) : (
                <>
                  <li><b>{fmtN(s.rooms)}</b> {word(s.rooms, [t('приміщення'), t('приміщення'), t('приміщень')])}</li>
                  <li><b>{fmtN(s.tiles)}</b> {word(s.tiles, [t('плита'), t('плити'), t('плит')])}</li>
                  <li><b>{fmtN(s.items)}</b> {word(s.items, [t('пристрій'), t('пристрої'), t('пристроїв')])}</li>
                  <li><b>{fmtN(s.levels)}</b> {word(s.levels, [t('рівень'), t('рівні'), t('рівнів')])}</li>
                </>
              )}
              <li><b>{fmtN(s.claims)}</b> {word(s.claims, [t('ділянка'), t('ділянки'), t('ділянок')])}</li>
            </ul>
            {s.source && (
              <span className="text-[12.5px] text-muted">
                {[s.source.site, s.source.version ? t('версія {n}', { n: s.source.version }) : null, s.source.exportedAt ? t('вивантажено {date}', { date: new Date(s.source.exportedAt).toLocaleString(locale()) }) : null].filter(Boolean).join(' · ')}
              </span>
            )}
            {s.format !== 2 && <span className="text-[12.5px] text-muted">{t('Давня база з приміщень: редактор перетворить її в деталі гри, щойно ти її відкриєш.')}</span>}
          </div>
        )}

        {ready && (
          <>
            <Field label={t('Назва нової бази')}>
              <SnInput size="md" modelValue={name} maxLength={120} placeholder={s?.name || t('База')} accessibilityLabel={t('Назва нової бази')}
                onInput={(e: Event) => setName(valueOf(e) ?? '')}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && !busy) { e.preventDefault(); void run() } }} />
            </Field>
            <NewAccess owner={owner} visibility={vis} rights={rights} onChange={(o, v) => { setOwner(o); setVis(v) }} />
          </>
        )}
      </div>
    </Modal>
  )
}

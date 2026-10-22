/**
 * «Переклади сайту» — редактор, а не таблиця: мова, фільтр (усі / без перекладу / змінені тут), пошук; кожен текст —
 * український оригінал ліворуч і переклад праворуч, зберігається, щойно виходиш із поля. «Повернути» — прибрати правку
 * й узяти переклад із файлу. Переклад має зберегти {заповнювачі} оригіналу — інакше підсвічуємо.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { SnBadge, SnButton, SnInput, SnSegmented, SnSegmentedItem, SnSelect, SnSkeleton, SnTextarea, valueOf } from '@/components/sn'
import { LANGS, currentLang, t } from '@/lib/i18n'
import { useUrlParam } from '@/lib/urlState'
import { adminApi, type Resource, type Row } from './api'
import { PageHeader, Panel } from './ui'
import { useUnsaved } from '@/components/UnsavedBar'

const SIZE = 50
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

export function Translations({ r }: { r: Resource }) {
  // мова й відбір — в адресі (?lang=de&show=all): посилання на потрібний шматок перекладів
  const [lang, setLangUrl] = useUrlParam('lang', currentLang() !== 'uk' ? currentLang() : 'en', (v) => LANGS.some((l) => l.code === v && v !== 'uk'))
  const setLang = (v: string) => { setPage(0); setLangUrl(v, { replace: true }) }
  const [state, setStateUrl] = useUrlParam<'all' | 'missing' | 'override'>('show', 'missing', (v) => v === 'all' || v === 'override')
  const setState = (v: 'all' | 'missing' | 'override') => { setPage(0); setStateUrl(v, { replace: true }) }
  const [search, setSearchRaw] = useState('')
  const setSearch = (v: string) => { setPage(0); setSearchRaw(v) }
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ rows: Row[]; total: number } | null>(null)
  const [err, setErr] = useState('')
  const seq = useRef(0)

  // сторінка скидається там, де змінюють мову, відбір чи пошук, — тож запит один, а не два
  const load = async () => {
    const n = ++seq.current
    try {
      const res = await adminApi.list(r.name, { page, size: SIZE, search, sort: null, desc: false, filters: { lang: [lang], ...(state === 'all' ? {} : { state: [state] }) } })
      if (n === seq.current) { setData({ rows: res.rows, total: res.total }); setErr('') }
    } catch (e) { if (n === seq.current) setErr((e as Error).message) }
  }
  useEffect(() => { const h = setTimeout(() => void load(), search ? 250 : 0); return () => clearTimeout(h) }, [lang, state, search, page])

  // правки перекладів — чернеткою на сторінці (без збереження при виході з поля): смуга внизу зберігає всі разом
  const [edits, setEdits] = useState<Record<string, { row: Row; text: string }>>({})
  const changed = Object.values(edits).filter((e) => e.text !== String(e.row.text ?? ''))
  const saveAll = async () => {
    const bad = changed.find((e) => e.text.trim() !== '' && holes(e.text) !== holes(String(e.row.key)))
    if (bad) { toast.error(t('Збережи заповнювачі оригіналу: {holes}', { holes: holes(String(bad.row.key)).split(',').map((h) => `{${h}}`).join(' ') })); return }
    try {
      for (const e of changed) await adminApi.update(r.name, e.row._id, { text: e.text })
      toast.success(changed.length > 1 ? t('Перекладів збережено: {n}', { n: changed.length }) : t('Переклад збережено'))
      setEdits({})
      void load()
    } catch (e) { toast.error((e as Error).message) }
  }
  useUnsaved(changed.length > 0, { save: saveAll, discard: () => setEdits({}), label: t('Перекладів змінено: {n}', { n: changed.length }) })
  const pages = data ? Math.max(1, Math.ceil(data.total / SIZE)) : 1
  const langs = useMemo(() => LANGS.filter((l) => l.code !== 'uk'), [])

  return (
    <div className="grid min-w-0 gap-3">
      <PageHeader title={t(r.label)} about={r.about ? t(r.about) : undefined} />
      <Panel>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SnSelect className="w-[200px]" modelValue={lang} options={langs.map((l) => ({ value: l.code, label: l.name }))} accessibilityLabel={t('Мова')} onChange={(e: Event) => setLang(valueOf(e))} />
            <SnSegmented modelValue={state} onChange={(e: Event) => setState(valueOf(e) as typeof state)}>
              <SnSegmentedItem value="missing">{t('Без перекладу')}</SnSegmentedItem>
              <SnSegmentedItem value="override">{t('Змінені тут')}</SnSegmentedItem>
              <SnSegmentedItem value="all">{t('Усі')}</SnSegmentedItem>
            </SnSegmented>
            <SnInput className="min-w-[min(100%,280px)] flex-1" type="search" modelValue={search} placeholder={t('Пошук в оригіналі й перекладі')} accessibilityLabel={t('Пошук')} onInput={(e: Event) => setSearch(valueOf(e))} />
            {data && <span className="text-[13px] text-muted">{t('Знайдено: {n}', { n: data.total })}</span>}
          </div>
          {err && <p className="text-[13.5px] text-bad">{err}</p>}
          {!data ? (!err && <SnSkeleton lines={8} />) : !data.rows.length ? (
            <p className="py-6 text-center text-[13.5px] text-muted">{state === 'missing' ? t('Усе перекладено.') : t('Нічого не знайшлося.')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.rows.map((row) => (
                <Line key={row._id} r={r} row={row} onSaved={load} text={edits[row._id]?.text ?? String(row.text ?? '')}
                  onText={(text) => setEdits((cur) => ({ ...cur, [row._id]: { row, text } }))} />
              ))}
            </ul>
          )}
          {data && pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-[13px]">
              <SnButton size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('Назад')}</SnButton>
              <span className="tabular-nums text-muted">{t('Сторінка {page} з {pages}', { page: page + 1, pages })}</span>
              <SnButton size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('Далі')}</SnButton>
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}

function Line({ r, row, onSaved, text, onText }: { r: Resource; row: Row; onSaved: () => void; text: string; onText: (text: string) => void }) {
  const key = String(row.key)
  const [busy, setBusy] = useState(false)
  const bad = text.trim() !== '' && holes(text) !== holes(key)
  const reset = async () => {
    setBusy(true)
    try { await adminApi.remove(r.name, [row._id]); onSaved() } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
      <div className="min-w-0">
        <p className="whitespace-pre-wrap break-words text-[13.5px]">{key}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
          {row.state === 'override' && <SnBadge size="sm" tone="info" variant="soft">{t('змінено тут')}</SnBadge>}
          {row.state === 'missing' && <SnBadge size="sm" tone="critical" variant="soft">{t('без перекладу')}</SnBadge>}
        </div>
      </div>
      <div className="grid gap-1">
        <div className="flex items-start gap-1.5">
          <SnTextarea className="min-w-0 flex-1" rows={Math.min(5, Math.max(1, Math.ceil(key.length / 60)))} modelValue={text} readOnly={!r.canWrite || busy}
            placeholder={row.file ? String(row.file) : t('Переклад')} accessibilityLabel={t('Переклад')} onInput={(e: Event) => onText(valueOf(e))} />
          {row.state === 'override' && r.canWrite && <SnButton size="icon-sm" variant="ghost" accessibilityLabel={t('Повернути переклад із файлу')} data-tip={t('Повернути переклад із файлу')} onClick={reset}><RotateCcw size={14} /></SnButton>}
        </div>
        {bad && <p className="text-[12px] text-bad">{t('Збережи заповнювачі оригіналу: {holes}', { holes: holes(key).split(',').map((h) => `{${h}}`).join(' ') })}</p>}
      </div>
    </li>
  )
}

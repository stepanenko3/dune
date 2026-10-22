/**
 * Пошук по всій панелі (Ctrl/⌘+K чи кнопка в меню): розділи за назвою й записи всіх розділів, які людина бачить
 * (сервер шукає в назві й полях пошуку кожного розділу). Стрілки — вибір, Enter — відкрити.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Search as SearchIcon } from 'lucide-react'
import { SnInput, valueOf } from '@/components/sn'
import { Modal } from '@/components/ui/modal'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { adminApi, adminHref, goAdmin, useAdmin } from './api'
import { DuneLoader } from '@/components/ui/dune-loader'
import { useStore } from '@/store'

interface Hit { key: string; parts: string[]; title: string; group: string }

/** кнопка «Пошук» (у бічному меню) і саме вікно; ⌘K / Ctrl+K відкриває звідусіль у панелі */
export function AdminSearch({ className, hotkey = false }: { className?: string; /** слухати ⌘K (лише один екземпляр) */ hotkey?: boolean }) {
  const [open, setOpen] = useState(false)
  // перейшли на інший розділ чи запис (зі сторінки, а не з пошуку) — вікно пошуку закривається
  const param = useStore((st) => st.param)
  useEffect(() => { setOpen(false) }, [param])
  useEffect(() => {
    if (!hotkey) return
    const h = (e: globalThis.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((o) => !o) } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [hotkey])
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn('flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-panel2/50 px-2.5 text-[13px] text-muted transition-colors hover:border-spice/40 hover:text-ink', className)}>
        <SearchIcon size={15} className="shrink-0" />
        <span className="flex-1 truncate text-left">{t('Пошук у панелі')}</span>
        <kbd className="hidden rounded border border-line px-1 font-mono text-[11px] lg:inline">{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <Modal open={open} onOpenChange={setOpen} title={t('Пошук у панелі')} description={t('Розділи, люди, гільдії, бази, білди — усе, що тобі видно.')}>
        <SearchBody onDone={() => setOpen(false)} />
      </Modal>
    </>
  )
}

function SearchBody({ onDone }: { onDone: () => void }) {
  const meta = useAdmin((s) => s.meta)
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<{ res: string; id: string; title: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [cur, setCur] = useState(0)
  const seq = useRef(0)
  const list = useRef<HTMLUListElement>(null)
  const input = useRef<HTMLElement>(null)
  // курсор — одразу в поле (вікно спершу ставить фокус на себе)
  useEffect(() => { const h = setTimeout(() => input.current?.focus(), 60); return () => clearTimeout(h) }, [])

  useEffect(() => {
    const s = q.trim()
    if (s.length < 2) { setRows([]); setBusy(false); return }
    const n = ++seq.current
    setBusy(true)
    const h = setTimeout(() => {
      adminApi.search(s).then((r) => { if (n === seq.current) setRows(r.rows) }).catch(() => { if (n === seq.current) setRows([]) }).finally(() => { if (n === seq.current) setBusy(false) })
    }, 200)
    return () => clearTimeout(h)
  }, [q])

  const hits = useMemo<Hit[]>(() => {
    const s = q.trim().toLocaleLowerCase()
    if (!s || !meta) return []
    // спершу розділи, чия назва підходить, далі — записи, згруповані розділами в порядку меню
    const sections = meta.resources.filter((r) => t(r.label).toLocaleLowerCase().includes(s)).slice(0, 6)
      .map((r) => ({ key: `s:${r.name}`, parts: [r.name], title: t(r.label), group: t('Розділи') }))
    const label = (res: string) => t(meta.resources.find((r) => r.name === res)?.label ?? res)
    return [...sections, ...rows.map((x) => ({ key: `${x.res}:${x.id}`, parts: [x.res, x.id], title: x.title, group: label(x.res) }))]
  }, [q, rows, meta])
  useEffect(() => setCur(0), [hits])
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest' }) }, [cur])

  const go = (h: Hit) => { onDone(); goAdmin(h.parts) }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(hits.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(0, c - 1)) }
    else if (e.key === 'Enter' && hits[cur]) { e.preventDefault(); go(hits[cur]) }
  }

  return (
    <div className="grid gap-2" onKeyDown={onKey}>
      <SnInput ref={input} type="search" size="lg" modelValue={q} placeholder={t('Ім’я, назва, пошта, адреса…')} accessibilityLabel={t('Пошук у панелі')} onInput={(e: Event) => setQ(valueOf(e))} />
      <div className="min-h-[120px]">
        {busy && !hits.length && <div className="flex justify-center py-6"><DuneLoader size={36} label={t('Завантаження…')} /></div>}
        {!busy && q.trim().length >= 2 && !hits.length && <p className="py-6 text-center text-[13.5px] text-muted">{t('Нічого не знайшлося.')}</p>}
        {q.trim().length < 2 && <p className="py-6 text-center text-[13px] text-muted">{t('Введи хоча б дві літери.')}</p>}
        {hits.length > 0 && (
          <ul ref={list} className="grid max-h-[min(55vh,440px)] gap-0.5 overflow-y-auto" role="listbox" aria-label={t('Знайдене')}>
            {hits.map((h, i) => (
              <li key={h.key} role="option" aria-selected={i === cur}>
                {(i === 0 || hits[i - 1].group !== h.group) && <div className="px-2 pb-0.5 pt-2 text-[11.5px] font-medium text-muted">{h.group}</div>}
                <a
                  data-i={i}
                  href={adminHref(h.parts)}
                  onMouseMove={() => setCur(i)}
                  onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); go(h) }}
                  className={cn('block truncate rounded-md px-2.5 py-1.5 text-[13.5px]', i === cur ? 'bg-spice/10 text-spice' : 'text-ink')}
                >
                  {h.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

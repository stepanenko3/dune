/**
 * Будівельник бази (/bases/<id>/edit) — як у грі, у 3D: зліва палітра деталей гри й станцій, посередині 3D (примара,
 * клік — поставити, тягни — рядом, ПКМ — прибрати), справа — зріз по висоті (рівні — кнопками), у кутку — план
 * поверху за зрізом, що будується сам. Інструменти: «Будувати» (деталі й станції; без форми — вибір, «Замінити на…»,
 * перетягування й стрілки), «Приміщення» (назви — кліком по підлозі), «Ділянки» (10×10).
 * Стара база (приміщення) відкривається вже перетвореною в деталі — це незбережена правка; що наближено —
 * у примітці до версії (заповнюється сама). Чернетка — у браузері, на сервер — «Зберегти» (конфлікт — вибір).
 * Клавіші: R — поворот, F — дзеркально, Del — прибрати вибране, стрілки — зсунути вибране на клітинку (View),
 * Esc — без форми / зняти вибір, Ctrl+Z / Ctrl+Shift+Z, Ctrl+S — зберегти. Під будівельником — ліміти й кошторис чернетки.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlignHorizontalSpaceAround, ArrowLeft, Hammer, LandPlot, Redo2, Save, Settings2, ShieldAlert, Tag, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { BASEDATA, PLAN2D, STABILITY } from '@/lib/engine'
import { saveBase, useBases, type BaseEnvelope } from '@/lib/bases'
import { useStore } from '@/store'
import { cn, plural } from '@/lib/utils'
import { locale, t, T } from '@/lib/i18n'
import { prefGet, prefSet } from '@/lib/prefs'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { SnInput, SnTextarea, valueOf } from '@/components/sn'
import { Limits } from '../BuildCards'
import { DraftRescue } from './DraftRescue'
import { Confirm } from '../Ask'
import { BaseCalc } from '../BaseCalc'
import { modelCtx } from '../ctx'
import { fmtZ, levelName } from '../tr'
import { dropDraft, readDraft, useBuilder, type Draft, type Tool } from './store'
import { View } from './View'
import { Palette } from './Palette'
import { ItemCard, mirrorPieces, PieceCard, removePieces, turnPieces, ZoneCard } from './Cards'
import { typing } from './bits'
import { FULL_CLASS, FullscreenButton, useFullscreen } from '@/lib/fullscreen'
import { CamModeSwitch } from '../camMode'
import { useUnsaved } from '@/components/UnsavedBar'

/* eslint-disable @typescript-eslint/no-explicit-any */
const undoToast = (what: string, label: string | null) => { if (label) toast(t('{what}: {label}', { what, label }), { id: 'undo', duration: 1800 }) }
const toStars = (s: string) => s.replace(/<\/?(b|strong)>/g, '**')
const fromStars = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')

const TOOLS: { id: Tool; label: string; icon: ReactNode; hint: string }[] = [
  { id: 'build', label: t('Будувати'), icon: <Hammer size={14} />, hint: t('Деталі гри й станції з палітри: клік — поставити, ПКМ — прибрати; без форми — вибір, заміна, перетягування й стрілки') },
  { id: 'zones', label: t('Приміщення'), icon: <Tag size={14} />, hint: t('Клік по підлозі — назвати приміщення (заповниться до стін) чи змінити назву й призначення') },
  { id: 'claims', label: t('Ділянки'), icon: <LandPlot size={14} />, hint: t('Клік по землі — додати чи прибрати ділянку 10×10') },
]

/** зріз по висоті: повзунок (крок — пів блоку) і кнопки рівнів (висоти підлог) */
function Slice({ M }: { M: any }) {
  const cut = useBuilder((s) => s.cut)
  const ed = useBuilder.getState
  const floors = M.levels.filter((l: any) => l.key !== 'r')
  const top = Math.ceil(M.levels[M.levels.length - 1].z0 + 1)
  const v = Math.min(cut, top)
  return (
    <div className="flex w-[64px] shrink-0 flex-col items-center gap-1.5 border-l border-line bg-panel px-1 py-2 text-[11px]" aria-label={t('Зріз по висоті')}>
      <button type="button" aria-pressed={cut >= 98} onClick={() => ed().set({ cut: 99 })} className={cn('w-full rounded border px-1 py-0.5', cut >= 98 ? 'border-spice bg-spice/20 text-ink' : 'border-line text-muted hover:text-ink')} title={t('Уся база, з дахами')}>{t('усе')}</button>
      <span className="font-mono text-[12px] font-semibold text-ink" title={t('Сховано все, що вище')}>{cut >= 98 ? '—' : fmtZ(v)}</span>
      <input
        type="range"
        min={0.5}
        max={top}
        step={0.5}
        value={cut >= 98 ? top : v}
        onChange={(e) => ed().set({ cut: Number(e.target.value) >= top ? 99 : Number(e.target.value) })}
        aria-label={t('Зріз по висоті, блоків')}
        className="min-h-0 flex-1 accent-[rgb(var(--c-spice))]"
        style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
      />
      <div className="grid w-full gap-0.5" role="group" aria-label={t('Рівні')}>
        {[...floors].reverse().map((l: any) => {
          // рівень: видно його підлогу й стіни — до наступної підлоги
          const at = Math.round((l.z1 - 0.05) * 100) / 100
          const on = cut < 98 && Math.abs(cut - at) < 0.01
          return (
            <button key={l.key} type="button" aria-pressed={on} onClick={() => ed().set({ cut: at })} title={t('{name}: видно до +{z}', { name: levelName(M.ui?.levelNames?.[l.key] ?? l.name), z: fmtZ(l.z1).replace('+', '') })} className={cn('rounded px-1 py-0.5 font-mono', on ? 'bg-spice/25 text-ink' : 'text-muted hover:text-ink')}>
              {fmtZ(l.z0)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** план поверху за зрізом — маленьким вікном у кутку (той самий, що на сторінці бази) */
function MiniPlan({ M }: { M: any }) {
  const cut = useBuilder((s) => s.cut)
  const [size, setSize] = useState<'off' | 'small' | 'big'>(() => prefGet('base-build:plan', 'small'))
  const pick = (v: typeof size) => { setSize(v); prefSet('base-build:plan', v) }
  const level = cut >= 98 ? 'r' : ([...M.levels].reverse().find((l: any) => l.key !== 'r' && l.z0 < cut - 1e-6)?.key ?? M.levels[0].key)
  const svg = useMemo(() => (size === 'off' ? '' : PLAN2D.make(M).render({ level, items: true, labels: size === 'big', coords: false, highlight: null })), [M, level, size])
  if (size === 'off') return <button type="button" onClick={() => pick('small')} className="absolute bottom-2 right-2 z-10 rounded-md border border-line bg-panel/95 px-2 py-1 text-[11.5px] text-muted shadow hover:text-ink">{t('План поверху')}</button>
  return (
    <div className={cn('absolute bottom-2 right-2 z-10 flex max-h-[min(70%,640px)] flex-col overflow-hidden rounded-lg border border-line bg-panel/95 shadow-lg', size === 'big' ? 'w-[min(560px,70%)]' : 'w-[200px] max-h-[45%]')}>
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-0.5 text-[11px] text-muted">
        <span className="min-w-0 flex-1 truncate">{t('План: {level}', { level: levelName(M.ui?.levelNames?.[level] ?? level) })}</span>
        <button type="button" onClick={() => pick(size === 'big' ? 'small' : 'big')} className="hover:text-ink">{size === 'big' ? t('менше') : t('більше')}</button>
        <button type="button" onClick={() => pick('off')} className="hover:text-ink" aria-label={t('Сховати план')}><X size={11} /></button>
      </div>
      <div className="pointer-events-none min-h-0 overflow-hidden [&_svg]:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  )
}

function Settings({ onClose }: { onClose: () => void }) {
  const doc = useBuilder((s) => s.doc)
  const ed = useBuilder.getState
  const ui = doc.ui || {}
  /** правка йде в документ, коли поле віддали (Enter чи клік повз), якщо текст змінився */
  const change = (value: string, set: (d: any, v: string) => void) => (e: Event) => {
    const v = valueOf(e) ?? ''
    if (v !== value) ed().apply((d) => set(d, v), t('параметри бази'))
  }
  const field = (label: string, value: string, set: (d: any, v: string) => void, area = false) => (
    <label key={label} className="grid gap-1 text-[12px] text-muted">
      {label}
      {area
        ? <SnTextarea rows={3} modelValue={value} accessibilityLabel={label} onChange={change(value, set)} />
        : <SnInput size="sm" modelValue={value} accessibilityLabel={label} onChange={change(value, set)} />}
    </label>
  )
  return (
    <div className="absolute right-2 top-12 z-30 grid max-h-[calc(100%-56px)] w-[min(380px,calc(100%-16px))] gap-2.5 overflow-y-auto overscroll-contain rounded-xl border border-line bg-panel p-3.5 shadow-2xl">
      <div className="flex items-center">
        <b className="flex-1 font-display text-[14px]">{t('Параметри бази')}</b>
        <button type="button" onClick={onClose} aria-label={t('Закрити')} className="grid h-7 w-7 place-items-center rounded text-muted hover:text-ink"><X size={15} /></button>
      </div>
      {field(t('Назва'), ui.name ?? '', (d, v) => { d.ui.name = v.trim() || d.ui.name })}
      {field(t('Опис під назвою'), ui.lead ?? '', (d, v) => { d.ui.lead = v.trim() }, true)}
      {field(t('Ключові цифри — кожна з нового рядка; **жирне** — у подвійних зірочках'), (ui.facts || []).map(toStars).join('\n'), (d, v) => { d.ui.facts = v.split('\n').map((x: string) => fromStars(x.trim())).filter(Boolean) }, true)}
      <div className="grid gap-1">
        <b className="text-[12.5px]">{t("Рівні — висоти підлог (з'являються самі)")}</b>
        {(doc.levels || []).map((l: any) => (
          <div key={l.key} className="grid grid-cols-[44px_1fr_1fr] items-center gap-1">
            <span className="font-mono text-[12px] text-muted">{l.key === 'r' ? t('дах') : fmtZ(l.z0)}</span>
            <SnInput
              size="sm"
              className="min-w-0"
              key={l.key + l.name}
              modelValue={l.name}
              accessibilityLabel={t('Назва рівня')}
              onChange={(e: Event) => { const v = (valueOf(e) ?? '').trim(); if (v && v !== l.name) ed().apply((d) => { const x = d.levels.find((y: any) => y.key === l.key); if (x) x.name = v }, t('назва рівня')) }}
            />
            <SnInput
              size="sm"
              className="min-w-0"
              key={l.key + (l.sub ?? '')}
              modelValue={l.sub ?? ''}
              placeholder={t('що тут')}
              accessibilityLabel={t('Що на цьому рівні')}
              onChange={(e: Event) => { const v = (valueOf(e) ?? '').trim(); if (v !== (l.sub ?? '')) ed().apply((d) => { const x = d.levels.find((y: any) => y.key === l.key); if (x) x.sub = v }, t('підпис рівня')) }}
            />
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-muted">{t('Ділянок: {claims} · деталей: {pieces} · приміщень: {zones} · станцій: {items}.', { claims: doc.claims.length, pieces: (doc.pieces || []).length, zones: (doc.zones || []).length, items: (doc.items || []).length })}</p>
    </div>
  )
}

/** onExit — куди «назад» (панель керування повертає свій перегляд бази); без нього — сторінка бази на сайті */
export function Builder({ env, onExit }: { env: BaseEnvelope; onExit?: () => void }) {
  // чернетка з цього ж браузера: тієї самої версії — продовжуємо одразу; від старішої — питаємо
  const [stale, setStale] = useState<Draft | null>(() => {
    const d = readDraft(env.id)
    const fresh = !!d && d.version === env.version
    useBuilder.getState().init(env, fresh ? d : null)
    return d && !fresh ? d : null
  })
  const s = useBuilder()
  // на весь екран: Esc лишається будівельнику (зняти вибір чи форму), вийти — кнопкою
  const sectionRef = useRef<HTMLElement>(null)
  const full = useFullscreen(sectionRef, { keepEsc: true })
  const M = useMemo(() => BASEDATA.hydrate(s.doc), [s.doc])
  const [settings, setSettings] = useState(false)
  const [saving, setSaving] = useState<null | 'form' | 'busy'>(null)
  const [note, setNote] = useState('')
  const [conflict, setConflict] = useState<BaseEnvelope | null>(null)
  /** зберегти в цю базу вже не можна (доступ забрали, базу стерли) — причина; правки рятує DraftRescue */
  const [lost, setLost] = useState<string | null>(null)
  const noteRef = useRef<(HTMLElement & { focus: () => void }) | null>(null)
  /** примітка, яку підставили самі (перетворення), — українською, щоб зберегти службову, а не переклад */
  const autoNote = useRef<{ shown: string; uk: string } | null>(null)
  const [ask, setAsk] = useState<null | 'reset' | 'theirs'>(null)
  // що зараз на сервері (живі оновлення сторінки бази): хтось зберіг новішу версію чи базу видалили — кажемо одразу,
  // а не лише при збереженні
  const live = useBases((st) => { const d = st.docs[env.id]; return d && typeof d === 'object' ? d : null })
  // підсумки (ліміти, кошторис) — з чернетки, трохи згодом після правок
  const [sumDoc, setSumDoc] = useState(s.doc)
  useEffect(() => { const h = setTimeout(() => setSumDoc(s.doc), 600); return () => clearTimeout(h) }, [s.doc])
  const C = useMemo(() => modelCtx(env.id, -1, sumDoc), [env.id, sumDoc])
  // стабільність — з тієї ж відкладеної копії (на всю базу ~0,2 с, тож не на кожен рух)
  const stab = useMemo(() => STABILITY.compute(sumDoc.pieces || []), [sumDoc])
  const unstable = useMemo(() => [...stab.values()].filter((v) => v <= 0).length, [stab])
  const [showStab, setShowStab] = useState(() => prefGet('base:stab', false))
  const toggleStab = () => setShowStab((v) => { prefSet('base:stab', !v); return !v })

  const openSave = () => {
    // перше збереження перетвореної бази — примітка з того, що наближено
    if (!note && s.convertNotes.length) {
      const notes = s.convertNotes.join('; ')
      autoNote.current = { shown: t('Перетворено в деталі гри. {notes}', { notes }).slice(0, 300), uk: `Перетворено в деталі гри. ${notes}`.slice(0, 300) }
      setNote(autoNote.current.shown)
    }
    setSaving('form')
    setTimeout(() => noteRef.current?.focus(), 0)
  }
  const save = async (force?: BaseEnvelope) => {
    setSaving('busy')
    const st = useBuilder.getState()
    const text = autoNote.current && note.trim() === autoNote.current.shown.trim() ? autoNote.current.uk : note.trim()
    const r = await saveBase(st.id, st.doc, force ? force.version : st.version, text)
    if (r.ok) {
      st.saved(r.base)
      setConflict(null)
      setNote('')
      autoNote.current = null
      setSaving(null)
      toast.success(t('Збережено: версія {n}', { n: r.base.version }))
    } else if (r.conflict) {
      setConflict(r.base)
      setSaving(null)
    } else if (r.status === 403 || r.status === 404 || r.status === 409) {
      setSaving(null)
      setLost(r.error)
    } else {
      setSaving('form')
      toast.error(r.error)
    }
  }
  // скинути зміни: чернетку — геть, відкрити те, що зараз збережено на сервері (свіже, не з кешу сторінки)
  const reset = async () => {
    await useBases.getState().loadBase(env.id, true)
    const got = useBases.getState().docs[env.id]
    const base = got && typeof got === 'object' ? got : env
    dropDraft(env.id)
    useBuilder.getState().init(base)
    setStale(null)
    setConflict(null)
    setSaving(null)
    setNote('')
    toast.success(t('Відкрито збережену версію {n}', { n: base.version }))
  }
  /** чужа версія замість чернетки */
  const openTheirs = (b: BaseEnvelope) => { dropDraft(env.id); useBuilder.getState().init(b); setConflict(null); setSaving(null); setStale(null) }
  const exit = () => (onExit ? onExit() : useStore.getState().setView('bases', { base: env.id }))
  const undo = () => undoToast(t('Скасовано'), s.undo())
  const redo = () => undoToast(t('Повторено'), s.redo())

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // поле вводу (і звичайне, і компонент sn-*, у якого справжній <input> у тіньовому DOM) — клавіші його
      if (typing(e)) return
      const st = useBuilder.getState()
      const mod = e.metaKey || e.ctrlKey
      // латинська літера — як є (AZERTY, Dvorak…); кирилиця чи інше письмо — за фізичною клавішею: R, F, Z, Y, S на ній
      const code = e.code || ''
      const key = (/^[a-z]$/i.test(e.key) || !code.startsWith('Key') ? e.key : code.slice(3)).toLowerCase()
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) undoToast(t('Повторено'), st.redo()); else undoToast(t('Скасовано'), st.undo()); return }
      if (mod && key === 'y') { e.preventDefault(); undoToast(t('Повторено'), st.redo()); return }
      if (mod && key === 's') { e.preventDefault(); openSaveRef.current(); return }
      if (mod || e.altKey) return
      const sel = st.sel
      const k = key
      if (e.key === 'Escape') { if (st.piece || st.preset != null) st.set({ piece: null, preset: null }); else st.set({ sel: null }); setSettings(false); return }
      if (k === 'r') {
        e.preventDefault()
        if (st.preset != null) return st.set({ itemAng: (st.itemAng + (e.shiftKey ? -15 : 15) + 360) % 360 })
        if (st.piece) return st.set({ turn: st.turn + 1 })
        if (sel?.kind === 'pieces') return turnPieces(sel.ids)
        if (sel?.kind === 'item') return st.apply((d) => { const it = d.items?.[sel.i]; if (it) it.ang = (((it.ang || 0) + 15) % 360 + 360) % 360 }, t('поворот'))
        return
      }
      if (k === 'f') {
        if (st.piece) { const m = (window as any).PIECES?.MIRROR?.[st.piece]; if (m) st.set({ piece: m }); return }
        if (sel?.kind === 'pieces') return mirrorPieces(sel.ids)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel?.kind === 'pieces') { e.preventDefault(); return removePieces(sel.ids) }
        if (sel?.kind === 'item') { e.preventDefault(); st.apply((d) => { d.items = d.items.filter((_: any, i: number) => i !== sel.i) }, t('станцію прибрано')); return st.set({ sel: null }) }
        if (sel?.kind === 'zone') { e.preventDefault(); st.apply((d) => { d.zones = (d.zones || []).filter((x: any) => x.id !== sel.id) }, t('приміщення прибрано')); return st.set({ sel: null }) }
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  // незбережені правки — смуга внизу: «Зберегти» (нова версія з приміткою), «Скасувати» (до збереженої, з питанням);
  // поки вони є, піти зі сторінки не можна (чернетка в браузері лишається, але спершу — вирішити)
  useUnsaved(s.changes > 0, {
    save: () => openSaveRef.current(),
    discard: () => setAsk('reset'),
    label: t('Незбережених правок: {n}', { n: s.changes }),
  })
  const openSaveRef = useRef(openSave)
  openSaveRef.current = openSave

  const sel = s.sel
  const card = sel?.kind === 'pieces' ? <PieceCard M={M} ids={sel.ids} stab={stab} /> : sel?.kind === 'zone' ? <ZoneCard M={M} id={sel.id} /> : sel?.kind === 'item' ? <ItemCard M={M} i={sel.i} /> : null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid max-w-[1800px] gap-2.5">
        <p className="rounded-lg border border-line bg-panel px-3 py-2 text-[13px] text-muted md:hidden">{t("Будувати — з комп'ютера: на телефоні деталі задрібні для пальця. Подивитися базу можна на її сторінці.")}</p>
        {lost && <DraftRescue id={env.id} doc={s.doc} reason={t('Зберегти в цю базу вже не можна: {why}', { why: lost })} />}
        {s.draftLost && !lost && <DraftRescue id={env.id} doc={s.doc} canSave={false} reason={t('Чернетка не вміщається в пам’ять браузера — збережи базу, щоб не втратити правки, або вивантаж чернетку файлом.')} />}
        {stale && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-spice/50 bg-spice/10 px-3.5 py-2.5 text-[13px]">
            <span className="min-w-0 flex-1">{t('У цьому браузері є незбережена чернетка від версії {version} ({count}, {date}), а база вже версії {current}.', { version: stale.version, count: plural(stale.changes, [t('правка'), t('правки'), t('правок')]), date: new Date(stale.at).toLocaleString(locale()), current: env.version })}</span>
            <Button size="sm" variant="secondary" onClick={() => { useBuilder.getState().init({ ...env, version: stale.version }, stale); setStale(null) }}>{t('Відкрити чернетку')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { dropDraft(env.id); setStale(null) }}>{t('Видалити чернетку')}</Button>
          </div>
        )}
        {conflict && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-bad/50 bg-bad/10 px-3.5 py-2.5 text-[13px]">
            <span className="min-w-0 flex-1">{conflict.note ? t('Поки ти будував, хтось зберіг версію {n} («{note}»). Твоя чернетка ціла.', { n: conflict.version, note: conflict.note }) : t('Поки ти будував, хтось зберіг версію {n}. Твоя чернетка ціла.', { n: conflict.version })}</span>
            <Button size="sm" onClick={() => save(conflict)}>{t('Зберегти мою поверх')}</Button>
            <Button size="sm" variant="secondary" onClick={() => setAsk('theirs')}>{t('Відкрити їхню версію')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>{t('Закрити')}</Button>
          </div>
        )}
        {live && !conflict && !lost && (live.deleted
          ? <div className="rounded-xl border border-bad/50 bg-bad/10 px-3.5 py-2.5 text-[13px]">{t('Цю базу щойно видалили — зберегти не вийде, поки її не повернуть. Чернетка ціла.')}</div>
          : live.version > s.version && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-spice/50 bg-spice/10 px-3.5 py-2.5 text-[13px]">
              <span className="min-w-0 flex-1">{t('Хтось щойно зберіг версію {n} — твоя чернетка від версії {mine}. «Зберегти» спершу спитає, чию лишити.', { n: live.version, mine: s.version })}</span>
              <Button size="sm" variant="secondary" onClick={() => (s.changes ? setAsk('theirs') : openTheirs(live))}>{t('Відкрити їхню версію')}</Button>
            </div>
          ))}
        {s.convertNotes.length > 0 && s.changes > 0 && (
          <details className="rounded-xl border border-spice/40 bg-spice/5 px-3.5 py-2 text-[12.5px]">
            <summary className="cursor-pointer"><T text="{title} — це ще не збережено. Що наближено ({n})" title={<b>{t('Базу перетворено в деталі гри')}</b>} n={s.convertNotes.length} /></summary>
            <ul className="mt-1.5 list-disc pl-5 text-muted">{s.convertNotes.map((n) => <li key={n}>{n}</li>)}</ul>
          </details>
        )}

        <section ref={sectionRef} className={cn('relative overflow-hidden rounded-xl border border-line bg-panel shadow-sm', full.on && FULL_CLASS)} aria-label={t('Будівельник бази')}>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2 py-2">
            <Button variant="ghost" size="sm" onClick={exit} title={t('До сторінки бази (чернетка лишиться)')} aria-label={t('До сторінки бази')}><ArrowLeft size={14} /></Button>
            <button type="button" onClick={() => setSettings((v) => !v)} className="min-w-0 max-w-[13rem] truncate font-display text-[14px] font-semibold hover:text-spice" title={t('Параметри бази')}>{s.doc.ui?.name}</button>
            <span className="mx-1 h-5 w-px bg-line" />
            <span className="inline-flex rounded-md border border-line p-0.5" role="toolbar" aria-label={t('Інструменти')}>
              {TOOLS.map((tl) => (
                <button key={tl.id} type="button" title={tl.hint} aria-pressed={s.tool === tl.id} onClick={() => s.set({ tool: tl.id, sel: null })} className={cn('inline-flex items-center gap-1 rounded px-2 py-1 text-[12.5px]', s.tool === tl.id ? 'bg-spice font-semibold text-on-spice' : 'text-muted hover:text-ink')}>
                  {tl.icon} {tl.label}
                </button>
              ))}
            </span>
            <span className="flex-1" />
            <CamModeSwitch size="sm" compact />
            <Button variant="ghost" size="icon" onClick={undo} disabled={!s.past.length} title={s.pastL.length ? t('Скасувати: {label} (Ctrl+Z)', { label: s.pastL[s.pastL.length - 1] }) : t('Скасувати (Ctrl+Z)')} aria-label={t('Скасувати правку')}><Undo2 size={15} /></Button>
            <Button variant="ghost" size="icon" onClick={redo} disabled={!s.future.length} title={s.futureL.length ? t('Повторити: {label} (Ctrl+Shift+Z)', { label: s.futureL[0] }) : t('Повторити (Ctrl+Shift+Z)')} aria-label={t('Повторити правку')}><Redo2 size={15} /></Button>
            {/* перемикачі — справжні: увімкнений видно рамкою й кольором (components/ui/toggle) */}
            <Toggle pressed={s.align} onPressedChange={(v) => s.set({ align: v })} aria-label={t('Вирівнювання')} title={t('Вирівнювання станцій: у лінію з сусідніми, 0,1 від стіни чи поручня, рівний крок — напрямні видно на підлозі. Alt — поставити вільно')}>
              <AlignHorizontalSpaceAround size={14} /> <span className="hidden 2xl:inline">{t('Вирівнювання')}</span>
            </Toggle>
            <Toggle pressed={showStab} onPressedChange={() => toggleStab()} aria-label={t('Стабільність')} title={t('Стабільність, як у грі: фундамент — 100 %, убік від опори — мінус 10 % за деталь; нестабільні — червоні')} className={cn(unstable > 0 && 'text-bad')}>
              <ShieldAlert size={14} /> {unstable > 0 ? t('Нестабільних: {n}', { n: unstable }) : <span className="hidden 2xl:inline">{t('Стабільність')}</span>}
            </Toggle>
            <Button variant="ghost" size="icon" onClick={() => setSettings((v) => !v)} title={t('Параметри бази: назва, опис, рівні')} aria-label={t('Параметри бази')}><Settings2 size={15} /></Button>
            <span className={cn('whitespace-nowrap font-mono text-[11.5px]', s.changes ? 'text-spice' : 'text-muted')}>
              {s.changes ? `● ${plural(s.changes, [t('незбережена'), t('незбережені'), t('незбережених')])}` : t('v{n} · збережено', { n: s.version })}
            </span>
            {/* «Зберегти» й «Скасувати» — у смузі незбережених змін унизу (як на всьому сайті); конфлікт — кнопкою тут */}
            {conflict && !s.changes && <Button size="sm" onClick={openSave} title={t('Зберегти нову версію для всіх (Ctrl+S)')}><Save size={14} /> {t('Зберегти')}</Button>}
            <FullscreenButton {...full} />
          </div>

          {saving && (
            <form onSubmit={(e) => { e.preventDefault(); save() }} className="absolute right-2 top-12 z-40 grid w-[min(380px,calc(100%-16px))] gap-2 rounded-xl border border-line bg-panel p-3 shadow-2xl">
              <b className="font-display text-[14px]">{t('Зберегти версію {n}', { n: s.version + 1 })}</b>
              <SnInput ref={noteRef} size="sm" modelValue={note} maxLength={300} placeholder={t("Що змінилось (необов'язково)")} accessibilityLabel={t('Примітка до версії')}
                onInput={(e: Event) => setNote(valueOf(e) ?? '')}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' && saving !== 'busy') { e.preventDefault(); void save() } }} />
              <p className="text-[11.5px] text-muted">{t('Нова версія буде видна всім; попередню завжди можна відновити з історії на сторінці бази.')}</p>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={saving === 'busy'}>{saving === 'busy' ? t('Зберігаю…') : t('Зберегти')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setSaving(null)}>{t('Скасувати')}</Button>
              </div>
            </form>
          )}
          {settings && <Settings onClose={() => setSettings(false)} />}

          <div className={cn('flex', full.on ? 'min-h-0 flex-1' : 'h-[min(82dvh,940px)] min-h-[520px]')}>
            {s.tool === 'build' ? <Palette /> : (
              <aside className="flex w-[236px] shrink-0 flex-col gap-2 border-r border-line bg-panel p-2.5 text-[12.5px] text-muted">
                {s.tool === 'zones' && <>
                  <b className="text-ink">{t('Приміщення')}</b>
                  <p>{t('Клік по підлозі без назви — нове приміщення: заповниться до стін (і проходів). Клік по названому — картка: назва, призначення.')}</p>
                  <ul className="grid gap-0.5 overflow-y-auto">
                    {M.rooms.map((r: any) => (
                      <li key={r.id}><button type="button" onClick={() => s.set({ sel: { kind: 'zone', id: r.id } })} className={cn('w-full truncate rounded px-1.5 py-0.5 text-left hover:bg-panel2', sel?.kind === 'zone' && sel.id === r.id ? 'bg-spice/15 text-ink' : 'text-ink/90')}>{r.name} <span className="font-mono text-[10.5px] text-muted">{fmtZ(r.z0)}</span></button></li>
                    ))}
                  </ul>
                </>}
                {s.tool === 'claims' && <>
                  <b className="text-ink">{t('Ділянки')}</b>
                  <p>{t('Клік по землі — додати ділянку 10×10 поруч чи прибрати наявну. Межі плану й камери 3D — за ділянками.')}</p>
                </>}
              </aside>
            )}
            <div className="relative min-w-0 flex-1">
              <View M={M} stab={stab} showStab={showStab} />
              {card && <div className="absolute right-2 top-2 z-20 max-h-[calc(100%-16px)] overflow-y-auto overscroll-contain" onPointerDown={(e) => e.stopPropagation()}>{card}</div>}
              <MiniPlan M={M} />
            </div>
            <Slice M={M} />
          </div>
        </section>

        {ask === 'reset' && (
          <Confirm danger title={t('Скинути зміни?')} text={t('Скинути {what} і відкрити збережену версію? Скасувати це не можна.', { what: plural(s.changes, [t('незбережену правку'), t('незбережені правки'), t('незбережених правок')]) })} confirm={t('Скинути зміни')}
            onClose={() => setAsk(null)} onConfirm={() => void reset()} />
        )}
        {ask === 'theirs' && (
          <Confirm danger title={t('Відкрити їхню версію?')} text={t('Твої незбережені зміни пропадуть.')} confirm={t('Відкрити їхню версію')}
            onClose={() => setAsk(null)} onConfirm={() => { const b = conflict ?? live; if (b) openTheirs(b) }} />
        )}
        <Limits C={C} />
        <details className="group">
          <summary className="cursor-pointer rounded-xl border border-line bg-panel px-4 py-2.5 text-[13.5px] font-semibold hover:border-spice/60">{t('Кошторис і виробництво чернетки')}</summary>
          <div className="mt-2.5"><BaseCalc C={C} /></div>
        </details>
      </div>
    </div>
  )
}

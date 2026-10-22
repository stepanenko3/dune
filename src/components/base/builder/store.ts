/**
 * Стан будівельника бази: чернетка документа з деталей (з «скасувати»/«повторити» й підписом кожної правки),
 * інструмент, вибране в палітрі (форма деталі чи станція) і поворот примари, зріз, вибране. Кілька правок поспіль з
 * тим самим ключем (стрілки — зсув вибраного) — один крок «скасувати». Стара база (приміщення) при відкритті
 * перетворюється в деталі — це вже незбережена зміна, а що наближено — у convertNotes (для примітки до версії).
 * Чернетка — у браузері (base-draft:<id>), на сервер — кнопкою «Зберегти».
 */
import { create } from 'zustand'
import { claimsLabel, type BaseDoc, type BaseEnvelope } from '@/lib/bases'
import { t } from '@/lib/i18n'
import { BASEDATA, CONVERT } from '@/lib/engine'
import { prefGet, prefSet } from '@/lib/prefs'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Tool = 'build' | 'zones' | 'claims'
export type Sel = { kind: 'pieces'; ids: string[] } | { kind: 'zone'; id: string } | { kind: 'item'; i: number } | null

const KEEP = 80
const draftKey = (id: string) => `base-draft:${id}`
export interface Draft { version: number; doc: BaseDoc; at: number; changes: number }

interface BS {
  id: string
  version: number
  doc: BaseDoc
  past: BaseDoc[]
  future: BaseDoc[]
  pastL: string[]
  futureL: string[]
  changes: number
  /** що перетворювач наблизив (стара база → деталі) — для примітки до версії */
  convertNotes: string[]
  /** чернетка не вміщається в пам'ять браузера — правки живуть лише у вкладці (редактор попереджає) */
  draftLost?: boolean
  tool: Tool
  /** форма в палітрі (null — вибір деталей) */
  piece: string | null
  /** станція в палітрі (індекс у PRESETS; null — не станція): ставиться, як деталь */
  preset: number | null
  /** скільки разів натиснуто R (поворот примари) */
  turn: number
  /** зріз: усе вище — сховано (99 — уся база) */
  cut: number
  sel: Sel
  /** поворот станції-примари */
  itemAng: number
  /** вирівнювання станцій (напрямні): у лінію з сусідами, від краю, рівний крок; Alt — тимчасово вільно */
  align: boolean
  init: (env: BaseEnvelope, draft?: Draft | null) => void
  /** правка з підписом; merge — ключ: та сама правка відразу після попередньої (стрілки) — той самий крок «скасувати» */
  apply: (fn: (d: BaseDoc) => void, label?: string, merge?: string) => void
  undo: () => string | null
  redo: () => string | null
  set: (p: Partial<Pick<BS, 'tool' | 'piece' | 'turn' | 'cut' | 'sel' | 'preset' | 'itemAng' | 'align'>>) => void
  saved: (env: BaseEnvelope) => void
}

const clone = (d: BaseDoc): BaseDoc => structuredClone(d)
/** ключ і час останньої правки, що зливається з наступною (apply з merge) */
let last: { key: string; at: number } | null = null
const MERGE_MS = 1500

export const useBuilder = create<BS>((set, get) => ({
  id: '',
  version: 0,
  doc: { format: 2, pieces: [], items: [], zones: [], claims: [], ui: {}, levels: [], heights: {} },
  past: [],
  future: [],
  pastL: [],
  futureL: [],
  changes: 0,
  convertNotes: [],
  tool: 'build',
  piece: null,
  turn: 0,
  cut: 99,
  sel: null,
  preset: null,
  itemAng: 0,
  align: prefGet('base:align', true),
  init(env, draft) {
    let doc = clone(draft ? draft.doc : env.doc)
    let notes: string[] = []
    let changes = draft ? draft.changes : 0
    // стара модель — у деталі: це правка, яку треба зберегти
    if (doc.format !== 2) {
      const r = CONVERT.toPieces(doc)
      doc = r.doc2
      notes = r.notes
      changes = Math.max(changes, 1)
    }
    BASEDATA.syncDoc(doc)
    last = null
    set({
      id: env.id,
      version: draft ? draft.version : env.version,
      doc,
      past: [],
      future: [],
      pastL: [],
      futureL: [],
      changes,
      convertNotes: notes,
      sel: null,
      piece: (doc.pieces || []).length ? null : 'foundation', // порожня база — одразу фундамент
      preset: null,
      turn: 0,
      tool: 'build',
      cut: prefGet(`base:${env.id}:cut`, 99),
    })
  },
  apply(fn, label = t('правка'), merge) {
    const { doc, past, pastL } = get()
    const next = clone(doc)
    fn(next)
    BASEDATA.syncDoc(next) // рівні (висоти підлог), підписи й зрізи — за новими деталями
    const now = Date.now()
    if (merge && last?.key === merge && now - last.at < MERGE_MS && past.length) {
      last.at = now
      set({ doc: next, future: [], futureL: [] })
      return
    }
    last = merge ? { key: merge, at: now } : null
    set({ doc: next, past: [...past.slice(-(KEEP - 1)), doc], pastL: [...pastL.slice(-(KEEP - 1)), label], future: [], futureL: [], changes: get().changes + 1 })
  },
  undo() {
    last = null
    const { past, pastL, doc, future, futureL, changes } = get()
    if (!past.length) return null
    const label = pastL[pastL.length - 1] ?? t('правка')
    set({ doc: past[past.length - 1], past: past.slice(0, -1), pastL: pastL.slice(0, -1), future: [doc, ...future], futureL: [label, ...futureL], changes: Math.max(0, changes - 1), sel: null })
    return label
  },
  redo() {
    last = null
    const { past, pastL, doc, future, futureL, changes } = get()
    if (!future.length) return null
    const label = futureL[0] ?? t('правка')
    set({ doc: future[0], past: [...past, doc], pastL: [...pastL, label], future: future.slice(1), futureL: futureL.slice(1), changes: changes + 1, sel: null })
    return label
  },
  set(p) {
    if (p.cut !== undefined) prefSet(`base:${get().id}:cut`, p.cut)
    if (p.align !== undefined) prefSet('base:align', p.align)
    // у палітрі вибрано щось одне: форма деталі чи станція
    if (p.piece) p = { preset: null, ...p }
    if (p.preset != null) p = { piece: null, ...p }
    // інша форма чи інструмент — поворот з нуля
    if ((p.piece !== undefined && p.piece !== get().piece) || (p.tool && p.tool !== get().tool)) p = { turn: 0, ...p }
    set(p)
  },
  saved(env) {
    last = null // наступна правка після збереження — нова (лічильник незбережених — з нуля)
    const doc = clone(env.doc)
    BASEDATA.syncDoc(doc)
    set({ version: env.version, doc, changes: 0, convertNotes: [] })
    try { localStorage.removeItem(draftKey(env.id)) } catch { /* без сховища */ }
  },
}))

// чернетка — у браузер, щойно щось змінилось (із затримкою)
let timer: ReturnType<typeof setTimeout> | null = null
/** записати чернетку зараз; false — не вмістилась (сховище переповнене чи вимкнене): правки лише в пам'яті вкладки */
function writeDraft(): boolean {
  timer = null
  const { id, version, doc, changes, draftLost } = useBuilder.getState()
  if (!id) return true
  try {
    if (changes > 0) localStorage.setItem(draftKey(id), JSON.stringify({ version, doc, at: Date.now(), changes } satisfies Draft))
    else localStorage.removeItem(draftKey(id))
    if (draftLost) useBuilder.setState({ draftLost: false })
    return true
  } catch {
    if (!draftLost) useBuilder.setState({ draftLost: true })
    return false
  }
}
useBuilder.subscribe((s, prev) => {
  if (!s.id || s.doc === prev.doc) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(writeDraft, 600)
})
// закривають вкладку — чернетку дописуємо одразу (не чекаючи 600 мс); не вмістилась — браузер перепитає
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    const s = useBuilder.getState()
    if (!s.id || s.changes <= 0) return
    if (timer) clearTimeout(timer)
    if (!writeDraft()) { e.preventDefault(); e.returnValue = '' }
  })
}

export function readDraft(id: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id))
    return raw ? (JSON.parse(raw) as Draft) : null
  } catch {
    return null
  }
}
export function dropDraft(id: string) {
  try { localStorage.removeItem(draftKey(id)) } catch { /* без сховища */ }
}
export const newId = (pre = 'p') => pre + Math.random().toString(36).slice(2, 9)

/** змінились ділянки — межі плану, камери 3D (якщо їх не задавали вручну) і підпис кількості */
export function claimsChanged(d: BaseDoc) {
  d.bounds = BASEDATA.boundsOf(d.claims)
  d.ui = d.ui || {}
  if (d.ui.autoViews !== false && (d.ui.autoViews || !d.ui.views)) { d.ui.views = BASEDATA.viewsOf(d.bounds); d.ui.autoViews = true }
  d.ui.claimsText = claimsLabel(d.claims.length)
}

// у розробці — стан будівельника з консолі браузера (перевірки й налагодження)
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV && typeof window !== 'undefined') (window as unknown as { __builder: typeof useBuilder }).__builder = useBuilder

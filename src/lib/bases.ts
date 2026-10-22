/**
 * Бази з сервера: список (коротко), документи з версіями, збереження (409 — хтось устиг раніше), створення й копія,
 * видалення й повернення, історія (з авторами) і перегляд давньої версії, спільні правки калькулятора бази,
 * вивантаження у файл і імпорт із файлу (спершу перевірка — dryRun).
 * Зміни з інших вкладок приходять через SSE (спільний src/lib/stream.ts) — лише поки відкрита сторінка, що їх хоче
 * (useBasesLive: список баз, сторінка бази); тоді відкриті бази оновлюються самі, а список перечитується раз на кілька
 * подій поспіль. Документ — дані моделі (див. src/engine/hydrate.js), модель для плану й 3D з нього робить hydrate().
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { t } from './i18n'
import { plural } from './utils'
import { subscribe } from './stream'
import type { Item, Visibility } from './items'
import type { Target } from './calc'

/* eslint-disable @typescript-eslint/no-explicit-any */
export type BaseDoc = Record<string, any>

export interface BaseSummary {
  id: string
  version: number
  created: number
  updated: number
  deleted: number | null
  name: string
  lead: string
  facts: string[]
  rooms: number
  tiles: number
  items: number
  claims: number
  /** адреса знімка 3D поточної версії (малює сервер); null — знімок не вдався (заглушка) */
  thumb?: string | null
  /** власник, видимість, права */
  item: Item
}
/** правки калькулятора бази відносно моделі: кількості, прибрані рядки, додані цілі, знижка DD */
export interface CalcEdits {
  qty: Record<string, number>
  removed: string[]
  extra: Target[]
  /** перемикач знижки Глибокої пустелі; не задано — як у моделі бази (DD — так, Main — ні) */
  dd?: boolean
}
export interface Author { id: string; login: string | null; name: string }
export interface BaseEnvelope {
  id: string
  doc: BaseDoc
  version: number
  updated: number
  note: string
  deleted: number | null
  item?: Item
  /** спільні правки калькулятора бази (null — як у моделі) */
  calc?: CalcEdits | null
}
export interface BaseRevision {
  hid: number
  current?: boolean
  version: number
  updated: number
  note: string
  /** хто зберіг (давні версії — без автора) */
  author?: Author | null
}

/** знімок 3D поточної версії бази (малює сервер); адреса зі списку — з версією й відбитком рушія, кешується назавжди */
export const thumbUrl = (b: Pick<BaseSummary, 'id' | 'version' | 'thumb'>) => b.thumb || `/api/bases/${b.id}/thumb.jpg?v=${b.version}`

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  const body = (await r.json().catch(() => ({}))) as T
  return { ok: r.ok, status: r.status, body }
}

/** документ у кеші: база; missing — нема (чи не видно); error — не завантажилась (мережа, сервер) — можна ще раз */
export type DocState = BaseEnvelope | 'missing' | 'error'
interface S {
  list: BaseSummary[] | null
  listError: boolean
  docs: Record<string, DocState>
  loadList: () => Promise<void>
  loadBase: (id: string, force?: boolean) => Promise<void>
}

export const useBases = create<S>((set, get) => ({
  list: null,
  listError: false,
  docs: {},
  async loadList() {
    // після помилки — знову «завантаження», поки пробуємо ще раз
    if (!get().list && get().listError) set({ listError: false })
    try {
      const r = await call<{ bases: BaseSummary[] }>('/api/bases')
      if (!r.ok) throw new Error()
      set({ list: r.body.bases, listError: false })
    } catch {
      set({ listError: true })
    }
  },
  async loadBase(id, force) {
    const have = get().docs[id]
    if (!force && have && have !== 'error') return
    // повторна спроба після помилки — знову «завантаження»
    if (have === 'error') set((s) => { const docs = { ...s.docs }; delete docs[id]; return { docs } })
    let next: DocState
    try {
      const r = await call<BaseEnvelope>(`/api/bases/${encodeURIComponent(id)}`)
      next = r.ok ? r.body : r.status === 404 || r.status === 403 || r.status === 401 ? 'missing' : 'error'
    } catch {
      next = 'error'
    }
    // обрив під час примусового перечитування — лишаємо те, що вже показано
    if (next === 'error' && force && have && have !== 'error' && have !== 'missing') return
    set((s) => ({ docs: { ...s.docs, [id]: next } }))
  },
}))

// ---------- живі оновлення ----------
/** список перечитуємо раз на кілька подій поспіль (збереження з редактора, кошик, доступ) */
let listTimer: ReturnType<typeof setTimeout> | null = null
function reloadList() {
  if (listTimer || !useBases.getState().list) return
  listTimer = setTimeout(() => { listTimer = null; void useBases.getState().loadList() }, 400)
}
interface BaseEvent { id: string; version?: number; deleted?: number | null; op?: string; calc?: CalcEdits | null }
function onEvent(data: unknown) {
  const ev = data as BaseEvent
  if (!ev || typeof ev.id !== 'string') return
  const s = useBases.getState()
  const have = s.docs[ev.id]
  // правки калькулятора — прямо в документ, без перечитування
  if (ev.op === 'calc') {
    if (have && typeof have === 'object') useBases.setState((st) => ({ docs: { ...st.docs, [ev.id]: { ...have, calc: ev.calc ?? null } } }))
    return
  }
  if (ev.op === 'purge') {
    if (s.list) useBases.setState({ list: s.list.filter((b) => b.id !== ev.id) })
    if (have) useBases.setState((st) => ({ docs: { ...st.docs, [ev.id]: 'missing' } }))
    return
  }
  const row = s.list?.find((b) => b.id === ev.id)
  if (ev.op === 'access' || !row || row.version !== ev.version || (row.deleted ?? null) !== (ev.deleted ?? null)) reloadList()
  // відкритий документ: нова версія, кошик чи доступ (права могли змінитися чи базу більше не видно) — перечитати
  if (have && (ev.op === 'access' || have === 'missing' || have === 'error' || have.version !== ev.version || (have.deleted ?? null) !== (ev.deleted ?? null))) void s.loadBase(ev.id, true)
}
/** зв'язок відновився після обриву — те, що змінилось тим часом, перечитуємо */
function onReopen() {
  const s = useBases.getState()
  if (s.list) void s.loadList()
  for (const [id, d] of Object.entries(s.docs)) if (d && typeof d === 'object') void s.loadBase(id, true)
}
/** живі оновлення баз, поки змонтовано (список баз, сторінка бази); з'єднання одне на всю вкладку */
export function useBasesLive() {
  useEffect(() => subscribe('/api/bases/stream', onEvent, onReopen), [])
}

/** після власного збереження — новий документ одразу в кеш (не чекаючи SSE); правки калькулятора — ті, що були */
const put = (b: BaseEnvelope) => useBases.setState((s) => {
  const was = s.docs[b.id]
  const calc = b.calc !== undefined ? b.calc : was && typeof was === 'object' ? was.calc : undefined
  return { docs: { ...s.docs, [b.id]: { ...b, ...(calc !== undefined ? { calc } : {}) } } }
})

export type SaveResult = { ok: true; base: BaseEnvelope } | { ok: false; conflict: true; base: BaseEnvelope } | { ok: false; conflict?: false; error: string; status?: number }

export async function saveBase(id: string, doc: BaseDoc, version: number, note: string): Promise<SaveResult> {
  let r
  try {
    r = await call<BaseEnvelope & { error?: string; conflict?: boolean }>(`/api/bases/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ doc, version, note }) })
  } catch {
    return { ok: false, error: t('Немає зв’язку з сервером — чернетка ціла, спробуй зберегти ще раз') }
  }
  if (r.status === 409 && r.body.doc) return { ok: false, conflict: true, base: r.body }
  if (r.status === 413) return { ok: false, error: t('База завелика для збереження'), status: r.status }
  if (!r.ok) return { ok: false, error: r.body.error || t('не вдалося зберегти'), status: r.status }
  put(r.body)
  reloadList()
  return { ok: true, base: r.body }
}

export async function createBase(doc: BaseDoc, note: string, owner?: { kind: 'user' | 'guild' | 'site'; id: string }, visibility?: Visibility): Promise<BaseEnvelope> {
  const r = await call<BaseEnvelope & { error?: string }>('/api/bases', { method: 'POST', body: JSON.stringify({ doc, note, owner, visibility }) })
  if (!r.ok) throw new Error(r.body.error || t('не вдалося створити базу'))
  put(r.body)
  await useBases.getState().loadList()
  return r.body
}

/** копія наявної бази під новою назвою: документ бере сервер, у реєстрі — «на основі …» (як копія з бібліотеки) */
export async function copyBase(from: string, name: string, owner?: { kind: 'user' | 'guild' | 'site'; id: string }, visibility?: Visibility): Promise<BaseEnvelope> {
  const r = await call<BaseEnvelope & { error?: string }>('/api/bases', { method: 'POST', body: JSON.stringify({ from, name, owner, visibility }) })
  if (!r.ok) throw new Error(r.body.error || t('не вдалося створити базу'))
  put(r.body)
  await useBases.getState().loadList()
  return r.body
}

export async function removeBase(id: string, back = false) {
  const r = await call<{ error?: string }>(`/api/bases/${encodeURIComponent(id)}${back ? '/undelete' : ''}`, { method: back ? 'POST' : 'DELETE' })
  if (!r.ok) throw new Error(r.body.error || t('не вдалося'))
  await useBases.getState().loadList()
  await useBases.getState().loadBase(id, true)
}

/** стерти назавжди базу з кошика: її версії, рядок реєстру, зірки */
export async function purgeBase(id: string) {
  const r = await call<{ error?: string }>(`/api/bases/${encodeURIComponent(id)}/purge`, { method: 'POST' })
  if (!r.ok) throw new Error(r.body.error || t('не вдалося'))
  await useBases.getState().loadList()
}

/** історія версій (лише тим, хто може змінювати базу); null — не вдалося */
export async function baseHistory(id: string): Promise<BaseRevision[] | null> {
  try {
    const r = await call<{ rows: BaseRevision[] }>(`/api/bases/${encodeURIComponent(id)}/history`)
    return r.ok ? r.body.rows : null
  } catch {
    return null
  }
}
/** давня версія — подивитися, не відновлюючи */
export async function historyDoc(id: string, hid: number): Promise<BaseEnvelope & { author?: Author | null }> {
  const r = await call<BaseEnvelope & { author?: Author | null; error?: string }>(`/api/bases/${encodeURIComponent(id)}/history/${hid}`)
  if (!r.ok) throw new Error(r.body.error || t('не вдалося завантажити версію'))
  return r.body
}
export async function restoreBase(id: string, hid: number): Promise<BaseEnvelope> {
  const r = await call<BaseEnvelope & { error?: string }>(`/api/bases/${encodeURIComponent(id)}/history/${hid}/restore`, { method: 'POST' })
  if (!r.ok) throw new Error(r.body.error || t('не вдалося відновити'))
  put(r.body)
  reloadList()
  return r.body
}

/** спільні правки калькулятора бази (null — скинути до моделі); у кеш — одразу, на сервер — відповідь */
export async function saveCalc(id: string, calc: CalcEdits | null): Promise<void> {
  const have = useBases.getState().docs[id]
  if (have && typeof have === 'object') useBases.setState((s) => ({ docs: { ...s.docs, [id]: { ...have, calc } } }))
  const r = await call<{ error?: string }>(`/api/bases/${encodeURIComponent(id)}/calc`, { method: 'PUT', body: JSON.stringify({ calc }) })
  if (!r.ok) throw new Error(r.body.error || t('не вдалося зберегти'))
}

// ---------- вивантаження й імпорт ----------
/** зауваження перевірки імпорту: де в файлі (path) і що не так (message — уже мовою людини) */
export interface ImportIssue { path: string; key: string; vars: Record<string, unknown> | null; message: string }
export interface ImportSummary {
  name: string
  /** 2 — з деталей гри, 1 — давня, з приміщень */
  format: 1 | 2
  pieces: number
  items: number
  zones: number
  rooms: number
  tiles: number
  levels: number
  claims: number
  bytes: number
  /** звідки файл (вивантаження сайту): назва, версія, коли, сайт */
  source: { name: string; version: number | null; exportedAt: string | null; site: string | null } | null
}
export interface ImportResult { ok: boolean; id?: string; errors: ImportIssue[]; warnings: ImportIssue[]; summary: ImportSummary | null; base?: BaseEnvelope }
/** найбільший документ, який приймає сервер */
export const IMPORT_MAX_BYTES = 8 * 1024 * 1024

/** вивантажити базу у файл (JSON): адреса — для посилань; downloadBase — з повідомленням про помилку */
export const exportUrl = (id: string) => `/api/bases/${encodeURIComponent(id)}/export`
export async function downloadBase(id: string) {
  const r = await fetch(exportUrl(id))
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || t('не вдалося вивантажити базу'))
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || `${id}.json`
  const url = URL.createObjectURL(await r.blob())
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * імпорт: dryRun — лише перевірка (помилки, попередження, підсумок); інакше — нова база (власник і видимість — як у
 * «Нова база»). Помилки у файлі — у результаті (ok: false); інші (немає входу, чужа гільдія) — винятком
 */
export async function importBase(doc: unknown, opts: { owner?: { kind: 'user' | 'guild' | 'site'; id: string }; visibility?: Visibility; name?: string; dryRun?: boolean } = {}): Promise<ImportResult> {
  const r = await call<ImportResult & { error?: string }>('/api/bases/import', { method: 'POST', body: JSON.stringify({ doc, ...opts }) })
  if (r.status === 400 && Array.isArray(r.body.errors) && r.body.errors.length) return { ...r.body, ok: false }
  if (r.status === 413) throw new Error(t('файл завеликий: можна до {max} МБ', { max: IMPORT_MAX_BYTES / 1048576 }))
  if (!r.ok) throw new Error(r.body.error || t('не вдалося імпортувати базу'))
  if (r.body.base) put(r.body.base)
  if (!opts.dryRun) await useBases.getState().loadList()
  return r.body
}

// ---------- нова база ----------
/** «1 ділянка», «3 ділянки» — підпис плану (зберігається в документі) */
export const claimsLabel = (n: number) => plural(n, [t('ділянка'), t('ділянки'), t('ділянок')])

/** порожня база з деталей (format 2) на одній ділянці 10×10: рівні з'являться самі — з висот підлог; камери — від ділянки.
 *  Рушій (з three.js) вантажимо лише тут: список баз і головна без нього легші */
export async function blankBase(name: string): Promise<BaseDoc> {
  const { BASEDATA } = await import('@/lib/engine')
  const claims = [{ x: -5, y: 0, w: 10, d: 10 }]
  const bounds = BASEDATA.boundsOf(claims)
  return BASEDATA.syncDoc({
    schema: 2,
    format: 2,
    claims,
    bounds,
    pieces: [],
    items: [],
    zones: [],
    // назви стандартні, українські: інтерфейс перекладає їх на льоту (components/base/tr.ts → levelName)
    levels: [{ key: 'g', name: 'Рівень 0', sub: 'земля', z0: 0, z1: 1 }, { key: 'r', name: 'Дах', sub: '', z0: 1, z1: 99 }],
    heights: {},
    ui: { name, lead: '', facts: [], store: 'new:', claimsText: claimsLabel(1), captions: {}, views: BASEDATA.viewsOf(bounds), autoViews: true },
  })
}

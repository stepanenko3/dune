/**
 * Роадмапи — документи на сервері (SQLite), у кожного власник і видимість. Тут: типи, відкритий роадмап (за id),
 * правки з автозбереженням (лише якщо можна змінювати), «скасувати» в межах вкладки, історія версій з сервера і живі
 * оновлення через SSE (lib/stream: затримка після обриву, після відновлення — перечитати; leave() закриває потік,
 * коли сторінку роадмапу покинули).
 *
 * Прогрес (статуси етапів, задачі, «зібрано») — не в документі, а окремо на сервері: запис власника, у кожного свій
 * чи спільний на всіх (за правами роадмапу). Позначка — одна на запит, одразу на екрані, при відмові — назад.
 * Права (хто редагує, відмічає, бачить, копіює…) приходять разом із роадмапом; сервер перевіряє те саме.
 *
 * Збереження: правки накопичуються ~0,7 с і летять одним PUT із версією, від якої редагували.
 * Якщо хтось устиг зберегти раніше (409) — показуємо свіжу версію і кажемо про це: тихо затирати
 * чужі зміни не можна.
 */
import { create } from 'zustand'
import { toast } from 'sonner'
import type { Item } from './items'
import { t } from './i18n'
import { subscribe } from './stream'
import { prefGet, prefSet } from './prefs'

export interface RTable {
  head: string[]
  rows: { cells: string[]; sum?: boolean }[]
}
export interface RTask {
  id: string
  text: string
}
export type RStatus = 'todo' | 'doing' | 'done'
export interface RStage {
  id: string
  title: string
  badge: string
  why: string
  table: RTable | null
  tasks: RTask[]
  meta: string
}
export interface RColumn {
  id: string
  title: string
  body: string
  table: RTable | null
}
export interface RSection {
  id: string
  title: string
  body: string
  stats: { value: string; label: string }[]
  columns: RColumn[]
  sources: string
  /** картки можна відмічати «зібрано» (прогрес роадмапу) */
  collect?: boolean
}
export interface RBlock {
  id: string
  title: string
  body: string
}
export interface RoadmapDoc {
  title: string
  lead: string
  facts: string[]
  sidebarTitle: string
  sidebar: RBlock[]
  note: string
  stages: RStage[]
  sections: RSection[]
}
/** рівень «хто» — від цього й вище (server/lib/roadmap-access.mjs) */
export type Level = 'nobody' | 'owner' | 'officer' | 'member' | 'recruit' | 'users' | 'anyone'
export type Mode = 'owner' | 'each' | 'all'
export type RightKey = 'edit' | 'mark' | 'seeProgress' | 'members' | 'copy' | 'history' | 'settings'
export interface Access {
  edit: Level
  progress: Mode
  mark: Level
  seeProgress: Level
  members: Level
  copy: Level
  copyTo: ('user' | 'guild')[]
  history: Level
  settings: Level
}
export interface Rights {
  view: boolean
  edit: boolean
  mark: boolean
  seeProgress: boolean
  members: boolean
  copy: boolean
  copyTo: ('user' | 'guild')[]
  history: boolean
  settings: boolean
  settingsLevel: boolean
  manage: boolean
  own: boolean
}
/** позначки: s — статус етапу, t — задачі, c — картки «зібрано» */
export interface PState {
  s: Record<string, RStatus>
  t: Record<string, true>
  c: Record<string, true>
}
export interface Progress {
  mode: Mode
  /** чий запис показано (null — прогресу не бачиш) */
  scope: string | null
  whose: 'mine' | 'guild' | 'site' | 'all' | 'owner' | 'none'
  state: PState
  /** у «кожен свій» — скільки людей веде прогрес; у спільному — скільки відмічали */
  people: number
  mark: Level
  seeProgress: Level
}
interface Envelope {
  id: string
  doc: RoadmapDoc
  version: number
  updated: number
  item?: Item
  rights?: Rights
  progress?: Progress
  access?: Access
  levels?: Record<RightKey, Level[]>
  modes?: Mode[]
  defaults?: Access
}
export const emptyPState = (): PState => ({ s: {}, t: {}, c: {} })
export interface Revision {
  hid: number
  version: number
  updated: number
  summary: string
}

export const newId = () => Math.random().toString(36).slice(2, 10)

/** стан з однією позначкою (todo / false — зняти) */
export function withMark(st: PState, kind: 's' | 't' | 'c', id: string, value: RStatus | boolean): PState {
  const next: PState = { s: { ...st.s }, t: { ...st.t }, c: { ...st.c } }
  if (kind === 's') { if (value === 'todo' || !value) delete next.s[id]; else next.s[id] = value as RStatus }
  else if (value) next[kind][id] = true
  else delete next[kind][id]
  return next
}
/** статус етапу з прогресу */
export const statusOf = (st: PState | undefined, id: string): RStatus => st?.s[id] ?? 'todo'
export const STATUS_LABEL: Record<RStatus, string> = { todo: t('Заплановано'), doing: t('У роботі'), done: t('Готово') }
export const nextStatus = (s: RStatus): RStatus => (s === 'todo' ? 'doing' : s === 'doing' ? 'done' : 'todo')

/**
 * Прогрес роадмапу з його опису в списках (сервер пише «5 етапів, виконано 3» мовою того, хто дивиться): ті самі
 * шаблони, що й на сервері (server/lib/roadmap.summaryText), лише навпаки. Не розібрався (чужа мова, старий опис) — null
 */
export function progressOf(summary: string): { n: number; done: number } | null {
  if (summary === t('Без етапів')) return { n: 0, done: 0 }
  for (const key of ['{n} етап, виконано {done}', '{n} етапи, виконано {done}', '{n} етапів, виконано {done}']) {
    const tpl = t(key, { n: '\u0001', done: '\u0002' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const order = tpl.indexOf('\u0001') < tpl.indexOf('\u0002') ? ['n', 'done'] : ['done', 'n']
    const m = new RegExp('^' + tpl.replace('\u0001', '([\\d\\s.,\u00a0]+)').replace('\u0002', '([\\d\\s.,\u00a0]+)') + '$').exec(summary)
    if (!m) continue
    const v = (x: string) => Number(x.replace(/\D/g, ''))
    const r = { [order[0]]: v(m[1]), [order[1]]: v(m[2]) } as { n: number; done: number }
    return r.done <= r.n ? r : null
  }
  return null
}

export const blankStage = (): RStage => ({ id: newId(), title: t('Новий етап'), badge: '', why: '', table: null, tasks: [], meta: '' })
/**
 * Давні позначки «зібрано» з браузера (до того, як прогрес переїхав на сервер): роадмап → id карток. Нові сюди не
 * пишуться; після входу їх раз переносимо в особистий прогрес і звідси прибираємо.
 */
const GOT = 'roadmap:got'
const legacyGot = (rid: string): string[] => prefGet<Record<string, string[]>>(GOT, {})[rid] ?? []
function dropLegacyGot(rid: string) {
  const all = { ...prefGet<Record<string, string[]>>(GOT, {}) }
  delete all[rid]
  prefSet(GOT, all)
}
export const blankSection = (): RSection => ({ id: newId(), title: t('Новий розділ'), body: '', stats: [], columns: [], sources: '' })
export const blankTable = (): RTable => ({ head: [], rows: [{ cells: ['', ''] }] })

type Save = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

interface S {
  /** який роадмап відкрито */
  id: string | null
  /** запис реєстру: власник, видимість, права */
  item: Item | null
  /** права людини на цей роадмап і прогрес, який їй показано */
  rights: Rights | null
  progress: Progress | null
  /** налаштування прав — лише тим, хто може їх міняти; levels — які рівні є для кожного права */
  access: Access | null
  levels: Record<RightKey, Level[]> | null
  /** які режими прогресу є за цієї видимості */
  modes: Mode[] | null
  /** типові права для власника й видимості — основа готових наборів */
  defaults: Access | null
  doc: RoadmapDoc | null
  version: number
  updated: number
  state: 'loading' | 'ready' | 'error' | 'missing'
  save: Save
  /** знімки до правок — для «Скасувати» (лише в цій вкладці) */
  undo: RoadmapDoc[]
  /** збережене на сервері — з ним порівнюємо (правки — лише на екрані, доки їх не зберегли) */
  base: RoadmapDoc | null
  load: (id: string) => Promise<void>
  setItem: (it: Item) => void
  /** правка: recipe міняє копію документа; на сервер — лише «Зберегти» (смуга незбережених змін), без автозбереження */
  edit: (recipe: (d: RoadmapDoc) => void, opts?: { now?: boolean; key?: string }) => void
  undoLast: () => void
  /** зберегти правки (нова версія) */
  commit: () => Promise<void>
  /** відкинути правки — знову збережене */
  discard: () => void
  history: () => Promise<Revision[]>
  restore: (hid: number) => Promise<void>
  /** сторінку роадмапу покинули — живі оновлення більше не потрібні */
  leave: () => void
  /** одна позначка прогресу (одразу на екрані; сервер відмовив — назад) */
  mark: (kind: 's' | 't' | 'c', id: string, value: RStatus | boolean) => Promise<void>
  /** змінити права роадмапу (частину) */
  saveAccess: (patch: Partial<Access>) => Promise<boolean>
  /** скинути свій чи спільний прогрес (з «Повернути») */
  resetProgress: (which: 'mine' | 'shared') => Promise<void>
}

async function call<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T }> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers || {}) } })
  const body = (await r.json().catch(() => ({}))) as T
  return { ok: r.ok, status: r.status, body }
}

/** відписатися від живих оновлень (null — не підписані) */
let unsub: (() => void) | null = null
let inflight = false
// набір тексту в одному полі — один крок «скасувати», а не кожна літера
let lastKey = ''
let lastAt = 0

export const useRoadmap = create<S>((set, get) => {
  const flush = async () => {
    // уже зберігається — друге натискання нічого не робить
    if (inflight) return
    const { doc, version, id } = get()
    if (!doc || !id) return
    inflight = true
    set({ save: 'saving' })
    try {
      const r = await call<Envelope & { error?: string }>(`/api/roadmaps/${id}`, { method: 'PUT', body: JSON.stringify({ doc, version }) })
      // поки йшло збереження, людина відкрила інший роадмап — відповідь стосується старого, у новий її не пишемо
      if (get().id !== id) return
      if (r.status === 409) {
        // свіжа версія — на екран, а своя лишається під рукою: «Лишити мою» запише її поверх (свідомо)
        const mine = doc
        set({ doc: r.body.doc, base: r.body.doc, version: r.body.version, updated: r.body.updated, save: 'idle', undo: [] })
        toast.warning(t('Роадмап щойно змінив хтось інший'), {
          description: t('Показую свіжу версію. Твої незбережені правки — кнопкою «Лишити мою версію» (запише її поверх).'),
          duration: 15_000,
          action: { label: t('Лишити мою версію'), onClick: () => { if (get().id !== id) return; set({ doc: mine }); void flush() } },
        })
      } else if (!r.ok) {
        set({ save: 'error' })
        toast.error(t('Не вдалося зберегти роадмап'), { description: r.body.error })
      } else {
        // збережено те, що відправили; змінили тим часом — ще незбережене
        set({ version: r.body.version, updated: r.body.updated, base: doc, item: r.body.item ?? get().item, save: get().doc === doc ? 'saved' : 'pending' })
      }
    } catch {
      set({ save: 'error' })
      toast.error(t('Не вдалося зберегти роадмап'), { description: t('Сервер не відповідає.') })
    } finally {
      inflight = false
    }
  }
  /** правка на екрані: незбережене — якщо документ не такий, як на сервері */
  const touched = () => { const { doc, base } = get(); set({ save: doc && base && JSON.stringify(doc) === JSON.stringify(base) ? 'idle' : 'pending' }) }

  return {
    id: null,
    item: null,
    rights: null,
    progress: null,
    access: null,
    levels: null,
    modes: null,
    defaults: null,
    doc: null,
    version: 0,
    updated: 0,
    state: 'loading',
    save: 'idle',
    undo: [],
    base: null,
    load: async (id) => {
      // інший роадмап — незбережене попереднього не переносимо (піти зі сторінки з незбереженим смуга й так не пускає)
      if (get().id !== id) set({ id, doc: null, base: null, item: null, rights: null, progress: null, access: null, levels: null, modes: null, defaults: null, undo: [], save: 'idle', state: 'loading' })
      else if (get().state === 'error') set({ state: 'loading' }) // «Спробувати ще»
      try {
        const r = await call<Envelope>(`/api/roadmaps/${encodeURIComponent(id)}`)
        if (r.status === 404) { set({ state: 'missing' }); return }
        if (!r.ok) throw new Error()
        if (get().id === id) set({ ...r.body, base: r.body.doc, save: 'idle', undo: [], item: r.body.item ?? null, rights: r.body.rights ?? null, progress: r.body.progress ?? null, access: r.body.access ?? null, levels: r.body.levels ?? null, modes: r.body.modes ?? null, defaults: r.body.defaults ?? null, state: 'ready' })
      } catch {
        set({ state: 'error' })
        return
      }
      // давні «зібрано» з браузера — раз у свій особистий прогрес (лише якщо тут діє саме він і відмічати можна)
      const p = get().progress, old = legacyGot(id)
      if (old.length && p?.whose === 'mine' && p.scope?.startsWith('u:') && get().rights?.mark) {
        const r = await call<{ state: PState }>(`/api/roadmaps/${id}/progress/import`, { method: 'POST', body: JSON.stringify({ c: old }) })
        if (r.ok) { dropLegacyGot(id); if (get().id === id && get().progress) set({ progress: { ...get().progress!, state: r.body.state } }) }
      }
      if (!unsub) {
        unsub = subscribe(
          '/api/roadmaps/stream',
          (data) => {
            const ev = data as { op: 'put' | 'access' | 'del' | 'progress'; id: string; scope?: string; kind?: 's' | 't' | 'c'; item?: string; value?: RStatus | boolean; reset?: boolean } & Partial<Envelope>
            const cur = get()
            if (ev.id !== cur.id) return
            // позначка в тому самому записі (інша людина чи інша вкладка)
            if (ev.op === 'progress') {
              const p = cur.progress
              if (!p || ev.scope !== p.scope) return
              if (ev.reset || !ev.kind || !ev.item) { cur.load(ev.id); return }
              set({ progress: { ...p, state: withMark(p.state, ev.kind, ev.item, ev.value!) } })
              return
            }
            if (ev.op === 'del') { set({ state: 'missing', doc: null }); return }
            // доступ змінився — перечитати (права, власник; можливо, вже не видно)
            if (ev.op === 'access') { cur.load(ev.id); return }
            // свої збереження й поточні правки не перебиваємо — розбіжність покаже 409
            if (ev.doc && (ev.version ?? 0) > cur.version && cur.save !== 'pending' && cur.save !== 'saving') set({ doc: ev.doc, version: ev.version!, updated: ev.updated! })
          },
          // з'єднання відновилось — що змінили тим часом, перечитати (якщо своїх незбережених правок нема)
          () => { const cur = get(); if (cur.id && cur.state === 'ready' && cur.save !== 'pending' && cur.save !== 'saving' && cur.save !== 'error') cur.load(cur.id) },
        )
      }
    },
    leave: () => { unsub?.(); unsub = null },
    mark: async (kind, mid, value) => {
      const { id, progress, rights } = get()
      if (!id || !progress) return
      if (!rights?.mark) { toast.info(t('Відмічати прогрес цього роадмапу тобі не можна'), { id: 'rm-mark' }); return }
      const before = progress.state
      set({ progress: { ...progress, state: withMark(before, kind, mid, value) } })
      const r = await call<{ state: PState; error?: string }>(`/api/roadmaps/${id}/progress`, { method: 'POST', body: JSON.stringify({ kind, id: mid, value }) }).catch(() => null)
      if (get().id !== id) return
      if (!r?.ok) {
        set({ progress: { ...get().progress!, state: before } })
        toast.error(t('Позначка не збереглась'), { description: r?.body.error || t('Сервер не відповідає.') })
        return
      }
      set({ progress: { ...get().progress!, state: r.body.state } })
    },
    saveAccess: async (patch) => {
      const id = get().id
      const r = await call<Envelope & { error?: string }>(`/api/roadmaps/${id}/access-settings`, { method: 'PATCH', body: JSON.stringify(patch) })
      if (!r.ok) { toast.error(t('Не вдалося змінити права'), { description: r.body.error }); return false }
      if (get().id === id) set({ item: r.body.item ?? get().item, rights: r.body.rights ?? null, progress: r.body.progress ?? null, access: r.body.access ?? null, levels: r.body.levels ?? null, modes: r.body.modes ?? null, defaults: r.body.defaults ?? null })
      return true
    },
    resetProgress: async (which) => {
      const id = get().id
      const r = await call<{ state: PState; before: PState; error?: string }>(`/api/roadmaps/${id}/progress?which=${which}`, { method: 'DELETE' })
      if (!r.ok) { toast.error(t('Не вдалося скинути прогрес'), { description: r.body.error }); return }
      if (get().id === id && get().progress) set({ progress: { ...get().progress!, state: r.body.state } })
      const before = r.body.before
      toast(which === 'mine' ? t('Твій прогрес скинуто') : t('Спільний прогрес скинуто'), {
        duration: 15_000,
        action: {
          label: t('Повернути'),
          onClick: async () => {
            const back = await call<{ state: PState }>(`/api/roadmaps/${id}/progress/restore`, { method: 'POST', body: JSON.stringify({ which, state: before }) })
            if (back.ok && get().id === id && get().progress) set({ progress: { ...get().progress!, state: back.body.state } })
          },
        },
      })
    },
    setItem: (item) => set({ item }),
    edit: (recipe, opts) => {
      const cur = get().doc
      if (!cur) return
      if (!get().item?.can?.edit) { toast.info(t('Цей роадмап можна лише переглядати'), { id: 'rm-ro' }); return }
      const next = structuredClone(cur)
      recipe(next)
      const now = Date.now()
      const merge = !!opts?.key && opts.key === lastKey && now - lastAt < 1500
      lastKey = opts?.key ?? ''
      lastAt = now
      set({ doc: next, undo: merge ? get().undo : [...get().undo.slice(-49), cur] })
      touched()
    },
    undoLast: () => {
      const u = get().undo
      if (!u.length) return
      set({ doc: u[u.length - 1], undo: u.slice(0, -1) })
      touched()
    },
    commit: () => flush(),
    discard: () => { const b = get().base; if (b) set({ doc: b, undo: [], save: 'idle' }) },
    history: async () => {
      const r = await call<{ rows: Revision[]; error?: string }>(`/api/roadmaps/${get().id}/history`)
      if (!r.ok) throw new Error(r.body.error || t('Сервер зараз не відповідає. Спробуй ще раз трохи згодом.'))
      return r.body.rows
    },
    restore: async (hid) => {
      const r = await call<Envelope & { error?: string }>(`/api/roadmaps/${get().id}/history/${hid}/restore`, { method: 'POST' })
      if (!r.ok) { toast.error(t('Не вдалося відновити'), { description: r.body.error }); return }
      set({ doc: r.body.doc, base: r.body.doc, version: r.body.version, updated: r.body.updated, undo: [], save: 'saved' })
      toast.success(t('Версію відновлено'), { description: t('Це теж нова версія — її можна так само відкотити.') })
    },
  }
})

// незбережене — браузер спитає перед закриттям вкладки сам (components/UnsavedBar); тут — лише поки зберігається
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (useRoadmap.getState().save === 'saving') { e.preventDefault(); e.returnValue = '' }
  })
}

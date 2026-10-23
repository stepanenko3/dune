/**
 * Панель керування на клієнті: опис розділів (приходить із сервера — server/admin/resources.mjs), запити до ресурсів
 * і переходи між сторінками панелі (/admin/<розділ>/<запис>).
 */
import { create } from 'zustand'
import { get, patch, post, put } from '@/lib/api'
import { leaveFreely, useStore } from '@/store'
import { t } from '@/lib/i18n'
import { optionLabel } from './labels'

export type FieldType = 'text' | 'textarea' | 'code' | 'email' | 'url' | 'color' | 'slug' | 'int' | 'num' | 'bool' | 'flag' | 'datetime' | 'select' | 'relation' | 'owner' | 'json' | 'pairs' | 'list' | 'permissions'
/** also — давні назви того ж значення (у журналі), фільтр шукає й за ними; parent — значення поля, від якого варіант
 *  залежить (підкатегорія — від категорії); icon — зображення запису (вибір зі списку записів) */
export interface Option { value: string; label: string; also?: string[]; parent?: string; icon?: string | null }
export interface Field {
  key: string
  label: string
  type: FieldType
  list?: boolean
  search?: boolean
  sort?: boolean
  filter?: boolean
  form?: boolean
  readonly?: boolean
  create?: boolean
  required?: boolean
  options?: Option[]
  resource?: string
  /** для owner: поле з видом власника (user | guild) */
  kindField?: string
  help?: string
  mono?: boolean
  tones?: Record<string, string>
  max?: number
  /** у таблиці схований, доки людина не покаже (Стовпці) */
  hidden?: boolean
  /** значення — посилання на запис: сервер дає <key>__ref ([розділ, id] чи [розділ]) і <key>__label */
  ref?: boolean
  /** особливий показ значення: 'request' — подробиці запиту з журналу */
  view?: string
  /** значення — текст сайту (назва задачі, вбудованої ролі): показувати перекладеним */
  tr?: boolean
  /** обчислюється сервером (немає в таблиці бази — ні фільтра, ні сортування) */
  virtual?: boolean
  /** значення — адреса зображення: мініатюра в таблиці, картинка у формі (збільшити, завантажити нове, прибрати) */
  image?: boolean
  /** pairs / list: id яких записів там (розділ) — вибір зі списку з іконкою й назвою; сервер дає <key>__refs */
  refs?: string
  /** як підписати варіанти select (словник сайту, ./labels.ts) */
  labels?: string
  /** варіанти select залежать від значення цього поля (option.parent) */
  dependsOn?: string
  /** службове (JSON, внутрішні коди) — у згорнутому блоці «Технічні дані» під формою */
  advanced?: boolean
  /** 'duration' — мілісекунди показувати як «1 хв 5 с» */
  format?: string
}
export interface Action {
  key: string
  label: string
  tone?: 'critical'
  bulk?: boolean
  row?: boolean
  global?: boolean
  confirm?: string
  fields?: Field[]
  /** коли показувати на записі: { поле: значення | null | '!null' } */
  show?: Record<string, unknown>
}
export interface Resource {
  name: string
  label: string
  one: string
  group: string
  icon: string
  about: string
  title: string | null
  canWrite: boolean
  canCreate: boolean
  canDelete: boolean
  link: Record<string, string> | null
  page: string | null
  texts: string | null
  /** перегляд на картці запису: 'base3d' — 3D бази */
  preview: string | null
  /** що ще зникне при видаленні (для підтвердження) */
  removeNote: string | null
  /** назва запису без власного поля-назви — з кількох полів («Дія · Що») */
  titleFields: string[] | null
  /** чи має сенс вкладка «Історія змін» (події журналу, запуски задач не змінюються) */
  history: boolean
  /** швидкі фільтри над таблицею: значення — як у «Фільтрах» ('-7d' — від тижня тому) */
  quick: { key: string; label: string; filters: Record<string, unknown> }[]
  defaultSort: string | null
  fields: Field[]
  actions: Action[]
  /** пов'язані записи інших розділів (відносно цього запису) */
  relations: Relation[]
  abilities: string[]
}
/** has — у списку чи парах пов'язаного розділу є id цього запису (рецепти, де потрібен предмет) */
export interface Relation { resource: string; field?: string; match?: Record<string, string>; has?: string; label?: string }
/** закріплені умови для пов'язаного списку: field = id запису, match — з підстановкою $id, has — { поле: { has: id } } */
export const fixedOf = (rel: Relation, id: string): Record<string, unknown> =>
  rel.has ? { [rel.has]: { has: id } } : rel.field ? { [rel.field]: id } : Object.fromEntries(Object.entries(rel.match ?? {}).map(([k, v]) => [k, v === '$id' ? id : v]))
/** ключ вкладки пов'язаних записів (в адресі ?tab=): розділ, а якщо він у картці не один — ще й поле */
export const relKey = (rel: Relation, all: Relation[]) => (all.filter((x) => x.resource === rel.resource).length > 1 ? `${rel.resource}.${rel.has ?? rel.field ?? Object.keys(rel.match ?? {})[0] ?? ''}` : rel.resource)
export type Row = Record<string, unknown> & { _id: string }
export interface Revision { id: number; action: string; actor: string | null; actor_name?: string | null; at: number; note: string; entity?: string; entity_id?: string }
export interface Change { path: string; type: 'add' | 'remove' | 'change'; from?: unknown; to?: unknown }
export interface ListQuery { page: number; size: number; search: string; sort: string | null; desc: boolean; filters: Record<string, unknown>; fixed?: Record<string, unknown> }
/** all — скільки записів без пошуку й фільтрів (є, коли вони задані) */
export interface ListResult { rows: Row[]; total: number; all?: number; page: number; size: number }

interface Meta { resources: Resource[]; langs: { code: string; name: string }[]; role: string; permissions: string[] }
/** title — назва відкритого запису для крихт над заголовком (ставить картка запису) */
export const useAdmin = create<{ meta: Meta | null; error: string; title: string | null; load: () => Promise<void> }>((set) => ({
  meta: null,
  error: '',
  title: null,
  load: async () => {
    try { set({ meta: withLabels(await get<Meta>('/api/admin/meta')), error: '' }) } catch (e) { set({ error: (e as Error).message }) }
  },
}))
/** чи є дозвіл — як на сервері (roles.has): точний, «*» чи «<розділ>.*» */
export const hasPerm = (perms: string[] | Set<string>, p: string) => {
  const has = (x: string) => (Array.isArray(perms) ? perms.includes(x) : perms.has(x))
  return has('*') || has(p) || has(p.split('.')[0] + '.*')
}
export const resourceOf = (name: string) => useAdmin.getState().meta?.resources.find((r) => r.name === name) ?? null

const enc = encodeURIComponent
export const adminApi = {
  list: (res: string, q: ListQuery) =>
    get<ListResult>(`/api/admin/r/${res}?page=${q.page}&size=${q.size}&search=${enc(q.search)}${q.sort ? `&sort=${enc(q.sort)}&desc=${q.desc ? 1 : 0}` : ''}&f=${enc(JSON.stringify(q.filters))}${q.fixed ? `&fixed=${enc(JSON.stringify(q.fixed))}` : ''}`),
  one: (res: string, id: string) => get<Row>(`/api/admin/r/${res}/one?id=${enc(id)}`),
  create: (res: string, data: Record<string, unknown>) => post<Row>(`/api/admin/r/${res}`, data),
  update: (res: string, id: string, data: Record<string, unknown>) => patch<Row>(`/api/admin/r/${res}/one?id=${enc(id)}`, data),
  remove: (res: string, ids: string[]) => post<{ removed: number }>(`/api/admin/r/${res}/delete`, { ids }),
  action: (res: string, key: string, ids: string[], input: Record<string, unknown>) => post<{ ok: boolean; message?: string; open?: string[] | null }>(`/api/admin/r/${res}/action/${key}`, { ids, input }),
  /** той самий запит списку — адресою вивантаження CSV */
  exportUrl: (res: string, q: ListQuery) =>
    `/api/admin/r/${res}/export.csv?search=${enc(q.search)}${q.sort ? `&sort=${enc(q.sort)}&desc=${q.desc ? 1 : 0}` : ''}&f=${enc(JSON.stringify(q.filters))}${q.fixed ? `&fixed=${enc(JSON.stringify(q.fixed))}` : ''}`,
  search: (q: string) => get<{ rows: { res: string; id: string; title: string }[] }>(`/api/admin/search?q=${enc(q)}`),
  options: (res: string, q: string, ids?: string[]) => get<Option[]>(`/api/admin/r/${res}/options?q=${enc(q)}${ids?.length ? `&ids=${enc(ids.join(','))}` : ''}`),
  history: (res: string, id: string, offset = 0) => get<{ rows: Revision[]; more: boolean }>(`/api/admin/history/${res}?id=${enc(id)}&offset=${offset}`),
  revisionDiff: (id: number) => get<{ revision: Revision; changes: Change[] }>(`/api/admin/revisions/${id}/diff`),
  versionDiff: (kind: 'base' | 'roadmap', hid: number) => get<{ from: { version: number; updated: number }; to: { version: number; updated: number } | null; changes: Change[] }>(`/api/admin/version-diff/${kind}/${hid}`),
  permissionsCatalog: () => get<{ sections: { name: string; label: string; group: string; abilities: string[]; actions: Record<string, string> }[]; site: { key: string; label: string }[] }>('/api/admin/permissions-catalog'),
  /** скільки записів: [[розділ, fixed?], …] → [n | null] */
  counts: (list: [string, Record<string, unknown>?][]) => get<{ counts: (number | null)[] }>(`/api/admin/counts?q=${enc(JSON.stringify(list))}`).then((r) => r.counts),
  /** зображення в сховище → адреса /media/… */
  upload: (res: string, file: Blob) => sendFile<{ url: string }>('POST', `/api/admin/upload?res=${enc(res)}`, file),
  basePhoto: (id: string) => get<BasePhoto>(`/api/admin/bases/${enc(id)}/photo`),
  setBasePhoto: (id: string, file: Blob) => sendFile<BasePhoto>('POST', `/api/admin/bases/${enc(id)}/photo`, file),
  dropBasePhoto: (id: string) => sendFile<BasePhoto>('DELETE', `/api/admin/bases/${enc(id)}/photo`, null),
  redrawBasePhoto: (id: string) => post<BasePhoto>(`/api/admin/bases/${enc(id)}/photo/redraw`, {}),
  gameTexts: (kind: string, id: string) => get<{ texts: Record<string, { name: string; description: string; source: string; locked: boolean }> }>(`/api/admin/game-texts/${kind}?id=${enc(id)}`),
  saveGameTexts: (kind: string, id: string, texts: Record<string, { name: string; description: string }>) => put(`/api/admin/game-texts/${kind}?id=${enc(id)}`, { texts }),
}

/** фото бази: своє (завантажене) чи знімок 3D; url null — знімок не вдався */
export interface BasePhoto { custom: boolean; url: string | null }

/** файл тілом запиту (зображення): помилку сервера — його текстом */
async function sendFile<T>(method: string, url: string, file: Blob | null): Promise<T> {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: file ? { 'content-type': file.type || 'application/octet-stream' } : {}, body: file ?? undefined })
  let body: unknown = null
  try { body = await r.json() } catch { /* не JSON */ }
  if (!r.ok) throw new Error((body as { error?: string } | null)?.error || t('Не вдалося зберегти'))
  return body as T
}

/** варіанти полів зі словником сайту (labels) — підписами мовою сайту (категорії гри тощо) */
function withLabels(m: Meta): Meta {
  for (const r of m.resources) for (const f of r.fields) if (f.labels && f.options) f.options = f.options.map((o) => ({ ...o, label: optionLabel(f.labels!, o.value) }))
  return m
}

/**
 * перейти в панелі: [] — огляд, ['users'] — список, ['users', id] — запис, ['users', 'new'] — новий. Незбережене на
 * картці не пускає (як на всьому сайті — смуга незбережених змін трусить); force — щойно збережено, тож можна
 */
export function goAdmin(parts: string[], opts?: { replace?: boolean; search?: string; force?: boolean }) {
  const go = () => useStore.getState().setView('admin', { param: parts.map(enc).join('/') || null, replace: opts?.replace, search: opts?.search })
  if (opts?.force) leaveFreely(go)
  else go()
}
/** href для посилань (щоб працювали «відкрити в новій вкладці» й середня кнопка) */
export const adminHref = (parts: string[]) => '/admin' + (parts.length ? '/' + parts.map(enc).join('/') : '')
/** клік по посиланню панелі без перезавантаження */
export const adminLink = (parts: string[]) => (e: React.MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  goAdmin(parts)
}

/** завантажити файл (вивантаження): помилку сервера показуємо повідомленням, а не сторінкою з сирою відповіддю */
export async function download(url: string, fallbackName: string) {
  const r = await fetch(url, { credentials: 'same-origin' })
  if (!r.ok) {
    let msg = ''
    try { msg = ((await r.json()) as { error?: string }).error || '' } catch { /* не JSON */ }
    throw new Error(msg || t('Не вдалося вивантажити'))
  }
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || fallbackName
  const a = document.createElement('a')
  a.href = URL.createObjectURL(await r.blob())
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

/** чи показувати дію для запису (show: { поле: значення | null | '!null' }) */
export function actionShown(a: Action, row: Record<string, unknown>) {
  if (!a.show) return true
  // '!значення' — показувати, коли поле НЕ таке (напр. '!0' — є хоч один)
  return Object.entries(a.show).every(([k, v]) => (v === null ? row[k] == null : v === '!null' ? row[k] != null : typeof v === 'string' && v.startsWith('!') ? String(row[k] ?? '') !== v.slice(1) : row[k] === v))
}

/** адреса запису на самому сайті (link з опису розділу) */
export function siteHref(r: Resource, row: Record<string, unknown>): string | null {
  const l = r.link
  if (!l) return null
  if (l.user) return `/u/${row[l.user]}`
  if (l.guild) return `/g/${row[l.guild]}`
  if (l.invite) return `/invite/${row[l.invite]}`
  const kind = l.kind === 'kind' ? String(row.kind) : l.kind
  const id = String(row.id)
  return ({ base: `/bases/${id}`, roadmap: `/roadmap/${id}`, build: `/skills?build=${id}`, marker: `/map?marker=${id}`, place: `/map`, event: `/events/${id}` } as Record<string, string>)[kind] ?? null
}

export { put }

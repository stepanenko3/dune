/**
 * Чуже публічне на мапі — позначки й записи ресурсів інших людей і гільдій. Усього разом не тягнемо й не малюємо
 * (сотні людей × десятки позначок): список — пачками з пошуком (/api/map/public, див. PublicList), а на мапі — лише
 * те, що людина ввімкнула: окремі речі чи все публічне від автора (/api/map/public/shown). Що ввімкнено — у prefs.
 * peek — одна річ «подивитись» (розгорнута в списку чи відкрита за посиланням): видно, поки її не закрили.
 * Зміни ввімкненого приходять живими оновленнями позначок і записів (update / drop з lib/markers і lib/places).
 */
import { create } from 'zustand'
import { get } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { prefGet, prefSet } from '@/lib/prefs'
import type { Item, Owner } from '@/lib/items'
import type { Marker } from '@/lib/markers'
import type { Place } from '@/lib/places'
import { ZONE_MAPS } from './data'

export type PubMarker = Marker & { item: Item & { kind: 'marker' } }
export type PubPlace = Place & { item: Item & { kind: 'place' } }
export type PubRow = PubMarker | PubPlace
export const isMarker = (r: { item?: Item }): r is PubMarker => r.item?.kind === 'marker'
export const isPlace = (r: { item?: Item }): r is PubPlace => r.item?.kind === 'place'
/** «marker:<id>» / «place:<id>» */
export const keyOf = (r: { item: Pick<Item, 'kind' | 'id'> }) => `${r.item.kind}:${r.item.id}`
/** «user:<id>» / «guild:<id>» */
export const ownerKey = (o: Pick<Owner, 'kind' | 'id'>) => `${o.kind}:${o.id}`
/** річ моя чи моєї гільдії — те, що мапа показує завжди (список «своїх», scope=shared) */
export function sharedOwner(o?: Pick<Owner, 'kind' | 'id'> | null) {
  const { user, guilds } = useAuth.getState()
  return !!o && !!user && ((o.kind === 'user' && o.id === user.id) || (o.kind === 'guild' && guilds.some((g) => g.id === o.id)))
}
/** замінити рядок з тим самим id (на тому ж місці) чи додати в кінець */
export function upsertRow<T extends { id: string }>(rows: T[], row: T): T[] {
  const i = rows.findIndex((r) => r.id === row.id)
  if (i < 0) return [...rows, row]
  const next = rows.slice()
  next[i] = row
  return next
}
/** річ на цій мапі: позначка — на своїй; запис — де його точки, типи точок чи мапи регіону */
export const onMapOf = (r: Marker | Place, map: string) =>
  isMarker(r) ? r.map === map : !!((r as Place).pins?.some((p) => p.map === map) || (r as Place).types?.some((x) => x.map === map) || (ZONE_MAPS[(r as Place).zone] || []).includes(map))

/** автор, чиє публічне ввімкнено, — з іменем: показати його й тоді, коли на цій мапі в нього нічого */
export type Follow = Pick<Owner, 'kind' | 'id' | 'name' | 'color' | 'tag' | 'login' | 'slug'>
interface Saved { ids: string[]; owners: Follow[] }
const PREF = 'map:pub'
const saved = (): Saved => {
  const s = prefGet<Partial<Saved>>(PREF, {})
  return { ids: Array.isArray(s.ids) ? s.ids : [], owners: Array.isArray(s.owners) ? s.owners : [] }
}

interface S {
  /** ввімкнені окремі речі — «вид:id» */
  ids: string[]
  /** ввімкнені автори: усе їхнє публічне */
  owners: Follow[]
  /** ввімкнене, що є на поточній мапі */
  rows: PubRow[]
  map: string | null
  error: string | null
  peek: PubRow | null
  load: (map?: string) => Promise<void>
  /** увімкнути / вимкнути одну річ */
  toggle: (r: PubRow) => void
  /** увімкнути / вимкнути все від автора */
  follow: (o: Follow) => void
  /** вимкнути все */
  clear: () => void
  setPeek: (r: PubRow | null) => void
  /** річ видалили (чи її більше не видно) */
  drop: (key: string) => void
  /** чи є річ серед увімкненого чи «подивитись» */
  has: (key: string) => boolean
  /** річ змінилась (жива подія): оновити, якщо вона ввімкнена; нова від автора, якого ввімкнули, — додати */
  update: (r: Marker | Place) => void
}

let seq = 0

export const usePubMarks = create<S>((set, get_) => {
  const save = () => prefSet(PREF, { ids: get_().ids, owners: get_().owners })
  return {
    ...saved(),
    rows: [],
    map: null,
    error: null,
    peek: null,
    load: async (map) => {
      const m = map ?? get_().map
      set({ map: m })
      const { ids, owners } = get_()
      if (!m || (!ids.length && !owners.length)) { set({ rows: [], error: null }); return }
      const n = ++seq
      const q = new URLSearchParams({ map: m })
      if (ids.length) q.set('ids', ids.join(','))
      if (owners.length) q.set('owners', owners.map(ownerKey).join(','))
      try {
        const r = await get<{ rows: PubRow[] }>(`/api/map/public/shown?${q.toString().replace(/%2C/g, ',').replace(/%3A/g, ':')}`)
        if (n === seq) set({ rows: r.rows, error: null })
      } catch {
        if (n === seq) set({ error: t('Увімкнені публічні позначки зараз не завантажились. Спробуй трохи згодом.') })
      }
    },
    toggle: (r) => {
      const k = keyOf(r)
      const { ids, rows, owners } = get_()
      if (ids.includes(k)) {
        const viaOwner = owners.some((o) => ownerKey(o) === ownerKey(r.item.owner))
        set({ ids: ids.filter((x) => x !== k), rows: viaOwner ? rows : rows.filter((x) => keyOf(x) !== k) })
      } else {
        set({ ids: [...ids, k], rows: rows.some((x) => keyOf(x) === k) ? rows : [...rows, r] })
      }
      save()
    },
    follow: (o) => {
      const k = ownerKey(o)
      const { owners } = get_()
      const f: Follow = { kind: o.kind, id: o.id, name: o.name, color: o.color, tag: o.tag, login: o.login, slug: o.slug }
      set({ owners: owners.some((x) => ownerKey(x) === k) ? owners.filter((x) => ownerKey(x) !== k) : [...owners, f] })
      save()
      void get_().load()
    },
    clear: () => {
      set({ ids: [], owners: [], rows: [] })
      save()
    },
    setPeek: (peek) => set({ peek }),
    drop: (k) => {
      if (!get_().has(k) && !get_().ids.includes(k)) return
      set({ ids: get_().ids.filter((x) => x !== k), rows: get_().rows.filter((x) => keyOf(x) !== k), peek: get_().peek && keyOf(get_().peek!) === k ? null : get_().peek })
      save()
    },
    has: (k) => get_().rows.some((x) => keyOf(x) === k) || (!!get_().peek && keyOf(get_().peek!) === k),
    update: (r) => {
      if (!r.item || (r.item.kind !== 'marker' && r.item.kind !== 'place')) return
      const row = r as PubRow
      const k = keyOf(row)
      const { rows, ids, owners, peek, map } = get_()
      // окрему річ — поки її видно; від автора — лише публічне (як на сервері)
      const wanted = ids.includes(k) || (row.item.visibility === 'public' && !row.item.hidden && owners.some((o) => ownerKey(o) === ownerKey(row.item.owner)))
      const i = rows.findIndex((x) => keyOf(x) === k)
      let next = rows
      if (wanted && (!map || onMapOf(row, map))) next = i < 0 ? [...rows, row] : rows.map((x, j) => (j === i ? row : x))
      else if (i >= 0) next = rows.filter((_, j) => j !== i)
      const pk = peek && keyOf(peek) === k ? row : peek
      if (next !== rows || pk !== peek) set({ rows: next, peek: pk })
    },
  }
})

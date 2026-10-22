/*
 * Драйвер-виняток TH.GL (spec §4.2): мапи (межі й трансформи), точки, типи точок, розкладки Глибокої пустелі, ресурси
 * й картинки мапи (тайли, спрайт іконок) — у серверних файлах гри пікселів нема. Сам нічого не тягне: збирає нинішня
 * задача map-refresh, драйвер лише читає її дані (mapData). Точки — записами з ключем «мапа@x:y» (координати сайту):
 * так порівняння з файлами гри йде за місцем, без зіставлення типів; ресурси (групи resources*) — окремим розділом.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const SECTIONS = ['maps', 'markers', 'markerTypes', 'ddLayouts', 'resources', 'images']
const DD = 'deepdesert_1'

const isResource = (group) => /^resources/.test(group ?? '')
const POINT_SECTIONS = new Set(['markers', 'resources', 'markerTypes'])

export function createThglDriver({ mapData }) {
  const source = () => {
    const s = mapData.source
    if (!s?.maps?.length) throw new Error('мапу ще не отримано')
    return s
  }
  const loaders = {
    maps: async () => {
      const s = source()
      return { data: { blob: s.maps.map(({ id, title, bounds, transformation }) => ({ id, title, bounds, transformation })) }, version: s.syncedAt }
    },
    markers: async () => { const s = source(); return { data: { records: await points(s, false) }, version: s.syncedAt } },
    resources: async () => { const s = source(); return { data: { records: await points(s, true) }, version: s.syncedAt } },
    markerTypes: async () => {
      const s = source()
      return { data: { records: (s.groups ?? []).flatMap((g) => g.types.map((t) => ({ id: t.id, group: g.id }))) }, version: s.syncedAt }
    },
    ddLayouts: async () => {
      const s = source()
      const dd = s.maps.find((m) => m.id === DD)
      if (!dd) throw new Error('нема Глибокої пустелі в даних мапи')
      return { data: { blob: { layout: dd.layout ?? null, layouts: dd.layouts ?? [] } }, version: s.syncedAt }
    },
    images: async () => {
      const s = source()
      let icons = null
      try { icons = createHash('sha256').update(fs.readFileSync(path.join(mapData.dir, 'icons.webp'))).digest('hex') } catch { /* спрайта ще нема */ }
      return { data: { blob: { tiles: s.maps.map((m) => m.tiles), icons } }, version: s.syncedAt }
    },
  }
  /** точки всіх мап (Глибока пустеля — поточна розкладка): ресурси чи решта */
  async function points(s, resources) {
    const groupOf = new Map((s.groups ?? []).flatMap((g) => g.types.map((t) => [t.id, g.id])))
    const out = []
    for (const m of s.maps) {
      const raw = await mapData.raw(m.id)
      if (!raw) continue
      const layout = m.layouts?.length ? { layout: m.layout } : {}
      const seen = new Map()
      for (const [type, T] of Object.entries(raw)) {
        if (isResource(groupOf.get(type)) !== resources) continue
        for (let i = 0; i < T.pts.length; i += 3) {
          const [x, y, z] = [T.pts[i], T.pts[i + 1], T.pts[i + 2]]
          const base = `${m.id}@${x}:${y}`
          const n = (seen.get(base) ?? 0) + 1
          seen.set(base, n)
          out.push({ id: n === 1 ? base : `${base}#${n}`, map: m.id, ...layout, type, x, y, z })
        }
      }
    }
    return out
  }
  return {
    id: 'thgl',
    label: 'TH.GL',
    sections: () => SECTIONS,
    describe: (section) => (SECTIONS.includes(section) ? { id: 'thgl', names: ['TH.GL'] } : null),
    async probe() { return { version: mapData.source?.syncedAt ?? '' } },
    /**
     * відбиток точок (markers, resources, markerTypes): імена файлів точок мап (з хешем вмісту) і поточна розкладка ГП —
     * незмінні, то сотні тисяч точок не розбираються знову; решта розділів дешева — без відбитка
     */
    async contentVersion(section) {
      if (!POINT_SECTIONS.has(section)) return null
      const s = mapData.source
      if (!s?.maps?.length) return null
      const key = JSON.stringify([s.maps.map((m) => [m.id, m.nodes, m.layout ?? null, (m.layouts ?? []).map((l) => [l.id, l.nodes ?? null])]), (s.groups ?? []).map((g) => [g.id, g.types.map((t) => t.id)])])
      return createHash('sha256').update(key).digest('hex').slice(0, 16)
    },
    async load(section) {
      const f = loaders[section]
      if (!f) throw new Error(`розділу ${section} у TH.GL нема`)
      const r = await f()
      return { data: r.data, version: r.version == null ? null : String(r.version) }
    },
  }
}

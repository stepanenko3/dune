/*
 * «Що тут є» — як підказка на мапі в грі: для кожної локації (печера, аванпост, уламок,
 * випробувальна станція…) зводимо лут контейнерів поблизу і руду / рослини довкола.
 * Радіус — за типом локації: табір маленький, уламок чи копальня — великі.
 */

const CELL = 10000
/** радіус локації в одиницях гри (см) */
export const RADIUS = {
  cave: 9000, sietch: 15000, shipwreck: 20000, small_shipwreck: 6000, wreck: 4000,
  enemyoutpost: 15000, enemycamp: 6000, enemylaboroutpost: 20000, ecolab: 15000,
  explorationpointofinterest: 20000, tradingpost: 8000, atreides: 15000, harkonnen: 15000,
  landsraad_control_point: 10000, secret_door: 5000, intel_point: 3000, exploration: 8000,
  discoverable: 8000, bank: 5000, taxiservice: 3000,
}
const MAX_R = 20000
const MINOR = new Set(['intel_point', 'secret_door', 'taxiservice', 'bank', 'discoverable'])

/** «<b>Items:</b><br>Пластелева плита (100%)<br>…» → [[назва, шанс], …] */
export function parseLoot(desc) {
  if (!desc) return []
  const out = []
  for (const line of desc.split(/<br\s*\/?>/i)) {
    const clean = line.replace(/<[^>]+>/g, '').trim()
    const m = /^(.+?)\s*\((\d+(?:[.,]\d+)?)%\)/.exec(clean)
    if (m) out.push([m[1].trim(), Number(m[2].replace(',', '.'))])
  }
  return out
}

function grid() {
  const g = new Map()
  return {
    add(x, y, v) {
      const k = Math.floor(x / CELL) + ':' + Math.floor(y / CELL)
      let a = g.get(k)
      if (!a) g.set(k, (a = []))
      a.push(v)
    },
    near(x, y, r, fn) {
      const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL)
      const y0 = Math.floor((y - r) / CELL), y1 = Math.floor((y + r) / CELL)
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) for (const v of g.get(i + ':' + j) || []) fn(v)
    },
  }
}

const cache = new WeakMap()

/**
 * @param P      точки мапи (mapData.points)
 * @param groups групи типів із source.json — звідти беремо, що є локацією, а що ресурсом
 */
export function summaries(P, groups) {
  if (cache.has(P)) return cache.get(P)
  const locTypes = new Set(groups.find((g) => g.id === 'locations')?.types.map((t) => t.id) ?? [])
  const resTypes = new Set(groups.find((g) => g.id === 'resources')?.types.map((t) => t.id) ?? [])
  const loot = grid(), res = grid(), locs = grid()
  for (const [type, T] of Object.entries(P.types)) {
    const n = T.pts.length / 3
    if (resTypes.has(type)) for (let i = 0; i < n; i++) res.add(T.pts[i * 3], T.pts[i * 3 + 1], [type, T.pts[i * 3], T.pts[i * 3 + 1]])
    if (locTypes.has(type)) for (let i = 0; i < n; i++) locs.add(T.pts[i * 3], T.pts[i * 3 + 1], { type, i, x: T.pts[i * 3], y: T.pts[i * 3 + 1], r: RADIUS[type] ?? 8000, name: T.info[i]?.[0] ?? null })
    for (const [i, inf] of Object.entries(T.info)) {
      const items = parseLoot(inf[1])
      if (items.length) loot.add(T.pts[i * 3], T.pts[i * 3 + 1], { x: T.pts[i * 3], y: T.pts[i * 3 + 1], items })
    }
  }

  const out = {}
  for (const type of locTypes) {
    const T = P.types[type]
    if (!T) continue
    const r = RADIUS[type] ?? 8000, r2 = r * r
    const n = T.pts.length / 3
    for (let i = 0; i < n; i++) {
      const x = T.pts[i * 3], y = T.pts[i * 3 + 1]
      const items = new Map()
      let boxes = 0
      loot.near(x, y, r, (c) => {
        if ((c.x - x) ** 2 + (c.y - y) ** 2 > r2) return
        boxes++
        for (const [name, pc] of c.items) {
          const cur = items.get(name)
          if (cur) { cur[1] = Math.max(cur[1], pc); cur[2]++ } else items.set(name, [name, pc, 1])
        }
      })
      const counts = new Map()
      res.near(x, y, r, ([t, rx, ry]) => {
        if ((rx - x) ** 2 + (ry - y) ** 2 <= r2) counts.set(t, (counts.get(t) || 0) + 1)
      })
      if (!items.size && !counts.size) continue
      ;(out[type] ||= {})[i] = {
        boxes,
        loot: [...items.values()].sort((a, b) => b[1] - a[1] || b[2] - a[2]).slice(0, 14),
        res: [...counts.entries()].sort((a, b) => b[1] - a[1]),
      }
    }
  }

  /** найближча локація, якій належить точка (x, y) — для «де випадає предмет»; дрібні мітки не рахуються */
  const owner = (x, y) => {
    let best = null, bd = Infinity
    locs.near(x, y, MAX_R, (l) => {
      if (MINOR.has(l.type)) return
      const d = (l.x - x) ** 2 + (l.y - y) ** 2
      if (d <= l.r * l.r && d < bd) { bd = d; best = l }
    })
    return best
  }
  const S = { byLoc: out, owner }
  cache.set(P, S)
  return S
}

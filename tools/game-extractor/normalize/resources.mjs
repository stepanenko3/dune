/*
 * Тип ресурсу в точках мапи (план 5b-3). Точки ресурсів рівнів (normalizeMap → resources) мають лише групу точок гри
 * (Minerals, Scrap, Primrose…) і вид: основна (core — вузол руди) чи додаткова (aux — підбирання). Конкретну руду гра
 * вибирає при появі: рядки DT_ResourceTypes з цією групою, у кожного варіанта — карта тепла (HeatmapName у групі карт
 * мапи) і спавнери core/aux; можливий той, чия карта в точці > 0 (None — без карти, завжди). Тож точка йде під кожним
 * можливим типом з вагою = значення карти тепла. Тип — тип мітки гри з компонента спавнера (AzuriteOre, AzuritePickup).
 * Карта тепла покриває світ мапи (WorldGenerator: m_WorldOriginOffset — центр, m_WorldSizeInMeters): піксель i — X гри,
 * j — Y гри; сайт тримає точки як [Y гри, X гри].
 */

/**
 * HeatMapData → (i, j) → значення: палітра й індекси пікселів (рядками), у кожному 32-бітному слові floor(32/bits)
 * індексів (5 біт — по 6, решта бітів слова порожні; довжина масиву це й показує)
 */
export function heatSampler(h) {
  const W = h.m_SizeX, H = h.m_SizeY, bits = h.m_PaletteBitDepth, pal = h.m_PaletteColors ?? [], words = h.m_PackedColorIndices ?? []
  const mask = (1 << bits) - 1, per = bits ? Math.floor(32 / bits) : 1
  if (h.m_bStoredAsPalette === false) throw new Error('карта тепла без палітри — формат не розібрано')
  if (!bits && pal.length > 1) throw new Error(`карта тепла: ${pal.length} кольорів палітри без бітів на піксель`)
  if (bits && words.length !== Math.ceil((W * H) / per)) throw new Error(`карта тепла ${W}×${H} по ${bits} біт: ${words.length} слів замість ${Math.ceil((W * H) / per)}`)
  return (i, j) => {
    if (!(i >= 0 && j >= 0 && i < W && j < H)) return 0
    if (!bits) return pal[0] ?? 0
    const n = j * W + i
    return pal[((words[Math.floor(n / per)] >>> 0) >>> ((n % per) * bits)) & mask] ?? 0
  }
}

/**
 * points — точки ресурсів { id, map, kind: core|aux, type: група, x, y, z }; rows — DT_ResourceTypes; world —
 * { origin: {X, Y}, sizeM: {X, Y} }; heatmaps — { HeatmapName: HeatMapData }; markerOf(шлях класу спавнера) → тип мітки.
 * → записи { id, map, kind, type, weight, x, y, z }. Точка без можливої руди — без запису: гра там нічого не створить.
 * Жодної карти можливих руд точки мапа не має (малі мапи — без карт узагалі; Хаґґа — «розставлені» точки брухту з
 * картою Placeable…, якої в групі мапи нема) — руда рядків групи з найвищим пріоритетом (Priority), вага 100: гравці
 * бачать там руду. Імена груп і карт тепла — імена рушія, без огляду на регістр (PlaceableFuelHeatMap = …Heatmap).
 */
export function normalizeResources({ points, rows, world, heatmaps, markerOf }) {
  const byGroup = new Map()
  for (const r of Object.values(rows)) {
    const g = r.ResourcePointGroupName?.toLowerCase()
    if (!g || g === 'notused') continue
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g).push(r)
  }
  const samplers = world.sizeM ? Object.fromEntries(Object.entries(heatmaps).map(([k, h]) => [k.toLowerCase(), { s: heatSampler(h), W: h.m_SizeX, H: h.m_SizeY }])) : {}
  const sx = (world.sizeM?.X ?? 0) * 100, sy = (world.sizeM?.Y ?? 0) * 100
  const x0 = world.origin.X - sx / 2, y0 = world.origin.Y - sy / 2
  const markers = new Map()
  const marker = (path) => {
    if (!markers.has(path)) {
      const m = markerOf(path)
      if (!m) throw new Error(`спавнер ${String(path).split('/').pop()}: нема типу мітки`)
      markers.set(path, m)
    }
    return markers.get(path)
  }
  const out = []
  for (const p of points) {
    const gx = p.y, gy = p.x
    const types = new Map()
    // рядки, чиєї карти тепла мапа не має (світ без геометрії чи група без цієї карти): шляхи спавнерів; sampled —
    // хоч одну можливу руду точки визначила карта тепла (тоді 0 — справді нічого)
    const blind = []
    let sampled = false
    for (const r of byGroup.get(String(p.type).toLowerCase()) ?? []) {
      for (const v of r.SpawnerVariants ?? []) {
        const path = (p.kind === 'core' ? v.ResourceSpawnerClassCore : v.ResourceSpawnerClassAux)?.AssetPathName
        if (!path || path === 'None') continue
        const name = v.HeatmapName
        let heat = 100
        if (name && name !== 'None') {
          const m = samplers[name.toLowerCase()]
          if (!m) { blind.push([r.Priority ?? 0, path]); continue }
          sampled = true
          heat = m.s(Math.floor(((gx - x0) / sx) * m.W), Math.floor(((gy - y0) / sy) * m.H))
        }
        if (heat > 0) { const t = marker(path); types.set(t, Math.max(heat, types.get(t) ?? 0)) }
      }
    }
    // жодної карти можливих руд точки мапа не має (малі мапи; «розставлені» точки Хаґґи) — руда рядків з найвищим
    // пріоритетом групи (Бруд: Minerals дає ріоліт, пріоритет Stone 10); карта є, але дає 0 — руди нема
    if (!types.size && blind.length && !sampled) {
      const top = Math.max(...blind.map((b) => b[0]))
      for (const [pr, path] of blind) if (pr === top) types.set(marker(path), 100)
    }
    const base = { map: p.map, kind: p.kind }
    for (const [t, w] of [...types].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) out.push({ id: `${p.id}~${t}`, ...base, type: t, weight: w, x: p.x, y: p.y, z: p.z })
  }
  return out
}

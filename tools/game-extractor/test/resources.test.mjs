// Тип ресурсу в точці мапи: руду гра вибирає при появі з тих рядків DT_ResourceTypes групи точки, чия карта тепла в
// точці > 0, — тож точка йде під кожним можливим типом (тип мітки з компонента спавнера) з вагою = значення карти.
import { describe, expect, it } from 'vitest'
import { heatSampler, normalizeResources } from '../normalize/resources.mjs'

/** карта тепла W×H з палітрою й індексами пікселів (рядками): як у грі — у кожному 32-бітному слові floor(32/bits) індексів */
function heatmap(W, H, palette, bits, idx) {
  const per = Math.floor(32 / bits)
  const words = new Array(Math.ceil((W * H) / per)).fill(0)
  idx.forEach((v, n) => { words[Math.floor(n / per)] = (words[Math.floor(n / per)] | (v << ((n % per) * bits))) >>> 0 })
  return { m_SizeX: W, m_SizeY: H, m_bStoredAsPalette: true, m_PaletteBitDepth: bits, m_PaletteColors: palette, m_PackedColorIndices: words.map((w) => (w > 0x7fffffff ? w - 0x100000000 : w)) }
}

describe('карта тепла', () => {
  it('5 біт: по 6 індексів у слові (2 старші біти порожні), індекс не перетинає межу слова', () => {
    const idx = Array.from({ length: 16 }, (_, n) => n % 7)
    const s = heatSampler(heatmap(4, 4, [0, 10, 20, 30, 40, 50, 60], 5, idx))
    expect(Array.from({ length: 16 }, (_, n) => s(n % 4, Math.floor(n / 4)))).toEqual(idx.map((v) => v * 10))
    expect(s(-1, 0)).toBe(0)
    expect(s(4, 0)).toBe(0)
  })
  it('палітра з одного кольору (bit depth нема) — він скрізь', () => {
    expect(heatSampler({ m_SizeX: 2, m_SizeY: 2, m_bStoredAsPalette: true, m_PaletteColors: [0] })(1, 1)).toBe(0)
  })
  it('незнайомий формат — помилка розділу, а не тихо нулі', () => {
    const ok = heatmap(4, 4, [0, 10, 20], 2, new Array(16).fill(1))
    expect(() => heatSampler({ ...ok, m_bStoredAsPalette: false })).toThrow('палітр')
    expect(() => heatSampler({ ...ok, m_PackedColorIndices: ok.m_PackedColorIndices.slice(1) })).toThrow('слів')
    expect(() => heatSampler({ ...ok, m_PaletteBitDepth: undefined })).toThrow('біт')
  })
})

describe('тип ресурсу в точках', () => {
  // світ 400×400 м з центром (0, 0): карта 2×2 — квадранти по 200 м; пікселі: i — X гри, j — Y гри
  const world = { origin: { X: 0, Y: 0 }, sizeM: { X: 400, Y: 400 } }
  const heatmaps = {
    Stone: heatmap(2, 2, [0, 40], 1, [1, 0, 0, 0]), // лише i=0, j=0 (X < 0, Y < 0)
    Azurite: heatmap(2, 2, [0, 77], 1, [1, 1, 0, 0]), // j = 0 (Y < 0)
  }
  const sp = (n) => ({ AssetPathName: `/Game/Dune/Systems/GlobalDistribution/${n}.${n}_C` })
  const rows = {
    Stone: { ResourcePointGroupName: 'Minerals', SpawnerVariants: [{ HeatmapName: 'Stone', ResourceSpawnerClassCore: sp('BP_Rhyolite_Spawner'), ResourceSpawnerClassAux: sp('BP_Rhyolite_Pickup_Spawner') }] },
    Azurite: { ResourcePointGroupName: 'Minerals', SpawnerVariants: [{ HeatmapName: 'Azurite', ResourceSpawnerClassCore: sp('BP_Azurite_Spawner'), ResourceSpawnerClassAux: sp('BP_Azurite_Pickup_Spawner') }] },
    Cliff: { ResourcePointGroupName: 'CliffsideMinerals', SpawnerVariants: [{ HeatmapName: 'None', ResourceSpawnerClassCore: sp('BP_Cliff_Spawner'), ResourceSpawnerClassAux: { AssetPathName: '' } }] },
    Old: { ResourcePointGroupName: 'NOTUSED', SpawnerVariants: [{ HeatmapName: 'None', ResourceSpawnerClassCore: sp('BP_Azurite_Spawner') }] },
  }
  const MARK = { BP_Rhyolite_Spawner: 'RhyoliteOre', BP_Rhyolite_Pickup_Spawner: 'RhyolitePickup', BP_Azurite_Spawner: 'AzuriteOre', BP_Azurite_Pickup_Spawner: 'AzuritePickup', BP_Cliff_Spawner: 'AzuriteOre' }
  const markerOf = (path) => MARK[String(path).split('/').pop().replace(/\..*$/, '')] ?? null
  // точка сайту: x = Y гри, y = X гри
  const pt = (id, kind, type, gx, gy) => ({ id, map: 'survival_1', kind, type, x: gy, y: gx, z: 0 })
  const run = (points) => normalizeResources({ points, rows, world, heatmaps, markerOf })

  it('основна точка (core) — під кожним можливим типом з вагою; додаткова (aux) — підбирання', () => {
    expect(run([pt('p1', 'core', 'Minerals', -10000, -10000), pt('p2', 'aux', 'Minerals', -10000, -10000)])).toEqual([
      { id: 'p1~AzuriteOre', map: 'survival_1', kind: 'core', type: 'AzuriteOre', weight: 77, x: -10000, y: -10000, z: 0 },
      { id: 'p1~RhyoliteOre', map: 'survival_1', kind: 'core', type: 'RhyoliteOre', weight: 40, x: -10000, y: -10000, z: 0 },
      { id: 'p2~AzuritePickup', map: 'survival_1', kind: 'aux', type: 'AzuritePickup', weight: 77, x: -10000, y: -10000, z: 0 },
      { id: 'p2~RhyolitePickup', map: 'survival_1', kind: 'aux', type: 'RhyolitePickup', weight: 40, x: -10000, y: -10000, z: 0 },
    ])
  })

  it('карта тепла 0 — типу нема; жодного — точки нема (гра там нічого не створить); без карти (None) — завжди; спавнера нема — нема', () => {
    expect(run([pt('a', 'core', 'Minerals', 10000, -10000)]).map((r) => r.type)).toEqual(['AzuriteOre'])
    expect(run([pt('b', 'core', 'Minerals', 10000, 10000)])).toEqual([])
    expect(run([pt('c', 'core', 'CliffsideMinerals', 10000, 10000)]).map((r) => [r.type, r.weight])).toEqual([['AzuriteOre', 100]])
    expect(run([pt('d', 'aux', 'CliffsideMinerals', 10000, 10000)])).toEqual([])
  })

  it('карти тепла для руди на мапі нема (світ без геометрії чи група без цієї карти) — руда рядка з найвищим пріоритетом групи (як Бруд: Minerals → ріоліт)', () => {
    const prio = { ...rows, Stone: { ...rows.Stone, Priority: 10 }, Azurite: { ...rows.Azurite, Priority: 0 } }
    const noGeo = normalizeResources({ points: [pt('e', 'core', 'Minerals', -10000, -10000), pt('f', 'core', 'CliffsideMinerals', -10000, -10000)], rows: prio, world: { origin: { X: 0, Y: 0 } }, heatmaps, markerOf })
    expect(noGeo.map((r) => [r.id, r.weight])).toEqual([['e~RhyoliteOre', 100], ['f~AzuriteOre', 100]])
    const noMaps = normalizeResources({ points: [pt('g', 'aux', 'Minerals', 10000, 10000)], rows: prio, world, heatmaps: {}, markerOf })
    expect(noMaps.map((r) => [r.id, r.weight])).toEqual([['g~RhyolitePickup', 100]])
    // карта є, але тут 0 — руди нема (не запасний варіант)
    expect(normalizeResources({ points: [pt('h', 'core', 'Minerals', 10000, 10000)], rows: prio, world, heatmaps, markerOf })).toEqual([])
    // частина карт групи на мапі є (Хаґґа), а руди Глибокої пустелі (титан, свою карту мапа не має) — ні: запасного нема
    const dd = { ...prio, Titanium: { ResourcePointGroupName: 'Minerals', Priority: 5, SpawnerVariants: [{ HeatmapName: 'T6ResourceA', ResourceSpawnerClassCore: sp('BP_Titanium_Spawner'), ResourceSpawnerClassAux: { AssetPathName: '' } }] } }
    expect(normalizeResources({ points: [pt('i', 'core', 'Minerals', 10000, 10000)], rows: dd, world, heatmaps, markerOf: (x) => markerOf(x) ?? 'TitaniumOre' })).toEqual([])
    // точка, жодної карти можливих руд якої мапа не має, хоч інші карти є (Хаґґа: MetalAHeatmap лише з картою
    // PlaceableScrapMetal) — запасний варіант, як і на малих мапах: гравці бачать там брухт
    const metal = { ...prio, MetalA: { ResourcePointGroupName: 'MetalAHeatmap', Priority: 5, SpawnerVariants: [{ HeatmapName: 'PlaceableScrapMetal', ResourceSpawnerClassCore: sp('BP_Scrap_Spawner'), ResourceSpawnerClassAux: { AssetPathName: '' } }] } }
    expect(normalizeResources({ points: [pt('j', 'core', 'MetalAHeatmap', -10000, -10000)], rows: metal, world, heatmaps, markerOf: (x) => markerOf(x) ?? 'ScrapMetalWreckage' }).map((r) => [r.id, r.weight])).toEqual([['j~ScrapMetalWreckage', 100]])
  })

  it('назви груп і карт тепла — без огляду на регістр (імена рушія): PlaceableFuelHeatMap — група PlaceableFuelHeatmap', () => {
    const fuel = { ...rows, Fuel: { ResourcePointGroupName: 'PlaceableFuelHeatmap', SpawnerVariants: [{ HeatmapName: 'stone', ResourceSpawnerClassCore: sp('BP_Rhyolite_Spawner'), ResourceSpawnerClassAux: { AssetPathName: '' } }] } }
    expect(normalizeResources({ points: [pt('k', 'core', 'PlaceableFuelHeatMap', -10000, -10000)], rows: fuel, world, heatmaps, markerOf }).map((r) => [r.id, r.weight])).toEqual([['k~RhyoliteOre', 40]])
  })

  it('спавнер без типу мітки — помилка розділу (а не мовчки без руди)', () => {
    expect(() => normalizeResources({ points: [pt('p', 'core', 'Minerals', -10000, -10000)], rows, world, heatmaps, markerOf: () => null })).toThrow('BP_')
  })
})

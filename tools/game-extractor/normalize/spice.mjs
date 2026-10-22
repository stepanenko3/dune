/*
 * Великі поля меланжу Глибокої пустелі з розкладок гри (DA_DeepDesert_1_Layout_NN): кластери меланжу (WLC_Spice_*)
 * кладуть блок CB_Arrakis_Spice_Large_* у сталу локальну точку; світова точка = локальна + ClusterAnchor × 101600 (см).
 * Сайт тримає мапу в координатах TH.GL — [Y гри, X гри] (так само лежали й відомі місця гравців).
 */
const CELL = 101600
const LARGE = /Spice_Large/
const nameOf = (o) => /'([^']+)'/.exec(o?.ObjectName ?? '')?.[1] ?? String(o?.ObjectPath ?? '').split('/').pop().replace(/\.\d+$/, '')

/** layouts — { номер: експорт розкладки }, clusters — { ім'я кластера: експорт } */
export function normalizeSpice({ layouts, clusters }) {
  const out = []
  for (const [num, exp] of Object.entries(layouts)) {
    const layout = Number(num)
    const props = exp.find((e) => e.Type === 'WorldLayoutDataAsset')?.Properties ?? {}
    for (const c of props.m_Clusters ?? []) {
      const name = nameOf(c.Value.ClusterDataAsset)
      if (!/^WLC_Spice_/.test(name)) continue
      const cl = clusters[name]
      if (!cl) throw new Error(`розкладка ${num}: нема кластера ${name}`)
      const variation = c.Value.ClusterVariation ?? 'Default'
      const v = cl.find((e) => e.Properties?.m_Variations)?.Properties.m_Variations.find((x) => x.Key === variation)
      for (const b of v?.Value.TerrainBlocks ?? []) {
        if (!b.bIsEnabled || !LARGE.test(nameOf(b.TerrainBlockDataAsset))) continue
        const gx = b.Location.X + c.Value.ClusterAnchor.X * CELL
        const gy = b.Location.Y + c.Value.ClusterAnchor.Y * CELL
        out.push({ id: `${layout}@${gy}:${gx}`, layout, x: gy, y: gx, size: 'large' })
      }
    }
  }
  return out
}

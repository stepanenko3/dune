// Великі поля меланжу Глибокої пустелі з розкладок гри: кластер WLC_Spice_* кладе блок CB_Arrakis_Spice_Large_* у
// сталу локальну точку; світ = локальна + ClusterAnchor × 101600; сайт тримає мапу як [Y гри, X гри].
import { describe, expect, it } from 'vitest'
import { normalizeSpice } from '../normalize/spice.mjs'

const cluster = (blocks) => [{ Type: 'WorldLayoutClusterDataAsset', Properties: { m_Variations: [{ Key: 'Default', Value: { TerrainBlocks: blocks } }] } }]
const block = (x, y, asset, enabled = true) => ({ bIsEnabled: enabled, Location: { X: x, Y: y, Z: 0 }, TerrainBlockDataAsset: { ObjectName: `TerrainBlockDataAsset'${asset}'` } })
const ref = (name, x, y) => ({ Key: '1', Value: { ClusterAnchor: { X: x, Y: y }, ClusterDataAsset: { ObjectName: `WorldLayoutClusterDataAsset'${name}'`, ObjectPath: `/Game/Dune/Maps/Arrakis/SeaOfSand/${name}.0` }, ClusterVariation: 'Default' } })
const layout = (clusters) => [{ Type: 'WorldLayoutDataAsset', Properties: { m_Clusters: clusters, m_GenericActorsInstances: [] } }]

const clusters = {
  WLC_Spice_05: cluster([block(-1219200, -1117600, 'CB_Arrakis_Spice_Large_00')]),
  WLC_Spice_11: cluster([block(-1016000, -1016000, 'CB_Arrakis_Spice_Large_00'), block(0, 0, 'CB_Arrakis_Rock_01')]),
  WLC_Spice_13: cluster([block(5, 5, 'CB_Arrakis_Spice_Large_00', false)]),
}

describe('поля меланжу з розкладок гри', () => {
  it('великі поля: локальна точка блоку + якір × 101600; на сайті — [Y, X]', () => {
    const r = normalizeSpice({ layouts: { 2: layout([ref('WLC_Spice_05', 12, 0), ref('WLC_Spice_11', 0, 4), ref('WLC_Basic_01', 3, 3)]) }, clusters })
    expect(r).toEqual([
      { id: '2@-1117600:0', layout: 2, x: -1117600, y: 0, size: 'large' },
      { id: '2@-609600:-1016000', layout: 2, x: -609600, y: -1016000, size: 'large' },
    ])
  })

  it('вимкнений блок — не поле; розкладка без кластерів меланжу — без записів', () => {
    expect(normalizeSpice({ layouts: { 7: layout([ref('WLC_Spice_13', 1, 1)]), 8: layout([]) }, clusters })).toEqual([])
  })

  it('кластера, на який посилається розкладка, нема в експорті — помилка розділу', () => {
    expect(() => normalizeSpice({ layouts: { 3: layout([ref('WLC_Spice_99', 0, 0)]) }, clusters })).toThrow('WLC_Spice_99')
  })
})

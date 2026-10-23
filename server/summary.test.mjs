// «Що тут є» для локацій: лут контейнерів поблизу (рядки «предмет (шанс %)») і руда довкола — з даних TH.GL і з файлів
// гри (групи інші: локації — категорія легенди гри «Місцевість», руда — видобуток різопроменем і рослини).
import { describe, expect, it } from 'vitest'
import { summaries } from './lib/summary.mjs'

const P = (types) => ({ map: 'survival_1', layout: null, types })
describe('що тут є', () => {
  it('TH.GL: групи locations і resources', () => {
    const S = summaries(P({ cave: { pts: [0, 0, 0], info: {} }, basic: { pts: [100, 100, 0], info: { 0: [null, 'Солярії (100%)', null] } }, titanium: { pts: [200, 0, 0], info: {} } }),
      [{ id: 'locations', types: [{ id: 'cave' }] }, { id: 'resources', types: [{ id: 'titanium' }] }])
    expect(S.byLoc.cave[0]).toEqual({ boxes: 1, loot: [['Солярії', 100, 1]], res: [['titanium', 1]] })
  })
  it('файли гри: категорія легенди «Місцевість», видобуток різопроменем і рослини; радіус — за типом гри', () => {
    const S = summaries(P({ Cave: { pts: [0, 0, 0], info: {} }, BasicContainer: { pts: [100, 100, 0], info: { 0: [null, 'Солярії (100%) ×40', null, 'Solari (100%) ×40'] } }, TitaniumOre: { pts: [200, 0, 0], info: {} }, BrittleBush: { pts: [8500, 0, 0], info: {} } }),
      [{ id: 'ST_Localization_UI:UI/Map_Legend_Category_Location', types: [{ id: 'Cave' }] }, { id: 'cutteray', types: [{ id: 'TitaniumOre' }] }, { id: 'plants', types: [{ id: 'BrittleBush' }] }])
    expect(S.byLoc.Cave[0]).toEqual({ boxes: 1, loot: [['Солярії', 100, 1]], res: [['TitaniumOre', 1], ['BrittleBush', 1]] })
    expect(S.owner(150, 150)).toMatchObject({ type: 'Cave', i: 0 })
  })
  it('руда довкола — лише ймовірні місця (частка руди від 10 %, як типовий поріг мапи): місце, де руда буває рідко, не рахується', () => {
    const S = summaries(P({ Cave: { pts: [0, 0, 0], info: {} }, TitaniumOre: { pts: [200, 0, 0, 300, 0, 0, 400, 0, 0], info: {}, share: [5, 20, 100] } }),
      [{ id: 'ST_Localization_UI:UI/Map_Legend_Category_Location', types: [{ id: 'Cave' }] }, { id: 'cutteray', types: [{ id: 'TitaniumOre' }] }])
    expect(S.byLoc.Cave[0].res).toEqual([['TitaniumOre', 2]])
  })
})

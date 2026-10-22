/*
 * «Перша оселя» — стартова база на одну ділянку, лише з дешевих деталей (камінь; без пентащитів і пластону): дім 6 × 6
 * зі скатним дахом, усі ранні станції вздовж стін, ганок з вітропастками перед входом і прибудований гараж для
 * піскоцикла з гаражними воротами — техніка під дахом із першого дня. Розширюється на сусідні ділянки.
 */
import * as L from './lib.mjs'

export function starter() {
  const B = L.createBase('f')
  const claims = [{ x: -5, y: 0, w: 10, d: 10 }]
  const win = (e, i) => (i === 1 && ((Math.abs(e.m.x + 4) < 1e-6 && Math.abs(e.m.y - 5.5) < 1e-6) || (Math.abs(e.m.y - 8) < 1e-6 && Math.abs(e.m.x + 1.5) < 1e-6) || (Math.abs(e.m.y - 2) < 1e-6 && Math.abs(e.m.x - 1.5) < 1e-6)) ? 'MTX_Neut_DesertMechanic_Window_01' : null)
  B.block({ tiles: L.rect(-4, 2, 2, 8), z: 0, h: 3, roof: 'hip', wall: win, zone: { name: 'Дім', group: 'core' } })
  B.block({ tiles: L.rect(2, 5, 2, 8), z: 0, h: 3, zone: { name: 'Гараж', group: 'drive' } })
  B.block({ tiles: L.rect(-4, 2, 0, 2), z: 0, h: 0, roof: 'none', zone: { name: 'Ганок', group: 'deck' } })

  B.after((B) => {
    B.door({ x: -1, y: 2 }, { x: 0, y: 2 }, 0, 'Choam_Level2_Door_Frame')
    B.door({ x: 2, y: 6 }, { x: 2, y: 7 }, 0, 'Choam_Level2_Door_Frame')
    B.door({ x: 3, y: 2 }, { x: 4, y: 2 }, 0, 'Sardaukar_Garage_Door_Frame')
  })

  // станції: усе раннє вздовж стін, середина й вхід — вільні
  B.item('Totem_Placeable', -0.6, 5.0, 0)
  B.item('SurvivalFabricator_Placeable', -3.1, 7.1, 0)
  B.item('WeaponsFabricator_Placeable', -1.5, 7.1, 0)
  B.item('Fabricator_Placeable', 0.1, 7.1, 0)
  B.item('SmallOreRefinery_Placeable', -3.3, 4.9, 0)
  B.item('WaterCistern_Placeable', -3.1, 3.0, 0)
  B.item('StorageContainer_Placeable', 1.4, 3.0, 0)
  B.item('StorageContainer_Placeable', 1.4, 4.0, 0)
  B.item('Generator_Placeable', 1.3, 5.4, 0)
  B.item('Sandbike', 3.5, 5.0, 0, 90)
  B.item('Windtrap_Placeable', -3.2, 1.0, 0)
  B.item('Windtrap_Placeable', -2.0, 1.0, 0)

  const pieces = B.finish()
  return {
    claims, pieces, items: B.items, zones: B.zones,
    ui: {
      name: 'Перша оселя',
      lead: 'Стартова база на одну ділянку з самого каменю: дім 6 × 6 зі скатним дахом, усі ранні станції вздовж стін, ганок із вітропастками і прибудований гараж для піскоцикла — техніка під дахом із першого дня. Поруч лишається місце, щоб розширитися.',
      facts: ['<b>1</b> ділянка', 'дім <b>6 × 6</b> + гараж', 'лише камінь', 'усі ранні станції'],
    },
    levelNames: { 0: ['Рівень 0', 'дім, гараж, ганок'], roof: 'скатний дах дому, плаский дах гаража' },
  }
}

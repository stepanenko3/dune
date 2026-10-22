/*
 * Будівельні деталі баз — форми, як у грі (без наборів і текстур): фундаменти, перекриття й дахи, стіни (і з
 * прорізами: вікна, двері, ворота, проходи), скісні стіни під скатами, скати даху й кути, сходи й пандуси, колони,
 * поручні, драбина, люк, пентащит. Деталь у документі бази — { id, shape, x, y, z, rot, flip? }:
 *   - форма на плитці (at 'tile'): x, y — центр плитки, rot — поворот її рамки (градуси); квадрат — кути (±½, ±½),
 *     трикутник — основа знизу, вершина вгорі (сторона 1); скати й сходи піднімаються вздовж локальної +y;
 *   - форма на краю (at 'edge'): x, y — середина краю (чи кількох поспіль, len), rot — напрям краю a → b;
 *     локальна x — уздовж краю, нормаль — ліворуч від напряму;
 *   - форма у вершині (at 'vertex'): x, y — точка.
 * z — висота низу деталі в блоках (плита — верх: на ній стоять). Розміри (товщини, підйом скатів, прорізи) — у DIM:
 * у довіднику гри їх нема, взято на око; база зберігає лише форму й прив'язку, тож розміри можна підправити.
 * Ціни — з довідника (сардаукарський набір, а як форми там нема — перший набір, де вона є).
 * Склад — рівно деталі будівельних наборів гри з awakening.wiki (Module:Buildables/data/structures, 132 id) плюс дві
 * поверхні пентащита (пристрої «Pentashield Surface Vertical/Horizontal»). Своїх форм нема; давні id з наших баз —
 * у LEGACY (migrate переносить їх на ігрові).
 */
(function (root) {
  'use strict';

  const RT = Math.sqrt(3);
  const RI = 1 / (2 * RT); // від центру трикутника до основи
  const RC = 1 / RT; // від центру трикутника до вершини
  const EPS = 1e-6;

  /** розміри деталей (у плитках і блоках) */
  const DIM = {
    found: 0.3, // фундамент — товщина вниз від верху
    slab: 0.12, // перекриття, дах
    wall: 0.14,
    rail: 0.5, // висота поручня
    col: 0.3, // колона — перетин
    rise: 1, // підйом скату, сходів і пандуса на плитку
  };

  // ---------- ціни будівництва: знімок даних гри (рядок модуля → [[предмет, к-сть]…]); живі — з довідника ----------
  const PRICE = {
    Sardaukar_Foundation: [['Stone', 15]], Sardaukar_Foundation_Wedge: [['Stone', 15]], Sardaukar_Foundation_Round_Corner: [['Stone', 15]],
    Sardaukar_Floor_02: [['Stone', 10]], Sardaukar_Floor: [['Stone', 10]], Sardaukar_Floor_Wedge: [['Stone', 10]],
    Sardaukar_Floor_Round_Corner_02: [['Stone', 10]], Sardaukar_Floor_Round_Corner: [['Stone', 10]], Sardaukar_Floor_Round_Inverted: [['Stone', 10]],
    Atreides_Outpost_Floor_Triangle_Wide_Left: [['Plastone', 12]], Atreides_Outpost_Floor_Triangle_Wide_Right: [['Plastone', 12]], MTX_Atreides_Outpost_FloorLight_Movie: [['Stone', 8]],
    Choam_Level2_Hatch: [['Stone', 7]], Sardaukar_Rooftop_01: [['Stone', 10]], Sardaukar_Rooftop_02: [['Stone', 10]],
    Sardaukar_Rooftop_Wedge: [['Stone', 10]], Sardaukar_Rooftop_Round_Corner: [['Stone', 10]], Sardaukar_Rooftop_Round_Inverted: [['Stone', 10]],
    Sardaukar_Wall_01: [['Stone', 10]], Sardaukar_Wall_Half: [['Stone', 10]], MTX_Neut_DesertMechanic_Wall_02: [['Stone', 10]],
    Sardaukar_Wall_03: [['Stone', 10]], MTX_Smug_Wall_04: [['Stone', 10]], Sardaukar_Wall_02_L: [['Stone', 10]],
    Sardaukar_Wall_02: [['Stone', 10]], MTX_Atreides_Outpost_Bookshelf: [['Stone', 8]], Sardaukar_Wall_Round_Corner: [['Stone', 10]],
    Choam_Level2_Wall_Round_Corner_02: [['Stone', 10]], Choam_Level2_Window_Round_Corner_01: [['Stone', 10]], Sardaukar_Wall_Round_Corner_Half: [['Stone', 10]],
    MTX_Neut_DesertMechanic_Window_01: [['Stone', 10]], Sardaukar_Window_L: [['Stone', 10]], Sardaukar_Window: [['Stone', 10]],
    Choam_Level2_Window_02: [['Stone', 10]], Atreides_Outpost_Window_03: [['Plastone', 12]], Atreides_Outpost_Window_04: [['Plastone', 12]],
    Watershippers_Window_Wide: [['Stone', 10]], Sardaukar_Window_Round_Corner: [['Stone', 10]], Choam_Shelter_Window_Round_Corner_02_New: [['Stone', 8]],
    Choam_Level2_Door_Frame: [['Stone', 7]], Sardaukar_Door_Frame_L: [['Stone', 7]], Sardaukar_Door_Frame: [['Stone', 7]],
    MTX_Neut_DesertMechanic_Prudence_Door_Frame: [['Stone', 10]], Sardaukar_PrudenceDoor_Frame_L: [['Stone', 10]], Sardaukar_PrudenceDoor_Frame: [['Stone', 10]],
    MTX_Neut_DesertMechanic_Door_Frame_Wide: [['Stone', 20]], Atreides_Outpost_Door_Frame_Tall: [['Plastone', 10]], Sardaukar_Door_Frame_Tall_L: [['Stone', 7]],
    Sardaukar_Door_Frame_Tall: [['Stone', 7]], Sardaukar_Garage_Door_Frame: [['Stone', 20]], Atreides_Outpost_Gate_Big: [['Plastone', 12]],
    Sardaukar_Passageway: [['Stone', 10]], Sardaukar_Door_Frame_Wide: [['Stone', 20]], Watershippers_Arch_01: [['Stone', 15]],
    Sardaukar_Wall_Triangle_Bottom_Left: [['Stone', 10]], Sardaukar_Wall_Triangle_Bottom_Right: [['Stone', 10]], Sardaukar_Wall_Triangle_Top_Left: [['Stone', 10]],
    Sardaukar_Wall_Triangle_Top_Right: [['Stone', 10]], Sardaukar_Wall_Triangle_Bottom_Half_Left: [['Stone', 10]], Sardaukar_Wall_Triangle_Bottom_Half_Right: [['Stone', 10]],
    Sardaukar_Wall_Triangle_Top_Half_Left: [['Stone', 10]], Sardaukar_Wall_Triangle_Top_Half_Right: [['Stone', 10]], Sardaukar_Wall_Triangle_Bottom_Tall_Left: [['Stone', 10]],
    Sardaukar_Wall_Triangle_Bottom_Tall_Right: [['Stone', 10]], Sardaukar_Wall_Triangle_Top_Tall_Left: [['Stone', 10]], Sardaukar_Wall_Triangle_Top_Tall_Right: [['Stone', 10]],
    Atreides_Outpost_Wall_Triangle_Top_Wide_Left: [['Plastone', 12]], Atreides_Outpost_Wall_Triangle_Top_Wide_Right: [['Plastone', 12]], Atreides_Outpost_Wall_Inclined_Wide_Left: [['Plastone', 12]],
    Atreides_Outpost_Wall_Inclined_Wide_Right: [['Plastone', 12]], Harkonnen_Outpost_Wall_Inclined_Tall: [['Plastone', 12]], Sardaukar_Wall_Inclined_Tall_01_L: [['Stone', 10]],
    Sardaukar_Wall_Inclined_Tall_01: [['Stone', 10]], Sardaukar_Wall_Inclined_Tall_02_L: [['Stone', 10]], Sardaukar_Wall_Inclined_Tall_02: [['Stone', 10]],
    Harkonnen_Outpost_Wall_Corner_Tall: [['Plastone', 12]], Sardaukar_Wall_Inclined_Corner_Tall_L: [['Stone', 10]], Sardaukar_Wall_Inclined_Corner_Tall: [['Stone', 10]],
    Sardaukar_Window_Inclined_Tall_L: [['Stone', 10]], Sardaukar_Window_Inclined_Tall: [['Stone', 10]], Sardaukar_Roof_01: [['Stone', 10]],
    MTX_Smug_Roof_Half_02: [['Stone', 10]], Sardaukar_Roof_02_L: [['Stone', 10]], Sardaukar_Roof_02: [['Stone', 10]],
    Sardaukar_Roof_03_L: [['Stone', 10]], Sardaukar_Roof_03: [['Stone', 10]], Sardaukar_Roof_Corner: [['Stone', 10]],
    MTX_Smug_Roof_Corner_Half_02: [['Stone', 10]], Sardaukar_Roof_Corner_Inward: [['Stone', 10]], MTX_Smug_Roof_Corner_Half_Inverted_02: [['Stone', 10]],
    Sardaukar_Roof_Wedge_Bottom: [['Stone', 10]], Sardaukar_Roof_Wedge_Top: [['Stone', 10]], Sardaukar_Roof_Round_Corner: [['Stone', 10]],
    MTX_Smug_Roof_Round_Corner_Half_02: [['Stone', 10]], MTX_Smug_Roof_Round_Corner_Half_01_B: [['Stone', 10]], Choam_Level2_Roof_Cover_Bottom_Half_Left: [['Stone', 10]],
    Choam_Level2_Roof_Cover_Bottom_Half_Right: [['Stone', 10]], Atreides_Outpost_Roof_Cover_Top_Half_Left: [['Plastone', 12]], Atreides_Outpost_Roof_Cover_Top_Half_Right: [['Plastone', 12]],
    Sardaukar_Stairs: [['Stone', 10]], Sardaukar_Stairs_Corner: [['Stone', 10]], Sardaukar_Stairs_Corner_Inward: [['Stone', 10]],
    Sardaukar_Ramp: [['Stone', 10]], Sardaukar_Ramp_Corner: [['Stone', 10]], Sardaukar_Ramp_Corner_Inward: [['Stone', 10]],
    Sardaukar_Stairs_Half: [['Stone', 10]], Sardaukar_Stairs_Corner_Half: [['Stone', 10]], Sardaukar_Stairs_Corner_Half_Inward: [['Stone', 10]],
    Sardaukar_Ramp_Half: [['Stone', 10]], Sardaukar_Ramp_Corner_Half: [['Stone', 10]], Sardaukar_Ramp_Corner_Half_Inward: [['Stone', 10]],
    Atreides_Outpost_Stair_Wide: [['Plastone', 12]], Atreides_Outpost_Ramp_Wide: [['Plastone', 12]], Atreides_Outpost_Ramp_Edge_Wide_Left: [['Plastone', 12]],
    Atreides_Outpost_Ramp_Edge_Wide_Right: [['Plastone', 12]], Sardaukar_Pillar_Bottom: [['Stone', 10]], Sardaukar_Pillar_Middle: [['Stone', 10]],
    Sardaukar_Pillar_Top: [['Stone', 10]], Sardaukar_Column_corner: [['Stone', 10]], Sardaukar_Column: [['Stone', 10]],
    MTX_Choam_TwitchReward_Column_02: [['Stone', 10]], Sardaukar_Railing: [['Stone', 10]], MTX_Neut_Gunner_Railing_02: [['Stone', 10]],
    Sardaukar_Railing_Gate: [['Stone', 10]], Sardaukar_Railing_Round_Corner: [['Stone', 10]], Sardaukar_Railing_Inclined: [['Stone', 10]],
    MTX_Smug_Railing_Inclined_Left: [['Stone', 10]], MTX_Smug_Railing_Inclined_Right: [['Stone', 10]], Sardaukar_Railing_Inclined_Half: [['Stone', 10]],
    MTX_Smug_Railing_Inclined_Half_Left: [['Stone', 10]], MTX_Smug_Railing_Inclined_Right_Half: [['Stone', 10]], Choam_Level2_Ladder: [['Stone', 10]],
    Choam_PentashieldSurfaceVertical_Placeable: [['CobaltBar', 20], ['SteelBar', 2], ['T3MiningGalleryComponent1', 6]], Choam_PentashieldSurfaceHorizontal_Placeable: [['CobaltBar', 20], ['SteelBar', 2], ['T3MiningGalleryComponent1', 6]],
  };
  const costOf = (id) => (PRICE[id] || []).map((x) => [...x]);

  // ---------- форми ----------
  // родини: slab (плита на плитці), wall (стіна на краю, може з прорізом hole і стулкою panel), wedge (скісна стіна),
  // slope (плита з висотами по вершинах: скат, сходи, пандус), column, rail, ladder, shield
  const S = {};
  const def = (id, name, cat, o) => { S[id] = { id, name, cat, len: 1, h: 0, ...o }; };

  // форми — рядки гри (набір сардаукарів, а якої форми там нема — перший набір гри, де вона є); властивості —
  // геометрія двигуна: родина, прив'язка, висоти, прорізи. Ціни — з даних гри (PRICE нижче, знімок пакета).
  // Фундаменти
  def('Sardaukar_Foundation', 'Фундамент', 'found', { h: 0, family: 'slab', at: 'tile', tile: 's', kind: 'fsq' });
  def('Sardaukar_Foundation_Wedge', 'Фундамент трикутний', 'found', { h: 0, family: 'slab', at: 'tile', tile: 't', kind: 'ftri' });
  def('Sardaukar_Foundation_Round_Corner', 'Фундамент заокруглений', 'found', { h: 0, family: 'slab', at: 'tile', tile: 'r', kind: 'fsq' });
  // Перекриття
  def('Sardaukar_Floor_02', 'Перекриття', 'floor', { h: 0, family: 'slab', at: 'tile', tile: 's', kind: 'csq' });
  def('Sardaukar_Floor', 'Перекриття (вар. 2)', 'floor', { h: 0, family: 'slab', at: 'tile', tile: 's', kind: 'csq', variantOf: 'Sardaukar_Floor_02' });
  def('Sardaukar_Floor_Wedge', 'Перекриття трикутне', 'floor', { h: 0, family: 'slab', at: 'tile', tile: 't', kind: 'ctri' });
  def('Sardaukar_Floor_Round_Corner_02', 'Перекриття заокруглене', 'floor', { h: 0, family: 'slab', at: 'tile', tile: 'r', kind: 'csq' });
  def('Sardaukar_Floor_Round_Corner', 'Перекриття заокруглене (вар. 2)', 'floor', { h: 0, family: 'slab', at: 'tile', tile: 'r', kind: 'csq', variantOf: 'Sardaukar_Floor_Round_Corner_02' });
  def('Sardaukar_Floor_Round_Inverted', 'Перекриття, внутрішнє заокруглення', 'floor', { h: 0, family: 'slab', at: 'tile', tile: 'ri', kind: 'csq' });
  def('Atreides_Outpost_Floor_Triangle_Wide_Left', 'Перекриття трикутне широке, ліве', 'floor', { h: 0, family: 'slab', at: 'tile', tile: 't', kind: 'ctri', variantOf: 'Sardaukar_Floor_Wedge' });
  def('Atreides_Outpost_Floor_Triangle_Wide_Right', 'Перекриття трикутне широке, праве', 'floor', { h: 0, family: 'slab', at: 'tile', tile: 't', kind: 'ctri', variantOf: 'Sardaukar_Floor_Wedge' });
  def('MTX_Atreides_Outpost_FloorLight_Movie', 'Стеля', 'floor', { h: 0, family: 'slab', at: 'tile', tile: 's', kind: 'csq', variantOf: 'Sardaukar_Floor_02' });
  def('Choam_Level2_Hatch', 'Люк', 'floor', { h: 0, family: 'slab', at: 'tile', tile: 's', kind: 'csq', hatch: true });
  // Дахи
  def('Sardaukar_Rooftop_01', 'Дах плаский', 'roof', { h: 0, family: 'slab', at: 'tile', tile: 's', kind: 'csq' });
  def('Sardaukar_Rooftop_02', 'Дах плаский (вар. 2)', 'roof', { h: 0, family: 'slab', at: 'tile', tile: 's', kind: 'csq', variantOf: 'Sardaukar_Rooftop_01' });
  def('Sardaukar_Rooftop_Wedge', 'Дах трикутний', 'roof', { h: 0, family: 'slab', at: 'tile', tile: 't', kind: 'ctri' });
  def('Sardaukar_Rooftop_Round_Corner', 'Дах заокруглений', 'roof', { h: 0, family: 'slab', at: 'tile', tile: 'r', kind: 'csq' });
  def('Sardaukar_Rooftop_Round_Inverted', 'Дах, внутрішнє заокруглення', 'roof', { h: 0, family: 'slab', at: 'tile', tile: 'ri', kind: 'csq' });
  // Стіни
  def('Sardaukar_Wall_01', 'Стіна', 'wall', { h: 1, family: 'wall', at: 'edge', kind: 'wall' });
  def('Sardaukar_Wall_Half', 'Напівстіна', 'wall', { h: 0.5, family: 'wall', at: 'edge', kind: 'wall' });
  def('MTX_Neut_DesertMechanic_Wall_02', 'Стіна (вар. 2)', 'wall', { h: 1, family: 'wall', at: 'edge', kind: 'wall', variantOf: 'Sardaukar_Wall_01' });
  def('Sardaukar_Wall_03', 'Стіна (вар. 3)', 'wall', { h: 1, family: 'wall', at: 'edge', kind: 'wall', variantOf: 'Sardaukar_Wall_01' });
  def('MTX_Smug_Wall_04', 'Стіна (вар. 4)', 'wall', { h: 1, family: 'wall', at: 'edge', kind: 'wall', variantOf: 'Sardaukar_Wall_01' });
  def('Sardaukar_Wall_02_L', 'Стіна ліва (вар. 2)', 'wall', { h: 1, family: 'wall', at: 'edge', kind: 'wall', variantOf: 'Sardaukar_Wall_01' });
  def('Sardaukar_Wall_02', 'Стіна права (вар. 2)', 'wall', { h: 1, family: 'wall', at: 'edge', kind: 'wall', variantOf: 'Sardaukar_Wall_01' });
  def('MTX_Atreides_Outpost_Bookshelf', 'Стіна з полицями', 'wall', { h: 1, family: 'wall', at: 'edge', kind: 'wall', variantOf: 'Sardaukar_Wall_01' });
  def('Sardaukar_Wall_Round_Corner', 'Стіна заокруглена', 'wall', { h: 1, family: 'wall', at: 'edge', kind: 'wall', bow: 0.18 });
  def('Choam_Level2_Wall_Round_Corner_02', 'Стіна заокруглена (вар. 2)', 'wall', { h: 1, family: 'wall', at: 'edge', kind: 'wall', bow: 0.18, variantOf: 'Sardaukar_Wall_Round_Corner' });
  def('Choam_Level2_Window_Round_Corner_01', 'Стіна заокруглена (вар. 3)', 'wall', { h: 1, family: 'wall', at: 'edge', kind: 'wall', bow: 0.18, variantOf: 'Sardaukar_Wall_Round_Corner' });
  def('Sardaukar_Wall_Round_Corner_Half', 'Напівстіна заокруглена', 'wall', { h: 0.5, family: 'wall', at: 'edge', kind: 'wall', bow: 0.18 });
  // Вікна, двері, проходи
  def('MTX_Neut_DesertMechanic_Window_01', 'Вікно', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'window', hole: [-0.28, 0.28, 0.38, 0.78], panel: 'glass' });
  def('Sardaukar_Window_L', 'Вікно ліве', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'window', hole: [-0.28, 0.28, 0.38, 0.78], panel: 'glass', variantOf: 'MTX_Neut_DesertMechanic_Window_01' });
  def('Sardaukar_Window', 'Вікно праве', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'window', hole: [-0.28, 0.28, 0.38, 0.78], panel: 'glass', variantOf: 'MTX_Neut_DesertMechanic_Window_01' });
  def('Choam_Level2_Window_02', 'Вікно (вар. 2)', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'window', hole: [-0.28, 0.28, 0.38, 0.78], panel: 'glass', variantOf: 'MTX_Neut_DesertMechanic_Window_01' });
  def('Atreides_Outpost_Window_03', 'Вікно (вар. 3)', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'window', hole: [-0.28, 0.28, 0.38, 0.78], panel: 'glass', variantOf: 'MTX_Neut_DesertMechanic_Window_01' });
  def('Atreides_Outpost_Window_04', 'Вікно (вар. 4)', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'window', hole: [-0.28, 0.28, 0.38, 0.78], panel: 'glass', variantOf: 'MTX_Neut_DesertMechanic_Window_01' });
  def('Watershippers_Window_Wide', 'Вікно широке', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'window', hole: [-0.42, 0.42, 0.3, 0.82], panel: 'glass' });
  def('Sardaukar_Window_Round_Corner', 'Вікно заокруглене', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'window', hole: [-0.28, 0.28, 0.38, 0.78], panel: 'glass', bow: 0.18 });
  def('Choam_Shelter_Window_Round_Corner_02_New', 'Вікно заокруглене (вар. 2)', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'window', hole: [-0.28, 0.28, 0.38, 0.78], panel: 'glass', bow: 0.18, variantOf: 'Sardaukar_Window_Round_Corner' });
  def('Choam_Level2_Door_Frame', 'Двері', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'door', hole: [-0.3, 0.3, 0, 0.82], panel: 'door' });
  def('Sardaukar_Door_Frame_L', 'Двері ліві', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'door', hole: [-0.3, 0.3, 0, 0.82], panel: 'door', variantOf: 'Choam_Level2_Door_Frame' });
  def('Sardaukar_Door_Frame', 'Двері праві', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'door', hole: [-0.3, 0.3, 0, 0.82], panel: 'door', variantOf: 'Choam_Level2_Door_Frame' });
  def('MTX_Neut_DesertMechanic_Prudence_Door_Frame', 'Двері «Prudence»', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'door', hole: [-0.3, 0.3, 0, 0.82], panel: 'door' });
  def('Sardaukar_PrudenceDoor_Frame_L', 'Двері «Prudence» ліві', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'door', hole: [-0.3, 0.3, 0, 0.82], panel: 'door', variantOf: 'MTX_Neut_DesertMechanic_Prudence_Door_Frame' });
  def('Sardaukar_PrudenceDoor_Frame', 'Двері «Prudence» праві', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'door', hole: [-0.3, 0.3, 0, 0.82], panel: 'door', variantOf: 'MTX_Neut_DesertMechanic_Prudence_Door_Frame' });
  def('MTX_Neut_DesertMechanic_Door_Frame_Wide', 'Двері широкі', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'door', hole: [-0.42, 0.42, 0, 0.82], panel: 'door' });
  def('Atreides_Outpost_Door_Frame_Tall', 'Двері високі', 'open', { h: 2, family: 'wall', at: 'edge', kind: 'door', hole: [-0.32, 0.32, 0, 1.6], panel: 'door' });
  def('Sardaukar_Door_Frame_Tall_L', 'Двері високі ліві', 'open', { h: 2, family: 'wall', at: 'edge', kind: 'door', hole: [-0.32, 0.32, 0, 1.6], panel: 'door', variantOf: 'Atreides_Outpost_Door_Frame_Tall' });
  def('Sardaukar_Door_Frame_Tall', 'Двері високі праві', 'open', { h: 2, family: 'wall', at: 'edge', kind: 'door', hole: [-0.32, 0.32, 0, 1.6], panel: 'door', variantOf: 'Atreides_Outpost_Door_Frame_Tall' });
  def('Sardaukar_Garage_Door_Frame', 'Гаражні ворота', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'door', hole: [-0.45, 0.45, 0, 0.9], panel: 'gate' });
  def('Atreides_Outpost_Gate_Big', 'Великі ворота', 'open', { len: 3, h: 2, family: 'wall', at: 'edge', kind: 'door', hole: [-1.42, 1.42, 0, 1.8], panel: 'gate' });
  def('Sardaukar_Passageway', 'Прохід', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'open', hole: [-0.38, 0.38, 0, 0.86] });
  def('Sardaukar_Door_Frame_Wide', 'Прохід широкий', 'open', { len: 2, h: 1, family: 'wall', at: 'edge', kind: 'open', hole: [-0.9, 0.9, 0, 0.86] });
  def('Watershippers_Arch_01', 'Арка', 'open', { h: 1, family: 'wall', at: 'edge', kind: 'open', hole: [-0.4, 0.4, 0, 0.8], arch: true });
  // Скісні й похилі стіни
  def('Sardaukar_Wall_Triangle_Bottom_Left', 'Скісна стіна, низ, ліва', 'wedge', { h: 1, family: 'wedge', at: 'edge', dir: 'bl', kind: 'wedge' });
  def('Sardaukar_Wall_Triangle_Bottom_Right', 'Скісна стіна, низ, права', 'wedge', { h: 1, family: 'wedge', at: 'edge', dir: 'br', kind: 'wedge' });
  def('Sardaukar_Wall_Triangle_Top_Left', 'Скісна стіна, верх, ліва', 'wedge', { h: 1, family: 'wedge', at: 'edge', dir: 'tl', kind: 'wedge' });
  def('Sardaukar_Wall_Triangle_Top_Right', 'Скісна стіна, верх, права', 'wedge', { h: 1, family: 'wedge', at: 'edge', dir: 'tr', kind: 'wedge' });
  def('Sardaukar_Wall_Triangle_Bottom_Half_Left', 'Скісна пів-стіна, низ, ліва', 'wedge', { h: 0.5, family: 'wedge', at: 'edge', dir: 'bl', kind: 'wedge' });
  def('Sardaukar_Wall_Triangle_Bottom_Half_Right', 'Скісна пів-стіна, низ, права', 'wedge', { h: 0.5, family: 'wedge', at: 'edge', dir: 'br', kind: 'wedge' });
  def('Sardaukar_Wall_Triangle_Top_Half_Left', 'Скісна пів-стіна, верх, ліва', 'wedge', { h: 0.5, family: 'wedge', at: 'edge', dir: 'tl', kind: 'wedge' });
  def('Sardaukar_Wall_Triangle_Top_Half_Right', 'Скісна пів-стіна, верх, права', 'wedge', { h: 0.5, family: 'wedge', at: 'edge', dir: 'tr', kind: 'wedge' });
  def('Sardaukar_Wall_Triangle_Bottom_Tall_Left', 'Скісна висока стіна, низ, ліва', 'wedge', { h: 3, family: 'wedge', at: 'edge', dir: 'bl', kind: 'wedge' });
  def('Sardaukar_Wall_Triangle_Bottom_Tall_Right', 'Скісна висока стіна, низ, права', 'wedge', { h: 3, family: 'wedge', at: 'edge', dir: 'br', kind: 'wedge' });
  def('Sardaukar_Wall_Triangle_Top_Tall_Left', 'Скісна висока стіна, верх, ліва', 'wedge', { h: 3, family: 'wedge', at: 'edge', dir: 'tl', kind: 'wedge' });
  def('Sardaukar_Wall_Triangle_Top_Tall_Right', 'Скісна висока стіна, верх, права', 'wedge', { h: 3, family: 'wedge', at: 'edge', dir: 'tr', kind: 'wedge' });
  def('Atreides_Outpost_Wall_Triangle_Top_Wide_Left', 'Скісна стіна широка, верх, ліва', 'wedge', { len: 2, h: 1, family: 'wedge', at: 'edge', dir: 'tl', kind: 'wedge' });
  def('Atreides_Outpost_Wall_Triangle_Top_Wide_Right', 'Скісна стіна широка, верх, права', 'wedge', { len: 2, h: 1, family: 'wedge', at: 'edge', dir: 'tr', kind: 'wedge' });
  def('Atreides_Outpost_Wall_Inclined_Wide_Left', 'Похила стіна широка, ліва', 'wedge', { len: 2, h: 1, family: 'wedge', at: 'edge', dir: 'bl', kind: 'wedge' });
  def('Atreides_Outpost_Wall_Inclined_Wide_Right', 'Похила стіна широка, права', 'wedge', { len: 2, h: 1, family: 'wedge', at: 'edge', dir: 'br', kind: 'wedge' });
  def('Harkonnen_Outpost_Wall_Inclined_Tall', 'Високий пандус (похила стіна)', 'wedge', { h: 3, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 3, 3], kind: 'lean', wall: true });
  def('Sardaukar_Wall_Inclined_Tall_01_L', 'Високий пандус (похила стіна), ліва', 'wedge', { h: 3, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 3, 3], kind: 'lean', wall: true, variantOf: 'Harkonnen_Outpost_Wall_Inclined_Tall' });
  def('Sardaukar_Wall_Inclined_Tall_01', 'Високий пандус (похила стіна), права', 'wedge', { h: 3, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 3, 3], kind: 'lean', wall: true, variantOf: 'Harkonnen_Outpost_Wall_Inclined_Tall' });
  def('Sardaukar_Wall_Inclined_Tall_02_L', 'Високий пандус (похила стіна), ліва 2', 'wedge', { h: 3, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 3, 3], kind: 'lean', wall: true, variantOf: 'Harkonnen_Outpost_Wall_Inclined_Tall' });
  def('Sardaukar_Wall_Inclined_Tall_02', 'Високий пандус (похила стіна), права 2', 'wedge', { h: 3, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 3, 3], kind: 'lean', wall: true, variantOf: 'Harkonnen_Outpost_Wall_Inclined_Tall' });
  def('Harkonnen_Outpost_Wall_Corner_Tall', 'Високий пандус, кут', 'wedge', { h: 3, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 3, 0], kind: 'lean', wall: true });
  def('Sardaukar_Wall_Inclined_Corner_Tall_L', 'Високий пандус, кут лівий', 'wedge', { h: 3, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 3, 0], kind: 'lean', wall: true, variantOf: 'Harkonnen_Outpost_Wall_Corner_Tall' });
  def('Sardaukar_Wall_Inclined_Corner_Tall', 'Високий пандус, кут правий', 'wedge', { h: 3, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 3, 0], kind: 'lean', wall: true, variantOf: 'Harkonnen_Outpost_Wall_Corner_Tall' });
  def('Sardaukar_Window_Inclined_Tall_L', 'Похила стіна з вікном, ліва', 'wedge', { h: 3, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 3, 3], kind: 'lean', wall: true, glass: true });
  def('Sardaukar_Window_Inclined_Tall', 'Похила стіна з вікном, права', 'wedge', { h: 3, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 3, 3], kind: 'lean', wall: true, glass: true, variantOf: 'Sardaukar_Window_Inclined_Tall_L' });
  // Дахи
  def('Sardaukar_Roof_01', 'Скат даху', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'slope' });
  def('MTX_Smug_Roof_Half_02', 'Скат даху (вар. 2)', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'slope', variantOf: 'Sardaukar_Roof_01' });
  def('Sardaukar_Roof_02_L', 'Скат даху лівий (вар. 2)', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'slope', variantOf: 'Sardaukar_Roof_01' });
  def('Sardaukar_Roof_02', 'Скат даху правий (вар. 2)', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'slope', variantOf: 'Sardaukar_Roof_01' });
  def('Sardaukar_Roof_03_L', 'Скат даху лівий (вар. 3)', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'slope', variantOf: 'Sardaukar_Roof_01' });
  def('Sardaukar_Roof_03', 'Скат даху правий (вар. 3)', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'slope', variantOf: 'Sardaukar_Roof_01' });
  def('Sardaukar_Roof_Corner', 'Кут даху зовнішній', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 0], kind: 'slope' });
  def('MTX_Smug_Roof_Corner_Half_02', 'Кут даху зовнішній (вар. 2)', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 0], kind: 'slope', variantOf: 'Sardaukar_Roof_Corner' });
  def('Sardaukar_Roof_Corner_Inward', 'Кут даху внутрішній', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 1, 1, 1], kind: 'slope' });
  def('MTX_Smug_Roof_Corner_Half_Inverted_02', 'Кут даху внутрішній (вар. 2)', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 1, 1, 1], kind: 'slope', variantOf: 'Sardaukar_Roof_Corner_Inward' });
  def('Sardaukar_Roof_Wedge_Bottom', 'Скат трикутний, низ', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 't', hs: [0, 0, 1], kind: 'slope' });
  def('Sardaukar_Roof_Wedge_Top', 'Скат трикутний, верх', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 't', hs: [1, 1, 0], kind: 'slope' });
  def('Sardaukar_Roof_Round_Corner', 'Скат заокруглений', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'slope', bow: true });
  def('MTX_Smug_Roof_Round_Corner_Half_02', 'Скат заокруглений (вар. 2)', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'slope', bow: true, variantOf: 'Sardaukar_Roof_Round_Corner' });
  def('MTX_Smug_Roof_Round_Corner_Half_01_B', 'Скат заокруглений (вар. 3)', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'slope', bow: true, variantOf: 'Sardaukar_Roof_Round_Corner' });
  def('Choam_Level2_Roof_Cover_Bottom_Half_Left', 'Накривка даху, низ, ліва', 'roof', { h: 0.5, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 0.5, 0.5], kind: 'slope', variantOf: 'Choam_Level2_Roof_Cover_Bottom_Half_Right' });
  def('Choam_Level2_Roof_Cover_Bottom_Half_Right', 'Накривка даху, низ', 'roof', { h: 0.5, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 0.5, 0.5], kind: 'slope' });
  def('Atreides_Outpost_Roof_Cover_Top_Half_Left', 'Накривка даху, верх, ліва', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0.5, 0.5, 1, 1], kind: 'slope', variantOf: 'Atreides_Outpost_Roof_Cover_Top_Half_Right' });
  def('Atreides_Outpost_Roof_Cover_Top_Half_Right', 'Накривка даху, верх', 'roof', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0.5, 0.5, 1, 1], kind: 'slope' });
  // Сходи й пандуси
  def('Sardaukar_Stairs', 'Сходи', 'incline', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'stairs', steps: true });
  def('Sardaukar_Stairs_Corner', 'Сходи, зовнішній кут', 'incline', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 0], kind: 'stairs', steps: true });
  def('Sardaukar_Stairs_Corner_Inward', 'Сходи, внутрішній кут', 'incline', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 1, 1, 1], kind: 'stairs', steps: true });
  def('Sardaukar_Ramp', 'Пандус', 'incline', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'ramp' });
  def('Sardaukar_Ramp_Corner', 'Пандус, зовнішній кут', 'incline', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 0], kind: 'ramp' });
  def('Sardaukar_Ramp_Corner_Inward', 'Пандус, внутрішній кут', 'incline', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 1, 1, 1], kind: 'ramp' });
  def('Sardaukar_Stairs_Half', 'Пів-сходи', 'incline', { h: 0.5, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 0.5, 0.5], kind: 'stairs', steps: true });
  def('Sardaukar_Stairs_Corner_Half', 'Пів-сходи, зовнішній кут', 'incline', { h: 0.5, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 0.5, 0], kind: 'stairs', steps: true });
  def('Sardaukar_Stairs_Corner_Half_Inward', 'Пів-сходи, внутрішній кут', 'incline', { h: 0.5, family: 'slope', at: 'tile', tile: 's', hs: [0, 0.5, 0.5, 0.5], kind: 'stairs', steps: true });
  def('Sardaukar_Ramp_Half', 'Пів-пандус', 'incline', { h: 0.5, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 0.5, 0.5], kind: 'ramp' });
  def('Sardaukar_Ramp_Corner_Half', 'Пів-пандус, зовнішній кут', 'incline', { h: 0.5, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 0.5, 0], kind: 'ramp' });
  def('Sardaukar_Ramp_Corner_Half_Inward', 'Пів-пандус, внутрішній кут', 'incline', { h: 0.5, family: 'slope', at: 'tile', tile: 's', hs: [0, 0.5, 0.5, 0.5], kind: 'ramp' });
  def('Atreides_Outpost_Stair_Wide', 'Сходи широкі', 'incline', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'stairs', steps: true, variantOf: 'Sardaukar_Stairs' });
  def('Atreides_Outpost_Ramp_Wide', 'Пандус широкий', 'incline', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'ramp', variantOf: 'Sardaukar_Ramp' });
  def('Atreides_Outpost_Ramp_Edge_Wide_Left', 'Пандус широкий, край лівий', 'incline', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'ramp', variantOf: 'Sardaukar_Ramp' });
  def('Atreides_Outpost_Ramp_Edge_Wide_Right', 'Пандус широкий, край правий', 'incline', { h: 1, family: 'slope', at: 'tile', tile: 's', hs: [0, 0, 1, 1], kind: 'ramp', variantOf: 'Sardaukar_Ramp' });
  // Колони
  def('Sardaukar_Pillar_Bottom', 'Колона, низ', 'column', { h: 1, family: 'column', at: 'vertex', size: 0.3, kind: 'pillar', variantOf: 'Sardaukar_Pillar_Middle' });
  def('Sardaukar_Pillar_Middle', 'Колона', 'column', { h: 1, family: 'column', at: 'vertex', size: 0.3, kind: 'pillar' });
  def('Sardaukar_Pillar_Top', 'Колона, верх', 'column', { h: 1, family: 'column', at: 'vertex', size: 0.3, kind: 'pillar', variantOf: 'Sardaukar_Pillar_Middle' });
  def('Sardaukar_Column_corner', 'Колона кутова', 'column', { h: 1, family: 'column', at: 'vertex', size: 0.24, kind: 'pillar' });
  def('Sardaukar_Column', 'Колона центральна', 'column', { h: 1, family: 'column', at: 'vertex', size: 0.4, kind: 'pillar' });
  def('MTX_Choam_TwitchReward_Column_02', 'Колона центральна (вар. 2)', 'column', { h: 1, family: 'column', at: 'vertex', size: 0.4, kind: 'pillar', variantOf: 'Sardaukar_Column' });
  // Поручні
  def('Sardaukar_Railing', 'Поручень', 'rail', { h: 0.5, family: 'rail', at: 'edge', kind: 'rail' });
  def('MTX_Neut_Gunner_Railing_02', 'Поручень (вар. 2)', 'rail', { h: 0.5, family: 'rail', at: 'edge', kind: 'rail', variantOf: 'Sardaukar_Railing' });
  def('Sardaukar_Railing_Gate', 'Хвіртка', 'rail', { h: 0.5, family: 'rail', at: 'edge', kind: 'rail', gate: true });
  def('Sardaukar_Railing_Round_Corner', 'Поручень заокруглений', 'rail', { len: 1.4142135623730951, h: 0.5, family: 'rail', at: 'edge', kind: 'rail', arc: 1 });
  def('Sardaukar_Railing_Inclined', 'Поручень похилий', 'rail', { h: 0.5, family: 'rail', at: 'edge', kind: 'rail', incline: 1 });
  def('MTX_Smug_Railing_Inclined_Left', 'Поручень похилий лівий', 'rail', { h: 0.5, family: 'rail', at: 'edge', kind: 'rail', incline: 1, variantOf: 'Sardaukar_Railing_Inclined' });
  def('MTX_Smug_Railing_Inclined_Right', 'Поручень похилий правий', 'rail', { h: 0.5, family: 'rail', at: 'edge', kind: 'rail', incline: 1, variantOf: 'Sardaukar_Railing_Inclined' });
  def('Sardaukar_Railing_Inclined_Half', 'Поручень похилий, пів', 'rail', { h: 0.5, family: 'rail', at: 'edge', kind: 'rail', incline: 0.5 });
  def('MTX_Smug_Railing_Inclined_Half_Left', 'Поручень похилий, пів, лівий', 'rail', { h: 0.5, family: 'rail', at: 'edge', kind: 'rail', incline: 0.5, variantOf: 'Sardaukar_Railing_Inclined_Half' });
  def('MTX_Smug_Railing_Inclined_Right_Half', 'Поручень похилий, пів, правий', 'rail', { h: 0.5, family: 'rail', at: 'edge', kind: 'rail', incline: 0.5, variantOf: 'Sardaukar_Railing_Inclined_Half' });
  def('Choam_Level2_Ladder', 'Драбина', 'rail', { h: 1, family: 'ladder', at: 'edge', kind: 'rail' });
  // Пентащит
  def('Choam_PentashieldSurfaceVertical_Placeable', 'Пентащит, вертикальна поверхня', 'shield', { h: 1, family: 'shield', at: 'edge', kind: 'shield', shield: true });
  def('Choam_PentashieldSurfaceHorizontal_Placeable', 'Пентащит, горизонтальна поверхня', 'shield', { h: 0, family: 'shield', at: 'tile', tile: 's', kind: 'shield', shield: true });
  for (const s of Object.values(S)) { s.name = s.name.replace(/\s+/g, ' '); s.cost = costOf(s.id); }

  /** дзеркальна пара (ліва ↔ права) — для F */
  const MIRROR = {};
  for (const [a, b] of [
    ['Atreides_Outpost_Floor_Triangle_Wide_Left', 'Atreides_Outpost_Floor_Triangle_Wide_Right'],
    ['Sardaukar_Wall_02_L', 'Sardaukar_Wall_02'],
    ['Sardaukar_Window_L', 'Sardaukar_Window'],
    ['Sardaukar_Door_Frame_L', 'Sardaukar_Door_Frame'],
    ['Sardaukar_PrudenceDoor_Frame_L', 'Sardaukar_PrudenceDoor_Frame'],
    ['Sardaukar_Door_Frame_Tall_L', 'Sardaukar_Door_Frame_Tall'],
    ['Sardaukar_Wall_Triangle_Bottom_Left', 'Sardaukar_Wall_Triangle_Bottom_Right'],
    ['Sardaukar_Wall_Triangle_Top_Left', 'Sardaukar_Wall_Triangle_Top_Right'],
    ['Sardaukar_Wall_Triangle_Bottom_Half_Left', 'Sardaukar_Wall_Triangle_Bottom_Half_Right'],
    ['Sardaukar_Wall_Triangle_Top_Half_Left', 'Sardaukar_Wall_Triangle_Top_Half_Right'],
    ['Sardaukar_Wall_Triangle_Bottom_Tall_Left', 'Sardaukar_Wall_Triangle_Bottom_Tall_Right'],
    ['Sardaukar_Wall_Triangle_Top_Tall_Left', 'Sardaukar_Wall_Triangle_Top_Tall_Right'],
    ['Atreides_Outpost_Wall_Triangle_Top_Wide_Left', 'Atreides_Outpost_Wall_Triangle_Top_Wide_Right'],
    ['Atreides_Outpost_Wall_Inclined_Wide_Left', 'Atreides_Outpost_Wall_Inclined_Wide_Right'],
    ['Sardaukar_Wall_Inclined_Tall_01_L', 'Sardaukar_Wall_Inclined_Tall_01'],
    ['Sardaukar_Wall_Inclined_Tall_02_L', 'Sardaukar_Wall_Inclined_Tall_02'],
    ['Sardaukar_Wall_Inclined_Corner_Tall_L', 'Sardaukar_Wall_Inclined_Corner_Tall'],
    ['Sardaukar_Window_Inclined_Tall_L', 'Sardaukar_Window_Inclined_Tall'],
    ['Sardaukar_Roof_02_L', 'Sardaukar_Roof_02'],
    ['Sardaukar_Roof_03_L', 'Sardaukar_Roof_03'],
    ['Choam_Level2_Roof_Cover_Bottom_Half_Left', 'Choam_Level2_Roof_Cover_Bottom_Half_Right'],
    ['Atreides_Outpost_Roof_Cover_Top_Half_Left', 'Atreides_Outpost_Roof_Cover_Top_Half_Right'],
    ['Atreides_Outpost_Ramp_Edge_Wide_Left', 'Atreides_Outpost_Ramp_Edge_Wide_Right'],
    ['MTX_Smug_Railing_Inclined_Left', 'MTX_Smug_Railing_Inclined_Right'],
    ['MTX_Smug_Railing_Inclined_Half_Left', 'MTX_Smug_Railing_Inclined_Right_Half'],
  ]) { MIRROR[a] = b; MIRROR[b] = a; }

  /** категорії палітри: назва й порядок */
  const CATS = [
    ['found', 'Фундаменти'],
    ['floor', 'Перекриття'],
    ['wall', 'Стіни'],
    ['open', 'Вікна, двері, проходи'],
    ['wedge', 'Скісні й похилі стіни'],
    ['roof', 'Дахи'],
    ['incline', 'Сходи й пандуси'],
    ['column', 'Колони'],
    ['rail', 'Поручні'],
    ['shield', 'Пентащит'],
  ];

  // ---------- прив'язка ----------
  const rad = (d) => (d * Math.PI) / 180;
  const loc = (p) => {
    const c = Math.cos(rad(p.rot || 0)), s = Math.sin(rad(p.rot || 0));
    return (lx, ly) => ({ x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c });
  };
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  /** вершини плитки в локальній рамці */
  function tileLocal(tile) {
    if (tile === 't') return [[-0.5, -RI], [0.5, -RI], [0, RC]];
    if (tile === 'r') { // чверть кола радіуса 1 з центром у (−½, −½)
      const out = [[-0.5, -0.5]];
      for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); out.push([-0.5 + Math.cos(a), -0.5 + Math.sin(a)]); }
      return out;
    }
    if (tile === 'ri') { // квадрат без чверті кола з центром у (½, ½)
      const out = [[-0.5, -0.5], [0.5, -0.5]];
      for (let i = 0; i <= 8; i++) { const a = Math.PI * 1.5 - (i / 8) * (Math.PI / 2); out.push([0.5 + Math.cos(a), 0.5 + Math.sin(a)]); }
      out.push([-0.5, 0.5]);
      return out;
    }
    return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  }
  /** плитка деталі на плані (кути в світових координатах) */
  function tilePoly(tile, x, y, rot) {
    const L = loc({ x, y, rot });
    return tileLocal(tile).map(([a, b]) => { const q = L(a, b); return { x: r6(q.x), y: r6(q.y) }; });
  }
  /** край деталі: від a до b (довжина len) */
  function edgeSeg(x, y, rot, len = 1) {
    const L = loc({ x, y, rot });
    const a = L(-len / 2, 0), b = L(len / 2, 0);
    return { a: { x: r6(a.x), y: r6(a.y) }, b: { x: r6(b.x), y: r6(b.y) } };
  }
  /** скат, що піднімається рівно від одного краю до протилежного (низ — два перші кути, верх — два останні) */
  const hs2 = (s) => s.hs && s.hs.length === 4 && s.hs[0] === s.hs[1] && s.hs[2] === s.hs[3] && s.hs[0] !== s.hs[3];
  /** межі деталі по висоті: плити — тонкий шар під верхом, решта — від низу на висоту */
  function zRange(p) {
    const s = S[p.shape];
    if (!s) return [p.z, p.z];
    if (s.family === 'slab' || (s.family === 'shield' && s.at === 'tile')) return [p.z - (s.cat === 'found' ? DIM.found : DIM.slab), p.z];
    return [p.z, p.z + (s.h || 0)];
  }
  /** слід деталі: плитка, край чи точка + висоти */
  function footprint(p) {
    const s = S[p.shape];
    const [z0, z1] = zRange(p);
    if (!s) return { at: 'none', z0, z1 };
    if (s.at === 'tile') return { at: 'tile', poly: tilePoly(s.tile === 'r' || s.tile === 'ri' ? 's' : s.tile, p.x, p.y, p.rot), z0, z1 };
    if (s.at === 'edge') return { at: 'edge', seg: edgeSeg(p.x, p.y, p.rot, s.len), z0, z1 };
    return { at: 'vertex', pt: { x: p.x, y: p.y }, z0, z1 };
  }
  const near = (a, b) => Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3;
  /** відрізки на одній прямій, що перекриваються (не лише торкаються) */
  function segsOverlap(e, f) {
    const L = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y) || 1;
    const ux = (f.b.x - f.a.x) / L, uy = (f.b.y - f.a.y) / L;
    const off = (q) => Math.abs((q.x - f.a.x) * uy - (q.y - f.a.y) * ux);
    if (off(e.a) > 1e-3 || off(e.b) > 1e-3) return false;
    const t1 = (e.a.x - f.a.x) * ux + (e.a.y - f.a.y) * uy, t2 = (e.b.x - f.a.x) * ux + (e.b.y - f.a.y) * uy;
    return Math.min(Math.max(t1, t2), L) - Math.max(Math.min(t1, t2), 0) > 1e-3;
  }
  /** дві деталі не можуть стояти разом: та сама прив'язка (плитка, край, точка) і перетин по висоті */
  function clash(p, q) {
    const a = footprint(p), b = footprint(q);
    if (a.at !== b.at || a.at === 'none') return false;
    // скат і плита на одній плитці: разом, якщо плита під скатом чи на висоті його верху (скос під стелею); інакше плита
    // розтинає скат
    if (a.at === 'tile' && near({ x: p.x, y: p.y }, { x: q.x, y: q.y })) {
      const sp = S[p.shape], sq = S[q.shape];
      const [sl, pl] = sp.family === 'slope' && isSlab(sq) ? [p, q] : sq.family === 'slope' && isSlab(sp) ? [q, p] : [null, null];
      if (sl) return pl.z > sl.z + EPS && pl.z < sl.z + S[sl.shape].h - EPS;
    }
    if (!(a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS)) return false;
    // драбина висить на лиці стіни того самого краю — разом (дві драбини на одному краї — ні)
    if (a.at === 'edge' && (S[p.shape].family === 'ladder') !== (S[q.shape].family === 'ladder')) return false;
    if (a.at === 'vertex') return near(a.pt, b.pt);
    if (a.at === 'edge') return segsOverlap(a.seg, b.seg);
    const ca = { x: p.x, y: p.y }, cb = { x: q.x, y: q.y };
    return near(ca, cb);
  }
  /** ключ центру плитки (як у редакторі плиток): «x,y» з точністю 1e-3 */
  const keyOf = (q) => {
    const kx = Math.round(q.x * 1000), ky = Math.round(q.y * 1000);
    return (kx === 0 ? 0 : kx) + ',' + (ky === 0 ? 0 : ky);
  };
  const centroid = (ps) => ({ x: ps.reduce((s, q) => s + q.x, 0) / ps.length, y: ps.reduce((s, q) => s + q.y, 0) / ps.length });

  // ---------- геометрія для 3D (у координатах плану: x, y, z — блоки) ----------
  function geom(p) {
    const s = S[p.shape];
    const out = { faces: [], lines: [] };
    if (!s) return out;
    const buckets = new Map();
    const face = (mat) => { if (!buckets.has(mat)) buckets.set(mat, []); return buckets.get(mat); };
    const tri = (mat, a, b, c) => face(mat).push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const quad = (mat, a, b, c, d) => { tri(mat, a, b, c); tri(mat, a, c, d); };
    const line = (a, b) => out.lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const L = loc(p);
    const P = (lx, ly, z) => { const q = L(lx, ly); return { x: q.x, y: q.y, z }; };
    const z = p.z;
    // призма: многокутник (локальний) від z0 до z1; matTop — верх, matSide — боки
    const prism = (poly, z0, z1, matTop, matSide = matTop, matBottom = matSide, outline = true) => {
      const lo = poly.map(([a, b]) => P(a, b, z0)), hi = poly.map(([a, b]) => P(a, b, z1));
      for (let i = 1; i < poly.length - 1; i++) { tri(matTop, hi[0], hi[i], hi[i + 1]); tri(matBottom, lo[0], lo[i + 1], lo[i]); }
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        quad(matSide, lo[i], lo[j], hi[j], hi[i]);
        if (outline) line(hi[i], hi[j]);
      }
    };
    // брусок у локальних координатах краю: x0…x1 уздовж, t — товщина, z0…z1
    const box = (x0, x1, t, z0, z1, mat, bow = 0) => {
      const n = bow ? 6 : 1;
      for (let i = 0; i < n; i++) {
        const xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n;
        const off = (xx) => (bow ? bow * (1 - ((2 * xx) / (s.len || 1)) ** 2) : 0);
        const ya = off(xa), yb = off(xb);
        prism([[xa, ya - t / 2], [xb, yb - t / 2], [xb, yb + t / 2], [xa, ya + t / 2]], z0, z1, mat, mat, mat, false);
      }
      line(P(x0, 0, z1), P(x1, 0, z1));
    };
    const len = s.len || 1, X0 = -len / 2, X1 = len / 2;

    if (s.family === 'slab' || (s.family === 'shield' && s.at === 'tile')) {
      const poly = tileLocal(s.tile);
      if (s.family === 'shield') {
        const pts = poly.map(([a, b]) => P(a, b, z));
        for (let i = 1; i < pts.length - 1; i++) tri('shield', pts[0], pts[i], pts[i + 1]);
        for (let i = 0; i < pts.length; i++) line(pts[i], pts[(i + 1) % pts.length]);
      } else {
        const thick = s.cat === 'found' ? DIM.found : DIM.slab;
        const top = s.cat === 'roof' ? 'roof' : s.tile === 't' ? 'tri' : 'sq';
        prism(poly, z - thick, z, top, s.cat === 'found' ? 'wallLight' : 'trim');
        if (s.hatch) { const q = [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]].map(([a, b]) => P(a, b, z + 0.005)); quad('frame', q[0], q[1], q[2], q[3]); }
      }
    } else if (s.family === 'wall') {
      const h = s.h, t = DIM.wall, bow = s.bow || 0;
      if (!s.hole) box(X0, X1, t, z, z + h, 'wall', bow);
      else {
        const [hx0, hx1, hz0, hz1] = s.hole;
        // стіна навколо прорізу: ліворуч, праворуч, під і над
        if (hx0 > X0 + EPS) box(X0, hx0, t, z, z + h, 'wall', 0);
        if (hx1 < X1 - EPS) box(hx1, X1, t, z, z + h, 'wall', 0);
        if (hz0 > EPS) box(hx0, hx1, t, z, z + hz0, 'wall', 0);
        if (hz1 < h - EPS) box(hx0, hx1, t, z + hz1, z + h, 'wall', 0);
        // рамка й стулка
        const f = 0.05;
        box(hx0 - f, hx0, t + 0.04, z + hz0, z + hz1, 'frame');
        box(hx1, hx1 + f, t + 0.04, z + hz0, z + hz1, 'frame');
        box(hx0 - f, hx1 + f, t + 0.04, z + hz1, z + hz1 + f, 'frame');
        if (s.panel === 'glass') { const q = [P(hx0, 0, z + hz0), P(hx1, 0, z + hz0), P(hx1, 0, z + hz1), P(hx0, 0, z + hz1)]; quad('glass', q[0], q[1], q[2], q[3]); }
        if (s.panel === 'door' || s.panel === 'gate') box(hx0 + 0.01, hx1 - 0.01, 0.05, z + hz0, z + hz1, s.panel === 'gate' ? 'gate' : 'door');
      }
    } else if (s.family === 'wedge') {
      const h = s.h, t = DIM.wall / 2;
      const tri3 = { bl: [[X0, 0], [X1, 0], [X0, h]], br: [[X0, 0], [X1, 0], [X1, h]], tl: [[X0, h], [X1, h], [X0, 0]], tr: [[X0, h], [X1, h], [X1, 0]] }[s.dir];
      const A = tri3.map(([x, zz]) => P(x, -t, z + zz)), B = tri3.map(([x, zz]) => P(x, t, z + zz));
      tri(s.glass ? 'glass' : 'wall', A[0], A[1], A[2]);
      tri(s.glass ? 'glass' : 'wall', B[0], B[2], B[1]);
      for (let i = 0; i < 3; i++) { const j = (i + 1) % 3; quad('wall', A[i], A[j], B[j], B[i]); line(B[i], B[j]); }
    } else if (s.family === 'slope' && s.bow && s.tile === 's' && hs2(s)) {
      // заокруглений скат: опуклий профіль (чверть кола — крутий низ, пологий верх), смугами поперек підйому
      const N = 6, h0 = s.hs[0], h1 = s.hs[3], th = DIM.slab;
      const zf = (ly) => z + h0 + (h1 - h0) * Math.sin((Math.PI / 2) * (ly + 0.5));
      const ys = Array.from({ length: N + 1 }, (_, i) => -0.5 + i / N);
      const T = ys.map((ly) => [P(-0.5, ly, zf(ly)), P(0.5, ly, zf(ly))]);
      const U = ys.map((ly) => [P(-0.5, ly, zf(ly) - th), P(0.5, ly, zf(ly) - th)]);
      for (let i = 0; i < N; i++) {
        quad('roof', T[i][0], T[i][1], T[i + 1][1], T[i + 1][0]);
        quad('trim', U[i][0], U[i + 1][0], U[i + 1][1], U[i][1]);
        quad('trim', U[i][0], U[i][1], T[i][1], T[i][0]);
        quad('trim', T[i][0], T[i + 1][0], U[i + 1][0], U[i][0]);
        quad('trim', U[i][1], U[i + 1][1], T[i + 1][1], T[i][1]);
        line(T[i][0], T[i + 1][0]); line(T[i][1], T[i + 1][1]);
      }
      quad('trim', U[N][1], U[N][0], T[N][0], T[N][1]);
      line(T[0][0], T[0][1]); line(T[N][0], T[N][1]);
    } else if (s.family === 'slope') {
      const poly = tileLocal(s.tile), hs = s.hs;
      const top = poly.map(([a, b], i) => P(a, b, z + hs[i]));
      const mat = s.cat === 'roof' ? 'roof' : s.wall ? 'wall' : 'wallLight';
      // похила стіна — товщина стіни поперек панелі (по вертикалі більша), низ не нижче підлоги
      const th = s.solid ? 0 : s.wall ? DIM.wall * Math.hypot(1, Math.max(...hs)) : DIM.slab;
      // верх — двома трикутниками по діагоналі 0–2 (кути даху — ребро вздовж неї)
      for (let i = 1; i < top.length - 1; i++) tri(mat, top[0], top[i], top[i + 1]);
      for (let i = 0; i < top.length; i++) line(top[i], top[(i + 1) % top.length]);
      if (s.solid) {
        // суцільне тіло до підлоги: боки — від z до верху
        const lo = poly.map(([a, b]) => P(a, b, z));
        for (let i = 0; i < poly.length; i++) {
          const j = (i + 1) % poly.length;
          if (hs[i] > EPS || hs[j] > EPS) quad('wall', lo[i], lo[j], top[j], top[i]);
        }
      } else {
        // похила плита (сходи, пандус, скат) чи похила стіна: товщина під верхом, під нею порожньо
        const bot = poly.map(([a, b], i) => P(a, b, s.wall ? Math.max(z, z + hs[i] - th) : z + hs[i] - th));
        const under = s.wall ? 'wall' : 'trim';
        for (let i = 1; i < bot.length - 1; i++) tri(under, bot[0], bot[i + 1], bot[i]);
        for (let i = 0; i < poly.length; i++) { const j = (i + 1) % poly.length; quad(under, bot[i], bot[j], top[j], top[i]); }
      }
      if (s.glass) {
        // вікно в похилій панелі: скло трохи над нею
        const hz = (ly) => z + hs[0] + ((hs[3] - hs[0]) * (ly + 0.5));
        const q = [[-0.3, -0.2], [0.3, -0.2], [0.3, 0.25], [-0.3, 0.25]].map(([a, b]) => P(a, b - 0.02, hz(b) + 0.02));
        quad('glass', q[0], q[1], q[2], q[3]);
      }
      if (s.steps) {
        // сходинки: смуги поперек підйому
        const n = Math.max(2, Math.round(Math.max(...hs) * 4));
        for (let k = 1; k < n; k++) {
          const yy = -0.5 + k / n, zz = z + (Math.max(...hs) * k) / n;
          line(P(-0.5, yy, zz), P(0.5, yy, zz));
        }
      }
    } else if (s.family === 'column') {
      const a = (s.size || DIM.col) / 2;
      prism([[-a, -a], [a, -a], [a, a], [-a, a]], z, z + s.h, 'trim', 'wall');
    } else if (s.family === 'rail' && s.arc) {
      // по дузі заокругленого перекриття: хорда — край деталі, вигин — у бік локального +y (назовні від центру кола)
      const R0 = s.arc, half = len / 2, sag0 = Math.sqrt(R0 * R0 - half * half);
      const off = (x) => Math.sqrt(Math.max(0, R0 * R0 - x * x)) - sag0;
      for (const x of [X0 + 0.04, -half / 3, half / 3, X1 - 0.04]) { const y = off(x); prism([[x - 0.03, y - 0.03], [x + 0.03, y - 0.03], [x + 0.03, y + 0.03], [x - 0.03, y + 0.03]], z, z + s.h, 'trim', 'trim', 'trim', false); }
      const N = 8;
      for (let i = 0; i < N; i++) {
        const xa = X0 + (len * i) / N, xb = X0 + (len * (i + 1)) / N;
        const a = P(xa, off(xa), z + s.h), b = P(xb, off(xb), z + s.h);
        quad('trim', P(xa, off(xa), z + s.h - 0.06), P(xb, off(xb), z + s.h - 0.06), b, a);
        line(a, b);
      }
    } else if (s.family === 'rail') {
      const rise = s.incline || 0;
      const zr = (x) => z + (rise * (x - X0)) / len;
      // стовпчики й поручень зверху (похилий — уздовж підйому)
      for (const x of s.gate ? [X0 + 0.04, X1 - 0.04] : [X0 + 0.04, 0, X1 - 0.04]) box(x - 0.03, x + 0.03, 0.06, zr(x), zr(x) + s.h, 'trim');
      const a = P(X0, 0, zr(X0) + s.h), b = P(X1, 0, zr(X1) + s.h), a2 = P(X0, 0, zr(X0) + s.h - 0.06), b2 = P(X1, 0, zr(X1) + s.h - 0.06);
      quad('trim', a2, b2, b, a);
      line(a, b);
    } else if (s.family === 'ladder') {
      // на лиці стіни: зсунута в бік нормалі (локальна +y) на пів товщини стіни
      const o = DIM.wall / 2 + 0.04;
      const bar = (x0, x1, t, z0, z1) => prism([[x0, o - t / 2], [x1, o - t / 2], [x1, o + t / 2], [x0, o + t / 2]], z0, z1, 'trim', 'trim', 'trim', false);
      for (const x of [-0.22, 0.22]) bar(x - 0.03, x + 0.03, 0.05, z, z + s.h);
      for (let k = 1; k <= 4; k++) bar(-0.22, 0.22, 0.04, z + (s.h * k) / 5 - 0.02, z + (s.h * k) / 5 + 0.02);
    } else if (s.family === 'shield') {
      const q = [P(X0, 0, z), P(X1, 0, z), P(X1, 0, z + s.h), P(X0, 0, z + s.h)];
      quad('shield', q[0], q[1], q[2], q[3]);
      for (let i = 0; i < 4; i++) line(q[i], q[(i + 1) % 4]);
    }
    for (const [mat, tris] of buckets) out.faces.push({ mat, tris });
    return out;
  }

  /** форми, якими можна замінити деталь на тому самому місці: та сама прив'язка, плитка й довжина */
  function replacements(shape) {
    const s = S[shape];
    if (!s) return [];
    const tileOf = (o) => (o.tile === 'r' || o.tile === 'ri' ? 's' : o.tile || '');
    return Object.values(S).filter((o) => o.id !== s.id && o.at === s.at && tileOf(o) === tileOf(s) && (o.len || 1) === (s.len || 1)).map((o) => o.id);
  }

  // ---------- приміщення (зони) ----------
  const isFloor = (s) => s && s.family === 'slab' && (s.cat === 'found' || s.cat === 'floor');
  const isSlab = (s) => s && (s.family === 'slab' || (s.family === 'shield' && s.at === 'tile'));
  /**
   * Приміщення з деталей: явні плитки зони (на її висоті, де ще є підлога) і саморозширення — сусідня підлога на тій
   * самій висоті, до якої можна дійти через край без деталі (стіна, прохід, поручень — межа), якщо її не взяла інша
   * зона. Висота — до найнижчої плити над підлогою (стеля, дах), а як нема — до верху стін на межі.
   * Повертає [{ ...zone, tiles: ключі, polys: многокутники, h }]
   */
  function zonesOf(pieces, zones) {
    const floors = new Map(); // висота → ключ плитки → многокутник
    const roofOnly = new Set(); // висота@ключ: плита — дах (тераса); туди приміщення само не розростається
    const slabsAt = new Map(); // ключ плитки → висоти плит
    const edgeBlocks = new Map(); // ключ краю → [[z0, z1]]
    const ek = (a, b) => { const ka = keyOf(a), kb = keyOf(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
    for (const p of pieces) {
      const s = S[p.shape];
      if (!s) continue;
      if (isSlab(s)) {
        const k = keyOf({ x: p.x, y: p.y });
        if (!slabsAt.has(k)) slabsAt.set(k, []);
        slabsAt.get(k).push(p.z);
        // підлога приміщення — будь-яка плита (і плаский дах-тераса); рівні ж — лише з фундаментів і перекриттів
        if (s.family === 'slab') {
          const z = Math.round(p.z * 100) / 100;
          if (!floors.has(z)) floors.set(z, new Map());
          floors.get(z).set(k, tilePoly(s.tile === 'r' || s.tile === 'ri' ? 's' : s.tile, p.x, p.y, p.rot));
          if (s.cat === 'roof') roofOnly.add(z + '@' + k);
        }
      } else if (s.at === 'edge') {
        const len = s.len || 1;
        const seg = edgeSeg(p.x, p.y, p.rot, len);
        // широка деталь — на кількох краях поспіль
        for (let i = 0; i < len; i++) {
          const a = { x: seg.a.x + ((seg.b.x - seg.a.x) * i) / len, y: seg.a.y + ((seg.b.y - seg.a.y) * i) / len };
          const b = { x: seg.a.x + ((seg.b.x - seg.a.x) * (i + 1)) / len, y: seg.a.y + ((seg.b.y - seg.a.y) * (i + 1)) / len };
          const k = ek(a, b);
          if (!edgeBlocks.has(k)) edgeBlocks.set(k, []);
          edgeBlocks.get(k).push([p.z, p.z + (s.h || 0.5)]);
        }
      }
    }
    const blocked = (a, b, z) => (edgeBlocks.get(ek(a, b)) || []).some(([z0, z1]) => z0 < z + 0.5 && z1 > z + 0.01);
    const out = [];
    const owner = new Map(); // висота@ключ → зона
    const list = (zones || []).map((zn) => ({ zn, z: Math.round((zn.z || 0) * 100) / 100 }));
    for (const { zn, z } of list) for (const k of zn.tiles || []) if (floors.get(z)?.has(k) && !owner.has(z + '@' + k)) owner.set(z + '@' + k, zn.id);
    // сусідство плиток на кожній висоті: ключ краю → плитки
    const adj = new Map();
    for (const [z, fl] of floors) {
      const m = new Map();
      for (const [k, poly] of fl) for (let i = 0; i < poly.length; i++) {
        const e = ek(poly[i], poly[(i + 1) % poly.length]);
        if (!m.has(e)) m.set(e, []);
        m.get(e).push(k);
      }
      adj.set(z, m);
    }
    for (const { zn, z } of list) {
      const fl = floors.get(z) || new Map();
      const az = adj.get(z) || new Map();
      const mine = new Set((zn.tiles || []).filter((k) => owner.get(z + '@' + k) === zn.id));
      // саморозширення: сусіди через порожні краї
      const queue = [...mine];
      while (queue.length) {
        const k = queue.pop();
        const poly = fl.get(k);
        if (!poly) continue;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          if (blocked(a, b, z)) continue;
          for (const k2 of az.get(ek(a, b)) || []) {
            if (mine.has(k2) || owner.has(z + '@' + k2) || roofOnly.has(z + '@' + k2)) continue;
            mine.add(k2);
            owner.set(z + '@' + k2, zn.id);
            queue.push(k2);
          }
        }
      }
      const keys = [...mine];
      // висота: плита над підлогою (стеля, дах); інакше — верх стін, що оточують зону; інакше — палуба (0)
      const above = keys.map((k) => Math.min(...(slabsAt.get(k) || []).filter((zz) => zz > z + 0.05))).filter(Number.isFinite);
      // антресоль у частині зали не робить залу нижчою: беремо найвищу «стелю» серед плиток
      let h = above.length ? Math.max(...above) - z : 0;
      if (!h) {
        // без стелі: стіни по всій межі (від підлоги) — до верху найнижчої з них; хоч один край без стіни — палуба
        const mineSet = new Set(keys);
        let top = Infinity;
        for (const k of keys) {
          const poly = fl.get(k);
          for (let i = 0; i < poly.length; i++) {
            const e = ek(poly[i], poly[(i + 1) % poly.length]);
            if ((az.get(e) || []).some((k2) => k2 !== k && mineSet.has(k2))) continue; // усередині зони
            // стовпчик блоків від підлоги вгору поспіль
            const bl = (edgeBlocks.get(e) || []).slice().sort((u, v) => u[0] - v[0]);
            let t = z;
            for (const [z0, z1] of bl) if (z0 <= t + 0.01 && z1 > t) t = z1;
            if (t - z < 0.6) { top = z; break; }
            top = Math.min(top, t);
          }
          if (top === z) break;
        }
        h = Number.isFinite(top) ? top - z : 0;
      }
      out.push({ ...zn, z, tiles: keys, polys: keys.map((k) => fl.get(k)), h: Math.round(h * 100) / 100 });
    }
    return out;
  }
  /** висоти підлог (фундаменти, перекриття) — рівні для зрізу й планів */
  const floorHeights = (pieces) => [...new Set(pieces.filter((p) => isFloor(S[p.shape])).map((p) => Math.round(p.z * 100) / 100))].sort((a, b) => a - b);

  /** дуга заокругленої плити (чверть кола): хорда a→b так, що ліва нормаль (вигин) дивиться від центру кола; інакше null */
  function arcChord(p) {
    const s = S[p.shape];
    if (!s || s.at !== 'tile' || s.tile !== 'r') return null;
    const poly = tilePoly('r', p.x, p.y, p.rot);
    const cc = poly[0];
    let a = poly[1], b = poly[poly.length - 1];
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (-(b.y - a.y) * (m.x - cc.x) + (b.x - a.x) * (m.y - cc.y) < 0) [a, b] = [b, a];
    return { a, b };
  }
  const api = { arcChord, SHAPES: S, CATS, DIM, MIRROR, PRICE, tilePoly, tileLocal, edgeSeg, footprint, zRange, clash, segsOverlap, geom, replacements, keyOf, centroid, zonesOf, floorHeights, isFloor, isSlab, RI, RC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PIECES = api;
})(typeof window !== 'undefined' ? window : globalThis);

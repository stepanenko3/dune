// Міста, малі мапи й огляд — мапи World Composition: кореневий рівень теки X.umap (поряд рівні X_*), рівні мапи — усі
// .umap теки (з підтеками) без звуку, світла, листя, LOD, ефектів, туману, кінематографії й контрактів. Id мапи сайту —
// назва кореневого рівня малими (SH_Arrakeen → sh_arrakeen): так їх зве й TH.GL, тож без відповідності.
import { describe, expect, it } from 'vitest'
import { worldMaps } from '../lib/raw.mjs'

const C = 'DuneSandbox/Content/Dune'
describe('мапи World Composition зі списку пакетів', () => {
  it('корінь теки з рівнями X_* — мапа (сам не X_ іншого кореня); рівні — уся тека без службових; інші теки й Хаґґа — ні', () => {
    const list = [
      `${C}/Maps/SocialHubs/Arrakeen/SH_Arrakeen.umap`,
      `${C}/Maps/SocialHubs/Arrakeen/SH_Arrakeen_Gameplay.umap`,
      `${C}/Maps/SocialHubs/Arrakeen/SH_Arrakeen_Art.umap`,
      `${C}/Maps/SocialHubs/Arrakeen/SH_Arrakeen_Art_Bar.umap`,
      `${C}/Maps/SocialHubs/Arrakeen/SH_Arrakeen_Audio.umap`,
      `${C}/Maps/SocialHubs/Arrakeen/Story/CB_Arrakeen_Story_Jackal.umap`,
      `${C}/Maps/SocialHubs/Arrakeen/SH_Arrakeen_Contract_X.umap`,
      `${C}/Maps/SocialHubs/Arrakeen/LOD/SH_Arrakeen_Art_LOD1.umap`,
      `${C}/Maps/SocialHubs/Arrakeen/DA_Arrakeen_FullscreenMapData.uasset`,
      `${C}/Maps/OverlandMaps_Story/BanditFortress01/CB_Story_BanditFortress01.umap`,
      `${C}/Maps/OverlandMaps_Story/BanditFortress01/CB_Story_BanditFortress01_art.umap`,
      `${C}/Maps/OverlandMaps_Story/BanditFortress01/CB_Story_BanditFortress01_Fog.umap`,
      `${C}/Systems/Overmap/Overmap.umap`,
      `${C}/Systems/Overmap/Overmap_Audio.umap`,
      `${C}/Systems/Overmap/Sublevels/Overmap_WindPass.umap`,
      `${C}/Maps/SocialHubs/Lonely/Lonely.umap`,
      `${C}/Maps/Arrakis/SOC_1/Survival_1.umap`,
      `${C}/Maps/Arrakis/SOC_1/Survival_1_Graben.umap`,
    ]
    expect(worldMaps(list)).toEqual([
      { id: 'sh_arrakeen', world: `${C}/Maps/SocialHubs/Arrakeen/SH_Arrakeen.umap`, levels: [`${C}/Maps/SocialHubs/Arrakeen/SH_Arrakeen.umap`, `${C}/Maps/SocialHubs/Arrakeen/SH_Arrakeen_Gameplay.umap`, `${C}/Maps/SocialHubs/Arrakeen/SH_Arrakeen_Art.umap`, `${C}/Maps/SocialHubs/Arrakeen/SH_Arrakeen_Art_Bar.umap`, `${C}/Maps/SocialHubs/Arrakeen/Story/CB_Arrakeen_Story_Jackal.umap`] },
      { id: 'cb_story_banditfortress01', world: `${C}/Maps/OverlandMaps_Story/BanditFortress01/CB_Story_BanditFortress01.umap`, levels: [`${C}/Maps/OverlandMaps_Story/BanditFortress01/CB_Story_BanditFortress01.umap`, `${C}/Maps/OverlandMaps_Story/BanditFortress01/CB_Story_BanditFortress01_art.umap`] },
      { id: 'overmap', world: `${C}/Systems/Overmap/Overmap.umap`, levels: [`${C}/Systems/Overmap/Overmap.umap`, `${C}/Systems/Overmap/Sublevels/Overmap_WindPass.umap`] },
    ])
  })
})

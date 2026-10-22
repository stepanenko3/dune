/*
 * Предмети (CDT_BaseItems → GameItemStaticData) у формі каталогу сайту. Категорія й підкатегорія — з тегів предмета,
 * так само, як їх показує сайт; невипущене (застаріле, «назва = id») — released:false.
 */
import { iconPath, snake, textOf, tierOf } from './common.mjs'

/** службові теги — не вид предмета */
const FLAG = /^Items\.(Exclude|Not)/

/** теги → [cat, sub] */
export function categoryOf(tags) {
  const has = (re) => tags.find((t) => re.test(t))
  let t
  if (has(/^Items\.Customization\./) || has(/^Items\.Consumables\.Customizations/)) return ['swatch', null]
  if ((t = has(/^Items\.Schematics\./))) {
    if (/\.MeleeWeapons/.test(t)) return ['schematic', 'melee']
    const r = /\.RangedWeapons\.(?:Light|Heavy)\.(\w+)/.exec(t)
    return ['schematic', r ? snake(r[1]) : null]
  }
  if ((t = has(/^Items\.Clothes\./))) {
    const sub = { HeavyArmor: 'heavy_armor', ScoutArmor: 'light_armor', Stillsuit: 'stillsuit', Social: 'social', Utility: 'utility' }[t.split('.')[2]]
    return ['garment', sub ?? null]
  }
  if ((t = has(/^Items\.Holsters\.Deployables\.Vehicle(Base|Extra)/))) return ['vehicle', /VehicleBase/.test(t) ? 'base' : 'extra']
  if ((t = has(/^Items\.Holsters\.(Building|Cartography|Gathering|Hydration|Utility)Tools/))) {
    return ['tool', /Holsters\.(\w+)Tools/.exec(t)[1].toLowerCase()]
  }
  if (has(/^Items\.Holsters\.MeleeWeapons/)) return ['weapon', 'melee']
  if ((t = has(/^Items\.Holsters\.RangedWeapons\./))) {
    const r = /RangedWeapons\.(?:Light|Heavy)\.(\w+)/.exec(t)
    return ['weapon', r ? snake(r[1]) : null]
  }
  // контракт — після зброї: нагорода-зброя з тегом контракту — це зброя
  if (has(/^Items\.Contract/)) return ['contract', 'contract']
  return ['misc', null]
}

export function normalizeItems(rows) {
  return Object.entries(rows).map(([id, r]) => {
    const sd = r.StaticData ?? {}
    const tags = sd.ItemTags ?? []
    const [cat, sub] = categoryOf(tags)
    const kindTag = tags.find((x) => /^Items\.\w+/.test(x) && !FLAG.test(x))
    const rarity = tags.find((x) => /^Rarity\./.test(x))
    const name = textOf(sd.Name)
    const size = typeof sd.ItemSizeOverride === 'number' && sd.ItemSizeOverride >= 0 ? sd.ItemSizeOverride : sd.ItemSize
    return {
      id, name, icon: iconPath(r.Icon), grade: tierOf(tags), cat, sub,
      kind: kindTag ? kindTag.split('.')[1] : null,
      rarity: rarity ? rarity.split('.')[1] : null,
      stack: r.StackAndDurability?.MaxStackSize ?? null,
      volume: typeof size === 'number' ? size : null,
      released: r.bIsDeprecated !== true && !!name && name !== id,
    }
  })
}

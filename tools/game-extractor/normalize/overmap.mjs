/*
 * Огляд (мапа подорожей): точки — актори BP_OvermapPoi_C кореневого рівня Overmap. Місце — кореневий компонент актора,
 * назва — ключ рядка гри (m_LocationName компонента OvermapPoiComponent), тип — тип мітки категорії гри: дерево
 * DA_PoiCategoryTree, тег точки входить у фільтр категорії верхнього рівня (як теги гри: Poi.Location.Cities — під
 * Poi.Location, зокрема через підкатегорії). Сайт тримає мапу як [Y гри, X гри].
 */
const pkg = (p) => String(p ?? '').split('/').pop().replace(/\..*$/, '')
/** «Type'Outer:PersistentLevel.A.B'» → «PersistentLevel.A.B» (шлях об'єкта в пакеті) */
const inner = (ref) => { const m = /'[^:']*:([^']+)'/.exec(String(ref ?? '')); return m ? m[1] : null }
const under = (tag, f) => tag === f || tag.startsWith(f + '.')

/** exp — повний експорт рівня Overmap; categories — { tree: властивості дерева, <назва>: властивості категорії } */
export function normalizeOvermap(exp, categories) {
  const byPath = new Map()
  for (const e of exp) { const o = inner(e.Outer?.ObjectName); if (o && e.Name) byPath.set(`${o}.${e.Name}`, e) }
  // теги фільтра категорії разом із підкатегоріями
  const tagsOf = (name, seen = new Set()) => {
    const c = categories[name]
    if (!c || seen.has(name)) return []
    seen.add(name)
    return [...(c.m_ItemFilter?.TagDictionary ?? []).map((t) => t.TagName), ...(c.m_SubCategories ?? []).flatMap((s) => tagsOf(pkg(s.ObjectPath), seen))]
  }
  const top = (categories.tree?.m_SubCategories ?? []).map((s) => pkg(s.ObjectPath)).map((n) => ({ type: categories[n]?.m_MarkerType?.Name, tags: tagsOf(n) })).filter((c) => c.type && c.type !== 'None')
  const out = []
  const ids = new Map()
  for (const a of exp) {
    if (a.Type !== 'BP_OvermapPoi_C') continue
    const self = `PersistentLevel.${a.Name}`
    const poi = byPath.get(`${self}.PoiComponent`) ?? exp.find((e) => e.Type === 'OvermapPoiComponent' && inner(e.Outer?.ObjectName) === self)
    const root = byPath.get(inner(a.Properties?.RootComponent?.ObjectName))
    const l = root?.Properties?.RelativeLocation
    if (!poi || !l) throw new Error(`огляд: точка ${a.Name} без компонента чи місця`)
    const tag = poi.Properties?.m_PoiCategoryTags?.[0]
    const c = top.find((x) => x.tags.some((f) => under(String(tag), f)))
    if (!c) throw new Error(`огляд: точка ${a.Name}: тег ${tag} без категорії`)
    const n = poi.Properties?.m_LocationName
    const x = Math.round(l.Y), y = Math.round(l.X)
    const base = `overmap@${x}:${y}`
    const k = (ids.get(base) ?? 0) + 1
    ids.set(base, k)
    out.push({ id: k === 1 ? base : `${base}#${k}`, map: 'overmap', kind: 'marker', type: c.type, ...(n?.Key ? { name: `${pkg(n.TableId)}:${n.Key}` } : {}), x, y, z: Math.round(l.Z ?? 0) })
  }
  return out
}

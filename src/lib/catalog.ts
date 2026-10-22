/**
 * Довідник гри на клієнті: завантаження каталогу з /api/catalog і індекси для сторінок
 * (за id, «як отримати», «де використовується», «у будівництві»). Каталог — мовою сайту (loc — перекладені назви).
 */
import { currentLang, t } from './i18n'

export interface CItem {
  id: string
  name: string
  /** назва мовою сайту (null — перекладу нема, показуємо англійську name) */
  loc: string | null
  icon: string | null
  grade: number
  cat: string
  sub: string | null
  /** клас із тегів вікі: RawResources, RefinedResources, CraftedResources, Consumables, Ammo, Schematics */
  kind: string | null
  rarity: string | null
  stack: number | null
  volume: number | null
}
export interface CPlace {
  id: string
  name: string
  loc: string | null
  icon: string | null
  grade: number
  cat: string
  sub: string | null
  power: number | null
  water: number | null
  waterRate: number | null
}
export interface CRecipe {
  id: string
  name: string
  loc?: string | null
  time: number | null
  water: number | null
  /** id пристроїв, на яких крафтиться */
  at: string[]
  in: [string, number][]
  out: [string, number][]
}
export interface CBuild {
  set: string
  group: string
  id: string
  name: string | null
  loc?: string | null
  health: number | null
  img: string | null
  cost: [string, number][]
}
export interface Catalog {
  syncedAt: string
  items: CItem[]
  placeables: CPlace[]
  recipes: CRecipe[]
  buildables: CBuild[]
}

export interface CatalogIndex {
  cat: Catalog
  item: Map<string, CItem>
  place: Map<string, CPlace>
  /** рецепти, що дають предмет */
  makes: Map<string, CRecipe[]>
  /** рецепти, де предмет — інгредієнт */
  uses: Map<string, CRecipe[]>
  /** рецепти, що крафтяться на пристрої */
  craftsAt: Map<string, CRecipe[]>
  /** будівельні елементи, у ціні яких є предмет */
  builds: Map<string, CBuild[]>
}

let loading: Promise<CatalogIndex | 'syncing'> | null = null

export function loadCatalog(): Promise<CatalogIndex | 'syncing'> {
  if (loading) return loading
  loading = fetch(`/api/catalog?lang=${encodeURIComponent(currentLang())}`)
    .then(async (r) => {
      if (r.status === 202) {
        loading = null
        return 'syncing' as const
      }
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return index((await r.json()) as Catalog)
    })
    .catch((e) => {
      loading = null
      throw e
    })
  return loading
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k)
  if (a) a.push(v)
  else m.set(k, [v])
}

function index(cat: Catalog): CatalogIndex {
  const ix: CatalogIndex = {
    cat,
    item: new Map(cat.items.map((i) => [i.id, i])),
    place: new Map(cat.placeables.map((p) => [p.id, p])),
    makes: new Map(),
    uses: new Map(),
    craftsAt: new Map(),
    builds: new Map(),
  }
  for (const r of cat.recipes) {
    for (const [id] of r.out) push(ix.makes, id, r)
    for (const [id] of r.in) push(ix.uses, id, r)
    for (const p of r.at) push(ix.craftsAt, p, r)
  }
  for (const b of cat.buildables) for (const [id] of b.cost) push(ix.builds, id, b)
  rememberSets(cat)
  return ix
}

export const iconUrl = (icon: string | null) => (icon ? `/catalog-icons/${icon}.webp` : null)
/** зображення вікі — через наш кеш */
export const wikiImg = (url: string | null) => (url ? url.replace(/^https:\/\/media\.awakening\.wiki\//, '/catalog-wiki/') : null)

/** Назва для показу: мовою сайту, якщо є переклад, інакше англійська. */
export const nameOf = (x: { name: string; loc?: string | null } | undefined, fallback = '') => (x ? x.loc || x.name : fallback && (MISSING[fallback]?.() ?? prettyId(fallback)))
/** матеріали з цін деталей, яких нема в довіднику questlog, — своя назва, перекладна */
const MISSING: Record<string, () => string> = { Plastone: () => t('Пластон') }
/**
 * Чого нема в довіднику (ціна в матеріалі, якого questlog не знає, — «Plastone»): замість сирого id — слова з нього:
 * «TankBoost_6» → «Tank Boost 6»
 */
export const prettyId = (id: string) => id.replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/\s+/g, ' ').trim()

// ---------- розділи й підписи ----------

export type SectionId = 'resources' | 'weapon' | 'garment' | 'tool' | 'vehicle' | 'placeable' | 'building' | 'schematic' | 'contract' | 'swatch'

export const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'resources', label: t('Ресурси й матеріали') },
  { id: 'weapon', label: t('Зброя') },
  { id: 'garment', label: t('Одяг і броня') },
  { id: 'tool', label: t('Інструменти') },
  { id: 'vehicle', label: t('Техніка') },
  { id: 'placeable', label: t('Пристрої') },
  { id: 'building', label: t('Будівельні набори') },
  { id: 'schematic', label: t('Схеми') },
  { id: 'contract', label: t('Контракти') },
  { id: 'swatch', label: t('Кастомізація') },
]

/** розділ предмета: «misc» з гри ділимо на ресурси (у розділі ресурсів) і решту */
export const sectionOfItem = (i: CItem): SectionId => (i.cat === 'misc' ? 'resources' : (i.cat as SectionId))

const KIND: Record<string, string> = {
  Resources: t('Ресурси'),
  Deployables: t('Розгортуване'),
  Augments: t('Модифікації'),
  Emotes: t('Емоції'),
  Modules: t('Модулі'),
  RawResources: t('Сировина'),
  RefinedResources: t('Перероблене'),
  CraftedResources: t('Компоненти'),
  Consumables: t('Витратне'),
  Ammo: t('Набої'),
  Schematics: t('Схеми'),
}
const SUB: Record<string, string> = {
  melee: t('Холодна'), pistol: t('Пістолети'), rifle: t('Гвинтівки'), smg: t('Пістолети-кулемети'), lmg: t('Кулемети'), shotgun: t('Дробовики'),
  flamethrower: t('Вогнемети'), lasgun: t('Лазгани'), rocket_launcher: t('Ракетниці'),
  heavy_armor: t('Важка броня'), light_armor: t('Легка броня'), social: t('Повсякденний'), stillsuit: t('Дистикостюми'), utility: t('Спорядження'),
  hydration: t('Вода'), gathering: t('Добування'), cartography: t('Картографія'), building: t('Будівництво'),
  base: t('Основні частини'), extra: t('Модулі'), contract: t('Контракти'),
}
// невідоме (гра додала нову підкатегорію) — «Інше», а не сирий англійський ключ
export const subLabel = (s: string | null) => (s ? SUB[s] ?? t('Інше') : t('Інше'))
export const rarityLabel = (r: string) => ({ Rare: t('Рідкісне'), Memento: t('Пам’ятне'), Common: t('Звичайне'), Unique: t('Унікальне') })[r] ?? r

/**
 * Вид техніки для деталі: за назвою, а де вона не каже — за кодом в іконці гри
 * (CH1MG — піскоцикл, CCB — багі, COL/CMO/CTO — розвідувальний/штурмовий/транспортний орні, CIG — краулер).
 * Ключ (sandbike…) — для адреси групи (?g=): однаковий усіма мовами; підпис — мовою сайту.
 */
const VEHICLES: [string, string, RegExp, RegExp][] = [
  ['sandbike', t('Піскоцикл'), /Sandbike/, /IconVehCH1MG/],
  ['buggy', t('Багі'), /Buggy|Rattler|Bluddshot/, /IconVehCCB/],
  ['treadwheel', t('Тредвіл'), /Treadwheel/, /IconVehOETreadwheel/],
  ['scout', t('Розвідувальний орнітоптер'), /Scout Ornithopter|Albatross|Stormrider/, /IconVehCOL/],
  ['assault', t('Штурмовий орнітоптер'), /Assault|Hummingbird/, /IconVeh(CMO|COM)/],
  ['carrier', t('Транспортний орнітоптер'), /Carrier|Transport/, /IconVehCTO/],
  ['crawler', t('Піщаний краулер'), /Sandcrawler|Regis/, /IconVehCIG/],
]
export const VEHICLE_KEYS = VEHICLES.map(([k]) => k)
export const vehicleKey = (i: CItem): string => VEHICLES.find(([, , n]) => n.test(i.name))?.[0] ?? VEHICLES.find(([, , , ic]) => ic.test(i.icon ?? ''))?.[0] ?? 'other'
export const vehicleLabel = (key: string) => VEHICLES.find(([k]) => k === key)?.[1] ?? t('Інше')
/** підпис тіру: у техніки нульовий — «брухт» (Scrap), у решти — без тіру */
export const tierLabel = (grade: number, vehicle = false) => (grade > 0 ? t('Тір {n}', { n: grade }) : vehicle ? t('Брухт') : t('Без тіру'))
export const kindLabel = (k: string | null) => (k ? KIND[k] ?? t('Інше') : t('Інше'))

/**
 * Клас предмета «misc»: тег вікі, а де його немає — тека іконки в грі. Набори «Placeables»
 * вікі зве витратними, але це розгортувані пристрої — тека важливіша.
 */
export function kindOf(i: CItem): string | null {
  const f = /Gameplay\/([^/]+(?:\/[^/]+)?)\/T_UI/.exec(i.icon ?? '')?.[1] ?? ''
  if (f.startsWith('Placeables')) return 'Deployables'
  if (i.kind) return i.kind
  if (f.startsWith('AugmentMods')) return 'Augments'
  if (f.startsWith('Emotes')) return 'Emotes'
  if (f.startsWith('Modules')) return 'Modules'
  if (f === 'Items/Resources') return 'Resources'
  if (f === 'Items/Consumables') return 'Consumables'
  return null
}

/** «MTX_Neut_DesertMechanicSet02_Patent» → «Neut Desert Mechanic Set 02» — коли в гри нема назви набору */
const prettySet = (set: string) =>
  set.replace(/^MTX_/, '').replace(/_Patent$/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').trim()
/** заглушки назв у даних гри */
const STUB = /^(EMPTY_TEXT|NA_|LOC_|XX_)/
/** набір модуля гри (патент) → назва мовою сайту: предмет-патент гри з тим самим id */
const SET_NAMES = new Map<string, string>()
/** запам'ятати назви наборів з довідника (кличе індекс каталогу) */
export function rememberSets(cat: Pick<Catalog, 'items' | 'buildables'>) {
  const items = new Map(cat.items.map((i) => [i.id, i]))
  for (const b of cat.buildables) {
    const it = items.get(b.set)
    const name = it ? it.loc || it.name : null
    SET_NAMES.set(b.set, name && !STUB.test(name) ? name : prettySet(b.set))
  }
}
export const setLabel = (set: string) => SET_NAMES.get(set) ?? prettySet(set)
/** модуль — пристрій (рядок пристроїв гри), а не будівельна деталь */
export const isDevice = (b: Pick<CBuild, 'id'>) => /_Placeable$/.test(b.id)
/** слова з id гри для пошуку: «LargeOreRefinery_Placeable» → «large ore refinery placeable» */
export const buildWords = (id: string) => id.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').toLowerCase()
export const groupLabel = (g: string) =>
  ({
    structural: t('Фундаменти й колони'), wall: t('Стіни'), wedge_wall: t('Скошені стіни'), roof: t('Дахи й перекриття'), incline: t('Схили й сходи'), special: t('Особливі'),
    doors: t('Двері'), windows: t('Вікна'), refinery: t('Переробка'), fabricator: t('Фабрикатори'), storage: t('Зберігання'), utility: t('Обладнання'),
    lighting: t('Світло'), furniture: t('Меблі'), banners: t('Знамена'), ornaments: t('Оздоби'), decorations: t('Декор'), misc: t('Інше'),
  })[g] ??
  t('Інше')

/** назва модуля мовою сайту; нема — читабельний id гри */
export const buildName = (b: CBuild) => b.loc ?? b.name ?? buildWords(b.id).replace(/^\w/, (c) => c.toUpperCase())

/** тривалість: «45 с», «2 хв 30 с», «21 год 50 хв», «2 д 3 год» — великі черги не в хвилинах */
export function fmtTime(s: number | null) {
  if (s == null) return ''
  s = Math.round(s)
  if (s < 60) return t('{n} с', { n: s })
  if (s < 3600) return s % 60 ? t('{m} хв {s} с', { m: Math.floor(s / 60), s: s % 60 }) : t('{m} хв', { m: s / 60 })
  const m = Math.round(s / 60)
  if (m < 24 * 60) return m % 60 ? t('{h} год {m} хв', { h: Math.floor(m / 60), m: m % 60 }) : t('{h} год', { h: m / 60 })
  const h = Math.round(m / 60)
  return h % 24 ? t('{d} д {h} год', { d: Math.floor(h / 24), h: h % 24 }) : t('{d} д', { d: h / 24 })
}

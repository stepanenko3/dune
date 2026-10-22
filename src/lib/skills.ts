/**
 * Уміння для планувальника: дані з /api/skills (сервер збирає їх із questlog.gg; назви й описи — мовою сайту) і правила гри.
 *   • Школа — дерево на сітці 7×5 (x, y). Ряд y = 0 — входи (без зв'язків); решта вузлів відкриваються, коли
 *     взято хоча б один сусідній (or — ребра дерева) і відкрито школу (and: skills_key_<школа>1 — дерево
 *     відкриває базовий тренер школи; тут вважаємо відкритим).
 *   • Ряд y = 4 — завершальні вузли гілок: and — skills_key_capstone<гілка>; у грі їх відкриває просунутий тренер
 *     (умова рангу з даних гри мовою сайту, lib/skillsUk), а не очки: тут вузол береться від сусіда, умову тренера
 *     показує картка.
 *   • Ранг r коштує levels[r-1].cost очок; витрачено — сума за всіма вузлами.
 * Збірка — { id: ранг }; в адресі — коротким кодом (encodeShort): ранги й слоти одним числом, ≤ 40 знаків.
 * Код залежить від порядку вузлів у дереві, тож після патчу той самий код дає інший білд. Збережене (свій білд у
 * браузері, білди на сервері) тому ще й знімком (snap): «вузол: ранг», слоти, спеціалізації й версія даних; unsnap
 * відновлює за id і каже, що змінилось (вузол прибрали, ранг обрізали, очок стало інакше).
 */
import { currentLang, locale, t } from './i18n'
import { create } from 'zustand'
import { useLoc } from './skillsUk'

export interface SkillLevel { cost: number; bonuses: [string, number, boolean][]; perks: string[]; buffs: string[] }
export interface Skill {
  id: string
  /** назва англійською (questlog) */
  name: string
  /** назва й опис мовою сайту (з довідника сервера); немає перекладу — null */
  locName?: string | null
  locDesc?: string | null
  icon: string | null
  school: string
  kind: string
  desc: string
  x: number
  y: number
  max: number
  levels: SkillLevel[]
  and: string[]
  or: string[]
  /** з яких записів даних складено вузол (двійники злиті в один, mergeTwins) — по черзі рангів */
  parts?: { id: string; max: number }[]
}
/** sources[0] — звідки дерево: 'game' (файли гри) чи 'questlog.gg' */
export interface SkillsData { syncedAt: string; sources?: string[]; skills: Skill[] }
export type Build = Record<string, number>
/** слоти внизу: здібності (a) і прийоми (t), по три */
export type Eq = { a: string[]; t: string[] }

/** школи — у порядку гри (як у вкладці «Навички»), назви — як у грі мовою сайту */
export const SCHOOLS: [string, string, string][] = [
  ['trooper', t('Піхотинець'), t('Вогнепальна зброя, бій на силовій підвісці, гранати й тактичні гаджети: хто тримає дистанцію й поле бою.')],
  ['mentat', t('Ментат'), t('Люди-обчислювачі: точний розрахунок, тактика й тихе усунення цілей.')],
  ['planetologist', t('Планетолог'), t('Науковці й дослідники пустелі: виживання, техніка, мапи й тераформування.')],
  ['benegesserit', t('Бене Ґессерит'), t('Таємне сестринство: Голос, чарівницький шлях у бою й повне керування власним тілом.')],
  ['swordmaster', t('Майстер меча'), t('Спадкоємці школи Гінац: клинок, воля й шлях — ближній бій без рівних.')],
]
/** підпис типу вузла (ключ — typeOf) */
export const KIND: Record<string, string> = {
  ability: t('Здібність'),
  attribute: t('Атрибут'),
  perk: t('Прийом'),
}
export type SkillType = 'ability' | 'perk' | 'attribute'
const GAME_TYPE: Record<string, SkillType> = { Ability: 'ability', Technique: 'perk', Attribute: 'attribute' }
/** де questlog розходиться з грою (звірено з типами навичок гри 20.10.2026) */
const QL_FIX: Record<string, SkillType> = { skills_perk_shieldweakpoint: 'attribute' }
/**
 * Тип вузла, як у грі: здібність, прийом (у грі — Technique) чи атрибут (діє сам, у слоти не ставиться). Береться з
 * даних гри (gaming.tools, skillType); поки їх нема — з questlog, який плутає: його «спайсові» навички (потребують
 * прозорливості) і «наука» в грі — атрибути, а «Перевантаження щита» — атрибут, а не прийом.
 */
export function typeOf(s: Skill): SkillType {
  const g = useLoc.getState().map?.[s.parts?.[0]?.id ?? s.id]?.type
  if (g && GAME_TYPE[g]) return GAME_TYPE[g]
  return QL_FIX[s.id] ?? (s.kind === 'ability' ? 'ability' : s.kind === 'perk' ? 'perk' : 'attribute')
}
/** що ставиться в слоти внизу, як у грі: «Здібності» (3) і «Прийоми» (3); атрибути діють завжди */
export const slotOf = (s: Skill): 'a' | 't' | null => { const k = typeOf(s); return k === 'ability' ? 'a' : k === 'perk' ? 't' : null }
/**
 * Слоти в короткому коді білду — за давнім поділом questlog (спайсові — серед здібностей): так номери слотів і все,
 * що в коді після них (спеціалізації), читаються в старих посиланнях і збережених білдах так само; що не ставиться в
 * слот за грою — при читанні відкидається
 */
const codeSlotOf = (s: Skill): 'a' | 't' | null => (s.kind === 'ability' || s.kind === 'spice' ? 'a' : s.kind === 'perk' ? 't' : null)
/**
 * Гілки шкіл (за ключами капстоунів у даних) — назви, як у грі. У Майстра меча порядок у грі:
 * Клинок, Воля, Шлях — і в даних гілки йдуть так само зліва направо: blade, resolve, aggression
 */
export const BRANCH: Record<string, string> = {
  weaponry: t('Стрільба'), suspensortech: t('Тренування силової підвіски'), gadgets: t('Тактичні технології'),
  mentalcalculus: t('Ментальна майстерність'), assassination: t('Убивство'), tactician: t('Тактик'),
  scientist: t('Учений'), explorer: t('Дослідник'), driver: t('Механік'),
  weirdingway: t('Чарівницький шлях'), manipulation: t('Голос'), selfcontrol: t('Керування тілом'),
  blade: t('Клинок'), resolve: t('Воля'), aggression: t('Шлях'),
}
export const rankCost = (s: Skill, rank: number) => s.levels.slice(0, rank).reduce((n, l) => n + l.cost, 0)
export const spent = (skills: Skill[], b: Build) => skills.reduce((n, s) => n + rankCost(s, b[s.id] ?? 0), 0)

/**
 * Гілки школи — окремі зв'язні шматки дерева (між гілками ребер немає), кожна зі своїм ключем капстоуна;
 * зліва направо, як у грі. Повертає й мапу id → гілка
 */
export function layout(skills: Skill[], school: string) {
  const ss = skills.filter((s) => s.school === school)
  const ids = new Set(ss.map((s) => s.id))
  const adj = new Map<string, Set<string>>(ss.map((s) => [s.id, new Set<string>()]))
  for (const s of ss) for (const o of s.or) if (ids.has(o)) { adj.get(s.id)!.add(o); adj.get(o)!.add(s.id) }
  const seen = new Set<string>()
  const out: { key: string; name: string; nodes: Skill[] }[] = []
  for (const s of ss) {
    if (seen.has(s.id)) continue
    const nodes: Skill[] = []
    const st = [s.id]
    while (st.length) {
      const id = st.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      nodes.push(ss.find((x) => x.id === id)!)
      st.push(...adj.get(id)!)
    }
    const key = nodes.flatMap((n) => n.and).find((a) => a.startsWith('skills_key_capstone'))?.replace('skills_key_capstone', '') ?? ''
    out.push({ key, name: BRANCH[key] ?? key, nodes })
  }
  return out.sort((a, b) => Math.min(...a.nodes.map((n) => n.x)) - Math.min(...b.nodes.map((n) => n.x)))
}
export function branches(skills: Skill[]) {
  const out = new Map<string, string>() // id → гілка
  for (const [sc] of SCHOOLS) for (const b of layout(skills, sc)) for (const n of b.nodes) out.set(n.id, b.key)
  return out
}
/**
 * Де вузол на екрані, як у грі: сітка шестикутна — непарні ряди зсунуті на пів кроку, тож гілки виходять ромбами й
 * шестикутниками; вхід (y = 0) — унизу, завершальний вузол (y = 4) — угорі
 */
export const place = (s: Skill) => ({ vx: s.x - (s.y % 2 ? 0.5 : 0), vy: 4 - s.y })

/**
 * Два записи з одним ім'ям в одній клітинці (у даних так буває: «Cartographer» — карти-sinkchart і, з 1.5.3,
 * ширший огляд туману) — у грі це один вузол: зливаємо в один із рангами обох
 */
export function mergeTwins(skills: Skill[]): Skill[] {
  const out: Skill[] = []
  const rename = new Map<string, string>() // злитий id → той, що лишився
  for (const s of skills) {
    const twin = out.find((o) => o.school === s.school && o.x === s.x && o.y === s.y && o.name === s.name)
    if (!twin) { out.push({ ...s, levels: [...s.levels], or: [...s.or], and: [...s.and], parts: [{ id: s.id, max: s.max }] }); continue }
    rename.set(s.id, twin.id)
    twin.levels.push(...s.levels)
    twin.parts!.push({ id: s.id, max: s.max })
    twin.max += s.max
    if (s.desc && !twin.desc.includes(s.desc)) twin.desc += '\n\n' + s.desc
    if (s.locDesc && !twin.locDesc?.includes(s.locDesc)) twin.locDesc = twin.locDesc ? twin.locDesc + '\n\n' + s.locDesc : s.locDesc
    twin.or.push(...s.or)
  }
  for (const o of out) o.or = [...new Set(o.or.map((x) => rename.get(x) ?? x))].filter((x) => x !== o.id)
  return out
}

/**
 * Чи можна вузол брати (і тримати) при такій збірці. Ключі skills_key_… (школа, завершальний вузол гілки) у грі дає
 * тренер, а не очки — тут вважаємо їх виданими; умову тренера показує картка. branchOf і skills — для сумісності виклику
 */
export function open(s: Skill, b: Build, _branchOf: Map<string, string>, _skills: Skill[]): boolean {
  for (const a of s.and) {
    if (a.startsWith('skills_key_')) continue
    if (!(b[a] > 0)) return false
  }
  return !s.or.length || s.or.some((o) => b[o] > 0)
}

/** чи вся збірка тримається (після зняття рангу нічого не «повисло» без опори) */
export function valid(skills: Skill[], b: Build, branchOf: Map<string, string>) {
  // від входів — хвилею по взятих вузлах: усе взяте має бути досяжним
  const taken = skills.filter((s) => b[s.id] > 0)
  const ok = new Set<string>()
  let grew = true
  while (grew) {
    grew = false
    for (const s of taken) {
      if (ok.has(s.id)) continue
      const reach = !s.or.length || s.or.some((o) => ok.has(o))
      if (reach && open(s, b, branchOf, skills)) { ok.add(s.id); grew = true }
    }
  }
  return taken.every((s) => ok.has(s.id))
}

// ---------- збірка в адресі: короткий код ----------
/**
 * Код білду: ранги всіх вузлів і шість слотів — одним числом зі змішаною основою (у кожного вузла — max+1
 * варіантів, у слота — скільки вузлів його типу + «порожньо»), записаним знаками base64url. Довжина не росте
 * з білдом: на всі 108 вузлів і слоти — до ~36 знаків. Порядок вузлів — за місцем у дереві (школа, ряд,
 * стовпчик), він переживає оновлення даних. Перший знак — версія коду, другий — «відбиток» дерева: не збігся —
 * посилання зібране на іншій версії дерева (після патчу), розбираємо як є, але попереджаємо.
 * Версія 3 — ще й спеціалізації (lib/specs): рівень кожного з п'яти треків (0–100) і, для треків з рівнем > 0,
 * 41 біт куплених рис — найстаршими розрядами; з усім — до ~76 знаків. Версії 1 (без спеціалізацій) і 2 (лише
 * рівні, у старому порядку треків) теж читаються.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const CODE_V = '3'
const SPEC_N = 5 // треків (lib/specs.TRACKS)
const SPEC_R = 101 // рівні 0–100
const TRAITS = 41 // рис у треку (lib/specs.TRAITS)
/** версія 2 писала рівні в порядку «бій, збирання, виготовлення, дослідження, саботаж» — куди вони тепер */
const V2_TO_V3 = [3, 1, 0, 2, 4]
export type SpecCode = { lv: number[]; got: number[][] }
export const isShort = (code: string | null) => !!code && '123'.includes(code[0])
/** порядок вузлів у коді білду — однаковий для всіх мов сайту (англійські назви, фіксована мова порівняння) */
function order(skills: Skill[]) {
  const si = (s: Skill) => SCHOOLS.findIndex(([id]) => id === s.school)
  return [...skills].sort((a, b) => si(a) - si(b) || a.y - b.y || a.x - b.x || a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : 1))
}
const shape = (ord: Skill[]) => B64[ord.reduce((n, s, i) => (n + (i + 1) * (s.max + 1)) % 64, 0)]
const slotLists = (ord: Skill[]) => [['a', ord.filter((s) => codeSlotOf(s) === 'a')], ['t', ord.filter((s) => codeSlotOf(s) === 't')]] as const

export function encodeShort(skills: Skill[], b: Build, eq: Eq, spec?: SpecCode): string {
  const ord = order(skills)
  let n = 0n
  let mul = 1n
  const put = (v: number, radix: number) => { n += BigInt(v) * mul; mul *= BigInt(radix) }
  for (const s of ord) put(Math.min(b[s.id] ?? 0, s.max), s.max + 1)
  for (const [k, list] of slotLists(ord)) for (let i = 0; i < 3; i++) put(list.findIndex((s) => s.id === eq[k][i]) + 1, list.length + 1)
  const lv = Array.from({ length: SPEC_N }, (_, i) => Math.max(0, Math.min(SPEC_R - 1, Math.round(spec?.lv[i] ?? 0))))
  for (const l of lv) put(l, SPEC_R)
  for (let i = 0; i < SPEC_N; i++) if (lv[i]) for (let r = 0; r < TRAITS; r++) put(spec?.got[i]?.includes(r) ? 1 : 0, 2)
  if (!n) return ''
  let out = ''
  for (; n > 0n; n >>= 6n) out = B64[Number(n & 63n)] + out
  return CODE_V + shape(ord) + out
}
export function decodeShort(skills: Skill[], code: string): { b: Build; eq: Eq; spec: SpecCode; same: boolean } | null {
  if (!isShort(code)) return null
  const ord = order(skills)
  let n = 0n
  for (const ch of code.slice(2)) {
    const d = B64.indexOf(ch)
    if (d < 0) return null
    n = n * 64n + BigInt(d)
  }
  const take = (radix: number) => { const r = Number(n % BigInt(radix)); n /= BigInt(radix); return r }
  const b: Build = {}
  for (const s of ord) { const r = take(s.max + 1); if (r) b[s.id] = r }
  const eq: Eq = { a: [], t: [] }
  for (const [k, list] of slotLists(ord))
    for (let i = 0; i < 3; i++) {
      const x = list[take(list.length + 1) - 1]
      if (x && b[x.id] > 0 && slotOf(x) === k && !eq[k].includes(x.id)) eq[k].push(x.id)
    }
  const spec: SpecCode = { lv: Array(SPEC_N).fill(0), got: Array.from({ length: SPEC_N }, () => []) }
  if (code[0] === '2') V2_TO_V3.forEach((to) => { spec.lv[to] = take(SPEC_R) })
  if (code[0] === '3') {
    for (let i = 0; i < SPEC_N; i++) spec.lv[i] = take(SPEC_R)
    for (let i = 0; i < SPEC_N; i++) if (spec.lv[i]) for (let r = 0; r < TRAITS; r++) if (take(2)) spec.got[i].push(r)
  }
  return { b, eq, spec, same: code[1] === shape(ord) }
}

// ---------- стара збірка в адресі (до короткого коду): «?b=<школа>.<номер><ранг>…» ----------
export function encodeBuild(skills: Skill[], b: Build) {
  return SCHOOLS.map(([sc]) => {
    const ss = skills.filter((s) => s.school === sc)
    const parts = ss.map((s, i) => (b[s.id] > 0 ? `${i.toString(36)}${b[s.id]}` : '')).filter(Boolean)
    return parts.length ? `${sc}.${parts.join('')}` : ''
  }).filter(Boolean).join('_')
}
export function decodeBuild(skills: Skill[], s: string | null): Build {
  const b: Build = {}
  if (!s) return b
  for (const part of s.split('_')) {
    const [sc, body] = part.split('.')
    const ss = skills.filter((x) => x.school === sc)
    for (const m of (body ?? '').matchAll(/([0-9a-z])(\d)/g)) {
      const sk = ss[parseInt(m[1], 36)]
      const r = Number(m[2])
      if (sk && r > 0) b[sk.id] = Math.min(r, sk.max)
    }
  }
  return b
}

// ---------- знімок білду: стабільний між оновленнями даних ----------
export interface Snap {
  /** вузол → ранг */
  nodes: Build
  eq: Eq
  spec: SpecCode
  /** версія дерева (dataVer): інша — дерево після збереження змінилось */
  ver: string
  /** дата збору даних, на яких зібрано (syncedAt) */
  at: string
  /** скільки очок коштував білд тоді */
  pts: number
  /** назви взятих вузлів (англійською) — щоб назвати й ті, яких у новому дереві вже нема */
  names: Record<string, string>
}
/** що змінилось у білді після оновлення даних */
export interface Drift {
  gone: { id: string; name: string; rank: number }[]
  cut: { id: string; from: number; to: number }[]
  /** знято зі слотів (вузол прибрали чи він більше не ставиться в слот) */
  slots: number
  /** взяте тримається не все: зв'язки в дереві змінились */
  loose: boolean
  was: number
  now: number
}
/** відбиток дерева: id, ранги й ціни всіх вузлів (FNV-1a) — змінився хоч один вузол — інша версія */
export function dataVer(skills: Skill[]): string {
  const s = order(skills).map((x) => `${x.id}:${x.max}:${x.levels.map((l) => l.cost).join(',')}`).join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}
export function snap(data: SkillsData, b: Build, eq: Eq, spec: SpecCode): Snap {
  const byId = new Map(data.skills.map((s) => [s.id, s]))
  const nodes: Build = {}
  const names: Record<string, string> = {}
  for (const [id, r] of Object.entries(b)) if (r > 0 && byId.has(id)) { nodes[id] = r; names[id] = byId.get(id)!.name }
  return { nodes, eq: { a: [...eq.a], t: [...eq.t] }, spec: { lv: [...spec.lv], got: spec.got.map((g) => [...g]) }, ver: dataVer(data.skills), at: data.syncedAt, pts: spent(data.skills, b), names }
}
/** знімок → білд у поточному дереві (за id; злитий двійник — за id частини); drift — що змінилось (null — нічого) */
export function unsnap(skills: Skill[], s: Snap): { b: Build; eq: Eq; spec: SpecCode; drift: Drift | null } {
  const byId = new Map(skills.map((x) => [x.id, x]))
  for (const x of skills) for (const p of x.parts ?? []) if (!byId.has(p.id)) byId.set(p.id, x)
  const b: Build = {}
  const gone: Drift['gone'] = []
  const cut: Drift['cut'] = []
  for (const [id, r] of Object.entries(s.nodes ?? {})) {
    const x = byId.get(id)
    if (!x) { gone.push({ id, name: s.names?.[id] ?? id, rank: r }); continue }
    const to = Math.min(x.max, (b[x.id] ?? 0) + r)
    if (to < (b[x.id] ?? 0) + r) cut.push({ id: x.id, from: (b[x.id] ?? 0) + r, to })
    b[x.id] = to
  }
  const fits = (id: string, k: 'a' | 't') => { const x = byId.get(id); return !!x && b[x.id] > 0 && slotOf(x) === k }
  const eq: Eq = { a: [], t: [] }
  let slots = 0
  for (const k of ['a', 't'] as const)
    for (const id of s.eq?.[k] ?? []) {
      const x = byId.get(id)
      if (x && fits(id, k) && !eq[k].includes(x.id)) eq[k].push(x.id)
      else slots++
    }
  const spec: SpecCode = { lv: Array.from({ length: SPEC_N }, (_, i) => s.spec?.lv?.[i] ?? 0), got: Array.from({ length: SPEC_N }, (_, i) => [...(s.spec?.got?.[i] ?? [])]) }
  const now = spent(skills, b)
  const loose = !valid(skills, b, branches(skills))
  const same = s.ver === dataVer(skills)
  const drift = gone.length || cut.length || slots || loose || (!same && now !== s.pts) ? { gone, cut, slots, loose, was: s.pts, now } : null
  return { b, eq, spec, drift }
}

// ---------- опис білду: однаковий для всіх мов ----------
/**
 * Опис білду пишемо українською (школи й очки: «Майстер меча 54, Ментат 20 · 74 очки»), хоч би якою мовою був сайт
 * автора, — а показуємо мовою того, хто дивиться (aboutText): інакше в бібліотеці всі бачили б його мовою автора
 */
const SCHOOL_UK: Record<string, string> = { trooper: 'Піхотинець', mentat: 'Ментат', planetologist: 'Планетолог', benegesserit: 'Бене Ґессерит', swordmaster: 'Майстер меча' }
const ukForm = (n: number, [one, few, many]: [string, string, string]) => {
  const a = n % 10, b = n % 100
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many
}
export function aboutOf(per: [string, number][], total: number): string {
  const schools = per.filter(([, n]) => n > 0).map(([id, n]) => `${SCHOOL_UK[id] ?? id} ${n}`).join(', ')
  return [schools, `${total} ${ukForm(total, ['очко', 'очки', 'очок'])}`].filter(Boolean).join(' · ')
}
/** розібрати опис (aboutOf); чужий текст (давні білди, написані мовою автора) — null */
export function parseAbout(s: string | null | undefined): { schools: [string, number][]; total: number } | null {
  const m = /^(?:(.+) · )?(\d+) оч(?:ко|ки|ка|ок)$/.exec(String(s ?? '').trim())
  if (!m) return null
  const schools: [string, number][] = []
  for (const part of m[1] ? m[1].split(', ') : []) {
    const id = Object.keys(SCHOOL_UK).find((k) => part.startsWith(SCHOOL_UK[k] + ' '))
    const n = Number(part.slice((SCHOOL_UK[id ?? ''] ?? '').length + 1))
    if (!id || !Number.isInteger(n)) return null
    schools.push([id, n])
  }
  return { schools, total: Number(m[2]) }
}
/** опис мовою сайту; не розібрався — як є */
export function aboutText(s: string | null | undefined): string {
  const a = parseAbout(s)
  if (!a) return s ?? ''
  const name = (id: string) => SCHOOLS.find(([x]) => x === id)?.[1] ?? id
  const pts = new Intl.PluralRules(locale()).select(a.total)
  const word = pts === 'one' ? t('очко') : pts === 'few' ? t('очки') : t('очок')
  return [a.schools.map(([id, n]) => `${name(id)} ${n}`).join(', '), `${a.total.toLocaleString(locale())} ${word}`].filter(Boolean).join(' · ')
}

// ---------- завантаження ----------
export const useSkills = create<{ data: SkillsData | null; error: boolean; load: () => Promise<void> }>((set, get) => ({
  data: null,
  error: false,
  async load() {
    if (get().data) return
    set({ error: false }) // «Спробувати ще» — знову показати завантаження
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch(`/api/skills?lang=${encodeURIComponent(currentLang())}`)
        // сервер ще збирає — перепитати; збір не вдався (503) — не перепитувати, а показати «Спробувати ще»
        if (r.status === 202) { await new Promise((ok) => setTimeout(ok, 3000)); continue }
        if (!r.ok) throw new Error()
        const d = (await r.json()) as SkillsData
        set({ data: { ...d, skills: mergeTwins(d.skills) }, error: false })
        return
      } catch {
        set({ error: true })
        return
      }
    }
    set({ error: true })
  },
}))

/*
 * Права речей — у кожної свої (items.access, JSON), для всіх видів: хто редагує, копіює й куди, хто міняє права; у бази
 * й роадмапу ще й хто бачить історію версій; у роадмапу — ще й прогрес (RIGHTS_FOR). Нижче — як для роадмапу, що має
 * їх найбільше. Права роадмапу — у кожного свої: хто редагує зміст, чий прогрес (власника / у кожного свій /
 * спільний на всіх), хто відмічає й бачить прогрес, хто бачить «Прогрес учасників», хто й куди копіює, хто бачить
 * історію й хто міняє ці права. Кожне право — рівень на одній шкалі «від цього й вище» (LEVELS); які рівні є, залежить
 * від власника. Бачити сам роадмап — як і раніше, видимість реєстру (items.can().view): «усі, хто увійшов» значить
 * «усі, хто увійшов і бачить роадмап», тож для «Особисте» / «Гільдія» це й так лише свої.
 * Які рівні є, залежить і від видимості (сказав користувач: спершу «Особисте / Гільдія / Публічне», а від неї — права):
 * «Особисте» — вибору нема, усе лише власнику; «Гільдія» — лише ранги (бачить і так тільки гільдія, «усі, хто увійшов»
 * там те саме, що «уся гільдія»); «За посиланням» / «Публічне» — ще й «усі, хто увійшов» і «усі, і без входу».
 * Збережене, що для поточної видимості не діє, не стирається: відкрили роадмап знову — діє воно (effectiveAccess).
 * Аноніми — лише бачать (рівень anyone); змінювати щось без входу не можна: усе зберігається в базі, за людиною.
 * Адміністратор сайту може все, крім позначок у чужому особистому прогресі.
 */
import { can } from './items.mjs'
import { fail } from './util.mjs'

/** шкала: від найвужчого до найширшого */
export const LEVELS = ['nobody', 'owner', 'officer', 'member', 'recruit', 'users', 'anyone']
/** рівні, що мають сенс для власника */
const FOR_OWNER = {
  user: ['nobody', 'owner', 'users', 'anyone'],
  guild: LEVELS,
  site: ['nobody', 'owner', 'users', 'anyone'],
}
/** які рівні можна дати кожному праву (до обмеження за власником) */
const RANGE = {
  edit: ['nobody', 'owner', 'officer', 'member', 'recruit', 'users'],
  mark: ['nobody', 'owner', 'officer', 'member', 'recruit', 'users'],
  seeProgress: ['owner', 'officer', 'member', 'recruit', 'users', 'anyone'],
  members: ['owner', 'officer', 'member', 'recruit', 'users'],
  copy: ['nobody', 'owner', 'officer', 'member', 'recruit', 'users'],
  history: ['owner', 'officer', 'member', 'recruit', 'users', 'anyone'],
  settings: ['owner', 'officer'],
}
export const MODES = ['owner', 'each', 'all']
/** які права є в кожного виду (решта — не налаштовується й не показується) */
export const RIGHTS_FOR = {
  roadmap: ['edit', 'mark', 'seeProgress', 'members', 'copy', 'history', 'settings'],
  base: ['edit', 'copy', 'history', 'settings'],
  build: ['edit', 'copy', 'settings'],
  calc: ['edit', 'copy', 'settings'],
  marker: ['edit', 'settings'],
  place: ['edit', 'settings'],
  event: ['edit', 'settings'],
  listing: ['edit', 'settings'],
}
export const rightsFor = (kind) => RIGHTS_FOR[kind] || RIGHTS_FOR.roadmap
export const COPY_TO = ['user', 'guild']
export const RIGHTS = Object.keys(RANGE)

/**
 * типові права нової речі за видом власника (kind — вид речі; без нього — роадмап). Не роадмап — як було до
 * налаштувань: змінює власник (у гільдії — учасник і вище), історію бази бачать ті самі, хто її змінює.
 */
export function defaultAccess(ownerKind, kind = 'roadmap') {
  if (kind !== 'roadmap') {
    const edit = ownerKind === 'guild' ? 'member' : 'owner'
    return { edit, progress: 'owner', mark: 'nobody', seeProgress: 'owner', members: 'owner', copy: 'users', copyTo: [...COPY_TO], history: edit, settings: ownerKind === 'guild' ? 'officer' : 'owner' }
  }
  const base = { progress: 'owner', seeProgress: 'anyone', copy: 'users', copyTo: [...COPY_TO], history: 'anyone', settings: 'owner' }
  if (ownerKind === 'guild') return { ...base, edit: 'member', mark: 'member', members: 'recruit', settings: 'officer' }
  // у сайту нема «своєї» команди, що веде прогрес: гості з бібліотеки ведуть кожен свій
  if (ownerKind === 'site') return { ...base, edit: 'owner', progress: 'each', mark: 'users', members: 'owner' }
  return { ...base, edit: 'owner', mark: 'owner', members: 'owner' }
}

/** видимість, за якої вибору нема (бачить лише власник) */
const solo = (visibility) => visibility === 'private'
const OPEN_ONLY = new Set(['users', 'anyone'])

/** рівні, які можна дати праву key для такого власника (і такої видимості, якщо вказана) */
export function levelsFor(key, ownerKind, visibility) {
  if (solo(visibility)) return []
  const ok = RANGE[key].filter((l) => (FOR_OWNER[ownerKind] || FOR_OWNER.user).includes(l))
  return visibility === 'guild' ? ok.filter((l) => !OPEN_ONLY.has(l)) : ok
}
/** режими прогресу для видимості: «Особисте» — лише свій; «Гільдія» — без «спільного на всіх» (усі й так — гільдія) */
export const modesFor = (visibility) => (solo(visibility) ? ['owner'] : visibility === 'guild' ? ['owner', 'each'] : MODES)

/** рівень, якого власник не має (офіцер в особистого), — до найближчого вужчого, що є («owner» чи «nobody») */
function fit(key, level, ownerKind) {
  const ok = levelsFor(key, ownerKind)
  if (ok.includes(level)) return level
  for (let i = LEVELS.indexOf(level); i >= 0; i--) if (ok.includes(LEVELS[i])) return LEVELS[i]
  return ok[0]
}

/** збережені права (рядок чи об'єкт, можна неповні) → повні й допустимі для власника */
export function normAccess(raw, ownerKind, kind = 'roadmap') {
  let a = raw
  if (typeof a === 'string') { try { a = JSON.parse(a) } catch { a = null } }
  const d = defaultAccess(ownerKind, kind)
  const out = { ...d }
  if (a && typeof a === 'object') {
    for (const k of RIGHTS) if (LEVELS.includes(a[k])) out[k] = fit(k, a[k], ownerKind)
    if (MODES.includes(a.progress)) out.progress = a.progress
    if (Array.isArray(a.copyTo)) out.copyTo = COPY_TO.filter((x) => a.copyTo.includes(x))
  }
  return out
}

/**
 * Права, що діють за поточної видимості: «Особисте» — усе лише власнику; «Гільдія» — «усі, хто увійшов» стає «уся
 * гільдія», «спільний на всіх» — прогресом власника. Збережені (normAccess) від цього не змінюються.
 */
export function effectiveAccess(raw, ownerKind, visibility, kind = 'roadmap') {
  const a = normAccess(raw, ownerKind, kind)
  if (solo(visibility)) return { ...a, edit: 'owner', progress: 'owner', mark: 'owner', seeProgress: 'owner', members: 'owner', copy: 'owner', history: 'owner', settings: 'owner' }
  if (visibility !== 'guild') return a
  const out = { ...a }
  for (const k of RIGHTS) if (OPEN_ONLY.has(out[k])) out[k] = ownerKind === 'guild' ? 'recruit' : 'owner'
  if (out.progress === 'all') out.progress = 'owner'
  return out
}

/**
 * Зміна прав з запиту: лише відомі ключі, лише допустимі для власника й видимості значення — інакше 400 з
 * поясненням (а не мовчки інше). cur — збережені права (normAccess); повертає нові повні.
 */
export function patchAccess(cur, patch, ownerKind, visibility, kind = 'roadmap') {
  if (!patch || typeof patch !== 'object') throw fail('порожні налаштування')
  if (solo(visibility)) throw fail(kind === 'roadmap' ? 'особистий роадмап бачиш і змінюєш лише ти — щоб дати права іншим, відкрий його в «Доступ»' : 'особисте бачиш і змінюєш лише ти — щоб дати права іншим, відкрий це в «Доступ»')
  const out = { ...cur }
  const has = new Set(rightsFor(kind))
  for (const [k, v] of Object.entries(patch)) {
    // чого в цього виду нема (прогрес у бази) — так само невідоме налаштування
    if (k !== 'copyTo' && k !== 'progress' && RIGHTS.includes(k) && !has.has(k)) throw fail('невідоме налаштування')
    if ((k === 'progress' || k === 'copyTo') && !has.has(k === 'progress' ? 'mark' : 'copy')) throw fail('невідоме налаштування')
    if (k === 'progress') {
      if (!modesFor(visibility).includes(v)) throw fail('такого режиму прогресу для цієї видимості нема')
      out.progress = v
    } else if (k === 'copyTo') {
      if (!Array.isArray(v) || v.some((x) => !COPY_TO.includes(x))) throw fail('куди копіювати — в особисте й/або в гільдію')
      out.copyTo = COPY_TO.filter((x) => v.includes(x))
    } else if (RIGHTS.includes(k)) {
      if (!levelsFor(k, ownerKind, visibility).includes(v)) throw fail('такого рівня для цього права нема', 400)
      out[k] = v
    } else throw fail('невідоме налаштування')
  }
  return out
}

/** чий запис прогресу власника: людина, гільдія чи сайт */
export const ownerScope = (it) => (it.owner_kind === 'guild' ? `g:${it.owner_id}` : it.owner_kind === 'site' ? 'site' : `u:${it.owner_id}`)

/**
 * Чи контекст — у рівні level для речі it. «Свої» рівні (owner…recruit) — власник; users / anyone — ті, хто бачить
 * роадмап (users — ще й увійшовши). Адміністрацію (усе можна) враховує rightsOf.
 */
export function inLevel(ctx, it, level, view) {
  const u = ctx?.user
  switch (level) {
    case 'nobody': return false
    case 'anyone': return view
    case 'users': return view && !!u
    default: {
      if (it.owner_kind === 'user') return level === 'owner' && !!u && it.owner_id === u.id
      if (it.owner_kind === 'site') return level === 'owner' && !!ctx?.siteContent
      const rank = ctx?.ranks?.get(it.owner_id) || 0
      return rank >= { owner: 4, officer: 3, member: 2, recruit: 1 }[level]
    }
  }
}

/** «свій» роадмапу: власник, учасник гільдії-власника (з новобранцями), для сайту — ті, хто веде його вміст */
export const insider = (ctx, it) => inLevel(ctx, it, it.owner_kind === 'guild' ? 'recruit' : 'owner', true)

/**
 * Що контекст може з роадмапом за його правами: { view, edit, mark, seeProgress, members, copy, copyTo, history,
 * settings, settingsLevel, manage, own, scope, mode, whose }. scope — чий запис прогресу людині показувати й куди
 * писати її позначки (null — прогресу не бачить); whose — підпис для інтерфейсу.
 */
export function rightsOf(ctx, it, access = it?.access) {
  const base = can(ctx, it)
  const none = { view: false, edit: false, mark: false, seeProgress: false, members: false, copy: false, copyTo: [], history: false, settings: false, settingsLevel: false, manage: false, own: false, scope: null, mode: 'owner', whose: 'none' }
  if (!it || !base.view) return none
  const kind = it.kind || 'roadmap'
  const a = effectiveAccess(access, it.owner_kind, it.visibility, kind)
  const has = new Set(rightsFor(kind))
  const u = ctx?.user
  const admin = u?.role === 'admin' || !!ctx?.superuser
  const at = (level) => admin || inLevel(ctx, it, level, true)
  const mode = a.progress
  let scope = null, whose = 'none', mark = false
  if (!has.has('mark')) { /* у цього виду прогресу нема */ } else if (mode === 'each') {
    // у кожного свій: бачить свій кожен, хто увійшов; відмічає — кому дано
    if (u) { scope = `u:${u.id}`; whose = 'mine'; mark = at(a.mark) }
  } else {
    const shared = mode === 'all' ? 'all' : ownerScope(it)
    if (at(a.seeProgress)) {
      scope = shared
      whose = mode === 'all' ? 'all' : it.owner_kind === 'guild' ? 'guild' : it.owner_kind === 'site' ? 'site' : u && it.owner_id === u.id ? 'mine' : 'owner'
      // позначки — лише з входом; чужий особистий прогрес не відмічає й адміністратор
      mark = !!u && (shared.startsWith('u:') && shared !== `u:${u.id}` ? inLevel(ctx, it, a.mark, true) : at(a.mark))
    }
  }
  return {
    view: true,
    edit: !!u && at(a.edit),
    mark,
    seeProgress: !!scope,
    members: has.has('members') && !!u && at(a.members),
    copy: has.has('copy') && !!u && at(a.copy),
    copyTo: has.has('copy') ? a.copyTo : [],
    history: has.has('history') && at(a.history),
    settings: !!u && at(a.settings),
    // міняти саме «хто міняє права» — лише власник (лідер), щоб офіцер не відсік лідера
    settingsLevel: !!u && (admin || base.own || inLevel(ctx, it, 'owner', true)),
    manage: base.manage,
    own: base.own,
    scope,
    mode,
    whose,
  }
}

/**
 * Рівні прав роадмапу — те саме, що server/lib/roadmap-access.mjs (тест src/lib/roadmapLevels.test.ts звіряє їх):
 * потрібні тут, щоб у вікні «Доступ» права одразу підлаштовувались під вибрану видимість, ще до збереження.
 * «Особисте» — вибору нема (усе лише власнику); «Гільдія» — лише ранги; «За посиланням» / «Публічне» — ще й «усі».
 */
import type { Access, Level, Mode, RightKey } from './roadmap'
import type { Kind } from './items'

export type OwnerKind = 'user' | 'guild' | 'site'
export type Vis = 'private' | 'guild' | 'link' | 'public'

export const LEVELS: Level[] = ['nobody', 'owner', 'officer', 'member', 'recruit', 'users', 'anyone']
export const MODES: Mode[] = ['owner', 'each', 'all']
export const RIGHT_KEYS: RightKey[] = ['edit', 'mark', 'seeProgress', 'members', 'copy', 'history', 'settings']
const FOR_OWNER: Record<OwnerKind, Level[]> = {
  user: ['nobody', 'owner', 'users', 'anyone'],
  guild: LEVELS,
  site: ['nobody', 'owner', 'users', 'anyone'],
}
const RANGE: Record<RightKey, Level[]> = {
  edit: ['nobody', 'owner', 'officer', 'member', 'recruit', 'users'],
  mark: ['nobody', 'owner', 'officer', 'member', 'recruit', 'users'],
  seeProgress: ['owner', 'officer', 'member', 'recruit', 'users', 'anyone'],
  members: ['owner', 'officer', 'member', 'recruit', 'users'],
  copy: ['nobody', 'owner', 'officer', 'member', 'recruit', 'users'],
  history: ['owner', 'officer', 'member', 'recruit', 'users', 'anyone'],
  settings: ['owner', 'officer'],
}
const OPEN_ONLY = new Set<Level>(['users', 'anyone'])
/** які права є в кожного виду речі */
export const RIGHTS_FOR: Record<Kind, RightKey[]> = {
  roadmap: ['edit', 'mark', 'seeProgress', 'members', 'copy', 'history', 'settings'],
  base: ['edit', 'copy', 'history', 'settings'],
  build: ['edit', 'copy', 'settings'],
  calc: ['edit', 'copy', 'settings'],
  marker: ['edit', 'settings'],
  place: ['edit', 'settings'],
  event: ['edit', 'settings'],
  listing: ['edit', 'settings'],
}
export const rightsFor = (kind: Kind): RightKey[] => RIGHTS_FOR[kind] ?? RIGHTS_FOR.roadmap

export function defaultAccess(ok: OwnerKind, kind: Kind = 'roadmap'): Access {
  if (kind !== 'roadmap') {
    const edit: Level = ok === 'guild' ? 'member' : 'owner'
    return { edit, progress: 'owner', mark: 'nobody', seeProgress: 'owner', members: 'owner', copy: 'users', copyTo: ['user', 'guild'], history: edit, settings: ok === 'guild' ? 'officer' : 'owner' }
  }
  const base = { progress: 'owner' as Mode, seeProgress: 'anyone' as Level, copy: 'users' as Level, copyTo: ['user', 'guild'] as Access['copyTo'], history: 'anyone' as Level, settings: 'owner' as Level }
  if (ok === 'guild') return { ...base, edit: 'member', mark: 'member', members: 'recruit', settings: 'officer' }
  if (ok === 'site') return { ...base, edit: 'owner', progress: 'each', mark: 'users', members: 'owner' }
  return { ...base, edit: 'owner', mark: 'owner', members: 'owner' }
}

export function levelsFor(key: RightKey, ok: OwnerKind, vis?: Vis): Level[] {
  if (vis === 'private') return []
  const out = RANGE[key].filter((l) => FOR_OWNER[ok].includes(l))
  return vis === 'guild' ? out.filter((l) => !OPEN_ONLY.has(l)) : out
}
export const modesFor = (vis: Vis): Mode[] => (vis === 'private' ? ['owner'] : vis === 'guild' ? ['owner', 'each'] : MODES)

/** рівень, якого власник не має, — до найближчого вужчого */
function fit(key: RightKey, l: Level, ok: OwnerKind): Level {
  const allowed = levelsFor(key, ok)
  if (allowed.includes(l)) return l
  for (let i = LEVELS.indexOf(l); i >= 0; i--) if (allowed.includes(LEVELS[i])) return LEVELS[i]
  return allowed[0]
}
export function normAccess(a: Partial<Access> | null | undefined, ok: OwnerKind, kind: Kind = 'roadmap'): Access {
  const out = defaultAccess(ok, kind)
  if (!a) return out
  for (const k of RIGHT_KEYS) if (a[k] && LEVELS.includes(a[k] as Level)) out[k] = fit(k, a[k] as Level, ok)
  if (a.progress && MODES.includes(a.progress)) out.progress = a.progress
  if (Array.isArray(a.copyTo)) out.copyTo = (['user', 'guild'] as const).filter((x) => a.copyTo!.includes(x))
  return out
}
/** права, що діють за видимості (збережене, що не діє, лишається в normAccess) */
export function effectiveAccess(a: Partial<Access> | null | undefined, ok: OwnerKind, vis: Vis, kind: Kind = 'roadmap'): Access {
  const n = normAccess(a, ok, kind)
  if (vis === 'private') return { ...n, edit: 'owner', progress: 'owner', mark: 'owner', seeProgress: 'owner', members: 'owner', copy: 'owner', history: 'owner', settings: 'owner' }
  if (vis !== 'guild') return n
  const out = { ...n }
  for (const k of RIGHT_KEYS) if (OPEN_ONLY.has(out[k])) out[k] = ok === 'guild' ? 'recruit' : 'owner'
  if (out.progress === 'all') out.progress = 'owner'
  return out
}

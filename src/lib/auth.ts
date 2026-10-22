/**
 * Хто зайшов: людина, її гільдія (одна, з роллю — як у грі), заявки, налаштування сайту (реєстрація відкрита?, ліміт гільдії).
 * Вхід — поштою: код у лист → код на сайті (з двофакторною перевіркою — ще код застосунку), або паскеєм; нова пошта —
 * новий обліковий запис (паролів нема). Вхід і вихід
 * перезавантажують сторінку — усі списки (бази, роадмапи, мапа) мають перечитатись уже для іншої людини.
 */
import { create } from 'zustand'
import { get, patch, post } from './api'
import { currentLang, setLang, t } from './i18n'
import { passkeysHere, signInWithPasskey } from './webauthn'

export type SiteRole = 'user' | 'moderator' | 'admin'
export type GuildRole = 'leader' | 'officer' | 'member' | 'recruit'
export const GUILD_RANK: Record<GuildRole, number> = { recruit: 1, member: 2, officer: 3, leader: 4 }
/** роль із рангом цифрою: «Офіцер · 3» */
export const roleWithRank = (r: GuildRole) => `${GUILD_ROLE_LABEL[r]} · ${GUILD_RANK[r]}`
export const GUILD_ROLE_LABEL: Record<GuildRole, string> = { leader: t('Лідер'), officer: t('Офіцер'), member: t('Учасник'), recruit: t('Новобранець') }
export const SITE_ROLE_LABEL: Record<SiteRole, string> = { admin: t('Адміністратор'), moderator: t('Модератор'), user: t('Користувач') }
/** підпис ролі людини: вбудована — перекладена, своя — її назва (вбудовані назви перекладає t()) */
export const roleLabel = (u: Pick<User, 'role' | 'roleName'>) => (SITE_ROLE_LABEL as Record<string, string>)[u.role] ?? (u.roleName ? t(u.roleName) : '')
/** чи пускати в панель керування — за дозволом ролі, а не за її назвою */
export const canAdmin = (u: Pick<User, 'perms'> | null | undefined) => !!u?.perms?.some((p) => p === '*' || p === 'admin')

export interface User {
  id: string
  login: string
  /** лише своя (і в панелі керування) */
  email?: string
  name: string
  nick: string
  bio: string
  color: string
  role: SiteRole
  /** назва своєї (не вбудованої) ролі; вбудовані підписує SITE_ROLE_LABEL */
  roleName?: string | null
  /** дозволи ролі (лише свої, у /api/me) */
  perms?: string[]
  created: number
  /** гільдія людини (id) — та сама, що й Me.guild; тримається синхронно з членством */
  mainGuild?: string | null
  banned?: number | null
  banReason?: string
  seen?: number | null
  /** мова сайту, вибрана людиною (null — з браузера) */
  lang?: string | null
}
export interface Guild {
  id: string
  slug: string
  name: string
  tag: string
  about: string
  color: string
  open: boolean
  created: number
  members: number
}
export interface MyGuild extends Guild {
  role: GuildRole
  joined: number
}
export interface Me {
  user: User | null
  /** гільдія людини з її роллю (людина — лише в одній) чи null */
  guild: MyGuild | null
  /** те саме масивом із 0–1 елемента (для сторінок, що ще чекають список) */
  guilds: MyGuild[]
  requests: string[]
  /** guildCap — скільки людей у гільдії (ліміт сайту, як у грі — 32) */
  site: { registration: 'open' | 'closed'; defaultLang: string; name: string; guildCap: number }
}

/** відповідь входу: як /api/me + новенький?, скільки паскеїв (запропонувати створити), скільки резервних кодів лишилось */
export type SignedIn = Me & { created: boolean; passkeys: number; recoveryLeft?: number }
/** код із листа прийнято, але ввімкнено двофакторну перевірку — потрібен код застосунку з цим квитком */
export type NeedsCode = { twoFactor: true; ticket: string }

interface S extends Me {
  ready: boolean
  load: () => Promise<void>
  /** код у лист (відповідь однакова для будь-якої пошти) */
  sendCode: (email: string) => Promise<{ ok: boolean }>
  /** код із листа → вхід (нова пошта — новий обліковий запис) або другий крок */
  verify: (email: string, code: string) => Promise<SignedIn | NeedsCode>
  /** другий крок: код застосунку чи резервний */
  verify2fa: (ticket: string, code: string) => Promise<SignedIn>
  /** вхід паскеєм (conditional — підказкою в полі пошти) */
  passkey: (opts?: { conditional?: boolean; signal?: AbortSignal }) => Promise<SignedIn>
  logout: () => Promise<void>
  update: (p: Partial<Pick<User, 'name' | 'nick' | 'bio' | 'color' | 'login' | 'lang'>>) => Promise<void>
}

/**
 * Безпечна адреса повернення: лише цей самий сайт. «/\evil.com», «/%09/evil.com» браузер читає як чужий сайт —
 * тож розбираємо як адресу й беремо лише шлях, якщо джерело те саме.
 */
export function safeNext(next?: string | null): string | null {
  if (!next) return null
  try {
    const u = new URL(next, location.origin)
    return u.origin === location.origin ? u.pathname + u.search + u.hash : null
  } catch { return null }
}
/** після входу чи виходу — туди, куди йшли (?next=), або на головну; сторінку перечитуємо цілком */
function go(next?: string | null) {
  location.assign(safeNext(next) ?? '/')
}
const nextOf = () => new URLSearchParams(location.search).get('next')

export const useAuth = create<S>((set) => ({
  user: null,
  guild: null,
  guilds: [],
  requests: [],
  site: { registration: 'open', defaultLang: 'uk', name: 'Sandwalkers', guildCap: 32 },
  ready: false,
  load: async () => {
    try {
      const me = await get<Me>('/api/me')
      set({ ...me, ready: true })
      // мова з профілю — на пристрої, де людина ще не вибирала мову сама
      let picked = false
      try { picked = !!localStorage.getItem('lang') } catch { /* без сховища */ }
      if (me.user?.lang && !picked && me.user.lang !== currentLang()) void setLang(me.user.lang)
    } catch {
      set({ ready: true })
    }
  },
  sendCode: (email) => post<{ ok: boolean }>('/api/auth/code', { email }),
  verify: (email, code) => post<SignedIn | NeedsCode>('/api/auth/verify', { email, code }),
  verify2fa: (ticket, code) => post<SignedIn>('/api/auth/2fa', { ticket, code }),
  passkey: async (opts) => {
    const r = (await signInWithPasskey(opts)) as unknown as SignedIn
    try { localStorage.setItem('auth:passkey', '1') } catch { /* без сховища */ }
    return r
  },
  logout: async () => {
    await post('/api/auth/logout').catch(() => {})
    go('/')
  },
  update: async (p) => set(await patch<Me>('/api/me', p)),
}))

/** після входу: туди, куди йшов; новенький — у профіль (вказати ім'я), а звідти — далі (запрошення в гільдію тощо) */
export function finishSignIn(r: Pick<SignedIn, 'created'>) {
  try { localStorage.removeItem('auth:email') } catch { /* без сховища */ }
  const next = safeNext(nextOf())
  go(r.created ? (next && next !== '/' ? `/me?next=${encodeURIComponent(next)}` : '/me') : next)
}

/** запропонувати після входу кодом створити паскей: тут можна, у людини їх ще нема і вона не відмовилась нещодавно */
const SKIP_KEY = 'auth:passkey-skip'
export function offerPasskey(r: Pick<SignedIn, 'passkeys'>) {
  if (!passkeysHere() || r.passkeys > 0) return false
  try { return Date.now() - Number(localStorage.getItem(SKIP_KEY) || 0) > 30 * 86400_000 } catch { return true }
}
/** «Пізніше» — не питати місяць на цьому пристрої */
export function skipPasskeyOffer() {
  try { localStorage.setItem(SKIP_KEY, String(Date.now())) } catch { /* без сховища */ }
}

/** гільдії (з моєї єдиної), у яких можна створювати (учасник і вище) */
export const creatorGuilds = (gs: MyGuild[]) => gs.filter((g) => GUILD_RANK[g.role] >= 2)

/** адреса входу з поверненням сюди */
export const loginHref = () => `/login?next=${encodeURIComponent(location.pathname + location.search)}`

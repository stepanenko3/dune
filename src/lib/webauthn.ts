/**
 * Паскеї в браузері: параметри від сервера (base64url) → ArrayBuffer для navigator.credentials і відповідь назад у
 * JSON. Сервер — routes/security.mjs. За IP-адресою (192.168…) браузер паскеїв не дає — там їх і не показуємо.
 */
import { post } from './api'
import { t } from './i18n'

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')

/** чи можна паскеї тут: браузер уміє, сторінка безпечна (https чи localhost) і відкрита за іменем, а не за IP */
export const passkeysHere = () =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential && window.isSecureContext && !isIp(location.hostname)

/** чому паскеї тут недоступні (для підказки в профілі) — або null */
export function passkeysWhyNot(): string | null {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return t('Цей браузер не вміє паскеї.')
  if (isIp(location.hostname)) return t('Паскеї працюють лише на адресі сайту, а не за IP — відкрий сайт за його адресою.')
  if (!window.isSecureContext) return t('Паскеї працюють лише на захищеному з’єднанні (https).')
  return null
}

const buf = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
  const out = new Uint8Array(b.length)
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
  return out.buffer
}
const str = (b: ArrayBuffer | null) => {
  if (!b) return null
  let s = ''
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

type Json = Record<string, unknown>
type Desc = { type: 'public-key'; id: string; transports?: AuthenticatorTransport[] }

/** скасував сам (закрив вікно паскея) — не помилка, яку треба показувати */
export const cancelled = (e: unknown) => e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')

/** зрозуміле повідомлення про помилку паскея */
export function passkeyError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'InvalidStateError') return t('Цей паскей уже додано на цьому пристрої.')
    if (e.name === 'SecurityError') return t('Паскеї працюють лише на адресі сайту.')
    if (e.name === 'NotSupportedError') return t('Цей пристрій не вміє такі паскеї.')
  }
  return (e as Error)?.message || t('Паскей не спрацював')
}

/** вхід паскеєм; conditional — тихо, через підказки поля пошти (автозаповнення), signal — щоб скасувати */
export async function signInWithPasskey(opts: { conditional?: boolean; signal?: AbortSignal } = {}) {
  const o = await post<{ ticket: string; publicKey: Json & { challenge: string; allowCredentials: Desc[] } }>('/api/auth/passkey/options')
  const pk = o.publicKey
  const cred = (await navigator.credentials.get({
    publicKey: { ...(pk as unknown as PublicKeyCredentialRequestOptions), challenge: buf(pk.challenge), allowCredentials: pk.allowCredentials.map((c) => ({ ...c, id: buf(c.id) })) },
    ...(opts.conditional ? { mediation: 'conditional' as CredentialMediationRequirement } : {}),
    signal: opts.signal,
  })) as PublicKeyCredential | null
  if (!cred) throw new DOMException('cancelled', 'NotAllowedError')
  const r = cred.response as AuthenticatorAssertionResponse
  return post<Json & { passkeys: number }>('/api/auth/passkey', {
    ticket: o.ticket,
    credential: { id: cred.id, rawId: str(cred.rawId), type: cred.type, response: { clientDataJSON: str(r.clientDataJSON), authenticatorData: str(r.authenticatorData), signature: str(r.signature), userHandle: str(r.userHandle) } },
  })
}

/** чи вміє браузер підказувати паскеї прямо в полі пошти */
export async function conditionalAvailable() {
  try { return passkeysHere() && !!(await PublicKeyCredential.isConditionalMediationAvailable?.()) } catch { return false }
}

export interface PasskeyInfo { id: string; name: string; created: number; lastUsed: number | null; backedUp: boolean; transports: string[]; agent: string }
export interface TwoFactorState { enabled: boolean; since: number | null; recoveryLeft: number }
export interface SecurityState { passkeys: PasskeyInfo[]; twoFactor: TwoFactorState }

/** створити паскей для свого облікового запису (вхід уже є) */
export async function createPasskey(name?: string) {
  const o = await post<{ ticket: string; publicKey: Json & { challenge: string; user: Json & { id: string }; excludeCredentials: Desc[] } }>('/api/me/passkeys/options')
  const pk = o.publicKey
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...(pk as unknown as PublicKeyCredentialCreationOptions),
      challenge: buf(pk.challenge),
      user: { ...(pk.user as unknown as PublicKeyCredentialUserEntity), id: buf(pk.user.id) },
      excludeCredentials: pk.excludeCredentials.map((c) => ({ ...c, id: buf(c.id) })),
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new DOMException('cancelled', 'NotAllowedError')
  const r = cred.response as AuthenticatorAttestationResponse
  const res = await post<SecurityState & { id: string }>('/api/me/passkeys', {
    ticket: o.ticket,
    ...(name ? { name } : {}),
    credential: { id: cred.id, rawId: str(cred.rawId), type: cred.type, response: { clientDataJSON: str(r.clientDataJSON), attestationObject: str(r.attestationObject), transports: r.getTransports?.() ?? [] } },
  })
  // на цьому пристрої вже є паскей — сторінка входу покаже вхід паскеєм першим
  try { localStorage.setItem('auth:passkey', '1') } catch { /* без сховища */ }
  return res
}

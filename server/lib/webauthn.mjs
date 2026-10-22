/*
 * Паскеї (WebAuthn) без сторонніх бібліотек: розбір відповіді автентифікатора й перевірка підпису вбудованим crypto.
 *
 * Реєстрація: clientDataJSON (тип, виклик, сайт) + attestationObject (CBOR: authData з ключем у форматі COSE).
 * Засвідчення виробника не просимо (attestation: 'none') — нам не важливо, чий це пристрій, лише що ключ той самий.
 * Вхід: підпис authenticatorData ‖ sha256(clientDataJSON) збереженим ключем; лічильник підписів не має йти назад
 * (копія ключа). Ключ зберігаємо як SPKI (DER, base64url) — його розуміє crypto.createPublicKey без COSE.
 * Алгоритми: ES256 (-7, найчастіший), EdDSA (-8), RS256 (-257, Windows Hello).
 */
import crypto from 'node:crypto'
import { Decoder } from 'cbor-x'
import { fail } from './util.mjs'

const cbor = new Decoder({ mapsAsObjects: false, useRecords: false })
export const ALGS = [-7, -8, -257]

export const b64u = (buf) => Buffer.from(buf).toString('base64url')
export const fromB64u = (s) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw fail('хибна відповідь паскея')
  return Buffer.from(s, 'base64url')
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest()

/** IP замість імені сайту: паскеї там не працюють (браузер не дає), тож і не пропонуємо */
export const isIpHost = (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')

/** authenticatorData: відбиток сайту, прапорці, лічильник; при реєстрації — ще й id ключа і сам ключ (COSE) */
export function parseAuthData(buf) {
  if (buf.length < 37) throw fail('хибна відповідь паскея')
  const flagsByte = buf[32]
  const flags = { up: !!(flagsByte & 0x01), uv: !!(flagsByte & 0x04), be: !!(flagsByte & 0x08), bs: !!(flagsByte & 0x10), at: !!(flagsByte & 0x40), ed: !!(flagsByte & 0x80) }
  const out = { rpIdHash: buf.subarray(0, 32), flags, counter: buf.readUInt32BE(33) }
  if (flags.at) {
    if (buf.length < 55) throw fail('хибна відповідь паскея')
    out.aaguid = buf.subarray(37, 53).toString('hex')
    const len = buf.readUInt16BE(53)
    out.credId = buf.subarray(55, 55 + len)
    const rest = buf.subarray(55 + len)
    // за ключем можуть іти розширення (ed) — беремо лише перший CBOR-об'єкт
    let first
    cbor.decodeMultiple(rest, (v) => { first = v; return false })
    if (!(first instanceof Map)) throw fail('хибний ключ паскея')
    out.cose = first
  }
  return out
}

/** COSE-ключ → KeyObject і алгоритм */
export function coseToKey(cose) {
  const kty = cose.get(1), alg = cose.get(3)
  let jwk
  if (kty === 2 && alg === -7 && cose.get(-1) === 1) jwk = { kty: 'EC', crv: 'P-256', x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) }
  else if (kty === 1 && alg === -8 && cose.get(-1) === 6) jwk = { kty: 'OKP', crv: 'Ed25519', x: b64u(cose.get(-2)) }
  else if (kty === 3 && alg === -257) jwk = { kty: 'RSA', n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) }
  else throw fail('цей вид паскея не підтримується')
  return { alg, key: crypto.createPublicKey({ key: jwk, format: 'jwk' }) }
}

function checkClient(clientDataJSON, type, challenge, origin) {
  let c
  try { c = JSON.parse(clientDataJSON.toString('utf8')) } catch { throw fail('хибна відповідь паскея') }
  if (c.type !== type) throw fail('хибна відповідь паскея')
  // виклик — одноразовий і наш: інакше це повтор чужої відповіді
  const got = Buffer.from(String(c.challenge || ''), 'base64url'), want = Buffer.from(challenge, 'base64url')
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) throw fail('паскей відповів на інший запит — спробуй ще раз')
  if (c.origin !== origin) throw fail('паскей створено для іншого сайту')
}

function checkRp(auth, rpId) {
  if (!crypto.timingSafeEqual(auth.rpIdHash, sha256(rpId))) throw fail('паскей створено для іншого сайту')
  if (!auth.flags.up) throw fail('паскей не підтвердив, що це ти')
}

/**
 * реєстрація: { credential (як віддає браузер, base64url), challenge, origin, rpId } →
 * { id, publicKey (SPKI base64url), alg, counter, aaguid, transports, backedUp }
 */
export function verifyRegistration({ credential, challenge, origin, rpId }) {
  const r = credential?.response
  if (!credential || credential.type !== 'public-key' || !r) throw fail('хибна відповідь паскея')
  const clientData = fromB64u(r.clientDataJSON)
  checkClient(clientData, 'webauthn.create', challenge, origin)
  let att
  try { att = cbor.decode(fromB64u(r.attestationObject)) } catch { throw fail('хибна відповідь паскея') }
  const authData = att instanceof Map ? att.get('authData') : att?.authData
  if (!authData) throw fail('хибна відповідь паскея')
  const auth = parseAuthData(Buffer.from(authData))
  checkRp(auth, rpId)
  if (!auth.flags.at || !auth.cose) throw fail('паскей не передав ключ')
  const { alg, key } = coseToKey(auth.cose)
  const id = b64u(auth.credId)
  if (credential.id && credential.id !== id) throw fail('хибна відповідь паскея')
  const transports = Array.isArray(r.transports) ? r.transports.filter((x) => typeof x === 'string' && x.length < 20).slice(0, 6) : []
  return { id, publicKey: b64u(key.export({ type: 'spki', format: 'der' })), alg, counter: auth.counter, aaguid: auth.aaguid, transports, backedUp: auth.flags.bs, uv: auth.flags.uv }
}

/** вхід: перевіряє підпис збереженим ключем; повертає новий лічильник */
export function verifyAuthentication({ credential, challenge, origin, rpId, publicKey, alg, counter }) {
  const r = credential?.response
  if (!credential || credential.type !== 'public-key' || !r) throw fail('хибна відповідь паскея')
  const clientData = fromB64u(r.clientDataJSON)
  checkClient(clientData, 'webauthn.get', challenge, origin)
  const authData = fromB64u(r.authenticatorData)
  const auth = parseAuthData(authData)
  checkRp(auth, rpId)
  const data = Buffer.concat([authData, sha256(clientData)])
  const key = crypto.createPublicKey({ key: fromB64u(publicKey), format: 'der', type: 'spki' })
  const sig = fromB64u(r.signature)
  const ok = alg === -8 ? crypto.verify(null, data, key, sig)
    : alg === -7 ? crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, sig)
      : crypto.verify('sha256', data, key, sig)
  if (!ok) throw fail('паскей не підійшов', 401)
  // лічильник: обидва 0 — пристрій його не веде (iCloud, Google); інакше має рости
  if ((auth.counter || counter) && auth.counter <= counter) throw fail('цей паскей схожий на копію — увійди інакше й видали його', 401)
  return { counter: auth.counter, uv: auth.flags.uv, backedUp: auth.flags.bs }
}

/*
 * Коди застосунку-автентифікатора (TOTP, RFC 6238): HMAC-SHA1, крок 30 с, 6 цифр — так рахують Google Authenticator,
 * 1Password, «Паролі» в iPhone тощо. Секрет — 20 випадкових байтів у base32 (його показує QR-код).
 */
import crypto from 'node:crypto'

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const STEP = 30

export function base32(buf) {
  let bits = 0, val = 0, out = ''
  for (const b of buf) {
    val = (val << 8) | b
    bits += 8
    while (bits >= 5) { out += ABC[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += ABC[(val << (5 - bits)) & 31]
  return out
}

export function unbase32(s) {
  const clean = String(s).toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0, val = 0
  const out = []
  for (const ch of clean) {
    const i = ABC.indexOf(ch)
    if (i < 0) throw new Error('хибний base32')
    val = (val << 5) | i
    bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

export const newSecret = () => base32(crypto.randomBytes(20))

/** код для кроку часу */
export function codeAt(secret, step) {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest()
  const o = h[h.length - 1] & 15
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000
  return String(n).padStart(6, '0')
}

export const stepOf = (now = Date.now()) => Math.floor(now / 1000 / STEP)

/**
 * перевірка коду: допускаємо сусідні кроки (годинник телефона трохи розходиться); код не можна вжити двічі —
 * крок має бути новішим за останній прийнятий. Повертає прийнятий крок або null
 */
export function checkCode(secret, code, lastStep = 0, now = Date.now()) {
  const digits = String(code || '').replace(/\D/g, '')
  if (digits.length !== 6) return null
  const cur = stepOf(now)
  for (const s of [cur, cur - 1, cur + 1]) {
    if (s <= lastStep) continue
    const want = Buffer.from(codeAt(secret, s)), got = Buffer.from(digits)
    if (crypto.timingSafeEqual(want, got)) return s
  }
  return null
}

/** адреса для QR-коду й кнопки «Відкрити в застосунку» */
export const otpauthUri = ({ secret, label, issuer }) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`

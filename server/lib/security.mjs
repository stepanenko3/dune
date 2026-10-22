/*
 * Вхід без коду й захист облікового запису: паскеї, одноразові виклики (для паскеїв і другого кроку входу),
 * двофакторна перевірка застосунком (TOTP) з резервними кодами.
 *
 * Таблиці — окремо від users: секрети не потрапляють ні в історію змін людей, ні у вивантаження.
 *   passkeys — ключі людей (id — id ключа з автентифікатора, публічний ключ SPKI, лічильник підписів);
 *   auth_challenges — виклики паскеїв і квитки другого кроку (діють кілька хвилин, одноразові);
 *   user_2fa — секрет застосунку (enabled — коли увімкнено; NULL — налаштування ще не підтверджено);
 *   recovery_codes — відбитки резервних кодів (кожен — один раз).
 */
import crypto from 'node:crypto'
import { fail, plain } from './util.mjs'
import { checkCode, newSecret } from './totp.mjs'

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const CHALLENGE_MS = 5 * 60_000
const TICKET_MS = 10 * 60_000
const TICKET_TRIES = 5
const RECOVERY_N = 10
// без схожих знаків (0/o, 1/l/i): код переписують з папірця
const RC_ABC = 'abcdefghjkmnpqrstuvwxyz23456789'
export const MAX_PASSKEYS = 20

/** резервний код: «xxxx-xxxx» (регістр, пробіли й дефіс при введенні не важать) */
const normRecovery = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
function recoveryCode() {
  let s = ''
  for (let i = 0; i < 8; i++) s += RC_ABC[crypto.randomInt(RC_ABC.length)]
  return `${s.slice(0, 4)}-${s.slice(4)}`
}

export async function createSecurity(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', public_key TEXT NOT NULL, alg INTEGER NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '', aaguid TEXT NOT NULL DEFAULT '', backed_up INTEGER NOT NULL DEFAULT 0,
      agent TEXT NOT NULL DEFAULT '', created BIGINT NOT NULL, last_used BIGINT
    );
    CREATE INDEX IF NOT EXISTS passkeys_by_user ON passkeys (user_id);
    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id TEXT, challenge TEXT NOT NULL DEFAULT '', rp_id TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT '', tries INTEGER NOT NULL DEFAULT 0, expires BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_2fa (user_id TEXT PRIMARY KEY, secret TEXT NOT NULL, enabled BIGINT, last_step BIGINT NOT NULL DEFAULT 0, created BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_codes (user_id TEXT NOT NULL, code TEXT NOT NULL, used BIGINT, PRIMARY KEY (user_id, code));
  `)
  await db.run('DELETE FROM auth_challenges WHERE expires < ?', Date.now())

  const passkeyRow = (p) => ({ id: p.id, name: p.name, created: p.created, lastUsed: p.last_used || null, backedUp: !!p.backed_up, transports: p.transports ? p.transports.split(',') : [], agent: p.agent })

  const challenges = {
    /** новий виклик паскея: id — квиток для клієнта, challenge — випадкові байти (base64url) */
    async make(kind, { userId = null, rpId = '', origin = '' } = {}) {
      // прострочені — геть (таблиця маленька: виклики живуть хвилини)
      await db.run('DELETE FROM auth_challenges WHERE expires < ?', Date.now())
      const id = crypto.randomBytes(18).toString('base64url')
      const challenge = crypto.randomBytes(32).toString('base64url')
      await db.run('INSERT INTO auth_challenges (id, kind, user_id, challenge, rp_id, origin, expires) VALUES (?, ?, ?, ?, ?, ?, ?)', sha(id), kind, userId, challenge, rpId, origin, Date.now() + CHALLENGE_MS)
      return { id, challenge }
    },
    /** забрати виклик (одноразово): лише одного виду й, якщо задано, тієї самої людини */
    async take(id, kind, userId) {
      if (typeof id !== 'string' || id.length > 64) throw fail('запит застарів — спробуй ще раз')
      const row = await db.get('DELETE FROM auth_challenges WHERE id = ? AND kind = ? RETURNING *', sha(id), kind)
      if (!row || row.expires < Date.now() || (userId !== undefined && row.user_id !== userId)) throw fail('запит застарів — спробуй ще раз')
      return row
    },
  }

  const tickets = {
    /** квиток другого кроку: пошту вже підтверджено, лишився код застосунку */
    async make(userId) {
      const id = crypto.randomBytes(24).toString('base64url')
      await db.run('INSERT INTO auth_challenges (id, kind, user_id, expires) VALUES (?, ?, ?, ?)', sha(id), '2fa', userId, Date.now() + TICKET_MS)
      return id
    },
    /** спроба з квитком: рахується до перевірки (паралельні запити не обійдуть ліміт); повертає людину */
    async use(id) {
      if (typeof id !== 'string' || id.length > 64) throw fail('вхід застарів — почни спочатку', 400, { restart: 1 })
      const row = await db.get('UPDATE auth_challenges SET tries = tries + 1 WHERE id = ? AND kind = ? AND tries < ? RETURNING *', sha(id), '2fa', TICKET_TRIES)
      if (!row) { await db.run('DELETE FROM auth_challenges WHERE id = ?', sha(id)); throw fail('забагато спроб або вхід застарів — почни спочатку', 429, { restart: 1 }) }
      if (row.expires < Date.now()) throw fail('вхід застарів — почни спочатку', 400, { restart: 1 })
      return { userId: row.user_id, left: TICKET_TRIES - Number(row.tries) }
    },
    done: (id) => db.run('DELETE FROM auth_challenges WHERE id = ?', sha(id)),
  }

  const passkeys = {
    list: async (userId) => (await db.all('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created', userId)).map(passkeyRow),
    count: async (userId) => Number((await db.get('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?', userId)).n),
    ids: async (userId) => (await db.all('SELECT id, transports FROM passkeys WHERE user_id = ?', userId)),
    byId: async (id) => (typeof id === 'string' && id.length <= 1400 ? (await db.get('SELECT * FROM passkeys WHERE id = ?', id)) || null : null),
    async add(userId, k, { name = '', agent = '' } = {}) {
      if ((await passkeys.count(userId)) >= MAX_PASSKEYS) throw fail('забагато паскеїв — видали непотрібні')
      if (await passkeys.byId(k.id)) throw fail('цей паскей уже додано', 409)
      await db.run('INSERT INTO passkeys (id, user_id, name, public_key, alg, counter, transports, aaguid, backed_up, agent, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        k.id, userId, plain(name, 60), k.publicKey, k.alg, k.counter || 0, (k.transports || []).join(','), k.aaguid || '', k.backedUp ? 1 : 0, String(agent).slice(0, 200), Date.now())
      return passkeyRow(await passkeys.byId(k.id))
    },
    used: (id, counter) => db.run('UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?', counter, Date.now(), id),
    async rename(userId, id, name) {
      const n = plain(name, 60)
      if (!n) throw fail('назва не може бути порожньою')
      if (!(await db.run('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?', n, id, userId)).changes) throw fail('немає такого паскея', 404)
    },
    async remove(userId, id) {
      if (!(await db.run('DELETE FROM passkeys WHERE id = ? AND user_id = ?', id, userId)).changes) throw fail('немає такого паскея', 404)
    },
  }

  const twoFactor = {
    async status(userId) {
      const r = await db.get('SELECT enabled FROM user_2fa WHERE user_id = ?', userId)
      const left = r?.enabled ? Number((await db.get('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used IS NULL', userId)).n) : 0
      return { enabled: !!r?.enabled, since: r?.enabled || null, recoveryLeft: left }
    },
    on: async (userId) => !!(await db.get('SELECT 1 AS x FROM user_2fa WHERE user_id = ? AND enabled IS NOT NULL', userId)),
    /** почати налаштування: новий секрет (увімкнене — не чіпаємо: спершу вимкнути) */
    async setup(userId) {
      if (await twoFactor.on(userId)) throw fail('двофакторну перевірку вже увімкнено')
      const secret = newSecret()
      await db.run(`INSERT INTO user_2fa (user_id, secret, enabled, last_step, created) VALUES (?, ?, NULL, 0, ?)
        ON CONFLICT (user_id) DO UPDATE SET secret = excluded.secret, enabled = NULL, last_step = 0, created = excluded.created`, userId, secret, Date.now())
      return secret
    },
    /** підтвердити налаштування кодом із застосунку → увімкнено, нові резервні коди */
    async enable(userId, code) {
      const r = await db.get('SELECT * FROM user_2fa WHERE user_id = ?', userId)
      if (!r) throw fail('спершу почни налаштування')
      if (r.enabled) throw fail('двофакторну перевірку вже увімкнено')
      const step = checkCode(r.secret, code, r.last_step)
      if (step == null) throw fail('код не підійшов — перевір час на телефоні й введи свіжий')
      await db.run('UPDATE user_2fa SET enabled = ?, last_step = ? WHERE user_id = ?', Date.now(), step, userId)
      return twoFactor.newRecovery(userId)
    },
    async newRecovery(userId) {
      const codes = Array.from({ length: RECOVERY_N }, recoveryCode)
      await db.tx(async (t) => {
        await t.run('DELETE FROM recovery_codes WHERE user_id = ?', userId)
        for (const c of codes) await t.run('INSERT INTO recovery_codes (user_id, code) VALUES (?, ?)', userId, sha(normRecovery(c)))
      })
      return codes
    },
    /**
     * код другого кроку: 6 цифр із застосунку або резервний (одноразовий). Повертає 'totp' | 'recovery' | null
     */
    async check(userId, code) {
      const r = await db.get('SELECT * FROM user_2fa WHERE user_id = ? AND enabled IS NOT NULL', userId)
      if (!r) return null
      const s = String(code || '')
      if (/^\s*\d[\d\s]*$/.test(s)) {
        const step = checkCode(r.secret, s, r.last_step)
        // лише один запит забирає цей крок (той самий код двічі — ні)
        if (step != null && (await db.run('UPDATE user_2fa SET last_step = ? WHERE user_id = ? AND last_step < ?', step, userId, step)).changes) return 'totp'
        return null
      }
      const n = normRecovery(s)
      if (n.length !== 8) return null
      if ((await db.run('UPDATE recovery_codes SET used = ? WHERE user_id = ? AND code = ? AND used IS NULL', Date.now(), userId, sha(n))).changes) return 'recovery'
      return null
    },
    async disable(userId) {
      await db.run('DELETE FROM user_2fa WHERE user_id = ?', userId)
      await db.run('DELETE FROM recovery_codes WHERE user_id = ?', userId)
    },
    secretOf: async (userId) => (await db.get('SELECT secret FROM user_2fa WHERE user_id = ? AND enabled IS NULL', userId))?.secret || null,
  }

  return {
    challenges,
    tickets,
    passkeys,
    twoFactor,
    /** людину видалено — її ключі й коди теж */
    async removeUser(userId) {
      await db.run('DELETE FROM passkeys WHERE user_id = ?', userId)
      await db.run('DELETE FROM auth_challenges WHERE user_id = ?', userId)
      await twoFactor.disable(userId)
    },
  }
}

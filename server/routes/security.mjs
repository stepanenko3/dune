/*
 * Вхід паскеєм і захист облікового запису (маршрути — частина createAuthRoutes, бо вхід закінчується так само).
 *   POST /api/auth/passkey/options → { ticket, publicKey } — виклик для входу (будь-яким своїм паскеєм, без пошти);
 *   POST /api/auth/passkey { ticket, credential } — вхід; паскей — це вже два фактори, тож код застосунку не питаємо;
 *   POST /api/auth/2fa { ticket, code } — другий крок після коду з пошти (код застосунку чи резервний);
 *   GET /api/me/security — свої паскеї й стан двофакторної перевірки;
 *   POST /api/me/passkeys/options → { ticket, publicKey }; POST /api/me/passkeys { ticket, credential, name? };
 *   PATCH /api/me/passkeys/:id { name }; DELETE /api/me/passkeys/:id;
 *   POST /api/me/2fa/setup → { secret, uri }; POST /api/me/2fa/enable { code } → { codes };
 *   POST /api/me/2fa/recovery { code } → { codes } (нові резервні); POST /api/me/2fa/disable { code }.
 * Паскеї працюють лише на імені сайту (dune.test, localhost) — за IP браузер їх не дає; сайт — з адреси запиту.
 */
import { createLimiter } from '../lib/auth.mjs'
import { b64u, fromB64u, isIpHost, verifyAuthentication, verifyRegistration, ALGS } from '../lib/webauthn.mjs'
import { otpauthUri } from '../lib/totp.mjs'
import { fail } from '../lib/util.mjs'

/** відомі менеджери паскеїв (AAGUID) — назва за замовчуванням, щоб у списку було видно, де лежить ключ */
const PROVIDERS = {
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  'adce0002-35bc-c60a-648b-0b25f1f05503': 'Chrome',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  '531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
  '53414d53-554e-4700-0000-000000000000': 'Samsung Pass',
}
const dashed = (h) => (h && h.length === 32 ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : '')
const deviceOf = (ua = '') => (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '')

const hostOf = (h) => String(h || '').split(',')[0].trim().replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
/**
 * сайт для паскея: ім'я з джерела запиту (Origin, без порту). Джерело — наше, якщо браузер каже «той самий сайт»
 * (Sec-Fetch-Site: same-origin) або воно збігається з адресою запиту, X-Forwarded-Host чи APP_URL: за проксі
 * (dune.test → Vite → API) Host уже не той, що бачить браузер
 */
function rpOf(req) {
  const origin = req.get('origin') || ''
  let host = ''
  try { host = new URL(origin).hostname.toLowerCase() } catch { /* без Origin */ }
  let app = ''
  try { app = new URL(process.env.APP_URL || 'https://dune.test').hostname } catch { /* хибний APP_URL */ }
  const ours = req.get('sec-fetch-site') === 'same-origin' || [hostOf(req.get('host')), hostOf(req.get('x-forwarded-host')), app].includes(host)
  if (!host || !ours) throw fail('запит не з цього сайту', 403)
  if (isIpHost(host)) throw fail('паскеї працюють лише на адресі сайту, а не за IP', 400)
  return { rpId: host, origin }
}

export function mountSecurity(r, { auth, security, need, wrap, me, signIn, ipOf }) {
  const optIp = createLimiter({ max: 60, ms: 15 * 60_000 })
  const loginIp = createLimiter({ max: 30, ms: 15 * 60_000 })
  const twoIp = createLimiter({ max: 30, ms: 15 * 60_000 })
  // перевірка коду застосунку в профілі (вимкнути, нові резервні) — щоб викрадений сеанс не підбирав код
  const codeUser = createLimiter({ max: 10, ms: 15 * 60_000 })
  const tooMany = () => fail('забагато спроб — спробуй трохи згодом', 429)
  const siteName = () => auth.settings.get('siteName', 'Sandwalkers')

  // ---------- вхід паскеєм ----------
  r.post('/api/auth/passkey/options', wrap(async (req, res) => {
    if (!optIp.hit(ipOf(req))) throw tooMany()
    const rp = rpOf(req)
    const c = await security.challenges.make('login', rp)
    // без allowCredentials: браузер сам покаже паскеї цього сайту (пошту вводити не треба)
    res.json({ ticket: c.id, publicKey: { challenge: c.challenge, rpId: rp.rpId, timeout: 120_000, userVerification: 'preferred', allowCredentials: [] } })
  }))

  r.post('/api/auth/passkey', wrap(async (req, res) => {
    if (!loginIp.hit(ipOf(req))) throw tooMany()
    const ch = await security.challenges.take(req.body?.ticket, 'login')
    const cred = req.body?.credential
    const key = await security.passkeys.byId(typeof cred?.id === 'string' ? cred.id : '')
    if (!key) throw fail('цей паскей не знаємо — можливо, його видалили. Увійди кодом із пошти', 401)
    // userHandle — id людини, яку автентифікатор зберіг разом із ключем: має збігатися з власником ключа
    if (cred.response?.userHandle && fromB64u(cred.response.userHandle).toString('utf8') !== key.user_id) throw fail('паскей не підійшов', 401)
    const v = verifyAuthentication({ credential: cred, challenge: ch.challenge, origin: ch.origin, rpId: ch.rp_id, publicKey: key.public_key, alg: key.alg, counter: Number(key.counter) })
    await security.passkeys.used(key.id, v.counter)
    const u = await auth.get(key.user_id)
    if (!u) throw fail('паскей не підійшов', 401)
    await signIn(req, res, u)
  }))

  // ---------- другий крок після коду з пошти ----------
  r.post('/api/auth/2fa', wrap(async (req, res) => {
    if (!twoIp.hit(ipOf(req))) throw tooMany()
    const { userId, left } = await security.tickets.use(req.body?.ticket)
    const how = await security.twoFactor.check(userId, req.body?.code)
    if (!how) throw left > 0 ? fail('код не підійшов (спроб лишилось: {n})', 400, { n: left }) : fail('забагато спроб — почни вхід спочатку', 429, { restart: 1 })
    await security.tickets.done(req.body.ticket)
    const u = await auth.get(userId)
    if (!u) throw fail('вхід застарів — почни спочатку', 400, { restart: 1 })
    await signIn(req, res, u, how === 'recovery' ? { recoveryLeft: (await security.twoFactor.status(u.id)).recoveryLeft } : {})
  }))

  // ---------- свої паскеї ----------
  const state = async (uid) => ({ passkeys: await security.passkeys.list(uid), twoFactor: await security.twoFactor.status(uid) })
  r.get('/api/me/security', need(), wrap(async (req, res) => res.set('cache-control', 'no-store').json(await state(req.user.id))))

  r.post('/api/me/passkeys/options', need(), wrap(async (req, res) => {
    if (!optIp.hit(ipOf(req))) throw tooMany()
    const rp = rpOf(req)
    const u = req.user
    const c = await security.challenges.make('register', { ...rp, userId: u.id })
    res.json({
      ticket: c.id,
      publicKey: {
        challenge: c.challenge,
        rp: { id: rp.rpId, name: await siteName() },
        // user.id — непублічний id людини (не пошта): за ним вхід знаходить власника; name — що показує менеджер паролів
        user: { id: b64u(Buffer.from(u.id)), name: u.email, displayName: u.name },
        pubKeyCredParams: ALGS.map((alg) => ({ type: 'public-key', alg })),
        // ключ має жити на пристрої чи в менеджері паролів (resident) — інакше без пошти вхід не знайде його
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
        excludeCredentials: (await security.passkeys.ids(u.id)).map((k) => ({ type: 'public-key', id: k.id, ...(k.transports ? { transports: k.transports.split(',') } : {}) })),
        attestation: 'none',
        timeout: 120_000,
      },
    })
  }))

  r.post('/api/me/passkeys', need(), wrap(async (req, res) => {
    const ch = await security.challenges.take(req.body?.ticket, 'register', req.user.id)
    const k = verifyRegistration({ credential: req.body?.credential, challenge: ch.challenge, origin: ch.origin, rpId: ch.rp_id })
    const agent = req.get('user-agent') || ''
    const name = String(req.body?.name || '').trim() || PROVIDERS[dashed(k.aaguid)] || deviceOf(agent) || req.t('Паскей')
    const added = await security.passkeys.add(req.user.id, k, { name, agent })
    res.status(201).json({ id: added.id, passkey: added, ...(await state(req.user.id)) })
  }))

  r.patch('/api/me/passkeys/:id', need(), wrap(async (req, res) => {
    await security.passkeys.rename(req.user.id, req.params.id, req.body?.name)
    res.json(await state(req.user.id))
  }))

  r.delete('/api/me/passkeys/:id', need(), wrap(async (req, res) => {
    await security.passkeys.remove(req.user.id, req.params.id)
    res.json(await state(req.user.id))
  }))

  // ---------- двофакторна перевірка ----------
  r.post('/api/me/2fa/setup', need(), wrap(async (req, res) => {
    const secret = await security.twoFactor.setup(req.user.id)
    res.set('cache-control', 'no-store').json({ secret, uri: otpauthUri({ secret, label: req.user.email, issuer: await siteName() }) })
  }))

  r.post('/api/me/2fa/enable', need(), wrap(async (req, res) => {
    if (!codeUser.hit(req.user.id)) throw tooMany()
    const codes = await security.twoFactor.enable(req.user.id, req.body?.code)
    res.set('cache-control', 'no-store').json({ codes, ...(await state(req.user.id)) })
  }))

  /** код застосунку (чи резервний) для змін у вже увімкненій перевірці */
  const confirm = async (req) => {
    if (!codeUser.hit(req.user.id)) throw tooMany()
    if (!(await security.twoFactor.check(req.user.id, req.body?.code))) throw fail('код не підійшов')
  }
  r.post('/api/me/2fa/recovery', need(), wrap(async (req, res) => {
    await confirm(req)
    res.set('cache-control', 'no-store').json({ codes: await security.twoFactor.newRecovery(req.user.id), ...(await state(req.user.id)) })
  }))

  r.post('/api/me/2fa/disable', need(), wrap(async (req, res) => {
    await confirm(req)
    await security.twoFactor.disable(req.user.id)
    res.json(await state(req.user.id))
  }))

  return { me }
}

/*
 * Журнал усіх дій на сайті: кожен запит, що щось змінює (POST/PUT/PATCH/DELETE до /api), — рядок журналу: хто, що
 * (метод і маршрут), куди, відповідь, IP і тіло запиту без секретів (коди входу) й без великих документів.
 * Дії панелі керування рушій пише сам, детальніше, — їх тут не дублюємо. Людською мовою журнал показує
 * server/admin/describe.mjs — новий маршрут, що щось змінює, варто додати туди.
 */
// пошти (вхід, підтвердження видалення облікового запису) — теж: журнал живе місяцями, а пошта — особисте
// квитки входу й відповіді паскеїв — теж (квиток другого кроку дає увійти)
const SECRET = new Set(['code', 'password', 'token', 'sub', 'keys', 'email', 'confirm', 'ticket', 'credential'])
const BIG = new Set(['doc', 'rows', 'texts'])

function clean(v, depth = 0) {
  if (v == null || typeof v !== 'object') return typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v
  if (depth > 2) return '…'
  if (Array.isArray(v)) return v.length > 10 ? `[${v.length}]` : v.map((x) => clean(x, depth + 1))
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET.has(k) ? '•••' : BIG.has(k) ? (Array.isArray(x) ? `[${x.length}]` : '{…}') : clean(x, depth + 1)]))
}

/** часті дрібниці, які журнал лише засмічували б: «друкує…», «прочитано» */
const QUIET = /^\/(chats\/[^/]+\/(typing|read)|notifications\/read)$/
/** особисте листування: текст повідомлень у журнал не пишемо */
const PRIVATE = /^\/chats\//

export function auditMiddleware(auth) {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || req.path.startsWith('/admin/') || QUIET.test(req.path)) return next()
    const t0 = Date.now()
    // id того, що запит створив (нова база, гільдія, людина при реєстрації) — щоб журнал міг на нього послатися
    let made = null
    const json = res.json.bind(res)
    res.json = (body) => {
      if (res.statusCode < 400 && body && typeof body === 'object') made = (req.originalUrl.startsWith('/api/auth/') ? body.user?.id : body.id ?? body.guild?.id) ?? null
      return json(body)
    }
    res.on('finish', () => {
      const route = req.route?.path ? (req.baseUrl || '') + req.route.path : req.originalUrl.split('?')[0]
      // forget — людина щойно видалила свій обліковий запис: подія лишається, але безіменна й без IP
      const forget = !!res.locals.forgetActor
      const detail = { status: res.statusCode, ms: Date.now() - t0, ...(forget ? {} : { ip: req.ip }), body: PRIVATE.test(req.originalUrl.split('?')[0].replace(/^\/api/, '')) && req.body?.text != null ? { ...clean(req.body), text: '•••' } : clean(req.body), ...(made != null ? { id: String(made) } : {}) }
      // вхід, що створив обліковий запис, — окрема подія «Реєстрація», і її автор — нова людина
      const register = route === '/api/auth/verify' && res.statusCode === 201
      // вхід (код, паскей, другий крок) — автор той, хто увійшов
      const signIn = route === '/api/auth/verify' || route === '/api/auth/passkey' || route === '/api/auth/2fa'
      const actor = forget ? null : req.user?.id || (signIn && res.statusCode < 400 ? made : null)
      auth.log(actor || null, register ? 'register' : `${req.method} ${route}`.slice(0, 120), req.originalUrl.slice(0, 200), JSON.stringify(detail)).catch?.(() => {})
    })
    next()
  }
}

/**
 * Давні дублікати: до журналу всіх запитів маршрути писали події ще й самі («item.access», «guild.create»…) — тепер
 * кожна така подія є й рядком запиту. Прибираємо давній рядок, якщо поруч (±5 с, та сама людина) є рядок запиту.
 */
const LEGACY = {
  'item.access': 'PATCH /api/items/:kind/:id/access', 'guild.create': 'POST /api/guilds', 'guild.update': 'PATCH /api/guilds/:slug',
  'guild.delete': 'DELETE /api/guilds/:slug', 'guild.leave': 'POST /api/guilds/:slug/leave', 'guild.role': 'PATCH /api/guilds/:slug/members/:uid',
  'guild.kick': 'DELETE /api/guilds/:slug/members/:uid', 'guild.join': 'POST /api/invites/:code/accept', 'guild.accept': 'POST /api/guilds/:slug/requests/:uid',
  'user.delete.self': 'DELETE /api/me',
}
export async function dropLegacyDuplicates(db) {
  for (const [old, route] of Object.entries(LEGACY)) {
    await db.run('DELETE FROM audit WHERE action = ? AND actor IS NOT NULL AND EXISTS (SELECT 1 FROM audit b WHERE b.action = ? AND b.actor = audit.actor AND b.at BETWEEN audit.at - 5000 AND audit.at + 5000)', old, route)
  }
}

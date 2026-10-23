/*
 * Журнал дій та історія змін людською мовою. У базі лишається як є («PUT /api/bases/:id», «items ["place","x"]») —
 * тут із цього виходить «Збереження бази» і назва запису з посиланням на нього в панелі. Підписи — українські тексти-
 * ключі (клієнт перекладає їх t()), назви записів — як їх назвали люди.
 */

/** дія в журналі → підпис; also — давні назви тієї ж дії (до журналу всіх запитів маршрути писали самі) */
const AUDIT = [
  ['POST /api/auth/code', 'Запит коду входу'],
  ['POST /api/auth/verify', 'Вхід на сайт'],
  ['register', 'Реєстрація'],
  ['POST /api/auth/logout', 'Вихід із сайту'],
  ['POST /api/auth/passkey/options', 'Запит входу паскеєм'],
  ['POST /api/auth/passkey', 'Вхід паскеєм'],
  ['POST /api/auth/2fa', 'Вхід: код двофакторної перевірки'],
  ['POST /api/me/passkeys/options', 'Запит нового паскея'],
  ['POST /api/me/passkeys', 'Новий паскей'],
  ['PATCH /api/me/passkeys/:id', 'Перейменування паскея'],
  ['DELETE /api/me/passkeys/:id', 'Видалення паскея'],
  ['POST /api/me/2fa/setup', 'Налаштування двофакторної перевірки'],
  ['POST /api/me/2fa/enable', 'Увімкнення двофакторної перевірки'],
  ['POST /api/me/2fa/recovery', 'Нові резервні коди'],
  ['POST /api/me/2fa/disable', 'Вимкнення двофакторної перевірки'],
  ['PATCH /api/me', 'Зміна профілю'],
  ['PUT /api/me/house', 'Зміна дому в Ландсрааді'],
  ['DELETE /api/me', 'Видалення облікового запису', ['user.delete.self']],
  ['DELETE /api/me/sessions/:id', 'Завершення сеансу'],
  ['POST /api/me/sessions/others', 'Завершення інших сеансів'],
  ['POST /api/bases', 'Нова база'],
  ['POST /api/bases/import', 'База з файлу'],
  ['POST /api/bases/generate', 'Згенерована база'],
  ['PUT /api/bases/:id', 'Збереження бази'],
  ['DELETE /api/bases/:id', 'База в кошик'],
  ['POST /api/bases/:id/undelete', 'База з кошика'],
  ['POST /api/bases/:id/purge', 'База видалена назавжди'],
  ['POST /api/bases/:id/history/:hid/restore', 'Повернення версії бази'],
  ['POST /api/roadmaps', 'Новий роадмап'],
  ['PUT /api/roadmaps/:id', 'Збереження роадмапу'],
  ['DELETE /api/roadmaps/:id', 'Видалення роадмапу'],
  ['POST /api/roadmaps/:id/history/:hid/restore', 'Повернення версії роадмапу'],
  ['POST /api/roadmaps/:id/progress', 'Позначка прогресу роадмапу'],
  ['POST /api/roadmaps/:id/progress/import', 'Перенесення давніх позначок роадмапу'],
  ['DELETE /api/roadmaps/:id/progress', 'Скидання прогресу роадмапу'],
  ['POST /api/roadmaps/:id/progress/restore', 'Повернення прогресу роадмапу'],
  ['PATCH /api/roadmaps/:id/access-settings', 'Зміна прав роадмапу'],
  ['POST /api/builds', 'Новий білд'],
  ['PUT /api/builds/:id', 'Збереження білда'],
  ['DELETE /api/builds/:id', 'Видалення білда'],
  ['POST /api/calcs', 'Новий розрахунок'],
  ['PUT /api/calcs/:id', 'Збереження розрахунку'],
  ['DELETE /api/calcs/:id', 'Видалення розрахунку'],
  ['POST /api/markers', 'Нова позначка на мапі'],
  ['PUT /api/markers/:id', 'Зміна позначки на мапі'],
  ['DELETE /api/markers/:id', 'Видалення позначки на мапі'],
  ['POST /api/places', 'Новий запис ресурсу'],
  ['PATCH /api/places/:id', 'Зміна запису ресурсу'],
  ['DELETE /api/places/:id', 'Видалення запису ресурсу'],
  ['POST /api/events', 'Нова подія'],
  ['PUT /api/events/:id', 'Збереження події'],
  ['DELETE /api/events/:id', 'Видалення події'],
  ['POST /api/events/:id/watch', 'Глядач події'],
  ['POST /api/events/:id/teams', 'Реєстрація на подію'],
  ['PATCH /api/events/:id/teams/:tid', 'Зміна команди події'],
  ['DELETE /api/events/:id/teams/:tid', 'Команда знялась з події'],
  ['POST /api/events/:id/teams/:tid/join', 'Приєднання до команди події'],
  ['POST /api/events/:id/teams/:tid/leave', 'Вихід із команди події'],
  ['PATCH /api/items/:kind/:id/access', 'Зміна доступу', ['item.access']],
  ['POST /api/items/:kind/:id/copy', 'Копія собі'],
  ['POST /api/items/:kind/:id/star', 'Зірка'],
  ['POST /api/guilds', 'Нова гільдія', ['guild.create']],
  ['PATCH /api/guilds/:slug', 'Зміна гільдії', ['guild.update']],
  ['DELETE /api/guilds/:slug', 'Видалення гільдії', ['guild.delete']],
  ['POST /api/guilds/:slug/leave', 'Вихід із гільдії', ['guild.leave']],
  ['PATCH /api/guilds/:slug/members/:uid', 'Зміна рангу в гільдії', ['guild.role']],
  ['DELETE /api/guilds/:slug/members/:uid', 'Виключення з гільдії', ['guild.kick']],
  ['POST /api/guilds/:slug/invites', 'Нове запрошення до гільдії'],
  ['DELETE /api/guilds/:slug/invites/:code', 'Скасування запрошення'],
  ['POST /api/invites/:code/accept', 'Вступ до гільдії за запрошенням', ['guild.join']],
  ['POST /api/guilds/:slug/requests', 'Заявка до гільдії'],
  ['DELETE /api/guilds/:slug/requests', 'Скасування заявки до гільдії'],
  ['POST /api/guilds/:slug/requests/:uid', 'Розгляд заявки до гільдії', ['guild.accept']],
  ['POST /api/guilds/:slug/requests/:uid/comments', 'Коментар до заявки в гільдію'],
  ['POST /api/guilds/:slug/emblem', 'Новий герб гільдії'],
  ['DELETE /api/guilds/:slug/emblem', 'Герб гільдії прибрано'],
  ['PUT /api/guilds/:slug/decree', 'Указ гільдії'],
  ['PUT /api/decree', 'Указ Ландсрааду'],
  ['POST /api/catalog/refresh', 'Оновлення довідника'],
  ['POST /api/map/refresh', 'Оновлення мапи'],
  ['POST /api/admin/gamedata/update', 'Дані гри: оновлення до нової версії'],
  ['POST /api/admin/gamedata/update/check', 'Дані гри: перевірка нової версії в Steam'],
  ['POST /api/admin/gamedata/update/stop', 'Дані гри: зупинка оновлення'],
  ['POST /api/push/subscribe', 'Підписка на сповіщення'],
  ['POST /api/push/unsubscribe', 'Відписка від сповіщень'],
  ['POST /api/push/test', 'Пробне сповіщення'],
  ['admin.create', 'Панель: створення'],
  ['admin.update', 'Панель: зміна'],
  ['admin.delete', 'Панель: видалення'],
  ['admin.action', 'Панель: дія'],
  ['admin.settings', 'Панель: налаштування сайту', ['settings']],
  ['admin.announcements.bulk', 'Панель: оголошення кільком мовам'],
  ['admin.game-texts', 'Панель: тексти гри'],
  ['admin.game-texts.import', 'Панель: тексти гри з файлу'],
  ['admin.upload', 'Панель: завантаження зображення'],
  ['admin.base-photo', 'Панель: фото бази'],
]
export const AUDIT_OPTIONS = AUDIT.map(([value, label, also]) => (also ? { value, label, also } : { value, label }))

/** історія змін: дії сховищ (track у app.mjs) і рушія панелі */
export const REVISION_ACTIONS = {
  create: 'Створено', update: 'Змінено', delete: 'Видалено', trash: 'У кошик', restore: 'Повернуто з кошика',
  'restore-version': 'Повернуто версію', access: 'Змінено доступ', moderate: 'Модерація', role: 'Змінено роль',
  ban: 'Заблоковано', unban: 'Розблоковано', 'access-settings': 'Змінено права', 'progress-reset': 'Скинуто прогрес',
}
export const REVISION_TONES = { create: 'success', update: 'info', access: 'info', 'access-settings': 'info', 'progress-reset': 'warning', delete: 'critical', trash: 'warning', ban: 'critical', restore: 'info', unban: 'info' }

/** вид речі → розділ панелі */
const KIND_RES = { base: 'bases', build: 'builds', roadmap: 'roadmaps', calc: 'calcs', marker: 'markers', place: 'places', event: 'events' }
const DOC_RES = new Set(['bases', 'builds', 'roadmaps', 'calcs', 'markers', 'places', 'events'])

const parse = (s) => { try { return JSON.parse(s) } catch { return null } }

/** на що вказує подія журналу: [розділ, id] (id гільдії — поки slug: { slug }) або [розділ] — сам розділ */
export function subjectOf(row) {
  const action = String(row.action || ''), target = String(row.target || '')
  const d = typeof row.detail === 'string' ? parse(row.detail) : row.detail
  if (action === 'admin.action') return [target.split(':')[0]]
  if (action === 'admin.settings' || action === 'settings') return ['settings']
  if (action.startsWith('admin.game-texts')) return ['game-texts']
  if (action === 'admin.announcements.bulk') return ['announcements']
  if (action.startsWith('admin.')) { const i = target.indexOf('/'); return i > 0 ? [target.slice(0, i), target.slice(i + 1)] : [target] }
  if (action === 'register') return row.actor ? ['users', row.actor] : null
  if (action === 'item.access') { const [k, id] = target.split('/'); return KIND_RES[k] ? [KIND_RES[k], id] : null }
  if (action.startsWith('guild.')) {
    const [slug, uid] = target.split('/')
    return uid ? ['users', uid] : slug ? ['guilds', { slug }] : null
  }
  const p = target.split('?')[0].split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x) } catch { return x } })
  if (p[0] !== 'api') return null
  const created = d?.id ? String(d.id) : null
  switch (p[1]) {
    case 'items': return KIND_RES[p[2]] && p[3] ? [KIND_RES[p[2]], p[3]] : null
    case 'guilds':
      if ((p[3] === 'members' || p[3] === 'requests') && p[4]) return ['users', p[4]]
      if (p[2]) return ['guilds', { slug: p[2] }]
      return created ? ['guilds', created] : null
    case 'me': return row.actor ? ['users', row.actor] : null
    case 'auth': return p[2] === 'verify' && (row.actor || created) ? ['users', row.actor || created] : null
    case 'decree': return ['settings']
    default:
      if (!DOC_RES.has(p[1])) return null
      if (p[2] && p[2] !== 'import') return [p[1], p[2]]
      return created ? [p[1], created] : null
  }
}

/** відповідь сервера → успішно / відмовлено (4xx) / помилка (5xx); дії панелі пишуться лише після успіху */
export function statusOf(row) {
  const d = typeof row.detail === 'string' ? parse(row.detail) : row.detail
  const s = Number(d?.status)
  if (!s) return 'ok'
  return s >= 500 ? 'error' : s >= 400 ? 'denied' : 'ok'
}
export const STATUS_OPTIONS = [{ value: 'ok', label: 'Успішно' }, { value: 'denied', label: 'Відмовлено' }, { value: 'error', label: 'Помилка' }]
export const STATUS_TONES = { ok: 'success', denied: 'warning', error: 'critical' }

/**
 * Назви записів, на які вказують рядки: refs — [розділ, id | {slug}] для кожного рядка; повертає [посилання, назва]
 * у тому ж порядку. Запису вже нема — посилання нема, а назва — з останньої його версії в історії змін.
 */
async function resolve(refs, api, db) {
  const slugs = [...new Set(refs.filter((r) => r?.[1] && typeof r[1] === 'object').map((r) => r[1].slug))]
  const bySlug = slugs.length ? await api.guildIds(slugs) : new Map()
  const fixed = refs.map((r) => (r && r[1] && typeof r[1] === 'object' ? (bySlug.get(r[1].slug) ? ['guilds', bySlug.get(r[1].slug)] : null) : r))
  const by = new Map()
  for (const r of fixed) if (r?.[1] != null && api.has(r[0])) (by.get(r[0]) || by.set(r[0], new Set()).get(r[0])).add(String(r[1]))
  const names = new Map()
  for (const [res, ids] of by) for (const [id, title] of await api.titles(res, [...ids])) names.set(`${res}\n${id}`, title ?? id)
  // видалені: назва з останньої версії (назву історія пише в момент зміни; давні версії без неї — без назви)
  const gone = [...new Set(fixed.filter((r) => r?.[1] != null && api.has(r[0]) && !names.has(`${r[0]}\n${r[1]}`)).map((r) => `${r[0]}\n${r[1]}`))].slice(0, 50)
  const old = new Map()
  for (const k of gone) {
    const [res, id] = k.split('\n')
    const v = await db.get('SELECT title FROM revisions WHERE entity = ? AND entity_id = ? AND title IS NOT NULL ORDER BY id DESC LIMIT 1', res, id)
    if (v?.title) old.set(k, String(v.title))
  }
  // tr — назва цього розділу є текстом сайту (назви задач, вбудованих ролей, налаштувань) і перекладається
  return fixed.map((r) => {
    if (!r || !api.has(r[0])) return [null, null, false]
    if (r[1] == null) return [[r[0]], null, false]
    const k = `${r[0]}\n${r[1]}`, tr = !!api.trTitle?.(r[0])
    return names.has(k) ? [[r[0], String(r[1])], names.get(k), tr] : [null, old.get(k) ?? null, tr]
  })
}

/** журнал дій: target__label / target__ref (на що), status (успішно / відмовлено / помилка) */
export async function describeAudit(rows, api, db) {
  const got = await resolve(rows.map(subjectOf), api, db)
  rows.forEach((row, i) => {
    const [ref, label, tr] = got[i]
    row.target__ref = ref
    if (tr && label) row.target__tr = true
    row.target__label = label
    row.status = statusOf(row)
  })
  return rows
}

/** історія змін: entity_id__label (назва запису; видаленого — з історії) і посилання на нього, якщо він ще є */
export async function describeRevisions(rows, api, db) {
  const got = await resolve(rows.map((r) => [r.entity, r.entity_id]), api, db)
  rows.forEach((row, i) => {
    row.entity_id__ref = got[i][0]
    row.entity_id__label = got[i][1]
    if (got[i][2] && got[i][1]) row.entity_id__tr = true
  })
  return rows
}

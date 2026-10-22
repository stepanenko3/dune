/*
 * Ролі сайту з дозволами. Роль — ключ (users.role) і набір дозволів:
 *   '*'                — усе (адміністратор);
 *   'admin'            — вхід у панель керування;
 *   '<розділ>.view|create|edit|delete' — розділ панелі (users.view, bases.edit…);
 *   '<розділ>.<дія>'   — окрема дія розділу (users.ban, items.hide…);
 *   '<розділ>.*'       — усе в розділі;
 *   'site.decree', 'site.settings', 'site.moderate' — сайтові (указ тижня, налаштування, бачити сховане модерацією);
 *   'site.content' — робити речі «від сайту» й вести їх; 'site.owners' — у панелі віддавати річ будь-якій людині чи гільдії.
 * Вбудовані ролі (адміністратор, модератор, користувач) видалити не можна; адміністратора — і змінити.
 */
import { fail, plain } from './util.mjs'

const MOD = [
  'admin', 'site.moderate',
  'users.view', 'users.ban', 'users.unban', 'sessions.view',
  'guilds.view', 'members.view', 'invites.view', 'requests.view',
  'items.view', 'items.hide', 'items.unhide', 'items.feature', 'items.unfeature',
  'bases.view', 'roadmaps.view', 'builds.view', 'calcs.view', 'markers.view', 'places.view', 'events.view', 'event-teams.view', 'base-history.view', 'roadmap-history.view', 'stars.view',
  'game-items.view', 'game-placeables.view', 'game-recipes.view', 'game-buildables.view', 'game-skills.view', 'game-texts.view',
  'announcements.*', 'audit.view', 'revisions.view', 'cron-jobs.view', 'cron-runs.view',
]
export const BUILTIN = [
  { key: 'admin', name: 'Адміністратор', description: 'Усе на сайті й у панелі керування', permissions: ['*'] },
  { key: 'moderator', name: 'Модератор', description: 'Дивиться людей і вміст, блокує, модерує бібліотеку, веде оголошення', permissions: MOD },
  { key: 'user', name: 'Користувач', description: 'Звичайний гравець — без панелі керування', permissions: [] },
]

export async function createRoles(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS roles (
    key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', permissions TEXT NOT NULL DEFAULT '[]',
    system INTEGER NOT NULL DEFAULT 0, created BIGINT NOT NULL, updated BIGINT NOT NULL
  )`)
  // seeded — які типові дозволи вбудованої ролі вже застосовано: нові з коду (новий розділ) додаються самі,
  // а те, що адміністратор прибрав сам, назад не повертається
  await db.addColumn('roles', 'seeded', 'TEXT')
  const now = Date.now()
  for (const r of BUILTIN) {
    await db.run(`INSERT INTO roles (key, name, description, permissions, system, created, updated, seeded) VALUES (?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT (key) DO NOTHING`,
      r.key, r.name, r.description, JSON.stringify(r.permissions), now, now, JSON.stringify(r.permissions))
    const row = await db.get('SELECT permissions, seeded FROM roles WHERE key = ?', r.key)
    const have = new Set(JSON.parse(row.permissions || '[]')), seeded = new Set(JSON.parse(row.seeded || '[]'))
    const add = r.permissions.filter((p) => !seeded.has(p) && !have.has(p))
    if (add.length || row.seeded == null) {
      await db.run('UPDATE roles SET permissions = ?, seeded = ?, updated = ? WHERE key = ?', JSON.stringify([...have, ...add]), JSON.stringify(r.permissions), now, r.key)
    }
  }
  let cache = null
  const load = async () => {
    cache = new Map((await db.all('SELECT * FROM roles')).map((r) => [r.key, { ...r, permissions: new Set(JSON.parse(r.permissions || '[]')) }]))
    return cache
  }
  const all = async () => cache || load()

  /** дозволи ролі (Set); невідома роль — як у користувача */
  const permsOf = async (role) => (await all()).get(role)?.permissions ?? new Set()
  /** чи дозволено: точний дозвіл, '*' або '<розділ>.*' */
  const has = (perms, perm) => perms.has('*') || perms.has(perm) || perms.has(perm.split('.')[0] + '.*')
  const can = async (user, perm) => !!user && has(await permsOf(user.role), perm)

  return {
    has,
    can,
    permsOf,
    reload: load,
    list: async () => [...(await all()).values()].map((r) => ({ key: r.key, name: r.name, description: r.description, permissions: [...r.permissions], system: !!r.system })),
    exists: async (key) => (await all()).has(key),
    /** зберегти роль (нова чи зміна); адміністратора не змінюють */
    async save(key, { name, description, permissions }, creating) {
      key = String(key || '').trim().toLowerCase()
      if (!/^[a-z][a-z0-9_-]{1,31}$/.test(key)) throw fail('ключ ролі — латиниця, цифри, «_» і «-», 2–32 знаки')
      if (key === 'admin') throw fail('роль адміністратора не змінюється')
      const cur = (await all()).get(key)
      if (creating && cur) throw fail('така роль уже є', 409)
      if (!creating && !cur) throw fail('немає такої ролі', 404)
      const perms = [...new Set((Array.isArray(permissions) ? permissions : []).map(String).filter((p) => /^[\w.*-]{1,80}$/.test(p) && p !== '*'))]
      const now = Date.now()
      if (creating) await db.run('INSERT INTO roles (key, name, description, permissions, system, created, updated) VALUES (?, ?, ?, ?, 0, ?, ?)', key, plain(name, 60) || key, plain(description, 300), JSON.stringify(perms), now, now)
      else await db.run('UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description), permissions = ?, updated = ? WHERE key = ?',
        name == null ? null : plain(name, 60) || key, description == null ? null : plain(description, 300), JSON.stringify(perms), now, key)
      await load()
      return key
    },
    async remove(key) {
      const r = (await all()).get(key)
      if (!r) return false
      if (r.system) throw fail('вбудовану роль видалити не можна')
      const used = Number((await db.get('SELECT COUNT(*) AS n FROM users WHERE role = ?', key)).n)
      if (used) throw fail('цю роль мають {n} людей — спершу зміни їм роль', 400, { n: used })
      await db.run('DELETE FROM roles WHERE key = ?', key)
      await load()
      return true
    },
  }
}

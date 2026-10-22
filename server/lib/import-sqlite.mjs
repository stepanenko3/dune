/*
 * Перенесення з давньої SQLite (server/data/app.db) у Postgres — раз, коли Postgres щойно підключили: усі таблиці з
 * тими самими id, версіями й історією (бази, роадмапи, записи ресурсів, гільдії, реєстр речей, зірки, журнал,
 * налаштування, підписки на нагадування). Людей і сеанси не переносимо — у SQLite вони були з паролями (тепер вхід
 * поштою) і їх там ще ніхто не завів. Сам файл SQLite лишається як є — це й резервна копія.
 * Таблиці в Postgres уже мають бути створені сховищами; переносимо лише спільні стовпці (давні назви — через RENAME).
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const TABLES = [
  'meta', 'settings', 'places', 'docs', 'doc_history', 'push_subs', 'bases', 'base_history', 'roadmaps', 'roadmap_history',
  'builds', 'markers', 'guilds', 'items', 'stars', 'audit',
]
const RENAME = { invites: { by: 'by_user' } }
// лічильники-ключі, які треба підтягнути до найбільшого перенесеного значення
const SERIALS = [['doc_history', 'hid'], ['base_history', 'hid'], ['roadmap_history', 'hid'], ['audit', 'id']]

/** true — перенесли; false — нема чого чи вже */
export async function importSqlite(db, file, log = console) {
  if (db.kind !== 'pg' || !fs.existsSync(file)) return false
  if (await db.get("SELECT v FROM settings WHERE k = 'importedSqlite'")) return false
  // Postgres уже живе своїм життям (є бази чи записи) — не чіпаємо
  if ((await db.get('SELECT COUNT(*) AS n FROM bases')).n || (await db.get('SELECT COUNT(*) AS n FROM items')).n) {
    await db.run("INSERT INTO settings (k, v) VALUES ('importedSqlite', ?) ON CONFLICT (k) DO NOTHING", JSON.stringify('skipped'))
    return false
  }
  const { DatabaseSync } = require('node:sqlite')
  const src = new DatabaseSync(file, { readOnly: true })
  const have = new Set(src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name))
  const counts = {}
  await db.tx(async (t) => {
    for (const table of TABLES) {
      if (!have.has(table)) continue
      const target = new Set((await t.all('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?', table)).map((c) => c.column_name))
      if (!target.size) continue
      const rows = src.prepare(`SELECT * FROM ${table}`).all()
      const rename = RENAME[table] || {}
      // налаштування: позначки самого Postgres (що вже перенесено) не перезаписуємо
      for (const r of rows) {
        const cols = [], vals = []
        for (const [k, v] of Object.entries(r)) {
          const c = rename[k] || k
          if (!target.has(c)) continue
          cols.push(c)
          vals.push(v)
        }
        if (!cols.length) continue
        await t.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`, ...vals)
      }
      counts[table] = rows.length
    }
    for (const [table, col] of SERIALS) {
      const m = (await t.get(`SELECT MAX(${col}) AS m FROM ${table}`))?.m
      if (m) await t.get(`SELECT setval(pg_get_serial_sequence('${table}', '${col}'), ?)`, m)
    }
    await t.run("INSERT INTO settings (k, v) VALUES ('importedSqlite', ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", JSON.stringify(new Date().toISOString()))
  })
  src.close()
  log.info?.(`[db] перенесено з SQLite: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ')}`)
  return true
}

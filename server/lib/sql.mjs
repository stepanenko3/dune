/*
 * База: Postgres (з .env — DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME, DB_PASSWORD; їх заповнює Snotax console) або,
 * без нього, запасна SQLite у <dataDir>/app.db — з одним асинхронним інтерфейсом:
 *   await db.get(sql, ...args) → рядок | undefined;  db.all → рядки;  db.run → { changes };  db.exec(sql) — кілька команд;
 *   await db.tx(async (t) => …) — транзакція (t — той самий інтерфейс);  db.addColumn(таблиця, стовпець, опис);
 *   db.kind — 'pg' | 'sqlite';  db.close().
 * SQL пишемо з «?» — для Postgres вони стають $1, $2…; схема — з типами, які розуміють обидві: BIGINT для
 * мілісекунд, TEXT для JSON, {{SERIAL}} — лічильник-ключ (BIGSERIAL / INTEGER AUTOINCREMENT). BIGINT з Postgres
 * приходить числом (усі наші — мілісекунди й лічильники, у межах точності JS).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** «?» поза лапками → $1, $2… */
function dollars(sql) {
  let out = '', n = 0, q = false
  for (const ch of sql) {
    if (ch === "'") q = !q
    out += !q && ch === '?' ? `$${++n}` : ch
  }
  return out
}
const clean = (args) => args.map((a) => (a === undefined ? null : a))

/** налаштування з оточення: Postgres, якщо є DB_HOST (і DB_CONNECTION не sqlite) */
export function dbConfig(env = process.env) {
  if (!env.DB_HOST || env.DB_CONNECTION === 'sqlite') return null
  return { host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: env.DB_DATABASE || 'dune', user: env.DB_USERNAME || 'postgres', password: env.DB_PASSWORD || undefined }
}

export async function openDb({ dataDir, pg = dbConfig() } = {}) {
  return pg ? openPg(pg) : openSqlite(dataDir)
}

async function openPg(cfg) {
  const { Pool, types } = require('pg')
  types.setTypeParser(20, (v) => (v === null ? null : Number(v))) // BIGINT → число
  types.setTypeParser(1700, (v) => (v === null ? null : Number(v))) // NUMERIC (COUNT, SUM) → число
  const pool = new Pool({ ...cfg, max: 10 })
  // база обірвала з'єднання (перезапуск Postgres, pg_terminate_backend): без обробника pg кидає 'error' на пулі чи
  // клієнті — і падає весь сервер. Пишемо в журнал; зіпсоване з'єднання пул викидає, наступний запит відкриє нове
  const seen = new WeakSet() // ту саму помилку ловлять і клієнт, і пул — пишемо раз
  const lost = (e) => {
    if (e && typeof e === 'object') { if (seen.has(e)) return; seen.add(e) }
    console.warn(`[db] з'єднання з базою обірвалось (${e?.code || e?.message || e}) — перепідключусь на наступному запиті`)
  }
  pool.on('error', lost)
  pool.on('connect', (c) => c.on('error', lost))
  await pool.query('SELECT 1') // одразу видно, якщо з'єднання нема
  const on = (c) => ({
    kind: 'pg',
    get: async (sql, ...a) => (await c.query(dollars(sql), clean(a))).rows[0],
    all: async (sql, ...a) => (await c.query(dollars(sql), clean(a))).rows,
    run: async (sql, ...a) => ({ changes: (await c.query(dollars(sql), clean(a))).rowCount }),
    exec: async (sql) => { await c.query(sql.replaceAll('{{SERIAL}}', 'BIGSERIAL PRIMARY KEY')) },
  })
  const db = on(pool)
  db.tx = async (fn) => {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      const out = await fn(on(c))
      await c.query('COMMIT')
      return out
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      c.release()
    }
  }
  db.addColumn = (table, col, def) => db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${def}`)
  db.close = () => pool.end()
  db.label = `Postgres ${cfg.host}:${cfg.port}/${cfg.database}`
  return db
}

function openSqlite(dataDir) {
  const { DatabaseSync } = require('node:sqlite') // через require: vite-node (тести) не знає node:sqlite як import
  fs.mkdirSync(dataDir, { recursive: true })
  const s = new DatabaseSync(path.join(dataDir, 'app.db'))
  s.exec('PRAGMA journal_mode = WAL;')
  const prep = new Map()
  // кеш підготовлених запитів — обмежений (найдавніше використаний іде геть), інакше тексти з даними в SQL його роздувають
  const st = (sql) => {
    let p = prep.get(sql)
    if (p) { prep.delete(sql); prep.set(sql, p); return p }
    p = s.prepare(sql)
    prep.set(sql, p)
    if (prep.size > 500) prep.delete(prep.keys().next().value)
    return p
  }
  // транзакції по черзі: з'єднання одне, тож одночасні «BEGIN» не можна
  let chain = Promise.resolve()
  const db = {
    kind: 'sqlite',
    get: async (sql, ...a) => st(sql).get(...clean(a)) ?? undefined,
    all: async (sql, ...a) => st(sql).all(...clean(a)),
    run: async (sql, ...a) => ({ changes: Number(st(sql).run(...clean(a)).changes) }),
    exec: async (sql) => { s.exec(sql.replaceAll('{{SERIAL}}', 'INTEGER PRIMARY KEY AUTOINCREMENT')) },
    tx: (fn) => {
      const job = chain.then(async () => {
        s.exec('BEGIN')
        try { const out = await fn(db); s.exec('COMMIT'); return out } catch (e) { s.exec('ROLLBACK'); throw e }
      })
      chain = job.catch(() => {})
      return job
    },
    addColumn: async (table, col, def) => {
      const have = s.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)
      if (!have) s.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
    },
    close: async () => s.close(),
    label: `SQLite ${path.join(dataDir, 'app.db')}`,
    raw: s,
  }
  return db
}

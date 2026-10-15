/*
 * База записів — SQLite-файл <dataDir>/app.db через вбудований node:sqlite (Node 22.5+).
 * Таблиця одна: записи «Ресурсів» (де брати унікальні ресурси), кожен — JSON-документ.
 * Порожня база при першому запуску заповнюється з data/places.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED = path.join(__dirname, '..', '..', 'data', 'places.json')

export function createDb({ dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(path.join(dataDir, 'app.db'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY,
      doc TEXT NOT NULL,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  `)
  const seeded = db.prepare('SELECT v FROM meta WHERE k = ?').get('seeded')
  if (!seeded) {
    const rows = JSON.parse(fs.readFileSync(SEED, 'utf8'))
    const ins = db.prepare('INSERT OR IGNORE INTO places (id, doc, created, updated) VALUES (?, ?, ?, ?)')
    const now = Date.now()
    db.exec('BEGIN')
    rows.forEach((r, i) => {
      const { id, ...doc } = r
      ins.run(id, JSON.stringify({ ok: false, ...doc }), now + i, now + i)
    })
    db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('seeded', String(now))
    db.exec('COMMIT')
  }
  return db
}

// старі записи (до мапи) не мають pins/types/loot — віддаємо їх з порожніми значеннями
const DEFAULTS = { ok: false, zone: 'hagga', area: '', how: '', loot: '', pins: [], types: [] }
const row = (r) => (r ? { id: r.id, ...DEFAULTS, ...JSON.parse(r.doc), created: r.created, updated: r.updated } : null)

export function createPlacesStore(db) {
  const all = db.prepare('SELECT * FROM places ORDER BY created')
  const one = db.prepare('SELECT * FROM places WHERE id = ?')
  const ins = db.prepare('INSERT INTO places (id, doc, created, updated) VALUES (?, ?, ?, ?)')
  const upd = db.prepare('UPDATE places SET doc = ?, updated = ? WHERE id = ?')
  const del = db.prepare('DELETE FROM places WHERE id = ?')
  return {
    list: () => all.all().map(row),
    get: (id) => row(one.get(id)),
    add(doc) {
      const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const now = Date.now()
      ins.run(id, JSON.stringify(doc), now, now)
      return row(one.get(id))
    },
    patch(id, patch) {
      const cur = one.get(id)
      if (!cur) return null
      upd.run(JSON.stringify({ ...JSON.parse(cur.doc), ...patch }), Date.now(), id)
      return row(one.get(id))
    },
    remove: (id) => del.run(id).changes > 0,
  }
}

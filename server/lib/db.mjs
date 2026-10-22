/*
 * Записи «Ресурсів» (де брати унікальні ресурси) — кожен JSON-документ; власник і видимість — у реєстрі речей.
 * Порожня база при першому запуску заповнюється з data/places.json (seed — після перенесення давніх даних). Сама база — lib/sql.mjs (Postgres чи SQLite).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED = path.join(__dirname, '..', '..', 'data', 'places.json')

// старі записи (до мапи) не мають pins/types/loot — віддаємо їх з порожніми значеннями
const DEFAULTS = { ok: false, zone: 'hagga', area: '', how: '', loot: '', pins: [], types: [] }
const row = (r) => (r ? { id: r.id, ...DEFAULTS, ...JSON.parse(r.doc), created: r.created, updated: r.updated } : null)

export async function createPlacesStore(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS places (id TEXT PRIMARY KEY, doc TEXT NOT NULL, created BIGINT NOT NULL, updated BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  `)
  const one = async (id) => row(await db.get('SELECT * FROM places WHERE id = ?', id))
  return {
    /** порожня база — початкові записи з data/places.json (раз) */
    async seed() {
      if (await db.get('SELECT v FROM meta WHERE k = ?', 'seeded')) return
      const rows = JSON.parse(fs.readFileSync(SEED, 'utf8'))
      const now = Date.now()
      await db.tx(async (t) => {
        for (const [i, r] of rows.entries()) {
          const { id, ...doc } = r
          await t.run('INSERT INTO places (id, doc, created, updated) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', id, JSON.stringify({ ok: false, ...doc }), now + i, now + i)
        }
        await t.run('INSERT INTO meta (k, v) VALUES (?, ?)', 'seeded', String(now))
      })
    },
    list: async () => (await db.all('SELECT * FROM places ORDER BY created')).map(row),
    /** лише ці записи (ті, що людина бачить), у порядку створення — а не всі записи всіх людей */
    async many(ids) {
      const out = []
      // пачками: у SQLite обмеження на кількість «?» у запиті
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500).map(String)
        out.push(...(await db.all(`SELECT * FROM places WHERE id IN (${part.map(() => '?').join(',')})`, ...part)))
      }
      return out.sort((a, b) => Number(a.created) - Number(b.created)).map(row)
    },
    get: one,
    async add(doc) {
      const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
      const now = Date.now()
      await db.run('INSERT INTO places (id, doc, created, updated) VALUES (?, ?, ?, ?)', id, JSON.stringify(doc), now, now)
      return one(id)
    },
    /**
     * Змінити запис. base — «updated», від якого правили (змінили тим часом — { conflict, ...поточний });
     * addPins — додати точки до тих, що є (двоє, які одночасно тиснуть «+ до запису», не затирають точок одне одного).
     * Запис — умовним UPDATE за «updated», з кількома спробами, якщо хтось устиг між читанням і записом.
     */
    async patch(id, patch, { base = null, addPins = null } = {}) {
      // свіжий стан для 409; запис тим часом видалили — null (404), а не порожній «конфлікт»
      const fresh = async () => { const r = await one(id); return r && { conflict: true, ...r } }
      for (let i = 0; i < 5; i++) {
        const cur = await db.get('SELECT doc, updated FROM places WHERE id = ?', id)
        if (!cur) return null
        if (base != null && Number(cur.updated) !== Number(base)) return fresh()
        const doc = { ...JSON.parse(cur.doc), ...patch }
        if (addPins?.length) {
          const key = (p) => `${p.map}|${p.x}|${p.y}|${p.layout ?? ''}`
          const have = new Set((doc.pins || []).map(key))
          doc.pins = [...(doc.pins || []), ...addPins.filter((p) => !have.has(key(p)))].slice(0, 60)
        }
        const r = await db.run('UPDATE places SET doc = ?, updated = ? WHERE id = ? AND updated = ?', JSON.stringify(doc), Math.max(Date.now(), Number(cur.updated) + 1), id, cur.updated)
        if (r.changes) return one(id)
        if (base != null) return fresh()
      }
      return fresh()
    },
    remove: async (id) => (await db.run('DELETE FROM places WHERE id = ?', id)).changes > 0,
  }
}

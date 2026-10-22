/*
 * Роадмапи — документи (JSON) у тій самій SQLite; їх багато, у кожного свій власник і видимість (реєстр речей,
 * lib/items.mjs). Колись роадмап був один (таблиця docs, id 'roadmap') — він переїжджає сюди з усією історією.
 *
 * Прогрес (статуси етапів, галочки задач, «зібрано») — не в документі, а окремо (lib/roadmap-progress.mjs), права —
 * у стовпці access (lib/roadmap-access.mjs); stages — id етапів документа, щоб списки рахували прогрес, не читаючи документів.
 *
 * Версії: кожне збереження приходить з версією, від якої редагували; якщо хтось устиг зберегти
 * раніше — 409 і свіжий документ, щоб не затерти чужі зміни мовчки. Попередні версії лягають в
 * історію (останні 100), з неї можна відновити. Перший роадмап — початковий вміст з data/roadmap.json.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { byPlural, fail, fill } from './util.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED = path.join(__dirname, '..', '..', 'data', 'roadmap.json')
const LEGACY = 'roadmap'
const KEEP = 100

// ---------- форма документа: беремо лише відомі поля, рядки й списки — з обмеженнями ----------
const str = (v, max = 4000) => String(v ?? '').slice(0, max)
const list = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).map(fn) : [])
const id = (v) => (typeof v === 'string' && /^[\w-]{1,32}$/.test(v) ? v : Math.random().toString(36).slice(2, 10))

const table = (t) =>
  t && typeof t === 'object'
    ? {
        head: list(t.head, 8, (h) => str(h, 80)),
        rows: list(t.rows, 60, (r) => ({ cells: list(r?.cells, 9, (c) => str(c, 300)), ...(r?.sum ? { sum: true } : {}) })),
      }
    : null

export function cleanRoadmap(d) {
  if (!d || typeof d !== 'object') throw fail('порожній документ')
  return {
    title: str(d.title, 120),
    lead: str(d.lead, 600),
    facts: list(d.facts, 12, (f) => str(f, 120)),
    sidebarTitle: str(d.sidebarTitle, 80),
    sidebar: list(d.sidebar, 20, (b) => ({ id: id(b?.id), title: str(b?.title, 120), body: str(b?.body) })),
    note: str(d.note, 2000),
    stages: list(d.stages, 60, (s) => ({
      id: id(s?.id),
      title: str(s?.title, 160),
      badge: str(s?.badge, 60),
      why: str(s?.why),
      table: table(s?.table),
      tasks: list(s?.tasks, 60, (t) => ({ id: id(t?.id), text: str(t?.text, 400) })),
      meta: str(s?.meta),
    })),
    sections: list(d.sections, 30, (s) => ({
      id: id(s?.id),
      title: str(s?.title, 160),
      body: str(s?.body),
      stats: list(s?.stats, 16, (x) => ({ value: str(x?.value, 60), label: str(x?.label, 200) })),
      columns: list(s?.columns, 8, (c) => ({ id: id(c?.id), title: str(c?.title, 160), body: str(c?.body), table: table(c?.table) })),
      sources: str(s?.sources),
      // картки розділу можна відмічати «зібрано» (кожен глядач — у себе)
      ...(s?.collect ? { collect: true } : {}),
    })),
  }
}

/** порожній роадмап з назвою */
export const blankRoadmap = (title) => cleanRoadmap({ title: title || 'Новий роадмап', stages: [], sections: [] })

/** «5 етапів, виконано 3» мовою: t — перекладач (за замовчуванням ключі як є, українською), lang — для форми множини */
export function summaryText(all, done, t = fill, lang = 'uk') {
  if (!all) return t('Без етапів')
  const v = { n: all, done }
  return byPlural(lang, all, [t('{n} етап, виконано {done}', v), t('{n} етапи, виконано {done}', v), t('{n} етапів, виконано {done}', v)])
}

/**
 * короткий опис для списків: етапи й скільки виконано (зберігається українською — мовою людини його робить localSummary).
 * state — запис прогресу ({ s: { id етапу: статус } }); без нього — давні статуси з самого документа (історія версій)
 */
export function roadmapSummary(d, state) {
  const st = d.stages || []
  return summaryText(st.length, st.filter((s) => (state ? state.s?.[s.id] : s.status) === 'done').length)
}

/** id етапів документа (для підрахунку прогресу в списках) */
export const stageIds = (d) => JSON.stringify((d?.stages || []).map((s) => s.id))

/** збережений опис → мовою людини (t, lang — з її запиту); чужий текст лишається як є */
export function localSummary(s, t, lang) {
  if (s === 'Без етапів') return summaryText(0, 0, t, lang)
  const m = /^(\d+) етап\S*, виконано (\d+)$/.exec(String(s))
  return m ? summaryText(Number(m[1]), Number(m[2]), t, lang) : s
}

export async function createRoadmaps(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS roadmaps (id TEXT PRIMARY KEY, doc TEXT NOT NULL, version INTEGER NOT NULL, created BIGINT NOT NULL, updated BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS roadmap_history (
      hid {{SERIAL}}, roadmap_id TEXT NOT NULL, doc TEXT NOT NULL, version INTEGER NOT NULL, updated BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS roadmap_history_by_id ON roadmap_history (roadmap_id, hid);
    CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, doc TEXT NOT NULL, version INTEGER NOT NULL, updated BIGINT NOT NULL);
    CREATE TABLE IF NOT EXISTS doc_history (hid {{SERIAL}}, doc_id TEXT NOT NULL, doc TEXT NOT NULL, version INTEGER NOT NULL, updated BIGINT NOT NULL);
  `)
  // опис версії для списку історії — пишемо разом із версією, щоб список не розбирав сотню документів щоразу
  await db.addColumn('roadmap_history', 'summary', 'TEXT')
  // права роадмапу жили тут (давні; тепер — items.access, див. moveAccess) і id етапів — для списків
  await db.addColumn('roadmaps', 'access', 'TEXT')
  await db.addColumn('roadmaps', 'stages', 'TEXT')
  const one = (id) => db.get('SELECT * FROM roadmaps WHERE id = ?', id)
  const read = async (id) => {
    const r = await one(id)
    return r ? { id: r.id, doc: JSON.parse(r.doc), version: r.version, created: r.created, updated: r.updated } : null
  }
  /**
   * Нова версія, лише якщо версія ще та сама (умова в самому UPDATE): два одночасні збереження від версії N не
   * затирають одне одного — друге отримує конфлікт. expect — версія, від якої правили (null — від поточної).
   */
  const CONFLICT = Symbol('conflict')
  const write = async (id, doc, expect = null) => {
    try {
      await db.tx(async (t) => {
        const cur = await t.get('SELECT * FROM roadmaps WHERE id = ?', id)
        if (!cur || (expect != null && cur.version !== expect)) throw CONFLICT
        const r = await t.run('UPDATE roadmaps SET doc = ?, version = ?, updated = ?, stages = ? WHERE id = ? AND version = ?', JSON.stringify(doc), cur.version + 1, Date.now(), stageIds(doc), id, cur.version)
        if (!r.changes) throw CONFLICT
        let summary = null
        try { summary = roadmapSummary(JSON.parse(cur.doc)) } catch { /* зіпсований документ — опис порахує історія */ }
        await t.run('INSERT INTO roadmap_history (roadmap_id, doc, version, updated, summary) VALUES (?, ?, ?, ?, ?)', id, cur.doc, cur.version, cur.updated, summary)
        await t.run('DELETE FROM roadmap_history WHERE roadmap_id = ? AND hid NOT IN (SELECT hid FROM roadmap_history WHERE roadmap_id = ? ORDER BY hid DESC LIMIT ?)', id, id, KEEP)
      })
    } catch (e) {
      if (e !== CONFLICT) throw e
      const cur = await read(id)
      return cur ? { conflict: true, ...cur } : null
    }
    return read(id)
  }
  return {
    get: read,
    has: async (id) => !!(await one(id)),
    /**
     * Давній єдиний роадмап (docs 'roadmap' з історією) → роадмап id з тими самими версіями; якщо його не було
     * зовсім — початковий вміст з data/roadmap.json. Повертає id, якщо щось перенесли.
     */
    async migrateLegacy(id) {
      if (await one(id)) return null
      const old = await db.get('SELECT * FROM docs WHERE id = ?', LEGACY)
      const now = Date.now()
      await db.tx(async (t) => {
        if (old) {
          await t.run('INSERT INTO roadmaps (id, doc, version, created, updated) VALUES (?, ?, ?, ?, ?)', id, old.doc, old.version, old.updated, old.updated)
          for (const h of await t.all('SELECT * FROM doc_history WHERE doc_id = ? ORDER BY hid', LEGACY))
            await t.run('INSERT INTO roadmap_history (roadmap_id, doc, version, updated) VALUES (?, ?, ?, ?)', id, h.doc, h.version, h.updated)
        } else {
          let raw = { title: 'Роадмап' }
          try { raw = JSON.parse(fs.readFileSync(SEED, 'utf8')) } catch { /* без початкового файлу — порожній роадмап */ }
          await t.run('INSERT INTO roadmaps (id, doc, version, created, updated) VALUES (?, ?, ?, ?, ?)', id, JSON.stringify(cleanRoadmap(raw)), 1, now, now)
        }
      })
      return id
    },
    /** новий роадмап з документа (порожній чи копія) */
    async create(id, doc) {
      const now = Date.now()
      const clean = cleanRoadmap(doc)
      await db.run('INSERT INTO roadmaps (id, doc, version, created, updated, stages) VALUES (?, ?, ?, ?, ?, ?)', id, JSON.stringify(clean), 1, now, now, stageIds(clean))
      return read(id)
    },
    /** зберегти, якщо ніхто не встиг раніше; інакше { conflict, ...свіжий } */
    async put(id, doc, base) {
      const cur = await read(id)
      if (!cur) return null
      if (base !== cur.version) return { conflict: true, ...cur }
      return write(id, cleanRoadmap(doc), base)
    },
    /** збережені права (рядок JSON чи null) — тепер у реєстрі речей (items.access), як у всіх видів */
    access: async (id) => (await db.get("SELECT access FROM items WHERE kind = 'roadmap' AND id = ?", id))?.access ?? null,
    setAccess: (id, a) => db.run("UPDATE items SET access = ? WHERE kind = 'roadmap' AND id = ?", a == null ? null : JSON.stringify(a), id),
    /** давні права роадмапів (стовпець roadmaps.access) → реєстр; раз для кожного, повторно нічого не робить */
    moveAccess: () => db.run("UPDATE items SET access = (SELECT r.access FROM roadmaps r WHERE r.id = items.id) WHERE kind = 'roadmap' AND access IS NULL AND id IN (SELECT id FROM roadmaps WHERE access IS NOT NULL)"),
    /** права (з реєстру) й id етапів кількох роадмапів: Map(id → { access, stages }) — для списків */
    async meta(ids) {
      const out = new Map()
      for (let i = 0; i < ids.length; i += 400) {
        const part = ids.slice(i, i + 400)
        if (!part.length) continue
        for (const r of await db.all(`SELECT r.id, i.access, r.stages FROM roadmaps r LEFT JOIN items i ON i.kind = 'roadmap' AND i.id = r.id WHERE r.id IN (${part.map(() => '?').join(',')})`, ...part)) {
          let stages = []
          try { stages = JSON.parse(r.stages || '[]') } catch { /* порожньо */ }
          out.set(r.id, { access: r.access, stages })
        }
      }
      return out
    },
    /** давні роадмапи без id етапів — дописати (раз) */
    async fillStages() {
      for (const r of await db.all('SELECT id, doc FROM roadmaps WHERE stages IS NULL')) {
        let d = null
        try { d = JSON.parse(r.doc) } catch { /* зіпсований документ */ }
        await db.run('UPDATE roadmaps SET stages = ? WHERE id = ?', stageIds(d), r.id)
      }
    },
    /** сирі документи (міграція прогресу: давні статуси з документів) */
    rawDocs: async () => (await db.all('SELECT id, doc FROM roadmaps')).map((r) => { try { return { id: r.id, doc: JSON.parse(r.doc) } } catch { return { id: r.id, doc: null } } }),
    async remove(id) {
      await db.run('DELETE FROM roadmap_history WHERE roadmap_id = ?', id)
      await db.run('DELETE FROM roadmaps WHERE id = ?', id)
    },
    // документ — лише тим версіям, що записані до стовпця summary
    history: async (id) =>
      (await db.all('SELECT hid, version, updated, summary, CASE WHEN summary IS NULL THEN doc END AS doc FROM roadmap_history WHERE roadmap_id = ? ORDER BY hid DESC', id))
        .map((r) => ({ hid: r.hid, version: r.version, updated: r.updated, summary: r.summary ?? roadmapSummary(JSON.parse(r.doc)) })),
    /** відновлення — теж нова версія, тож його можна скасувати так само */
    async restore(id, hid) {
      if (!Number.isInteger(hid)) return null
      const r = await db.get('SELECT * FROM roadmap_history WHERE hid = ? AND roadmap_id = ?', hid, id)
      return r ? write(id, JSON.parse(r.doc)) : null
    },
  }
}

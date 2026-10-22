/*
 * Невеликі документи без історії версій — білди умінь і позначки на мапі. Власник і видимість — у реєстрі речей
 * (lib/items.mjs); тут лише сам документ, очищений своєю функцією.
 *
 * Білд: назва, код планувальника умінь (той самий, що в адресі /skills?b=…), нотатки, коротко про нього (школи й очки
 * рахує клієнт — дані умінь живуть у браузері) і знімок snap — «вузол: ранг», слоти, спеціалізації й версія даних: код
 * залежить від порядку вузлів у дереві, і після патчу той самий код дав би інший білд, а знімок — ні (lib/skills.unsnap).
 * Позначка: мапа, точка (x, y; для Глибокої пустелі — ще й розкладка тижня), вид, назва, нотатка.
 */
import { fail, newId, plain } from './util.mjs'

const SKILL_ID = /^[\w.-]{1,120}$/
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || 0))
/** знімок білду (див. вище): лише відомі поля, id — як у даних умінь, ранги й рівні — у межах */
function cleanSnap(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const nodes = {}
  for (const [k, r] of Object.entries(v.nodes && typeof v.nodes === 'object' ? v.nodes : {}).slice(0, 300)) if (SKILL_ID.test(k) && Number.isInteger(r) && r > 0 && r <= 50) nodes[k] = r
  const ids = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && SKILL_ID.test(x) && nodes[x]))].slice(0, 3) : [])
  const names = {}
  for (const k of Object.keys(nodes)) if (typeof v.names?.[k] === 'string') names[k] = plain(v.names[k], 80)
  return {
    nodes,
    eq: { a: ids(v.eq?.a), t: ids(v.eq?.t) },
    spec: {
      lv: Array.from({ length: 5 }, (_, i) => int(v.spec?.lv?.[i], 0, 100)),
      got: Array.from({ length: 5 }, (_, i) => (Array.isArray(v.spec?.got?.[i]) ? [...new Set(v.spec.got[i].filter((x) => Number.isInteger(x) && x >= 0 && x < 64))].sort((a, b) => a - b) : [])),
    },
    ver: plain(v.ver, 40),
    at: plain(v.at, 40),
    pts: int(v.pts, 0, 100000),
    names,
  }
}

export function cleanBuild(d) {
  if (!d || typeof d !== 'object') throw fail('порожній білд')
  const name = plain(d.name, 80)
  if (!name) throw fail('потрібна назва білду')
  const code = String(d.code ?? '').trim()
  if (!/^[\w.~+-]{0,400}$/.test(code)) throw fail('хибний код білду')
  if (!code) throw fail('білд порожній — візьми хоч один вузол чи рівень спеціалізації')
  const snap = cleanSnap(d.snap)
  return { name, code, notes: plain(d.notes, 4000, true), about: plain(d.about, 160), ...(snap ? { snap } : {}) }
}

/**
 * Розрахунок калькулятора: назва, цілі (той самий код, що в адресі /calculator?t=…), вибрані рецепти (предмет → рецепт),
 * нотатки й коротко про нього (підсумок рахує клієнт).
 */
export function cleanCalc(d) {
  if (!d || typeof d !== 'object') throw fail('порожній розрахунок')
  const name = plain(d.name, 80)
  if (!name) throw fail('потрібна назва розрахунку')
  const code = String(d.code ?? '').trim()
  if (!/^[\w.~%|!*'()+-]{0,4000}$/.test(code)) throw fail('хибний код розрахунку')
  if (!code) throw fail('розрахунок порожній — додай хоч одну ціль')
  const picks = {}
  if (d.picks && typeof d.picks === 'object' && !Array.isArray(d.picks)) {
    for (const [k, v] of Object.entries(d.picks).slice(0, 300)) if (typeof v === 'string' && k.length <= 160 && v.length <= 160) picks[k] = v
  }
  // указ, з яким рахували (лише ті, що міняють числа): у кого інший указ тижня — побачить ті самі числа; давні
  // розрахунки без поля рахуються з поточним
  const decree = 'decree' in d ? (d.decree === 'production' || d.decree === 'refining' ? d.decree : null) : undefined
  return { name, code, picks, dd: !!d.dd, notes: plain(d.notes, 4000, true), about: plain(d.about, 160), ...(decree !== undefined ? { decree } : {}) }
}

export const MARKER_KINDS = ['base', 'outpost', 'resource', 'danger', 'meet', 'note']
/** maps — дані мапи (cleanPoint: точка в межах мапи, розкладка лише відома й лише там, де вони є) чи просто Set мап */
export function cleanMarker(d, maps) {
  if (!d || typeof d !== 'object') throw fail('порожня позначка')
  const title = plain(d.title, 80)
  if (!title) throw fail('потрібна назва позначки')
  let point
  if (typeof maps?.cleanPoint === 'function') point = maps.cleanPoint(d)
  else {
    if (!maps.has(d.map)) throw fail('невідома мапа')
    if (!Number.isFinite(+d.x) || !Number.isFinite(+d.y)) throw fail('хибна точка')
    point = { map: d.map, x: Math.round(+d.x), y: Math.round(+d.y), ...(Number.isInteger(d.layout) ? { layout: d.layout } : {}) }
  }
  return { ...point, kind: MARKER_KINDS.includes(d.kind) ? d.kind : 'note', title, note: plain(d.note, 1000, true) }
}

/** сховище: таблиця (id, doc, created, updated) */
export async function createDocs(db, table, prefix) {
  await db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, doc TEXT NOT NULL, created BIGINT NOT NULL, updated BIGINT NOT NULL)`)
  const row = (r) => (r ? { id: r.id, ...JSON.parse(r.doc), created: r.created, updated: r.updated } : null)
  const get = async (id) => row(await db.get(`SELECT * FROM ${table} WHERE id = ?`, String(id)))
  return {
    get,
    /** кілька за id — у тому самому порядку (шматками: тисячі параметрів в одному IN база не любить) */
    async many(ids) {
      const m = new Map()
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500).map(String)
        for (const r of await db.all(`SELECT * FROM ${table} WHERE id IN (${part.map(() => '?').join(',')})`, ...part)) m.set(r.id, row(r))
      }
      return ids.map((id) => m.get(String(id))).filter(Boolean)
    },
    async create(doc) {
      const id = newId(prefix)
      const now = Date.now()
      await db.run(`INSERT INTO ${table} (id, doc, created, updated) VALUES (?, ?, ?, ?)`, id, JSON.stringify(doc), now, now)
      return get(id)
    },
    /**
     * Зберегти. base — «updated» версії, від якої правили: якщо запис тим часом змінили, нічого не пишемо й
     * повертаємо { conflict, ...поточний } (умова — в самому UPDATE, тож і одночасні збереження не затирають одне одного).
     */
    async put(id, doc, base = null) {
      const now = Date.now()
      const r = base == null
        ? await db.run(`UPDATE ${table} SET doc = ?, updated = ? WHERE id = ?`, JSON.stringify(doc), now, String(id))
        : await db.run(`UPDATE ${table} SET doc = ?, updated = ? WHERE id = ? AND updated = ?`, JSON.stringify(doc), Math.max(now, Number(base) + 1), String(id), Number(base))
      if (r.changes) return get(id)
      const cur = await get(id)
      return cur && base != null ? { conflict: true, ...cur } : null
    },
    remove: async (id) => (await db.run(`DELETE FROM ${table} WHERE id = ?`, String(id))).changes > 0,
  }
}

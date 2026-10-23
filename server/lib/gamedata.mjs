/*
 * Дані гри в базі: предмети, пристрої, рецепти, будівельні модулі (довідник і калькулятор) і вміння (планувальник).
 * Звідки беруться: файли гри — реєстр джерел (server/lib/gamedata) застосовує пакет видобувача сюди (upsert). Панель
 * керування редагує будь-який рядок; змінений вручну стає «закріпленим» (locked) — застосування його не чіпає.
 * «Прихований» (hidden) рядок сайт не показує; невипущене в грі (unreleased) — теж, доки адмін не відкриє (revealed).
 *
 * Тексти мовами гри (назва, опис) — game_texts (kind, id, lang): з файлів гри (14 мов), ручні правки — закріплені.
 * Сайт отримує довідник однією мовою: name — англійська, loc — назва вибраною мовою (null, якщо перекладу нема).
 *
 * Запис (upsert) не затирає відоме порожнім (KEEP). Чого в повних даних уже нема — не видаляємо, а позначаємо gone (час):
 * сайт його не показує, панель — бачить; повернеться в грі — позначка знімається.
 */
import { DEFAULT_PRIMARY, groupOf } from './gamedata/sections.mjs'

/** мови гри (і сайту): код, назва своєю мовою; gt — як їх зве gaming.tools, ql — questlog (null — немає) */
export const LANGS = [
  { code: 'uk', name: 'Українська', gt: 'uk', ql: null },
  { code: 'en', name: 'English', gt: 'en', ql: 'en' },
  { code: 'de', name: 'Deutsch', gt: 'de', ql: 'de' },
  { code: 'fr', name: 'Français', gt: 'fr', ql: 'fr' },
  { code: 'es', name: 'Español', gt: 'es', ql: 'es' },
  { code: 'it', name: 'Italiano', gt: 'it', ql: null },
  { code: 'pl', name: 'Polski', gt: 'pl', ql: null },
  { code: 'pt-BR', name: 'Português (Brasil)', gt: 'pt-br', ql: 'pt' },
  { code: 'ru', name: 'Русский', gt: 'ru', ql: null },
  { code: 'tr', name: 'Türkçe', gt: 'tr', ql: null },
  { code: 'ja', name: '日本語', gt: 'ja', ql: 'ja' },
  { code: 'ko', name: '한국어', gt: 'ko', ql: 'ko' },
  { code: 'zh-Hans', name: '简体中文', gt: 'zh-hans', ql: 'zh' },
  { code: 'zh-Hant', name: '繁體中文', gt: 'zh-hant', ql: null },
]
export const LANG_CODES = LANGS.map((l) => l.code)
export const DEFAULT_LANG = 'uk'
export const langOf = (v) => (LANG_CODES.includes(v) ? v : LANG_CODES.find((c) => c.toLowerCase() === String(v || '').toLowerCase()) || null)

/** таблиці: стовпці, як їх зберігаємо (json — масив/об'єкт текстом) */
/** види перекладів без власної таблиці: назви типів міток мапи, категорій легенди й місць (мапа з файлів гри) */
const TEXT_ONLY = new Set(['markerType', 'place', 'legend'])

export const GAME = {
  item: {
    table: 'game_items', key: 'id',
    cols: { id: 'text', name: 'text', icon: 'text', grade: 'int', cat: 'text', sub: 'text', kind: 'text', rarity: 'text', stack: 'num', volume: 'num', description: 'text' },
  },
  placeable: {
    table: 'game_placeables', key: 'id',
    cols: { id: 'text', name: 'text', icon: 'text', grade: 'int', cat: 'text', sub: 'text', power: 'num', water: 'num', water_rate: 'num', description: 'text' },
  },
  recipe: {
    table: 'game_recipes', key: 'id',
    cols: { id: 'text', name: 'text', time: 'num', water: 'num', stations: 'json', inputs: 'json', outputs: 'json' },
  },
  buildable: {
    table: 'game_buildables', key: 'key',
    cols: { key: 'text', set_id: 'text', grp: 'text', id: 'text', name: 'text', health: 'num', img: 'text', cost: 'json' },
  },
  skill: {
    table: 'game_skills', key: 'id',
    cols: { id: 'text', name: 'text', icon: 'text', school: 'text', kind: 'text', description: 'text', x: 'int', y: 'int', max: 'int', levels: 'json', req_and: 'json', req_or: 'json' },
  },
}
/** розділ даних гри (server/lib/gamedata) → вид у GAME */
export const SECTION_KIND = { items: 'item', placeables: 'placeable', recipes: 'recipe', buildables: 'buildable' }
const SQL_TYPE = { text: 'TEXT', int: 'INTEGER', num: 'DOUBLE PRECISION', json: "TEXT NOT NULL DEFAULT '[]'" }
/**
 * Що збір не затирає порожнім (null, «[]»): ці поля приходять з окремих запитів (вікі, деталі пристроїв і рецептів),
 * і збій одного з них не має стирати відоме з минулого разу
 */
const KEEP = {
  item: ['icon', 'kind', 'rarity', 'stack', 'volume', 'description'],
  placeable: ['icon', 'power', 'water', 'water_rate', 'description'],
  recipe: ['time', 'water', 'stations'],
  buildable: ['health', 'img'],
  // опису частини атрибутів у серверних файлах гри нема — лишається відомий (questlog)
  skill: ['icon', 'description'],
}
/** повний збір дав менше половини того, що є, — схоже на збій джерела, а не на патч: прибраним нічого не позначаємо */
const SWEEP_MIN = 0.5
/** «… Mk5» — номер моделі: з кількох перекладів однієї назви беремо той, де цей номер є */
const MK = /\bMk\s?(\d+)\b/i

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const json = (v) => JSON.stringify(v ?? [])
const parse = (v, d = []) => { try { return v ? JSON.parse(v) : d } catch { return d } }

/** рядок довідника з catalog.json (чи з пакета файлів гри — та сама форма) → рядок таблиці */
export const FROM = {
  item: (i) => ({ id: i.id, name: i.name, icon: i.icon, grade: i.grade ?? 0, cat: i.cat ?? '', sub: i.sub ?? null, kind: i.kind ?? null, rarity: i.rarity ?? null, stack: num(i.stack), volume: num(i.volume), description: i.description ?? '' }),
  placeable: (p) => ({ id: p.id, name: p.name, icon: p.icon, grade: p.grade ?? 0, cat: p.cat ?? '', sub: p.sub ?? null, power: num(p.power), water: num(p.water), water_rate: num(p.waterRate), description: p.description ?? '' }),
  recipe: (r) => ({ id: r.id, name: r.name, time: num(r.time), water: num(r.water), stations: r.at ?? [], inputs: r.in ?? [], outputs: r.out ?? [] }),
  // модуль — під своїм id гри (рядок таблиці гри; унікальний між наборами)
  buildable: (b) => ({ key: b.id, set_id: b.set, grp: b.group, id: b.id, name: b.name ?? null, health: num(b.health), img: b.img ?? null, cost: b.cost ?? [] }),
  skill: (s) => ({ id: s.id, name: s.name, icon: s.icon, school: s.school, kind: s.kind, description: s.desc ?? '', x: s.x ?? 0, y: s.y ?? 0, max: s.max ?? 1, levels: s.levels ?? [], req_and: s.and ?? [], req_or: s.or ?? [] }),
}

export async function createGameData(db, { dataDir, log = console } = {}) {
  for (const [kind, g] of Object.entries(GAME)) {
    const cols = Object.entries(g.cols).map(([c, t]) => `${c} ${c === g.key ? 'TEXT PRIMARY KEY' : SQL_TYPE[t]}`)
    await db.exec(`CREATE TABLE IF NOT EXISTS ${g.table} (${cols.join(', ')}, hidden INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, updated BIGINT NOT NULL)`)
    // коли рядок зник з повного збору (прибрали з гри); null — є
    await db.addColumn(g.table, 'gone', 'BIGINT')
    // з файлів гри: невипущене в грі — у таблиці, але сайт не показує, доки адмін не відкриє (revealed)
    await db.addColumn(g.table, 'unreleased', 'INTEGER NOT NULL DEFAULT 0')
    await db.addColumn(g.table, 'revealed', 'INTEGER NOT NULL DEFAULT 0')
    void kind
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS game_texts (
      kind TEXT NOT NULL, id TEXT NOT NULL, lang TEXT NOT NULL, name TEXT, description TEXT, source TEXT NOT NULL DEFAULT '',
      locked INTEGER NOT NULL DEFAULT 0, updated BIGINT NOT NULL, PRIMARY KEY (kind, id, lang)
    );
    CREATE INDEX IF NOT EXISTS game_texts_by_lang ON game_texts (lang, kind);
  `)

  const cache = new Map() // `${що}:${мова}` → готова відповідь сайту
  const invalidate = () => cache.clear()

  /**
   * Зберегти рядки (збір чи імпорт): закріплені вручну не чіпаємо; порожнє в полях KEEP не затирає відоме (крім force).
   * sweep — це повний список з джерела: чого в ньому нема (і не закріплене) — позначити gone. Повертає, скільки записано
   */
  async function upsert(kind, rows, { force = false, sweep = false } = {}) {
    const g = GAME[kind]
    const cols = Object.keys(g.cols)
    const now = Date.now()
    const keep = force ? [] : KEEP[kind] ?? []
    const set = cols.filter((c) => c !== g.key).map((c) => {
      if (!keep.includes(c)) return `${c} = excluded.${c}`
      return g.cols[c] === 'json' ? `${c} = CASE WHEN excluded.${c} = '[]' THEN ${g.table}.${c} ELSE excluded.${c} END` : `${c} = COALESCE(excluded.${c}, ${g.table}.${c})`
    }).join(', ')
    const sql = `INSERT INTO ${g.table} (${cols.join(', ')}, updated) VALUES (${cols.map(() => '?').join(', ')}, ?)
      ON CONFLICT (${g.key}) DO UPDATE SET ${set}, updated = excluded.updated, gone = NULL${force ? '' : ` WHERE ${g.table}.locked = 0`}`
    let n = 0
    await db.tx(async (t) => {
      for (const r of rows) {
        const vals = cols.map((c) => (g.cols[c] === 'json' ? json(r[c]) : r[c] ?? null))
        n += (await t.run(sql, ...vals, now)).changes
      }
      if (!sweep) return
      // що є зараз (не прибране) — для запобіжника: повний збір не може раптом стати вдвічі меншим
      const have = Number((await t.get(`SELECT COUNT(*) AS n FROM ${g.table} WHERE gone IS NULL`)).n)
      if (rows.length < have * SWEEP_MIN) { log.warn?.(`[game] ${kind}: у зборі ${rows.length} з ${have} — прибраним нічого не позначаю`); return }
      // рядки цього збору щойно отримали updated = now; старіші й не закріплені — у зборі їх уже нема
      await t.run(`UPDATE ${g.table} SET gone = ? WHERE gone IS NULL AND locked = 0 AND updated < ?`, now, now)
    })
    invalidate()
    return n
  }

  /** тексти мовою: [{kind, id, name?, description?}] — порожнє поле не затирає наявне; закріплені вручну не чіпаємо.
   * Види — таблиці даних гри й лише текстові (назви типів міток мапи й місць — lib/gamemap.mjs) */
  async function putTexts(lang, rows, source) {
    const now = Date.now()
    let n = 0
    await db.tx(async (t) => {
      for (const r of rows) {
        if (!r?.id || !(GAME[r.kind] || TEXT_ONLY.has(r.kind))) continue
        const name = r.name ? String(r.name).slice(0, 300) : null
        const desc = r.description ? String(r.description).slice(0, 4000) : null
        if (!name && !desc) continue
        n += (await t.run(
          `INSERT INTO game_texts (kind, id, lang, name, description, source, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (kind, id, lang) DO UPDATE SET name = COALESCE(excluded.name, game_texts.name),
             description = COALESCE(excluded.description, game_texts.description), source = excluded.source, updated = excluded.updated
           WHERE game_texts.locked = 0 AND (game_texts.source <> 'game' OR excluded.source = 'game')`,
          r.kind, r.id, lang, name, desc, source, now,
        )).changes
      }
    })
    invalidate()
    return n
  }

  /** позначити випущене й невипущене (дані файлів гри) — пакетами, щоб не впертись у ліміт параметрів запиту */
  async function markReleased(kind, { released = [], unreleased = [] }) {
    const g = GAME[kind]
    for (const [ids, v] of [[released, 0], [unreleased, 1]]) {
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500)
        await db.run(`UPDATE ${g.table} SET unreleased = ? WHERE ${g.key} IN (${part.map(() => '?').join(', ')})`, v, ...part)
      }
    }
    invalidate()
  }

  const count = async (kind) => Number((await db.get(`SELECT COUNT(*) AS n FROM ${GAME[kind].table}`)).n)

  /** набір довідника у формі каталогу сайту — у таблиці (c.complete — повний: чого в ньому нема, позначаємо gone) */
  async function importCatalog(c) {
    const sweep = !!c.complete
    await upsert('item', c.items.map(FROM.item), { sweep })
    await upsert('placeable', c.placeables.map(FROM.placeable), { sweep })
    await upsert('recipe', c.recipes.map(FROM.recipe), { sweep })
    await setMeta('catalogSynced', c.syncedAt || new Date().toISOString())
  }
  async function importSkills(s) {
    await upsert('skill', s.skills.map(FROM.skill), { sweep: !!s.complete })
    await setMeta('skillsSynced', s.syncedAt || new Date().toISOString())
  }
  const setMeta = (k, v) => db.run('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', 'game:' + k, String(v))
  const getMeta = async (k) => (await db.get('SELECT v FROM meta WHERE k = ?', 'game:' + k))?.v ?? null
  /**
   * основне джерело розділу даних гри (server/lib/gamedata), вибране адміном: для розділу з групи (довідник, мапа) — групи;
   * null — не вибрано (тоді — перше за пріоритетом: файли гри). Давнє «community» (збір сторонніх сайтів) — вже нема
   */
  const getPrimary = async (section) => {
    const g = groupOf(section)
    const v = await getMeta('primary:' + (g ?? section))
    return v && v !== 'community' ? v : DEFAULT_PRIMARY[g] ?? null
  }
  const setPrimary = (target, driver) => setMeta('primary:' + target, driver ?? '')

  /** назви записів одного виду мовою: Map id → назва (лише ті, що перекладено) */
  async function names(lang, kind, ids) {
    if (!ids.length) return new Map()
    const rows = await db.all(`SELECT id, name FROM game_texts WHERE lang = ? AND kind = ? AND id IN (${ids.map(() => '?').join(', ')})`, lang, kind, ...ids)
    return new Map(rows.filter((r) => r.name).map((r) => [r.id, r.name]))
  }

  /** тексти мовою: Map `${kind}:${id}` → {name, description} */
  async function texts(lang, kinds) {
    const rows = await db.all(`SELECT kind, id, name, description FROM game_texts WHERE lang = ? AND kind IN (${kinds.map(() => '?').join(', ')})`, lang, ...kinds)
    return new Map(rows.map((r) => [`${r.kind}:${r.id}`, r]))
  }

  /** довідник для сайту однією мовою (форма — як була в catalog.json; loc — назва мовою або null) */
  async function catalog(lang = DEFAULT_LANG) {
    const key = 'catalog:' + lang
    if (cache.has(key)) return cache.get(key)
    if (!(await count('item'))) return null
    const tx = lang === 'en' ? new Map() : await texts(lang, ['item', 'placeable', 'recipe', 'buildable'])
    const loc = (kind, id) => tx.get(`${kind}:${id}`)?.name || null
    const items = (await db.all('SELECT * FROM game_items WHERE hidden = 0 AND gone IS NULL AND (unreleased = 0 OR revealed = 1) ORDER BY id')).map((i) => ({
      id: i.id, name: i.name, loc: loc('item', i.id), icon: i.icon, grade: i.grade ?? 0, cat: i.cat, sub: i.sub, kind: i.kind, rarity: i.rarity, stack: i.stack, volume: i.volume,
    }))
    const placeables = (await db.all('SELECT * FROM game_placeables WHERE hidden = 0 AND gone IS NULL AND (unreleased = 0 OR revealed = 1) ORDER BY id')).map((p) => ({
      id: p.id, name: p.name, loc: loc('placeable', p.id), icon: p.icon, grade: p.grade ?? 0, cat: p.cat, sub: p.sub, power: p.power, water: p.water, waterRate: p.water_rate,
    }))
    if (lang !== 'en') { sameName(items); sameName(placeables) }
    // рецепт без власного перекладу, названий як його предмет, — назвою предмета
    const itemById = new Map(items.map((i) => [i.id, i]))
    const placeIds = new Set(placeables.map((p) => p.id))
    const recipes = (await db.all('SELECT * FROM game_recipes WHERE hidden = 0 AND gone IS NULL AND (unreleased = 0 OR revealed = 1) ORDER BY id'))
      .map((r) => {
        const out = parse(r.outputs)
        const it = out.length ? itemById.get(out[0][0]) : null
        return { id: r.id, name: r.name, loc: loc('recipe', r.id) || (it && it.name === r.name ? it.loc : null), time: r.time, water: r.water, at: parse(r.stations), in: parse(r.inputs), out }
      })
      // рецепт того, чого в довіднику нема (вимкнене в грі: старі деталі танка, давній кінджал), — теж мертвий: на
      // сайті він показував би сирі id замість назв
      .filter((r) => r.out.length && r.out.every(([id]) => itemById.has(id) || placeIds.has(id)))
    const buildables = (await db.all('SELECT * FROM game_buildables WHERE hidden = 0 AND gone IS NULL AND (unreleased = 0 OR revealed = 1) ORDER BY set_id, grp, id')).map((b) => ({
      set: b.set_id, group: b.grp, id: b.id, name: b.name, loc: loc('buildable', b.key), health: b.health, img: b.img, cost: parse(b.cost),
    }))
    const out = { syncedAt: (await getMeta('catalogSynced')) || new Date(0).toISOString(), lang, items, placeables, recipes, buildables }
    out.etag = `"c${lang}-${hash(JSON.stringify(out))}"`
    cache.set(key, out)
    return out
  }

  /** уміння для планувальника однією мовою (форма — як була в skills.json; locName/locDesc — мовою) */
  async function skills(lang = DEFAULT_LANG) {
    const key = 'skills:' + lang
    if (cache.has(key)) return cache.get(key)
    if (!(await count('skill'))) return null
    const tx = lang === 'en' ? new Map() : await texts(lang, ['skill'])
    const list = (await db.all('SELECT * FROM game_skills WHERE hidden = 0 AND gone IS NULL AND (unreleased = 0 OR revealed = 1) ORDER BY id')).map((s) => ({
      id: s.id, name: s.name, locName: tx.get('skill:' + s.id)?.name || null, locDesc: tx.get('skill:' + s.id)?.description || null,
      icon: s.icon, school: s.school, kind: s.kind, desc: s.description, x: s.x, y: s.y, max: s.max,
      levels: parse(s.levels), and: parse(s.req_and), or: parse(s.req_or),
    }))
    // дерево — з файлів гри; значення рангів і спеціалізації сторінка бере з dune.gaming.tools (виняток, у браузері)
    const out = { syncedAt: (await getMeta('skillsSynced')) || new Date(0).toISOString(), lang, sources: ['game', 'dune.gaming.tools'], skills: list }
    out.etag = `"s${lang}-${hash(JSON.stringify(out))}"`
    cache.set(key, out)
    return out
  }

  /** опис предмета / пристрою мовою (якщо є) */
  async function description(kind, id, lang) {
    const t = await db.get('SELECT description FROM game_texts WHERE kind = ? AND id = ? AND lang = ?', kind, id, lang)
    if (t?.description) return t.description
    const g = GAME[kind]
    if (lang === 'en' && g?.cols.description) return (await db.get(`SELECT description FROM ${g.table} WHERE ${g.key} = ?`, id))?.description || null
    return null
  }

  /** скільки перекладено кожною мовою — для панелі керування */
  async function coverage() {
    const rows = await db.all('SELECT lang, kind, COUNT(*) AS n FROM game_texts GROUP BY lang, kind')
    const totals = {}
    for (const k of Object.keys(GAME)) totals[k] = await count(k)
    return { totals, rows }
  }

  return { upsert, putTexts, importCatalog, importSkills, catalog, skills, description, names, coverage, count, invalidate, getMeta, setMeta, getPrimary, setPrimary, markReleased }
}

/**
 * Запасна назва мовою: у грі є записи з тією самою англійською назвою, що й перекладений (схема «Hajra Literjon Mk6» —
 * як сам літреджон, варіант прикраси — як прикраса), а переклад у джерелі лише в одного з них. Таким даємо його
 * переклад; кілька різних — той, де є номер моделі з назви. За іконкою не зіставляємо: у сотень записів вона спільна
 * («загорнутий пакунок» у прикрас), і назви виходили б чужі.
 */
export function sameName(rows) {
  const by = new Map()
  for (const r of rows) {
    if (!r.loc) continue
    const k = r.name.trim().toLowerCase()
    if (!by.has(k)) by.set(k, [])
    if (!by.get(k).includes(r.loc)) by.get(k).push(r.loc)
  }
  for (const r of rows) {
    if (r.loc) continue
    const list = by.get(r.name.trim().toLowerCase())
    if (!list) continue
    const mk = MK.exec(r.name)?.[1]
    r.loc = (mk && list.find((x) => x.includes(mk))) || list[0]
  }
  return rows
}

/** короткий незалежний від криптографії відбиток рядка (FNV-1a) — для ETag */
export function hash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

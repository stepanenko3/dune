/*
 * Бази — документи (JSON моделі: ділянки, деталі гри чи давні приміщення з плитками, пристрої, рівні, тексти) у базі
 * сайту (Postgres чи запасна SQLite), як і роадмап. Кожне збереження приходить з версією, від якої редагували; хтось
 * устиг раніше — конфлікт і свіжий документ, щоб не затерти чужі зміни мовчки. Попередні версії лягають в історію (з
 * приміткою й автором) і проріджуються: свіжі — усі, давніші — по одній на день, ще давніші — на тиждень
 * (thinHistory); з неї можна відновити. Видалена база не зникає — її можна повернути.
 * Для списку — короткий підсумок (summary) окремим стовпцем: список не розбирає повних документів. Правки
 * калькулятора бази (calc) — спільні для всіх, хто її бачить, окремо від версій.
 * Порожня таблиця — бази з data/bases/*.json (вивантажені з коду: npm run bases:export).
 * Базу можна вивантажити у файл (exportBase) і завантажити назад (validateBase — перевірка з помилками людською мовою
 * й місцем у документі; нею ж користується панель керування).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { fail, fill, slugify } from './util.mjs'

// рушій сайту (ті самі файли, що в браузері): перевірка імпорту знає, які деталі бувають, і ставить камери 3D
const engine = createRequire(import.meta.url)
const PIECES = engine('../../src/engine/pieces.js')
const BASEDATA = engine('../../src/engine/hydrate.js')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED_DIR = path.join(__dirname, '..', '..', 'data', 'bases')
/** історія: RECENT найновіших — усі; давніші — по одній на день за DAILY днів, ще давніші — по одній на тиждень; разом
 *  не більше CAP (повний документ головної бази — сотні КБ, 200 повних копій — десятки МБ) */
const RECENT = 20, DAILY = 30, CAP = 80
/** порядок наявних баз у списку */
const SEED_ORDER = ['main', 'dd']

// ---------- очищення документа ----------
// Документ великий і різноманітний, тож чистимо його цілком, а не поле за полем: ключі — лише слова,
// числа — скінченні, рядки — без розмітки, крім кількох безпечних тегів (тексти бази показуються як HTML:
// факти, підписи рівнів, поради), «службові» поля (id, kind, group…) — лише слова й дефіси (вони йдуть у
// класи й атрибути плану)
const ALLOWED_TAGS = /^(b|strong|em|i|span|br)$/i
const TOKEN_KEYS = new Set(['id', 'kind', 'group', 'roof', 'type', 'store', 'key', 'recipe', 'inside', 'k', 'base', 'frame', 'shape'])
const LIMITS = { depth: 14, array: 80000, string: 6000, rooms: 600, tiles: 80000, pieces: 80000, items: 8000, bytes: 8 * 1024 * 1024 }

function cleanText(s) {
  return String(s)
    .slice(0, LIMITS.string)
    .replace(/<\/?([a-z][\w-]*)\b[^>]*>/gi, (m, tag) => (ALLOWED_TAGS.test(tag) ? (m.startsWith('</') ? `</${tag.toLowerCase()}>` : `<${tag.toLowerCase()}>`) : ''))
    .replace(/<(?!\/?(b|strong|em|i|span|br)>)/gi, '&lt;')
}
const token = (s) => String(s).replace(/[^\w-]/g, '-').slice(0, 48) || 'x'

function clean(v, key, depth) {
  if (depth > LIMITS.depth) return undefined
  if (v === null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? Math.max(-1e6, Math.min(1e6, v)) : undefined
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return TOKEN_KEYS.has(key) ? token(v) : cleanText(v)
  if (Array.isArray(v)) return v.slice(0, LIMITS.array).map((x) => clean(x, key, depth + 1)).filter((x) => x !== undefined)
  if (typeof v === 'object') {
    const o = {}
    for (const [k, x] of Object.entries(v)) {
      if (!/^[\w-]{1,48}$/.test(k)) continue
      const c = clean(x, k, depth + 1)
      if (c !== undefined) o[k] = c
    }
    return o
  }
  return undefined
}

/** t — перекладач мовою людини: з ним назви за замовчуванням («База», «Приміщення») будуть її мовою */
export function cleanBase(doc, t = fill) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw fail('порожня база')
  if (JSON.stringify(doc).length > LIMITS.bytes) throw fail('база завелика')
  const d = clean(doc, '', 0)
  if (d.format === 2) return cleanPieces(d, t)
  if (!Array.isArray(d.rooms)) throw fail('у базі немає приміщень')
  if (!Array.isArray(d.claims)) d.claims = []
  if (!Array.isArray(d.levels) || !d.levels.length) throw fail('у базі немає рівнів')
  if (!d.heights || typeof d.heights !== 'object') throw fail('у базі немає висот')
  if (!d.ui || typeof d.ui !== 'object') d.ui = {}
  d.ui.name = String(d.ui.name || t('База')).replace(/<[^>]*>/g, '').slice(0, 120) || t('База')
  if (d.rooms.length > LIMITS.rooms) throw fail('забагато приміщень')
  let tiles = 0, items = (d.roofItems || []).length
  const ids = new Set()
  for (const r of d.rooms) {
    if (!r || typeof r !== 'object') throw fail('зіпсоване приміщення')
    if (!r.id || ids.has(r.id)) r.id = 'r' + Math.random().toString(36).slice(2, 9)
    ids.add(r.id)
    if (!Array.isArray(r.tiles)) r.tiles = []
    r.tiles = r.tiles.filter((t) => t && (t.k === 's' || t.k === 't') && Array.isArray(t.p) && t.p.length >= 3 && t.p.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)))
    tiles += r.tiles.length
    if (!Number.isFinite(r.z0)) r.z0 = 0
    if (!Number.isFinite(r.h)) r.h = 0
    if (typeof r.name !== 'string') r.name = t('Приміщення')
    items += (r.items || []).length
  }
  if (tiles > LIMITS.tiles) throw fail('забагато плиток')
  if (items > LIMITS.items) throw fail('забагато пристроїв')
  return d
}

/**
 * база з деталей гри (format 2): pieces — { id, shape, x, y, z, rot }, items — станції, zones — приміщення (плитки);
 * рівні й підписи будівельник рахує сам
 */
function cleanPieces(d, t) {
  if (!Array.isArray(d.pieces)) throw fail('у базі немає деталей')
  if (d.pieces.length > LIMITS.pieces) throw fail('забагато деталей')
  const ids = new Set()
  d.pieces = d.pieces.filter((p) => p && typeof p === 'object' && typeof p.shape === 'string' && ['x', 'y', 'z', 'rot'].every((k) => Number.isFinite(p[k])))
  for (const p of d.pieces) {
    if (!p.id || ids.has(p.id)) p.id = 'p' + Math.random().toString(36).slice(2, 9)
    ids.add(p.id)
  }
  if (!Array.isArray(d.items)) d.items = []
  if (d.items.length > LIMITS.items) throw fail('забагато пристроїв')
  d.items = d.items.filter((it) => it && typeof it === 'object' && it.c && Number.isFinite(it.c.x) && Number.isFinite(it.c.y))
  if (!Array.isArray(d.zones)) d.zones = []
  d.zones = d.zones.filter((z) => z && typeof z === 'object' && typeof z.name === 'string' && Array.isArray(z.tiles))
  if (!Array.isArray(d.claims)) d.claims = []
  if (!Array.isArray(d.levels)) d.levels = []
  if (!d.heights || typeof d.heights !== 'object') d.heights = {}
  if (!d.ui || typeof d.ui !== 'object') d.ui = {}
  d.ui.name = String(d.ui.name || t('База')).replace(/<[^>]*>/g, '').slice(0, 120) || t('База')
  delete d.rooms
  delete d.roofItems
  return d
}

/** коротко для списку: назва, опис, факти, скільки приміщень, плиток і пристроїв */
export function summary(doc, t = fill) {
  const ui = doc.ui || {}
  let tiles = 0, items = (doc.roofItems || []).length
  for (const r of doc.rooms || []) { tiles += (r.tiles || []).length; items += (r.items || []).length }
  // база з деталей: «плитки» — плити (фундаменти, перекриття), приміщення — названі зони
  if (doc.format === 2) {
    tiles = (doc.pieces || []).filter((p) => PIECES.SHAPES[p.shape]?.family === 'slab').length
    items = (doc.items || []).length
  }
  const rooms = doc.format === 2 ? (doc.zones || []).length : (doc.rooms || []).length
  return { name: ui.name || t('База'), lead: ui.lead || '', facts: Array.isArray(ui.facts) ? ui.facts.slice(0, 8) : [], rooms, tiles, items, claims: (doc.claims || []).length }
}

/**
 * Примітка до версії мовою людини. Службові примітки (початкова, копія, відновлення) зберігаються українською —
 * тут їх перекладають; те, що написала людина, лишається як є.
 */
export function noteText(note, t = fill) {
  if (note === 'Початкова версія' || note === 'Перенесено з коду') return t('Початкова версія')
  if (note === 'Копія з бібліотеки') return t('Копія з бібліотеки')
  if (note === 'Копія чернетки') return t('Копія чернетки')
  if (note === 'Змінено в панелі керування') return t('Змінено в панелі керування')
  if (note === 'Імпортовано з файлу') return t('Імпортовано з файлу')
  if (note === 'Нова база') return t('Нова база')
  if (note === 'Згенеровано генератором баз') return t('Згенеровано генератором баз')
  const s = String(note)
  const imp = /^Імпортовано з файлу: (.+)$/.exec(s)
  if (imp) return t('Імпортовано з файлу: {from}', { from: imp[1] })
  const cp = /^Копія бази «(.*)»$/.exec(s)
  if (cp) return t('Копія бази «{name}»', { name: cp[1] })
  const cv = /^Перетворено в деталі гри\. ([\s\S]*)$/.exec(s)
  if (cv) return t('Перетворено в деталі гри. {notes}', { notes: cv[1] })
  const m = /^Відновлено версію (\d+)$/.exec(s)
  return m ? t('Відновлено версію {n}', { n: m[1] }) : note
}

/**
 * Які версії з історії прибрати: rows — [{ hid, updated }] від найновішої. Лишаються RECENT найновіших; давніші — остання
 * за кожен день (за останні DAILY днів) і остання за кожен тиждень (ще давніші); разом — не більше CAP. Повертає hid.
 */
export function thinHistory(rows, now = Date.now()) {
  const DAY = 864e5
  const keep = [], slots = new Set()
  rows.forEach((r, i) => {
    if (i < RECENT) return void keep.push(r.hid)
    const slot = now - r.updated < DAILY * DAY ? 'd' + Math.floor(r.updated / DAY) : 'w' + Math.floor(r.updated / (7 * DAY))
    if (slots.has(slot)) return
    slots.add(slot)
    keep.push(r.hid)
  })
  const kept = new Set(keep.slice(0, CAP))
  return rows.filter((r) => !kept.has(r.hid)).map((r) => r.hid)
}

/**
 * Правки калькулятора бази (спільні): кількості рядків моделі, прибрані рядки, додані цілі з довідника, знижка DD.
 * Ключі рядків — службові («row:foundation», «pl:Цистерна»), тож чистимо не загальним clean (він ламає id), а тут.
 */
export function cleanCalc(v) {
  if (v == null) return null
  if (!isObj(v)) throw fail('правки калькулятора зіпсовані')
  if (JSON.stringify(v).length > 64 * 1024) throw fail('правок калькулятора забагато')
  const str = (s, n = 200) => String(s).replace(/<[^>]*>/g, '').replace(/[<>]/g, '').slice(0, n)
  const num = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1e6, x)) : null)
  const qty = {}
  for (const [k, x] of Object.entries(isObj(v.qty) ? v.qty : {}).slice(0, 500)) { const n = num(x); if (n != null) qty[str(k)] = n }
  const removed = (Array.isArray(v.removed) ? v.removed : []).filter((x) => typeof x === 'string').slice(0, 500).map((x) => str(x))
  const extra = (Array.isArray(v.extra) ? v.extra : [])
    .filter((x) => isObj(x) && ['item', 'build', 'custom'].includes(x.kind) && typeof x.id === 'string' && num(x.qty) != null)
    .slice(0, 200)
    .map((x) => {
      const o = { kind: x.kind, id: str(x.id), qty: num(x.qty) }
      if (typeof x.name === 'string') o.name = str(x.name, 120)
      if (Array.isArray(x.cost)) o.cost = x.cost.filter((c) => Array.isArray(c) && typeof c[0] === 'string' && Number.isFinite(c[1])).slice(0, 40).map(([i, q]) => [str(i, 80), q])
      if (x.cat === null || typeof x.cat === 'string') o.cat = x.cat === null ? null : str(x.cat, 20)
      if (typeof x.icon === 'string' && /^(\/|https:\/\/)/.test(x.icon)) o.icon = x.icon.slice(0, 400)
      if (typeof x.ref === 'string') o.ref = str(x.ref)
      if (Array.isArray(x.see) && (x.see[0] === 'item' || x.see[0] === 'place') && typeof x.see[1] === 'string') o.see = [x.see[0], str(x.see[1])]
      if (typeof x.dd === 'boolean') o.dd = x.dd
      return o
    })
  return { qty, removed, extra, ...(typeof v.dd === 'boolean' ? { dd: v.dd } : {}) }
}

// ---------- вивантаження й імпорт ----------
/** файл вивантаження: службове (формат, назва, версія, коли, звідки) і сам документ бази в doc */
export const EXPORT_FORMAT = 'sandwalkers-base/1'

export function exportBase(b, { site = 'Sandwalkers', url = '', at = Date.now() } = {}) {
  return {
    format: EXPORT_FORMAT,
    name: b.doc?.ui?.name || '',
    id: b.id,
    version: b.version,
    exportedAt: new Date(at).toISOString(),
    site: { name: site, url },
    doc: b.doc,
  }
}

/** ім'я файлу вивантаження: адреса бази й версія (лише латиниця — id вже такий) */
export const exportFileName = (b) => `${b.id}-v${b.version}.json`

/** примітка до першої версії імпортованої бази (службова, українською — мовою людини її показує noteText) */
export function importNote(summary) {
  const src = summary?.source
  return src?.name ? `Імпортовано з файлу: ${src.name}${src.version ? ` v${src.version}` : ''}${src.site ? ` (${src.site})` : ''}` : 'Імпортовано з файлу'
}

const MAX_ISSUES = 60
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Перевірка бази перед імпортом (сайт і панель керування). input — файл вивантаження ({ format, …, doc }), відповідь
 * API бази ({ id, doc, version }) чи сам документ. Повертає { errors, warnings, doc, summary }: errors і warnings —
 * [{ path, key, vars, message }] (path — де в файлі: «doc.pieces[12].shape»; key і vars — український текст і
 * заповнювачі, message — уже перекладений через tr); doc — очищений документ, готовий до bases.create, або null,
 * якщо є помилки; summary — скільки чого (деталей, станцій, рівнів…) і звідки файл.
 * Дрібне виправляє саме (з попередженням): повторені id, однакові деталі на одному місці, база без ділянок чи назви.
 */
export function validateBase(input, tr = fill) {
  const errors = [], warnings = []
  let more = 0
  // t — щоб збирач текстів (i18n-extract) бачив ключі; повідомлення одразу мовою людини
  const t = (key, vars = null) => ({ key, vars, message: tr(key, vars || undefined) })
  // назва поля в повідомленні — словом (координати x, y, z — як є)
  const FIELDS = { rot: () => t('поворот').message, ang: () => t('кут').message, w: () => t('ширина').message, d: () => t('глибина').message }
  const field = (k) => (FIELDS[k] ? FIELDS[k]() : k)
  let pre = ''
  const bad = (p, m) => { if (errors.length < MAX_ISSUES) errors.push({ path: pre + p, ...m }); else more++ }
  const warn = (p, m) => { if (warnings.length < MAX_ISSUES) warnings.push({ path: pre + p, ...m }) }
  const done = (doc, summary) => {
    if (more) errors.push({ path: '', ...t('і ще помилок: {n}', { n: more }) })
    return { errors, warnings, doc: errors.length ? null : doc, summary }
  }

  if (!isObj(input)) { bad('', t('це не база: у файлі має бути об’єкт JSON із документом бази')); return done(null, null) }
  let size = 0
  try { size = JSON.stringify(input).length } catch { bad('', t('документ бази не вдалося прочитати')); return done(null, null) }
  if (size > LIMITS.bytes) { bad('', t('база завелика: {mb} МБ, можна до {max} МБ', { mb: (size / 1048576).toFixed(1), max: LIMITS.bytes / 1048576 })); return done(null, null) }

  // файл вивантаження чи відповідь API — документ у doc
  let d = input, source = null
  if (typeof input.format === 'string') {
    const m = /^sandwalkers-base\/(\d+)$/.exec(input.format)
    if (!m) { bad('format', t('це не база, а «{format}»', { format: input.format.slice(0, 60) })); return done(null, null) }
    if (Number(m[1]) > 1) warn('format', t('файл з новішої версії сайту ({format}) — щось може не перенестися', { format: input.format }))
    if (!isObj(input.doc)) { bad('doc', t('у файлі немає документа бази')); return done(null, null) }
    d = input.doc
    pre = 'doc.'
    source = { name: typeof input.name === 'string' ? input.name.slice(0, 120) : '', version: Number.isInteger(input.version) ? input.version : null, exportedAt: typeof input.exportedAt === 'string' ? input.exportedAt.slice(0, 40) : null, site: isObj(input.site) && typeof input.site.name === 'string' ? input.site.name.slice(0, 80) : null }
  } else if (isObj(input.doc) && !('pieces' in input) && !('rooms' in input)) {
    d = input.doc
    pre = 'doc.'
  }
  d = { ...d }

  if (d.format !== 2 && !Array.isArray(d.rooms)) {
    if (Array.isArray(d.pieces)) {
      warn('format', t('не вказано формат бази — вважаю базою з деталей'))
      d.format = 2
    } else if ('pieces' in d) {
      bad('pieces', t('деталі мають бути списком'))
      return done(null, null)
    } else {
      bad('', t('невідомий формат бази: немає ні деталей, ні приміщень'))
      return done(null, null)
    }
  }
  if ('ui' in d && !isObj(d.ui)) bad('ui', t('підписи бази (назва, опис) зіпсовані'))
  const ui = isObj(d.ui) ? d.ui : {}
  const rawName = typeof ui.name === 'string' ? ui.name.replace(/<[^>]*>/g, '').trim() : ''
  if (!rawName) warn('ui.name', t('у бази немає назви — буде «{name}»', { name: tr('База') }))
  else if (rawName.length > 120) warn('ui.name', t('назва задовга — обріжемо до {n} знаків', { n: 120 }))
  if ('claims' in d && !Array.isArray(d.claims)) bad('claims', t('ділянки мають бути списком'))
  else (d.claims || []).forEach((c, i) => {
    if (!isObj(c) || !['x', 'y', 'w', 'd'].every((k) => Number.isFinite(c[k])) || !(c.w > 0 && c.d > 0)) bad(`claims[${i}]`, t('у ділянки мають бути місце й розмір — числа, ширина й глибина більші за нуль'))
  })

  if (d.format === 2) checkPieces(d, { t, bad, warn, field })
  else checkRooms(d, { t, bad })

  let clean = null
  if (!errors.length) {
    try { clean = cleanBase(d, tr) } catch (e) { bad('', e.key ? t(e.key, e.vars) : t('документ бази зіпсований')) }
  }
  if (clean && clean.format === 2) {
    // однакові деталі на тому самому місці — лишаємо по одній (у грі так не буває, а план і кошторис рахували б двічі)
    const seen = new Set()
    const r4 = (v) => Math.round(v * 1e4)
    const n0 = clean.pieces.length
    clean.pieces = clean.pieces.filter((p) => { const k = `${p.shape}|${r4(p.x)}|${r4(p.y)}|${r4(p.z)}|${r4(p.rot)}`; if (seen.has(k)) return false; seen.add(k); return true })
    if (clean.pieces.length < n0) warn('pieces', t('однакових деталей на тому самому місці: {n} — лишено по одній', { n: n0 - clean.pieces.length }))
    // без ділянок план і камери не знають, де база: ділянки 10×10 довкола будови
    if (!clean.claims.length) {
      clean.claims = claimsAround([...clean.pieces, ...clean.items.map((it) => it.c)])
      clean.bounds = BASEDATA.boundsOf(clean.claims)
      // камери 3D — від нових ділянок (як у новій базі), якщо у файлі своїх нема
      if (!isObj(clean.ui.views)) clean.ui = { ...clean.ui, views: BASEDATA.viewsOf(clean.bounds), autoViews: true }
      warn('claims', t('у базі не було ділянок — додано {n} (10×10) за розміром будови', { n: clean.claims.length }))
    }
  }
  return done(clean, describe(clean || d, size, source, tr))
}

/** деталі, станції, приміщення бази з деталей: помилки — з місцем у документі */
function checkPieces(d, { t, bad, warn, field }) {
  if (!Array.isArray(d.pieces)) { bad('pieces', t('деталі мають бути списком')); return }
  if (d.pieces.length > LIMITS.pieces) { bad('pieces', t('забагато деталей: {n}, можна до {max}', { n: d.pieces.length, max: LIMITS.pieces })); return }
  if (!d.pieces.length) warn('pieces', t('у базі жодної деталі — відкриється порожньою'))
  const ids = new Set()
  let dup = 0
  d.pieces.forEach((p, i) => {
    const at = `pieces[${i}]`
    if (!isObj(p)) return bad(at, t('деталь — це об’єкт із формою, місцем і поворотом'))
    if (typeof p.shape !== 'string' || !p.shape) bad(`${at}.shape`, t('не вказано форму деталі'))
    else if (!PIECES.SHAPES[p.shape]) bad(`${at}.shape`, t('невідома деталь «{shape}»', { shape: p.shape.slice(0, 60) }))
    for (const k of ['x', 'y', 'z', 'rot']) {
      if (!Number.isFinite(p[k])) bad(`${at}.${k}`, t('{field} має бути числом', { field: field(k) }))
      else if (Math.abs(p[k]) > 1e5) bad(`${at}.${k}`, t('{field} — завелике число: {v}', { field: field(k), v: p[k] }))
    }
    if (p.id != null) { const k = String(p.id); if (ids.has(k)) dup++; else ids.add(k) }
  })
  if (dup) warn('pieces', t('повторюються id деталей ({n}) — такі отримають нові', { n: dup }))

  if ('items' in d && !Array.isArray(d.items)) bad('items', t('станції мають бути списком'))
  else if ((d.items || []).length > LIMITS.items) bad('items', t('забагато станцій: {n}, можна до {max}', { n: d.items.length, max: LIMITS.items }))
  else {
    let unnamed = 0
    ;(d.items || []).forEach((it, i) => {
      const at = `items[${i}]`
      if (!isObj(it)) return bad(at, t('станція — це об’єкт із назвою, видом, місцем і розміром'))
      if (!isObj(it.c) || !Number.isFinite(it.c.x) || !Number.isFinite(it.c.y)) bad(`${at}.c`, t('у станції немає місця: координати мають бути числами'))
      for (const k of ['w', 'd']) if (!(Number.isFinite(it[k]) && it[k] > 0)) bad(`${at}.${k}`, t('розмір станції ({field}) має бути числом, більшим за нуль', { field: field(k) }))
      if (!(Number.isFinite(it.h) && it.h >= 0)) bad(`${at}.h`, t('висота станції має бути числом, не меншим за нуль'))
      if ('ang' in it && !Number.isFinite(it.ang)) bad(`${at}.ang`, t('{field} має бути числом', { field: field('ang') }))
      if (typeof it.name !== 'string' || !it.name.trim()) unnamed++
    })
    if (unnamed) warn('items', t('станцій без назви: {n} — їх буде видно як «{name}»', { n: unnamed, name: t('Станція').message }))
  }
  if ('zones' in d && !Array.isArray(d.zones)) bad('zones', t('приміщення мають бути списком'))
  else (d.zones || []).forEach((z, i) => {
    const at = `zones[${i}]`
    if (!isObj(z)) return bad(at, t('приміщення — це об’єкт із назвою, висотою й плитками'))
    if (typeof z.name !== 'string' || !z.name.trim()) bad(`${at}.name`, t('у приміщення немає назви'))
    if (!Array.isArray(z.tiles)) bad(`${at}.tiles`, t('плитки приміщення мають бути списком'))
  })
  // станції без назви — з типовою (план і списки показують назву), без повороту — прямо
  if (Array.isArray(d.items)) d.items = d.items.map((it) => {
    if (!isObj(it)) return it
    const fix = { ...(typeof it.name !== 'string' || !it.name.trim() ? { name: 'Станція' } : {}), ...(!('ang' in it) ? { ang: 0 } : {}) }
    return Object.keys(fix).length ? { ...it, ...fix } : it
  })
}

/** давня база з приміщень (до будівельника) */
function checkRooms(d, { t, bad }) {
  if (d.rooms.length > LIMITS.rooms) bad('rooms', t('забагато приміщень: {n}, можна до {max}', { n: d.rooms.length, max: LIMITS.rooms }))
  d.rooms.forEach((r, i) => {
    if (!isObj(r)) bad(`rooms[${i}]`, t('приміщення — це об’єкт із назвою, висотою й плитками'))
    else if ('tiles' in r && !Array.isArray(r.tiles)) bad(`rooms[${i}].tiles`, t('плитки приміщення мають бути списком'))
  })
  if (!Array.isArray(d.levels) || !d.levels.length) bad('levels', t('у базі немає рівнів'))
  if (!isObj(d.heights)) bad('heights', t('у базі немає висот'))
}

/** ділянки 10×10, що накривають усі точки (деталі, станції); щонайбільше 400 */
function claimsAround(pts) {
  const ok = pts.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  if (!ok.length) return [{ x: -5, y: 0, w: 10, d: 10 }]
  const x0 = Math.floor(Math.min(...ok.map((p) => p.x)) / 10) * 10, y0 = Math.floor(Math.min(...ok.map((p) => p.y)) / 10) * 10
  const x1 = Math.max(x0 + 10, Math.ceil(Math.max(...ok.map((p) => p.x)) / 10) * 10), y1 = Math.max(y0 + 10, Math.ceil(Math.max(...ok.map((p) => p.y)) / 10) * 10)
  const out = []
  for (let x = x0; x < x1 && out.length < 400; x += 10) for (let y = y0; y < y1 && out.length < 400; y += 10) out.push({ x, y, w: 10, d: 10 })
  return out
}

/** підсумок імпорту: скільки чого в базі */
function describe(d, bytes, source, tr) {
  if (!isObj(d)) return null
  const pieces = Array.isArray(d.pieces) ? d.pieces.filter(isObj) : []
  const two = d.format === 2
  // рівні — висоти підлог (як у будівельнику); давня база — її власні рівні без даху
  const levels = two
    ? new Set(pieces.filter((p) => PIECES.isFloor(PIECES.SHAPES[p.shape]) && Number.isFinite(p.z)).map((p) => Math.round(p.z * 100) / 100)).size
    : (Array.isArray(d.levels) ? d.levels : []).filter((l) => l?.key !== 'r').length
  const s = summary({ ...d, rooms: Array.isArray(d.rooms) ? d.rooms.filter(isObj) : [], pieces, items: Array.isArray(d.items) ? d.items : [], zones: Array.isArray(d.zones) ? d.zones : [], claims: Array.isArray(d.claims) ? d.claims : [] }, tr)
  return {
    name: s.name, format: two ? 2 : 1,
    pieces: pieces.length, items: two ? (Array.isArray(d.items) ? d.items.length : 0) : s.items,
    zones: two ? s.rooms : 0, rooms: two ? 0 : s.rooms, tiles: s.tiles, levels, claims: s.claims,
    bytes, source,
  }
}

export async function createBasesStore(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bases (
      id TEXT PRIMARY KEY, doc TEXT NOT NULL, version INTEGER NOT NULL,
      created BIGINT NOT NULL, updated BIGINT NOT NULL, ord INTEGER NOT NULL DEFAULT 0, deleted BIGINT
    );
    CREATE TABLE IF NOT EXISTS base_history (
      hid {{SERIAL}}, base_id TEXT NOT NULL, doc TEXT NOT NULL,
      version INTEGER NOT NULL, updated BIGINT NOT NULL, note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS base_history_by_base ON base_history (base_id, hid);
  `)
  // нотатка до поточної версії (що змінили) — окремо від історії, де лежать попередні
  await db.addColumn('bases', 'note', "TEXT NOT NULL DEFAULT ''")
  // хто зберіг версію (поточну й давні) — історія показує автора
  await db.addColumn('bases', 'author', 'TEXT')
  await db.addColumn('base_history', 'author', 'TEXT')
  // короткий підсумок (JSON, як summary()) — список не розбирає повних документів
  await db.addColumn('bases', 'summary', "TEXT NOT NULL DEFAULT ''")
  // спільні правки калькулятора бази (JSON, cleanCalc) — не версія документа
  await db.addColumn('bases', 'calc', "TEXT NOT NULL DEFAULT ''")

  const brief = (doc) => JSON.stringify(summary(doc))
  // підсумки баз, збережених до стовпця summary, — раз
  for (const r of await db.all("SELECT id, doc FROM bases WHERE summary = ''")) await db.run('UPDATE bases SET summary = ? WHERE id = ?', brief(JSON.parse(r.doc)), r.id)

  const one = (id) => db.get('SELECT * FROM bases WHERE id = ?', id)
  /** без документа: версія, час і кошик (знімки, перевірки прав) */
  const head = async (id) => {
    const r = await db.get('SELECT id, version, updated, deleted FROM bases WHERE id = ?', id)
    return r ? { id: r.id, version: r.version, updated: r.updated, deleted: r.deleted || null } : null
  }

  const read = async (id) => {
    const r = await one(id)
    if (!r) return null
    return { id: r.id, doc: JSON.parse(r.doc), version: r.version, updated: r.updated, note: r.note, author: r.author || null, deleted: r.deleted || null, calc: r.calc ? JSON.parse(r.calc) : null }
  }
  /**
   * Нова версія. expect — версія, від якої правили (null — від поточної). Запис — лише якщо версія ще та сама (умова
   * в самому UPDATE): двоє, що зберігають одночасно від версії N, не перезапишуть одне одного — другий отримає
   * конфлікт. Попередня — в історію (з автором), історія проріджується. Повертає свіжу базу, { conflict, ...поточна }
   * або null (бази вже нема).
   */
  const CONFLICT = Symbol('conflict')
  const write = async (id, doc, note, expect = null, author = null) => {
    try {
      await db.tx(async (t) => {
        const cur = await t.get('SELECT * FROM bases WHERE id = ?', id)
        if (!cur) throw CONFLICT
        if (expect != null && cur.version !== expect) throw CONFLICT
        const r = await t.run('UPDATE bases SET doc = ?, summary = ?, version = ?, updated = ?, note = ?, author = ? WHERE id = ? AND version = ?', JSON.stringify(doc), brief(doc), cur.version + 1, Date.now(), String(note || '').slice(0, 300), author, id, cur.version)
        if (!r.changes) throw CONFLICT
        await t.run('INSERT INTO base_history (base_id, doc, version, updated, note, author) VALUES (?, ?, ?, ?, ?, ?)', id, cur.doc, cur.version, cur.updated, cur.note || '', cur.author || null)
        const drop = thinHistory(await t.all('SELECT hid, updated FROM base_history WHERE base_id = ? ORDER BY hid DESC', id))
        for (let i = 0; i < drop.length; i += 500) {
          const part = drop.slice(i, i + 500)
          await t.run(`DELETE FROM base_history WHERE hid IN (${part.map(() => '?').join(', ')})`, ...part)
        }
      })
    } catch (e) {
      if (e !== CONFLICT) throw e
      const cur = await read(id)
      return cur ? { conflict: true, ...cur } : null
    }
    return read(id)
  }
  // латиницею з назви (кирилицю — транслітом: «Аванпост на Хагга» → avanpost-na-khahha) і випадковий хвіст: адресу
  // бази «за посиланням» не вгадати перебором, і збіг назви не каже, що чужа база з такою назвою є
  const slug = async (name) => {
    const stem = slugify(name, () => false, 'base').slice(0, 40).replace(/-+$/, '')
    for (;;) {
      const id = `${stem}-${crypto.randomBytes(5).toString('hex').slice(0, 6)}`
      if (!(await head(id))) return id
    }
  }

  return {
    /** порожня таблиця — бази з data/bases/*.json */
    async seed() {
      if ((await db.get('SELECT COUNT(*) AS n FROM bases')).n) return
      const now = Date.now()
      let files = []
      try { files = fs.readdirSync(SEED_DIR).filter((f) => f.endsWith('.json')) } catch { /* без початкових баз */ }
      const rank = (f) => { const i = SEED_ORDER.indexOf(f.slice(0, -5)); return i < 0 ? 99 : i }
      files.sort((a, b) => rank(a) - rank(b))
      await db.tx(async (t) => {
        for (const [i, f] of files.entries()) {
          const doc = cleanBase(JSON.parse(fs.readFileSync(path.join(SEED_DIR, f), 'utf8')))
          await t.run('INSERT INTO bases (id, doc, summary, version, created, updated, ord, note) VALUES (?, ?, ?, 1, ?, ?, ?, ?)', f.slice(0, -5), JSON.stringify(doc), brief(doc), now + i, now + i, i, 'Початкова версія')
        }
      })
    },
    /** список коротко (без документів); ids — лише ці (те, що людина бачить) */
    async list(t = fill, ids = null) {
      if (ids && !ids.length) return []
      const some = ids && ids.length <= 500
      const rows = await db.all(`SELECT id, version, created, updated, deleted, summary FROM bases${some ? ` WHERE id IN (${ids.map(() => '?').join(', ')})` : ''} ORDER BY ord, created`, ...(some ? ids : []))
      const want = ids && !some ? new Set(ids) : null
      return rows.filter((r) => !want || want.has(r.id)).map((r) => {
        const s = r.summary ? JSON.parse(r.summary) : {}
        return { id: r.id, version: r.version, created: r.created, updated: r.updated, deleted: r.deleted || null, name: s.name || t('База'), lead: s.lead || '', facts: s.facts || [], rooms: s.rooms || 0, tiles: s.tiles || 0, items: s.items || 0, claims: s.claims || 0 }
      })
    },
    get: read,
    head,
    /** нова база: з документа (порожня чи копія); author — хто створив (перша версія) */
    async create(doc, note, t, author = null) {
      const clean = cleanBase(doc, t)
      const id = await slug(clean.ui.name)
      const now = Date.now()
      const ord = (await db.get('SELECT COALESCE(MAX(ord), 0) AS m FROM bases')).m + 1
      await db.run('INSERT INTO bases (id, doc, summary, version, created, updated, ord, note, author) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)', id, JSON.stringify(clean), brief(clean), now, now, ord, String(note || '').slice(0, 300), author)
      return read(id)
    },
    /** зберегти, якщо ніхто не встиг раніше; інакше { conflict, ...свіжа } */
    async put(id, doc, base, note, t, author = null) {
      const cur = await head(id)
      if (!cur) return null
      if (base !== cur.version) {
        const fresh = await read(id)
        return fresh ? { conflict: true, ...fresh } : null
      }
      return write(id, cleanBase(doc, t), note, base, author)
    },
    // у кошик і назад — без зміни часу версії: вміст той самий
    async remove(id) {
      if (!(await head(id))) return null
      await db.run('UPDATE bases SET deleted = ? WHERE id = ?', Date.now(), id)
      return head(id)
    },
    /** стерти назовсім, з історією (людину чи гільдію видалили) */
    async purge(id) {
      await db.run('DELETE FROM base_history WHERE base_id = ?', id)
      await db.run('DELETE FROM bases WHERE id = ?', id)
    },
    async undelete(id) {
      if (!(await head(id))) return null
      await db.run('UPDATE bases SET deleted = ? WHERE id = ?', null, id)
      return head(id)
    },
    /** історія: поточна версія першою (hid 0), далі попередні; author — id людини (ім'я додає маршрут) */
    async history(id) {
      const cur = await db.get('SELECT version, updated, note, author FROM bases WHERE id = ?', id)
      if (!cur) return null
      const rows = await db.all('SELECT hid, version, updated, note, author FROM base_history WHERE base_id = ? ORDER BY hid DESC', id)
      return [{ hid: 0, current: true, version: cur.version, updated: cur.updated, note: cur.note, author: cur.author || null }, ...rows.map((r) => ({ ...r, author: r.author || null }))]
    },
    /** відновити версію з історії: стає новою поточною (поточна йде в історію); author — хто відновив */
    async restore(id, hid, author = null) {
      if (!Number.isInteger(hid)) return null
      const h = await db.get('SELECT * FROM base_history WHERE hid = ? AND base_id = ?', hid, id)
      if (!h) return null
      return write(id, JSON.parse(h.doc), `Відновлено версію ${h.version}`, null, author)
    },
    /** документ із історії — подивитися, не відновлюючи */
    async historyDoc(id, hid) {
      if (!Number.isInteger(hid)) return null
      const h = await db.get('SELECT * FROM base_history WHERE hid = ? AND base_id = ?', hid, id)
      return h ? { id, hid, doc: JSON.parse(h.doc), version: h.version, updated: h.updated, note: h.note, author: h.author || null } : null
    },
    /** спільні правки калькулятора бази (null — як у моделі) */
    async setCalc(id, calc) {
      const c = cleanCalc(calc)
      const r = await db.run('UPDATE bases SET calc = ? WHERE id = ?', c ? JSON.stringify(c) : '', id)
      return r.changes ? c : undefined
    },
  }
}

/*
 * Біржа гравців (WTB / WTS): оголошення «Куплю» й «Продам» з предметами з файлів гри, угоди між гравцями з
 * листуванням і оцінками, скарги й заборони. Власник і видимість оголошення — у реєстрі речей (kind 'listing',
 * lib/items.mjs); тут — документ і все, що навколо. Платежів нема: сайт зводить людей, передача — у грі.
 *
 * Таблиці: market_listings — документ (JSON) і окремо те, за чим шукають (вид, предмет, розділ довідника, тир, регіон,
 * ключі світу й сервера, ціна за штуку, кількість і залишок, стан, строк, свіжість); market_deals — угода зі знімком
 * умов (сторони бачать її, навіть коли оголошення сховали чи закрили) і прапорцем pub — чи було оголошення публічним
 * (лише такі угоди йдуть в історію цін і медіану); market_ratings — оцінки сторін (листування угоди — у спільних
 * розмовах сайту, lib/chats.mjs);
 * market_matches — пари оголошень, про збіг яких уже сповіщено; market_reports — скарги; market_bans — заборони біржі.
 *
 * Продається лише те, що гра пускає на свою біржу: не HideFromExchange (прапорець гри), не сама валюта, не вміння, не
 * контракти й зразки фарб, не заглушки розробників.
 */
import { STORM_REGIONS } from './storm.mjs'
import { fail, newId, plain } from './util.mjs'

export const SIDES = ['buy', 'sell']
export const PAYS = ['solari', 'barter', 'both']
export const TTL_DAYS = [1, 3, 7, 14, 30]
export const REASONS = ['rmt', 'scam', 'spam', 'wrong', 'abuse', 'other']
export const SECTIONS = ['resources', 'weapon', 'garment', 'tool', 'vehicle', 'schematic']
export const DEAL_STATES = ['offered', 'accepted', 'done', 'declined', 'cancelled']
export const REGIONS = Object.keys(STORM_REGIONS)
/** ліміт відкритих оголошень (налаштування сайту «limits» міняє; 0 — без меж) */
export const LISTING_LIMITS = { user: 30, guild: 100 }
/** скільки різних людей має поскаржитись на RMT, щоб оголошення сховалось до рішення модератора */
export const RMT_AUTOHIDE = 3
/** оцінку можна змінити стільки днів */
export const RATE_EDIT_DAYS = 14

const DAY = 86400_000
const MAX_QTY = 1e9
const MAX_PRICE = 1e12

/** ключ світу чи сервера для збігу й фільтра: «Hagga-EU_7» і «hagga eu  7» — одне */
export const worldKey = (s) => String(s ?? '').toLowerCase().replace(/[\s\-_]+/g, ' ').trim()

/** ознаки торгівлі за реальні гроші: валюти, платіжки, крипта, «реальні гроші» */
const W = (x) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${x})(?![\\p{L}])`, 'iu')
const RMT = [
  /\$\s?\d|\d\s?\$|[€£₴₽]/u,
  W('usd|eur|uah|rub|pln|gbp|usdt|btc|eth'),
  /pay\s?pal|пейпал|пайпал|venmo|revolut|skrill|qiwi|monobank|приват\s?24|privat\s?24|western\s?union|webmoney/iu,
  /real[\s-]*(life\s+)?money|\birl\s+(money|cash)|реальн\p{L}*\s+гро[шш]\p{L}*|живі\s+гроші|крипт\p{L}*|crypto/iu,
  W('гривн\\p{L}*|грн|руб|рубл\\p{L}*|долар\\p{L}*|dollars?|euros?|євро'),
]
/** перша ознака RMT у текстах (рядок, який її видав) або null */
export function rmtHit(...texts) {
  for (const s of texts) {
    const str = String(s ?? '')
    for (const re of RMT) {
      const m = re.exec(str)
      if (m) return m[0].trim()
    }
  }
  return null
}

/** заглушки розробників у даних гри (та сама перевірка, що в довіднику на клієнті — src/lib/catalog.ts) */
export const junkName = (name) => name.includes('/') || /\bTBD\b/.test(name) || /^[A-Z0-9]+_[A-Z0-9_]*$/.test(name) || /^(XX|NA|PH)_/.test(name) || /^\[DEPRECATED\]/i.test(name)
const NOT_TRADE_CATS = new Set(['contract', 'swatch'])
const NOT_TRADE_KINDS = new Set(['HideFromExchange', 'Solaris', 'Abilities', 'HalloweenCurrency'])
/** розділ довідника: misc — ресурси */
export const sectionOf = (i) => (i.cat === 'misc' ? 'resources' : i.cat)
export const tradeable = (i) => !!i && !NOT_TRADE_CATS.has(i.cat) && !NOT_TRADE_KINDS.has(i.kind) && !!i.name && !junkName(i.name)

/** предмети, що продаються: Map(id гри → { id, cat, grade, rarity, name, icon }) — з довідника англійською (той самий об'єкт — та сама мапа) */
const goodsMemo = new WeakMap()
export function goodsOf(catalog) {
  if (!catalog) return new Map()
  let m = goodsMemo.get(catalog)
  if (!m) {
    m = new Map(catalog.items.filter(tradeable).map((i) => [i.id, { id: i.id, cat: sectionOf(i), grade: i.grade ?? 0, rarity: i.rarity ?? null, name: i.name, icon: i.icon ?? null }]))
    goodsMemo.set(catalog, m)
  }
  return m
}

const int = (v, lo, hi) => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n >= lo && n <= hi ? n : null
}

/** бартер: до 3 рядків «предмет × кількість», без повторів і без самого предмета оголошення */
export function cleanBarter(list, goods, self) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const b of list.slice(0, 3)) {
    if (!b || typeof b !== 'object' || !b.gid) continue
    if (!goods.has(b.gid)) throw fail('цей предмет не продається на біржі')
    if (b.gid === self || seen.has(b.gid)) throw fail('у бартері — різні предмети, не той самий, що в оголошенні')
    const qty = int(b.qty, 1, MAX_QTY)
    if (qty == null) throw fail('кількість — ціле число від 1')
    seen.add(b.gid)
    out.push({ gid: b.gid, qty })
  }
  return out
}

/**
 * Документ оголошення: лише відомі поля, тексти обрізані; точка — тією самою перевіркою, що в подій і позначок
 * (maps.cleanPoint); база — лише id (чи бачить її автор — перевіряє маршрут). goods — goodsOf(довідник).
 */
export function cleanListing(d, { goods, maps }) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw fail('порожнє оголошення')
  const side = SIDES.includes(d.side) ? d.side : null
  if (!side) throw fail('вибери: куплю чи продам')
  const g = typeof d.gid === 'string' ? goods.get(d.gid) : null
  if (!g) throw fail('цей предмет не продається на біржі')
  const qty = int(d.qty, 1, MAX_QTY)
  if (qty == null) throw fail('кількість — ціле число від 1')
  const minQty = d.minQty == null || d.minQty === '' || d.minQty === 0 ? 0 : int(d.minQty, 1, MAX_QTY)
  if (minQty == null) throw fail('мінімальна партія — ціле число від 1')
  if (minQty > qty) throw fail('мінімальна партія не може бути більшою за кількість')
  const pay = PAYS.includes(d.pay) ? d.pay : 'solari'
  const price = pay === 'barter' || d.price == null || d.price === '' ? null : int(d.price, 1, MAX_PRICE)
  if (pay !== 'barter' && price == null) throw fail('ціна за штуку — ціле число соларів від 1')
  const barter = pay === 'solari' ? [] : cleanBarter(d.barter, goods, g.id)
  if (pay !== 'solari' && !barter.length) throw fail('для бартеру вкажи хоча б один предмет')
  const region = REGIONS.includes(d.region) ? d.region : null
  if (!region) throw fail('вибери регіон')
  const world = plain(d.world, 40)
  if (worldKey(world).length < 2) throw fail('вкажи світ — щонайменше 2 знаки')
  const server = plain(d.server, 40)
  const ttl = TTL_DAYS.includes(Number(d.ttl)) ? Number(d.ttl) : 7
  let place = null
  const p = d.place && typeof d.place === 'object' ? d.place : null
  if (p?.kind === 'point') place = { kind: 'point', point: maps.cleanPoint(p.point) }
  else if (p?.kind === 'base') {
    if (typeof p.base !== 'string' || !/^[\w-]{1,64}$/.test(p.base)) throw fail('немає такої бази')
    place = { kind: 'base', base: p.base }
  } else if (p?.kind === 'text') {
    const text = plain(p.text, 200)
    if (text) place = { kind: 'text', text }
  }
  const c = d.contact && typeof d.contact === 'object' ? d.contact : {}
  const contact = { site: c.site !== false, nick: plain(c.nick, 40) }
  if (!contact.site && !contact.nick) throw fail('як з тобою зв’язатися: через сайт чи нік у грі')
  const note = plain(d.note, 1000, true)
  const hit = rmtHit(note, world, server, contact.nick, place?.kind === 'text' ? place.text : '')
  if (hit) throw fail('схоже на торгівлю за реальні гроші («{word}») — на біржі це заборонено', 400, { word: hit })
  return { side, gid: g.id, qty, minQty, pay, price, barter, negotiable: !!d.negotiable, region, world, server, ttl, place, contact, note }
}

/** медіана й квартилі відсортованого списку */
function quantiles(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => {
    const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i)
    return Math.round(s[lo] + (s[hi] - s[lo]) * (i - lo))
  }
  return { median: q(0.5), p25: q(0.25), p75: q(0.75), n: s.length }
}

/** ціни сумісні: купують не дешевше, ніж продають (бартер без ціни — завжди «можливо») */
export function pricesMeet(a, b) {
  const buy = a.side === 'buy' ? a : b, sell = a.side === 'sell' ? a : b
  if (buy.price == null || sell.price == null) return true
  return buy.price >= sell.price
}

export async function createMarket(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS market_listings (
      id TEXT PRIMARY KEY, doc TEXT NOT NULL, side TEXT NOT NULL, gid TEXT NOT NULL, cat TEXT NOT NULL, grade INTEGER NOT NULL DEFAULT 0,
      region TEXT NOT NULL, world_key TEXT NOT NULL, server_key TEXT NOT NULL DEFAULT '', price BIGINT, qty BIGINT NOT NULL,
      left_qty BIGINT NOT NULL, min_qty BIGINT NOT NULL DEFAULT 0, status TEXT NOT NULL, expires BIGINT NOT NULL, fresh BIGINT NOT NULL,
      created BIGINT NOT NULL, updated BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS market_listings_by_item ON market_listings (gid, status, side);
    CREATE INDEX IF NOT EXISTS market_listings_by_fresh ON market_listings (status, fresh);
    CREATE TABLE IF NOT EXISTS market_deals (
      id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, gid TEXT NOT NULL, side TEXT NOT NULL, maker TEXT NOT NULL,
      owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, taker TEXT, qty BIGINT NOT NULL, price BIGINT, barter TEXT NOT NULL,
      status TEXT NOT NULL, maker_done BIGINT, taker_done BIGINT, region TEXT NOT NULL, world TEXT NOT NULL, server TEXT NOT NULL DEFAULT '',
      pub INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '', by_user TEXT, created BIGINT NOT NULL, updated BIGINT NOT NULL, closed BIGINT
    );
    CREATE INDEX IF NOT EXISTS market_deals_by_listing ON market_deals (listing_id, status);
    CREATE INDEX IF NOT EXISTS market_deals_by_maker ON market_deals (maker, updated);
    CREATE INDEX IF NOT EXISTS market_deals_by_taker ON market_deals (taker, updated);
    CREATE INDEX IF NOT EXISTS market_deals_by_item ON market_deals (gid, status, closed);
    CREATE TABLE IF NOT EXISTS market_ratings (
      deal_id TEXT NOT NULL, from_user TEXT NOT NULL, to_user TEXT NOT NULL, score INTEGER NOT NULL, text TEXT NOT NULL DEFAULT '',
      at BIGINT NOT NULL, updated BIGINT NOT NULL, PRIMARY KEY (deal_id, from_user)
    );
    CREATE INDEX IF NOT EXISTS market_ratings_by_to ON market_ratings (to_user, at);
    CREATE TABLE IF NOT EXISTS market_matches (a TEXT NOT NULL, b TEXT NOT NULL, at BIGINT NOT NULL, PRIMARY KEY (a, b));
    CREATE TABLE IF NOT EXISTS market_reports (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', by_user TEXT,
      status TEXT NOT NULL, action TEXT, created BIGINT NOT NULL, resolved_by TEXT, resolved BIGINT
    );
    CREATE INDEX IF NOT EXISTS market_reports_by_target ON market_reports (kind, target, status);
    CREATE INDEX IF NOT EXISTS market_reports_by_status ON market_reports (status, created);
    CREATE TABLE IF NOT EXISTS market_bans (user_id TEXT PRIMARY KEY, until BIGINT, reason TEXT NOT NULL DEFAULT '', by_user TEXT, at BIGINT NOT NULL);
  `)
  const qs = (a) => a.map(() => '?').join(',')
  const listingRow = (r) => (r ? { id: r.id, ...JSON.parse(r.doc), left: Number(r.left_qty), status: r.status, expires: Number(r.expires), fresh: Number(r.fresh), created: Number(r.created), updated: Number(r.updated) } : null)
  const dealRow = (r) => (r ? {
    id: r.id, listingId: r.listing_id, gid: r.gid, side: r.side, maker: r.maker, owner: { kind: r.owner_kind, id: r.owner_id }, taker: r.taker,
    qty: Number(r.qty), price: r.price == null ? null : Number(r.price), barter: JSON.parse(r.barter), status: r.status,
    makerDone: r.maker_done == null ? null : Number(r.maker_done), takerDone: r.taker_done == null ? null : Number(r.taker_done),
    region: r.region, world: r.world, server: r.server, pub: !!Number(r.pub), reason: r.reason, by: r.by_user,
    created: Number(r.created), updated: Number(r.updated), closed: r.closed == null ? null : Number(r.closed),
  } : null)
  const cols = (doc, g) => [doc.side, doc.gid, g.cat, g.grade ?? 0, doc.region, worldKey(doc.world), worldKey(doc.server), doc.price, doc.qty, doc.minQty || 0]
  const getListing = async (id) => listingRow(await db.get('SELECT * FROM market_listings WHERE id = ?', String(id)))
  const getDeal = async (id) => dealRow(await db.get('SELECT * FROM market_deals WHERE id = ?', String(id)))

  const api = {
    get: getListing,
    async many(ids) {
      const out = new Map()
      for (let i = 0; i < ids.length; i += 500) {
        const part = ids.slice(i, i + 500).map(String)
        for (const r of await db.all(`SELECT * FROM market_listings WHERE id IN (${qs(part)})`, ...part)) out.set(r.id, listingRow(r))
      }
      return out
    },
    /** g — запис предмета з goodsOf (розділ і тир — у стовпці для фільтрів) */
    async create(doc, g, now = Date.now()) {
      const id = newId('l')
      await db.run(`INSERT INTO market_listings (id, doc, side, gid, cat, grade, region, world_key, server_key, price, qty, min_qty, left_qty, status, expires, fresh, created, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`, id, JSON.stringify(doc), ...cols(doc, g), doc.qty, now + doc.ttl * DAY, now, now, now)
      return getListing(id)
    },
    /**
     * Зберегти зміни; base — «updated», від якого правили (змінили тим часом — { conflict, ...поточне }). Продане
     * лишається проданим: залишок = нова кількість − уже продане (не менше 0).
     */
    async put(id, doc, g, base = null) {
      const cur = await getListing(id)
      if (!cur) return null
      const left = Math.max(0, doc.qty - (cur.qty - cur.left))
      const now = Date.now()
      const set = 'doc = ?, side = ?, gid = ?, cat = ?, grade = ?, region = ?, world_key = ?, server_key = ?, price = ?, qty = ?, min_qty = ?, left_qty = ?, updated = ?'
      const vals = [JSON.stringify(doc), ...cols(doc, g), left]
      const r = base == null
        ? await db.run(`UPDATE market_listings SET ${set} WHERE id = ?`, ...vals, now, String(id))
        : await db.run(`UPDATE market_listings SET ${set} WHERE id = ? AND updated = ?`, ...vals, Math.max(now, Number(base) + 1), String(id), Number(base))
      if (r.changes) return getListing(id)
      return { conflict: true, ...(await getListing(id)) }
    },
    /** { mod } — закрив модератор: автор сам не відкриє (позначка в документі) */
    async setStatus(id, status, { mod = false } = {}) {
      if (mod) {
        const r = await db.get('SELECT doc FROM market_listings WHERE id = ?', String(id))
        if (r) await db.run('UPDATE market_listings SET doc = ? WHERE id = ?', JSON.stringify({ ...JSON.parse(r.doc), modClosed: true }), String(id))
      }
      await db.run('UPDATE market_listings SET status = ?, updated = ? WHERE id = ?', status, Date.now(), String(id))
      return getListing(id)
    },
    /** продовжити: знову відкрите на ttl днів, свіже від зараз */
    async renew(id, ttl, now = Date.now()) {
      const cur = await getListing(id)
      const days = TTL_DAYS.includes(Number(ttl)) ? Number(ttl) : cur?.ttl || 7
      const doc = { ...JSON.parse((await db.get('SELECT doc FROM market_listings WHERE id = ?', String(id))).doc), ttl: days }
      await db.run("UPDATE market_listings SET doc = ?, status = 'open', expires = ?, fresh = ?, updated = ? WHERE id = ?", JSON.stringify(doc), now + days * DAY, now, now, String(id))
      return getListing(id)
    },
    /** стерти оголошення (угоди лишаються — у них знімок умов) */
    async remove(id) {
      await db.run('DELETE FROM market_matches WHERE a = ? OR b = ?', String(id), String(id))
      return (await db.run('DELETE FROM market_listings WHERE id = ?', String(id))).changes > 0
    },
    hasDeals: async (id) => !!(await db.get('SELECT 1 AS x FROM market_deals WHERE listing_id = ? LIMIT 1', String(id))),
    /** скільки відкритих (і ще не минулих) оголошень у власника — для ліміту */
    openCount: async (o, now = Date.now()) => Number((await db.get(`SELECT COUNT(*) AS n FROM market_listings l JOIN items i ON i.kind = 'listing' AND i.id = l.id
      WHERE i.owner_kind = ? AND i.owner_id = ? AND l.status = 'open' AND l.expires > ?`, o.kind, o.id, now)).n),

    /**
     * Оголошення для списків. scope: all — відкрите, що людина бачить (публічне не сховане, своє, своїх гільдій);
     * mine — своє й своїх гільдій, у будь-якому стані (state: open | closed | all); guild — гільдії guild (чужої — лише
     * публічне); user — публічне відкрите людини uidOf (сторінка людини). Рядки — з реєстру (i.*) і l_*; права
     * перевіряє маршрут.
     */
    async list({ scope = 'all', uid = null, gids = [], guild = null, uidOf = null, side = '', gid = '', gidsIn = null, cat = '', region = '', world = '', server = '', min = null, max = null, fresh = 0, sort = 'new', state = 'open', limit = 30, offset = 0, now = Date.now() } = {}) {
      const where = [], args = []
      const own = "(i.owner_kind = 'user' AND i.owner_id = ?)"
      const pub = "(i.visibility = 'public' AND i.hidden IS NULL)"
      if (scope === 'mine') {
        if (!uid) return { rows: [], total: 0 }
        where.push(`(${own}${gids.length ? ` OR (i.owner_kind = 'guild' AND i.owner_id IN (${qs(gids)}))` : ''} OR i.created_by = ?)`); args.push(uid, ...gids, uid)
      } else if (scope === 'guild') {
        if (!guild) return { rows: [], total: 0 }
        // своїм — і гільдійське, але сховане модератором — лише автору
        if (gids.includes(guild)) { where.push("i.owner_kind = 'guild' AND i.owner_id = ? AND (i.hidden IS NULL OR i.created_by = ?)"); args.push(guild, uid) }
        else { where.push(`i.owner_kind = 'guild' AND i.owner_id = ? AND ${pub}`); args.push(guild) }
      } else if (scope === 'user') {
        if (!uidOf) return { rows: [], total: 0 }
        where.push(`${pub} AND ${own}`); args.push(uidOf)
      } else {
        const parts = [pub]
        if (uid) { parts.push(own); args.push(uid) }
        if (gids.length) { parts.push(`(i.owner_kind = 'guild' AND i.owner_id IN (${qs(gids)}))`); args.push(...gids) }
        where.push(`(${parts.join(' OR ')})`)
        // сховане модератором — не в стрічці, навіть власнику (він бачить його в «Моїх»)
        where.push('i.hidden IS NULL')
      }
      // відкрите — ще й не минуле (фонова задача могла ще не пройти)
      if (scope !== 'mine' || state === 'open') { where.push("l.status = 'open' AND l.expires > ?"); args.push(now) }
      else if (state === 'closed') { where.push("(l.status <> 'open' OR l.expires <= ?)"); args.push(now) }
      if (SIDES.includes(side)) { where.push('l.side = ?'); args.push(side) }
      if (gid) { where.push('l.gid = ?'); args.push(String(gid)) }
      else if (Array.isArray(gidsIn)) {
        if (!gidsIn.length) return { rows: [], total: 0 }
        const part = gidsIn.slice(0, 400)
        where.push(`l.gid IN (${qs(part)})`); args.push(...part)
      }
      if (SECTIONS.includes(cat)) { where.push('l.cat = ?'); args.push(cat) }
      if (REGIONS.includes(region)) { where.push('l.region = ?'); args.push(region) }
      if (worldKey(world)) { where.push('l.world_key = ?'); args.push(worldKey(world)) }
      if (worldKey(server)) { where.push('l.server_key = ?'); args.push(worldKey(server)) }
      if (min != null && Number.isFinite(Number(min)) && Number(min) > 0) { where.push('l.price >= ?'); args.push(Math.floor(Number(min))) }
      if (max != null && Number.isFinite(Number(max)) && Number(max) > 0) { where.push('l.price <= ?'); args.push(Math.ceil(Number(max))) }
      if ([1, 3, 7].includes(Number(fresh))) { where.push('l.fresh > ?'); args.push(now - Number(fresh) * DAY) }
      const order = sort === 'cheap' ? '(l.price IS NULL), l.price ASC, l.fresh DESC' : sort === 'dear' ? '(l.price IS NULL), l.price DESC, l.fresh DESC' : 'l.fresh DESC'
      const from = `FROM market_listings l JOIN items i ON i.kind = 'listing' AND i.id = l.id WHERE ${where.join(' AND ')}`
      const rows = await db.all(`SELECT i.*, l.doc AS l_doc, l.left_qty AS l_left, l.status AS l_status, l.expires AS l_expires, l.fresh AS l_fresh, l.created AS l_created, l.updated AS l_updated ${from} ORDER BY ${order}, l.id LIMIT ? OFFSET ?`, ...args, Math.min(100, Math.max(1, Number(limit) || 30)), Math.max(0, Number(offset) || 0))
      const total = Number((await db.get(`SELECT COUNT(*) AS n ${from}`, ...args)).n)
      return { rows, total }
    },
    /** рядок списку (i.* + l_*) → оголошення */
    fromList: (r) => ({ id: r.id, ...JSON.parse(r.l_doc), left: Number(r.l_left), status: r.l_status, expires: Number(r.l_expires), fresh: Number(r.l_fresh), created: Number(r.l_created), updated: Number(r.l_updated) }),
    /** світи регіону, які трапляються найчастіше (за 60 днів): Map(регіон → назви) */
    async worlds(now = Date.now()) {
      const rows = await db.all(`SELECT region, world_key, COUNT(*) AS n FROM market_listings l JOIN items i ON i.kind = 'listing' AND i.id = l.id
        WHERE l.created > ? AND i.visibility = 'public' AND i.hidden IS NULL GROUP BY region, world_key ORDER BY n DESC`, now - 60 * DAY)
      const out = {}
      for (const r of rows) {
        const list = (out[r.region] ||= [])
        if (list.length >= 8) continue
        // назву світу — як її написав автор найсвіжішого оголошення
        const one = await db.get('SELECT doc FROM market_listings WHERE region = ? AND world_key = ? ORDER BY created DESC LIMIT 1', r.region, r.world_key)
        list.push(one ? JSON.parse(one.doc).world : r.world_key)
      }
      return out
    },
    /** останні регіон / світ / сервер / нік людини — з її найсвіжішого оголошення */
    async defaultsOf(uid) {
      const r = await db.get("SELECT l.doc FROM market_listings l JOIN items i ON i.kind = 'listing' AND i.id = l.id WHERE i.created_by = ? ORDER BY l.created DESC LIMIT 1", uid)
      if (!r) return null
      const d = JSON.parse(r.doc)
      return { region: d.region, world: d.world, server: d.server, nick: d.contact?.nick || '' }
    },
    /** минули строки: відкриті → expired; повертає їх (сповістити авторів) */
    async expire(now = Date.now()) {
      const rows = await db.all("SELECT * FROM market_listings WHERE status = 'open' AND expires <= ?", now)
      if (rows.length) await db.run("UPDATE market_listings SET status = 'expired', updated = ? WHERE status = 'open' AND expires <= ?", now, now)
      return rows.map(listingRow)
    },

    // ---------- збіг ----------
    /** кандидати на зустрічне для оголошення l (права, власник і «сховане» перевіряє маршрут) */
    async counterOf(l, now = Date.now()) {
      if (l.status !== 'open' || l.expires <= now) return []
      const rows = await db.all(`SELECT * FROM market_listings WHERE gid = ? AND side = ? AND region = ? AND world_key = ? AND status = 'open' AND expires > ? AND id <> ?
        AND (server_key = '' OR ? = '' OR server_key = ?) ORDER BY fresh DESC LIMIT 200`, l.gid, l.side === 'buy' ? 'sell' : 'buy', l.region, worldKey(l.world), now, l.id, worldKey(l.server), worldKey(l.server))
      return rows.map(listingRow).filter((c) => pricesMeet(l, c) && c.left >= (l.minQty || 1) && l.left >= (c.minQty || 1))
    },
    /** чи вже сповіщали про цю пару; позначити */
    matched: async (a, b) => !!(await db.get('SELECT 1 AS x FROM market_matches WHERE a = ? AND b = ?', ...[a, b].sort())),
    markMatched: (a, b) => db.run('INSERT INTO market_matches (a, b, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', ...[a, b].sort(), Date.now()),

    // ---------- книга, медіана, історія ----------
    /**
     * Ціни предмета від спільноти: медіана (і 25–75 %) ціни за штуку з завершених угод у Solari за 30 днів, лише з
     * публічних оголошень; угод нема — медіана відкритих «Продам» (publicSell — ціни, які людина бачить у книзі).
     */
    async stats(gid, { region = '', world = '', publicSell = [], now = Date.now() } = {}) {
      const where = ["gid = ? AND status = 'done' AND pub = 1 AND price IS NOT NULL AND closed > ?"], args = [gid, now - 30 * DAY]
      if (REGIONS.includes(region)) { where.push('region = ?'); args.push(region) }
      const rows = await db.all(`SELECT price, world FROM market_deals WHERE ${where.join(' AND ')}`, ...args)
      const prices = rows.filter((r) => !worldKey(world) || worldKey(r.world) === worldKey(world)).map((r) => Number(r.price))
      const d = quantiles(prices)
      if (d) return { ...d, source: 'deals' }
      const l = quantiles(publicSell)
      return l ? { ...l, source: 'listings' } : { median: null, p25: null, p75: null, n: 0, source: null }
    },
    /** завершені угоди з публічних оголошень — без імен: коли, скільки, почім (чи бартер), де */
    async history(gid, { region = '', world = '', limit = 100 } = {}) {
      const where = ["gid = ? AND status = 'done' AND pub = 1"], args = [gid]
      if (REGIONS.includes(region)) { where.push('region = ?'); args.push(region) }
      // світ фільтруємо після запиту (ключ світу — з назви), тож беремо з запасом, а обрізаємо вже відфільтроване
      const rows = await db.all(`SELECT closed, qty, price, barter, side, region, world FROM market_deals WHERE ${where.join(' AND ')} ORDER BY closed DESC LIMIT ?`, ...args, worldKey(world) ? 3000 : Math.min(300, limit))
      return rows.filter((r) => !worldKey(world) || worldKey(r.world) === worldKey(world)).slice(0, Math.min(300, limit))
        .map((r) => ({ at: Number(r.closed), qty: Number(r.qty), price: r.price == null ? null : Number(r.price), barter: JSON.parse(r.barter), side: r.side, region: r.region, world: r.world }))
    },

    // ---------- угоди ----------
    getDeal,
    /** нова пропозиція (стан offered): знімок умов оголошення l, власник o, pub — чи публічне оголошення */
    async addDeal(l, { maker, owner: o, qty, price, barter, pub }) {
      const id = newId('d')
      const now = Date.now()
      await db.run(`INSERT INTO market_deals (id, listing_id, gid, side, maker, owner_kind, owner_id, taker, qty, price, barter, status, maker_done, taker_done, region, world, server, pub, reason, by_user, created, updated, closed)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'offered', NULL, NULL, ?, ?, ?, ?, '', NULL, ?, ?, NULL)`,
      id, l.id, l.gid, l.side, maker, o.kind, o.id, qty, price, JSON.stringify(barter || []), l.region, l.world, l.server || '', pub ? 1 : 0, now, now)
      return getDeal(id)
    },
    /** змінити умови пропозиції (лише поки offered) */
    amendDeal: async (id, { qty, price, barter }) => { await db.run("UPDATE market_deals SET qty = ?, price = ?, barter = ?, updated = ? WHERE id = ? AND status = 'offered'", qty, price, JSON.stringify(barter || []), Date.now(), String(id)); return getDeal(id) },
    /** людина вже має активну пропозицію на це оголошення */
    activeOffer: async (lid, uid) => dealRow(await db.get("SELECT * FROM market_deals WHERE listing_id = ? AND maker = ? AND status IN ('offered', 'accepted') LIMIT 1", String(lid), uid)),
    /** скільки вже обіцяно в прийнятих (ще не завершених) угодах */
    promised: async (lid) => Number((await db.get("SELECT COALESCE(SUM(qty), 0) AS n FROM market_deals WHERE listing_id = ? AND status = 'accepted'", String(lid))).n),
    dealsOfListing: async (lid) => (await db.all('SELECT * FROM market_deals WHERE listing_id = ? ORDER BY created DESC', String(lid))).map(dealRow),
    /** угоди, де людина — сторона (запропонувала чи прийняла), і пропозиції на оголошення, які вона веде (lids) */
    async dealsFor(uid, lids = [], state = 'active') {
      const st = state === 'done' ? "status IN ('done', 'declined', 'cancelled')" : state === 'all' ? '1 = 1' : "status IN ('offered', 'accepted')"
      const parts = ['maker = ?', 'taker = ?'], args = [uid, uid]
      const part = lids.slice(0, 500)
      if (part.length) { parts.push(`(listing_id IN (${qs(part)}) AND status = 'offered')`); args.push(...part) }
      return (await db.all(`SELECT * FROM market_deals WHERE (${parts.join(' OR ')}) AND ${st} ORDER BY updated DESC LIMIT 200`, ...args)).map(dealRow)
    },
    /** перехід стану лише з очікуваного (одночасні кліки не проскочать двічі) */
    async moveDeal(id, from, to, patch = {}) {
      const now = Date.now()
      const r = await db.run(`UPDATE market_deals SET status = ?, taker = COALESCE(?, taker), reason = ?, by_user = ?, updated = ?, closed = ? WHERE id = ? AND status IN (${qs(from)})`,
        to, patch.taker ?? null, plain(patch.reason, 300, true), patch.by ?? null, now, ['done', 'declined', 'cancelled'].includes(to) ? now : null, String(id), ...from)
      return r.changes ? getDeal(id) : null
    },
    /**
     * Сторона підтвердила «Завершено»; обидві — угода done і залишок оголошення менше на її кількість (0 — оголошення
     * закривається). Повертає { deal, finished, listing }.
     */
    async confirmDone(id, who) {
      return db.tx(async (t) => {
        const col = who === 'maker' ? 'maker_done' : 'taker_done'
        const now = Date.now()
        await t.run(`UPDATE market_deals SET ${col} = COALESCE(${col}, ?), updated = ? WHERE id = ? AND status = 'accepted'`, now, now, String(id))
        const fin = await t.run("UPDATE market_deals SET status = 'done', closed = ? WHERE id = ? AND status = 'accepted' AND maker_done IS NOT NULL AND taker_done IS NOT NULL", now, String(id))
        const deal = dealRow(await t.get('SELECT * FROM market_deals WHERE id = ?', String(id)))
        let listing = null
        if (fin.changes) {
          await t.run("UPDATE market_listings SET left_qty = CASE WHEN left_qty > ? THEN left_qty - ? ELSE 0 END, updated = ? WHERE id = ?", deal.qty, deal.qty, now, deal.listingId)
          await t.run("UPDATE market_listings SET status = 'closed' WHERE id = ? AND left_qty <= 0 AND status = 'open'", deal.listingId)
          listing = listingRow(await t.get('SELECT * FROM market_listings WHERE id = ?', deal.listingId))
        }
        return { deal, finished: !!fin.changes, listing }
      })
    },
    setPub: (id, pub) => db.run('UPDATE market_deals SET pub = ? WHERE id = ?', pub ? 1 : 0, String(id)),
    /** заборона: пропозиції людини, яких ще не прийняли, — скасовано; повертає їх */
    async cancelOffersOf(uid) {
      const rows = (await db.all("SELECT * FROM market_deals WHERE maker = ? AND status = 'offered'", uid)).map(dealRow)
      if (rows.length) await db.run("UPDATE market_deals SET status = 'cancelled', reason = '', closed = ?, updated = ? WHERE maker = ? AND status = 'offered'", Date.now(), Date.now(), uid)
      return rows
    },
    /** відкриті угоди людини (заборона): скасувати можна іншій стороні — тут лише список */
    openDealsOf: async (uid) => (await db.all("SELECT * FROM market_deals WHERE (maker = ? OR taker = ?) AND status IN ('offered', 'accepted')", uid, uid)).map(dealRow),

    // ---------- оцінки й репутація ----------
    ratingOf: async (dealId, from) => { const r = await db.get('SELECT * FROM market_ratings WHERE deal_id = ? AND from_user = ?', String(dealId), from); return r ? { score: Number(r.score), text: r.text, at: Number(r.at), updated: Number(r.updated) } : null },
    /** оцінити (чи змінити свою оцінку в межах RATE_EDIT_DAYS) */
    async rate(dealId, from, to, score, text) {
      const now = Date.now()
      const cur = await api.ratingOf(dealId, from)
      if (cur && now - cur.at > RATE_EDIT_DAYS * DAY) throw fail('оцінку вже не можна змінити — минуло {n} днів', 409, { n: RATE_EDIT_DAYS })
      if (cur) await db.run('UPDATE market_ratings SET score = ?, text = ?, updated = ? WHERE deal_id = ? AND from_user = ?', score, text, now, String(dealId), from)
      else await db.run('INSERT INTO market_ratings (deal_id, from_user, to_user, score, text, at, updated) VALUES (?, ?, ?, ?, ?, ?, ?)', String(dealId), from, to, score, text, now, now)
      return api.ratingOf(dealId, from)
    },
    dropRatings: (dealId) => db.run('DELETE FROM market_ratings WHERE deal_id = ?', String(dealId)),
    /** репутація людей: Map(id → { avg, n, done }) — середня оцінка (до десятих), скільки оцінок і завершених угод */
    async reputation(uids) {
      const ids = [...new Set(uids.filter(Boolean))]
      const out = new Map(ids.map((id) => [id, { avg: null, n: 0, done: 0 }]))
      for (let i = 0; i < ids.length; i += 400) {
        const part = ids.slice(i, i + 400)
        for (const r of await db.all(`SELECT to_user, AVG(score) AS a, COUNT(*) AS n FROM market_ratings WHERE to_user IN (${qs(part)}) GROUP BY to_user`, ...part)) {
          Object.assign(out.get(r.to_user), { avg: Math.round(Number(r.a) * 10) / 10, n: Number(r.n) })
        }
        for (const r of await db.all(`SELECT u, COUNT(*) AS n FROM (SELECT maker AS u FROM market_deals WHERE status = 'done' AND maker IN (${qs(part)}) UNION ALL SELECT taker AS u FROM market_deals WHERE status = 'done' AND taker IN (${qs(part)})) x GROUP BY u`, ...part, ...part)) {
          out.get(r.u).done = Number(r.n)
        }
      }
      return out
    },
    /** останні оцінки людини: оцінка, текст, коли, у якій ролі вона була (продавець / покупець) */
    async ratingsOf(uid, limit = 20) {
      const rows = await db.all(`SELECT r.score, r.text, r.at, r.from_user, d.side, d.maker, d.gid, d.pub FROM market_ratings r JOIN market_deals d ON d.id = r.deal_id
        WHERE r.to_user = ? ORDER BY r.at DESC LIMIT ?`, uid, Math.min(100, limit))
      // продавець — та сторона, що віддає предмет: у «Продам» — сторона оголошення, у «Куплю» — та, що запропонувала
      // предмет угоди з непублічного оголошення не показуємо (це внутрішня торгівля гільдії чи людини)
      return rows.map((r) => ({ score: Number(r.score), text: r.text, at: Number(r.at), from: r.from_user, gid: Number(r.pub) ? r.gid : null, role: (r.side === 'sell') === (r.maker !== uid) ? 'seller' : 'buyer' }))
    },

    // ---------- скарги й заборони ----------
    /** скарга; одна відкрита від людини на ціль (інакше 409) */
    async report({ kind, target, reason, note, by }) {
      if (await db.get("SELECT 1 AS x FROM market_reports WHERE kind = ? AND target = ? AND by_user = ? AND status = 'open'", kind, target, by)) throw fail('ти вже поскаржився — модератори розглянуть', 409)
      const id = newId('mr')
      await db.run("INSERT INTO market_reports (id, kind, target, reason, note, by_user, status, action, created) VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?)", id, kind, target, reason, note, by, Date.now())
      return id
    },
    /** скільки різних людей скаржаться на RMT (відкриті скарги) */
    rmtVotes: async (kind, target) => Number((await db.get("SELECT COUNT(DISTINCT by_user) AS n FROM market_reports WHERE kind = ? AND target = ? AND reason = 'rmt' AND status = 'open'", kind, target)).n),
    getReport: async (id) => db.get('SELECT * FROM market_reports WHERE id = ?', String(id)),
    reportsOn: async (kind, target) => db.all('SELECT * FROM market_reports WHERE kind = ? AND target = ? ORDER BY created DESC', kind, target),
    hasReports: async (pairs) => {
      for (const [k, t] of pairs) if (t && (await db.get('SELECT 1 AS x FROM market_reports WHERE kind = ? AND target = ? LIMIT 1', k, String(t)))) return true
      return false
    },
    /** скарги для черги: open — відкриті, closed — розглянуті (останні 200) */
    reports: async (status = 'open') => db.all(`SELECT * FROM market_reports WHERE status ${status === 'open' ? "= 'open'" : "<> 'open'"} ORDER BY created DESC LIMIT ${status === 'open' ? 1000 : 200}`),
    /** розглянути всі відкриті скарги на ціль: action — що зробили (dismiss → dismissed, решта → done) */
    resolve: async (kind, target, action, by) => (await db.run("UPDATE market_reports SET status = ?, action = ?, resolved_by = ?, resolved = ? WHERE kind = ? AND target = ? AND status = 'open'", ['dismiss', 'unhide'].includes(action) ? 'dismissed' : 'done', action, by, Date.now(), kind, target)).changes,
    /** заборона: until — до коли (null — назавжди) */
    ban: (uid, until, reason, by) => db.run('INSERT INTO market_bans (user_id, until, reason, by_user, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET until = excluded.until, reason = excluded.reason, by_user = excluded.by_user, at = excluded.at', uid, until, reason, by, Date.now()),
    unban: (uid) => db.run('DELETE FROM market_bans WHERE user_id = ?', uid),
    /** діюча заборона людини або null */
    async banOf(uid, now = Date.now()) {
      if (!uid) return null
      const b = await db.get('SELECT * FROM market_bans WHERE user_id = ?', uid)
      if (!b || (b.until != null && Number(b.until) <= now)) return null
      return { until: b.until == null ? null : Number(b.until), reason: b.reason }
    },

    /** людину видалено: оцінки їй і її скарги, заборона — геть; угоди лишаються в історії іншої сторони */
    async forgetUser(uid) {
      await db.run('DELETE FROM market_ratings WHERE to_user = ?', uid)
      await db.run('DELETE FROM market_reports WHERE by_user = ?', uid)
      await db.run('DELETE FROM market_bans WHERE user_id = ?', uid)
      await db.run("UPDATE market_deals SET status = 'cancelled', reason = '', closed = ?, updated = ? WHERE (maker = ? OR taker = ?) AND status IN ('offered', 'accepted')", Date.now(), Date.now(), uid, uid)
    },
  }
  return api
}

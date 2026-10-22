/*
 * Дрібниці, спільні для сервера: помилка з кодом відповіді, id, адреса з назви (кирилиця — транслітом), очищення
 * тексту від розмітки й керівних символів.
 */
import crypto from 'node:crypto'

/**
 * Помилка, яку обробник перетворить на відповідь з цим кодом. msg — український текст-ключ перекладу з
 * {заповнювачами}, vars — їхні значення: обробник перекладе мовою людини (i18n.mjs)
 */
export const fail = (msg, status = 400, vars = null) => Object.assign(new Error(fill(msg, vars)), { status, key: msg, vars })

/**
 * По черзі за ключем (у межах процесу сервера): «перевірити, чи є місце» і «вписати» не перемежовуються між
 * одночасними запитами (вступ у гільдію, ліміт речей). Не вкладати з тим самим ключем — зависне.
 */
const queues = new Map()
export async function withLock(key, fn) {
  const prev = queues.get(key) || Promise.resolve()
  let release
  const mine = new Promise((r) => { release = r })
  const tail = prev.then(() => mine)
  queues.set(key, tail)
  await prev
  try { return await fn() } finally {
    release()
    if (queues.get(key) === tail) queues.delete(key)
  }
}

/** «через {n} с» + { n: 5 } → «через 5 с» */
export const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : String(s))

/**
 * форма слова до числа за правилами мови (Intl.PluralRules), як word() на клієнті: forms — уже перекладені
 * [одна, кілька, багато]; решта (other) — остання форма
 */
export const byPlural = (lang, n, [one, few, many]) => {
  const c = new Intl.PluralRules(lang).select(n)
  return c === 'one' ? one : c === 'few' ? few : many
}

/** короткий випадковий id з префіксом: u…, g…, r… */
export const newId = (prefix) => prefix + crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8).toLowerCase() + Date.now().toString(36).slice(-3)

/** українська (і російська) кирилиця → латиниця для адрес; за спрощеною офіційною транслітерацією */
export const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', "'": '', '’': '', ʼ: '', ы: 'y', э: 'e', ё: 'io', ъ: '',
}

/** адреса з назви: латиниця, цифри й дефіси; taken(id) — чи зайнята (тоді -2, -3…) */
export function slugify(name, taken, fallback = 'x', max = 32) {
  const lat = [...String(name).toLowerCase()].map((c) => TRANSLIT[c] ?? c).join('')
  const base = lat.normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max).replace(/-$/, '') || fallback
  let id = base, i = 2
  while (taken(id)) id = `${base}-${i++}`
  return id
}

/** звичайний текст: без тегів і керівних символів, обрізаний; lines — чи лишати переноси рядків */
export function plain(v, max, lines = false) {
  let s = String(v ?? '').replace(/<[^>]*>/g, '')
  s = lines ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '') : s.replace(/[\u0000-\u001f\u007f]/g, ' ')
  s = s.trim()
  return s.length > max ? s.slice(0, max) : s
}

/** колір #rrggbb або null */
export const color = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null)

/** колір для нової людини чи гільдії — з палітри, за рядком (той самий логін — той самий колір) */
const PALETTE = ['#d9481f', '#ee8a2c', '#c9a227', '#5f9e4b', '#2f9e8f', '#2f6fd0', '#6a5acd', '#a855a8', '#c2410c', '#0e7490']
export const paletteFor = (s) => PALETTE[[...String(s)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length]

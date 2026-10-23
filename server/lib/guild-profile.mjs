/*
 * Картка гільдії для каталогу й набору — guilds.profile (JSON): сервер і регіон гри, пояс, мови, стиль гри, правила,
 * вимоги, розклад активності, посилання на Discord і Telegram, герб, хто бачить кожен блок сторінки, анкета вступу.
 * Мішок налаштувань розширюваний (згодом — можливості гільдійного плану): невідомі ключі відкидаються тут, тож нове
 * поле — один рядок у cleanProfile.
 *
 * Видимість блоків — у межах моделі власник + видимість: 'public' (усі) чи 'guild' (лише учасники). Офіцери бачать усе.
 * Анкета: питання «текст», «вибір» (один чи кілька варіантів), «рівень гравця» (1–200), «години онлайну» (розклад
 * у поясі кандидата). Відповіді перевіряє cleanAnswers за анкетою гільдії.
 */
import crypto from 'node:crypto'
import { fail, plain } from './util.mjs'

export const REGIONS = ['eu', 'na', 'sa', 'oce']
export const STYLES = ['pve', 'pvp', 'dd', 'craft', 'trade']
/** мови сайту — ними ж гільдія каже, як спілкується */
export const LANGS = ['uk', 'en', 'de', 'fr', 'es', 'it', 'pl', 'pt-BR', 'ru', 'tr', 'ja', 'ko', 'zh-Hans', 'zh-Hant']
/** блоки сторінки гільдії, видимість яких налаштовується */
export const BLOCKS = ['about', 'rules', 'requirements', 'schedule', 'links', 'officers', 'members', 'bases', 'events', 'map']
/** за замовчуванням усе показуємо всім, крім складу (як було: склад бачать учасники) */
const SHOW_DEFAULT = Object.fromEntries(BLOCKS.map((b) => [b, b === 'members' ? 'guild' : 'public']))
export const QUESTION_TYPES = ['text', 'choice', 'level', 'hours']
export const MAX_QUESTIONS = 12
export const LEVEL_MAX = 200
const MAX_SLOTS = 6

/** пояс IANA, який знає Intl, або null */
export function cleanTz(v) {
  if (typeof v !== 'string' || !v || v.length > 64) return null
  try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return v } catch { return null }
}
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
/** розклад: рядки { days: [0–6], from, to } (до 6); to ≤ from — через північ */
export function cleanSlots(v) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const s of v.slice(0, MAX_SLOTS)) {
    if (!s || typeof s !== 'object') continue
    const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    // поле часу в браузері буває з секундами (18:00:00) — беремо години й хвилини
    const from = String(s.from ?? '').slice(0, 5), to = String(s.to ?? '').slice(0, 5)
    if (!days.length || !HHMM.test(from) || !HHMM.test(to) || from === to) continue
    out.push({ days, from, to })
  }
  return out
}
/** посилання лише туди, куди кличуть у гільдію: запрошення Discord і Telegram */
const LINK_RE = {
  discord: /^https:\/\/(discord\.gg|(www\.)?discord\.com\/invite)\/[\w-]{2,64}\/?$/i,
  telegram: /^https:\/\/t\.me\/(\+|joinchat\/)?[\w-]{3,64}\/?$/i,
}
function cleanLink(kind, v) {
  const s = plain(v, 200)
  if (!s) return ''
  if (!LINK_RE[kind].test(s)) throw fail(kind === 'discord' ? 'посилання на Discord — https://discord.gg/… чи https://discord.com/invite/…' : 'посилання на Telegram — https://t.me/…')
  return s
}
const pick = (v, list) => [...new Set((Array.isArray(v) ? v : []).filter((x) => list.includes(x)))]

function cleanQuestion(q) {
  if (!q || typeof q !== 'object' || !QUESTION_TYPES.includes(q.type)) return null
  const label = plain(q.label, 200)
  if (!label) throw fail('у питання анкети має бути текст')
  const out = { id: /^[\w-]{2,24}$/.test(q.id) ? q.id : crypto.randomBytes(6).toString('base64url'), type: q.type, label, required: !!q.required }
  if (q.type === 'choice') {
    out.options = [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => plain(o, 80)).filter(Boolean))].slice(0, 12)
    if (out.options.length < 2) throw fail('у питання з вибором — щонайменше два варіанти')
    out.multi = !!q.multi
  }
  return out
}
export function cleanForm(f) {
  const src = f && typeof f === 'object' ? f : {}
  const qs = (Array.isArray(src.questions) ? src.questions : []).map(cleanQuestion).filter(Boolean)
  if (qs.length > MAX_QUESTIONS) throw fail('в анкеті — не більше {n} питань', 400, { n: MAX_QUESTIONS })
  const ids = new Set()
  for (const q of qs) { while (ids.has(q.id)) q.id = crypto.randomBytes(6).toString('base64url'); ids.add(q.id) }
  return { intro: plain(src.intro, 1000, true), questions: qs }
}

/** картка гільдії з того, що прийшло (часткове — поверх prev) */
export function cleanProfile(p, prev = {}) {
  const src = { ...emptyProfile(), ...prev, ...(p && typeof p === 'object' ? p : {}) }
  const out = {
    server: plain(src.server, 40),
    region: REGIONS.includes(src.region) ? src.region : null,
    tz: cleanTz(src.tz),
    langs: pick(src.langs, LANGS),
    styles: pick(src.styles, STYLES),
    rules: plain(src.rules, 2000, true),
    requirements: plain(src.requirements, 2000, true),
    schedule: cleanSlots(src.schedule),
    links: { discord: cleanLink('discord', src.links?.discord), telegram: cleanLink('telegram', src.links?.telegram) },
    // герб ставить лише свій маршрут завантаження (адреса зі сховища); тут — тільки прибрати
    emblem: typeof src.emblem === 'string' && /^\/media\/uploads\/[a-f0-9]{24}\.webp$/.test(src.emblem) ? src.emblem : null,
    show: Object.fromEntries(BLOCKS.map((b) => [b, ['public', 'guild'].includes(src.show?.[b]) ? src.show[b] : SHOW_DEFAULT[b]])),
    form: cleanForm(src.form),
  }
  return out
}
export const emptyProfile = () => ({ server: '', region: null, tz: null, langs: [], styles: [], rules: '', requirements: '', schedule: [], links: { discord: '', telegram: '' }, emblem: null, show: { ...SHOW_DEFAULT }, form: { intro: '', questions: [] } })
/** з рядка БД (JSON чи порожньо) — завжди повна картка */
export function readProfile(raw) {
  let p = null
  try { p = raw ? JSON.parse(raw) : null } catch { p = null }
  try { return cleanProfile(p || {}) } catch { return emptyProfile() }
}

/**
 * що з картки бачить глядач: officer — усе (разом з видимістю й анкетою); учасник — усі блоки; чужий — лише блоки
 * «для всіх»; анкета — усім, хто може подати заявку (і офіцерам), бо без неї заявку не подати
 */
export function profileFor(p, { member = false, officer = false } = {}) {
  if (officer) return p
  const see = (b) => member || p.show[b] === 'public'
  return {
    server: p.server, region: p.region, tz: p.tz, langs: p.langs, styles: p.styles, emblem: p.emblem,
    rules: see('rules') ? p.rules : '',
    requirements: see('requirements') ? p.requirements : '',
    schedule: see('schedule') ? p.schedule : [],
    links: see('links') ? p.links : { discord: '', telegram: '' },
    show: Object.fromEntries(BLOCKS.map((b) => [b, see(b) ? 'public' : 'hidden'])),
    form: p.form,
  }
}
/** для картки в каталозі — лише те, що показує картка (без правил і анкети) */
export const cardProfile = (p) => ({ server: p.server, region: p.region, tz: p.tz, langs: p.langs, styles: p.styles, emblem: p.emblem, schedule: p.show.schedule === 'public' ? p.schedule : [], questions: p.form.questions.length })

/** відповіді кандидата за анкетою: { [id питання]: значення }; обов'язкові — без порожніх */
export function cleanAnswers(form, a) {
  const src = a && typeof a === 'object' ? a : {}
  const out = {}
  for (const q of form?.questions || []) {
    const v = src[q.id]
    let x = null
    if (q.type === 'text') x = plain(v, 1000, true) || null
    else if (q.type === 'choice') {
      const list = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).filter((o) => q.options.includes(o))
      x = list.length ? (q.multi ? [...new Set(list)] : [list[0]]) : null
    } else if (q.type === 'level') {
      const n = Number(v)
      if (v != null && v !== '' && (!Number.isInteger(n) || n < 1 || n > LEVEL_MAX)) throw fail('рівень — ціле число від 1 до {max}', 400, { max: LEVEL_MAX })
      x = v == null || v === '' ? null : n
    } else if (q.type === 'hours') {
      const s = cleanSlots(v)
      x = s.length ? s : null
    }
    if (x == null && q.required) throw fail('дай відповідь на питання «{q}»', 400, { q: q.label })
    if (x != null) out[q.id] = x
  }
  return out
}

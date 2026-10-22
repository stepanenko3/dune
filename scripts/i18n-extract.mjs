/*
 * Збирач текстів для перекладу: усі t('…'), <T text="…">, req.t('…'), fail('…') з коду сайту й сервера, плюс підписи,
 * які показують через t(name): розділи панелі керування (server/admin/resources.mjs — поля, дії, зв'язки, повідомлення
 * дій), журнал дій та історія змін (describe.mjs), каталог дозволів (routes/admin.mjs), <FieldShell f={{ label, help }}>,
 * назви й описи фонових задач (cron.register) → locales/keys.json ({ текст: ['файл:рядок', …] }).
 * Показує, скільки текстів без перекладу в кожному locales/<мова>.json; `--prune` прибирає з файлів мов переклади
 * текстів, яких у коді вже нема. Запуск: npm run i18n:extract
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'locales')
const keys = new Map()
const add = (k, where) => {
  if (!k || !/[А-Яа-яІіЇїЄєҐґ]/.test(k)) return // лише українські тексти
  if (!keys.has(k)) keys.set(k, [])
  if (where && keys.get(k).length < 5) keys.get(k).push(where)
}
const unq = (s, q) => s.replace(new RegExp('\\\\' + q, 'g'), q).replace(/\\n/g, '\n').replace(/\\\\/g, '\\')

const walk = (dir, exts) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name)
  if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'data' ? [] : walk(p, exts)
  return exts.some((x) => e.name.endsWith(x)) && !/\.test\.\w+$/.test(e.name) ? [p] : []
})

const STR = String.raw`(['"\`])((?:\\.|(?!\1)[^\\])*?)\1`
const PATTERNS = [
  new RegExp(String.raw`(?<![\w$])(?<!(?<!\.\.)\.)t\(\s*` + STR, 'g'), // t('…') і ...t('…'), але не obj.t('…')
  new RegExp(String.raw`\breq\.t\(\s*` + STR, 'g'), // req.t('…')
  new RegExp(String.raw`\bfail\(\s*` + STR, 'g'), // fail('…')
  new RegExp(String.raw`<T\s+text=(?:\{\s*)?` + STR, 'g'), // <T text="…">
]
/** значення властивостей names: '…' (не obj.label і не в рядку-коментарі) */
const PROP = (names) => new RegExp(String.raw`(?<![\w$.])(?:${names.join('|')})\s*:\s*` + STR, 'g')
const inComment = (src, i) => { const ln = src.slice(src.lastIndexOf('\n', i - 1) + 1, i); return /^\s*(\/\/|\/?\*)/.test(ln) || /\s\/\/\s/.test(ln) }
/** текст об'єкта-літерала з «{» на позиції i (дужки в рядках і //-коментарях не рахуються) */
function objAt(src, i) {
  for (let j = i, depth = 0; j < src.length; j++) {
    const c = src[j]
    if (c === "'" || c === '"' || c === '`') { for (j++; j < src.length && src[j] !== c; j++) if (src[j] === '\\') j++; continue }
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j < 0) break; continue }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return src.slice(i, j + 1)
  }
  return ''
}
/** об'єкти-описи, підписи з яких показують через t(): шукаємо «{» після виклику — і з нього лише ці властивості */
const OBJECTS = [
  [/<FieldShell\s+f=\{(?=\{)/g, ['label', 'help']], // <FieldShell f={{ key, label: '…', help: '…' }}>
  [new RegExp(String.raw`\bcron\.register\(\s*` + STR + String.raw`\s*,\s*(?=\{)`, 'g'), ['name', 'description']], // фонові задачі
]
/** файли-описи панелі: тут кожне українське label/help/… — підпис (дії, зв'язки, повідомлення дій, каталог дозволів) */
const DESCRIBED = { 'server/admin/resources.mjs': true, 'server/routes/admin.mjs': true }
const DESCRIBED_PROPS = PROP(['label', 'one', 'group', 'about', 'help', 'confirm', 'message', 'title', 'description', 'removeNote'])

const files = [...walk(path.join(root, 'src'), ['.ts', '.tsx', '.js']), ...walk(path.join(root, 'server'), ['.mjs'])]
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const rel = path.relative(root, f).split(path.sep).join('/')
  const at = (i) => `${rel}:${src.slice(0, i).split('\n').length}`
  const take = (m, base = 0) => { if (!(m[1] === '`' && m[2].includes('${'))) add(unq(m[2], m[1]), at(base + m.index)) } // з підстановкою — не ключ
  for (const re of PATTERNS) for (const m of src.matchAll(re)) take(m)
  for (const [re, names] of OBJECTS) {
    for (const m of src.matchAll(re)) {
      if (inComment(src, m.index)) continue
      const start = m.index + m[0].length
      for (const p of objAt(src, start).matchAll(PROP(names))) take(p, start)
    }
  }
  if (DESCRIBED[rel]) for (const m of src.matchAll(DESCRIBED_PROPS)) if (!inComment(src, m.index)) take(m)
}

// підписи панелі керування — з самих описів розділів (заглушки замість сховищ)
{
  const { buildResources, SETTING_L } = await import(path.join(root, 'server/admin/resources.mjs'))
  for (const v of Object.values(SETTING_L)) add(v, 'server/admin/resources.mjs#settings')
  const stub = new Proxy({}, { get: () => stub })
  const list = buildResources(new Proxy({}, { get: () => stub }))
  const s = (v, w) => typeof v === 'string' && add(v, w)
  const field = (f, w) => { s(f.label, w); s(f.help, w); for (const o of f.options || []) s(o.label, w) }
  for (const r of list) {
    const w = `server/admin/resources.mjs#${r.name}`
    for (const k of ['label', 'one', 'group', 'about', 'removeNote']) s(r[k], w)
    for (const q of r.quick || []) s(q.label, w)
    for (const f of r.fields) field(f, w)
    for (const a of r.actions || []) { s(a.label, w); s(a.confirm, w); for (const f of a.fields || []) field(f, w) }
    for (const x of r.relations || []) s(x.label, w)
  }
  // журнал дій та історія змін: підписи дій і результатів (маршрути й ключі дій — англійською, їх відсіє add)
  const { AUDIT_OPTIONS, REVISION_ACTIONS, STATUS_OPTIONS } = await import(path.join(root, 'server/admin/describe.mjs'))
  for (const o of [...AUDIT_OPTIONS, ...STATUS_OPTIONS]) s(o.label, 'server/admin/describe.mjs')
  for (const v of Object.values(REVISION_ACTIONS)) s(v, 'server/admin/describe.mjs')
  const { SITE_SETTINGS } = await import(path.join(root, 'server/routes/admin.mjs'))
  for (const v of Object.values(SITE_SETTINGS)) { s(v.label, 'server/routes/admin.mjs#settings'); s(v.help, 'server/routes/admin.mjs#settings') }
}

const sorted = Object.fromEntries([...keys.entries()].sort(([a], [b]) => a.localeCompare(b, 'uk')))
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'keys.json'), JSON.stringify(sorted, null, 1) + '\n')
console.log(`[i18n] текстів: ${keys.size}`)

const prune = process.argv.includes('--prune')
for (const f of fs.readdirSync(out).filter((x) => x.endsWith('.json') && x !== 'keys.json')) {
  const p = path.join(out, f)
  const d = JSON.parse(fs.readFileSync(p, 'utf8'))
  const missing = [...keys.keys()].filter((k) => !d[k])
  const stale = Object.keys(d).filter((k) => !keys.has(k))
  if (prune && stale.length) {
    for (const k of stale) delete d[k]
    fs.writeFileSync(p, JSON.stringify(Object.fromEntries(Object.entries(d).sort(([a], [b]) => a.localeCompare(b, 'uk'))), null, 1) + '\n')
  }
  console.log(`  ${f.padEnd(12)} без перекладу: ${String(missing.length).padStart(5)}${stale.length ? `, зайвих: ${stale.length}${prune ? ' (прибрано)' : ''}` : ''}`)
}

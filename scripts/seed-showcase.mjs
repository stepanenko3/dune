/*
 * Показові публічні бази — кожна зі своєю ідеєю (scripts/showcase/*.mjs). На 6 ділянок: караван-сарай з критою
 * вулицею наскрізь, зикурат із парадними сходами, авіабаза з ангарами вертикального зльоту, спайсовий комбінат каскадом,
 * гексагональна цитадель, січ з амфітеатром вітропасток, гільдійське містечко з будиночком для кожного, шпиль з ангаром
 * на вершині; на одну — стартова «Перша оселя». Бази будує конструктор scripts/showcase/lib.mjs з деталей гри; перед викладанням кожна
 * проходить перевірки: деталі не перетинаються, стабільність кожної ≥ 20 %, усе в межах ділянок, уся техніка — під
 * дахом і за стінами, станції не врізаються в стіни, двері й сходи ведуть на підлогу (scripts/showcase/verify.mjs).
 * Хоч одна проблема — нічого не викладаємо.
 *
 * Викладає через звичайне API сайту від імені першого адміністратора (як seed-demo): власник — сайт, видимість —
 * «Публічне». База з такою назвою вже є — пропускає.
 *
 *   node scripts/seed-showcase.mjs                         — сервер розробки (127.0.0.1:5181), .env проєкту
 *   ENV_FILE=… node scripts/seed-showcase.mjs --api http://127.0.0.1:5291 — інша база й сервер
 *   … --check                                              — лише зібрати й перевірити, нічого не викладати
 *   … --out <тека>                                         — ще й записати документи баз у файли (для імпорту вручну)
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { check, makeDoc } from './showcase/lib.mjs'
import { verify } from './showcase/verify.mjs'
import { caravanserai } from './showcase/caravanserai.mjs'
import { ziggurat } from './showcase/ziggurat.mjs'
import { airbase } from './showcase/airbase.mjs'
import { combine } from './showcase/combine.mjs'
import { hexcitadel } from './showcase/hexcitadel.mjs'
import { sietch } from './showcase/sietch.mjs'
import { town } from './showcase/town.mjs'
import { spire } from './showcase/spire.mjs'
import { starter } from './showcase/starter.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const CHECK = process.argv.includes('--check')
const OUT = arg('--out')

// ---------- зібрати й перевірити ----------
const docs = []
let bad = 0
for (const make of [caravanserai, ziggurat, airbase, combine, hexcitadel, sietch, town, spire, starter]) {
  const b = make()
  const r = check(b.pieces, b.items, b.claims)
  const issues = [
    ...r.clashes.map(([p, q]) => `перетин: ${p.shape} (${p.x}, ${p.y}, +${p.z}) і ${q.shape}`),
    ...r.weak.map((p) => `стабільність ${r.st.get(p.id)} %: ${p.shape} (${p.x}, ${p.y}, +${p.z})`),
    ...r.outside.map((p) => `поза ділянками: ${p.shape} (${p.x}, ${p.y})`),
    ...r.itemsOut.map((it) => `станція поза ділянками: ${it.name}`),
    ...verify(b.pieces, b.items),
  ]
  if (b.claims.length > 6) issues.push(`ділянок ${b.claims.length}, а можна до 6`)
  const doc = makeDoc(b)
  console.log(`[showcase] «${doc.ui.name}»: ${b.pieces.length} деталей, ${b.items.length} станцій, ${b.zones.length} приміщень, мін. стабільність ${r.min} %${issues.length ? ` — ПРОБЛЕМ: ${issues.length}` : ''}`)
  for (const x of issues.slice(0, 20)) console.log('   ' + x)
  bad += issues.length
  docs.push(doc)
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `${make.name}.json`), JSON.stringify(doc)) }
}
if (bad) { console.log(`[showcase] проблем: ${bad} — нічого не викладаю`); process.exit(1) }
if (CHECK) process.exit(0)

// ---------- викласти ----------
Object.assign(process.env, parseEnv(fs.readFileSync(process.env.ENV_FILE || path.join(root, '.env'), 'utf8')))
const API = (arg('--api') || `http://127.0.0.1:${process.env.API_PORT || 5181}`).replace(/\/+$/, '')
const { openDb } = await import('../server/lib/sql.mjs')
const { createAuth } = await import('../server/lib/auth.mjs')
const db = await openDb({ dataDir: path.join(root, 'server', 'data') })
const auth = await createAuth(db)
const admin = await db.get("SELECT id, login FROM users WHERE role = 'admin' ORDER BY created LIMIT 1")
if (!admin) throw new Error('немає адміністратора — спершу хтось має зареєструватися')
const token = await auth.openSession(admin.id, { agent: 'seed-showcase' })
console.log(`[showcase] ${API} (база ${process.env.DB_DATABASE || 'SQLite'}) від імені ${admin.login}`)

async function call(method, url, body) {
  const r = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', cookie: `sw_session=${token}; sw_lang=uk` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* не JSON */ }
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status}: ${json?.error || text.slice(0, 200)}`)
  return json
}

try {
  for (const doc of docs) {
    const have = await call('GET', `/api/admin/r/bases?search=${encodeURIComponent(doc.ui.name)}&size=5`)
    if (have.rows.some((r) => r.title === doc.ui.name)) { console.log(`[showcase] «${doc.ui.name}» уже є — пропускаю`); continue }
    const r = await call('POST', '/api/bases/import', { doc, owner: { kind: 'site', id: 'site' }, visibility: 'public' })
    if (r.warnings?.length) console.log(`[showcase] «${doc.ui.name}»: ${r.warnings.map((w) => w.message).join('; ')}`)
    console.log(`[showcase] «${doc.ui.name}» → /bases/${r.id}`)
  }
} finally {
  await auth.closeSession(token)
  await db.close()
}

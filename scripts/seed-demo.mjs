/*
 * Публічний вміст для бібліотеки: кілька баз, білдів, роадмапів, позначок на мапі й записів ресурсів — щоб новачок
 * бачив, як це виглядає, ще до того, як щось викладе гільдія. Усе — від імені першого адміністратора, власник —
 * його основна гільдія, видимість «Публічне»; створюється через звичайне API сайту (перевірки, історія змін, журнал —
 * як у людини), а не записами в базу напряму.
 *
 *   npx vite-node scripts/seed-demo.mjs                       — сервер розробки (127.0.0.1:5181), .env проєкту
 *   ENV_FILE=… npx vite-node scripts/seed-demo.mjs -- --api http://127.0.0.1:5191 — інша база й сервер
 *   … -- --force                                             — ще раз, навіть якщо вже засіяно
 *   … -- --only builds                                       — лише один розділ (builds, roadmaps, markers, places),
 *                                                              навіть якщо засіяно
 *
 * Бази тут більше не створюються — показові публічні бази викладає scripts/seed-showcase.mjs.
 *
 * vite-node — бо коди білдів рахує той самий src/lib/skills.ts, що й планувальник. Скрипт нікого не реєструє: бере
 * наявного адміністратора, відкриває йому сеанс на час роботи й закриває після. Повторний запуск без --force нічого
 * не робить (позначка в settings: demo-seed).
 */
import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { branches, encodeShort, mergeTwins, open, rankCost, slotOf, SCHOOLS } from '../src/lib/skills.ts'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
Object.assign(process.env, parseEnv(fs.readFileSync(process.env.ENV_FILE || path.join(root, '.env'), 'utf8')))
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const API = (arg('--api') || `http://127.0.0.1:${process.env.API_PORT || 5181}`).replace(/\/+$/, '')
const FORCE = process.argv.includes('--force')
const ONLY = arg('--only')
const want = (kind) => !ONLY || ONLY.split(',').includes(kind)

const { openDb } = await import('../server/lib/sql.mjs')
const { createAuth } = await import('../server/lib/auth.mjs')
const db = await openDb({ dataDir: path.join(root, 'server', 'data') })
const auth = await createAuth(db)

const done = await db.get("SELECT v FROM settings WHERE k = 'demo-seed'")
if (done && !FORCE && !ONLY) {
  console.log(`[seed] уже засіяно (${JSON.parse(done.v).at}) — нічого не роблю; ще раз: -- --force`)
  await db.close()
  process.exit(0)
}
const admin = await db.get("SELECT id, login, main_guild FROM users WHERE role = 'admin' ORDER BY created LIMIT 1")
if (!admin) throw new Error('немає адміністратора — спершу хтось має зареєструватися')
const guild = admin.main_guild || (await db.get('SELECT guild_id FROM members WHERE user_id = ? LIMIT 1', admin.id))?.guild_id
// власник — сам сайт: офіційний вміст не з'являється в чиємусь списку («Мої», гільдія), лише в бібліотеці
const owner = { kind: 'site', id: 'site' }
const token = await auth.openSession(admin.id, { agent: 'seed-demo' })
console.log(`[seed] ${API} від імені ${admin.login}, власник: ${owner.kind} ${owner.id}`)

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
// ======================================================================================================================

/** білд жадібно: гілки за порядком, ранг за рангом, поки вистачає очок; слоти — перші взяті здібності й прийоми */
function makeBuild(skills, prefer, budget) {
  const branchOf = branches(skills)
  const build = {}
  let points = 0
  const rank = (s) => build[s.id] ?? 0
  for (;;) {
    const cands = skills
      .filter((s) => prefer.includes(branchOf.get(s.id)) && rank(s) < s.max && open(s, build, branchOf, skills))
      .sort((a, b) => prefer.indexOf(branchOf.get(a.id)) - prefer.indexOf(branchOf.get(b.id)) || a.y - b.y || a.x - b.x)
    const s = cands.find((x) => points + (x.levels[rank(x)]?.cost ?? 1) <= budget)
    if (!s) break
    points += s.levels[rank(s)]?.cost ?? 1
    build[s.id] = rank(s) + 1
  }
  const taken = skills.filter((s) => build[s.id] > 0).sort((a, b) => b.y - a.y)
  const eq = { a: taken.filter((s) => slotOf(s) === 'a').slice(0, 3).map((s) => s.id), t: taken.filter((s) => slotOf(s) === 't').slice(0, 3).map((s) => s.id) }
  return { build, eq, points }
}

/** «Майстер меча 120, Піхотинець 60 · 180 очок» — як підпис збереженого білду в планувальнику */
function aboutOf(skills, build, points) {
  const by = (sc) => skills.filter((s) => s.school === sc).reduce((n, s) => n + rankCost(s, build[s.id] ?? 0), 0)
  const schools = SCHOOLS.filter(([id]) => by(id) > 0).map(([id, name]) => `${name} ${by(id)}`).join(', ')
  const n10 = points % 10, n100 = points % 100
  const word = n10 === 1 && n100 !== 11 ? 'очко' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'очки' : 'очок'
  return [schools, `${points} ${word}`].filter(Boolean).join(' · ')
}

const BUILDS = [
  {
    name: 'Мечник: Клинок, Воля і Шлях',
    branches: ['blade', 'resolve', 'aggression'],
    budget: 200,
    notes: 'Ближній бій від першого дня: спершу вся гілка «Клинок», далі «Воля» — стійкість під ударами, решта — у «Шлях». Добре для PvE у печерах і на станціях.',
  },
  {
    name: 'Стрілець із гаджетами',
    branches: ['weaponry', 'gadgets', 'suspensortech'],
    budget: 200,
    notes: 'Вогнепальна зброя і тактичні гаджети, решта очок — у силову підвіску, щоб швидко міняти позицію. Тримає дистанцію й контролює поле бою.',
  },
  {
    name: 'Планетолог-збирач',
    branches: ['explorer', 'driver', 'scientist'],
    budget: 200,
    notes: 'Для того, хто возить ресурси й техніку: дослідження мапи, механіка й наука. Корисно в Глибокій пустелі, коли треба швидко зібрати й вивезти.',
  },
  {
    name: 'Ментат-тактик',
    branches: ['mentalcalculus', 'tactician', 'assassination'],
    budget: 200,
    notes: 'Точний розрахунок і тактика, решта — в тихе усунення. Гра від позиції й першого пострілу.',
  },
  {
    name: 'Перші 60 очок: Голос',
    branches: ['manipulation', 'selfcontrol'],
    budget: 60,
    notes: 'Невеликий старт для Бене Ґессерит: Голос і керування тілом — куди вкласти перші очки, поки решта дерева ще закрита.',
  },
]

const ROADMAPS = [
  {
    title: 'Шлях новачка: від першої ділянки до грузового',
    lead: 'Порядок, у якому зручно розвивати базу й техніку на старті — від води й першого фабрикатора до орнітоптера, на якому вже можна возити руду.',
    facts: ['**5** етапів', 'Басейн Хагга', 'без Глибокої пустелі'],
    sidebarTitle: 'Що знадобиться',
    sidebar: [
      { id: 'need-water', title: 'Вода', body: '- Вітропастка на даху\n- Цистерна біля фабрикаторів' },
      { id: 'need-power', title: 'Енергія', body: '- Генератор на паливних елементах\n- Далі — вітряки' },
    ],
    note: 'Етапи — орієнтир, а не правило: якщо гільдія вже має щось із техніки, відповідний етап можна пропустити.',
    stages: [
      { id: 'water', title: 'Ділянка, вода й перший фабрикатор', status: 'done', badge: 'старт', why: 'Без води й місця для виготовлення далі не рушиш: вітропастка, цистерна, фабрикатор виживання.', table: null, tasks: [{ id: 't1', text: 'Поставити ділянку біля скель, подалі від відкритого піску', done: true }, { id: 't2', text: 'Вітропастка й цистерна', done: true }, { id: 't3', text: 'Фабрикатор виживання й верстак', done: true }], meta: '' },
      { id: 'refine', title: 'Переробка руди', status: 'done', badge: '', why: 'Злитки потрібні майже для всього: броні, зброї, техніки й наступних будівель.', table: null, tasks: [{ id: 't4', text: 'Переробник руди', done: true }, { id: 't5', text: 'Генератор і запас паливних елементів', done: true }], meta: '' },
      { id: 'bike', title: 'Піскоцикл', status: 'doing', badge: '', why: 'Перша техніка: швидше до руди й назад до бази.', table: null, tasks: [{ id: 't6', text: 'Фабрикатор техніки', done: true }, { id: 't7', text: 'Зібрати піскоцикл', done: false }], meta: '' },
      { id: 'buggy', title: 'Багі', status: 'todo', badge: '', why: 'Більший багажник і місце для другого гравця — збирати разом вигідніше.', table: null, tasks: [{ id: 't8', text: 'Деталі багі', done: false }, { id: 't9', text: 'Гараж біля бази', done: false }], meta: '' },
      { id: 'thopter', title: 'Скаут-орнітоптер', status: 'todo', badge: '', why: 'Політ знімає більшість проблем із черв\'яками й відстанями: розвідка, швидкі рейси, порятунок.', table: null, tasks: [{ id: 't10', text: 'Деталі скаута', done: false }, { id: 't11', text: 'Майданчик на базі', done: false }], meta: '' },
    ],
    sections: [],
  },
  {
    title: 'Тиждень у Глибокій пустелі',
    lead: 'Як розкласти тиждень між бурями: розвідка, збір спайсу краулером і вивезення до бази, поки буря Коріоліса не перемішала пустелю.',
    facts: ['**4** кроки', 'до бурі', 'грузовий + краулер'],
    sidebarTitle: 'Перед виходом',
    sidebar: [
      { id: 'before', title: 'Перевірити', body: '- Паливо для техніки\n- Ремонтні набори\n- Місце на складі бази' },
    ],
    note: 'Після бурі мапа Глибокої пустелі інша: старі позначки місць перевіряй заново.',
    stages: [
      { id: 'scout', title: 'Розвідка полів спайсу', status: 'done', badge: 'день 1', why: 'Скаут облітає сектори й позначає поля — команда не їде навмання.', table: null, tasks: [{ id: 'd1', text: 'Позначити поля на мапі сайту', done: true }], meta: '' },
      { id: 'crawler', title: 'Краулер на полі', status: 'doing', badge: 'дні 2–5', why: 'Грузовий опускає краулер на велике поле; поки він збирає, решта охороняє.', table: { head: ['Роль', 'Скільки'], rows: [{ cells: ['Пілот грузового', '1'] }, { cells: ['Охорона', '2–3'] }] }, tasks: [], meta: '' },
      { id: 'haul', title: 'Вивезення на базу', status: 'todo', badge: 'дні 5–6', why: 'Спайс-пісок везуть контейнером грузового на переробку.', table: null, tasks: [{ id: 'd2', text: 'Розвантажити контейнер', done: false }], meta: '' },
      { id: 'storm', title: 'До бурі — техніку додому', status: 'todo', badge: 'день 7', why: 'Буря Коріоліса забирає все, що лишилось у пустелі: вивезти техніку заздалегідь.', table: null, tasks: [{ id: 'd3', text: 'Повернути краулер і грузовий', done: false }], meta: '' },
    ],
    sections: [],
  },
]

const MARKERS = [
  { map: 'survival_1', x: -311247, y: -124348, kind: 'resource', title: 'Вартове місто: промислові помпи', note: 'Контейнер у хатині на північному краю; ще скрині в замкненій кімнаті нагорі. Машину лиши біля входу.' },
  { map: 'survival_1', x: 52147, y: -315699, kind: 'danger', title: 'Край Ахерону', note: 'Багато ворогів — іти групою.' },
  { map: 'survival_1', x: -149227, y: 158940, kind: 'meet', title: 'Збір біля Руки Хідра', note: 'Звідси зручно рушати на схід.' },
  { map: 'survival_1', x: 139228, y: -225757, kind: 'note', title: '«Дельфіс», ніс корабля', note: 'Дві частини уламка далеко одна від одної: ніс тут, корма — західніше.' },
]

const PLACES = [
  {
    zone: 'hagga', res: 'Рослинне волокно (Plant Fiber)', place: 'Кущі по всьому басейну', area: 'Басейн Хагга',
    how: 'Росте всюди, де є твердий ґрунт. Потрібне для броні й бинтів — збирай дорогою, воно знадобиться весь час.',
    loot: '', pins: [], types: [{ map: 'survival_1', type: 'fiber_plant' }],
  },
  {
    zone: 'hagga', res: 'Борошняний пісок (Flour Sand)', place: 'Поклади борошняного піску', area: 'Переважно западина Вермілія',
    how: 'Збирають вручну або статичним компактором. У хімічному переробнику з нього — кремнієві блоки.',
    loot: '', pins: [], types: [{ map: 'survival_1', type: 'flour_sand_field' }],
  },
  {
    zone: 'hagga', res: 'Насіння агави (Agave Seeds)', place: 'Кущі агави', area: 'Басейн Хагга',
    how: 'Рідкісні кущі — на мапі всі відомі місця. Плоди агави дають насіння.',
    loot: '', pins: [], types: [{ map: 'survival_1', type: 'agave_seeds' }],
  },
]

// ---------- запуск (після оголошень вище: білди, роадмапи й решта — const) ----------
const pub = { owner, visibility: 'public' }
const made = { bases: [], builds: [], roadmaps: [], markers: [], places: [] }

try {
  // бази — окремо: scripts/seed-showcase.mjs (показові бази з перевірками)

  // ---------- білди: коди — тим самим кодуванням, що й у планувальнику ----------
  const skills = want('builds') ? mergeTwins((await call('GET', '/api/skills')).skills) : []
  if (want('builds')) for (const b of BUILDS) {
    const { build, eq, points } = makeBuild(skills, b.branches, b.budget)
    const code = encodeShort(skills, build, eq)
    const r = await call('POST', '/api/builds', { name: b.name, code, notes: b.notes, about: aboutOf(skills, build, points), ...pub })
    made.builds.push(r.id)
  }

  // ---------- роадмапи ----------
  if (want('roadmaps')) for (const doc of ROADMAPS) {
    const r = await call('POST', '/api/roadmaps', { title: doc.title, ...pub })
    await call('PUT', `/api/roadmaps/${r.id}`, { doc, version: r.version })
    made.roadmaps.push(r.id)
  }

  // ---------- позначки на мапі ----------
  if (want('markers')) for (const m of MARKERS) made.markers.push((await call('POST', '/api/markers', { ...m, ...pub })).id)

  // ---------- записи ресурсів: точки — з даних мапи (types), тож місця завжди справжні ----------
  if (want('places')) for (const p of PLACES) made.places.push((await call('POST', '/api/places', { ...p, ...pub })).id)

  // позначка: що створено (з --only — дописуємо до попереднього)
  const prev = done ? JSON.parse(done.v) : {}
  const all = Object.fromEntries(Object.keys(made).map((k) => [k, [...(ONLY ? prev[k] || [] : []), ...made[k]]]))
  await db.run("DELETE FROM settings WHERE k = 'demo-seed'")
  await db.run("INSERT INTO settings (k, v) VALUES ('demo-seed', ?)", JSON.stringify({ at: new Date().toISOString(), ...all }))
  console.log('[seed] готово:', Object.entries(made).map(([k, v]) => `${k} ${v.length}`).join(', '))
} finally {
  await auth.closeSession(token)
  await db.close()
}

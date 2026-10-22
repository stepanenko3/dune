/*
 * Планувальник фонових задач (як cron): оновлення мапи з TH.GL, збір довідника й умінь, знімки баз, прибирання
 * сеансів і кодів. Розклад — cron-рядок «хв год день міс день-тижня» (зірочка, крок «/n», діапазон a-b, перелік a,b), його можна змінити в панелі
 * керування, як і вимкнути задачу чи запустити зараз. Кожен запуск — рядок cron_runs: початок, тривалість, стан,
 * журнал (усе, що задача написала через log). Одна задача не запускається вдруге, поки йде попередній запуск.
 * Час — місцевий час сервера (cronTimeZone). Запуск, який обірвав перезапуск сервера, на старті стає помилкою.
 */
import { fail } from './util.mjs'

/** «*\/5 * * * *» → перевірка, чи підходить дата; кидає помилку на хибному рядку */
export function parseCron(expr) {
  const parts = String(expr || '').trim().split(/\s+/)
  if (parts.length !== 5) throw fail('розклад — п’ять полів: хвилина година день місяць день-тижня')
  const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]]
  const sets = parts.map((p, i) => {
    const [lo, hi] = RANGES[i]
    const out = new Set()
    for (const item of p.split(',')) {
      const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item)
      if (!m) throw fail('незрозумілий розклад: {part}', 400, { part: item })
      let [a, b] = m[1] === '*' ? [lo, hi] : m[1].split('-').map(Number)
      if (b === undefined) b = m[2] ? hi : a
      const step = Number(m[2] || 1)
      if (a < lo || b > hi || a > b || step < 1) throw fail('незрозумілий розклад: {part}', 400, { part: item })
      for (let v = a; v <= b; v += step) out.add(i === 4 && v === 7 ? 0 : v)
    }
    return out
  })
  const [min, hour, dom, mon, dow] = sets
  const anyDom = parts[2] === '*', anyDow = parts[4] === '*'
  const day = (d) => {
    if (!mon.has(d.getMonth() + 1)) return false
    // як у cron: якщо задано і день місяця, і день тижня — досить одного
    const a = dom.has(d.getDate()), b = dow.has(d.getDay())
    return anyDom && anyDow ? true : anyDom ? b : anyDow ? a : a || b
  }
  // .day / .hour — щоб nextRun перескакував цілі дні й години, а не перебирав їх по хвилині
  return Object.assign((d) => min.has(d.getMinutes()) && hour.has(d.getHours()) && day(d), { day, hour: (d) => hour.has(d.getHours()) })
}

/** наступний час запуску після from: днями, годинами, хвилинами — до п’яти років уперед (29 лютого буває раз на чотири роки);
 *  null — розклад не спрацює ніколи (31 лютого) */
export function nextRun(expr, from = Date.now()) {
  const match = parseCron(expr)
  const d = new Date(from)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const end = from + 5 * 366 * 864e5
  for (let i = 0; i < 1e6 && d.getTime() <= end; i++) {
    if (!match.day(d)) d.setHours(24, 0, 0, 0)
    else if (!match.hour(d)) d.setHours(d.getHours() + 1, 0, 0, 0)
    else if (match(d)) return d.getTime()
    else d.setMinutes(d.getMinutes() + 1)
  }
  return null
}

/** розклад, який справді колись спрацює → час наступного запуску; інакше — помилка, як на хибному рядку */
export function checkCron(expr) {
  const at = nextRun(expr)
  if (at === null) throw fail('цей розклад ніколи не спрацює — перевір день і місяць')
  return at
}

/** часовий пояс сервера — у ньому рахується розклад (для підказки в панелі) */
export function cronTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export async function createCron(db, { log = console } = {}) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      key TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', schedule TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      last_run BIGINT, last_status TEXT, last_ms INTEGER, last_error TEXT, next_run BIGINT, runs INTEGER NOT NULL DEFAULT 0, fails INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS cron_runs (
      id {{SERIAL}}, job TEXT NOT NULL, started BIGINT NOT NULL, finished BIGINT, status TEXT NOT NULL DEFAULT 'running', ms INTEGER,
      trigger TEXT NOT NULL DEFAULT 'schedule', log TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS cron_runs_by_job ON cron_runs (job, id);
  `)
  const jobs = new Map() // key → { run(log) }
  const running = new Set()
  let timer = null
  const stamp = () => new Date().toISOString().slice(11, 19)

  // запуски, які обірвав перезапуск сервера (оновлення, падіння), лишились «Виконується» — тепер це помилка з поясненням;
  // у задачі — теж: останній запуск невдалий. Тривалість лишаємо порожньою — коли саме зупинився процес, невідомо
  const cut = 'Перервано: сервер перезапустився'
  for (const r of await db.all("SELECT id, job, started, log FROM cron_runs WHERE status = 'running'")) {
    await db.run("UPDATE cron_runs SET status = 'error', log = ? WHERE id = ?", `${r.log ? r.log + '\n' : ''}${stamp()} ⚠ ${cut}`, r.id)
    await db.run('UPDATE cron_jobs SET runs = runs + 1, fails = fails + 1 WHERE key = ?', r.job)
    await db.run(`UPDATE cron_jobs SET last_run = ?, last_status = 'error', last_ms = NULL, last_error = ? WHERE key = ? AND (last_run IS NULL OR last_run <= ?)`,
      r.started, cut, r.job, r.started)
  }

  /** зареєструвати задачу (розклад із бази важливіший — його могли змінити в панелі; якщо він не спрацює ніколи — типовий) */
  async function register(key, { name, description = '', schedule, run }) {
    checkCron(schedule) // типовий розклад із коду мусить бути робочим
    jobs.set(key, { run })
    const cur = await db.get('SELECT schedule, enabled FROM cron_jobs WHERE key = ?', key)
    let sched = cur?.schedule || schedule
    if (sched !== schedule) try { checkCron(sched) } catch (e) { log.warn?.(`[cron] ${key}: розклад «${sched}» — ${e.message}; повертаю «${schedule}»`); sched = schedule }
    await db.run(`INSERT INTO cron_jobs (key, name, description, schedule, next_run) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET name = excluded.name, description = excluded.description, schedule = excluded.schedule, next_run = excluded.next_run`,
    key, name, description, sched, nextRun(sched))
  }

  async function execute(key, trigger = 'schedule') {
    const job = jobs.get(key)
    if (!job) throw fail('немає такої задачі', 404)
    if (running.has(key)) throw fail('задача вже виконується')
    running.add(key) // ще до першого await — другий запуск одразу бачить, що задача йде
    const started = Date.now()
    const lines = []
    const write = (...a) => { lines.push(`${stamp()} ${a.map(String).join(' ')}`); if (lines.length > 500) lines.shift() }
    let id
    try {
      id = (await db.get('INSERT INTO cron_runs (job, started, trigger) VALUES (?, ?, ?) RETURNING id', key, started, trigger)).id
    } catch (e) { running.delete(key); throw e }
    let status = 'ok', error = null
    try {
      const out = await job.run(write)
      if (out !== undefined) write(typeof out === 'string' ? out : JSON.stringify(out))
    } catch (e) {
      status = 'error'
      error = String(e?.message || e).slice(0, 500)
      write('⚠', error)
    } finally {
      running.delete(key)
    }
    const ms = Date.now() - started
    const job0 = await db.get('SELECT schedule FROM cron_jobs WHERE key = ?', key)
    await db.run('UPDATE cron_runs SET finished = ?, status = ?, ms = ?, log = ? WHERE id = ?', Date.now(), status, ms, lines.join('\n').slice(-20000), id)
    await db.run(`UPDATE cron_jobs SET last_run = ?, last_status = ?, last_ms = ?, last_error = ?, runs = runs + 1, fails = fails + ?, next_run = ? WHERE key = ?`,
      started, status, ms, error, status === 'error' ? 1 : 0, nextRun(job0.schedule), key)
    // тримаємо 200 останніх запусків кожної задачі
    await db.run('DELETE FROM cron_runs WHERE job = ? AND id NOT IN (SELECT id FROM cron_runs WHERE job = ? ORDER BY id DESC LIMIT 200)', key, key)
    if (status === 'error') log.warn?.(`[cron] ${key}: ${error}`)
    return { status, ms, error }
  }

  /** раз на 20 с: що пора — запускаємо (без очікування, кожна задача окремо) */
  async function tick() {
    const now = Date.now()
    for (const j of await db.all('SELECT key, next_run FROM cron_jobs WHERE enabled = 1 AND next_run IS NOT NULL AND next_run <= ?', now)) {
      if (!jobs.has(j.key) || running.has(j.key)) continue
      execute(j.key).catch(() => {})
    }
  }

  /** «Запустити зараз» без очікування: збір довідника йде 10–15 хв, а відповідь панелі — одразу; стан і журнал — у «Запусках задач» */
  async function launch(key) {
    if (!jobs.has(key)) throw fail('немає такої задачі', 404)
    if (running.has(key)) return { started: false, running: true }
    execute(key, 'manual').catch((e) => log.warn?.(`[cron] ${key}: ${e.message}`))
    return { started: true }
  }

  return {
    register,
    /** запустити й дочекатися: { status, ms, error } */
    run: (key) => execute(key, 'manual'),
    running: () => [...running],
    async setSchedule(key, schedule) {
      const at = checkCron(schedule)
      await db.run('UPDATE cron_jobs SET schedule = ?, next_run = ? WHERE key = ?', schedule, at, key)
    },
    async setEnabled(key, on) {
      const j = await db.get('SELECT schedule FROM cron_jobs WHERE key = ?', key)
      await db.run('UPDATE cron_jobs SET enabled = ?, next_run = ? WHERE key = ?', on ? 1 : 0, on && j ? nextRun(j.schedule) : null, key)
    },
    /** start() — увімкнути планувальник (раз на 20 с); start(key) — запустити задачу у фоні: { started: true } одразу
     *  або { started: false, running: true }, якщо вона вже йде */
    start(key) {
      if (key !== undefined) return launch(key)
      if (!timer) { timer = setInterval(() => tick().catch(() => {}), 20_000); timer.unref?.() }
    },
    stop() { clearInterval(timer); timer = null },
    tick,
  }
}

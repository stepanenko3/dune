// Планувальник фонових задач: «Запустити зараз» без очікування (start), запуски, обірвані перезапуском сервера,
// розклад, що не спрацює ніколи (31 лютого), окремий запис журналу кожному запуску (INSERT … RETURNING id).
// node --test server/cron.test.mjs; той самий файл іде й у vitest (npm test) — тому раннер вибираємо за оточенням.
// Обв'язка — як в admin.test.mjs: SQLite у тимчасовій теці і Postgres <DB_DATABASE>_testing у власній схемі.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkCron, createCron, cronTimeZone, nextRun } from './lib/cron.mjs'
import { openDb } from './lib/sql.mjs'

const T = process.env.VITEST ? await import('vitest') : await import('node:test')
const { describe, it } = T
const before = T.beforeAll || T.before, after = T.afterAll || T.after

const quiet = { info() {}, warn() {}, error() {} }
const at = (s) => new Date(s).getTime()
/** чекаємо, доки умова справдиться (фоновий запуск), — до 5 с */
async function until(fn) {
  for (const end = Date.now() + 5000; Date.now() < end; await new Promise((r) => setTimeout(r, 10))) if (await fn()) return
  throw new Error('не дочекались')
}
/** задача, яка чекає, доки її відпустять */
function gated(out = 'готово') {
  let open
  const gate = new Promise((r) => { open = r })
  return { open: () => open(), run: async (say) => { say('почали'); await gate; return out } }
}

describe('розклад, що не спрацює ніколи', () => {
  it('31 лютого — null і зрозуміла помилка; 29 лютого — за кілька років, але спрацює', () => {
    assert.equal(nextRun('0 0 31 2 *'), null)
    assert.throws(() => checkCron('0 0 31 2 *'), (e) => e.status === 400 && /ніколи не спрацює/.test(e.message))
    // від 19.10.2026 найближче 29 лютого — у 2028-му (більше ніж рік уперед)
    assert.equal(nextRun('0 0 29 2 *', at('2026-10-19T12:00:00')), at('2028-02-29T00:00:00'))
    assert.equal(nextRun('*/5 * * * *', at('2026-10-19T12:03:20')), at('2026-10-19T12:05:00'))
  })
  it('часовий пояс сервера', () => {
    assert.equal(cronTimeZone(), Intl.DateTimeFormat().resolvedOptions().timeZone)
    assert.ok(cronTimeZone())
  })
})

const SCHEMA = `cron_${process.pid}_${Date.now().toString(36)}`
let pg = null
try {
  const env = Object.fromEntries(fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  if (env.DB_HOST && env.DB_CONNECTION !== 'sqlite') {
    pg = { host: env.DB_HOST, port: Number(env.DB_PORT) || 5432, database: `${env.DB_DATABASE || 'dune'}_testing`, user: env.DB_USERNAME || 'postgres', password: env.DB_PASSWORD || undefined }
    const probe = await openDb({ pg }).catch(() => null)
    if (probe) {
      await probe.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`)
      await probe.close()
      pg = { ...pg, options: `-c search_path=${SCHEMA}` }
    } else pg = null
  }
} catch { pg = null }

const ENGINES = [['SQLite', null], ...(pg ? [['Postgres', pg]] : [])]

for (const [engine, pgCfg] of ENGINES) {
  describe(`планувальник (${engine})`, () => {
    let dir, db, cron
    const runsOf = (job) => db.all('SELECT * FROM cron_runs WHERE job = ? ORDER BY id', job)
    const jobOf = (key) => db.get('SELECT * FROM cron_jobs WHERE key = ?', key)

    before(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-cron-'))
      db = await openDb({ dataDir: dir, pg: pgCfg })
      cron = await createCron(db, { log: quiet })
    })
    after(async () => {
      if (db?.kind === 'pg') await db.exec(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {})
      await db?.close()
      fs.rmSync(dir, { recursive: true, force: true })
    })

    it('start(key) відповідає одразу, а запуск іде у фоні й доходить до кінця', async () => {
      const g = gated()
      await cron.register('slow', { name: 'Довга', schedule: '0 4 * * 3', run: g.run })
      const t0 = Date.now()
      assert.deepEqual(await cron.start('slow'), { started: true })
      assert.ok(Date.now() - t0 < 1000)
      assert.deepEqual(cron.running(), ['slow'])
      await until(async () => (await runsOf('slow')).length === 1)
      assert.equal((await runsOf('slow'))[0].status, 'running')
      // поки йде — другий раз не запускається; невідома задача — 404, як у run
      assert.deepEqual(await cron.start('slow'), { started: false, running: true })
      await assert.rejects(cron.start('немає'), (e) => e.status === 404)
      g.open()
      await until(async () => !cron.running().length && (await runsOf('slow'))[0].status !== 'running')
      const [r] = await runsOf('slow')
      assert.equal(r.status, 'ok')
      assert.equal(r.trigger, 'manual')
      assert.match(r.log, /почали[\s\S]*готово/)
      assert.ok(r.ms >= 0)
      assert.equal((await jobOf('slow')).last_status, 'ok')
      assert.equal((await jobOf('slow')).runs, 1)
    })

    it('одночасні запуски — кожен пише у свій рядок (і два процеси на одній базі теж)', async () => {
      const a = gated('a-кінець'), b = gated('b-кінець')
      await cron.register('a', { name: 'А', schedule: '*/5 * * * *', run: a.run })
      await cron.register('b', { name: 'Б', schedule: '*/5 * * * *', run: async (say) => { await b.run(say); throw new Error('b впала') } })
      const ra = cron.run('a'), rb = cron.run('b')
      b.open()
      assert.equal((await rb).status, 'error')
      a.open()
      assert.equal((await ra).status, 'ok')
      const [ka] = await runsOf('a'), [kb] = await runsOf('b')
      assert.equal(ka.status, 'ok')
      assert.match(ka.log, /a-кінець/)
      assert.equal(kb.status, 'error')
      assert.match(kb.log, /b впала/)
      // та сама задача з двох планувальників на одній базі: з MAX(id) обидва писали б в один рядок, а другий лишався б «running»
      const other = await createCron(db, { log: quiet })
      await other.register('a', { name: 'А', schedule: '*/5 * * * *', run: async () => 'a-другий' })
      await Promise.all([cron.run('a'), other.run('a')])
      const rows = (await runsOf('a')).slice(1)
      assert.deepEqual(rows.map((r) => r.status), ['ok', 'ok'])
      assert.deepEqual(rows.map((r) => r.log.split('\n').at(-1).slice(9)).sort(), ['a-другий', 'a-кінець'])
    })

    it('запуск, обірваний перезапуском сервера, на старті стає помилкою з поясненням', async () => {
      const g = gated()
      await cron.register('hang', { name: 'Зависла', schedule: '0 4 * * 3', run: g.run })
      await cron.start('hang')
      await until(async () => (await runsOf('hang')).length === 1)
      // «новий процес» — той самий сервер, та сама база
      const cron2 = await createCron(db, { log: quiet })
      const [r] = await runsOf('hang')
      assert.equal(r.status, 'error')
      assert.match(r.log, /Перервано: сервер перезапустився/)
      const j = await jobOf('hang')
      assert.equal(j.last_status, 'error')
      assert.equal(j.last_error, 'Перервано: сервер перезапустився')
      assert.equal(j.last_run, r.started)
      assert.equal(j.fails, 1)
      // завершені запуски не чіпає
      assert.equal((await runsOf('slow'))[0].status, 'ok')
      assert.deepEqual(cron2.running(), [])
      g.open()
      await until(() => !cron.running().length)
    })

    it('setSchedule: 31 лютого — помилка й розклад не змінено; «*/5 * * * *» — так', async () => {
      await cron.register('x', { name: 'Ікс', schedule: '15 * * * *', run: async () => {} })
      await assert.rejects(cron.setSchedule('x', '0 0 31 2 *'), (e) => e.status === 400 && /ніколи не спрацює — перевір день і місяць/.test(e.message))
      assert.equal((await jobOf('x')).schedule, '15 * * * *')
      await cron.setSchedule('x', '*/5 * * * *')
      const j = await jobOf('x')
      assert.equal(j.schedule, '*/5 * * * *')
      assert.ok(j.next_run > Date.now() && j.next_run <= Date.now() + 5 * 60_000)
      await cron.setSchedule('x', '0 0 29 2 *')
      assert.ok((await jobOf('x')).next_run > Date.now())
    })

    it('register: розклад із бази, що не спрацює ніколи, — назад до типового', async () => {
      await db.run("UPDATE cron_jobs SET schedule = '0 0 31 2 *', next_run = NULL WHERE key = 'x'")
      const warns = []
      const cron3 = await createCron(db, { log: { ...quiet, warn: (m) => warns.push(m) } })
      await cron3.register('x', { name: 'Ікс', schedule: '15 * * * *', run: async () => {} })
      const j = await jobOf('x')
      assert.equal(j.schedule, '15 * * * *')
      assert.ok(j.next_run > Date.now())
      assert.match(warns.join('\n'), /0 0 31 2 \*/)
      await assert.rejects(cron3.register('y', { name: 'Ігрек', schedule: '0 0 30 2 *', run: async () => {} }), /ніколи не спрацює/)
    })
  })
}

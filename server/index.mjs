import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// .env проєкту (база й пошта; його заповнює snotax-console env) — головніший за оточення: Snotax console підставляє
// процесу свої загальні DB_*/MAIL_* (імена контейнерів, база laravel), а сервер працює на самому Mac
// (ENV_FILE — інший файл, напр. для перевірки на тестовій базі)
try { Object.assign(process.env, parseEnv(fs.readFileSync(process.env.ENV_FILE || path.join(__dirname, '..', '.env'), 'utf8'))) } catch { /* без .env — запасна SQLite, листи в журнал */ }
const serveDist = process.argv.includes('--serve-dist')
const app = await createApp({ dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'), serveDist })
const port = Number(process.env.PORT || process.env.API_PORT) || 5181
// адреса прослуховування — локальна, доки HOST не скаже інше (напр. 0.0.0.0 у контейнері)
const host = process.env.HOST || '127.0.0.1'
// робочий сайт без цих змінних ламається тихо: листи з кодом не йдуть (код лише в журналі), посилання ведуть не туди
if (serveDist && !process.env.APP_URL) console.warn('[api] APP_URL не задано — посилання в листах вестимуть на dune.test')
if (serveDist && !process.env.MAIL_HOST) console.warn('[api] MAIL_HOST не задано — листи з кодом входу не надсилаються, код пишеться лише в журнал')
const server = app.listen(port, host, () => console.log(`[api] http://${host}:${port}${serveDist ? ' (з фронтом)' : ''}`))
// миттєві розмови (WebSocket /api/chats/ws)
app.locals.attachWs?.(server)

// зупинка під час оновлення: нових з'єднань не беремо, почате дописуємо (збереження бази не обривається), потім
// закриваємо базу; живі потоки (SSE) самі не закінчаться — через 10 с виходимо все одно
let stopping = false
const stop = (sig) => {
  if (stopping) return
  stopping = true
  console.log(`[api] ${sig}: зупиняюсь`)
  setTimeout(() => process.exit(0), 10_000).unref()
  server.close(async () => {
    try { await app.locals.close?.() } catch (e) { console.error(e) }
    process.exit(0)
  })
  server.closeIdleConnections?.()
}
process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))
// необроблена відмова в обіцянці — у журнал, а не тихе падіння всього сервера
process.on('unhandledRejection', (e) => console.error('[api] unhandledRejection', e))

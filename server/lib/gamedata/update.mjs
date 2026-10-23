/*
 * Оновлення даних до нової версії гри з панелі (/admin/gamedata): видобувач (tools/game-extractor, `gdx all`) —
 * окремим процесом, а панель лише стежить за ним: крок, відсоток завантаження, останні рядки журналу.
 *
 * Процес відв'язаний від сервера сайту (detached), журнал — файлом у робочій теці видобувача: сервер у розробці
 * перезапускається від кожної правки, а прогін іде пів години — тож стан читається з файлів (<work>/admin-update.json
 * і .log), а не з пам'яті. Після вдалого прогону з новим пакетом — одразу перевірка реєстру даних, щоб сайт узяв пакет,
 * не чекаючи планової (раз на 10 хв). Прогін один за раз: видобувач і сам тримає замок у робочій теці.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fail } from '../util.mjs'
import { readState } from '../../../tools/game-extractor/lib/state.mjs'

const GDX = path.join(import.meta.dirname, '..', '..', '..', 'tools', 'game-extractor', 'bin', 'gdx.mjs')
/** кроки, як їх бачить панель: конвеєр видобувача і наостанок — сайт бере новий пакет */
export const UPDATE_STEPS = ['check', 'fetch', 'unpack', 'usmap', 'export', 'normalize', 'bundle', 'apply']
const TAIL = 64 * 1024

const alive = (pid) => {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

/** що видно з журналу прогону: поточний крок, відсоток завантаження, підсумок, помилка, останні рядки */
export function parseLog(text) {
  const out = { step: null, pct: null, result: null, error: null, exit: null, build: null, version: null, lines: [] }
  // кольори терміналу (FORCE_COLOR у середовищі сервера) — геть
  for (const raw of text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line) continue
    let m
    if ((m = /^\[gdx:step\] (\w+)/.exec(line))) { out.step = m[1]; out.pct = null; continue }
    if ((m = /^\[gdx:exit\] (\d+)/.exec(line))) { out.exit = Number(m[1]); continue }
    out.lines.push(line.replace(/^\[gdx\] /, ''))
    if (out.step === 'fetch' && (m = /(\d{1,3}(?:[.,]\d+)?)\s*%/.exec(line))) out.pct = Math.min(100, Number(m[1].replace(',', '.')))
    if (/^\[gdx\] без змін/.test(line)) out.result = 'same'
    else if (/^\[gdx\] пакет: /.test(line)) out.result = 'updated'
    else if ((m = /^\[gdx\] помилка: (.+)$/.exec(line))) out.error = m[1]
    else if ((m = /^\[gdx\] збірка (\S+), версія (\S+)/.exec(line))) { out.build = m[1].replace(/,$/, ''); out.version = m[2] }
  }
  out.lines = out.lines.slice(-40)
  return out
}

/**
 * work — робоча тека видобувача (GD_WORK; за замовчуванням — тека над пакетами GAMEDATA_BUNDLE_DIR); registry — реєстр
 * даних (check() бере новий пакет); without work — оновлення з панелі вимкнено
 */
export function createUpdater({ work, registry = null, log = console, gdx = GDX, node = process.execPath }) {
  const jobFile = work ? path.join(work, 'admin-update.json') : null
  const logFile = work ? path.join(work, 'admin-update.log') : null
  const readJob = () => { try { return JSON.parse(fs.readFileSync(jobFile, 'utf8')) } catch { return null } }
  const writeJob = (j) => { fs.mkdirSync(work, { recursive: true }); fs.writeFileSync(jobFile, JSON.stringify(j)) }
  const readTail = () => {
    try {
      const fd = fs.openSync(logFile, 'r')
      try {
        const size = fs.fstatSync(fd).size
        const buf = Buffer.alloc(Math.min(size, TAIL))
        fs.readSync(fd, buf, 0, buf.length, size - buf.length)
        return buf.toString('utf8')
      } finally { fs.closeSync(fd) }
    } catch { return '' }
  }
  let applying = null

  /** стан для панелі: прогін (якщо був), що в Steam востаннє, які збірки вже в пакеті */
  async function status() {
    if (!work) return { enabled: false }
    const job = readJob()
    const st = readState(work)
    const known = Object.values(st.builds ?? {}).map((b) => b.sha)
    const steam = st.lastCheck ? { manifestId: st.lastCheck.manifestId, date: st.lastCheck.date, at: st.lastCheck.at ?? null, fresh: !known.includes(st.lastCheck.serverTarSha) } : null
    if (!job) return { enabled: true, job: null, steam, steps: UPDATE_STEPS }
    const p = parseLog(readTail())
    const running = alive(job.pid) && p.exit == null
    let finishedAt = job.finishedAt ?? null
    if (!running && !finishedAt) {
      finishedAt = job.stopped || (() => { try { return fs.statSync(logFile).mtimeMs } catch { return Date.now() } })()
      writeJob({ ...job, finishedAt })
    }
    // процес зник без коду виходу — його вбили (зупинка, перезапуск машини)
    const ok = !running && p.exit === 0
    // новий пакет — сайт бере його одразу (раз на прогін, і після перезапуску сервера теж)
    if (ok && job.kind === 'all' && p.result === 'updated' && !job.applied && registry && !applying) {
      applying = (async () => {
        try { await registry.check(); writeJob({ ...readJob(), applied: Date.now() }) }
        catch (e) { log.warn?.('[gamedata] новий пакет не застосувався:', e?.message || e); writeJob({ ...readJob(), applied: -1, applyError: String(e?.message || e) }) }
        finally { applying = null }
      })()
    }
    const cur = readJob() ?? job
    const step = running ? p.step : ok && job.kind === 'all' && p.result === 'updated' && !(cur.applied > 0) ? 'apply' : p.step
    return {
      enabled: true,
      steps: UPDATE_STEPS,
      steam,
      job: {
        kind: job.kind, force: !!job.force, startedAt: job.startedAt, finishedAt: running ? null : finishedAt, running,
        step, pct: running ? p.pct : null, result: p.result, ok, stopped: !!job.stopped,
        error: p.error ?? (cur.applied === -1 ? cur.applyError : null) ?? (!running && p.exit == null && !job.stopped ? 'процес видобувача зупинився, не дійшовши до кінця' : null),
        applied: cur.applied > 0 ? cur.applied : null, build: p.build, version: p.version, lines: p.lines,
      },
    }
  }

  /** почати: kind 'all' — увесь конвеєр (force — навіть тієї самої збірки), 'check' — лише що зараз у Steam */
  function start(kind, { force = false, by = null } = {}) {
    if (!work) throw fail('оновлення даних гри з панелі вимкнено: на сервері не задано робочої теки видобувача', 409)
    const job = readJob()
    // живий pid без рядка виходу в журналі — прогін ще йде (рядок виходу є — pid уже чужий)
    if (job && alive(job.pid) && parseLog(readTail()).exit == null) throw fail('оновлення вже йде', 409)
    fs.mkdirSync(work, { recursive: true })
    const fd = fs.openSync(logFile, 'w')
    let child
    try {
      child = spawn(node, [gdx, kind, '--work', work, ...(force ? ['--force'] : [])], { detached: true, stdio: ['ignore', fd, fd], env: process.env, cwd: path.dirname(gdx) })
    } finally { fs.closeSync(fd) }
    child.on('error', (e) => log.warn?.('[gamedata] видобувач не запустився:', e?.message || e))
    child.unref()
    writeJob({ pid: child.pid, kind, force: !!force, startedAt: Date.now(), by })
    return status()
  }

  /** зупинити прогін: уся група процесів (DepotDownloader, docker-клієнти) */
  function stop() {
    const job = readJob()
    if (!job || !alive(job.pid)) throw fail('оновлення зараз не йде', 409)
    try { process.kill(-job.pid, 'SIGTERM') } catch { try { process.kill(job.pid, 'SIGTERM') } catch { /* уже нема */ } }
    writeJob({ ...job, stopped: Date.now() })
    return status()
  }

  return { status, start, stop }
}

/*
 * usmap (опис полів класів гри — без нього паки не прочитати) знімаємо з живого процесу сервера: запускаємо бінарник у
 * його ж образі без мережі й бази, чекаємо «Game Engine Initialized» (уся рефлексія вже в пам'яті), заморожуємо
 * SIGSTOP (інакше за кілька секунд він падає без Postgres) і в другому контейнері в тому самому pid-просторі
 * сканер знаходить FNamePool / GUObjectArray, а jmap_dumper (з патчем UClass для Dune) пише usmap. Кеш — за збіркою.
 */
import fs from 'node:fs'
import path from 'node:path'
import { run } from './run.mjs'

export const JMAP_IMAGE = 'sandwalkers/gd-jmap:1'
const SERVER_CMD = "su dune -c './DuneSandbox/Binaries/Linux/DuneSandboxServer-Linux-Shipping DuneSandbox -log -stdout -unattended -nosteam' > /tmp/s.log 2>&1; sleep infinity"

const dockerDefault = (args, opts) => run('docker', args, opts)

/** рядок сканера find_globals.py → адреси */
export function parseGlobals(line) {
  const g = JSON.parse(line)
  if (!g.fnamePool || !g.guobjectArray || !g.imageBase) throw new Error(`сканер не дав адрес: ${line}`)
  return { fnamePool: g.fnamePool, guobjectArray: g.guobjectArray, imageBase: g.imageBase }
}

/** чекати, доки check() дасть true; час вийшов — false */
export async function waitFor(check, { timeoutMs, intervalMs = 2000 }) {
  const end = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return true
    if (Date.now() >= end) return false
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/**
 * startMs — скільки після docker run процес сервера може ще не з'явитися (під емуляцією amd64 su й запуск — секунди):
 * «упав» — лише якщо процес був і зник або так і не з'явився за цей час
 */
export async function makeUsmap({ work, build, image, serverTar, docker = dockerDefault, timeoutMs = 180_000, intervalMs = 2000, startMs = 60_000, log = () => {} }) {
  const dir = path.join(work, 'mappings')
  const out = path.join(dir, `DuneSandbox-${build}.usmap`)
  if (fs.existsSync(out)) return out

  // образ сервера — у Docker (завантажити з tar, якщо ще нема; тоді після usmap і прибрати — це 4.45 GB на збірку)
  let loaded = false
  await docker(['image', 'inspect', image]).catch(async () => { log(`docker load ${serverTar}`); await docker(['load', '-i', serverTar]); loaded = true })
  const name = `gd-usmap-${build}`
  await docker(['rm', '-f', name]).catch(() => {})
  const tmp = fs.mkdtempSync(path.join(work, 'tmp-usmap-'))
  // останні рядки журналу сервера — до помилки (контейнер потім видаляється разом із журналом)
  const tail = () => docker(['exec', name, 'tail', '-n', '40', '/tmp/s.log']).then((r) => r.out.trim(), () => '')
  try {
    await docker(['run', '-d', '--name', name, '--platform', 'linux/amd64', '--network', 'none', '--cap-add', 'SYS_PTRACE',
      '--entrypoint', 'bash', '-w', '/home/dune/server', image, '-c', SERVER_CMD])
    let dead = false, seen = false
    const started = Date.now()
    const ready = await waitFor(async () => {
      if (await docker(['exec', name, 'grep', '-q', 'Game Engine Initialized', '/tmp/s.log']).then(() => true, () => false)) return true
      // процес уже завершився (впав без бази, не запустився) — не чекати даремно до кінця таймауту; ще не з'явився — чекаємо
      const alive = await docker(['exec', name, 'pgrep', '-x', 'DuneSandboxServ']).then(() => true, () => false)
      if (alive) seen = true
      else if (seen || Date.now() - started > startMs) { dead = true; throw new Error('dead') }
      return false
    }, { timeoutMs, intervalMs }).catch((e) => { if (e.message === 'dead') return false; throw e })
    if (!ready) {
      const why = dead ? 'сервер завершився до Game Engine Initialized' : `сервер не дійшов до Game Engine Initialized за ${Math.round(timeoutMs / 1000)} с`
      throw new Error(`${why}\n${await tail()}`)
    }
    await docker(['exec', name, 'pkill', '-STOP', '-x', 'DuneSandboxServ'])
    log('сервер заморожено, знімаю usmap')
    await docker(['run', '--rm', '--platform', 'linux/amd64', '--pid', `container:${name}`, '--cap-add', 'SYS_PTRACE', '--network', 'none',
      '-v', `${tmp}:/out`, '-e', `BUILD=${build}`, JMAP_IMAGE, '/opt/dump.sh'], { timeoutMs: 30 * 60_000 })
    if (!fs.existsSync(path.join(tmp, 'dune.usmap'))) throw new Error('jmap не записав usmap')
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(path.join(tmp, 'dune.jmap.gz'), path.join(dir, `DuneSandbox-${build}.jmap.gz`))
    fs.copyFileSync(path.join(tmp, 'dune.usmap'), out + '.tmp')
    fs.renameSync(out + '.tmp', out)
    return out
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
    await docker(['rm', '-f', name]).catch(() => {})
    // образ — лише після контейнера (інакше Docker його не видалить) і лише коли usmap уже є (він кешується)
    if (loaded && fs.existsSync(out)) await docker(['rmi', image]).catch(() => {})
  }
}

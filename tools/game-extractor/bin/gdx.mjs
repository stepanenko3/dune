#!/usr/bin/env node
/*
 * Видобувач ігрових даних: npm run gdx -- <крок> [--work DIR] [--force]
 *   check     — що зараз у Steam (і чи змінився образ сервера)
 *   fetch | unpack | usmap | export | normalize | bundle — конвеєр до цього кроку (кожен крок кешується за збіркою)
 *   all       — увесь конвеєр; той самий образ і пакет уже є — «без змін»; наприкінці prune
 *   prune     — лишити 2 останні збірки
 *   compare --catalog <catalog.json> — покриття id каталогу сайту випущеними записами пакета
 * Робоча тека — --work або GD_WORK (за замовчуванням …/DuneAwakening/gamefiles).
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { check, fetchServer } from '../lib/steam.mjs'
import { unpack } from '../lib/image.mjs'
import { JMAP_IMAGE, makeUsmap } from '../lib/usmap.mjs'
import { ensureImage, exportRaw, normalizeRaw } from '../lib/raw.mjs'
import { prune, writeBundle } from '../lib/bundle.mjs'
import { readState, writeState } from '../lib/state.mjs'

export const EXTRACTOR_VERSION = '1'
/**
 * відбиток коду видобувача (normalize/ і lib/): той самий — різниця двох пакетів є патчем гри, а не нашим покращенням
 * видобувача (сайт рахує «що змінилось у патчі» на мапі лише тоді — server/lib/patches.mjs)
 */
export function extractorCode(root = path.join(import.meta.dirname, '..')) {
  const h = createHash('sha256')
  for (const d of ['normalize', 'lib']) {
    for (const f of fs.readdirSync(path.join(root, d)).filter((x) => x.endsWith('.mjs')).sort()) h.update(d + '/' + f + '\0').update(fs.readFileSync(path.join(root, d, f)))
  }
  return h.digest('hex').slice(0, 16)
}
const STEPS = ['check', 'fetch', 'unpack', 'usmap', 'export', 'normalize', 'bundle']
const DEFAULT_WORK = '/Users/stepanenko/Sites/DuneAwakening/gamefiles'

const DEPS = {
  check, fetchServer, unpack,
  makeUsmap: async (o) => { await ensureImage(JMAP_IMAGE, path.join(import.meta.dirname, '..', 'usmap'), { platform: 'linux/amd64' }); return makeUsmap(o) },
  exportRaw, normalizeRaw, writeBundle, prune,
  log: (...a) => console.log('[gdx]', ...a),
  // крок конвеєра — окремим рядком: за ним панель сайту показує, де зараз оновлення (server/lib/gamedata/update.mjs)
  step: (name) => console.log('[gdx:step]', name),
}

function args(argv) {
  const o = { cmd: argv[0], force: false, work: process.env.GD_WORK || DEFAULT_WORK, catalog: null }
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--force') o.force = true
    else if (argv[i] === '--work') o.work = argv[++i]
    else if (argv[i] === '--catalog') o.catalog = argv[++i]
  }
  return o
}

/** пакет збірки справді є: маніфест на диску, latest.json — на нього, видобувач тієї самої версії */
function bundled(work, build) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(work, 'bundles', String(build), 'manifest.json'), 'utf8'))
    const latest = JSON.parse(fs.readFileSync(path.join(work, 'bundles', 'latest.json'), 'utf8'))
    return latest.build === String(build) && m.extractor?.version === EXTRACTOR_VERSION
  } catch { return false }
}

/** уже розпакована збірка цього образу (за SHA з .done) */
function unpacked(work, sha) {
  let dirs = []
  try { dirs = fs.readdirSync(path.join(work, 'extract')).filter((x) => /^\d+$/.test(x)) } catch { return null }
  for (const x of dirs) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(work, 'extract', x, '.done'), 'utf8'))
      if (info.sha === sha && fs.existsSync(info.root)) return info
    } catch { /* не розпаковано до кінця */ }
  }
  return null
}

/** один запуск на робочу теку: замок з pid; замок мертвого процесу — забираємо */
function lock(work) {
  const f = path.join(work, 'gdx.lock')
  fs.mkdirSync(work, { recursive: true })
  for (;;) {
    try {
      fs.writeFileSync(f, String(process.pid), { flag: 'wx' })
      return () => fs.rmSync(f, { force: true })
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      const pid = Number(fs.readFileSync(f, 'utf8'))
      let alive = false
      try { process.kill(pid, 0); alive = true } catch (k) { alive = k.code === 'EPERM' }
      if (alive) throw new Error(`gdx уже працює (pid ${pid}); замок ${f}`)
      fs.rmSync(f, { force: true })
    }
  }
}

/** конвеєр до кроку until (включно) */
async function pipeline(o, d, until) {
  const state = readState(o.work)
  d.step('check')
  const r = await d.check(o.work)
  d.log(`Steam: маніфест ${r.manifestId} (${r.date}), образ ${r.serverTarSha}${state.lastCheck?.serverTarSha === r.serverTarSha ? ' — як минулого разу' : ''}`)
  const known = Object.entries(state.builds ?? {}).find(([b, v]) => v.sha === r.serverTarSha && v.bundled && bundled(o.work, b))
  const save = (extra = {}) => writeState(o.work, { ...state, ...extra, lastCheck: { ...r, at: new Date().toISOString() } })
  if (until === 'check') return save(), 0
  if (until === 'all' && known && !o.force) { d.log(`без змін: збірка ${known[0]} уже в пакеті`); save(); return 0 }

  const at = (s) => STEPS.indexOf(s) <= STEPS.indexOf(until === 'all' ? 'bundle' : until)
  const depot = path.join(o.work, 'depot')
  const tar = path.join(depot, 'images', 'battlegroup', 'server.tar')
  if (at('fetch')) { d.step('fetch'); d.log('завантажую образ сервера'); await d.fetchServer(o.work, depot, { onLine: (l) => /%|Total/.test(l) && d.log(l.trim()) }) }
  if (!at('unpack')) return save(), 0
  d.step('unpack')
  let info = unpacked(o.work, r.serverTarSha)
  if (!info) {
    const incoming = path.join(o.work, 'extract', 'sha-' + r.serverTarSha.slice(0, 12))
    info = await d.unpack(tar, incoming)
    const final = path.join(o.work, 'extract', String(info.build))
    if (fs.existsSync(incoming)) {
      fs.rmSync(final, { recursive: true, force: true })
      fs.renameSync(incoming, final)
      info = { ...info, root: info.root.replace(incoming, final), sha: r.serverTarSha }
      // .done — з SHA образу й справжнім шляхом (після перейменування), щоб наступні запуски впізнали розпаковане
      fs.writeFileSync(path.join(final, '.done'), JSON.stringify(info))
    }
  }
  d.log(`збірка ${info.build}, версія ${info.version ?? '?'}`)
  if (!at('usmap')) return save(), 0
  d.step('usmap')
  const usmap = await d.makeUsmap({ work: o.work, build: info.build, image: info.tag, serverTar: tar, log: d.log })
  if (!at('export')) return save(), 0
  d.step('export')
  await d.exportRaw({ work: o.work, build: info.build, root: info.root, usmap })
  if (!at('normalize')) return save(), 0
  d.step('normalize')
  const sections = d.normalizeRaw({ work: o.work, build: info.build })
  for (const [k, v] of Object.entries(sections)) if (v instanceof Error) d.log(`розділ ${k}: ${v.message}`)
  if (!at('bundle')) return save(), 0
  d.step('bundle')
  const dir = await d.writeBundle({ work: o.work, build: info.build, version: info.version, manifestId: r.manifestId, sections, extractor: { version: EXTRACTOR_VERSION, code: extractorCode() } })
  d.log(`пакет: ${dir}`)
  save({ builds: { ...(state.builds ?? {}), [info.build]: { sha: r.serverTarSha, bundled: Date.now() } } })
  if (until === 'all') { try { d.prune(o.work, 2) } catch (e) { d.log(`prune не вдався: ${e?.message || e}`) } }
  return 0
}

/** покриття id каталогу сайту випущеними записами останнього пакета */
function compare(o, d) {
  const latest = JSON.parse(fs.readFileSync(path.join(o.work, 'bundles', 'latest.json'), 'utf8'))
  const cat = JSON.parse(fs.readFileSync(o.catalog, 'utf8'))
  for (const k of ['items', 'placeables', 'recipes']) {
    const f = path.join(latest.dir, 'sections', k + '.json.gz')
    if (!fs.existsSync(f)) { d.log(`${k}: розділу нема в пакеті`); continue }
    const have = new Set(JSON.parse(zlib.gunzipSync(fs.readFileSync(f))).records.filter((r) => r.released).map((r) => r.id))
    const missing = cat[k].map((x) => x.id).filter((id) => !have.has(id))
    d.log(`${k}: ${cat[k].length - missing.length}/${cat[k].length} (${(100 * (1 - missing.length / cat[k].length)).toFixed(1)} %)${missing.length ? ' — бракує: ' + missing.slice(0, 30).join(', ') : ''}`)
  }
  return 0
}

export async function main(argv, deps = DEPS) {
  const o = args(argv)
  const d = { ...DEPS, ...deps }
  if (o.cmd === 'compare') { try { return compare(o, d) } catch (e) { d.log('помилка:', e?.message || e); return 1 } }
  if (o.cmd !== 'prune' && o.cmd !== 'all' && !STEPS.includes(o.cmd)) {
    d.log(`невідомий крок: ${o.cmd ?? '(нема)'}; кроки: ${[...STEPS, 'all', 'prune', 'compare'].join(', ')}`)
    return 2
  }
  let unlock = null
  try {
    unlock = lock(o.work)
    if (o.cmd === 'prune') return d.prune(o.work, 2), 0
    return await pipeline(o, d, o.cmd)
  } catch (e) {
    d.log('помилка:', e?.message || e)
    return 1
  } finally {
    unlock?.()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2))
  // код виходу рядком: панель сайту читає журнал і після власного перезапуску (процес уже не її дитина)
  console.log(`[gdx:exit] ${process.exitCode}`)
}

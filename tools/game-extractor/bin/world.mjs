#!/usr/bin/env node
/*
 * Карта світу з файлів гри: node tools/game-extractor/bin/world.mjs [--work DIR] [--out data/world.json] [--build N]
 * Бере збірку останнього пакета (bundles/latest.json), експортує образом експортера в GD_WORK/raw/<збірка>/world
 * DT_MapsInfo*, категорії місць і рівні карти поверхні (повністю — компоненти місць), потім рівні мап із переходами
 * (*_Travel, *_Gameplay*); посадки таксі в Западині — з уже експортованих рівнів мапи (raw/<збірка>/levels).
 * Нормалізує (normalize/world.mjs) і пише JSON для сайту (server/lib/world.mjs). Уже експортоване не повторює.
 */
import fs from 'node:fs'
import path from 'node:path'
import { run } from '../lib/run.mjs'
import { EXPORT_IMAGE, MAP_WORLD, levelFile } from '../lib/raw.mjs'
import { rowsOf } from '../normalize/common.mjs'
import { LANG_DIRS } from '../normalize/texts.mjs'
import { normalizeWorld, worldLevels, worldTables } from '../normalize/world.mjs'

const DEFAULT_WORK = '/Users/stepanenko/Sites/DuneAwakening/gamefiles'
const repo = path.join(import.meta.dirname, '..', '..', '..')

function args(argv) {
  const o = { work: process.env.GD_WORK || DEFAULT_WORK, out: path.join(repo, 'data', 'world.json'), build: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--work') o.work = path.resolve(argv[++i])
    else if (argv[i] === '--out') o.out = path.resolve(argv[++i])
    else if (argv[i] === '--build') o.build = argv[++i]
  }
  return o
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }

async function main() {
  const o = args(process.argv.slice(2))
  const build = o.build ?? readJson(path.join(o.work, 'bundles', 'latest.json'))?.build
  if (!build) throw new Error('нема збірки: bundles/latest.json порожній — спершу npm run gdx -- all')
  const raw = path.join(o.work, 'raw', String(build))
  const files = fs.readFileSync(path.join(raw, 'files.txt'), 'utf8').split('\n').filter(Boolean)
  // корінь сервера збірки: розпакована тека (у .done — шлях, де розпаковували; тека могла переїхати)
  const ext = path.join(o.work, 'extract', String(build))
  const done = readJson(path.join(ext, '.done')) ?? {}
  const root = [path.join(ext, 'home/dune/server/DuneSandbox'), done.root].find((p) => p && fs.existsSync(path.join(p, 'Content/Paks')))
  if (!root) throw new Error(`нема розпакованої збірки ${build} у ${ext}`)
  const usmap = path.join(o.work, 'mappings', `DuneSandbox-${build}.usmap`)
  if (!fs.existsSync(usmap)) throw new Error(`нема ${usmap}`)

  const out = path.join(raw, 'world')
  fs.mkdirSync(path.join(out, 'tables'), { recursive: true })
  fs.mkdirSync(path.join(out, 'levels'), { recursive: true })
  const user = process.getuid ? ['--user', `${process.getuid()}:${process.getgid()}`] : []
  const exp = (...a) => run('docker', ['run', '--rm', ...user, '--network', 'none', '-v', `${path.join(root, 'Content/Paks')}:/paks:ro`, '-v', `${usmap}:/map.usmap:ro`, '-v', `${out}:/out`, EXPORT_IMAGE, ...a], { timeoutMs: 3600_000 })
  const tableFile = (p) => path.join(out, 'tables', path.basename(p) + '.json')
  const levelOf = (p) => path.join(out, 'levels', levelFile(p) + '.json')

  const tables = worldTables(files)
  const needT = tables.filter((p) => !fs.existsSync(tableFile(p)))
  if (needT.length) { console.log(`[world] таблиці й карта поверхні: ${needT.length}`); await exp('tables', ...needT) }
  const mapsInfo = {}
  for (const p of tables.filter((x) => /DT_MapsInfo/.test(x))) Object.assign(mapsInfo, rowsOf(readJson(tableFile(p))))
  const levels = worldLevels(files, mapsInfo)
  const needL = levels.filter((p) => !fs.existsSync(levelOf(p)))
  for (let i = 0; i < needL.length; i += 200) { console.log(`[world] рівні мап: ${i + 1}–${Math.min(i + 200, needL.length)} з ${needL.length}`); await exp('levels', ...needL.slice(i, i + 200)) }

  const overmap = {}, categories = {}
  for (const p of tables) {
    const e = readJson(tableFile(p))
    if (!e) { console.warn(`[world] не експортовано: ${p}`); continue }
    if (/\/Overmap\//.test(p)) overmap[p] = e
    else if (/DA_PoiCategoryData/.test(p)) categories[p] = e
  }
  const lv = {}
  for (const p of levels) { const e = readJson(levelOf(p)); if (e) lv[p] = e }
  // посадки таксі в Западині — у рівнях блоків мапи, вже експортованих для мапи (raw/<збірка>/levels)
  const haggaLevels = {}
  for (const f of fs.readdirSync(path.join(raw, 'levels')).filter((x) => x.endsWith('.json'))) {
    const s = fs.readFileSync(path.join(raw, 'levels', f), 'utf8')
    if (/Travel_To_/i.test(s)) haggaLevels[f] = JSON.parse(s)
  }
  const loc = {}
  for (const l of Object.keys(LANG_DIRS)) { const d = readJson(path.join(raw, 'loc', `${l}.json`)); if (d) loc[l] = d }

  const w = normalizeWorld({ mapsInfo, overmap, levels: lv, extra: [{ map: MAP_WORLD, levels: haggaLevels }], categories, loc })
  const manifest = readJson(path.join(o.work, 'bundles', String(build), 'manifest.json'))
  const { unresolved, ...data } = w
  const doc = { schema: 1, build: String(build), version: manifest?.game?.version ?? done.version ?? null, extractedAt: new Date().toISOString(), ...data }
  fs.mkdirSync(path.dirname(o.out), { recursive: true })
  fs.writeFileSync(o.out, JSON.stringify(doc, null, 1) + '\n')
  console.log(`[world] ${o.out}: місць ${doc.locations.length} (на карті ${doc.locations.filter((l) => l.pos).length}), переходів ${doc.links.length}, текстів ${Object.keys(doc.texts).length}`)
  if (unresolved.length) console.log(`[world] без точки прибуття (${unresolved.length}): ${[...new Set(unresolved)].join(', ')}`)
}

main().catch((e) => { console.error('[world]', e?.message || e); process.exit(1) })

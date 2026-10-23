/*
 * Драйвер «файли гри» (spec §4.2, §4.3): читає пакет видобувача tools/game-extractor — <dir>/latest.json →
 * <збірка>/manifest.json → sections/<розділ>.json.gz. latest.json перечитується щоразу: новий пакет підхоплюється без
 * перезапуску. Розділ з помилкою в маніфесті не віддається (реєстр візьме запасне джерело). Без теки чи пакета — нічого.
 * applies: дані цього драйвера реєстр застосовує в таблиці сайту (дані запасного джерела туди пише нинішній збір).
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export function createGamefilesDriver({ dir }) {
  /** поточний пакет: { build, root, manifest } або null */
  function current() {
    if (!dir) return null
    try {
      const latest = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8'))
      // пакет могли перенести з іншої машини — тоді абсолютний шлях не той, беремо поряд із latest.json
      const root = latest.dir && fs.existsSync(path.join(latest.dir, 'manifest.json')) ? latest.dir : path.join(dir, String(latest.build))
      const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
      return { build: String(manifest.game?.build ?? latest.build), root, manifest }
    } catch {
      return null
    }
  }

  return {
    id: 'gamefiles',
    label: 'файли гри',
    applies: true,
    manifest: () => current()?.manifest ?? null,
    /** опис джерела для панелі й /data: збірка й версія гри поточного пакета */
    describe(section) {
      const c = current()
      if (!c || !c.manifest.sections?.[section]) return null
      return { id: 'gamefiles', names: [], build: c.build, version: c.manifest.game?.version ?? null }
    },
    sections() {
      const c = current()
      return c ? Object.entries(c.manifest.sections ?? {}).filter(([, s]) => !s.error && s.file).map(([id]) => id) : []
    },
    async probe() {
      const c = current()
      if (!c) return null
      const g = c.manifest.game ?? {}
      return { version: c.build, build: c.build, gameVersion: g.version ?? null, manifestId: g.manifestId ?? null, extractedAt: c.manifest.extractedAt ?? null }
    },
    /** відбиток вмісту розділу — збірка й хеш розділу з маніфесту (реєстр тоді не читає незмінний розділ) */
    async contentVersion(section) {
      const c = current()
      const s = c?.manifest.sections?.[section]
      return s?.hash && !s.error ? `${c.build}:${s.hash}` : null
    },
    async load(section) {
      const c = current()
      if (!c) throw new Error('пакета файлів гри нема')
      const s = c.manifest.sections?.[section]
      if (!s) throw new Error(`у пакеті нема розділу ${section}`)
      if (s.error) throw new Error(s.error)
      const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(c.root, s.file))).toString('utf8'))
      // розділ з файлами (ресурси ГП: перелік розкладок, файл на розкладку) — читач файлу, неперелічуваний (поза хешем)
      const layouts = section === 'ddResources' ? data?.blob?.layouts : null
      if (layouts) Object.defineProperty(data, 'files', { enumerable: false, value: (k) => fs.readFileSync(path.join(c.root, layouts[k]?.file ?? '')) })
      return { data, version: c.build }
    },
  }
}

/*
 * Реєстр джерел ігрових даних (spec §4.2, §4.5, §5). Драйвери — у порядку пріоритету; для кожного розділу береться перший,
 * хто його має й віддав дані. Хеш нормалізованих даних порівнюється з останнім: журнал змін пишеться лише коли хеш інший.
 * Збій усіх джерел нічого не затирає; збір, що раптом удвічі менший, чекає підтвердження адміна. Знімки розділів — на
 * диску (<dataDir>/gamedata/<розділ>/<хеш>.json.gz, кілька останніх) — з них рахується, що саме змінилось.
 *
 * Драйвер: { id, label, sections(): string[], probe(): Promise<{ version, build? } | null>,
 *            load(section): Promise<{ data: { records?: Rec[] } | { blob }, version }>, asset?(kind, key), applies?,
 *            contentVersion?(section): Promise<string | null> }
 * contentVersion — дешевий відбиток вмісту розділу (імена файлів, хеш розділу в пакеті): той самий, що минулого разу, —
 * розділ не вантажиться й не хешується знову (сотні тисяч точок мапи щодесять хвилин). Розділ групи з вибраним основним
 * (мапа) запасного джерела не бере: збій основного — помилка, а не дані іншого джерела в таблицях сайту.
 * Основне джерело розділу (primaryOf) береться першим. Дані драйвера з applies (файли гри) після зміни застосовуються в
 * таблиці сайту (apply[розділ]) — до запису нового хешу: збій застосування лишає старий хеш, і наступна перевірка
 * спробує знову.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { diffRecords, normalizeSection, sectionHash } from './hash.mjs'
import { RECORD_SECTIONS, SECTIONS, groupOf } from './sections.mjs'

/** запобіжник обсягу: було хоч стільки записів, а стало менше половини — схоже на збій джерела, а не на патч */
const HOLD_MIN = 20
const HOLD_RATIO = 0.5
const KEEP_SNAPSHOTS = 5

export async function createRegistry({ db, dataDir, drivers, log = console, now = Date.now, primaryOf = async () => null, apply = {} }) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS gamedata_sections (
      section TEXT PRIMARY KEY, driver TEXT, version TEXT, hash TEXT, count INTEGER, applied_at BIGINT, checked_at BIGINT,
      status TEXT NOT NULL DEFAULT 'ok', error TEXT, held_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS gamedata_changes (
      id {{SERIAL}}, at BIGINT NOT NULL, section TEXT NOT NULL, driver TEXT NOT NULL, build TEXT,
      from_hash TEXT, to_hash TEXT NOT NULL, summary TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS gamedata_changes_at ON gamedata_changes (at);
    CREATE TABLE IF NOT EXISTS gamedata_builds (
      build TEXT PRIMARY KEY, manifest_id TEXT, version TEXT, seen_at BIGINT, extracted_at BIGINT, status TEXT
    );
  `)
  await db.addColumn('gamedata_sections', 'content', 'TEXT')
  const root = path.join(dataDir, 'gamedata')

  const snapFile = (section, hash) => path.join(root, section, hash + '.json.gz')
  function writeSnap(section, hash, norm, keep) {
    const dir = path.join(root, section)
    fs.mkdirSync(dir, { recursive: true })
    const f = snapFile(section, hash)
    if (!fs.existsSync(f)) fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(norm)))
    // давні знімки — геть, крім потрібних зараз (поточний, на підтвердженні)
    const files = fs.readdirSync(dir).filter((x) => x.endsWith('.json.gz'))
      .map((x) => ({ x, t: fs.statSync(path.join(dir, x)).mtimeMs })).sort((a, b) => b.t - a.t)
    const need = new Set([...keep, hash].filter(Boolean).map((h) => h + '.json.gz'))
    let kept = need.size
    for (const { x } of files) {
      if (need.has(x)) continue
      if (kept < KEEP_SNAPSHOTS) { kept++; continue }
      fs.rmSync(path.join(dir, x), { force: true })
    }
  }
  function readSnap(section, hash) {
    try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(snapFile(section, hash))).toString('utf8')) } catch { return null }
  }
  function summarize(section, fromHash, toNorm) {
    const prev = fromHash ? readSnap(section, fromHash) : null
    if (RECORD_SECTIONS.has(section) && prev?.records && toNorm.records) return diffRecords(prev.records, toNorm.records)
    return { added: 0, removed: 0, changed: 1, examples: [] }
  }
  const latestBuild = async () => (await db.get("SELECT build FROM gamedata_builds WHERE status = 'ok' ORDER BY extracted_at DESC LIMIT 1"))?.build ?? null

  /**
   * Записати зміну, якщо хеш у базі досі той, від якого рахували (паралельна перевірка вже могла записати). Новий хеш і
   * рядок журналу — однією транзакцією: обрив між ними (перезапуск сервера) не має лишити зміну без запису в журналі
   */
  async function commit(section, { from, to, norm, driver, version, status, at }) {
    const summary = JSON.stringify(summarize(section, from, norm))
    const build = await latestBuild()
    return db.tx(async (t) => {
      const r = await t.run(
        `UPDATE gamedata_sections SET hash = ?, count = ?, driver = ?, version = ?, checked_at = ?, status = ?, error = NULL, held_hash = NULL
         WHERE section = ? AND hash = ?`,
        to, norm.count, driver, version, at, status, section, from,
      )
      if (!r.changes) return false
      await t.run(
        'INSERT INTO gamedata_changes (at, section, driver, build, from_hash, to_hash, summary) VALUES (?, ?, ?, ?, ?, ?, ?)',
        at, section, driver, build, from, to, summary,
      )
      return true
    })
  }

  /** драйвери розділу: основне джерело — першим, далі решта за списком */
  async function ordered(section) {
    const p = await primaryOf(section)
    return p ? [...drivers.filter((d) => d.id === p), ...drivers.filter((d) => d.id !== p)] : drivers
  }

  /**
   * перший драйвер, що дав дані розділу, і помилки тих, що не дали. Той самий драйвер з тим самим відбитком вмісту, що й
   * минулого разу (row), — { got: { same: true } } без завантаження
   */
  async function pick(section, row) {
    const errors = []
    const primary = await primaryOf(section)
    const only = primary && groupOf(section)
    for (const d of await ordered(section)) {
      if (only && d.id !== primary) continue
      if (!d.sections().includes(section)) {
        // основне джерело розділу не дає (пакет зник чи розділ у ньому зламаний) — це збій, а не «нема джерела»
        if (d.id === primary) errors.push(`${d.id}: нема розділу ${section}`)
        continue
      }
      try {
        const content = d.contentVersion ? await d.contentVersion(section) : null
        if (!errors.length && content != null && row?.hash && row.driver === d.id && row.content === content && row.status === 'ok') {
          return { got: { driver: d.id, same: true, content }, errors }
        }
        const { data, version } = await d.load(section)
        return { got: { driver: d.id, applies: !!d.applies, data, version: version == null ? null : String(version), content }, errors }
      } catch (e) {
        errors.push(`${d.id}: ${e?.message || e}`)
      }
    }
    return { got: null, errors }
  }

  /** застосувати дані драйвера-«файли гри» в таблиці сайту; збій — текст помилки (null — вдалося або нема чого) */
  async function applyGot(section, got) {
    if (!got.applies || !apply[section]) return null
    try {
      await apply[section](got.data, { driver: got.driver, build: got.version })
      return null
    } catch (e) {
      log.warn?.(`[gamedata] ${section}: не вдалося застосувати — ${e?.message || e}`)
      return `застосування: ${e?.message || e}`.slice(0, 2000)
    }
  }
  const markError = (section, at, error) => db.run(
    `INSERT INTO gamedata_sections (section, checked_at, status, error) VALUES (?, ?, 'error', ?)
     ON CONFLICT (section) DO UPDATE SET checked_at = excluded.checked_at, status = 'error', error = excluded.error`,
    section, at, error,
  )

  /** switched — перевірку запустило перемикання основного адміном: спад обсягу тоді не на підтвердженні */
  async function checkOne(section, { switched = false } = {}) {
    const row = await db.get('SELECT * FROM gamedata_sections WHERE section = ?', section)
    const { got, errors } = await pick(section, row)
    if (!got && !errors.length) return null // розділу не дає жоден драйвер
    const at = now()
    if (got?.same) {
      await db.run('UPDATE gamedata_sections SET checked_at = ? WHERE section = ?', at, section)
      return { section, driver: got.driver, status: 'same', count: row.count }
    }
    if (!got) {
      const error = errors.join('; ').slice(0, 2000)
      log.warn?.(`[gamedata] ${section}: ${error}`)
      await markError(section, at, error)
      return { section, driver: null, status: 'error' }
    }
    const norm = normalizeSection(got.data)
    const hash = sectionHash(got.data)
    // відбиток вмісту — разом із хешем (наступна перевірка з тим самим відбитком не вантажить)
    const remember = () => db.run('UPDATE gamedata_sections SET content = ? WHERE section = ?', got.content ?? null, section)
    const status = errors.length ? 'fallback' : 'ok'
    const error = errors.length ? errors.join('; ').slice(0, 2000) : null
    const res = (s) => ({ section, driver: got.driver, status: errors.length ? 'fallback' : s, count: norm.count })

    if (!row?.hash) {
      const failed = await applyGot(section, got)
      if (failed) { await markError(section, at, failed); return { section, driver: got.driver, status: 'error' } }
      writeSnap(section, hash, norm, [])
      await db.run(
        `INSERT INTO gamedata_sections (section, driver, version, hash, count, applied_at, checked_at, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (section) DO UPDATE SET driver = excluded.driver, version = excluded.version, hash = excluded.hash, count = excluded.count,
           applied_at = excluded.applied_at, checked_at = excluded.checked_at, status = excluded.status, error = excluded.error
         WHERE gamedata_sections.hash IS NULL`,
        section, got.driver, got.version, hash, norm.count, at, at, status, error,
      )
      await remember()
      return res('first')
    }
    if (row.hash === hash) {
      await db.run('UPDATE gamedata_sections SET checked_at = ?, driver = ?, version = ?, status = ?, error = ?, held_hash = NULL WHERE section = ?',
        at, got.driver, got.version, status, error, section)
      await remember()
      return res('same')
    }
    // удвічі менший збір — схоже на збій розбору; крім перевірки, яку запустило перемикання основного адміном
    if (!switched && (row.count ?? 0) >= HOLD_MIN && norm.count < row.count * HOLD_RATIO) {
      writeSnap(section, hash, norm, [row.hash])
      await db.run("UPDATE gamedata_sections SET checked_at = ?, status = 'held', held_hash = ?, error = ? WHERE section = ?",
        at, hash, `${norm.count} з ${row.count}`, section)
      log.warn?.(`[gamedata] ${section}: ${norm.count} з ${row.count} — чекає підтвердження`)
      return { section, driver: got.driver, status: 'held', count: norm.count }
    }
    const failed = await applyGot(section, got)
    if (failed) { await markError(section, at, failed); return { section, driver: got.driver, status: 'error' } }
    writeSnap(section, hash, norm, [row.hash])
    await commit(section, { from: row.hash, to: hash, norm, driver: got.driver, version: got.version, status, at })
    await remember()
    return res('changed')
  }

  /** перевірити розділи (усі — за замовчуванням); результат — по розділу, що його дає хоч один драйвер */
  async function check(sections = SECTIONS, opts = {}) {
    await noteBuilds()
    const out = []
    for (const s of sections) {
      const r = await checkOne(s, opts)
      if (r) out.push(r)
    }
    return out
  }

  /** збірки гри з пакетів (драйвери, що застосовуються): що бачили й коли видобуто — для індикатора */
  async function noteBuilds() {
    for (const d of drivers) {
      if (!d.applies) continue
      const p = await d.probe().catch(() => null)
      if (!p?.build) continue
      const at = now()
      await db.run(
        `INSERT INTO gamedata_builds (build, manifest_id, version, seen_at, extracted_at, status) VALUES (?, ?, ?, ?, ?, 'ok')
         ON CONFLICT (build) DO UPDATE SET seen_at = excluded.seen_at, manifest_id = excluded.manifest_id, version = excluded.version, extracted_at = excluded.extracted_at`,
        String(p.build), p.manifestId ?? null, p.gameVersion ?? null, at, p.extractedAt ? Date.parse(p.extractedAt) || at : at,
      )
    }
  }

  /** застосувати поточні дані розділу ще раз (перемкнули основне джерело, а хеш той самий) */
  async function reapply(section) {
    const { got } = await pick(section)
    if (!got?.applies || !apply[section]) return false
    const failed = await applyGot(section, got)
    if (failed) throw new Error(failed)
    return true
  }

  /**
   * Прийняти розділ, що чекає підтвердження (запобіжник обсягу). Застосовуються свіжі повні дані з джерела (знімок —
   * нормалізований, без невипущеного: застосувавши його, прибрали б і відкрите адміном), і лише якщо джерело досі
   * віддає саме те, що затримано.
   */
  async function accept(section) {
    const row = await db.get('SELECT * FROM gamedata_sections WHERE section = ?', section)
    if (!row?.held_hash) return false
    const { got } = await pick(section)
    if (!got || sectionHash(got.data) !== row.held_hash) return false
    const failed = await applyGot(section, got)
    if (failed) throw new Error(failed)
    return commit(section, { from: row.hash, to: row.held_hash, norm: normalizeSection(got.data), driver: got.driver, version: got.version, status: 'ok', at: now() })
  }

  async function status() {
    const rows = await db.all('SELECT * FROM gamedata_sections ORDER BY section')
    const last = await db.all('SELECT section, MAX(at) AS at FROM gamedata_changes GROUP BY section')
    const changedAt = new Map(last.map((r) => [r.section, r.at == null ? null : Number(r.at)]))
    const build = await db.get("SELECT build, version FROM gamedata_builds WHERE status = 'ok' ORDER BY extracted_at DESC LIMIT 1")
    const all = [...changedAt.values()].filter((x) => x != null)
    return {
      game: { version: build?.version ?? null, build: build?.build ?? null },
      updatedAt: all.length ? Math.max(...all) : null,
      sections: await Promise.all(rows.map(async (r) => ({
        id: r.section, primary: (await primaryOf(r.section)) ?? null, driver: r.driver,
        // конкретне джерело (questlog.gg, TH.GL, файли гри зі збіркою…), а не лише id драйвера
        source: drivers.find((d) => d.id === r.driver)?.describe?.(r.section) ?? null, count: r.count, changedAt: changedAt.get(r.section) ?? null,
        // since — коли розділ уперше побачили (applied_at пишеться лише першим спостереженням)
        since: r.hash && r.applied_at != null ? Number(r.applied_at) : null,
        checkedAt: r.checked_at == null ? null : Number(r.checked_at), status: r.status, error: r.error ?? null,
      }))),
    }
  }

  async function changes({ limit = 30, before = null } = {}) {
    const n = Math.max(1, Math.min(100, Number(limit) || 30))
    const rows = before == null
      ? await db.all('SELECT * FROM gamedata_changes ORDER BY id DESC LIMIT ?', n + 1)
      : await db.all('SELECT * FROM gamedata_changes WHERE id < ? ORDER BY id DESC LIMIT ?', Number(before), n + 1)
    const page = rows.slice(0, n)
    return {
      items: page.map((r) => ({
        id: Number(r.id), at: Number(r.at), section: r.section, driver: r.driver, build: r.build ?? null, summary: JSON.parse(r.summary),
        // конкретні сайти запасного джерела (збірка файлів гри — у build: опис драйвера знає лише поточну)
        names: drivers.find((d) => d.id === r.driver)?.describe?.(r.section)?.names ?? [],
      })),
      next: rows.length > n ? Number(page[page.length - 1].id) : null,
    }
  }

  return { check, accept, reapply, status, changes }
}

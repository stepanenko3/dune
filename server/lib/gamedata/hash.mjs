/*
 * Хеш розділу ігрових даних і різниця між двома його версіями. Хеш не залежить від того, в якому порядку джерело
 * віддало записи чи ключі об'єктів, — тож той самий набір даних (навіть з іншого драйвера) дає той самий хеш, і журнал
 * змін мовчить. Невипущене в грі (released: false) у хеш і лічильник не входить.
 */
import { createHash } from 'node:crypto'

/** JSON з відсортованими ключами об'єктів (масиви — у своєму порядку) */
export function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}'
  }
  return JSON.stringify(v ?? null)
}

const byId = (a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)

/** без невипущеного, записи за id; count — скільки записів (blob — один) */
export function normalizeSection(data) {
  if (Array.isArray(data?.records)) {
    const records = data.records.filter((r) => r && r.released !== false).sort(byId)
    return { records, count: records.length }
  }
  return { blob: data?.blob ?? null, count: 1 }
}

export function sectionHash(data) {
  const { count, ...rest } = normalizeSection(data)
  void count
  return createHash('sha256').update(stableStringify(rest)).digest('hex')
}

const MAX_EXAMPLES = 20

/** що додали, прибрали й змінили (за id); приклади — спершу додане, тоді прибране, тоді змінене */
export function diffRecords(prev, next) {
  const was = new Map((prev ?? []).map((r) => [String(r.id), r]))
  const now = new Map((next ?? []).map((r) => [String(r.id), r]))
  const ex = { '+': [], '-': [], '~': [] }
  const note = (op, r) => ex[op].push({ id: String(r.id), name: r.name ?? null, op })
  for (const [id, r] of now) {
    if (!was.has(id)) note('+', r)
    else if (stableStringify(was.get(id)) !== stableStringify(r)) note('~', r)
  }
  for (const [id, r] of was) if (!now.has(id)) note('-', r)
  return {
    added: ex['+'].length, removed: ex['-'].length, changed: ex['~'].length,
    examples: [...ex['+'], ...ex['-'], ...ex['~']].slice(0, MAX_EXAMPLES),
  }
}

/** Стан видобувача: <work>/state.json { lastCheck, builds: { <збірка>: { sha, bundled } } } — запис через tmp+rename. */
import fs from 'node:fs'
import path from 'node:path'

export function readState(work) {
  try { return JSON.parse(fs.readFileSync(path.join(work, 'state.json'), 'utf8')) } catch { return { lastCheck: null, builds: {} } }
}

export function writeState(work, state) {
  const f = path.join(work, 'state.json')
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(f + '.tmp', JSON.stringify(state, null, 1))
  fs.renameSync(f + '.tmp', f)
}

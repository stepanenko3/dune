/*
 * Steam: офіційний dedicated server Dune: Awakening (app 4754530, Linux-депо 4754532), анонімно через DepotDownloader
 * (SteamCMD падає в Docker на Маці arm64). Перевірка — лише маніфест (0 байт файлів); завантаження — лише образ
 * сервера й номер версії.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { run } from './run.mjs'

export const APP = '4754530'
export const DEPOT = '4754532'
const VERSION = '3.4.0'
const RELEASE = `https://github.com/SteamRE/DepotDownloader/releases/download/DepotDownloader_${VERSION}/`
/** закріплені збірки DepotDownloader: платформа → архів і його sha256 */
export const PINNED = {
  'darwin-arm64': { asset: 'DepotDownloader-macos-arm64.zip', sha256: '60e80c7c496f3f9a079cd3c62036b35d088c27bc0149baf38f009eb57a52f6a5' },
  'linux-x64': { asset: 'DepotDownloader-linux-x64.zip', sha256: 'a999dec66b4850fc961bd50366696d23c2d0fad7b18790e6a5647b2f19097a53' },
}
export const SERVER_FILES = ['images/battlegroup/server.tar', 'images/battlegroup/version.txt']

/** шлях до DepotDownloader у <work>/tools (качає й перевіряє sha256 лише раз) */
export async function ensureDepotDownloader(work, { platform = `${process.platform}-${process.arch}` } = {}) {
  const pin = PINNED[platform]
  if (!pin) throw new Error(`нема закріпленого DepotDownloader для ${platform}`)
  const dir = path.join(work, 'tools', `depotdownloader-${VERSION}`)
  const bin = path.join(dir, 'DepotDownloader')
  if (fs.existsSync(bin)) return bin
  fs.mkdirSync(dir, { recursive: true })
  const res = await fetch(RELEASE + pin.asset)
  if (!res.ok) throw new Error(`DepotDownloader не завантажився: ${res.status}`)
  const zip = Buffer.from(await res.arrayBuffer())
  const sha = createHash('sha256').update(zip).digest('hex')
  if (sha !== pin.sha256) throw new Error(`DepotDownloader: sha256 ${sha} ≠ закріпленого ${pin.sha256}`)
  const zipFile = path.join(dir, pin.asset)
  fs.writeFileSync(zipFile, zip)
  await run('unzip', ['-o', '-q', zipFile, '-d', dir])
  fs.chmodSync(bin, 0o755)
  fs.rmSync(zipFile)
  return bin
}

/** маніфест депо (текст -manifest-only): id, дата, файли { шлях: { size, sha } } */
export function parseManifest(text) {
  const head = /Manifest ID \/ date\s*:\s*(\d+)\s*\/\s*(.+?)\s*$/m.exec(text)
  if (!head) throw new Error('у маніфесті нема «Manifest ID / date»')
  const files = {}
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+\d+\s+([0-9a-f]{40})\s+\d+\s+(.+?)\s*$/.exec(line)
    if (m) files[m[3]] = { size: Number(m[1]), sha: m[2] }
  }
  return { manifestId: head[1], date: head[2], files }
}

const ddArgs = (dir) => ['-app', APP, '-os', 'linux', '-osarch', '64', '-dir', dir]

/** що зараз у Steam: id маніфесту, дата, SHA образу сервера й version.txt (без завантаження файлів) */
export async function check(work) {
  const bin = await ensureDepotDownloader(work)
  const tmp = path.join(work, 'tmp', `manifest-${Date.now()}`)
  fs.mkdirSync(tmp, { recursive: true })
  try {
    await run(bin, [...ddArgs(tmp), '-manifest-only'], { cwd: tmp, timeoutMs: 10 * 60_000 })
    const f = fs.readdirSync(tmp).find((x) => x.startsWith(`manifest_${DEPOT}_`) && x.endsWith('.txt'))
    if (!f) throw new Error('DepotDownloader не записав маніфест')
    const m = parseManifest(fs.readFileSync(path.join(tmp, f), 'utf8'))
    const tar = m.files[SERVER_FILES[0]]
    if (!tar) throw new Error(`у маніфесті нема ${SERVER_FILES[0]}`)
    return { manifestId: m.manifestId, date: m.date, serverTarSha: tar.sha, versionTxtSha: m.files[SERVER_FILES[1]]?.sha ?? null }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/** завантажити лише образ сервера й version.txt у depotDir (докачує й перевіряє вже наявне) */
export async function fetchServer(work, depotDir, { onLine } = {}) {
  const bin = await ensureDepotDownloader(work)
  fs.mkdirSync(depotDir, { recursive: true })
  const list = path.join(work, 'tmp', 'filelist.txt')
  fs.mkdirSync(path.dirname(list), { recursive: true })
  fs.writeFileSync(list, SERVER_FILES.join('\n') + '\n')
  await run(bin, [...ddArgs(depotDir), '-validate', '-max-downloads', '24', '-filelist', list], { cwd: depotDir, onLine, timeoutMs: 6 * 3600_000 })
}

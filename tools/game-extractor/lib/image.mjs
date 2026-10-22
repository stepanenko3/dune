/*
 * Образ сервера (tar у форматі docker save) розпаковується системним tar, без запуску: із шарів беремо лише паки й
 * конфіги гри. Збірка — з тегу образу (…:2160922-0-shipping), версія — з мітки code_branch (Seabass_sb-1.5.15.0 → 1.5.15).
 */
import fs from 'node:fs'
import path from 'node:path'
import { run as runDefault } from './run.mjs'

const GAME = 'home/dune/server/DuneSandbox'
const WANT = [`${GAME}/Content/Paks`, `${GAME}/Config`]

export const buildOf = (tag) => /:(\d+)-/.exec(tag || '')?.[1] ?? null
export const versionOf = (branch) => /(\d+)\.(\d+)\.(\d+)/.exec(branch || '')?.slice(1, 4).join('.') ?? null

export async function unpack(tarPath, destDir, { run = runDefault } = {}) {
  const done = path.join(destDir, '.done')
  if (fs.existsSync(done)) return JSON.parse(fs.readFileSync(done, 'utf8'))

  const json = async (member) => JSON.parse((await run('tar', ['-xOf', tarPath, member])).out)
  const [m] = await json('manifest.json')
  const tag = m.RepoTags?.[0] ?? ''
  const cfg = await json(m.Config)
  const info = { build: buildOf(tag), version: versionOf(cfg?.config?.Labels?.code_branch), tag, root: path.join(destDir, GAME) }
  if (!info.build) throw new Error(`у тегу образу нема номера збірки: «${tag}»`)

  fs.mkdirSync(destDir, { recursive: true })
  const tmp = fs.mkdtempSync(path.join(destDir, '.layer-'))
  try {
    for (const layer of m.Layers) {
      // шар — окремим файлом (tar у tar), з нього — лише потрібні теки, якщо вони в цьому шарі є
      await run('tar', ['-xf', tarPath, '-C', tmp, layer])
      const file = path.join(tmp, layer)
      const names = (await run('tar', ['-tzf', file])).out.split('\n')
      const take = WANT.filter((w) => names.some((n) => n === w || n.startsWith(w + '/')))
      if (take.length) await run('tar', ['-xzf', file, '-C', destDir, ...take])
      fs.rmSync(file, { force: true })
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  fs.writeFileSync(done, JSON.stringify(info))
  return info
}

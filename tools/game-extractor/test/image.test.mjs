// Розпакування образу сервера (формат docker save / OCI) без запуску: лише паки й конфіги, збірка й версія з тегу й міток.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { unpack } from '../lib/image.mjs'
import { run } from '../lib/run.mjs'

/** крихітний образ: шар 1 — сторонній файл, шар 2 — паки, конфіг і бінарник (бінарник розпаковувати не треба) */
function fakeImage(dir) {
  const S = path.join(dir, 'src')
  const put = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text) }
  put(path.join(S, 'l1'), 'etc/hostname', 'x')
  const D = 'home/dune/server/DuneSandbox'
  put(path.join(S, 'l2'), `${D}/Config/DefaultGame.ini`, '[x]\na=1\n')
  put(path.join(S, 'l2'), `${D}/Content/Paks/x.utoc`, 'toc')
  put(path.join(S, 'l2'), `${D}/Binaries/Linux/server`, 'elf')
  const img = path.join(dir, 'img')
  fs.mkdirSync(path.join(img, 'blobs/sha256'), { recursive: true })
  execFileSync('tar', ['-czf', path.join(img, 'blobs/sha256/aaa'), '-C', path.join(S, 'l1'), 'etc'])
  execFileSync('tar', ['-czf', path.join(img, 'blobs/sha256/bbb'), '-C', path.join(S, 'l2'), 'home'])
  fs.writeFileSync(path.join(img, 'blobs/sha256/ccc'), JSON.stringify({ config: { Labels: { code_branch: 'Seabass_sb-1.5.15.0' } } }))
  fs.writeFileSync(path.join(img, 'manifest.json'), JSON.stringify([{ Config: 'blobs/sha256/ccc', RepoTags: ['registry.funcom.com/funcom/self-hosting/seabass-server:123-0-shipping'], Layers: ['blobs/sha256/aaa', 'blobs/sha256/bbb'] }]))
  const tar = path.join(dir, 'server.tar')
  execFileSync('tar', ['-cf', tar, '-C', img, 'manifest.json', 'blobs'])
  return tar
}

describe('розпакування образу сервера', () => {
  let dir, tar
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-img-')); tar = fakeImage(dir) })

  it('лише паки й конфіги; збірка, тег і версія', async () => {
    const dest = path.join(dir, 'out')
    const r = await unpack(tar, dest)
    expect(r).toMatchObject({ build: '123', version: '1.5.15', tag: 'registry.funcom.com/funcom/self-hosting/seabass-server:123-0-shipping' })
    expect(r.root).toBe(path.join(dest, 'home/dune/server/DuneSandbox'))
    expect(fs.readFileSync(path.join(r.root, 'Config/DefaultGame.ini'), 'utf8')).toContain('a=1')
    expect(fs.existsSync(path.join(r.root, 'Content/Paks/x.utoc'))).toBe(true)
    expect(fs.existsSync(path.join(r.root, 'Binaries'))).toBe(false)
    expect(fs.existsSync(path.join(dest, 'etc'))).toBe(false)
  })

  it('удруге — без tar (уже розпаковано)', async () => {
    const dest = path.join(dir, 'out2')
    await unpack(tar, dest)
    let calls = 0
    const counting = (...a) => { calls++; return run(...a) }
    const r = await unpack(tar, dest, { run: counting })
    expect(calls).toBe(0)
    expect(r.build).toBe('123')
  })
})

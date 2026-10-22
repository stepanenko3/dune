// Оркестратор gdx: та сама збірка й пакет є — нічого не качається; Steam недоступний — помилка без змін стану.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { main } from '../bin/gdx.mjs'

function deps(over = {}, work) {
  const calls = []
  const bundle = ({ build }) => {
    const dir = path.join(work, 'bundles', String(build))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ extractor: { version: '1' } }))
    fs.writeFileSync(path.join(work, 'bundles', 'latest.json'), JSON.stringify({ build: String(build), dir }))
    return dir
  }
  const note = (name, v) => (...a) => { calls.push(name); return typeof v === 'function' ? v(...a) : v }
  return {
    calls,
    deps: {
      check: note('check', { manifestId: 'm1', date: 'd', serverTarSha: 'sha1', versionTxtSha: 'v' }),
      fetchServer: note('fetch', undefined),
      unpack: note('unpack', { build: '7', version: '1.5.15', tag: 'img:7-0-shipping', root: '/x' }),
      makeUsmap: note('usmap', '/x.usmap'),
      exportRaw: note('export', undefined),
      normalizeRaw: note('normalize', {}),
      writeBundle: note('bundle', bundle),
      prune: note('prune', undefined),
      log: () => {},
      ...over,
    },
  }
}

describe('gdx', () => {
  let work
  beforeEach(() => { work = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-gdx-')) })
  const state = () => JSON.parse(fs.readFileSync(path.join(work, 'state.json'), 'utf8'))

  it('all: нова збірка — усі кроки по черзі, стан записано', async () => {
    const { deps: d, calls } = deps({}, work)
    expect(await main(['all', '--work', work], d)).toBe(0)
    expect(calls).toEqual(['check', 'fetch', 'unpack', 'usmap', 'export', 'normalize', 'bundle', 'prune'])
    expect(state()).toMatchObject({ lastCheck: { manifestId: 'm1', serverTarSha: 'sha1' }, builds: { 7: { sha: 'sha1', bundled: expect.any(Number) } } })
  })

  it('all: той самий образ і пакет уже є — «без змін», нічого не качається', async () => {
    const first = deps({}, work)
    await main(['all', '--work', work], first.deps)
    const { deps: d, calls } = deps({}, work)
    expect(await main(['all', '--work', work], d)).toBe(0)
    expect(calls).toEqual(['check'])
  })

  it('all --force — перезбирає', async () => {
    await main(['all', '--work', work], deps({}, work).deps)
    const { deps: d, calls } = deps({}, work)
    await main(['all', '--work', work, '--force'], d)
    expect(calls).toContain('bundle')
  })

  it('Steam недоступний — код ≠ 0, стан і пакет не зачеплено', async () => {
    await main(['all', '--work', work], deps({}, work).deps)
    const before = fs.readFileSync(path.join(work, 'state.json'), 'utf8')
    const { deps: d, calls } = deps({ check: () => { throw new Error('Steam недоступний') } }, work)
    expect(await main(['all', '--work', work], d)).not.toBe(0)
    expect(calls).toEqual([])
    expect(fs.readFileSync(path.join(work, 'state.json'), 'utf8')).toBe(before)
  })

  it('розпаковану збірку з тим самим образом не розпаковує вдруге', async () => {
    const dir = path.join(work, 'extract', '7')
    fs.mkdirSync(path.join(dir, 'home/dune/server/DuneSandbox'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.done'), JSON.stringify({ build: '7', version: '1.5.15', tag: 'img:7-0-shipping', root: path.join(dir, 'home/dune/server/DuneSandbox'), sha: 'sha1' }))
    const { deps: d, calls } = deps({}, work)
    expect(await main(['export', '--work', work], d)).toBe(0)
    expect(calls).toEqual(['check', 'fetch', 'usmap', 'export'])
  })

  it('prune не зміг (файли root-а) — пакет усе одно записано в стан, код 0', async () => {
    const { deps: d } = deps({ prune: () => { throw new Error('EACCES') } }, work)
    expect(await main(['all', '--work', work], d)).toBe(0)
    expect(state().builds['7'].bundled).toEqual(expect.any(Number))
  })

  it('пакет видалено з диска — «без змін» не вірить стану, перезбирає', async () => {
    await main(['all', '--work', work], deps({}, work).deps)
    fs.rmSync(path.join(work, 'bundles'), { recursive: true, force: true })
    const { deps: d, calls } = deps({}, work)
    await main(['all', '--work', work], d)
    expect(calls).toContain('bundle')
  })

  it('latest.json вказує на іншу збірку (відкат образу) — перезбирає', async () => {
    await main(['all', '--work', work], deps({}, work).deps)
    fs.writeFileSync(path.join(work, 'bundles', 'latest.json'), JSON.stringify({ build: '8', dir: '/x' }))
    const { deps: d, calls } = deps({}, work)
    await main(['all', '--work', work], d)
    expect(calls).toContain('bundle')
  })

  it('другий запуск, поки перший працює, — відмова; після роботи замок знято', async () => {
    fs.writeFileSync(path.join(work, 'gdx.lock'), String(process.pid))
    const { deps: d, calls } = deps({}, work)
    expect(await main(['all', '--work', work], d)).not.toBe(0)
    expect(calls).toEqual([])
    fs.rmSync(path.join(work, 'gdx.lock'))
    await main(['all', '--work', work], deps({}, work).deps)
    expect(fs.existsSync(path.join(work, 'gdx.lock'))).toBe(false)
  })

  it('замок від мертвого процесу — забирає', async () => {
    fs.writeFileSync(path.join(work, 'gdx.lock'), '999999')
    expect(await main(['all', '--work', work], deps({}, work).deps)).toBe(0)
  })
})

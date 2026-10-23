// usmap із замороженого сервера: оркестрація Docker (тут — фейковий docker, що записує виклики).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { makeUsmap, parseGlobals, waitFor } from '../lib/usmap.mjs'

/** фейковий docker: ready — чи сервер «дійшов» до Game Engine Initialized; jmap кладе файли в змонтовану /out */
function fakeDocker({ ready, alive = true, haveImage = true, lateStart = 0 }) {
  const calls = []
  let pg = 0, gr = 0
  const docker = async (args) => {
    calls.push(args)
    const [cmd] = args
    if (cmd === 'image' && !haveImage) throw new Error('No such image')
    // lateStart — процес сервера з'являється лише після стількох перевірок (емуляція amd64 стартує повільно)
    if (cmd === 'exec' && args.includes('grep')) { if (!ready || ++gr <= lateStart + 1) throw new Error('нема рядка'); return { code: 0, out: '' } }
    if (cmd === 'exec' && args.includes('pgrep')) { if (!alive || ++pg <= lateStart) throw new Error('нема процесу'); return { code: 0, out: '42' } }
    if (cmd === 'exec' && args.includes('tail')) return { code: 0, out: 'LogCore: Unhandled Exception: SIGSEGV\n' }
    if (cmd === 'run' && args.includes('sandwalkers/gd-jmap:1')) {
      const out = args[args.indexOf('-v') + 1].split(':/out')[0]
      fs.writeFileSync(path.join(out, 'dune.usmap'), 'USMAP')
      fs.writeFileSync(path.join(out, 'dune.jmap.gz'), 'JMAP')
    }
    return { code: 0, out: '' }
  }
  return { docker, calls }
}

describe('usmap', () => {
  let work
  beforeEach(() => { work = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-usmap-')) })

  it('рядок сканера → адреси', () => {
    expect(parseGlobals('{"fnamePool":"0x1","guobjectArray":"0x2","imageBase":"0x3"}')).toEqual({ fnamePool: '0x1', guobjectArray: '0x2', imageBase: '0x3' })
    expect(() => parseGlobals('кандидати …')).toThrow()
  })

  it('чекання з таймаутом', async () => {
    expect(await waitFor(async () => false, { timeoutMs: 50, intervalMs: 5 })).toBe(false)
    let n = 0
    expect(await waitFor(async () => ++n > 2, { timeoutMs: 1000, intervalMs: 5 })).toBe(true)
  })

  it('usmap уже є — docker не потрібен', async () => {
    fs.mkdirSync(path.join(work, 'mappings'))
    fs.writeFileSync(path.join(work, 'mappings', 'DuneSandbox-7.usmap'), 'x')
    const { docker, calls } = fakeDocker({ ready: true })
    expect(await makeUsmap({ work, build: '7', image: 'img:7', serverTar: '/nope', docker })).toBe(path.join(work, 'mappings', 'DuneSandbox-7.usmap'))
    expect(calls).toEqual([])
  })

  it('сервер не стартував — ясна помилка, контейнер прибрано', async () => {
    const { docker, calls } = fakeDocker({ ready: false })
    await expect(makeUsmap({ work, build: '7', image: 'img:7', serverTar: '/nope', docker, timeoutMs: 60, intervalMs: 5 }))
      .rejects.toThrow('сервер не дійшов до Game Engine Initialized')
    expect(calls.at(-1)).toEqual(['rm', '-f', 'gd-usmap-7'])
    expect(fs.existsSync(path.join(work, 'mappings', 'DuneSandbox-7.usmap'))).toBe(false)
  })

  it('успіх: сервер заморожено, jmap у його pid-просторі, файли скопійовано, контейнер прибрано', async () => {
    const { docker, calls } = fakeDocker({ ready: true })
    const f = await makeUsmap({ work, build: '7', image: 'img:7', serverTar: '/nope', docker, timeoutMs: 1000, intervalMs: 5 })
    expect(fs.readFileSync(f, 'utf8')).toBe('USMAP')
    expect(fs.readFileSync(path.join(work, 'mappings', 'DuneSandbox-7.jmap.gz'), 'utf8')).toBe('JMAP')
    expect(calls.some((a) => a[0] === 'exec' && a.includes('pkill') && a.includes('-STOP'))).toBe(true)
    const jmap = calls.find((a) => a.includes('sandwalkers/gd-jmap:1'))
    expect(jmap).toEqual(expect.arrayContaining(['--pid', 'container:gd-usmap-7', '--cap-add', 'SYS_PTRACE', '--network', 'none']))
    expect(calls.at(-1)).toEqual(['rm', '-f', 'gd-usmap-7'])
  })

  it('процес сервера з\'являється не одразу після docker run — це не «упав»: чекаємо далі', async () => {
    const { docker } = fakeDocker({ ready: true, lateStart: 3 })
    expect(await makeUsmap({ work, build: '7', image: 'img:7', serverTar: '/nope', docker, timeoutMs: 5000, intervalMs: 5, startMs: 2000 })).toMatch(/DuneSandbox-7\.usmap$/)
  })

  it('сервер упав до старту — швидка помилка з хвостом журналу сервера', async () => {
    const { docker } = fakeDocker({ ready: false, alive: false })
    const t0 = Date.now()
    await expect(makeUsmap({ work, build: '7', image: 'img:7', serverTar: '/nope', docker, timeoutMs: 5000, intervalMs: 5, startMs: 50 }))
      .rejects.toThrow(/сервер завершився[\s\S]*Unhandled Exception/)
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('таймаут — теж з хвостом журналу', async () => {
    const { docker } = fakeDocker({ ready: false })
    await expect(makeUsmap({ work, build: '7', image: 'img:7', serverTar: '/nope', docker, timeoutMs: 60, intervalMs: 5 })).rejects.toThrow(/Unhandled Exception/)
  })

  it('образ сервера завантажили самі — після usmap прибираємо (4.45 GB); свій — не чіпаємо', async () => {
    const a = fakeDocker({ ready: true, haveImage: false })
    await makeUsmap({ work, build: '7', image: 'img:7', serverTar: '/srv.tar', docker: a.docker, timeoutMs: 1000, intervalMs: 5 })
    expect(a.calls).toContainEqual(['load', '-i', '/srv.tar'])
    expect(a.calls).toContainEqual(['rmi', 'img:7'])
    fs.rmSync(path.join(work, 'mappings'), { recursive: true })
    const b = fakeDocker({ ready: true, haveImage: true })
    await makeUsmap({ work, build: '7', image: 'img:7', serverTar: '/srv.tar', docker: b.docker, timeoutMs: 1000, intervalMs: 5 })
    expect(b.calls.some((c) => c[0] === 'rmi')).toBe(false)
  })
})

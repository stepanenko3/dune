import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createUpdater, parseLog } from './lib/gamedata/update.mjs'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 5000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timeout')
    await wait(50)
  }
}

/** підставний видобувач: друкує кроки, як справжній gdx, і виходить з кодом */
function fakeGdx(dir, body) {
  const f = path.join(dir, 'gdx.mjs')
  fs.writeFileSync(f, body)
  return f
}

describe('parseLog', () => {
  it('крок, відсоток завантаження, підсумок і код виходу', () => {
    const p = parseLog([
      '[gdx:step] check', '[gdx] Steam: маніфест 1 (2026), образ abc', '[gdx:step] fetch', '[gdx] 12.5% depot/server.tar', '[gdx]  47,25% depot/server.tar',
    ].join('\n'))
    expect(p).toMatchObject({ step: 'fetch', pct: 47.25, result: null, exit: null })
    const q = parseLog(['[gdx:step] unpack', '[gdx] збірка 2162777, версія 1.5.15', '[gdx:step] bundle', '[gdx] пакет: /x/bundles/2162777', '[gdx:exit] 0'].join('\n'))
    expect(q).toMatchObject({ step: 'bundle', pct: null, result: 'updated', exit: 0, build: '2162777', version: '1.5.15' })
    expect(parseLog('[gdx] без змін: збірка 1 уже в пакеті\n[gdx:exit] 0').result).toBe('same')
    expect(parseLog('[gdx] помилка: docker не відповідає\n[gdx:exit] 1')).toMatchObject({ error: 'docker не відповідає', exit: 1 })
  })
})

describe('createUpdater', () => {
  it('вимкнено без робочої теки', async () => {
    const u = createUpdater({ work: null })
    expect(await u.status()).toEqual({ enabled: false })
    expect(() => u.start('all')).toThrow(/вимкнено/)
  })

  it('прогін із новим пакетом: крок за кроком, наприкінці реєстр бере пакет', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gdu-'))
    const gdx = fakeGdx(work, `
      const step = (s) => console.log('[gdx:step]', s)
      step('check'); console.log('[gdx] Steam: маніфест 7')
      step('fetch'); console.log('[gdx] 50% server.tar')
      await new Promise((r) => setTimeout(r, 300))
      step('bundle'); console.log('[gdx] пакет: /tmp/b/9')
      console.log('[gdx:exit]', 0)
    `)
    let checked = 0
    const u = createUpdater({ work, gdx, registry: { check: async () => { checked++ } } })
    const s0 = await u.start('all')
    expect(s0.job.running).toBe(true)
    expect(() => u.start('all')).toThrow(/вже йде/)
    const mid = await until(async () => { const s = await u.status(); return s.job.pct === 50 ? s : null })
    expect(mid.job.step).toBe('fetch')
    const end = await until(async () => { const s = await u.status(); return !s.job.running && s.job.applied ? s : null })
    expect(end.job).toMatchObject({ ok: true, result: 'updated', error: null })
    expect(checked).toBe(1)
    // повторний стан — пакет уже застосовано, вдруге не перевіряємо
    await u.status()
    expect(checked).toBe(1)
  })

  it('без змін — реєстр не чіпаємо; помилка видобувача — у стані', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gdu-'))
    let checked = 0
    const same = createUpdater({ work, registry: { check: async () => { checked++ } }, gdx: fakeGdx(work, `console.log('[gdx:step] check'); console.log('[gdx] без змін: збірка 9 уже в пакеті'); console.log('[gdx:exit]', 0)`) })
    await same.start('all')
    const a = await until(async () => { const s = await same.status(); return s.job.running ? null : s })
    expect(a.job).toMatchObject({ ok: true, result: 'same' })
    expect(checked).toBe(0)

    const bad = createUpdater({ work, gdx: fakeGdx(work, `console.log('[gdx:step] fetch'); console.log('[gdx] помилка: нема місця на диску'); console.log('[gdx:exit]', 1); process.exitCode = 1`) })
    await bad.start('all')
    const b = await until(async () => { const s = await bad.status(); return s.job.running ? null : s })
    expect(b.job).toMatchObject({ ok: false, error: 'нема місця на диску', step: 'fetch' })
  })

  it('зупинка вбиває прогін', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gdu-'))
    const u = createUpdater({ work, gdx: fakeGdx(work, `console.log('[gdx:step] fetch'); setTimeout(() => {}, 60000)`) })
    await u.start('all')
    await until(async () => (await u.status()).job.step === 'fetch')
    const s = await u.stop()
    expect(s.job.stopped).toBe(true)
    const end = await until(async () => { const x = await u.status(); return x.job.running ? null : x })
    expect(end.job).toMatchObject({ ok: false, stopped: true, error: null })
  })
})

describe('parseLog: кольори', () => {
  it('ANSI-коди не заважають', () => {
    expect(parseLog('[gdx:step] check\n[gdx:exit] \x1b[33m0\x1b[39m').exit).toBe(0)
  })
})

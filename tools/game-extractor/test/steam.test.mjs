// Steam: розбір маніфесту депо (з -manifest-only), закріплений DepotDownloader, запуск процесів.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureDepotDownloader, parseManifest } from '../lib/steam.mjs'
import { run } from '../lib/run.mjs'

describe('Steam', () => {
  it('маніфест: id, дата, файли з розміром і SHA', () => {
    const m = parseManifest(fs.readFileSync(new URL('./fixtures/manifest_4754532.txt', import.meta.url), 'utf8'))
    expect(m.manifestId).toBe('7714035349234915047')
    expect(m.date).toBe('10/19/2026 13:58:35')
    expect(m.files['images/battlegroup/server.tar']).toEqual({ size: 4453453824, sha: 'b42fa11002a70add0717edc191c3ae345e1289da' })
    expect(m.files['images/battlegroup/version.txt'].sha).toBe('4fea2613a8143ee729f6320b5cc0102ba80b6cd5')
  })

  it('платформа без закріпленого хешу — помилка, нічого не качає', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-steam-'))
    await expect(ensureDepotDownloader(work, { platform: 'win32-x64' })).rejects.toThrow('нема закріпленого DepotDownloader для win32-x64')
    expect(fs.existsSync(path.join(work, 'tools'))).toBe(false)
  })

  it('run: ненульовий код — помилка з кодом і хвостом виводу', async () => {
    await expect(run('node', ['-e', 'console.log("hi"); process.exit(3)'])).rejects.toThrow(/код 3[\s\S]*hi/)
    expect((await run('node', ['-e', 'console.log("ok")'])).out.trim()).toBe('ok')
  })
})

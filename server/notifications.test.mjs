// Сповіщення сайту: згортання за ref (непрочитане оновлюється, а не множиться), прочитати вибрані / усі, межі людини,
// прибирання давніх прочитаних. Маршрути (/api/notifications) — у market.test.mjs, де сповіщення шле біржа.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDb } from './lib/sql.mjs'
import { createNotifications } from './lib/notifications.mjs'

describe('сповіщення', () => {
  let db, dir, n
  const sent = []
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-notes-'))
    db = await openDb({ dataDir: dir })
    n = await createNotifications(db, { push: (uid, ev) => sent.push([uid, ev]) })
  })
  afterAll(async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

  it('ref згортає непрочитане: count росте, рядок один; інший ref — новий рядок', async () => {
    await n.notify('u1', 'market.message', { deal: 'd1' }, { ref: 'd1' })
    await n.notify('u1', 'market.message', { deal: 'd1' }, { ref: 'd1' })
    let r = await n.list('u1')
    expect(r.unread).toBe(1)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ kind: 'market.message', data: { deal: 'd1' }, count: 2, read: false })
    await n.notify('u1', 'market.message', { deal: 'd2' }, { ref: 'd2' })
    r = await n.list('u1')
    expect(r.unread).toBe(2)
    // живий потік — лише цій людині, з лічильником
    expect(sent.at(-1)).toEqual(['u1', { op: 'note', unread: 2 }])
  })

  it('прочитати вибране й усе; чуже не чіпається; прочитане з тим самим ref — нове сповіщення', async () => {
    await n.notify('u2', 'market.offer', { deal: 'd9' })
    const [first] = (await n.list('u1')).rows
    expect(await n.read('u1', [first.id])).toBe(1)
    expect((await n.list('u1')).unread).toBe(1)
    // чужим id нічого не позначиш
    const other = (await n.list('u2')).rows[0]
    expect(await n.read('u1', [other.id])).toBe(0)
    expect((await n.list('u2')).unread).toBe(1)
    expect(await n.read('u1', 'all')).toBe(1)
    expect((await n.list('u1')).unread).toBe(0)
    await n.notify('u1', 'market.message', { deal: 'd1' }, { ref: 'd1' })
    const r = await n.list('u1')
    expect(r.unread).toBe(1)
    expect(r.rows).toHaveLength(3)
  })

  it('давні прочитані прибираються, непрочитані лишаються; людину видалено — усе її геть', async () => {
    const later = Date.now() + 91 * 86400_000
    expect(await n.purgeOld(later)).toBe(2)
    expect((await n.list('u1')).rows).toHaveLength(1)
    await n.forgetUser('u1')
    expect((await n.list('u1')).rows).toHaveLength(0)
    expect((await n.list('u2')).rows).toHaveLength(1)
  })
})

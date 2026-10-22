// «Будівельні елементи»: картка на сторінці бази й у редакторі складає рядки калькулятора за групами (B.groupOf) —
// сума за групами має збігатися з повним підрахунком моделі (B.budget) і для бази з деталей гри (рядки — форми
// деталей), і для давньої моделі (рядки — види). Раніше картка шукала рядки за видами й для нових баз показувала 0
// перекриттів і майже 0 фундаменту.
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const root = path.resolve(__dirname, '../..')
const BD = require(path.join(root, 'src/engine/hydrate.js'))
require(path.join(root, 'src/engine/build.js'))
const BUILD = (globalThis as unknown as { BUILD: { make: (M: unknown) => any } }).BUILD

/** групи з рядків калькулятора — так само, як картка Limits */
function cardGroups(B: any, res: any) {
  const n: Record<string, number> = { f: 0, d: 0, w: 0, o: 0 }
  for (const r of B.cost(res).rows) {
    const g = B.groupOf(r.id)
    if (g) n[g] += r.n
  }
  return n
}
const modelGroups = (B: any, res: any) => Object.fromEntries(B.budget(res).groups.filter((g: any) => g.id !== 'g').map((g: any) => [g.id, g.n]))

describe('будівельні елементи', () => {
  it('база з деталей гри: картка = модель, перекриття й похилі стіни враховано', () => {
    const pieces: Record<string, unknown>[] = []
    let n = 0
    const put = (shape: string, x: number, y: number, z: number, rot = 0) => pieces.push({ id: 'p' + n++, shape, x, y, z, rot })
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) put('Sardaukar_Foundation', i * 2 - 2, j * 2 + 1, 0)
    put('Sardaukar_Foundation_Wedge', 4, 1, 0)
    put('Sardaukar_Wall_01', -3, 1, 0, 90)
    put('Sardaukar_Floor_02', -1, 1, 4)
    put('Sardaukar_Floor_02', 1, 1, 4)
    put('Sardaukar_Floor_Wedge', 1, 3, 4)
    put('Sardaukar_Rooftop_01', -1, 3, 8)
    put('Sardaukar_Stairs', 1, 5, 0)
    const claims = [{ x: -5, y: 0, w: 10, d: 10 }]
    const bounds = BD.boundsOf(claims)
    const doc = BD.syncDoc({ schema: 2, format: 2, claims, bounds, pieces, items: [], zones: [], levels: [], heights: {}, ui: { name: 'x', views: BD.viewsOf(bounds) } })
    const B = BUILD.make(BD.hydrate(doc))
    const res = B.compute()
    const card = cardGroups(B, res)
    expect(card).toEqual(modelGroups(B, res))
    expect(card.d).toBeGreaterThanOrEqual(4)
    expect(card.f).toBeGreaterThanOrEqual(10)
  })

  it('давня база: сходи й колони, поставлені станціями, — окремі рядки (сходи не рахуються колонами)', () => {
    const doc = JSON.parse(require('node:fs').readFileSync(path.join(root, 'data/bases/main.json'), 'utf8'))
    const B = BUILD.make(BD.hydrate(doc))
    const rows = Object.fromEntries(B.cost(B.compute()).rows.map((r: any) => [r.id, r.n]))
    expect(rows.Sardaukar_Stairs).toBe(52)
    expect(rows.Sardaukar_Pillar_Middle).toBe(4)
  })

  it('усі деталі бази потрапляють у якусь групу (жоден вид не губиться)', () => {
    const P = require(path.join(root, 'src/engine/pieces.js'))
    const kinds = new Set(Object.values(P.SHAPES as Record<string, { kind?: string; family?: string }>).filter((s) => s.family !== 'shield' && s.kind).map((s) => s.kind as string))
    const doc = { schema: 2, format: 2, claims: [{ x: -5, y: 0, w: 10, d: 10 }], pieces: [], items: [], zones: [], levels: [], heights: {}, ui: { name: 'x' } }
    const B = BUILD.make(BD.hydrate(BD.syncDoc({ ...doc, bounds: BD.boundsOf(doc.claims) })))
    const shapeOfKind = (k: string) => Object.entries(P.SHAPES as Record<string, { kind?: string }>).find(([, s]) => s.kind === k)?.[0]
    for (const k of kinds) expect([k, B.groupOf(shapeOfKind(k))]).not.toEqual([k, null])
  })
})

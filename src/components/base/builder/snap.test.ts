import { describe, expect, it, vi } from 'vitest'

// справжні геометрія й деталі рушія (без вікна браузера)
vi.mock('@/lib/engine', async () => {
  // @ts-expect-error — рушій на чистому JS
  const g: any = await import('@/engine/geom.js') // eslint-disable-line @typescript-eslint/no-explicit-any
  // @ts-expect-error — рушій на чистому JS
  const p: any = await import('@/engine/pieces.js') // eslint-disable-line @typescript-eslint/no-explicit-any
  return { GEOM: g.default ?? (globalThis as any).GEOM, PIECES: p.default ?? (globalThis as any).PIECES, BASEDATA: {} } // eslint-disable-line @typescript-eslint/no-explicit-any
})
const { snap, check } = await import('./snap')

/* eslint-disable @typescript-eslint/no-explicit-any */
const P = (id: string, shape: string, x: number, y: number, z = 0, rot = 0): any => ({ id, shape, x, y, z, rot })
const hit = (piece: string | null, x: number, y: number, z: number, n: [number, number, number] = [0, 0, 1]): any => ({ piece, item: null, ground: !piece, point: { x, y, z }, normal: { x: n[0], y: n[1], z: n[2] } })
const r = (v: number) => Math.round(v * 1000) / 1000

describe('прив\'язка деталей', () => {
  const found = P('f', 'Sardaukar_Foundation', 0.5, 0.5, 0)
  it('фундамент на землі — клітинка сітки на 0; поруч із наявним — сусідня плитка', () => {
    const g = snap('Sardaukar_Foundation', hit(null, 3.3, 4.7, 0), [found])!
    expect([g.piece.x, g.piece.y, g.piece.z, g.ok]).toEqual([3.5, 4.5, 0, true])
    const n = snap('Sardaukar_Foundation', hit('f', 0.95, 0.5, 0), [found])! // біля правого краю
    expect([r(n.piece.x), r(n.piece.y), n.piece.z, n.ok]).toEqual([1.5, 0.5, 0, true])
  })

  it('стіна на верху плити — на найближчому краї; на стіну — вище', () => {
    const w = snap('Sardaukar_Wall_01', hit('f', 0.5, 0.06, 0), [found])!
    expect([w.piece.x, w.piece.y, w.piece.z, w.ok]).toEqual([0.5, 0, 0, true])
    const wall = { ...w.piece, id: 'w' }
    const up = snap('Sardaukar_Wall_01', hit('w', 0.5, 0.07, 0.6, [0, -1, 0]), [found, wall])!
    expect([up.piece.x, up.piece.y, up.piece.z, up.ok]).toEqual([0.5, 0, 1, true])
  })

  it('перекриття на верху стіни — плитка з того боку, звідки дивимось; R — з іншого', () => {
    const wall = P('w', 'Sardaukar_Wall_01', 0.5, 0, 0, 0)
    const a = snap('Sardaukar_Floor_02', hit('w', 0.5, -0.07, 0.9, [0, -1, 0]), [found, wall])! // дивимось ззовні (з −y)
    expect([r(a.piece.x), r(a.piece.y), a.piece.z]).toEqual([0.5, -0.5, 1])
    const b = snap('Sardaukar_Floor_02', hit('w', 0.5, -0.07, 0.9, [0, -1, 0]), [found, wall], 1)!
    expect([r(b.piece.x), r(b.piece.y), b.piece.z]).toEqual([0.5, 0.5, 1])
    expect(b.ok).toBe(true) // тримається на стіні
  })

  it('сходи на плиту — та сама плитка, піднімаються від найближчого краю', () => {
    const st = snap('Sardaukar_Stairs', hit('f', 0.5, 0.9, 0), [found])!
    expect([r(st.piece.x), r(st.piece.y), st.piece.z, st.ok]).toEqual([0.5, 0.5, 0, true])
    expect(st.piece.rot).toBe(180) // нижня сторона — верхній край (y = 1), підйом до y = 0
  })

  it('перевірка: налазить — червона з причиною; без опори — червона', () => {
    const wall = P('w', 'Sardaukar_Wall_01', 0.5, 0, 0, 0)
    expect(check(P('', 'Choam_Level2_Door_Frame', 0.5, 0, 0, 180), [found, wall])).toEqual({ ok: false, why: 'Тут уже стіна' })
    expect(check(P('', 'Sardaukar_Wall_01', 5.5, 5, 3, 0), [found]).ok).toBe(false)
    expect(check(P('', 'Sardaukar_Floor_02', 0.5, 1.5, 0), [found]).ok).toBe(true) // поруч із фундаментом на тій самій висоті
    expect(check(P('', 'Sardaukar_Foundation', 0.5, 1.5, 1), [found])).toEqual({ ok: false, why: 'Фундамент — лише на землі' })
    expect(check(P('', 'Sardaukar_Wall_01', 10.5, 10, 0), [found])).toEqual({ ok: false, why: 'На голу землю — лише фундамент: спершу постав фундамент' })
    expect(check(P('', 'Sardaukar_Stairs', 0.5, 0.5, 0), [found]).ok).toBe(true) // сходи на фундаменті
  })

  it('широкий прохід — на два краї в бік курсора', () => {
    const wide = [found, P('f2', 'Sardaukar_Foundation', 1.5, 0.5, 0)]
    const g = snap('Sardaukar_Door_Frame_Wide', hit('f', 0.8, 0.06, 0), wide)!
    expect([r(g.piece.x), g.piece.y, g.piece.z]).toEqual([1, 0, 0])
  })

  it('під дахом: навели на плиту знизу — напівстіна звисає з її краю (верх — на рівні даху), опора — плита над нею', () => {
    const wall = P('w', 'Sardaukar_Wall_01', 0.5, 0, 0, 0), roof = P('rf', 'Sardaukar_Rooftop_01', 0.5, 0.5, 2)
    const g = snap('Sardaukar_Wall_Half', hit('rf', 0.5, 0.05, 1.88, [0, 0, -1]), [found, roof])!
    expect([g.piece.x, g.piece.y, g.piece.z, g.ok]).toEqual([0.5, 0, 1.5, true])
    // під неї — трикутна стіна (навели на нижню половину напівстіни)
    const hw = { ...g.piece, id: 'hw' }
    const t = snap('Sardaukar_Wall_Triangle_Top_Left', hit('hw', 0.5, 0.07, 1.6, [0, -1, 0]), [found, roof, hw])!
    expect([t.piece.z, t.ok]).toEqual([0.5, true])
    // поручень не звисає — стає на дах
    const rl = snap('Sardaukar_Railing', hit('rf', 0.5, 0.05, 1.88, [0, 0, -1]), [found, roof])!
    expect(rl.piece.z).toBe(2)
    // звичайна стіна на стіні — як і раніше, вище
    expect(snap('Sardaukar_Wall_01', hit('w', 0.5, 0.07, 0.8, [0, -1, 0]), [found, wall])!.piece.z).toBe(1)
  })

  it('заокруглений поручень — на дугу заокругленого перекриття, вигином назовні', () => {
    const rf = P('rf', 'Sardaukar_Floor_Round_Corner_02', -9, 10.5, 9, 180)
    const g = snap('Sardaukar_Railing_Round_Corner', hit('rf', -9.3, 10.3, 9), [rf])!
    expect([r(g.piece.x), r(g.piece.y), g.piece.z, g.piece.rot, g.ok]).toEqual([-9, 10.5, 9, 135, true])
    // звичайний поручень на заокругленому — лише на прямому краї
    const f = snap('Sardaukar_Railing', hit('rf', -9.3, 10.3, 9), [rf])!.piece
    expect(Math.abs(f.x + 9) < 1e-6 && Math.abs(f.y - 10.5) < 1e-6).toBe(false)
  })

  it('колона — у найближчий кут плити чи в її центр (посеред трикутника)', () => {
    const h = Math.sqrt(3) / 2
    const tri = P('t', 'Sardaukar_Foundation_Wedge', 0.5, h / 3, 0, 0)
    const mid = snap('Sardaukar_Pillar_Middle', hit('t', 0.52, h / 3 + 0.02, 0), [tri])!
    expect([r(mid.piece.x), r(mid.piece.y), mid.piece.z, mid.ok]).toEqual([0.5, r(h / 3), 0, true])
    const corner = snap('Sardaukar_Pillar_Middle', hit('t', 0.05, 0.03, 0), [tri])!
    expect([r(corner.piece.x) + 0, r(corner.piece.y) + 0, corner.ok]).toEqual([0, 0, true])
  })

  it('біля ската: через верхній край — плитка на висоті верху (пласка середина даху), через нижній — на висоті низу', () => {
    // скат на +9: низ на y 0 (локальне −y), верх на y 1 — на висоті +10
    const sl = P('s', 'Sardaukar_Roof_01', 0.5, 0.5, 9, 0)
    const hi = snap('Sardaukar_Rooftop_01', hit('s', 0.5, 0.95, 9.9), [sl])!
    expect([r(hi.piece.x), r(hi.piece.y), hi.piece.z]).toEqual([0.5, 1.5, 10])
    const lo = snap('Sardaukar_Rooftop_01', hit('s', 0.5, 0.05, 9.1), [sl])!
    expect([r(lo.piece.x), r(lo.piece.y), lo.piece.z]).toEqual([0.5, -0.5, 9])
  })
})

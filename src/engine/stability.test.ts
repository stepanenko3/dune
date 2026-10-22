import { describe, expect, it } from 'vitest'
// @ts-expect-error — рушій на чистому JS, без типів
import * as st from './stability.js'

/* eslint-disable @typescript-eslint/no-explicit-any */
const ST: any = (st as any).default ?? (globalThis as any).STABILITY
const pc = (id: string, shape: string, x: number, y: number, z = 0, rot = 0) => ({ id, shape, x, y, z, rot })

describe('стабільність', () => {
  it('фундамент — 100; стіна на ньому й перекриття на стіні — без втрат; убік — мінус 10 за деталь, 10-те — 0', () => {
    const ps: any[] = [pc('f', 'Sardaukar_Foundation', 0.5, 0.5), pc('w', 'Sardaukar_Wall_01', 0.5, 1, 0), pc('w2', 'Sardaukar_Wall_01', 0.5, 1, 1)]
    for (let i = 0; i < 11; i++) ps.push(pc('c' + i, 'Sardaukar_Floor_02', 0.5, 1.5 + i, 2))
    const v = ST.compute(ps)
    expect(v.get('f')).toBe(100)
    expect(v.get('w2')).toBe(100)
    expect(v.get('c0')).toBe(100) // на верху стіни
    expect(v.get('c1')).toBe(90)
    expect(v.get('c9')).toBe(10)
    expect(v.get('c10')).toBe(0) // 10 деталей від опори — нестабільна
  })

  it('без шляху до фундаменту — 0; пентащит тримає лише пентащит; поручень на плиті — як плита', () => {
    const v = ST.compute([pc('f', 'Sardaukar_Foundation', 0.5, 0.5), pc('s1', 'Choam_PentashieldSurfaceVertical_Placeable', 0.5, 0, 0), pc('s2', 'Choam_PentashieldSurfaceVertical_Placeable', 0.5, 0, 1), pc('w', 'Sardaukar_Wall_01', 0.5, 0, 2), pc('r', 'Sardaukar_Railing', 0.5, 1, 0), pc('x', 'Sardaukar_Floor_02', 5.5, 5.5, 3)])
    expect(v.get('s2')).toBe(100)
    expect(v.get('w')).toBe(0) // стіна на пентащиті — без опори
    expect(v.get('r')).toBe(100)
    expect(v.get('x')).toBe(0)
  })

  it('скат кутом на колоні; перекриття в повітрі — 0; стіна, що звисає під перекриттям, — мінус 10 (примара — від найкращої опори)', () => {
    const base = [pc('f', 'Sardaukar_Foundation', 0.5, 0.5), pc('c', 'Sardaukar_Pillar_Middle', 1, 1, 0), pc('k', 'Sardaukar_Roof_Corner', 1.5, 1.5, 1, 0)]
    expect(ST.compute(base).get('k')).toBe(100)
    expect(ST.compute([...base, pc('air', 'Sardaukar_Floor_02', 0.5, 0.5, 2)]).get('air')).toBe(0)
    // перекриття на +2 на двох стінах (100), під ним звисає напівстіна на іншому краї
    const ps = [...base, pc('w', 'Sardaukar_Wall_01', 0.5, 1, 0), pc('wa', 'Sardaukar_Wall_01', 0.5, 1, 1), pc('fl', 'Sardaukar_Floor_02', 0.5, 0.5, 2)]
    const v = ST.compute(ps)
    expect(v.get('fl')).toBe(100)
    expect(ST.of(pc('h', 'Sardaukar_Wall_Half', 0.5, 0, 1.5), ps, v)).toBe(90)
  })

  it('колона посеред трикутника: тримається на трикутній плиті й тримає перекриття над собою', () => {
    const h = Math.sqrt(3) / 2
    const cy = h / 3 // центр трикутника з основою на y 0
    const ps = [pc('f', 'Sardaukar_Foundation_Wedge', 0.5, cy, 0, 0), pc('c', 'Sardaukar_Pillar_Middle', 0.5, cy, 0), pc('c2', 'Sardaukar_Pillar_Middle', 0.5, cy, 1), pc('t', 'Sardaukar_Floor_Wedge', 0.5, cy, 2, 0)]
    const v = ST.compute(ps)
    expect(v.get('c2')).toBe(100)
    expect(v.get('t')).toBe(100)
  })

  it('колона на куті трикутника не тримає його (лише з-під центру); на куті квадрата — тримає', () => {
    const h = Math.sqrt(3) / 2
    const base = [pc('f', 'Sardaukar_Foundation_Wedge', 0.5, h / 3, 0, 0), pc('c', 'Sardaukar_Pillar_Middle', 0, 0, 0)]
    // трикутне перекриття на +1 над колоною в його куті — нема опори
    expect(ST.compute([...base, pc('t', 'Sardaukar_Floor_Wedge', 0.5, h / 3, 1, 0)]).get('t')).toBe(0)
    // колона під центром — тримає
    expect(ST.compute([pc('f', 'Sardaukar_Foundation_Wedge', 0.5, h / 3, 0, 0), pc('c', 'Sardaukar_Pillar_Middle', 0.5, h / 3, 0), pc('t', 'Sardaukar_Floor_Wedge', 0.5, h / 3, 1, 0)]).get('t')).toBe(100)
    // квадрат кутом на колоні — тримає
    expect(ST.compute([pc('f', 'Sardaukar_Foundation', 0.5, 0.5), pc('c', 'Sardaukar_Pillar_Middle', 1, 1, 0), pc('s', 'Sardaukar_Floor_02', 1.5, 1.5, 1)]).get('s')).toBe(100)
  })
})

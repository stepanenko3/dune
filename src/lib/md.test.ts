import { describe, expect, it, vi } from 'vitest'

// md.tsx тягне стор застосунку (він читає location) — для чистої функції він не потрібен
vi.mock('@/store', () => ({ openPath: () => {} }))
const { safeImg } = await import('./md')

describe('картинки в розмітці роадмапу', () => {
  it('з CDN іконок гри й з цього сайту — можна', () => {
    // давня адреса CDN іконок гри — через наш проксі з медіатеки
    expect(safeImg('https://cdn-hosted.gaming.tools/dune/images/dune/x.webp')).toBe('/catalog-gt/images/dune/x.webp')
    expect(safeImg('/icons/x.png')).toBe('/icons/x.png')
  })
  it('чужі сайти, http, «//чужий» і javascript: — ні', () => {
    expect(safeImg('https://evil.example/pixel.gif')).toBeNull()
    expect(safeImg('http://cdn-hosted.gaming.tools/dune/x.webp')).toBeNull()
    expect(safeImg('https://cdn-hosted.gaming.tools.evil.example/x.webp')).toBeNull()
    expect(safeImg('//evil.example/x.png')).toBeNull()
    expect(safeImg('/\\evil.example/x.png')).toBeNull()
    expect(safeImg('javascript:alert(1)')).toBeNull()
  })
})

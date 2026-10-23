import { describe, expect, it } from 'vitest'
import { mediaInfo, ourImg } from './media'
import { iconUrl, wikiImg } from './catalog'

describe('адреси картинок', () => {
  it('наші — як є, дозволені чужі — наш проксі, решта — нічого', () => {
    expect(ourImg('/media/img/ab/c.webp#s=1x1')).toBe('/media/img/ab/c.webp#s=1x1')
    expect(ourImg('https://cdn.questlog.gg/dune-awakening/assets/Dune/GUI/T_A_D.webp')).toBe('/catalog-icons/assets/Dune/GUI/T_A_D.webp')
    expect(ourImg('https://media.awakening.wiki/wiki/a/ab/T_X.png')).toBe('/catalog-wiki/wiki/a/ab/T_X.png')
    expect(ourImg('https://cdn-hosted.gaming.tools/dune/images/dune/x.webp')).toBe('/catalog-gt/images/dune/x.webp')
    expect(ourImg('https://cdn-hosted.gaming.tools/dune/data/en/x.json')).toBeNull()
    expect(ourImg('https://cdn-hosted.gaming.tools/dune/images/../x.webp')).toBeNull()
    expect(ourImg('https://evil.example/x.png')).toBeNull()
    expect(ourImg('//evil.example/x.png')).toBeNull()
    expect(ourImg(null)).toBeNull()
  })
  it('розміри й заглушка з фрагмента', () => {
    expect(mediaInfo('/media/img/ab/c.webp#s=256x128&t=5iiGDQI3VMufZId4d5x3wGk')).toEqual({ src: '/media/img/ab/c.webp', w: 256, h: 128, thumb: '5iiGDQI3VMufZId4d5x3wGk' })
    expect(mediaInfo('/catalog-icons/x.webp')).toEqual({ src: '/catalog-icons/x.webp', w: null, h: null, thumb: null })
    expect(mediaInfo('/m.webp#t=<script>')).toEqual({ src: '/m.webp', w: null, h: null, thumb: null })
  })
  it('довідник: наша адреса — як є, шлях гри — проксі', () => {
    expect(iconUrl('/media/img/ab/c.webp')).toBe('/media/img/ab/c.webp')
    expect(iconUrl('assets/Dune/GUI/T_A_D')).toBe('/catalog-icons/assets/Dune/GUI/T_A_D.webp')
    expect(wikiImg('https://media.awakening.wiki/wiki/a/ab/T_X.png')).toBe('/catalog-wiki/wiki/a/ab/T_X.png')
    expect(wikiImg('/media/img/ab/c.webp#s=2x2')).toBe('/media/img/ab/c.webp#s=2x2')
  })
})

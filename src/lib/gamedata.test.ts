import { describe, expect, it } from 'vitest'
import { groupLabel, sourceAbout, sourceSub, sourceText, sourceTitle, stampTime, summaryText, type GdSection } from './gamedata'

const sec = (id: string, o: Partial<GdSection>): GdSection => ({ id, driver: 'community', count: 1, changedAt: null, checkedAt: null, since: null, status: 'ok', error: null, ...o })

describe('дата підпису «оновлено»', () => {
  it('остання реальна зміна; без змін — відколи стежимо; час перевірки не рахується', () => {
    const s = [sec('items', { changedAt: 2000, checkedAt: 9000, since: 100 }), sec('recipes', { since: 3000, checkedAt: 9000 }), sec('skills', { changedAt: 8000 })]
    expect(stampTime(s, ['items', 'recipes'])).toBe(3000)
    expect(stampTime(s, ['items'])).toBe(2000)
  })
  it('розділ лише з помилками (нема ні змін, ні since) — нема дати', () => {
    expect(stampTime([sec('items', { checkedAt: 9000, status: 'error' })], ['items'])).toBeNull()
  })
})

describe('підсумок зміни розділу', () => {
  it('додано, прибрано, змінено — через крапку, порожнє пропускає', () => {
    expect(summaryText({ added: 12, removed: 3, changed: 40, examples: [] })).toBe('+12 · −3 · змінено 40')
    expect(summaryText({ added: 2, removed: 0, changed: 0, examples: [] })).toBe('+2')
  })
  it('усе нуль (зміна без записів — мапа, картинки) — просто «змінено»', () => {
    expect(summaryText({ added: 0, removed: 0, changed: 0, examples: [] })).toBe('змінено')
  })
})

describe('назва джерела', () => {
  it('файли гри — з версією гри й збіркою; решта — конкретні сайти', () => {
    expect(sourceText({ id: 'gamefiles', names: [], build: '2160922', version: '1.5.15' })).toBe('Файли гри 1.5.15 · збірка 2160922')
    expect(sourceText({ id: 'community', names: ['questlog.gg', 'awakening.wiki'] })).toBe('questlog.gg + awakening.wiki')
    expect(sourceText(null, 'thgl')).toBe('TH.GL')
    expect(sourceText({ id: 'gamefiles', names: [], build: '2160000' })).toBe('Файли гри · збірка 2160000')
  })
})

describe('картка джерела', () => {
  it('назва — з версією гри, другий рядок — збірка; у сайтів спільноти другого рядка нема', () => {
    const gf = { id: 'gamefiles', names: [], build: '2160922', version: '1.5.15' }
    expect(sourceTitle(gf)).toBe('Файли гри 1.5.15')
    expect(sourceSub(gf)).toBe('збірка 2160922')
    expect(sourceTitle({ id: 'community', names: ['questlog.gg', 'awakening.wiki'] })).toBe('questlog.gg + awakening.wiki')
    expect(sourceSub({ id: 'community', names: ['questlog.gg'] })).toBeNull()
  })
  it('опис кожного джерела; невідоме — без опису', () => {
    for (const n of ['gamefiles', 'questlog.gg', 'awakening.wiki', 'gaming.tools', 'TH.GL']) expect(sourceAbout(n)).toBeTruthy()
    expect(sourceAbout('unknown.site')).toBeNull()
  })
})

describe('групи розділів', () => {
  it('назви груп', () => {
    expect(groupLabel('catalog')).toBe('Довідник')
    expect(groupLabel('map')).toBe('Мапа')
  })
})

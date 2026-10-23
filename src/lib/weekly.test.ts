// Тижневий розклад гільдії й кандидата в поясі глядача: зсув поясів, перехід через північ і через неділю, злиття й
// короткий підпис («пн–пт 20:00–23:00»).
import { describe, expect, it } from 'vitest'
import { hhmm, summary, toViewer, tzOffset, utcLabel } from './weekly'

// середа, 15 січня 2025 — зимовий час: Київ UTC+2, Чикаго UTC−6, Токіо UTC+9
const WINTER = Date.UTC(2025, 0, 15, 12)
// середа, 16 липня 2025 — літній: Київ UTC+3, Чикаго UTC−5
const SUMMER = Date.UTC(2025, 6, 16, 12)

describe('розклад у поясі глядача', () => {
  it('зсув поясів — з урахуванням літнього часу', () => {
    expect(tzOffset('Europe/Kyiv', WINTER)).toBe(120)
    expect(tzOffset('Europe/Kyiv', SUMMER)).toBe(180)
    expect(tzOffset('America/Chicago', SUMMER)).toBe(-300)
    expect(tzOffset('Nope/Nowhere', SUMMER)).toBe(0)
    expect(utcLabel('Asia/Kolkata', SUMMER)).toBe('UTC+5:30')
    expect(utcLabel('America/Chicago', WINTER)).toBe('UTC−6')
  })
  it('той самий пояс — як вписано; через північ — два відрізки', () => {
    expect(toViewer([{ days: [1], from: '20:00', to: '23:00' }], 'Europe/Kyiv', 'Europe/Kyiv', WINTER)).toEqual([{ day: 1, from: 1200, to: 1380 }])
    expect(toViewer([{ days: [6], from: '22:00', to: '02:00' }], 'Europe/Kyiv', 'Europe/Kyiv', WINTER)).toEqual([{ day: 0, from: 0, to: 120 }, { day: 6, from: 1320, to: 1440 }])
  })
  it('у Токіо вечір Києва — наступного дня; у Чикаго — в обід того ж дня; неділя переходить на понеділок', () => {
    // пн 20:00–23:00 Київ (UTC+2) = вт 03:00–06:00 Токіо (UTC+9)
    expect(toViewer([{ days: [1], from: '20:00', to: '23:00' }], 'Europe/Kyiv', 'Asia/Tokyo', WINTER)).toEqual([{ day: 2, from: 180, to: 360 }])
    // = пн 12:00–15:00 Чикаго (UTC−6)
    expect(toViewer([{ days: [1], from: '20:00', to: '23:00' }], 'Europe/Kyiv', 'America/Chicago', WINTER)).toEqual([{ day: 1, from: 720, to: 900 }])
    // нд 23:00–01:00 Чикаго = пн 07:00–09:00 Київ (з неділі — на понеділок по колу тижня)
    expect(toViewer([{ days: [0], from: '23:00', to: '01:00' }], 'America/Chicago', 'Europe/Kyiv', WINTER)).toEqual([{ day: 1, from: 420, to: 540 }])
  })
  it('кінець доби — 24:00, через північ — година наступного дня', () => {
    expect(hhmm(1440)).toBe('24:00')
    expect(hhmm(1440 + 120)).toBe('02:00')
    expect(hhmm(0)).toBe('00:00')
  })
  it('відрізки, що перекриваються, — злиті', () => {
    expect(toViewer([{ days: [3], from: '18:00', to: '21:00' }, { days: [3], from: '20:00', to: '22:00' }], 'UTC', 'UTC', WINTER)).toEqual([{ day: 3, from: 1080, to: 1320 }])
  })
  it('короткий підпис: дні поспіль — діапазоном, через північ — одним відрізком', () => {
    const s = toViewer([{ days: [1, 2, 3, 4, 5], from: '20:00', to: '23:00' }, { days: [6], from: '22:00', to: '02:00' }], 'UTC', 'UTC', WINTER)
    const text = summary(s)
    expect(text).toMatch(/20:00–23:00/)
    expect(text).toMatch(/22:00–02:00/)
    expect(text.split(';')).toHaveLength(2)
    expect(text).toMatch(/–.+ 20:00/) // пн–пт діапазоном
    expect(text.indexOf('20:00')).toBeLessThan(text.indexOf('22:00')) // будні — перші
  })
})

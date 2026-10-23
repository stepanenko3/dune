/*
 * Указ Ландсрааду на тиждень. У грі Ландсраад виграє фракція — Великий дім Атрідів чи Харконненів, — і указ обирають
 * лідери гільдій дому-переможця; діє він лише на людей цього дому (гра: «голосувати можуть лише ті, хто в союзі з
 * фракцією-переможцем»). На сайті указ один на всіх: його виставляє адміністрація в панелі керування (дозвіл
 * site.decree) разом із домом-переможцем; головна й калькулятор показують його й враховують лише для людей цього дому.
 * Дім людини — свій (профіль, users.house) або, якщо свій не вказано, дім її гільдії (guilds.house).
 * Гра указ назовні не віддає (ні API, ні вікі з поточним). Діє до кінця сесії Ландсрааду — до найближчої бурі
 * Коріоліса, після неї сам зникає.
 */
import { fail } from './util.mjs'

/** Великі доми, що змагаються в Ландсрааді (у грі — Factions_Name_Atreides / Factions_Name_Harkonnen) */
export const HOUSES = ['atreides', 'harkonnen']
const KNOWN = new Set(['tools', 'armor', 'weapons', 'vehicles', 'production', 'refining', 'ranged', 'melee', 'xp', 'salvage'])
const NONE = { id: null, until: null, setAt: null, house: null }

/** дім із запиту: atreides | harkonnen | null (порожньо — «не вказано») */
export function cleanHouse(v) {
  if (v === null || v === undefined || v === '') return null
  if (!HOUSES.includes(v)) throw fail('невідомий дім')
  return v
}

function check(id, until, house) {
  if (id === null) return null
  if (!KNOWN.has(id)) throw fail('невідомий указ')
  // указ обирає дім-переможець — без нього не знати, на кого він діє
  if (!HOUSES.includes(house)) throw fail('вкажи дім, що виграв Ландсраад')
  const max = Date.now() + 8 * 24 * 3600 * 1000
  if (!(Number.isFinite(until) && until > Date.now() && until <= max)) throw fail('хибний термін указу')
  return { id, until, house, setAt: Date.now() }
}
// давній указ (до домів) — без дому: діє на всіх, як і діяв
const live = (d) => (d && d.id && d.until > Date.now() ? { id: d.id, until: d.until, setAt: d.setAt || null, house: HOUSES.includes(d.house) ? d.house : null } : NONE)

/**
 * Чи діє указ на людину: true — так (її дім переміг або указ давній, без дому); false — ні (інший дім); null — невідомо
 * (дім не вказано) чи указу нема
 */
export function applies(decree, house) {
  if (!decree?.id) return null
  if (!decree.house) return true
  return house ? house === decree.house : null
}

export function createDecrees({ db, auth, guilds }) {
  // свій дім людини — стовпець users.house (додатковий, ідемпотентно); дім гільдії — guilds.house (lib/guilds.mjs)
  const ready = db.addColumn('users', 'house', 'TEXT')
  ready.catch(() => {}) // не вдалось — скажуть ті, хто чекає ready (а не падіння процесу)
  // указ — один на весь сайт (у грі він діє на весь сервер); зберігається в налаштуваннях сайту
  const read = async () => live(await auth.settings.get('decree', null))
  const api = {
    ready,
    /** указ сайту: { id, until, setAt, house, scope: { kind: 'site' } } */
    current: async () => ({ ...(await read()), scope: { kind: 'site' } }),
    /** вибрати указ із домом-переможцем (права — перевіряє маршрут: дозвіл site.decree) */
    async set(u, id, until, house) {
      await auth.settings.set('decree', id === null ? null : { ...check(id, until, house), by: u?.id ?? null })
      return api.current()
    },
    /** дім людини: own — свій (профіль), guild — дім її гільдії, house — який діє (свій, інакше гільдії) */
    async houseOf(uid) {
      if (!uid) return null
      await ready
      const own = cleanHouseSafe((await db.get('SELECT house FROM users WHERE id = ?', uid))?.house)
      const guild = cleanHouseSafe((await guilds.ofOne(uid))?.house)
      return { own, guild, house: own ?? guild }
    },
    /** свій дім людини (null — не вказано: тоді діє дім гільдії) */
    async setHouse(uid, house) {
      await ready
      await db.run('UPDATE users SET house = ? WHERE id = ?', cleanHouse(house), uid)
      return api.houseOf(uid)
    },
    /** давній указ (сайту чи гільдії Sandwalkers) → указ сайту, якщо його ще нема */
    async migrateLegacy(gid) {
      await ready
      let r = null
      try { r = await db.get("SELECT * FROM docs WHERE id = 'decree'") } catch { /* таблиці ще нема */ }
      if (r) {
        const d = JSON.parse(r.doc)
        if (d?.id && d.until > Date.now() && !(await read()).id) await auth.settings.set('decree', { id: d.id, until: d.until, setAt: r.updated })
        await db.run("DELETE FROM docs WHERE id = 'decree'")
      }
      const g = gid ? live(await guilds.decree(gid)) : NONE
      if (g.id && !(await read()).id) await auth.settings.set('decree', g)
    },
  }
  return api
}

/** дім із бази: невідоме значення — як «не вказано» (не валимо читання) */
const cleanHouseSafe = (v) => (HOUSES.includes(v) ? v : null)

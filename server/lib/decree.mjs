/*
 * Указ Ландсрааду на тиждень. У грі його обирає фракція-переможець Ландсрааду, і він діє на весь сервер — тож і на
 * сайті він один на всіх: його виставляє адміністрація в панелі керування (дозвіл site.decree), головна й калькулятор
 * лише показують і враховують. Гра указ назовні не віддає (ні API, ні вікі з поточним). Діє до кінця сесії
 * Ландсрааду — до найближчої бурі Коріоліса, після неї сам зникає.
 */
import { fail } from './util.mjs'

const KNOWN = new Set(['tools', 'armor', 'weapons', 'vehicles', 'production', 'refining', 'ranged', 'melee', 'xp', 'salvage'])
const NONE = { id: null, until: null, setAt: null }

function check(id, until) {
  if (id === null) return null
  if (!KNOWN.has(id)) throw fail('невідомий указ')
  const max = Date.now() + 8 * 24 * 3600 * 1000
  if (!(Number.isFinite(until) && until > Date.now() && until <= max)) throw fail('хибний термін указу')
  return { id, until, setAt: Date.now() }
}
const live = (d) => (d && d.id && d.until > Date.now() ? { id: d.id, until: d.until, setAt: d.setAt || null } : NONE)

export function createDecrees({ db, auth, guilds }) {
  // указ — один на весь сайт (у грі він діє на весь сервер); зберігається в налаштуваннях сайту
  const read = async () => live(await auth.settings.get('decree', null))
  const api = {
    /** указ сайту: { id, until, setAt, scope: { kind: 'site' } } */
    current: async () => ({ ...(await read()), scope: { kind: 'site' } }),
    /** вибрати указ (права — перевіряє маршрут: дозвіл site.decree) */
    async set(u, id, until) {
      await auth.settings.set('decree', id === null ? null : { ...check(id, until), by: u?.id ?? null })
      return api.current()
    },
    /** давній указ (сайту чи гільдії Sandwalkers) → указ сайту, якщо його ще нема */
    async migrateLegacy(gid) {
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

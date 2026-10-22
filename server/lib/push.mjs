/*
 * Нагадування про бурю Коріоліса — Web Push: приходять, навіть коли сайт закритий (браузер має працювати).
 * Ключі VAPID генеруються один раз і лежать у <dataDir>/push-vapid.json (у git не йде). Підписки — у базі:
 * для кожної — чия (лише людей, що увійшли: давні підписки без людини мовчать, доки браузер не підтвердить підписку
 * вже з входом), регіон сервера, за скільки годин нагадати (24 чи 12) і мова сайту людини (текст сповіщення — її
 * мовою, хоч сповіщає фонова перевірка без запиту). Раз на хвилину дивимось, кому пора.
 */
import fs from 'node:fs'
import path from 'node:path'
import webpush from 'web-push'
import { DEFAULT_LANG, langOf } from './gamedata.mjs'
import { fail, fill } from './util.mjs'
// розклад бурі (місцевий час регіону, з переходом на зимовий / літній) — спільний з мапою
import { nextReset, STORM_REGIONS } from './storm.mjs'

/** нагадування вже пішло про цю бурю: та сама буря ± кілька годин (розклад могли уточнити між нагадуваннями) */
const sameStorm = (a, b) => Math.abs(Number(a) - b) < 12 * 3600000

/**
 * Підписка — лише на адресу справжньої служби push браузера (Chrome/Android, Firefox, Safari, Edge): інакше будь-хто
 * змусив би сервер слати запити куди завгодно (зокрема в його ж мережу).
 */
const PUSH_HOST = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|[\w.-]+\.push\.services\.mozilla\.com|updates\.push\.services\.mozilla\.com|[\w.-]*push\.apple\.com|[\w.-]+\.notify\.windows\.com)\//

/** i18n — екземпляр з lib/i18n.mjs (переклад сповіщень); без нього сповіщення йдуть українською */
export async function createPush({ db, dataDir, log = console, i18n = null }) {
  const keyFile = path.join(dataDir, 'push-vapid.json')
  let keys
  try { keys = JSON.parse(fs.readFileSync(keyFile, 'utf8')) } catch {
    keys = webpush.generateVAPIDKeys()
    fs.writeFileSync(keyFile, JSON.stringify(keys))
  }
  // контакт для служб push — справжня адреса (Apple відкидає вигадану на кшталт @localhost)
  const contact = process.env.MAIL_FROM_ADDRESS ? `mailto:${process.env.MAIL_FROM_ADDRESS}` : process.env.APP_URL && /^https:\/\//.test(process.env.APP_URL) ? process.env.APP_URL : 'mailto:sandwalkers@localhost'
  webpush.setVapidDetails(contact, keys.publicKey, keys.privateKey)

  await db.exec(`CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY, sub TEXT NOT NULL, region TEXT NOT NULL, lead INTEGER NOT NULL,
    sent_for BIGINT NOT NULL DEFAULT 0, created BIGINT NOT NULL)`)
  // мова сайту, якою людина підписалась (текст сповіщення — нею)
  await db.addColumn('push_subs', 'lang', 'TEXT')
  // чия підписка: нагадування — лише людям, що увійшли
  await db.addColumn('push_subs', 'user_id', 'TEXT')
  /** перекладач для мови підписки (як req.t, але без запиту) */
  const translator = (lang) => {
    const l = langOf(lang) || DEFAULT_LANG
    return (key, vars) => (i18n ? i18n.t(l, key, vars) : fill(key, vars))
  }
  const del = (endpoint) => db.run('DELETE FROM push_subs WHERE endpoint = ?', endpoint)
  const all = () => db.all('SELECT * FROM push_subs WHERE user_id IS NOT NULL')

  const send = async (row, payload) => {
    try {
      await webpush.sendNotification(JSON.parse(row.sub), JSON.stringify(payload), { TTL: 6 * 3600 })
      return true
    } catch (e) {
      // підписку відкликали або браузер її забув — прибираємо
      if (e.statusCode === 404 || e.statusCode === 410) await del(row.endpoint)
      else log.warn?.('[push] не вдалося надіслати:', e.statusCode || e.message)
      return false
    }
  }
  const hoursLeft = (ms) => Math.max(1, Math.round(ms / 3600000))

  const tick = async () => {
    const now = Date.now()
    for (const row of await all()) {
      const next = nextReset(row.region, now)
      if (sameStorm(row.sent_for, next) || now < next - row.lead * 3600000) continue
      await db.run('UPDATE push_subs SET sent_for = ? WHERE endpoint = ?', next, row.endpoint) // спершу позначаємо — щоб не надіслати двічі, якщо відправка затягнеться
      const t = translator(row.lang)
      await send(row, {
        title: t('Буря Коріоліса через {n} год', { n: hoursLeft(next - now) }),
        body: t('Глибоку пустелю зітре: заберіть лут зі сховищ форпосту і виведіть техніку.'),
        // клік по нагадуванню — одразу на мапу Глибокої пустелі
        url: '/map?m=deepdesert_1',
        tag: 'storm-' + next,
      })
    }
  }
  const timer = setInterval(() => tick().catch(() => {}), 60_000)
  timer.unref?.()

  return {
    publicKey: keys.publicKey,
    /** lang — мова сайту людини (req.lang): сповіщення прийдуть нею */
    async subscribe(sub, region, lead, lang = DEFAULT_LANG, userId = null) {
      if (!userId) throw fail('нагадування — після входу', 401)
      if (!sub?.endpoint || !PUSH_HOST.test(String(sub.endpoint)) || String(sub.endpoint).length > 1000 || !sub.keys?.p256dh || !sub.keys?.auth || String(sub.keys.p256dh).length > 200 || String(sub.keys.auth).length > 100) throw fail('хибна підписка')
      if (!Object.hasOwn(STORM_REGIONS, region)) throw fail('невідомий регіон')
      if (lead !== 24 && lead !== 12) throw fail('нагадування — за 24 або 12 год')
      await db.run(`INSERT INTO push_subs (endpoint, sub, region, lead, sent_for, created, lang, user_id) VALUES (?, ?, ?, ?, 0, ?, ?, ?)
        ON CONFLICT (endpoint) DO UPDATE SET sub = excluded.sub, region = excluded.region, lead = excluded.lead, lang = excluded.lang, user_id = excluded.user_id`, sub.endpoint, JSON.stringify(sub), region, lead, Date.now(), langOf(lang) || DEFAULT_LANG, String(userId))
    },
    unsubscribe: (endpoint) => del(String(endpoint || '')),
    /** пробне сповіщення — переконатися, що все працює */
    test: async (endpoint, lang, userId) => {
      const row = await db.get('SELECT * FROM push_subs WHERE endpoint = ?', String(endpoint || ''))
      // пробне — лише на свою підписку
      if (!row || !userId || row.user_id !== String(userId)) return false
      // мову могли змінити після підписки — тестове сповіщення вже нею, і далі теж
      const l = langOf(lang) || row.lang
      if (l && l !== row.lang) await db.run('UPDATE push_subs SET lang = ? WHERE endpoint = ?', l, row.endpoint)
      const t = translator(l)
      return send(row, { title: t('Нагадування увімкнено'), body: t('Сповіщу за {n} год до бурі Коріоліса.', { n: row.lead }), url: '/map?m=deepdesert_1', tag: 'storm-test' })
    },
    /** людину видалено — її нагадування теж */
    forgetUser: (userId) => db.run('DELETE FROM push_subs WHERE user_id = ?', String(userId)),
    close: () => clearInterval(timer),
  }
}

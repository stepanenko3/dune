/*
 * Discord: повідомлення у вебхук каналу (без бота й без публічної адреси сайту). Адреса — лише справжній вебхук
 * Discord: інакше будь-хто змусив би сервер слати запити куди завгодно (зокрема в його ж мережу).
 */
import { fail } from '../util.mjs'

/** ключ перекладу помилки (у базі — український текст; показує сайт мовою людини) */
const t = (k) => k

const WEBHOOK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d{5,25})\/([\w-]{20,120})\/?$/

export const isWebhook = (url) => typeof url === 'string' && WEBHOOK.test(url.trim())

/** відповідь служби → { ok } | { ok: false, permanent, error, retryAfter } */
async function outcome(res) {
  if (res.ok) return { ok: true }
  let body = null
  try { body = await res.json() } catch { /* не JSON */ }
  if (res.status === 429) return { ok: false, permanent: false, error: t('Discord: забагато повідомлень'), retryAfter: Math.ceil(Number(body?.retry_after ?? 5) * 1000) }
  // вебхук видалено чи токен хибний — повторювати марно
  if ([401, 403, 404].includes(res.status)) return { ok: false, permanent: true, error: t('Discord: вебхук видалено чи недійсний') }
  return { ok: false, permanent: false, error: t('Discord зараз не відповідає — спробуй трохи згодом') }
}

export function createDiscord({ fetch: doFetch }) {
  /** одна форма адреси (discord.com, без хвостового /): той самий вебхук двічі не підключиться */
  const normalize = (url) => {
    const m = WEBHOOK.exec(String(url).trim())
    return `https://discord.com/api/webhooks/${m[1]}/${m[2]}`
  }
  return {
    normalize,
    /** вебхук живий: назва вебхука (для картки каналу); ні — помилка з поясненням */
    async check(url) {
      if (!isWebhook(url)) throw fail('це не адреса вебхука Discord', 400, { fieldKey: 'url' })
      let res
      try { res = await doFetch(normalize(url), { method: 'GET', signal: AbortSignal.timeout(10_000) }) } catch { throw fail('Discord зараз не відповідає — спробуй трохи згодом', 503) }
      if (!res.ok) throw fail('Discord не знає такого вебхука — скопіюй адресу ще раз', 400, { fieldKey: 'url' })
      const info = await res.json().catch(() => ({}))
      return { name: info?.name ? String(info.name).slice(0, 80) : null }
    },
    /** msg — { title, text, url, color, time } з messages.mjs */
    async send(url, msg) {
      const embed = { title: msg.title?.slice(0, 256), description: msg.text?.slice(0, 4000) || undefined, url: msg.url || undefined, color: msg.color ?? undefined, timestamp: msg.time ? new Date(msg.time).toISOString() : undefined, footer: { text: 'Sandwalkers' } }
      try {
        const res = await doFetch(url + '?wait=true', {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
          body: JSON.stringify({ username: 'Sandwalkers', embeds: [embed], allowed_mentions: { parse: [] } }),
        })
        return await outcome(res)
      } catch {
        return { ok: false, permanent: false, error: t('Discord зараз не відповідає — спробуй трохи згодом') }
      }
    },
  }
}

/*
 * Telegram: бот сайту (TELEGRAM_BOT_TOKEN у .env). Повідомлення — sendMessage з HTML; оновлення (людина натиснула
 * «Start» з кодом, бота додали чи прибрали з групи) — довгим опитуванням getUpdates: публічна адреса сайту не потрібна.
 * Без токена бот вимкнено.
 */
const API = 'https://api.telegram.org'
/** ключ перекладу помилки (у базі — український текст; показує сайт мовою людини) */
const t = (k) => k

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** повідомлення як HTML Telegram: жирний заголовок, текст, посилання */
export function telegramHtml(msg) {
  const parts = []
  if (msg.title) parts.push(`<b>${esc(msg.title)}</b>`)
  if (msg.text) parts.push(esc(msg.text))
  if (msg.url) parts.push(`<a href="${esc(msg.url)}">${esc(msg.link || msg.url)}</a>`)
  return parts.join('\n\n')
}

export function createTelegram({ fetch: doFetch, token, log = console }) {
  const call = async (method, body, timeout = 15_000) => {
    const res = await doFetch(`${API}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(timeout) })
    const j = await res.json().catch(() => ({ ok: false, description: String(res.status) }))
    return { status: res.status, ...j }
  }
  let meCache = null

  return {
    enabled: !!token,
    async me() {
      if (meCache) return meCache
      try { const r = await call('getMe'); if (r.ok) meCache = r.result } catch { /* мережа */ }
      return meCache
    },
    async send(chatId, msg) {
      if (!token) return { ok: false, permanent: false, error: t('Telegram-бот сайту ще не налаштовано') }
      try {
        const r = await call('sendMessage', { chat_id: chatId, text: telegramHtml(msg), parse_mode: 'HTML', link_preview_options: { is_disabled: !msg.url } })
        if (r.ok) return { ok: true }
        if (r.status === 429) return { ok: false, permanent: false, error: t('Telegram: забагато повідомлень'), retryAfter: (r.parameters?.retry_after ?? 5) * 1000 }
        // бота заблоковано, вигнано, чату нема — повторювати марно
        if (r.status === 403 || (r.status === 400 && /chat not found|bot was kicked|not a member/i.test(r.description ?? ''))) return { ok: false, permanent: true, error: t('Telegram: бота заблоковано чи прибрано з чату') }
        return { ok: false, permanent: false, error: t('Telegram зараз не відповідає — спробуй трохи згодом') }
      } catch {
        return { ok: false, permanent: false, error: t('Telegram зараз не відповідає — спробуй трохи згодом') }
      }
    },
    /** опитування оновлень: onUpdate(u) на кожне; start/stop */
    poll(onUpdate) {
      let on = false, offset = 0
      const loop = async () => {
        while (on) {
          try {
            const r = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'my_chat_member'] }, 35_000)
            if (!r.ok) { await new Promise((d) => setTimeout(d, 10_000)); continue }
            for (const u of r.result ?? []) { offset = u.update_id + 1; await onUpdate(u) }
          } catch (e) {
            if (on) { log.warn?.(`[notify] telegram getUpdates: ${e?.message || e}`); await new Promise((d) => setTimeout(d, 10_000)) }
          }
        }
      }
      return { start: () => { if (!on) { on = true; loop() } }, stop: () => { on = false } }
    },
  }
}

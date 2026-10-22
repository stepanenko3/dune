/*
 * Листи (коди входу) через SMTP з .env: MAIL_HOST, MAIL_PORT, MAIL_USERNAME, MAIL_PASSWORD, MAIL_ENCRYPTION
 * (tls/ssl — шифрування), MAIL_FROM_ADDRESS, MAIL_FROM_NAME. У розробці це Mailpit зі Snotax console (скринька —
 * http://127.0.0.1:8025/proxy/mailpit/). Без MAIL_HOST лист не йде, а код пишеться в журнал сервера — щоб і так можна було увійти.
 */
import { createRequire } from 'node:module'
import { fill } from './util.mjs'

const require = createRequire(import.meta.url)
const val = (v) => (v && v !== 'null' ? v : '')

export function createMailer(env = process.env, log = console) {
  const host = val(env.MAIL_HOST)
  const from = { name: val(env.MAIL_FROM_NAME) || 'Sandwalkers', address: val(env.MAIL_FROM_ADDRESS) || 'noreply@dune.test' }
  let transport = null
  if (host) {
    const nodemailer = require('nodemailer')
    const enc = val(env.MAIL_ENCRYPTION).toLowerCase()
    const port = Number(env.MAIL_PORT) || 587
    transport = nodemailer.createTransport({
      host,
      port,
      secure: enc === 'ssl' || port === 465,
      // Mailpit і подібні — без TLS; справжній SMTP — STARTTLS, якщо сервер його пропонує
      ignoreTLS: !enc && (port === 1025 || host === '127.0.0.1' || host === 'localhost'),
      auth: val(env.MAIL_USERNAME) ? { user: val(env.MAIL_USERNAME), pass: val(env.MAIL_PASSWORD) } : undefined,
    })
  }
  return {
    ready: !!transport,
    async send({ to, subject, text, html }) {
      if (!transport) {
        log.info?.(`[mail] SMTP не налаштовано — лист для ${to}: ${subject}\n${text}`)
        return
      }
      await transport.sendMail({ from, to, subject, text, html })
    },
  }
}

/** лист із кодом входу мовою людини (t — перекладач запиту) */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/** лист із кодом; fresh — пошта ще не зареєстрована (сайт про це не каже на сторінці, лише в листі власнику пошти) */
export function codeLetter(code, { site, name = 'Sandwalkers', t = (k, v) => fill(k, v), fresh = false } = {}) {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`
  const isNew = fresh ? t('Це нова пошта — після входу з’явиться твій обліковий запис.') : ''
  return {
    subject: t('Код входу: {code}', { code: spaced }),
    text: `${t('Твій код входу в {name}: {code}', { name, code })}\n\n${isNew ? isNew + '\n' : ''}${t('Діє 10 хвилин. Якщо ти не входив на {site}, просто не зважай на цей лист.', { site })}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1f1a14">
<p style="margin:0 0 6px;font-size:14px;color:#6b5f52">${esc(name)} · ${esc(t('код входу'))}</p>
<p style="margin:0 0 18px;font-size:34px;font-weight:700;letter-spacing:6px">${spaced}</p>
<p style="margin:0 0 6px;font-size:14px">${esc(t('Введи його на сторінці входу. Код діє 10 хвилин.'))}</p>
${isNew ? `<p style="margin:0 0 6px;font-size:14px">${esc(isNew)}</p>\n` : ''}<p style="margin:0;font-size:12px;color:#8a7d6e">${esc(t('Якщо ти не входив на {site}, просто не зважай на цей лист.', { site }))}</p></div>`,
  }
}

/** лист замість коду, коли нових людей сайт зараз не приймає (сторінка входу відповідає однаково для будь-якої пошти) */
export function closedLetter({ site, name = 'Sandwalkers', t = (k, v) => fill(k, v) } = {}) {
  const body = t('Реєстрацію на {name} зараз закрито — увійти можна лише з поштою, яка вже має обліковий запис.', { name })
  const tail = t('Якщо ти не входив на {site}, просто не зважай на цей лист.', { site })
  return {
    subject: t('{name}: реєстрацію зараз закрито', { name }),
    text: `${body}\n\n${tail}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#1f1a14">
<p style="margin:0 0 12px;font-size:14px">${esc(body)}</p>
<p style="margin:0;font-size:12px;color:#8a7d6e">${esc(tail)}</p></div>`,
  }
}

/*
 * Прев'ю посилань (Discord, Telegram, пошук): сервер сам вписує в сторінку заголовок, опис і картинку того, на що
 * веде адреса — база (зі знімком 3D), роадмап, білд, людина, гільдія, подія (коли, формат, призи). Лише те, що видно без входу (публічне чи «за
 * посиланням»); решта — загальний опис сайту, без жодного слова про приховане. Мова — мовою запиту (у ботів
 * зазвичай українська за замовчуванням).
 */
import fs from 'node:fs'
import { can } from './items.mjs'
import { STORM_REGIONS } from './storm.mjs'
import { endsOf, EVENT_TYPE_L, formatOf } from './events.mjs'
import { profileFor } from './guild-profile.mjs'

/** регіони гри — коротко, як у грі (не перекладаються); стилі гри гільдії — ключі перекладу */
const REGION_L = { eu: 'EU', na: 'NA', sa: 'SA', oce: 'OCE' }
const STYLE_L = { pve: 'PvE', pvp: 'PvP', dd: 'Глибока пустеля', craft: 'Крафт', trade: 'Торгівля' }

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cut = (s, n) => { const x = String(s || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1).trimEnd() + '…' : x }
const SITE = 'Sandwalkers'

export function createOg({ file, db, items, auth, guilds, thumbs, access, events }) {
  // index.html збірки — перечитуємо, лише коли файл змінився (нова збірка)
  let html = '', at = 0
  const page = () => {
    try {
      const m = fs.statSync(file).mtimeMs
      if (m !== at) { html = fs.readFileSync(file, 'utf8'); at = m }
    } catch { /* без збірки — порожньо */ }
    return html
  }

  /** річ, яку бачить людина без входу (інакше — нічого) */
  const open = async (kind, id) => {
    const it = await items.get(kind, id).catch(() => null)
    if (!it) return null
    return can(await access.ctxOf(null), it).view ? it : null
  }

  /** що сказати про адресу: { title, description, image? } або null — загальний опис */
  async function about(req) {
    const t = req.t
    const [, a, b, c] = req.path.split('/')
    const id = b ? decodeURIComponent(b) : ''
    if (a === 'bases' && id === 'generate') return { title: t('Генератор баз'), description: t('База з деталей гри за твоїми ділянками й потребами') }
    if (a === 'bases' && id && c !== 'edit') {
      const it = await open('base', id)
      if (!it) return null
      const row = await db.get('SELECT version, deleted FROM bases WHERE id = ?', id).catch(() => null)
      if (!row || row.deleted) return null
      return { title: it.title || t('База'), description: it.summary || t('База в Dune: Awakening — план, 3D і кошторис на Sandwalkers.'), image: thumbs?.url(id, row.version) || null, large: true }
    }
    if (a === 'roadmap' && id) {
      const it = await open('roadmap', id)
      return it ? { title: it.title || t('Роадмап'), description: it.summary || t('Що будувати далі, скільки коштує і що вже зроблено.') } : null
    }
    if (a === 'events' && id && events) {
      const it = await open('event', id)
      const ev = it && (await events.get(id))
      if (!ev) return null
      // час — за поясом серверів регіону події (у бота свого поясу нема), з назвою поясу
      const tz = STORM_REGIONS[ev.region]?.tz || 'UTC'
      let when = ''
      try { when = new Intl.DateTimeFormat(req.lang || 'uk', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(ev.starts) } catch { when = new Date(ev.starts).toISOString() }
      const state = ev.cancelled ? t('Скасовано') : endsOf(ev) <= Date.now() ? t('Завершено') : ''
      const prizes = ev.prizes.slice(0, 3).map((p) => (p.label ? `${p.label}: ${p.prize}` : p.prize)).join('; ')
      const head = [state, when, `${t(EVENT_TYPE_L[ev.type] || 'Подія')} · ${formatOf(ev, t)}`, ev.server].filter(Boolean).join(' · ')
      return { title: it.title, description: [head, prizes && `${t('Призи')}: ${prizes}`, cut(ev.about, 120)].filter(Boolean).join('. ') }
    }
    if (a === 'u' && id) {
      const u = await auth.byLogin(id)
      return u && !u.banned ? { title: u.name, description: cut(u.bio, 200) || t('Сторінка гравця на Sandwalkers') } : null
    }
    if (a === 'g' && id) {
      const g = await guilds.get(id)
      if (!g) return null
      // лише те, що гільдія показує всім (картка для чужого — profileFor)
      const p = profileFor(await guilds.profile(g.id), {})
      const lang = (code) => { try { return new Intl.DisplayNames([req.lang || 'uk'], { type: 'language' }).of(code) || code } catch { return code } }
      const facts = [
        g.open ? t('Набір відкрито') : t('Лише за запрошенням'),
        [p.region ? REGION_L[p.region] : '', p.server].filter(Boolean).join(' · '),
        p.langs.map(lang).join(', '),
        p.styles.map((s) => t(STYLE_L[s])).join(', '),
        t('Учасників: {n}', { n: await guilds.memberCount(g.id) }),
      ].filter(Boolean).join(' · ')
      const about = p.show.about === 'public' ? cut(g.about, 140) : ''
      return { title: `[${g.tag}] ${g.name}`, description: [facts, about].filter(Boolean).join('. ') || t('Гільдія на Sandwalkers'), image: p.emblem || null }
    }
    if (a === 'skills' && req.query.build) {
      const it = await open('build', String(req.query.build))
      return it ? { title: it.title || t('Білд умінь'), description: it.summary || t('Білд умінь для Dune: Awakening') } : null
    }
    if (a === 'calculator' && req.query.calc) {
      const it = await open('calc', String(req.query.calc))
      return it ? { title: it.title || t('Розрахунок'), description: it.summary || t('Скільки сировини, крафтів, води й часу на набір предметів і будівель') } : null
    }
    return null
  }

  /** сторінка з метатегами для цієї адреси */
  async function render(req) {
    const src = page()
    if (!src) return src
    const t = req.t
    const origin = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    const info = await about(req).catch(() => null)
    const title = info ? `${cut(info.title, 90)} · ${SITE}` : `${SITE} · Dune: Awakening`
    const description = cut(info?.description || t('Гільдійський помічник для Dune: Awakening: бази в 3D, роадмапи, мапа з ресурсами, довідник, калькулятор і вміння.'), 200)
    const image = origin + (info?.image || '/icons/icon-512.png')
    const tags = [
      `<meta name="description" content="${esc(description)}" />`,
      `<meta property="og:site_name" content="${SITE}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(description)}" />`,
      `<meta property="og:url" content="${esc(origin + req.originalUrl)}" />`,
      `<meta property="og:image" content="${esc(image)}" />`,
      `<meta name="twitter:card" content="${info?.large && info.image ? 'summary_large_image' : 'summary'}" />`,
    ].join('\n    ')
    return src
      .replace(/<meta (?:name|property)="(?:description|og:[^"]+|twitter:[^"]+)"[^>]*>\s*/g, '')
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace('</head>', `  ${tags}\n  </head>`)
  }
  return { render }
}

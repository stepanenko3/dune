/*
 * Тексти сповіщень за темою — мовою каналу (t — переклад мовою каналу; третім аргументом, щоб збирач перекладів бачив
 * t('…')). Повідомлення: { title, text, url, link, color, time }. Час події: у Discord — позначка <t:…>, яку кожен бачить у своєму часовому поясі; у Telegram — UTC.
 */
import { EVENT_TYPE_L } from '../events.mjs'

const COLOR = { 'event.new': 0xd9822b, 'event.soon': 0xe0b23a, 'patch.new': 0x5b8def, test: 0x6aa84f }
/** за скільки хвилин до початку — «скоро почнеться» */
export const SOON_MIN = 30

function when(ms, { lang, kind }) {
  const s = Math.floor(ms / 1000)
  if (kind === 'discord') return `<t:${s}:F> (<t:${s}:R>)`
  try {
    return new Intl.DateTimeFormat(lang, { timeZone: 'UTC', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(ms) + ' UTC'
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
  }
}

const RENDER = {
  test: (d, o, t) => ({ title: t('Сповіщення Sandwalkers підключено'), text: t('Сюди приходитимуть вибрані сповіщення сайту.'), url: `${o.site}/notify`, link: t('Налаштувати сповіщення') }),
  'event.new': (d, o, t) => ({
    title: t('Нова подія: {title}', { title: d.title }),
    text: `${t(EVENT_TYPE_L[d.type] ?? 'Подія')} · ${when(d.starts, o)}`,
    url: `${o.site}/events/${d.id}`, link: t('Відкрити подію'), time: d.starts,
  }),
  'event.soon': (d, o, t) => ({
    title: t('За {n} хв: {title}', { n: SOON_MIN, title: d.title }),
    text: `${t(EVENT_TYPE_L[d.type] ?? 'Подія')} · ${when(d.starts, o)}`,
    url: `${o.site}/events/${d.id}`, link: t('Відкрити подію'), time: d.starts,
  }),
  // відповіді бота в Telegram (не теми): посилання застаріло чи вже використане
  linkGone: (d, o, t) => ({ title: t('Посилання застаріло'), text: t('Візьми нове на сайті: сторінка «Сповіщення в Discord і Telegram».'), url: `${o.site}/notify`, link: t('Налаштувати сповіщення') }),
  'patch.new': (d, o, t) => {
    const sum = Object.values(d.summary ?? {}).reduce((a, x) => ({ added: a.added + (x.added || 0), removed: a.removed + (x.removed || 0), changed: a.changed + (x.changed || 0) }), { added: 0, removed: 0, changed: 0 })
    return {
      title: d.version ? t('Оновлення гри {version}', { version: d.version }) : t('Оновлення гри (збірка {build})', { build: d.build }),
      text: t('Нового: {added} · прибрано: {removed} · змінено: {changed}', sum),
      url: `${o.site}/patches/${d.build}`, link: t('Що змінилось'),
    }
  },
}

/** повідомлення теми; o — { t, lang, site, kind } */
export function renderMessage(topic, data, o) {
  const r = RENDER[topic]
  if (!r) throw new Error(`нема тексту для теми ${topic}`)
  return { color: COLOR[topic], ...r(data ?? {}, o, o.t) }
}

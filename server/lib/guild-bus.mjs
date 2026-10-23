/*
 * Події набору гільдії — в одному місці на сервері: маршрути гільдій кажуть, що сталося, а хто на це відповідає
 * (сповіщення на сайті, згодом — бот Discord/Telegram), підписується тут, не чіпаючи маршрутів.
 *
 * Подія: { type, guild: { id, slug, name, tag }, user (кандидат), by (хто зробив; для submitted — сам кандидат),
 * reason?, at }. type: 'submitted' (подано чи подано знову), 'edited' (кандидат змінив чекаючу заявку), 'withdrawn'
 * (кандидат відкликав), 'accepted' (прийнято за заявкою), 'rejected' (відхилено з причиною), 'commented' (офіцер
 * прокоментував; кандидат не бачить).
 * Слухач, що впав, не заважає іншим і самому маршруту — помилку лише записуємо в журнал.
 */
export const GUILD_EVENTS = ['submitted', 'edited', 'withdrawn', 'accepted', 'rejected', 'commented']

export function createGuildBus({ log = console } = {}) {
  const fns = new Set()
  return {
    /** підписатись: fn(подія) — може бути async; повертає «відписатись» */
    on(fn) { fns.add(fn); return () => fns.delete(fn) },
    /** розіслати (чекає всіх слухачів, але їхні помилки не прокидає) */
    async emit(ev) {
      const e = { ...ev, at: ev.at ?? Date.now() }
      await Promise.all([...fns].map((fn) => Promise.resolve().then(() => fn(e)).catch((err) => log.warn?.(`[guild-bus] ${e.type}: ${err?.message || err}`))))
    },
  }
}

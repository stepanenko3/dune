/*
 * Сітка на вибування (single elimination) для турнірів подій — та сама логіка в браузері й на сервері (сервер так само
 * перераховує сітку, яку прислали, і бере з неї лише перший раунд і вибір переможців).
 *
 * seed — команди першого раунду за місцями в сітці (довжина — степінь двійки, null — пропуск); picks — хто переміг у
 * кожному матчі, за раундами: 'a' (верхня), 'b' (нижня) чи null (ще не зіграно). Матчі наступних раундів не
 * зберігаються — вони завжди з переможців попередніх, тож сітка не може «розійтися» сама з собою. Пропуск проходить
 * далі сам; матч, де ще не визначено суперника, чекає.
 */

/** найменша степінь двійки, у яку влазять n команд (щонайменше 2) */
export function bracketSize(n) {
  let s = 2
  while (s < n) s *= 2
  return s
}

/** місця посіву в сітці: 1 проти останнього, 2 проти передостаннього… і сильні не зустрічаються до кінця (1, 8, 4, 5, 2, 7, 3, 6) */
function positions(size) {
  if (size <= 2) return [1, 2]
  return positions(size / 2).flatMap((p) => [p, size + 1 - p])
}

/** команди за посівом (перша — найсильніша) → перший раунд; пропуски дістаються найсильнішим, два пропуски не зійдуться */
export function seedOf(ids) {
  const size = bracketSize(ids.length)
  return positions(size).map((p) => ids[p - 1] ?? null)
}

/**
 * Усі матчі сітки: rounds[r][i] = { a, b, w, aBye, bBye, auto } — команди (id чи null), хто переміг ('a' | 'b' | null),
 * чи сторона — пропуск, auto — пройшов без гри. champion — переможець фіналу (чи null).
 */
export function matchesOf(seed, picks = []) {
  const rounds = []
  // сторона матчу: { id } — команда, { bye } — пропуск, {} — ще не визначено
  let sides = (seed || []).map((id) => (id ? { id } : { bye: true }))
  for (let r = 0; sides.length > 1; r++) {
    const round = [], next = []
    for (let i = 0; i + 1 < sides.length; i += 2) {
      const a = sides[i], b = sides[i + 1]
      const pick = picks?.[r]?.[i / 2]
      let w = null, auto = false
      if (a.bye && b.bye) next.push({ bye: true })
      else if (a.bye || b.bye) {
        const x = a.bye ? b : a
        if (x.id) { w = a.bye ? 'b' : 'a'; auto = true; next.push({ id: x.id }) } else next.push({})
      } else if (a.id && b.id) {
        w = pick === 'a' || pick === 'b' ? pick : null
        next.push(w ? { id: w === 'a' ? a.id : b.id } : {})
      } else next.push({})
      round.push({ a: a.id ?? null, b: b.id ?? null, w, aBye: !!a.bye, bBye: !!b.bye, auto })
    }
    rounds.push(round)
    sides = next
  }
  const final = rounds.at(-1)?.[0]
  return { rounds, champion: final?.w ? final[final.w] : null }
}

/** вибір переможців без зайвого: лише в матчах, де є обидві команди (решта — null) */
export const cleanPicks = (seed, picks) => matchesOf(seed, picks).rounds.map((r) => r.map((m) => (m.a && m.b ? m.w : null)))

/** місця з завершеної частини сітки: [[переможець], [фіналіст], [обидва півфіналісти]] — порожні, поки не зіграно */
export function placesOf(seed, picks) {
  const { rounds, champion } = matchesOf(seed, picks)
  const lost = (m) => (m && m.w && m.a && m.b ? m[m.w === 'a' ? 'b' : 'a'] : null)
  const final = rounds.at(-1)?.[0]
  const semis = rounds.length >= 2 ? rounds.at(-2) : []
  return [champion ? [champion] : [], lost(final) ? [lost(final)] : [], semis.map(lost).filter(Boolean)]
}

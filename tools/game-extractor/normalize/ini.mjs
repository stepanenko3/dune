/*
 * Конфіги Unreal (DefaultGame.ini): секції й ключі; масиви за правилами UE — «!Key=» очищує, «.Key=» додає завжди,
 * «+Key=» додає, якщо такого значення ще нема, «-Key=» прибирає, просто «Key=» — одне значення. Значення структур
 * («(("A", (B=1,C="x")),…)») розбирає parseUeStruct.
 */

/** текст ini → { секція: { ключ: [значення…] } } */
export function parseIni(text) {
  const out = {}
  let sec = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const s = /^\[(.+)\]$/.exec(line)
    if (s) { sec = out[s[1]] ??= {}; continue }
    if (!sec) continue
    const m = /^([!.+-]?)([^=]+?)=(.*)$/.exec(line)
    if (!m) continue
    const [, op, key, value] = m
    const cur = sec[key] ?? []
    if (op === '!') sec[key] = []
    else if (op === '.') sec[key] = [...cur, value]
    else if (op === '+') sec[key] = cur.includes(value) ? cur : [...cur, value]
    else if (op === '-') sec[key] = cur.filter((v) => v !== value)
    else sec[key] = [value]
  }
  return out
}

/** літерал структури UE → масиви (позиційні елементи) й об'єкти (усі елементи — Key=Value); числа — числами */
export function parseUeStruct(src) {
  let i = 0
  const ws = () => { while (/\s/.test(src[i] ?? '')) i++ }
  function value() {
    ws()
    if (src[i] === '(') return group()
    if (src[i] === '"') {
      let s = ''
      i++
      while (i < src.length && src[i] !== '"') s += src[i++] === '\\' ? src[i++] : src[i - 1]
      i++
      return s
    }
    let s = ''
    while (i < src.length && !/[,)]/.test(src[i])) s += src[i++]
    s = s.trim()
    return s !== '' && Number.isFinite(Number(s)) ? Number(s) : s
  }
  function group() {
    i++ // (
    const items = []
    for (;;) {
      ws()
      if (src[i] === ')') { i++; break }
      const key = /^([A-Za-z_]\w*)\s*=/.exec(src.slice(i))
      if (key) { i += key[0].length; items.push([key[1], value()]) } else items.push([null, value()])
      ws()
      if (src[i] === ',') i++
    }
    return items.length && items.every(([k]) => k) ? Object.fromEntries(items) : items.map(([k, v]) => (k ? { [k]: v } : v))
  }
  return value()
}

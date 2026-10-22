/*
 * Урізання вендорної @snotax/ui під сайт (викликає scripts/sync-snotax-ui.mjs; перевіряє snotax-ui-trim.test.mjs).
 * У спільному шматку бібліотеки два важкі рядки: набір іконок (rawNodes у icons-*.js) і всі утиліти Tailwind 4, які
 * компоненти беруть у тіньовий DOM (utilitiesCss у base-*.js). Лишаємо з них те, що трапляється в коді елементів, які
 * сайт справді імпортує (і в їхніх залежностях), та в коді самого сайту: класи з class="…" на sn-* бібліотека
 * переносить усередину компонента (hostClass), а назви іконок сайт може передати в icon=/name=.
 * Клас, якого немає в жодному файлі бібліотеки, теж лишаємо — його Snotax додав для класів, що складаються на льоту.
 * Що вирізано — у vendor/snotax-ui/trim.json: тест падає, якщо сайт почне імпортувати новий елемент чи вживати
 * вирізаний клас або іконку (тоді — `npm run ui:sync`).
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
export const VENDOR = path.join(ROOT, 'vendor/snotax-ui')
export const MANIFEST = path.join(VENDOR, 'trim.json')

/** код сайту, де можуть бути класи для sn-* і назви іконок (тести не рендерять — без них) */
export function siteText() {
  const dir = path.join(ROOT, 'src')
  const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.(tsx?|jsx?|mjs)$/.test(f) && !/\.test\./.test(f))
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') + '\n' + fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
}

/** які елементи імпортує сайт: «button», «table»… (порожній рядок — увесь пакет) */
export function siteElements(text = siteText()) {
  const out = new Set()
  for (const m of text.matchAll(/['"]@snotax\/ui(?:\/elements(?:\/([\w-]+))?)?['"]/g)) out.add(m[1] ?? (m[0].includes('/elements') ? '*' : ''))
  return [...out].sort()
}

/** файли dist, до яких доходять імпорти елементів сайту (статичні й динамічні) */
function reachable(dist, elements) {
  const seen = new Set()
  const queue = elements.map((e) => path.join(dist, e === '' ? 'index.js' : e === '*' ? 'elements.js' : `elements/${e}.js`))
  while (queue.length) {
    const f = queue.shift()
    if (seen.has(f) || !fs.existsSync(f)) continue
    seen.add(f)
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+\.js)["']/g)) queue.push(path.resolve(path.dirname(f), m[1]))
  }
  return seen
}

// ── межі слова для класу: «p-2» не знаходиться в «gap-2», «flex» — у «flex items-center»
const WORD = /[\w-]/
function mentions(text, word) {
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    if (!WORD.test(text[i - 1] ?? ' ') && !WORD.test(text[i + word.length] ?? ' ')) return true
  }
  return false
}

// ── CSS: розбір мінімізованого виводу Tailwind (правила, @media/@supports/@layer з вкладеними правилами)
const unescape = (s) => s.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|([\s\S]))/g, (_, hex, ch) => (hex ? String.fromCodePoint(parseInt(hex, 16)) : ch))
/** перший клас селектора — сама утиліта («.hover\:bg-x:hover» → «hover:bg-x»); не з класу — null */
function leadClass(sel) {
  sel = sel.trim()
  if (sel[0] !== '.') return null
  let i = 1
  while (i < sel.length) {
    if (sel[i] === '\\') {
      const hex = /^[0-9a-fA-F]{1,6}\s?/.exec(sel.slice(i + 1, i + 8)) // «\32 xl\:…» — код символу й пробіл після нього
      i += 1 + (hex ? hex[0].length : 1)
    } else if (WORD.test(sel[i]) || sel.charCodeAt(i) > 127) i++
    else break
  }
  return unescape(sel.slice(1, i))
}
/** до наступного з stops на верхньому рівні (поза дужками, рядками й екрануванням) */
function scan(css, i, stops) {
  let depth = 0
  for (; i < css.length; i++) {
    const ch = css[i]
    if (ch === '\\') i++
    else if (ch === '"' || ch === "'") { for (i++; i < css.length && css[i] !== ch; i++) if (css[i] === '\\') i++ }
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (depth === 0 && stops.includes(ch)) return i
  }
  return i
}
function splitSelectors(prelude) {
  const out = []
  for (let i = 0; i <= prelude.length;) { const j = scan(prelude, i, ','); out.push(prelude.slice(i, j)); i = j + 1 }
  return out
}
/** кінець блоку, що почався після «{» в i (з урахуванням вкладених) — індекс його «}» */
function blockEnd(css, i) {
  for (let depth = 1; ; ) {
    i = scan(css, i, '{}')
    if (i >= css.length) return i
    if (css[i] === '{') depth++
    else if (--depth === 0) return i
    i++
  }
}
/** назва іконки, яку сайт передає компоненту: icon="x", name="x" (sn-icon), type="x" (Polaris), trueIcon: 'x' (таблиця) */
const ICON_PROP = /(?:icon|Icon|name|type)\w*\s*[=:]\s*\{?\s*["'`]([a-z0-9][a-z0-9-]*)["'`]/g

const GROUPING = /^@(media|supports|layer|container|scope|starting-style)\b/

/** CSS лише з правилами, чий клас потрібен (keep(клас)); правила без класу (:host, *, @property…) — як були */
export function trimCss(css, keep) {
  const classes = new Set()
  const walk = (from, to) => {
    let out = ''
    for (let i = from; i < to;) {
      const j = scan(css, i, '{;}')
      if (j >= to || css[j] !== '{') { out += css.slice(i, Math.min(j + 1, to)); i = j + 1; continue }
      const prelude = css.slice(i, j), end = blockEnd(css, j + 1)
      if (GROUPING.test(prelude.trim())) {
        const inner = walk(j + 1, end)
        if (inner.trim()) out += prelude + '{' + inner + '}'
      } else if (prelude.trim().startsWith('@')) out += css.slice(i, end + 1)
      else {
        const sels = splitSelectors(prelude).filter((s) => {
          const c = leadClass(s)
          if (c === null) return true
          classes.add(c)
          return keep(c)
        })
        if (sels.length) out += sels.join(',') + css.slice(j, end + 1)
      }
      i = end + 1
    }
    return out
  }
  const out = walk(0, css.length)
  return { css: out, classes }
}

/** рядковий літерал JS, що починається в s[at] ("…", '…' чи `…` без ${}) → [значення, кінець] */
function stringAt(s, at) {
  const q = s[at]
  let i = at + 1
  for (; i < s.length && s[i] !== q; i++) if (s[i] === '\\') i++
  return [new Function('return ' + s.slice(at, i + 1))(), i + 1]
}

/**
 * Урізати dist (у ньому вже повний набір іконок і утиліт із Snotax). site — код сайту (siteText()).
 * Повертає підсумок для trim.json.
 */
export function trimDist(dist, site = siteText()) {
  const files = fs.readdirSync(dist, { recursive: true }).map(String).filter((f) => f.endsWith('.js')).map((f) => path.join(dist, f))
  const iconsFile = files.find((f) => /[/\\]icons-[\w-]+\.js$/.test(f))
  const baseFile = files.find((f) => /[/\\]base-[\w-]+\.js$/.test(f) && fs.readFileSync(f, 'utf8').includes('const utilitiesCss = '))
  const aliasFile = files.find((f) => fs.readFileSync(f, 'utf8').includes('const POLARIS_ICON_ALIASES = '))
  if (!iconsFile || !baseFile) throw new Error('[ui] не знайшов icons-*.js чи utilitiesCss у base-*.js — формат @snotax/ui змінився, онови scripts/snotax-ui-trim.mjs')

  const elements = siteElements(site)
  const reach = reachable(dist, elements)
  const iconsSrc = fs.readFileSync(iconsFile, 'utf8'), baseSrc = fs.readFileSync(baseFile, 'utf8')
  const ia = iconsSrc.indexOf('const rawNodes = ') + 17, ib = iconsSrc.indexOf(';\nfunction iconSvg')
  const ca = baseSrc.indexOf('const utilitiesCss = ') + 21, [utilities, cb] = stringAt(baseSrc, ca)
  // код без самих рядків іконок і утиліт (у них — усі назви)
  const code = (f) => (f === iconsFile ? '' : f === baseFile ? baseSrc.slice(0, ca) + baseSrc.slice(cb) : fs.readFileSync(f, 'utf8'))
  const reachCode = [...reach].filter((f) => f !== aliasFile).map(code).join('\n')
  const libCode = files.map(code).join('\n')

  // ── іконки: назви-рядки в досяжному коді («arrow-up», ICON_GLYPH…) + Polaris-назви (alert-triangle → danger) + icon=/name= сайту
  const nodes = new Function('return ' + iconsSrc.slice(ia, ib))()
  const aliasSrc = aliasFile ? fs.readFileSync(aliasFile, 'utf8') : ''
  const aliases = aliasFile ? new Function('return ' + aliasSrc.slice(aliasSrc.indexOf('{', aliasSrc.indexOf('const POLARIS_ICON_ALIASES = ')), aliasSrc.indexOf('}, EMPTY_ICON') + 1))() : {}
  const wanted = new Set()
  for (const m of reachCode.matchAll(/["'`]([a-z0-9][a-z0-9-]*)["'`]/g)) wanted.add(m[1])
  for (const m of site.matchAll(ICON_PROP)) wanted.add(m[1])
  for (const n of [...wanted]) if (aliases[n]) wanted.add(aliases[n])
  const keptIcons = [...wanted].filter((n) => nodes[n]).sort()
  // стилі: linear — типовий (iconSvgFrom бере його, коли просять відсутній); bold — лише якщо сайт його просить
  const styles = new Set(['linear', ...(/\bvariant\s*[=:]\s*\{?\s*["'`]bold["'`]/.test(site) ? ['bold'] : [])])
  const iconsOut = Object.fromEntries(keptIcons.map((n) => [n, Object.fromEntries(Object.entries(nodes[n]).filter(([v]) => styles.has(v)))]))
  fs.writeFileSync(iconsFile, iconsSrc.slice(0, ia) + JSON.stringify(iconsOut) + iconsSrc.slice(ib))

  // ── утиліти: клас потрібен, якщо він є в досяжному коді чи в коді сайту, або його немає ніде в бібліотеці
  const reachAll = reachCode + '\n' + site
  const keep = (c) => mentions(reachAll, c) || !mentions(libCode, c)
  const { css, classes } = trimCss(utilities, keep)
  fs.writeFileSync(baseFile, baseSrc.slice(0, ca) + JSON.stringify(css) + baseSrc.slice(cb))
  const droppedClasses = [...classes].filter((c) => !keep(c)).sort()

  return {
    elements,
    icons: { kept: keptIcons.length, of: Object.keys(nodes).length, styles: [...styles], dropped: Object.keys(nodes).filter((n) => !iconsOut[n]).sort() },
    utilities: { bytes: [utilities.length, css.length], kept: classes.size - droppedClasses.length, of: classes.size, dropped: droppedClasses },
  }
}

/** що з коду сайту вирізано (для тесту): нові елементи, класи, іконки */
export function staleAgainst(manifest, site = siteText()) {
  const elements = siteElements(site).filter((e) => !manifest.elements.includes(e))
  const classes = manifest.utilities.dropped.filter((c) => mentions(site, c))
  const icons = []
  for (const m of site.matchAll(ICON_PROP)) if (manifest.icons.dropped.includes(m[1])) icons.push(m[1])
  return { elements, classes, icons: [...new Set(icons)] }
}

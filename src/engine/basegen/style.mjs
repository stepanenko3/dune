/*
 * Стиль бази для генератора: пресети (Сандвокери, Атріди, Харконнени, Сардаукари, Фримени, Контрабандисти, Водовози,
 * Бене Гессерит, Іксіанці, Імперський, Простий) і перемикачі, з яких вони складаються. Пресет — лише набір значень
 * перемикачів; змінив будь-який — стиль «Свій». Що робить кожен перемикач, див. generate.mjs (пошук за назвою):
 *   walls       — прямі; похилі (lean) — верхи й одноповерхові приміщення; обернені (inverted) — перший поверх
 *                 під верхнім модулем чи терасою похилий назовні: верх нависає над підніжжям (брутальний фасад);
 *   roof        — пласкі, скатні, піраміди, склепіння (скатні з заокругленими скатами), куполи (піраміди з
 *                 заокругленими скатами) — верхні модулі, ангари, вежі, одноповерхові приміщення;
 *   columns     — колонади: перший поверх відступає від зовнішніх сторін на плитку, верх тримають колони;
 *   cantilever  — нависання: перший поверх під верхом відступає на дві плитки, верх висить над затіненим підсінням
 *                 (колони лише по кутах і посередині) — як ангари Sandwalkers Main;
 *   porch       — ганок: вхід у ніші 3 × 1 під навісом на двох колонах;
 *   setbacks    — уступи: житло нагорі на плитку вужче від зовнішніх сторін, довкола — балкон із поручнями, з кожної
 *                 кімнати двері на нього;
 *   towers      — none · one (одна вежа на терасі) · corners (вежі на зовнішніх кутах терас); towerFloors — 1–3
 *                 поверхи понад терасою (кутові — різної висоти, за варіантом);
 *   towerShape  — square (4 × 4 на всю висоту) · goblet (келих: стовбур 2 × 2, нагорі оглядовий майданчик 4 × 4 з
 *                 павільйоном — як вежа Sandwalkers Main) · stepped (уступом: нагорі вужча кімната 2 × 2, довкола —
 *                 майданчик із поручнями);
 *   balconies   — балкончики на вежах (плита 2 × 1 з поручнями й дверима);
 *   battlements — зубці замість поручнів (тераси, пласкі дахи, верх веж);
 *   parapets    — суцільний парапет-напівстіна замість поручнів (з зубцями — зубці);
 *   skylights   — скляні стелі (горизонтальний пентащит) над житлом і одноповерховими залами;
 *   dome        — ступінчастий купол над шестикутником;
 *   towerCap    — верх веж: за дахами стилю, піраміда, скатний, пласкі, голки (колони-шпилі на кутах), кімната (на
 *                 келиху — закрита оглядова на майданчику);
 *   ziggurat    — зикурат на терасі: три яруси похилих стін (8 × 8, 6 × 6 і корона 4 × 4), уступи-виступи з
 *                 поручнями, двері й драбини з люками між ярусами;
 *   pavilion    — павільйон на даху житла: чотири колони й дах (за верхом веж), драбина з коридору й люк;
 *   canopies    — навіси на терасах: пласкі дахи 3 × 3 (чи 4 × 2) на чотирьох колонах (тінь від сонця).
 * Вікон генератор не ставить: у кожному будівельному наборі гри вони свої — це на розсуд того, хто будуватиме. Його
 * справа — форма й стиль будівлі, щоб усе вмістилось і гарно виглядало.
 * Варіант (seed) змінює не лише план, а й деталі стилю: де стоять вежі й зикурат, висоту кутових веж, двері, навіси —
 * кожен варіант інший.
 */

export const STYLE_ENUMS = {
  walls: ['straight', 'lean', 'inverted'],
  roof: ['flat', 'hip', 'pyramid', 'vault', 'dome'],
  towers: ['none', 'one', 'corners'],
  towerShape: ['square', 'goblet', 'stepped'],
  towerCap: ['roof', 'pyramid', 'hip', 'flat', 'spires', 'room'],
}
export const STYLE_FLAGS = ['columns', 'cantilever', 'porch', 'setbacks', 'balconies', 'battlements', 'parapets', 'skylights', 'dome', 'ziggurat', 'pavilion', 'canopies']

/** звідки дах блоку: склепіння — скатний, купол — піраміда (обидва з заокругленими скатами) */
export const roofBase = (roof) => (roof === 'vault' ? 'hip' : roof === 'dome' ? 'pyramid' : roof)
export const roofRound = (roof) => roof === 'vault' || roof === 'dome'

/**
 * Пресети; name — ключ перекладу, sub — коротко, у чому стиль. Підстава — дослідження баз гравців і будівельних наборів
 * гри (docs/superpowers/specs/2026-10-21-base-generator-styles.md): Атріди — прямі стіни, колонади, балкони, зубці,
 * кутові вежі; Харконнени — похилі всередину стіни, піраміди, куполи, вежі-голки; Сардаукари — зикурат, уступи, без веж
 * і зубців; Контрабандисти — «ноги», галереї, вежа-келих; Водовози — заокруглені склепіння, навіси; Бене Гессерит —
 * куполи, колонади; Іксіанці — нависання, ступінчасті вежі; Імперський (CHOAM) — колонади, піраміди, зикурат, кутові вежі.
 */
const OFF = { columns: false, cantilever: false, porch: false, setbacks: false, balconies: false, battlements: false, parapets: false, skylights: false, dome: false, ziggurat: false, pavilion: false, canopies: false }
const pre = (name, sub, v) => ({ name, sub, ...OFF, towers: 'none', towerShape: 'square', towerFloors: 1, towerCap: 'roof', ...v })
export const STYLE_PRESETS = {
  sandwalkers: pre('Сандвокери', 'як Sandwalkers Main: верх нависає над похилим підніжжям, скатні дахи, скляні стелі, вежа-келих з оглядовим майданчиком',
    { walls: 'inverted', roof: 'hip', towers: 'one', towerShape: 'goblet', towerFloors: 2, towerCap: 'hip', skylights: true, dome: true }),
  atreides: pre('Атріди', 'колонади, ганок, балкони й уступи, зубці, кутові вежі зі скатними дахами, павільйон у саду на даху',
    { walls: 'straight', roof: 'flat', columns: true, porch: true, setbacks: true, towers: 'corners', towerFloors: 2, towerCap: 'hip', balconies: true, battlements: true, skylights: true, dome: true, pavilion: true }),
  harkonnen: pre('Харконнени', 'чорний моноліт над темним підсінням: похилі стіни, піраміди, зикурат, вежі-голки',
    { walls: 'lean', roof: 'pyramid', cantilever: true, towers: 'corners', towerFloors: 3, towerCap: 'spires', dome: true, ziggurat: true }),
  sardaukar: pre('Сардаукари', 'імперський бруталізм: похилі стіни, зикурат, уступи, ганок, парапети',
    { walls: 'lean', roof: 'flat', porch: true, setbacks: true, towerCap: 'flat', parapets: true, skylights: true, ziggurat: true }),
  fremen: pre('Фримени', 'низько й глухо: похилі стіни, пласкі дахи, парапети, навіси від сонця, купол над шестикутником',
    { walls: 'lean', roof: 'flat', porch: true, towerCap: 'flat', parapets: true, dome: true, canopies: true }),
  smuggler: pre('Контрабандисти', 'промисловий: верх на колонах-ногах, галереї, вежа-келих з оглядовою кімнатою',
    { walls: 'straight', roof: 'flat', cantilever: true, towers: 'one', towerShape: 'goblet', towerFloors: 3, towerCap: 'room', balconies: true, skylights: true }),
  watershippers: pre('Водовози', 'заокруглені склепіння, верх нависає над похилим підніжжям, навіси, вежа-келих з оглядовою кімнатою',
    { walls: 'inverted', roof: 'vault', towers: 'one', towerShape: 'goblet', towerFloors: 2, towerCap: 'room', skylights: true, dome: true, canopies: true }),
  bene: pre('Бене Гессерит', 'куполи, колонади й ганок, ступінчасті вежі, павільйон, парапети',
    { walls: 'straight', roof: 'dome', columns: true, porch: true, setbacks: true, towers: 'corners', towerShape: 'stepped', towerFloors: 2, towerCap: 'roof', parapets: true, skylights: true, dome: true, pavilion: true }),
  ixian: pre('Іксіанці', 'техніка: похилі стіни над підсінням, ступінчасті вежі з кімнатою нагорі, навіси, скляні стелі',
    { walls: 'lean', roof: 'flat', cantilever: true, towers: 'corners', towerShape: 'stepped', towerFloors: 3, towerCap: 'room', skylights: true, canopies: true }),
  imperial: pre('Імперський', 'CHOAM: колонади, піраміди, зикурат, уступи, кутові вежі з зубцями',
    { walls: 'straight', roof: 'pyramid', columns: true, porch: true, setbacks: true, towers: 'corners', towerFloors: 2, towerCap: 'flat', balconies: true, battlements: true, skylights: true, dome: true, ziggurat: true }),
  plain: pre('Простий', 'прямі стіни й пласкі дахи — найдешевше, доробиш сам',
    { walls: 'straight', roof: 'flat' }),
}
export const STYLE_DEFAULT = 'sandwalkers'

/**
 * Варіації пресета за варіантом бази: перемикач → імовірність увімкнути (якщо в пресеті вимкнений) чи перелік, з якого
 * береться значення (повтор — частіше). Характер фракції той самий, деталі щоразу інші. Свій стиль не варіюється —
 * його людина задала сама.
 */
export const STYLE_VARY = {
  sandwalkers: { canopies: 0.3, pavilion: 0.2, towers: ['one', 'one', 'corners'], towerShape: ['goblet', 'goblet', 'stepped'], roof: ['hip', 'hip', 'vault'] },
  atreides: { canopies: 0.35, ziggurat: 0.15, towers: ['corners', 'corners', 'one'], towerShape: ['square', 'square', 'stepped'], towerCap: ['hip', 'hip', 'pyramid'] },
  harkonnen: { towers: ['corners', 'corners', 'one'], towerCap: ['spires', 'spires', 'pyramid'], roof: ['pyramid', 'pyramid', 'dome'] },
  sardaukar: { canopies: 0.3, cantilever: 0.3, towers: ['none', 'none', 'one'], towerShape: ['stepped'] },
  fremen: { towers: ['none', 'none', 'one'], towerShape: ['stepped'], roof: ['flat', 'flat', 'vault'] },
  smuggler: { canopies: 0.4, towers: ['one', 'one', 'corners'], towerShape: ['goblet', 'goblet', 'stepped'], roof: ['flat', 'flat', 'vault'] },
  watershippers: { pavilion: 0.25, towerShape: ['goblet', 'goblet', 'stepped'], towers: ['one', 'one', 'corners'] },
  bene: { canopies: 0.3, ziggurat: 0.2, towerCap: ['roof', 'roof', 'room'] },
  ixian: { pavilion: 0.25, towers: ['corners', 'corners', 'one'], towerCap: ['room', 'room', 'flat'] },
  imperial: { canopies: 0.25, towerShape: ['square', 'square', 'stepped'], roof: ['pyramid', 'pyramid', 'dome'] },
}
/** стиль, яким будується база цього варіанта (rand — від варіанта): пресет — з варіаціями, свій — як є */
export function varyStyle(style, rand) {
  const v = STYLE_VARY[style.preset]
  if (!v) return style
  const out = { ...style }
  for (const [k, o] of Object.entries(v)) {
    const r = rand()
    if (Array.isArray(o)) out[k] = o[Math.floor(r * o.length)]
    else if (!out[k] && r < o) out[k] = true
  }
  return out
}

/** значення перемикачів пресета (без назви) */
export const presetValues = (id) => { const { name, sub, ...v } = STYLE_PRESETS[id] || STYLE_PRESETS[STYLE_DEFAULT]; void name; void sub; return v }
/** який пресет збігається з перемикачами (чи 'custom') */
export function presetOf(style) {
  for (const id of Object.keys(STYLE_PRESETS)) {
    const v = presetValues(id)
    if (Object.keys(v).every((k) => v[k] === style[k])) return id
  }
  return 'custom'
}

/**
 * Стиль із будь-якого входу: { preset, …перемикачі }; давні walls / roof першої версії — поверх пресета «Простий» з
 * тими стінами й дахами (так виглядали бази першої версії).
 */
export function normalizeStyle(src, legacy = {}) {
  const s = src && typeof src === 'object' ? src : null
  const base = s && STYLE_PRESETS[s.preset] ? presetValues(s.preset) : s ? presetValues(STYLE_DEFAULT) : legacy.walls || legacy.roof ? { ...presetValues('plain'), skylights: false } : presetValues(STYLE_DEFAULT)
  const out = { ...base }
  if (!s) { if (STYLE_ENUMS.walls.includes(legacy.walls)) out.walls = legacy.walls; if (STYLE_ENUMS.roof.includes(legacy.roof)) out.roof = legacy.roof }
  if (s) {
    // давній верх веж «ліхтар» (засклений) — тепер кімната нагорі (вікна — на розсуд будівельника)
    const src2 = s.towerCap === 'lantern' ? { ...s, towerCap: 'room' } : s
    for (const k of Object.keys(STYLE_ENUMS)) if (STYLE_ENUMS[k].includes(src2[k])) out[k] = src2[k]
    for (const k of STYLE_FLAGS) if (typeof s[k] === 'boolean') out[k] = s[k]
    const f = Math.round(Number(s.towerFloors))
    if (Number.isFinite(f)) out.towerFloors = Math.max(1, Math.min(3, f))
  }
  return { preset: presetOf(out), ...out }
}

/**
 * Випадковий стиль для кнопки «Рандом»: здебільшого пресет (часом із кількома зміненими перемикачами — «свій»), інколи
 * зовсім довільний набір — але не голий: вежі частіше є, щонайменше чотири прикраси (колонади, нависання,
 * уступи, павільйон, навіси…). rand — () → [0, 1).
 */
const RANDOM_POOL = {
  walls: STYLE_ENUMS.walls, roof: STYLE_ENUMS.roof,
  towers: ['one', 'corners', 'corners', 'none'], towerShape: STYLE_ENUMS.towerShape, towerCap: STYLE_ENUMS.towerCap,
}
const DECOR = ['columns', 'cantilever', 'porch', 'setbacks', 'skylights', 'pavilion', 'canopies', 'ziggurat', 'battlements', 'parapets', 'balconies', 'dome']
export function randomStyle(rand) {
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const ids = Object.keys(STYLE_PRESETS).filter((id) => id !== 'plain')
  const r = rand()
  if (r < 0.4) return normalizeStyle({ preset: pick(ids) })
  let out
  if (r < 0.75) {
    // пресет і 2–4 зміни
    out = presetValues(pick(ids))
    for (let n = 2 + Math.floor(rand() * 3); n > 0; n--) {
      const k = pick([...Object.keys(RANDOM_POOL), ...STYLE_FLAGS, 'towerFloors'])
      if (k === 'towerFloors') out.towerFloors = 1 + Math.floor(rand() * 3)
      else if (RANDOM_POOL[k]) out[k] = pick(RANDOM_POOL[k])
      else out[k] = !out[k]
    }
  } else {
    // довільний набір
    out = { towerFloors: 1 + Math.floor(rand() * 3) }
    for (const [k, list] of Object.entries(RANDOM_POOL)) out[k] = pick(list)
    for (const f of STYLE_FLAGS) out[f] = rand() < 0.4
    while (DECOR.filter((f) => out[f]).length < 4) out[pick(DECOR)] = true
  }
  return normalizeStyle({ ...out, preset: 'custom' })
}

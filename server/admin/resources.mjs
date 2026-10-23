/*
 * Розділи панелі керування — усе, що є в базі сайту. Опис полів і дій — див. engine.mjs. Записи, у яких є власна
 * логіка (люди, гільдії, вміст із документами), змінюються через свої сховища (хуки), решта — прямо в таблиці.
 * Підписи — українською: це ключі перекладу (клієнт перекладає їх мовою людини).
 */
import { cleanBase } from '../lib/bases.mjs'
import { cleanRoadmap } from '../lib/roadmap.mjs'
import { cleanBuild, cleanCalc, cleanMarker } from '../lib/docs.mjs'
import { cleanEvent, EVENT_TYPE_L, EVENT_TYPES, TEAM_STATUS } from '../lib/events.mjs'
import { GUILD_ROLES } from '../lib/guilds.mjs'
import { KINDS, normVis, VIS } from '../lib/items.mjs'
import { GAME, LANGS } from '../lib/gamedata.mjs'
import { AUDIENCES, TONES } from '../lib/announcements.mjs'
import { fail, paletteFor } from '../lib/util.mjs'
import { AUDIT_OPTIONS, REVISION_ACTIONS, REVISION_TONES, STATUS_OPTIONS, STATUS_TONES, describeAudit, describeRevisions } from './describe.mjs'

const opts = (list, labels = {}) => list.map((v) => ({ value: v, label: labels[v] ?? v }))
const GROLE_L = { leader: 'Лідер', officer: 'Офіцер', member: 'Учасник', recruit: 'Новобранець' }
const KIND_L = { base: 'База', roadmap: 'Роадмап', build: 'Білд', calc: 'Розрахунок', marker: 'Позначка', place: 'Ресурс', event: 'Подія' }
const TEAM_STATUS_L = { pending: 'Чекає рішення', confirmed: 'Бере участь', reserve: 'У резерві', rejected: 'Відхилено' }
const VIS_L = { private: 'Особисте', guild: 'Гільдійське', link: 'За посиланням', public: 'Публічне' }
const OWNER_L = { user: 'Людина', guild: 'Гільдія', site: 'Сайт' }
const TONE_L = { info: 'Інформація', success: 'Успіх', warning: 'Увага', critical: 'Тривога' }
const AUD_L = { all: 'Усім', guests: 'Гостям', users: 'Тим, хто увійшов', guild: 'Учасникам гільдії', staff: 'Адміністрації' }
const LANG_OPTS = LANGS.map((l) => ({ value: l.code, label: l.name }))
const GAME_KIND_L = { item: 'Предмет', placeable: 'Пристрій', recipe: 'Рецепт', buildable: 'Будівельний елемент', skill: 'Уміння' }
/** назви налаштувань сайту (для історії змін; ключі — як у SITE_SETTINGS) */

// служба сповіщень — за адресою підписки: так видно, з якого браузера людина підписалась
const PUSH_BROWSERS = [
  { value: 'chrome', label: 'Chrome, Android', like: 'https://fcm.googleapis.com/%' }, { value: 'firefox', label: 'Firefox', like: '%.mozilla.com/%' },
  { value: 'safari', label: 'Safari, iPhone', like: 'https://web.push.apple.com/%' }, { value: 'edge', label: 'Edge', like: '%.notify.windows.com/%' },
  { value: 'other', label: 'Інший' },
]
const pushBrowserSql = (col) => `(CASE ${PUSH_BROWSERS.filter((b) => b.like).map((b) => `WHEN push_subs.endpoint LIKE '${b.like}' THEN '${b[col]}'`).join(' ')} ELSE '${PUSH_BROWSERS.at(-1)[col]}' END)`
export const SETTING_L = { registration: 'Нові люди', defaultLang: 'Мова сайту для нових', siteName: 'Назва сайту', guildCap: 'Скільки людей у гільдії', limits: 'Ліміти на людину й гільдію', auditDays: 'Скільки днів зберігати журнал дій', revisionDays: 'Скільки днів зберігати історію змін', decree: 'Указ Ландсрааду' }
const SRC_L = { game: 'Файли гри', 'game-old': 'Файли гри (давніші)', gamingtools: 'Спільнота: тексти', thgl: 'Спільнота: мапа', questlog: 'Спільнота: довідник', manual: 'Вручну' }

const created = { key: 'created', label: 'Створено', type: 'datetime', readonly: true, sort: true, filter: true }
const updated = { key: 'updated', label: 'Змінено', type: 'datetime', readonly: true, sort: true }

export function buildResources(d) {
  const { db, auth, guilds, items, content, bases, roadmaps, builds, calcs, markers, places, events, game, i18n, announcements, catalog, skills, removeUser, deleteGuild, mapData, roles, revisions, cron } = d
  const now = () => Date.now()

  /** «людина / гільдія» для колонки власника */
  async function ownerLabels(rows) {
    const us = [...new Set(rows.filter((r) => r.owner_kind === 'user').map((r) => r.owner_id))]
    const gs = [...new Set(rows.filter((r) => r.owner_kind === 'guild').map((r) => r.owner_id))]
    const u = us.length ? await db.all(`SELECT id, name, login FROM users WHERE id IN (${us.map(() => '?').join(',')})`, ...us) : []
    const g = gs.length ? await db.all(`SELECT id, name, tag FROM guilds WHERE id IN (${gs.map(() => '?').join(',')})`, ...gs) : []
    const um = new Map(u.map((x) => [x.id, `${x.name} (@${x.login})`])), gm = new Map(g.map((x) => [x.id, `[${x.tag}] ${x.name}`]))
    for (const r of rows) r.owner_id__label = r.owner_kind === 'site' ? 'Сайт' : r.owner_kind === 'user' ? um.get(r.owner_id) ?? null : gm.get(r.owner_id) ?? null
    return rows
  }
  /** власник з форми: { kind, id } як у реєстрі (гільдія — за id, навіть якщо в формі її адреса); нема такого — 404 */
  async function ownerRef(kind, id) {
    if (kind === 'site') return { kind, id: 'site' }
    if (kind === 'user') { if (!id || !(await auth.get(id))) throw fail('немає такої людини', 404); return { kind, id } }
    if (kind === 'guild') { const g = id ? await guilds.get(id) : null; if (!g) throw fail('немає такої гільдії', 404); return { kind, id: g.id } }
    throw fail('хибний власник')
  }
  /**
   * Чи може людина з панелі зробити річ такою (cur — рядок реєстру до зміни; той самий власник — без перевірки).
   * Як і на сайті (content.ownerFor): сайт — лише з дозволом site.content. Право змінювати розділ (bases.edit…)
   * не дає забирати чуже: віддати річ іншому власнику (і зробити нову чужою чи гільдійською) — з дозволом site.owners;
   * без нього нова річ — лише своя чи гільдії, де ти щонайменше учасник.
   */
  async function mayOwn(user, o, cur) {
    if (cur && o.kind === cur.owner_kind && o.id === cur.owner_id) return
    const perms = await roles.permsOf(user.role)
    if (o.kind === 'site' && !roles.has(perms, 'site.content')) throw fail('віддати сайту може лише адміністрація', 403)
    if (roles.has(perms, 'site.owners')) return
    if (!cur && (o.kind === 'site' || (o.kind === 'user' && o.id === user.id))) return
    if (!cur && o.kind === 'guild' && ((await guilds.ranks(user.id)).get(o.id) || 0) >= 2) return
    throw fail('бракує прав', 403)
  }
  /** власник нової речі з форми (порожньо — ти сам) */
  async function ownerOf(dv, user) {
    const kind = dv.owner_kind || 'user'
    const o = await ownerRef(kind, dv.owner_id || (kind === 'user' ? user.id : null))
    await mayOwn(user, o, null)
    return o
  }
  /** новий власник і видимість речі з форми (поля, яких нема, — як були) */
  async function access(kind, id, dv, cur, user) {
    const ok = dv.owner_kind || cur.owner_kind
    const o = await ownerRef(ok, ok === 'site' ? 'site' : dv.owner_id || (ok === cur.owner_kind ? cur.owner_id : null))
    await mayOwn(user, o, cur)
    return items.setAccess(kind, id, o, dv.visibility || cur.visibility)
  }

  // ---------- вміст із документами: бази, роадмапи, білди, позначки, ресурси ----------
  const ownerFields = [
    { key: 'title', label: 'Назва', type: 'text', sql: 'i.title', readonly: true, search: true, sort: true },
    { key: 'owner_kind', label: 'Чиє', type: 'select', options: opts(['user', 'guild', 'site'], OWNER_L), sql: 'i.owner_kind', filter: true, list: false, form: false, create: true },
    { key: 'owner_id', label: 'Власник', type: 'owner', kindField: 'owner_kind', sql: 'i.owner_id', filter: true, help: 'Людина чи гільдія; порожньо при створенні — ти' },
    { key: 'visibility', label: 'Хто бачить', type: 'select', options: opts(VIS, VIS_L), sql: 'i.visibility', filter: true, tones: { private: 'neutral', guild: 'info', link: 'warning', public: 'success' } },
  ]
  const DOC_ABOUT = {
    base: 'Бази людей і гільдій: план, 3D, кошторис і версії. Видалені лежать у кошику — їх можна повернути.',
    roadmap: 'Роадмапи: що, у якому порядку будувати й досліджувати.',
    build: 'Білди вмінь: розподіл очок і слоти.',
    calc: 'Збережені розрахунки калькулятора виробництва.',
    marker: 'Позначки людей і гільдій на мапі.',
    place: 'Записи про те, де брати рідкісні ресурси.',
  }
  function docResource({ name, kind, table, label, one, icon, extra = [], write, clean, about = DOC_ABOUT[kind], actions = [], relations = [], preview = null, quick = [] }) {
    return {
      quick,
      name, label, one, group: 'Вміст', icon, table, alias: 't', title: 'title', about, removeNote: 'Разом із записом зникнуть його версії й зірки.',
      from: `${table} t LEFT JOIN items i ON i.kind = '${kind}' AND i.id = t.id`,
      key: 'id', sort: 't.updated DESC', link: { kind },
      fields: [
        // адреса (id) — у пошуку й на картці; у таблиці лише назва (довгі адреси розтягують рядки)
        { key: 'id', label: 'Адреса (ID)', type: 'text', readonly: true, mono: true, search: true, hidden: true },
        ...ownerFields,
        ...extra,
        created, updated,
        { key: 'doc', label: 'Вміст як дані (JSON)', type: 'json', list: false, required: true, create: true, advanced: true, snap: kind !== 'base' && kind !== 'roadmap', help: 'Увесь вміст як є — зручніше правити в редакторі на сайті. Зберігаєш — сайт перевіряє й чистить його так само, як після редактора.' },
      ],
      hooks: {
        rows: ownerLabels,
        async create(dv, user) {
          const doc = clean(JSON.parse(dv.doc || '{}'))
          const id = await content.H[kind].create(doc, 'Створено в панелі керування', undefined, user.id)
          const owner = await ownerOf(dv, user)
          await items.add(kind, id, { owner, visibility: normVis(owner.kind, dv.visibility), ...content.H[kind].meta(doc), by: user.id })
          return id
        },
        async update(id, dv, old, user) {
          if (dv.doc != null) {
            const doc = clean(JSON.parse(dv.doc))
            await write(id, doc, old, dv, user)
            await items.touch(kind, id, content.H[kind].meta(doc))
          } else if (dv.note != null && kind === 'base') await db.run('UPDATE bases SET note = ? WHERE id = ?', dv.note, id)
          if (dv.owner_kind || dv.owner_id || dv.visibility) {
            const it = await items.get(kind, id)
            if (it) await access(kind, id, dv, it, user)
          }
        },
        remove: (id) => content.purge(kind, id),
      },
      actions,
      relations,
      preview,
    }
  }

  const docPut = (store) => async (id, doc) => { const r = await store.put(id, doc); if (!r) throw fail('немає такого запису', 404) }

  // ---------- дані гри ----------
  /** підписи полів даних гри: спільні й ті, що в різних видах означають різне ([вид, поле]) */
  const GAME_LABEL = {
    id: 'Код у грі', key: 'Код у грі', name: 'Назва англійською', icon: 'Іконка', img: 'Зображення', grade: 'Тір', cat: 'Категорія', sub: 'Підкатегорія',
    rarity: 'Рідкість', stack: 'Найбільше в стосі, шт.', volume: 'Об’єм в інвентарі', description: 'Опис англійською',
    power: 'Енергія', water: 'Вода', water_rate: 'Дає води за секунду, мл', set_id: 'Будівельний набір', grp: 'Група', health: 'Міцність',
    school: 'Школа', x: 'Стовпець у дереві', y: 'Рядок у дереві', max: 'Скільки рангів', levels: 'Ранги: ціна й бонуси',
  }
  const GAME_LABEL_OF = {
    'item.kind': 'Клас предмета', 'skill.kind': 'Вид уміння',
    'placeable.water': 'Ємність для води, мл', 'placeable.sub': 'Тір пристрою',
    'recipe.name': 'Назва рецепта англійською', 'recipe.time': 'Час на виготовлення, с', 'recipe.water': 'Вода на виготовлення, мл',
    'recipe.stations': 'Де виготовляють', 'recipe.inputs': 'Що потрібно', 'recipe.outputs': 'Що виходить',
    'buildable.id': 'Код деталі в кошторисах', 'buildable.cost': 'Ціна будівництва',
    'skill.req_and': 'Потрібні всі ці вміння', 'skill.req_or': 'Потрібне хоч одне з цих умінь',
  }
  const GAME_HELP = {
    'placeable.power': 'Додатне — пристрій дає енергію, від’ємне — споживає',
    'recipe.time': 'Скільки секунд пристрій виготовляє одну партію',
    'recipe.water': 'Скільки води пристрій бере на одну партію',
    'item.volume': 'Скільки місця одна штука займає в інвентарі',
    'skill.x': 'Положення вміння в дереві школи', 'skill.y': 'Положення вміння в дереві школи',
  }
  /** id у списках і парах — записи цих розділів (вибір зі списку з іконкою й назвою) */
  const GAME_REFS = { inputs: 'game-items', outputs: 'game-items', cost: 'game-items', stations: 'game-placeables', req_and: 'game-skills', req_or: 'game-skills' }
  /** як клієнт підписує варіанти категорій (словник сайту; без словника — як у грі) */
  const GAME_OPT_LABELS = { 'item.cat': 'item.cat', 'item.sub': 'item.sub', 'item.kind': 'item.kind', 'item.rarity': 'rarity', 'placeable.sub': 'tier', 'buildable.grp': 'buildable.grp', 'buildable.set_id': 'buildable.set', 'skill.school': 'skill.school', 'skill.kind': 'skill.kind' }
  /** варіанти поля — те, що є в таблиці (категорії гри); parent — значення поля, від якого залежить (підкатегорія від категорії) */
  const distinct = (table, col, parent) => async () =>
    (await db.all(`SELECT DISTINCT ${col} AS v${parent ? `, ${parent} AS p` : ''} FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> '' ORDER BY ${col}`))
      .map((x) => ({ value: String(x.v), label: String(x.v), ...(parent && x.p != null && x.p !== '' ? { parent: String(x.p) } : {}) }))
  const TYPE = { text: 'text', int: 'int', num: 'num', json: 'json' }
  const gameField = (kind, c, t) => {
    const f = { key: c, label: GAME_LABEL_OF[`${kind}.${c}`] || GAME_LABEL[c] || c, type: TYPE[t] }
    if (GAME_HELP[`${kind}.${c}`]) f.help = GAME_HELP[`${kind}.${c}`]
    if (c === GAME[kind].key) Object.assign(f, { readonly: true, create: true, required: true, mono: true, search: true, sort: true })
    if (c === 'name') Object.assign(f, { search: true, sort: true, required: kind !== 'recipe' })
    if (c === 'description') Object.assign(f, { type: 'textarea', list: false })
    if (['grade', 'time', 'water', 'health', 'power', 'stack'].includes(c)) f.sort = true
    // категорії — вибір з того, що є в грі; підкатегорія предмета — з тих, що є в його категорії
    if (['cat', 'sub', 'kind', 'rarity', 'school', 'set_id', 'grp'].includes(c)) {
      Object.assign(f, { type: 'select', filter: true, sort: true, optionsFn: distinct(GAME[kind].table, c, kind === 'item' && c === 'sub' ? 'cat' : null) })
      if (kind === 'item' && c === 'sub') f.dependsOn = 'cat'
      if (GAME_OPT_LABELS[`${kind}.${c}`]) f.labels = GAME_OPT_LABELS[`${kind}.${c}`]
    }
    if (c === 'grade') f.filter = true
    if (['inputs', 'outputs', 'cost'].includes(c)) Object.assign(f, { type: 'pairs', list: c !== 'cost' })
    if (['stations', 'req_and', 'req_or'].includes(c)) Object.assign(f, { type: 'list', list: c === 'stations' })
    if (GAME_REFS[c]) f.refs = GAME_REFS[c]
    if (c === 'levels') Object.assign(f, { list: false, advanced: true })
    if (['description', 'volume', 'water_rate', 'x', 'y'].includes(c)) f.list = false
    // зображення: у таблиці — мініатюрою першим стовпцем, у формі — картинкою з «Завантажити нове»
    if (c === 'icon' || c === 'img') Object.assign(f, { image: true, label: c === 'img' ? 'Зображення' : 'Іконка' })
    // у будівельних елементах код і код у кошторисах однакові — другий лише на картці
    if (kind === 'buildable' && c === 'id') Object.assign(f, { list: false, mono: true })
    return f
  }
  /** пов'язані записи даних гри: рецепти, де предмет потрібен чи виходить, що виготовляє пристрій, що відкриває вміння */
  const GAME_RELATIONS = {
    item: [
      { resource: 'game-recipes', has: 'outputs', label: 'Як отримати' },
      { resource: 'game-recipes', has: 'inputs', label: 'Де потрібен' },
      { resource: 'game-buildables', has: 'cost', label: 'У будівництві' },
    ],
    placeable: [{ resource: 'game-recipes', has: 'stations', label: 'Що тут виготовляють' }],
    skill: [
      { resource: 'game-skills', has: 'req_and', label: 'Що відкриває' },
      { resource: 'game-skills', has: 'req_or', label: 'Що відкриває разом з іншими' },
    ],
  }
  /** порядок у таблиці: зображення, назва, далі як у грі */
  const rank = (f) => (f.image ? 0 : f.key === 'name' ? 1 : 2)
  const GAME_NAMES = { item: ['game-items', 'Предмети', 'Предмет', 'package'], placeable: ['game-placeables', 'Пристрої', 'Пристрій', 'factory'], recipe: ['game-recipes', 'Рецепти', 'Рецепт', 'flask-conical'], buildable: ['game-buildables', 'Будівельні елементи', 'Будівельний елемент', 'brick-wall'], skill: ['game-skills', 'Уміння', 'Уміння', 'sparkles'] }
  const gameResources = Object.entries(GAME).map(([kind, g]) => {
    const [name, label, one, icon] = GAME_NAMES[kind]
    return {
      name, label, one, icon, group: 'Гра', table: g.table, key: g.key, title: 'name',
      texts: kind, lockOnEdit: true, touch: 'updated', stamp: ['updated'], sort: 'name',
      about: 'Дані з гри. Змінений вручну запис стає закріпленим — оновлення даних гри його не перепише. Сховане сайт не показує.',
      quick: [
        { key: 'hidden', label: 'Сховані', filters: { hidden: 'yes' } },
        { key: 'locked', label: 'Змінені вручну', filters: { locked: 'yes' } },
        { key: 'unreleased', label: 'Ще не в грі', filters: { unreleased: 'yes' } },
      ],
      relations: GAME_RELATIONS[kind] || [],
      fields: [
        // зображення — першим (у таблиці мініатюра перед назвою)
        ...Object.entries(g.cols).map(([c, t]) => gameField(kind, c, t)).sort((a, b) => rank(a) - rank(b)),
        { key: 'hidden', label: 'Сховано на сайті', type: 'bool', filter: true },
        { key: 'locked', label: 'Змінено вручну', type: 'bool', filter: true, help: 'Оновлення даних гри не чіпає записи, змінені вручну' },
        { key: 'unreleased', label: 'Ще не в грі', type: 'bool', filter: true, readonly: true, help: 'За файлами гри цього ще (чи вже) нема в грі — сайт не показує, доки не відкрити' },
        { key: 'revealed', label: 'Показувати, хоч ще не в грі', type: 'bool', filter: true, help: 'Сайт покаже це, хоч у грі його ще нема (лишається й після оновлення даних)' },
        updated,
      ],
      hooks: {
        after: () => game.invalidate(),
        // рецепт без власної назви — зветься тим, що з нього виходить
        ...(kind === 'recipe' ? { rows: (rows) => {
          for (const x of rows) {
            if (x.name) continue
            let out = x.outputs
            try { if (typeof out === 'string') out = JSON.parse(out) } catch { out = null }
            const id = Array.isArray(out?.[0]) ? String(out[0][0]) : null
            const n = id && x.outputs__refs?.[id]?.[0]
            if (n) x.name__label = n
          }
          return rows
        } } : {}),
      },
      actions: [
        { key: 'hide', label: 'Сховати на сайті', bulk: true, row: true, show: { hidden: false }, run: async (rows) => { for (const r of rows) await db.run(`UPDATE ${g.table} SET hidden = 1, locked = 1, updated = ? WHERE ${g.key} = ?`, now(), r[g.key]) } },
        { key: 'unhide', label: 'Показувати на сайті', bulk: true, row: true, show: { hidden: true }, run: async (rows) => { for (const r of rows) await db.run(`UPDATE ${g.table} SET hidden = 0, updated = ? WHERE ${g.key} = ?`, now(), r[g.key]) } },
        { key: 'unlock', label: 'Скасувати ручні зміни при оновленні', bulk: true, row: true, show: { locked: true }, confirm: 'Наступне оновлення даних гри перепише цей запис тим, що в грі.', run: async (rows) => { for (const r of rows) await db.run(`UPDATE ${g.table} SET locked = 0 WHERE ${g.key} = ?`, r[g.key]) } },
        { key: 'reveal', label: 'Показати на сайті заздалегідь', bulk: true, row: true, show: { unreleased: true, revealed: false }, run: async (rows) => { for (const r of rows) await db.run(`UPDATE ${g.table} SET revealed = 1, updated = ? WHERE ${g.key} = ?`, now(), r[g.key]); game.invalidate() } },
        { key: 'unreveal', label: 'Сховати, доки не в грі', bulk: true, row: true, show: { revealed: true }, run: async (rows) => { for (const r of rows) await db.run(`UPDATE ${g.table} SET revealed = 0, updated = ? WHERE ${g.key} = ?`, now(), r[g.key]); game.invalidate() } },
      ],
    }
  })

  // ---------- хто кого може змінювати ----------
  /** чи покривають мої дозволи всі дозволи ролі (роль «не ширша» за мої права) */
  const covers = (mine, perms) => [...perms].every((p) => roles.has(mine, p))
  /**
   * Людина me може змінювати людину target: адміністрацію (вхід у панель) — лише той, хто має всі права; решту — якщо
   * роль цілі не ширша за права самої me. Себе — лише профіль (self), без ролі, пошти, блокування чи видалення.
   */
  async function assertCanManage(me, target, { self = false } = {}) {
    if (target.id === me.id) { if (self) return; throw fail('себе тут не змінюють — для цього є профіль', 403) }
    const mine = await roles.permsOf(me.role)
    if (mine.has('*')) return
    const theirs = await roles.permsOf(target.role)
    if (theirs.has('*') || theirs.has('admin')) throw fail('цю людину може змінювати лише адміністратор', 403)
    if (!covers(mine, theirs)) throw fail('у цієї людини більше прав, ніж у тебе', 403)
  }
  /** дати роль можна лише тоді, коли сам маєш усі її права */
  async function assertCanGrant(me, role) {
    if (!(await roles.exists(role))) throw fail('невідома роль')
    const mine = await roles.permsOf(me.role)
    if (!mine.has('*') && !covers(mine, await roles.permsOf(role))) throw fail('цю роль може дати лише той, хто має всі її права', 403)
  }
  /** чи остання це людина з усіма правами */
  const lastAdmin = async (u) => (await roles.permsOf(u.role)).has('*') && (await auth.admins()) < 2
  /**
   * Змінювати роль можна, лише якщо вона не ширша за мої права; свою — лише адміністратору; дати можна тільки ті
   * права, які маю сам.
   */
  async function assertRoleEdit(me, key, perms) {
    const mine = await roles.permsOf(me.role)
    if (mine.has('*')) return
    if (key && key === me.role) throw fail('свою роль змінює лише адміністратор', 403)
    if (key && (await roles.exists(key)) && !covers(mine, await roles.permsOf(key))) throw fail('у цієї ролі більше прав, ніж у тебе', 403)
    if (perms.some((p) => !roles.has(mine, p))) throw fail('дати можна лише ті права, які маєш сам', 403)
  }

  /** [мова, ключ] з id перекладу; хибний id — 400, а не збій сервера */
  const pairOf = (id) => {
    let v = null
    try { v = JSON.parse(id) } catch { /* нижче */ }
    if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'string' || typeof v[1] !== 'string') throw fail('хибний ключ запису')
    return v
  }

  /** slug гільдій → id (журнал пише адресу з slug) */
  const guildIds = async (slugs) => new Map((await db.all(`SELECT id, slug FROM guilds WHERE slug IN (${slugs.map(() => '?').join(', ')})`, ...slugs)).map((g) => [g.slug, g.id]))

  const all = [
    // ================= Люди =================
    {
      name: 'users', label: 'Люди', one: 'Людина', group: 'Люди', icon: 'users', table: 'users', key: 'id', title: 'name',
      sort: 'created DESC',
      about: 'Облікові записи сайту. Вхід — кодом на пошту, тож щоб додати людину, досить її пошти.',
      removeNote: 'Разом із людиною зникнуть її особисті речі, зірки й сеанси; якщо вона лідер — лідером стане хтось із гільдії.',
      forgetOnDelete: true,
      // швидкі фільтри над таблицею (значення — як у «Фільтрах»; '-7d' — від тижня тому)
      quick: [
        { key: 'new', label: 'Нові за тиждень', filters: { created: { from: '-7d' } } },
        { key: 'staff', label: 'Адміністрація', filters: { role: ['admin', 'moderator'] } },
        { key: 'banned', label: 'Заблоковані', filters: { banned: 'yes' } },
      ],
      fields: [
        { key: 'id', label: 'ID', type: 'text', readonly: true, mono: true, list: false, advanced: true },
        { key: 'name', label: 'Ім’я', type: 'text', search: true, sort: true, max: 40 },
        { key: 'login', label: 'Адреса профілю', type: 'slug', search: true, sort: true, mono: true, help: 'Частина адреси сторінки людини: /u/адреса. Латиниця, цифри й дефіс' },
        { key: 'email', label: 'Пошта', type: 'email', search: true, sort: true, required: true },
        { key: 'nick', label: 'Нік у грі', type: 'text', search: true, max: 40 },
        { key: 'role', label: 'Роль', type: 'select', optionsFn: async () => (await roles.list()).map((r) => ({ value: r.key, label: r.name })), filter: true, sort: true, tones: { admin: 'critical', moderator: 'warning', user: 'neutral' } },
        { key: 'main_guild', label: 'Гільдія', type: 'relation', resource: 'guilds', filter: true, readonly: true, help: 'Гільдія людини — одна; змінюється вступом чи виходом (розділ «Учасники гільдій»)' },
        { key: 'color', label: 'Колір аватарки', type: 'color', list: false },
        { key: 'bio', label: 'Про себе', type: 'textarea', list: false, max: 500 },
        { key: 'banned', label: 'Заблоковано', type: 'flag', readonly: true, filter: true, sort: true },
        { key: 'ban_reason', label: 'Причина блокування', type: 'text', readonly: true, list: false },
        { ...created, label: 'Зареєструвався(-лась)' }, { key: 'seen', label: 'Востаннє на сайті', type: 'datetime', readonly: true, sort: true, filter: true },
        { key: 'guilds_n', label: 'У гільдіях', type: 'int', readonly: true, form: false, sql: '(SELECT COUNT(*) FROM members m WHERE m.user_id = users.id)', sort: true, hidden: true },
        { key: 'items_n', label: 'Речей', type: 'int', readonly: true, form: false, sql: "(SELECT COUNT(*) FROM items i WHERE i.owner_kind = 'user' AND i.owner_id = users.id)", sort: true },
        { key: 'passkeys_n', label: 'Ключів входу', type: 'int', readonly: true, form: false, sql: '(SELECT COUNT(*) FROM passkeys p WHERE p.user_id = users.id)', sort: true },
        { key: 'two_factor', label: 'Двофакторна перевірка', type: 'flag', readonly: true, form: false, sql: '(SELECT f.enabled FROM user_2fa f WHERE f.user_id = users.id)', filter: true },
      ],
      link: { user: 'login' },
      relations: [
        { resource: 'members', field: 'user_id', label: 'Гільдія' },
        { resource: 'items', match: { owner_kind: 'user', owner_id: '$id' }, label: 'Речі' },
        { resource: 'sessions', field: 'user_id', label: 'Сеанси' },
        { resource: 'passkeys', field: 'user_id', label: 'Ключі входу' },
        { resource: 'push', field: 'user_id', label: 'Сповіщення' },
        { resource: 'stars', field: 'user_id', label: 'Зірки' },
        { resource: 'audit', field: 'actor', label: 'Дії в журналі' },
      ],
      hooks: {
        async create(dv, me) {
          if (await auth.byEmail(dv.email)) throw fail('людина з такою поштою вже є', 409)
          if (dv.role) await assertCanGrant(me, dv.role)
          const { user } = await auth.create(dv.email)
          // хибна адреса сторінки чи роль — людини не лишаємо (інакше повтор скаже «вже є»)
          try {
            const p = {}
            for (const k of ['name', 'nick', 'bio', 'color', 'login']) if (dv[k]) p[k] = dv[k]
            if (Object.keys(p).length) await auth.updateProfile(user.id, p)
            if (dv.role && dv.role !== user.role) await auth.setRole(user.id, dv.role)
          } catch (e) {
            await removeUser(user.id).catch(() => {})
            throw e
          }
          return user.id
        },
        async update(id, dv, old, me) {
          await assertCanManage(me, old, { self: true })
          const p = {}
          for (const k of ['name', 'nick', 'bio', 'color', 'login']) if (k in dv) p[k] = dv[k] ?? ''
          if (Object.keys(p).length) await auth.updateProfile(id, p)
          if (dv.email && dv.email !== old.email) {
            // пошта — це вхід: хто її змінить, той і увійде, тож лише адміністратор; старі сеанси й коди — геть
            if (!(await roles.permsOf(me.role)).has('*')) throw fail('пошту змінює лише адміністратор', 403)
            if (await auth.byEmail(dv.email)) throw fail('людина з такою поштою вже є', 409)
            await db.run('UPDATE users SET email = ? WHERE id = ?', dv.email, id)
            await db.run('DELETE FROM sessions WHERE user_id = ?', id)
            await db.run('DELETE FROM login_codes WHERE email = ? OR email = ?', old.email, dv.email)
          }
          if (dv.role && dv.role !== old.role) {
            if (id === me.id) throw fail('собі роль тут не змінюють')
            await assertCanGrant(me, dv.role)
            if (await lastAdmin(old)) throw fail('це єдиний адміністратор')
            await auth.setRole(id, dv.role)
          }
        },
        async remove(id, old, me) {
          if (id === me.id) throw fail('себе видалити тут не можна — у профілі')
          await assertCanManage(me, old)
          if (await lastAdmin(old)) throw fail('це єдиний адміністратор')
          await removeUser(id)
        },
      },
      actions: [
        { key: 'ban', label: 'Заблокувати', tone: 'critical', bulk: true, row: true, show: { banned: null },
          fields: [{ key: 'reason', label: 'Причина', type: 'text', max: 300 }],
          run: async (rows, v, me) => {
            // спершу перевірка всіх — щоб не заблокувати половину й упасти на другій
            for (const u of rows) { if (u.id === me.id) throw fail('себе заблокувати не можна'); await assertCanManage(me, u) }
            for (const u of rows) { await auth.ban(u.id, v.reason || ''); await guilds.stepDown(u.id) }
          } },
        { key: 'unban', label: 'Розблокувати', bulk: true, row: true, show: { banned: '!null' }, run: async (rows, v, me) => { for (const u of rows) await assertCanManage(me, u); for (const u of rows) await auth.unban(u.id) } },
        { key: 'logout', label: 'Вийти на всіх пристроях', bulk: true, row: true, confirm: 'Закрити всі сеанси цих людей? Їм доведеться увійти знову.', run: async (rows, v, me) => { for (const u of rows) await assertCanManage(me, u); for (const u of rows) await db.run('DELETE FROM sessions WHERE user_id = ?', u.id) } },
        // втратив телефон і резервні коди — увійде знову кодом із пошти, а перевірку налаштує заново
        { key: 'reset2fa', label: 'Вимкнути двофакторну перевірку', tone: 'critical', row: true, show: { two_factor: '!null' },
          confirm: 'Вимкнути двофакторну перевірку? Людина входитиме лише кодом із пошти, доки не ввімкне її знову. Роби це, лише переконавшись, що це справді вона.',
          run: async (rows, v, me) => { for (const u of rows) await assertCanManage(me, u); for (const u of rows) { await db.run('DELETE FROM user_2fa WHERE user_id = ?', u.id); await db.run('DELETE FROM recovery_codes WHERE user_id = ?', u.id) } } },
        { key: 'dropPasskeys', label: 'Видалити всі ключі входу', tone: 'critical', bulk: true, row: true, show: { passkeys_n: '!0' },
          confirm: 'Видалити всі ключі входу (паскеї) цих людей? Увійти ними більше не вийде — лише кодом із пошти.',
          run: async (rows, v, me) => { for (const u of rows) await assertCanManage(me, u); for (const u of rows) await db.run('DELETE FROM passkeys WHERE user_id = ?', u.id) } },
      ],
    },
    {
      name: 'passkeys', label: 'Ключі входу', one: 'Ключ входу', group: 'Люди', icon: 'fingerprint', table: 'passkeys', key: 'id', title: 'name', create: false, sort: 'created DESC',
      about: 'Паскеї — ключі, якими люди входять без коду з пошти. Видалити — увійти цим ключем більше не вийде (сам ключ лишиться на пристрої, але нічого не відкриє).',
      hooks: {
        async update(id, dv, old, me) {
          await assertCanManage(me, await auth.get(old.user_id), { self: true })
          if ('name' in dv) await db.run('UPDATE passkeys SET name = ? WHERE id = ?', String(dv.name || '').trim().slice(0, 60) || old.name, id)
        },
        async remove(id, old, me) {
          await assertCanManage(me, await auth.get(old.user_id), { self: true })
          await db.run('DELETE FROM passkeys WHERE id = ?', id)
        },
      },
      fields: [
        { key: 'id', label: 'ID ключа', type: 'text', readonly: true, mono: true, list: false, advanced: true },
        { key: 'name', label: 'Назва', type: 'text', search: true, sort: true, max: 60, required: true },
        { key: 'user_id', label: 'Людина', type: 'relation', resource: 'users', readonly: true, filter: true },
        { key: 'agent', label: 'Браузер, де створено', type: 'text', readonly: true, search: true, list: false },
        { key: 'backed_up', label: 'Синхронізується', type: 'bool', readonly: true, filter: true, help: 'Ключ у менеджері паролів (iCloud, Google, 1Password…) — є на всіх пристроях людини' },
        { key: 'transports', label: 'Як ключ підключається', type: 'text', readonly: true, list: false, mono: true, advanced: true },
        { key: 'counter', label: 'Лічильник входів ключа', type: 'int', readonly: true, list: false, advanced: true },
        { ...created },
        { key: 'last_used', label: 'Востаннє ним входили', type: 'datetime', readonly: true, sort: true },
      ],
    },
    {
      name: 'sessions', label: 'Сеанси', one: 'Сеанс', group: 'Люди', icon: 'monitor-smartphone', table: 'sessions', key: 'id', create: false, sort: 'seen DESC',
      // IP — лише тим, хто має всі права (модератору досить знати, що сеанс є); пошук за IP — теж лише їм
      hooks: { async rows(rows, user) { if (!(await roles.permsOf(user.role)).has('*')) for (const r of rows) if (r.ip) r.ip = String(r.ip).replace(/[\d]+$|[\da-f]*:[\da-f]*$/i, '•••'); return rows } },
      about: 'Де люди увійшли. Видалити сеанс — вийти на тому пристрої.',
      fields: [
        { key: 'id', label: 'ID', type: 'text', readonly: true, mono: true, list: false, advanced: true },
        { key: 'user_id', label: 'Людина', type: 'relation', resource: 'users', readonly: true, filter: true },
        { key: 'agent', label: 'Браузер і пристрій', type: 'text', readonly: true, search: true },
        { key: 'ip', label: 'IP-адреса', type: 'text', readonly: true, search: true, mono: true },
        { ...created, label: 'Увійшли' }, { key: 'seen', label: 'Востаннє активний', type: 'datetime', readonly: true, sort: true },
        { key: 'expires', label: 'Діє до', type: 'datetime', sort: true },
      ],
    },
    {
      name: 'login-codes', label: 'Коди входу', one: 'Код входу', group: 'Люди', icon: 'key-round', table: 'login_codes', key: 'email', create: false, sort: 'sent DESC', history: false,
      about: 'Надіслані, але ще не використані коди (самі коди не зберігаються — лише їхній відбиток).',
      fields: [
        { key: 'email', label: 'Пошта', type: 'email', readonly: true, search: true },
        { key: 'sent', label: 'Надіслано', type: 'datetime', readonly: true, sort: true },
        { key: 'expires', label: 'Діє до', type: 'datetime', readonly: true, sort: true },
        { key: 'tries', label: 'Спроб ввести', type: 'int', readonly: true },
      ],
    },

    // ================= Гільдії =================
    {
      name: 'guilds', label: 'Гільдії', one: 'Гільдія', group: 'Гільдії', icon: 'shield', table: 'guilds', key: 'id', title: 'name', sort: 'created DESC',
      quick: [{ key: 'open', label: 'Приймають заявки', filters: { open: 'yes' } }],
      about: 'Гільдії сайту: назва, тег, адреса сторінки, учасники й речі.',
      removeNote: 'Разом із гільдією зникнуть її речі, учасники, запрошення й заявки.',
      link: { guild: 'slug' },
      relations: [
        { resource: 'members', field: 'guild_id', label: 'Учасники' },
        { resource: 'items', match: { owner_kind: 'guild', owner_id: '$id' }, label: 'Речі гільдії' },
        { resource: 'invites', field: 'guild_id', label: 'Запрошення' },
        { resource: 'requests', field: 'guild_id', label: 'Заявки' },
      ],
      fields: [
        { key: 'id', label: 'ID', type: 'text', readonly: true, mono: true, list: false, advanced: true },
        { key: 'name', label: 'Назва', type: 'text', search: true, sort: true, required: true, max: 60 },
        { key: 'tag', label: 'Тег', type: 'text', search: true, sort: true, required: true, max: 5, mono: true, help: 'Коротка позначка в квадратних дужках біля імен, до 5 знаків' },
        { key: 'slug', label: 'Адреса сторінки', type: 'slug', search: true, mono: true, help: 'Частина адреси: /g/адреса. Порожньо при створенні — з назви' },
        { key: 'color', label: 'Колір гільдії', type: 'color', list: false },
        { key: 'open', label: 'Приймає заявки', type: 'bool', filter: true },
        { key: 'about', label: 'Про гільдію', type: 'textarea', list: false, max: 1000 },
        { key: 'members_n', label: 'Учасників', type: 'int', readonly: true, form: false, sql: '(SELECT COUNT(*) FROM members m WHERE m.guild_id = guilds.id)', sort: true },
        { key: 'items_n', label: 'Речей', type: 'int', readonly: true, form: false, sql: "(SELECT COUNT(*) FROM items i WHERE i.owner_kind = 'guild' AND i.owner_id = guilds.id)", sort: true },
        { ...created },
      ],
      hooks: {
        async create(dv) {
          const g = await guilds.create({ name: dv.name, tag: dv.tag, about: dv.about || '', color: dv.color || paletteFor(dv.name), open: !!dv.open }, null, dv.slug ? { slug: dv.slug } : {})
          return g.id
        },
        async update(id, dv) {
          const p = {}
          for (const k of ['name', 'tag', 'about', 'color', 'open']) if (k in dv) p[k] = k === 'open' ? !!dv[k] : dv[k]
          if (Object.keys(p).length) await guilds.update(id, p)
          if (dv.slug) {
            if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(dv.slug)) throw fail('адреса — латиниця, цифри й дефіс, 2–32 знаки')
            if (/^g[a-z0-9]{11}$/.test(dv.slug)) throw fail('така адреса схожа на службову — вибери іншу')
            const other = await guilds.get(dv.slug)
            if (other && other.id !== id) throw fail('така адреса вже зайнята', 409)
            await db.run('UPDATE guilds SET slug = ? WHERE id = ?', dv.slug, id)
          }
        },
        remove: (id) => deleteGuild(id),
      },
    },
    {
      name: 'members', label: 'Учасники гільдій', one: 'Учасник', group: 'Гільдії', icon: 'user-round-check', table: 'members', key: ['guild_id', 'user_id'], title: 'who', sort: 'joined DESC',
      about: 'Хто в якій гільдії і з яким рангом. Людина — лише в одній гільдії; лідер у гільдії один.',
      fields: [
        { key: 'guild_id', label: 'Гільдія', type: 'relation', resource: 'guilds', filter: true, readonly: true, create: true, required: true },
        { key: 'user_id', label: 'Людина', type: 'relation', resource: 'users', filter: true, readonly: true, create: true, required: true },
        { key: 'role', label: 'Ранг', type: 'select', options: opts([...GUILD_ROLES].reverse(), GROLE_L), filter: true, sort: true, required: true, tones: { leader: 'critical', officer: 'warning', member: 'info', recruit: 'neutral' } },
        { key: 'joined', label: 'Коли вступив(-ла)', type: 'datetime', readonly: true, sort: true },
        { key: 'who', label: 'Учасник', type: 'text', readonly: true, form: false, list: false, sql: "(SELECT u.name FROM users u WHERE u.id = members.user_id) || ' · ' || (SELECT g.name FROM guilds g WHERE g.id = members.guild_id)" },
      ],
      hooks: {
        async create(dv) {
          if (await guilds.rankOf(dv.guild_id, dv.user_id)) throw fail('ця людина вже в гільдії', 409)
          // ліміт учасників — як і на сайті
          const cap = await auth.guildCap(), n = await guilds.memberCount(dv.guild_id)
          if (n >= cap) throw fail('Гільдія заповнена ({n} з {cap})', 400, { n, cap })
          await guilds.addMember(dv.guild_id, dv.user_id, dv.role || 'member')
          return JSON.stringify([dv.guild_id, dv.user_id])
        },
        async update(id, dv, old) {
          const [g, u] = JSON.parse(id)
          if (!dv.role || dv.role === old.role) return
          // лідер у гільдії один: новий лідер — колишній стає офіцером; єдиного лідера просто так не знімають
          if (dv.role === 'leader') {
            for (const l of await db.all("SELECT user_id FROM members WHERE guild_id = ? AND role = 'leader' AND user_id <> ?", g, u)) await guilds.setRole(g, l.user_id, 'officer')
          } else if (old.role === 'leader') throw fail('у гільдії має бути лідер — признач лідером когось іншого', 400)
          await guilds.setRole(g, u, dv.role)
        },
        async remove(id, old) {
          const [g, u] = JSON.parse(id)
          if (old.role === 'leader' && Number((await db.get('SELECT COUNT(*) AS n FROM members WHERE guild_id = ?', g)).n) > 1) throw fail('це лідер гільдії — спершу признач лідером когось іншого', 400)
          await guilds.removeMember(g, u)
        },
      },
    },
    {
      name: 'invites', label: 'Запрошення', one: 'Запрошення', group: 'Гільдії', icon: 'ticket', table: 'invites', key: 'code', sort: 'created DESC',
      about: 'Посилання-запрошення до гільдій: хто створив, до коли діє, скільки разів використали.',
      fields: [
        { key: 'code', label: 'Код запрошення', type: 'text', readonly: true, mono: true, search: true },
        { key: 'guild_id', label: 'Гільдія', type: 'relation', resource: 'guilds', filter: true, readonly: true, create: true, required: true },
        { key: 'by_user', label: 'Хто запросив', type: 'relation', resource: 'users', readonly: true },
        { ...created },
        { key: 'expires', label: 'Діє до', type: 'datetime', sort: true, help: 'Порожньо — безстроково' },
        { key: 'uses', label: 'Скільки разів використали', type: 'int', readonly: true, sort: true },
        { key: 'max_uses', label: 'Скільки разів можна використати', type: 'int', help: 'Порожньо — без обмежень' },
      ],
      link: { invite: 'code' },
      hooks: {
        async create(dv, me) {
          const days = dv.expires ? Math.max(1, Math.ceil((dv.expires - Date.now()) / 86400_000)) : 0
          const i = await guilds.invite(dv.guild_id, me.id, { days, uses: dv.max_uses || 0 })
          return i.code
        },
      },
    },
    {
      name: 'requests', label: 'Заявки до гільдій', one: 'Заявка', group: 'Гільдії', icon: 'inbox', table: 'requests', key: ['guild_id', 'user_id'], create: false, sort: 'created DESC',
      about: 'Люди, що попросились до гільдії. Прийняти — стане новобранцем.',
      fields: [
        { key: 'guild_id', label: 'Гільдія', type: 'relation', resource: 'guilds', filter: true, readonly: true },
        { key: 'user_id', label: 'Людина', type: 'relation', resource: 'users', filter: true, readonly: true },
        { key: 'note', label: 'Повідомлення від людини', type: 'textarea', search: true },
        { ...created },
      ],
      actions: [
        { key: 'accept', label: 'Прийняти новобранцем', bulk: true, row: true, run: async (rows) => {
          // як на сайті: з лімітом учасників гільдії
          const cap = await auth.guildCap()
          for (const r of rows) { await guilds.addMember(r.guild_id, r.user_id, 'recruit', { cap }); await guilds.dropRequest(r.guild_id, r.user_id) }
        } },
      ],
    },

    // ================= Вміст =================
    {
      name: 'items', label: 'Реєстр речей', one: 'Річ', group: 'Вміст', icon: 'library', table: 'items', key: ['kind', 'id'], title: 'title', create: false, sort: 'updated DESC',
      about: 'Усе, що люди й гільдії створили на сайті: чиє, хто бачить, що в бібліотеці. Видалити — стерти разом із вмістом.',
      removeNote: 'Разом із річчю зникнуть її вміст, версії й зірки.',
      quick: [
        { key: 'public', label: 'Публічне', filters: { visibility: ['public'] } },
        { key: 'featured', label: 'Вибране', filters: { featured: 'yes' } },
        { key: 'hidden', label: 'Сховане', filters: { hidden: 'yes' } },
      ],
      link: { kind: 'kind' },
      fields: [
        { key: 'kind', label: 'Що це', type: 'select', options: opts(KINDS, KIND_L), filter: true, readonly: true, sort: true },
        { key: 'id', label: 'Адреса (ID)', type: 'text', readonly: true, mono: true, search: true, list: false },
        { key: 'title', label: 'Назва', type: 'text', search: true, sort: true, readonly: true, help: 'Назва й опис беруться з самої речі — змінюй їх у її розділі' },
        { key: 'summary', label: 'Опис', type: 'textarea', list: false, readonly: true },
        { key: 'owner_kind', label: 'Чиє', type: 'select', options: opts(['user', 'guild', 'site'], OWNER_L), filter: true, list: false, form: false },
        { key: 'owner_id', label: 'Власник', type: 'owner', kindField: 'owner_kind', filter: true },
        { key: 'visibility', label: 'Хто бачить', type: 'select', options: opts(VIS, VIS_L), filter: true, sort: true, tones: { private: 'neutral', guild: 'info', link: 'warning', public: 'success' } },
        // сховане й вибране — швидкими фільтрами над таблицею, тож стовпці типово сховані (місце — назві)
        { key: 'hidden', label: 'Сховано модерацією', type: 'flag', filter: true, hidden: true },
        { key: 'featured', label: 'У вибраному', type: 'flag', filter: true, hidden: true },
        { key: 'stars', label: 'Зірок', type: 'int', readonly: true, sort: true },
        { key: 'copies', label: 'Скільки разів скопіювали', type: 'int', readonly: true, sort: true, hidden: true },
        { key: 'created_by', label: 'Автор', type: 'relation', resource: 'users', readonly: true, filter: true, list: false },
        { key: 'based_on', label: 'Копія чого', type: 'json', readonly: true, list: false, advanced: true },
        { ...created }, updated,
        { key: 'published', label: 'Опубліковано', type: 'datetime', readonly: true, sort: true, list: false },
      ],
      hooks: {
        rows: ownerLabels,
        async update(id, dv, old, me) {
          const [kind, iid] = JSON.parse(id)
          if (dv.owner_kind || dv.owner_id || dv.visibility) await access(kind, iid, dv, old, me)
          if ('hidden' in dv || 'featured' in dv) {
            await items.moderate(kind, iid, { hidden: 'hidden' in dv ? !!dv.hidden : undefined, featured: 'featured' in dv ? !!dv.featured : undefined })
          }
        },
        async remove(id, old, me) {
          const [kind, iid] = JSON.parse(id)
          await content.purge(kind, iid)
        },
      },
      actions: [
        { key: 'hide', label: 'Сховати з бібліотеки', bulk: true, row: true, show: { hidden: null }, confirm: 'Сховати з бібліотеки? Власники й далі бачать свої речі, а інші — ні.', run: async (rows) => { for (const r of rows) await items.moderate(r.kind, r.id, { hidden: true }) } },
        { key: 'unhide', label: 'Повернути в бібліотеку', bulk: true, row: true, show: { hidden: '!null' }, run: async (rows) => { for (const r of rows) await items.moderate(r.kind, r.id, { hidden: false }) } },
        { key: 'feature', label: 'У вибране', bulk: true, row: true, show: { featured: null }, run: async (rows) => { for (const r of rows) await items.moderate(r.kind, r.id, { featured: true }) } },
        { key: 'unfeature', label: 'Прибрати з вибраного', bulk: true, row: true, show: { featured: '!null' }, run: async (rows) => { for (const r of rows) await items.moderate(r.kind, r.id, { featured: false }) } },
        { key: 'visibility', label: 'Змінити, хто бачить', bulk: true, fields: [{ key: 'visibility', label: 'Хто бачить', type: 'select', options: opts(VIS, VIS_L), required: true }],
          run: async (rows, v) => { for (const r of rows) await items.setAccess(r.kind, r.id, { kind: r.owner_kind, id: r.owner_id }, v.visibility) } },
      ],
    },
    docResource({
      name: 'bases', kind: 'base', table: 'bases', label: 'Бази', one: 'База', icon: 'castle', clean: cleanBase, preview: 'base3d',
      quick: [{ key: 'public', label: 'Публічні', filters: { visibility: ['public'] } }, { key: 'trash', label: 'У кошику', filters: { deleted: 'yes' } }],
      relations: [{ resource: 'base-history', field: 'base_id', label: 'Версії' }],
      extra: [
        { key: 'version', label: 'Версія', type: 'int', readonly: true, sort: true },
        { key: 'note', label: 'Примітка до версії', type: 'text', tr: true, list: false, max: 300, help: 'Що змінилось — видно в історії версій' },
        { key: 'deleted', label: 'У кошику', type: 'flag', readonly: true, filter: true },
      ],
      write: async (id, doc, old, dv, user) => {
        const r = await bases.put(id, doc, old.version, dv?.note || 'Змінено в панелі керування', undefined, user?.id || null)
        if (r?.conflict) throw fail('хтось уже змінив цю базу — онови сторінку', 409)
      },
      actions: [
        { key: 'trash', label: 'У кошик', bulk: true, row: true, show: { deleted: null }, run: async (rows) => { for (const r of rows) await bases.remove(r.id) } },
        { key: 'restore', label: 'Повернути з кошика', bulk: true, row: true, show: { deleted: '!null' }, run: async (rows) => { for (const r of rows) await bases.undelete(r.id) } },
      ],
    }),
    docResource({
      name: 'roadmaps', kind: 'roadmap', table: 'roadmaps', label: 'Роадмапи', one: 'Роадмап', icon: 'route', clean: cleanRoadmap,
      relations: [{ resource: 'roadmap-history', field: 'roadmap_id', label: 'Версії' }],
      extra: [{ key: 'version', label: 'Версія', type: 'int', readonly: true, sort: true }],
      write: async (id, doc, old) => {
        const r = await roadmaps.put(id, doc, old.version)
        if (r?.conflict) throw fail('хтось уже змінив роадмап — онови сторінку', 409)
      },
    }),
    docResource({ name: 'builds', kind: 'build', table: 'builds', label: 'Білди', one: 'Білд', icon: 'swords', clean: cleanBuild, write: docPut(builds) }),
    docResource({ name: 'calcs', kind: 'calc', table: 'calcs', label: 'Розрахунки', one: 'Розрахунок', icon: 'calculator', clean: cleanCalc, write: docPut(calcs) }),
    docResource({
      name: 'markers', kind: 'marker', table: 'markers', label: 'Позначки на мапі', one: 'Позначка', icon: 'map-pin',
      clean: (doc) => cleanMarker(doc, mapData), write: docPut(markers),
    }),
    docResource({
      name: 'places', kind: 'place', table: 'places', label: 'Записи ресурсів', one: 'Запис ресурсу', icon: 'gem',
      clean: (doc) => { if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw fail('порожній запис'); return doc },
      write: async (id, doc) => { const cur = await places.get(id); if (!cur) throw fail('немає такого запису', 404); await db.run('UPDATE places SET doc = ?, updated = ? WHERE id = ?', JSON.stringify(doc), now(), id) },
    }),
    docResource({
      name: 'events', kind: 'event', table: 'events', label: 'Події', one: 'Подія', icon: 'calendar-days',
      about: 'Події спільноти: бої, турніри, перегони, збори. Вміст — як із редактора події; команди — у вкладці «Команди».',
      extra: [
        { key: 'type', label: 'Вид', type: 'select', options: opts(EVENT_TYPES, EVENT_TYPE_L), sql: 't.type', readonly: true, filter: true },
        { key: 'starts', label: 'Початок', type: 'datetime', sql: 't.starts', readonly: true, sort: true, filter: true },
        { key: 'teams_n', label: 'Команд', type: 'int', readonly: true, form: false, sql: '(SELECT COUNT(*) FROM event_teams et WHERE et.event_id = t.id)', sort: true },
      ],
      relations: [{ resource: 'event-teams', field: 'event_id', label: 'Команди' }],
      // з панелі можна правити й давню подію (на сайті початок — не раніше як рік тому)
      clean: (doc) => cleanEvent(doc, { maps: mapData, now: Number.isFinite(doc?.starts) ? Math.min(Date.now(), doc.starts) : Date.now() }),
      write: docPut(events),
    }),
    {
      name: 'event-teams', label: 'Команди подій', one: 'Команда', group: 'Вміст', icon: 'users', table: 'event_teams', key: 'id', title: 'name', create: false, sort: 'created DESC',
      about: 'Команди, що зареєструвались на події: капітан, гравці, чи бере участь.',
      fields: [
        { key: 'id', label: 'ID', type: 'text', readonly: true, mono: true, hidden: true },
        { key: 'event_id', label: 'Подія', type: 'relation', resource: 'events', filter: true, readonly: true },
        { key: 'name', label: 'Назва', type: 'text', search: true, sort: true, required: true, max: 40 },
        { key: 'captain', label: 'Капітан', type: 'relation', resource: 'users', filter: true, readonly: true },
        { key: 'status', label: 'Статус', type: 'select', options: opts(TEAM_STATUS, TEAM_STATUS_L), filter: true, sort: true, tones: { pending: 'info', confirmed: 'success', reserve: 'warning', rejected: 'neutral' } },
        { key: 'members', label: 'Гравці', type: 'json', readonly: true, list: false, advanced: true },
        { key: 'note', label: 'Примітка', type: 'textarea', list: false, max: 300 },
        { ...created }, updated,
      ],
      // гравців із сайту — разом із командою (інакше вони «вже в команді» події, якої нема)
      hooks: { remove: (id) => events.removeTeam(id) },
    },
    {
      name: 'base-history', label: 'Версії баз', one: 'Версія бази', group: 'Вміст', icon: 'history', table: 'base_history', key: 'hid', create: false, sort: 'hid DESC',
      about: 'Попередні версії баз. Відкрий версію — побачиш, що змінилось у наступній; її можна відновити.',
      fields: [
        { key: 'hid', label: '№', type: 'int', readonly: true, sort: true },
        { key: 'base_id', label: 'База', type: 'relation', resource: 'bases', filter: true, readonly: true },
        { key: 'version', label: 'Версія', type: 'int', readonly: true, sort: true },
        { key: 'note', label: 'Примітка до версії', type: 'text', tr: true, search: true, max: 300 },
        { key: 'updated', label: 'Збережено', type: 'datetime', readonly: true, sort: true, filter: true },
        { key: 'doc', label: 'Вміст як дані (JSON)', type: 'json', readonly: true, list: false, advanced: true },
      ],
      actions: [{ key: 'restore', label: 'Відновити цю версію', row: true, confirm: 'Відновити? Поточна версія піде в історію.', run: async (rows) => { for (const r of rows) await bases.restore(r.base_id, Number(r.hid)) } }],
    },
    {
      name: 'roadmap-history', label: 'Версії роадмапів', one: 'Версія роадмапу', group: 'Вміст', icon: 'history', table: 'roadmap_history', key: 'hid', create: false, sort: 'hid DESC',
      about: 'Попередні версії роадмапів. Відкрий версію — побачиш, що змінилось; її можна відновити.',
      fields: [
        { key: 'hid', label: '№', type: 'int', readonly: true, sort: true },
        { key: 'roadmap_id', label: 'Роадмап', type: 'relation', resource: 'roadmaps', filter: true, readonly: true },
        { key: 'version', label: 'Версія', type: 'int', readonly: true, sort: true },
        { key: 'updated', label: 'Збережено', type: 'datetime', readonly: true, sort: true, filter: true },
        { key: 'doc', label: 'Вміст як дані (JSON)', type: 'json', readonly: true, list: false, advanced: true },
      ],
      actions: [{ key: 'restore', label: 'Відновити цю версію', row: true, confirm: 'Відновити? Поточна версія піде в історію.', run: async (rows) => { for (const r of rows) await roadmaps.restore(r.roadmap_id, Number(r.hid)) } }],
    },
    {
      name: 'stars', label: 'Зірки', one: 'Зірка', group: 'Вміст', icon: 'star', table: 'stars', key: ['kind', 'id', 'user_id'], create: false, sort: 'at DESC',
      about: 'Хто яку річ відзначив зіркою.',
      fields: [
        { key: 'kind', label: 'Що це', type: 'select', options: opts(KINDS, KIND_L), filter: true, readonly: true },
        { key: 'id', label: 'Річ', type: 'text', readonly: true, search: true, ref: true },
        { key: 'user_id', label: 'Хто поставив', type: 'relation', resource: 'users', readonly: true, filter: true },
        { key: 'at', label: 'Коли', type: 'datetime', readonly: true, sort: true },
      ],
      hooks: {
        // річ — назвою й посиланням на її запис у панелі (нема — лише адреса)
        async rows(rows) {
          const keys = rows.map((r) => [r.kind, r.id])
          const got = keys.length ? await db.all(`SELECT kind, id, title FROM items WHERE ${keys.map(() => '(kind = ? AND id = ?)').join(' OR ')}`, ...keys.flat()) : []
          const m = new Map(got.map((x) => [`${x.kind}\n${x.id}`, x.title]))
          const RES = { base: 'bases', roadmap: 'roadmaps', build: 'builds', calc: 'calcs', marker: 'markers', place: 'places', event: 'events' }
          for (const r of rows) {
            const k = `${r.kind}\n${r.id}`
            r.id__label = m.has(k) ? m.get(k) || r.id : r.id
            r.id__ref = m.has(k) && RES[r.kind] ? [RES[r.kind], r.id] : null
          }
          return rows
        },
        // зірку прибрали — перераховуємо лише цю річ, а не всі речі сайту
        async remove(id) {
          const [kind, iid, uid] = JSON.parse(id)
          await db.run('DELETE FROM stars WHERE kind = ? AND id = ? AND user_id = ?', kind, iid, uid)
          await db.run('UPDATE items SET stars = (SELECT COUNT(*) FROM stars s WHERE s.kind = ? AND s.id = ?) WHERE kind = ? AND id = ?', kind, iid, kind, iid)
        },
      },
    },

    // ================= Гра =================
    ...gameResources,
    {
      name: 'game-texts', label: 'Тексти гри мовами', one: 'Текст гри', group: 'Гра', icon: 'languages', table: 'game_texts', key: ['kind', 'id', 'lang'], title: 'name',
      lockOnEdit: true, touch: 'updated', stamp: ['updated'], sort: 'kind, id, lang',
      about: 'Назви й описи предметів, пристроїв, рецептів, будівельних елементів і вмінь мовами гри — з файлів гри. Змінене вручну закріплюється: оновлення даних його не перепише.',
      quick: [{ key: 'manual', label: 'Змінені вручну', filters: { locked: 'yes' } }],
      fields: [
        { key: 'kind', label: 'Вид запису', type: 'select', options: opts(Object.keys(GAME), GAME_KIND_L), filter: true, sort: true, readonly: true, create: true, required: true },
        { key: 'id', label: 'Код у грі', type: 'text', mono: true, search: true, sort: true, readonly: true, create: true, required: true, ref: true },
        { key: 'lang', label: 'Мова', type: 'select', options: LANG_OPTS, filter: true, sort: true, readonly: true, create: true, required: true },
        { key: 'name', label: 'Назва', type: 'text', search: true, sort: true, max: 300 },
        { key: 'description', label: 'Опис', type: 'textarea', search: true, list: false, max: 4000 },
        { key: 'source', label: 'Звідки текст', type: 'select', options: opts(Object.keys(SRC_L), SRC_L), filter: true, readonly: true },
        { key: 'locked', label: 'Змінено вручну', type: 'bool', filter: true, help: 'Оновлення даних гри не перепише цей текст' },
        updated,
      ],
      hooks: {
        // код у грі — посиланням на сам запис гри
        rows(rows) {
          const RES = { item: 'game-items', placeable: 'game-placeables', recipe: 'game-recipes', buildable: 'game-buildables', skill: 'game-skills' }
          for (const r of rows) { r.id__label = r.id; r.id__ref = RES[r.kind] ? [RES[r.kind], r.id] : null }
          return rows
        },
        async create(dv) {
          await db.run('INSERT INTO game_texts (kind, id, lang, name, description, source, locked, updated) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', dv.kind, dv.id, dv.lang, dv.name || null, dv.description || null, 'manual', now())
          return JSON.stringify([dv.kind, dv.id, dv.lang])
        },
        after: () => game.invalidate(),
      },
      actions: [
        { key: 'unlock', label: 'Скасувати ручні зміни при оновленні', bulk: true, row: true, show: { locked: true }, confirm: 'Наступне оновлення даних гри перепише цей текст тим, що в грі.', run: async (rows) => { for (const r of rows) await db.run('UPDATE game_texts SET locked = 0 WHERE kind = ? AND id = ? AND lang = ?', r.kind, r.id, r.lang) } },
      ],
    },

    // ================= Сайт =================
    {
      name: 'announcements', label: 'Оголошення', one: 'Оголошення', group: 'Сайт', icon: 'megaphone', table: 'announcements', key: 'id', title: 'title',
      sort: 'COALESCE(starts, created) DESC', page: 'announcements', touch: 'updated',
      quick: [{ key: 'live', label: 'Показуються', filters: { status: ['live'] } }, { key: 'scheduled', label: 'Заплановані', filters: { status: ['scheduled'] } }],
      about: 'Смужка вгорі сайту. Показується від «Показувати з» до «Показувати до» (порожньо — без меж). Кілька одразу — серією (щодня, щотижня) чи списком.',
      fields: [
        { key: 'id', label: '№', type: 'int', readonly: true, sort: true, list: false },
        { key: 'status', label: 'Стан', type: 'select', readonly: true, form: false, filter: true, options: opts(['live', 'scheduled', 'ended', 'off'], { live: 'Показується', scheduled: 'Заплановано', ended: 'Завершено', off: 'Вимкнено' }),
          tones: { live: 'success', scheduled: 'info', ended: 'neutral', off: 'warning' },
          // час — у тексті SQL (вираз стовпця без параметрів); кеш запитів SQLite обмежений, тож це не роздуває пам'ять
          sql: () => { const t = Date.now(); return `(CASE WHEN enabled = 0 THEN 'off' WHEN starts IS NOT NULL AND starts > ${t} THEN 'scheduled' WHEN ends IS NOT NULL AND ends <= ${t} THEN 'ended' ELSE 'live' END)` } },
        { key: 'title', label: 'Заголовок', type: 'text', search: true, sort: true, required: true, max: 160 },
        { key: 'body', label: 'Текст', type: 'textarea', search: true, list: false, max: 1000 },
        { key: 'tone', label: 'Колір смужки', type: 'select', options: opts(TONES, TONE_L), filter: true, tones: { info: 'info', success: 'success', warning: 'warning', critical: 'critical' } },
        { key: 'audience', label: 'Кому показувати', type: 'select', options: opts(AUDIENCES, AUD_L), filter: true },
        { key: 'guild_id', label: 'Гільдія (для «Учасникам гільдії»)', type: 'relation', resource: 'guilds', list: false },
        { key: 'lang', label: 'Якою мовою сайту показувати', type: 'select', options: [{ value: '', label: 'Усі мови' }, ...LANG_OPTS], filter: true, list: false },
        { key: 'link_url', label: 'Адреса посилання', type: 'url', list: false, help: 'https://… чи /шлях на сайті' },
        { key: 'link_label', label: 'Текст посилання', type: 'text', list: false, max: 60 },
        { key: 'starts', label: 'Показувати з', type: 'datetime', sort: true, filter: true },
        { key: 'ends', label: 'Показувати до', type: 'datetime', sort: true, filter: true },
        { key: 'dismissible', label: 'Людина може закрити', type: 'bool', list: false },
        { key: 'enabled', label: 'Увімкнено', type: 'bool', filter: true, list: false },
        { key: 'batch', label: 'Серія (створено разом)', type: 'text', readonly: true, filter: true, mono: true, list: false },
        { key: 'created_by', label: 'Автор', type: 'relation', resource: 'users', readonly: true, list: false },
        { ...created, list: false }, updated,
      ],
      hooks: {
        async create(dv, me) { return announcements.create({ dismissible: true, enabled: true, ...dv }, me.id) },
        async update(id, dv, old) {
          const c = announcements.clean({ ...old, ...dv, dismissible: 'dismissible' in dv ? dv.dismissible : old.dismissible, enabled: 'enabled' in dv ? dv.enabled : old.enabled })
          const cols = Object.keys(c)
          await db.run(`UPDATE announcements SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated = ? WHERE id = ?`, ...cols.map((k) => c[k]), now(), Number(id))
        },
      },
      actions: [
        { key: 'enable', label: 'Увімкнути', bulk: true, row: true, show: { enabled: false }, run: async (rows) => { for (const r of rows) await db.run('UPDATE announcements SET enabled = 1, updated = ? WHERE id = ?', now(), r.id) } },
        { key: 'disable', label: 'Вимкнути', bulk: true, row: true, show: { enabled: true }, run: async (rows) => { for (const r of rows) await db.run('UPDATE announcements SET enabled = 0, updated = ? WHERE id = ?', now(), r.id) } },
        { key: 'end', label: 'Завершити зараз', bulk: true, row: true, confirm: 'Завершити ці оголошення зараз? Кінцем стане теперішній час.', run: async (rows) => { for (const r of rows) await db.run('UPDATE announcements SET ends = ?, updated = ? WHERE id = ?', now(), now(), r.id) } },
        { key: 'shift', label: 'Зсунути дати', bulk: true, fields: [{ key: 'days', label: 'На скільки днів (можна мінус)', type: 'int', required: true }, { key: 'hours', label: 'І годин', type: 'int' }],
          run: async (rows, v) => {
            const ms = (Number(v.days) || 0) * 86400_000 + (Number(v.hours) || 0) * 3600_000
            for (const r of rows) await db.run('UPDATE announcements SET starts = CASE WHEN starts IS NULL THEN NULL ELSE starts + ? END, ends = CASE WHEN ends IS NULL THEN NULL ELSE ends + ? END, updated = ? WHERE id = ?', ms, ms, now(), r.id)
          } },
        // копія вимкнена (інакше людям одразу дві однакові смужки) і з позначкою в назві; одну — одразу відкриваємо
        { key: 'duplicate', label: 'Дублювати', bulk: true, row: true, run: async (rows, v, me) => {
          const ids = []
          for (const r of rows) ids.push(await announcements.create({ ...r, title: `${r.title} (копія)`.slice(0, 160), enabled: false }, me.id))
          return { ok: true, n: ids.length, open: ids.length === 1 ? ['announcements', String(ids[0])] : null }
        } },
      ],
    },
    {
      name: 'translations', label: 'Переклади сайту', one: 'Переклад', group: 'Сайт', icon: 'languages', key: ['lang', 'key'], create: false, page: 'translations',
      about: 'Тексти інтерфейсу мовами. Ключ — український текст із коду. Правка тут важливіша за файл перекладу; видалити — повернути переклад із файлу.',
      fields: [
        { key: 'lang', label: 'Мова', type: 'select', options: LANG_OPTS.filter((l) => l.value !== 'uk'), filter: true, readonly: true },
        { key: 'key', label: 'Текст (українською)', type: 'textarea', readonly: true, search: true },
        { key: 'text', label: 'Переклад', type: 'textarea', search: true },
        { key: 'file', label: 'Переклад із файлу', type: 'textarea', readonly: true, list: false },
        { key: 'state', label: 'Стан', type: 'select', readonly: true, form: false, filter: true, options: opts(['missing', 'file', 'override'], { missing: 'Немає перекладу', file: 'З файлу', override: 'Змінено тут' }), tones: { missing: 'critical', file: 'neutral', override: 'info' } },
        { key: 'where', label: 'Де на сайті', type: 'list', readonly: true, list: false, view: 'none' },
      ],
      hooks: {
        async list(q) {
          const lang = (Array.isArray(q.filters?.lang) ? q.filters.lang[0] : q.filters?.lang) || 'en'
          const keys = i18n.keys()
          const s = String(q.search || '').trim().toLowerCase()
          const st = q.filters?.state
          let rows = Object.entries(keys).map(([key, where]) => {
            const ov = i18n.override(lang, key), file = i18n.fileText(lang, key)
            return { lang, key, text: ov ?? file ?? '', file: file ?? '', state: ov != null ? 'override' : file != null ? 'file' : 'missing', where }
          })
          if (s) rows = rows.filter((r) => r.key.toLowerCase().includes(s) || r.text.toLowerCase().includes(s))
          if (st && st.length) rows = rows.filter((r) => (Array.isArray(st) ? st : [st]).includes(r.state))
          if (q.sort === 'key' || q.sort === 'text') rows.sort((a, b) => a[q.sort].localeCompare(b[q.sort]) * (q.desc ? -1 : 1))
          const size = Math.min(200, Math.max(1, Number(q.size) || 50)), page = Math.max(0, Number(q.page) || 0)
          return { rows: rows.slice(page * size, page * size + size).map((r) => ({ _id: JSON.stringify([r.lang, r.key]), ...r })), total: rows.length, page, size }
        },
        async get(id) {
          const [lang, key] = pairOf(id)
          const ov = i18n.override(lang, key), file = i18n.fileText(lang, key)
          return { lang, key, text: ov ?? file ?? '', file: file ?? '', state: ov != null ? 'override' : file != null ? 'file' : 'missing', where: i18n.keys()[key] || [] }
        },
        async update(id, dv, old, me) { const [lang, key] = pairOf(id); await i18n.set(lang, key, dv.text ?? '', me.id) },
        async remove(id) { const [lang, key] = pairOf(id); await i18n.set(lang, key, null) },
      },
    },
    {
      // сторінка — «Налаштування сайту» (перевірка значень і дозвіл site.settings); напряму таблицю лише читають
      name: 'settings', label: 'Налаштування', one: 'Налаштування', group: 'Сайт', icon: 'settings', table: 'settings', key: 'k', title: 'name', page: 'settings', create: false, remove: false,
      about: 'Значення, з якими працює сайт. Змінюються на сторінці «Налаштування сайту».',
      fields: [
        { key: 'name', label: 'Що', type: 'text', readonly: true, tr: true, sql: `(CASE k ${Object.entries(SETTING_L).map(([k, l]) => `WHEN '${k}' THEN '${l}'`).join(' ')} ELSE k END)` },
        { key: 'k', label: 'Ключ', type: 'text', readonly: true, mono: true, search: true, sort: true, hidden: true },
        { key: 'v', label: 'Значення', type: 'json', readonly: true, search: true },
      ],
    },
    {
      name: 'audit', label: 'Журнал дій', one: 'Подія', group: 'Сайт', icon: 'scroll-text', table: 'audit', key: 'id', create: false, remove: false, sort: 'id DESC',
      // назва події — «Дія · Що»; події не змінюються, тож і історії змін у них нема
      titleFields: ['action', 'target'], history: false,
      about: 'Хто що робив на сайті й у панелі: входи, збереження, доступ, гільдії. Відкрий подію — побачиш подробиці запиту.',
      fields: [
        { key: 'id', label: '№', type: 'int', readonly: true, sort: true, hidden: true },
        { key: 'at', label: 'Коли', type: 'datetime', readonly: true, sort: true, filter: true },
        { key: 'actor', label: 'Хто', type: 'relation', resource: 'users', readonly: true, filter: true },
        { key: 'action', label: 'Дія', type: 'select', options: AUDIT_OPTIONS, readonly: true, filter: true },
        { key: 'target', label: 'Що', type: 'text', readonly: true, search: true, ref: true },
        { key: 'status', label: 'Результат', type: 'select', virtual: true, readonly: true, options: STATUS_OPTIONS, tones: STATUS_TONES },
        { key: 'detail', label: 'Подробиці запиту', type: 'json', readonly: true, search: true, list: false, keep: true, view: 'request' },
      ],
      hooks: { rows: (rows, user, api) => describeAudit(rows, { ...api, guildIds }, db) },
    },
    {
      name: 'push', label: 'Сповіщення про бурю', one: 'Підписка', group: 'Сайт', icon: 'bell', table: 'push_subs', key: 'endpoint', title: 'who', create: false, sort: 'created DESC',
      about: 'Браузери, яким сайт шле нагадування перед бурею Коріоліса: чия підписка, який браузер, регіон і мова.',
      fields: [
        { key: 'user_id', label: 'Людина', type: 'relation', resource: 'users', readonly: true, filter: true, help: 'Порожньо — підписався гість, без входу' },
        { key: 'browser', label: 'Браузер', type: 'select', readonly: true, form: false, filter: true, sql: pushBrowserSql('value'), options: PUSH_BROWSERS.map(({ value, label }) => ({ value, label })) },
        { key: 'lang', label: 'Мова', type: 'text', readonly: true, filter: true },
        { key: 'who', label: 'Підписка', type: 'text', readonly: true, form: false, list: false, view: 'none',
          sql: `COALESCE((SELECT u.name FROM users u WHERE u.id = push_subs.user_id) || ' · ', '') || ${pushBrowserSql('label')} || ' · ' || push_subs.region` },
        { key: 'endpoint', label: 'Адреса браузера', type: 'text', readonly: true, mono: true, search: true, list: false, help: 'Службова адреса, за якою браузер отримує сповіщення' },
        { key: 'region', label: 'Регіон', type: 'text', filter: true, readonly: true },
        { key: 'lead', label: 'За скільки годин', type: 'int', sort: true },
        { key: 'sent_for', label: 'Останнє нагадування', type: 'datetime', readonly: true, sort: true },
        { ...created },
      ],
    },
    {
      name: 'roles', label: 'Ролі й права', one: 'Роль', group: 'Люди', icon: 'shield-check', table: 'roles', key: 'key', title: 'name', sort: 'system DESC, key', page: null,
      about: 'Що може кожна роль: які розділи панелі бачить, створює, змінює, видаляє й які дії виконує. «Адміністратор» має все.',
      fields: [
        { key: 'key', label: 'Код ролі', type: 'slug', readonly: true, create: true, required: true, mono: true, search: true, sort: true, help: 'Латинські літери, цифри, «_» і «-»; після створення не змінюється' },
        { key: 'name', label: 'Назва', type: 'text', search: true, sort: true, required: true, max: 60, tr: true },
        { key: 'description', label: 'Опис', type: 'textarea', max: 300, tr: true },
        { key: 'permissions', label: 'Дозволи', type: 'permissions', list: false },
        { key: 'users_n', label: 'Людей із роллю', type: 'int', readonly: true, form: false, sql: '(SELECT COUNT(*) FROM users u WHERE u.role = roles.key)', sort: true },
        { key: 'system', label: 'Вбудована', type: 'bool', readonly: true, filter: true, help: 'Вбудовану роль не видалити' },
      ],
      relations: [{ resource: 'users', field: 'role', label: 'Люди з цією роллю' }],
      hooks: {
        async create(dv, me) {
          const perms = JSON.parse(dv.permissions || '[]')
          await assertRoleEdit(me, null, perms)
          return roles.save(dv.key, { name: dv.name, description: dv.description, permissions: perms }, true)
        },
        async update(id, dv, old, me) {
          const perms = 'permissions' in dv ? JSON.parse(dv.permissions || '[]') : [...(await roles.permsOf(id))]
          await assertRoleEdit(me, id, perms)
          await roles.save(id, { name: dv.name, description: dv.description, permissions: perms }, false)
        },
        async remove(id, old, me) { await assertRoleEdit(me, id, []); await roles.remove(id) },
      },
      actions: [
        // нова роль з тими самими правами — щоб не відмічати все заново
        { key: 'duplicate', label: 'Дублювати', row: true, run: async (rows, v, me) => {
          const src = rows[0]
          const perms = [...(await roles.permsOf(src.key))].filter((p) => p !== '*')
          await assertRoleEdit(me, null, perms)
          let key = `${src.key}-copy`.slice(0, 28)
          for (let i = 2; await roles.exists(key); i++) key = `${src.key}-copy${i}`.slice(0, 32)
          await roles.save(key, { name: `${src.name} (копія)`.slice(0, 60), description: src.description, permissions: perms }, true)
          return { ok: true, open: ['roles', key] }
        } },
      ],
    },
    {
      name: 'revisions', label: 'Історія змін', one: 'Зміна', group: 'Сайт', icon: 'git-compare', table: 'revisions', key: 'id', create: false, remove: false, sort: 'id DESC', page: null,
      titleFields: ['action', 'entity_id'], history: false,
      // лише зміни тих розділів, які людина сама бачить (інакше через «Було / Стало» видно чужі пошти, налаштування)
      scopeFor: (user, { canView }) => {
        const names = all.map((r) => r.name).filter(canView)
        return names.length ? { sql: `entity IN (${names.map(() => '?').join(', ')})`, args: names } : { sql: '1 = 0', args: [] }
      },
      about: 'Кожна зміна будь-чого: що було й що стало. Відкрий зміну — побачиш різницю.',
      fields: [
        { key: 'id', label: '№', type: 'int', readonly: true, sort: true, hidden: true },
        { key: 'at', label: 'Коли', type: 'datetime', readonly: true, sort: true, filter: true },
        { key: 'actor', label: 'Хто', type: 'relation', resource: 'users', readonly: true, filter: true },
        { key: 'entity', label: 'Розділ', type: 'select', readonly: true, filter: true, optionsFn: () => all.map((r) => ({ value: r.name, label: r.label })) },
        { key: 'entity_id', label: 'Запис', type: 'text', readonly: true, search: true, ref: true },
        { key: 'action', label: 'Дія', type: 'select', readonly: true, filter: true, tones: REVISION_TONES, optionsFn: () => revisionActions() },
        { key: 'note', label: 'Подробиці', type: 'text', readonly: true, list: false },
        // «було / стало» цілком на картці не показуємо — під нею «Різниця» за полями
        { key: 'before', label: 'Було', type: 'json', readonly: true, list: false, view: 'none' },
        { key: 'after', label: 'Стало', type: 'json', readonly: true, list: false, view: 'none' },
      ],
      hooks: { rows: (rows, user, api) => describeRevisions(rows, { ...api, guildIds }, db) },
    },
    {
      name: 'cron-jobs', label: 'Фонові задачі', one: 'Задача', group: 'Сайт', icon: 'timer', table: 'cron_jobs', key: 'key', title: 'name', create: false, remove: false, sort: 'key',
      quick: [{ key: 'failed', label: 'З помилкою', filters: { last_status: ['error'] } }],
      about: 'Що сайт робить сам за розкладом: оновлення мапи, перевірка даних гри, знімки баз, прибирання. Відкрий задачу — побачиш журнал її запуску, а поки вона йде — наживо.',
      fields: [
        { key: 'key', label: 'Код задачі', type: 'text', readonly: true, mono: true, hidden: true, advanced: true },
        { key: 'name', label: 'Задача', type: 'text', readonly: true, search: true, tr: true },
        { key: 'description', label: 'Що робить', type: 'textarea', readonly: true, list: false, tr: true },
        { key: 'schedule', label: 'Розклад', type: 'text', mono: true, required: true, view: 'cron', help: 'П’ять полів: хвилина, година, день місяця, місяць, день тижня. «*/5 * * * *» — кожні 5 хв; «0 4 * * 3» — щосереди о 04:00 (час сервера)' },
        { key: 'enabled', label: 'Увімкнено', type: 'bool', filter: true },
        { key: 'next_run', label: 'Наступний запуск', type: 'datetime', readonly: true, sort: true },
        { key: 'last_run', label: 'Останній запуск', type: 'datetime', readonly: true, sort: true },
        { key: 'last_status', label: 'Чим скінчився', type: 'select', readonly: true, filter: true, options: opts(['ok', 'error'], { ok: 'Успішно', error: 'Помилка' }), tones: { ok: 'success', error: 'critical' } },
        { key: 'last_ms', label: 'Тривав', type: 'int', format: 'duration', readonly: true, sort: true, hidden: true },
        { key: 'runs', label: 'Запусків', type: 'int', readonly: true, sort: true },
        { key: 'fails', label: 'З них з помилкою', type: 'int', readonly: true, sort: true },
        { key: 'last_error', label: 'Остання помилка', type: 'textarea', readonly: true, list: false },
      ],
      relations: [{ resource: 'cron-runs', field: 'job', label: 'Запуски' }],
      hooks: {
        async update(id, dv) {
          if (dv.schedule) await cron.setSchedule(id, dv.schedule)
          if ('enabled' in dv) await cron.setEnabled(id, !!dv.enabled)
        },
      },
      actions: [
        // у фоні: довгі задачі запит не чекає; хід видно в журналі на сторінці задачі (наживо)
        { key: 'run', label: 'Запустити зараз', row: true, bulk: true, confirm: 'Запустити зараз? Задача піде у фоні — її журнал видно на сторінці задачі, наживо.', run: async (rows) => {
          let started = 0
          for (const r of rows) if ((await cron.start(r.key)).started) started++
          return { ok: true, message: started ? 'Запущено — журнал видно на сторінці задачі' : 'Ця задача вже виконується' }
        } },
      ],
    },
    {
      name: 'cron-runs', label: 'Запуски задач', one: 'Запуск', group: 'Сайт', icon: 'list-checks', table: 'cron_runs', key: 'id', create: false, sort: 'id DESC',
      about: 'Кожен запуск фонової задачі: коли, скільки тривав, чим скінчився, і журнал — що вона писала.',
      titleFields: ['job', 'started'], history: false,
      quick: [{ key: 'failed', label: 'З помилкою', filters: { status: ['error'] } }, { key: 'running', label: 'Виконуються', filters: { status: ['running'] } }],
      fields: [
        { key: 'id', label: '№', type: 'int', readonly: true, sort: true },
        { key: 'job', label: 'Задача', type: 'relation', resource: 'cron-jobs', readonly: true, filter: true },
        { key: 'started', label: 'Почався', type: 'datetime', readonly: true, sort: true, filter: true },
        { key: 'finished', label: 'Скінчився', type: 'datetime', readonly: true, sort: true, hidden: true },
        { key: 'ms', label: 'Тривав', type: 'int', format: 'duration', readonly: true, sort: true },
        { key: 'status', label: 'Стан', type: 'select', readonly: true, filter: true, options: opts(['running', 'ok', 'error'], { running: 'Виконується', ok: 'Успішно', error: 'Помилка' }), tones: { running: 'info', ok: 'success', error: 'critical' } },
        { key: 'trigger', label: 'Як запущено', type: 'select', readonly: true, filter: true, options: opts(['schedule', 'manual'], { schedule: 'За розкладом', manual: 'Вручну' }) },
        // журнал — окремим блоком під карткою (з підсвіткою й наживо, поки запуск іде)
        { key: 'log', label: 'Журнал', type: 'code', readonly: true, list: false, view: 'none' },
      ],
    },
    {
      name: 'meta', label: 'Службові позначки', one: 'Позначка', group: 'Сайт', icon: 'database', table: 'meta', key: 'k', sort: 'k',
      about: 'Внутрішні позначки сайту (коли зібрано довідник, що вже перенесено). Змінюй, лише якщо знаєш навіщо.',
      fields: [
        { key: 'k', label: 'Назва позначки', type: 'text', readonly: true, create: true, required: true, mono: true, search: true, sort: true },
        { key: 'v', label: 'Значення', type: 'textarea', search: true },
      ],
    },
  ]
  /** дії історії змін: загальні й кнопки розділів («action:hide» → «Приховати») */
  const revisionActions = () => {
    const out = Object.entries(REVISION_ACTIONS).map(([value, label]) => ({ value, label }))
    for (const r of all) for (const a of r.actions || []) if (!out.some((o) => o.value === `action:${a.key}`)) out.push({ value: `action:${a.key}`, label: a.label })
    return out
  }
  return all
}


# Ігрові дані: драйвер «файли гри» для каталогу й перекладів (план 3) — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сайт читає пакет видобувача (план 2) драйвером «файли гри» і, коли адмін перемкне розділ, бере з нього предмети, пристрої, рецепти, будівельні модулі й переклади — з тими самими id для збережених баз і розрахунків, з прихованим невипущеним і звіркою перед перемиканням.

**Architecture:** Кожен розділ має **основне джерело** (`community` за замовчуванням, `gamefiles` — після перемикання адміном; зберігається в `meta`). Реєстр (етап 1) бере драйвери в порядку «основне → інші», а коли дані віддав драйвер із прапорцем `applies` (файли гри) і хеш змінився — викликає **застосувач** розділу, що пише в таблиці `game_*` / `game_texts` через наявний `createGameData`. Збір із questlog/вікі (`catalog-sync`) розділів, де основне — файли гри, більше не пише. Будівлі зберігають ключі вікі (`set|id`) через таблицю відповідності «ключ вікі → рядок гри» (автоматично за іконкою, вручну — в адмінці). Адмін-сторінка «Дані гри»: звірка запасне ↔ файли гри по розділу, перемикання й відкат, прийняття затриманого.

**Tech Stack:** Node (ESM), Express, SQLite/Postgres (`server/lib/sql.mjs`), vitest, React (адмінка `src/pages/admin`), i18n `t()`.

**Spec:** `docs/superpowers/specs/2026-10-21-game-data-drivers-design.md` (§4.2 драйвер, §4.3 пакет, §4.8 переклади, §5 адмін, §6 стабільність id, §6a невипущене, §7 етап 2). Попередні плани: `2026-10-21-game-data-drivers-stage1.md`, `2026-10-21-game-data-extractor.md`. Факти: `game-field-mapping.md`, `game-extractor-run.md` у `~/Library/Application Support/Claude/side-session-notes/local_42e4b3b4-0215-4938-bfb7-f086091fdc37/`.

**Рішення плану (у межах, що spec лишив будівельнику):** доставка пакета push-ом з окремого хоста (`POST /api/admin/gamedata/bundle`) — у плані 6; тут драйвер читає теку пакетів `GAMEDATA_BUNDLE_DIR` (на Маці — тека видобувача). Картинки будівель і предметів лишаються з запасного джерела (img/icon у таблицях не перезаписуються даними гри, коли там уже є значення).

## Global Constraints

- Тека не git — без комітів; змінювати лише файли задач. Чужого не чіпати.
- Збереження в `server/lib`, `server/routes`, `server/admin`, `locales` перезапускає живий `dune.test` і проганяє стартові міграції на ЖИВІЙ базі `dune` (`GAMEDATA=1` там увімкнено): міграції — лише `CREATE TABLE IF NOT EXISTS` / `db.addColumn` з типовими значеннями, що не змінюють поведінку; **жодного запису даних у живу базу без дозволу користувача**. Драйвер «файли гри» на живому неактивний, доки нема `GAMEDATA_BUNDLE_DIR` (без нього `sections()` порожній). Перемикання розділу — лише адмінською дією.
- Watcher не перезапускає сервер від зміни самого `server/app.mjs` чи `.env` — для перезапуску зачепити файл у `server/routes`.
- Перевірка — на копії `dune_preview` (launch-записи `gamedata-api`/`gamedata-web`, env у scratchpad).
- Розділи, які застосовуються: `items`, `placeables`, `recipes`, `buildables`, `texts`. `config` — лише спостерігається.
- Розділ → вид у `GAME` (`server/lib/gamedata.mjs`): `items→item`, `placeables→placeable`, `recipes→recipe`, `buildables→buildable`.
- Основне джерело: ключ `meta` `game:primary:<section>`, значення `gamefiles` | `community`; нема — `community`.
- Пріоритет текстів у `game_texts`: `manual` (locked) > `game` > `gamingtools` > `thgl` — нижчий не перезаписує вищий.
- Невипущене (`released:false`) пишеться в таблицю з `unreleased = 1` і не показується; адмінський прапорець `revealed = 1` показує запис і переживає оновлення.
- Публічні id не змінюються: предмети/пристрої/рецепти — як є; будівлі — ключ вікі `set|id` через відповідність; нова будівля без відповідника — ключ `game|<рядок>`.
- Тексти інтерфейсу — `t()`, переклади 13 мов через `locales/parts/gamedata3.<мова>.json` + `npm run i18n:merge` (без `--clean`).

## Review Focus

- Файли гри стали основними, а пакет зник/зіпсувався → розділ іде з запасного (`fallback`), таблиці лишаються з останніх даних гри, `catalog-sync` їх не перезаписує (основне — досі файли гри). Тест у Task 3.
- Адмін відкотив розділ на запасне → дані questlog повертаються в таблиці з `catalog.json` без нового збору; журнал показує зміну. Тест у Task 8.
- Іконка вікі, що підходить кільком рядкам гри (центральна й кутова колони), → відповідність за групою; неоднозначне — не зіставлено і видно в звітах, а запис вікі не зникає. Тест у Task 5.
- Відкритий адміном невипущений запис → після наступного оновлення пакета лишається видимим. Тест у Task 4.
- Переклади gaming.tools/TH.GL після перемикання текстів на файли гри → не перезаписують тексти гри; ручні правки — не перезаписуються ніким. Тест у Task 6.

---

### Task 1: Драйвер «файли гри»

**Files:**
- Create: `server/lib/gamedata/drivers/gamefiles.mjs`
- Test: `server/gamedata-gamefiles.test.mjs` (фікстура-пакет складається в тимчасовій теці тестом: `latest.json`, `<build>/manifest.json`, `sections/*.json.gz`)

**Interfaces:**
- Produces: `createGamefilesDriver({ dir }): Driver & { applies: true, manifest(): object|null }`:
  - `id: 'gamefiles'`, `label: 'файли гри'`, `applies: true`
  - `sections()` — розділи маніфесту без `error` (порожньо, якщо `dir` не задано чи нема `latest.json`); читає `latest.json` щоразу (новий пакет підхоплюється без перезапуску)
  - `probe()` → `{ version: build, build, gameVersion, manifestId, extractedAt }`; пакета нема (нема `dir` чи `latest.json`) → `null` (реєстр тоді нічого не пише в `gamedata_builds` — на живому без `GAMEDATA_BUNDLE_DIR` жодних записів)
  - `load(section)` → `{ data, version: build }` (`gunzip` + `JSON.parse`); розділу нема → `Error`
  - `latest.json.dir` абсолютний — якщо такої теки нема, брати `<dir>/<build>` (пакет перенесли).
- [ ] **Step 1: Тести:** без `latest.json` → `sections()` `[]` і `probe()` → `null`; з пакетом, де `recipes: { error }` → `sections()` = `['items','texts']` (фікстура), `load('recipes')` відхиляється; `load('items').data.records[0].id`; `probe()` = `{ version: '7', build: '7', gameVersion: '1.5.15', manifestId: 'm1', extractedAt: … }`; `latest.json.dir` неіснуючий → читає `<dir>/7`.
- [ ] **Step 2:** `npx vitest run server/gamedata-gamefiles.test.mjs` → FAIL. **Step 3:** реалізувати. **Step 4:** PASS.

### Task 2: Основне джерело, порядок драйверів, застосування, збірки

**Files:**
- Modify: `server/lib/gamedata/registry.mjs`, `server/lib/gamedata.mjs` (лише додати `getPrimary`/`setPrimary` і експорт `FROM`)
- Test: `server/gamedata-registry.test.mjs` (додати)

**Interfaces:**
- `gamedata.mjs`: `game.getPrimary(section): Promise<'gamefiles'|'community'>` (meta `game:primary:<section>`, нема → `community`); `game.setPrimary(section, driver): Promise<void>`; `export const FROM` (наявний об'єкт перетворень).
- `createRegistry({ …, primaryOf = async () => null, apply = {} })`:
  - для розділу порядок драйверів: спершу той, чий `id === await primaryOf(section)`, далі решта в заданому порядку;
  - після `first` / `changed` / `accept`, якщо дані віддав драйвер з `applies === true` і `apply[section]` є — `await apply[section](data, { driver: id, build })`; помилка застосувача → статус розділу `error` з текстом, хеш **не** зсувається (застосування й запис хешу — одна логічна дія: спершу застосувати, потім `commit`);
  - `check()` на початку викликає `probe()` у драйверів з `applies` і пише `gamedata_builds` (`build`, `manifest_id`, `version` (= `gameVersion`), `seen_at`, `extracted_at` (з `extractedAt`), `status 'ok'`), ON CONFLICT — оновлює `seen_at`;
  - `status().sections[i].primary` — основне джерело розділу;
  - `reapply(section): Promise<boolean>` — застосувати поточні дані основного драйвера, навіть якщо хеш той самий (для перемикання).
- [ ] **Step 1: Тести:** основне `gamefiles` → `driver:'gamefiles'` навіть коли `community` перший у списку; `applies`-драйвер дав нові дані → `apply.items` викликано раз із даними; `community` дав нові дані → `apply` не викликано; `apply` кидає → статус `error`, наступний `check` знову пробує застосувати (хеш не зсунувся); `probe` з `build:'7'` → `status().game` = `{ version:'1.5.15', build:'7' }`; `reapply('items')` викликає `apply` при незмінному хеші.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS + `npx vitest run server/gamedata*.test.mjs`.

### Task 3: Таблиці `game_*`: невипущене, відкриття, пріоритет текстів, збір questlog поважає основне

**Files:**
- Modify: `server/lib/gamedata.mjs` (міграції, `catalog()`, `putTexts`, `importCatalog(c, { skip })`), `server/lib/catalog.mjs` (`sync` передає `skip`; новий `reimport(kinds)`), `server/admin/resources.mjs` (поля `unreleased` (readonly) і `revealed` (bool) у `gameResources`; дії «Відкрити»/«Сховати знову»; `SRC_L.game = 'Файли гри'`)
- Test: `server/gamedata.test.mjs` (додати)

**Interfaces:**
- Міграції: `db.addColumn(table, 'unreleased', 'INTEGER NOT NULL DEFAULT 0')`, `db.addColumn(table, 'revealed', 'INTEGER NOT NULL DEFAULT 0')` для всіх `GAME`-таблиць.
- `catalog()` і `skills()`: умова `hidden = 0 AND gone IS NULL AND (unreleased = 0 OR revealed = 1)`.
- `game.markReleased(kind, { released: string[], unreleased: string[] })` — `UPDATE … SET unreleased = 0/1 WHERE key IN (…)` (пакетами по 500), `invalidate()`.
- `putTexts`: оновлює лише коли `game_texts.locked = 0 AND (game_texts.source <> 'game' OR excluded.source = 'game')`.
- `importCatalog(c, { skip = new Set() } = {})` — види з `skip` не пишуться (ні рядки, ні `putThgl` для них); `catalog.sync()` перед імпортом бере `skip` = види, чий розділ має основне `gamefiles`.
- `catalog.reimport(kinds: string[])` — з `<dataDir>/catalog/catalog.json` (`complete:false`) лише ці види — для відкату.
- [ ] **Step 1: Тести:** запис з `unreleased=1` не в `catalog()`; з `revealed=1` — у `catalog()`; `putTexts('uk', [...], 'gamingtools')` не перезаписує рядок з `source='game'`, а `putTexts(..., 'game')` перезаписує `gamingtools`; `locked` не перезаписує ніхто; `importCatalog(c, { skip: new Set(['item']) })` не змінює `game_items`, але пише рецепти.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати (резервна копія не потрібна — міграції адитивні з типовими 0). **Step 4:** PASS + `npx vitest run server/` (усе зелене).

### Task 4: Застосувачі предметів, пристроїв, рецептів

**Files:**
- Create: `server/lib/gamedata/apply.mjs`
- Test: `server/gamedata-apply.test.mjs`

**Interfaces:**
- `createAppliers({ db, game }): { items, placeables, recipes, buildables, texts }` — кожен `async (data, ctx) => void`; тут — перші три:
  - `upsert(kind, records.map(FROM[kind]) , { sweep: true })` — **усі** записи (і невипущені), потім `markReleased(kind, { released, unreleased })`;
  - поля, яких у даних гри нема (`description` предметів; `icon` пристроїв без іконки) — `null` → `KEEP` у `upsert` зберігає наявне;
  - рецепти: `FROM.recipe` бере `at`/`in`/`out` як є.
- [ ] **Step 1: Тести** (тимчасова SQLite з `seed()` фікстурою як у `server/gamedata.test.mjs`): після `items({ records: [ {AluminiumBar released}, {OldThing released:false} ] })` — `catalog('en').items` має `AluminiumBar` з новими полями, не має `OldThing`; рядок вручну закріплений (`locked=1`) — не змінено; запис, що зник з даних, — `gone`; `revealed=1` на `OldThing` → після повторного застосування він у `catalog()`.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS.

### Task 5: Відповідність будівель «ключ вікі → рядок гри» і застосувач модулів

**Files:**
- Create: `server/lib/gamedata/buildmap.mjs`; Modify: `server/lib/gamedata/apply.mjs` (`buildables`), `server/admin/resources.mjs` (ресурс `gamedata-buildable-map`, група «Гра»)
- Test: `server/gamedata-buildmap.test.mjs`

**Interfaces:**
- Таблиця `gamedata_buildable_map(wiki_key TEXT PRIMARY KEY, row TEXT, how TEXT NOT NULL, updated BIGINT NOT NULL)`; `how` ∈ `icon` | `icon+group` | `icon~` (збіг після зняття суфікса `R|I|S` перед `_D`) | `manual`.
- `matchBuildables(wiki: {key, img, group}[], game: {id, img, group, released}[]): { map: {wikiKey, row, how}[], wikiUnmatched: string[], gameUnmatched: string[] }` — ім'я файла іконки: вікі — останній сегмент `img` без `.png`, гра — останній сегмент `img`; кілька кандидатів — той, чия `group` = групі вікі; досі кілька чи жодного — не зіставлено. Лише `released` рядки гри.
- `syncMap(db, wiki, game)` — пише автоматичні рядки, **не чіпає** `how = 'manual'`; повертає звіт `matchBuildables` з урахуванням ручних.
- Застосувач `buildables(data)`: відповідність → для кожного зіставленого ключа вікі — `upsert('buildable', …, { sweep: false })` рядком `{ key: wikiKey, set_id: <з наявного рядка>, grp: <з наявного>, id: <з наявного>, name, health, img: null, cost }`; незіставлені випущені рядки гри — ключ `game|<row>`, `set_id: 'game/' + set`, `grp: group`, `id: row`; невипущені — з `unreleased=1`.
- [ ] **Step 1: Тести:** дві колони з тією самою іконкою, групи `structural`/`structural` і запис вікі з групою `structural` → неоднозначно, не зіставлено; та сама іконка, але одна з груп збігається → зіставлено `icon+group`; `…01R_D` проти `…01_D` → `icon~`; ручний рядок `manual` переживає `syncMap`; застосувач оновив `health`/`cost` рядка `structures/dune man|foundation`, `img` лишився вікі; новий рядок гри → ключ `game|Row`.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS.

### Task 6: Застосувач перекладів

**Files:**
- Modify: `server/lib/gamedata/apply.mjs` (`texts`)
- Test: `server/gamedata-apply.test.mjs` (додати)

**Interfaces:**
- `texts(data)`: записи `{ id: 'kind:id:lang', name, description }` → групувати за мовою → `putTexts(lang, rows, 'game')`; `buildable:<рядок>` → ключ вікі з `gamedata_buildable_map` (нема — `game|<рядок>`); мови — 14 кодів сайту.
- [ ] **Step 1: Тести:** `item:AluminiumBar:uk` пише `source='game'`; існуючий `gamingtools` перезаписано, `manual`/`locked` — ні; `buildable:Row:uk` лягає на `structures/dune man|foundation`, якщо в карті є відповідність.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS.

### Task 7: Звірка «запасне ↔ файли гри»

**Files:**
- Create: `server/lib/gamedata/compare.mjs`
- Test: `server/gamedata-compare.test.mjs`

**Interfaces:**
- `compareSection(section, { community, gamefiles, map? }): { section, a: 'community', b: 'gamefiles', added, removed, changed, fields: Record<string, number>, examples: { id, name, op, fields?: string[] }[] }` — лише випущені записи `b`; для `buildables` записи гри перед порівнянням переіменовуються в ключі вікі за `map` (незіставлені — `game|<row>`); поля порівнюються нормалізовано (числа як числа, `null`≡відсутнє); `examples` ≤ 30.
- [ ] **Step 1: Тести:** предмет з іншим `stack` → `changed:1`, `fields.stack:1`, приклад з `fields:['stack']`; невипущений у `b` не рахується доданим; `'1.0'` проти `1` — не зміна; будівля зіставлена за картою → порівнюється з відповідним вікі-рядком.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS.

### Task 8: Збирання на сервері й адмін-API

**Files:**
- Modify: `server/lib/gamedata/index.mjs` (драйвери `[gamefiles, community]`, `primaryOf: game.getPrimary`, `apply: createAppliers(...)`), `server/routes/gamedata.mjs` (нові адмін-маршрути), `server/app.mjs` (передати `catalog` і `dataDir`; після зміни — `touch server/routes/gamedata.mjs`)
- Test: `server/gamedata-routes.test.mjs` (додати), `server/gamedata-switch.test.mjs` (інтеграційний: реєстр + застосувачі + тимчасова SQLite + фікстура-пакет)

**Interfaces:**
- `createGameDataSources({ …, bundleDir = process.env.GAMEDATA_BUNDLE_DIR || null, catalog })` → `{ registry, drivers: { gamefiles, community }, buildmap: { report(): Promise<…> } }` або `null` (вимкнено). `createGameDataRoutes({ sources, roles, game, catalog })` — замість `{ registry, roles }` (`sources?.registry` для наявних маршрутів); `app.mjs` — під нову форму, cron `gamedata-check` — `sources.registry.check()`.
- Маршрути (дозвіл `gamedata.manage`):
  - `GET /api/admin/gamedata/sections` → `{ sections: [{ id, primary, driver, status, count, changedAt, available: string[] }], bundle: manifest.game|null, map: { mapped, wikiUnmatched, gameUnmatched } }`
  - `POST /api/admin/gamedata/compare/:section` → `compareSection(...)` (обидва драйвери мають розділ, інакше 409 `req.t('для звірки потрібні обидва джерела')`)
  - `POST /api/admin/gamedata/primary/:section` `{ driver: 'gamefiles'|'community' }` → `setPrimary`, далі: на `gamefiles` — `check([section])` + `reapply(section)`; на `community` — `catalog.reimport([kind])` (тексти — нічого не стирає: рядки `source='game'` лишаються, доки їх не перезапише вища дія) + `check([section])`; `config` не перемикається (400)
  - наявні `check`/`accept` — без змін.
- [ ] **Step 1: Тести:** маршрути — права (401/403), невідомий розділ 400, `config` 400, 409 без пакета; інтеграційний: пакет-фікстура → `primary/items {driver:'gamefiles'}` → `catalog('en')` має значення з пакета, `status().sections.items.driver === 'gamefiles'`, журнал має рядок; `primary/items {driver:'community'}` → дані з `catalog.json` повернулися; пакет видалено → наступний `check` → `fallback`, таблиці не змінені; `catalog.sync` з основним `gamefiles` для `items` не чіпає `game_items`.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS + `npx vitest run server/`.

### Task 9: Адмін-сторінка «Дані гри»

**Files:**
- Create: `src/pages/admin/GameDataAdmin.tsx`; Modify: `src/pages/admin/AdminApp.tsx` (розділ `gamedata`, пункт меню з дозволом `gamedata.manage`, крихти), `src/pages/DataUpdates.tsx` (для адміна — посилання «Керувати джерелами»)
- Test: `src/lib/gamedata.test.ts` (додати чисту функцію `switchLabel`)

**Interfaces:**
- Сторінка: шапка «Дані гри» + рядок пакета (збірка, версія гри, коли видобуто; нема — «пакета файлів гри ще нема»); кнопка «Перевірити зараз»; таблиця/картки розділів (назва `sectionLabel`, основне, звідки зараз, стан, записів, коли змінився, кнопки «Звірити», «Перемкнути на файли гри» / «Повернути запасне» (з підтвердженням), «Прийняти» для `held`); під кнопкою «Звірити» — звіт: `+N · −N · змінено N`, поля з кількостями, приклади; блок «Відповідність будівель»: зіставлено N, без пари у вікі / у грі (перші 20) + посилання на ресурс `gamedata-buildable-map`.
- `switchLabel(primary: string): string` → `primary === 'gamefiles' ? t('Повернути запасне') : t('Перемкнути на файли гри')`.
- Мобільна ширина — картками; нічого не обрізати.
- [ ] **Step 1: Тест** `switchLabel`. **Step 2:** FAIL. **Step 3:** реалізувати сторінку. **Step 4:** PASS + `npx tsc --noEmit`.

### Task 10: Переклади, прев'ю, ввімкнення

**Files:**
- Create: `locales/parts/gamedata3.<мова>.json` (13 мов); Modify: `.claude/launch.json` (env прев'ю: `GAMEDATA_BUNDLE_DIR=/Users/stepanenko/Sites/DuneAwakening/gamefiles/bundles`)

- [ ] **Step 1:** нові ключі (сторінка, API-помилки, ресурс карти, `SRC_L.game`) → part-файли → `npm run i18n:merge` (без `--clean`), свої part-файли видалити.
- [ ] **Step 2:** прев'ю на `dune_preview` з пакетом: «Звірити» кожен розділ (зберегти числа в нотатку `game-data-switch-preview.md`); перемкнути `items`, `placeables`, `recipes`, `buildables`, `texts` на файли гри; перевірити в браузері Довідник, Калькулятор (наявний розрахунок з будівлями), сторінку бази з кошторисом, `/data` (джерело «файли гри», версія 1.5.15), українською й англійською, 375 px.
- [ ] **Step 3:** відкотити один розділ на запасне й назад — дані повертаються.
- [ ] **Step 4:** **спитати користувача**: (а) додати `GAMEDATA_BUNDLE_DIR` у живий `.env`; (б) які розділи перемикати на живому (перемикання — дія адміна в панелі або за його «так»).

# Ігрові дані: каркас драйверів і індикатор оновлень (етап 1) — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реєстр джерел ігрових даних з одним інтерфейсом драйвера, драйвер «запасне джерело» поверх нинішнього коду, журнал реальних змін по розділах і індикатор на сайті — без зміни того, звідки сайт бере дані.

**Architecture:** `server/lib/gamedata/` — реєстр (`registry.mjs`) опитує драйвери за пріоритетом, рахує стабільний хеш кожного розділу і пише рядок журналу лише коли хеш змінився; знімки розділів — на диску для diff. На етапі 1 реєстр лише **спостерігає**: писачі `game_*` таблиць і мапи лишаються нинішні (cron `catalog-sync`, `skills-sync`, `map-refresh`). Фронтенд: сторінка `/data` і підпис «оновлено …» там, де зараз стоять посилання на TH.GL/questlog.

**Tech Stack:** Node (ESM, Express), SQLite/Postgres через `server/lib/sql.mjs`, vitest, React + zustand, i18n `t()`.

**Spec:** `docs/superpowers/specs/2026-10-21-game-data-drivers-design.md` (§4.1, §4.2, §4.5, §5, §6a, §7 етап 1).

**Рішення плану (у межах, що spec лишив будівельнику):** індикатор — сторінка `/data` + підписи «оновлено …» біля нинішніх рядків джерел на Головній, Мапі, Довіднику, Калькуляторі, Уміннях (футера на сайті нема, а сьомий пункт у шапці зламав би її розкладку); адмін-сторінка драйверів (пріоритет, помилки, відкат) — у плані 6, на етапі 1 адмінові доступні API `check`/`accept` і журнал cron.

## Global Constraints

- Тека **не git**: кроків коміту нема; замість них — перевірка, що змінено лише файли задачі. Чужих файлів не чіпати (паралельні сесії; напр. `src/pages/BaseGenerator.tsx`).
- Збереження файлів у `server/lib`, `server/routes`, `server/admin`, `server/app.mjs`, `locales` перезапускає живий `dune.test` і проганяє стартові міграції на ЖИВІЙ базі `dune`: міграції — лише `CREATE TABLE IF NOT EXISTS` / `db.addColumn`; реєстр і його cron працюють **лише при `GAMEDATA=1`** у середовищі. У живу базу без дозволу користувача не писати.
- Перевірка в браузері — на копії `dune_preview` через окремий порт (Task 7).
- Тексти інтерфейсу — `t('українська фраза')`; переклади 13 мов — `locales/parts/gamedata.<мова>.json` + `npm run i18n:merge` (**ніколи `--clean`**).
- Розділи (рівно ці id): `items placeables recipes buildables skills texts maps markers resources spice ddLayouts config images`.
- Драйвери (id → підпис): `gamefiles` → «файли гри», `community` → «запасне джерело».
- Рядок журналу змін — **лише** коли змінився хеш розділу; перше спостереження розділу журналу не пише.
- Записи з `released === false` не входять у хеш, лічильник і публічний журнал (spec §6a).
- Запобіжник обсягу: попередньо ≥ 20 записів і нових < 50 % → розділ «на підтвердженні», не застосовується.
- Мобільний макет: нічого ширшого за екран, без обрізання тексту, одна прокрутка (правила з пам'яті сайту).

## Review Focus

- Драйвер кидає помилку або повертає порожньо (TH.GL лежить) → розділ лишає попередній хеш, статус `error`/`fallback`, журнал не пише «−2586 предметів». Тест у Task 2.
- Той самий набір даних в іншому порядку (БД віддала рядки інакше, ключі об'єкта переставлені) → той самий хеш, журнал мовчить. Тест у Task 1.
- Кілька процесів/перезапуск посеред перевірки (живий дев-сервер перезапускається на кожне збереження) → повторна перевірка не дублює рядок журналу. Тест у Task 2 (два `check()` поспіль паралельно).
- Сторінка `/data` до першої перевірки (таблиці порожні) і на телефоні 375 px → зрозумілий порожній стан, без горизонтальної прокрутки. Перевірка в Task 7.
- Мова відвідувача ≠ uk: назви розділів і приклади змін перекладені (`t()` для розділів; приклади — англ. назви з журналу, це прийнятно на етапі 1). Перевірка в Task 7.

---

### Task 1: Стабільний хеш і diff записів

**Files:**
- Create: `server/lib/gamedata/hash.mjs`
- Test: `server/gamedata-hash.test.mjs`

**Interfaces:**
- Produces:
  - `stableStringify(value: any): string` — JSON з відсортованими ключами об'єктів (масиви — у своєму порядку).
  - `normalizeSection(data: { records?: Rec[], blob?: any }): { records?: Rec[], blob?: any, count: number }` — викидає `released === false`, сортує `records` за `id` (рядкове порівняння), `count` = кількість записів (для `blob` — 1).
  - `sectionHash(data): string` — sha256 hex від `stableStringify(normalizeSection(data))` без поля `count`.
  - `diffRecords(prev: Rec[], next: Rec[]): { added: number, removed: number, changed: number, examples: { id: string, name: string|null, op: '+'|'-'|'~' }[] }` — за `id`; «змінено» = різний `stableStringify`; `examples` ≤ 20, спершу `+`, потім `-`, потім `~`.
  - `type Rec = { id: string, name?: string, released?: boolean, [k: string]: any }`

- [ ] **Step 1: Тести** — `describe('хеш розділу')`:
  - `sectionHash({records:[{id:'b',x:1},{id:'a',y:{q:1,p:2}}]}) === sectionHash({records:[{id:'a',y:{p:2,q:1}},{id:'b',x:1}]})`
  - запис `{id:'c', released:false}` не змінює хеш і `normalizeSection(...).count`
  - `sectionHash({blob:{a:1,b:[2,1]}}) !== sectionHash({blob:{a:1,b:[1,2]}})` (порядок масиву в blob значущий)
  - `diffRecords([{id:'a',name:'A'},{id:'b',name:'B',v:1}], [{id:'b',name:'B',v:2},{id:'c',name:'C'}])` → `{added:1, removed:1, changed:1}`, `examples` = `[{id:'c',name:'C',op:'+'},{id:'a',name:'A',op:'-'},{id:'b',name:'B',op:'~'}]`
  - 30 доданих → `examples.length === 20`
- [ ] **Step 2:** `npx vitest run server/gamedata-hash.test.mjs` → FAIL (модуля нема).
- [ ] **Step 3:** Реалізувати `hash.mjs` (`node:crypto` `createHash('sha256')`).
- [ ] **Step 4:** Той самий запуск → PASS.

### Task 2: Реєстр: таблиці, перевірка, журнал, запобіжники

**Files:**
- Create: `server/lib/gamedata/registry.mjs`, `server/lib/gamedata/sections.mjs`
- Test: `server/gamedata-registry.test.mjs` (тимчасова SQLite, як `server/gamedata.test.mjs`: `openDb({ dataDir, pg: null })`, `createPlacesStore(db)` для `meta`)

**Interfaces:**
- Consumes: Task 1 (`normalizeSection`, `sectionHash`, `diffRecords`).
- Produces:
  - `sections.mjs`: `export const SECTIONS = ['items','placeables','recipes','buildables','skills','texts','maps','markers','resources','spice','ddLayouts','config','images']`; `export const RECORD_SECTIONS = new Set(['items','placeables','recipes','buildables','skills','texts','markers','resources','spice'])` (решта віддають `blob`).
  - Контракт драйвера (JSDoc у `registry.mjs`, spec §4.2): `{ id: string, label: string, sections(): string[], probe(): Promise<{version: string, build?: string}>, load(section): Promise<{ data: {records?: Rec[], blob?: any}, version: string }>, asset?(kind, key) }`.
  - `createRegistry({ db, dataDir, drivers, log = console, now = Date.now }): Promise<Registry>`, де `drivers` — масив у порядку пріоритету, а
    `Registry = { check(sections?: string[]): Promise<CheckResult[]>, status(): Promise<Status>, changes({ limit = 30, before = null }): Promise<{ items: Change[], next: number|null }>, accept(section: string): Promise<boolean> }`
  - `CheckResult = { section, driver: string|null, status: 'same'|'changed'|'first'|'held'|'error'|'fallback', count?: number }`
  - `Status = { game: { version: string|null, build: string|null }, updatedAt: number|null, sections: { id, driver, count, changedAt: number|null, checkedAt: number|null, status: string, error: string|null }[] }` (лише розділи, що мають рядок у `gamedata_sections`)
  - `Change = { id: number, at: number, section: string, driver: string, build: string|null, summary: { added, removed, changed, examples } }`
- Таблиці (у `createRegistry`, адитивно):
  - `gamedata_sections(section TEXT PRIMARY KEY, driver TEXT, version TEXT, hash TEXT, count INTEGER, applied_at BIGINT, checked_at BIGINT, status TEXT NOT NULL DEFAULT 'ok', error TEXT, held_hash TEXT)`
  - `gamedata_changes(id INTEGER/SERIAL PRIMARY KEY, at BIGINT NOT NULL, section TEXT NOT NULL, driver TEXT NOT NULL, build TEXT, from_hash TEXT, to_hash TEXT NOT NULL, summary TEXT NOT NULL)` + індекс `(at)`; унікальність `(section, to_hash, from_hash)` — захист від дубля при паралельних перевірках. Автоінкремент — як в інших таблицях проєкту (подивитися, як `sql.mjs` робить id для Postgres/SQLite).
  - `gamedata_builds(build TEXT PRIMARY KEY, manifest_id TEXT, version TEXT, seen_at BIGINT, extracted_at BIGINT, status TEXT)` — порожня на етапі 1, читається `status().game`.
- Знімки: `<dataDir>/gamedata/<section>/<hash>.json.gz` (`zlib.gzipSync` нормалізованих даних); лишати 5 найновіших (за mtime) на розділ.

- [ ] **Step 1: Тести** з фейковими драйверами (об'єкти з контрактом, дані з змінних тесту):
  - перший `check(['items'])` → `status:'first'`, `changes().items` порожній, `status().sections[0].count` = кількість випущених записів
  - ті самі дані в іншому порядку → `'same'`, журнал порожній
  - +1 запис і змінене поле → `'changed'`; `changes().items[0].summary` = `{added:1, changed:1, removed:0, …}`, `driver:'community'`
  - драйвер `load` кидає → `'error'`, хеш і `count` не змінились, журнал без нового рядка, `status().sections[0].error` містить текст помилки
  - два драйвери `[a, b]`, `a` кидає, `b` дає дані → `'fallback'`, `driver:'b'`
  - драйвер не має розділу в `sections()` → наступний; жоден не має → розділ пропущено (не в `status()`)
  - 100 записів → 30 записів: `'held'`, хеш старий; `accept('items')` → `true`, хеш новий, рядок журналу є
  - `await Promise.all([reg.check(['items']), reg.check(['items'])])` після зміни даних → рівно 1 новий рядок журналу
  - у теці знімків розділу ≤ 5 файлів після 7 змін
  - `changes({limit:2})` → 2 записи, `next` = id для `before`; `changes({limit:2, before: next})` → наступні
- [ ] **Step 2:** `npx vitest run server/gamedata-registry.test.mjs` → FAIL.
- [ ] **Step 3:** Реалізувати `sections.mjs` і `registry.mjs`. Порядок у `check` для розділу: перебрати драйвери → перший успішний `load` → `normalizeSection` → порівняти хеш із `gamedata_sections.hash` → `same` (оновити `checked_at`) | `first` (записати рядок, знімок) | запобіжник → `held` (записати `held_hash`, знімок) | `changed` (прочитати попередній знімок за старим хешем, `diffRecords` для `RECORD_SECTIONS`, інакше `{added:0,removed:0,changed:1,examples:[]}`; вставити журнал з `ON CONFLICT DO NOTHING`; оновити рядок). Помилки всіх драйверів → `error` без зміни хешу.
- [ ] **Step 4:** Той самий запуск → PASS; `npx vitest run server/gamedata.test.mjs` — не зламано.

### Task 3: Драйвер «запасне джерело» поверх нинішніх сховищ

**Files:**
- Create: `server/lib/gamedata/drivers/community.mjs`
- Test: `server/gamedata-community.test.mjs`

**Interfaces:**
- Consumes: контракт драйвера (Task 2); `game` з `createGameData` (`catalog('en')`, `skills('en')`, `getMeta`), `db` (таблиця `game_texts`), `mapData` з `createMapData` (`source`, `dir`), шлях до `data/large-spice.json`.
- Produces: `createCommunityDriver({ db, game, mapData, spiceFile }): Driver` з `id:'community'`, `label:'запасне джерело'`, `sections()` = `['items','placeables','recipes','buildables','skills','texts','maps','markers','ddLayouts','spice','images']` (без `resources`, `config` — їх у спільноти нема).
- Відповідність (`load`):
  - `items`/`placeables`/`recipes` → `records` з `game.catalog('en')` (поля як у відповіді, без `loc`); `buildables` → `records` з `id: \`${set}|${id}\``; `version` = `game.getMeta('catalogSynced')`.
  - `skills` → `records` з `game.skills('en').skills` (без `locName`/`locDesc`); `version` = `getMeta('skillsSynced')`.
  - `texts` → `records` `{ id: \`${kind}:${id}:${lang}\`, name, description }` з усіх рядків `game_texts`; `version` = `max(updated)`.
  - `maps` → `blob` `mapData.source.maps.map(({id,title,bounds,transformation}) => …)`; `markers` → `records` `{ id: map.id, nodes: map.nodes }` (ім'я файлу містить хеш вмісту TH.GL); `ddLayouts` → `blob` `{ layout, layouts }` мапи `deepdesert_1`; `version` = `source.syncedAt`.
  - `spice` → `records` з `large-spice.json` (подивитися форму файлу; id — стабільний з полів точки).
  - `images` → `blob` `{ tiles: maps.map(m => m.tiles), icons: sha256 файлу <mapData.dir>/icons.webp або null }`.
  - Порожній каталог (`game.catalog` → `null`) → кидати `Error('довідник ще не зібрано')` (реєстр сприйме як збій, не як «усе прибрали»).
  - `probe()` → `{ version: max(catalogSynced, skillsSynced, source.syncedAt) }`.

- [ ] **Step 1: Тести** на тимчасовій SQLite з `createGameData` + `seed()` фікстурою як у `server/gamedata.test.mjs`, `mapData`-заглушкою `{ source: {...}, dir }` і тимчасовим spice-файлом:
  - `load('items').data.records` містить `{id:'IronOre', name:'Iron Ore'}`, не містить `loc`
  - `load('buildables').data.records[0].id === 'structures/dune man|wall'`
  - `load('texts')` містить запис `id:'item:IronOre:uk'`
  - `load('markers').data.records` = `[{id:'survival_1', nodes:'survival_1.<hash>.raw'}]`
  - порожня БД → `load('items')` відхиляється з `довідник ще не зібрано`
  - `sections()` не містить `resources` і `config`
- [ ] **Step 2:** `npx vitest run server/gamedata-community.test.mjs` → FAIL.
- [ ] **Step 3:** Реалізувати драйвер.
- [ ] **Step 4:** PASS.

### Task 4: Підключення до сервера: API, права, cron, вмикач

**Files:**
- Create: `server/routes/gamedata.mjs`, `server/lib/gamedata/index.mjs`
- Modify: `server/app.mjs` (створення реєстру поряд із `createGameData` ~рядок 136; `app.use` поряд із `createSkillsRoutes` ~311; `cron.register` поряд з іншими ~373; `'data'` у `KNOWN` ~338), `server/lib/roles.mjs` (`'gamedata.view'` у `MOD` поряд із `'game-texts.view'`)
- Test: `server/gamedata-routes.test.mjs`

**Interfaces:**
- Consumes: `createRegistry` (Task 2), `createCommunityDriver` (Task 3), `wrap` з `server/routes/auth.mjs`, `roles.can(user, perm)`.
- Produces:
  - `index.mjs`: `createGameDataSources({ db, dataDir, game, mapData, log, enabled = process.env.GAMEDATA === '1' }): Promise<Registry|null>` — `null`, якщо вимкнено (тоді таблиць не створює, маршрути віддають порожній стан).
  - `createGameDataRoutes({ registry, roles }): Router`:
    - `GET /api/gamedata/status` → `Status` (вимкнено → `{ game:{version:null,build:null}, updatedAt:null, sections:[] }`), `cache-control: no-cache`
    - `GET /api/gamedata/changes?limit&before` → `{items, next}`; `limit` обрізати до 1…100
    - `POST /api/admin/gamedata/check` (дозвіл `gamedata.manage`; `admin` має `*`) → `{ results: CheckResult[] }`
    - `POST /api/admin/gamedata/accept/:section` (`gamedata.manage`) → `{ ok: boolean }`; невідомий розділ → 400 `req.t('немає такого розділу')`
  - cron `gamedata-check`: name «Дані гри: перевірка змін», description «Порівнює кожен розділ даних із попереднім і пише журнал, лише коли щось справді змінилось», schedule `'*/10 * * * *'`; `say` — «змінено: items, recipes» / «без змін»; реєструється лише коли реєстр не `null`.

- [ ] **Step 1: Тести** (express-застосунок лише з цим роутером, реєстр-заглушка, `roles`-заглушка `{ can: async (u, p) => u.perms.includes(p) || u.perms.includes('*') }`, перед роутером — проміжна функція, що ставить `req.user` із заголовка `x-test-user` (JSON) і `req.t = (s) => s`; `fetch` на тимчасовий порт — як у `server/app.test.mjs`):
  - `GET /api/gamedata/status` з `registry:null` → 200 і `sections: []`
  - `GET /api/gamedata/changes?limit=500` → заглушка отримала `limit:100`
  - `POST /api/admin/gamedata/check` без користувача → 401; з користувачем без права → 403
  - `POST /api/admin/gamedata/accept/nope` (з правом) → 400
- [ ] **Step 2:** `npx vitest run server/gamedata-routes.test.mjs` → FAIL.
- [ ] **Step 3:** Реалізувати `index.mjs`, `routes/gamedata.mjs`. **Перед збереженням `server/app.mjs` і `roles.mjs`**: переконатися, що код у `app.mjs` не робить нічого без `GAMEDATA=1` (у живому `.env` змінної нема) — збереження перезапустить `dune.test`.
- [ ] **Step 4:** PASS; `npx vitest run server/app.test.mjs server/gamedata.test.mjs server/cron.test.mjs` — не зламано.

### Task 5: Фронтенд: сторінка «Оновлення даних» і підписи «оновлено …»

**Files:**
- Create: `src/lib/gamedata.ts`, `src/components/DataStamp.tsx`, `src/pages/DataUpdates.tsx`
- Modify: `src/store.ts` (`View` + `'data'`; розбір `seg === 'data'` → `at('data')`; `pathOf` для `'data'` → `/data`), `src/App.tsx` (гілка `view === 'data'` з `lazy`), `src/pages/Home.tsx:168`, `src/pages/MapPage.tsx:1628`, `src/pages/SkillsPage.tsx:702`, `src/pages/Catalog.tsx` (біля заголовка/джерела, де є місце), `src/pages/CalcPage.tsx` (аналогічно)
- Test: `src/lib/gamedata.test.ts`

**Interfaces:**
- Consumes: `GET /api/gamedata/status`, `GET /api/gamedata/changes` (Task 4), `get` з `src/lib/api.ts`, `t`/`T`/`locale()` з `src/lib/i18n.tsx`.
- Produces:
  - `src/lib/gamedata.ts`: типи `GdStatus`, `GdChange` (як `Status`/`Change` у Task 2); `SECTION_LABEL: Record<string, string>` (через `t()`): items «Предмети», placeables «Пристрої», recipes «Рецепти», buildables «Будівельні модулі», skills «Уміння», texts «Переклади», maps «Мапи», markers «Точки на мапі», resources «Ресурси», spice «Поля меланжу», ddLayouts «Розкладки Глибокої пустелі», config «Налаштування гри», images «Картинки»; `DRIVER_LABEL`: gamefiles «файли гри», community «запасне джерело»; `useGdStatus(): GdStatus | null` (один запит на сесію сторінки, кеш у модулі); `summaryText(s: GdChange['summary']): string` → напр. «+12 · −3 · змінено 40» (порожні частини пропускати; усе нуль → `t('змінено')`).
  - `<DataStamp sections={string[]} />` — «оновлено {date}» (найпізніший `changedAt ?? checkedAt` серед указаних розділів, `toLocaleDateString(locale())`) — посилання на `/data` через `plainClick`; нема даних → нічого не рендерить.
  - Сторінка `/data`: заголовок «Оновлення даних»; рядок «Версія гри: {version}» (або «версія гри ще невідома»); таблиця/список розділів (назва, джерело, записів, коли змінився); стрічка змін з «Показати ще» (`before`). Порожній стан: «Ще немає жодної перевірки даних».
  - Підписи: Home — після рядка про TH.GL `<DataStamp sections={['maps','markers','items']} />`; Map — поряд із «перевірено {date}» `['markers','ddLayouts']`; Skills — `['skills']`; Catalog і Calc — `['items','recipes','buildables']`. Наявні посилання на TH.GL/questlog **не прибирати** (джерела ще ті самі).

- [ ] **Step 1: Тести** `summaryText`: `{added:12,removed:3,changed:40}` → `'+12 · −3 · змінено 40'`; `{added:0,removed:0,changed:0}` → `'змінено'`; `{added:2,removed:0,changed:0}` → `'+2'`.
- [ ] **Step 2:** `npx vitest run src/lib/gamedata.test.ts` → FAIL.
- [ ] **Step 3:** Реалізувати модулі й правки сторінок (стилі — як у сусідніх сторінок, класи `text-ink2`/`underline hover:text-spice` тощо; на телефоні список розділів — картками, не таблицею).
- [ ] **Step 4:** PASS; `npx tsc --noEmit` без нових помилок.

### Task 6: Переклади

**Files:**
- Create: `locales/parts/gamedata.<lang>.json` для `en de fr es it pl pt-BR ru tr ja ko zh-Hans zh-Hant` (перевірити імена мов у `locales/*.json`)
- Modify (скриптом): `locales/<lang>.json`

- [ ] **Step 1:** `npm run i18n:extract` (або подивитися його вивід) — зібрати нові ключі з Tasks 4–5: назви розділів, драйверів, підписи сторінки, «оновлено {date}», «немає такого розділу», тексти cron.
- [ ] **Step 2:** Записати переклади в part-файли (тільки нові ключі).
- [ ] **Step 3:** `npm run i18n:merge` (**без `--clean`**) → у виводі `+N` для кожної мови; part-файли не видаляти руками, якщо інші сесії ще мерджать — видаляти лише свої `gamedata.*.json` після злиття.

### Task 7: Перевірка на копії `dune_preview` і ввімкнення

**Files:**
- Modify: `.claude/launch.json` у `/Users/stepanenko/Sites/DuneAwakening` — додати `gamedata-api` (як `spice-api`, але `ENV_FILE` — власний файл у scratchpad цієї сесії з базою `dune_preview` і `GAMEDATA=1`, `PORT=5241`) і `gamedata-web` (`API_PORT=5241`, `--port 5242`).

- [ ] **Step 1:** Створити env-файл для прев'ю: скопіювати змінні з живого `.env`, замінити базу на `dune_preview`, додати `GAMEDATA=1`. Переконатися, що `dune_preview` існує (`snotax db`/psql); якщо ні — спитати користувача, звідки взяти копію.
- [ ] **Step 2:** `preview_start gamedata-api`, `gamedata-web`; дочекатися першого `gamedata-check` (або `POST /api/admin/gamedata/check` під адміном прев'ю) → `GET /api/gamedata/status` показує розділи `items…images` зі статусом `ok`, журнал порожній.
- [ ] **Step 3:** Ще раз `check` без змін даних → журнал порожній (індикатор не «оновлюється» сам).
- [ ] **Step 4:** Змінити одне поле в `game_items` на `dune_preview` (напр. `stack` одного предмета) → `check` → рівно один рядок журналу `items: змінено 1`; повернути значення → ще один рядок.
- [ ] **Step 5:** Браузер: `/data`, Home, Map, Catalog, Skills на 1280 і 375 px, мови uk і en, темна тема — без обрізання, без горизонтальної прокрутки; знімок екрана як доказ.
- [ ] **Step 6:** **Спитати користувача** дозвіл увімкнути на живому (`GAMEDATA=1` у живий `.env` → 3 нові таблиці й cron пишуть у базу `dune`). Без «так» — не вмикати.

---

## Дорожня карта наступних планів (кожен — окремий документ після завершення попереднього)

| План | Зміст (spec) | Від чого залежить |
|---|---|---|
| 2. Видобувач | `dune/tools/game-extractor/`: Docker-образ(и), DepotDownloader `check/fetch`, розпакування образу, usmap (заморожений сервер + сканер + jmap з патчем UClass), CUE4Parse-консоль, нормалізатор `items/placeables/recipes/buildables/texts/config` з `released`, пакет `manifest.json` + `sections/*.json.gz`, доставка в теку або push (§4.3–4.5, §6a) | — (паралельно з планом 1) |
| 3. Драйвер `gamefiles` для каталогу й перекладів | читання пакета, `POST /api/admin/gamedata/bundle`, реєстр стає писачем `game_*` для розділів з пріоритетом `gamefiles`, таблиця відповідності будівель, `source='game'` у `game_texts`, diff-звіт і кнопка перемикання по розділу, ручне відкриття невипущеного (§4.8, §6, §6a, §7 етап 2) | 1, 2 |
| 4. Навички | `DT_SkillTree*` у видобувачі, заморожена таблиця відповідності для `?b=` (§6) | 3 |
| 5. Мапа | `maps/markers/resources/spice/ddLayouts` у видобувачі (складання трансформів CB), перетворення в кадр TH.GL у драйвері, підтвердження «сід → розкладка», заміна `large-spice.json` (§4.6, §4.7) | 3 |
| 6. Автоматизація | розклад `check` на хості видобування, push з окремого сервера гри, адмін-сторінка драйверів (пріоритет, помилки, «перевірити зараз», відкат розділу), прогін на Linux (§4.4, §5 адмін, §7 етап 5) | 3 |

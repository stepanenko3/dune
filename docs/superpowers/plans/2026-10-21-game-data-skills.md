# Уміння з файлів гри — план 4

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** розділ `skills` (дерева вмінь для планувальника `/skills`) береться з файлів гри так само, як предмети/рецепти: видобувач кладе його в пакет, адмін перемикає в «Дані гри», збір questlog перестає його чіпати, відкат повертає дані questlog.

**Architecture:** видобувач експортує 4 таблиці прогресії, нормалізатор `normalize/skills.mjs` складає записи у формі нинішнього `skills.json` (id = тег модуля в нижньому регістрі з `_` замість `.`, — це рівно нинішні slug-и questlog), тексти отримують вид `skill` у 14 мовах. На сайті `skills` стає перемикним розділом: застосовувач пише `game_skills` з позначками випущеного, `createSkills` не збирає questlog, поки основне — файли гри, відкат перечитує `skills/skills.json`.

**Tech Stack:** Node ESM (видобувач і сервер), vitest, CUE4Parse-експортер (без змін коду — лише нові пакети в `TABLES`).

**Spec:** `docs/superpowers/specs/2026-10-21-game-data-drivers-design.md` (§4.1 `skills`, §6 «Навички», §6a, §7 етап 3)

## Знахідки дослідження (збірка 2160922)

- `DuneSandbox/Content/Dune/Systems/Progression/DT_TrainingModules` — 146 рядків-модулів: `Tag.TagName` (`Skills.Ability.AssaultSeeker`), `SkillArea` (`ESkillTree::Trooper|Mentat|Swordmaster|BeneGesserit|Planetologist|Hidden`), `GridPosition {X,Y}`, `MaxLevel`, `PrereqModuleTags_And/_Or`, `SkillPointsPerLevel {Value, Curve{CurveTable, RowName}}`, `AbilityExtraStatsUIData[] {Stat{CurveTable,RowName}, DescriptionShort FText, bPercentBased}`, `DisplayName` FText, `AbilityLongDescription` FText, `Icon`, `bExternal`.
- `tag.toLowerCase().replaceAll('.', '_')` = id questlog для **всіх 109** нинішніх умінь; x/y/max збігаються 109/109 → коди білдів `?b=` лишаються дійсними без таблиці відповідності (spec §6 вимагав її лише на випадок розбіжності).
- `bExternal: true` — 30 ключів (`Skills.Key.*`: відкриття школи й завершальних вузлів) — не вміння, на сайті їх нема (лише в `and`). `SkillArea = Hidden` — 7 невипущених (заглушки `LOC_…`, `XX_`). Решта — рівно 109.
- Ціна рангу: `Value × крива(ранг)` з `SkillCosts` (рядки `Technique`, `Ability_Standard`, `Ability_First`, `Attribute`, `SpiceEffect`; лінійна інтерполяція ключів) чи з `CT_AbilityTuning` (`SkillPointCost.FirstSkill`); без кривої — `Value`. Збіг з questlog 108/109 (`explorer5`: гра 2, questlog 1 — правда за грою).
- Бонуси здібностей: криві `CT_AbilityTuning` / `CT_AbilityStatDisplay` за рангом, `bPercentBased` → ×100. Збіг 27/34; решта — свіжіші значення гри (витрата витривалості 15 замість 30–45, новий рядок «Dash Cost Multiplier»); рядка кривої нема — бонус пропускаємо.
- Назва й опис — FText у `ST_Localization_Abilities` (усі 109 знайдено в `Game.locres`): опис = `AbilityLongDescription`, а коли його нема — ключ назви з `_NAME` → `_LONGDESC` у тій самій таблиці.
- `perks`/`buffs` (у questlog — повтор опису й сирі назви атрибутів) сайт не показує, коли є значення gaming.tools; з файлів гри — порожні (значення атрибутів — у GE-блюпринтах, це окрема робота).

## Global Constraints

- Файли гри, usmap, сирі експорти — лише в `GD_WORK` (`/Users/stepanenko/Sites/DuneAwakening/gamefiles`); фікстури тестів — обрізані похідні JSON, не файли гри.
- Живий dune.test перезапускається на кожне збереження в `server/lib|routes|admin`, `locales` і ганяє міграції на живій базі `dune` → міграції лише додаткові й ідемпотентні; перевірки — на `dune_preview` через `gamedata-api`/`gamedata-web` (launch.json, env `scratchpad/gamedata-preview.env`).
- Живий розділ не перемикати — це робить користувач в адмінці.
- `npm run i18n:merge` без `--clean`; свої part-файли видаляти вручну.
- Тека не git: без комітів; паралельні сесії — не чіпати чужі файли.
- Невипущене (§6a): пишеться з `unreleased`, сайт не показує, адмін відкриває вручну.

## Review Focus

1. Старий код білду `?b=` (з questlog-id) після перемикання на файли гри розкодовується в той самий набір рангів — id і порядок умінь не змінились.
2. Відкат на запасне повертає рівно дані questlog (`skills/skills.json`), уміння, що файли гри вважали невипущеними, знову видно.
3. Збір questlog (`skills-sync`, автозбір при порожньому/старому) не перезаписує `game_skills`, поки основне — файли гри.
4. Пакет без `skills` (зламаний експорт таблиці) — розділ `{ error }`, інші розділи й сайт працюють, перемикання на файли гри відмовляє з причиною.
5. Звірка `skills` не показує хибних змін через поле `updated` (є лише в questlog) чи порядок бонусів.

---

### Task 1: Видобувач — експорт і нормалізація вмінь

**Files:**
- Create: `tools/game-extractor/normalize/skills.mjs`
- Modify: `tools/game-extractor/lib/raw.mjs` (TABLES: `modules`, `skillCosts`, `abilityTuning`, `abilityStats`; `out.skills`; тексти вмінь; досвантаження відсутніх таблиць при наявному `.done`)
- Modify: `tools/game-extractor/normalize/texts.mjs` (вид `skill`)
- Test: `tools/game-extractor/test/skills.test.mjs`, `tools/game-extractor/test/texts.test.mjs` (новий випадок), `tools/game-extractor/test/raw.test.mjs` (новий випадок)

**Interfaces:**
- Produces: `normalizeSkills({ modules, curves }) → Skill[]`, де `curves` — `{ '<ObjectPath CurveTable>': Rows }`, `Skill = { id, name, icon, school, kind, desc, x, y, max, levels: [{ cost, bonuses: [name, value, pct][], perks: [], buffs: [] }], and: string[], or: string[], released: boolean }`; `evalCurve(curve, t) → number`; `skillId(tag) → string`; `normalizeTexts({ …, records: { …, skills }, rows: { …, modules } })` додає `skill:<id>:<мова>`.

- [ ] **Step 1: Тести нормалізатора** (`skills.test.mjs`, фікстура — 4 модулі й обрізані криві, вписані в тест):
  - `skillId('Skills.Ability.AssaultSeeker') === 'skills_ability_assaultseeker'`
  - `evalCurve({ InterpMode: 'RCIM_Linear', Keys: [{Time:1,Value:2},{Time:3,Value:4}] }, 2) === 3`; до першого ключа — перший, після останнього — останній; `RCIM_Constant` — значення лівого ключа.
  - здібність: `school 'trooper'`, `kind 'ability'`, `x/y/max` з `GridPosition/MaxLevel`, `and/or` — id тегів, `levels[i].cost = Value × крива(i+1)` (округлено), бонуси `[DescriptionShort.SourceString, крива(i+1), pct]`, відсоткові ×100, рядок кривої відсутній → бонус пропущено; `desc` — `AbilityLongDescription.SourceString`.
  - атрибут без кривої ціни: `cost = Value` на кожному рангу; `perks: [], buffs: []`.
  - `bExternal` — не в результаті; `SkillArea Hidden` → `released: false`; назва `LOC_…`/`XX_…` → `released: false`.
  - школа `BeneGesserit` → `benegesserit`.
- [ ] **Step 2:** `npx vitest run tools/game-extractor/test/skills.test.mjs` → FAIL (модуля нема).
- [ ] **Step 3:** реалізувати `normalize/skills.mjs` (опис без `AbilityLongDescription` — `null` у записі; англійський текст береться з перекладів, див. крок 4).
- [ ] **Step 4: Тест текстів:** модуль з `DisplayName {TableId …ST_Localization_Abilities, Key 'SKILLS/TECHNIQUE_X_NAME'}` без довгого опису → `skill:<id>:uk` з назвою й описом за ключем `SKILLS/TECHNIQUE_X_LONGDESC`; невипущене — без записів. Англійський опис запису вміння (`desc`), якщо `null`, нормалізатор `raw.mjs` заповнює з `en` за тим самим правилом.
- [ ] **Step 5: Тест raw:** `.done` є, а `tables/DT_TrainingModules.json` нема → `exportRaw` експортує лише відсутні таблиці (фейковий `docker`, лічильник викликів `tables`), `locres`/`stations` не повторює.
- [ ] **Step 6:** реалізувати `raw.mjs` / `texts.mjs`; `npx vitest run tools/game-extractor` → PASS.
- [ ] **Step 7: Прогін на справжній збірці:** `npm run gdx -- export --work /Users/stepanenko/Sites/DuneAwakening/gamefiles` (досвантажить 4 таблиці), далі `normalize`, `bundle`. Expected: у `bundles/2160922/manifest.json` розділ `skills` без `error`; 116 записів (109 випущених + 7 невипущених); `node` звірка з `server/data/skills/skills.json`: id 109/109, x/y/max 109/109, cost ≥108/109. Результат — у `plan4-ledger.md`.

### Task 2: Сайт — перемикний розділ «Уміння»

**Files:**
- Modify: `server/lib/gamedata/index.mjs` (`SWITCHABLE` + `skills`; `switchPrimary` відкат → `skills.reimport()`), `server/lib/gamedata/apply.mjs` (застосовувач `skills`), `server/lib/gamedata/compare.mjs` (`IGNORE.skills` + `updated`), `server/lib/skills.mjs` (`createSkills`: пропуск збору, `reimport`), `server/app.mjs` (передати `skills` у `createGameDataRoutes`/`switchPrimary`), `server/routes/gamedata.mjs`
- Test: `server/gamedata-switch.test.mjs`, `server/gamedata-compare.test.mjs`, `server/skills.test.mjs` (новий чи наявний файл тестів `createSkills`)

**Interfaces:**
- Consumes: розділ пакета `skills: { records: Skill[] }` (Task 1).
- Produces: `createSkills({ …, primary: () => Promise<string|null> })` — `sync()` повертає наявне без збору, коли `primary() === 'gamefiles'`; `skills.reimport()` — `skills.json` → `game.importSkills({ …, complete: true })` + `markReleased('skill', { released: всі id })`; `switchPrimary(sources, { game, catalog, skills }, section, driver)`.

- [ ] **Step 1: Тести:**
  - switch: перемикання `skills` на файли гри пише `game_skills` з пакета (ціна рангу з гри), невипущене не видно в `game.skills('en')`; відкат на запасне — знову значення з `skills.json`, невипущене видно.
  - switch: пакет без `skills` → перемикання відмовляє (409/Error), основне лишається `community`.
  - `createSkills`: основне — файли гри → `sync()` не викликає `collect`, `get()` старших за тиждень даних не запускає збору.
  - compare: однакові записи, що різняться лише `updated`, → `changed 0`.
- [ ] **Step 2:** запуск → FAIL.
- [ ] **Step 3:** реалізація (застосовувач — як `applyKind(game, 'skill', records, FROM.skill)`; `FROM.skill` уже має форму `skills.json`).
- [ ] **Step 4:** `npx vitest run server/gamedata-*.test.mjs server/skills*.test.mjs` → PASS; `npm test` → усе зелене.

### Task 3: Перевірка на копії й адмінка

- [ ] **Step 1:** прев'ю (`gamedata-api`/`gamedata-web`, `dune_preview`; роль admin тестовому `udwrapcyulwp` тимчасово, потім повернути `user`): у «Дані гри» «Уміння» — у групі з вибором джерела, картки «Файли гри 1.5.15» / «questlog.gg + gaming.tools»; «Порівняти джерела» показує відмінності (очікувано: ціна `explorer5`, витрата витривалості 7 здібностей).
- [ ] **Step 2:** перемкнути «Уміння» на файли гри; `/skills`: 5 шкіл, дерева на місцях, старе посилання з `?b=` (взяти будь-яке збережене білдів у `dune_preview`) відкриває ті самі ранги; українські назви з файлів гри; підказка рангу показує бонуси гри. Відкат — знову questlog.
- [ ] **Step 3:** телефон 375 px — `/skills` без горизонтальної прокрутки (не змінювали, але дані інші).
- [ ] **Step 4:** фінальний рецензент (найздібніша модель) на всю роботу плану; виправлення Critical/Important з тестом RED→GREEN; живий розділ не перемикати.

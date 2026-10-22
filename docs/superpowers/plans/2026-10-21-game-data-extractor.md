# Ігрові дані: видобувач із файлів гри (план 2) — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Інструмент `dune/tools/game-extractor`, що сам перевіряє Steam, качає серверні файли Dune: Awakening, знімає usmap, експортує потрібні таблиці й переклади і складає нормалізований пакет (bundle) розділів `items`, `placeables`, `recipes`, `buildables`, `texts`, `config` з хешами — однаково на Маці, Linux-сервері й окремому сервері гри.

**Architecture:** Node-оркестратор `bin/gdx.mjs` (кроки `check → fetch → unpack → usmap → export → normalize → bundle`, кожен кешується за збіркою) викликає: DepotDownloader (закріплений реліз, перевірка sha256), системний `tar` (розпакування OCI-образу без запуску), Docker з образом сервера + образом jmap (usmap із замороженого процесу), Docker-образ .NET-експортера на CUE4Parse (таблиці → JSON, `.locres` → JSON, станції крафту). Нормалізація — у Node, хеші — тим самим `server/lib/gamedata/hash.mjs`, що й у реєстрі сайту, тож однакові дані дають однаковий хеш. Сайт пакет поки не читає, а доставка на сайт (push з окремого хоста, `POST /api/admin/gamedata/bundle`) — теж план 3; тут пакет лягає в локальну теку `GD_WORK/bundles`.

**Tech Stack:** Node 24 (ESM), vitest; .NET 10 + CUE4Parse (вихідники, закріплений коміт); Rust (jmap_dumper, закріплений коміт + наш патч); Docker; DepotDownloader 3.4.0.

**Spec:** `docs/superpowers/specs/2026-10-21-game-data-drivers-design.md` (§4.3 пакет, §4.4 видобувач, §4.5 стійкість, §6a невипущене, §8 перевірка). Факти: нотатки спайку `game-data-spike.md` і відповідність полів `game-field-mapping.md` у `~/Library/Application Support/Claude/side-session-notes/local_42e4b3b4-0215-4938-bfb7-f086091fdc37/`.

## Global Constraints

- Тека не git: замість комітів — перевірка, що змінено лише файли задачі. Чужого не чіпати.
- **Нічого в `dune/server/`, `dune/locales/`, `dune/src/` не змінювати** (живий `dune.test` перезапускається від `server/`; план 2 — лише `dune/tools/game-extractor/` і `dune/package.json` (скрипт)). `server/lib/gamedata/hash.mjs` лише імпортувати.
- Файли гри, tar-образи, usmap, сирі експорти — **лише в робочій теці** `GD_WORK` (за замовчуванням `/Users/stepanenko/Sites/DuneAwakening/gamefiles`), ніколи в `dune/`. У тестах — тільки маленькі вручну складені фікстури (похідні факти), не шматки файлів гри.
- Джерело — лише офіційне: Steam app `4754530`, Linux-депо `4754532`, анонімно (`-os linux -osarch 64`). Качаємо лише `images/battlegroup/server.tar` і `images/battlegroup/version.txt` (`-filelist`).
- Закріплені залежності:
  - DepotDownloader `3.4.0`: `DepotDownloader-macos-arm64.zip` sha256 `60e80c7c496f3f9a079cd3c62036b35d088c27bc0149baf38f009eb57a52f6a5`; `DepotDownloader-linux-x64.zip` sha256 `a999dec66b4850fc961bd50366696d23c2d0fad7b18790e6a5647b2f19097a53`; інші платформи — помилка «нема закріпленого хешу».
  - CUE4Parse — `https://github.com/FabianFG/CUE4Parse` коміт `6f7b06eefa22f3cc259d03bb9901a384cb4fb538`.
  - jmap — `https://github.com/trumank/jmap` коміт `06358743191bd3942b6824666f7a02ce07b19fe8` + патч `usmap/jmap-dune-uclass.patch` (Task 4).
- Режим гри в CUE4Parse — `EGame.GAME_DuneAwakening`; обов'язково заповнювати `Versions.MapStructTypes` (інакше мапи з ключем-структурою — інгредієнти, вихід рецептів, ціни будівництва — тихо стають `null`; деталі — Task 1).
- Мови: каталоги `.locres` → коди сайту: `zh-CN`→`zh-Hans`, `zh-TW`→`zh-Hant`, решта 1:1 (`de en es fr it ja ko pl pt-BR ru tr uk`).
- Форма записів розділів — як у драйвера «запасне джерело» (`server/lib/gamedata/drivers/community.mjs`), щоб у плані 3 порівнювати 1:1; плюс `released: boolean` (невипущене лишається в пакеті з `released:false`, spec §6a).
- Linux/x86 бінарники (сервер гри, jmap) — `--platform linux/amd64` (на Маці — Rosetta); .NET-експортер — рідна архітектура.

## Review Focus

- Повторний `gdx all` на тій самій збірці → нічого не качається й не перераховується, хеші пакета ті самі. Тест у Task 9.
- Steam недоступний / DepotDownloader падає посеред завантаження → крок завершується помилкою, `latest.json` і попередній пакет не зачеплені. Тест у Task 9.
- Сервер не дійшов до «Game Engine Initialized» за 180 с або впав раніше → `usmap` падає з ясною причиною, контейнери прибрано. Тест у Task 4.
- Експорт без однієї таблиці / підозріло мало рядків → цей розділ не потрапляє в пакет (у `manifest.json` — `{ error }` з причиною), решта розділів — потрапляють (spec §4.5: зламаний розділ не блокує інші); усі розділи зламані → пакета нема. Тест у Task 9.
- Місце на диску: старі збірки накопичуються (≈10 GB на збірку) → `prune` лишає 2 останні. Тест у Task 9.

---

### Task 1: .NET-експортер (CUE4Parse) у Docker

**Files:**
- Create: `dune/tools/game-extractor/export/Gdx.Export.csproj`, `export/Program.cs`, `export/Dockerfile`, `dune/tools/game-extractor/README.md` (розділ «Експортер»)
- Test: `dune/tools/game-extractor/test/export.int.test.mjs` (інтеграційний; пропускається, якщо нема паків у `GD_WORK`)

**Interfaces:**
- Produces: Docker-образ `sandwalkers/gd-export:1` (рідна архітектура). Запуск: `docker run --rm -v <paks>:/paks:ro -v <usmap>:/map.usmap:ro -v <out>:/out sandwalkers/gd-export:1 <команда> …`:
  - `tables <пакет>…` → `/out/tables/<ім'я пакета>.json` (масив експортів, як `GetExports()` у JSON; для `UCompositeDataTable` — зі злитими рядками).
  - `locres` → `/out/loc/<код сайту>.json` для 14 мов (`{ "<namespace>": { "<key>": "<text>" } }`); джерело `DuneSandbox/Content/Localization/Game/<lang>/Game.locres` через `new FTextLocalizationResource(new FByteArchive(path, provider.SaveAsset(path), provider.Versions))`.
  - `stations <пакет CDT_PlaceableData>` → `/out/stations.json` `{ "<placeableId>": ["<ProductionType>", …] }`: для кожного рядка — `m_Placeable.AssetPathName` (BP-клас) → пакет BP → експорт типу `ItemCraftingActorComponent` з `m_SupportedProductionTypes[].Name`; нема — іти до батьківського класу (`Super` у `BlueprintGeneratedClass`) до кореня; рядки без компонента — не включати.
- Налаштування провайдера (як у `research/spike2/src/Program.cs`): `new DefaultFileProvider("/paks", TopDirectoryOnly, new VersionContainer(EGame.GAME_DuneAwakening, mapStructTypesOverrides: <явні>))`; явні ключі: `Outcome`/`Ingredients` → `EItemTemplateID`, `m_BuildableTierData` → (`EBuildableTier`, `BuildableTierData`), `BaseAdditionalCurrencyPrices` → `ECurrency`; після `Mount()` — пройти всі типи usmap і для кожного `MapProperty` з ключем `StructProperty` додати `ім'я → (KeyStruct, ValueStruct)`, якщо ім'я не неоднозначне й ще не задане.
- `Dockerfile`: етап збирання `mcr.microsoft.com/dotnet/sdk:10.0` — `git clone` CUE4Parse і `git checkout 6f7b06eefa22f3cc259d03bb9901a384cb4fb538`, `dotnet publish -c Release`; етап запуску `mcr.microsoft.com/dotnet/runtime:10.0`.

- [ ] **Step 1: Тест** `export.int.test.mjs` (`describe.skipIf(!fs.existsSync(PAKS))`, `PAKS = $GD_WORK/extract/rootfs/home/dune/server/DuneSandbox/Content/Paks`, usmap `$GD_WORK/mappings/DuneSandbox-2160922.usmap`): запускає образ у тимчасову теку й перевіряє:
  - `tables …/Items/CDT_BaseItems` → рядок `AluminiumBar` має `StaticData.Name.SourceString === 'Aluminum Ingot'`
  - `tables …/Crafting/DT_ItemsCraftingRecipes` → `AluminiumBarRecipe.Recipe.Outcome` — непорожній масив з ключем `AluminiumBar` (а не `null`)
  - `locres` → 14 файлів, `uk.json` має namespace `ST_Localization_Items`
  - `stations …/Building/Data/CDT_PlaceableData` → `VehiclesFabricator_Placeable` містить `VehicleFabricator`
- [ ] **Step 2:** `docker build -t sandwalkers/gd-export:1 dune/tools/game-extractor/export` ще не існує → `npx vitest run tools/game-extractor/test/export.int.test.mjs` FAIL.
- [ ] **Step 3:** Реалізувати `Program.cs`, `.csproj`, `Dockerfile`; зібрати образ.
- [ ] **Step 4:** PASS (на Маці, де є паки зі спайку).

### Task 2: Steam: перевірка й завантаження

**Files:**
- Create: `dune/tools/game-extractor/lib/steam.mjs`, `lib/run.mjs`
- Test: `dune/tools/game-extractor/test/steam.test.mjs`, фікстура `test/fixtures/manifest_4754532.txt` (шапка + 3 рядки файлів, вручну)

**Interfaces:**
- Produces:
  - `run.mjs`: `run(cmd: string, args: string[], { cwd?, env?, timeoutMs?, onLine? }): Promise<{ code: number, out: string }>` (spawn без shell; ненульовий код → `Error` з останніми 20 рядками виводу).
  - `steam.mjs`:
    - `PINNED = { 'darwin-arm64': { asset: 'DepotDownloader-macos-arm64.zip', sha256: '60e8…f6a5' }, 'linux-x64': { asset: 'DepotDownloader-linux-x64.zip', sha256: 'a999…7a53' } }` (повні значення — з Global Constraints); реліз `https://github.com/SteamRE/DepotDownloader/releases/download/DepotDownloader_3.4.0/<asset>`.
    - `ensureDepotDownloader(work): Promise<string>` — шлях до бінарника в `<work>/tools/depotdownloader-3.4.0/`; качає й перевіряє sha256 лише раз; невідома платформа → `Error('нема закріпленого DepotDownloader для <platform>')`.
    - `parseManifest(text): { manifestId: string, date: string, files: Record<string, { size: number, sha: string }> }`.
    - `check(work): Promise<{ manifestId, date, serverTarSha, versionTxtSha }>` — `-manifest-only` у тимчасову теку `<work>/tmp/manifest-<ts>`.
    - `fetch(work, depotDir): Promise<void>` — `-app 4754530 -os linux -osarch 64 -dir <depotDir> -validate -max-downloads 24 -filelist <file>` з двома рядками `images/battlegroup/server.tar`, `images/battlegroup/version.txt`.

- [ ] **Step 1: Тести:** `parseManifest(фікстура)` → `manifestId '7714035349234915047'`, `files['images/battlegroup/server.tar'] = { size: 4453453824, sha: 'b42fa11002a70add0717edc191c3ae345e1289da' }`; `ensureDepotDownloader` з `process.platform`/`arch`, підміненими на `win32-x64` (параметр `platform` для тесту), → кидає «нема закріпленого»; `run('node', ['-e','process.exit(3)'])` → відхиляється, повідомлення містить код 3.
- [ ] **Step 2:** `npx vitest run tools/game-extractor/test/steam.test.mjs` → FAIL.
- [ ] **Step 3:** Реалізувати.
- [ ] **Step 4:** PASS; руками: `node -e "import('./tools/game-extractor/lib/steam.mjs').then(m=>m.check('<GD_WORK>')).then(console.log)"` → `manifestId` такий самий, як у спайку (або новіший).

### Task 3: Розпакування образу сервера (без запуску)

**Files:**
- Create: `dune/tools/game-extractor/lib/image.mjs`
- Test: `dune/tools/game-extractor/test/image.test.mjs` (будує в тимчасовій теці крихітний OCI-tar: `manifest.json` з `RepoTags: ['registry.funcom.com/funcom/self-hosting/seabass-server:123-0-shipping']`, два gzip-шари; потрібні файли — у другому)

**Interfaces:**
- Produces: `unpack(tarPath, destDir): Promise<{ build: string, version: string|null, tag: string, root: string }>` — `version` — з мітки `code_branch` у конфігу образу (`Config` з `manifest.json` → JSON-блоб → `config.Labels.code_branch`, `Seabass_sb-1.5.15.0` → `'1.5.15'`; нема → `null`); `tar -xOf <tar> manifest.json` → шари; із кожного шару (`tar -xzf <tar-шар>` через тимчасовий файл або потік) — лише `home/dune/server/DuneSandbox/Content/Paks` і `home/dune/server/DuneSandbox/Config`; `build` — число з тегу до першого `-` (`2160922`); `root` — `<destDir>/home/dune/server/DuneSandbox`. Повторний виклик з наявним `<destDir>/.done` (вміст — тег) → нічого не робить.
- [ ] **Step 1: Тести:** після `unpack` є `root/Config/DefaultGame.ini` і `root/Content/Paks/x.utoc`, нема `root/Binaries`; `build === '123'`; `version === '1.5.15'` (фікстурний конфіг з `Labels.code_branch = 'Seabass_sb-1.5.15.0'`); другий виклик не викликає `tar` (лічильник викликів через параметр-обгортку `run`).
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS.

### Task 4: usmap із замороженого сервера

**Files:**
- Create: `dune/tools/game-extractor/usmap/Dockerfile` (образ jmap), `usmap/jmap-dune-uclass.patch`, `usmap/find_globals.py`, `usmap/dump.sh`, `lib/usmap.mjs`
- Test: `dune/tools/game-extractor/test/usmap.test.mjs`

**Interfaces:**
- `jmap-dune-uclass.patch` — рівно цей diff (поверх коміту jmap з Global Constraints):
  ```diff
  --- a/jmap_dumper/unreal/src/objects.gs
  +++ b/jmap_dumper/unreal/src/objects.gs
  @@ TArray<UField*> NetFields;
       TArray<UField*> NetFields;
  +    // Dune: Awakening (UE 5.2.1 fork): 0x18 extra bytes before ClassDefaultObject
  +    if (UE_VERSION == 502) {
  +        STUB* DuneUnk0;
  +        uint64_t DuneUnk1;
  +        uint64_t DuneUnk2;
  +    }
       if (UE_VERSION >= 425 && UE_VERSION < 500) int32_t FirstOwnedClassRep;
  ```
  (згенерувати справжній `git diff` з `/Users/stepanenko/Sites/DuneAwakening/gamefiles/tools/jmap`; збережено й у `/private/tmp/…/scratchpad/jmap-dune-uclass.patch`).
- `usmap/Dockerfile`: `FROM --platform=linux/amd64 rust:1-bookworm`, `git clone` jmap, `checkout 0635874…`, `git apply` патч, `cargo build --release -p jmap_dumper`; кінцевий образ `sandwalkers/gd-jmap:1` з `/usr/local/bin/jmap_dumper`, `python3`, `/opt/find_globals.py`.
- `find_globals.py <pid>` — як `/private/tmp/claude-501/-Users-stepanenko-Sites-DuneAwakening/a4b4a352-0def-4f87-b590-eb0d97ad8e8f/scratchpad/find_globals.py` (перенести), вивід — рівно один JSON-рядок `{"fnamePool":"0x…","guobjectArray":"0x…","imageBase":"0x…"}` (imageBase — початок першого сегмента бінарника в `/proc/<pid>/maps`); нема рівно одного кандидата кожного → код 2 і перелік кандидатів у stderr.
- `dump.sh` (у контейнері jmap): `pid` процесу `DuneSandboxServer-Linux-Shipping` (через `pgrep -x DuneSandboxServ`), `python3 /opt/find_globals.py $pid` → `jmap_dumper --skip-vtables --pid $pid --fname-pool … --guobject-array … --engine-version 5.2 --image-base … --target x86_64-unknown-linux-gnu --build-changelist $BUILD /out/dune.jmap.gz` → `jmap_dumper --jmap /out/dune.jmap.gz /out/dune.usmap`.
- `lib/usmap.mjs`:
  - `parseGlobals(line: string): { fnamePool: string, guobjectArray: string, imageBase: string }`
  - `waitForLine(readLine: () => Promise<string|null>, re: RegExp, timeoutMs: number): Promise<boolean>`
  - `makeUsmap({ work, build, image, docker = run }): Promise<string>` — шлях `<work>/mappings/DuneSandbox-<build>.usmap`; є файл → повертає одразу. Інакше: `docker image inspect <image>` (нема → `docker load -i <server.tar>`); `docker run -d --name gd-usmap-<build> --platform linux/amd64 --network none --cap-add SYS_PTRACE --entrypoint bash -w /home/dune/server <image> -c "su dune -c './DuneSandbox/Binaries/Linux/DuneSandboxServer-Linux-Shipping DuneSandbox -log -stdout -unattended -nosteam' > /tmp/s.log 2>&1; sleep infinity"`; чекати в `docker exec … tail -F /tmp/s.log` рядок `/Game Engine Initialized/` ≤ 180 с; `docker exec … pkill -STOP DuneSandboxServ`; `docker run --rm --platform linux/amd64 --pid container:gd-usmap-<build> --cap-add SYS_PTRACE -v <tmp>:/out -e BUILD=<build> sandwalkers/gd-jmap:1 /opt/dump.sh`; скопіювати `dune.usmap` (+ `dune.jmap.gz`) у `<work>/mappings/`; **завжди** `docker rm -f gd-usmap-<build>` (finally).
- [ ] **Step 1: Тести** (з фейковим `docker`-виконавцем, що записує виклики): `parseGlobals('{"fnamePool":"0x1","guobjectArray":"0x2","imageBase":"0x3"}')` → об'єкт; `waitForLine` з рядками без маркера і `timeoutMs: 50` → `false`; `makeUsmap` при наявному файлі не викликає `docker`; коли рядок не з'явився — відхиляється з «сервер не дійшов до Game Engine Initialized за 180 с» і серед викликів є `rm -f gd-usmap-…`.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати; `docker build --platform linux/amd64 -t sandwalkers/gd-jmap:1 dune/tools/game-extractor/usmap` (≈35 хв уперше під емуляцією).
- [ ] **Step 4:** PASS; руками: перейменувати наявний `DuneSandbox-2160922.usmap` на `.bak`, `makeUsmap` → новий файл; `cmp` з `.bak` не обов'язково побайтно, але розмір у межах ±5 % і Task 1 int-тест проходить з новим.

### Task 5: Нормалізація: предмети й пристрої

**Files:**
- Create: `dune/tools/game-extractor/normalize/common.mjs`, `normalize/items.mjs`, `normalize/placeables.mjs`
- Test: `dune/tools/game-extractor/test/normalize-items.test.mjs` з фікстурами `test/fixtures/items.json`, `test/fixtures/placeables.json` (кілька рядків, вручну, у формі експорту Task 1)

**Interfaces:**
- `common.mjs`: `rowsOf(exports): Record<string, any>` (злиті `Rows` таблиці/композиту); `iconPath(softPath): string|null` — `'/Game/Dune/…/T_X_D.T_X_D'` → `'assets/Dune/…/T_X_D'`; `tagNames(tags): string[]`; `tierOf(tags): number` (`LootTier.N` → N, нема → 0).
- `normalizeItems(rows): Rec[]` — запис `{ id, name, icon, grade, cat, sub, kind, rarity, stack, volume, released }` (поля й правила — `game-field-mapping.md` §1, §3):
  - `name` ← `StaticData.Name.SourceString` (нема → `null`); `icon` ← `iconPath(Icon)`; `grade` ← `tierOf(StaticData.ItemTags)`; `cat`/`sub` ← таблиця тегів §3 (`Items.Holsters.RangedWeapons.Heavy.RocketLauncher` → `weapon`/`rocket_launcher`; інше → `misc`/`null`); `kind` ← другий сегмент першого тегу `Items.X…`; `rarity` ← `'rare'|'memento'|null` з `Rarity.*`; `stack` ← `StackAndDurability.MaxStackSize`; `volume` ← `StaticData.ItemSize`.
  - `released` ← `bIsDeprecated !== true && name !== id`.
- `normalizePlaceables(rows): Rec[]` — `{ id, name, icon, grade, cat, sub, power, water, waterRate, released }`: `name` ← `m_DisplayName.SourceString`; `icon` ← `m_BuildableIcon`; `cat` ← `m_BuildableGroupType.Name.toLowerCase()`; `sub` ← `m_BuildableTier.Name.toLowerCase()`; `grade` ← число з tier; `power` ← `m_PowerProduction − m_PowerConsumption`; `water` ← `m_WaterCapacity`; `waterRate` ← `m_WaterGenerationRateInSecs`; `released` ← name не починається з `XX_`/`LOC_`/`DEBUG` і `name !== id`.
- [ ] **Step 1: Тести** (значення — з `game-field-mapping.md`): `AluminiumBar` → `{ name:'Aluminum Ingot', icon:'assets/Dune/GUI/Textures/Icons/Gameplay/Items/Resources/T_UI_IconResourceAluminiumBar_D', grade:<N з LootTier>, released:true }`; рядок з `bIsDeprecated:true` → `released:false`; рядок з назвою = id → `released:false`; тег `Items.Holsters.RangedWeapons.Heavy.RocketLauncher` → `cat:'weapon', sub:'rocket_launcher'`; пристрій з `m_PowerProduction:0, m_PowerConsumption:15` → `power:-15`; пристрій `XX_Test` → `released:false`.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS.

### Task 6: Нормалізація: рецепти й станції

**Files:**
- Create: `dune/tools/game-extractor/normalize/recipes.mjs`
- Test: `dune/tools/game-extractor/test/normalize-recipes.test.mjs`, фікстура `test/fixtures/recipes.json`, `test/fixtures/stations.json`

**Interfaces:**
- Consumes: записи `items` (Task 5), `stations.json` (Task 1).
- `normalizeRecipes(rows, { items: Rec[], stations: Record<string,string[]> }): Rec[]` — `{ id, name, time, water, at, in, out, released }` (§4):
  - `in` ← `IngredientsPerQuality[0].Ingredients[] → [Key.Name, Value.Amount]` (ключ `None` — пропустити); `out` ← `Recipe.Outcome[] → [Key.Name, Value.Amount]`; `time` ← `Recipe.CraftingTimeInSec`; `water` ← `IngredientsPerQuality[0].m_WaterIngredientAmount` (нема → `Recipe.WaterOutcome` або `null`).
  - `name` ← `name` першого виходу серед `items`; `at` ← усі `placeableId`, чиї `stations[id]` перетинаються з `RequiredProductionTypes[].Name`, відсортовані; тип `Personal` → `[]`.
  - `released` ← кожен вхід і вихід — запис `items` з `released:true`.
- [ ] **Step 1: Тести:** `AluminiumBarRecipe` → `in:[['BauxiteOre',7]]`, `out:[['AluminiumBar',1]]`, `time:30`, `water:150`, `at:['MediumOreRefinery_Placeable']` (фікстура станцій: `MediumOreRefinery_Placeable: ['MediumOreRefinery']`, рецепт вимагає `MediumOreRefinery`); `VehicleFabricator` → `at:['VehiclesFabricator_Placeable']`; вихід — невипущений предмет → `released:false`; інгредієнт з ключем `None` пропущено.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS.

### Task 7: Нормалізація: будівельні модулі

**Files:**
- Create: `dune/tools/game-extractor/normalize/buildables.mjs`
- Test: `dune/tools/game-extractor/test/normalize-buildables.test.mjs`, фікстури `test/fixtures/building.json` (рядки `CDT_BuildingData`), `group.json` (`CDT_BuildableGroupData`), `sets.json` (`DT_BuildableUnlockableSetsData`), `subcat.json` (`DT_DuneBuildableUiSubcategory`), `uicat.json` (`DT_BuildableUiCategory`)

**Interfaces:**
- `normalizeBuildables({ building, placeables, group, sets, subcat, uicat }): Rec[]` — запис `{ id, set, group, name, img, health, cost, released }` (§5):
  - `id` — ім'я рядка гри (прив'язка до ключів вікі — план 3, через `img`).
  - `set` — набір (патент-предмет) з `DT_BuildableUnlockableSetsData`, що містить рядок (ім'я рядка набору як є; людські назви — план 3).
  - `group` — підкатегорія з `DT_DuneBuildableUiSubcategory`, в `m_Buildables` якої є `m_BuildableGroupType` рядка (`Foundations→structural`, `Walls→wall`, `Triangle_Walls→wedge_wall`, `Roofs→roof`, `Ramps→incline`, `Decorative`/`Stairs→special`; інші — ім'я в нижньому регістрі).
  - `name` ← `m_DisplayName.SourceString`; `img` ← `iconPath(m_BuildableIcon)`.
  - `health` ← `group[m_BuildableGroupType].m_BuildableTierData[m_BuildableTier].m_MaxHealth`; `cost` ← той самий запис `.m_PlacementCosts` → `[[item, n]]`, відсортовано за item.
  - `released` ← `m_bShowInList && є набір && фракція (через uicat) ≠ 'Blockout'`.
  - Пристрої (`placeables/*` у вікі) — ті самі правила для рядків `CDT_PlaceableData`, що мають запис у group/tier.
- [ ] **Step 1: Тести:** колона центру й кутова з однаковою іконкою → два записи з різним `health` (5600 у кутової); рядок з фракцією Blockout → `released:false`; ціна з двох ресурсів відсортована; `group` для `Foundations` → `structural`.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS.

### Task 8: Нормалізація: переклади й налаштування гри

**Files:**
- Create: `dune/tools/game-extractor/normalize/texts.mjs`, `normalize/config.mjs`, `normalize/ini.mjs`
- Test: `dune/tools/game-extractor/test/normalize-texts.test.mjs`, `normalize-config.test.mjs`; фікстури `test/fixtures/loc-uk.json`, `loc-en.json`, `test/fixtures/DefaultGame.ini` (вручну: секції `[/Script/DuneSandbox.SpiceHarvestingSystem]`, `[/Script/DuneSandbox.CoriolisStormConfigMultiplayer]`, `[/Script/DuneSandbox.CoriolisSubsystem]` із кількома ключами)

**Interfaces:**
- `LANG_DIRS = { de:'de', en:'en', es:'es', fr:'fr', it:'it', ja:'ja', ko:'ko', pl:'pl', 'pt-BR':'pt-BR', ru:'ru', tr:'tr', uk:'uk', 'zh-Hans':'zh-CN', 'zh-Hant':'zh-TW' }` (код сайту → тека `.locres`).
- `normalizeTexts({ loc: Record<siteLang, LocJson>, rows: { items, placeables, building }, records: { items, placeables, recipes, buildables } }): Rec[]` — `{ id: \`${kind}:${id}:${lang}\`, name, description }` для `kind ∈ item|placeable|recipe|buildable`, лише для випущених записів: `name`/`description` ← `loc[lang][TableId-namespace][Key]` (`TableId '/Game/Dune/Localization/ST_Localization_Items.ST_Localization_Items'` → namespace `ST_Localization_Items`); предмети: `StaticData.Name`, `StaticData.LongDesc`; пристрої й модулі: `m_DisplayName`; рецепт — назва першого виходу тією мовою. Порожній текст → поле `null`; обидва `null` → запису нема.
- `ini.mjs`: `parseIni(text): Record<section, Record<key, string[]>>` (повтори `+Key=` накопичуються); `parseUeStruct(value: string): any` — розбір UE-літералів `(("A", (B=1,C=2)),(…))` у масиви/об'єкти (ключі без лапок, рядки в лапках, числа).
- `normalizeConfig(iniText): { blob }` — `{ spice: { maps: { DeepDesert_1: { Small:{primed:60,active:60}, Medium:{…}, Large:{…} }, Survival_1:{…}, Editor_Default:{…} }, primeRateSec }, coriolis: { warningsHours, stagesSec:[s1,s2,s3,s4,s5], sandstormPreventionSec, cycleDays, cycleStart } }` (§7; ключі `m_PerMapSystemSettings`, `m_PrimeRateInSeconds`, `m_CoriolisSpawnWarningsDurationInHours`, `m_CoriolisStage{1..5}Duration*`, `m_CoriolisSandstormSpawnPreventionSeconds`, `m_CycleDurationInDays`, початок циклу).
- [ ] **Step 1: Тести:** текст `item:AluminiumBar:uk` береться з `loc-uk.json` за namespace/ключем; `zh-Hans` читає теку `zh-CN`; невипущений предмет текстів не має; `normalizeConfig(фікстура).blob.spice.maps.DeepDesert_1.Large` = `{primed:1, active:1}`; `coriolis.stagesSec` = `[32400, 3540, 60, 60, 1740]`.
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS.

### Task 9: Пакет і оркестратор `gdx`

**Files:**
- Create: `dune/tools/game-extractor/lib/bundle.mjs`, `lib/state.mjs`, `bin/gdx.mjs`; Modify: `dune/package.json` (скрипт `"gdx": "node tools/game-extractor/bin/gdx.mjs"`)
- Test: `dune/tools/game-extractor/test/bundle.test.mjs`, `test/gdx.test.mjs`

**Interfaces:**
- Consumes: усе з Tasks 1–8; `normalizeSection`, `sectionHash` з `dune/server/lib/gamedata/hash.mjs`.
- `bundle.mjs`:
  - `MIN = { items: 1000, placeables: 500, recipes: 500, buildables: 300, texts: 14 * 1000 }` (випущених записів; `config` — є `spice` і `coriolis`).
  - `writeBundle({ work, build, version, manifestId, sections: Record<string, {records}|{blob}|Error>, extractor }): Promise<string>` — тека `<work>/bundles/<build>/`: `sections/<id>.json.gz` (gzip `JSON.stringify` даних як є, з невипущеним) + `manifest.json` `{ schema: 1, game: { build, version, manifestId, depot: '4754532' }, extractedAt, extractor: { version }, sections: { <id>: { file, schema: 1, hash: sectionHash(data), count: normalizeSection(data).count } | { error: '<причина>' } } }`. Розділ, що є `Error` (збій нормалізації) або нижче `MIN`, файлу не має, у маніфесті — `{ error }` (`'<n> < <мін>'` або текст помилки). Усі розділи з `error` → `Error('пакет не складено: …')`, тека не створюється. Запис — у `<build>.tmp`, потім `rename`; потім `<work>/bundles/latest.json` = `{ build, dir }` (через tmp+rename).
  - `prune(work, keep = 2)` — лишає `keep` найновіших збірок у `<work>/{depot,extract,raw,bundles}/<build>` (поточну з `latest.json` — завжди).
- `state.mjs`: `<work>/state.json` `{ lastCheck: { at, manifestId, serverTarSha }, builds: { <build>: { fetched, unpacked, usmap, exported, bundled } } }` — читання/запис через tmp+rename.
- `bin/gdx.mjs <крок> [--work DIR] [--force]`, кроки: `check` (друкує, чи змінився `serverTarSha` проти `state.lastCheck`), `fetch`, `unpack`, `usmap`, `export`, `normalize`, `bundle`, `all` (якщо `serverTarSha` той самий і пакет для збірки є, а `--force` нема → «без змін», код 0), `prune`, `compare --catalog <шлях catalog.json>` (покриття id: частка id каталогу сайту серед випущених записів пакета для items/placeables/recipes; список відсутніх ≤ 30).
  - Сирі експорти — `<work>/raw/<build>/{tables,loc}/…`, `stations.json`, `DefaultGame.ini` (копія з `extract/<build>/…/Config`).
  - Версія гри — `unpack().version` (Task 3).
  - Крок `normalize` ловить помилку кожного нормалізатора окремо й передає її в `writeBundle` як `Error` розділу.
- [ ] **Step 1: Тести:**
  - `writeBundle`, де `recipes` нижче `MIN`, а інші в нормі → пакет є, `manifest.sections.recipes = { error: '… < 500' }`, файлу `sections/recipes.json.gz` нема, `items` — з хешем
  - `writeBundle`, де всі розділи з помилкою → відхиляється, теки `<build>` і `latest.json` нема
  - два `writeBundle` поспіль з тими самими даними → однакові хеші в `manifest.json`
  - `latest.json` вказує на останній пакет; падіння посеред (підміна `fs.rename` на кидання) → `latest.json` старий
  - `prune(work, 2)` з 4 збірками → лишились 2 найновіші + поточна
  - `gdx all` з фейковими кроками (ін'єкція через `--dry` або експорт `main(argv, deps)`): `serverTarSha` той самий і пакет є → жоден крок `fetch/usmap/export` не викликано, вихід «без змін»; `check` кидає (Steam недоступний) → код ≠ 0, `state.json` і `latest.json` не змінені
- [ ] **Step 2:** FAIL. **Step 3:** реалізувати. **Step 4:** PASS; `npx vitest run tools/game-extractor/` — усе зелене; `npm test` — не зламано.

### Task 10: Повний прогін на Маці й інструкція

**Files:**
- Modify: `dune/tools/game-extractor/README.md` (як запустити на Маці, Linux-сервері, окремому сервері гри; вимоги: Docker, ~15 GB; що лежить у `GD_WORK`; право: файли гри не публікувати)

- [ ] **Step 1:** `npm run gdx -- all --work /Users/stepanenko/Sites/DuneAwakening/gamefiles` (у фоні; лог у `GD_WORK/logs/`) → пакет `bundles/2160922/` (або новіша збірка), `latest.json`.
- [ ] **Step 2:** `npm run gdx -- compare --catalog server/data/catalog/catalog.json` → покриття id: items ≥ 99 %, placeables = 100 %, recipes ≥ 98 % (очікування з `game-field-mapping.md` §6); відсутні — переглянути й записати в леджер як рішення або виправити нормалізатор.
- [ ] **Step 3:** Повторний `npm run gdx -- all` → «без змін» за ≤ 1 хв, без мережі до Steam, крім `check`.
- [ ] **Step 4:** Записати в спільні нотатки (`game-extractor-run.md`): збірка, manifestId, обсяги розділів, покриття, час кроків.

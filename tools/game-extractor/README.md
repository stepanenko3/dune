# Видобувач ігрових даних (game-extractor)

Бере дані сайту напряму з офіційних файлів сервера Dune: Awakening (Steam app 4754530, анонімно) і складає нормалізований
пакет розділів для реєстру джерел сайту (`server/lib/gamedata`). Задум — `docs/superpowers/specs/2026-10-21-game-data-drivers-design.md`.

**Файли гри, образи, usmap і сирі експорти не публікуються** і живуть лише в робочій теці `GD_WORK`
(за замовчуванням `/Users/stepanenko/Sites/DuneAwakening/gamefiles`), ніколи в `dune/`.

## Експортер (`export/`)

.NET 10 + CUE4Parse (вихідники, закріплений коміт — у `Dockerfile`). Образ — рідної архітектури.

```bash
docker build -t sandwalkers/gd-export:2 tools/game-extractor/export
```

```bash
docker run --rm -v <Paks>:/paks:ro -v <x.usmap>:/map.usmap:ro -v <out>:/out sandwalkers/gd-export:2 tables DuneSandbox/Content/Dune/Systems/Items/CDT_BaseItems
```

- `tables <пакет>…` → `out/tables/<ім'я>.json` (експорти пакета; у таблиць — `Rows`)
- `locres` → `out/loc/<мова сайту>.json` для 14 мов (`{ namespace: { key: text } }`; `zh-CN` → `zh-Hans`, `zh-TW` → `zh-Hant`)
- `stations <CDT_PlaceableData>` → `out/stations.json` (`{ пристрій: [типи виробництва] }`, з батьківських BP теж)

Таблиці Dune теговані, і без підказки типів ключів CUE4Parse мовчки віддає `null` замість мап із ключем-структурою
(інгредієнти, вихід рецептів, ціни будівництва) — експортер підказує їх явно й з usmap.

Інтеграційний тест (потрібні паки й usmap у `GD_WORK`): `GD_INT=1 npx vitest run tools/game-extractor/test/export.int.test.mjs`.

## Повний прогін (`npm run gdx`)

```bash
npm run gdx -- all --work /Users/stepanenko/Sites/DuneAwakening/gamefiles
```

Кроки (кожен кешується за збіркою, повтор на тій самій збірці — «без змін» за хвилину):

1. `check` — маніфест депо в Steam (0 байт файлів): id, дата, SHA `server.tar`.
2. `fetch` — DepotDownloader 3.4.0 (закріплений sha256) качає лише `images/battlegroup/server.tar` і `version.txt` (~4.5 GB) у `GD_WORK/depot`.
3. `unpack` — системний `tar`: із шарів образу лише `Content/Paks` і `Config` → `GD_WORK/extract/<збірка>`; збірка — з тегу, версія — з мітки `code_branch`.
4. `usmap` — `docker load` образу сервера, запуск бінарника без мережі й бази, «Game Engine Initialized» → `SIGSTOP`, сканер (`usmap/find_globals.py`) і `jmap_dumper` з патчем UClass для Dune (`usmap/`) у тому самому pid-просторі → `GD_WORK/mappings/DuneSandbox-<збірка>.usmap`.
5. `export` — образ експортера: таблиці, 14 `.locres`, станції → `GD_WORK/raw/<збірка>`.
6. `normalize` — `normalize/*.mjs`: `items`, `placeables`, `recipes`, `buildables`, `texts`, `config` (невипущене — `released:false`).
7. `bundle` — `GD_WORK/bundles/<збірка>/{manifest.json, sections/*.json.gz}` + `latest.json`; зламаний розділ — `{ error }` у маніфесті, решта йде.

Інше: `check` окремо (чи вийшов патч), `prune` (лишити 2 збірки), `compare --catalog server/data/catalog/catalog.json` (покриття id каталогу сайту).

## Де запускати

| Хост | Що потрібно | Примітки |
|---|---|---|
| Мак (arm64) | Docker Desktop (Rosetta для amd64), ~20 GB вільного місця | сервер і jmap — під емуляцією `linux/amd64`, експортер — рідний arm64 |
| Linux-сервер сайту (x86-64) | Docker, ~20 GB | усе рідне; DepotDownloader — `linux-x64` |
| Окремий сервер гри | те саме | пакет доставляється на сайт (push — план 3) |

Перше збирання образу jmap під емуляцією — ~35 хв, експортера — ~2 хв; далі образи беруться з кешу Docker.

## Право

EULA Dune: Awakening §7(g) обмежує datamining — рішення користувача. Публікуються лише похідні факти (назви, числа,
координати) з пакета; файли гри, образи, usmap і сирі експорти лишаються в `GD_WORK`. Картинок серверна збірка не має —
вони з запасного джерела.

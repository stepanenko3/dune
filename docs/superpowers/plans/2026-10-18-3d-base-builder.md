# 3D-будівельник баз — план робіт

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** база будується деталями гри просто в 3D (палітра зліва, примара, клік — поставити, ПКМ — прибрати, заміна, зріз), а план, кошторис, ліміти й рівні генеруються з деталей; main і dd перетворюються автоматично.

**Architecture:** документ бази `format: 2` — `pieces` (форма + прив'язка), `items`, `zones`. Рушій (`src/engine/*.js`, UMD без збирання) отримує бібліотеку форм `pieces.js` (геометрія, слід, сокети, ціна), перетворювач `convert.js` (стара модель → деталі) і гілки «format 2» у `hydrate.js`, `view3d.js`, `plan2d.js`, `build.js` з тим самим API для сторінки бази. Старі документи перетворюються при відкритті (`hydrate`), тож сторінка бази й будівельник працюють лише з деталями. Будівельник — `src/components/base/builder/`, стан, чернетка, «скасувати» й збереження — наявний `editor/store.ts`.

**Tech Stack:** React 18 + Vite + Tailwind + zustand; three.js r128 + OrbitControls (глобальні `window.THREE`); vitest; Express + SQLite.

**Spec:** `docs/superpowers/specs/2026-10-18-3d-base-builder-design.md`

## Global Constraints

- Сітка: квадрат 1×1 і рівносторонній трикутник зі стороною 1 (план x, y у плитках); висота — блоки: стіна 1, напівстіна 0,5.
- 3D: `v3(x, y, z) = (x, z * LH, -y)`, `LH = 0.85`; fps не обмежуємо, `setPixelRatio(min(dpr, 2))` (на телефоні не нижче ×1,5).
- Форми — усі різні з усіх наборів гри (132 id), без текстур; ціна — сардаукарська, інакше — з першого набору, де форма є.
- Кожна деталь — 1 будівельний елемент; двері — одна деталь (ціна з довідника); пентащит — клітинки 1×1 (вертикальні на краю, горизонтальні на плитці), поспіль — одна поверхня: матеріали раз, 2 елементи, енергія 3 за клітинку.
- Приміщення: зв'язна підлога на одній висоті, обмежена будь-якою деталлю на краю (і прохід); `Zone.tiles` — явні плитки + саморозширення в незайняту підлогу за порожніми краями.
- Інтерфейс і коментарі — українською; без комітів (користувач комітить сам).
- Телефон — лише перегляд.

## Review Focus

- Порожня база (нуль деталей) — будівельник відкривається, примара фундаменту на землі, план і кошторис порожні без помилок.
- Деталь на зрізі: примара й вибір не чіпляються за сховане вище зрізу.
- Правий клік по порожньому місцю чи по землі — нічого не прибирає й не відкриває меню браузера.
- Спільний край двох підлог на різних висотах — стіна стає на ту висоту, куди наведено (верх стіни нижче, а не підлога вище).
- Перетворена main: кількість зон = кількість приміщень зі старою назвою; кошторис різниться пояснено (двері, верхівки).

---

### Task 1: Бібліотека форм (`src/engine/pieces.js`)

**Files:** Create `src/engine/pieces.js`, `src/engine/pieces.test.ts`; Modify `src/lib/engine.ts` (тип `PIECES`), `index.html`/місце, де підключено рушій.

**Interfaces — Produces:**
- `PIECES.SHAPES: Record<string, Shape>`; `Shape = { id, name (укр.), cat: 'found'|'floor'|'wall'|'open'|'wedge'|'roof'|'incline'|'column'|'rail'|'shield', at: 'tile'|'edge'|'vertex', tile?: 's'|'t', len (плиток уздовж краю, 1–4), h (блоків), stone, mats?, kind (рядок етапу: fsq|ftri|csq|ctri|wall|door|window|wedge|slope|ramp|stairs|pillar|rail|shield) }`.
- `PIECES.tilePoly(kind, x, y, rot) → P[]`, `PIECES.edgeSeg(x, y, rot, len) → {a,b}`.
- `PIECES.footprint(p) → { at, poly?|seg?|pt?, z0, z1 }`; `PIECES.clash(a, b) → boolean` (та сама прив'язка й перетин по висоті).
- `PIECES.geom(p) → { faces: { mat: 'floor'|'wall'|'roof'|'frame'|'shield'|'trim', tris: number[] }[], lines: number[] }` у координатах плану (x, y, z).
- `PIECES.CATS` — порядок і назви категорій палітри.

- [ ] Тести: `footprint` квадрата `foundation` у (0.5,0.5,rot 0) — 4 кути (0,0)…(1,1), z 0–0.1… (фундамент — від −0,4 до 0); `wall` на краю (0.5,0, rot 0) — seg (0,0)-(1,0), z 0–1; `half_wall` z1−z0 = 0.5; `wall_3` — довжина 3; `clash(wall@z0, wall@z0.5)` true, `clash(wall@0, wall@1)` false; `geom(angled_roof)` має трикутники з z від 0 до 1; для кожної з 132 форм `geom` повертає ≥ 1 трикутник і `stone > 0`.
- [ ] Реалізація: родини геометрії — плита (тайл/заокруглена/подвійна), стіна (суцільна / з прорізом: вікно, двері, прохід, ворота), скісна стіна (прямокутний трикутник), скат (плита з висотами по вершинах; кути), сходи/пандус, колона, поручень, щит, люк, драбина. Таблиця розмірів — одна (`DIM`) угорі файлу.
- [ ] Ціни й `mats` — таблиця, вивантажена з `server/data/catalog/catalog.json` (сардаукарська, інакше перший набір).

### Task 2: Перетворювач (`src/engine/convert.js`)

**Files:** Create `src/engine/convert.js`, `src/engine/convert.test.ts`.

**Interfaces — Consumes:** `GEOM.edgePieces`, `GEOM.boundaryEdges`, `GEOM.roomEdges`, `PIECES.SHAPES`. **Produces:** `CONVERT.toPieces(doc) → { doc2, notes: string[] }` (`doc2.format === 2`; `notes` — відмінності для примітки версії).

- [ ] Тести на маленьких кімнатах: кімната 2×1 на 0 h 2 → 2 `foundation`, 6 країв × 2 блоки = 12 `wall`, 2 `floor` на +2 (дах), `zones[0].tiles.length === 2`; двері без висоти → `door` + `wall` над ним; `shield` блоки → `shield` клітинки; `open` між двома кімнатами → без деталі (край порожній), зони лишаються окремими (явні `tiles`); h 2,5 → верхній ряд `half_wall`; палуба h 0 → `floor` + `railing` по краях без `open`; `items` кімнати → `doc2.items` з `z`.
- [ ] Перевірка на `data/bases/main.json` і `dd.json`: зон стільки ж, скільки іменованих кімнат; немає двох деталей з `clash`.

### Task 3: Модель format 2 у рушії (`hydrate.js`) і сервер

**Files:** Modify `src/engine/hydrate.js`, `server/lib/bases.mjs`, `src/components/base/ctx.ts`, `src/components/base/BaseCalc.tsx`, `src/lib/bases.ts` (тип).

**Interfaces — Produces:** `BASEDATA.hydrate(doc)` — для старого документа спершу `CONVERT.toPieces`; `M.format = 2`, `M.pieces`, `M.items`, `M.zones` (з обчисленими `tiles`, `z0`, `h`), `M.rooms` — псевдокімнати із зон (id, name, short, group, z0, h, tiles, items) для списків сторінки, `M.roofItems` — станції поза зонами; `M.levels` — висоти підлог (`floorLevels`).
- [ ] `cleanBase`: приймає `format: 2` (`pieces` — масив, `shape` у `TOKEN_KEYS`, ліміт 80 000 деталей); старий формат — як був.
- [ ] Тест: `hydrate(main)` → `format 2`, рівні 0, +5, +9…, `rooms.length === zones.length`.

### Task 4: Кошторис і етапи з деталей (`build.js`)

**Files:** Modify `src/engine/build.js`, `src/components/base/BaseCalc.tsx` (рядок → `r.ref ?? ROW_BUILD[r.id]`).

**Interfaces — Produces:** для `M.format === 2` — той самий API: `compute() → { stages: [{id, name, note, n}], total }` (етапи — фундамент, далі за висотою підлоги: «Рівень +5»… з `ui.stages`), `cost(res) → { rows: [{id: shape, ref: shape, name, n, price, sum}], … }`, `budget(res)`, `equipment()`.
- [ ] Тест: дві стіни, двері, три клітинки щита поспіль → `wall` 2, двері 1, `penta` 1, `shield` 3; `budget.total` = кількість деталей + 2 за щит.

### Task 5: План з деталей (`plan2d.js`)

**Files:** Modify `src/engine/plan2d.js`.

**Interfaces — Produces:** `PLAN2D.make(M).render(opts)` для format 2: підлоги рівня (плитки плит на висоті рівня), зони кольором призначення й підписами, стіни/прорізи/щити на висоті рівня (лінії тих самих класів), скати й сходи — штрихуванням, станції, контекст інших поверхів (`.ctx` у редакторі), ділянки й сітка — як було.
- [ ] Перевірка в браузері: main і dd — рівні 0/+5/+9 читаються як раніше.

### Task 6: 3D з деталей і API для будівельника (`view3d.js`)

**Files:** Modify `src/engine/view3d.js`, `src/lib/engine.ts`.

**Interfaces — Produces:** для format 2 — геометрія з `PIECES.geom`, шари (плити за висотою ховаються зрізом цілком), станції з `M.items`, підписи — із зон. Нове в API: `update(M)` (перебудувати будову без нової сцени), `pick(clientX, clientY) → { piece: id|null, item: index|null, point: {x,y,z}, normal: {x,y,z}, ground: boolean } | null` (враховує зріз), `setGhost(pieces: Piece[], ok: boolean)`, `setHover(id|null)`, `setSelected(ids)`.
- [ ] Перевірка: main і dd у 3D — «на око» як раніше; `pick` по стіні повертає її id.

### Task 7: Прив'язка (сокети) — `builder/snap.ts`

**Files:** Create `src/components/base/builder/snap.ts`, `snap.test.ts`.

**Interfaces — Produces:** `snap(shape: string, hit: Hit, M, rot: number) → { piece: Piece, ok: boolean, why?: string } | null`; `Hit` — з `pick`.
- [ ] Тести: фундамент біля краю наявного фундаменту → сусідня плитка, z 0; стіна, наведена на верх фундаменту біля краю → край, z = верх плити; стіна, наведена на стіну → та сама прив'язка, z = верх стіни; перекриття над стінами → плитка, z = верх стін; червона примара, коли `clash`; без опори (стіна в повітрі) — `why: 'нема опори'`.

### Task 8: Будівельник — екран (варіант A)

**Files:** Create `src/components/base/builder/Builder.tsx`, `Palette.tsx`, `PieceCard.tsx`, `Slice.tsx`, `MiniPlan.tsx`, `View.tsx`; Modify `src/pages/BasePage.tsx` (маршрут `/bases/<id>/edit` → `Builder`), `editor/store.ts` (`tool: 'build'|'select'|'zones'|'items'`, `shape`, `rot`, `slice`, `sel: { kind: 'piece', ids } | { kind: 'zone', id } | { kind: 'item', i }`).
- [ ] Палітра зліва: категорії `PIECES.CATS`, іконки вікі з довідника, пошук, клавіші 1–9; Esc — без деталі.
- [ ] 3D: примара за курсором (`snap`), клік — поставити, тягни — ряд (стіни вздовж краю, плити рамкою), ПКМ — прибрати (без контекстного меню), R / колесо — поворот, F — дзеркально, Del, Ctrl+Z.
- [ ] Без деталі — клік вибирає: картка «Замінити на…» (форми з тим самим `at` і `len`), поворот, дзеркально, прибрати; Shift — кілька.
- [ ] Зріз: повзунок справа (крок 0,5), рівні — кнопками поруч; план у кутку (поточний зріз), клік — камера туди.
- [ ] Збереження, чернетка, конфлікт — як у старому редакторі; перше збереження старої бази — примітка з `notes` перетворювача.

### Task 9: Приміщення й станції

**Files:** Create `builder/ZoneCard.tsx`, `builder/ItemCard.tsx`; Modify `Palette.tsx`, `Builder.tsx`, `pieces.js` (`zonesOf`).
- [ ] Режим «Приміщення»: клік по підлозі — зона (нова: заповнення до стін; наявна — картка: назва, коротка, призначення, нотатка, «Прибрати»); зони підсвічені кольором призначення.
- [ ] Станції — з палітри (як `PresetPicker`), примара на підлозі під курсором, «за стіну не стане» червоним, налазить — жовтим; картка станції як була.
- [ ] Тест `zonesOf`: дві кімнати через прохід — дві зони; нова підлога поруч у тому самому замкненому просторі — додається до зони.

### Task 10: Прибрати старий редактор, перевірка, пам'ять

**Files:** Delete `src/components/base/editor/{PlanEdit,PropsCard,Levels,BlockPicker,Live3D}.tsx`, `walls.ts`, `rooms.ts` (що не потрібно); Modify `BaseEditor.tsx` → лишити лише спільне (збереження) чи злити в `Builder.tsx`.
- [ ] `npx tsc --noEmit -p .`, `npx vitest run` — чисто.
- [ ] Браузер: main, dd, нова порожня база — будування, заміна, зріз, приміщення, станції, збереження не натискати; сторінка бази — план, 3D, кошторис.
- [ ] Пам'ять `bases-as-data-editor.md` — новий будівельник.

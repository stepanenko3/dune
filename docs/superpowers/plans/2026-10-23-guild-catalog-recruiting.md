# Каталог гільдій і набір — план реалізації

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** каталог гільдій з фільтрами, публічна сторінка з блоками за видимістю, анкети вступу з чергою офіцерів і сповіщеннями.

**Architecture:** картка гільдії — JSON `guilds.profile` (`server/lib/guild-profile.mjs`); заявки — розширена таблиця
`requests` + `request_comments`; події набору — шина `server/lib/guild-bus.mjs`, на неї підписані сповіщення
(`notify()` біржі). Клієнт — `src/pages/Guilds.tsx` (каталог і сторінка) + нові файли `src/pages/guild/*`,
`src/lib/weekly.ts`, `src/lib/guildProfile.ts`.

**Tech Stack:** Express, Postgres/SQLite (`server/lib/sql.mjs`), sharp, React 18, zustand, @snotax/ui, vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-guild-catalog-recruiting-design.md`

## Global Constraints

- Міграції лише додають (`addColumn`, `CREATE TABLE IF NOT EXISTS`), ідемпотентні; жодних DROP.
- Тексти — `t()` з українським ключем; переклади в `locales/parts/guilds25.<lang>.json` для 13 мов; `i18n:merge` без `--clean`.
- Без англійської в неанглійському інтерфейсі; назви мов і поясів — з `Intl` мовою сайту.
- Каталог без випадних списків: фільтри — чипи, що переносяться; вкладки й фільтри — в адресі.
- Телефон: одна прокрутка, `grid-cols-[minmax(0,1fr)]`, без `truncate` на телефоні, поля вводу `size="lg"` (≥16px).
- Права гільдії лише через `guildCan()`; речі — через `can()` реєстру `items`.

## Review Focus

1. Чужий не бачить схованого блоку ні в `/api/guilds/:slug`, ні в `/api/guilds`, ні в OG — тест на кожне.
2. Анкета змінилась після подачі заявки — черга показує відповіді за поточною анкетою, невідомі id пропускає.
3. Розклад через північ (22:00–02:00) і між поясами з різними днями — тест `weekly.ts`.
4. Давні рядки `requests` без статусу — `pending`; давні клієнти, що шлють лише `note`, працюють.
5. Кандидат вступив деінде, поки заявка чекала: прийняти — 409 і заявка `closed`.

---

### Task 1: картка гільдії на сервері

**Files:** Create `server/lib/guild-profile.mjs`; Modify `server/lib/guilds.mjs`; Test `server/guild-recruit.test.mjs`

**Produces:** `cleanProfile(p, prev)`, `readProfile(raw)`, `profileFor(p, {member, officer})`, `cardProfile(p)`,
`cleanAnswers(form, answers)`, `cleanSlots(v)`, `REGIONS`, `STYLES`, `LANGS`, `BLOCKS`; у `guilds`:
`profile(gid)`, `setProfile(gid, patch)`, `guildCan(ctx, g)` → `{ member, review, profile, identity, remove }`,
`list()` рядки з `profile` (сирим, обрізає маршрут).

- [ ] Тести бібліотеки: очищення (невідомі ключі геть, хибні посилання → 400, пояс невідомий → null), `profileFor` ховає
  блоки `guild` від чужих, `cleanAnswers` (обов'язкові, рівень 1–200, вибір лише з варіантів).
- [ ] `guilds.profile TEXT` (addColumn), `profile/setProfile`, `guildCan`.

### Task 2: заявки й коментарі

**Files:** Modify `server/lib/guilds.mjs`, `server/routes/guilds.mjs`, `server/app.mjs` (прибирання), `server/routes/auth.mjs`

**Produces:** `requests` + `status, answers, tz, reason, decided, decided_by`; `request(gid, uid, {note, answers, tz})`,
`decide(gid, uid, {accept, reason, by})`, `comment(gid, uid, by, text)`, `comments(gid)`, `myRequests(uid)`;
`requestsOfUser(uid)` — лише чекаючі; `_addMember` закриває заявки (ця гільдія `accepted`, інші `closed`).
Маршрути: `POST/DELETE /api/guilds/:slug/requests`, `POST …/requests/:uid` `{accept, reason}`, `POST …/requests/:uid/comments`.

- [ ] Тести HTTP: подача з анкетою, відхилення без причини → 400, з причиною → кандидат бачить `rejected` і причину,
  повторна подача → `pending`, прийняття → recruit, коментарі бачать лише офіцери, запрошення закриває заявку.

### Task 3: шина, сповіщення, герб, OG

**Files:** Create `server/lib/guild-bus.mjs`, `server/lib/notifications.mjs` + `server/routes/notifications.mjs` (копія біржі);
Modify `server/routes/guilds.mjs` (герб), `server/lib/og.mjs`, `server/app.mjs`

**Produces:** `createGuildBus()` → `{ on(fn), emit(ev) }`, ев. `{ type, guild, user, by, reason }`; види сповіщень
`guild.app.new` (офіцерам, `ref` = гільдія), `guild.app.sent|accepted|rejected` (кандидатові).
`POST/DELETE /api/guilds/:slug/emblem` (офіцер, sharp 512 WebP → `uploads/<sha>.webp`).

- [ ] Тести: подача → сповіщення офіцерам (згортання), рішення → кандидатові; OG без схованих блоків, з гербом.

### Task 4: клієнт — розклад і профіль

**Files:** Create `src/lib/weekly.ts` (+ `weekly.test.ts`), `src/lib/guildProfile.ts`

**Produces:** `toViewer(slots, fromTz, toTz, now?) → { day: 0..6, from: min, to: min }[]` (лише в межах доби, через
північ — на наступний день), `slotsLabel(…)`, `tzLabel(tz)`, `langLabel(code)`, типи `GuildProfile`, `Question`, `Application`.

### Task 5: клієнт — каталог

**Files:** Modify `src/pages/Guilds.tsx`; Create `src/pages/guild/Filters.tsx`, `src/pages/guild/bits.tsx`

- [ ] Фільтри-чипи в адресі (`region`, `tz`, `lang`, `style`, `size`, `server`), «Мої заявки», картка з гербом і розкладом.

### Task 6: клієнт — сторінка гільдії, заявка, черга, налаштування

**Files:** Create `src/pages/guild/Home.tsx`, `Apply.tsx`, `Queue.tsx`, `Settings.tsx`, `FormEditor.tsx`, `Schedule.tsx`;
Modify `src/pages/Guilds.tsx`, `src/store.ts` (`GUILD_TABS += 'apply'`), `src/lib/notify-guild.ts`

### Task 7: переклади, перевірка в браузері, PR

- [ ] `npm run i18n:extract` → 0 відсутніх; частини `guilds25.*`; браузер з трьома обліковими записами на копії БД
  (десктоп, 390, 320); `npx vitest run`; `npx tsc --noEmit`; PR у `claude/sandwalkers-react-app`.

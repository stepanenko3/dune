/*
 * Бібліотека компонентів @snotax/ui (Lit, sn-*) — у vendor/snotax-ui: зібраний dist із робочої копії Snotax
 * (SNOTAX_UI=<шлях до packages/ui>, за замовчуванням ~/Sites/Snotax/frontend/packages/ui). У dist немає залежностей,
 * крім lit, тож сайт ставить його як звичайний пакет («file:vendor/snotax-ui»), без монорепозиторію Snotax.
 * Оновити: зібрати ui у Snotax (pnpm --filter @snotax/ui build), тоді `npm run ui:sync && npm install`. Набір іконок і утиліт
 * урізано під сайт — після нового імпорту елемента бібліотеки синхронізуй ще раз (підкаже тест snotax-ui-trim).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MANIFEST, trimDist } from './snotax-ui-trim.mjs'

const src = process.env.SNOTAX_UI || path.join(os.homedir(), 'Sites/Snotax/frontend/packages/ui')
const dst = path.resolve(import.meta.dirname, '../vendor/snotax-ui')
const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'))
if (!fs.existsSync(path.join(src, 'dist/index.js'))) throw new Error(`немає ${src}/dist — спершу збери @snotax/ui`)

fs.rmSync(path.join(dst, 'dist'), { recursive: true, force: true })
fs.mkdirSync(dst, { recursive: true })
// testing/ і ssr — лише для тестів і серверного рендеру Snotax
fs.cpSync(path.join(src, 'dist'), path.join(dst, 'dist'), { recursive: true, filter: (f) => !/[/\\]testing([/\\]|$)|\.map$/.test(f) })
// Tailwind v4 у тіньовому DOM спирається на @property (--tw-border-style тощо), а їх браузер бере лише з документа —
// без них у компонентах зникають рамки. Повний ui.css тягне ще й скидання стилів і утиліти, що б'ються з нашими, тож
// виносимо лише реєстрації властивостей у properties.css (його підключає main.tsx)
{
  const css = fs.readFileSync(path.join(dst, 'dist/ui.css'), 'utf8')
  const props = css.match(/@property\s+--[\w-]+\s*\{[^}]*\}/g) || []
  fs.writeFileSync(path.join(dst, 'dist/properties.css'), `/* @property з @snotax/ui (ui.css) — для компонентів у тіньовому DOM */\n${props.join('\n')}\n`)
}
// Набір іконок (~1300 × 6 стилів, 4 МБ) і всі утиліти Tailwind для тіньового DOM (140 КБ) ідуть у спільний шматок
// бібліотеки на кожній сторінці. Урізаємо їх під елементи, які імпортує сайт, і під його класи (scripts/snotax-ui-trim.mjs);
// що вирізано — у trim.json (за ним стежить тест). Тож після нового імпорту @snotax/ui/elements/* — знову `npm run ui:sync`.
{
  const r = trimDist(path.join(dst, 'dist'))
  fs.writeFileSync(MANIFEST, JSON.stringify(r, null, 1) + '\n')
  console.log(`[ui] іконки: ${r.icons.of} → ${r.icons.kept} (${r.icons.styles.join(', ')}); утиліти: ${r.utilities.of} → ${r.utilities.kept} класів, ${Math.round(r.utilities.bytes[0] / 1024)} → ${Math.round(r.utilities.bytes[1] / 1024)} КБ`)
}
fs.writeFileSync(path.join(dst, 'package.json'), JSON.stringify({
  name: '@snotax/ui',
  version: pkg.version === '0.0.0' ? '0.0.0-vendored' : pkg.version,
  description: 'Vendored build of @snotax/ui (Lit web components). Synced by scripts/sync-snotax-ui.mjs — do not edit.',
  type: 'module',
  exports: {
    '.': { types: './dist/index.d.ts', import: './dist/index.js' },
    './elements': { types: './dist/elements.d.ts', import: './dist/elements.js' },
    './elements/*': { types: './dist/elements/*.d.ts', import: './dist/elements/*.js' },
    './style.css': './dist/ui.css',
    './properties.css': './dist/properties.css',
  },
  sideEffects: ['*.css', './dist/elements.js', './dist/elements/*.js'],
  dependencies: { lit: pkg.dependencies.lit },
}, null, 2) + '\n')
fs.writeFileSync(path.join(dst, 'SOURCE.txt'), `Зібрано з ${src} — ${new Date().toISOString()}\n`)
console.log(`[ui] @snotax/ui → ${path.relative(process.cwd(), dst)}`)

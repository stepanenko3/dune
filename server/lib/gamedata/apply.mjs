/*
 * Застосування даних файлів гри в таблиці сайту (реєстр викликає, коли розділ, де основне — файли гри, змінився).
 * Пишемо через createGameData: закріплене вручну не чіпається, порожнє в полях KEEP не затирає відоме (опис, іконка
 * з запасного джерела), чого в повних даних нема — позначається прибраним. Невипущене в грі теж пишеться — з позначкою
 * unreleased (сайт його не показує, адмін може відкрити, і це переживає оновлення). Id — ігрові, без відповідностей.
 */
import { createHash } from 'node:crypto'
import { FROM } from '../gamedata.mjs'

/** записи розділу → таблиця виду: усі (і невипущені), потім позначки випущеного */
async function applyKind(game, kind, records, toRow) {
  await game.upsert(kind, records.map(toRow), { sweep: true })
  await game.markReleased(kind, {
    released: records.filter((r) => r.released !== false).map((r) => r.id),
    unreleased: records.filter((r) => r.released === false).map((r) => r.id),
  })
}

/**
 * Картинка модуля: у серверних файлах гри пікселів нема, а файли awakening.wiki названі так само, як текстури гри
 * (T_UI_…_D.png). Шлях MediaWiki — за md5 імені файлу: wiki/<h[0]>/<h[0..1]>/<файл>. Правило, не таблиця.
 */
export function wikiFile(texture) {
  const base = texture ? String(texture).split('/').pop() : ''
  if (!base) return null
  const name = base + '.png'
  const h = createHash('md5').update(name).digest('hex')
  return `https://media.awakening.wiki/wiki/${h[0]}/${h.slice(0, 2)}/${encodeURIComponent(name)}`
}

/** переклади (kind:id:мова) — у game_texts з джерелом game: перезаписують gaming.tools і TH.GL, але не закріплене */
async function applyTexts(game, records) {
  const byLang = new Map()
  for (const r of records) {
    const parts = String(r.id).split(':')
    const lang = parts.at(-1)
    if (!byLang.has(lang)) byLang.set(lang, [])
    byLang.get(lang).push({ kind: parts[0], id: parts.slice(1, -1).join(':'), name: r.name, description: r.description })
  }
  for (const [lang, rows] of byLang) await game.putTexts(lang, rows, 'game')
}

/** розділи, які дані файлів гри застосовують у таблиці сайту */
export const APPLIED = ['texts', 'buildables', 'items', 'placeables', 'recipes', 'skills', 'spice', 'markers', 'markerTypes', 'resources', 'ddLayouts']

export function createAppliers({ game, spice, gamemap }) {
  return {
    texts: (data) => applyTexts(game, data.records),
    buildables: (data) => applyKind(game, 'buildable', data.records, (r) => ({ ...FROM.buildable(r), img: wikiFile(r.img) })),
    // опису в даних гри нема (він у перекладах) — null, щоб не затерти відоме
    items: (data) => applyKind(game, 'item', data.records, (r) => ({ ...FROM.item(r), description: null })),
    placeables: (data) => applyKind(game, 'placeable', data.records, (r) => ({ ...FROM.placeable(r), description: null })),
    recipes: (data) => applyKind(game, 'recipe', data.records, FROM.recipe),
    // опису кількох атрибутів у серверних файлах нема — null (KEEP лишає відомий), не порожній рядок
    skills: (data) => applyKind(game, 'skill', data.records, (r) => ({ ...FROM.skill(r), description: r.desc || null })),
    // відомі місця великих полів меланжу Глибокої пустелі
    spice: (data) => spice.setKnown(data.records),
    // мапа з файлів гри (застосовується, лише коли основне групи «Мапа» — файли гри)
    // місця й ресурси — одна таблиця точок (lib/gamemap.mjs), кожен розділ замінює свою частину
    markers: (data) => gamemap.setPoints(data.records, 'markers'),
    resources: (data) => gamemap.setPoints(data.records, 'resources'),
    markerTypes: (data) => gamemap.setTypes(data.records),
    ddLayouts: (data) => gamemap.setSchedule(data.blob),
  }
}

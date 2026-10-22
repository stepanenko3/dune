/*
 * Довідник гри для сайту: предмети, пристрої, рецепти й будівельні модулі — у базі (gamedata.mjs), їх пише реєстр
 * джерел з файлів гри (server/lib/gamedata). Сторонніх зборів нема. Іконки й характеристики на картці предмета —
 * routes/catalog.mjs (виняток: пікселів і частини характеристик у серверних файлах гри нема).
 */
import path from 'node:path'

export function createCatalog({ dataDir, game }) {
  return {
    /** довідник мовою; null — даних гри ще нема */
    get: (lang) => game.catalog(lang),
    syncing: false,
    failed: false,
    dir: path.join(dataDir, 'catalog'),
  }
}

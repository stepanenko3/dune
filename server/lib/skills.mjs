/*
 * Уміння для планувальника: дерева шкіл у базі (gamedata.mjs), їх пише реєстр джерел з файлів гри (server/lib/gamedata).
 * Сторонніх зборів нема.
 */
export function createSkills({ game }) {
  return {
    /** уміння мовою; null — даних гри ще нема */
    get: (lang) => game.skills(lang),
    syncing: false,
    failed: false,
  }
}

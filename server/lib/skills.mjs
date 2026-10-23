/*
 * Уміння для планувальника: дерева шкіл у базі (gamedata.mjs), їх пише реєстр джерел з файлів гри (server/lib/gamedata).
 * Сторонніх зборів нема. Іконки — шлях текстури гри; сайт бере їх через наш /catalog-icons/… з медіатеки
 * (lib/media.mjs), фонова задача медіатеки завантажує їх заздалегідь.
 */
import { iconSource } from './media.mjs'

export function createSkills({ game, media = null }) {
  const skills = {
    /** уміння мовою; null — даних гри ще нема */
    get: (lang) => game.skills(lang),
    /** іконки вмінь для медіатеки: [{ src }] */
    async images() {
      const d = await game.skills('en')
      return [...new Set((d?.skills ?? []).map((s) => s.icon).filter(Boolean))].map((icon) => iconSource(icon, { color: false })).filter(Boolean)
    },
    syncing: false,
    failed: false,
  }
  media?.collect(skills.images)
  return skills
}

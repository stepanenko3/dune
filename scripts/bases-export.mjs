// Бази з коду (src/engine/model.js, model-dd.js) — у JSON-документи data/bases/<id>.json. З них сервер
// заповнює порожню таблицю баз, далі бази живуть на сервері й правляться в редакторі. Модель — це вже дані:
// приміщення з плитками (точки), прорізи, пристрої, рівні; функції-помічники (V, boundaryEdges…) не зберігаємо,
// їх підставляє hydrate() при завантаженні.
// Запуск: npm run bases:export
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const out = path.join(root, 'data', 'bases')
fs.mkdirSync(out, { recursive: true })

/** лише дані: без функцій; спільні об'єкти (уступи даху — ті самі плитки) копіюються */
const data = (M) => JSON.parse(JSON.stringify(M, (k, v) => (typeof v === 'function' ? undefined : v)))

for (const [id, file] of [['main', 'model.js'], ['dd', 'model-dd.js']]) {
  const M = require(path.join(root, 'src', 'engine', file))
  const doc = { schema: 1, ...data(M) }
  fs.writeFileSync(path.join(out, `${id}.json`), JSON.stringify(doc))
  console.log(`${id}: ${doc.rooms.length} приміщень, ${Math.round(JSON.stringify(doc).length / 1024)} КБ`)
}
// палітра станцій (builder/presets.json) — пристрої гри, ведеться вручну, з моделей не береться

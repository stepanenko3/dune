// Наперед завантажує в кеш сервера (server/data/map) усе для роботи мапи без мережі:
// словники, іконки, точки всіх мап і всіх розкладок Deep Desert, тайли поточних мап.
// Запуск: npm run map:prefetch            — тайли Хагга, міст, підземель і поточного тижня DD
//         npm run map:prefetch -- --weeks — ще й тайли всіх 12 розкладок Deep Desert (багато)
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMapData } from '../server/lib/thgl.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const md = createMapData({ dataDir: process.env.DATA_DIR || path.join(root, 'server', 'data') })
const allWeeks = process.argv.includes('--weeks')
await md.refresh(true)
await md.icons()
await md.labels()

const jobs = []
for (const m of md.source.maps) {
  if (m.layouts.length) {
    for (const l of m.layouts) {
      await md.points(m.id, l.id)
      if (allWeeks || l.id === m.layout) jobs.push([l.tiles, m.maxNativeZoom])
    }
  } else {
    await md.points(m.id)
    jobs.push([m.tiles, m.maxNativeZoom])
  }
  console.log('точки:', m.id)
}

let n = 0, miss = 0
for (const [dir, maxZ] of jobs) {
  const queue = []
  for (let z = 0; z <= maxZ; z++) for (let y = 0; y < 2 ** z; y++) for (let x = 0; x < 2 ** z; x++) queue.push([z, y, x])
  // по 8 запитів паралельно — CDN не любить зливу
  for (let i = 0; i < queue.length; i += 8) {
    const got = await Promise.all(queue.slice(i, i + 8).map(([z, y, x]) => md.tile(dir, z, y, x)))
    n += got.filter(Boolean).length
    miss += got.filter((g) => !g).length
  }
  console.log('тайли:', dir, `(${n} є, ${miss} порожніх)`)
}
console.log('ok — кеш у', path.relative(process.cwd(), md.dir))

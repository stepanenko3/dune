// Оновлює знімок опису мап із TH.GL: server/map/source.json (мапи, тайли, групи і типи точок,
// розкладки Deep Desert з позначкою поточної). Сервер і сам перевіряє свіжий раз на 6 годин,
// а знімок у репозиторії — це те, з чого він стартує без мережі.
// Запуск: npm run map:sync
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchSource } from '../server/lib/thgl.mjs'

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'map', 'source.json')
const s = await fetchSource()
fs.writeFileSync(out, JSON.stringify(s, null, 1) + '\n')
const dd = s.maps.find((m) => m.id === 'deepdesert_1')
console.log(`ok -> ${path.relative(process.cwd(), out)}: мап ${s.maps.length}, груп ${s.groups.length}, типів ${s.groups.reduce((n, g) => n + g.types.length, 0)}; Deep Desert — розкладка ${dd?.layout} з ${dd?.layouts.length}`)

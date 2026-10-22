/**
 * Значки для «Додати на головний екран» (manifest, iPhone): PNG із того самого малюнка, що й favicon.svg.
 * Запуск: node scripts/make-icons.mjs — пише public/icons/*.png.
 */
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

const BG = '#1c1a18'
const SPICE = '#ec913e'
// малюнок на повне поле (без закруглень — телефон закруглює сам); pad — відступ, щоб «безпечна зона» маски не різала
const svg = (pad) => {
  const s = 32 - pad * 2
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${BG}"/>
<g transform="translate(${pad} ${pad}) scale(${s / 32})"><path d="M5 21c4-6 8-6 11-2s7 4 11-2" fill="none" stroke="${SPICE}" stroke-width="3" stroke-linecap="round"/><circle cx="22" cy="10" r="3" fill="${SPICE}"/></g></svg>`)
}

mkdirSync('public/icons', { recursive: true })
const out = [
  ['icon-192.png', 192, 2],
  ['icon-512.png', 512, 2],
  ['maskable-512.png', 512, 6],
  ['apple-touch-icon.png', 180, 3],
]
for (const [name, size, pad] of out) {
  await sharp(svg(pad), { density: 1200 }).resize(size, size).png().toFile(`public/icons/${name}`)
  console.log(name)
}

/**
 * QR-код без бібліотек (для налаштування застосунку-автентифікатора): байтовий режим, рівень корекції M, версії
 * 1–40, вибір маски за спрощеною оцінкою (правила 1, 2 і 4 стандарту). Алгоритм — як у qrcodegen (Nayuki).
 * qrPath(text) → { size, d }: SVG-шлях темних модулів із полем 4 модулі довкола.
 */

const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
const BLOCKS_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]

function rawModules(v: number) {
  let r = (16 * v + 128) * v + 64
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36 }
  return r
}
const dataCodewords = (v: number) => Math.floor(rawModules(v) / 8) - ECC_M[v] * BLOCKS_M[v]

function mul(x: number, y: number) {
  let z = 0
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x }
  return z
}
function divisor(deg: number) {
  const r = new Array(deg).fill(0)
  r[deg - 1] = 1
  let root = 1
  for (let i = 0; i < deg; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = mul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1] }
    root = mul(root, 2)
  }
  return r
}
function remainder(data: number[], div: number[]) {
  const r = div.map(() => 0)
  for (const b of data) {
    const f = b ^ (r.shift() as number)
    r.push(0)
    div.forEach((c, i) => { r[i] ^= mul(c, f) })
  }
  return r
}

function encode(bytes: Uint8Array) {
  let v = 1
  for (; v <= 40; v++) if (4 + (v <= 9 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8) break
  if (v > 40) throw new Error('QR: забагато даних')
  const bits: number[] = []
  const put = (val: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(4, 4)
  put(bytes.length, v <= 9 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const cap = dataCodewords(v) * 8
  put(0, Math.min(4, cap - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2))

  // блоки з корекцією і переплетення
  const nb = BLOCKS_M[v], eccLen = ECC_M[v], raw = Math.floor(rawModules(v) / 8)
  const nShort = nb - (raw % nb), shortLen = Math.floor(raw / nb)
  const div = divisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1))
    k += dat.length
    const ecc = remainder(dat, div)
    if (i < nShort) dat.push(0)
    blocks.push(dat.concat(ecc))
  }
  const out: number[] = []
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= nShort) out.push(b[i]) })
  return { v, codewords: out }
}

export function qrMatrix(text: string): boolean[][] {
  const { v, codewords } = encode(new TextEncoder().encode(text))
  const size = v * 4 + 17
  const m: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => { m[y][x] = dark; fn[y][x] = true }

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
    }
  }
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
  if (v > 1) {
    const n = Math.floor(v / 7) + 2
    const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2
    const pos = [6]
    for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p)
    pos.forEach((a, i) => pos.forEach((b, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }))
  }
  const format = (mask: number) => {
    const data = (0 << 3) | mask // рівень M — 00
    let r = data
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537)
    const bits = ((data << 10) | r) ^ 0x5412
    const bit = (i: number) => ((bits >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) set(8, i, bit(i))
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
    set(8, size - 8, true)
  }
  format(0)
  if (v >= 7) {
    let r = v
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25)
    const bits = (v << 12) | r
    for (let i = 0; i < 18; i++) {
      const b = ((bits >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3)
      set(a, c, b); set(c, a, b)
    }
  }
  // дані змійкою знизу вгору парами стовпців
  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert
      if (!fn[y][x] && i < codewords.length * 8) { m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++ }
    }
  }
  const masked = (mask: number) => m.map((row, y) => row.map((d, x) => {
    if (fn[y][x]) return d
    const inv = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask]
    return inv ? !d : d
  }))
  const penalty = (g: boolean[][]) => {
    let p = 0, dark = 0
    for (let a = 0; a < size; a++) {
      let rx = 1, ry = 1
      for (let b = 1; b < size; b++) {
        if (g[a][b] === g[a][b - 1]) { if (++rx === 5) p += 3; else if (rx > 5) p++ } else rx = 1
        if (g[b][a] === g[b - 1][a]) { if (++ry === 5) p += 3; else if (ry > 5) p++ } else ry = 1
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) p += 3
    for (const row of g) for (const d of row) if (d) dark++
    return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10
  }
  let best: boolean[][] = m, bestP = Infinity
  for (let mask = 0; mask < 8; mask++) {
    format(mask)
    const g = masked(mask)
    const p = penalty(g)
    if (p < bestP) { bestP = p; best = g }
  }
  return best
}

/** SVG-шлях: квадрат 1×1 на кожен темний модуль; size — з полем 4 модулі з кожного боку */
export function qrPath(text: string) {
  const g = qrMatrix(text)
  let d = ''
  g.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z` }))
  return { size: g.length + 8, d }
}

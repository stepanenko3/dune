// Атрейдесівський орнітоптер для головної: «Atreides ornithopter Dune» від jorafe (Sketchfab),
// CC BY 4.0 — https://sketchfab.com/3d-models/atreides-ornithopter-dune-cf7ff8d98ed34258a041d5873291a3f2
// Зі скачаного glTF (107 МБ: текстури PNG 4K) робимо легкий GLB: текстури — WebP до 1024 px,
// геометрія й анімації — meshopt, усі 21 анімацію моделі зберігаємо.
// Запуск: npm run orni:atreides -- "<тека з розпакованим scene.gltf>"
import fs from 'node:fs'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, prune, resample, textureCompress, quantize, reorder, weld } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'
import { mirrorWings } from './orni-mirror.mjs'

const src = process.argv[2]
if (!src) throw new Error('вкажи теку зі scene.gltf')
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'models', 'orni-atreides.glb')

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(path.join(src, 'scene.gltf'))
// праві крила в анімаціях моделі криві — робимо їх дзеркалом лівих (див. orni-mirror.mjs)
mirrorWings(doc)

await doc.transform(
  dedup(),
  prune({ keepLeaves: true }),
  weld(),
  resample(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
  reorder({ encoder: MeshoptEncoder }),
  // позиції й ваги скіна не квантуємо: деквантування позицій ховається в матрицях скіна, а байтові
  // ваги three при розрахунку меж читає як 0…255 — і рамка моделі виходить хибною
  quantize({ pattern: /^(NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+)$/ }),
)
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })

fs.mkdirSync(path.dirname(out), { recursive: true })
await io.write(out, doc)
const anims = doc.getRoot().listAnimations().map((a) => a.getName())
console.log('ok ->', out, Math.round(fs.statSync(out).size / 1024), 'КБ; анімацій', anims.length)
console.log(anims.join('\n'))

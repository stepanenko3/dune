// Дрон для головної (друга модель поруч з орні): «Buster Drone» від LaVADraGoN (Sketchfab), CC BY 4.0 —
// https://sketchfab.com/3d-models/buster-drone-294e79652f494130ad2ab00a13fdbafd
// Зі скачаного glTF (75 МБ: текстури PNG 4K) робимо легкий GLB: прибираємо підлогу й небо сцени Sketchfab
// (Env), текстури — WebP до 1024 px, геометрія й анімація — meshopt. Корпус у файлі позначено прозорим, але його
// альфа скрізь повна — робимо непрозорим (інакше three сортує його як скло і деталі мерехтять).
// Запуск: npm run drone:buster -- "<тека з розпакованим scene.gltf>"
import fs from 'node:fs'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, prune, resample, textureCompress, quantize, reorder, weld } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

const src = process.argv[2]
if (!src) throw new Error('вкажи теку зі scene.gltf')
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'models', 'buster-drone.glb')

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(path.join(src, 'scene.gltf'))

// підлога (Scheibe) і небо (Himmel) — оточення сцени Sketchfab, у нас свій пісок
for (const node of doc.getRoot().listNodes()) if (node.getName() === 'Env') node.traverse((n) => n.dispose())
for (const mat of doc.getRoot().listMaterials()) if (mat.getName() === 'body') mat.setAlphaMode('OPAQUE')

await doc.transform(
  prune({ keepLeaves: false }),
  dedup(),
  weld(),
  resample(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ pattern: /^(NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+)$/ }),
)
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })

fs.mkdirSync(path.dirname(out), { recursive: true })
await io.write(out, doc)
const root = doc.getRoot()
console.log('ok ->', out, Math.round(fs.statSync(out).size / 1024), 'КБ; мешів', root.listMeshes().length, '; матеріали', root.listMaterials().map((m) => m.getName()).join(', '))
console.log('анімації:', root.listAnimations().map((a) => `${a.getName()} (${a.listChannels().length} каналів)`).join(', '))

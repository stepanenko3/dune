// Полегшений орні для телефонів: той самий GLB (public/models/orni-atreides.glb — з віддзеркаленими крилами
// й усіма анімаціями), але геометрія спрощена meshoptimizer: трикутників — 45% (похибка обрису — 0,4% розміру
// моделі, межі частин зафіксовані, щоб не розходились шви). Текстури ті самі, 1024 px: на маленькому екрані
// відеокарта й так бере їхні зменшені копії, а у великому вікні вони лишаються чіткими. Кістки, ваги скіна
// й анімації — без змін, тож усе, що сцена робить із моделлю (крила, куполи-шарніри, опори, рампа), працює так само.
// Запуск: npm run orni:lite (після npm run orni:atreides)
import fs from 'node:fs'
import path from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { simplify, weld, prune } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'models')
const src = path.join(dir, 'orni-atreides.glb')
const out = path.join(dir, 'orni-atreides-lite.glb')
const RATIO = Number(process.argv[2] || 0.35)

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(src)
const tris = () => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0)
const before = tris()
await doc.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.004, lockBorder: true }),
  prune(),
)
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
await io.write(out, doc)
console.log(`трикутників: ${Math.round(before)} → ${Math.round(tris())}; ${Math.round(fs.statSync(src).size / 1024)} КБ → ${Math.round(fs.statSync(out).size / 1024)} КБ`)

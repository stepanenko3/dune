/*
 * Окремий потік для знімка бази (lib/thumbs.mjs): сцену будує сам рушій сайту (src/engine/view3d.js) — ті самі
 * деталі, техніка, пісок, сітка, світло й камера 3/4, — але без DOM і WebGL: замість полотна, керування камерою
 * й підписів — заглушки, малює програмний растеризатор (raster.mjs) у SS разів більшому кадрі, а sharp зменшує
 * його (згладжування) і стискає в JPEG. Вхід: { doc, width, height, ss }; вихід: JPEG (Uint8Array).
 */
import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'
import sharp from 'sharp'
import { render } from './raster.mjs'

const require = createRequire(import.meta.url)
const THREE = require('three')
const { doc, width, height, ss, sky } = workerData
const W = width * ss, H = height * ss

// ---------- заглушки браузера ----------
class El {
  constructor() { this.style = {}; this.hidden = false; this.className = ''; this.textContent = ''; this.clientWidth = W; this.clientHeight = H }
  appendChild(c) { return c }
  remove() {}
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: W, height: H } }
}
class Renderer {
  constructor() { this.domElement = new El(); this.shadowMap = {} }
  setPixelRatio() {}
  setSize() {}
  setClearColor() {}
  render() {}
  dispose() {}
  forceContextLoss() {}
}
class Controls {
  constructor(camera) { this.object = camera; this.target = new THREE.Vector3(); this.mouseButtons = {} }
  update() { this.object.lookAt(this.target); return false }
  addEventListener() {}
  dispose() {}
}
globalThis.document = { createElement: () => new El() }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.requestAnimationFrame = () => 0
globalThis.cancelAnimationFrame = () => {}
globalThis.THREE = { ...THREE, WebGLRenderer: Renderer, OrbitControls: Controls }

// ---------- рушій: у Node файли віддають себе через module.exports; view3d бере сусідів із глобальних ----------
const engine = (n) => require(`../../src/engine/${n}.js`)
globalThis.GEOM = engine('geom')
globalThis.PIECES = engine('pieces')
globalThis.CONVERT = engine('convert')
globalThis.STABILITY = engine('stability')
globalThis.STATIONS3D = engine('stations3d')
const BASEDATA = (globalThis.BASEDATA = engine('hydrate'))
engine('view3d')

const view = globalThis.VIEW3D.create(new El(), {}, BASEDATA.hydrate(doc))
view.setLabels(false)
const { scene, camera } = view.debug
const rgb = render(scene, camera, { width: W, height: H, sky })
const jpg = await sharp(Buffer.from(rgb.buffer), { raw: { width: W, height: H, channels: 3 } })
  .resize(width, height, { kernel: 'lanczos3' })
  .jpeg({ quality: 84 })
  .toBuffer()
parentPort.postMessage(jpg)

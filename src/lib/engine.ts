/**
 * Рушій баз — ті самі файли, що й у класичній однофайловій сторінці (src/engine/*.js):
 * геометрія, моделі Main і DD, 2D-план (SVG-рядок), підрахунки і 3D на three.js r128.
 * Вони UMD-подібні: у браузері кладуть себе у window (GEOM, BASES, PLAN2D, BUILD, VIEW3D,
 * VERSIONS), у Node — у module.exports (так їх беруть tools/check-model.js тощо).
 * Тут ми просто виконуємо їх по черзі і віддаємо типізовані посилання.
 */
import * as THREE_NS from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import '../engine/geom.js'
import '../engine/model.js'
import '../engine/model-dd.js'
import '../engine/plan2d.js'
import '../engine/build.js'
import '../engine/view3d.js'
import '../engine/versions.js'

// view3d.js чекає глобальний THREE з THREE.OrbitControls, як від <script> з CDN
const w = window as unknown as Record<string, any>
w.THREE = { ...THREE_NS, OrbitControls }

/* eslint-disable @typescript-eslint/no-explicit-any */
export type BaseId = 'main' | 'dd'
export type Model = any
export const BASES = w.BASES as Record<BaseId, Model>
export const PLAN2D = w.PLAN2D as { make: (M: Model) => { render: (o: { level: string; items: boolean; labels: boolean; coords: boolean; highlight: string | null }) => string } }
export const BUILD = w.BUILD as { make: (M: Model) => any }
export const VIEW3D = w.VIEW3D as {
  create: (el: HTMLElement, opts: object, M: Model) => {
    start: () => void
    stop: () => void
    setCut: (v: number, floor: number) => void
    setInterior: (v: boolean) => void
    setFoundation: (v: boolean) => void
    setTileColors: (v: boolean) => void
    setLabels: (v: boolean) => void
    setView: (v: 'quarter' | 'front' | 'back' | 'top') => void
  }
}
export interface Version { id: string; base: BaseId; n: string; date: string; commit: string | null; page: string; title: string; changes: string[]; img: string }
export const VERSIONS = (w.VERSIONS || []) as Version[]

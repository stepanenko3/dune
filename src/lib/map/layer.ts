/**
 * Шар точок мапи на одному canvas — як PointsLayer у Satisfactory, але під масштаб Dune:
 * у Хагга сотні тисяч точок (лише первоцвіту 75 тисяч), тож жодних L.Marker.
 *
 * Координати гри → екран рахуються афінно: як у TH.GL, lat = x гри (вертикаль), lng = y гри
 * (горизонталь), і перетворення лінійне, тож дві опорні точки дають множник і зсув на весь
 * кадр. Це на порядок швидше за latLngToContainerPoint на кожну точку.
 *
 * Густота: якщо видимих точок типу забагато, тип малюється квадратиками свого кольору
 * (колір — середній з його іконки), інакше — іконками зі спрайта TH.GL.
 */
import L from 'leaflet'

export interface Batch {
  type: string
  pts: number[]
  icon: [number, number, number, number] | null
  color: string
  size: number
  /** ключі «x,y» зібраних точок: малюються блідими з галочкою */
  done?: Set<string>
}

export interface Mark {
  x: number
  y: number
  /** pin — точка нашого запису; loot — контейнер із потрібним лутом; focus — вибрана */
  kind: 'pin' | 'loot' | 'focus'
  label?: string
  badge?: string
  placeId?: string
  /** pin з іншої розкладки Deep Desert — лише контур */
  ghost?: boolean
  /** точка вибраного запису — поверх чужих на тому самому місці */
  sel?: boolean
}

export type Hit =
  | { kind: 'point'; type: string; i: number; x: number; y: number }
  | { kind: 'mark'; mark: Mark }

const DENSE = 1600

export class PointsLayer extends L.Layer {
  batches: Batch[] = []
  marks: Mark[] = []
  /** типи, точки яких підсвічуються кільцем (вибраний запис «Ресурсів») */
  ringTypes = new Set<string>()
  sprite: HTMLImageElement | null = null
  spice = '#ee9340'
  canvas = document.createElement('canvas')
  private m: L.Map | null = null
  private raf = 0

  onAdd(map: L.Map) {
    this.m = map
    this.canvas.className = 'map-points leaflet-layer'
    this.canvas.style.pointerEvents = 'none'
    map.getPanes().overlayPane.appendChild(this.canvas)
    map.on('moveend zoomend viewreset resize', this.redraw, this)
    map.on('zoomanim', this.hideDuringZoom, this)
    this.redraw()
    return this
  }
  onRemove(map: L.Map) {
    map.off('moveend zoomend viewreset resize', this.redraw, this)
    map.off('zoomanim', this.hideDuringZoom, this)
    this.canvas.remove()
    this.m = null
    return this
  }
  private hideDuringZoom() {
    this.canvas.style.visibility = 'hidden'
  }
  set(b: Partial<Pick<PointsLayer, 'batches' | 'marks' | 'ringTypes' | 'sprite' | 'spice'>>) {
    Object.assign(this, b)
    this.schedule()
  }
  schedule() {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.redraw())
  }

  /** множник і зсув: екран x = kx * y гри + ox, екран y = ky * x гри + oy */
  private affine() {
    const map = this.m!
    const a = map.latLngToContainerPoint([0, 0])
    const b = map.latLngToContainerPoint([100000, 100000])
    return { kx: (b.x - a.x) / 100000, ky: (b.y - a.y) / 100000, ox: a.x, oy: a.y }
  }

  iconPx(size: number) {
    const z = this.m?.getZoom() ?? 0
    const base = 12 + size * 4
    return Math.round(Math.max(14, Math.min(30, base + (z - 2) * 2)))
  }

  redraw = () => {
    const map = this.m
    if (!map) return
    this.canvas.style.visibility = ''
    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    if (this.canvas.width !== size.x * dpr || this.canvas.height !== size.y * dpr) {
      this.canvas.width = size.x * dpr
      this.canvas.height = size.y * dpr
      this.canvas.style.width = size.x + 'px'
      this.canvas.style.height = size.y + 'px'
    }
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]))
    const ctx = this.canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.x, size.y)
    const { kx, ky, ox, oy } = this.affine()
    const W = size.x, H = size.y, pad = 20

    for (const b of this.batches) {
      const n = b.pts.length / 3
      // спершу рахуємо видимі: від цього залежить, іконки чи квадратики
      let vis = 0
      for (let i = 0; i < n; i++) {
        const cx = kx * b.pts[i * 3 + 1] + ox, cy = ky * b.pts[i * 3] + oy
        if (cx > -pad && cy > -pad && cx < W + pad && cy < H + pad) vis++
      }
      if (!vis) continue
      const ring = this.ringTypes.has(b.type)
      if (vis > DENSE || !b.icon || !this.sprite) {
        const s = vis > 20000 ? 2 : 3
        ctx.fillStyle = b.color
        ctx.globalAlpha = 0.85
        for (let i = 0; i < n; i++) {
          const cx = kx * b.pts[i * 3 + 1] + ox, cy = ky * b.pts[i * 3] + oy
          if (cx > -pad && cy > -pad && cx < W + pad && cy < H + pad) ctx.fillRect(cx - s / 2, cy - s / 2, s, s)
        }
        ctx.globalAlpha = 1
        if (ring) this.rings(ctx, b, kx, ky, ox, oy, W, H, 5)
        continue
      }
      const px = this.iconPx(b.size)
      const [sx, sy, sw, sh] = b.icon
      if (ring) this.rings(ctx, b, kx, ky, ox, oy, W, H, px / 2 + 3)
      for (let i = 0; i < n; i++) {
        const x = b.pts[i * 3], y = b.pts[i * 3 + 1]
        const cx = kx * y + ox, cy = ky * x + oy
        if (cx < -pad || cy < -pad || cx > W + pad || cy > H + pad) continue
        const done = b.done?.has(x + ',' + y)
        if (done) ctx.globalAlpha = 0.35
        ctx.drawImage(this.sprite, sx, sy, sw, sh, cx - px / 2, cy - px / 2, px, px)
        if (done) {
          ctx.globalAlpha = 1
          drawCheck(ctx, cx + px / 2 - 3, cy + px / 2 - 3)
        }
      }
    }

    // наш шар: лут, точки записів, вибрана — поверх усього
    const order = (m: Mark) => (m.kind === 'loot' ? 0 : m.kind === 'pin' ? (m.sel ? 2 : 1) : 3)
    const marks = [...this.marks].sort((a, b) => order(a) - order(b))
    ctx.font = '600 11px "Golos Text", system-ui, sans-serif'
    for (const m of marks) {
      const cx = kx * m.y + ox, cy = ky * m.x + oy
      if (cx < -60 || cy < -30 || cx > W + 60 || cy > H + 30) continue
      if (m.kind === 'loot') drawLoot(ctx, cx, cy, this.spice, m.badge)
      else if (m.kind === 'pin') drawPin(ctx, cx, cy, this.spice, m.ghost, m.label)
      else drawFocus(ctx, cx, cy, this.spice)
    }
  }

  private rings(ctx: CanvasRenderingContext2D, b: Batch, kx: number, ky: number, ox: number, oy: number, W: number, H: number, r: number) {
    ctx.save()
    ctx.strokeStyle = this.spice
    ctx.lineWidth = 2
    ctx.shadowColor = 'rgba(0,0,0,.6)'
    ctx.shadowBlur = 3
    const n = b.pts.length / 3
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const cx = kx * b.pts[i * 3 + 1] + ox, cy = ky * b.pts[i * 3] + oy
      if (cx < -20 || cy < -20 || cx > W + 20 || cy > H + 20) continue
      ctx.moveTo(cx + r, cy)
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
    }
    ctx.stroke()
    ctx.restore()
  }

  /** Що під курсором: спершу наш шар, потім точки гри (верхні батчі мають перевагу). */
  hit(cp: L.Point): Hit | null {
    if (!this.m) return null
    const { kx, ky, ox, oy } = this.affine()
    let best: Hit | null = null
    let bd = Infinity
    for (const m of this.marks) {
      if (m.kind === 'focus') continue
      const d = Math.hypot(kx * m.y + ox - cp.x, ky * m.x + oy - cp.y)
      const r = m.kind === 'pin' ? 14 : 11
      if (d <= r && (d < bd || (d === bd && m.sel))) { bd = d; best = { kind: 'mark', mark: m } }
    }
    if (best) return best
    for (let bi = this.batches.length - 1; bi >= 0; bi--) {
      const b = this.batches[bi]
      const r = this.iconPx(b.size) / 2 + 2
      const n = b.pts.length / 3
      for (let i = 0; i < n; i++) {
        const dx = kx * b.pts[i * 3 + 1] + ox - cp.x
        if (dx > r || dx < -r) continue
        const dy = ky * b.pts[i * 3] + oy - cp.y
        if (dy > r || dy < -r) continue
        const d = Math.hypot(dx, dy)
        if (d < bd) { bd = d; best = { kind: 'point', type: b.type, i, x: b.pts[i * 3], y: b.pts[i * 3 + 1] } }
      }
      if (best) return best
    }
    return null
  }
}

function drawCheck(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x - 4, y)
  ctx.lineTo(x - 1, y + 3)
  ctx.lineTo(x + 5, y - 4)
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(0,0,0,.75)'
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#6ee27a'
  ctx.stroke()
  ctx.restore()
}

function drawLoot(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, badge?: string) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, 8, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(20,14,8,.55)'
  ctx.fill()
  ctx.lineWidth = 2.4
  ctx.strokeStyle = c
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, 2.6, 0, Math.PI * 2)
  ctx.fillStyle = c
  ctx.fill()
  if (badge) {
    ctx.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace'
    const w = ctx.measureText(badge).width + 6
    ctx.fillStyle = 'rgba(20,14,8,.82)'
    ctx.beginPath()
    ctx.roundRect(x + 7, y - 15, w, 13, 3)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(badge, x + 10, y - 5)
  }
  ctx.restore()
}

/** Точка нашого запису: ромб кольору спайсу з білою серцевиною і підписом. */
function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, ghost?: boolean, label?: string) {
  ctx.save()
  const r = 10
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x + r, y)
  ctx.lineTo(x, y + r)
  ctx.lineTo(x - r, y)
  ctx.closePath()
  ctx.shadowColor = 'rgba(0,0,0,.55)'
  ctx.shadowBlur = 5
  ctx.fillStyle = ghost ? 'rgba(20,14,8,.4)' : c
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.lineWidth = 1.6
  ctx.strokeStyle = ghost ? c : 'rgba(20,14,8,.9)'
  ctx.setLineDash(ghost ? [3, 2] : [])
  ctx.stroke()
  ctx.setLineDash([])
  if (!ghost) {
    ctx.beginPath()
    ctx.arc(x, y, 3, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
  }
  if (label) {
    ctx.font = '600 11px "Golos Text", system-ui, sans-serif'
    ctx.lineWidth = 3.5
    ctx.strokeStyle = 'rgba(20,14,8,.85)'
    ctx.strokeText(label, x + 13, y + 4)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, x + 13, y + 4)
  }
  ctx.restore()
}

function drawFocus(ctx: CanvasRenderingContext2D, x: number, y: number, c: string) {
  ctx.save()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = c
  ctx.shadowColor = 'rgba(0,0,0,.6)'
  ctx.shadowBlur = 4
  ctx.beginPath()
  ctx.arc(x, y, 17, 0, Math.PI * 2)
  ctx.stroke()
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    ctx.beginPath()
    ctx.moveTo(x + dx * 21, y + dy * 21)
    ctx.lineTo(x + dx * 27, y + dy * 27)
    ctx.stroke()
  }
  ctx.restore()
}

/** Середній «живий» колір іконки: для квадратиків на дрібному масштабі. */
export function iconColors(sprite: HTMLImageElement, icons: Record<string, [number, number, number, number]>) {
  const c = document.createElement('canvas')
  c.width = sprite.naturalWidth
  c.height = sprite.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(sprite, 0, 0)
  const out: Record<string, string> = {}
  for (const [id, [x, y, w, h]] of Object.entries(icons)) {
    const d = ctx.getImageData(x, y, w, h).data
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2])
      // темна підкладка щитів і сірі контури не кажуть нічого про тип — беремо насичене
      if (mx < 70 || mx - mn < 28) continue
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++
    }
    out[id] = n ? `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})` : '#d9c7a3'
  }
  return out
}

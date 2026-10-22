/**
 * Шар точок мапи на одному canvas — як PointsLayer у Satisfactory, але під масштаб Dune:
 * у Хагга сотні тисяч точок (лише первоцвіту 75 тисяч), тож жодних L.Marker.
 *
 * Координати гри → екран рахуються афінно: як у TH.GL, lat = x гри (вертикаль), lng = y гри
 * (горизонталь), і перетворення лінійне, тож дві опорні точки дають множник і зсув на весь
 * кадр. Це на порядок швидше за latLngToContainerPoint на кожну точку.
 *
 * Плавність: canvas більший за вікно (запас PAD з кожного боку), тож під час перетягування
 * краї не порожні; на анімованому зумі canvas масштабується CSS-трансформом разом із тайлами
 * (як L.Renderer), а не ховається — значки не блимають.
 *
 * Густота: якщо видимих точок типу забагато, тип малюється квадратиками свого кольору
 * (колір — середній з його іконки), інакше — іконками зі спрайта TH.GL. Позначки й точки записів, що на екрані
 * налазять одна на одну, теж збираються в кружок з лічильником (клік — наблизити).
 *
 * Без shadowBlur на кожен значок: тінь — той самий контур, темніший і зсунутий на піксель (розмиття щокадру на
 * сотнях значків гальмувало телефон). Полотно — не більше 16 млн пікселів (межа Safari, інакше шар порожній).
 */
import L from 'leaflet'
import { locale, t } from '../i18n'

export interface Batch {
  type: string
  pts: number[]
  icon: [number, number, number, number] | null
  color: string
  size: number
  /** ключі «x,y» зібраних точок: малюються блідими з галочкою */
  done?: Set<string>
  /** зібрані вузли, що відновлюються: ключ → частка відновлення 0…1 (дуга замість галочки) */
  respawn?: Map<string, number>
  /** малювати лише ці індекси (фільтр «Наших ресурсів») */
  only?: Set<number>
}

export interface Mark {
  x: number
  y: number
  /** pin — точка нашого запису; marker — позначка (база, збір…); loot — контейнер із потрібним лутом; focus — вибрана */
  kind: 'pin' | 'marker' | 'loot' | 'focus'
  /** позначка: її id, колір і знак */
  markerId?: string
  color?: string
  glyph?: string
  label?: string
  badge?: string
  placeId?: string
  /** pin з іншої розкладки Deep Desert — лише контур */
  ghost?: boolean
  /** точка вибраного запису — поверх чужих на тому самому місці */
  sel?: boolean
}

/** Сітка секторів Deep Desert: n×n клітинок у межах мапи, ряди A знизу, стовпці 1 зліва. */
export interface Grid {
  x0: number
  x1: number
  y0: number
  y1: number
  n: number
}

export type Hit =
  | { kind: 'point'; type: string; i: number; x: number; y: number }
  | { kind: 'cluster'; type: string; n: number; x: number; y: number; bounds: [[number, number], [number, number]] }
  | { kind: 'mark'; mark: Mark }

/** Група однакових значків: центр, кількість, межі; i — індекс точки, якщо вона одна. */
interface Cluster {
  x: number
  y: number
  n: number
  i: number
  x0: number
  y0: number
  x1: number
  y1: number
}
/** Що намальовано в останньому кадрі (у координатах вікна) — для наведення і кліку. */
interface Drawn {
  type: string
  c: Cluster
  sx: number
  sy: number
  r: number
}

/** Радіус групування на екрані: значки, ближчі за нього, зливаються в один з лічильником. */
const CLUSTER_PX = 34
const fmtCount = (n: number) => (n < 1000 ? String(n) : (Math.round(n / 100) / 10).toLocaleString(locale(), { maximumFractionDigits: 1 }) + 'k')

const DENSE = 1600
const PAD = 0.35
/** найбільше пікселів полотна: більше Safari не малює зовсім */
const MAX_PX = 16_000_000
/** позначки й точки записів ближчі за стільки пікселів — одним кружком */
const MARK_GROUP_PX = 20
/** «тип» групи позначок у Hit (для підказки й кліку) */
export const MARK_GROUP = '__marks'
/** сенсорний екран: палець ширший за курсор — і зона попадання більша */
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
const SLOP = COARSE ? 10 : 0

/** Перша літера слова — знак на кружечку (для китайської чи японської — перший ієрогліф). */
const initial = (word: string) => (Array.from(word.trim())[0] ?? '').toUpperCase()
const spice = (r: number, color: string, name: string, label: string) => ({ r, color, name, label, letter: initial(name) })

/**
 * Поля меланжу: у TH.GL три майже однакові іконки — малюємо свої, розмір і колір за величиною поля.
 * name — величина одним словом (підказка), label — рядок у панелі, letter — знак на кружечку.
 */
export const SPICE: Record<string, { r: number; color: string; letter: string; name: string; label: string }> = {
  spice_field_small: spice(6, '#f2c14e', t('мале'), t('Мале поле')),
  spice_field_medium: spice(8.5, '#ee8a2c', t('середнє'), t('Середнє поле')),
  spice_field_large: spice(11.5, '#d9481f', t('велике'), t('Велике поле')),
}

export class PointsLayer extends L.Layer {
  batches: Batch[] = []
  marks: Mark[] = []
  /** типи, точки яких підсвічуються кільцем (вибраний запис «Ресурсів») */
  ringTypes = new Set<string>()
  sprite: HTMLImageElement | null = null
  spice = '#ee9340'
  grid: Grid | null = null
  /** групувати однакові значки при віддаленні */
  cluster = true
  canvas = document.createElement('canvas')
  private drawn: Drawn[] = []
  private clustered = new Set<string>()
  /**
   * групи за масивом точок і фільтром (а не за об'єктом Batch): поки щось відновлюється, Batch-і перебудовуються
   * раз на 20 с — і групування 75 тисяч точок рахувалось би заново щоразу
   */
  private clusterCache = new WeakMap<number[], WeakMap<object, Map<number, Cluster[]>>>()
  /** групи позначок, намальовані в останньому кадрі (координати вікна) */
  private markGroups: { sx: number; sy: number; n: number; x: number; y: number; x0: number; y0: number; x1: number; y1: number }[] = []
  /** позначки, що зараз у групах (окремо їх не видно — і клік ловить група) */
  private grouped = new Set<Mark>()
  private m: L.Map | null = null
  private raf = 0
  private topLeft: L.LatLng | null = null

  onAdd(map: L.Map) {
    this.m = map
    this.canvas.className = 'map-points leaflet-layer leaflet-zoom-animated'
    this.canvas.style.pointerEvents = 'none'
    map.getPanes().overlayPane.appendChild(this.canvas)
    map.on('moveend zoomend viewreset resize', this.redraw, this)
    map.on('zoom', this.onZoom, this)
    map.on('zoomanim', this.onZoomAnim, this)
    this.redraw()
    return this
  }
  /** кадри плавного зуму (map._move): перемальовуємо одразу, синхронно з тайлами */
  private onZoom() {
    if (!(this.m as unknown as { _animatingZoom?: boolean })?._animatingZoom) this.draw()
  }
  onRemove(map: L.Map) {
    map.off('moveend zoomend viewreset resize', this.redraw, this)
    map.off('zoom', this.onZoom, this)
    map.off('zoomanim', this.onZoomAnim, this)
    cancelAnimationFrame(this.raf)
    this.canvas.remove()
    this.m = null
    return this
  }
  /** анімований зум: тягнемо готовий кадр трансформом, як Leaflet тягне тайли */
  private onZoomAnim(e: L.ZoomAnimEvent) {
    const map = this.m
    if (!map || !this.topLeft) return
    const scale = map.getZoomScale(e.zoom, map.getZoom())
    const offset = (map as unknown as { _latLngToNewLayerPoint: (ll: L.LatLng, z: number, c: L.LatLng) => L.Point })._latLngToNewLayerPoint(this.topLeft, e.zoom, e.center)
    L.DomUtil.setTransform(this.canvas, offset, scale)
  }
  set(b: Partial<Pick<PointsLayer, 'batches' | 'marks' | 'ringTypes' | 'sprite' | 'spice' | 'grid' | 'cluster'>>) {
    Object.assign(this, b)
    this.schedule()
  }
  schedule() {
    cancelAnimationFrame(this.raf)
    this.raf = requestAnimationFrame(() => this.redraw())
  }

  /**
   * Множник і зсув: x = kx * y гри + ox, y = ky * x гри + oy (з запасом px, py — у координатах canvas).
   * Через project без округлення: latLngToContainerPoint округлює до пікселя, і на плавному зумі
   * точки стрибали на піксель туди-сюди.
   */
  private affine(px = 0, py = 0) {
    const map = this.m!
    const z = map.getZoom()
    const shift = (map as unknown as { _getMapPanePos: () => L.Point })._getMapPanePos().subtract(map.getPixelOrigin())
    const a = map.project([0, 0], z), b = map.project([100000, 100000], z)
    return { kx: (b.x - a.x) / 100000, ky: (b.y - a.y) / 100000, ox: a.x + shift.x + px, oy: a.y + shift.y + py }
  }

  /**
   * Режим «іконки / квадратики» для кожного типу — з запасом (гістерезисом): на межі густоти
   * повільний зум інакше перемикав його туди-сюди щокадру.
   */
  private denseOf = new Map<string, boolean>()

  /** Розмір значка сталий: якщо він росте з масштабом, на зумі значки «дихають». */
  iconPx(size: number) {
    return Math.round(Math.max(20, Math.min(32, 18 + size * 4)))
  }

  redraw = () => this.draw()

  private draw() {
    const map = this.m
    if (!map) return
    const size = map.getSize()
    // великий екран з dpr 2: спершу менший запас довкола вікна, і лише якщо й так не влазить — менша чіткість
    const dpr0 = window.devicePixelRatio || 1
    let pad = PAD
    while (pad > 0.1 && size.x * (1 + 2 * pad) * size.y * (1 + 2 * pad) * dpr0 * dpr0 > MAX_PX) pad -= 0.05
    const px = Math.round(size.x * pad), py = Math.round(size.y * pad)
    const W = size.x + px * 2, H = size.y + py * 2
    const dpr = Math.min(dpr0, Math.sqrt(MAX_PX / (W * H)))
    const cw = Math.round(W * dpr), ch = Math.round(H * dpr)
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw
      this.canvas.height = ch
      this.canvas.style.width = W + 'px'
      this.canvas.style.height = H + 'px'
    }
    this.topLeft = map.containerPointToLatLng([-px, -py])
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([-px, -py]))
    const ctx = this.canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const { kx, ky, ox, oy } = this.affine(px, py)
    const edge = 20
    const inView = (cx: number, cy: number) => cx > -edge && cy > -edge && cx < W + edge && cy < H + edge

    if (this.grid) this.drawGrid(ctx, kx, ky, ox, oy)
    this.drawn = []
    this.clustered.clear()

    for (const b of this.batches) {
      if (this.cluster && (SPICE[b.type] || (b.icon && this.sprite))) {
        this.drawClusters(ctx, b, kx, ky, ox, oy, px, py, inView)
        continue
      }
      const n = b.pts.length / 3
      const want = (i: number) => !b.only || b.only.has(i)
      // спершу рахуємо видимі: від цього залежить, іконки чи квадратики
      let vis = 0
      for (let i = 0; i < n; i++) if (want(i) && inView(kx * b.pts[i * 3 + 1] + ox, ky * b.pts[i * 3] + oy)) vis++
      if (!vis) continue
      const was = this.denseOf.get(b.type)
      const dense = was === undefined ? vis > DENSE : was ? vis > DENSE * 0.7 : vis > DENSE * 1.3
      this.denseOf.set(b.type, dense)
      const ring = this.ringTypes.has(b.type)
      if ((dense || !b.icon || !this.sprite) && !SPICE[b.type]) {
        const s = 4
        ctx.fillStyle = b.color
        ctx.globalAlpha = 0.9
        for (let i = 0; i < n; i++) {
          if (!want(i)) continue
          const cx = kx * b.pts[i * 3 + 1] + ox, cy = ky * b.pts[i * 3] + oy
          if (inView(cx, cy)) ctx.fillRect(cx - s / 2, cy - s / 2, s, s)
        }
        ctx.globalAlpha = 1
        if (ring) this.rings(ctx, b, kx, ky, ox, oy, W, H, 5)
        continue
      }
      const sp = SPICE[b.type]
      if (sp) {
        const r = sp.r * 1.15
        if (ring) this.rings(ctx, b, kx, ky, ox, oy, W, H, r + 4)
        for (let i = 0; i < n; i++) {
          if (!want(i)) continue
          const cx = kx * b.pts[i * 3 + 1] + ox, cy = ky * b.pts[i * 3] + oy
          if (inView(cx, cy)) drawSpice(ctx, cx, cy, r, sp.color, r >= 8 ? sp.letter : '')
        }
        continue
      }
      if (!b.icon || !this.sprite) continue
      const sprite = this.sprite
      const ipx = this.iconPx(b.size)
      const [sx, sy, sw, sh] = b.icon
      if (ring) this.rings(ctx, b, kx, ky, ox, oy, W, H, ipx / 2 + 3)
      for (let i = 0; i < n; i++) {
        if (!want(i)) continue
        const x = b.pts[i * 3], y = b.pts[i * 3 + 1]
        const cx = kx * y + ox, cy = ky * x + oy
        if (!inView(cx, cy)) continue
        const done = b.done?.has(x + ',' + y)
        if (done) ctx.globalAlpha = 0.35
        ctx.drawImage(sprite, sx, sy, sw, sh, cx - ipx / 2, cy - ipx / 2, ipx, ipx)
        if (done) {
          ctx.globalAlpha = 1
          const p = b.respawn?.get(x + ',' + y)
          if (p != null) drawRespawn(ctx, cx, cy, ipx / 2 + 2, p)
          else drawCheck(ctx, cx + ipx / 2 - 3, cy + ipx / 2 - 3)
        }
      }
    }

    // наш шар: лут, точки записів, вибрана — поверх усього
    const order = (m: Mark) => (m.kind === 'loot' ? 0 : m.kind === 'pin' || m.kind === 'marker' ? (m.sel ? 2 : 1) : 3)
    const marks = [...this.marks].sort((a, b) => order(a) - order(b))
    const solo = this.groupMarks(marks, kx, ky, ox, oy, W, H)
    for (const m of marks) {
      if (!solo.has(m)) continue
      const cx = kx * m.y + ox, cy = ky * m.x + oy
      if (cx < -60 || cy < -30 || cx > W + 60 || cy > H + 30) continue
      if (m.kind === 'loot') drawLoot(ctx, cx, cy, this.spice, m.badge)
      else if (m.kind === 'pin') drawPin(ctx, cx, cy, this.spice, m.ghost, m.label)
      else if (m.kind === 'marker') drawMarker(ctx, cx, cy, m.color || this.spice, m.glyph || '•', m.label, m.sel, m.ghost)
      else drawFocus(ctx, cx, cy, this.spice)
    }
    for (const g of this.markGroups) drawMarkGroup(ctx, g.sx + px, g.sy + py, g.n, this.spice)
  }

  /**
   * Позначки й точки записів, що на екрані налазять одна на одну (ближче за MARK_GROUP_PX), — одним кружком з
   * лічильником; вибрана й «тимчасові» (лут, фокус) — завжди окремо. На найбільшому наближенні не групуємо: далі
   * наближати нікуди. Повертає те, що малювати окремо.
   */
  private groupMarks(marks: Mark[], kx: number, ky: number, ox: number, oy: number, W: number, H: number) {
    this.markGroups = []
    this.grouped = new Set()
    const solo = new Set(marks)
    const map = this.m!
    if (!this.cluster || map.getZoom() >= map.getMaxZoom() - 0.5) return solo
    const px = (W - map.getSize().x) / 2, py = (H - map.getSize().y) / 2
    type G = { members: Mark[]; sx: number; sy: number }
    const cells = new Map<string, G[]>()
    const groups: G[] = []
    for (const m of marks) {
      if ((m.kind !== 'marker' && m.kind !== 'pin') || m.sel) continue
      const sx = kx * m.y + ox, sy = ky * m.x + oy
      if (sx < -60 || sy < -60 || sx > W + 60 || sy > H + 60) continue
      const gx = Math.floor(sx / MARK_GROUP_PX), gy = Math.floor(sy / MARK_GROUP_PX)
      let hit: G | null = null
      for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (const g of cells.get(gx + dx + ':' + (gy + dy)) ?? []) if (Math.hypot(g.sx - sx, g.sy - sy) < MARK_GROUP_PX) { hit = g; break }
      }
      if (hit) { hit.members.push(m); continue }
      const g: G = { members: [m], sx, sy }
      groups.push(g)
      const k = gx + ':' + gy
      cells.set(k, [...(cells.get(k) ?? []), g])
    }
    for (const g of groups) {
      if (g.members.length < 2) continue
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sx = 0, sy = 0
      for (const m of g.members) {
        solo.delete(m)
        this.grouped.add(m)
        x0 = Math.min(x0, m.x); x1 = Math.max(x1, m.x); y0 = Math.min(y0, m.y); y1 = Math.max(y1, m.y)
        sx += m.x; sy += m.y
      }
      const n = g.members.length
      this.markGroups.push({ sx: g.sx - px, sy: g.sy - py, n, x: sx / n, y: sy / n, x0, y0, x1, y1 })
    }
    return solo
  }

  /**
   * Групи на поточному кроці масштабу. Рахуються в координатах гри і лише на кроках по 0,5
   * рівня — тож під час пересування групи стоять на місці, а на зумі не «перестрибують» щокадру.
   * Жадібно: перша вільна точка збирає всіх вільних сусідів у радіусі.
   */
  private clustersFor(b: Batch, bucket: number, r: number): Cluster[] {
    let byOnly = this.clusterCache.get(b.pts)
    if (!byOnly) this.clusterCache.set(b.pts, (byOnly = new WeakMap()))
    const key = b.only ?? ALL_POINTS
    let per = byOnly.get(key)
    if (!per) byOnly.set(key, (per = new Map()))
    const hit = per.get(bucket)
    if (hit) return hit
    const n = b.pts.length / 3
    const cells = new Map<string, number[]>()
    for (let i = 0; i < n; i++) {
      if (b.only && !b.only.has(i)) continue
      const k = Math.floor(b.pts[i * 3] / r) + ':' + Math.floor(b.pts[i * 3 + 1] / r)
      const a = cells.get(k)
      if (a) a.push(i)
      else cells.set(k, [i])
    }
    const used = new Uint8Array(n)
    const out: Cluster[] = []
    const r2 = r * r
    for (let i = 0; i < n; i++) {
      if (used[i] || (b.only && !b.only.has(i))) continue
      const x = b.pts[i * 3], y = b.pts[i * 3 + 1]
      const gx = Math.floor(x / r), gy = Math.floor(y / r)
      let sx = 0, sy = 0, cnt = 0, x0 = x, x1 = x, y0 = y, y1 = y
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const j of cells.get(gx + dx + ':' + (gy + dy)) ?? []) {
            if (used[j]) continue
            const jx = b.pts[j * 3], jy = b.pts[j * 3 + 1]
            if ((jx - x) ** 2 + (jy - y) ** 2 > r2) continue
            used[j] = 1
            sx += jx; sy += jy; cnt++
            if (jx < x0) x0 = jx; if (jx > x1) x1 = jx
            if (jy < y0) y0 = jy; if (jy > y1) y1 = jy
          }
        }
      }
      out.push({ x: sx / cnt, y: sy / cnt, n: cnt, i, x0, y0, x1, y1 })
    }
    per.set(bucket, out)
    return out
  }

  private drawClusters(
    ctx: CanvasRenderingContext2D, b: Batch, kx: number, ky: number, ox: number, oy: number,
    px: number, py: number, inView: (x: number, y: number) => boolean,
  ) {
    const map = this.m!
    const z = map.getZoom()
    const bucket = Math.floor(z * 2) / 2
    // радіус у одиницях гри — за масштабом кроку, а не поточного кадру
    const kAt = Math.abs(kx) * 2 ** (bucket - z)
    const list = this.clustersFor(b, bucket, CLUSTER_PX / kAt)
    this.clustered.add(b.type)
    const sp = SPICE[b.type]
    const ipx = this.iconPx(b.size)
    const r = sp ? sp.r * 1.15 : ipx / 2
    const ring = this.ringTypes.has(b.type)
    if (ring) {
      ctx.save()
      ctx.strokeStyle = this.spice
      ctx.lineWidth = 2
      ctx.beginPath()
      for (const c of list) {
        const cx = kx * c.y + ox, cy = ky * c.x + oy
        if (!inView(cx, cy)) continue
        ctx.moveTo(cx + r + 3, cy)
        ctx.arc(cx, cy, r + 3, 0, Math.PI * 2)
      }
      ctx.stroke()
      ctx.restore()
    }
    for (const c of list) {
      const cx = kx * c.y + ox, cy = ky * c.x + oy
      if (!inView(cx, cy)) continue
      this.drawn.push({ type: b.type, c, sx: cx - px, sy: cy - py, r: r + (c.n > 1 ? 6 : 2) })
      if (sp) drawSpice(ctx, cx, cy, r, sp.color, r >= 8 ? sp.letter : '')
      else {
        const [sx, sy, sw, sh] = b.icon!
        const key = b.pts[c.i * 3] + ',' + b.pts[c.i * 3 + 1]
        const done = c.n === 1 && b.done?.has(key)
        if (done) ctx.globalAlpha = 0.35
        ctx.drawImage(this.sprite!, sx, sy, sw, sh, cx - ipx / 2, cy - ipx / 2, ipx, ipx)
        if (done) {
          ctx.globalAlpha = 1
          const p = b.respawn?.get(key)
          if (p != null) drawRespawn(ctx, cx, cy, ipx / 2 + 2, p)
          else drawCheck(ctx, cx + ipx / 2 - 3, cy + ipx / 2 - 3)
        }
      }
      if (c.n > 1) drawBadge(ctx, cx + r - 2, cy + r - 4, fmtCount(c.n))
    }
  }

  /** Сітка секторів: ряди A…I знизу вгору, стовпці 1…9 зліва направо; підпис у кутку клітинки. */
  private drawGrid(ctx: CanvasRenderingContext2D, kx: number, ky: number, ox: number, oy: number) {
    const g = this.grid!
    const sx = (y: number) => kx * y + ox, sy = (x: number) => ky * x + oy
    const cw = (g.y1 - g.y0) / g.n, ch = (g.x1 - g.x0) / g.n
    ctx.save()
    // суцільні лінії: пунктир відраховується від краю мапи, і на зумі штрихи «повзли» вздовж ліній
    ctx.strokeStyle = 'rgba(20,14,8,.38)'
    ctx.lineWidth = 1.25
    ctx.beginPath()
    for (let k = 0; k <= g.n; k++) {
      const X = sx(g.y0 + cw * k), Y = sy(g.x0 + ch * k)
      ctx.moveTo(X, sy(g.x0)); ctx.lineTo(X, sy(g.x1))
      ctx.moveTo(sx(g.y0), Y); ctx.lineTo(sx(g.y1), Y)
    }
    ctx.stroke()
    const fs = 14
    ctx.font = `700 ${fs}px Unbounded, "Golos Text", sans-serif`
    ctx.textBaseline = 'top'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(20,14,8,.7)'
    ctx.fillStyle = 'rgba(255,244,226,.92)'
    for (let r = 0; r < g.n; r++) {
      for (let c = 0; c < g.n; c++) {
        // ряд A — нижній: найбільший x гри
        const label = String.fromCharCode(65 + r) + (c + 1)
        const X = sx(g.y0 + cw * c) + 6
        const Y = sy(g.x1 - ch * (r + 1)) + 5
        ctx.strokeText(label, X, Y)
        ctx.fillText(label, X, Y)
      }
    }
    ctx.restore()
  }

  private rings(ctx: CanvasRenderingContext2D, b: Batch, kx: number, ky: number, ox: number, oy: number, W: number, H: number, r: number) {
    ctx.save()
    const n = b.pts.length / 3
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      if (b.only && !b.only.has(i)) continue
      const cx = kx * b.pts[i * 3 + 1] + ox, cy = ky * b.pts[i * 3] + oy
      if (cx < -20 || cy < -20 || cx > W + 20 || cy > H + 20) continue
      ctx.moveTo(cx + r, cy)
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
    }
    // темна підкладка замість розмитої тіні — той самий контур ширше
    ctx.lineWidth = 4
    ctx.strokeStyle = 'rgba(0,0,0,.45)'
    ctx.stroke()
    ctx.lineWidth = 2
    ctx.strokeStyle = this.spice
    ctx.stroke()
    ctx.restore()
  }

  /**
   * Що під курсором (точка вікна): спершу наш шар, потім точки гри (верхні батчі мають перевагу). На сенсорному
   * екрані зона попадання ширша (SLOP): палець не влучить у значок 11 px.
   */
  hit(cp: L.Point): Hit | null {
    if (!this.m) return null
    const { kx, ky, ox, oy } = this.affine()
    let best: Hit | null = null
    let bd = Infinity
    for (const g of this.markGroups) {
      const d = Math.hypot(g.sx - cp.x, g.sy - cp.y)
      if (d <= 15 + SLOP && d < bd) { bd = d; best = { kind: 'cluster', type: MARK_GROUP, n: g.n, x: g.x, y: g.y, bounds: [[g.x0, g.y0], [g.x1, g.y1]] } }
    }
    for (const m of this.marks) {
      if (m.kind === 'focus') continue
      // у групі — ловиться групою (окремо її значка не видно)
      if (this.grouped.has(m)) continue
      // позначка — крапля над точкою: ловимо її кружок, а не вістря
      const lift = m.kind === 'marker' ? (m.sel ? 17 : 15) : 0
      const d = Math.hypot(kx * m.y + ox - cp.x, ky * m.x + oy - lift - cp.y)
      const r = (m.kind === 'pin' || m.kind === 'marker' ? 14 : 11) + SLOP
      if (d <= r && (d < bd || (d === bd && m.sel))) { bd = d; best = { kind: 'mark', mark: m } }
    }
    if (best) return best
    // згруповані типи — за тим, що реально намальовано (верхні — останні)
    for (let k = this.drawn.length - 1; k >= 0; k--) {
      const d = this.drawn[k]
      const dd = Math.hypot(d.sx - cp.x, d.sy - cp.y)
      if (dd > d.r + SLOP || dd >= bd) continue
      bd = dd
      const c = d.c
      best = c.n > 1
        ? { kind: 'cluster', type: d.type, n: c.n, x: c.x, y: c.y, bounds: [[c.x0, c.y0], [c.x1, c.y1]] }
        : { kind: 'point', type: d.type, i: c.i, x: c.x, y: c.y }
    }
    if (best) return best
    for (let bi = this.batches.length - 1; bi >= 0; bi--) {
      const b = this.batches[bi]
      if (this.clustered.has(b.type)) continue
      const r = this.iconPx(b.size) / 2 + 2 + SLOP
      const n = b.pts.length / 3
      for (let i = 0; i < n; i++) {
        if (b.only && !b.only.has(i)) continue
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

/** ключ кешу груп для батча без фільтра */
const ALL_POINTS = {}

/** Сітка секторів мапи: лише в Глибокої пустелі (9×9 у межах мапи). */
export const gridOf = (def: { id: string; bounds: [[number, number], [number, number]] }): Grid | null =>
  def.id === 'deepdesert_1' ? { x0: def.bounds[0][0], x1: def.bounds[1][0], y0: def.bounds[0][1], y1: def.bounds[1][1], n: 9 } : null

/** Сектор Глибокої пустелі під точкою гри: «E5» або null поза сіткою. */
export function sectorOf(g: Grid, x: number, y: number) {
  const ch = (g.x1 - g.x0) / g.n, cw = (g.y1 - g.y0) / g.n
  const r = Math.floor((g.x1 - x) / ch), c = Math.floor((y - g.y0) / cw)
  if (r < 0 || c < 0 || r >= g.n || c >= g.n) return null
  return String.fromCharCode(65 + r) + (c + 1)
}

export function drawSpice(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, letter: string) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y + 1, r + 0.5, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,.3)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 1.6
  ctx.strokeStyle = 'rgba(30,14,4,.85)'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, r - 2.2, 0, Math.PI * 2)
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,.7)'
  ctx.stroke()
  if (letter) {
    ctx.font = `700 ${Math.round(r * 1.05)}px "Golos Text", system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(30,14,4,.9)'
    ctx.fillText(letter, x, y + 0.5)
  }
  ctx.restore()
}

/** Група позначок і точок записів: кружок кольору спайсу з числом. */
function drawMarkGroup(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, c: string) {
  ctx.save()
  const r = n < 10 ? 12 : n < 100 ? 14 : 16
  ctx.beginPath()
  ctx.arc(x, y + 1.5, r, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0,0,0,.35)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = c
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#fff'
  ctx.stroke()
  ctx.font = '700 12px "Golos Text", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.fillText(fmtCount(n), x, y + 0.5)
  ctx.restore()
}

/** Лічильник групи: темна «таблетка» з числом у правому нижньому куті значка. */
function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.save()
  ctx.font = '700 11px "JetBrains Mono", ui-monospace, monospace'
  const w = Math.max(16, ctx.measureText(text).width + 8)
  ctx.fillStyle = 'rgba(20,14,8,.9)'
  ctx.strokeStyle = 'rgba(255,255,255,.75)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(x - w / 2, y - 8, w, 16, 8)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y + 0.5)
  ctx.restore()
}

/** вузол відновлюється: темне кільце і бурштинова дуга за годинниковою стрілкою — скільки вже минуло */
function drawRespawn(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, p: number) {
  ctx.save()
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(0,0,0,.55)'
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, Math.max(0.02, p)))
  ctx.lineWidth = 2.5
  ctx.strokeStyle = '#f0a54a'
  ctx.stroke()
  ctx.restore()
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
  ctx.arc(x, y, 9, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(20,14,8,.55)'
  ctx.fill()
  ctx.lineWidth = 2.6
  ctx.strokeStyle = c
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, 3, 0, Math.PI * 2)
  ctx.fillStyle = c
  ctx.fill()
  if (badge) {
    ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace'
    const w = ctx.measureText(badge).width + 6
    ctx.fillStyle = 'rgba(20,14,8,.82)'
    ctx.beginPath()
    ctx.roundRect(x + 8, y - 16, w, 14, 3)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(badge, x + 11, y - 5)
  }
  ctx.restore()
}

/** Точка нашого запису: ромб кольору спайсу з білою серцевиною і підписом. */
function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, ghost?: boolean, label?: string) {
  ctx.save()
  const r = 12
  const diamond = (dy: number) => {
    ctx.beginPath()
    ctx.moveTo(x, y - r + dy)
    ctx.lineTo(x + r, y + dy)
    ctx.lineTo(x, y + r + dy)
    ctx.lineTo(x - r, y + dy)
    ctx.closePath()
  }
  if (!ghost) {
    diamond(1.5)
    ctx.fillStyle = 'rgba(0,0,0,.35)'
    ctx.fill()
  }
  diamond(0)
  ctx.fillStyle = ghost ? 'rgba(20,14,8,.4)' : c
  ctx.fill()
  ctx.lineWidth = 1.8
  ctx.strokeStyle = ghost ? c : 'rgba(20,14,8,.9)'
  ctx.setLineDash(ghost ? [3, 2] : [])
  ctx.stroke()
  ctx.setLineDash([])
  if (!ghost) {
    ctx.beginPath()
    ctx.arc(x, y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
  }
  if (label) {
    ctx.font = '600 12px "Golos Text", system-ui, sans-serif'
    ctx.lineWidth = 3.5
    ctx.strokeStyle = 'rgba(20,14,8,.85)'
    ctx.strokeText(label, x + 15, y + 4)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, x + 15, y + 4)
  }
  ctx.restore()
}

/** Позначка: крапля кольору виду зі знаком (Б, А, Р, !, З, •) і підписом; вибрана — більша, з білим обідком. */
function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, glyph: string, label?: string, sel?: boolean, ghost?: boolean) {
  ctx.save()
  const r = sel ? 13 : 11
  const cy = y - r - 4 // вістря краплі — у точці
  const drop = (dy: number) => {
    ctx.beginPath()
    ctx.moveTo(x, y + dy)
    ctx.bezierCurveTo(x - r * 0.35, cy + dy + r * 0.95, x - r, cy + dy + r * 0.45, x - r, cy + dy)
    ctx.arc(x, cy + dy, r, Math.PI, 0)
    ctx.bezierCurveTo(x + r, cy + dy + r * 0.45, x + r * 0.35, cy + dy + r * 0.95, x, y + dy)
    ctx.closePath()
  }
  ctx.globalAlpha = ghost ? 0.55 : 1
  drop(1.5)
  ctx.fillStyle = 'rgba(0,0,0,.35)'
  ctx.fill()
  drop(0)
  ctx.fillStyle = c
  ctx.fill()
  ctx.lineWidth = sel ? 2.5 : 1.6
  ctx.strokeStyle = sel ? '#fff' : 'rgba(20,14,8,.9)'
  ctx.stroke()
  ctx.font = `700 ${sel ? 13 : 12}px "Golos Text", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.fillText(glyph, x, cy + 0.5)
  if (label) {
    ctx.textAlign = 'left'
    ctx.font = '600 12px "Golos Text", system-ui, sans-serif'
    ctx.lineWidth = 3.5
    ctx.strokeStyle = 'rgba(20,14,8,.85)'
    ctx.strokeText(label, x + r + 4, cy + 1)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, x + r + 4, cy + 1)
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
  ctx.arc(x, y, 20, 0, Math.PI * 2)
  ctx.stroke()
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    ctx.beginPath()
    ctx.moveTo(x + dx * 24, y + dy * 24)
    ctx.lineTo(x + dx * 30, y + dy * 30)
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

/**
 * Плавний зум колесом / тачпадом (як Leaflet.SmoothWheelZoom): безперервний масштаб до курсора
 * з легким згасанням. Кожен кадр — map._move, як у flyTo: тайли не скидаються (setView без
 * анімації стирав їх, і мапа на мить чорніла), а центр щокадру тримається в межах мапи —
 * тож після зуму ніщо не «відскакує» назад. Повертає функцію відписки.
 */
export function smoothWheel(map: L.Map) {
  type M = L.Map & {
    _moveStart: (zoomChanged: boolean, noMoveStart: boolean) => void
    _move: (center: L.LatLng, zoom: number) => void
    _moveEnd: (zoomChanged: boolean) => void
    _limitCenter: (center: L.LatLng, zoom: number, bounds?: L.LatLngBounds) => L.LatLng
  }
  const m = map as M
  const el = map.getContainer()
  let goal = map.getZoom()
  let anim = 0
  let endTimer: ReturnType<typeof setTimeout> | undefined
  let moving = false
  let mouse = map.getSize().divideBy(2)
  let anchor = map.getCenter()
  const finish = () => {
    if (anim || !moving) return
    moving = false
    m._moveEnd(true)
  }
  const frame = () => {
    const z = map.getZoom()
    let next = z + (goal - z) * 0.3
    if (Math.abs(goal - next) < 0.003) next = goal
    // точка під курсором лишається під курсором
    const delta = mouse.subtract(map.getSize().divideBy(2))
    let c = map.unproject(map.project(anchor, next).subtract(delta), next)
    // Leaflet зберігає maxBounds уже як LatLngBounds (setMaxBounds перетворює)
    const mb = map.options.maxBounds as L.LatLngBounds | undefined
    if (mb) c = m._limitCenter(c, next, mb)
    if (!moving) { m._moveStart(true, false); moving = true }
    m._move(c, next)
    anim = next === goal ? 0 : requestAnimationFrame(frame)
    if (!anim) { clearTimeout(endTimer); endTimer = setTimeout(finish, 250) }
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (!anim && !moving) { map.stop(); goal = map.getZoom() }
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 600 : e.deltaY
    // щипок на тачпаді приходить як wheel з ctrlKey і дрібним кроком — йому більша чутливість
    goal = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), goal - dy / (e.ctrlKey ? 90 : 320)))
    mouse = map.mouseEventToContainerPoint(e as unknown as MouseEvent)
    anchor = map.containerPointToLatLng(mouse)
    clearTimeout(endTimer)
    if (!anim) anim = requestAnimationFrame(frame)
  }
  el.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    cancelAnimationFrame(anim)
    clearTimeout(endTimer)
    el.removeEventListener('wheel', onWheel)
  }
}

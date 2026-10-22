/*
 * Правила гри для бази з деталей (format 2) — перевірки, а не поради. Працюють на готовому документі (будь-якому, не
 * лише згенерованому): rules(doc, engine) → { errors, warnings, checks, stats }.
 *   checks — по одному рядку на правило ({ id, title, ok, n }) для переліку ✓ / ✗ у генераторі;
 *   errors / warnings — { rule, text, vars, at } (text — ключ перекладу, at — точка на плані).
 * Правила (від користувача, з гри):
 *   1. уся техніка — у закритому приміщенні (стіни на кожному краї, дах чи пентащит над кожною плиткою); вихід:
 *      наземній — пентащит-портал чи ворота, орні — лише пентащит (вертикальний портал чи горизонтальний над орні);
 *      перед порталом орні — смуга вильоту: на 8 назовні на висоті прорізу (вище першого ряду) нічого не стоїть;
 *   2. пентащит — строгий прямокутник на квадратах;
 *   3. грузовий — один на ангар 6 заввишки; вилітає прямо: портал ≥ 9 × 6 навпроти носа чи корми (наскрізний чи з одного
 *      боку) або пентащит у даху над усім грузовим;
 *   4. стабільність кожної деталі > 10 % (нижче 20 % — попередження);
 *   5. похилі стіни лише на квадратах, трикутних скатів нема;
 *   6. сходи — прямим маршем; драбина — на стіні, з люком угорі;
 *   7. відкриті зверху плити — деталі даху;
 *   8. станції не виходять за похилі стіни (на висоті h панель на h/3 всередину), не перетинаються, у межах ділянок;
 *   9. деталі не перетинаються й лежать у межах ділянок.
 */
import { obb, overlap } from './geom.mjs'

const EPS = 1e-6
const r3 = (v) => Math.round(v * 1000) / 1000
const near = (a, b, e = 1e-3) => Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e

/** назви правил (ключі перекладу) */
export const RULES = [
  ['shelter', 'Уся техніка — у закритих ангарах і гаражах'],
  ['exit', 'Вихід техніки — крізь пентащит (наземній — і ворота)'],
  ['shield', 'Пентащит — строгий прямокутник на квадратах'],
  ['carrier', 'Грузовий — один на ангар 6 заввишки; вихід — портал ≥ 9 × 6 прямо по осі чи щит у даху над ним'],
  ['stability', 'Стабільність кожної деталі > 10 % (ціль ≥ 20 %)'],
  ['slopes', 'Похилі стіни лише на квадратах, трикутних скатів нема'],
  ['stairs', 'Сходи — прямим маршем, драбина — на стіні з люком'],
  ['roofs', 'Відкриті зверху поверхні — деталі даху'],
  ['stations', 'Станції — на підлозі, під стелею, не за похилими стінами, не одна в одній, у межах ділянок'],
  ['pieces', 'Деталі не перетинаються й лежать у межах ділянок'],
]

export function rules(doc, E) {
  const { PIECES, STABILITY } = E
  const S = PIECES.SHAPES
  const pieces = doc.pieces || [], items = doc.items || [], claims = doc.claims || []
  const errors = [], warnings = []
  const err = (rule, text, vars, at) => errors.push({ rule, text, vars, at: at ? { x: r3(at.x), y: r3(at.y) } : undefined })
  const warn = (rule, text, vars, at) => warnings.push({ rule, text, vars, at: at ? { x: r3(at.x), y: r3(at.y) } : undefined })
  const fam = (p) => S[p.shape]?.family
  const isSlab = (p) => S[p.shape]?.at === 'tile' && (fam(p) === 'slab' || p.shape === 'Choam_PentashieldSurfaceHorizontal_Placeable')
  const fp = new Map(pieces.filter((p) => S[p.shape]).map((p) => [p.id, PIECES.footprint(p)]))

  // ---------- індекси ----------
  // плити за висотою: z → [{ p, poly }]
  const slabsAt = new Map()
  for (const p of pieces) if (isSlab(p)) {
    const z = r3(p.z)
    if (!slabsAt.has(z)) slabsAt.set(z, [])
    slabsAt.get(z).push({ p, poly: fp.get(p.id).poly })
  }
  // деталі на краях: одиничні відрізки → [{ p, z0, z1 }]
  const ekey = (a, b) => { const ka = PIECES.keyOf(a), kb = PIECES.keyOf(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka }
  const units = (a, b) => {
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)))
    return Array.from({ length: n }, (_, i) => [{ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, { x: a.x + ((b.x - a.x) * (i + 1)) / n, y: a.y + ((b.y - a.y) * (i + 1)) / n }])
  }
  const onEdge = new Map()
  for (const p of pieces) {
    const f = fp.get(p.id)
    if (!f || f.at !== 'edge') continue
    for (const [a, b] of units(f.seg.a, f.seg.b)) {
      const k = ekey(a, b)
      if (!onEdge.has(k)) onEdge.set(k, [])
      onEdge.get(k).push({ p, z0: f.z0, z1: f.z1 })
    }
  }
  // похилі стіни (tall_ramp*) за плиткою й висотою
  const ramps = pieces.filter((p) => S[p.shape]?.kind === 'lean')
  const rampAt = new Map(ramps.map((p) => [PIECES.keyOf(p) + '|' + r3(p.z), p]))
  // що над плиткою: будь-яка плита, скат чи щит вище z
  const tileKey = (q) => PIECES.keyOf(q)
  const overhead = new Map()
  for (const p of pieces) {
    const s = S[p.shape]
    if (!s || s.at !== 'tile') continue
    const k = tileKey(p)
    if (!overhead.has(k)) overhead.set(k, [])
    overhead.get(k).push(p)
  }
  // над плиткою на висоті z щось є: плита, скат чи щит вище, або похила стіна з цієї ж висоти (панель накриває плитку)
  const coveredAbove = (t, z) => (overhead.get(tileKey(t)) || []).some((q) => (q.z > z + 0.5 && (isSlab(q) || fam(q) === 'slope')) || (Math.abs(q.z - z) < EPS && S[q.shape]?.kind === 'lean'))

  /** закриває край на висоті z (перший ряд над підлогою): стіна (не прохід), двері, ворота, щит */
  const OPEN = new Set(['Sardaukar_Passageway', 'Sardaukar_Door_Frame_Wide', 'Watershippers_Arch_01'])
  const closer = (a, b, z) => (onEdge.get(ekey(a, b)) || []).filter((e) => e.z0 <= z + 0.01 && e.z1 > z + 0.01 && ['wall', 'wedge', 'shield'].includes(fam(e.p)) && !OPEN.has(e.p.shape))

  const walls = pieces.filter((p) => p.shape === 'Choam_PentashieldSurfaceVertical_Placeable')
  const floors = pieces.filter((p) => p.shape === 'Choam_PentashieldSurfaceHorizontal_Placeable')

  // ---------- 1–3: техніка ----------
  const vehicles = items.filter((it) => it.group === 'vehicle' || it.kind === 'vehicle' || it.kind === 'air')
  const roomOf = new Map() // ключ приміщення → { tiles, boundary, height }
  let sheltered = 0
  const carriers = new Map()
  for (const it of vehicles) {
    const z = r3(it.z || 0)
    const air = it.kind === 'air'
    const label = it.name || it.type
    const list = slabsAt.get(z) || []
    const start = list.find((x) => pointIn(it.c, x.poly))
    if (!start) { err('shelter', '«{name}» стоїть не на плиті', { name: label }, it.c); continue }
    // приміщення: плити тієї ж висоти, з'єднані краями без стін
    const key = z + '|' + start.p.id
    let room = [...roomOf.values()].find((r) => r.z === z && r.ids.has(start.p.id))
    if (!room) {
      room = flood(start, list, z)
      roomOf.set(key, room)
    }
    if (room.leak) { err('shelter', '«{name}» стоїть надворі: з приміщення є вихід без стіни чи щита', { name: label }, room.leak); continue }
    const open = room.tiles.find((t) => !coveredAbove(t.p, z))
    if (open) { err('shelter', '«{name}» без даху: над приміщенням відкрите небо', { name: label }, open.p); continue }
    sheltered++
    // виходи: вертикальні щити (групи) й ворота на межі; горизонтальний щит над техніка
    const portals = room.portals
    const box = obb(it.c, it.w, it.d, it.ang || 0)
    const need = air ? { w: it.type === 'OrnithopterTransport' ? 9 : 5, h: it.type === 'OrnithopterTransport' ? 6 : 3 } : { w: Math.ceil(it.d + 0.5), h: Math.ceil(it.h) }
    const t = ((it.ang || 0) * Math.PI) / 180, ax = { x: Math.cos(t), y: Math.sin(t) }
    // грузовий вилітає прямо — портал має стояти поперек його осі (навпроти носа чи корми)
    const wide = portals.filter((g) => g.w >= need.w - EPS && g.h >= need.h - EPS && (air ? g.shield : true) && (it.type !== 'OrnithopterTransport' || Math.abs(Math.abs(ax.x * g.n.x + ax.y * g.n.y) - 1) < 0.02))
    // щит у даху над усією технікою: орні злітають угору, наземну й контейнер забирає грузовий згори
    const roofShield = room.skies.some((g) => box.every((q) => pointIn(q, g.poly, 0.05)))
    if (it.type === 'OrnithopterTransport') { if (!wide.length && !roofShield) err('carrier', 'Грузовому потрібен вихід: портал ≥ 9 × 6 навпроти носа чи корми або пентащит у даху над усім грузовим', {}, it.c) }
    else if (it.type === 'ContainerVehicle') {
      // контейнер сам не їздить — його забирає грузовий: щит у даху над ним чи портал, у який грузовий залітає
      if (!roofShield && !portals.some((g) => g.shield && g.w >= 9 - EPS && g.h >= 6 - EPS)) err('exit', '«{name}» забирає грузовий: потрібен щит у даху над ним чи портал ≥ 9 × 6', { name: label }, it.c)
    } else if (!wide.length && !roofShield) err('exit', air ? '«{name}»: нема пентащита-порталу ≥ {w} × {h} чи щита в даху над ним' : '«{name}»: нема виходу ≥ {w} × {h} (пентащит чи ворота)', { name: label, w: need.w, h: need.h }, it.c)
    // орні вилітає крізь портал — перед ним смуга вильоту має бути вільною (щит у даху — і так угору)
    if (air && wide.length) {
      const free = wide.filter((g) => laneFree(g, need.h))
      if (!free.length && !roofShield) err('exit', '«{name}»: перед порталом перешкода — смуга вильоту має бути вільною', { name: label }, it.c)
      else if (free.length < wide.length) warn('exit', '«{name}»: перед одним із порталів перешкода — вилетіти можна лише крізь інший', { name: label }, it.c)
    }
    if (it.type === 'OrnithopterTransport') {
      carriers.set(room, [...(carriers.get(room) || []), it])
      // висота над самим грузовим: найнижче, що є над плитками під ним
      let ceil = Infinity
      for (const t of room.tiles) if (pointIn(cen(t.poly), box, 0.3)) for (const q of overhead.get(tileKey(t.p)) || []) if (q.z > z + 0.5 && (isSlab(q) || fam(q) === 'slope')) ceil = Math.min(ceil, q.z - z)
      if (ceil < 6 - EPS) err('carrier', 'Ангар грузового нижчий за 6', {}, it.c)
    }
  }
  for (const [, list] of carriers) if (list.length > 1) err('carrier', 'В одному ангарі — не більше одного грузового', {}, list[1].c)

  // ---------- 2: пентащити ----------
  for (const g of groupWalls(walls)) {
    if (!g.rect) err('shield', 'Пентащит не прямокутний ({n} секцій)', { n: g.list.length }, g.list[0])
    // на квадратах: під низом щита — квадратні плити (чи земля)
    const bottom = g.list.filter((p) => Math.abs(p.z - g.z0) < EPS)
    for (const p of bottom) {
      const f = fp.get(p.id)
      const ts = (slabsAt.get(r3(p.z)) || []).filter((x) => hasEdge(x.poly, f.seg.a, f.seg.b))
      if (ts.some((x) => S[x.p.shape].tile === 't')) { err('shield', 'Пентащит стоїть на краю трикутника — лише на квадратах', {}, p); break }
    }
  }
  for (const g of groupFloors(floors)) if (!g.rect) err('shield', 'Пентащит у даху не прямокутний ({n} секцій)', { n: g.list.length }, g.list[0])

  // ---------- 4: стабільність ----------
  const st = STABILITY.compute(pieces)
  let min = 100
  for (const p of pieces) {
    const s = S[p.shape]
    if (!s || s.shield || s.family === 'rail' || s.family === 'ladder') continue
    const v = st.get(p.id) ?? 0
    min = Math.min(min, v)
    if (v <= 10) err('stability', '{shape}: стабільність {v} % — у грі не поставиться', { shape: s.name, v }, p)
    else if (v < 20) warn('stability', '{shape}: стабільність {v} % — краще ≥ 20 %', { shape: s.name, v }, p)
  }

  // ---------- 5: скати ----------
  for (const p of pieces) {
    if (S[p.shape].cat === 'roof' && S[p.shape].family === 'slope' && S[p.shape].tile === 't') err('slopes', 'Трикутних скатів у грі нема', {}, p)
    if (S[p.shape].kind === 'lean' && S[p.shape].tile !== 's') err('slopes', 'Похила стіна — лише на квадраті', {}, p)
  }

  // ---------- 6: сходи й драбини ----------
  for (const p of pieces) if (['Sardaukar_Stairs_Corner', 'Sardaukar_Stairs_Corner_Inward', 'Sardaukar_Stairs_Corner_Half', 'Sardaukar_Stairs_Corner_Half_Inward'].includes(p.shape)) err('stairs', 'Сходи — лише прямим маршем (кутових і гвинтових нема)', {}, p)
  const stairs = pieces.filter((p) => ['Sardaukar_Stairs', 'Atreides_Outpost_Stair_Wide', 'Sardaukar_Stairs_Half'].includes(p.shape))
  for (const p of stairs) {
    // попередня сходинка: позаду (вниз по локальній −y) на блок нижче, той самий поворот; або підлога під низом
    const t = ((p.rot + 90) * Math.PI) / 180, back = { x: p.x - Math.cos(t), y: p.y - Math.sin(t) }
    const prev = stairs.some((q) => near(q, back) && Math.abs(q.z - (p.z - 1)) < EPS && Math.abs(((q.rot - p.rot + 540) % 360) - 180) < 0.5)
    const floor = (slabsAt.get(r3(p.z)) || []).some((x) => near(x.p, p) || near(x.p, back)) || p.z < EPS
    if (!prev && !floor) err('stairs', 'Сходинка без попередньої — марш має йти прямо', {}, p)
  }
  const ladders = pieces.filter((p) => fam(p) === 'ladder')
  for (const p of ladders) {
    const f = fp.get(p.id)
    const wall = (onEdge.get(ekey(f.seg.a, f.seg.b)) || []).some((e) => e.p !== p && ['wall', 'wedge'].includes(fam(e.p)) && e.z0 <= p.z + EPS && e.z1 >= p.z + 1 - EPS)
    if (!wall) err('stairs', 'Драбина має стояти на стіні', {}, p)
    const above = ladders.some((q) => q !== p && near(q, p) && Math.abs(q.z - (p.z + 1)) < EPS)
    if (!above) {
      const hatch = pieces.some((q) => q.shape === 'Choam_Level2_Hatch' && Math.abs(q.z - (p.z + 1)) < EPS && Math.hypot(q.x - p.x, q.y - p.y) < 0.75)
      if (!hatch) err('stairs', 'Над драбиною має бути люк', {}, p)
    }
  }

  // ---------- 7: відкриті зверху плити ----------
  for (const p of pieces) {
    if (!['Sardaukar_Floor_02', 'Sardaukar_Floor', 'Sardaukar_Floor_Wedge', 'Atreides_Outpost_Floor_Triangle_Wide_Left', 'Atreides_Outpost_Floor_Triangle_Wide_Right', 'Sardaukar_Floor_Round_Corner_02', 'Sardaukar_Floor_Round_Corner', 'MTX_Atreides_Outpost_FloorLight_Movie'].includes(p.shape)) continue
    if (!coveredAbove(p, p.z)) err('roofs', 'Відкриту зверху плиту кладуть деталлю даху', {}, p)
  }

  // ---------- 8: станції ----------
  const boxes = items.map((it) => ({ it, poly: obb(it.c, it.w || 1, it.d || 1, it.ang || 0) }))
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]
    if (Math.abs((a.it.z || 0) - (b.it.z || 0)) > 0.5) continue
    if (overlap(a.poly, b.poly, -0.02)) err('stations', '«{a}» і «{b}» стоять одна в одній', { a: a.it.name, b: b.it.name }, a.it.c)
  }
  const inClaims = (q) => claims.some((c) => q.x >= c.x - 1e-6 && q.x <= c.x + c.w + 1e-6 && q.y >= c.y - 1e-6 && q.y <= c.y + c.d + 1e-6)
  for (const { it, poly } of boxes) {
    if (!poly.every(inClaims)) err('stations', '«{name}» виходить за межі ділянок', { name: it.name }, it.c)
    // підлога під станцією на її висоті
    const floor = (slabsAt.get(r3(it.z || 0)) || []).find((x) => pointIn(it.c, x.poly, 1e-4))
    if (!floor) err('stations', '«{name}» стоїть не на підлозі', { name: it.name }, it.c)
    // і влазить під стелю (найнижче, що є над нею)
    else if (it.h) {
      const over = (overhead.get(tileKey(floor.p)) || []).filter((q) => q.z > (it.z || 0) + 0.5 && (isSlab(q) || fam(q) === 'slope'))
      const top = Math.min(...over.map((q) => q.z))
      if (Number.isFinite(top) && (it.z || 0) + it.h > top + 0.05) err('stations', '«{name}» не влазить під стелю', { name: it.name }, it.c)
    }
    // похилі стіни: у плитці з панеллю кут станції має бути всередину від панелі на висоті станції
    const hh = Math.min(it.h || 1, 3)
    for (const q of poly) {
      for (const p of ramps) {
        if (Math.abs(p.z - (it.z || 0)) > EPS) continue
        const t = (p.rot * Math.PI) / 180, lx = (q.x - p.x) * Math.cos(t) + (q.y - p.y) * Math.sin(t), ly = -(q.x - p.x) * Math.sin(t) + (q.y - p.y) * Math.cos(t)
        if (Math.abs(lx) > 0.5 + EPS || Math.abs(ly) > 0.5 + EPS) continue
        const corner = /corner/i.test(p.shape)
        if (corner || ly < -0.5 + hh / 3 - EPS) { err('stations', '«{name}» заходить за похилу стіну', { name: it.name }, it.c); break }
      }
    }
  }

  // ---------- 9: деталі ----------
  let clashes = 0, outside = 0
  {
    const bucket = new Map()
    const add = (k, p) => { if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(p) }
    for (const p of pieces) {
      const f = fp.get(p.id)
      if (!f) { err('pieces', 'Невідома деталь {shape}', { shape: p.shape }, p); continue }
      if (f.at === 'edge') for (const [a, b] of units(f.seg.a, f.seg.b)) add('e' + PIECES.keyOf({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }), p)
      else if (f.at === 'tile') add('t' + PIECES.keyOf(p), p)
      else add('v' + PIECES.keyOf(p), p)
      const pts = f.at === 'tile' ? f.poly : f.at === 'edge' ? [f.seg.a, f.seg.b] : [f.pt]
      if (!pts.every(inClaims)) { outside++; if (outside <= 3) err('pieces', '{shape} виходить за межі ділянок', { shape: S[p.shape].name }, p) }
    }
    for (const list of bucket.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (PIECES.clash(list[i], list[j])) { clashes++; if (clashes <= 3) err('pieces', '{a} і {b} перетинаються', { a: S[list[i].shape].name, b: S[list[j].shape].name }, list[i]) }
    }
  }

  const checks = RULES.map(([id, title]) => ({ id, title, ok: !errors.some((e) => e.rule === id), n: errors.filter((e) => e.rule === id).length, warn: warnings.filter((e) => e.rule === id).length }))
  return {
    errors, warnings, checks,
    stats: { pieces: pieces.length, items: items.length, vehicles: vehicles.length, sheltered, minStability: min, clashes, outside },
  }

  // ---------- приміщення навколо техніки ----------
  function flood(start, list, z) {
    const byEdge = new Map()
    for (const x of list) for (let i = 0; i < x.poly.length; i++) {
      const k = ekey(x.poly[i], x.poly[(i + 1) % x.poly.length])
      if (!byEdge.has(k)) byEdge.set(k, [])
      byEdge.get(k).push(x)
    }
    const seen = new Set([start.p.id]), q = [start], tiles = [start]
    const portalEdges = [], gateEdges = []
    let leak = null, height = Infinity
    while (q.length) {
      const x = q.shift()
      const outer = lowEdges(x.p, z)
      for (let i = 0; i < x.poly.length; i++) {
        const a = x.poly[i], b = x.poly[(i + 1) % x.poly.length]
        const k = ekey(a, b)
        const cl = closer(a, b, z)
        const other = (byEdge.get(k) || []).find((y) => y !== x)
        // край, де панель похилої стіни стоїть низом (її чи сусідньої плитки — обернені похилі), закритий панеллю
        if (outer.has(k) || (other && lowEdges(other.p, z).has(k))) continue
        if (cl.length) {
          // висота приміщення — найнижчий верх стін по межі (стіни рядами: суцільна колонка від z)
          height = Math.min(height, columnTop(k, z) - z)
          const sh = cl.find((e) => fam(e.p) === 'shield')
          if (sh) portalEdges.push({ a, b, k, c: cen(x.poly) })
          if (cl.some((e) => e.p.shape === 'Atreides_Outpost_Gate_Big' || e.p.shape === 'Sardaukar_Garage_Door_Frame')) gateEdges.push({ a, b, k, p: cl.find((e) => e.p.shape === 'Atreides_Outpost_Gate_Big' || e.p.shape === 'Sardaukar_Garage_Door_Frame').p })
          continue
        }
        if (other) { if (!seen.has(other.p.id)) { seen.add(other.p.id); q.push(other); tiles.push(other) } continue }
        // проріз у підлозі (сходи) під дахом — шахта всередину будівлі, а не надвір
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, c = cen(x.poly)
        const beyond = { x: 2 * m.x - c.x, y: 2 * m.y - c.y }
        if ((overhead.get(tileKey(beyond)) || []).some((o) => o.z < z - 0.5) && coveredAbove(beyond, z)) continue
        leak = leak || { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      }
    }
    // портали: щити на межі приміщення, згруповані в площині — ширина × висота
    const portals = []
    for (const g of groupWalls(walls)) {
      const ks = new Set(g.list.filter((p) => Math.abs(p.z - z) < EPS).flatMap((p) => { const f = fp.get(p.id); return units(f.seg.a, f.seg.b).map(([a, b]) => ekey(a, b)) }))
      if (![...ks].some((k) => portalEdges.some((e) => e.k === k))) continue
      if (g.z0 > z + EPS) continue
      portals.push({ shield: true, w: g.w, h: g.z1 - z, n: g.n, edges: portalEdges.filter((e) => ks.has(e.k)), z })
    }
    for (const e of gateEdges) { const s = S[e.p.shape]; portals.push({ shield: false, w: s.len, h: s.h, n: { x: 0, y: 0 } }) }
    // щити в даху над приміщенням
    const ids = new Set(tiles.map((t) => t.p.id))
    const skies = groupFloors(floors).filter((g) => g.rect && g.list.some((p) => tiles.some((t) => near(t.p, p)) && p.z > z)).map((g) => ({ poly: g.poly }))
    return { z, ids, tiles, leak, portals, skies, height: Number.isFinite(height) ? height : 0 }
  }
  /**
   * смуга вильоту перед порталом g: прямокутник уздовж порталу на 8 назовні, по висоті — від другого ряду прорізу до
   * верху h (у першому ряду можна поручні й напівстіни тераси); чи нема там жодної деталі
   */
  function laneFree(g, h) {
    const e0 = g.edges[0]
    if (!e0) return true
    const L = Math.hypot(e0.b.x - e0.a.x, e0.b.y - e0.a.y) || 1
    const U = { x: (e0.b.x - e0.a.x) / L, y: (e0.b.y - e0.a.y) / L }
    const m = { x: (e0.a.x + e0.b.x) / 2, y: (e0.a.y + e0.b.y) / 2 }
    let D = { x: -U.y, y: U.x }
    if ((m.x - e0.c.x) * D.x + (m.y - e0.c.y) * D.y < 0) D = { x: -D.x, y: -D.y }
    const us = g.edges.flatMap((e) => [e.a, e.b]).map((q) => (q.x - m.x) * U.x + (q.y - m.y) * U.y)
    const u0 = Math.min(...us) + 0.05, u1 = Math.max(...us) - 0.05
    const inLane = (q) => { const u = (q.x - m.x) * U.x + (q.y - m.y) * U.y, v = (q.x - m.x) * D.x + (q.y - m.y) * D.y; return u > u0 && u < u1 && v > 0.05 && v < 8 }
    const z0 = g.z + 1, z1 = g.z + h
    for (const p of pieces) {
      const f = fp.get(p.id)
      if (!f || !(f.z0 < z1 - EPS && f.z1 > z0 + EPS)) continue
      const pts = f.at === 'tile' ? [...f.poly, cen(f.poly)] : f.at === 'edge' ? [f.seg.a, f.seg.b, { x: (f.seg.a.x + f.seg.b.x) / 2, y: (f.seg.a.y + f.seg.b.y) / 2 }] : f.at === 'vertex' ? [f.pt] : []
      if (pts.some(inLane)) return false
    }
    return true
  }
  /** краї плитки, на яких стоїть низом панель похилої стіни (обидва кути внизу) */
  function lowEdges(tileP, z) {
    const ramp = rampAt.get(PIECES.keyOf(tileP) + '|' + z)
    const out = new Set()
    if (!ramp) return out
    const poly = fp.get(ramp.id).poly, hs = S[ramp.shape].hs || []
    for (let i = 0; i < poly.length; i++) if (!hs[i] && !hs[(i + 1) % poly.length]) out.add(ekey(poly[i], poly[(i + 1) % poly.length]))
    return out
  }
  /** верх суцільної колонки деталей на краї k від висоти z */
  function columnTop(k, z) {
    const list = (onEdge.get(k) || []).filter((e) => ['wall', 'wedge', 'shield'].includes(fam(e.p)))
    let top = z
    for (;;) {
      const nx = list.find((e) => e.z0 <= top + 0.01 && e.z1 > top + 0.01)
      if (!nx) return top
      top = nx.z1
    }
  }
  /** вертикальні щити: групи в одній площині, з'єднані краями чи рядами; прямокутник — усі клітинки ширина × висота */
  function groupWalls(list) {
    const out = []
    const left = new Set(list)
    while (left.size) {
      const first = left.values().next().value
      left.delete(first)
      const g = [first], q = [first]
      const rot0 = ((first.rot % 180) + 180) % 180
      const t = (first.rot * Math.PI) / 180, U = { x: Math.cos(t), y: Math.sin(t) }
      const n = { x: -U.y, y: U.x }
      const off = (p) => p.x * n.x + p.y * n.y
      while (q.length) {
        const p = q.shift()
        for (const o of [...left]) {
          const r = ((o.rot % 180) + 180) % 180
          if (Math.abs(r - rot0) > 0.5 || Math.abs(off(o) - off(first)) > 1e-3) continue
          const along = Math.abs((o.x - p.x) * U.x + (o.y - p.y) * U.y)
          const dz = Math.abs(o.z - p.z)
          if ((dz < EPS && Math.abs(along - 1) < 1e-3) || (Math.abs(dz - 1) < EPS && along < 1e-3)) { left.delete(o); g.push(o); q.push(o) }
        }
      }
      const s = g.map((p) => Math.round((p.x * U.x + p.y * U.y) * 1000) / 1000)
      const zs = g.map((p) => p.z)
      const cols = new Set(s), rows = new Set(zs.map(r3))
      const w = cols.size, h = rows.size
      const z0 = Math.min(...zs), z1 = Math.max(...zs) + 1
      const span = Math.max(...s) - Math.min(...s) + 1, zspan = z1 - z0
      out.push({ list: g, rect: g.length === w * h && Math.abs(span - w) < 1e-3 && Math.abs(zspan - h) < 1e-3, w, h, z0, z1, n })
    }
    return out
  }
  /** щити в даху: групи на одній висоті, сусідні краями, однаково повернуті квадрати; прямокутник у своїй сітці */
  function groupFloors(list) {
    const out = []
    const left = new Set(list)
    while (left.size) {
      const first = left.values().next().value
      left.delete(first)
      const g = [first], q = [first]
      const t = (first.rot * Math.PI) / 180, U = { x: Math.cos(t), y: Math.sin(t) }, V = { x: -U.y, y: U.x }
      while (q.length) {
        const p = q.shift()
        for (const o of [...left]) {
          if (Math.abs(o.z - p.z) > EPS) continue
          const du = (o.x - p.x) * U.x + (o.y - p.y) * U.y, dv = (o.x - p.x) * V.x + (o.y - p.y) * V.y
          if ((Math.abs(Math.abs(du) - 1) < 1e-3 && Math.abs(dv) < 1e-3) || (Math.abs(Math.abs(dv) - 1) < 1e-3 && Math.abs(du) < 1e-3)) { left.delete(o); g.push(o); q.push(o) }
        }
      }
      const us = g.map((p) => (p.x - first.x) * U.x + (p.y - first.y) * U.y), vs = g.map((p) => (p.x - first.x) * V.x + (p.y - first.y) * V.y)
      const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs)
      const w = Math.round(u1 - u0) + 1, h = Math.round(v1 - v0) + 1
      const grid = g.every((p, i) => Math.abs(us[i] - Math.round(us[i])) < 1e-3 && Math.abs(vs[i] - Math.round(vs[i])) < 1e-3)
      const P = (u, v) => ({ x: first.x + U.x * u + V.x * v, y: first.y + U.y * u + V.y * v })
      out.push({ list: g, rect: grid && g.length === w * h, poly: [P(u0 - 0.5, v0 - 0.5), P(u1 + 0.5, v0 - 0.5), P(u1 + 0.5, v1 + 0.5), P(u0 - 0.5, v1 + 0.5)] })
    }
    return out
  }
}

/** точка в многокутнику (опуклому, будь-якого обходу) з допуском e назовні */
function pointIn(q, poly, e = 1e-6) {
  let sgn = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const c = ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) / L
    if (Math.abs(c) <= e) continue
    const s = Math.sign(c)
    if (!sgn) sgn = s
    else if (s !== sgn) return false
  }
  return true
}
const cen = (ps) => ({ x: ps.reduce((s, q) => s + q.x, 0) / ps.length, y: ps.reduce((s, q) => s + q.y, 0) / ps.length })
function hasEdge(poly, a, b) {
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    if ((near(p, a) && near(q, b)) || (near(p, b) && near(q, a))) return true
  }
  return false
}

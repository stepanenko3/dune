/*
 * Зведення для головної: що зараз у Глибокій пустелі (тиждень, руда й меланж за секторами) і стан «Наших ресурсів»
 * (того, що бачить людина). Рахується з тих самих даних, що й мапа для поточної розкладки:
 *   • точки (титан, стравідій, поля меланжу, уламки, станції, печери) — з того ж джерела, що й мапа: файли гри, коли
 *     адмін перемкнув групу «Мапа» на них і точки вже застосовано (lib/gamemap.mjs), інакше — основне джерело мапи;
 *   • великі поля меланжу — ще й місця з файлів гри та з позначок гравців (lib/spice.mjs), як їх домальовує мапа;
 *   • активні поля — позначки гравців, які бачить саме ця людина (свої, гільдії, публічні).
 */
import express from 'express'
import { bestSpot } from '../../src/lib/map/spot.mjs'

const N = 9
/** чистий острівець руди: стільки місць у секторі, де руда завжди одна (частка 100 %) */
const ISLAND = 20
const DD = 'deepdesert_1'
/** сектор A1…I9: ряд A — знизу (найбільший x гри), стовпці 1…9 — зліва (найменший y) */
function sector(b, x, y) {
  const ch = (b[1][0] - b[0][0]) / N, cw = (b[1][1] - b[0][1]) / N
  const r = Math.floor((b[1][0] - x) / ch), c = Math.floor((y - b[0][1]) / cw)
  return r < 0 || c < 0 || r >= N || c >= N ? null : String.fromCharCode(65 + r) + (c + 1)
}

/**
 * Шари головної — типи точок мапи в кожному джерелі (ті самі id, що вмикає мапа): основне джерело мапи зве їх
 * по-своєму, файли гри — типами міток гри (CDT_FullscreenMapMarkers)
 */
const LAYERS = {
  base: { titanium: 'titanium', stravidium: 'stravidium', spice_small: 'spice_field_small', spice_medium: 'spice_field_medium', spice_large: 'spice_field_large', shipwreck: 'shipwreck', ecolab: 'ecolab', cave: 'cave' },
  game: { titanium: 'TitaniumOre', stravidium: 'StravidiumOre', spice_small: 'SpiceFieldSmall', spice_medium: 'SpiceFieldMedium', spice_large: 'SpiceFieldLarge', shipwreck: 'Shipwreck', ecolab: 'EcoLab', cave: 'Cave' },
}

export function createHomeRoutes({ mapData, places, items, spice = null, game = null, gamemap = null }) {
  const r = express.Router()
  /** звідки точки: файли гри чи основне джерело — так само, як вирішує мапа (routes/map.mjs) */
  const fromGame = async () => !!gamemap && (await game?.getPrimary('markers')) === 'gamefiles' && (await gamemap.ready())
  r.get('/api/home', async (req, res, next) => {
    try {
      mapData.refresh().catch(() => {}) // головна теж показує тиждень DD — хай підтягує нову розкладку
      const isGame = await fromGame()
      const src = isGame ? await gamemap.source() : mapData.source
      const L = isGame ? LAYERS.game : LAYERS.base
      const dd = src?.maps.find((m) => m.id === DD)
      const lay = dd?.layouts.find((l) => l.id === dd.layout)
      const P = dd ? await (isGame ? gamemap.points(dd.id, dd.layout, req.lang) : mapData.points(dd.id, dd.layout)) : null
      const seen = [...mapData.ddHistory()].reverse().find((h) => h.layout === dd?.layout)
      // поля меланжу, які бачить людина: місця великих полів (файли гри + позначки) і активні зараз
      const sp = dd && spice ? await spice.view(req.ctx, DD, dd.layout ?? null) : { spots: [], fields: [] }
      /**
       * точки шару [x, y, …] — великі поля разом із місцями з файлів гри й позначок (як на мапі); руда з файлів гри —
       * очікувана кількість (лише місця, де жереб місця випав на цю руду), як типовий вид мапи
       */
      const ptsOf = (k) => {
        const T = P?.types[L[k]]
        if (T?.pick) return T.pts.filter((_, j) => T.pick[Math.floor(j / 3)])
        const pts = T?.pts ?? []
        if (k !== 'spice_large' || !sp.spots.length) return pts
        const have = new Set()
        for (let i = 0; i < pts.length; i += 3) have.add(`${Math.round(pts[i])}:${Math.round(pts[i + 1])}`)
        return [...pts, ...sp.spots.filter((s) => !have.has(`${s.x}:${s.y}`)).flatMap((s) => [s.x, s.y, 0])]
      }
      /**
       * найкращі сектори: [сектор, вузлів]. Руда з часткою (файли гри) — за певністю: сума квадратів частки місць (чистий
       * острівець, 100 %, важить у 40 разів більше за змішане місце на 16 %), а вузлів — очікувана кількість; інше — за
       * кількістю точок
       */
      const bySector = (k) => {
        const pts = ptsOf(k)
        const m = new Map(), score = new Map()
        for (let i = 0; i < pts.length; i += 3) {
          const s = sector(dd.bounds, pts[i], pts[i + 1])
          if (s) m.set(s, (m.get(s) || 0) + 1)
        }
        const T = P?.types[L[k]]
        const pure = new Map()
        if (T?.share) {
          for (let i = 0; i < T.share.length; i++) {
            const s = sector(dd.bounds, T.pts[i * 3], T.pts[i * 3 + 1])
            if (!s) continue
            score.set(s, (score.get(s) || 0) + (T.share[i] / 100) ** 2)
            if (T.share[i] >= 100) pure.set(s, (pure.get(s) || 0) + 1)
          }
        }
        // чистий острівець — сектор, де руда в багатьох місцях завжди одна: усі такі — першими, з позначкою 1
        const island = (s) => (pure.get(s) || 0) >= ISLAND
        const by = (s) => (T?.share ? score.get(s) || 0 : m.get(s) || 0)
        return [...m.entries()]
          .sort((a, b) => Number(island(b[0])) - Number(island(a[0])) || by(b[0]) - by(a[0]) || b[1] - a[1])
          .slice(0, 5)
          .map(([s, n]) => (island(s) ? [s, n, 1] : [s, n]))
      }
      const count = (k) => ptsOf(k).length / 3
      // меланж: найкраща точка — звідки в межах ¾ сектора найбільше середніх і великих полів (туди найшвидше до них)
      const spiceSpot = (() => {
        if (!dd) return null
        const fields = []
        for (const [k, size] of [['spice_medium', 'medium'], ['spice_large', 'large']]) { const p = ptsOf(k); for (let i = 0; i < p.length; i += 3) fields.push([p[i], p[i + 1], size]) }
        const radius = Math.round(((dd.bounds[1][0] - dd.bounds[0][0]) / N) * 0.75)
        const s = bestSpot(fields, radius)
        return s && { ...s, radius, sector: sector(dd.bounds, s.x, s.y) }
      })()
      // точки для hero: поля меланжу й руда — лише координати, без підписів
      const dots = (k, max) => {
        const pts = ptsOf(k)
        const out = []
        const step = Math.max(1, Math.floor(pts.length / 3 / max))
        for (let i = 0; i < pts.length / 3; i += step) out.push([pts[i * 3], pts[i * 3 + 1]])
        return out
      }
      // активні поля — у Глибокій пустелі лише своєї розкладки; найсвіжіші першими
      const active = sp.fields.filter((f) => !dd || sector(dd.bounds, f.x, f.y)).sort((a, b) => b.first - a.first)
      // «Наші ресурси» — те, що людина бачить (свої й гільдій)
      const mine = new Set((await items.list(req.ctx, { kind: 'place', scope: 'shared' })).map((it) => it.id))
      const rows = await places.many([...mine])
      res.set({ 'cache-control': 'private, max-age=30', vary: 'Cookie' }).json({
        dd: dd && {
          layout: dd.layout,
          layouts: dd.layouts.length,
          since: seen?.seenAt ?? null,
          tiles: lay?.tiles ?? dd.tiles,
          bounds: dd.bounds,
          transformation: dd.transformation,
          /** id шарів мапи (для посилань «відкрити шар на мапі») */
          layers: L,
          counts: {
            titanium: count('titanium'), stravidium: count('stravidium'),
            spice_small: count('spice_small'), spice_medium: count('spice_medium'), spice_large: count('spice_large'),
            shipwreck: count('shipwreck'), ecolab: count('ecolab'), cave: count('cave'),
          },
          spiceSpot,
          top: { titanium: bySector('titanium'), stravidium: bySector('stravidium'), spice_medium: bySector('spice_medium'), spice_large: bySector('spice_large') },
          dots: {
            spice_large: dots('spice_large', 80), spice_medium: dots('spice_medium', 140),
            spice_small: dots('spice_small', 200), titanium: dots('titanium', 450), stravidium: dots('stravidium', 450),
          },
        },
        // активні поля, які бачить людина (величина, місце, сектор, з якого часу й до якого — приблизно), окремо від
        // тижня: міняються щохвилини, а мапа тижня від цього не має програватися заново
        active: dd ? { now: Date.now(), total: active.length, fields: active.slice(0, 40).map((f) => ({ size: f.size, x: f.x, y: f.y, sector: sector(dd.bounds, f.x, f.y), first: f.first, expires: f.expires, n: f.n })) } : null,
        places: {
          total: rows.length,
          ok: rows.filter((p) => p.ok).length,
          recent: [...rows].sort((a, b) => b.updated - a.updated).slice(0, 5).map((p) => ({ id: p.id, res: p.res, place: p.place, zone: p.zone, ok: p.ok, updated: p.updated })),
        },
        syncedAt: src?.syncedAt ?? null,
      })
    } catch (e) { next(e) }
  })
  return r
}

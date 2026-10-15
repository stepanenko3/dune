/**
 * Мапа ресурсів — як «Карта» в Satisfactory: тайли гри, усі точки з гри шарами з фільтром
 * за групами й типами, наведення і клік по точці, позначки «зібрано», пошук місць —
 * і поверх наш шар «Наші ресурси» (де брати унікальні ресурси: точки, типи, лут).
 *
 * Deep Desert — окрема мапа, яку буря перебудовує щотижня. TH.GL тримає всі її розкладки
 * (тайли й точки кожного тижня), сервер стежить, яка зараз поточна. Тут можна перемкнути
 * тиждень; наші точки в DD прив'язані до свого тижня і на чужому показуються лише контуром.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Crosshair, Layers, Maximize2, Minus, Plus, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  labelOf, loadIndex, loadLoot, loadPoints, loadSource, MAIN_MAPS, MAP_SHORT, safeDesc,
  type LootHit, type MapDef, type MapIndex, type SourceResp, type TypeDef, type TypePoints,
} from '@/lib/map/data'
import { PointsLayer, iconColors, type Batch, type Hit, type Mark } from '@/lib/map/layer'
import { defaultOn, doneKey, enabledFor, loadDone, pointKey, readUrl, saveDone, saveEnabled, writeUrl } from '@/lib/map/settings'
import { useMapUi } from '@/lib/map/ui'
import { usePlaces } from '@/lib/places'
import { prefGet, prefSet } from '@/lib/prefs'
import { useStore } from '@/store'
import { cn, fmtN } from '@/lib/utils'
import { Seg } from '@/components/ui/seg'
import { SHEET_BASE, SheetBackdrop, SheetHead } from '@/components/ui/sheet'
import { Section, SpriteIcon, SPRITE, TypeRow } from '@/components/map/bits'
import { PlacesSection } from '@/components/map/PlacesSection'
import '@/components/map/map.css'

type Focus = { type: string; i: number; x: number; y: number } | null
const fmtC = (n: number) => (n < 0 ? '−' : '') + fmtN(Math.abs(n))
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })

export default function MapPage() {
  const url0 = useRef(readUrl())
  const [resp, setResp] = useState<SourceResp | null>(null)
  const [failed, setFailed] = useState(false)
  const [mapId, setMapId] = useState<string>(url0.current.m || prefGet('map:map', 'survival_1'))
  const [week, setWeek] = useState<number | null>(url0.current.w ?? null)
  const [enabled, setEnabled] = useState<string[] | null>(null)
  const [index, setIndex] = useState<MapIndex | null>(null)
  const [pts, setPts] = useState<Record<string, TypePoints>>({})
  const [sprite, setSprite] = useState<HTMLImageElement | null>(null)
  const [colors, setColors] = useState<Record<string, string>>({})
  const [done, setDone] = useState<Record<string, string[]>>({})
  const [focus, setFocus] = useState<Focus>(null)
  const [zoom, setZoom] = useState(0)
  const [loot, setLoot] = useState<{ key: string; hits: LootHit[]; loading: boolean } | null>(null)
  const places = usePlaces((s) => s.rows)
  const { selected, select, picking, setPicking, addPin, draft } = useMapUi()
  const sheet = useStore((s) => s.sheet)
  const setSheet = useStore((s) => s.setSheet)

  const def: MapDef | undefined = resp?.source.maps.find((m) => m.id === mapId)
  const isDD = !!def?.layouts.length
  const layout = isDD ? (week ?? def!.layout) : null
  const lay = isDD ? def!.layouts.find((l) => l.id === layout) : undefined
  const tilesDir = lay?.tiles ?? def?.tiles
  const types = useMemo(() => {
    const m = new Map<string, TypeDef & { group: string }>()
    for (const g of resp?.source.groups ?? []) for (const t of g.types) m.set(t.id, { ...t, group: g.id })
    return m
  }, [resp])

  // ---------- завантаження ----------
  useEffect(() => {
    loadSource().then(setResp).catch(() => setFailed(true))
    void usePlaces.getState().load()
    const im = new Image()
    im.onload = () => setSprite(im)
    im.src = SPRITE
    // вибраний запис з адреси (?r=…)
    if (url0.current.r) select(url0.current.r)
    return () => { useMapUi.getState().edit(null) }
  }, [select])

  useEffect(() => {
    if (!sprite || !resp) return
    const icons: Record<string, [number, number, number, number]> = {}
    for (const g of resp.source.groups) for (const t of g.types) if (t.icon) icons[t.id] = t.icon
    setColors(iconColors(sprite, icons))
  }, [sprite, resp])

  // мапа з адреси могла зникнути з TH.GL — тоді Хагга
  useEffect(() => {
    if (resp && !def) setMapId('survival_1')
  }, [resp, def])

  useEffect(() => {
    if (!resp || !def) return
    const u = url0.current
    const fromUrl = u.m === def.id && u.l ? u.l : null
    url0.current = {}
    setEnabled(fromUrl ?? enabledFor(def.id, resp.source.groups))
    if (fromUrl) saveEnabled(def.id, fromUrl)
    prefSet('map:map', def.id)
  }, [resp, def])

  useEffect(() => {
    if (!def) return
    setIndex(null)
    setPts({})
    setFocus(null)
    setDone(loadDone(doneKey(def.id, layout)))
    let live = true
    loadIndex(def.id, layout).then((ix) => live && setIndex(ix)).catch(() => live && toast.error('Не вдалося завантажити точки мапи'))
    return () => { live = false }
  }, [def, layout])

  const place = places.find((p) => p.id === selected) || null
  const ringTypes = useMemo(() => new Set(place?.types.filter((t) => t.map === mapId).map((t) => t.type) ?? []), [place, mapId])

  // точки потрібних типів: увімкнені + ті, що підсвічує вибраний запис
  const needed = useMemo(() => {
    if (!index || !enabled) return []
    const s = new Set([...enabled, ...ringTypes])
    return [...s].filter((t) => index.counts[t])
  }, [index, enabled, ringTypes])
  useEffect(() => {
    if (!def || !index) return
    let live = true
    for (const t of needed) {
      if (pts[t]) continue
      loadPoints(def.id, layout, t).then((p) => live && setPts((cur) => (cur[t] ? cur : { ...cur, [t]: p }))).catch(() => {})
    }
    return () => { live = false }
  }, [needed, def, layout, index, pts])

  // лут вибраного запису на цій мапі
  const lootKey = place?.loot && def ? `${def.id}|${layout}|${place.loot}` : null
  useEffect(() => {
    if (!lootKey || !place || !def) { setLoot(null); return }
    let live = true
    setLoot({ key: lootKey, hits: [], loading: true })
    loadLoot(def.id, layout, place.loot)
      .then((hits) => live && setLoot({ key: lootKey, hits, loading: false }))
      .catch(() => live && setLoot({ key: lootKey, hits: [], loading: false }))
    return () => { live = false }
  }, [lootKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Leaflet ----------
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<PointsLayer | null>(null)
  const coordsRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const handlers = useRef<{ move: (e: L.LeafletMouseEvent) => void; click: (e: L.LeafletMouseEvent) => void }>()

  useEffect(() => {
    if (!def || !tilesDir || !divRef.current) return
    const t = def.transformation
    const crs = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(t[0], t[1], t[2], t[3]) })
    const bounds = L.latLngBounds(def.bounds)
    const map = L.map(divRef.current, {
      crs,
      zoomControl: false,
      minZoom: -6,
      maxZoom: def.maxNativeZoom + 3,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      maxBounds: bounds.pad(0.08),
      maxBoundsViscosity: 0.8,
    })
    map.attributionControl.setPrefix(false)
    L.tileLayer(`/map-tiles/${tilesDir}/{z}/{y}/{x}.webp`, {
      tileSize: def.tileSize,
      // у TileLayer типово minZoom 0, а ціла мапа влазить лише на від'ємному масштабі
      minZoom: -6,
      minNativeZoom: def.minNativeZoom,
      maxNativeZoom: def.maxNativeZoom,
      bounds,
      noWrap: true,
      attribution: 'Мапа й точки — <a href="https://duneawakening.th.gl" target="_blank" rel="noopener">TH.GL</a>',
    }).addTo(map)
    const clamp = () => {
      const whole = map.getBoundsZoom(bounds, false)
      map.setMinZoom(whole - 0.5)
    }
    map.fitBounds(bounds, { animate: false })
    clamp()
    setZoom(map.getZoom())
    map.on('zoomend', () => setZoom(map.getZoom()))
    const ro = new ResizeObserver(() => { map.invalidateSize(); clamp() })
    ro.observe(divRef.current)
    const layer = new PointsLayer()
    layer.spice = `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--c-spice').trim().replace(/ /g, ',')})`
    layer.addTo(map)
    mapRef.current = map
    layerRef.current = layer

    let raf = 0
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => handlers.current?.move(e))
    })
    map.on('mouseout', () => { if (tipRef.current) tipRef.current.hidden = true })
    map.on('click', (e: L.LeafletMouseEvent) => handlers.current?.click(e))
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [def, tilesDir])

  // шар точок
  const batches: Batch[] = useMemo(() => {
    const out: Batch[] = []
    for (const t of needed) {
      const p = pts[t]
      const td = types.get(t)
      if (!p) continue
      out.push({
        type: t,
        pts: p.pts,
        icon: td?.icon ?? null,
        size: td?.size ?? 2,
        color: colors[t] || '#d9c7a3',
        done: done[t]?.length ? new Set(done[t]) : undefined,
      })
    }
    // густі шари (руда, рослини) — знизу, місця й люди — зверху
    return out.sort((a, b) => b.pts.length - a.pts.length)
  }, [needed, pts, types, colors, done])

  const marks: Mark[] = useMemo(() => {
    if (!def) return []
    const out: Mark[] = []
    if (loot && place && loot.key === lootKey) for (const h of loot.hits) out.push({ x: h.x, y: h.y, kind: 'loot', badge: h.chance != null && zoom >= def.maxNativeZoom - 2 ? `${h.chance}%` : undefined })
    for (const p of places) {
      const sel = p.id === selected
      for (const pin of p.pins) {
        if (pin.map !== def.id) continue
        const other = isDD && pin.layout != null && pin.layout !== layout
        if (other && !sel) continue
        const short = p.res.replace(/\s*\(.*$/, '')
        out.push({ x: pin.x, y: pin.y, kind: 'pin', placeId: p.id, ghost: other, sel, label: sel ? pin.label || short : zoom >= def.maxNativeZoom - 1 ? short : undefined })
      }
    }
    for (const pin of draft?.pins ?? []) if (pin.map === def.id) out.push({ x: pin.x, y: pin.y, kind: 'pin', label: pin.label || 'нова точка' })
    if (focus) out.push({ x: focus.x, y: focus.y, kind: 'focus' })
    return out
  }, [def, loot, lootKey, place, places, selected, isDD, layout, zoom, draft, focus])

  useEffect(() => { layerRef.current?.set({ batches, marks, ringTypes, sprite }) }, [batches, marks, ringTypes, sprite, def])

  // підпис точки: назва з TH.GL або тип
  const pointInfo = useCallback(
    (type: string, i: number) => {
      const inf = pts[type]?.info[i]
      return { name: inf?.[0] || null, desc: inf?.[1] || null, en: inf?.[2] || null, typeLabel: resp ? labelOf(resp.labels, type) : type }
    },
    [pts, resp],
  )

  handlers.current = {
    move: (e) => {
      const map = mapRef.current, layer = layerRef.current, tip = tipRef.current
      if (!map || !layer || !tip) return
      const { lat: x, lng: y } = e.latlng
      if (coordsRef.current) coordsRef.current.textContent = `X ${fmtC(Math.round(x))} · Y ${fmtC(Math.round(y))}`
      if (picking) { tip.hidden = true; return }
      const h = layer.hit(e.containerPoint)
      if (!h) { tip.hidden = true; return }
      tip.innerHTML = tipHtml(h)
      tip.hidden = false
      const box = map.getSize()
      const left = e.containerPoint.x + 14 + tip.offsetWidth > box.x ? e.containerPoint.x - 14 - tip.offsetWidth : e.containerPoint.x + 14
      tip.style.left = Math.max(4, left) + 'px'
      tip.style.top = Math.min(box.y - tip.offsetHeight - 4, Math.max(4, e.containerPoint.y - 10)) + 'px'
    },
    click: (e) => {
      if (!def) return
      const { lat: x, lng: y } = e.latlng
      if (picking) {
        // підпис — найближче іменоване місце, якщо клацнули поруч
        const span = def.bounds[1][0] - def.bounds[0][0]
        let label: string | undefined, bd = span * 0.012
        for (const n of index?.named ?? []) {
          const d = Math.hypot(n[4] - x, n[5] - y)
          if (d < bd) { bd = d; label = n[2] }
        }
        addPin({ map: def.id, x: Math.round(x), y: Math.round(y), ...(isDD && layout != null ? { layout } : {}), ...(label ? { label } : {}) })
        return
      }
      const h = layerRef.current?.hit(e.containerPoint)
      if (!h) { setFocus(null); return }
      if (h.kind === 'mark') {
        if (h.mark.kind === 'pin' && h.mark.placeId) { select(h.mark.placeId); setSheet('map-panel') }
        else if (h.mark.kind === 'loot') {
          const hit = loot?.hits.find((l) => l.x === h.mark.x && l.y === h.mark.y)
          if (hit) setFocus({ type: hit.type, i: hit.i, x: hit.x, y: hit.y })
        }
        return
      }
      setFocus({ type: h.type, i: h.i, x: h.x, y: h.y })
    },
  }

  function tipHtml(h: Hit) {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
    if (h.kind === 'mark') {
      const m = h.mark
      if (m.kind === 'pin') {
        const p = places.find((x) => x.id === m.placeId)
        return `<b>${esc(p?.res || m.label || 'Точка')}</b>${p ? `<div class="mt">${esc(p.place)}</div>` : ''}${m.ghost ? '<div class="mt">точка з іншого тижня</div>' : ''}`
      }
      if (m.kind === 'loot') {
        const hit = loot?.hits.find((l) => l.x === m.x && l.y === m.y)
        return `<b>${esc(hit?.item || 'Лут')}</b>${hit?.chance != null ? ` — ${hit.chance}%` : ''}<div class="mt">${esc(hit?.name || labelOf(resp!.labels, hit?.type || ''))}</div>`
      }
      return ''
    }
    const inf = pointInfo(h.type, h.i)
    const desc = inf.desc ? safeDesc(inf.desc).split('<br>').slice(0, 7).join('<br>') : ''
    return `<b>${esc(inf.name || inf.typeLabel)}</b>${inf.name ? `<div class="mt">${esc(inf.typeLabel)}</div>` : ''}${desc ? `<div class="desc">${desc}</div>` : ''}`
  }

  // класом, а не через className: Leaflet сам додає класи контейнеру, і React їх затер би
  useEffect(() => { divRef.current?.classList.toggle('picking', picking) }, [picking, def])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (useMapUi.getState().picking) setPicking(false)
      else setFocus(null)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [setPicking])

  // адреса віддзеркалює вид
  useEffect(() => {
    if (!def || !enabled) return
    // шари в адресі — лише якщо відрізняються від типових, інакше посилання на півекрана
    const dflt = defaultOn(resp!.source.groups)
    const same = dflt.length === enabled.length && dflt.every((t) => enabled.includes(t))
    writeUrl({ m: def.id, w: isDD && week != null ? week : undefined, r: selected ?? undefined, l: same ? undefined : enabled })
  }, [def, enabled, isDD, week, selected, resp])

  // вибрали запис — показати все, що з ним пов'язано на цій мапі
  const flyKey = place && def ? `${place.id}|${def.id}|${layout}|${loot?.loading === false ? loot.hits.length : '-'}` : null
  useEffect(() => {
    const map = mapRef.current
    if (!map || !place || !def) return
    const ll: L.LatLngExpression[] = []
    for (const p of place.pins) if (p.map === def.id) ll.push([p.x, p.y])
    if (loot && loot.key === lootKey) for (const h of loot.hits) ll.push([h.x, h.y])
    if (!ll.length) return
    const b = L.latLngBounds(ll)
    if (ll.length === 1) map.flyTo(b.getCenter(), Math.max(map.getZoom(), def.maxNativeZoom - 1), { duration: 0.6 })
    else map.flyToBounds(b.pad(0.25), { duration: 0.6, maxZoom: def.maxNativeZoom })
  }, [flyKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const fly = (x: number, y: number) => {
    const map = mapRef.current
    if (!map || !def) return
    map.flyTo([x, y], Math.max(map.getZoom(), def.maxNativeZoom), { duration: 0.6 })
    setSheet(null)
  }

  const setTypes = (next: string[]) => {
    if (!def) return
    setEnabled(next)
    saveEnabled(def.id, next)
  }
  const toggleType = (t: string) => enabled && setTypes(enabled.includes(t) ? enabled.filter((x) => x !== t) : [...enabled, t])

  const switchMap = (m: string, sel?: string) => {
    setMapId(m)
    setWeek(null)
    select(sel ?? null)
    setFocus(null)
  }

  const toggleDone = (f: NonNullable<Focus>) => {
    if (!def) return
    const k = pointKey(f.x, f.y)
    const cur = done[f.type] || []
    const next = { ...done, [f.type]: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] }
    setDone(next)
    saveDone(doneKey(def.id, layout), next)
  }

  const shown = needed.reduce((n, t) => n + (index?.counts[t] || 0), 0)
  const dims: [number, number] | null = sprite ? [sprite.naturalWidth, sprite.naturalHeight] : null

  if (failed) return <div className="grid flex-1 place-items-center p-6 text-center text-muted">Сервер мапи не відповідає. Перевір, що запущено <code className="font-mono">npm run dev</code>.</div>
  if (!resp || !def) return <div className="grid flex-1 place-items-center text-muted">Завантаження мапи…</div>

  const extraMaps = resp.source.maps.filter((m) => !MAIN_MAPS.includes(m.id))
  const panelOpen = sheet === 'map-panel'

  return (
    <div className="relative flex min-h-0 flex-1 gap-1.5 sm:gap-2.5">
      <SheetBackdrop open={panelOpen} className="lg:hidden" />
      <aside
        data-open={panelOpen ? 'yes' : 'no'}
        className={cn(SHEET_BASE, 'sheet-lg flex flex-col lg:flex lg:w-[320px] lg:shrink-0 lg:overflow-hidden lg:rounded-xl lg:border lg:border-line lg:!bg-panel lg:shadow-lg')}
        aria-label="Шари мапи"
      >
        <SheetHead title="Мапа ресурсів" className="lg:hidden" />
        <div className="flex shrink-0 flex-col gap-2 border-b border-line p-3">
          <div className="flex items-baseline gap-2">
            <h1 className="font-display text-[14px] font-bold uppercase tracking-[0.08em] text-spice">{MAP_SHORT[def.id] || labelOf(resp.labels, def.id)}</h1>
            <span className="ml-auto font-mono text-[10.5px] text-muted" data-tip="Скільки точок зараз на мапі">
              {index ? `${fmtN(shown)} точок` : '…'}
            </span>
          </div>
          <Seg<string>
            label="Мапа"
            size="sm"
            value={MAIN_MAPS.includes(def.id) ? def.id : ''}
            onChange={(m) => switchMap(m)}
            items={MAIN_MAPS.map((m) => ({ id: m, label: MAP_SHORT[m], tip: labelOf(resp.labels, m) }))}
            className="w-full"
          />
          <select
            aria-label="Інші мапи: уламки, печери, підземелля"
            className="h-7 rounded-md border border-line bg-panel2/60 px-1.5 text-[11.5px] text-muted"
            value={MAIN_MAPS.includes(def.id) ? '' : def.id}
            onChange={(e) => e.target.value && switchMap(e.target.value)}
          >
            <option value="">Ще мапи: уламки, печери, підземелля…</option>
            {extraMaps.map((m) => (
              <option key={m.id} value={m.id}>{labelOf(resp.labels, m.id)}</option>
            ))}
          </select>
          {isDD && <WeekPicker def={def} layout={layout!} resp={resp} onPick={(w) => { setWeek(w === def.layout ? null : w); setFocus(null) }} />}
          <MapSearch index={index} resp={resp} onFly={(x, y, f) => { fly(x, y); if (f) setFocus(f) }} onType={(t) => enabled && !enabled.includes(t) && setTypes([...enabled, t])} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <PlacesSection
            def={def}
            layout={layout}
            resp={resp}
            counts={index?.counts ?? {}}
            loot={loot && loot.key === lootKey ? loot : null}
            onFly={fly}
            onSwitchMap={switchMap}
          />
          {resp.source.groups.map((g) => {
            const list = g.types.filter((t) => index?.counts[t.id])
            if (!list.length) return null
            const on = list.filter((t) => enabled?.includes(t.id))
            const total = list.reduce((n, t) => n + index!.counts[t.id], 0)
            return (
              <Section
                key={g.id}
                id={'g:' + g.id}
                title={labelOf(resp.labels, g.id)}
                count={`${on.length}/${list.length} · ${fmtN(total)}`}
                defaultOpen={g.id === 'locations' || g.id === 'resources'}
                allOn={on.length === list.length}
                onAll={(all) => enabled && setTypes(all ? [...new Set([...enabled, ...list.map((t) => t.id)])] : enabled.filter((x) => !list.some((t) => t.id === x)))}
              >
                {list.map((t) => (
                  <TypeRow
                    key={t.id}
                    icon={t.icon}
                    dims={dims}
                    label={labelOf(resp.labels, t.id)}
                    count={index!.counts[t.id]}
                    on={!!enabled?.includes(t.id)}
                    ring={ringTypes.has(t.id)}
                    onToggle={() => toggleType(t.id)}
                  />
                ))}
              </Section>
            )
          })}
          <SourceNote resp={resp} />
        </div>
      </aside>

      <section className="relative isolate min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel shadow-lg">
        <div ref={divRef} className="map-box absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-2.5 top-2.5 z-[500] flex items-start gap-2">
          <button
            type="button"
            onClick={() => setSheet('map-panel')}
            className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel/95 px-2.5 text-[12px] font-medium shadow backdrop-blur lg:hidden"
          >
            <Layers size={14} /> Шари і ресурси
          </button>
          {picking && (
            <div className="pointer-events-auto mx-auto flex items-center gap-2 rounded-md border border-spice bg-panel/95 px-3 py-1.5 text-[12px] shadow backdrop-blur">
              <Crosshair size={14} className="text-spice" /> Клацни на мапі, щоб додати точку до запису
              <button type="button" className="text-muted hover:text-ink" onClick={() => setPicking(false)} aria-label="Досить точок">
                <X size={14} />
              </button>
            </div>
          )}
          <div className="pointer-events-auto ml-auto flex flex-col gap-1">
            <MapBtn tip="Ближче" onClick={() => mapRef.current?.zoomIn()}><Plus size={14} /></MapBtn>
            <MapBtn tip="Далі" onClick={() => mapRef.current?.zoomOut()}><Minus size={14} /></MapBtn>
            <MapBtn tip="Уся мапа" onClick={() => mapRef.current?.fitBounds(L.latLngBounds(def.bounds))}><Maximize2 size={13} /></MapBtn>
          </div>
        </div>
        {focus && (
          <PointCard
            focus={focus}
            info={pointInfo(focus.type, focus.i)}
            icon={types.get(focus.type)?.icon ?? null}
            dims={dims}
            done={!!done[focus.type]?.includes(pointKey(focus.x, focus.y))}
            onDone={() => toggleDone(focus)}
            onClose={() => setFocus(null)}
            z={pts[focus.type]?.pts[focus.i * 3 + 2]}
            canAttach={!!draft}
            onAttach={() => {
              const inf = pointInfo(focus.type, focus.i)
              addPin({ map: def.id, x: focus.x, y: focus.y, ...(isDD && layout != null ? { layout } : {}), label: inf.name || inf.typeLabel })
              toast.success('Точку додано до чернетки запису')
            }}
          />
        )}
        <div ref={tipRef} hidden className="map-tip pointer-events-none absolute z-[600] max-w-[300px] rounded-md border border-line bg-panel/95 px-2.5 py-1.5 text-[12px] shadow-lg backdrop-blur" />
        <div ref={coordsRef} className="pointer-events-none absolute bottom-2.5 left-2.5 z-[500] rounded-md border border-line bg-panel/90 px-2.5 py-1 font-mono text-[10.5px] text-muted shadow backdrop-blur">
          наведи на мапу
        </div>
      </section>
    </div>
  )
}

function MapBtn({ children, tip, onClick }: { children: React.ReactNode; tip: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={tip} data-tip={tip} onClick={onClick} className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel/95 text-muted shadow backdrop-blur hover:text-spice">
      {children}
    </button>
  )
}

/** Тиждень Deep Desert: розкладки TH.GL, поточну сервер дізнається сам. */
function WeekPicker({ def, layout, resp, onPick }: { def: MapDef; layout: number; resp: SourceResp; onPick: (w: number) => void }) {
  const seen = [...resp.ddHistory].reverse().find((h) => h.layout === def.layout)
  const cur = def.layouts.find((l) => l.id === layout)
  return (
    <div className="rounded-lg border border-line bg-panel2/40 p-2 text-[11.5px]">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Тиждень після бурі</span>
        <span className="ml-auto text-muted">{layout === def.layout ? `поточний${seen ? ` · з ${fmtDate(seen.seenAt)}` : ''}` : 'архівний'}</span>
      </div>
      <select className="h-7 w-full rounded-md border border-line bg-panel px-1.5 text-[12px]" value={layout} onChange={(e) => onPick(Number(e.target.value))}>
        {def.layouts.map((l) => (
          <option key={l.id} value={l.id}>
            Розкладка {l.id}{l.id === def.layout ? ' — зараз у грі' : ''}{l.resources ? '' : ' (без руди)'}
          </option>
        ))}
      </select>
      <p className="mt-1 leading-snug text-muted">
        Глибока пустеля — окрема мапа: буря щотижня перебудовує її за однією з {def.layouts.length} розкладок.
        {cur && !cur.resources && ' Для цієї розкладки TH.GL ще не зібрав руду — видно лише місця й лут.'}
      </p>
    </div>
  )
}

function MapSearch({
  index,
  resp,
  onFly,
  onType,
}: {
  index: MapIndex | null
  resp: SourceResp
  onFly: (x: number, y: number, f?: { type: string; i: number; x: number; y: number }) => void
  onType: (t: string) => void
}) {
  const [q, setQ] = useState('')
  const ql = q.trim().toLowerCase()
  const res = useMemo(() => {
    if (ql.length < 2 || !index) return { named: [], types: [] as string[] }
    const named = index.named.filter((n) => n[2].toLowerCase().includes(ql) || n[3]?.toLowerCase().includes(ql)).slice(0, 12)
    const tl = Object.keys(index.counts).filter((t) => labelOf(resp.labels, t).toLowerCase().includes(ql) || t.includes(ql)).slice(0, 6)
    return { named, types: tl }
  }, [ql, index, resp])
  const has = res.named.length + res.types.length > 0
  return (
    <div className="relative">
      <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Пошук: місце, печера, уламок, тип…"
        aria-label="Пошук на мапі"
        className="h-8 w-full rounded-md border border-line bg-panel2/60 pl-7 pr-2 text-[12.5px] placeholder:text-muted focus:border-spice focus:outline-none"
      />
      {ql.length >= 2 && (
        <div className="absolute inset-x-0 top-9 z-10 max-h-72 overflow-y-auto rounded-md border border-line bg-panel p-1 shadow-xl">
          {!has && <p className="px-2 py-1.5 text-[12px] text-muted">Нічого не знайдено.</p>}
          {res.types.map((t) => (
            <button key={t} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-panel2" onClick={() => { onType(t); setQ('') }}>
              <Layers size={12} className="text-muted" /> Показати шар «{labelOf(resp.labels, t)}» <span className="ml-auto font-mono text-[10px] text-muted">{index?.counts[t]}</span>
            </button>
          ))}
          {res.named.map(([t, i, name, en, x, y]) => (
            <button
              key={`${t}:${i}`}
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-panel2"
              onClick={() => { onFly(x, y, { type: t, i, x, y }); setQ('') }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{name}</span>
                <span className="block truncate text-[10.5px] text-muted">{labelOf(resp.labels, t)}{en && en !== name ? ` · ${en}` : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PointCard({
  focus,
  info,
  icon,
  dims,
  done,
  onDone,
  onClose,
  z,
  canAttach,
  onAttach,
}: {
  focus: NonNullable<Focus>
  info: { name: string | null; desc: string | null; en: string | null; typeLabel: string }
  icon: [number, number, number, number] | null
  dims: [number, number] | null
  done: boolean
  onDone: () => void
  onClose: () => void
  z?: number
  canAttach: boolean
  onAttach: () => void
}) {
  return (
    <div className="absolute bottom-12 right-2.5 z-[650] w-[min(320px,calc(100%-20px))] rounded-xl border border-line bg-panel/97 p-3 text-[12px] shadow-2xl backdrop-blur">
      <div className="flex items-start gap-2">
        <SpriteIcon icon={icon} dims={dims} px={30} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">{info.name || info.typeLabel}</div>
          <div className="text-[11px] text-muted">{info.name ? info.typeLabel : ''}{info.en && info.en !== info.name ? `${info.name ? ' · ' : ''}${info.en}` : ''}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрити" className="text-muted hover:text-ink"><X size={15} /></button>
      </div>
      {info.desc && <div className="mt-2 max-h-48 overflow-y-auto rounded-md bg-panel2/50 p-2 leading-snug" dangerouslySetInnerHTML={{ __html: safeDesc(info.desc) }} />}
      <div className="mt-2 font-mono text-[10.5px] text-muted">X {fmtC(focus.x)} · Y {fmtC(focus.y)}{z != null ? ` · Z ${fmtC(z)}` : ''}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onDone}
          className={cn('h-7 rounded-md border px-2.5 text-[11.5px] font-medium', done ? 'border-ok/50 bg-ok/15 text-ok' : 'border-line hover:bg-panel2')}
        >
          {done ? '✓ Зібрано' : 'Позначити зібраним'}
        </button>
        {canAttach && (
          <button type="button" onClick={onAttach} className="h-7 rounded-md border border-spice/50 px-2.5 text-[11.5px] font-medium text-spice hover:bg-spice/10">
            + до запису
          </button>
        )}
      </div>
    </div>
  )
}

function SourceNote({ resp }: { resp: SourceResp }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex items-center gap-2 border-t border-line px-3 py-2.5 text-[10.5px] leading-snug text-muted">
      <span className="min-w-0 flex-1">
        Мапа й точки гри — <a className="underline" href="https://duneawakening.th.gl" target="_blank" rel="noopener">TH.GL</a>, опис оновлено {fmtDate(resp.source.syncedAt)}.
        Наші ресурси — спільні записи.
      </span>
      <button
        type="button"
        disabled={busy}
        data-tip="Перевірити свіжі дані TH.GL (новий тиждень Deep Desert)"
        aria-label="Оновити дані мапи"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line hover:text-spice disabled:opacity-50"
        onClick={async () => {
          setBusy(true)
          const r = await fetch('/api/map/refresh', { method: 'POST' }).then((x) => x.json()).catch(() => null)
          setBusy(false)
          if (r) {
            toast.success('Дані мапи перевірено', { description: r.dd != null ? `Deep Desert: розкладка ${r.dd}` : undefined })
            location.reload()
          }
        }}
      >
        <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
      </button>
    </div>
  )
}

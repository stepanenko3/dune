/**
 * Мапа події: де вона (арена, старт) і де зона для глядачів — Leaflet на тайлах гри, як мапа сайту, тільки маленька.
 * У редакторі (picking) — вибір точок: мапа вкладками, клік ставить вибрану точку; у Глибокій пустелі — на розкладці
 * цього тижня (буря перебудовує мапу — точка пам'ятає свою розкладку). Окремим шматком разом із Leaflet.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '@/components/map/map.css'
import { HIDDEN_MAPS, loadSource, MAP_ORDER, mapName, type MapDef, type SourceResp } from '@/lib/map/data'
import type { Point } from '@/lib/events'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Seg } from '@/components/ui/seg'

export type PinKind = 'arena' | 'watch'

// значки lucide (swords, eye) рядком — divIcon Leaflet приймає лише HTML
const SVG = (body: string) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const GLYPH: Record<PinKind, string> = {
  arena: SVG('<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>'),
  watch: SVG('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'),
}
export const PIN_LABEL: Record<PinKind, string> = { arena: t('Місце події'), watch: t('Зона для глядачів') }
const pinIcon = (k: PinKind) => L.divIcon({ className: `event-pin event-pin--${k}`, iconSize: [30, 30], iconAnchor: [15, 36], html: `<span>${GLYPH[k]}</span>` })

/** адреса мапи сайту з цією точкою (мапа підлітає й ставить мітку) */
export const mapHref = (p: Point) => `/map?m=${p.map}${p.layout != null ? `&w=${p.layout}` : ''}&at=${p.x},${p.y}`

export default function EventMap({ arena, watch, picking = null, onPick, className }: {
  arena: Point | null
  watch: Point | null
  /** яку точку ставить клік (редактор); null — лише перегляд */
  picking?: PinKind | null
  onPick?: (k: PinKind, p: Point) => void
  className?: string
}) {
  const [resp, setResp] = useState<SourceResp | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { let live = true; loadSource().then((r) => live && setResp(r), () => live && setFailed(true)); return () => { live = false } }, [])
  const edit = !!onPick
  // мапи вкладками: у редакторі — усі відкриті сайту, у перегляді — лише ті, де стоять точки
  const maps = useMemo(() => {
    const all = (resp?.source.maps ?? []).filter((m) => !HIDDEN_MAPS.has(m.id) && MAP_ORDER.includes(m.id)).sort((a, b) => MAP_ORDER.indexOf(a.id) - MAP_ORDER.indexOf(b.id))
    return edit ? all : all.filter((m) => m.id === arena?.map || m.id === watch?.map)
  }, [resp, edit, arena?.map, watch?.map])
  const [mapId, setMapId] = useState(arena?.map ?? watch?.map ?? 'survival_1')
  const def: MapDef | undefined = maps.find((m) => m.id === mapId) ?? maps[0]
  // розкладка Глибокої пустелі: точки — на своїй, нова точка — на поточній
  const layoutOf = (p: Point | null) => (p && def && p.map === def.id && p.layout != null ? p.layout : def?.layout ?? null)
  const layout = def?.layouts.length ? layoutOf(arena?.map === def.id ? arena : watch) : null
  const tiles = def?.layouts.length ? def.layouts.find((l) => l.id === layout)?.tiles ?? def.tiles : def?.tiles

  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const pins = useRef<L.LayerGroup | null>(null)
  /** мапа, до точок якої вже підлетіли */
  const flown = useRef('')
  const pickRef = useRef({ picking, onPick, def, layout })
  pickRef.current = { picking, onPick, def, layout }

  useEffect(() => {
    if (!def || !tiles || !box.current) return
    const tr = def.transformation
    const crs = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(tr[0], tr[1], tr[2], tr[3]) })
    const bounds = L.latLngBounds(def.bounds)
    // масштаб без кроків (як на мапі сайту): ціла мапа точно вписується у висоту, а не на пів кроку дрібніше
    const map = L.map(box.current, { crs, zoomControl: true, minZoom: -6, maxZoom: def.maxNativeZoom + 2, zoomSnap: 0, zoomDelta: 0.5, maxBounds: bounds.pad(0.05), attributionControl: true,
      // на сторінці події колесо гортає сторінку, а не масштабує маленьку мапу (масштаб — кнопками й пальцями)
      scrollWheelZoom: edit })
    map.attributionControl.setPrefix(false)
    L.tileLayer(`/map-tiles/${tiles}/{z}/{y}/{x}.webp`, {
      tileSize: def.tileSize, minZoom: -6, minNativeZoom: def.minNativeZoom, maxNativeZoom: def.maxNativeZoom, bounds, noWrap: true,
      attribution: '<a href="https://duneawakening.th.gl" target="_blank" rel="noopener">TH.GL</a>',
    }).addTo(map)
    map.fitBounds(bounds, { animate: false })
    // дрібніше за цілу мапу — нема куди
    map.setMinZoom(map.getZoom())
    map.on('resize', () => map.setMinZoom(map.getBoundsZoom(bounds, false)))
    flown.current = ''
    pins.current = L.layerGroup().addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => {
      const { picking: k, onPick: cb, def: d, layout: l } = pickRef.current
      if (!k || !cb || !d) return
      cb(k, { map: d.id, x: Math.round(e.latlng.lat), y: Math.round(e.latlng.lng), ...(d.layouts.length && l != null ? { layout: l } : {}) })
    })
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(box.current)
    mapRef.current = map
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; pins.current = null }
  }, [def, tiles])

  // мітки: обидві точки, що на цій мапі; у перегляді — підлетіти до них
  const here = useMemo(() => ([['arena', arena], ['watch', watch]] as const).filter(([, p]) => p && def && p.map === def.id) as [PinKind, Point][], [arena, watch, def])
  const key = JSON.stringify(here)
  useEffect(() => {
    const map = mapRef.current, g = pins.current
    if (!map || !g || !def) return
    g.clearLayers()
    for (const [k, p] of here) L.marker([p.x, p.y], { icon: pinIcon(k), keyboard: false, title: PIN_LABEL[k] }).addTo(g)
    // у редакторі мапа не стрибає за кожним кліком — лише вперше, до точок, що вже були (точок нема — лишається вся мапа)
    if (edit && !here.length) flown.current = def.id
    if (!here.length || (edit && flown.current === def.id)) return
    flown.current = def.id
    const b = L.latLngBounds(here.map(([, p]) => [p.x, p.y] as [number, number]))
    if (here.length === 1) map.setView(b.getCenter(), Math.max(map.getZoom(), def.maxNativeZoom - 1), { animate: false })
    else map.fitBounds(b.pad(0.6), { animate: false, maxZoom: def.maxNativeZoom })
  }, [key, def, tiles]) // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <div className={cn('grid place-items-center rounded-lg border border-dashed border-line text-[13px] text-muted', className)}>{t('Мапа не завантажилась')}</div>
  return (
    <div className="grid gap-2">
      {maps.length > 1 && resp && (
        <Seg size="sm" label={t('Мапа')} value={def?.id ?? ''} onChange={(v) => { flown.current = ''; setMapId(v) }} items={maps.map((m) => ({ id: m.id, label: mapName(resp.labels, m.id) }))} />
      )}
      <div ref={box} className={cn('map-box overflow-hidden rounded-lg border border-line', edit && picking && 'picking', className)} role="img" aria-label={here.map(([k]) => PIN_LABEL[k]).join(', ') || t('Мапа')} />
    </div>
  )
}

/**
 * Мапа — як «Карта» в Satisfactory: тайли гри, усі точки з гри шарами з фільтром
 * за групами й типами, наведення і клік по точці («що тут є» — лут і руда поруч, як у грі),
 * позначки «зібрано», пошук місць — і поверх усе від гравців: позначки й записи ресурсів.
 *
 * Бічна панель — дві сторінки, що гортаються всередині неї (?side=): «Гра» — шари з гри, «Позначки» — від гравців
 * (мої, гільдії й увімкнене людиною чуже публічне, див. MarksPanel).
 * Галочки біля записів ресурсів — фільтр: мапа лишає тільки місця, де є позначені ресурси
 * (контейнери з потрібним лутом і локації, де вони лежать, пов'язані типи точок, наші точки).
 *
 * Глибока пустеля — окрема мапа, яку буря перебудовує щотижня: TH.GL тримає всі її розкладки,
 * сервер стежить, яка поточна; поверх — сітка секторів A1…I9, у панелі — розкладка й відлік до бурі.
 * Мапа й розкладка — в адресі кроками історії (?m=, ?w=): «назад» повертає попередню мапу.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Boxes, ChevronDown, CloudLightning, Crosshair, Filter, Layers, Map as MapIcon, MapPinned, Maximize2, Minus, Plus, RefreshCw, Star, Wind, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/lib/auth'
import {
  HIDDEN_MAPS, labelOf, loadIndex, loadLoot, loadPoints, loadSource, loadSpot, loadSummary, MAP_ORDER, mapName, OPEN_MAPS, reloadSource, safeDesc,
  type LocSummary, type Loot, type MapDef, type MapIndex, type SourceResp, type Summaries, type TypeDef, type TypePoints,
} from '@/lib/map/data'
import { MARK_GROUP, PointsLayer, SPICE, gridOf, iconColors, sectorOf, smoothWheel, type Batch, type Hit, type Mark } from '@/lib/map/layer'
import { defaultOn, doneKey, enabledFor, loadDone, loadDoneAt, mapUrl, okMap, okWeek, pointKey, readUrl, respawnMin, saveDone, saveDoneAt, saveEnabled, setRespawnMin, writeUrl } from '@/lib/map/settings'
import { useMapUi } from '@/lib/map/ui'
import { livePlaces, usePlaces, type Place } from '@/lib/places'
import { isMarker, isPlace, usePubMarks, type PubRow } from '@/lib/map/marks'
import { prefGet, prefSet } from '@/lib/prefs'
import { goUrl, plainClick, useUrlParam } from '@/lib/urlState'
import { useStore } from '@/store'
import { cn, fmtN, plural, splitEn } from '@/lib/utils'
import { locale, t, T } from '@/lib/i18n'
import { SnInput, valueOf } from '@/components/sn'
import { Button } from '@/components/ui/button'
import { ErrorAlert, Loading, PageError } from '@/components/states'
import { Seg } from '@/components/ui/seg'
import { SHEET_BASE, SheetBackdrop, SheetHead } from '@/components/ui/sheet'
import { boxes, fmtC, Section, setSpriteUrl, SpriteIcon, SPRITE, spriteUrl, TOUCH, TOUCH_SEG, TypeRow } from '@/components/map/bits'
import { newDraft, onMap } from '@/components/map/PlaceParts'
import { MarksPanel, scopeOf, useMarksScope, type Scope } from '@/components/map/MarksPanel'
import { DDTimer, useStale, useStorm } from '@/components/DDTimer'
import { fmtLeft } from '@/lib/ddReset'
import { liveMarkers, markerKind, useMarkers } from '@/lib/markers'
import { clockOf, fieldKey, liveSpice, namesText, SIZE_OF, spanText, TYPE_OF, useSpice } from '@/lib/map/spice'
import { SpiceActive, spiceVisNow } from '@/components/map/SpiceActive'
import '@/components/map/map.css'
import { DataStamp } from '@/components/DataStamp'

type Focus = { type: string; i: number; x: number; y: number } | null
/** лут запису: шукається, знайдено чи пошук не вдався (тоді — «Спробувати ще», а не «тут не випадає») */
type LootState = Loot & { loading: boolean; failed?: boolean }
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
/** вузький екран: панель мапи — висувний лист знизу */
const narrow = () => matchMedia('(max-width: 1023.98px)').matches
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
/** рослини довкола є майже всюди — у «що тут є» вони останні */
const PLANTS = new Set(['primrose_field', 'fiber_plant', 'agave_seeds'])
const lootKeyOf = (map: string, layout: number | null, q: string) => `${map}|${layout}|${q.toLowerCase()}`
/** свої й гільдійські + чуже (без повторів): що малювати на мапі */
const withPub = <T extends { id: string },>(own: T[], pub: T[]) => {
  const seen = new Set(own.map((x) => x.id))
  return [...own, ...pub.filter((x) => !seen.has(x.id) && !!seen.add(x.id))]
}
type Side = 'game' | 'marks'

export default function MapPage() {
  const url0 = useRef(readUrl())
  // позначка й запис за посиланням (?marker=, ?r=) — поки їх не знайдено й не вибрано
  const markerParam = useRef(url0.current.marker ?? null)
  const placeParam = useRef(url0.current.r ?? null)
  // точка гри за посиланням (?pt=тип.ключ — торговець указу Ландсрааду): лишається в адресі, поки її картка відкрита
  const [pt, setPt] = useState<string | null>(url0.current.pt ?? null)
  const ptFocus = useRef<Focus>(null)
  const [resp, setResp] = useState<SourceResp | null>(null)
  const [failed, setFailed] = useState(false)
  /** точки мапи не завантажились (індекс); attempt — «Спробувати ще» */
  const [indexFailed, setIndexFailed] = useState(false)
  const [indexTry, setIndexTry] = useState(0)
  /** типи, точки яких не завантажились (шар не «вантажиться» вічно — показуємо помилку зі «Спробувати ще») */
  const [ptsFailed, setPtsFailed] = useState<string[]>([])
  // мапа й розкладка — в адресі, кроками історії; без ?m= — та, що була відкрита востаннє
  const lastMap = useRef(prefGet('map:map', 'survival_1')).current
  const [mapId] = useUrlParam<string>('m', lastMap, okMap, { always: true })
  const [wParam] = useUrlParam<string>('w', '', okWeek)
  const week = wParam ? Number(wParam) : null
  const [enabled, setEnabled] = useState<string[] | null>(null)
  const [index, setIndex] = useState<MapIndex | null>(null)
  const [summary, setSummary] = useState<Summaries | null>(null)
  const [pts, setPts] = useState<Record<string, TypePoints>>({})
  const [sprite, setSprite] = useState<HTMLImageElement | null>(null)
  const [colors, setColors] = useState<Record<string, string>>({})
  const [done, setDone] = useState<Record<string, string[]>>({})
  /** коли вузли руди позначено «зібрано» — для таймера відновлення («тип|x,y» → мс) */
  const [doneAt, setDoneAt] = useState<Record<string, number>>({})
  const [respawn, setRespawn] = useState(respawnMin)
  const [now, setNow] = useState(Date.now)
  const [focus, setFocus] = useState<Focus>(null)
  const [zoom, setZoom] = useState(0)
  const [loots, setLoots] = useState<Record<string, LootState>>({})
  const [group, setGroup] = useState<boolean>(() => prefGet('map:cluster', true))
  // предмет із довідника (?loot=…): поводиться як тимчасовий запис «Наших ресурсів» лише з лутом
  const [lootQ, setLootQ] = useState<string | null>(url0.current.loot ?? null)
  const places = usePlaces((s) => s.rows)
  const markers = useMarkers((s) => s.rows)
  const markerSel = useMarkers((s) => s.selected)
  const markerPicking = useMarkers((s) => s.picking)
  const markerDraft = useMarkers((s) => s.draft)
  const placesReady = usePlaces((s) => s.ready)
  // активні поля меланжу (позначки гравців) і місця великих полів
  const spiceFields = useSpice((s) => s.fields)
  const spiceSpots = useSpice((s) => s.spots)
  const spiceByKey = useSpice((s) => s.byKey)
  const spicePicking = useSpice((s) => s.picking)
  const authUser = useAuth((s) => s.user)
  // чуже публічне: ввімкнене людиною і те, що розгорнули «подивитись» (чи відкрили за посиланням)
  const pubRows = usePubMarks((s) => s.rows)
  const peek = usePubMarks((s) => s.peek)
  const allMarkers = useMemo(() => withPub(markers, [...pubRows.filter(isMarker), ...(peek && isMarker(peek) ? [peek] : [])]), [markers, pubRows, peek])
  const allPlaces = useMemo(() => withPub(places, [...pubRows.filter(isPlace), ...(peek && isPlace(peek) ? [peek] : [])]), [places, pubRows, peek])
  // сторінка бічної панелі: «Гра» (шари з гри) чи «Позначки» (усе від гравців); там — вкладка «Мої / Гільдія / Публічні»
  const [side, setSide, sideHref] = useUrlParam<Side>('side', 'game', (v) => v === 'game' || v === 'marks')
  const [scope, setScope] = useMarksScope()
  const { selected, select, picking, setPicking, addPin, draft, edit, checked } = useMapUi()
  const marksGame = useMapUi((s) => s.marksGame)
  const sheet = useStore((s) => s.sheet)
  const setSheet = useStore((s) => s.setSheet)

  const def: MapDef | undefined = resp?.source.maps.find((m) => m.id === mapId && !HIDDEN_MAPS.has(m.id))
  const isDD = !!def?.layouts.length
  // розкладка з адреси — лише та, що є (інакше поточна)
  const layout = isDD ? (week != null && def!.layouts.some((l) => l.id === week) ? week : def!.layout) : null
  const lay = isDD ? def!.layouts.find((l) => l.id === layout) : undefined
  const tilesDir = lay?.tiles ?? def?.tiles
  // активні поля цієї мапи (і розкладки): заново — і коли людина увійшла чи вийшла (видно інше)
  useEffect(() => { void useSpice.getState().load(def?.id ?? null, layout) }, [def?.id, layout, authUser?.id])
  const types = useMemo(() => {
    const m = new Map<string, TypeDef & { group: string }>()
    for (const g of resp?.source.groups ?? []) for (const t of g.types) m.set(t.id, { ...t, group: g.id })
    return m
  }, [resp])
  const grid = useMemo(() => (def ? gridOf(def) : null), [def])

  // ---------- відновлення вузлів ----------
  /** руда й місця збору відновлюються; поля меланжу — ні (з'являються подіями) */
  const respawnable = (t: string) => {
    const g = types.get(t)?.group
    return (g === 'resources' || g === 'resources_pickup') && !/_field/.test(t)
  }
  const respawnMs = respawn * 60_000
  // поки щось відновлюється — «зараз» тікає раз на 20 с: дуги ростуть, відновлені позначки знімаються
  const anyRespawn = Object.keys(doneAt).length > 0
  useEffect(() => {
    if (!anyRespawn) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(id)
  }, [anyRespawn])
  useEffect(() => {
    if (!def) return
    const gone = Object.entries(doneAt).filter(([, at]) => now - at >= respawnMs).map(([k]) => k)
    if (!gone.length) return
    const nextAt = { ...doneAt }
    const nextDone = { ...done }
    for (const k of gone) {
      delete nextAt[k]
      const [t, key] = k.split('|')
      if (nextDone[t]) nextDone[t] = nextDone[t].filter((x) => x !== key)
    }
    setDoneAt(nextAt)
    setDone(nextDone)
    saveDoneAt(doneKey(def.id, layout), nextAt)
    saveDone(doneKey(def.id, layout), nextDone)
  }, [now, respawnMs]) // eslint-disable-line react-hooks/exhaustive-deps
  /** частка відновлення зібраних вузлів типу: ключ «x,y» → 0…1 */
  const progressOf = (t: string, keys: string[]) => {
    const m = new Map<string, number>()
    for (const k of keys) {
      const at = doneAt[`${t}|${k}`]
      if (at) m.set(k, (now - at) / respawnMs)
    }
    return m.size ? m : undefined
  }
  const respawning = useMemo(() => {
    const left = Object.values(doneAt).map((at) => at + respawnMs - now).filter((ms) => ms > 0)
    return { n: left.length, soonest: left.length ? Math.min(...left) : 0 }
  }, [doneAt, now, respawnMs])

  // ---------- завантаження ----------
  const fetchSource = useCallback(() => {
    setFailed(false)
    loadSource().then(setResp).catch(() => setFailed(true))
  }, [])
  // відкрита мапа сама підхоплює нову розкладку Глибокої пустелі (після бурі): раз на 15 хв і коли вкладку знову
  // відкрили — без перезавантаження сторінки, тож відкрита чернетка позначки не губиться (а нові позначки отримують
  // нову розкладку, якщо людина не вибрала іншу сама)
  useEffect(() => {
    const check = () => { if (document.visibilityState === 'visible') reloadSource().then(({ resp: r, changed }) => { if (changed) { setResp(r); toast.info(t('Мапу оновлено — вийшли свіжі дані TH.GL')) } }).catch(() => {}) }
    const h = setInterval(check, 15 * 60_000)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(h); document.removeEventListener('visibilitychange', check) }
  }, [])
  useEffect(() => {
    fetchSource()
    void usePlaces.getState().load()
    // свої й гільдійські позначки; чуже публічне вмикається поштучно (сторінка «Позначки»)
    void useMarkers.getState().load()
    if (url0.current.r) select(url0.current.r)
    // живі оновлення позначок і записів — поки відкрита мапа (і тоді, коли перше завантаження не вдалось)
    const offM = liveMarkers()
    const offP = livePlaces()
    const offS = liveSpice()
    return () => { offM(); offP(); offS(); useMapUi.getState().edit(null); useSpice.getState().setPicking(false) }
  }, [select, fetchSource])

  useEffect(() => {
    if (!sprite || !resp) return
    const icons: Record<string, [number, number, number, number]> = {}
    for (const g of resp.source.groups) for (const t of g.types) if (t.icon) icons[t.id] = t.icon
    setColors(iconColors(sprite, icons))
  }, [sprite, resp])

  // мапа з адреси могла зникнути з TH.GL або бути прихованою — тоді Хагга
  useEffect(() => {
    if (resp && !def) goUrl(mapUrl({ m: 'survival_1', w: null }), true)
  }, [resp, def])

  useEffect(() => {
    if (!resp || !def) return
    const u = url0.current
    const fromUrl = u.m === def.id && u.l ? u.l : null
    url0.current = {}
    const small = !OPEN_MAPS.has(def.id)
    setEnabled(fromUrl ?? enabledFor(def.id, resp.source.groups, small))
    if (fromUrl) saveEnabled(def.id, fromUrl, small)
    prefSet('map:map', def.id)
    // відкрили /map без мапи — в адресу ту, що показана (посилання й «назад» однозначні)
    if (new URLSearchParams(location.search).get('m') !== def.id) goUrl(mapUrl({ m: def.id }), true)
  }, [resp, def])

  useEffect(() => {
    if (!def) return
    setIndex(null)
    setSummary(null)
    setPts({})
    setFocus(null)
    setDone(loadDone(doneKey(def.id, layout)))
    setDoneAt(loadDoneAt(doneKey(def.id, layout)))
    setIndexFailed(false)
    setPtsFailed([])
    let live = true
    loadIndex(def.id, layout).then((ix) => live && setIndex(ix)).catch(() => live && setIndexFailed(true))
    loadSummary(def.id, layout).then((s) => live && setSummary(s)).catch(() => {})
    return () => { live = false }
  }, [def, layout, indexTry])

  // ввімкнене чуже публічне — для кожної мапи своє
  useEffect(() => { if (def) void usePubMarks.getState().load(def.id) }, [def?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // «подивитись» живе, поки річ вибрана
  useEffect(() => {
    const p = usePubMarks.getState().peek
    if (p && p.id !== selected && p.id !== markerSel) usePubMarks.getState().setPeek(null)
  }, [selected, markerSel])

  const place = allPlaces.find((p) => p.id === selected) || null
  /** вкладка «Позначки»: на мапі — позначене галочками, ігрові маркери — за перемикачем; на «Грі» — шари «Гри» */
  const onMarks = side === 'marks'
  /** увімкнене чуже публічне (галочка на «Публічних» чи все від автора) — те саме, що галочка на своєму */
  const pubOn = useMemo(() => new Set([...pubRows.map((r) => r.id), ...(peek ? [peek.id] : [])]), [pubRows, peek])
  const isOn = useCallback((id: string) => checked.includes(id) || pubOn.has(id), [checked, pubOn])
  /** записи з галочкою на цій мапі */
  const checkedHere = useMemo(() => (def ? allPlaces.filter((p) => isOn(p.id) && onMap(p, def.id)) : []), [allPlaces, isOn, def])
  /** у фокусі: позначені галочками + вибраний; якщо є хоч один — решта точок ховається */
  const lootPlace: Place | null = useMemo(
    () => (lootQ ? { id: '__loot', res: lootQ, place: t('лут із довідника'), area: '', zone: 'hagga', how: '', ok: false, loot: lootQ, pins: [], types: [], created: 0, updated: 0 } : null),
    [lootQ],
  )
  const active = useMemo(() => {
    const out = place && def && onMap(place, def.id) && !checkedHere.includes(place) ? [...checkedHere, place] : [...checkedHere]
    if (lootPlace) out.push(lootPlace)
    return out
  }, [checkedHere, place, def, lootPlace])
  // пов'язане з позначеними записами (типи точок, лут) — на «Позначках» (і для луту з довідника)
  const linking = onMarks || !!lootPlace
  // ігрові шари сховані: «Позначки» без ігрових маркерів, лут із довідника
  const filtering = !!lootPlace || (onMarks && !marksGame)
  /** увімкнені шари «Гри», що малюються зараз */
  const gameOn = useMemo(() => (filtering ? [] : enabled ?? []), [filtering, enabled])

  // лут: вибраного запису і всіх позначених галочками
  const lootWanted = useMemo(() => {
    const out = new Map<string, string>()
    for (const p of [...(linking ? active : []), ...(place ? [place] : [])]) if (p.loot && def) out.set(p.id, lootKeyOf(def.id, layout, p.loot))
    return out
  }, [active, place, def, layout, linking])
  useEffect(() => {
    if (!def) return
    for (const id of new Set(lootWanted.keys())) {
      const k = lootWanted.get(id)!
      if (loots[k]) continue
      const p = id === '__loot' ? lootPlace! : allPlaces.find((x) => x.id === id)!
      setLoots((cur) => ({ ...cur, [k]: { hits: [], places: [], loading: true } }))
      loadLoot(def.id, layout, p.loot)
        .then((l) => setLoots((cur) => ({ ...cur, [k]: { ...l, loading: false } })))
        // не «тут не випадає»: пошук не вдався — так і кажемо, з «Спробувати ще»
        .catch(() => setLoots((cur) => ({ ...cur, [k]: { hits: [], places: [], loading: false, failed: true } })))
    }
  }, [lootWanted, def, layout, loots, allPlaces])
  const lootOf = (p: Place | null) => (p?.loot && def ? loots[lootKeyOf(def.id, layout, p.loot)] ?? null : null)
  /** шукати лут вибраного запису ще раз */
  const retryLoot = () => {
    if (!place?.loot || !def) return
    const k = lootKeyOf(def.id, layout, place.loot)
    setLoots(({ [k]: _drop, ...rest }) => rest)
  }

  // що малювати: у фільтрі — лише пов'язане з позначеними записами, інакше — увімкнені шари
  const linked = useMemo(() => {
    const full = new Set<string>()
    const only = new Map<string, Set<number>>()
    const from = linking ? active : place ? [place] : []
    for (const p of from) {
      for (const t of p.types) if (t.map === mapId) full.add(t.type)
      if (!linking) continue
      for (const lp of lootOf(p)?.places ?? []) {
        let s = only.get(lp.type)
        if (!s) only.set(lp.type, (s = new Set()))
        s.add(lp.i)
      }
    }
    return { full, only }
  }, [linking, active, place, mapId, loots]) // eslint-disable-line react-hooks/exhaustive-deps
  const ringTypes = linked.full

  const needed = useMemo(() => {
    if (!index || !enabled) return []
    const s = new Set([...gameOn, ...linked.full, ...linked.only.keys()])
    return [...s].filter((t) => index.counts[t])
  }, [index, enabled, linked, gameOn])
  useEffect(() => {
    if (!def || !index) return
    let live = true
    for (const t of needed) {
      if (pts[t] || ptsFailed.includes(t)) continue
      loadPoints(def.id, layout, t)
        .then((p) => live && setPts((cur) => (cur[t] ? cur : { ...cur, [t]: p })))
        .catch(() => live && setPtsFailed((cur) => (cur.includes(t) ? cur : [...cur, t])))
    }
    return () => { live = false }
  }, [needed, def, layout, index, pts, ptsFailed])

  // сторінка панелі, яку зараз не видно, — поза фокусом клавіатури й читачів екрана
  const gamePage = useRef<HTMLDivElement>(null)
  const marksPage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    gamePage.current?.toggleAttribute('inert', side !== 'game')
    marksPage.current?.toggleAttribute('inert', side !== 'marks')
  })

  // ---------- Leaflet ----------
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<PointsLayer | null>(null)
  const coordsRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const pulseRef = useRef<L.LayerGroup | null>(null)
  const fitted = useRef<string | null>(null)
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
      // колесо веде smoothWheel: безперервний масштаб замість стрибків
      scrollWheelZoom: false,
      zoomSnap: 0,
      zoomDelta: 0.5,
      // межі тримає lockDrag (нижче): за край мапи не тягнеться взагалі — нічому «відскакувати»
      maxBounds: bounds,
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
      keepBuffer: 4,
      attribution: '<a href="https://duneawakening.th.gl" target="_blank" rel="noopener">TH.GL</a>',
    }).addTo(map)
    map.fitBounds(bounds, { animate: false })
    map.setMinZoom(map.getZoom())
    map.on('resize', () => map.setMinZoom(map.getBoundsZoom(map.options.maxBounds as L.LatLngBounds, false)))
    // у стан — лише крок 0,5: інакше плавний зум перемальовував би React щокадру
    const q = () => Math.round(map.getZoom() * 2) / 2
    setZoom(q())
    map.on('zoomend', () => setZoom(q()))
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(divRef.current)
    const unwheel = smoothWheel(map)
    lockDrag(map)
    const layer = new PointsLayer()
    layer.spice = `rgb(${getComputedStyle(document.documentElement).getPropertyValue('--c-spice').trim().replace(/ /g, ',')})`
    layer.addTo(map)
    mapRef.current = map
    layerRef.current = layer
    pulseRef.current = L.layerGroup().addTo(map)
    fitted.current = null

    let raf = 0
    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => handlers.current?.move(e))
    })
    // підказка прив'язана до точки під курсором — під час руху мапи вона вже бреше
    map.on('mouseout movestart zoomstart', () => { if (tipRef.current) tipRef.current.hidden = true })
    map.on('click', (e: L.LeafletMouseEvent) => handlers.current?.click(e))
    return () => {
      cancelAnimationFrame(raf)
      unwheel()
      ro.disconnect()
      map.remove()
      mapRef.current = null
      layerRef.current = null
      pulseRef.current = null
    }
  }, [def, tilesDir])

  // активні поля пульсують: кілька DOM-значків над полотном (анімація CSS — без перемальовування точок)
  useEffect(() => {
    const g = pulseRef.current
    if (!g) return
    g.clearLayers()
    for (const f of spiceFields) {
      const d = f.size === 'large' ? 46 : f.size === 'medium' ? 36 : 28
      L.marker([f.x, f.y], { interactive: false, keyboard: false, icon: L.divIcon({ className: `spice-pulse spice-pulse--${f.size}`, iconSize: [d, d], html: '<i></i><i></i>' }) }).addTo(g)
    }
  }, [spiceFields, def, tilesDir])

  // міста й підземелля: тайли ширші за саме місто — центруємо за точками
  useEffect(() => {
    const map = mapRef.current
    // індекс попередньої мапи ще може бути в стані в мить перемикання — чекаємо свого
    if (!map || !def || !index?.bbox || index.map !== def.id || OPEN_MAPS.has(def.id) || fitted.current === def.id) return
    fitted.current = def.id
    const b = L.latLngBounds(index.bbox).pad(0.12)
    map.setMaxBounds(b)
    map.setMinZoom(map.getBoundsZoom(b, false))
    map.fitBounds(b, { animate: false })
    // точка гри з посилання вже знайдена — летимо до неї після вписування міста, а не до нього
    const f = ptFocus.current
    if (f) setTimeout(() => fly(f.x, f.y), 400)
  }, [index, def]) // eslint-disable-line react-hooks/exhaustive-deps

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
        respawn: respawnable(t) && done[t]?.length ? progressOf(t, done[t]) : undefined,
        // з лутом записів, а шар не ввімкнено — лише ті точки, де він є
        only: !gameOn.includes(t) && !linked.full.has(t) ? linked.only.get(t) : undefined,
      })
    }
    // місця великих полів (відомі й з позначок гравців) — завжди, хоч би шар і вимкнули: TH.GL їх не має
    if (spiceSpots.length && !filtering) {
      const LG = TYPE_OF.large
      const extra = spiceSpots.flatMap((p) => [p.x, p.y, 0])
      const have = out.find((b) => b.type === LG)
      if (have) have.pts = [...have.pts, ...extra]
      else out.push({ type: LG, pts: extra, icon: types.get(LG)?.icon ?? null, size: types.get(LG)?.size ?? 2, color: colors[LG] || '#d9481f' })
    }
    // активні поля видно й тоді, коли шар їхньої величини вимкнено
    for (const f of spiceFields) {
      const ty = TYPE_OF[f.size]
      if (f.size === 'large' || needed.includes(ty)) continue
      const have = out.find((b) => b.type === ty)
      if (have) have.pts = [...have.pts, f.x, f.y, 0]
      else out.push({ type: ty, pts: [f.x, f.y, 0], icon: types.get(ty)?.icon ?? null, size: types.get(ty)?.size ?? 2, color: colors[ty] || '#ee8a2c' })
    }
    // густі шари (руда, рослини) — знизу, місця й люди — зверху
    return out.sort((a, b) => b.pts.length - a.pts.length)
  }, [needed, pts, types, colors, done, filtering, gameOn, linked, doneAt, now, respawnMs, spiceSpots, spiceFields]) // eslint-disable-line react-hooks/exhaustive-deps

  const marks: Mark[] = useMemo(() => {
    if (!def) return []
    const out: Mark[] = []
    const badge = zoom >= def.maxNativeZoom - 2
    const lootFrom = linking ? [...active, ...(place && !active.includes(place) ? [place] : [])] : place ? [place] : []
    for (const p of lootFrom) for (const h of lootOf(p)?.hits ?? []) out.push({ x: h.x, y: h.y, kind: 'loot', badge: h.chance != null && badge ? `${h.chance}%` : undefined })
    // позначки й записи — лише з галочкою (свої, гільдійські, увімкнене публічне) чи вибрані / ті, що правлять
    const hide = (id: string, sel: boolean) => !sel && !isOn(id)
    const pinsFrom = allPlaces.filter((p) => !hide(p.id, p.id === selected || p.id === draft?.id))
    for (const p of pinsFrom) {
      const sel = p.id === selected
      for (const pin of p.pins) {
        if (pin.map !== def.id) continue
        const other = isDD && pin.layout != null && pin.layout !== layout
        if (other && !sel) continue
        const short = splitEn(p.res)[0]
        out.push({ x: pin.x, y: pin.y, kind: 'pin', placeId: p.id, ghost: other, sel, label: sel || filtering || zoom >= def.maxNativeZoom - 1 ? (sel ? pin.label || short : short) : undefined })
      }
    }
    for (const pin of draft?.pins ?? []) if (pin.map === def.id) out.push({ x: pin.x, y: pin.y, kind: 'pin', label: pin.label || t('нова точка') })
    // позначки (мої, гільдійські, публічні): Глибока пустеля — лише свого тижня (інші — блідо, якщо вибрана)
    const mdraft = markerDraft
    for (const m of allMarkers) {
      if (m.map !== def.id) continue
      const sel = m.id === markerSel
      if (hide(m.id, sel || m.id === markerDraft?.id)) continue
      const other = isDD && m.layout != null && m.layout !== layout
      if (other && !sel) continue
      const k = markerKind(m.kind)
      const color = m.kind === 'base' && m.item.owner.kind === 'guild' ? m.item.owner.color : k.color
      out.push({ x: m.x, y: m.y, kind: 'marker', markerId: m.id, color, glyph: k.glyph, sel, ghost: other, label: sel || zoom >= def.maxNativeZoom - 2 ? m.title : undefined })
    }
    if (mdraft && mdraft.map === def.id && !mdraft.id) out.push({ x: mdraft.x, y: mdraft.y, kind: 'marker', color: markerKind(mdraft.kind).color, glyph: markerKind(mdraft.kind).glyph, sel: true, label: mdraft.title || t('нова позначка') })
    if (focus) out.push({ x: focus.x, y: focus.y, kind: 'focus' })
    return out
  }, [def, loots, place, allPlaces, active, filtering, selected, isDD, layout, zoom, draft, focus, allMarkers, markerSel, markerDraft, isOn, linking]) // eslint-disable-line react-hooks/exhaustive-deps

  // на малих мапах (міста, підземелля) точок небагато — показуємо кожну, без групування
  const cluster = group && !!def && OPEN_MAPS.has(def.id)
  useEffect(() => { layerRef.current?.set({ batches, marks, ringTypes, sprite, grid, cluster }) }, [batches, marks, ringTypes, sprite, grid, cluster, def])

  // підпис точки: назва з TH.GL або тип; для локацій — «що тут є»
  const pointInfo = useCallback(
    (type: string, i: number) => {
      const inf = pts[type]?.info[i]
      return {
        name: inf?.[0] || null,
        desc: inf?.[1] || null,
        en: inf?.[2] || null,
        typeLabel: resp ? labelOf(resp.labels, type) : type,
        sum: summary?.[type]?.[i] ?? null,
      }
    },
    [pts, resp, summary],
  )

  // спрайт іконок — той, що в даних мапи (TH.GL чи файли гри): змінився — вантажимо новий
  const spriteSrc = resp ? resp.source.sprite ?? SPRITE : null
  useEffect(() => {
    if (!spriteSrc) return
    setSpriteUrl(spriteSrc)
    const im = new Image()
    im.onload = () => setSprite(im)
    im.src = spriteSrc
  }, [spriteSrc])
  const dims: [number, number] | null = sprite ? [sprite.naturalWidth, sprite.naturalHeight] : null
  const spriteHtml = (t: string, px = 16) => {
    const ic = types.get(t)?.icon
    if (!ic || !dims) return ''
    const k = px / ic[2]
    return `<span class="ic" style="width:${px}px;height:${px}px;background-image:url(${spriteUrl});background-position:${-ic[0] * k}px ${-ic[1] * k}px;background-size:${dims[0] * k}px ${dims[1] * k}px"></span>`
  }
  const sumHtml = (s: LocSummary, lines = 7) => {
    const loot = s.loot.slice(0, lines).map(([n, pc, c]) => `<div class="li"><b>${pc}%</b> ${esc(n)}${c > 1 ? ` <i>×${c}</i>` : ''}</div>`).join('')
    const res = [...s.res].sort((a, b) => Number(PLANTS.has(a[0])) - Number(PLANTS.has(b[0])) || b[1] - a[1]).slice(0, 8)
      .map(([t, n]) => `<span class="rs" title="${esc(resp ? labelOf(resp.labels, t) : t)}">${spriteHtml(t)}${n}</span>`).join('')
    return (loot ? `<div class="sec">${esc(t('Лут · {boxes}', { boxes: boxes(s.boxes) }))}</div>${loot}` : '') + (res ? `<div class="sec">${esc(t('Поруч'))}</div><div class="res">${res}</div>` : '')
  }

  /** координати під курсором (на телефоні — там, де торкнулись) */
  const showCoords = (x: number, y: number) => {
    if (!coordsRef.current) return
    const sec = grid ? sectorOf(grid, x, y) : null
    coordsRef.current.textContent = sec ? t('Сектор {sec} · X {x} · Y {y}', { sec, x: fmtC(Math.round(x)), y: fmtC(Math.round(y)) }) : `X ${fmtC(Math.round(x))} · Y ${fmtC(Math.round(y))}`
  }
  handlers.current = {
    move: (e) => {
      const map = mapRef.current, layer = layerRef.current, tip = tipRef.current
      if (!map || !layer || !tip) return
      const { lat: x, lng: y } = e.latlng
      showCoords(x, y)
      if (picking || useMarkers.getState().picking || useSpice.getState().picking) { tip.hidden = true; return }
      const h = layer.hit(e.containerPoint)
      if (!h) { tip.hidden = true; return }
      tip.innerHTML = tipHtml(h)
      tip.hidden = false
      const box = map.getSize()
      const left = e.containerPoint.x + 16 + tip.offsetWidth > box.x ? e.containerPoint.x - 16 - tip.offsetWidth : e.containerPoint.x + 16
      tip.style.left = Math.max(4, left) + 'px'
      tip.style.top = Math.min(box.y - tip.offsetHeight - 4, Math.max(4, e.containerPoint.y - 10)) + 'px'
    },
    click: (e) => {
      if (!def) return
      const { lat: x, lng: y } = e.latlng
      showCoords(x, y)
      if (useSpice.getState().picking) {
        // велике поле там, де клацнули (сервер «прилипить» його до відомого місця поруч)
        useSpice.getState().setPicking(false)
        void markLargeAt(x, y)
        return
      }
      const mk = useMarkers.getState()
      if (mk.picking) {
        // точка нової (чи переміщеної) позначки; перенесли з пустелі на іншу мапу — без розкладки
        const at = { map: def.id, x: Math.round(x), y: Math.round(y), layout: isDD && layout != null ? layout : undefined }
        const next = mk.draft ? { ...mk.draft, ...at } : { ...at, kind: 'base' as const, title: '', note: '' }
        if (!next.id) useMarkers.setState({ selected: null })
        mk.setDraft(next)
        reveal()
        return
      }
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
        if (h.mark.kind === 'pin' && h.mark.placeId) { select(h.mark.placeId); reveal(scopeOfPlace(h.mark.placeId)) }
        else if (h.mark.kind === 'marker' && h.mark.markerId) { useMarkers.getState().select(h.mark.markerId); reveal(scopeOfMarker(h.mark.markerId)) }
        else if (h.mark.kind === 'loot') {
          for (const l of Object.values(loots)) {
            const hit = l.hits.find((v) => v.x === h.mark.x && v.y === h.mark.y)
            if (hit) { setFocus({ type: hit.type, i: hit.i, x: hit.x, y: hit.y }); break }
          }
        }
        return
      }
      if (h.kind === 'cluster') {
        // група — наблизити так, щоб вона розпалась на окремі значки
        const map = mapRef.current!
        const b = L.latLngBounds(h.bounds)
        if (b.getNorthEast().equals(b.getSouthWest())) map.flyTo([h.x, h.y], Math.min(map.getZoom() + 2, map.getMaxZoom()), { duration: 0.5 })
        else flyWithin(map, b, map.getMaxZoom())
        return
      }
      setFocus({ type: h.type, i: h.i, x: h.x, y: h.y })
    },
  }

  async function markLargeAt(x: number, y: number) {
    if (!def) return
    try {
      const f = await useSpice.getState().mark({ map: def.id, layout: isDD ? layout : null, size: 'large', x: Math.round(x), y: Math.round(y), visibility: spiceVisNow() })
      if (f) setFocus({ type: TYPE_OF.large, i: -1, x: f.x, y: f.y })
    } catch (e) { toast.error((e as Error).message) }
  }

  /** активне поле під точкою: рядки для підказки */
  function spiceTip(type: string, x: number, y: number) {
    const size = SIZE_OF[type]
    if (!size) return ''
    const f = spiceByKey.get(fieldKey(size, x, y))
    const spot = size === 'large' ? spiceSpots.find((p) => p.x === Math.round(x) && p.y === Math.round(y)) : null
    const src = spot ? `<div class="mt">${esc(spot.src === 'known' ? t('можливе місце великого поля') : t('місце з позначок гравців'))}</div>` : ''
    if (!f) return src + (authUser ? `<div class="mt">${esc(t('клік — позначити активним'))}</div>` : '')
    const now = Date.now() + useSpice.getState().skew
    return src + `<div class="sp-act"><b>${esc(t('Активне'))}</b> · ${esc(t('з {time} ({ago} тому)', { time: clockOf(f.first), ago: spanText(now - f.first) }))}</div>`
      + `<div class="mt">${esc(t('Позначили {n}: {names}', { n: f.n, names: namesText(f) }))}</div>`
  }

  function tipHtml(h: Hit) {
    if (h.kind === 'mark') {
      const m = h.mark
      if (m.kind === 'pin') {
        const p = allPlaces.find((x) => x.id === m.placeId)
        return `<b>${esc(p ? splitEn(p.res)[0] : m.label || t('Точка'))}</b>${p ? `<div class="mt">${esc(splitEn(p.place)[0])}</div>` : ''}${m.ghost ? `<div class="mt">${esc(t('точка з іншої розкладки'))}</div>` : ''}`
      }
      if (m.kind === 'marker') {
        const mk = allMarkers.find((x) => x.id === m.markerId)
        if (!mk) return `<b>${esc(m.label || t('Нова позначка'))}</b>`
        const o = mk.item.owner
        return `<b>${esc(mk.title)}</b><div class="mt">${esc(markerKind(mk.kind).label)} · ${esc(o.kind === 'guild' ? `[${o.tag}] ${o.name}` : o.name)}</div>${mk.note ? `<div class="desc">${esc(mk.note.slice(0, 200))}</div>` : ''}`
      }
      if (m.kind === 'loot') {
        for (const l of Object.values(loots)) {
          const hit = l.hits.find((v) => v.x === m.x && v.y === m.y)
          if (hit) return `<b>${esc(hit.item)}</b>${hit.chance != null ? ` — ${hit.chance}%` : ''}<div class="mt">${esc(hit.name || labelOf(resp!.labels, hit.type))}</div>`
        }
      }
      return ''
    }
    if (h.kind === 'cluster' && h.type === MARK_GROUP) return `<b>${esc(t('Позначки'))} ×${fmtN(h.n)}</b><div class="mt">${esc(t('клік — наблизити'))}</div>`
    if (h.kind === 'cluster') {
      const sec = grid ? sectorOf(grid, h.x, h.y) : null
      return `<div class="hd">${spriteHtml(h.type, 20)}<span><b>${esc(labelOf(resp!.labels, h.type))} ×${fmtN(h.n)}</b><span class="mt">${esc(sec ? t('сектор {sec} · клік — наблизити', { sec }) : t('клік — наблизити'))}</span></span></div>`
    }
    const inf = pointInfo(h.type, h.i)
    const head = `<div class="hd">${spriteHtml(h.type, 20)}<span><b>${esc(inf.name || inf.typeLabel)}</b>${inf.name ? `<span class="mt">${esc(inf.typeLabel)}</span>` : ''}</span></div>`
    if (SIZE_OF[h.type]) return head + spiceTip(h.type, h.x, h.y)
    if (inf.sum) return head + sumHtml(inf.sum)
    const desc = inf.desc ? safeDesc(inf.desc).split('<br>').filter((l) => !/^<b>[^<]*<\/b>$/.test(l.trim())).slice(0, 8).join('<br>') : ''
    return head + (desc ? `<div class="desc">${desc}</div>` : '')
  }

  // класом, а не через className: Leaflet сам додає класи контейнеру, і React їх затер би
  useEffect(() => { divRef.current?.classList.toggle('picking', picking || markerPicking || spicePicking) }, [picking, markerPicking, spicePicking, def])

  // вибір точки на телефоні: лист панелі закриває мапу (і підказку «Клацни на мапі») — ховаємо його, поки людина
  // клацає, і повертаємо, щойно точку вибрано чи вибір скасовано
  const sheetBack = useRef(false)
  useEffect(() => {
    const on = picking || markerPicking
    if (on && useStore.getState().sheet === 'map-panel' && narrow()) { sheetBack.current = true; setSheet(null) }
    else if (!on && sheetBack.current) { sheetBack.current = false; setSheet('map-panel') }
  }, [picking, markerPicking, setSheet])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (useMapUi.getState().picking) setPicking(false)
      else if (useSpice.getState().picking) useSpice.getState().setPicking(false)
      else if (useMarkers.getState().picking) useMarkers.getState().setPicking(false)
      else setFocus(null)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [setPicking])

  // адреса віддзеркалює вибране й шари (мапу й розкладку пишуть їхні перемикачі — кроками історії)
  useEffect(() => {
    if (!def || !enabled) return
    // шари в адресі — лише якщо відрізняються від типових, інакше посилання на півекрана
    const dflt = defaultOn(resp!.source.groups, !OPEN_MAPS.has(def.id))
    const same = dflt.length === enabled.length && dflt.every((t) => enabled.includes(t))
    // запис чи позначка з посилання, які ще дочитуються, — лишаються в адресі
    writeUrl({ r: selected ?? placeParam.current ?? undefined, marker: markerSel ?? markerParam.current ?? undefined, l: same ? undefined : enabled, loot: lootQ ?? undefined, pt: pt ?? undefined })
  }, [def, enabled, selected, markerSel, resp, lootQ, pt]) // eslint-disable-line react-hooks/exhaustive-deps

  // вибрали запис — один переліт до всього, що з ним пов'язано на цій мапі. Якщо в запису є лут,
  // чекаємо його: інакше мапа летіла б спершу до точки, а потім ще раз — до контейнерів.
  const selLoot = lootOf(place)
  const ready = !!place && (!place.loot || selLoot?.loading === false)
  const flyKey = place && def && ready ? `${place.id}|${def.id}|${layout}` : null
  useEffect(() => {
    const map = mapRef.current
    if (!map || !place || !def || !flyKey) return
    const ll: L.LatLngExpression[] = []
    for (const p of place.pins) if (p.map === def.id) ll.push([p.x, p.y])
    for (const h of selLoot?.hits ?? []) ll.push([h.x, h.y])
    for (const t of place.types) {
      const tp = t.map === def.id ? pts[t.type] : null
      if (tp && tp.pts.length / 3 < 400) for (let i = 0; i < tp.pts.length; i += 3) ll.push([tp.pts[i], tp.pts[i + 1]])
    }
    if (!ll.length) return
    flyWithin(map, L.latLngBounds(ll), ll.length === 1 ? def.maxNativeZoom - 1 : def.maxNativeZoom)
  }, [flyKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const fly = (x: number, y: number) => {
    const map = mapRef.current
    if (!map || !def) return
    flyWithin(map, L.latLngBounds([[x, y], [x, y]]), Math.max(map.getZoom(), def.maxNativeZoom))
    setSheet(null)
  }

  const setTypes = (next: string[]) => {
    if (!def) return
    setEnabled(next)
    saveEnabled(def.id, next, !OPEN_MAPS.has(def.id))
  }
  const toggleType = (t: string) => enabled && setTypes(enabled.includes(t) ? enabled.filter((x) => x !== t) : [...enabled, t])

  /** показати річ у панелі: сторінка «Позначки», вкладка, де вона є; sheet — на телефоні відкрити панель */
  const reveal = (sc?: Scope, sheet = true) => {
    if (side !== 'marks') setSide('marks', { replace: true })
    if (sc && sc !== scope) setScope(sc, { replace: true })
    if (sheet) setSheet('map-panel')
  }
  const scopeOfMarker = (id: string): Scope => { const m = markers.find((x) => x.id === id); return m ? scopeOf(m.item) : 'public' }
  const scopeOfPlace = (id: string): Scope => { const p = places.find((x) => x.id === id); return p ? scopeOf(p.item) : 'public' }

  // позначка за посиланням (/map?marker=<id>) чи зі списку з іншої мапи: на її мапу (і розкладку), вибрати й підлетіти;
  // чужу (публічну чи «за посиланням») — дочитати й показати «подивитись»
  useEffect(() => {
    const id = markerParam.current
    if (!id || !def || !useMarkers.getState().ready) return
    const m = allMarkers.find((x) => x.id === id)
    if (!m) {
      markerParam.current = null
      fetch(`/api/markers/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).then((x) => {
        if (!x) return
        usePubMarks.getState().setPeek(x)
        markerParam.current = id
      }).catch(() => {})
      return
    }
    if (m.map !== def.id) { switchMap(m.map, undefined, true); return }
    if (isDD && m.layout != null && m.layout !== layout) { pickWeek(m.layout, true); return }
    markerParam.current = null
    useMarkers.getState().select(m.id)
    reveal(scopeOfMarker(m.id), false)
    setTimeout(() => fly(m.x, m.y), 400)
  }, [allMarkers, def, layout]) // eslint-disable-line react-hooks/exhaustive-deps

  // запис за посиланням (/map?r=<id>): свій — на його мапу; чужий (публічний чи «за посиланням») — дочитати
  useEffect(() => {
    const id = placeParam.current
    if (!id || !def || !placesReady) return
    placeParam.current = null
    const p = places.find((x) => x.id === id)
    const go = (p: Place, sc: Scope) => {
      const to = p.pins?.[0]?.map || p.types?.[0]?.map
      if (!onMap(p, def.id) && to) switchMap(to, p.id, true)
      else select(p.id)
      reveal(sc, false)
    }
    if (p) { go(p, scopeOf(p.item)); return }
    fetch(`/api/places/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).then((x: Place | null) => {
      if (!x) return
      usePubMarks.getState().setPeek(x as PubRow)
      go(x, 'public')
    }).catch(() => {})
  }, [placesReady, def?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // точка гри за посиланням (/map?m=sh_arrakeen&pt=npc_unaffiliated.weapon_vendor — з картки указу Ландсрааду): знайти
  // за стабільним ключем, увімкнути її шар, підлетіти й відкрити її картку. Такої точки вже нема — просто мапа.
  useEffect(() => {
    if (!pt || ptFocus.current || !def || !enabled || index?.map !== def.id) return
    const [type, key] = pt.split('.')
    let live = true
    loadSpot(def.id, layout, type, key).then((s) => {
      if (!live) return
      if (!s) { setPt(null); return }
      ptFocus.current = s
      if (!enabled.includes(s.type)) setTypes([...enabled, s.type])
      setFocus(s)
      // місто ще не вписане в екран — полетимо після вписування (там же)
      if (OPEN_MAPS.has(def.id) || fitted.current === def.id) setTimeout(() => fly(s.x, s.y), 400)
    }).catch(() => live && setPt(null))
    return () => { live = false }
  }, [pt, def, index, !!enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  // картку цієї точки закрили чи вибрали іншу — з адреси її прибираємо
  useEffect(() => {
    if (ptFocus.current && focus !== ptFocus.current) { ptFocus.current = null; setPt(null) }
  }, [focus])

  /** річ зі списку «На інших мапах»: туди, вибрати й підлетіти */
  const openElsewhere = (kind: 'marker' | 'place', id: string, map: string) => {
    if (kind === 'place') { switchMap(map, id); return }
    markerParam.current = id
    switchMap(map)
  }

  /** інша мапа — новий крок історії (з поточною розкладкою); replace — без кроку (перехід за посиланням) */
  const switchMap = (m: string, sel?: string, replace = false) => {
    goUrl(mapUrl({ m, w: null, r: sel ?? null, marker: null, pt: null }), replace)
    select(sel ?? null)
    setFocus(null)
    setPt(null)
  }
  /** інша розкладка Глибокої пустелі — теж крок історії; поточна — без ?w= */
  const pickWeek = (w: number, replace = false) => {
    if (!def) return
    goUrl(mapUrl({ w: w === def.layout ? null : String(w) }), replace)
    setFocus(null)
  }
  /** позначка з іншої розкладки в списку: перейти на її розкладку, вибрати й підлетіти */
  const openWeek = (id: string, w: number) => {
    markerParam.current = id
    pickWeek(w)
  }

  const toggleDone = (f: NonNullable<Focus>) => {
    if (!def) return
    const k = pointKey(f.x, f.y)
    const cur = done[f.type] || []
    const was = cur.includes(k)
    const next = { ...done, [f.type]: was ? cur.filter((x) => x !== k) : [...cur, k] }
    setDone(next)
    saveDone(doneKey(def.id, layout), next)
    // вузол руди: запам'ятати, коли зібрали, — від цього рахується відновлення
    if (respawnable(f.type) || doneAt[`${f.type}|${k}`]) {
      const at = { ...doneAt }
      if (was) delete at[`${f.type}|${k}`]
      else at[`${f.type}|${k}`] = Date.now()
      setDoneAt(at)
      saveDoneAt(doneKey(def.id, layout), at)
      setNow(Date.now())
    }
  }

  /** точку з мапи — у запис: у відкриту чернетку, в існуючий запис або новий запис */
  const attach = async (f: NonNullable<Focus>, to: 'draft' | 'new' | string) => {
    if (!def) return
    const inf = pointInfo(f.type, f.i)
    const pin = { map: def.id, x: f.x, y: f.y, ...(isDD && layout != null ? { layout } : {}), label: inf.name || inf.typeLabel }
    if (to === 'draft') { addPin(pin); toast.success(t('Точку додано до чернетки')); return }
    if (to === 'new') {
      edit({ ...newDraft(def.id), place: inf.name || inf.typeLabel, pins: [pin] })
      select(null)
      reveal()
      return
    }
    const p = places.find((x) => x.id === to)
    if (!p) return
    // додаємо саме точку (сервер допише її до тих, що є), а не весь список — інакше одночасна точка іншого зникла б
    const row = await usePlaces.getState().patch(p.id, { addPins: [pin] })
    if (row) toast.success(t('Точку додано до «{name}»', { name: splitEn(p.res)[0] }))
  }

  // + скрині з потрібним лутом, що не належать жодній локації: вони малюються окремими мітками
  const lootMarks = marks.filter((m) => m.kind === 'loot').length
  const shown = needed.reduce((n, t) => n + (linked.only.has(t) && !gameOn.includes(t) && !linked.full.has(t) ? linked.only.get(t)!.size : index?.counts[t] || 0), 0) + lootMarks

  if (failed) return <PageError page title={t('Мапа зараз не завантажилась')} message={t('Онови сторінку за хвилину.')} onRetry={fetchSource} />
  if (!resp || !def) return <Loading page label={t('Завантаження мапи…')} />

  const marksHere = allMarkers.filter((m) => m.map === def.id).length + allPlaces.filter((p) => onMap(p, def.id)).length
  const panelOpen = sheet === 'map-panel'
  const pointsFailed = indexFailed || ptsFailed.length > 0
  const retryPoints = () => { if (indexFailed) setIndexTry((n) => n + 1); else setPtsFailed([]) }

  return (
    <div className="relative flex min-h-0 flex-1 gap-1.5 sm:gap-2.5">
      <SheetBackdrop open={panelOpen} className="lg:hidden" />
      <aside
        data-open={panelOpen ? 'yes' : 'no'}
        className={cn(SHEET_BASE, 'sheet-lg flex flex-col lg:flex lg:w-[320px] lg:shrink-0 lg:rounded-none lg:border-0 lg:!bg-transparent lg:shadow-none')}
        aria-label={t('Шари мапи')}
      >
        <SheetHead title={t('Мапа')} className="lg:hidden" />
        {/* панель — окремими плаваючими блоками: мапа (з розкладкою Глибокої пустелі), сторінка панелі, вміст сторінки;
            на телефоні (висувна панель) прокручується вся панель разом, а не лише список унизу */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 max-lg:overflow-y-auto max-lg:overscroll-contain lg:gap-2.5 lg:p-0">
        {/* мапа й розкладка — згорнуто: потрібні рідко, а місця займають багато; згорнутий рядок каже, що відкрито */}
        <MapBlock resp={resp} def={def} layout={isDD ? layout! : null} onPick={(m) => switchMap(m)} onWeek={(w) => pickWeek(w)} />
        <div className={cn(BLOCK, 'shrink-0 p-1')}>
          <Seg<Side>
            label={t('Сторінка панелі')}
            value={side}
            onChange={(v) => setSide(v)}
            href={sideHref}
            items={[
              { id: 'game', label: <><Layers size={13} aria-hidden /> {t('Гра')}</>, tip: t('Що є в грі: локації, ресурси, лут, NPC') },
              {
                id: 'marks',
                label: <><MapPinned size={13} aria-hidden /> {t('Позначки')}{marksHere > 0 && <span className="font-mono text-[10px] opacity-70">{marksHere}</span>}</>,
                tip: t('Від гравців: позначки й записи ресурсів — свої, гільдії, публічні'),
              },
            ]}
            className={cn('grid w-full grid-cols-2 border-0 bg-transparent [&>*]:gap-1.5', TOUCH_SEG)}
          />
        </div>
        {/* дві сторінки панелі поруч: перемикач угорі «гортає» їх усередині панелі; на широкому кожна тримає свою прокрутку,
            на телефоні — своєї висоти (прихована — нульової), а прокручується вся панель */}
        <div className={cn(BLOCK, 'relative min-h-0 max-lg:shrink-0 lg:flex-1')} style={{ overflow: 'clip' }}>
          <div className={cn('flex w-[200%] items-start transition-transform duration-300 ease-out motion-reduce:transition-none lg:absolute lg:inset-y-0 lg:left-0 lg:items-stretch', side === 'marks' && '-translate-x-1/2')}>
            <div ref={gamePage} data-scroller className={cn('relative w-1/2 overflow-x-hidden lg:h-full lg:overflow-y-auto', side !== 'game' && 'max-lg:h-0')}>
              <div className="flex flex-col gap-2 border-b border-line p-2.5">
                {respawning.n > 0 && (
                  <div className="grid gap-1.5 rounded-md border border-line bg-panel2/40 px-2 py-1.5 text-[12px]">
                    <span className="flex items-center gap-1.5">
                      <span className="h-3 w-3 shrink-0 rounded-full border-2 border-[#f0a54a] border-r-transparent" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <T text="Відновлюються {n} · найближчий через {time}" n={<b>{respawning.n}</b>} time={<b className="font-mono">{t('{n} хв', { n: Math.max(1, Math.ceil(respawning.soonest / 60_000)) })}</b>} />
                      </span>
                    </span>
                    {/* скільки відновлюється вузол — усі варіанти поруч */}
                    <Seg<string>
                      label={t('Скільки відновлюється вузол')}
                      size="sm"
                      value={String(respawn)}
                      onChange={(v) => { setRespawn(Number(v)); setRespawnMin(Number(v)) }}
                      items={[15, 30, 45, 60, 90, 120].map((m) => ({ id: String(m), label: t('{n} хв', { n: m }) }))}
                      className={cn('grid w-full grid-cols-6 [&>*]:px-0', TOUCH_SEG)}
                    />
                  </div>
                )}
                <MapSearch index={index} resp={resp} onFly={(x, y, f) => { fly(x, y); if (f) setFocus(f) }} onType={(t) => enabled && !enabled.includes(t) && setTypes([...enabled, t])} />
              </div>
              <SpiceSection
                types={types}
                counts={spiceSpots.length ? { ...index?.counts, [TYPE_OF.large]: (index?.counts?.[TYPE_OF.large] || 0) + spiceSpots.length } : index?.counts ?? {}}
                enabled={enabled ?? []}
                ring={ringTypes}
                onToggle={toggleType}
                onAll={(all) => enabled && setTypes(all ? [...new Set([...enabled, ...SPICE_IDS])] : enabled.filter((x) => !SPICE_IDS.includes(x)))}
                active={spiceFields.length}
                onPickLarge={isDD && authUser ? () => { useSpice.getState().setPicking(true); if (narrow()) setSheet(null) } : undefined}
              />
              {!index && !indexFailed && <Loading lines={7} className="p-3" />}
              {resp.source.groups.map((g) => {
                // поля меланжу — окремим розділом вище
                const list = g.types.filter((t) => index?.counts[t.id] && !SPICE[t.id])
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
                        swatch={SPICE[t.id] ? <SpiceDot type={t.id} /> : undefined}
                        onToggle={() => toggleType(t.id)}
                      />
                    ))}
                  </Section>
                )
              })}
              <SourceNote resp={resp} onFresh={setResp} />
            </div>
            <div ref={marksPage} data-scroller className={cn('relative w-1/2 overflow-x-hidden lg:h-full lg:overflow-y-auto', side !== 'marks' && 'max-lg:h-0')}>
              <MarksPanel def={def} layout={layout} resp={resp} counts={index?.counts ?? {}} loot={lootOf(place)} onLootRetry={retryLoot} onFly={fly} onOpen={openElsewhere} onWeek={openWeek} />
            </div>
          </div>
        </div>
        </div>
      </aside>

      <section className="relative isolate min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel shadow-lg">
        <div ref={divRef} className="map-box absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-2.5 top-2.5 z-[500] flex items-start gap-2">
          <div className="pointer-events-auto flex flex-col gap-1 lg:hidden">
            <button
              type="button"
              onClick={() => { setSide('game', { replace: true }); setSheet('map-panel') }}
              className="flex h-10 items-center gap-1.5 rounded-md border border-line bg-panel/95 px-3 text-[13px] font-medium shadow backdrop-blur"
            >
              <Layers size={15} /> {t('Шари')}
            </button>
            <button
              type="button"
              onClick={() => { setSide('marks', { replace: true }); setSheet('map-panel') }}
              className="flex h-10 items-center gap-1.5 rounded-md border border-line bg-panel/95 px-3 text-[13px] font-medium shadow backdrop-blur"
            >
              <MapPinned size={15} /> {t('Позначки')}
            </button>
          </div>
          <div className="mx-auto flex min-w-0 flex-col items-center gap-1.5">
            {/* лут із довідника: решта шарів схована, доки не знімеш */}
            {lootPlace && (
              <div className="pointer-events-auto flex max-w-[min(520px,100%)] items-center gap-2 rounded-md border border-spice/60 bg-panel/95 py-1 pl-3 pr-1 text-[12px] shadow backdrop-blur">
                <Filter size={13} className="shrink-0 text-spice" />
                <span className="min-w-0 truncate">{t('Лише: {list}', { list: t('лут «{res}»', { res: lootPlace.res }) })}</span>
                <button type="button" className={cn('grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:text-ink', TOUCH)} onClick={() => setLootQ(null)} aria-label={t('Зняти фільтр')}>
                  <X size={14} />
                </button>
              </div>
            )}
            {pointsFailed && <IndexError onRetry={retryPoints} className="pointer-events-auto max-w-[min(420px,100%)] shadow-lg" />}
            {picking && (
              <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-spice bg-panel/95 py-1 pl-3 pr-1 text-[12px] shadow backdrop-blur">
                <Crosshair size={14} className="shrink-0 text-spice" /> {t('Клацни на мапі — додати точку')}
                <button type="button" className={cn('grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:text-ink', TOUCH)} onClick={() => setPicking(false)} aria-label={t('Досить точок')}>
                  <X size={14} />
                </button>
              </div>
            )}
            {spicePicking && (
              <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-spice bg-panel/95 py-1 pl-3 pr-1 text-[12px] shadow backdrop-blur">
                <Crosshair size={14} className="shrink-0 text-spice" /> {t('Клацни на мапі, де зараз велике поле')}
                <button type="button" className={cn('grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:text-ink', TOUCH)} onClick={() => useSpice.getState().setPicking(false)} aria-label={t('Скасувати')}>
                  <X size={14} />
                </button>
              </div>
            )}
            {markerPicking && !picking && (
              <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-spice bg-panel/95 py-1 pl-3 pr-1 text-[12px] shadow backdrop-blur">
                <Crosshair size={14} className="shrink-0 text-spice" /> {t('Клацни на мапі, де поставити позначку')}
                <button type="button" className={cn('grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:text-ink', TOUCH)} onClick={() => useMarkers.getState().setPicking(false)} aria-label={t('Скасувати')}>
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
          <div className="pointer-events-auto flex flex-col gap-1">
            <MapBtn tip={t('Наблизити')} onClick={() => mapRef.current?.zoomIn()}><Plus size={14} /></MapBtn>
            <MapBtn tip={t('Віддалити')} onClick={() => mapRef.current?.zoomOut()}><Minus size={14} /></MapBtn>
            <MapBtn
              tip={t('Уся мапа')}
              onClick={() => mapRef.current?.fitBounds(!OPEN_MAPS.has(def.id) && index?.bbox ? L.latLngBounds(index.bbox).pad(0.12) : L.latLngBounds(def.bounds))}
            >
              <Maximize2 size={13} />
            </MapBtn>
            {OPEN_MAPS.has(def.id) && (
              <MapBtn
                tip={group ? t('Не групувати однакові значки') : t('Групувати однакові значки з лічильником')}
                on={group}
                onClick={() => { setGroup(!group); prefSet('map:cluster', !group) }}
              >
                <Boxes size={14} />
              </MapBtn>
            )}
          </div>
        </div>
        {focus && (
          <PointCard
            focus={focus}
            info={pointInfo(focus.type, focus.i)}
            icon={types.get(focus.type)?.icon ?? null}
            dims={dims}
            types={types}
            resp={resp}
            done={!!done[focus.type]?.includes(pointKey(focus.x, focus.y))}
            respawnLeft={doneAt[`${focus.type}|${pointKey(focus.x, focus.y)}`] ? doneAt[`${focus.type}|${pointKey(focus.x, focus.y)}`] + respawnMs - now : null}
            onDone={() => toggleDone(focus)}
            onClose={() => setFocus(null)}
            z={pts[focus.type]?.pts[focus.i * 3 + 2]}
            sector={grid ? sectorOf(grid, focus.x, focus.y) : null}
            hasDraft={!!draft}
            records={places.filter((p) => onMap(p, def.id) && p.item?.can?.edit !== false)}
            onAttach={(to) => void attach(focus, to)}
            extra={SIZE_OF[focus.type] ? (
              <SpiceActive
                field={spiceByKey.get(fieldKey(SIZE_OF[focus.type], focus.x, focus.y)) ?? null}
                at={{ map: def.id, layout: isDD ? layout : null, size: SIZE_OF[focus.type], x: Math.round(focus.x), y: Math.round(focus.y) }}
              />
            ) : null}
          />
        )}
        <div ref={tipRef} hidden className="map-tip pointer-events-none absolute z-[600] w-max max-w-[300px] rounded-lg border border-line bg-panel/95 px-2.5 py-2 text-[12px] shadow-lg backdrop-blur" />
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-[500] flex max-w-[calc(100%-20px)] gap-1.5 rounded-md border border-line bg-panel/90 px-2.5 py-1 font-mono text-[10.5px] text-muted shadow backdrop-blur">
          {/* координати під курсором (на телефоні — там, де торкнулись) пише сам обробник руху — не React */}
          <span ref={coordsRef} className="truncate [&:empty+span]:hidden" />
          <span aria-hidden>·</span>
          <span className="shrink-0">{pointsFailed ? t('точки не завантажились') : !index || needed.some((k) => !pts[k] && !ptsFailed.includes(k)) ? t('завантаження…') : plural(shown, [t('точка'), t('точки'), t('точок')])}</span>
        </div>
      </section>
    </div>
  )
}

/** точки мапи не завантажились: що сталось і «Спробувати ще» */
function IndexError({ onRetry, className }: { onRetry: () => void; className?: string }) {
  return (
    <ErrorAlert className={className} title={t('Точки мапи не завантажились')} message={t('Онови сторінку трохи згодом.')}>
      <Button size="xs" variant="outline" className="mt-2" onClick={onRetry}><RefreshCw size={12} /> {t('Спробувати ще')}</Button>
    </ErrorAlert>
  )
}

/**
 * Жорсткі межі перетягування. Вбудований maxBoundsViscosity ламається, коли мапа вужча за
 * вікно (переставляє мінімум і максимум) — і мапа спершу тягнеться, а потім ривком вертається.
 * Тут: по осі, де мапа менша за вікно, вона стоїть по центру; по іншій — тягнеться лише до краю.
 */
function lockDrag(map: L.Map) {
  type D = { _startPos: L.Point; _newPos: L.Point; on: (ev: string, fn: () => void) => void }
  const drag = (map.dragging as unknown as { _draggable?: D })._draggable
  let lim: { x0: number; x1: number; y0: number; y1: number } | null = null
  map.on('dragstart', () => {
    const mb = map.options.maxBounds as L.LatLngBounds | undefined
    if (!mb) { lim = null; return }
    const a = map.latLngToContainerPoint(mb.getNorthWest()), b = map.latLngToContainerPoint(mb.getSouthEast())
    const size = map.getSize()
    const nx = Math.min(a.x, b.x), xx = Math.max(a.x, b.x), ny = Math.min(a.y, b.y), xy = Math.max(a.y, b.y)
    lim = {
      x0: xx - nx <= size.x ? 0 : size.x - xx, x1: xx - nx <= size.x ? 0 : -nx,
      y0: xy - ny <= size.y ? 0 : size.y - xy, y1: xy - ny <= size.y ? 0 : -ny,
    }
  })
  drag?.on('predrag', () => {
    if (!lim || !drag) return
    const o = drag._newPos.subtract(drag._startPos)
    o.x = Math.max(lim.x0, Math.min(lim.x1, o.x))
    o.y = Math.max(lim.y0, Math.min(lim.y1, o.y))
    drag._newPos = drag._startPos.add(o)
  })
}

/**
 * Переліт, що не виходить за межі мапи: ціль одразу обмежуємо так, як це зробив би maxBounds,
 * інакше Leaflet спершу летить «за край», а потім ривком повертає назад.
 */
function flyWithin(map: L.Map, b: L.LatLngBounds, maxZoom: number) {
  const pad = b.getNorthEast().equals(b.getSouthWest()) ? b : b.pad(0.2)
  const z = Math.min(maxZoom, map.getBoundsZoom(pad, false), map.getMaxZoom())
  const mb = map.options.maxBounds as L.LatLngBounds | undefined
  const lim = (map as unknown as { _limitCenter: (c: L.LatLng, z: number, b?: L.LatLngBounds) => L.LatLng })._limitCenter
  const c = mb ? lim.call(map, pad.getCenter(), z, mb) : pad.getCenter()
  map.flyTo(c, Math.max(z, map.getMinZoom()), { duration: 0.7 })
}

const SPICE_IDS = Object.keys(SPICE)

/**
 * Поля меланжу окремим розділом: малі, середні й великі — кожне своєю галочкою, навіть якщо
 * на цій мапі (чи цього тижня в Глибокій пустелі) таких зараз немає — тоді лічильник 0.
 */
function SpiceSection({
  types,
  counts,
  enabled,
  ring,
  onToggle,
  onAll,
  active,
  onPickLarge,
}: {
  types: Map<string, TypeDef & { group: string }>
  counts: Record<string, number>
  enabled: string[]
  ring: Set<string>
  onToggle: (t: string) => void
  onAll: (all: boolean) => void
  /** скільки полів зараз позначено активними */
  active: number
  /** позначити велике поле там, де клацнуть (Глибока пустеля, після входу) */
  onPickLarge?: () => void
}) {
  const on = SPICE_IDS.filter((t) => enabled.includes(t))
  const total = SPICE_IDS.reduce((n, t) => n + (counts[t] || 0), 0)
  // мапи без полів меланжу (міста, підземелля) — без цього блоку
  if (!total && !onPickLarge && !active) return null
  return (
    <Section id="g:spice" title={t('Поля меланжу')} count={`${on.length}/3 · ${fmtN(total)}`} allOn={on.length === SPICE_IDS.length} onAll={onAll}>
      {SPICE_IDS.map((t) => (
        <TypeRow
          key={t}
          icon={types.get(t)?.icon ?? null}
          dims={null}
          label={SPICE[t].label}
          count={counts[t] || 0}
          on={enabled.includes(t)}
          ring={ring.has(t)}
          swatch={<SpiceDot type={t} />}
          onToggle={() => onToggle(t)}
        />
      ))}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 pt-1 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">{active > 0 && <span className="spice-dot" aria-hidden />}{active ? plural(active, [t('активне поле'), t('активні поля'), t('активних полів')]) : t('Активних полів ніхто не позначив')}</span>
        {onPickLarge && (
          <button type="button" onClick={onPickLarge} className="ml-auto inline-flex min-h-7 items-center gap-1 rounded-md border border-spice/50 px-2 text-[11.5px] font-medium text-spice hover:bg-spice/10 [@media(pointer:coarse)]:min-h-9">
            <Crosshair size={12} aria-hidden /> {t('Велике поле тут…')}
          </button>
        )}
      </div>
    </Section>
  )
}

/** Кружечок поля меланжу для панелі — як на мапі: розмір і колір за величиною поля. */
function SpiceDot({ type }: { type: string }) {
  const sp = SPICE[type]
  const d = Math.round(sp.r * 1.5)
  return (
    <span
      className="flex items-center justify-center rounded-full border border-black/70 text-[8px] font-bold text-black/80"
      style={{ width: d, height: d, background: sp.color }}
      data-tip={t('Поле меланжу: {name}', { name: sp.name })}
    >
      {d >= 12 ? sp.letter : ''}
    </span>
  )
}

function MapBtn({ children, tip, onClick, on }: { children: React.ReactNode; tip: string; onClick: () => void; on?: boolean }) {
  return (
    <button
      type="button"
      aria-label={tip}
      aria-pressed={on}
      data-tip={tip}
      onClick={onClick}
      className={cn('flex h-8 w-8 items-center justify-center rounded-md border bg-panel/95 shadow backdrop-blur hover:text-spice', TOUCH, on ? 'border-spice/60 text-spice' : 'border-line text-muted')}
    >
      {children}
    </button>
  )
}

/** плаваючий блок панелі мапи (на телефоні — блок у листі) */
const BLOCK = 'rounded-xl border border-line bg-panel lg:shadow-lg'
/** перемикач вибору (мапа, печера, розкладка): одна невелика форма для всіх; вибраний — спайсом */
const TILE = 'inline-flex min-h-7 items-center justify-center rounded-md border px-2 py-0.5 text-[12px] leading-tight transition-colors [@media(pointer:coarse)]:min-h-9'
const TILE_ON = 'border-spice/60 bg-spice/10 font-semibold text-spice'
const TILE_OFF = 'border-line/80 bg-panel2/40 text-ink/85 hover:border-spice/40 hover:text-ink'

/** відлік до бурі коротко — для згорнутого рядка (повністю — у підказці) */
function StormShort() {
  const { left, warn } = useStorm()
  const Icon = warn ? CloudLightning : Wind
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', warn && 'text-spice')} title={t('Буря Коріоліса через {left}', { left: fmtLeft(left) })}>
      <Icon size={13} className={cn('shrink-0', warn && 'animate-pulse')} aria-hidden />
      <b className="truncate font-mono font-semibold tabular-nums">{fmtLeft(left)}</b>
    </span>
  )
}

/**
 * Мапа й розкладка — один блок, згорнутий за замовчуванням: рядок каже, яка мапа (і розкладка Глибокої пустелі з
 * відліком до бурі); розгорнуто — великі мапи, печери й підземелля і розкладки з таймером, усе відкрито (згортати
 * всередині вже нема чого). Розгорнуте лишається між відвідинами.
 */
function MapBlock({ resp, def, layout, onPick, onWeek }: { resp: SourceResp; def: MapDef; layout: number | null; onPick: (m: string) => void; onWeek: (w: number) => void }) {
  const all = resp.source.maps.filter((m) => !HIDDEN_MAPS.has(m.id))
  const main = MAP_ORDER.filter((id) => all.some((m) => m.id === id))
  const small = all.filter((m) => !MAP_ORDER.includes(m.id)).sort((a, b) => mapName(resp.labels, a.id).localeCompare(mapName(resp.labels, b.id), locale()))
  const current = def.id
  const inSmall = small.some((m) => m.id === current)
  const [open, setOpen] = useState(() => prefGet('map:pickOpen', false))
  const toggle = () => { setOpen(!open); prefSet('map:pickOpen', !open) }
  const href = (m: string) => `/map?m=${encodeURIComponent(m)}`
  // Глибока пустеля: розкладка цього тижня, коли її бачили, і чи мапа ще показує минулий тиждень
  const dd = layout != null
  const seen = dd ? [...resp.ddHistory].reverse().find((h) => h.layout === def.layout) : undefined
  const stale = useStale(seen?.seenAt) && dd && layout === def.layout
  const cur = dd ? def.layouts.find((l) => l.id === layout) : undefined
  // у згорнутому рядку — коротко (поруч ще відлік до бурі); не цей тиждень — кольором
  const layoutLabel = !dd ? '' : t('Розкладка {n}', { n: layout! })
  const title = (s: string) => <h3 className="mb-1.5 font-display text-[11px] font-semibold uppercase tracking-wide text-muted">{s}</h3>
  return (
    <section className={cn(BLOCK, 'shrink-0 overflow-hidden')} aria-label={t('Мапа')}>
      <button type="button" aria-expanded={open} onClick={toggle} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-panel2/50 [@media(pointer:coarse)]:min-h-12">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-spice/10 text-spice"><MapIcon size={16} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">{mapName(resp.labels, current)}</span>
          {dd
            ? (
              <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-muted">
                <span className={cn('shrink-0 font-medium', layout !== def.layout ? 'text-spice' : 'text-ink/85')} title={cur && !cur.resources ? t('{name} (без руди)', { name: layoutLabel }) : undefined}>{layoutLabel}{cur && !cur.resources && ' *'}</span>
                <StormShort />
              </span>
            )
            : <span className="block truncate text-[11.5px] text-muted">{inSmall ? t('Печери й підземелля') : t('Мапа')}</span>}
        </span>
        <ChevronDown size={16} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {/* згорнуто — підказку однаково видно */}
      {stale && !open && <p className="border-t border-line px-3 py-1.5 text-[11px] leading-snug text-spice">{t("Мапа ще показує минулий тиждень — нова розкладка з'явиться найближчим часом.")}</p>}
      {open && (
        <div className="grid gap-2.5 border-t border-line p-3">
          <div>
            {title(t('Мапа'))}
            <div className="flex flex-wrap gap-1" role="group" aria-label={t('Мапа')}>
              {main.map((id) => (
                <a
                  key={id}
                  href={href(id)}
                  aria-current={id === current ? 'page' : undefined}
                  data-tip={labelOf(resp.labels, id)}
                  onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); onPick(id) }}
                  className={cn(TILE, id === current ? TILE_ON : TILE_OFF)}
                >
                  {mapName(resp.labels, id)}
                </a>
              ))}
            </div>
          </div>
          {small.length > 0 && (
            <div>
              {title(t('Печери й підземелля'))}
              <div className="flex flex-wrap gap-1" role="group" aria-label={t('Печери й підземелля')}>
                {small.map((m) => (
                  <a
                    key={m.id}
                    href={href(m.id)}
                    aria-current={m.id === current ? 'page' : undefined}
                    onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); onPick(m.id) }}
                    className={cn(TILE, m.id === current ? TILE_ON : TILE_OFF)}
                  >
                    {mapName(resp.labels, m.id)}
                  </a>
                ))}
              </div>
            </div>
          )}
          {dd && (
            <div>
              {title(seen ? t('Розкладка {n} — зараз, з {date}', { n: def.layout, date: fmtDate(seen.seenAt) }) : t('Розкладка'))}
              <div role="group" aria-label={t('Розкладка')} className="grid grid-cols-6 gap-1">
                {def.layouts.map((l) => {
                  const on = l.id === layout
                  return (
                    <a
                      key={l.id}
                      href={`/map?m=${encodeURIComponent(def.id)}${l.id === def.layout ? '' : `&w=${l.id}`}`}
                      aria-current={on ? 'true' : undefined}
                      onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); onWeek(l.id) }}
                      data-tip={l.id === def.layout ? t('Розкладка {n} — зараз', { n: l.id }) : l.resources ? t('Розкладка {n}', { n: l.id }) : t('{name} (без руди)', { name: t('Розкладка {n}', { n: l.id }) })}
                      className={cn(TILE, 'relative px-0 font-mono', on ? TILE_ON : TILE_OFF, !l.resources && 'opacity-60')}
                    >
                      {l.id}
                      {l.id === def.layout && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-spice" aria-hidden />}
                    </a>
                  )
                })}
              </div>
            </div>
          )}
          {/* буря — окремою частиною блоку: риска й заголовок, без рамки всередині рамки */}
          {dd && (
            <div className="-mx-3 border-t border-line px-3 pt-3">
              {title(t('Буря Коріоліса'))}
              <DDTimer narrow since={layout === def.layout ? seen?.seenAt : null} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const norm = (s: string) => s.toLowerCase().replace(/№|\bno\.?(?=\s*\d)|[«»"'.,#]/g, ' ').replace(/\s+/g, ' ').trim()

/** Пошук на мапі: місця за назвою (мовою сайту й англійською) і шари за назвою типу; стрілки, Enter і Esc — з клавіатури. */
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
  const [at, setAt] = useState(-1)
  const ql = q.trim().toLowerCase()
  const res = useMemo(() => {
    if (ql.length < 2 || !index) return { named: [], types: [] as string[] }
    // за словами: «станція 13» знаходить «Імперська випробувальна станція № 13» і «No. 13»; число — цілим словом
    const words = norm(ql).split(' ').filter(Boolean)
    const hit = (s: string) => words.every((w) => (/^\d+$/.test(w) ? new RegExp(`(^|\\D)${w}(\\D|$)`).test(s) : s.includes(w)))
    const named = index.named.filter((n) => hit(norm(n[2] + ' ' + (n[3] || '')))).slice(0, 12)
    const tl = Object.keys(index.counts).filter((t) => hit(norm(labelOf(resp.labels, t) + ' ' + t))).slice(0, 6)
    return { named, types: tl }
  }, [ql, index, resp])
  useEffect(() => setAt(-1), [ql])
  // усе знайдене одним списком: спершу шари, далі місця
  const all: (() => void)[] = [
    ...res.types.map((ty) => () => { onType(ty); setQ('') }),
    ...res.named.map(([ty, i, , , x, y]) => () => { onFly(x, y, { type: ty, i, x, y }); setQ('') }),
  ]
  const open = ql.length >= 2
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (all.length) setAt((n) => (e.key === 'ArrowDown' ? (n + 1) % all.length : (n - 1 + all.length) % all.length))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      const go = all[at >= 0 ? at : 0]
      if (go) { e.preventDefault(); go() }
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setQ('')
    }
  }
  const opt = (k: number) => cn('flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12px] hover:bg-panel2 [@media(pointer:coarse)]:min-h-10', at === k && 'bg-panel2')
  return (
    <div className="relative">
      <SnInput
        type="search"
        modelValue={q}
        onInput={(e: Event) => setQ(valueOf(e))}
        onChange={(e: Event) => setQ(valueOf(e))}
        onKeyDown={onKey}
        placeholder={t('Пошук: місце, печера, тип…')}
        accessibilityLabel={t('Пошук на мапі')}
      />
      {open && (
        <div role="listbox" aria-label={t('Пошук на мапі')} className="absolute inset-x-0 top-9 z-10 max-h-72 overflow-y-auto rounded-md border border-line bg-panel p-1 shadow-xl">
          {!all.length && <p className="px-2 py-1.5 text-[12px] text-muted">{t('Нічого не знайдено.')}</p>}
          {res.types.map((ty, k) => (
            <button key={ty} type="button" role="option" aria-selected={at === k} className={opt(k)} onClick={all[k]} onMouseEnter={() => setAt(k)}>
              <Layers size={12} className="text-muted" /> {t('Шар «{name}»', { name: labelOf(resp.labels, ty) })} <span className="ml-auto font-mono text-[10px] text-muted">{index?.counts[ty]}</span>
            </button>
          ))}
          {res.named.map(([ty, i, name, en], j) => {
            const k = res.types.length + j
            return (
              <button key={`${ty}:${i}`} type="button" role="option" aria-selected={at === k} className={opt(k)} onClick={all[k]} onMouseEnter={() => setAt(k)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{name}</span>
                  <span className="block truncate text-[10.5px] text-muted">{labelOf(resp.labels, ty)}{en && en !== name ? ` · ${en}` : ''}</span>
                </span>
              </button>
            )
          })}
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
  types,
  resp,
  done,
  respawnLeft,
  onDone,
  onClose,
  z,
  sector,
  hasDraft,
  records,
  onAttach,
  extra,
}: {
  focus: NonNullable<Focus>
  info: { name: string | null; desc: string | null; en: string | null; typeLabel: string; sum: LocSummary | null }
  icon: [number, number, number, number] | null
  dims: [number, number] | null
  types: Map<string, TypeDef & { group: string }>
  resp: SourceResp
  done: boolean
  /** вузол руди відновлюється: скільки ще, мс; null — не відновлюється */
  respawnLeft: number | null
  onDone: () => void
  onClose: () => void
  z?: number
  sector: string | null
  hasDraft: boolean
  records: Place[]
  onAttach: (to: 'draft' | 'new' | string) => void
  /** додаткове під описом (активне поле меланжу) */
  extra?: React.ReactNode
}) {
  const s = info.sum
  const res = s ? [...s.res].sort((a, b) => Number(PLANTS.has(a[0])) - Number(PLANTS.has(b[0])) || b[1] - a[1]) : []
  const btn = 'h-7 rounded-md border px-2.5 text-[11.5px] font-medium [@media(pointer:coarse)]:h-10'
  // «+ до запису»: усі записи цієї мапи списком (а не випадним меню)
  const [pick, setPick] = useState(false)
  useEffect(() => setPick(false), [focus.type, focus.i])
  return (
    <div className="absolute bottom-11 right-2.5 z-[650] flex max-h-[calc(100%-110px)] w-[min(330px,calc(100%-20px))] flex-col rounded-xl border border-line bg-panel/95 p-3 text-[12px] shadow-2xl backdrop-blur">
      <div className="flex items-start gap-2">
        <SpriteIcon icon={icon} dims={dims} px={30} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-tight">{info.name || info.typeLabel}</div>
          <div className="text-[11px] text-muted">{[info.name ? info.typeLabel : null, info.en && info.en !== info.name ? info.en : null].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={t('Закрити')} className={cn('-m-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-panel2 hover:text-ink', TOUCH)}><X size={15} /></button>
      </div>
      <div className="mt-2 min-h-0 overflow-y-auto">
        {s ? (
          <>
            {s.loot.length > 0 && (
              <>
                <div className="mb-0.5 font-display text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">{t('Лут · {boxes}', { boxes: boxes(s.boxes) })}</div>
                <ul className="grid gap-px">
                  {s.loot.map(([n, pc, c]) => (
                    <li key={n} className="flex gap-1.5">
                      <span className="w-9 shrink-0 text-right font-mono text-[10.5px] font-semibold text-spice">{pc}%</span>
                      <span className="min-w-0 flex-1">{n}</span>
                      {c > 1 && <span className="font-mono text-[10px] text-muted">×{c}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {res.length > 0 && (
              <>
                <div className="mb-1 mt-2 font-display text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted">{t('Поруч')}</div>
                <div className="flex flex-wrap gap-1">
                  {res.map(([t, n]) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-md bg-panel2/70 py-0.5 pl-0.5 pr-1.5 text-[11px]" data-tip={labelOf(resp.labels, t)}>
                      <SpriteIcon icon={types.get(t)?.icon ?? null} dims={dims} px={18} />
                      {n}
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          info.desc && <div className="rounded-md bg-panel2/50 p-2 leading-snug" dangerouslySetInnerHTML={{ __html: safeDesc(info.desc) }} />
        )}
        {extra}
      </div>
      <div className="mt-2 font-mono text-[10.5px] text-muted">
        {sector && <b className="mr-1 text-ink">{sector}</b>}X {fmtC(focus.x)} · Y {fmtC(focus.y)}{z != null ? ` · Z ${fmtC(z)}` : ''}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={onDone} className={cn(btn, done ? 'border-ok/50 bg-ok/15 text-ok' : 'border-line hover:bg-panel2')}>
          {done ? (respawnLeft != null ? t('✓ Зібрано · відновиться через {n} хв', { n: Math.max(1, Math.ceil(respawnLeft / 60_000)) }) : t('✓ Зібрано')) : t('Зібрано')}
        </button>
        {hasDraft ? (
          <button type="button" onClick={() => onAttach('draft')} className={cn(btn, 'border-spice/50 text-spice hover:bg-spice/10')}>
            {t('+ до чернетки')}
          </button>
        ) : (
          <>
            <button type="button" onClick={() => onAttach('new')} className={cn(btn, 'inline-flex items-center gap-1 border-spice/50 text-spice hover:bg-spice/10')} data-tip={t('Новий запис ресурсу з цією точкою')}>
              <Star size={12} /> {t('Наш ресурс тут')}
            </button>
            {records.length > 0 && (
              <button type="button" aria-expanded={pick} onClick={() => setPick(!pick)} className={cn(btn, 'border-line text-muted hover:bg-panel2 hover:text-ink', pick && 'bg-panel2 text-ink')}>
                {t('+ до запису…')}
              </button>
            )}
          </>
        )}
      </div>
      {pick && !hasDraft && (
        <ul aria-label={t('Додати точку до запису')} className="mt-1.5 grid max-h-40 grid-cols-[minmax(0,1fr)] gap-0.5 overflow-y-auto rounded-md border border-line p-0.5">
          {records.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => { setPick(false); onAttach(r.id) }}
                className="flex w-full flex-wrap items-baseline gap-x-1.5 rounded px-2 py-1 text-left hover:bg-panel2 [@media(pointer:coarse)]:min-h-10 [@media(pointer:coarse)]:content-center [@media(pointer:coarse)]:items-center"
              >
                <span className="min-w-0 break-words font-medium">{splitEn(r.res)[0]}</span>
                <span className="min-w-0 break-words text-[11px] text-muted">{splitEn(r.place)[0]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SourceNote({ resp, onFresh }: { resp: SourceResp; onFresh: (r: SourceResp) => void }) {
  const [busy, setBusy] = useState(false)
  const user = useAuth((s) => s.user)
  return (
    <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-[10.5px] text-muted">
      {/* дата — коли сервер востаннє звірявся з TH.GL, а не коли вийшла розкладка */}
      <span className="min-w-0 flex-1">
        {/* точки з файлів гри (у даних є власний спрайт) — так і кажемо; тайли мапи — завжди TH.GL */}
        {resp.source.sprite && <>{t('Точки — з файлів гри, мапа — з')} </>}
        <a className="underline" href="https://duneawakening.th.gl" target="_blank" rel="noopener">TH.GL</a> · {t('перевірено {date}', { date: fmtDate(resp.source.syncedAt) })}
        <DataStamp sep sections={['markers', 'ddLayouts']} />
      </span>
      {user && <button
        type="button"
        disabled={busy}
        data-tip={t('Перевірити, чи вийшла свіжа мапа (нова розкладка Глибокої пустелі)')}
        aria-label={t('Оновити дані мапи')}
        className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line hover:text-spice disabled:opacity-50', TOUCH)}
        onClick={async () => {
          // без перезавантаження сторінки: відкрита чернетка позначки чи запису не губиться
          setBusy(true)
          try {
            const r = await fetch('/api/map/refresh', { method: 'POST' })
            if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || t('Сервер зараз не відповідає. Спробуй ще раз трохи згодом.'))
            const { resp: fresh, changed } = await reloadSource()
            if (changed) onFresh(fresh)
            const dd = fresh.source.maps.find((m) => m.id === 'deepdesert_1')?.layout
            toast.success(changed ? t('Мапу оновлено') : t('Мапа вже свіжа'), { description: dd != null ? t('Глибока пустеля: розкладка {n}', { n: dd }) : undefined })
          } catch (e) {
            toast.error(t('Не вдалося перевірити мапу'), { description: (e as Error).message })
          } finally {
            setBusy(false)
          }
        }}
      >
        <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
      </button>}
    </div>
  )
}

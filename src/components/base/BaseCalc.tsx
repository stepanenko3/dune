/**
 * Калькулятор бази — замість кошторису. Ціль — будівлі бази з моделі: будівельні деталі (ціна в гранітному
 * камені), пентащити й пристрої (їхні матеріали), паливо генераторів на тиждень; у Deep Desert — зі знижкою
 * моделі (costFactor). Кількість можна правити, рядки — прибирати, можна додати будь-які предмети й будівлі
 * довідника. Правки спільні: хто може змінювати базу — зберігає їх для всіх (сервер, PUT …/calc), решта бачить їх
 * і може крутити числа лише в себе (prefs `base:<id>:calc`); «Скинути» повертає модель (чи спільні числа).
 * Енергія — з потужності пристроїв у довіднику (вітряки, генератори дають; переробники, фабрикатори беруть), у
 * кількості з калькулятора, плюс пентащити (по 3 на секцію).
 * Далі — спільний ProdCalc: що потрібно на будівництво, сировина, крафти, де і скільки часу, вода;
 * указ тижня — з головної.
 */
import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Card, SectionTitle } from '@/components/ui/card'
import { iconUrl, loadCatalog, wikiImg, type CatalogIndex } from '@/lib/catalog'
import type { Target } from '@/lib/calc'
import { saveCalc, useBases, type CalcEdits } from '@/lib/bases'
import { prefGet, prefSet } from '@/lib/prefs'
import { fmtN } from '@/lib/utils'
import { t, T } from '@/lib/i18n'
import { ProdCalc } from '@/components/catalog/ProdCalc'
import { Loading } from '@/components/states'
import { openInCatalog } from '@/components/catalog/bits'
import type { BaseCtx } from './ctx'
import { lab } from './tr'
import { buildIdOf, energyOf, fuelGens, ICON_OF, modelsOf, RECIPE_BUILD, ROW_BUILD } from './power'

/* eslint-disable @typescript-eslint/no-explicit-any */
/** матеріали моделі бази (src/engine/build.js) → предмети довідника */
export const BASE_ITEMS: Record<string, string> = {
  stone: 'Stone', // гранітний камінь
  steel: 'SteelBar',
  cobalt: 'CobaltBar',
  servo: 'T3MiningGalleryComponent1', // відкалібрований сервок
  scrap: 'ScrapMetal',
  iron: 'IronBar',
  alu: 'AluminiumBar',
  silicone: 'Silicone',
  fuel: 'Oil', // паливний елемент
}

/** категорія для будівлі, доданої з довідника, — за групою пристрою гри (будівельні деталі — без категорії) */
export const buildCat = (b: { id: string; group: string } | null | undefined) =>
  !b || !/_Placeable$/.test(b.id) ? null : b.group === 'storage' ? 'store' : ['fabricator', 'refinery', 'utility', 'misc'].includes(b.group) ? 'prod' : null

type Edits = CalcEdits
/** пристрої моделі з фіксованою ціною (RECIPES fixed у build.js) — знижка DD на них не діє */
const FIXED = new Set(['shield', 'replicator'])
const NONE: Edits = { qty: {}, removed: [], extra: [] }

/** правки кількостей зі старого кошторису (prefs `base:<id>:cost`) — щоб нічого не загубилось */
function migrate(id: string): Edits {
  const old = prefGet<Record<string, { n?: number }>>(`base:${id}:cost`, {})
  const qty: Record<string, number> = {}
  for (const [k, v] of Object.entries(old)) {
    if (v.n == null) continue
    qty[k === 'shield' ? 'dev:shield' : k.startsWith('d-') ? 'dev:' + k.slice(2) : 'row:' + k] = v.n
  }
  return { ...NONE, qty }
}

/** свої (лише в цьому браузері) правки калькулятора баз — спільні для карток сторінки бази (калькулятор і ліміти) */
const useLocal = create<{ by: Record<string, Edits | null>; set: (id: string, e: Edits | null) => void }>((set, get) => ({
  by: {},
  set: (id, e) => { prefSet(`base:${id}:calc`, e); set({ by: { ...get().by, [id]: e } }) },
}))
const localOf = (id: string) => {
  const have = useLocal.getState().by[id]
  return have !== undefined ? have : prefGet<Edits | null>(`base:${id}:calc`, null)
}

/** на сервер — не на кожну цифру: правки однієї бази зливаються, летить остання */
const sendTimers = new Map<string, ReturnType<typeof setTimeout>>()
function shareCalc(id: string, e: Edits | null) {
  const have = useBases.getState().docs[id]
  if (have && typeof have === 'object') useBases.setState((s) => ({ docs: { ...s.docs, [id]: { ...have, calc: e } } }))
  clearTimeout(sendTimers.get(id))
  sendTimers.set(id, setTimeout(() => {
    sendTimers.delete(id)
    saveCalc(id, e).catch((err) => toast.error(t('Правки калькулятора не збережено: {why}', { why: (err as Error).message })))
  }, 700))
}

/**
 * Цілі калькулятора бази — модель бази з правками. Нею ж рахуються «Будівельні елементи»,
 * тож обидві картки показують одне й те саме.
 */
export function useBaseTargets(C: BaseCtx) {
  const c = useMemo(() => C.B.cost(C.res), [C])
  // ціни й потужність пристроїв — з довідника (кешований завантажувач, той самий, що в калькуляторі)
  const [ix, setIx] = useState<CatalogIndex | null>(null)
  useEffect(() => {
    let live = true
    loadCatalog().then((r) => live && r !== 'syncing' && setIx(r)).catch(() => {})
    return () => { live = false }
  }, [])
  // спільні правки — з документа бази; змінювати їх для всіх може той, хто може змінювати базу
  const env = useBases((s) => { const d = s.docs[C.id]; return d && typeof d === 'object' ? d : null })
  const shared = env?.calc ?? null
  const canShare = !!env?.item?.can?.edit
  const local = useLocal((s) => s.by[C.id])
  const mine = local !== undefined ? local : localOf(C.id)
  // хто змінює для всіх — бачить спільне (а як його ще нема — свої давні правки з браузера); решта — свої поверх спільних
  const ed: Edits = canShare ? shared ?? mine ?? migrate(C.id) : mine ?? shared ?? NONE
  const save = (e: Edits | null) => (canShare ? shareCalc(C.id, e) : useLocal.getState().set(C.id, e))

  // модель бази як цілі калькулятора; паливо — на стільки паливних генераторів, скільки їх у списку
  const { defaults, models } = useMemo(() => {
    const mats = (m: Record<string, number>) => Object.entries(m).filter(([k]) => BASE_ITEMS[k]).map(([k, q]) => [BASE_ITEMS[k], q]) as [string, number][]
    const build = (id?: string | null) => (id && ix ? ix.cat.buildables.find((b) => b.id === id) ?? null : null)
    const look = (b: ReturnType<typeof build>, name?: string) => {
      if (b) return { icon: wikiImg(b.img), ref: b.id }
      const o = name ? ICON_OF[name] : undefined
      const x = o && ix ? (o[0] === 'item' ? ix.item.get(o[1]) : ix.place.get(o[1])) : null
      return { icon: x ? iconUrl(x.icon) : null, ...(x && o ? { see: o } : {}) }
    }
    // пристрої моделі за рядком калькулятора: з них — енергія й генератори (кількість рядка — частка від моделі)
    const kinds: Record<string, string | null> = C.B.CAT || {}
    const models = modelsOf(C.M, kinds)
    // решта пристроїв моделі (без recipe): ціна — з довідника, у DD — зі знижкою моделі
    const places: Target[] = [...models].filter(([id]) => id.startsWith('pl:')).map(([id, list]) => {
      const name = id.slice(3)
      const bid = buildIdOf(list[0])
      const b = build(bid)
      return { kind: 'custom' as const, id, name: lab(name), qty: list.length, cost: b ? b.cost : [], cat: kinds[list[0].kind] ?? null, ...look(b ?? null, name) }
    })
    const defaults: Target[] = [
      // ціни — повні (без знижки моделі): знижку Глибокої пустелі вмикає перемикач калькулятора
      // деталі бази: рядок — форма гри (ref), ціна — з її матеріалів (камінь, а в деяких — пластобетон, залізо)
      ...c.rows.map((r: any) => ({
        kind: 'custom' as const, id: 'row:' + r.id, name: lab(r.name), qty: r.n,
        cost: (r.cost ? r.cost.map(([i, q]: [string, number]) => [i, q / c.factor]) : [[BASE_ITEMS.stone, r.price / c.factor]]) as [string, number][],
        ...look(build(r.ref ?? ROW_BUILD[r.id])),
      })),
      ...c.devices.map((x: any) => ({
        kind: 'custom' as const, id: 'dev:' + x.id, name: lab(x.name), qty: x.n, cat: x.cat ?? null,
        cost: FIXED.has(x.id) ? mats(x.mats) : mats(x.mats).map(([id, q]) => [id, q / c.factor] as [string, number]),
        dd: !FIXED.has(x.id),
        ...look(build(RECIPE_BUILD[x.id]), x.name),
      })),
      ...places,
    ]
    return { defaults, models }
  }, [c, C, ix])

  const gensIn = (list: Target[]) => fuelGens(list, models)
  const targets: Target[] = useMemo(() => {
    const base = defaults.filter((x) => !ed.removed.includes(x.id)).map((x) => ({ ...x, qty: ed.qty[x.id] ?? x.qty }))
    const gens = gensIn([...base, ...ed.extra])
    const fuel: Target[] = gens && !ed.removed.includes('fuel')
      ? [{ kind: 'custom', id: 'fuel', name: t('Паливо генераторів на тиждень'), qty: ed.qty.fuel ?? gens, cost: [[BASE_ITEMS.fuel, c.fuelWeek]], dd: false, icon: ix ? iconUrl(ix.item.get(BASE_ITEMS.fuel)?.icon ?? null) : null }]
      : []
    return [...base, ...fuel, ...ed.extra].filter((x) => x.qty > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults, ed, c.fuelWeek, ix, models])

  // новий список із калькулятора → правки відносно моделі
  const onTargets = (next: Target[]) => {
    const known = new Set([...defaults.map((x) => x.id), 'fuel'])
    const byId = new Map(next.map((x) => [x.id, x]))
    const qty: Record<string, number> = {}
    for (const tg of targets) {
      if (!known.has(tg.id)) continue
      const n = byId.get(tg.id)
      const def = tg.id === 'fuel' ? gensIn(next.filter((x) => x.id !== 'fuel')) : defaults.find((d) => d.id === tg.id)!.qty
      if (n && n.qty !== def) qty[tg.id] = n.qty
    }
    const removed = [...new Set([...ed.removed, ...targets.filter((x) => known.has(x.id) && !byId.has(x.id)).map((x) => x.id)])]
    save({ ...ed, qty, removed, extra: next.filter((x) => !known.has(x.id)) })
  }
  const dd = ed.dd ?? c.factor !== 1
  const setDd = (v: boolean) => save({ ...ed, dd: v })
  const qtyOf = (id: string) => targets.find((x) => x.id === id)?.qty ?? 0

  // енергія: потужність — з довідника (power.ts), кількості — з калькулятора
  const energy = useMemo(
    () => energyOf({ targets, models, devices: c.devices, shieldDraw: c.shieldDraw, power: (id) => ix?.place.get(id)?.power }),
    [targets, models, ix, c],
  )

  const edited = Object.keys(ed.qty).length > 0 || ed.removed.length > 0 || ed.extra.length > 0 || ed.dd !== undefined
  /** «Скинути»: хто змінює для всіх — модель для всіх (порожні правки, а не «нема»: інакше знову взялися б давні свої
   *  з браузера); решта — прибрати свої (лишаються спільні) */
  const reset = () => save(canShare ? NONE : null)
  const own = !canShare && mine != null
  return { c, ed, targets, onTargets, reset, qtyOf, ix, dd, setDd, energy, edited: canShare ? edited : own, own, shared: shared != null, canShare }
}

export function BaseCalc({ C }: { C: BaseCtx }) {
  const { targets, onTargets, reset, ix, dd, setDd, energy, edited, own, shared, canShare } = useBaseTargets(C)
  const { gives, takes } = energy

  return (
    <Card>
      <SectionTitle
        aside={
          edited && (
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-[12px] text-spice underline underline-offset-2">
              <RotateCcw size={12} /> {own && shared ? t('Повернути спільні числа') : t('Скинути до моделі бази')}
            </button>
          )
        }
      >
        {t('Калькулятор бази')}
      </SectionTitle>
      {(gives > 0 || takes > 0) && (
        <p className="mb-2 text-[12.5px] text-muted">
          <T text="Енергія {gives} є · {takes} треба" gives={<b className={gives < takes ? 'font-mono text-bad' : 'font-mono text-ink'}>{fmtN(Math.round(gives))}</b>} takes={<b className="font-mono text-ink">{fmtN(Math.round(takes))}</b>} />
        </p>
      )}
      {!canShare && own && <p className="mb-2 text-[12px] text-muted">{t('Ці числа змінено лише в цьому браузері — інші бачать спільні.')}</p>}
      {ix ? (
        <ProdCalc ix={ix} targets={targets} onTargets={onTargets} dd={dd} onDd={setDd} open={(k, id) => openInCatalog(ix, k, id)} />
      ) : (
        <Loading label={t('Завантаження довідника…')} />
      )}
    </Card>
  )
}

/**
 * Спеціалізації, як у грі (вкладка «Навички» → «Спеціалізації»): п'ять треків — виготовлення, збирання,
 * дослідження, бій, саботаж (порядок гри). У треку:
 *   • рівень 0–100 (досвід — із завдань Ландсрааду й щоденних); з кожним рівнем сам росте пасивний бонус
 *     (у грі — дрібні значки між картками: «Міцність виготовленого предмета +2%» на 2-му рівні виготовлення);
 *   • 41 риса — картки на своїх рівнях; кожну купують окремо за меланж («Рис придбано 1 (41)», «Купити»), коли
 *     трек дорісь до її рівня. Бойові риси «Очки навичок» додають очки до дерева (усі разом — 54).
 * Тож у білді спеціалізація — рівень кожного треку й куплені риси (номери в треку, за рівнем).
 * Дані — з dune.gaming.tools (дані гри мовою сайту; тягне браузер, як і навички, lib/skillsUk) і кеш у
 * localStorage; описи треків — свої (t(), у даних їх немає). Іконки — з їхнього CDN.
 */
import { gtLang, locale, t } from './i18n'
import { create } from 'zustand'
import { unflatten } from './skillsUk'

const GT = `https://cdn-hosted.gaming.tools/dune/data/${gtLang()}/specializations/`
export const GT_IMG = 'https://cdn-hosted.gaming.tools/dune'
const CACHE = `skills:spec:${gtLang()}:v2`
const STALE = 3 * 24 * 3600 * 1000
export const SPEC_MAX = 100
/** рис у треку (у всіх п'яти — 41; від цього числа залежить код посилання, lib/skills.encodeShort) */
export const TRAITS = 41

/** треки — у порядку гри; цей самий порядок — у коді посилання */
export const TRACKS: [string, string, string][] = [
  ['craftingtrack', t('Виготовлення'), t('Пасивно — міцніші виготовлені речі. Риси: ліміти аугментацій, серійне виготовлення, вихід переробки, рецепти.')],
  ['gatheringtrack', t('Збирання'), t('Пасивно — продуктивніший видобуток і статичний компактор. Риси: більше води, крові, мінералів і брухту.')],
  ['explorationtrack', t('Дослідження'), t('Пасивно — місткіший рюкзак. Риси: комірки інвентарю, швидший і економніший транспорт, сканування, скарби.')],
  ['combattrack', t('Бій'), t("Пасивно — більше шкоди й опору шкоді. Риси: очки навичок (усі разом — 54), здоров'я й витривалість.")],
  ['sabotagetrack', t('Саботаж'), t('Пасивно — більше шкоди приголомшеним цілям. Риси: шкода в голову, пастки, вибухові бочки, внесок до Ландсрааду.')],
]
export const COMBAT = TRACKS.findIndex(([id]) => id === 'combattrack')

/** спеціалізації в білді: рівень кожного треку й куплені риси (номери 0..40, за рівнем) */
export interface Specs { lv: number[]; got: number[][] }
export const noSpecs = (): Specs => ({ lv: TRACKS.map(() => 0), got: TRACKS.map(() => []) })

export interface KeyStat { name: string; value: number; pct: boolean }
export interface Keystone { level: number; type: string; name: string; desc: string; icon: string | null; stats: KeyStat[]; sp: number; spice: number }
export interface Track { id: string; name: string; icon: string | null; passive: { name: string; values: number[] }[]; keys: Keystone[]; xp: number[] }

/** очки навичок бойових рис (номер риси → очки) — запасний розклад гри, поки дані не приїхали */
const COMBAT_SP: Record<number, number> = { 0: 3, 2: 1, 4: 3, 5: 1, 6: 1, 8: 3, 9: 1, 10: 1, 12: 3, 13: 1, 14: 1, 16: 3, 17: 1, 18: 1, 19: 3, 20: 1, 21: 1, 23: 3, 24: 1, 25: 1, 27: 3, 28: 1, 29: 1, 32: 3, 33: 1, 34: 1, 35: 3, 37: 1, 39: 1, 40: 5 }
/** очки навичок з куплених бойових рис */
export function combatPoints(s: Specs, combat?: Track | null) {
  return (s.got[COMBAT] ?? []).reduce((n, i) => n + (combat ? combat.keys[i]?.sp ?? 0 : COMBAT_SP[i] ?? 0), 0)
}

const num = (v: number) => (Math.round(v * 10) / 10).toLocaleString(locale(), { maximumFractionDigits: 1 }).replace('-', '−')
/** стат риси: частки (5% = 0.05) — відсотками, решта — як є; знак — завжди */
export const fmtKey = (s: KeyStat) => `${s.value > 0 ? '+' : ''}${num(s.pct ? s.value * 100 : s.value)}${s.pct ? '%' : ''}`
/** пасивний бонус на рівні: від базового значення (0 — прибавка, 1 — множник), відсотками */
export const fmtPassive = (values: number[], level: number) => `+${num(((values[level] ?? values[values.length - 1]) - values[0]) * 100)}%`

/** що дає трек: рівень (пасивні бонуси, досвід), куплені риси (сума статів, очки навичок, меланж), доступні */
export function atLevel(tr: Track, level: number, got: number[]) {
  const bought = got.map((i) => tr.keys[i]).filter(Boolean)
  const sum = new Map<string, KeyStat>()
  for (const k of bought) for (const s of k.stats) {
    const m = sum.get(s.name)
    sum.set(s.name, m ? { ...m, value: m.value + s.value } : { ...s })
  }
  return {
    bought,
    open: tr.keys.filter((k) => k.level <= level).length,
    stats: [...sum.values()],
    perks: bought.filter((k) => k.type === 'Recipe' || k.type === 'PlayerTag'),
    sp: bought.reduce((n, k) => n + k.sp, 0),
    spice: bought.reduce((n, k) => n + k.spice, 0),
    xp: tr.xp[level] ?? 0,
  }
}
/** рівень треку змінився: риси вище нового рівня — геть (у грі їх ще не купити) */
export const keepGot = (tr: Track | null | undefined, level: number, got: number[]) => (tr ? got.filter((i) => (tr.keys[i]?.level ?? 0) <= level) : got)

type RawTrack = {
  id: string
  name: string
  iconPath?: string
  passiveAttributes?: { name: string; values: number[] }[]
  xpCurve?: number[]
  keystones?: { level: number; keystoneType: string; name: string; description?: string; iconPath?: string; stats?: { name: string; value: number; format: string }[]; skillPointsGranted?: { value: number }; cost?: { quantity?: number } }[]
}
const compact = (tr: RawTrack): Track => ({
  id: tr.id,
  name: tr.name,
  icon: tr.iconPath ?? null,
  passive: (tr.passiveAttributes ?? []).map((p) => ({ name: p.name.replace(/:$/, ''), values: p.values })),
  xp: tr.xpCurve ?? [],
  keys: [...(tr.keystones ?? [])]
    .sort((a, b) => a.level - b.level)
    .map((k) => ({
      level: k.level,
      type: k.keystoneType,
      name: k.name,
      desc: k.description ?? '',
      icon: k.iconPath ?? null,
      stats: (k.stats ?? []).map((s) => ({ name: s.name, value: s.value, pct: s.format.includes('%') })),
      sp: k.skillPointsGranted?.value ?? 0,
      spice: k.cost?.quantity ?? 0,
    })),
})

const readCache = (): { at: number; tracks: Record<string, Track> } | null => {
  try {
    return JSON.parse(localStorage.getItem(CACHE) ?? 'null')
  } catch {
    return null
  }
}
let busy = false

export const useSpecs = create<{ tracks: Record<string, Track> | null; failed: boolean; load: () => void }>((set, get) => ({
  tracks: readCache()?.tracks ?? null,
  failed: false,
  load() {
    const c = readCache()
    if (busy || (c && Date.now() - c.at < STALE && get().tracks)) return
    busy = true
    // «Спробувати ще» — знову показати завантаження
    if (get().failed) set({ failed: false })
    Promise.all(
      TRACKS.map(([id]) =>
        fetch(GT + id + '.d.json')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((arr) => compact(unflatten(arr) as RawTrack)),
      ),
    )
      .then((list) => {
        const tracks = Object.fromEntries(list.map((tr) => [tr.id, tr]))
        set({ tracks, failed: false })
        try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), tracks })) } catch { /* без кешу */ }
      })
      // збій — можна спробувати ще (повторний load())
      .catch(() => { busy = false; set({ failed: !get().tracks }) })
  },
}))

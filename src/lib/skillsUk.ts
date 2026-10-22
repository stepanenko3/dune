/**
 * Назви навичок — як у грі — і справжні значення кожного рангу мовою сайту: з dune.gaming.tools (дані гри всіма
 * мовами гри). Сервер туди не пускає Cloudflare, тож тягне браузер відвідувача — так само, як сайти, що
 * вбудовують підказки gaming.tools:
 *   • skill-builder-data — усі навички одним файлом: назва, ціна рангів і стати кожного рангу;
 *   • skills/<id> — опис і умова кожного рангу (тренер школи), по одному файлу — коли відкрили картку.
 * Файли в стиснутому форматі SvelteKit (devalue: масив, де об'єкти посилаються на інші елементи за номером).
 * Список кешуємо в localStorage (оновлюємо у фоні), щоб назви з'являлись одразу; не вдалося — лишаються
 * назви з довідника сайту (locName) чи англійські, а бонуси — з questlog.
 */
import { create } from 'zustand'
import { gtLang, locale, t } from './i18n'
import type { Skill } from './skills'

// мовою сайту: gaming.tools має дані гри всіма 14 мовами
const GT = `https://cdn-hosted.gaming.tools/dune/data/${gtLang()}/`
// v2 — з типом навички гри (type): давній кеш без нього перечитується одразу
const CACHE = `skills:${gtLang()}:v2`
const STALE = 3 * 24 * 3600 * 1000

export interface LocStat { level: number; name: string; value: number; op: string | null; fmt: string }
/** type — тип навички в грі: Ability, Technique, Attribute (див. typeOf у skills.ts) */
export interface LocSkill { name: string; cost: number[]; stats: LocStat[]; type?: string }
export interface LocInfo { desc: string; req: string[] }

/** devalue → звичайний JSON: числа в масивах і об'єктах — номери елементів */
export function unflatten(arr: unknown[]): unknown {
  const h = (i: unknown): unknown => {
    if (typeof i !== 'number' || i < 0) return null
    const v = arr[i]
    if (Array.isArray(v)) return typeof v[0] === 'string' ? null : v.map(h) // спецтипи (Date, Map…) нам не трапляються
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, h(x)]))
    return v
  }
  return h(0)
}
/** id gaming.tools («skills-attribute-aggression1») → id questlog («skills_attribute_aggression1») */
export const qlId = (gid: string) => gid.replace(/-/g, '_')
/** назад: лише перші два «_» стають «-» — далі gaming.tools лишає підкреслення («skills-ability-suspensormine_reduction») */
export const gtId = (id: string) => id.replace('_', '-').replace('_', '-')

/**
 * Значення стату, як у грі: формат «{v:0.#}%» — частка (0.1 → 10%), множник (1.05) — це +5%;
 * прибавка й множник — зі знаком, базові значення здібностей (відновлення, шкода) — як є
 */
export function fmtStat(s: LocStat): string {
  const pct = s.fmt.includes('%')
  let v = s.value
  if (pct) v = (s.op === 'Multiplicitive' ? v - 1 : v) * 100
  const n = Math.round(v * 10) / 10
  const num = n.toLocaleString(locale(), { maximumFractionDigits: 1 })
  const sign = s.op && n > 0 ? '+' : ''
  return `${sign}${num.replace('-', '−')}${pct ? '%' : ''}${s.fmt.endsWith('/s') ? t('/с') : ''}`
}

/** назва мовою сайту й стати вузла по рангах (1..max) з даних gaming.tools; злиті двійники — шматками по черзі */
export function locRanks(s: Skill, map: Record<string, LocSkill> | null): { name: string; stats: LocStat[][] } | null {
  const parts = s.parts ?? [{ id: s.id, max: s.max }]
  const first = map?.[parts[0].id]
  if (!map || !first) return null
  const stats: LocStat[][] = []
  for (const p of parts) for (let l = 1; l <= p.max; l++) stats.push(map[p.id]?.stats.filter((x) => x.level === l) ?? [])
  return { name: first.name, stats }
}
/** назва вузла мовою сайту: дані gaming.tools → довідник сайту (locName) → англійська (questlog) */
export const skillName = (s: Skill, map: Record<string, LocSkill> | null) => locRanks(s, map)?.name ?? s.locName ?? s.name
export const partIds = (s: Skill) => (s.parts ?? [{ id: s.id }]).map((p) => p.id)

type Raw = { id: string; name: string; skillType?: string; costPerLevel?: number[]; stats?: { level: number; name: string; value: number; operation?: string | null; format: string }[] }
const compact = (list: Raw[]): Record<string, LocSkill> =>
  Object.fromEntries(
    list.map((s) => [
      qlId(s.id),
      { name: s.name, type: s.skillType, cost: s.costPerLevel ?? [], stats: (s.stats ?? []).map((st) => ({ level: st.level, name: st.name, value: st.value, op: st.operation ?? null, fmt: st.format })) },
    ]),
  )

let busy = false // список уже тягнеться (раз за відкриття сторінки)
const readCache = (): { at: number; map: Record<string, LocSkill> } | null => {
  try {
    return JSON.parse(localStorage.getItem(CACHE) ?? 'null')
  } catch {
    return null
  }
}
/** описи — теж у localStorage (тиждень): картка відкривається вже з текстом, без «Завантажую…» і стрибка */
const INFO = `skills:${gtLang()}:info:v1`
const readInfo = (): Record<string, LocInfo> => {
  try {
    const c = JSON.parse(localStorage.getItem(INFO) ?? 'null') as { at: number; info: Record<string, LocInfo> } | null
    return c && Date.now() - c.at < 7 * 24 * 3600 * 1000 ? c.info : {}
  } catch {
    return {}
  }
}
let infoAt = 0
const saveInfo = (all: Record<string, LocInfo | 'loading' | 'fail'>) => {
  const info = Object.fromEntries(Object.entries(all).filter(([, v]) => typeof v === 'object'))
  try { localStorage.setItem(INFO, JSON.stringify({ at: (infoAt ||= Date.now()), info })) } catch { /* без кешу */ }
}

export const useLoc = create<{
  map: Record<string, LocSkill> | null
  failed: boolean
  info: Record<string, LocInfo | 'loading' | 'fail'>
  load: () => void
  loadInfo: (ids: string[]) => Promise<void>
  /** описи вузлів школи — наперед, по чотири запити разом, поки людина дивиться на дерево */
  prefetch: (groups: string[][]) => void
}>((set, get) => ({
  map: readCache()?.map ?? null,
  failed: false,
  info: readInfo(),
  load() {
    const c = readCache()
    if (busy || (c && Date.now() - c.at < STALE && get().map)) return
    busy = true
    fetch(GT + 'skill-builder-data.d.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((arr) => {
        const d = unflatten(arr) as { skills: Raw[] }
        const map = compact(d.skills)
        set({ map, failed: false })
        try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), map })) } catch { /* сховище заповнене — без кешу */ }
      })
      .catch(() => set({ failed: !get().map }))
  },
  /** опис і умови рангів — по файлу на навичку (для злитих двійників — кожен шматок) */
  async loadInfo(ids) {
    const key = ids.join('+')
    if (get().info[key]) return
    set({ info: { ...get().info, [key]: 'loading' } })
    return Promise.all(
      ids.map((id) =>
        fetch(GT + 'skills/' + gtId(id) + '.d.json')
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
          .then((arr) => unflatten(arr) as { description?: string; levelRequirements?: string[] }),
      ),
    )
      .then((parts) => {
        const desc = [...new Set(parts.map((p) => p.description ?? '').filter(Boolean))].join('\n\n')
        set({ info: { ...get().info, [key]: { desc, req: parts.flatMap((p) => p.levelRequirements ?? []) } } })
        saveInfo(get().info)
      })
      .catch(() => set({ info: { ...get().info, [key]: 'fail' } }))
  },
  prefetch(groups) {
    const queue = groups.filter((ids) => !get().info[ids.join('+')])
    const next = (): Promise<void> => {
      const ids = queue.shift()
      return ids ? get().loadInfo(ids).then(next) : Promise.resolve()
    }
    for (let i = 0; i < 4; i++) void next()
  },
}))

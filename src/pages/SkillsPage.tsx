/**
 * Планувальник навичок — як вкладка «Навички» в грі, але в стилі сайту (нічна пустеля головної, акцент — спайс):
 *   • угорі — п'ять шкіл ромбами (порядок і назви — як у грі), «Очки навичок» (скільки лишилось з бюджету) і
 *     посилання на білд — воно міняється з кожною зміною (короткий код, lib/skills.encodeShort);
 *   • школа — три гілки з назвами гри: вхід унизу, завершальний вузол угорі в рамці; сітка шестикутна, як у грі
 *     (lib/skills.place), тож гілки виходять ромбами й шестикутниками;
 *   • вузли за типом: атрибут — коло, прийом — восьмикутник, здібність — ромб; під вузлом — ромбики рангів;
 *     взяте залите спайсом, доступне — з обводкою спайсу, решта — з замком;
 *   • наведення — картка навички поруч (як підказка в грі, components/skills/SkillTip): мовою сайту, з таблицею
 *     рангів і умовами тренера; клік — ранг вище, правий клік чи Shift+клік — нижче (якщо на вузлі ніщо не
 *     тримається); на телефоні дотик відкриває картку знизу, ще дотик по тому ж вузлу — ранг вище;
 *   • внизу — слоти «Здібності» (3) і «Прийоми» (3), як у грі: ставляться з картки взятого вузла, зняті вузли
 *     злітають зі слотів самі;
 *   • за рискою після шкіл — «Спеціалізації», як у грі (components/skills/SpecView): рівень кожного з п'яти треків і
 *     куплені риси теж у білді й у посиланні; бюджет очок = рівень персонажа + куплені бойові риси «Очки навичок».
 * Дерево — з questlog.gg (сервер збирає й кешує, server/lib/skills.mjs; назви й описи — мовою сайту); назви, значення
 * рангів і спеціалізації — з dune.gaming.tools мовою сайту (тягне браузер, lib/skillsUk).
 * Свій білд у браузері й збережені білди — ще й знімком «вузол: ранг» (lib/skills.snap): після оновлення гри білд не
 * міняється тихо, а сторінка каже, що змінилось (вузол прибрали, ранг обрізали, скільки очок стало).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Lock, Medal, Plus, TriangleAlert, X } from 'lucide-react'
import { SCHOOL_ICON as ICON } from '@/components/skills/icons'
import { toast } from 'sonner'
import { cn, plural } from '@/lib/utils'
import { gtLang, t, T } from '@/lib/i18n'
import { BuildsBar, OpenBuild, type SavedBuild } from '@/components/skills/BuildsBar'
import { prefGet, prefSet } from '@/lib/prefs'
import { del, get, put } from '@/lib/api'
import { plainClick } from '@/lib/urlState'
import { useStore } from '@/store'
import { BRANCH, KIND, SCHOOLS, typeOf, aboutOf, branches, decodeBuild, decodeShort, encodeShort, isShort, layout, open, place, slotOf, snap, spent, unsnap, useSkills, valid, type Build, type Drift, type Eq, type Skill, type Snap } from '@/lib/skills'
import { partIds, skillName, useLoc } from '@/lib/skillsUk'
import { SkillTip } from '@/components/skills/SkillTip'
import { SpecView, LevelInput } from '@/components/skills/SpecView'
import { Loading, PageError } from '@/components/states'
import { combatPoints, noSpecs, useSpecs, type Specs } from '@/lib/specs'
import { ConfirmDialog } from '@/pages/Account'
import './skills.css'
import { useCrumb, useScopeOf } from '@/components/Crumbs'
import { useUnsaved } from '@/components/UnsavedBar'
import { DataStamp } from '@/components/DataStamp'

const UX = 104 // крок сітки по горизонталі (сусідні ряди зсунуті на пів кроку)
const ROW = 80 // крок рядів
const NODE = 56
const PAD = 20
/** «очко / очки / очок» — форми слова до числа очок навичок (уже перекладені) */
const POINTS = (): [string, string, string] => [t('очко'), t('очки'), t('очок')]
const GAP_X = 40 // між гілками
const TITLE = 34 // назва гілки над нею
const MAX_K = 1.6 // дерево на великому екрані — не більше ніж у 1,6 раза
// на середньому екрані (≈ 700–1040 px) три гілки трохи зменшуються, щоб стати в один рядок; вужче (телефон) — масштаб 1
// і гілки одна під одною
const MIN_K = 0.7
const GRACE = 90 // мс після відходу з вузла: встигнути перевести курсор на картку
const FADE = 130 // мс: картка гасне (skills.css, .sk-tip[data-out])
type Tip = { id: string; el: HTMLElement; pin: boolean }

/** форма вузла за типом, як у грі: атрибут — коло, прийом — восьмикутник, здібність — ромб */
function Shape({ kind, size, className, width = 2 }: { kind: string; size: number; className: string; width?: number }) {
  const r = size / 2
  const k = r - width
  if (kind === 'ability') return <polygon points={`${r},${width} ${size - width},${r} ${r},${size - width} ${width},${r}`} strokeWidth={width} className={className} />
  if (kind === 'perk') {
    const pts = Array.from({ length: 8 }, (_, i) => {
      const a = Math.PI / 8 + (i * Math.PI) / 4
      return `${r + k * Math.cos(a)},${r + k * Math.sin(a)}`
    }).join(' ')
    return <polygon points={pts} strokeWidth={width} className={className} />
  }
  return <circle cx={r} cy={r} r={k - 1} strokeWidth={width} className={className} />
}

/** ромбики рангів під вузлом */
function Pips({ n, max }: { n: number; max: number }) {
  return (
    <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 flex -translate-x-1/2 gap-[3px]">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={cn('h-[7px] w-[7px] rotate-45 border', i < n ? 'border-spice bg-spice' : 'border-ink/45')} />
      ))}
    </span>
  )
}

/** що сказати про білд, відкритий не таким, яким його зберегли: заголовок і (для знімка) що саме змінилось */
type Notice = { title: string; d: Drift | null }

/** картка над деревом: білд зібрано на іншій версії дерева — що змінилось після оновлення гри */
function DriftNote({ n, nameOf, onClose }: { n: Notice; nameOf: (id: string) => string; onClose: () => void }) {
  const d = n.d
  return (
    <div data-volatile role="status" className="flex items-start gap-2.5 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-[12.5px] leading-snug">
      <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <b className="font-semibold">{n.title}</b>
        {d && d.gone.length > 0 && <span>{t('Прибрано з гри: {list}.', { list: d.gone.map((x) => t('«{name}» (ранг {rank})', { name: x.name, rank: x.rank })).join(', ') })}</span>}
        {d && d.cut.length > 0 && <span>{t('Ранг знижено: {list}.', { list: d.cut.map((x) => t('«{name}» {from} → {to}', { name: nameOf(x.id), from: x.from, to: x.to })).join(', ') })}</span>}
        {d && d.slots > 0 && <span>{t('Знято зі слотів: {n}.', { n: d.slots })}</span>}
        {d && d.loose && <span>{t('Зв’язки в дереві змінились — деякі вузли тепер без опори, перевір гілки.')}</span>}
        {d && d.was !== d.now && <span>{t('Очок: було {was}, стало {now}.', { was: d.was, now: d.now })}</span>}
      </div>
      <button type="button" onClick={onClose} aria-label={t('Закрити')} className="-m-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-ink/10 hover:text-ink"><X size={14} /></button>
    </div>
  )
}

/** про спеціалізації — підказка на назві (як опис школи) */
const SPEC_ABOUT = () => t("П'ять треків, як у грі. Рівень (0–100, досвід — із завдань Ландсрааду) сам дає пасивний бонус; риси відкриваються на своїх рівнях і купуються за меланж — кожна окремо. Бойові риси «Очки навичок» додають до 54 очок у дерево.")

export default function SkillsPage() {
  const { data, error, load } = useSkills()
  const locMap = useLoc((u) => u.map)
  const tracks = useSpecs((s) => s.tracks)
  useEffect(() => { load(); useLoc.getState().load(); useSpecs.getState().load() }, [load])
  const skills = useMemo(() => data?.skills ?? [], [data])
  const branchOf = useMemo(() => branches(skills), [skills])
  const byId = useMemo(() => new Map(skills.map((s) => [s.id, s])), [skills])
  const nameOf = (s: Skill) => skillName(s, locMap)

  // що відкрито — школа чи спеціалізації — в адресі (?s=mentat, ?s=spec): кожна вкладка — своє посилання;
  // без параметра — те, що було востаннє
  const [lastTab] = useState(() => (prefGet<string>('skills:view', 'tree') === 'spec' ? 'spec' : prefGet<string>('skills:school', 'trooper')))
  // вкладка (школа чи «Спеціалізації») — сегментом шляху: /skills/mentat, /skills/spec; код білду — параметром (?b=…)
  const okTab = (v: string | null) => !!v && (v === 'spec' || SCHOOLS.some(([id]) => id === v))
  const subTab = useStore((st) => st.sub)
  // без вкладки в адресі: уперше — давнє ?s= чи те, що було востаннє; далі («Уміння» в хлібних крихтах) — дерево школи
  const fallback = useRef<string | null>(null)
  if (fallback.current === null) { const legacy = new URLSearchParams(location.search).get('s'); fallback.current = okTab(legacy) ? legacy! : lastTab }
  const tabS = okTab(subTab) ? subTab! : fallback.current
  // параметри — ті, що в адресі, і код білду (після переходу з хлібних крихт його в адресі вже нема)
  const keepQ = () => { const q = new URLSearchParams(location.search); q.delete('s'); if (code && !q.has('build') && !q.has('b')) q.set('b', code); return q.size ? `?${q}` : '' }
  const setTabS = (v: string, o?: { replace?: boolean }) => useStore.getState().setView('skills', { sub: v, search: keepQ(), replace: o?.replace })
  const tabHref = (v: string) => `/skills/${v}${keepQ()}`
  // адреса завжди з вкладкою — посилання однозначне (як і раніше з ?s=)
  useEffect(() => { if (subTab !== tabS) setTabS(tabS, { replace: true }); fallback.current = prefGet('skills:school', 'trooper') }, [subTab, tabS]) // eslint-disable-line react-hooks/exhaustive-deps
  const school = tabS === 'spec' ? prefGet('skills:school', 'trooper') : tabS
  const [build, setBuildState] = useState<Build>({})
  const [eq, setEqState] = useState<Eq>({ a: [], t: [] })
  const [code, setCode] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [spec, setSpecState] = useState<Specs>(noSpecs)
  /** відкритий збережений білд (з «Моїх білдів» чи за посиланням ?build=…) */
  const [saved, setSaved] = useState<SavedBuild | null>(null)
  /** свій білд до того, як відкрили чужий (посилання, збережений): його можна повернути одним натиском (знімок; давній — код) */
  const [prev, setPrev] = useState<Snap | string | null>(() => prefGet<Snap | string | null>('skills:prev', null))
  /** перед тим, як показати чужий білд, — відкласти свій (якщо він інший і не порожній) */
  const stash = (incoming: string | null) => {
    const own = prefGet<string | null>('skills:build', null)
    // свій порожній — теж «свій»: повернутись — до порожнього планувальника ('')
    if (own !== incoming) { const keep = own ? prefGet<Snap | null>('skills:snap', null) ?? own : ''; prefSet('skills:prev', keep); setPrev(keep) }
  }
  /** білд відкрито не таким, яким зберегли (інша версія дерева) — що змінилось */
  const [notice, setNotice] = useState<Notice | null>(null)
  const [resetting, setResetting] = useState(false)
  /** питаємо, чи видалити відкритий збережений білд */
  const [deleting, setDeleting] = useState(false)
  // ?build=<id> — читаємо одразу: перше ж збереження стану (save) переписує адресу на /skills?b=…
  const [linked] = useState(() => new URLSearchParams(location.search).get('build'))
  // відкриваємо за посиланням — сторінку показуємо вже з білдом (інакше дерево спершу малюється порожнім, а тоді
  // перемикається школа, з'являються кнопки білду — і все «переїжджає»)
  const [linkedWait, setLinkedWait] = useState(!!linked)
  // оновили сторінку з відкритим білдом (/skills/<школа>?build=<id>&b=<код>): дерево — з коду (там і незбережені правки), а збережений білд — лише блоком над ним
  const [reopened] = useState(() => !!linked && new URLSearchParams(location.search).has('b'))
  /** відкритий збережений білд — його id лишається в адресі (?build=), тож після оновлення сторінки він знову відкритий */
  const openId = useRef<string | null>(linked)
  // шлях: «Уміння [вкладка, де білд лежить]» › відкритий білд (свій незбережений — «Планувальник») › спеціалізації
  const buildScope = useScopeOf(saved?.item.owner)
  const schoolName = (id: string) => SCHOOLS.find(([x]) => x === id)?.[1]
  const onSpec = tabS === 'spec'
  // ланка білду показує, куди веде клік, — школу дерева: «Sandwalker Universal [Ментат]»; спеціалізації — окрема сторінка
  // (і окрема ланка); білд за посиланням ще вантажиться — шляху поки нема
  useCrumb(linkedWait ? null : [
    onSpec
      ? { label: saved?.name ?? t('Планувальник'), value: schoolName(school), path: `/skills/${school}${keepQ()}`, go: () => setSchool(school) }
      : { label: saved?.name ?? t('Планувальник'), value: schoolName(tabS) },
    ...(onSpec ? [{ label: t('Спеціалізації') }] : []),
  ], { sub: buildScope })
  // що на екрані: дерево школи чи спеціалізації
  const view: 'tree' | 'spec' = tabS === 'spec' ? 'spec' : 'tree'
  const setView = (v: 'tree' | 'spec') => { prefSet('skills:view', v); setTabS(v === 'spec' ? 'spec' : school) }
  // очки навичок: рівень персонажа (1 очко за рівень, до 200) + ключові камені бойової спеціалізації (до 54)
  const [lvl, setLvlState] = useState(() => prefGet('skills:level', 200))
  const setLvl = (v: number) => { setLvlState(v); prefSet('skills:level', v) }

  // картка навички: наведення — одразу показати; піти — коротка пауза (встигнути перевести курсор на картку),
  // далі картка гасне анімацією й тоді зникає; між вузлами — пливе на нове місце. На дотик — закріплена,
  // закривається дотиком поза нею
  const [tip, setTipState] = useState<Tip | null>(null)
  const [out, setOut] = useState(false)
  const tipRef = useRef<Tip | null>(null)
  const setTip = (v: Tip | null) => { tipRef.current = v; setTipState(v) }
  const timer = useRef(0)
  const ptr = useRef('mouse')
  const show = (id: string, el: HTMLElement, pin = false) => { window.clearTimeout(timer.current); setOut(false); setTip({ id, el, pin }) }
  const close = () => {
    window.clearTimeout(timer.current)
    if (!tipRef.current) return
    setOut(true)
    timer.current = window.setTimeout(() => { setTip(null); setOut(false) }, FADE)
  }
  const hide = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (!tipRef.current?.pin) close() }, GRACE) }
  const keep = () => { window.clearTimeout(timer.current); setOut(false) }
  useEffect(() => {
    if (!tip) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const down = (e: PointerEvent) => { if (!(e.target as Element).closest?.('[data-skill-tip],[data-skill-node]')) close() }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', down)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', down) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip])
  const setSchool = (s: string) => { prefSet('skills:school', s); prefSet('skills:view', 'tree'); setTabS(s); window.clearTimeout(timer.current); setTip(null) }
  // описи вузлів школи — наперед, щоб картка відкривалась уже з текстом
  useEffect(() => {
    if (locMap && skills.length) useLoc.getState().prefetch(skills.filter((s) => s.school === school).map(partIds))
  }, [locMap, skills, school])

  /** зберегти білд (навички, слоти, спеціалізації): адреса (короткий код) — одразу, з кожною зміною; у браузері — ще й знімок */
  const save = (b: Build, e: Eq, sp: Specs) => {
    const c = encodeShort(skills, b, e, sp)
    setCode(c)
    prefSet('skills:build', c)
    if (data) prefSet('skills:snap', c ? snap(data, b, e, sp) : null)
    // код білду — параметром поруч із вкладкою (сегмент /skills/<школа> лишається)
    const q = new URLSearchParams(location.search)
    // відкритий збережений білд — і в адресі (оновили сторінку — він знову відкритий); закрили — геть
    if (openId.current) q.set('build', openId.current)
    else q.delete('build')
    q.delete('s')
    if (c) q.set('b', c)
    else q.delete('b')
    history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : ''))
  }
  /**
   * Білд із коду (адреса, давній збережений) чи знімка (свій у браузері, збережений на сервері). Код після патчу
   * розбирається вже інакше — тоді попередження; знімок — за id вузлів, і сказати, що змінилось. title — про що картка
   */
  const readBuild = (src: Snap | string | null, title: { code: string; snap: string }) => {
    let out = { b: {} as Build, eq: { a: [], t: [] } as Eq, spec: noSpecs() as Specs }
    let note: Notice | null = null
    if (src && typeof src === 'object') {
      const r = unsnap(skills, src)
      out = { b: r.b, eq: r.eq, spec: r.spec }
      if (r.drift) note = { title: title.snap, d: r.drift }
    } else if (isShort(src)) {
      const d = decodeShort(skills, src!)
      if (d) { out = { b: d.b, eq: d.eq, spec: d.spec }; if (!d.same) note = { title: title.code, d: null } }
    } else if (src) out.b = decodeBuild(skills, src)
    return { ...out, note }
  }
  const showBuild = (r: { b: Build; eq: Eq; spec: Specs; note: Notice | null }) => {
    setBuildState(r.b)
    setEqState(r.eq)
    setSpecState(r.spec)
    setNotice(r.note)
    save(r.b, r.eq, r.spec)
  }
  // білд з адреси (посилання) чи з минулого разу; старі посилання («?b=trooper.11…») теж розуміємо
  useEffect(() => {
    if (!skills.length || loaded) return
    let fromUrl = new URLSearchParams(location.search).get('b')
    const own = prefGet<string | null>('skills:build', null)
    const ownSnap = prefGet<Snap | null>('skills:snap', null)
    // у адресі — код власного білду (сторінка сама пише його туди): це свій білд, і він — зі знімка
    if (fromUrl && fromUrl === own && ownSnap) fromUrl = null
    // посилання пошкоджене — свого білду не чіпаємо (раніше його затирав порожній)
    if (fromUrl && isShort(fromUrl) && !decodeShort(skills, fromUrl)) {
      toast.error(t('Посилання на білд пошкоджене — відкрито твій білд'), { id: 'sk' })
      fromUrl = null
    } else if (fromUrl) stash(fromUrl)
    showBuild(fromUrl
      ? readBuild(fromUrl, { code: t('Посилання зібране на іншій версії дерева (до оновлення гри) — перевір білд'), snap: '' })
      : readBuild(ownSnap ?? own, { code: t('Твій білд зібрано на іншій версії дерева — перевір його'), snap: t('Дерево навичок оновилось — твій білд змінився') }))
    setLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, loaded])
  const dropOpenId = () => { const q = new URLSearchParams(location.search); if (!q.has('build')) return; q.delete('build'); history.replaceState(null, '', location.pathname + (q.size ? `?${q}` : '')) }
  /**
   * «Повернутися до свого білду» — одна дія замість «закрити» й «повернути»: відкритий (збережений чи за посиланням)
   * зникає, у планувальнику — твій, який був до нього. Новим кроком історії: «Назад» у браузері — знову до відкритого.
   */
  const backToMine = () => {
    history.pushState(history.state, '', location.href)
    if (prev !== null) { restoreMine(); return }
    openId.current = null
    setSaved(null)
    dropOpenId()
  }
  /** видалити відкритий збережений білд — і назад до свого */
  const removeSaved = async () => {
    if (!saved) return
    try {
      await del(`/api/builds/${encodeURIComponent(saved.id)}`)
      toast.success(t('Білд видалено'))
      if (prev !== null) restoreMine()
      else { openId.current = null; setSaved(null); dropOpenId() }
    } catch (e) { toast.error(t('Не вдалося видалити'), { description: (e as Error).message }) }
  }
  /** повернути свій білд (той, що був до відкриття чужого): і в адресі — його код і школа, де в ньому найбільше очок */
  const restoreMine = () => {
    if (prev === null) return
    const r = readBuild(prev, { code: t('Твій білд зібрано на іншій версії дерева — перевір його'), snap: t('Дерево навичок оновилось — твій білд змінився') })
    openId.current = null
    setSaved(null)
    prefSet('skills:prev', null)
    setPrev(null)
    showBuild(r)
    const top = SCHOOLS.map(([id]) => [id, spent(skills.filter((x) => x.school === id), r.b)] as const).sort((x, y) => y[1] - x[1])[0]
    if (top && top[1] > 0) { prefSet('skills:school', top[0]); prefSet('skills:view', 'tree'); setTabS(top[0], { replace: true }) }
  }
  /** відкрити збережений білд: дерево — на школі, куди вкладено найбільше очок (а не на тій, що була відкрита) */
  const openSaved = (b: SavedBuild | null) => {
    setSaved(b)
    openId.current = b?.id ?? null
    if (!b) return
    stash(b.code)
    const r = readBuild(b.snap ?? b.code, {
      code: t('Білд «{name}» зібрано на іншій версії дерева — перевір його', { name: b.name }),
      snap: t('Білд «{name}» зібрано до оновлення гри — що змінилось', { name: b.name }),
    })
    showBuild(r)
    const top = SCHOOLS.map(([id]) => [id, spent(skills.filter((x) => x.school === id), r.b)] as const).sort((x, y) => y[1] - x[1])[0]
    if (top && top[1] > 0) { prefSet('skills:school', top[0]); prefSet('skills:view', 'tree'); setTabS(top[0], { replace: true }) }
  }
  // збережений білд за посиланням (/skills?build=<id> — з бібліотеки, сторінки людини чи гільдії)
  useEffect(() => {
    const id = linked
    if (!id || !skills.length || !loaded) return
    get<SavedBuild>(`/api/builds/${encodeURIComponent(id)}`)
      // після оновлення сторінки — лише блок білду: дерево вже з адреси (зі змінами, яких у збереженому ще нема)
      .then((b) => { if (reopened) { setSaved(b); openId.current = b.id } else openSaved(b) })
      .catch((e) => { openId.current = null; dropOpenId(); toast.error(t('Білд не відкрився'), { description: (e as Error).message }) })
      .finally(() => setLinkedWait(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills.length, loaded])
  // «Назад» / «Вперед» у браузері в межах планувальника: адреса знову з відкритим білдом (чи без) — показати те, що в ній
  const live = useRef({ code: '', saved: null as SavedBuild | null })
  live.current = { code, saved }
  useEffect(() => {
    if (!loaded) return
    const onPop = () => {
      if (useStore.getState().view !== 'skills') return
      const q = new URLSearchParams(location.search)
      const id = q.get('build'), b = q.get('b') || ''
      if (id !== openId.current) {
        openId.current = id
        if (!id) setSaved(null)
        else if (!b) {
          // посилання на збережений білд (/skills?build=<id>, напр. щойно скопійований) — відкрити його повністю
          get<SavedBuild>(`/api/builds/${encodeURIComponent(id)}`).then((x) => { if (openId.current === id) openSaved(x) }).catch(() => {})
          return
        } else {
          // знову до відкритого — свій відкладаємо (щоб «Повернутися до свого білду» знову працювало)
          stash(b || null)
          get<SavedBuild>(`/api/builds/${encodeURIComponent(id)}`).then((x) => { if (openId.current === id) setSaved(x) }).catch(() => {})
        }
      }
      if (b !== live.current.code) showBuild(readBuild(b || null, { code: t('Посилання зібране на іншій версії дерева (до оновлення гри) — перевір білд'), snap: '' }))
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])
  const setBuild = (b: Build) => {
    // зняті вузли — геть і зі слотів
    const e = { a: eq.a.filter((id) => b[id] > 0), t: eq.t.filter((id) => b[id] > 0) }
    setBuildState(b)
    setEqState(e)
    save(b, e, spec)
  }
  const setEq = (e: Eq) => { setEqState(e); save(build, e, spec) }
  const reset = () => { showBuild({ b: {}, eq: { a: [], t: [] }, spec: noSpecs(), note: null }) }
  const setSpec = (sp: Specs) => { setSpecState(sp); save(build, eq, sp) }

  const total = spent(skills, build)
  const fromCombat = combatPoints(spec, tracks?.combattrack)
  const budget = lvl + fromCombat
  const left = budget - total
  const specLv = spec.lv.reduce((a, b) => a + b, 0)
  const specGot = spec.got.reduce((a, g) => a + g.length, 0)
  const bySchool = (sc: string) => spent(skills.filter((s) => s.school === sc), build)
  const tree = useMemo(() => layout(skills, school), [skills, school])

  // панель — на всю сторінку, дерево — на все вільне в ній місце: масштаб k, щоб три гілки заповнили її по ширині
  // чи висоті (що впреться раніше). Менше 1 — ні: на вузькому екрані гілки стають одна під одну й сторінка гортається
  const scroller = useRef<HTMLDivElement>(null)
  const treeBox = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(1)
  // колонка гілки — завширшки з найширшу гілку всіх шкіл, а масштаб — від найширшої школи: при перемиканні шкіл
  // вузли не міняють розміру, а гілки стоять у тих самих колонках (не «стрибають»)
  const { colW, natW } = useMemo(() => {
    const trees = SCHOOLS.map(([sc]) => layout(skills, sc))
    const w = (b: { nodes: Skill[] }) => { const v = b.nodes.map((x) => place(x).vx); return (Math.max(...v) - Math.min(...v)) * UX + NODE + PAD * 2 }
    const colW = Math.max(0, ...trees.flatMap((tr) => tr.map(w)))
    const cols = Math.max(0, ...trees.map((tr) => tr.length))
    return { colW, natW: colW * cols + GAP_X * Math.max(0, cols - 1) }
  }, [skills])
  const natH = TITLE + 4 * ROW + NODE + PAD * 2
  useLayoutEffect(() => {
    const sc = scroller.current
    const tb = treeBox.current
    if (!sc || !tb || !natW) return
    const sec = tb.parentElement!
    const fit = () => {
      // вільна висота: вікно гортання мінус усе, що в панелі, крім дерева (шапка, слоти, підказки, відступи)
      const cs = getComputedStyle(sec)
      const kids = [...sec.children] as HTMLElement[]
      // картка відкритого білду й попередження з'являються й зникають — у розрахунок не беремо (інакше дерево «стрибає»)
      const stable = kids.filter((c) => c !== tb && !c.dataset.volatile)
      const other = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + (parseFloat(cs.rowGap) || 0) * stable.length + stable.reduce((n, c) => n + c.offsetHeight, 0)
      // кілька пікселів запасу: при масштабі «точно на всю ширину» найменше округлення переносило третю гілку вниз
      const kw = Math.floor(((tb.clientWidth - 4) / natW) * 1000) / 1000
      const next = kw < MIN_K ? 1 : kw < 1 ? kw : Math.max(1, Math.min(MAX_K, kw, (sc.clientHeight - other) / natH))
      setK((prev) => (Math.abs(prev - next) > 0.01 ? next : prev))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(sc)
    for (const c of sec.children) if (c !== tb && !(c as HTMLElement).dataset.volatile) ro.observe(c)
    return () => ro.disconnect()
  }, [natW, natH, !!data, view]) // eslint-disable-line react-hooks/exhaustive-deps

  const up = (s: Skill) => {
    const r = build[s.id] ?? 0
    if (r >= s.max) return void toast.info(t('«{name}» — уже найвищий ранг', { name: nameOf(s) }), { id: 'sk' })
    if (!open(s, build, branchOf, skills)) return void toast.info(t('Спершу візьми сусідній вузол — від нього цей відкривається'), { id: 'sk' })
    setBuild({ ...build, [s.id]: r + 1 })
  }
  const down = (s: Skill) => {
    const r = build[s.id] ?? 0
    if (!r) return
    const next = { ...build, [s.id]: r - 1 }
    if (!next[s.id]) delete next[s.id]
    if (!valid(skills, next, branchOf)) return void toast.info(t('На «{name}» тримаються інші вузли — спершу зніми їх', { name: nameOf(s) }), { id: 'sk' })
    setBuild(next)
  }
  const equip = (s: Skill) => {
    const k = slotOf(s)
    if (!k) return
    const list = eq[k]
    if (list.includes(s.id)) return setEq({ ...eq, [k]: list.filter((x) => x !== s.id) })
    if (list.length >= 3) return void toast.info(t('Слоти «{slot}» зайняті — звільни один кліком по ньому', { slot: k === 'a' ? t('Здібності') : t('Прийоми') }), { id: 'sk' })
    setEq({ ...eq, [k]: [...list, s.id] })
  }

  const sc = SCHOOLS.find((x) => x[0] === school) ?? SCHOOLS[0]
  // посилання — з відкритою вкладкою (?s=), щоб відкрилось там само
  const href = `${location.origin}/skills/${tabS}${code ? `?${new URLSearchParams({ b: code })}` : ''}`
  const copy = () => { navigator.clipboard?.writeText(href).then(() => toast.success(t('Посилання на білд скопійовано'), { id: 'sk' }), () => toast.info(href)) }
  // відкритий збережений білд змінено (і його можна змінювати) — смуга внизу: «Зберегти» — оновити його, «Скасувати» —
  // знову збережений; поки зміни є, піти зі сторінки не можна
  const savedCode = useMemo(() => (saved && skills.length ? (() => { const r = readBuild(saved.snap ?? saved.code, { code: '', snap: '' }); return encodeShort(skills, r.b, r.eq, r.spec) })() : null), [saved, skills]) // eslint-disable-line react-hooks/exhaustive-deps
  const buildDirty = !!saved?.item.can?.edit && savedCode !== null && code !== savedCode
  useUnsaved(buildDirty, {
    save: async () => {
      if (!saved || !data) return
      try {
        const nb = await put<SavedBuild>(`/api/builds/${saved.id}`, { name: saved.name, notes: saved.notes, code, about: aboutOf(SCHOOLS.map(([id]) => [id, spent(skills.filter((x) => x.school === id), build)]), spent(skills, build)), snap: snap(data, build, eq, spec) })
        setSaved({ ...nb, item: { ...nb.item, can: nb.item?.can ?? saved.item.can } })
        toast.success(t('Білд оновлено'))
      } catch (e) { toast.error(t('Не вдалося зберегти білд'), { description: (e as Error).message }) }
    },
    discard: () => { if (saved) showBuild(readBuild(saved.snap ?? saved.code, { code: '', snap: '' })) },
    label: saved ? t('Білд «{name}» змінено', { name: saved.name }) : undefined,
  })
  if (error) return <PageError page title={t('Уміння не завантажились')} onRetry={() => void load()} />
  if (!data) return <Loading page label={t('Збираю дерева навичок… перший раз це може тривати до пів хвилини.')} />
  if (linkedWait) return <Loading page label={t('Відкриваю білд…')} />

  // коротко про білд для збереження: школи з очками (українською — кожен побачить своєю мовою, lib/skills.aboutText)
  const buildAbout = aboutOf(SCHOOLS.map(([id]) => [id, bySchool(id)]), total)
  const cur = tip ? byId.get(tip.id) : null
  const curSlot = cur && slotOf(cur) && (build[cur.id] ?? 0) > 0 ? { label: slotOf(cur) === 'a' ? t('У здібності') : t('У прийоми'), in: eq[slotOf(cur)!].includes(cur.id) } : null

  return (
    // місце під смугу прокрутки — завжди: інакше вона, з'являючись, звужує дерево, масштаб перераховується, і гілки
    // «стрибають» (найпомітніше після переходу з бібліотеки, де вона вже була)
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
    {/* відкритий збережений білд — окремим блоком над планувальником (як шапка бази) */}
    {saved && <OpenBuild b={saved} onChange={setSaved} />}
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
      <section className="sk-night flex min-h-full flex-col gap-5 rounded-2xl px-3 py-4 sm:px-6 sm:py-5" aria-label={t('Навички')}>
        {/* школи, очки, посилання */}
        {/* школи й назва ліворуч, праворуч очки й дії; не влазить (телефон) — праве переходить на другий рядок, а не
            за край екрана */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="tablist" aria-label={t('Школи')}>
            {SCHOOLS.map(([id, name]) => {
              const I = ICON[id]
              const n = bySchool(id)
              const on = view === 'tree' && school === id
              return (
                <a key={id} href={tabHref(id)} role="tab" aria-selected={on} aria-label={name} data-tip={name} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setSchool(id) }} className="group relative grid h-12 w-12 shrink-0 place-items-center">
                  <span className={cn('absolute inset-[7px] rotate-45 rounded-[4px] border-2 transition-colors', on ? 'border-spice bg-spice' : 'border-line bg-panel group-hover:border-spice/70')} />
                  <I size={17} className={cn('relative', on ? 'text-on-spice' : 'text-ink/85')} />
                  {n > 0 && <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-panel px-1 font-mono text-[10px] leading-[14px] text-spice ring-1 ring-spice/50">{n}</span>}
                </a>
              )
            })}
            {/* спеціалізації — окремо від шкіл, за рискою */}
            <span className="mx-1 h-7 w-px bg-line" aria-hidden />
            <a
              href={tabHref('spec')}
              role="tab"
              aria-selected={view === 'spec'}
              aria-label={t('Спеціалізації')}
              data-tip={t('Спеціалізації')}
              onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); setView('spec'); setTip(null) }}
              className="group relative grid h-12 w-12 shrink-0 place-items-center"
            >
              <span className={cn('absolute inset-[7px] rounded-[6px] border-2 transition-colors', view === 'spec' ? 'border-spice bg-spice' : 'border-line bg-panel group-hover:border-spice/70')} />
              <Medal size={17} className={cn('relative', view === 'spec' ? 'text-on-spice' : 'text-ink/85')} />
              {specLv > 0 && <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-panel px-1 font-mono text-[10px] leading-[14px] text-spice ring-1 ring-spice/50" title={t('Куплено рис')}>{specGot}</span>}
            </a>
            {/* опис школи (чи спеціалізацій) — підказкою при наведенні на назву, не текстом на сторінці */}
            <h1
              tabIndex={0}
              data-tip={view === 'spec' ? SPEC_ABOUT() : sc[2]}
              className="ml-2 cursor-help whitespace-nowrap rounded-md bg-ink px-2.5 py-1 font-display text-[12px] font-bold uppercase tracking-[0.12em] text-panel"
            >
              {view === 'spec' ? t('Спеціалізації') : sc[1]}
            </h1>
          </div>
          <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
            {/* очки — одним рядком, такої ж висоти, як кнопки поруч */}
            <div
              className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line bg-panel/60 pl-3 pr-1 text-[12.5px]"
              title={fromCombat
                ? t('Очки навичок: {lvl} — за рівень персонажа (очко за рівень, до 200), {pts} — з куплених бойових рис «Очки навичок»', { lvl, pts: fromCombat })
                : t('Очки навичок: {lvl} — за рівень персонажа (очко за рівень, до 200); ще до 54 дають бойові риси «Очки навичок» (спеціалізації)', { lvl })}
            >
              <span className="font-semibold">{t('Очки навичок')}</span>
              <b className={cn('font-mono text-[15px] leading-none tabular-nums', left < 0 ? 'text-bad' : 'text-spice')}>{left}</b>
              <span className="whitespace-nowrap text-muted">{t('{total} з {budget} · рів.', { total, budget })}</span>
              {/* на телефоні — 16 px, інакше iOS збільшує сторінку при вводі */}
              <LevelInput value={lvl} min={1} max={200} onCommit={setLvl} label={t('Рівень персонажа')}
                className="h-7 w-12 rounded border border-line bg-panel px-1 font-mono text-[16px] text-ink sm:h-6 sm:w-11 sm:text-[12px]" />
            </div>
            <BuildsBar code={code} about={buildAbout} snap={() => snap(data, build, eq, spec)} open={saved} onOpen={openSaved} onCopy={copy} onBack={saved || prev !== null ? backToMine : null} onDelete={saved?.item.can?.manage ? () => setDeleting(true) : null} onReset={() => {
                if (total || specLv > 0) setResetting(true)
                else reset()
            }} />
          </div>
        </div>
        {notice && <DriftNote n={notice} nameOf={(id) => (byId.get(id) ? nameOf(byId.get(id)!) : id)} onClose={() => setNotice(null)} />}
        {left < 0 && <p data-volatile className="w-full rounded-md bg-bad/15 px-2 py-1 text-[12.5px] text-bad">{t('Білд дорожчий за бюджет на {n}.', { n: plural(-left, POINTS()) })}</p>}
        {resetting && <ConfirmDialog danger title={t('Очистити білд — навички, слоти й спеціалізації?')} confirm={t('Очистити')} onClose={() => setResetting(false)} onConfirm={reset} />}
        {deleting && saved && <ConfirmDialog danger title={t('Видалити білд «{name}»?', { name: saved.name })} confirm={t('Видалити')} onClose={() => setDeleting(false)} onConfirm={() => void removeSaved()} />}

        {view === 'spec' ? (
          // після того, як білд розібрано з адреси: стрічки одразу стають на рівні треків
          loaded && <SpecView spec={spec} tracks={tracks} set={setSpec} />
        ) : (
        <>
        {/* три гілки школи */}
        <div ref={treeBox} className="flex flex-1 flex-wrap content-center items-start justify-center gap-y-6" style={{ columnGap: GAP_X * k }}>
          {tree.map((b) => {
            const [ux, row, node, pad] = [UX * k, ROW * k, NODE * k, PAD * k]
            const vxs = b.nodes.map((n) => place(n).vx)
            const x0 = Math.min(...vxs)
            const W = (Math.max(...vxs) - x0) * ux + node + pad * 2
            const H = 4 * row + node + pad * 2
            const at = (n: Skill) => ({ x: (place(n).vx - x0) * ux + pad + node / 2, y: place(n).vy * row + pad + node / 2 })
            const ids = new Set(b.nodes.map((n) => n.id))
            const seen = new Set<string>()
            const edges: [Skill, Skill][] = []
            for (const n of b.nodes)
              for (const o of n.or) {
                const k = n.id < o ? `${n.id}|${o}` : `${o}|${n.id}`
                if (!ids.has(o) || seen.has(k)) continue
                seen.add(k)
                edges.push([n, byId.get(o)!])
              }
            return (
              <div key={b.key} className="grid justify-items-center gap-1" style={{ width: colW * k }}>
                <h2 className="flex min-h-[2.5em] max-w-[15em] items-end text-center font-display font-bold uppercase leading-tight tracking-[0.1em]" style={{ fontSize: 12 * Math.min(k, 1.25) }}>{BRANCH[b.key] ?? b.name}</h2>
                <div className="relative" style={{ width: W, height: H }}>
                  <svg width={W} height={H} className="absolute inset-0" aria-hidden>
                    {edges.map(([a, c], i) => {
                      const on = (build[a.id] ?? 0) > 0 && (build[c.id] ?? 0) > 0
                      return <line key={i} x1={at(a).x} y1={at(a).y} x2={at(c).x} y2={at(c).y} strokeWidth={on ? 3.5 : 2} strokeLinecap="round" className={on ? 'stroke-spice' : 'stroke-line'} />
                    })}
                  </svg>
                  {b.nodes.map((n) => {
                    const r = build[n.id] ?? 0
                    const can = r > 0 || open(n, build, branchOf, skills)
                    const cap = n.and.some((a) => a.startsWith('skills_key_capstone'))
                    const p = at(n)
                    const type = typeOf(n)
                    const size = type === 'ability' ? node + 8 * k : node
                    const sel = tip?.id === n.id
                    const about = { name: nameOf(n), kind: KIND[type], r, max: n.max }
                    return (
                      <button
                        key={n.id}
                        type="button"
                        data-skill-node
                        onPointerDown={(e) => { ptr.current = e.pointerType }}
                        onPointerEnter={(e) => { if (e.pointerType === 'mouse') show(n.id, e.currentTarget) }}
                        onPointerLeave={(e) => { if (e.pointerType === 'mouse') hide() }}
                        onFocus={(e) => { if (ptr.current !== 'touch') show(n.id, e.currentTarget) }}
                        onClick={(e) => {
                          if (ptr.current === 'touch') {
                            if (tip?.id === n.id) up(n)
                            else show(n.id, e.currentTarget, true)
                            return
                          }
                          show(n.id, e.currentTarget)
                          if (e.shiftKey) down(n)
                          else up(n)
                        }}
                        onContextMenu={(e) => { e.preventDefault(); show(n.id, e.currentTarget); down(n) }}
                        aria-label={can ? t('{name}, {kind}, ранг {r} з {max}', about) : t('{name}, {kind}, ранг {r} з {max}, закрито', about)}
                        className="group absolute rounded-full"
                        style={{ left: p.x - size / 2, top: p.y - size / 2, width: size, height: size }}
                      >
                        {cap && (
                          // завершальний вузол — у рамці, як у грі
                          <span className="pointer-events-none absolute -inset-[5px]" aria-hidden>
                            <span className={cn('absolute inset-0 rotate-45 border', r > 0 ? 'border-spice/70' : 'border-ink/30')} />
                            <span className={cn('absolute inset-0 border', r > 0 ? 'border-spice/50' : 'border-ink/20')} />
                          </span>
                        )}
                        <svg width={size} height={size} className="absolute inset-0 overflow-visible">
                          <Shape
                            kind={type}
                            size={size}
                            width={sel ? 3 : 2}
                            className={cn(
                              'transition-colors',
                              r > 0 ? 'fill-spice stroke-ink/90' : can ? 'fill-panel stroke-spice/80 group-hover:stroke-spice' : 'fill-panel/90 stroke-line',
                              sel && 'stroke-ink',
                            )}
                          />
                        </svg>
                        {n.icon && (
                          <img
                            src={`/catalog-icons/${n.icon}.webp`}
                            alt=""
                            loading="lazy"
                            className={cn('pointer-events-none absolute inset-0 m-auto object-contain', type === 'ability' ? 'h-[52%] w-[52%]' : 'h-[66%] w-[66%]', r > 0 ? 'brightness-0' : can ? 'opacity-95' : 'opacity-30')}
                          />
                        )}
                        {!can && (
                          <span className="pointer-events-none absolute -right-1 -top-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-panel ring-1 ring-line">
                            <Lock size={10} className="text-ink/70" />
                          </span>
                        )}
                        <Pips n={r} max={n.max} />
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* слоти, як у грі: здібності — ромби, прийоми — восьмикутники */}
        <div className="flex flex-wrap items-start justify-center gap-x-12 gap-y-4 border-t border-line pt-4">
          {([['a', t('Здібності'), 'ability'], ['t', t('Прийоми'), 'perk']] as const).map(([k, title, shape]) => (
            <div key={k} className="grid justify-items-center gap-2">
              <span className="font-display text-[11.5px] font-bold uppercase tracking-[0.12em] text-ink/85">{title}</span>
              <div className="flex gap-3">
                {[0, 1, 2].map((i) => {
                  const s = eq[k][i] ? byId.get(eq[k][i]) : null
                  return (
                    <button
                      key={i}
                      type="button"
                      data-skill-node
                      title={s ? undefined : t('Порожній слот: наведи на взятий вузол і в картці натисни «{btn}»', { btn: k === 'a' ? t('У здібності') : t('У прийоми') })}
                      aria-label={s ? t('{slot}: {name}, зняти зі слота', { slot: title, name: nameOf(s) }) : t('{slot}: порожній слот', { slot: title })}
                      onClick={() => { if (s) { equip(s); close() } }}
                      onPointerEnter={(e) => { if (s && e.pointerType === 'mouse') show(s.id, e.currentTarget) }}
                      onPointerLeave={(e) => { if (e.pointerType === 'mouse') hide() }}
                      className="relative grid h-14 w-14 place-items-center"
                    >
                      <svg width={56} height={56} className="absolute inset-0">
                        <Shape kind={shape} size={56} className={s ? 'fill-spice stroke-ink/90' : 'fill-panel/70 stroke-line'} />
                      </svg>
                      {s?.icon ? <img src={`/catalog-icons/${s.icon}.webp`} alt="" className="relative h-7 w-7 object-contain brightness-0" /> : <Plus size={15} className="relative text-ink/40" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        </>
        )}
        <div className="grid gap-1 text-center text-[11.5px] text-muted">
          {view === 'spec' ? (
            <p>{t('Клік по картці — купити чи продати рису (трек підніметься до її рівня); наведи на картку — що дає. Рівень треку — «−/+» у картці праворуч. Стрічки гортаються вбік. Рівні й куплені риси — теж у посиланні на білд.')}</p>
          ) : (
            <p>{t('Наведи на вузол — картка з рангами. Клік — ранг вище, правий клік чи Shift+клік — нижче; на телефоні: дотик — картка, ще дотик — ранг вище.')}</p>
          )}
          <p>
            {view === 'tree' && <>{t('Коло — атрибут, восьмикутник — прийом, ромб — здібність; у рамці — завершальний вузол гілки.')} </>}
            <T
              text="Дерево навичок — з файлів гри; значення рангів і спеціалізації — {gaming}."
              gaming={<a className="underline hover:text-spice" href={`https://dune.gaming.tools/${gtLang()}/skills`} target="_blank" rel="noopener">dune.gaming.tools</a>}
            />
            <DataStamp sep sections={['skills']} />
          </p>
        </div>
      </section>

      {cur && tip &&
        createPortal(
          <SkillTip
            s={cur}
            el={tip.el}
            out={out}
            rank={build[cur.id] ?? 0}
            branch={branchOf.get(cur.id) ? BRANCH[branchOf.get(cur.id)!] ?? branchOf.get(cur.id)! : null}
            slot={curSlot}
            pinned={tip.pin}
            onUp={() => up(cur)}
            onDown={() => down(cur)}
            onEquip={() => equip(cur)}
            onClose={close}
            onEnter={keep}
            onLeave={hide}
          />,
          document.body,
        )}
    </div>
    </div>
  )
}

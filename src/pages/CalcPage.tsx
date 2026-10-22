/**
 * Калькулятор виробництва — окрема сторінка: свій список цілей (предмети й будівлі довідника), разом.
 * Список живе в адресі (/calculator?t=…) — посиланням можна поділитися — і в налаштуваннях браузера.
 * Список з посилання (кнопка в довіднику, чуже посилання) збережений список не затирає: це окремий
 * розрахунок, поки його не додали до свого списку чи не повернулись до свого.
 * Розрахунок можна зберегти (цілі, вибрані станції — як рецепти, «Глибока пустеля», назва, нотатки, доступ) і
 * поділитися ним: /calculator?calc=<id>. Відкритий зі списку чи за посиланням — теж окремо від свого списку
 * (правки — до «Зберегти»; «Повернутися до свого розрахунку» повертає свій, «Назад» у браузері — знову відкритий);
 * збережений зі свого списку — і далі він.
 * Етапи калькулятора — в адресі (?step=), без неї — з першого. Сам калькулятор — спільний компонент ProdCalc.
 * Збережений розрахунок після оновлення гри: цілі й рецепти, яких у довіднику вже нема, — окремим поясненням, а не
 * мовчки й не як «незбережені зміни». Указ, з яким рахували, зберігається з розрахунком.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { loadCatalog, prettyId, type CatalogIndex } from '@/lib/catalog'
import { decodeTargets, encodeTargets, type CalcResult, type Target } from '@/lib/calc'
import { calcAbout, deleteCalc, getCalc, picksOf, samePicks, staleOf, stationsOf, type SavedCalc } from '@/lib/calcs'
import type { DecreeId } from '@/lib/decree'
import { prefGet, prefSet } from '@/lib/prefs'
import { plural } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { useStore } from '@/store'
import { ProdCalc } from '@/components/catalog/ProdCalc'
import { openInCatalog } from '@/components/catalog/bits'
import { CalcMenu, OpenCalc, SaveCalcDialog } from '@/components/calc/SavedCalcs'
import { PageHeader } from '@/components/PageHeader'
import { DataStamp } from '@/components/DataStamp'
import { Loading, PageError } from '@/components/states'
import { ConfirmDialog } from '@/pages/Account'
import { useCrumb, useScopeOf } from '@/components/Crumbs'
import { useUnsaved } from '@/components/UnsavedBar'

/** додати цілі до списку: що вже є — більшою кількістю */
function merge(base: Target[], add: Target[]) {
  const out = base.map((x) => ({ ...x }))
  for (const a of add) {
    const x = out.find((y) => y.kind === a.kind && y.id === a.id)
    if (x) x.qty = Math.min(100000, x.qty + a.qty)
    else out.push(a)
  }
  return out
}

type Stations = Record<string, number>
/** ціль, якої вже нема в довіднику, — словами з її id (назви вже нема звідки взяти) */
const goneName = (x: Target) => prettyId(x.id)

export default function CalcPage() {
  const [ix, setIx] = useState<CatalogIndex | null>(null)
  const [state, setState] = useState<'loading' | 'syncing' | 'error' | 'ok'>('loading')
  const [dd, setDd] = useState(() => prefGet('calc:dd', false))
  const [stations, setStations] = useState<Stations>(() => prefGet('calc:stations', {}))
  const [init] = useState(() => {
    const q = new URLSearchParams(location.search)
    const saved = prefGet<Target[]>('calc:targets', [])
    // ?calc=<id> — збережений розрахунок; поки вантажиться — свій список (якщо не відкриється, лишиться він)
    const calc = q.get('calc')
    if (calc) return { calc, targets: saved, saved: null }
    const url = decodeTargets(q.get('t'))
    return { calc: null, targets: url ?? saved, saved: url && saved.length && encodeTargets(saved) !== encodeTargets(url) ? saved : null }
  })
  const [targets, setTargets] = useState<Target[]>(init.targets)
  /** збережений список, поки на сторінці розрахунок з посилання */
  const [saved, setSaved] = useState<Target[] | null>(init.saved)
  /** відкритий збережений розрахунок; sep — відкрито окремо (зі списку, за посиланням): свій список у браузері не чіпаємо */
  const [open, setOpen] = useState<{ c: SavedCalc; sep: boolean } | null>(null)
  // шлях: Калькулятор (вкладка, де розрахунок лежить) › відкритий розрахунок; свій незбережений — «Розрахунок»
  const scope = useScopeOf(open?.c.item.owner)
  /** розрахунок, який відкрити, щойно буде довідник (станції — з його рецептів) */
  const [incoming, setIncoming] = useState<SavedCalc | null>(null)
  const [linking, setLinking] = useState(!!init.calc)
  // розрахунок за посиланням ще вантажиться — шляху поки нема (інакше мигне «Мої»)
  useCrumb(linking ? null : [{ label: open ? open.c.name : t('Розрахунок') }], { sub: scope })
  /** новий відкритий розрахунок — калькулятор наново, з першого етапу */
  const [gen, setGen] = useState(0)
  /** розрахунок з калькулятора — для збереження (рецепти, підсумок) */
  const [res, setRes] = useState<CalcResult | null>(null)
  const [dialog, setDialog] = useState<'save' | null>(null)
  /** указ, з яким калькулятор зараз рахує, — для збереження */
  const [decree, setDecree] = useState<DecreeId | null>(null)
  /** дія, яка відкине незбережені правки окремого розрахунку, — чекає на підтвердження */
  const [asking, setAsking] = useState<(() => void) | null>(null)
  /** підтвердження: видалити відкритий збережений, очистити свій список */
  const [ask, setAsk] = useState<'delete' | 'clear' | null>(null)

  // довідник; поки сервер уперше збирає його — перепитуємо кожні 4 с (як сам довідник)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const go = () =>
      loadCatalog()
        .then((r) => {
          if (!live) return
          if (r === 'syncing') { setState('syncing'); timer = setTimeout(go, 4000) }
          else { setIx(r); setState('ok') }
        })
        .catch(() => live && setState('error'))
    go()
    return () => { live = false; clearTimeout(timer) }
  }, [attempt])
  const retry = useCallback(() => { setState('loading'); setAttempt((n) => n + 1) }, [])

  const sep = !!open?.sep
  /** адреса сторінки: розрахунок (?calc=) чи цілі (?t=); решта параметрів (етап ?step=, ?haul=) лишається, крім fresh — новий відкритий, з першого етапу */
  const urlOf = (ts: Target[], o = open, fresh = false) => {
    const q = new URLSearchParams(location.search)
    q.delete('calc'); q.delete('t')
    if (fresh) q.delete('step')
    if (o) q.set('calc', o.c.id)
    else if (ts.length) q.set('t', encodeTargets(ts))
    // код цілей уже закодований (encodeURIComponent усередині) — не кодуємо вдруге
    const s = q.toString().replace(/(^|&)t=([^&]*)/, (_m, a, v) => `${a}t=${decodeURIComponent(v)}`)
    return '/calculator' + (s ? `?${s}` : '')
  }
  const update = (ts: Target[], keep = !!saved || sep) => {
    setTargets(ts)
    if (!keep) prefSet('calc:targets', ts)
    history.replaceState(null, '', urlOf(ts))
  }
  const leave = (ts: Target[]) => { setSaved(null); update(ts, false) }
  // DD і станції — свої налаштування, поки на сторінці не окремий збережений розрахунок
  const changeDd = (v: boolean) => { setDd(v); if (!sep) prefSet('calc:dd', v) }
  const changeStations = (v: Stations) => { setStations(v); if (!sep) prefSet('calc:stations', v) }

  // цілі, яких більше немає в довіднику, не показуємо
  const valid = useMemo(
    () => (ix ? targets.filter((x) => (x.kind === 'item' ? ix.item.has(x.id) : ix.cat.buildables.some((b) => b.id === x.id))) : []),
    [ix, targets],
  )
  const code = encodeTargets(valid)
  const picks = useMemo(() => (ix && res ? picksOf(ix, res) : null), [ix, res])
  const crafts = res ? res.steps.reduce((n, s) => n + s.crafts, 0) : 0
  // опис — українською (кожен побачить своєю мовою, lib/calcs.calcAboutText)
  const about = calcAbout(valid.length, crafts)
  // відкритий розрахунок проти довідника: що з нього зникло після оновлення гри
  const stale = useMemo(() => (ix && open ? staleOf(ix, open.c) : null), [ix, open])
  const dirty = !!open && !!stale && (code !== stale.fresh.code || dd !== open.c.dd || (!!picks && !samePicks(picks, stale.fresh.picks)) || (open.c.decree !== undefined && decree !== open.c.decree))
  // незбережені правки відкритого розрахунку — смуга внизу (як на всьому сайті): «Зберегти» — вікно збереження,
  // «Скасувати» — знову збережений; поки зміни є, піти зі сторінки не можна
  useUnsaved(dirty, {
    save: () => setDialog('save'),
    discard: () => { if (open) { setLinking(true); setIncoming(open.c) } },
    label: open ? t('Розрахунок «{name}» змінено', { name: open.c.name }) : undefined,
  })

  // збережений розрахунок за посиланням /calculator?calc=<id> (з бібліотеки, сторінки людини чи гільдії)
  useEffect(() => {
    if (!init.calc) return
    let live = true
    getCalc(init.calc).then((c) => live && setIncoming(c), (e) => {
      if (!live) return
      setLinking(false)
      toast.error(t('Розрахунок не відкрився'), { description: (e as Error).message })
      history.replaceState(null, '', urlOf(init.targets, null, true))
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // відкрити: цілі, DD, станції з рецептів (решта родин — свій вибір); калькулятор — з першого етапу
  useEffect(() => {
    if (!ix || !incoming) return
    const o = { c: incoming, sep: true }
    setOpen(o)
    setSaved(null)
    setTargets(decodeTargets(incoming.code) ?? [])
    setDd(incoming.dd)
    setStations({ ...prefGet<Stations>('calc:stations', {}), ...stationsOf(ix, incoming.picks ?? {}) })
    setRes(null) // поки калькулятор не порахує новий — без хибних «незбережених змін»
    setGen((n) => n + 1)
    setIncoming(null)
    setLinking(false)
    // новий відкритий — з першого етапу (адреса без ?step=, калькулятор наново — key={gen})
    history.replaceState(null, '', urlOf([], o))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ix, incoming])
  /** правки окремого розрахунку пропадуть — спершу спитати вікном */
  const guard = (go: () => void) => { if (sep && dirty) setAsking(() => go); else go() }
  /** закрити відкритий: окремий — назад до свого списку; свій — лишається на сторінці */
  const closeNow = () => {
    if (!open) return
    setOpen(null)
    if (!open.sep) return void history.replaceState(null, '', urlOf(targets, null))
    const own = prefGet<Target[]>('calc:targets', [])
    setTargets(own)
    setDd(prefGet('calc:dd', false))
    setStations(prefGet<Stations>('calc:stations', {}))
    setRes(null)
    setGen((n) => n + 1)
    history.replaceState(null, '', urlOf(own, null, true))
  }
  /**
   * «Повернутися до свого розрахунку» — одна дія замість «закрити» й «відкрити свій список»: відкритий (збережений чи
   * за посиланням) зникає, на сторінці — твій список. Новим кроком історії: «Назад» у браузері — знову до відкритого.
   */
  const backToMine = () => guard(() => {
    history.pushState(history.state, '', location.href)
    if (open) closeNow()
    else if (saved) leave(saved)
  })
  // «Назад» / «Вперед» у браузері: адреса знову з відкритим розрахунком (чи з чужими цілями, чи зі своїми) — показати те, що в ній
  const live = useRef({ open, saved, targets, closeNow })
  live.current = { open, saved, targets, closeNow }
  useEffect(() => {
    const onPop = () => {
      if (useStore.getState().view !== 'calculator') return
      const q = new URLSearchParams(location.search)
      const id = q.get('calc')
      const { open: o, saved: sv, targets: ts } = live.current
      if (id) {
        if (o?.c.id !== id) { setLinking(true); getCalc(id).then(setIncoming, () => setLinking(false)) }
        return
      }
      if (o?.sep) { live.current.closeNow(); return }
      // чужі цілі за посиланням (?t=) — знову окремо від свого списку; свої — свій
      const url = decodeTargets(q.get('t'))
      const own = prefGet<Target[]>('calc:targets', [])
      if (url && encodeTargets(url) !== encodeTargets(own)) { setSaved(sv ?? own); setTargets(url) }
      else if (sv) { setSaved(null); setTargets(own) }
      else if (encodeTargets(url ?? []) !== encodeTargets(ts)) setTargets(url ?? own)
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const onSaved = (c: SavedCalc) => {
    // зі свого списку — він і далі пишеться в браузер; з посилання чи відкритого окремо — окремо й лишається
    const o = { c, sep: open ? open.sep : !!saved }
    setOpen(o)
    setSaved(null)
    history.replaceState(null, '', urlOf(targets, o))
  }
  const link = open ? `${location.origin}/calculator?calc=${encodeURIComponent(open.c.id)}` : valid.length ? `${location.origin}/calculator?t=${code}` : null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1480px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={t('Калькулятор')}
          lead={<>{t('Скільки сировини, крафтів, води й часу треба на все разом: предмети й будівлі з довідника, з указом тижня з головної.')}<DataStamp sep sections={['items', 'recipes', 'buildables']} /></>}
          actions={
            <CalcMenu
              canSave={state === 'ok' && !linking && !!valid.length && !!res}
              link={linking ? null : link}
              open={open?.c ?? null}
              dirty={dirty}
              onSave={() => setDialog('save')}
              onBack={sep || (saved && !open) ? backToMine : null}
              onDelete={open?.c.item.can?.manage ? () => setAsk('delete') : null}
              onClear={open || saved ? undefined : valid.length ? () => setAsk('clear') : null}
            />
          }
        />
        {state === 'error' && <PageError title={t('Калькулятор не завантажився')} onRetry={retry} />}
        {state !== 'ok' && state !== 'error' && <Loading page label={state === 'syncing' ? t('Довідник оновлюється — це хвилина-дві, сторінка оновиться сама.') : t('Завантаження калькулятора…')} className="py-16" />}
        {state === 'ok' && ix && linking && <Loading page label={t('Відкриваю розрахунок…')} className="py-16" />}
        {state === 'ok' && ix && !linking && (
          <>
            {open && <OpenCalc c={open.c} dirty={dirty} onChange={(c) => setOpen({ ...open, c })} onSave={() => setDialog('save')} />}
            {open && stale && (stale.gone.length > 0 || stale.recipes > 0) && (
              <p role="status" className="flex items-start gap-2 rounded-xl border border-warn/50 bg-warn/10 px-4 py-2.5 text-[13px]">
                <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" />
                <span>
                  {t('Розрахунок зібрано до оновлення гри.')}{' '}
                  {stale.gone.length > 0 && t('Цього вже нема в довіднику, тож не рахується: {list}.', { list: stale.gone.map(goneName).join(', ') })}{' '}
                  {stale.recipes > 0 && t('Вибрані рецепти змінились ({n}) — узято найближчі.', { n: stale.recipes })}
                </span>
              </p>
            )}
            {saved && !open && (
              <p className="rounded-xl border border-spice/40 bg-spice/10 px-4 py-2.5 text-[13px]">
                {t('Це окремий розрахунок за посиланням — твій список ({count}) не змінено.', { count: plural(saved.length, [t('позиція'), t('позиції'), t('позицій')]) })}{' '}
                <span className="whitespace-nowrap">
                  <button type="button" onClick={() => leave(merge(saved, targets))} className="font-medium text-spice underline underline-offset-2">{t('Додати до свого списку')}</button>
                  {' · '}
                  <button type="button" onClick={backToMine} className="underline underline-offset-2 hover:text-spice">{t('Повернутися до свого розрахунку')}</button>
                </span>
              </p>
            )}
            <section className="rounded-xl border border-line bg-panel p-3 shadow-sm">
              <ProdCalc
                key={gen}
                ix={ix}
                targets={valid}
                onTargets={update}
                dd={dd}
                onDd={changeDd}
                stations={stations}
                onStations={changeStations}
                onResult={setRes}
                decree={open && open.c.decree !== undefined ? open.c.decree : undefined}
                onDecree={setDecree}
                open={(k, id) => openInCatalog(ix, k, id)}
              />
            </section>
          </>
        )}
      </div>
      {dialog === 'save' && <SaveCalcDialog doc={{ code, picks: picks ?? {}, dd, decree, about }} open={open?.c ?? null} onClose={() => setDialog(null)} onSaved={onSaved} />}
      {ask === 'delete' && open && (
        <ConfirmDialog danger title={t('Видалити розрахунок «{name}»?', { name: open.c.name })} confirm={t('Видалити')} onClose={() => setAsk(null)}
          onConfirm={() => void deleteCalc(open.c.id).then(() => { toast.success(t('Розрахунок видалено')); closeNow() }, (e) => toast.error(t('Не вдалося видалити'), { description: (e as Error).message }))} />
      )}
      {ask === 'clear' && (
        <ConfirmDialog danger title={t('Очистити розрахунок — прибрати всі цілі?')} confirm={t('Очистити')} onClose={() => setAsk(null)} onConfirm={() => update([])} />
      )}
      {asking && open && (
        <ConfirmDialog danger title={t('У розрахунку «{name}» є незбережені зміни. Відкинути їх?', { name: open.c.name })} confirm={t('Відкинути зміни')}
          onClose={() => setAsking(null)} onConfirm={asking} />
      )}
    </div>
  )
}

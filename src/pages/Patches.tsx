/**
 * «Що змінилось у патчі»: /patches — стрічка патчів гри (версія, збірка, скільки нового, прибраного й зміненого),
 * /patches/<збірка> — один патч: розділи довідника з новим (картки → довідник), прибраним і зміненим (поле: було →
 * стало; інгредієнти — предметами з кількістю). Усе — з файлів гри (server/lib/patches.mjs). Записи без назви мовою
 * людини — службові: не показуємо, лише рахуємо.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Minus, PackagePlus, Pencil } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Empty, ErrorAlert, Loading, PageError } from '@/components/states'
import { useCrumb } from '@/components/Crumbs'
import { Icon } from '@/components/catalog/bits'
import { iconUrl, kindLabel, groupLabel, rarityLabel, SECTIONS, subLabel, tierLabel } from '@/lib/catalog'
import { locale, t } from '@/lib/i18n'
import { fieldLabel, getPatch, hasChanges, listPatches, PATCH_SECTIONS, sectionTitle, totals, type Counts, type Patch, type PatchCard, type PatchChanged, type PatchHead, type PatchSection } from '@/lib/patches'
import { plainClick } from '@/lib/urlState'
import { openPath } from '@/store'
import { cn, fmtN } from '@/lib/utils'

const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) : null)
const titleOf = (p: PatchHead) => (p.version ? t('Оновлення гри {version}', { version: p.version }) : t('Збірка {build}', { build: p.build }))

export default function Patches({ build }: { build: string | null }) {
  return build ? <PatchPage key={build} build={build} /> : <PatchList />
}

/** посилання цього сайту: звичайний клік — без перезавантаження */
function Go({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return <a href={href} className={className} onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); openPath(href) }}>{children}</a>
}

function Chips({ c, className }: { c: Counts; className?: string }) {
  if (!c.added && !c.removed && !c.changed) return <span className={cn('text-[13px] text-muted', className)}>{t('без змін у довіднику')}</span>
  return (
    <span className={cn('flex flex-wrap gap-1.5 text-[12.5px] font-semibold', className)}>
      {c.added > 0 && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">{t('нового: {n}', { n: fmtN(c.added) })}</span>}
      {c.removed > 0 && <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-700 dark:text-rose-300">{t('прибрано: {n}', { n: fmtN(c.removed) })}</span>}
      {c.changed > 0 && <span className="rounded-full bg-spice/15 px-2 py-0.5 text-spice">{t('змінено: {n}', { n: fmtN(c.changed) })}</span>}
    </span>
  )
}

function PatchList() {
  const [list, setList] = useState<PatchHead[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useCrumb([])
  useEffect(() => { listPatches().then((r) => setList(r.items)).catch((e) => setError(e?.message || t('не вдалося завантажити'))) }, [])
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1100px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader title={t('Патчі гри')} lead={t('Що змінила кожна нова збірка гри: нові й прибрані предмети, пристрої, рецепти, будівлі й уміння. Порівнюємо самі файли гри.')} />
        {error ? <ErrorAlert message={error} /> : list === null ? <Loading lines={4} /> : !list.length ? (
          <Empty title={t('Патчів ще нема')} description={t('Щойно вийде нова збірка гри й сайт її отримає, тут з’явиться, що в ній змінилось.')} />
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {list.map((p) => {
              const on = hasChanges(p.summary)
              return (
                <li key={p.build}>
                  <Go href={`/patches/${p.build}`} className={cn('grid gap-1.5 rounded-xl border border-line bg-panel px-4 py-3 shadow-sm transition-colors hover:border-spice/60', !on && 'opacity-70')}>
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="break-words font-display text-[16px] font-bold">{titleOf(p)}</span>
                      <span className="text-[12.5px] text-muted">{[fmtDate(p.extractedAt), t('збірка {build}', { build: p.build })].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Chips c={totals(p.summary)} />
                  </Go>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function PatchPage({ build }: { build: string }) {
  const [p, setP] = useState<Patch | null>(null)
  const [error, setError] = useState<{ message: string; status?: number } | null>(null)
  useCrumb(p ? [{ label: titleOf(p) }] : error ? [] : null)
  useEffect(() => { getPatch(build).then(setP).catch((e) => setError({ message: e?.message || t('не вдалося завантажити'), status: e?.status })) }, [build])
  if (error) return <PageError page title={error.status === 404 ? t('Такого патча нема') : undefined} message={error.message} />
  if (!p) return <Loading page lines={6} />
  const any = hasChanges(p.summary)
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="mx-auto grid w-full max-w-[1100px] grid-cols-[minmax(0,1fr)] gap-2.5 pb-6">
        <PageHeader
          title={titleOf(p)}
          lead={t('Збірка {build} порівняно зі збіркою {prev}', { build: p.build, prev: p.prevBuild }) + (p.extractedAt ? ` · ${fmtDate(p.extractedAt)}` : '')}
        >
          <Chips c={totals(p.summary)} />
        </PageHeader>
        {!any && <Empty title={t('У довіднику гри змін нема')} description={t('Предмети, пристрої, рецепти, будівлі й уміння в цій збірці такі самі, як у попередній.')} />}
        {PATCH_SECTIONS.map((s) => <SectionBlock key={s} section={s} p={p} />)}
        <MapNote p={p} />
      </div>
    </div>
  )
}

/** куди веде запис у довіднику (уміння — без посилання) */
function hrefOf(section: PatchSection, x: PatchCard, refs: Patch['refs']): string | null {
  if (section === 'placeables') return `/catalog/placeable/${encodeURIComponent(x.id)}`
  if (section === 'buildables') return `/catalog/building/${encodeURIComponent(x.id)}`
  if (section === 'items') return `/catalog/${x.cat === 'misc' || !SECTIONS.some((s) => s.id === x.cat) ? 'resources' : x.cat}/${encodeURIComponent(x.id)}`
  if (section === 'recipes') {
    const out = x.out?.[0]?.[0]
    const r = out ? refs[out] : null
    return r ? hrefOf(r.kind === 'placeable' ? 'placeables' : 'items', r, refs) : null
  }
  return null
}
const iconOf = (x: PatchCard) => iconUrl(x.icon ?? x.img ?? null)

function SectionBlock({ section, p }: { section: PatchSection; p: Patch }) {
  const d = p.sections[section]
  if (!d || !(d.added.length + d.removed.length + d.changed.length)) return null
  const shown = (l: PatchCard[]) => l.filter((x) => x.loc)
  const added = shown(d.added), removed = shown(d.removed), changed = shown(d.changed) as PatchChanged[]
  const hidden = d.added.length + d.removed.length + d.changed.length - added.length - removed.length - changed.length
  return (
    <section aria-label={sectionTitle(section)} className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-display text-[17px] font-bold">{sectionTitle(section)}</h2>
        <Chips c={{ added: d.added.length, removed: d.removed.length, changed: d.changed.length }} />
      </div>
      {added.length > 0 && <CardGrid title={t('Нове')} icon={PackagePlus} list={added} section={section} refs={p.refs} />}
      {removed.length > 0 && <CardGrid title={t('Прибрано')} icon={Minus} list={removed} section={section} refs={p.refs} muted />}
      {changed.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted"><Pencil size={14} />{t('Змінено')}</h3>
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-line">
            {changed.map((x) => <ChangedRow key={x.id} x={x} section={section} refs={p.refs} />)}
          </ul>
        </div>
      )}
      {hidden > 0 && <p className="text-[12.5px] text-muted">{t('Ще {n} службових записів гри без назви — не показуємо.', { n: fmtN(hidden) })}</p>}
    </section>
  )
}

function CardGrid({ title, icon: I, list, section, refs, muted }: { title: string; icon: typeof Minus; list: PatchCard[]; section: PatchSection; refs: Patch['refs']; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted"><I size={14} />{title}</h3>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((x) => {
          const href = muted ? null : hrefOf(section, x, refs)
          const body = (
            <>
              <Icon src={iconOf(x)} size={40} grade={x.grade} />
              <span className="grid min-w-0">
                <span className={cn('break-words text-[14px] font-semibold leading-tight', muted && 'line-through decoration-muted/60')}>{x.loc}</span>
                <span className="text-[12px] text-muted">{[x.grade != null ? tierLabel(x.grade) : null, x.rarity ? rarityLabel(x.rarity) : null].filter(Boolean).join(' · ')}</span>
              </span>
            </>
          )
          const cls = cn('flex min-w-0 items-center gap-2.5 rounded-lg border border-line bg-panel2/40 px-2.5 py-2', href && 'transition-colors hover:border-spice/60', muted && 'opacity-75')
          return <li key={x.id}>{href ? <Go href={href} className={cls}>{body}</Go> : <div className={cls}>{body}</div>}</li>
        })}
      </ul>
    </div>
  )
}

function ChangedRow({ x, section, refs }: { x: PatchChanged; section: PatchSection; refs: Patch['refs'] }) {
  const href = hrefOf(section, x, refs)
  const head = (
    <span className="flex min-w-0 items-center gap-2.5">
      <Icon src={iconOf(x)} size={32} grade={x.grade} />
      <span className="break-words text-[14px] font-semibold">{x.loc}</span>
    </span>
  )
  const name = x.text?.name
  const desc = x.text?.desc
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-1.5 py-2.5">
      {href ? <Go href={href} className="w-fit max-w-full hover:text-spice">{head}</Go> : head}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 pl-[42px] text-[13.5px]">
        {name && <li><Change label={fieldLabel('name')} was={name[0] ?? '—'} now={name[1] ?? '—'} /></li>}
        {desc && (
          <li className="grid gap-1">
            <span className="text-muted">{fieldLabel('desc')}: <span className="text-ink">{t('змінено')}</span></span>
            {desc[1] && <p className="whitespace-pre-line break-words rounded-md bg-panel2/50 px-2.5 py-1.5 text-[13px]">{desc[1]}</p>}
            {desc[0] && (
              <details className="text-[12.5px] text-muted">
                <summary className="cursor-pointer select-none">{t('Як було')}</summary>
                <p className="mt-1 whitespace-pre-line break-words">{desc[0]}</p>
              </details>
            )}
          </li>
        )}
        {/* назва чи опис змінились англійською, а мовою людини — ще ні */}
        {!name && !desc && x.textChanged?.length ? <li className="text-muted">{t('Назву чи опис оновлено — переклад ще не змінився')}</li> : null}
        {x.fields.map(([k, a, b]) => <li key={k}><FieldValue k={k} a={a} b={b} refs={refs} /></li>)}
      </ul>
    </li>
  )
}

function Change({ label, was, now }: { label: string; was: ReactNode; now: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="text-muted">{label}:</span>
      <span className="break-words line-through decoration-muted/60">{was}</span>
      <ArrowRight size={13} className="shrink-0 text-muted" />
      <span className="break-words font-semibold">{now}</span>
    </span>
  )
}

const num = (v: unknown) => (typeof v === 'number' ? fmtN(v) : v == null ? '—' : null)
const refName = (refs: Patch['refs'], id: string) => refs[id]?.loc ?? null

/** одне змінене поле: числа й підписи — як є мовою людини; списки предметів — по предмету з кількістю */
function FieldValue({ k, a, b, refs }: { k: string; a: unknown; b: unknown; refs: Patch['refs'] }) {
  const label = fieldLabel(k)
  if (k === 'in' || k === 'out' || k === 'cost') return <AmountDiff label={label} a={(a ?? []) as [string, number][]} b={(b ?? []) as [string, number][]} refs={refs} />
  if (k === 'at') {
    const names = (v: unknown) => ((v ?? []) as string[]).map((id) => refName(refs, id)).filter(Boolean).join(', ') || '—'
    return <Change label={label} was={names(a)} now={names(b)} />
  }
  if (k === 'grade') return <Change label={label} was={tierLabel(Number(a ?? 0))} now={tierLabel(Number(b ?? 0))} />
  if (k === 'rarity') return <Change label={label} was={a ? rarityLabel(String(a)) : '—'} now={b ? rarityLabel(String(b)) : '—'} />
  if (k === 'kind') return <Change label={label} was={kindLabel(a as string | null)} now={kindLabel(b as string | null)} />
  if (k === 'sub') return <Change label={label} was={subLabel(a as string | null)} now={subLabel(b as string | null)} />
  if (k === 'group') return <Change label={label} was={a ? groupLabel(String(a)) : '—'} now={b ? groupLabel(String(b)) : '—'} />
  if (k === 'cat') {
    const sec = (v: unknown) => SECTIONS.find((s) => s.id === (v === 'misc' ? 'resources' : v))?.label ?? t('Інше')
    return <Change label={label} was={sec(a)} now={sec(b)} />
  }
  if (k === 'icon' || k === 'img') return <Change label={label} was={<Icon src={iconUrl((a as string) ?? null)} size={32} />} now={<Icon src={iconUrl((b as string) ?? null)} size={32} />} />
  if (k === 'levels') {
    const costs = (v: unknown) => ((v ?? []) as { cost: number }[]).map((l) => fmtN(l.cost)).join(' · ') || '—'
    const ca = costs(a), cb = costs(b)
    return ca !== cb ? <Change label={t('Ціна рангів')} was={ca} now={cb} /> : <span><span className="text-muted">{label}:</span> {t('бонуси рангів змінено')}</span>
  }
  const na = num(a), nb = num(b)
  if (na != null && nb != null) return <Change label={label} was={na} now={nb} />
  // текстові службові значення гри (школа, набір, позиція) — без сирого англійського
  return <span><span className="text-muted">{label}:</span> {t('змінено')}</span>
}

/** інгредієнти / результат / вартість: що з'явилось, зникло й скільки стало */
function AmountDiff({ label, a, b, refs }: { label: string; a: [string, number][]; b: [string, number][]; refs: Patch['refs'] }) {
  const was = new Map(a.map(([id, n]) => [id, n]))
  const now = new Map(b.map(([id, n]) => [id, n]))
  const ids = [...new Set([...was.keys(), ...now.keys()])]
  return (
    <span className="grid gap-1">
      <span className="text-muted">{label}:</span>
      <span className="flex flex-wrap gap-1.5">
        {ids.map((id) => {
          const x = was.get(id), y = now.get(id)
          const r = refs[id]
          const tone = x == null ? 'border-emerald-500/50' : y == null ? 'border-rose-500/50 opacity-75' : x !== y ? 'border-spice/60' : 'border-line'
          return (
            <span key={id} className={cn('flex min-w-0 items-center gap-1.5 rounded-md border bg-panel2/40 py-0.5 pl-0.5 pr-2', tone)}>
              <Icon src={r ? iconOf(r) : null} size={22} grade={r?.grade} />
              <span className="min-w-0 break-words">{r?.loc ?? t('предмет')}</span>
              <span className="font-mono text-[12.5px]">
                {x == null ? `+${fmtN(y!)}` : y == null ? <span className="line-through">{fmtN(x)}</span> : x !== y ? <>{fmtN(x)} → <b>{fmtN(y)}</b></> : fmtN(y)}
              </span>
            </span>
          )
        })}
      </span>
    </span>
  )
}

function MapNote({ p }: { p: Patch }) {
  if (!p.map) return null
  if ('skipped' in p.map) {
    return <p className="px-1 text-[12.5px] text-muted">{t('Мапу в цій збірці ми видобули новою версією нашого видобувача, тож зміни точок на мапі тут не рахуємо — щоб наші покращення не виглядали як патч гри.')}</p>
  }
  const all = Object.values(p.map.counts).flat()
  if (!all.length) return null
  const was = all.reduce((s, x) => s + x.was, 0), now = all.reduce((s, x) => s + x.now, 0)
  return (
    <section className="grid gap-1 rounded-xl border border-line bg-panel px-4 py-3 shadow-sm">
      <h2 className="font-display text-[16px] font-bold">{t('Мапа')}</h2>
      <p className="text-[13.5px]"><Change label={t('Точок у змінених типах')} was={fmtN(was)} now={fmtN(now)} /></p>
      <p className="text-[12.5px] text-muted">{t('Змінилась кількість точок {n} типів.', { n: fmtN(all.length) })}</p>
    </section>
  )
}

/**
 * Налаштування гільдії для офіцерів і лідера: герб і опис, сервер, регіон, пояс, мови й стиль гри, правила й вимоги,
 * розклад, Discord і Telegram, хто що бачить на сторінці, набір (відкрито / закрито) й анкета вступу. Усе — одним
 * «Зберегти» на смузі незбережених змін; герб зберігається одразу (файл). Назву, тег, колір і дім — лише лідер
 * (окремо, нижче на сторінці).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ImagePlus, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { patch } from '@/lib/api'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Img } from '@/components/ui/img'
import { Seg } from '@/components/ui/seg'
import { Toggle } from '@/components/ui/toggle'
import { SnInput, SnTextarea, valueOf } from '@/components/sn'
import { useUnsaved } from '@/components/UnsavedBar'
import { Section } from '../Account'
import { Field } from '../Auth'
import {
  BLOCKS, BLOCK_LABEL, COMMON_TZ, LANG_CODES, MAX_QUESTIONS, QUESTION_HINT, QUESTION_LABEL, QUESTION_TYPES, REGION_IDS, STYLES, STYLE_LABEL,
  langLabel, regionLabel, tzLabel, type Block, type GuildForm, type GuildProfile, type Question, type QuestionType,
} from '@/lib/guildProfile'
import { myZone } from '@/lib/weekly'
import { ScheduleEditor } from './Schedule'
import type { GuildData } from './types'

/** варіант-картка (як вибір дому): усі поруч, вибраний — підсвічений */
function Choice({ on, onClick, title, hint }: { on: boolean; onClick: () => void; title: string; hint?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className={cn('flex items-start gap-2 rounded-lg border px-3 py-2.5 text-left transition-colors', on ? 'border-spice/70 bg-spice/10' : 'border-line bg-panel2/40 hover:border-spice/40')}>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[13.5px] font-semibold">{title}</span>
        {hint && <span className="mt-0.5 block break-words text-[12px] leading-snug text-muted">{hint}</span>}
      </span>
      {on && <Check size={15} className="mt-0.5 shrink-0 text-spice" aria-hidden />}
    </button>
  )
}

const newId = () => Math.random().toString(36).slice(2, 10)

function QuestionEditor({ q, i, n, set, move, drop }: { q: Question; i: number; n: number; set: (q: Question) => void; move: (d: -1 | 1) => void; drop: () => void }) {
  return (
    <li className="grid gap-2.5 rounded-lg border border-line bg-panel2/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] text-muted">{i + 1}.</span>
        <Seg size="sm" label={t('Вид питання')} value={q.type} onChange={(type) => set({ ...q, type, ...(type === 'choice' && !q.options?.length ? { options: [], multi: false } : {}) })} items={QUESTION_TYPES.map((x) => ({ id: x, label: QUESTION_LABEL[x], tip: QUESTION_HINT[x] }))} />
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" disabled={i === 0} title={t('Вище')} aria-label={t('Вище')} onClick={() => move(-1)}><ArrowUp size={14} /></Button>
          <Button size="sm" variant="ghost" disabled={i === n - 1} title={t('Нижче')} aria-label={t('Нижче')} onClick={() => move(1)}><ArrowDown size={14} /></Button>
          <Button size="sm" variant="ghost" title={t('Прибрати питання')} aria-label={t('Прибрати питання')} onClick={drop}><Trash2 size={14} /></Button>
        </div>
      </div>
      <SnInput size="lg" maxLength={200} modelValue={q.label} placeholder={t('Текст питання')} accessibilityLabel={t('Текст питання')} onInput={(e: Event) => set({ ...q, label: valueOf(e) })} />
      {q.type === 'choice' && (
        <Field label={t('Варіанти — кожен з нового рядка')}>
          <SnTextarea size="lg" rows={3} modelValue={(q.options ?? []).join('\n')} accessibilityLabel={t('Варіанти — кожен з нового рядка')} onInput={(e: Event) => set({ ...q, options: valueOf(e).split('\n') })} />
        </Field>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Toggle pressed={q.required} onPressedChange={(v) => set({ ...q, required: v })}>{t('Обов’язкове')}</Toggle>
        {q.type === 'choice' && <Toggle pressed={!!q.multi} onPressedChange={(v) => set({ ...q, multi: v })}>{t('Можна кілька')}</Toggle>}
      </div>
    </li>
  )
}

/** анкета вступу: вступне слово й питання (до 12) */
function FormEditor({ form, onChange }: { form: GuildForm; onChange: (f: GuildForm) => void }) {
  const qs = form.questions
  const setQ = (i: number, q: Question) => onChange({ ...form, questions: qs.map((x, k) => (k === i ? q : x)) })
  const move = (i: number, d: -1 | 1) => { const next = [...qs]; [next[i], next[i + d]] = [next[i + d], next[i]]; onChange({ ...form, questions: next }) }
  const add = (type: QuestionType) => onChange({ ...form, questions: [...qs, { id: newId(), type, label: '', required: false, ...(type === 'choice' ? { options: [], multi: false } : {}) }] })
  return (
    <div className="grid gap-3">
      <Field label={t('Вступне слово до анкети')} hint={t('Кандидат побачить його над питаннями')}>
        <SnTextarea size="lg" rows={2} maxLength={1000} modelValue={form.intro} accessibilityLabel={t('Вступне слово до анкети')} onInput={(e: Event) => onChange({ ...form, intro: valueOf(e) })} />
      </Field>
      {qs.length > 0 && <ol className="grid gap-2">{qs.map((q, i) => <QuestionEditor key={q.id} q={q} i={i} n={qs.length} set={(x) => setQ(i, x)} move={(d) => move(i, d)} drop={() => onChange({ ...form, questions: qs.filter((_, k) => k !== i) })} />)}</ol>}
      {qs.length < MAX_QUESTIONS ? (
        <div className="grid gap-1.5">
          <span className="text-[12.5px] font-semibold">{t('Додати питання')}</span>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {QUESTION_TYPES.map((x) => (
              <button key={x} type="button" onClick={() => add(x)} className="flex items-start gap-2 rounded-lg border border-dashed border-line px-3 py-2.5 text-left hover:border-spice/50">
                <Plus size={15} className="mt-0.5 shrink-0 text-spice" />
                <span className="min-w-0"><span className="block text-[13.5px] font-semibold">{QUESTION_LABEL[x]}</span><span className="block text-[12px] leading-snug text-muted">{QUESTION_HINT[x]}</span></span>
              </button>
            ))}
          </div>
        </div>
      ) : <p className="text-[12.5px] text-muted">{t('В анкеті — не більше {n} питань', { n: MAX_QUESTIONS })}</p>}
    </div>
  )
}

interface Draft { about: string; open: boolean; profile: GuildProfile }

export function GuildSettings({ d, reload }: { d: GuildData; reload: () => void }) {
  const g = d.guild
  const from: Draft = useMemo(() => ({ about: g.about, open: g.open, profile: d.profile }), [d])
  const [x, setX] = useState<Draft>(from)
  // після збереження сторінка перечитала гільдію — чернетка знову як збережене
  useEffect(() => setX(from), [from])
  const [busy, setBusy] = useState(false)
  const [emblem, setEmblem] = useState(d.profile.emblem)
  const file = useRef<HTMLInputElement>(null)
  const p = x.profile
  const setP = (part: Partial<GuildProfile>) => setX({ ...x, profile: { ...p, ...part } })
  const dirty = JSON.stringify(x) !== JSON.stringify(from)
  const save = async () => {
    setBusy(true)
    try {
      // порожні варіанти вибору — геть (рядки, які людина ще не дописала)
      const form = { ...p.form, questions: p.form.questions.map((q) => (q.type === 'choice' ? { ...q, options: (q.options ?? []).map((o) => o.trim()).filter(Boolean) } : q)) }
      const { emblem: _e, ...profile } = { ...p, form }
      await patch(`/api/guilds/${g.slug}`, { about: x.about, open: x.open, profile })
      toast.success(t('Збережено'))
      reload()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  useUnsaved(dirty, { save, discard: () => setX(from), label: t('Налаштування гільдії не збережено') })
  const upload = async (f: File | undefined) => {
    if (!f) return
    try {
      const r = await fetch(`/api/guilds/${g.slug}/emblem`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f })
      const body = await r.json().catch(() => null)
      if (!r.ok) throw new Error(body?.error || t('Не вдалося зберегти'))
      setEmblem(body.emblem)
      toast.success(t('Герб змінено'))
      reload()
    } catch (e) { toast.error((e as Error).message) }
  }
  const dropEmblem = async () => {
    try { await fetch(`/api/guilds/${g.slug}/emblem`, { method: 'DELETE', credentials: 'same-origin' }); setEmblem(null); reload() } catch (e) { toast.error((e as Error).message) }
  }
  const mine = myZone()
  // пояси з однаковою назвою й зсувом (Київ і свій пояс, Берлін і Варшава) — одна картка; вибраний — той, що вже є
  const zones = [...new Map([...(p.tz ? [p.tz] : []), mine, ...COMMON_TZ].map((z) => [tzLabel(z) || z, z])).values()]
  const sameZone = (a: string | null, b: string) => !!a && (a === b || tzLabel(a) === tzLabel(b))
  const toggle = <T extends string>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((y) => y !== v))

  return (
    <div className="grid gap-2.5">
      <Section title={t('Герб і опис')} hint={t('Герб видно в каталозі, на сторінці гільдії й у прев’ю посилань. Квадратне зображення, до 8 МБ.')}>
        <div className="grid gap-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid shrink-0 place-items-center overflow-hidden rounded-2xl font-display text-[22px] font-bold text-white" style={{ background: g.color, width: 80, height: 80 }}>
              {emblem ? <Img src={emblem} alt="" width={80} height={80} className="object-cover" style={{ width: 80, height: 80 }} eager /> : g.tag}
            </span>
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} />
            <Button variant="secondary" onClick={() => file.current?.click()}><ImagePlus size={15} />{emblem ? t('Інший герб') : t('Завантажити герб')}</Button>
            {emblem && <Button variant="ghost" onClick={dropEmblem}>{t('Прибрати')}</Button>}
          </div>
          <Field label={t('Про гільдію')}>
            <SnTextarea size="lg" rows={3} maxLength={1000} modelValue={x.about} placeholder={t('Чим займаєтесь, кого шукаєте')} accessibilityLabel={t('Про гільдію')} onInput={(e: Event) => setX({ ...x, about: valueOf(e) })} />
          </Field>
        </div>
      </Section>

      <Section title={t('Де й як граєте')} hint={t('За цим гравці шукають гільдію в каталозі.')}>
        <div className="grid gap-4">
          <Field label={t('Сервер чи світ')} hint={t('Як він зветься в грі')}>
            <SnInput size="lg" maxLength={40} modelValue={p.server} accessibilityLabel={t('Сервер чи світ')} onInput={(e: Event) => setP({ server: valueOf(e) })} />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-semibold">{t('Регіон')}</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={t('Регіон')}>
              {[...REGION_IDS, null].map((r) => <Choice key={r ?? 'none'} on={p.region === r} onClick={() => setP({ region: r })} title={r ? regionLabel(r) : t('Не вказано')} />)}
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-semibold">{t('Часовий пояс гільдії')}</span>
            <span className="text-[12px] text-muted">{t('У ньому вписано розклад; кожен гравець побачить години у своєму поясі.')}</span>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label={t('Часовий пояс гільдії')}>
              {zones.map((z) => <Choice key={z} on={sameZone(p.tz, z)} onClick={() => setP({ tz: z })} title={tzLabel(z) || z} hint={sameZone(mine, z) ? t('твій пояс') : undefined} />)}
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-semibold">{t('Мови спілкування')}</span>
            <div className="flex flex-wrap gap-1.5">
              {LANG_CODES.map((c) => <Toggle key={c} pressed={p.langs.includes(c)} onPressedChange={(on) => setP({ langs: toggle(p.langs, c, on) })}><span className="first-letter:uppercase">{langLabel(c)}</span></Toggle>)}
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-semibold">{t('Стиль гри')}</span>
            <div className="flex flex-wrap gap-1.5">
              {STYLES.map((s) => <Toggle key={s} pressed={p.styles.includes(s)} onPressedChange={(on) => setP({ styles: toggle(p.styles, s, on) })}>{STYLE_LABEL[s]}</Toggle>)}
            </div>
          </div>
        </div>
      </Section>

      <Section title={t('Розклад активності')} hint={t('Коли гільдія зазвичай у грі — дні й години за поясом гільдії.')}>
        <ScheduleEditor label={t('Розклад активності')} value={p.schedule} onChange={(schedule) => setP({ schedule })} />
      </Section>

      <Section title={t('Правила й вимоги')}>
        <div className="grid gap-3.5">
          <Field label={t('Правила')}><SnTextarea size="lg" rows={4} maxLength={2000} modelValue={p.rules} accessibilityLabel={t('Правила')} onInput={(e: Event) => setP({ rules: valueOf(e) })} /></Field>
          <Field label={t('Вимоги до новачків')}><SnTextarea size="lg" rows={3} maxLength={2000} modelValue={p.requirements} placeholder={t('Рівень, години, мікрофон…')} accessibilityLabel={t('Вимоги до новачків')} onInput={(e: Event) => setP({ requirements: valueOf(e) })} /></Field>
        </div>
      </Section>

      <Section title={t('Discord і Telegram')} hint={t('Лише запрошення: https://discord.gg/… чи https://t.me/…')}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 sm:grid-cols-2">
          <Field label="Discord"><SnInput size="lg" type="url" maxLength={200} modelValue={p.links.discord} placeholder="https://discord.gg/…" accessibilityLabel="Discord" onInput={(e: Event) => setP({ links: { ...p.links, discord: valueOf(e).trim() } })} /></Field>
          <Field label="Telegram"><SnInput size="lg" type="url" maxLength={200} modelValue={p.links.telegram} placeholder="https://t.me/…" accessibilityLabel="Telegram" onInput={(e: Event) => setP({ links: { ...p.links, telegram: valueOf(e).trim() } })} /></Field>
        </div>
      </Section>

      <Section title={t('Хто що бачить')} hint={t('Офіцери й лідер бачать усе. «Лише учасники» — блок зникає зі сторінки для чужих, з каталогу й з прев’ю посилань.')}>
        <ul className="divide-y divide-line">
          {BLOCKS.map((b: Block) => (
            <li key={b} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-[13.5px] font-medium">{BLOCK_LABEL[b]}</span>
              <Seg size="sm" label={BLOCK_LABEL[b]} value={p.show[b] === 'guild' ? 'guild' : 'public'} onChange={(v) => setP({ show: { ...p.show, [b]: v } })} items={[{ id: 'public', label: t('Усі') }, { id: 'guild', label: t('Лише учасники') }]} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('Набір')} hint={t('Відкритий набір — гравці подають заявку за анкетою, офіцери розглядають у «Заявках». Закритий — вступ лише за запрошенням.')}>
        <div className="grid gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('Набір')}>
            <Choice on={x.open} onClick={() => setX({ ...x, open: true })} title={t('Набір відкрито')} hint={t('Заявки за анкетою')} />
            <Choice on={!x.open} onClick={() => setX({ ...x, open: false })} title={t('Набір закрито')} hint={t('Лише за запрошенням')} />
          </div>
          <FormEditor form={p.form} onChange={(form) => setP({ form })} />
        </div>
      </Section>
      {dirty && <div><Button disabled={busy} onClick={save}>{busy ? t('Зберігаю…') : t('Зберегти')}</Button></div>}
    </div>
  )
}

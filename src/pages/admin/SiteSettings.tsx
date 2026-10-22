/**
 * Налаштування сайту зручною формою: указ Ландсрааду цього тижня (один на сайт, картками — усі укази одразу), реєстрація,
 * мова за замовчуванням, назва сайту (у листах), ліміт учасників гільдії, ліміти речей, скільки зберігати журнал.
 * Кожен блок зберігає лише свої поля.
 */
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { toast } from 'sonner'
import { SnInput, SnNumberField, SnSegmented, SnSegmentedItem, SnSelect, valueOf } from '@/components/sn'
import { Loading } from '@/components/states'
import { get, patch } from '@/lib/api'
import { LANGS, t } from '@/lib/i18n'
import { DECREES, useDecree, type DecreeId } from '@/lib/decree'
import { fmtWhen } from '@/lib/ddReset'
import { cn } from '@/lib/utils'
import { FieldShell } from './fields'
import { adminHref, adminLink, hasPerm, useAdmin } from './api'
import { PageHeader, Panel } from './ui'
import { useUnsaved } from '@/components/UnsavedBar'

type Limits = Record<'user' | 'guild', Record<string, number>>
type Values = { registration: string; defaultLang: string; siteName: string; guildCap: number; limits: Limits; auditDays: number; revisionDays: number }

/** указ тижня: усі відомі укази картками + «не вказано» */
function DecreePicker() {
  const { id, until, loaded, load, set, canSet } = useDecree()
  useEffect(() => { if (!loaded) void load() }, [loaded, load])
  if (!loaded) return <Loading lines={3} />
  const card = (on: boolean) => cn('grid gap-1 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60', on ? 'border-spice/70 bg-spice/10' : 'border-line hover:border-spice/40')
  return (
    <div className="grid gap-2">
      <p className="text-[13px] text-muted">{id && until ? t('Діє до {when} (буря Коріоліса) — потім скинеться сам.', { when: fmtWhen(until) }) : t('Указ не вказано. Вибраний діятиме до найближчої бурі Коріоліса.')}</p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <button type="button" disabled={!canSet} aria-pressed={!id} onClick={() => set(null)} className={card(!id)}>
          <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">{!id && <Check size={14} className="text-spice" />}{t('Не вказано')}</span>
          <span className="text-[12.5px] text-muted">{t('Указ ще не відомий')}</span>
        </button>
        {DECREES.map((d) => (
          <button key={d.id} type="button" disabled={!canSet} aria-pressed={id === d.id} onClick={() => set(d.id as DecreeId)} className={card(id === d.id)}>
            <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">{id === d.id && <Check size={14} className="text-spice" />}{d.name}</span>
            <span className="text-[12.5px] leading-snug text-muted">{d.effect}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function SiteSettings() {
  const [v, setV] = useState<Values | null>(null)
  /** збережене на сервері — з чим порівнюємо (незбережене — у смузі внизу) */
  const [orig, setOrig] = useState<Values | null>(null)
  /** який блок зберігається (у кожного блоку — своя кнопка й свої поля) */
  const [, setBusy] = useState<string | null>(null)
  const perms = useAdmin((s) => s.meta?.permissions ?? [])
  const can = (p: string) => hasPerm(perms, p)
  useEffect(() => { if (can('site.settings')) get<{ values: Values }>('/api/admin/site-settings').then((r) => { setV(r.values); setOrig(r.values) }).catch((e) => toast.error((e as Error).message)) }, [])
  const save = async (block: string, keys: (keyof Values)[]) => {
    if (!v) return
    setBusy(block)
    try {
      const body = Object.fromEntries(keys.map((k) => [k, v[k]]))
      const got = (await patch<{ values: Values }>('/api/admin/site-settings', body)).values
      // беремо з відповіді лише збережене — незбережене в інших блоках лишається, як є
      setV((cur) => (cur ? { ...cur, ...Object.fromEntries(keys.map((k) => [k, got[k]])) } : got))
      setOrig((cur) => (cur ? { ...cur, ...Object.fromEntries(keys.map((k) => [k, got[k]])) } : got))
      toast.success(t('Налаштування збережено'))
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(null) }
  }
  const num = (x: unknown) => (x === '' || x == null ? NaN : Number(x))
  // що змінено — блоками; смуга внизу зберігає всі змінені блоки разом (і так само — «Скасувати»)
  const BLOCKS: Record<string, (keyof Values)[]> = { site: ['registration', 'guildCap', 'defaultLang', 'siteName'], limits: ['limits'], keep: ['auditDays', 'revisionDays'] }
  const changed = v && orig ? Object.entries(BLOCKS).filter(([, ks]) => ks.some((k) => JSON.stringify(v[k]) !== JSON.stringify(orig[k]))) : []
  const valid = !!v && !!v.siteName.trim() && Number.isInteger(v.guildCap) && Number.isInteger(v.auditDays) && Number.isInteger(v.revisionDays)
  useUnsaved(changed.length > 0, {
    save: async () => { if (!valid) { toast.error(t('Виправ поля з помилками')); return } for (const [b, ks] of changed) await save(b, ks) },
    discard: () => setV(orig),
    label: t('Налаштування сайту не збережено'),
  })
  return (
    <div className="grid gap-3">
      <PageHeader title={t('Налаштування сайту')} about={t('Кожна зміна тут потрапляє в «Історію змін» — видно, хто й коли що змінив.')}
        actions={<a href={adminHref(['settings'])} onClick={adminLink(['settings'])} className="text-[13px] text-spice hover:underline">{t('Усі значення')}</a>} />
      {can('site.decree') && (
        <Panel title={t('Указ Ландсрааду цього тижня')} description={t('Один на весь сайт, як у грі на сервері. На головній його бачать усі, калькулятор враховує.')}>
          <DecreePicker />
        </Panel>
      )}
      {can('site.settings') && (!v ? <Loading lines={5} /> : (
        <Panel title={t('Сайт')}>
          <form className="grid max-w-[640px] gap-4" onSubmit={(e) => { e.preventDefault(); void save('site', ['registration', 'guildCap', 'defaultLang', 'siteName']) }}>
            <FieldShell f={{ key: 'registration', label: 'Нові люди', help: 'Закрито — увійти можуть лише ті, хто вже має обліковий запис.' }}>
              <SnSegmented modelValue={v.registration} onChange={(e: Event) => setV({ ...v, registration: valueOf(e) })}>
                <SnSegmentedItem value="open">{t('Реєстрація відкрита')}</SnSegmentedItem>
                <SnSegmentedItem value="closed">{t('Реєстрацію закрито')}</SnSegmentedItem>
              </SnSegmented>
            </FieldShell>
            <FieldShell f={{ key: 'guildCap', label: 'Ліміт учасників гільдії', help: 'Як у грі — 32. Заповнену гільдію не поповнити ні заявкою, ні запрошенням.' }}>
              <SnNumberField className="w-[180px]" modelValue={v.guildCap} min={1} max={1000} step={1} accessibilityLabel={t('Ліміт учасників гільдії')} onChange={(e: Event) => setV({ ...v, guildCap: num(valueOf(e)) })} />
            </FieldShell>
            <FieldShell f={{ key: 'defaultLang', label: 'Мова за замовчуванням', help: 'Для тих, чий браузер не каже мови, яку знає сайт.' }}>
              <SnSelect modelValue={v.defaultLang} options={LANGS.map((l) => ({ value: l.code, label: l.name }))} accessibilityLabel={t('Мова за замовчуванням')} onChange={(e: Event) => setV({ ...v, defaultLang: valueOf(e) })} />
            </FieldShell>
            <FieldShell f={{ key: 'siteName', label: 'Назва сайту', help: 'У листах із кодом входу.' }} error={!v.siteName.trim() ? t('Назва не може бути порожньою') : undefined}>
              <SnInput modelValue={v.siteName} maxLength={60} accessibilityLabel={t('Назва сайту')} onInput={(e: Event) => setV({ ...v, siteName: valueOf(e) })} />
            </FieldShell>
          </form>
        </Panel>
      ))}
      {can('site.settings') && v && (
        <Panel title={t('Ліміти')} description={t('Скільки речей кожного виду може мати одна людина й одна гільдія — щоб сервер не засмічували. 0 — без обмежень. Адміністрацію й офіційне від сайту ліміти не стосуються.')}>
          <LimitsTable value={v.limits} onChange={(limits) => setV({ ...v, limits })} />
        </Panel>
      )}
      {can('site.settings') && v && (
        <Panel title={t('Журнал і історія')} description={t('Скільки днів пам’ятати, хто що робив і що змінювалось. Старіше щогодини прибирає фонова задача «Прибирання». 0 — зберігати завжди.')}>
          <div className="grid grid-cols-[minmax(0,1fr)] max-w-[640px] gap-4 sm:grid-cols-2">
            <FieldShell f={{ key: 'auditDays', label: 'Журнал дій, днів' }}>
              <SnNumberField className="w-[180px]" modelValue={v.auditDays} min={0} max={3650} step={1} accessibilityLabel={t('Журнал дій, днів')} onChange={(e: Event) => setV({ ...v, auditDays: num(valueOf(e)) })} />
            </FieldShell>
            <FieldShell f={{ key: 'revisionDays', label: 'Історія змін, днів' }}>
              <SnNumberField className="w-[180px]" modelValue={v.revisionDays} min={0} max={3650} step={1} accessibilityLabel={t('Історія змін, днів')} onChange={(e: Event) => setV({ ...v, revisionDays: num(valueOf(e)) })} />
            </FieldShell>
          </div>
        </Panel>
      )}
    </div>
  )
}

/** ліміти: вид речі рядком, людина й гільдія — стовпцями */
const LIMIT_KINDS: [string, string][] = [['base', 'Бази'], ['roadmap', 'Роадмапи'], ['build', 'Білди'], ['calc', 'Розрахунки'], ['marker', 'Позначки на мапі'], ['place', 'Записи ресурсів'], ['event', 'Події']]
function LimitsTable({ value, onChange }: { value: Limits; onChange: (v: Limits) => void }) {
  const set = (who: 'user' | 'guild', kind: string, n: number) => onChange({ ...value, [who]: { ...value[who], [kind]: Math.max(0, Math.round(n) || 0) } })
  return (
    <table className="w-full max-w-[560px] table-fixed text-[13.5px]">
      <thead><tr className="border-b border-line text-left text-[12px] text-muted"><th className="py-1.5 pr-2 font-medium">{t('Що')}</th><th className="w-[150px] px-2 py-1.5 font-medium">{t('На людину')}</th><th className="w-[150px] px-2 py-1.5 font-medium">{t('На гільдію')}</th></tr></thead>
      <tbody>
        {LIMIT_KINDS.map(([k, label]) => (
          <tr key={k} className="border-b border-line/60 last:border-0">
            <td className="py-1.5 pr-2">{t(label)}</td>
            {(['user', 'guild'] as const).map((who) => (
              <td key={who} className="px-2 py-1.5">
                <SnNumberField modelValue={value?.[who]?.[k] ?? 0} min={0} max={100000} step={1} accessibilityLabel={`${t(label)}: ${who === 'user' ? t('На людину') : t('На гільдію')}`} onChange={(e: Event) => set(who, k, Number(valueOf(e)))} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

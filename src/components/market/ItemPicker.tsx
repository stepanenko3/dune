/**
 * Вибір предмета для біржі — з довідника гри (лише те, що гра пускає на біржу): пошук назвою мовою сайту чи англійською
 * і розділ довідника; результати — картками з іконкою й тиром. Вибраний — одна картка з «Змінити».
 */
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { nameOf, rarityLabel, tierLabel } from '@/lib/catalog'
import { goodsOf, SECTION_LABEL, SECTIONS, sectionOf, type Section } from '@/lib/market'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Seg } from '@/components/ui/seg'
import { Loading } from '@/components/states'
import { SnInput, valueOf } from '@/components/sn'
import { Icon } from '@/components/catalog/bits'
import { Good } from './bits'
import { iconOf, useGoods } from './names'

const LIMIT = 18

export function ItemPicker({ value, onChange, exclude = [], label, compact }: { value: string; onChange: (gid: string) => void; exclude?: string[]; label: string; compact?: boolean }) {
  const ix = useGoods()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<Section | ''>('')
  const [open, setOpen] = useState(!value)
  const list = useMemo(() => {
    if (!ix) return []
    const s = q.trim().toLowerCase()
    return goodsOf(ix)
      .filter((i) => !exclude.includes(i.id) && (!cat || sectionOf(i) === cat) && (!s || (i.loc || i.name).toLowerCase().includes(s) || i.name.toLowerCase().includes(s)))
      // без пошуку — розділи по черзі (ресурси першими: їх продають найчастіше), усередині — за назвою й тиром
      .sort((a, b) => (s ? 0 : SECTIONS.indexOf(sectionOf(a)) - SECTIONS.indexOf(sectionOf(b))) || nameOf(a).localeCompare(nameOf(b)) || a.grade - b.grade)
  }, [ix, q, cat, exclude.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  if (value && !open) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-spice/50 bg-spice/5 p-2.5">
        <Good gid={value} size={compact ? 32 : 44} link={false} className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{t('Змінити')}</Button>
      </div>
    )
  }
  if (!ix) return <Loading label={t('Завантаження довідника…')} />
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SnInput type="search" size="lg" className="min-w-[min(220px,100%)] flex-1" modelValue={q} placeholder={t('Назва предмета')} accessibilityLabel={label} onInput={(e: Event) => setQ(valueOf(e))} />
        {value && <Button size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label={t('Скасувати')}><X size={14} />{t('Скасувати')}</Button>}
      </div>
      {!compact && <Seg size="sm" label={t('Розділ')} value={cat} onChange={setCat} items={[{ id: '' as const, label: t('Усі розділи') }, ...SECTIONS.map((s) => ({ id: s, label: SECTION_LABEL[s] }))]} />}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))] gap-1.5 rounded-lg border border-line p-1.5" aria-label={label}>
        {list.slice(0, LIMIT).map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => { onChange(i.id); setOpen(false) }} className={cn('flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left', i.id === value ? 'border-spice/60 bg-spice/10' : 'border-transparent hover:border-spice/40 hover:bg-panel2/60')}>
              <Icon src={iconOf(ix, i.id)} size={30} grade={i.grade} />
              <span className="min-w-0">
                <span className="block break-words text-[13px] font-semibold leading-snug">{nameOf(i)}</span>
                {/* однакові назви різних тирів і рідкостей — розрізняємо підписом */}
                {(i.grade > 0 || i.rarity) && <span className="block text-[11.5px] text-muted">{[i.grade > 0 ? tierLabel(i.grade) : '', i.rarity ? rarityLabel(i.rarity) : ''].filter(Boolean).join(' · ')}</span>}
              </span>
            </button>
          </li>
        ))}
        {!list.length && <li className="col-span-full p-3 text-center text-[13px] text-muted">{t('Нічого не знайшлося — спробуй іншу назву')}</li>}
        {list.length > LIMIT && <li className="col-span-full p-2 text-center text-[12px] text-muted">{t('Ще {n} — уточни назву', { n: list.length - LIMIT })}</li>}
      </ul>
    </div>
  )
}

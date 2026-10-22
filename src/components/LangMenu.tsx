/**
 * Мова сайту: кнопка з кодом поточної мови в шапці, у меню — усі мови гри одразу (без прокрутки й пошуку). Вибір
 * запам'ятовується (і в профілі, якщо увійшли) і перезавантажує сторінку — усе, разом із довідником, іншою мовою.
 */
import { useCallback, useRef, useState } from 'react'
import { Check, Languages } from 'lucide-react'
import { currentLang, LANGS, setLang, t } from '@/lib/i18n'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useMenuKeys } from '@/lib/menuKeys'

/** мова сайту: кнопка в блоці теми й мови шапки, по кліку — список усіх мов */
export function LangMenu() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const cur = currentLang()
  useMenuKeys(open, box, useCallback(() => setOpen(false), []), 2)
  const pick = (code: string) => {
    setOpen(false)
    if (code === cur) return
    const signedIn = !!useAuth.getState().user
    void setLang(code, { save: signedIn ? (l) => useAuth.getState().update({ lang: l }) : undefined })
  }
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" aria-label={t('Мова сайту: {lang}', { lang: LANGS.find((l) => l.code === cur)?.name ?? cur })}
        data-tip={t('Мова сайту')} className={cn('flex h-8 items-center justify-center gap-1 rounded-md px-2 font-display text-[11px] font-bold uppercase transition-colors', open ? 'bg-spice/15 text-spice' : 'text-muted hover:text-ink')}>
        <Languages size={15} className="text-spice" />
        <span className="hidden sm:inline">{cur.split('-')[0]}</span>
      </button>
      {/* на телефоні кнопка не край екрана — меню під шапкою на всю ширину (інакше вилазить ліворуч за екран) */}
      {open && (
        <div role="menu" className="absolute -right-1.5 top-[calc(100%+14px)] z-[950] grid w-[min(340px,calc(100vw-16px))] grid-cols-2 max-sm:fixed max-sm:inset-x-2 max-sm:top-[62px] max-sm:w-auto gap-0.5 rounded-xl border border-line bg-panel p-1.5 shadow-2xl">
          {LANGS.map((l) => (
            <button key={l.code} role="menuitemradio" aria-checked={l.code === cur} lang={l.code} onClick={() => pick(l.code)}
              className={cn('flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13.5px] hover:bg-panel2', l.code === cur ? 'font-semibold text-spice' : 'text-ink')}>
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              {l.code === cur && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

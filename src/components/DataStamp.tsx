/**
 * «оновлено 19 жовт.» — коли дані цих розділів востаннє реально змінились (або, якщо змін ще не було, — відколи за
 * ними стежимо); посилання на сторінку «Оновлення даних». Даних нема (перевірку вимкнено) — нічого не показує.
 */
import { locale, t } from '@/lib/i18n'
import { stampTime, useGdStatus } from '@/lib/gamedata'
import { plainClick } from '@/lib/urlState'
import { useStore } from '@/store'

/** sep — перед підписом « · » (лише коли є що показати, щоб не лишався зайвий розділювач) */
export function DataStamp({ sections, sep }: { sections: string[]; sep?: boolean }) {
  const s = useGdStatus()
  const when = stampTime(s?.sections ?? [], sections)
  if (!when) return null
  const date = new Date(when).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })
  return (
    <>
      {sep && ' · '}
      <a
        href="/data"
        className="underline hover:text-spice"
        onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); useStore.getState().setView('data') }}
      >
        {t('оновлено {date}', { date })}
      </a>
    </>
  )
}

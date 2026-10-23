/**
 * Вибір смайликів для розмов: вбудований набір емодзі (без бібліотек) розділами вкладками; клік — вставити в текст.
 * Відкривається над полем вводу; закривається клацанням повз і Esc.
 */
import { useEffect, useRef, useState } from 'react'
import { Smile } from 'lucide-react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const SETS: [() => string, string][] = [
  [() => t('Обличчя'), '😀 😁 😂 🤣 😊 😇 🙂 😉 😍 😘 😎 🤩 🤔 🤨 😐 😏 😴 😌 😜 🤪 😢 😭 😤 😡 🤯 😱 🥶 🥵 😬 🙄 😮 🤐 🤗 🤝 🫡 😈 💀 🤖 👽 🥳'],
  [() => t('Жести'), '👍 👎 👌 ✌️ 🤞 🤘 👊 ✊ 👏 🙌 🙏 💪 👋 🤙 👉 👈 👆 👇 ☝️ ✋ 🫶 👀 🧠 🫵'],
  [() => t('Дюна'), '🏜️ 🌵 🌞 🌙 ⭐ 🔥 💧 🌪️ ⚡ 🪐 🐛 🦂 🐪 🦅 ⚔️ 🗡️ 🛡️ 🏹 💣 🔫 🚁 🛸 🏰 ⛺ 🗺️ 🧭 💎 🪙 💰 ⚙️ 🔧 🛠️ 📦 🎯 🏆 👑 📜'],
  [() => t('Знаки'), '❤️ 🧡 💛 💚 💙 💜 🖤 💯 ✅ ❌ ⚠️ ❓ ❗ 💤 💬 🔔 🕐 ⏳ ➕ ➖ ↗️ 🔄 🆗 🆘'],
]

export function EmojiPicker({ onPick, className }: { onPick: (e: string) => void; className?: string }) {
  const [open, setOpen] = useState(false)
  const [set, setSet] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={box} className={cn('relative', className)}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t('Смайлики')} className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:bg-panel2 hover:text-spice">
        <Smile size={20} />
      </button>
      {open && (
        <div role="dialog" aria-label={t('Смайлики')} className="absolute bottom-[calc(100%+6px)] left-0 z-30 grid w-[min(320px,calc(100vw-32px))] gap-2 rounded-xl border border-line bg-panel p-2 shadow-2xl">
          <div className="flex flex-wrap gap-1">
            {SETS.map(([label], i) => (
              <button key={i} type="button" onClick={() => setSet(i)} aria-pressed={set === i} className={cn('rounded-md px-2 py-1 text-[12px] font-semibold', set === i ? 'bg-spice/10 text-spice' : 'text-muted hover:text-ink')}>{label()}</button>
            ))}
          </div>
          <div className="grid grid-cols-8 gap-0.5">
            {SETS[set][1].split(' ').map((e) => (
              <button key={e} type="button" onClick={() => onPick(e)} className="grid h-9 place-items-center rounded-md text-[20px] hover:bg-panel2" aria-label={e}>{e}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

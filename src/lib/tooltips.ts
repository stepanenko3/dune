/**
 * Одна плаваюча підказка на весь застосунок: будь-який елемент з data-tip="…" показує її при наведенні мишею, при
 * фокусі з клавіатури й при дотику (на телефоні — на 2,5 с). Fixed-позиція — тому не обрізається overflow:hidden
 * панелей і мапи. Escape, клік чи прокрутка ховають її.
 */
export function mountTooltips() {
  const tip = document.createElement('div')
  tip.className = 'data-tip-float'
  tip.id = 'data-tip-float'
  tip.setAttribute('role', 'tooltip')
  document.body.appendChild(tip)
  let cur: HTMLElement | null = null
  let touchTimer: ReturnType<typeof setTimeout> | undefined
  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const w = tip.offsetWidth, h = tip.offsetHeight
    let x = r.left + r.width / 2 - w / 2
    let y = r.top - h - 6
    if (y < 4) y = r.bottom + 6
    x = Math.max(6, Math.min(x, innerWidth - w - 6))
    tip.style.left = x + 'px'
    tip.style.top = y + 'px'
  }
  const hide = () => {
    if (cur?.getAttribute('aria-describedby') === tip.id) cur.removeAttribute('aria-describedby')
    tip.dataset.on = 'no'
    cur = null
  }
  const show = (el: HTMLElement | null) => {
    if (el === cur) return
    hide()
    const text = el?.getAttribute('data-tip')
    if (!el || !text) return
    cur = el
    tip.textContent = text
    place(el)
    tip.dataset.on = 'yes'
    // читач екрана прочитає підказку як опис (якщо вона не повторює підпис кнопки)
    if (!el.hasAttribute('aria-describedby') && el.getAttribute('aria-label') !== text) el.setAttribute('aria-describedby', tip.id)
  }
  const tipOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null
  let touching = false
  document.addEventListener('pointerdown', (e) => {
    touching = e.pointerType === 'touch'
    clearTimeout(touchTimer)
    if (!touching) { hide(); return }
    // дотик: показати підказку того, чого торкнулись, і прибрати сама — інакше «застрягає» до наступного дотику
    show(tipOf(e.target))
    touchTimer = setTimeout(hide, 2500)
  }, true)
  document.addEventListener('mouseover', (e) => { if (!touching) show(tipOf(e.target)) })
  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement
    // лише фокус із клавіатури (не після кліку мишею)
    if (!touching && el.matches?.(':focus-visible')) show(tipOf(el))
  })
  document.addEventListener('focusout', () => { if (!touching) hide() })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide() })
  document.addEventListener('scroll', hide, true)
  addEventListener('blur', hide)
}

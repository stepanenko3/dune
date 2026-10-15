/**
 * Одна плаваюча підказка на весь застосунок: будь-який елемент з data-tip="…" показує її
 * при наведенні. Fixed-позиція — тому не обрізається overflow:hidden панелей і мапи.
 */
export function mountTooltips() {
  const tip = document.createElement('div')
  tip.className = 'data-tip-float'
  document.body.appendChild(tip)
  let cur: HTMLElement | null = null
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
  document.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null
    if (el === cur) return
    cur = el
    const text = el?.getAttribute('data-tip')
    if (!el || !text) { tip.dataset.on = 'no'; return }
    tip.textContent = text
    place(el)
    tip.dataset.on = 'yes'
  })
  document.addEventListener('scroll', () => { tip.dataset.on = 'no'; cur = null }, true)
}

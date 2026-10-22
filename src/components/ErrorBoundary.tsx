/**
 * Збій сторінки не лишає білого екрана. Найчастіше — сайт оновився, а відкрита вкладка просить шматок старої збірки,
 * якого вже нема: тоді сторінку перезавантажуємо сама (раз — щоб не крутитись), інакше — повідомлення з «Оновити».
 */
import { Component, type ReactNode } from 'react'
import { PageError } from '@/components/states'
import { t } from '@/lib/i18n'

const CHUNK = /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|MIME type/i

/** перезавантажити сторінку, якщо за останню хвилину для цього ж місця ще не пробували; false — уже пробували */
export function reloadOnce(where: string): boolean {
  try {
    const [w, at] = (sessionStorage.getItem('chunk-reload') || '').split('|')
    if (w === where && Date.now() - Number(at) < 60_000) return false
    sessionStorage.setItem('chunk-reload', `${where}|${Date.now()}`)
  } catch { /* без сховища — пробуємо раз */ }
  location.reload()
  return true
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) {
    if (CHUNK.test(String(error?.message || error))) reloadOnce(location.pathname)
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    // перейшли на іншу сторінку — пробуємо знову
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    return <PageError page title={t('Сторінка не відкрилась')} message={t('Можливо, сайт щойно оновився. Онови сторінку.')} onRetry={() => location.reload()} />
  }
}

/**
 * Налаштування інтерфейсу — одним JSON-об'єктом під ключем `prefs` у localStorage
 * (тема, вкладки, шари мапи, згорнуті розділи, позначки «зібрано»). Без облікових
 * записів: це особисті зручності, а спільні записи живуть у базі на сервері.
 */
const BAG = 'prefs'

const readAll = (): Record<string, unknown> => {
  try {
    return JSON.parse(localStorage.getItem(BAG) ?? '{}')
  } catch {
    return {}
  }
}

export function prefGet<T>(key: string, fallback: T): T {
  const bag = readAll()
  return key in bag ? (bag[key] as T) : fallback
}

export function prefSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(BAG, JSON.stringify({ ...readAll(), [key]: value }))
  } catch {
    /* приватне вікно або заповнене сховище — живемо без збереження */
  }
}

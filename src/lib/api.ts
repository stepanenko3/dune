/**
 * Виклик API: JSON туди й назад, помилка — Error з повідомленням сервера (вже мовою людини: сервер бачить cookie
 * sw_lang) і кодом (status).
 */
import { t } from './i18n'

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message)
  }
}

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let r: Response
  try {
    r = await fetch(url, {
      method: init?.method || 'GET',
      headers: { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(t('Немає зв’язку з сайтом — перевір інтернет'), 0, null)
  }
  const body = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (!r.ok) throw new ApiError(body?.error || t('помилка {status}', { status: r.status }), r.status, body)
  return body
}

export const get = <T>(url: string) => api<T>(url)
export const post = <T>(url: string, body: unknown = {}) => api<T>(url, { method: 'POST', body })
export const put = <T>(url: string, body: unknown) => api<T>(url, { method: 'PUT', body })
export const patch = <T>(url: string, body: unknown) => api<T>(url, { method: 'PATCH', body })
export const del = <T>(url: string, body?: unknown) => api<T>(url, { method: 'DELETE', body })

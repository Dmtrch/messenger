const STORAGE_KEY = 'serverUrl'

/** Нормализует URL: убирает trailing slash, приводит к строке. */
function normalize(url: string): string {
  return url.trim().replace(/\/$/, '')
}

export function getServerUrl(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ''
}

export function setServerUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, normalize(url))
}

export function clearServerUrl(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function hasServerUrl(): boolean {
  return !!localStorage.getItem(STORAGE_KEY)
}

/**
 * При запуске из браузера (не standalone) автоматически устанавливает
 * текущий origin как адрес сервера.
 */
export function initServerUrl(): void {
  if (!hasServerUrl()) {
    setServerUrl(window.location.origin)
  }
}

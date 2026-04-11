const STORAGE_KEY = 'serverUrl'

/** Нормализует URL: убирает trailing slash, приводит к строке. */
function normalize(url: string): string {
  return url.trim().replace(/\/$/, '')
}

export function getServerUrl(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ''
}

export function setServerUrl(url: string): void {
  const normalized = normalize(url)
  const parsed = new URL(normalized) // бросает исключение при некорректном URL
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`)
  }
  localStorage.setItem(STORAGE_KEY, normalized)
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
    const origin = window.location.origin
    if (origin && origin !== 'null' && /^https?:\/\//.test(origin)) {
      setServerUrl(origin)
    }
  }
}

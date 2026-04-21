// Текущая версия клиента из env (задаётся при сборке через VITE_APP_VERSION)
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0'

interface VersionInfo {
  version: string
  minClientVersion: string
  buildDate: string
}

interface UpdateCheckResult {
  hasUpdate: boolean
  latestVersion: string
  isForced: boolean // true если текущая версия < minClientVersion
}

/** Сравнивает semver строки "x.y.z", возвращает -1/0/1 */
function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0)
  const [aMaj, aMin, aPat] = parse(a)
  const [bMaj, bMin, bPat] = parse(b)

  if (aMaj !== bMaj) return aMaj > bMaj ? 1 : -1
  if (aMin !== bMin) return aMin > bMin ? 1 : -1
  if (aPat !== bPat) return aPat > bPat ? 1 : -1
  return 0
}

/** Запрашивает GET /api/version и сравнивает с APP_VERSION */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const res = await fetch('/api/version')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const info: VersionInfo = await res.json()
    const latestVersion = info.version
    const hasUpdate = compareSemver(latestVersion, APP_VERSION) > 0
    const isForced = compareSemver(APP_VERSION, info.minClientVersion) < 0
    return { hasUpdate, latestVersion, isForced }
  } catch {
    return { hasUpdate: false, latestVersion: APP_VERSION, isForced: false }
  }
}

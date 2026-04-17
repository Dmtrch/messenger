import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { getServerUrl } from '@/config/serverConfig'
import s from './pages.module.css'

interface Artifact {
  platform: string
  arch: string
  format: string
  filename: string
  url: string
  sha256: string
  size_bytes: number
}

interface Manifest {
  generated_at: string
  artifacts: Artifact[]
}

const PLATFORM_LABELS: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
}

function detectOS(): string {
  const ua = navigator.userAgent.toLowerCase()
  if (/iphone|ipad|ipod/.test(ua)) return 'ios'
  if (/android/.test(ua)) return 'android'
  if (/win/.test(ua)) return 'windows'
  if (/mac/.test(ua)) return 'macos'
  if (/linux/.test(ua)) return 'linux'
  return 'unknown'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function downloadWithAuth(url: string, filename: string, token: string): Promise<void> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error('Ошибка скачивания')
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(blobUrl)
}

function ArtifactCard({
  artifact,
  primary = false,
  token,
}: {
  artifact: Artifact
  primary?: boolean
  token: string
}) {
  const [downloading, setDownloading] = useState(false)
  const [dlError, setDlError] = useState('')
  const label = PLATFORM_LABELS[artifact.platform] ?? artifact.platform
  const archLabel = artifact.arch ? ` (${artifact.arch})` : ''

  const handleDownload = async () => {
    setDownloading(true)
    setDlError('')
    try {
      await downloadWithAuth(
        `${getServerUrl()}${artifact.url}`,
        artifact.filename,
        token,
      )
    } catch (e: unknown) {
      setDlError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className={primary ? s.downloadsCardPrimary : s.downloadsCard}>
      <div className={s.downloadsCardInfo}>
        <strong>{label}{archLabel}</strong>
        <span className={s.downloadsFormat}>.{artifact.format}</span>
        {artifact.size_bytes > 0 && (
          <span className={s.downloadsMeta}>{formatBytes(artifact.size_bytes)}</span>
        )}
      </div>
      <button
        className={primary ? s.btn : s.btnOutline}
        onClick={handleDownload}
        disabled={downloading}
      >
        {downloading ? 'Скачивание…' : 'Скачать'}
      </button>
      {artifact.sha256 && (
        <p className={s.downloadsSha}>SHA256: {artifact.sha256}</p>
      )}
      {dlError && <p className={s.error}>{dlError}</p>}
    </div>
  )
}

export default function DownloadsPage() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((st) => st.accessToken) ?? ''
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const detectedOS = detectOS()

  useEffect(() => {
    fetch(`${getServerUrl()}/api/downloads/manifest`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error('Ошибка загрузки манифеста')
        return r.json() as Promise<Manifest>
      })
      .then(setManifest)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false))
  }, [accessToken])

  const primary = manifest?.artifacts.find((a) => a.platform === detectedOS)
  const secondary = manifest?.artifacts.filter((a) => a.platform !== detectedOS) ?? []

  return (
    <div className={s.downloadsPage}>
      <div className={s.downloadsHeader}>
        <button className={s.link} onClick={() => navigate('/')}>← Чаты</button>
        <h1 className={s.downloadsTitle}>Скачать приложение</h1>
      </div>

      {loading && <p className={s.sub}>Загрузка…</p>}
      {error && <p className={s.error}>{error}</p>}

      {!loading && !error && manifest && (
        <>
          {primary ? (
            <section className={s.downloadsSection}>
              <p className={s.sub}>Рекомендуется для вашей платформы</p>
              <ArtifactCard artifact={primary} primary token={accessToken} />
            </section>
          ) : (
            <p className={s.sub}>
              Нативное приложение для вашей платформы ещё не опубликовано.
            </p>
          )}

          {secondary.length > 0 && (
            <section className={s.downloadsSection}>
              <h2 className={s.downloadsSectionTitle}>Другие платформы</h2>
              {secondary.map((a) => (
                <ArtifactCard key={a.filename} artifact={a} token={accessToken} />
              ))}
            </section>
          )}

          {manifest.artifacts.length === 0 && (
            <p className={s.sub}>Дистрибутивы ещё не опубликованы.</p>
          )}
        </>
      )}
    </div>
  )
}

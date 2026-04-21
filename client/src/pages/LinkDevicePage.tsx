import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { initSodium, generateIdentityKeyPair, generateDHKeyPair, signData, toBase64 } from '@/crypto/x3dh'
import { saveIdentityKey, saveSignedPreKey, saveOneTimePreKeys, saveDeviceId } from '@/crypto/keystore'
import { api, setAccessToken } from '@/api/client'
import type { User } from '@/types'
import s from './pages.module.css'

const OPK_COUNT = 10

export default function LinkDevicePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const login = useAuthStore((st) => st.login)

  const [token, setToken] = useState(searchParams.get('link') ?? '')
  const [deviceName, setDeviceName] = useState(navigator.userAgent.substring(0, 60))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Если токен передан в URL — запускаем автоматически
  useEffect(() => {
    if (searchParams.get('link') && token) {
      void handleActivate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleActivate = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!token.trim()) { setError('Введите токен'); return }
    if (!deviceName.trim()) { setError('Введите имя устройства'); return }

    setLoading(true)
    setError('')

    try {
      await initSodium()

      const identityKey = generateIdentityKeyPair()
      const signedPreKey = generateDHKeyPair(1)
      const opks = Array.from({ length: OPK_COUNT }, (_, i) => generateDHKeyPair(i + 1))
      const spkSignature = signData(signedPreKey.publicKey, identityKey.privateKey)

      await saveIdentityKey(identityKey)
      await saveSignedPreKey(signedPreKey)
      await saveOneTimePreKeys(opks)

      const data = await api.activateDeviceLink({
        token: token.trim(),
        deviceName: deviceName.trim(),
        ikPublic: toBase64(identityKey.publicKey),
        spkId: signedPreKey.id,
        spkPublic: toBase64(signedPreKey.publicKey),
        spkSignature: toBase64(spkSignature),
        opkPublics: opks.map((k) => ({ id: k.id, key: toBase64(k.publicKey) })),
      })

      setAccessToken(data.accessToken)
      await saveDeviceId(data.deviceId)

      const user: User = {
        id: data.userId,
        username: data.username,
        displayName: data.displayName || data.username,
        identityKeyPublic: toBase64(identityKey.publicKey),
        role: (data.role as 'admin' | 'user') ?? 'user',
      }
      login(user, data.accessToken, data.deviceId)
      navigate('/chats')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка активации токена')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={s.authPage}>
      <div className={s.authCard}>
        <h1 className={s.authTitle}>Привязать устройство</h1>
        <p className={s.authSubtitle}>
          Введите токен с QR-кода или из ссылки, полученной на основном устройстве.
        </p>
        <form onSubmit={(e) => void handleActivate(e)} className={s.authForm}>
          <input
            className={s.authInput}
            placeholder="Токен привязки"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={loading}
            autoFocus
          />
          <input
            className={s.authInput}
            placeholder="Имя устройства"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            disabled={loading}
          />
          {error && <p className={s.authError}>{error}</p>}
          <button className={s.authBtn} type="submit" disabled={loading}>
            {loading ? 'Активация…' : 'Подключить'}
          </button>
        </form>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { initSodium, generateIdentityKeyPair, generateDHKeyPair, signData, toBase64 } from '@/crypto/x3dh'
import { saveIdentityKey, saveSignedPreKey, saveOneTimePreKeys, saveDeviceId } from '@/crypto/keystore'
import { api, setAccessToken } from '@/api/client'
import type { User } from '@/types'
import s from './pages.module.css'

const OPK_COUNT = 10

export default function AuthPage() {
  const login = useAuthStore((st) => st.login)
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) { setError('Заполните все поля'); return }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Ошибка входа'); return }

      setAccessToken(data.accessToken)
      const user: User = {
        id: data.userId,
        username: data.username,
        displayName: data.displayName || data.username,
        identityKeyPublic: '',
      }
      login(user, data.accessToken)
    } catch {
      setError('Ошибка соединения')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim() || !displayName.trim()) {
      setError('Заполните все поля')
      return
    }
    if (username.trim().length < 3) { setError('Логин минимум 3 символа'); return }
    if (password.length < 8) { setError('Пароль минимум 8 символов'); return }

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

      const { userId, accessToken } = await api.register({
        username: username.trim(),
        password: password,
        displayName: displayName.trim(),
        ikPublic: toBase64(identityKey.publicKey),
        spkId: signedPreKey.id,
        spkPublic: toBase64(signedPreKey.publicKey),
        spkSignature: toBase64(spkSignature),
        opkPublics: opks.map((k) => ({ id: k.id, key: toBase64(k.publicKey) })),
      })

      setAccessToken(accessToken)

      // Регистрируем устройство на сервере и сохраняем deviceId локально
      try {
        const { deviceId } = await api.registerKeys({
          deviceName: navigator.userAgent.substring(0, 100),
          ikPublic: toBase64(identityKey.publicKey),
          spkId: signedPreKey.id,
          spkPublic: toBase64(signedPreKey.publicKey),
          spkSignature: toBase64(spkSignature),
          opkPublics: opks.map((k) => toBase64(k.publicKey)),
        })
        await saveDeviceId(deviceId)
      } catch {
        // Не критично — deviceId можно получить позже
      }

      const user: User = {
        id: userId,
        username: username.trim(),
        displayName: displayName.trim(),
        identityKeyPublic: toBase64(identityKey.publicKey),
      }
      login(user, accessToken)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={s.authPage}>
      <div className={s.card}>
        <h1 className={s.logo}>Messenger</h1>
        <p className={s.sub}>Безопасный мессенджер с E2E шифрованием</p>

        <div className={s.tabs}>
          <button
            className={`${s.tab} ${tab === 'login' ? s.tabActive : ''}`}
            onClick={() => { setTab('login'); setError('') }}
            type="button"
          >Войти</button>
          <button
            className={`${s.tab} ${tab === 'register' ? s.tabActive : ''}`}
            onClick={() => { setTab('register'); setError('') }}
            type="button"
          >Регистрация</button>
        </div>

        {tab === 'login' ? (
          <form onSubmit={handleLogin} className={s.form}>
            <input
              className={s.input}
              type="text"
              placeholder="Логин (username)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
            />
            <input
              className={s.input}
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error && <p className={s.error} role="alert">{error}</p>}
            <button type="submit" className={s.btn} disabled={loading}>
              {loading ? 'Вход…' : 'Войти'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister} className={s.form}>
            <input
              className={s.input}
              type="text"
              placeholder="Логин (username)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
            />
            <input
              className={s.input}
              type="password"
              placeholder="Пароль (минимум 8 символов)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <input
              className={s.input}
              type="text"
              placeholder="Отображаемое имя"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
            {error && <p className={s.error} role="alert">{error}</p>}
            <button type="submit" className={s.btn} disabled={loading}>
              {loading ? 'Генерация ключей…' : 'Зарегистрироваться'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

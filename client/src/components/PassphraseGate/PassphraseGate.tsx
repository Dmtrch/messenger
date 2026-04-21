import { useState, useEffect } from 'react'
import { useVaultStore, unlockVault } from '@/store/vaultStore'
import { hasSaltStored } from '../../../../shared/native-core/crypto/cryptoVault'
import css from './PassphraseGate.module.css'

export function PassphraseGate() {
  const { isUnlocked } = useVaultStore()
  const [isCreate, setIsCreate] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setIsCreate(!hasSaltStored())
  }, [])

  if (isUnlocked) return null

  const validate = (): string => {
    if (passphrase.length < 8) return 'Пароль должен содержать не менее 8 символов'
    if (isCreate && passphrase !== confirm) return 'Пароли не совпадают'
    return ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')
    setLoading(true)
    try {
      await unlockVault(passphrase)
    } catch {
      setError('Неверный пароль')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={css.overlay}>
      <div className={css.card}>
        <h1 className={css.title}>
          {isCreate ? 'Создайте пароль хранилища' : 'Введите пароль хранилища'}
        </h1>
        <form className={css.form} onSubmit={handleSubmit}>
          <input
            className={css.input}
            type="password"
            placeholder="Пароль"
            value={passphrase}
            onChange={e => { setPassphrase(e.target.value); setError('') }}
            autoComplete={isCreate ? 'new-password' : 'current-password'}
            disabled={loading}
          />
          {isCreate && (
            <input
              className={css.input}
              type="password"
              placeholder="Повторите пароль"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError('') }}
              autoComplete="new-password"
              disabled={loading}
            />
          )}
          {error && <p className={css.error}>{error}</p>}
          <button className={css.btn} type="submit" disabled={loading}>
            {loading ? 'Загрузка...' : isCreate ? 'Продолжить' : 'Разблокировать'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default PassphraseGate

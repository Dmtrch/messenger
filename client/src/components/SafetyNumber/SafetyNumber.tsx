import { useEffect, useState } from 'react'
import s from './SafetyNumber.module.css'
import { loadIdentityKey, loadKnownPeerIK, saveKnownPeerIK } from '@/crypto/keystore'
import { toBase64 } from '@/crypto/x3dh'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'

interface Props {
  peerId: string
  peerName: string
  onClose: () => void
}

async function computeSafetyNumber(
  myUserId: string, myIK: string,
  peerUserId: string, peerIK: string
): Promise<string> {
  const [firstIK, secondIK] = myUserId < peerUserId
    ? [myIK, peerIK] : [peerIK, myIK]
  const combined = `${firstIK}:${secondIK}`
  const data = new TextEncoder().encode(combined)
  const hashBuf = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(hashBuf)
  const digits = Array.from(bytes.slice(0, 30))
    .flatMap(b => [Math.floor(b / 10) % 10, b % 10])
    .join('')
  return digits.match(/.{5}/g)?.join(' ') ?? digits
}

export default function SafetyNumber({ peerId, peerName, onClose }: Props) {
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const myUserId = useAuthStore((st) => st.currentUser?.id ?? 'me')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const myKeyPair = await loadIdentityKey()
        if (!myKeyPair) throw new Error('Свой ключ не найден')
        const myIK = toBase64(myKeyPair.publicKey)

        let peerIK = await loadKnownPeerIK(peerId)
        if (!peerIK) {
          const bundle = await api.getKeyBundle(peerId)
          const firstDevice = bundle.devices[0]
          if (!firstDevice) throw new Error('Ключи собеседника не найдены')
          peerIK = firstDevice.ikPublic
          await saveKnownPeerIK(peerId, peerIK)
        }

        const sn = await computeSafetyNumber(myUserId, myIK, peerId, peerIK)
        if (!cancelled) setSafetyNumber(sn)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка')
      }
    })()
    return () => { cancelled = true }
  }, [peerId, myUserId])

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={s.title}>Safety Number</h2>
        <p className={s.subtitle}>
          Сравните этот код с кодом {peerName} для проверки подлинности
        </p>
        {error && <p className={s.error}>{error}</p>}
        {safetyNumber && (
          <div className={s.number}>{safetyNumber}</div>
        )}
        {!safetyNumber && !error && (
          <div className={s.loading}>Вычисление...</div>
        )}
        <button className={s.closeBtn} onClick={onClose}>Закрыть</button>
      </div>
    </div>
  )
}

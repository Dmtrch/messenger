/**
 * Web Push VAPID подписка.
 * iOS 16.4+ и Android Chrome поддерживают Push API в PWA.
 */

import { useCallback } from 'react'
import { api } from '@/api/client'
import { getServerUrl } from '@/config/serverConfig'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)))
}

async function getVapidKey(): Promise<string> {
  const res = await fetch(`${getServerUrl()}/api/push/vapid-public-key`)
  if (!res.ok) throw new Error('vapid key unavailable')
  const { publicKey } = await res.json() as { publicKey: string }
  return publicKey
}

export function usePushNotifications() {
  const subscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('Push API не поддерживается')
      return
    }

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return

    let vapidKey: string
    try {
      vapidKey = await getVapidKey()
    } catch {
      console.warn('Не удалось получить VAPID ключ')
      return
    }

    const registration = await navigator.serviceWorker.ready

    const existing = await registration.pushManager.getSubscription()
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
    })

    try {
      await api.subscribePush(subscription.toJSON())
    } catch {
      console.warn('Не удалось сохранить push-подписку')
    }
  }, [])

  return { subscribe }
}

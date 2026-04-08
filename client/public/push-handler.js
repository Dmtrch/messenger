// Web Push и уведомления — импортируется через workbox importScripts

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try { payload = event.data.json() }
  catch { payload = { title: 'Messenger', body: event.data.text() } }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Messenger', {
      body: payload.body ?? 'Новое сообщение',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      tag: payload.chatId ?? 'messenger',
      data: { url: payload.chatId ? `/chat/${payload.chatId}` : '/' },
      actions: [
        { action: 'open', title: 'Открыть' },
        { action: 'dismiss', title: 'Закрыть' }
      ],
      vibrate: [200, 100, 200]
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.action === 'dismiss') return
  const targetUrl = event.notification.data?.url ?? '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin))
      if (existing) { existing.focus(); existing.navigate(targetUrl) }
      else { self.clients.openWindow(targetUrl) }
    })
  )
})

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then((sub) => fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub)
      }))
  )
})

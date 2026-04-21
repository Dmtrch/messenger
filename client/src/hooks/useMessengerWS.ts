import { useEffect, useRef } from 'react'
import { MessengerWS } from '@/api/websocket'
import {
  createBrowserWSWiring,
  createMessengerWSOrchestrator,
  type BrowserWSBindings,
  type BrowserApiClient,
} from '../../../shared/native-core'
import { deleteMessageFromDb } from '@/store/messageDb'

/**
 * Lifecycle-хук WebSocket-соединения мессенджера.
 *
 * Принимает apiClient и bindings (из useBrowserWSBindings).
 * Не импортирует сторы или api/client напрямую.
 *
 * WS пересоздаётся только при изменении token/isAuthenticated/currentUserId.
 * Свежие callback-ссылки из bindings доступны через bindingsRef без лишних reconnects.
 */
export function useMessengerWS(
  apiClient: BrowserApiClient,
  bindings: BrowserWSBindings,
) {
  const wsRef       = useRef<MessengerWS | null>(null)
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  useEffect(() => {
    if (!bindings.isAuthenticated || !bindings.token) return

    const deps        = createBrowserWSWiring(apiClient, bindings)
    const orchestrator = createMessengerWSOrchestrator(deps)

    const ws = new MessengerWS(
      bindings.token,
      (frame) => {
        const frameType = (frame as Record<string, unknown>)['type']
        if (frameType === 'remote_wipe') {
          localStorage.clear()
          void indexedDB.databases?.().then(dbs =>
            dbs.forEach(db => { if (db.name) indexedDB.deleteDatabase(db.name) })
          ).catch(() => {})
          bindingsRef.current.logout()
          return
        }
        if (frameType === 'message_expired') {
          const f = frame as { messageId: string; chatId: string }
          bindingsRef.current.deleteMessage(f.chatId, f.messageId)
          void deleteMessageFromDb(f.chatId, f.messageId).catch(() => {})
          return
        }
        if (frameType === 'device_removed') {
          const f = frame as { deviceId: string }
          if (f.deviceId === bindingsRef.current.currentDeviceId) {
            localStorage.clear()
            void indexedDB.databases?.().then(dbs =>
              dbs.forEach(db => { if (db.name) indexedDB.deleteDatabase(db.name) })
            ).catch(() => {})
            bindingsRef.current.logout()
          }
          return
        }
        void orchestrator.onFrame(frame)
      },
      () => { orchestrator.onConnect((frame) => wsRef.current!.send(frame)) },
      () => { orchestrator.onDisconnect() },
      () => { orchestrator.onAuthFail() },
    )

    ws.connect()
    wsRef.current = ws

    return () => {
      ws.disconnect()
      wsRef.current = null
      bindingsRef.current.setSend(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiClient, bindings.isAuthenticated, bindings.token, bindings.currentUserId])

  return wsRef
}

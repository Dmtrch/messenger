import { useEffect, useRef } from 'react'
import { MessengerWS } from '@/api/websocket'
import {
  createBrowserWSWiring,
  createMessengerWSOrchestrator,
  type BrowserWSBindings,
  type BrowserApiClient,
} from '../../../shared/native-core'

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

    const deps        = createBrowserWSWiring(apiClient, bindingsRef.current)
    const orchestrator = createMessengerWSOrchestrator(deps)

    const ws = new MessengerWS(
      bindings.token,
      (frame) => { void orchestrator.onFrame(frame) },
      () => { orchestrator.onConnect((frame) => ws.send(frame)) },
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

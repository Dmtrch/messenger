import type { BrowserApiClient } from '../../api/web/browser-api-client'
import type { MessengerWSOrchestratorDeps } from './messenger-ws-orchestrator'
import { mapChatSummariesToRealtimeChats, scheduleBrowserRealtimeTask } from './browser-messenger-ws-deps'

export interface BrowserWSBindings extends Omit<
  MessengerWSOrchestratorDeps,
  'getChats' | 'uploadPreKeys' | 'clearAccessToken' | 'schedule'
> {
  /** JWT токен текущей сессии — передаётся в apiClient.setAccessToken при создании wiring. */
  token: string | null
  /** Флаг для guard в useEffect: не создавать WS если не аутентифицирован. */
  isAuthenticated: boolean
  /** ID текущего устройства (из device-link flow), нужен для device_removed фрейма. */
  currentDeviceId?: string | null
}

/**
 * Собирает полный MessengerWSOrchestratorDeps из BrowserApiClient + BrowserWSBindings.
 *
 * Factory отвечает за четыре browser/API-специфичных поля:
 * - clearAccessToken → apiClient.setAccessToken(null)
 * - getChats        → apiClient.api.getChats() + маппинг ChatSummary → RealtimeChat
 * - uploadPreKeys   → apiClient.api.uploadPreKeys
 * - schedule        → scheduleBrowserRealtimeTask(setTimeout, ...)
 *
 * Все остальные поля берутся из bindings без изменений.
 * Вызывает apiClient.setAccessToken(bindings.token) немедленно при создании.
 */
export function createBrowserWSWiring(
  apiClient: BrowserApiClient,
  bindings: BrowserWSBindings,
): MessengerWSOrchestratorDeps {
  apiClient.setAccessToken(bindings.token)

  // Деструктурируем поля, которые не входят в MessengerWSOrchestratorDeps
  const { token: _token, isAuthenticated: _isAuthenticated, ...passthrough } = bindings

  return {
    ...passthrough,
    clearAccessToken() {
      apiClient.setAccessToken(null)
    },
    async getChats() {
      const result = await apiClient.api.getChats()
      return { chats: mapChatSummariesToRealtimeChats(result.chats) }
    },
    uploadPreKeys: (keys) => apiClient.api.uploadPreKeys(keys),
    schedule(delayMs, run) {
      return scheduleBrowserRealtimeTask(setTimeout, delayMs, run)
    },
  }
}
